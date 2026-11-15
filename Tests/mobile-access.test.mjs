import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {isTailIPv4, isAnchorURL, MobileAccess, prepareMobileAnchor, probeUnclaimedMobileThread, mobileStartupReadiness} from '../Sources/CodexPlus/Resources/mobile-access.mjs';
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
  const context = vm.createContext({window, location: {origin: 'null', href: 'about:blank'}, MessageChannel, MessageEvent: EventMessage, CustomEvent, MessagePort,
    __codexPlusMobileOutbound: text => sent.push(JSON.parse(text))});
  vm.runInContext(`(${installMobileEndpoint.toString()})({side:'host',connection:'test'},${encodeMobileValue.toString()},${decodeMobileValue.toString()})`, context);
  const endpoint = context.__codexPlusMobileEndpoint;
  endpoint.receive(JSON.stringify({connection: 'test', kind: 'port-open', id: 'one'}));
  await new Promise(resolve => setTimeout(resolve, 10));
  endpoint.receive(JSON.stringify({connection: 'test', kind: 'port-open', id: 'two'}));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(native, ['connect-app-host']);
  assert.deepEqual(origins, ['*']);
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

test('the captured native target navigates once to blank and waits for its new loader', async () => {
  const config = {threadId: 'thread', anchor: 'anchor'}, url = new URL('app://-/index.html');
  url.searchParams.set('initialRoute', '/local/thread?codexPlusMobileAnchor=anchor');
  const commands = []; let starts = 0, loader = 'old', probes = 0;
  let document = {complete: true, preload: true, isolated: false, ui: true};
  const manager = new MobileAccess(config, {
    cdp: {call: async () => ({targetInfos: [{type: 'page', targetId: 'owned', url: url.href}]})},
    command: async (session, method, params) => {
      commands.push({session, method, params});
      return method === 'Page.getFrameTree' ? {frameTree: {frame: {id: 'root', loaderId: loader, url: loader === 'old' ? url.href : 'about:blank'}}} : {};
    },
    sessions: new Map([['anchor-session', {target: 'owned', frame: 'root', contexts: new Map([[1, {id: 1, auxData: {isDefault: true, frameId: 'root'}}]])}]]),
    stateFile: '/unused', publish: async () => {},
  });
  manager.evaluate = async () => { probes++; return document; };
  manager.startGateway = async () => { starts++; manager.gateway = {}; manager.phase = 'listening'; };
  await manager.tick();
  assert.equal(starts, 0); assert.equal(manager.status().anchorReady, false);
  assert.deepEqual(commands.filter(c => c.method === 'Page.navigate').map(c => c.params.url), ['about:blank']);
  // Navigation can ACK while the old complete document is still committed.
  await manager.tick(); assert.equal(probes, 0); assert.equal(starts, 0); assert.equal(manager.stopped, false);
  loader = 'new'; document = {blank: true, complete: false, preload: true, isolated: false, ui: false};
  await manager.tick(); assert.equal(starts, 0);
  document = {blank: true, complete: true, preload: true, isolated: true, ui: false};
  await manager.tick(); await manager.tick();
  assert.equal(starts, 1); assert.equal(manager.status().anchorReady, true);
  assert.equal(commands.filter(c => c.method === 'Page.navigate').length, 1);
  assert.equal(commands.filter(c => c.method === 'Runtime.evaluate').length, 0);
});

test('a new loader that remains unisolated closes without replaying navigation or creating a second window', async () => {
  const config = {threadId: 'thread', anchor: 'anchor'}, url = new URL('app://-/index.html');
  url.searchParams.set('initialRoute', '/local/thread?codexPlusMobileAnchor=anchor');
  let navigations = 0, closes = 0, starts = 0, loader = 'old';
  const manager = new MobileAccess(config, {
    cdp: {call: async method => { if (method === 'Target.closeTarget') { closes++; return {}; } return {targetInfos: [{type: 'page', targetId: 'owned', url: url.href}]}; }},
    command: async (_, method) => { if (method === 'Page.getFrameTree') return {frameTree: {frame: {id: 'root', loaderId: loader, url: loader === 'old' ? url.href : 'about:blank'}}}; assert.equal(method, 'Page.navigate'); navigations++; return {}; },
    sessions: new Map([['anchor-session', {target: 'owned', frame: 'root', contexts: new Map([[1, {id: 1, auxData: {isDefault: true, frameId: 'root'}}]])}]]),
    stateFile: '/unused', publish: async () => {},
  });
  manager.evaluate = async () => ({blank: true, complete: true, preload: true, isolated: false, ui: true});
  manager.startGateway = async () => { starts++; };
  await manager.tick(); loader = 'new'; await manager.tick(); await manager.tick();
  assert.equal(navigations, 1); assert.equal(closes, 1); assert.equal(starts, 0);
  assert.equal(manager.stopped, true); assert.equal(manager.status().anchorReady, false);
});

