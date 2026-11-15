import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installMobileEndpoint} from '../Sources/CodexPlus/Resources/mobile-endpoint.mjs';
import {encodeMobileValue, decodeMobileValue} from '../Sources/CodexPlus/Resources/mobile-codec.mjs';

test('original Git metadata, real port messages and zero-port closure survive the phone carrier', async () => {
  class EventMessage extends Event { constructor(type, fields) { super(type); Object.assign(this, fields); } }
  const nativeIDs = [], hostWindow = new EventTarget(), phoneWindow = new EventTarget(), delivered = [], envelopes = [];
  phoneWindow.postMessage = () => {};
  // Node's real MessagePorts clone into the outer realm, so their carrier
  // encoder belongs to that realm too; the two endpoint globals stay isolated.
  const host = vm.createContext({window: hostWindow, location: {href: 'about:blank', origin: 'null'}, MessageChannel, MessagePort, MessageEvent: EventMessage, CustomEvent, encode: encodeMobileValue, decode: decodeMobileValue});
  const phone = vm.createContext({window: phoneWindow, location: {origin: 'null'}, MessageChannel, MessagePort, MessageEvent: EventMessage, CustomEvent, encode: encodeMobileValue, decode: decodeMobileValue});
  hostWindow.electronBridge = {subscribeToSystemThemeVariant: () => () => {}, connectGitWorker: async id => { nativeIDs.push(id); return true; }};
  host.__codexPlusMobileOutbound = text => { envelopes.push(JSON.parse(text)); phone.__codexPlusMobileEndpoint.receive(text); };
  phone.__codexPlusMobileNativeSend = text => host.__codexPlusMobileEndpoint.receive(text);
  phoneWindow.addEventListener('message', event => delivered.push(event));
  const install = (context, side) => vm.runInContext(`(${installMobileEndpoint.toString()})({side:'${side}',connection:'current',hostVersion:'version',snapshot:{version:'version'}},encode,decode)`, context);
  install(host, 'host'); install(phone, 'phone');
  const native = new MessageChannel(); let remote;
  const wait = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail('original Git event did not arrive'); };
  try {
    assert.equal(await phoneWindow.electronBridge.connectGitWorker('original-id'), true);
    assert.deepEqual(nativeIDs, ['original-id']);
    hostWindow.dispatchEvent(new EventMessage('message', {source: hostWindow, origin: 'null', data: {type: 'codex_desktop:git-worker-port', requestId: 'original-id', closed: undefined}, ports: [native.port1]}));
    await wait(() => delivered.length === 1);
    const opened = delivered[0]; remote = opened.ports[0];
    assert.equal(opened.source, phoneWindow); assert.equal(opened.origin, 'null'); assert.equal(opened.data.requestId, 'original-id');
    let request, reply;
    native.port2.onmessage = event => { request = event.data; native.port2.postMessage({reply: '中文🙂271828'}); };
    remote.onmessage = event => { reply = event.data; }; remote.start(); remote.postMessage({method: 'metadata'});
    await wait(() => reply);
    assert.equal(request.method, 'metadata'); assert.equal(reply.reply, '中文🙂271828');
    hostWindow.dispatchEvent(new EventMessage('message', {source: hostWindow, origin: 'null', data: {type: 'codex_desktop:git-worker-port', requestId: 'original-id', closed: true}, ports: []}));
    await wait(() => delivered.length === 2);
    assert.equal(delivered[1].source, phoneWindow); assert.equal(delivered[1].data.closed, true); assert.equal(delivered[1].ports.length, 0);
    const oldID = envelopes.find(message => message.kind === 'git-port').id;
    const late = JSON.stringify({connection: 'current', kind: 'port-frame', id: oldID, value: await encodeMobileValue({late: true})});
    host.__codexPlusMobileEndpoint.receive(late); phone.__codexPlusMobileEndpoint.receive(late);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(host.__codexPlusMobileEndpoint.inspect().closed, false); assert.equal(phone.__codexPlusMobileEndpoint.inspect().closed, false);
    assert.equal(await phoneWindow.electronBridge.connectGitWorker('next-id'), true);
    hostWindow.dispatchEvent(new EventMessage('message', {source: hostWindow, origin: 'null', data: {type: 'codex_desktop:git-worker-port', requestId: 'stale-id', closed: true}, ports: []}));
    await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(delivered.length, 2);
  } finally {
    host.__codexPlusMobileEndpoint.close(); phone.__codexPlusMobileEndpoint.close();
    native.port1.close(); native.port2.close(); remote?.close();
  }
});
