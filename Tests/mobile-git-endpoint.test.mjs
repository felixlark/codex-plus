import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installMobileLocalState} from '../Sources/CodexPlus/Resources/mobile-local-state.mjs';
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
    const tracedID = envelopes.find(message => message.kind === 'git-port').id;
    for (const frame of [['push', ['pipeline', 0, ['getMetadata'], ['PRIVATE_ARGUMENT']]], ['pull', 1]]) {
      host.__codexPlusMobileEndpoint.receive(JSON.stringify({connection: 'current', kind: 'port-frame', id: tracedID, value: await encodeMobileValue(frame)}));
    }
    await wait(() => host.__codexPlusMobileEndpoint.inspect().rpc.some(row => row.pending.includes('getMetadata')));
    assert.equal(JSON.stringify(host.__codexPlusMobileEndpoint.inspect()).includes('PRIVATE_ARGUMENT'), false);
    native.port2.postMessage(['resolve', 1, {private: 'PRIVATE_RESPONSE'}]);
    await wait(() => host.__codexPlusMobileEndpoint.inspect().rpc.every(row => row.pending.length === 0));
    assert.equal(JSON.stringify(host.__codexPlusMobileEndpoint.inspect()).includes('PRIVATE_RESPONSE'), false);
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


test('actual phone bridge seeds its private selection instead of the Mac sidebar UI selection', () => {
  const window = new EventTarget(); window.postMessage = () => {};
  const context = vm.createContext({window, location: {origin: 'app://-'}, MessageChannel, MessagePort, MessageEvent, CustomEvent, queueMicrotask, encode: encodeMobileValue, decode: decodeMobileValue});
  context.__codexPlusMobileNativeSend = () => {};
  const snapshot = {version: 'version', sidebar: {globalStateEntries: [{key: 'local-projects', value: [{id: 'real-project'}]}, {key: 'selected-project', value: {type: 'local', projectId: 'mac-project'}}]}};
  vm.runInContext(`(${installMobileEndpoint.toString()})({side:'phone',connection:'current',hostVersion:'version',snapshot:${JSON.stringify(snapshot)}},encode,decode)`, context);
  try {
    assert.throws(() => window.electronBridge.getInitialSidebarBootstrap(), /local UI state is not ready/);
    vm.runInContext(`(${installMobileLocalState.toString()})({atoms:{},application:{'selected-project':{type:'local',projectId:'phone-project'}}},()=>({}))`, context);
    const result = JSON.parse(JSON.stringify(window.electronBridge.getInitialSidebarBootstrap()));
    assert.deepEqual(result.globalStateEntries.find(e => e.key === 'selected-project').value, {type: 'local', projectId: 'phone-project'});
    assert.deepEqual(result.globalStateEntries.find(e => e.key === 'local-projects').value, [{id: 'real-project'}]);
  } finally { context.__codexPlusMobileLocal?.close(); context.__codexPlusMobileEndpoint.close(); }
});
