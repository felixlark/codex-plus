#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { adaptSidebar, inspect, reviewedHostResource, sortProjectGroups, toolRoot, writeReport } from './inspect-sidebar-model.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(root, 'Tests/Fixtures/ProjectOrderElectron');
const { values } = parseArgs({ options: {
  mode: { type: 'string' }, scenario: { type: 'string', default: 'all' }, out: { type: 'string' },
  app: { type: 'string' }, 'enable-host-debugging': { type: 'boolean', default: false },
  'isolated-profile': { type: 'string' },
} });
if (!values.out || !['fixture', 'host'].includes(values.mode)) throw new Error('--out and --mode fixture|host are required');

// Probe deadlines bound a failed experiment; they are not product admission limits.
async function eventually(operation, label) {
  const deadline = Date.now() + 20000;
  let latest;
  while (Date.now() < deadline) {
    try { const result = await operation(); if (result) return result; } catch (error) { latest = error; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Probe deadline: ${label}${latest ? ` (${latest.message})` : ''}`);
}

class CDP {
  constructor(socket) {
    this.socket = socket;
    this.open = true;
    this.nextID = 0;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      } else for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
    });
    socket.addEventListener('close', () => {
      this.open = false;
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('CDP closed')); }
      this.pending.clear();
    });
  }
  static async connect(url) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) throw new Error('Non-loopback CDP endpoint');
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('CDP connection failed')), { once: true });
    });
    return new CDP(socket);
  }
  call(method, params = {}) {
    if (!this.open) return Promise.reject(new Error('CDP closed'));
    const id = ++this.nextID;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP deadline: ${method}`)); }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, callback) {
    const listeners = this.listeners.get(method) ?? new Set();
    listeners.add(callback);
    this.listeners.set(method, listeners);
    return () => listeners.delete(callback);
  }
  close() { this.open = false; this.socket.close(); }
  async evaluate(expression) {
    const response = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error('Renderer evaluation failed');
    return response.result.value;
  }
}

async function launch(executable, args, env = {}) {
  const ownedFixture = Boolean(env.CODEX_PLUS_FIXTURE_HOME);
  const child = spawn(executable, args, { env: { ...process.env, ...env }, stdio: ownedFixture ? ['ignore', 'ignore', 'pipe', 'ipc'] : ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  let endpoint;
  let failure;
  child.on('error', error => { failure = error; });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', text => {
    // Retain only the current line; application output is never copied to reports.
    stderr += text;
    for (const line of stderr.split('\n').slice(0, -1)) {
      const match = line.match(/^DevTools listening on (ws:\/\/\S+)/);
      if (match) endpoint = match[1];
    }
    stderr = stderr.slice(stderr.lastIndexOf('\n') + 1);
  });
  try {
    const url = await eventually(() => {
      if (failure) throw failure;
      if (child.exitCode !== null) throw new Error(`Host exited (${child.exitCode})`);
      return endpoint;
    }, 'debug listener');
    const port = new URL(url).port;
    const listeners = execFileSync('/usr/sbin/lsof', ['-nP', '-a', '-p', String(child.pid), '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8' });
    const ownedLoopback = listeners.split('\n').some(line => line.includes(`127.0.0.1:${port}`) || line.includes(`[::1]:${port}`));
    if (!ownedLoopback || listeners.split('\n').some(line => line.includes(`*:${port}`))) throw new Error('Debug listener is not owned loopback');
    return { child, pid: child.pid, port, ownedLoopback };
  } catch (error) {
    if (ownedFixture && child.exitCode === null) child.kill('SIGTERM');
    if (!ownedFixture) {
      error.hostPID = child.pid;
      error.hostExitCode = child.exitCode;
      child.stderr.destroy();
      child.unref();
    }
    throw error;
  }
}

