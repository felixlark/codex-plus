import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import {spawn, execFileSync, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {randomUUID, createHash} from 'node:crypto';
import {mobileHost} from './mobile-host.mjs';
import {encodeMobileValue, decodeMobileValue} from './mobile-codec.mjs';
import {installMobileEndpoint} from './mobile-endpoint.mjs';
import {installMobileGitOriginRepair} from './mobile-git-origin.mjs';

const run = promisify(execFile);
const binding = '__codexPlusMobileOutbound';
export function isTailIPv4(text) {
  const parts = String(text).split('.');
  return parts.length === 4 && parts.every(p => /^(0|[1-9]\d{0,2})$/.test(p) && Number(p) <= 255) && Number(parts[0]) === 100 && Number(parts[1]) >= 64 && Number(parts[1]) <= 127;
}
export function isAnchorURL(text, config) {
  try {
    const url = new URL(text), route = new URL(url.searchParams.get('initialRoute'), 'https://route.invalid');
    return url.protocol === 'app:' && url.hostname === '-' && url.pathname === '/index.html' && route.pathname === `/local/${config.threadId}` && route.searchParams.get('codexPlusMobileAnchor') === config.anchor &&
      (config.instance == null || route.searchParams.get('codexPlusMobileInstance') === config.instance);
  } catch { return false; }
}
export async function mobileHostSupported(archive) {
  const packageEntry = archive.entries.find(e => e.path === 'package.json');
  if (!packageEntry || JSON.parse(await archive.read(packageEntry)).version !== mobileHost.version) return false;
  for (const [name, expected] of [...Object.entries(mobileHost.nativeSHA256), ['.vite/build/preload.js', mobileHost.preloadSHA256], ['webview/index.html', mobileHost.indexSHA256]]) {
    const entry = archive.entries.find(e => e.path === name);
    if (!entry || createHash('sha256').update(await archive.read(entry)).digest('hex') !== expected) return false;
  }
  return true;
}

// Recheck after awaited native probes: a phone can navigate while they run.
export async function probeUnclaimedMobileThread(mobile, threadId, probe) {
  const revision = mobile?.claimRevision;
  if (mobile?.ownsThread(threadId)) return false;
  const ok = await probe();
  return ok && revision === mobile?.claimRevision && !mobile?.ownsThread(threadId);
}

export function mobileAnchorRoute(config) {
  const query = new URLSearchParams({codexPlusMobileAnchor: config.anchor, codexPlusMobileInstance: config.instance});
  return `/local/${config.threadId}?${query}`;
}

// Executed only in the current default context of the captured native target.
export function prepareMobileAnchor(nonce, instance) {
  const probe = {blank: location.href === 'about:blank', preload: !!window.electronBridge, complete: document.readyState === 'complete', ui: !!document.querySelector('script'), isolated: document.querySelector('meta[name="codex-plus-mobile-anchor"]')?.content === nonce};
  if (!probe.blank || !probe.preload || !probe.complete || probe.ui) return probe;
  if (!probe.isolated) {
    const policy = document.createElement('meta'); policy.httpEquiv = 'Content-Security-Policy'; policy.content = "default-src 'none'";
    const marker = document.createElement('meta'); marker.name = 'codex-plus-mobile-anchor'; marker.content = nonce;
    const generation = document.createElement('meta'); generation.name = 'codex-plus-mobile-instance'; generation.content = instance;
    document.head.append(policy, marker, generation); document.title = 'Codex Plus Mobile';
    document.body.textContent = 'Codex Plus 移动接入专用窗口';
  }
  return {...probe, isolated: document.querySelector('meta[name="codex-plus-mobile-anchor"]')?.content === nonce && document.querySelector('meta[name="codex-plus-mobile-instance"]')?.content === instance};
}

// Poll the original startup acknowledgement without awaiting it inside a CDP
// command. An accepted one-way window IPC is not proof that native window
// context exists yet; at cold start createFreshWindow can otherwise return null.
export function mobileStartupReadiness(nonce, load = () => import('app://-/assets/348410.374a9b8f98.js')) {
  let state = globalThis.__codexPlusMobileStartup;
  if (!state || state.nonce !== nonce || state.phase === 'missing') {
    state = {nonce, phase: 'loading'};
    globalThis.__codexPlusMobileStartup = state;
    void load().then(async module => {
      const startup = module.__webpack_require__('GaA7').appServices?.startup;
      if (!startup) { state.phase = 'missing'; return; }
      state.phase = 'waiting';
      await startup.whenReady(); state.phase = 'ready';
    }).catch(() => { state.phase = 'failed'; });
  }
  return state.phase;
}

export class MobileAccess {
  static async create(options) {
    let config;
    try { config = JSON.parse(await fs.readFile(path.join(path.dirname(options.stateFile), 'mobile.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw Error('Invalid mobile configuration'); }
    if (config.enabled !== true) return null;
    if (config.protocol !== 1 || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535 || !isTailIPv4(config.bind) || !/^[a-zA-Z0-9]+$/.test(String(config.nodeId)) || !/^\d+$/.test(String(config.userId)) || !/^[a-f0-9-]{36}$/.test(config.threadId) || !/^[a-f0-9-]{36}$/.test(config.anchor)) throw Error('Invalid mobile configuration');
    if (!options.supported) throw Error('Mobile host version unsupported');
    const {stdout} = await run('/usr/local/bin/tailscale', ['status', '--json']);
    const self = JSON.parse(stdout).Self;
    if (!self?.TailscaleIPs?.includes(config.bind) || String(self.ID) !== String(config.nodeId) || String(self.UserID) !== String(config.userId)) throw Error('Mobile Tailscale identity changed');
    return new MobileAccess(config, options);
  }
  constructor(config, {cdp, command, sessions, stateFile, publish, requestWindowPlacement, instance = randomUUID()}) {
    this.config = {...config, instance}; this.cdp = cdp; this.command = command; this.sessions = sessions; this.publish = publish;
    this.stateFile = stateFile; this.claimRevision = 0; this.clients = new Map(); this.phase = 'waiting-for-anchor'; this.anchorSession = null;
    this.stopped = false; this.creationAttempted = false; this.preparationAttempted = false; this.preparingFromLoader = null; this.anchorPrepared = false; this.busy = false;
    this.anchorQueue = Promise.resolve();
    this.requestWindowPlacement = requestWindowPlacement;
  }
  status() { return {phase: this.phase, protocol: 1, version: this.version ?? null, hostVersion: mobileHost.version, connections: this.clients.size, anchorReady: !this.stopped && this.anchorPrepared, port: this.port ?? null, targetId: this.anchorTarget ?? null, windowID: this.windowID ?? null, stage: this.stage ?? null, failure: this.failure ?? null, gitOriginReady: !!this.gitOriginContext, probe: this.lastProbe ?? null}; }
  windowPlacementResult(message) {
    if (!this.windowPlacementRequested || this.stopped || this.windowPlaced || message.anchor !== this.config.anchor || message.instance !== this.config.instance || message.targetId !== this.anchorTarget) return;
    if (this.windowPlacementUnknown && message.windowID !== this.windowID) return;
    if (message.phase === 'ready' && Number.isSafeInteger(message.windowID) && message.windowID > 0) {
      this.windowID = message.windowID; this.windowPlaced = true;
      this.windowPlacementUnknown = false;
    } else if (message.phase === 'unknown') {
      this.windowPlacementUnknown = true;
      if (Number.isSafeInteger(message.windowID) && message.windowID > 0) this.windowID = message.windowID;
    }
  }
  isAnchorURL(url) { return isAnchorURL(url, this.config); }
  async tick() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      this.stage = 'targets';
      const {targetInfos} = await this.cdp.call('Target.getTargets');
      const candidates = targetInfos.filter(t => t.type === 'page' && this.isAnchorURL(t.url));
      if (candidates.length > 1 || this.anchorTarget && candidates.some(t => t.targetId !== this.anchorTarget)) throw Error('Ambiguous mobile anchor');
      // Ownership is sticky after the original nonce URL identifies the native
      // registered window. Never adopt a replacement or an unrelated blank page.
      if (!this.anchorTarget && candidates.length) this.anchorTarget = candidates[0].targetId;
      const anchors = targetInfos.filter(t => t.type === 'page' && t.targetId === this.anchorTarget);
      if (this.anchorTarget && !anchors.length) throw Error('Mobile anchor lost');
      if (anchors.length && !this.isAnchorURL(anchors[0].url) && anchors[0].url !== 'about:blank') throw Error('Mobile anchor lost');
      if (anchors.length) {
        const session = [...this.sessions].find(([, s]) => s.target === anchors[0].targetId);
        if (!session) return;
        this.anchorSession = session[0];
        if (this.requestWindowPlacement && !this.windowPlaced) {
          this.phase = this.windowPlacementUnknown ? 'window-placement-unknown' : 'awaiting-right-window-placement';
          if (!this.windowPlacementRequested) {
            this.windowPlacementRequested = true;
            this.requestWindowPlacement({anchor: this.config.anchor, instance: this.config.instance, targetId: this.anchorTarget});
          }
          return;
        }
        if (!session[1].frame) { this.phase = 'anchor-loading'; return; }
        this.stage = 'frame-tree';
        const {frameTree} = await this.command(session[0], 'Page.getFrameTree');
        if (this.stopped) return;
        if (this.preparationAttempted && frameTree.frame.loaderId === this.preparingFromLoader) { this.phase = 'anchor-loading'; return; }
        if (!this.preparationAttempted) {
          // The native sender stays registered; main-frame navigation tears down
          // any old app-host before the phone can register its sole port.
          this.preparationAttempted = true; this.preparingFromLoader = frameTree.frame.loaderId; this.phase = 'preparing-anchor'; this.stage = 'navigate';
          const navigation = await this.command(session[0], 'Page.navigate', {url: 'about:blank'});
          if (navigation.errorText) throw Error('Mobile anchor navigation failed');
          return;
        }
        const context = [...session[1].contexts.values()].find(c => c.auxData?.isDefault && c.auxData.frameId === frameTree.frame.id);
        if (!context) { this.phase = 'anchor-loading'; return; }
        this.stage = 'probe';
        const result = await this.evaluate(`(${prepareMobileAnchor.toString()})(${JSON.stringify(this.config.anchor)},${JSON.stringify(this.config.instance)})`, false, context.id);
        this.lastProbe = Object.fromEntries(['blank', 'preload', 'complete', 'isolated', 'ui'].map(key => [key, result?.[key] === true]));
        this.stage = 'isolation-check';
        if (!result.complete) { this.phase = 'anchor-loading'; return; }
        if (!result.preload) throw Error('Mobile anchor preload unavailable');
        if (frameTree.frame.url !== 'about:blank' || !result.blank || !result.isolated || result.ui) throw Error('Mobile anchor isolation unavailable');
        if (this.stopped) return;
        if (!this.gitOriginContext) {
          const isolated = [...session[1].contexts.values()].filter(c => !c.auxData?.isDefault && c.auxData?.frameId === frameTree.frame.id && c.name === 'Electron Isolated Context');
          if (isolated.length !== 1) throw Error('Mobile anchor preload unavailable');
          const installed = await this.evaluate(`(${installMobileGitOriginRepair.toString()})(${JSON.stringify(this.config.anchor)},${JSON.stringify(this.config.instance)})`, false, isolated[0].id);
          if (!installed || this.stopped) throw Error('Mobile anchor isolation unavailable');
          this.gitOriginContext = isolated[0].id;
        }
        if (!session[1].contexts.has(this.gitOriginContext)) throw Error('Mobile anchor lost');
        this.anchorPrepared = true;
        this.stage = 'gateway';
        if (!this.gateway) await this.startGateway();
      } else if (!this.creationAttempted) {
        const source = [...this.sessions].find(([, s]) => s.main);
        if (!source) return;
        const context = [...source[1].contexts.values()].find(c => c.auxData?.isDefault && c.auxData.frameId === source[1].frame);
        if (!context) return;
        this.phase = 'waiting-for-host-startup'; this.stage = 'startup';
        const readiness = await this.command(source[0], 'Runtime.evaluate', {expression: `(${mobileStartupReadiness.toString()})(${JSON.stringify(this.config.anchor)})`, contextId: context.id, returnByValue: true});
        if (readiness.exceptionDetails || readiness.result?.value === 'failed') throw Error('Native anchor startup failed');
        if (readiness.result?.value !== 'ready') return;
        this.creationAttempted = true; this.phase = 'creating-anchor';
        const route = mobileAnchorRoute(this.config);
        this.stage = 'create';
        const creation = await this.command(source[0], 'Runtime.evaluate', {expression: `window.electronBridge.sendMessageFromView(${JSON.stringify({type: 'open-in-new-window', path: route})})`, awaitPromise: true});
        if (creation.exceptionDetails) throw Error('Native anchor creation failed');
      } else if (this.anchorSession || this.gateway) throw Error('Mobile anchor lost');
    } catch (error) {
      const message = String(error?.message ?? '');
      this.failure = /^(Mobile anchor (preload unavailable|isolation unavailable|navigation failed|lost|unavailable|failed)|Native anchor (creation|startup) failed|Ambiguous mobile anchor|CDP timeout: [A-Za-z.]+)$/.test(message) ? message : 'Anchor initialization failed';
      this.phase = 'unavailable'; await this.close();
    }
    finally { this.busy = false; }
  }
  async evaluate(expression, awaitPromise = false, contextId) {
    if (!this.anchorSession || !this.sessions.has(this.anchorSession)) throw Error('Mobile anchor unavailable');
    const result = await this.command(this.anchorSession, 'Runtime.evaluate', {expression, returnByValue: true, awaitPromise, ...contextId !== undefined ? {contextId} : {}});
    if (result.exceptionDetails) throw Error('Mobile anchor failed'); return result.result.value;
  }
  async startGateway() {
    const gatewayPath = fileURLToPath(new URL('./MobileGateway', import.meta.url));
    execFileSync('/usr/bin/codesign', ['--verify', '--strict', '-R=anchor apple generic and identifier "me.longbiaochen.codex-plus.mobile-gateway" and certificate leaf[subject.OU] = "HJG65XBC25"', gatewayPath], {stdio: 'pipe'});
    // Identify the adapter and verified gateway actually loaded by this runtime.
    this.version = 'sha256:' + createHash('sha256').update(await fs.readFile(new URL(import.meta.url))).update(await fs.readFile(gatewayPath)).digest('hex');
    this.gateway = spawn(gatewayPath, ['--bind', this.config.bind, '--port', String(this.config.port)], {stdio: ['pipe', 'pipe', 'pipe']});
    this.gateway.stderr.resume();
    this.gateway.once('exit', () => { if (!this.stopped) { this.phase = 'gateway-exited'; void this.close(); } });
    this.gateway.once('error', () => { this.phase = 'gateway-failed'; void this.close(); });
    const lines = readline.createInterface({input: this.gateway.stdout});
    lines.on('line', line => { void this.gatewayEvent(line).catch(() => { this.phase = 'connection-failed'; void this.close(); }); });
    this.phase = 'gateway-starting';
  }
  send(id, message) {
    if (this.stopped || !this.gateway?.stdin.writable) return;
    this.gateway.stdin.write(JSON.stringify({type: 'send', id, text: JSON.stringify(message)}) + '\n');
  }
  async gatewayEvent(line) {
    const event = JSON.parse(line);
    if (this.stopped) return;
    if (event.type === 'listening') {
      this.port = event.port; this.phase = 'listening';
      const client = {url: `wss://${this.config.bind}:${event.port}`, fingerprint: event.fingerprint, hostVersion: mobileHost.version, route: `/local/${this.config.threadId}`};
      const file = path.join(os.homedir(), 'Library/Caches/codex-plus/mobile/connection.json');
      await fs.mkdir(path.dirname(file), {recursive: true, mode: 0o700});
      await fs.writeFile(file + '.tmp', JSON.stringify(client), {mode: 0o600}); await fs.rename(file + '.tmp', file);
    } else if (event.type === 'connected') {
      // Exclusive anchor ownership, not a concurrency/resource quota.
      if (this.clients.size || !isTailIPv4(event.peer)) { this.drop(event.id); return; }
      const session = this.sessions.get(this.anchorSession);
      const context = [...session?.contexts.values() ?? []].find(c => c.auxData?.isDefault && c.auxData.frameId === session.frame);
      if (!context) { this.drop(event.id); return; }
      const client = {id: event.id, phase: 'authenticating', connection: randomUUID(), session: this.anchorSession, context: context.id, buffered: []}; this.clients.set(event.id, client);
      try {
        const {stdout} = await run('/usr/local/bin/tailscale', ['whois', '--json', event.peer]);
        const who = JSON.parse(stdout);
        if (who.Node?.StableID !== this.config.nodeId || String(who.UserProfile?.ID) !== String(this.config.userId)) { await this.release(event.id); return; }
        await this.activate(client);
      } catch { if (this.clients.get(event.id) === client) await this.release(event.id); }
    } else if (event.type === 'frame') {
      const client = this.clients.get(event.id);
      if (client?.phase !== 'active') { this.drop(event.id); return; }
      const value = JSON.parse(event.text);
      if (value.connection !== client.connection) return;
      if (value.kind === 'fatal') { await this.release(event.id); return; }
      if (value.kind === 'view-route') {
        if (typeof value.route !== 'string' || !/^(?:\/|\/(?:local|remote)\/[a-zA-Z0-9_-]+)$/.test(value.route)) { await this.release(event.id); return; }
        const threadId = value.route === '/' ? null : value.route.split('/')[2];
        if (client.threadId !== threadId) { client.threadId = threadId; this.claimRevision++; }
        return;
      }
      await this.evaluate(`(()=>{const e=globalThis.__codexPlusMobileEndpoint;if(e?.connection===${JSON.stringify(client.connection)})e.receive(${JSON.stringify(event.text)});})()`);
    } else if (event.type === 'closed') await this.release(event.id);
    else if (event.type === 'failed') throw Error('Mobile gateway failed');
    await this.publish();
  }
  anchorWork(operation) { const result = this.anchorQueue.catch(() => {}).then(operation); this.anchorQueue = result.catch(() => {}); return result; }
  current(client) { return !this.stopped && this.clients.get(client.id) === client && this.anchorSession === client.session && this.sessions.get(client.session)?.contexts.has(client.context); }
  async activate(client) {
    return this.anchorWork(async () => {
      if (!this.current(client)) return;
      await this.command(client.session, 'Runtime.addBinding', {name: binding});
      if (!this.current(client)) return;
      client.phase = 'binding';
      const connection = client.connection;
      const source = `globalThis.__codexPlusMobileEndpoint?.close();delete globalThis.__codexPlusMobileEndpoint;(${installMobileEndpoint.toString()})(${JSON.stringify({side: 'host', connection, anchor: this.config.anchor, instance: this.config.instance})},${encodeMobileValue.toString()},${decodeMobileValue.toString()});(${encodeMobileValue.toString()})((()=>{const b=window.electronBridge;return {version:b.getSentryInitOptions().appVersion,theme:b.getSystemThemeVariant(),sentry:b.getSentryInitOptions(),buildFlavor:b.getBuildFlavor(),userAgent:b.getDesktopUserAgent(),appSessionId:b.getAppSessionId(),sidebar:b.getInitialSidebarBootstrap()};})())`;
      const snapshot = await this.evaluate(source, true);
      if (!this.current(client)) return;
      client.threadId = this.config.threadId; client.phase = 'active'; this.claimRevision++; this.phase = 'connected';
      this.send(client.id, {kind: 'bootstrap', connection, hostVersion: mobileHost.version, snapshot});
      for (const value of client.buffered ?? []) this.send(client.id, value);
      client.buffered = [];
    });
  }
  ownsThread(threadId) { return !this.stopped && [...this.clients.values()].some(c => c.phase === 'active' && c.threadId === threadId); }
  async onBinding(message) {
    if (this.stopped || message.params.name !== binding || message.sessionId !== this.anchorSession) return;
    const session = this.sessions.get(message.sessionId), context = session?.contexts.get(message.params.executionContextId);
    if (!context?.auxData?.isDefault || context.auxData.frameId !== session.frame) return;
    const value = JSON.parse(message.params.payload);
    const client = [...this.clients.values()].find(c => c.connection === value.connection && ['binding', 'active'].includes(c.phase)); if (!client) return;
    if (value.kind === 'fatal') { await this.release(client.id); return; }
    if (client.phase === 'binding') { client.buffered.push(value); return; }
    this.send(client.id, value);
  }
  drop(id) { if (this.gateway?.stdin.writable) this.gateway.stdin.write(JSON.stringify({type: 'close', id}) + '\n'); }
  async release(id) {
    const client = this.clients.get(id); if (!client) return;
    this.clients.delete(id); this.claimRevision++; this.drop(id);
    await this.anchorWork(() => this.evaluate(`(()=>{const e=globalThis.__codexPlusMobileEndpoint;if(e?.connection===${JSON.stringify(client.connection)}){e.close();delete globalThis.__codexPlusMobileEndpoint;}})()`)).catch(() => {});
    if (!this.stopped) this.phase = 'listening';
  }
  contextLost(id, contextId) {
    if (id === this.anchorSession && (this.gateway || this.gitOriginContext) &&
        (contextId === undefined || contextId === this.gitOriginContext || this.sessions.get(id)?.contexts.get(contextId)?.auxData?.isDefault)) {
      this.phase = 'anchor-lost'; void this.close();
    }
  }
  async close() {
    if (this.stopped) return; this.stopped = true;
    try {
      for (const id of this.clients.keys()) await this.release(id);
      this.gateway?.stdin.end();
    } finally {
      if (this.gitOriginContext && this.sessions.get(this.anchorSession)?.contexts.has(this.gitOriginContext)) {
        await this.evaluate('globalThis.__codexPlusMobileGitOriginRepair?.close()', false, this.gitOriginContext).catch(() => {});
      }
      if (this.anchorTarget) await this.cdp.call('Target.closeTarget', {targetId: this.anchorTarget}).catch(() => {});
    }
  }
}
