import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {isTailIPv4, isAnchorURL, MobileAccess, prepareMobileAnchor, probeUnclaimedMobileThread, mobileStartupReadiness, mobileAnchorRoute, mobileDocumentURL, mobileDocumentHTML} from '../Sources/CodexPlus/Resources/mobile-access.mjs';
import {isHumanWindowURL} from '../Sources/CodexPlus/Resources/human-window.mjs';
import {installMobileEndpoint} from '../Sources/CodexPlus/Resources/mobile-endpoint.mjs';
import {encodeMobileValue, decodeMobileValue} from '../Sources/CodexPlus/Resources/mobile-codec.mjs';

test('mobile binding is an exact private IPv4 and original anchor URL', () => {
  for (const value of ['100.64.0.1', '100.127.255.254']) assert.ok(isTailIPv4(value));
  for (const value of ['100.63.255.255', '100.128.0.0', '100.64.1.1.example.com', '100.064.1.1', '::1', '127.0.0.1']) assert.equal(isTailIPv4(value), false);
  const config = {threadId: 'thread', anchor: 'anchor'}, url = new URL('app://-/index.html');
  url.searchParams.set('initialRoute', '/local/thread?codexPlusMobileAnchor=anchor');
  assert.ok(isAnchorURL(url.href, config));
  assert.equal(isAnchorURL(url.href.replace('app://-', 'https://attacker.example'), config), false);
  assert.equal(isAnchorURL(url.href, {...config, anchor: 'another'}), false);
});

test('cold startup waits for original readiness and issues the native window request only once', async () => {
  let release, waits = 0, creates = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const load = async () => ({__webpack_require__: () => ({appServices: {startup: {whenReady() { waits++; return gate; }}}})});
  const sessions = new Map([['human', {main: true, frame: 'root', contexts: new Map([[7, {id: 7, auxData: {isDefault: true, frameId: 'root'}}]])}]]);
  const manager = new MobileAccess({threadId: 'thread', anchor: 'cold-test'}, {
    cdp: {call: async () => ({targetInfos: []})}, sessions, stateFile: '/unused', publish: async () => {},
    command: async (_, method, params) => {
      if (params.expression.includes('mobileStartupReadiness')) {
        assert.equal(params.contextId, 7);
        return {result: {value: mobileStartupReadiness('cold-test', load)}};
      }
      creates++; return {};
    },
  });
  try {
    await manager.tick(); await manager.tick(); await manager.tick();
    assert.equal(waits, 1); assert.equal(creates, 0); assert.equal(manager.creationAttempted, false);
    release(); await new Promise(resolve => setImmediate(resolve));
    await manager.tick(); await manager.tick();
    assert.equal(creates, 1); assert.equal(manager.creationAttempted, true);
  } finally { delete globalThis.__codexPlusMobileStartup; }
});

test('a duplicate app-host handshake closes instead of replacing the native view', async () => {
  const sent = [], native = [], ports = [], origins = [];
  class EventMessage extends Event { constructor(type, fields) { super(type); Object.assign(this, fields); } }
  const window = new EventTarget();
  window.electronBridge = {subscribeToSystemThemeVariant: () => () => {}};
  window.postMessage = (data, origin) => { native.push(data.type); ports.push(data.port); origins.push(origin); };
  const context = vm.createContext({window, location: {origin: 'app://-', href: 'app://-/index.html'}, MessageChannel, MessageEvent: EventMessage, CustomEvent, MessagePort,
    __codexPlusMobileOutbound: text => sent.push(JSON.parse(text))});
  vm.runInContext(`(${installMobileEndpoint.toString()})({side:'host',connection:'test'},${encodeMobileValue.toString()},${decodeMobileValue.toString()})`, context);
  const endpoint = context.__codexPlusMobileEndpoint;
  endpoint.receive(JSON.stringify({connection: 'test', kind: 'port-open', id: 'one'}));
  await new Promise(resolve => setTimeout(resolve, 10));
  endpoint.receive(JSON.stringify({connection: 'test', kind: 'port-open', id: 'two'}));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(native, ['connect-app-host']);
  assert.deepEqual(origins, ['app://-']);
  assert.ok(endpoint.inspect().closed);
  assert.ok(sent.some(event => event.kind === 'fatal'));
  for (const port of ports) port.close();
});