async function targets(instance) {
  const response = await fetch(`http://127.0.0.1:${instance.port}/json/list`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Target discovery HTTP ${response.status}`);
  return (await response.json()).filter(target => target.type === 'page' && target.url === 'app://-/index.html');
}

async function page(instance, selectedTarget) {
  const target = selectedTarget ?? (await eventually(async () => { const list = await targets(instance); return list.length ? list : null; }, 'main frame'))[0];
  const cdp = await CDP.connect(target.webSocketDebuggerUrl);
  try {
    const frame = await cdp.call('Page.getFrameTree');
    if (frame.frameTree.frame.url !== 'app://-/index.html') {
      const actual = new URL(frame.frameTree.frame.url);
      throw new Error(`Untrusted main frame (${actual.protocol}//${actual.hostname}${actual.pathname})`);
    }
    const result = { cdp, target, frameID: frame.frameTree.frame.id, generation: 0, alive: true };
    cdp.socket.addEventListener('close', () => { result.alive = false; result.generation++; });
    cdp.on('Inspector.targetCrashed', () => { result.alive = false; result.generation++; });
    cdp.on('Page.frameNavigated', event => { if (!event.frame.parentId) result.generation++; });
    await cdp.call('Page.enable');
    return result;
  } catch (error) { cdp.close(); throw error; }
}

async function interceptor(page, transform, onPaused, urls = ['app://-/*']) {
  const active = new Set();
  const results = [];
  const errors = [];
  let draining = false;
  let disabled = false;
  let recovered = 0;
  let discarded = 0;
  const remove = page.cdp.on('Fetch.requestPaused', event => {
    const generation = page.generation;
    let body;
    let completed = false;
    const finishOriginal = async () => {
      if (completed || !page.cdp.open) return;
      if (body) await page.cdp.call('Fetch.fulfillRequest', {
        requestId: event.requestId, responseCode: event.responseStatusCode,
        responseHeaders: event.responseHeaders.filter(header => !['content-length', 'content-encoding'].includes(header.name.toLowerCase())),
        body: body.base64Encoded ? body.body : Buffer.from(body.body).toString('base64'),
      });
      else await page.cdp.call('Fetch.continueRequest', { requestId: event.requestId });
      completed = true;
    };
    const work = (async () => {
      if (onPaused) return onPaused(event);
      if (draining || event.frameId !== page.frameID || event.resourceType !== 'Script' || !event.responseStatusCode) {
        await finishOriginal(); return;
      }
      body = await page.cdp.call('Fetch.getResponseBody', { requestId: event.requestId });
      const source = body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body;
      const adapted = await transform(source);
      if (!page.alive || !page.cdp.open || generation !== page.generation) {
        discarded++;
        await finishOriginal();
        return;
      }
      results.push({ supported: adapted.supported, reason: adapted.reason });
      if (!adapted.supported || draining) await finishOriginal();
      else await page.cdp.call('Fetch.fulfillRequest', {
        requestId: event.requestId, responseCode: event.responseStatusCode,
        responseHeaders: event.responseHeaders.filter(header => !['content-length', 'content-encoding'].includes(header.name.toLowerCase())),
        body: Buffer.from(adapted.source).toString('base64'),
      });
      completed = true;
    })().catch(async error => {
      if (disabled || !page.alive) return;
      errors.push(error.message);
      try { await finishOriginal(); recovered++; }
      catch (recoveryError) {
        errors.push(`original-response-recovery: ${recoveryError.message}`);
        page.cdp.close();
      }
    }).finally(() => active.delete(work));
    active.add(work);
  });
  await page.cdp.call('Fetch.enable', { patterns: urls.map(urlPattern => ({ urlPattern, resourceType: 'Script', requestStage: 'Response' })) });
  return { results, errors, get recovered() { return recovered; }, get discarded() { return discarded; }, async stop() {
    draining = true;
    try {
      while (active.size) await Promise.all([...active]);
      if (page.cdp.open) await page.cdp.call('Fetch.disable');
      disabled = true;
      while (active.size) await Promise.all([...active]);
    } finally { remove(); }
  } };
}

async function snapshot(cdp) {
  return eventually(() => cdp.evaluate('globalThis.fixtureResult ?? null'), 'fixture model');
}

async function normalStop(instance) {
  if (instance.child.exitCode === null) {
    const exited = once(instance.child, 'exit');
    instance.child.kill('SIGTERM');
    await exited;
  }
  const remaining = spawnSync('/usr/sbin/lsof', ['-nP', '-a', '-p', String(instance.child.pid), '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8' });
  if (remaining.error) throw remaining.error;
  if (remaining.status === 0 && remaining.stdout.includes(`:${instance.port}`)) throw new Error('Fixture debug listener remained after exit');
}

