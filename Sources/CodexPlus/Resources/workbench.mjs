import {randomUUID} from 'node:crypto';
import {TaskWorkspaceClient} from './task-workspace.mjs';
import {installWorkbenchView} from './workbench-view.mjs';
import {mobileStartupReadiness} from './mobile-access.mjs';

export const workbenchBinding = '__codexPlusWorkbenchOutbound';
export function workbenchMarker(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'app:' || u.hostname !== '-' || u.pathname !== '/index.html') return null;
    return u.searchParams.get('codexPlusWorkbench') ?? new URL(u.searchParams.get('initialRoute') ?? '/', 'https://route.invalid').searchParams.get('codexPlusWorkbench');
  } catch { return null; }
}
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export function validWorkbenchRequest(value) { return value?.version === 1 && uuid(value.request_id) && uuid(value.origin_runtime); }

export class Workbench {
  constructor({cdp, command, sessions, hostPID, previous, requestPlacement, persist, supported = true, client = new TaskWorkspaceClient()}) {
    Object.assign(this, {cdp, command, sessions, hostPID, requestPlacement, persist, supported, client});
    this.requests = new Map(); this.instance = randomUUID(); this.allowedRuns = new Set(); this.busy = false; this.stopped = false;
    if (previous?.workbench?.protocol === 1) {
      for (const request of previous.workbench.requests ?? []) if (validWorkbenchRequest({...request, version: 1})) this.requests.set(request.request_id, {...request, phase: ['closed', 'failed'].includes(request.phase) ? request.phase : 'unknown'});
      const old = previous.workbench.window;
      if (old && uuid(old.nonce) && uuid(old.instance)) {
        this.window = {...old, phase: 'unknown'};
        this.previousHost = previous.pid; this.previousController = previous.controllerPID;
        this.placementRequested = false;
      }
    }
  }
  status() {
    return {protocol: 1, supported: this.supported, window: this.window ?? null, requests: [...this.requests.values()].map(r => ({...r,
      ...r.nonce === this.window?.nonce ? {target: this.window.targetId ?? null, window: this.window.windowID ?? null, phase: this.window.phase} : {},
    }))};
  }
  open(message) {
    if (this.stopped || !this.supported || !validWorkbenchRequest(message) || this.requests.has(message.request_id)) return;
    if (!this.window || ['closed', 'failed'].includes(this.window.phase)) {
      if (this.window) for (const request of this.requests.values()) if (request.nonce === this.window.nonce) request.phase = this.window.phase;
      this.window = {nonce: randomUUID(), instance: this.instance, phase: 'requested', targetId: null, windowID: null};
      this.creationAttempted = false; this.placementRequested = false; this.placed = false; this.normalized = false;
      this.absenceRequested = false;
      this.previousHost = null; this.previousController = null;
    }
    this.requests.set(message.request_id, {request_id: message.request_id, origin_runtime: message.origin_runtime, nonce: this.window.nonce, phase: 'requested'});
    if (this.window.phase === 'ready') {
      const session = this.session();
      if (session) void this.command(session[0], 'Page.bringToFront').catch(() => {});
    }
  }
  session() { return [...this.sessions].find(([, s]) => s.target === this.window?.targetId); }
  placementResult(message) {
    const w = this.window;
    if (!w || this.stopped || message.nonce !== w.nonce || message.instance !== w.instance || message.targetId !== w.targetId) return;
    if (w.windowID != null && message.windowID !== w.windowID) return;
    if (Number.isSafeInteger(message.windowID) && message.windowID > 0) w.windowID = message.windowID;
    if (message.phase === 'identified') { this.placementRequested = false; return; }
    if (message.phase === 'closed') { w.phase = 'closed'; return; }
    if (message.phase === 'ready' && w.windowID) { this.placed = true; w.phase = 'loading'; }
    else if (message.phase === 'unknown') w.phase = 'unknown';
  }
  async tick() {
    if (this.busy || this.stopped || !this.supported || !this.window || ['closed', 'failed'].includes(this.window.phase)) return;
    this.busy = true;
    try {
      const w = this.window;
      if (this.previousController && this.previousController !== process.pid) {
        try { process.kill(this.previousController, 0); w.phase = 'unknown'; return; }
        catch (error) { if (error.code !== 'ESRCH') return; }
        this.previousController = null;
      }
      if (this.previousHost && this.previousHost !== this.hostPID) {
        try { process.kill(this.previousHost, 0); w.phase = 'unknown'; return; }
        catch (error) { if (error.code === 'ESRCH') w.phase = 'closed'; return; }
      }
      const {targetInfos} = await this.cdp.call('Target.getTargets');
      const matches = targetInfos.filter(t => t.type === 'page' && workbenchMarker(t.url) === w.nonce);
      if (matches.length > 1 || w.targetId && matches.some(t => t.targetId !== w.targetId)) { w.phase = 'unknown'; return; }
      if (!w.targetId && matches.length === 1) { w.targetId = matches[0].targetId; this.creationAttempted = true; }
      const target = targetInfos.find(t => t.type === 'page' && t.targetId === w.targetId);
      if (w.targetId && !target) {
        w.phase = 'unknown';
        if (w.windowID && !this.absenceRequested) { this.absenceRequested = true; this.requestPlacement({nonce: w.nonce, instance: w.instance, targetId: w.targetId, windowID: w.windowID, operation: 'inspect-absence'}); }
        return;
      }
      if (!target) {
        if (this.creationAttempted || w.phase === 'unknown') return;
        const source = [...this.sessions].find(([, s]) => s.main);
        if (!source) return;
        const probe = await this.command(source[0], 'Runtime.evaluate', {expression: `(${mobileStartupReadiness.toString()})(${JSON.stringify(w.nonce)})`, returnByValue: true});
        if (probe.result?.value !== 'ready') return;
        this.creationAttempted = true; w.phase = 'creating'; w.creationDispatched = true;
        await this.persist();
        const route = '/plugins/installed?' + new URLSearchParams({codexPlusWorkbench: w.nonce});
        const result = await this.command(source[0], 'Runtime.evaluate', {expression: `window.electronBridge.sendMessageFromView(${JSON.stringify({type: 'open-in-new-window', path: route})})`, returnByValue: true});
        if (result.exceptionDetails) w.phase = 'unknown';
        return;
      }
      if (workbenchMarker(target.url) !== w.nonce) { w.phase = 'unknown'; return; }
      const session = this.session(); if (!session) return;
      if (!this.placed) {
        if (!this.placementRequested) {
          this.placementRequested = true; w.phase = 'placing';
          let operation = 'identify';
          if (w.windowID) {
            operation = w.placementDispatched ? 'inspect' : 'place';
            w.placementDispatched = true;
            await this.persist();
          }
          this.requestPlacement({nonce: w.nonce, instance: w.instance, targetId: w.targetId, operation, ...w.windowID ? {windowID: w.windowID} : {}});
        }
        return;
      }
      const context = [...session[1].contexts.values()].find(c => c.auxData?.isDefault && c.auxData.frameId === session[1].frame);
      if (!context) return;
      const readiness = await this.command(session[0], 'Runtime.evaluate', {expression: 'document.readyState === "complete"', contextId: context.id, returnByValue: true});
      if (readiness.result?.value !== true) return;
      if (!this.normalized) {
        // A recovered window already shows its original conversation. Never
        // navigate or reset that document just to normalize its route.
        const route = new URL(target.url).searchParams.get('initialRoute') ?? '/';
        this.normalized = true;
        if (route.startsWith('/plugins/installed?codexPlusWorkbench=')) {
          const url = new URL('app://-/index.html'); url.searchParams.set('initialRoute', '/'); url.searchParams.set('codexPlusWorkbench', w.nonce);
          await this.command(session[0], 'Page.navigate', {url: url.href}); return;
        }
      }
      const result = await this.command(session[0], 'Runtime.evaluate', {expression: `(${installWorkbenchView.toString()})(${JSON.stringify({nonce: w.nonce, binding: workbenchBinding})})`, contextId: context.id, returnByValue: true});
      w.phase = result.result?.value?.ready && result.result.value.nonce === w.nonce ? 'ready' : 'loading';
    } catch { if (this.window) this.window.phase = 'unknown'; }
    finally { this.busy = false; }
  }
  async onBinding(message) {
    const session = this.sessions.get(message.sessionId), event = message.params, context = session?.contexts.get(event.executionContextId), w = this.window;
    if (this.stopped || !w || session?.target !== w.targetId || event.name !== workbenchBinding || !context?.auxData?.isDefault || context.auxData.frameId !== session.frame) return;
    let request; try { request = JSON.parse(event.payload); } catch { return; }
    if (request.version !== 1 || request.nonce !== w.nonce || !uuid(request.requestId)) return;
    let result;
    try {
      if (request.action === 'read') {
        const value = await this.client.read(request);
        if (request.operation === 'coordination') for (const action of value.coordination.actions) {
          if (action.host_id === 'sol' && uuid(action.thread_id) && typeof action.run_id === 'string' && action.run_id) this.allowedRuns.add(JSON.stringify([action.host_id, action.thread_id, action.run_id]));
        }
        result = {ok: true, value};
      } else if (request.action === 'open-thread' && this.allowedRuns.has(JSON.stringify([request.hostId, request.threadId, request.runId]))) {
        const url = new URL('app://-/index.html'); url.searchParams.set('initialRoute', `/local/${request.threadId}`); url.searchParams.set('codexPlusWorkbench', w.nonce);
        await this.command(message.sessionId, 'Page.navigate', {url: url.href}); return;
      } else throw Error('workbench_action_unavailable');
    } catch (error) {
      const errorCode = /^workspace_[a-z_0-9]+$/.test(error.message) ? error.message : 'workbench_action_unavailable';
      result = {ok: false, error: errorCode};
    }
    // The original context may have navigated or closed during the real API call.
    if (this.stopped || this.window !== w || this.sessions.get(message.sessionId) !== session || session.contexts.get(event.executionContextId) !== context || session.frame !== context.auxData.frameId) return;
    await this.command(message.sessionId, 'Runtime.evaluate', {expression: `globalThis.__codexPlusWorkbench?.resolve(${JSON.stringify(request.requestId)},${JSON.stringify(result)})`, contextId: event.executionContextId});
  }
  async close() {
    this.stopped = true; this.client.close();
    const w = this.window;
    if (!w?.targetId) return;
    const {targetInfos} = await this.cdp.call('Target.getTargets');
    const target = targetInfos.find(t => t.targetId === w.targetId && workbenchMarker(t.url) === w.nonce);
    if (!target) return;
    w.phase = 'unknown';
    await this.cdp.call('Target.closeTarget', {targetId: w.targetId});
    // Target disappearance still needs the native CG readback on next attach.
  }
}