test('revoked asynchronous encoding cannot emit into the next connection', async () => {
  const sent = []; let callback, release, started;
  const encoded = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const window = new EventTarget();
  window.electronBridge = {subscribeToSystemThemeVariant: () => () => {}, subscribeToWorkerMessages: (_, fn) => { callback = fn; return () => {}; }};
  const context = vm.createContext({window, location: {origin: 'app://-'}, CustomEvent,
    __codexPlusMobileOutbound: text => sent.push(JSON.parse(text)),
    encode: async value => { started(); await gate; return JSON.stringify(value); }, decode: JSON.parse});
  const install = id => vm.runInContext(`(${installMobileEndpoint.toString()})({side:'host',connection:${JSON.stringify(id)}},encode,decode)`, context);
  install('A');
  context.__codexPlusMobileEndpoint.receive(JSON.stringify({connection: 'A', kind: 'worker-subscribe', worker: 'git'}));
  await new Promise(resolve => setTimeout(resolve, 5));
  callback({reply: 'old'}); await encoded;
  // Match the real controller: revoke and delete inside the renderer context.
  // Node 24 can retain a contextified global after host-side property deletion.
  vm.runInContext('globalThis.__codexPlusMobileEndpoint.close(); delete globalThis.__codexPlusMobileEndpoint', context);
  install('B'); release();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(sent, []);
  assert.equal(context.__codexPlusMobileEndpoint.inspect().connection, 'B');
  assert.equal(context.__codexPlusMobileEndpoint.inspect().closed, false);
  context.__codexPlusMobileEndpoint.close();
});

test('revoked binding installation and old fatal cannot replace or release its successor', async () => {
  let release, called;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { called = resolve; });
  let bindings = 0; const evaluated = [], sent = [];
  const sessions = new Map([['anchor', {frame: 'frame', contexts: new Map([[1, {id: 1, auxData: {isDefault: true, frameId: 'frame'}}]])}]]);
  const manager = new MobileAccess({}, {cdp: {}, sessions, stateFile: '/unused', publish: async () => {}, command: async () => { if (++bindings === 1) { called(); await gate; } }});
  manager.anchorSession = 'anchor';
  manager.evaluate = async source => { evaluated.push(source); return 'snapshot'; };
  manager.send = (id, value) => sent.push({id, ...value}); manager.drop = () => {};
  const a = {id: 'A', connection: 'A-connection', session: 'anchor', context: 1}; manager.clients.set(a.id, a);
  const first = manager.activate(a); await started;
  const revoked = manager.release(a.id);
  const b = {id: 'B', connection: 'B-connection', session: 'anchor', context: 1}; manager.clients.set(b.id, b);
  const successor = manager.activate(b); release();
  await Promise.all([first, revoked, successor]);
  const installs = evaluated.filter(value => value.includes('installMobileEndpoint'));
  assert.equal(installs.length, 1); assert.ok(installs[0].includes('B-connection'));
  assert.deepEqual(sent.map(value => value.id), ['B']);
  await manager.onBinding({sessionId: 'anchor', params: {name: '__codexPlusMobileOutbound', executionContextId: 1, payload: JSON.stringify({kind: 'fatal', connection: 'A-connection'})}});
  assert.equal(manager.clients.get('B'), b);
});

function anchorHarness({fulfillError = false} = {}) {
  const commands = [], contexts = new Map([[1, {id: 1, auxData: {isDefault: true, frameId: 'root'}}]]);
  const state = {loader: 'old', target: 'owned', starts: 0, probes: [], ready: false};
  const manager = new MobileAccess({threadId: 'thread', anchor: 'anchor'}, {
    instance: 'fixture', scriptPatterns: [{urlPattern: 'app://-/assets/original.js', resourceType: 'Script', requestStage: 'Response'}],
    cdp: {call: async (method, args) => {
      commands.push({method, params: args});
      return method === 'Target.getTargets' ? {targetInfos: [{type: 'page', targetId: state.target, url: state.url}]} : {};
    }},
    command: async (session, method, params) => {
      commands.push({session, method, params});
      if (method === 'Fetch.enable') await state.fetchGate;
      if (method === 'Fetch.fulfillRequest' && fulfillError) throw Error('Controlled document failure');
      if (method === 'Page.getFrameTree') {
        state.onFrameTree?.();
        return {frameTree: {frame: {id: 'root', loaderId: state.loader, url: state.frameURL}}};
      }
      return {};
    },
    sessions: new Map([['anchor', {target: 'owned', frame: 'root', contexts}]]), stateFile: '/unused', publish: async () => {},
  });
  const initial = new URL('app://-/index.html'); initial.searchParams.set('initialRoute', mobileAnchorRoute(manager.config));
  state.url = state.frameURL = initial.href;
  manager.evaluate = async (_, __, context) => {
    state.probes.push(context);
    return state.probe ?? {url: true, origin: true, blank: true, complete: state.ready, preload: true, isolated: true, ui: false};
  };
  manager.startGateway = async () => { state.starts++; manager.gateway = {stdin: {end() { state.gatewayClosed = true; }}}; };
  const commit = () => {
    state.loader = 'new'; state.url = state.frameURL = manager.documentURL;
    contexts.clear(); contexts.set(2, {id: 2, auxData: {isDefault: true, frameId: 'root'}});
  };
  const document = extra => ({resourceType: 'Document', frameId: 'root', requestId: 'document-1', request: {url: manager.documentURL}, ...extra});
  return {manager, state, commands, contexts, commit, document};
}

