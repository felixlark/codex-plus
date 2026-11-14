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
