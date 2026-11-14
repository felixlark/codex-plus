import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {isTailIPv4, isAnchorURL} from '../Sources/CodexPlus/Resources/mobile-access.mjs';
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
  endpoint.receive(JSON.stringify({kind: 'port-open', id: 'one'}));
  await new Promise(resolve => setTimeout(resolve, 10));
  endpoint.receive(JSON.stringify({kind: 'port-open', id: 'two'}));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(native, ['connect-app-host']);
  assert.ok(endpoint.inspect().closed);
  assert.ok(sent.some(event => event.kind === 'fatal'));
  for (const port of ports) port.close();
});