test('the owned document waits for Fetch acknowledgement, fulfillment and a new original app-origin loader', async () => {
  const h = anchorHarness(); let release;
  h.state.fetchGate = new Promise(resolve => { release = resolve; });
  const preparing = h.manager.tick();
  while (!h.commands.some(c => c.method === 'Fetch.enable')) await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.commands.filter(c => c.method === 'Page.navigate').length, 0);
  release(); await preparing;
  const patterns = h.commands.find(c => c.method === 'Fetch.enable').params.patterns;
  assert.equal(patterns[0].resourceType, 'Script'); assert.equal(patterns[1].resourceType, 'Document');
  assert.deepEqual(h.commands.filter(c => c.method === 'Page.navigate').map(c => c.params.url), [h.manager.documentURL]);
  await h.manager.tick(); assert.equal(h.state.probes.length, 0);
  h.commit(); await h.manager.tick(); assert.equal(h.state.starts, 0); assert.equal(h.state.probes.length, 0);
  assert.equal(await h.manager.handleDocument('anchor', h.document()), true);
  const fulfilled = h.commands.find(c => c.method === 'Fetch.fulfillRequest').params;
  assert.equal(fulfilled.responseCode, 200); assert.ok(Buffer.from(fulfilled.body, 'base64').toString().includes('codex-plus-mobile-instance'));
  await h.manager.handleDocument('anchor', h.document());
  assert.equal(h.commands.filter(c => c.method === 'Fetch.fulfillRequest').length, 1);
  await h.manager.tick(); assert.equal(h.state.starts, 0);
  h.state.ready = true; await h.manager.tick(); await h.manager.tick();
  assert.equal(h.state.starts, 1); assert.equal(h.manager.status().anchorReady, true);
  assert.deepEqual(h.state.probes, [2, 2, 2]);
});

test('unexpected Documents and failed fulfillment never resume the original UI', async () => {
  for (const variant of ['url', 'frame', 'response-stage', 'fulfill']) {
    const h = anchorHarness({fulfillError: variant === 'fulfill'}); await h.manager.tick();
    const event = h.document(variant === 'url' ? {request: {url: 'app://-/index.html'}} : variant === 'frame' ? {frameId: 'other'} : variant === 'response-stage' ? {responseStatusCode: 200} : {});
    assert.equal(await h.manager.handleDocument('anchor', event), true);
    await h.manager.tick();
    assert.equal(h.manager.stopped, true); assert.equal(h.state.starts, 0);
    assert.equal(h.commands.filter(c => c.method === 'Fetch.failRequest').length, 1);
    assert.equal(h.commands.filter(c => c.method === 'Target.closeTarget').length, 1);
    assert.equal(h.commands.filter(c => c.method === 'Fetch.continueRequest').length, 0);
  }
});

test('a fulfilled owned page cannot reload the vendor Document while a phone is connected', async () => {
  const h = anchorHarness(); await h.manager.tick(); await h.manager.handleDocument('anchor', h.document());
  h.commit(); h.state.ready = true; await h.manager.tick();
  assert.equal(await h.manager.handleDocument('anchor', h.document({requestId: 'reload'})), true);
  assert.equal(h.manager.stopped, true); assert.equal(h.commands.filter(c => c.method === 'Target.closeTarget').length, 1);
  assert.equal(h.commands.filter(c => c.method === 'Fetch.fulfillRequest').length, 1);
});

test('foreign sessions remain untouched and a replaced sticky target is never adopted', async () => {
  const h = anchorHarness(); await h.manager.tick();
  const before = h.commands.length;
  assert.equal(await h.manager.handleDocument('human', h.document()), false); assert.equal(h.commands.length, before);
  h.state.target = 'replacement'; await h.manager.tick();
  assert.equal(h.manager.anchorTarget, 'owned'); assert.equal(h.manager.stopped, true);
  assert.deepEqual(h.commands.filter(c => c.method === 'Target.closeTarget').map(c => c.params.targetId), ['owned']);
});