test('anchor probes use the new context when navigation commits during frame-tree lookup', async () => {
  const url = new URL('app://-/index.html'); url.searchParams.set('initialRoute', '/local/thread?codexPlusMobileAnchor=anchor');
  const contexts = new Map([[1, {id: 1, auxData: {isDefault: true, frameId: 'root'}}]]);
  let swap = false, loader = 'old', starts = 0;
  const manager = new MobileAccess({threadId: 'thread', anchor: 'anchor'}, {
    cdp: {call: async () => ({targetInfos: [{type: 'page', targetId: 'owned', url: url.href}]})},
    sessions: new Map([['anchor-session', {target: 'owned', frame: 'root', contexts}]]), stateFile: '/unused', publish: async () => {},
    command: async (_, method) => {
      if (method === 'Page.getFrameTree') {
        if (swap) { contexts.clear(); contexts.set(2, {id: 2, auxData: {isDefault: true, frameId: 'root'}}); loader = 'new'; }
        return {frameTree: {frame: {id: 'root', loaderId: loader, url: loader === 'old' ? url.href : 'about:blank'}}};
      }
      assert.equal(method, 'Page.navigate'); return {};
    },
  });
  manager.evaluate = async (_, __, contextId) => {
    assert.equal(contextId, swap ? 2 : 1);
    return {blank: true, complete: true, preload: true, isolated: swap, ui: !swap};
  };
  manager.startGateway = async () => { starts++; manager.gateway = {}; };
  await manager.tick(); swap = true; await manager.tick();
  assert.equal(starts, 1); assert.equal(manager.stopped, false);
});


test('a captured target disappearing cannot adopt another matching nonce target', async () => {
  const url = new URL('app://-/index.html'); url.searchParams.set('initialRoute', '/local/thread?codexPlusMobileAnchor=anchor');
  let target = 'owned'; const closed = [], navigated = [];
  const manager = new MobileAccess({threadId: 'thread', anchor: 'anchor'}, {
    cdp: {call: async (method, args) => { if (method === 'Target.closeTarget') { closed.push(args.targetId); return {}; } return {targetInfos: [{type: 'page', targetId: target, url: url.href}]}; }},
    sessions: new Map([['session', {target: 'owned', frame: 'root', contexts: new Map()}]]), stateFile: '/unused', publish: async () => {},
    command: async (_, method, args) => { if (method === 'Page.getFrameTree') return {frameTree: {frame: {id: 'root', loaderId: 'old', url: url.href}}}; assert.equal(method, 'Page.navigate'); navigated.push(args.url); return {}; },
  });
  await manager.tick(); target = 'replacement'; await manager.tick();
  assert.equal(manager.anchorTarget, 'owned'); assert.equal(manager.stopped, true);
  assert.deepEqual(navigated, ['about:blank']); assert.deepEqual(closed, ['owned']);
});

test('blank marker writes require exact blank, complete document, original preload and no scripts', () => {
  for (const fixture of [{}, {href: 'app://-/index.html'}, {ready: 'loading'}, {preload: false}, {script: true}]) {
    const children = [], body = {};
    const document = {readyState: fixture.ready ?? 'complete', title: '', body,
      createElement: () => ({}), head: {append: (...nodes) => children.push(...nodes)},
      querySelector: selector => selector === 'script' ? (fixture.script ? {} : null) : children.find(n => n.name === 'codex-plus-mobile-anchor') ?? null,
    };
    const context = vm.createContext({document, window: {electronBridge: fixture.preload === false ? undefined : {}}, location: {href: fixture.href ?? 'about:blank'}});
    const result = vm.runInContext(`(${prepareMobileAnchor.toString()})('anchor')`, context);
    const allowed = Object.keys(fixture).length === 0;
    assert.equal(result.isolated, allowed); assert.equal(children.length, allowed ? 2 : 0);
    if (allowed) { assert.equal(children[0].content, "default-src 'none'"); assert.equal(document.title, 'Codex Plus Mobile'); }
    else assert.equal(body.textContent, undefined);
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