async function fixture(scenario) {
  const run = await fs.mkdtemp(path.join(toolRoot, 'fixture-'));
  const home = path.join(run, 'user-data');
  await fs.mkdir(home);
  const electron = path.join(toolRoot, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  let instance;
  let current;
  let step = 'initial-model';
  try {
    instance = await launch(electron, [path.join(fixturePath, 'main.cjs')], {
      CODEX_PLUS_FIXTURE_STATE: path.join(run, 'state.json'), CODEX_PLUS_FIXTURE_HOME: home,
    });
    current = await page(instance);
    const initial = await snapshot(current.cdp);
    assert.deepEqual(initial.order, ['A', 'B', 'C']);
    if (scenario === 'late-attach') {
      const hook = await interceptor(current, adaptSidebar);
      await current.cdp.call('Page.reload', { ignoreCache: true });
      const result = await eventually(async () => { const result = await snapshot(current.cdp); return result.adapted ? result : null; }, 'adapted model');
      assert.deepEqual(result.order, ['B', 'C', 'A']);
      assert.deepEqual(result.navigation, ['remote:B', 'chatgpt:C', 'local:A']);
      assert.deepEqual(result.pinned, ['pinned-project']);
      assert.deepEqual(result.custom, ['custom-project']);
      await current.cdp.evaluate("globalThis.fixtureUpdate('updated')");
      assert.deepEqual((await snapshot(current.cdp)).order, ['C', 'B', 'A']);
      assert.equal(hook.errors.length, 0);
      await hook.stop();
      current.cdp.close();
      current = await page(instance);
      await current.cdp.call('Page.reload', { ignoreCache: true });
      assert.deepEqual((await eventually(async () => { const s = await snapshot(current.cdp); return !s.adapted ? s : null; }, 'original model')).order, ['A', 'B', 'C']);
      return { scenario, passed: true, nativeOrderRestored: true, navigationConsistent: true };
    }
    if (scenario === 'response-disconnect') {
      let paused = false;
      await interceptor(current, adaptSidebar, () => { paused = true; current.cdp.close(); });
      await current.cdp.call('Page.reload', { ignoreCache: true }).catch(() => {});
      await eventually(() => paused, 'paused response');
      current = await page(instance);
      const result = await snapshot(current.cdp);
      assert.deepEqual(result.order, ['A', 'B', 'C']);
      const hook = await interceptor(current, async () => ({ supported: false, reason: 'pass-through' }));
      await current.cdp.call('Page.reload', { ignoreCache: true });
      await eventually(() => hook.results.length > 0, 'pass-through response');
      await hook.stop();
      assert.equal(hook.errors.length, 0);
      const failure = await interceptor(current, async () => { throw new Error('fixture-transform-failure'); });
      await current.cdp.call('Page.reload', { ignoreCache: true });
      await eventually(() => failure.recovered === 1, 'transform failure original-response recovery');
      assert.deepEqual((await snapshot(current.cdp)).order, ['A', 'B', 'C']);
      await failure.stop();
      return { scenario, passed: true, disconnectResumedOriginal: true, cleanDisable: true, transformFailureRecovered: true };
    }
    if (scenario === 'source-mismatch') {
      const source = await fs.readFile(path.join(fixturePath, 'sidebar-model.mjs'), 'utf8');
      assert.equal((await adaptSidebar(source.replaceAll('model', 'renamedModel').replaceAll('input', 'renamedInput'))).supported, true);
      assert.equal((await adaptSidebar(source.replaceAll('getRecencyAt', 'changedClock'))).supported, false);
      assert.equal((await adaptSidebar(source.replaceAll('getCollapsedAttention', 'changedAttention'))).supported, false);
      assert.equal((await adaptSidebar(source.replace('result.projectGroups.map', 'input.groups.map'))).reason, 'model-layout-data-chain');
      assert.equal((await adaptSidebar(source.replace('projectGroups: groups,', 'projectGroups: input.groups,'))).reason, 'model-layout-data-chain');
      assert.equal((await adaptSidebar(source.replace('const result = model(input);', 'const result = {projectGroups: input.groups}; function unused() { const result = model(input); }'))).reason, 'model-layout-data-chain');
      assert.equal((await adaptSidebar(source.replace('const layoutInput =', 'let layoutInput =').replace('const otherEntries =', 'layoutInput = {projectEntries: input.groups, options: {projectOrder: input.order}}; const otherEntries ='))).reason, 'model-layout-data-chain');
      const adapted = await adaptSidebar(source);
      assert.equal((await adaptSidebar(adapted.source)).reason, 'already-adapted');
      const otherLayout = source.slice(source.indexOf('function sidebar('), source.indexOf('\nfunction render(')).replace('function sidebar(', 'function otherSidebar(');
      assert.equal((await adaptSidebar(source + '\n' + otherLayout)).reason, 'layout-match-count');
      const otherModel = source.slice(source.indexOf('function model('), source.indexOf('\nfunction nativeLayout(')).replace('function model(', 'function otherModel(');
      assert.equal((await adaptSidebar(source + '\n' + otherModel)).supported, false);
      const hook = await interceptor(current, async () => ({ supported: false, reason: 'model-match-count' }));
      await current.cdp.call('Page.reload', { ignoreCache: true });
      await eventually(() => hook.results.length > 0, 'mismatch passthrough');
      assert.deepEqual((await snapshot(current.cdp)).order, ['A', 'B', 'C']);
      await hook.stop();
      return { scenario, passed: true, mismatchPreservedOriginal: true };
    }
    if (scenario === 'window-recreate') {
      step = 'second-window';
      const first = current.target.id;
      instance.child.send('new-window');
      await eventually(async () => (await targets(instance)).length === 2, 'second window');
      const secondTarget = (await targets(instance)).find(target => target.id !== first);
      const secondCDP = await CDP.connect(secondTarget.webSocketDebuggerUrl);
      const secondFrame = await secondCDP.call('Page.getFrameTree');
      const second = { cdp: secondCDP, frameID: secondFrame.frameTree.frame.id, generation: 0, alive: true };
      secondCDP.socket.addEventListener('close', () => { second.alive = false; second.generation++; });
      const secondHook = await interceptor(second, adaptSidebar);
      await secondCDP.call('Page.reload', { ignoreCache: true });
      const secondResult = await eventually(async () => { const s = await snapshot(secondCDP); return s.adapted ? s : null; }, 'second window adaptation');
      assert.deepEqual(secondResult.order, ['B', 'C', 'A']);
      assert.deepEqual(secondResult.navigation, ['remote:B', 'chatgpt:C', 'local:A']);
      await secondHook.stop();
      secondCDP.close();
      let entered = false;
      step = 'old-generation';
      let release;
      const barrier = new Promise(resolve => { release = resolve; });
      const delayed = await interceptor(current, async source => { entered = true; await barrier; return adaptSidebar(source); });
      await current.cdp.call('Page.reload', { ignoreCache: true });
      await eventually(() => entered, 'old generation delayed response');
      current.cdp.close();
      instance.child.send('recreate');
      await eventually(async () => { const list = await targets(instance); return list.length === 1 && list[0].id !== first; }, 'recreated window');
      release();
      await delayed.stop();
      assert.equal(delayed.discarded, 1);
      step = 'recreated-window';
      current = await page(instance);
      const hook = await interceptor(current, adaptSidebar);
      await current.cdp.call('Page.reload', { ignoreCache: true });
      await eventually(async () => (await snapshot(current.cdp)).adapted, 'recreated adapted model');
      step = 'renderer-crash';
      instance.child.send('crash');
      await eventually(async () => JSON.parse(await fs.readFile(path.join(run, 'state.json'), 'utf8')).generation === 1, 'renderer crash');
      current.cdp.close();
      await hook.stop();
      instance.child.send('recover');
      current = await page(instance);
      step = 'renderer-recovery';
      await snapshot(current.cdp);
      const restoredHook = await interceptor(current, adaptSidebar);
      await current.cdp.call('Page.reload', { ignoreCache: true });
      const restored = await eventually(async () => { const s = await snapshot(current.cdp); return s.adapted ? s : null; }, 'recovered renderer adaptation');
      assert.deepEqual(restored.order, ['B', 'C', 'A']);
      assert.deepEqual(restored.navigation, ['remote:B', 'chatgpt:C', 'local:A']);
      await restoredHook.stop();
      return { scenario, passed: true, secondWindowAdapted: true, recreatedWindow: true, staleResultDiscarded: true, recoveredRendererAdapted: true };
    }
    throw new Error(`Unknown fixture scenario: ${scenario}`);
  } catch (error) {
    error.message = `${scenario}/${step}: ${error.message}`;
    throw error;
  } finally {
    current?.cdp.close();
    if (instance) await normalStop(instance);
    await fs.rm(run, { recursive: true, force: true });
  }
}

async function host() {
  if (!values.app || !values['enable-host-debugging']) throw new Error('Host requires --app and --enable-host-debugging');
  const executable = path.join(values.app, 'Contents/MacOS/ChatGPT');
  const profile = values['isolated-profile'];
  const expectedProfile = path.join(os.homedir(), 'Library/Application Support/codex-plus/acceptance-20261110');
  if (profile && path.resolve(profile) !== expectedProfile) throw new Error('Use the task-owned acceptance profile');
  const processes = execFileSync('/bin/ps', ['-ax', '-o', 'comm='], { encoding: 'utf8' }).split('\n');
  if (!profile && processes.some(command => command.trim() === executable)) return { mode: 'host', status: 'waiting-for-normal-exit' };
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict',
    '-R=anchor apple generic and identifier "com.openai.codex" and certificate leaf[subject.OU] = "2DC432GLL2"', values.app], { stdio: 'pipe' });
  const metadata = await inspect(values.app);
  if (metadata.bundleID !== 'com.openai.codex') throw new Error('Unexpected host bundle');
  if (!metadata.resources.some(resource => resource.supported)) throw new Error('Unsupported sidebar model');
  const report = { mode: 'host', status: 'failed', version: metadata.version,
    recovery: 'Normally quit and launch the unmodified installed host to restore its original renderer and close CDP.' };
  let instance;
  const pages = [];
  const hooks = [];
  try {
    const markerPath = profile && path.join(profile, 'acceptance-owner.json');
    let marker;
    if (profile) {
      await fs.mkdir(path.dirname(profile), { recursive: true });
      try {
        await fs.mkdir(profile);
        marker = { owner: 'codex-plus-project-order-20261110' };
        await writeReport(markerPath, marker);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
        if (marker.owner !== 'codex-plus-project-order-20261110') throw new Error('Acceptance profile ownership mismatch');
      }
      if (marker.pid && marker.port) {
        const command = spawnSync('/bin/ps', ['-p', String(marker.pid), '-o', 'args='], { encoding: 'utf8' });
        if (command.status === 0 && command.stdout.includes(executable) && command.stdout.includes(`--user-data-dir=${path.join(profile, 'user-data')}`)) {
          const listener = spawnSync('/usr/sbin/lsof', ['-nP', '-a', '-p', String(marker.pid), '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8' });
          const ownedLoopback = listener.stdout.includes(`127.0.0.1:${marker.port}`) && !listener.stdout.includes(`*:${marker.port}`);
          if (!ownedLoopback) throw new Error('Existing acceptance listener ownership mismatch');
          instance = { pid: marker.pid, port: marker.port, ownedLoopback };
        }
      }
    }
    if (!instance) {
      const args = ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'];
      const childEnvironment = {};
      if (profile) {
        args.push(`--user-data-dir=${path.join(profile, 'user-data')}`);
        childEnvironment.CODEX_ELECTRON_USER_DATA_PATH = path.join(profile, 'user-data');
        // This is the launched Codex instance's supported home configuration.
        childEnvironment.CODEX_HOME = path.join(profile, 'codex-home');
      }
      if (profile) {
        const endpointFile = path.join(profile, 'user-data/DevToolsActivePort');
        await fs.rm(endpointFile, { force: true });
        execFileSync('/usr/bin/open', ['-n', ...Object.entries(childEnvironment).flatMap(([key, value]) => ['--env', `${key}=${value}`]), values.app, '--args', ...args], { stdio: 'pipe' });
        instance = await eventually(async () => {
          const port = (await fs.readFile(endpointFile, 'utf8')).split('\n')[0];
          if (!/^\d+$/.test(port)) return null;
          const output = execFileSync('/usr/sbin/lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
          const pids = [...new Set(output.trim().split(/\s+/))];
          if (pids.length !== 1) throw new Error('Ambiguous acceptance listener');
          const pid = Number(pids[0]);
          const command = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'args='], { encoding: 'utf8' });
          if (!command.includes(executable) || !command.includes(`--user-data-dir=${path.join(profile, 'user-data')}`)) throw new Error('Acceptance process identity mismatch');
          const listener = execFileSync('/usr/sbin/lsof', ['-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8' });
          if (!listener.includes(`127.0.0.1:${port}`) || listener.includes(`*:${port}`)) throw new Error('Acceptance listener is not loopback');
          return { pid, port, ownedLoopback: true };
        }, 'isolated signed host listener');
      } else instance = await launch(executable, args, childEnvironment);
      if (profile) await writeReport(markerPath, { ...marker, pid: instance.pid, port: instance.port });
    }
    report.hostPID = instance.pid;
    report.isolatedProfile = profile ?? null;
    report.ownedLoopback = instance.ownedLoopback;
    const hostTargets = await eventually(async () => { const list = await targets(instance); return list.length ? list : null; }, 'host main frames');
    report.windows = [];
    for (const target of hostTargets) {
      const result = { index: report.windows.length, status: 'failed' };
      report.windows.push(result);
      const current = await page(instance, target);
      pages.push(current);
      if (values.scenario === 'connect') result.status = 'connected-awaiting-setup';
      else if (values.scenario === 'inspect') {
        result.renderer = await current.cdp.evaluate('({protocol:globalThis.__codexPlusProjectOrder?.protocol??null,readyState:document.readyState,sort:globalThis.__codexPlusProjectOrder?.stats??null})');
        result.status = 'inspected';
      } else {
        const urls = metadata.resources.filter(resource => resource.supported).map(resource => `app://-/${resource.path.replace(/^webview\//, '')}`);
        const hook = await interceptor(current, source => adaptSidebar(source, { host: true, resourcePath: reviewedHostResource.path }), undefined, urls);
        hooks.push(hook);
        await current.cdp.call('Network.enable');
        await current.cdp.call('Network.setCacheDisabled', { cacheDisabled: true });
        const beforeReload = current.generation;
        await current.cdp.call('Page.reload', { ignoreCache: true });
        await eventually(() => current.generation > beforeReload, 'host frame navigation');
        await eventually(() => current.cdp.evaluate('globalThis.__codexPlusProjectOrder?.protocol === 6'), 'host adapted script execution');
        result.status = 'adapted-awaiting-visible-acceptance';
      }
    }
    report.status = report.windows[0].status;
  } catch (error) {
    report.error = error.message;
    report.hostPID ??= error.hostPID;
    report.hostExitCode = error.hostExitCode;
  } finally {
    for (const hook of hooks) {
      try { await hook.stop(); }
      catch (error) { report.status = 'failed'; (report.cleanupErrors ??= []).push(error.message); }
    }
    report.scenarios = hooks.flatMap(hook => hook.results);
    report.interceptionErrors = hooks.flatMap(hook => hook.errors);
    report.discarded = hooks.reduce((total, hook) => total + hook.discarded, 0);
    for (const current of pages) current.cdp.close();
    if (instance?.child) { instance.child.stderr.destroy(); instance.child.unref(); }
  }
  return report;
}

const report = { mode: values.mode, scenarios: [] };
try {
  if (values.mode === 'host') {
    Object.assign(report, await host());
    if (['failed', 'candidate-failed'].includes(report.status)) process.exitCode = 1;
  }
  else {
    const scenarios = values.scenario === 'all' ? ['late-attach', 'response-disconnect', 'source-mismatch', 'window-recreate'] : [values.scenario];
    const groups = [{ threadKeys: ['A'] }, { threadKeys: ['B'] }, { threadKeys: ['C'] }];
    assert.deepEqual(sortProjectGroups(groups, key => ({ A: 1, C: 3 })[key]), [groups[2], groups[1], groups[0]]);
    assert.strictEqual(sortProjectGroups(groups, () => 1), groups);
    for (const scenario of scenarios) { const result = await fixture(scenario); report.scenarios.push(result); console.log(JSON.stringify(result)); }
    report.status = 'passed';
  }
} catch (error) {
  report.status = 'failed';
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await writeReport(values.out, report);
  console.log(JSON.stringify({ status: report.status, out: values.out }));
}
