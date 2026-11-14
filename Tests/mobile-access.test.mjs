import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {isTailIPv4, isAnchorURL, MobileAccess} from '../Sources/CodexPlus/Resources/mobile-access.mjs';
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

test('a duplicate app-host handshake closes instead of replacing the native view', async () => {
  const sent = [], native = [], ports = [];
  class EventMessage extends Event { constructor(type, fields) { super(type); Object.assign(this, fields); } }
  const window = new EventTarget();
  window.electronBridge = {subscribeToSystemThemeVariant: () => () => {}};
  window.postMessage = data => { native.push(data.type); ports.push(data.port); };
  const context = vm.createContext({window, location: {origin: 'app://-'}, MessageChannel, MessageEvent: EventMessage, CustomEvent, MessagePort,
    __codexPlusMobileOutbound: text => sent.push(JSON.parse(text))});
  vm.runInContext(`(${installMobileEndpoint.toString()})({side:'host',connection:'test'},${encodeMobileValue.toString()},${decodeMobileValue.toString()})`, context);
  const endpoint = context.__codexPlusMobileEndpoint;
  endpoint.receive(JSON.stringify({connection: 'test', kind: 'port-open', id: 'one'}));
  await new Promise(resolve => setTimeout(resolve, 10));
  endpoint.receive(JSON.stringify({connection: 'test', kind: 'port-open', id: 'two'}));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(native, ['connect-app-host']);
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
  context.__codexPlusMobileEndpoint.close(); delete context.__codexPlusMobileEndpoint;
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

test('a missed first document waits for a new loader before starting the gateway', async () => {
  const config = {threadId: 'thread', anchor: 'anchor'}, url = new URL('app://-/index.html');
  url.searchParams.set('initialRoute', '/local/thread?codexPlusMobileAnchor=anchor');
  const commands = []; let starts = 0, loader = 'old', probes = 0;
  let document = {complete: true, preload: true, isolated: false, ui: true};
  const manager = new MobileAccess(config, {
    cdp: {call: async () => ({targetInfos: [{type: 'page', targetId: 'owned', url: url.href}]})},
    command: async (session, method, params) => {
      commands.push({session, method, params});
      return method === 'Page.getFrameTree' ? {frameTree: {frame: {id: 'root', loaderId: loader}}} : {};
    },
    sessions: new Map([['anchor-session', {target: 'owned', frame: 'root', contexts: new Map([[1, {id: 1, auxData: {isDefault: true, frameId: 'root'}}]])}]]),
    stateFile: '/unused', publish: async () => {},
  });
  manager.evaluate = async () => { probes++; return document; };
  manager.startGateway = async () => { starts++; manager.gateway = {}; manager.phase = 'listening'; };
  await manager.tick();
  assert.equal(starts, 0); assert.equal(manager.status().anchorReady, false);
  assert.deepEqual(commands.filter(c => c.method === 'Page.navigate').map(c => c.params.url), [url.href]);
  // Navigation can ACK while the old complete document is still committed.
  await manager.tick(); assert.equal(probes, 1); assert.equal(starts, 0); assert.equal(manager.stopped, false);
  loader = 'new'; document = {complete: false, preload: true, isolated: false, ui: false};
  await manager.tick(); assert.equal(starts, 0);
  assert.equal(await manager.interceptDocument('anchor-session', {request: {url: url.href}, resourceType: 'Document', requestId: 'first'}), true);
  const fulfilled = commands.find(c => c.method === 'Fetch.fulfillRequest');
  assert.ok(Buffer.from(fulfilled.params.body, 'base64').toString().includes('name="codex-plus-mobile-anchor" content="anchor"'));
  document = {complete: true, preload: true, isolated: true, ui: false};
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
    command: async (_, method) => { if (method === 'Page.getFrameTree') return {frameTree: {frame: {id: 'root', loaderId: loader}}}; assert.equal(method, 'Page.navigate'); navigations++; return {}; },
    sessions: new Map([['anchor-session', {target: 'owned', frame: 'root', contexts: new Map([[1, {id: 1, auxData: {isDefault: true, frameId: 'root'}}]])}]]),
    stateFile: '/unused', publish: async () => {},
  });
  manager.evaluate = async () => ({complete: true, preload: true, isolated: false, ui: true});
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
        return {frameTree: {frame: {id: 'root', loaderId: loader}}};
      }
      assert.equal(method, 'Page.navigate'); return {};
    },
  });
  manager.evaluate = async (_, __, contextId) => {
    assert.equal(contextId, swap ? 2 : 1);
    return {complete: true, preload: true, isolated: swap, ui: !swap};
  };
  manager.startGateway = async () => { starts++; manager.gateway = {}; };
  await manager.tick(); swap = true; await manager.tick();
  assert.equal(starts, 1); assert.equal(manager.stopped, false);
});