test('per-controller document identities exclude orphan anchors and all human enhancement entry points', async () => {
  const h = anchorHarness(), old = {...h.manager.config, instance: 'previous'};
  assert.ok(isAnchorURL(h.manager.documentURL, h.manager.config));
  assert.equal(isAnchorURL(mobileDocumentURL(old), h.manager.config), false);
  assert.equal(isHumanWindowURL(h.manager.documentURL), false); assert.equal(isHumanWindowURL(h.state.url), false);
  h.state.url = h.state.frameURL = mobileDocumentURL(old); await h.manager.tick();
  assert.equal(h.manager.anchorTarget, undefined); assert.equal(h.commands.some(c => c.method === 'Page.navigate'), false);
});

test('an unisolated new document closes even after the expected response was fulfilled', async () => {
  const h = anchorHarness(); await h.manager.tick(); await h.manager.handleDocument('anchor', h.document());
  h.commit(); h.state.probe = {url: true, origin: false, blank: true, complete: true, preload: true, isolated: true, ui: false};
  await h.manager.tick(); assert.equal(h.manager.stopped, true); assert.equal(h.state.starts, 0);
});

test('the new context wins when navigation commits during frame-tree lookup', async () => {
  const h = anchorHarness(); await h.manager.tick(); await h.manager.handleDocument('anchor', h.document());
  h.state.onFrameTree = h.commit; h.state.ready = true;
  await h.manager.tick(); assert.deepEqual(h.state.probes, [2]); assert.equal(h.state.starts, 1);
});

test('the app-origin probe requires the already fulfilled marker, CSP, preload and script-free body', () => {
  const config = {threadId: 'thread', anchor: 'anchor', instance: 'fixture'}, url = mobileDocumentURL(config);
  const html = mobileDocumentHTML(config); assert.equal(/<script/i.test(html), false);
  assert.throws(() => mobileDocumentHTML({...config, anchor: '<script>'}));
  for (const change of [{}, {origin: 'null'}, {url: 'about:blank'}, {script: true}, {preload: false}, {marker: 'other'}, {policy: 'default-src *'}]) {
    const document = {readyState: 'complete', body: {textContent: 'Codex Plus 移动接入专用窗口'},
      querySelector: selector => selector === 'script' ? (change.script ? {} : null) :
        {content: selector.includes('http-equiv') ? change.policy ?? "default-src 'none'; base-uri 'none'" : selector.includes('instance') ? 'fixture' : change.marker ?? 'anchor'},
    };
    const context = vm.createContext({document, window: {electronBridge: change.preload === false ? undefined : {}}, location: {href: change.url ?? url, origin: change.origin ?? 'app://-'}});
    const probe = vm.runInContext(`(${prepareMobileAnchor.toString()})('anchor','fixture',${JSON.stringify(url)})`, context);
    const accepted = probe.url && probe.origin && probe.blank && probe.complete && probe.preload && probe.isolated && !probe.ui;
    assert.equal(accepted, Object.keys(change).length === 0);
  }
});


test('mobile route claims migrate only on the authenticated current connection and revoke awaited guards', async () => {
  const manager = new MobileAccess({threadId: 'A'}, {cdp: {}, sessions: new Map(), stateFile: '/unused', publish: async () => {}});
  const client = {id: 'phone', connection: 'current', phase: 'active', threadId: 'A'};
  manager.clients.set('phone', client); manager.evaluate = async () => {}; manager.drop = () => {};
  const route = (connection, value) => manager.gatewayEvent(JSON.stringify({type: 'frame', id: 'phone', text: JSON.stringify({kind: 'view-route', connection, route: value})}));
  assert.ok(manager.ownsThread('A'));
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  const guard = probeUnclaimedMobileThread(manager, 'B', async () => { started(); await gate; return true; });
  await entered; await route('current', '/local/B'); release();
  assert.equal(await guard, false);
  assert.equal(manager.ownsThread('A'), false); assert.ok(manager.ownsThread('B'));
  await route('old', '/local/A'); assert.ok(manager.ownsThread('B'));
  await route('current', '/'); assert.equal(manager.ownsThread('B'), false);
  await route('current', '/remote/C'); assert.ok(manager.ownsThread('C'));
  await manager.release('phone'); assert.equal(manager.ownsThread('C'), false);
});
