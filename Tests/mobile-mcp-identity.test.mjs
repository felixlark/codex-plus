import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installMobileEndpoint} from '../Sources/CodexPlus/Resources/mobile-endpoint.mjs';

function fixture(connection = 'current') {
  class Message extends Event { constructor(fields) { super('message'); Object.assign(this, {source: null, ports: []}, fields); } }
  const sent = [], native = [], window = new EventTarget();
  window.electronBridge = {subscribeToSystemThemeVariant: () => () => {}, async sendMessageFromView(value) { native.push(value); }};
  const context = vm.createContext({window, location: {origin: 'null'}, CustomEvent,
    __codexPlusMobileOutbound: text => sent.push(JSON.parse(text)), encode: JSON.stringify, decode: JSON.parse});
  vm.runInContext(`(${installMobileEndpoint.toString()})({side:'host',connection:${JSON.stringify(connection)}},encode,decode)`, context);
  const endpoint = context.__codexPlusMobileEndpoint;
  const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
  const call = async value => { endpoint.receive(JSON.stringify({connection, kind: 'call', id: 'bridge:' + (sent.length + 1), method: 'sendMessageFromView', value: JSON.stringify([value])})); await flush(); };
  const event = async value => { window.dispatchEvent(new Message({data: value})); await flush(); };
  const events = () => sent.filter(message => message.kind === 'event').map(message => JSON.parse(message.value));
  return {native, sent, endpoint, call, event, events, flush};
}

test('retained delivery, abandon and a late real response share the original request identity', async () => {
  const f = fixture();
  try {
    await f.call({type: 'mcp-request', hostId: 'local', retainResponse: true, request: {id: 'original', method: 'thread/start', params: {text: 'PRIVATE_PROMPT'}}});
    const id = f.native[0].request.id; assert.notEqual(id, 'original');
    await f.event({type: 'mcp-request-delivery', hostId: 'local', update: {type: 'outcome-unknown', delivery: {requestId: id, method: 'thread/start', stage: 'outcome-unknown'}}});
    assert.equal(f.events()[0].update.delivery.requestId, 'original');
    await f.call({type: 'mcp-request-abandon', hostId: 'local', requestId: 'original'});
    assert.equal(f.native[1].requestId, id); assert.deepEqual([...f.endpoint.inspect().pendingMcp], ['thread/start']);
    assert.equal(JSON.stringify(f.endpoint.inspect()).includes('PRIVATE_PROMPT'), false);
    await f.event({type: 'mcp-response', hostId: 'local', message: {id, result: {thread: {id: 'real-thread'}}}});
    assert.equal(f.events()[1].message.id, 'original'); assert.equal(f.events()[1].message.result.thread.id, 'real-thread');
    assert.equal(f.endpoint.inspect().pendingMcp.length, 0);
  } finally { f.endpoint.close(); }
});

test('local timeout can abandon before the Native unknown notification without dropping the late result', async () => {
  const f = fixture();
  try {
    await f.call({type: 'mcp-request', hostId: 'local', request: {id: 7, method: 'turn/start'}});
    const id = f.native[0].request.id;
    await f.call({type: 'mcp-request-abandon', hostId: 'local', requestId: 7});
    await f.event({type: 'mcp-response', hostId: 'local', message: {id, result: 'late'}});
    assert.equal(f.events()[0].message.id, 7); assert.equal(f.endpoint.inspect().closed, false);
  } finally { f.endpoint.close(); }
});

test('prewarm IDs and terminal failure map exactly; foreign host updates and unowned cleanup never escape', async () => {
  const f = fixture();
  try {
    await f.call({type: 'thread-prewarm-start', hostId: 'local', request: {id: 'prewarm', method: 'thread/start'}});
    const id = f.native[0].request.id;
    await f.event({type: 'mcp-request-delivery', hostId: 'foreign', update: {type: 'failed', delivery: {requestId: id}}});
    assert.equal(f.events().length, 0);
    await f.event({type: 'mcp-request-delivery', hostId: 'local', update: {type: 'failed', delivery: {requestId: id, stage: 'not-sent'}, message: 'original error'}});
    assert.equal(f.events()[0].update.delivery.requestId, 'prewarm'); assert.equal(f.events()[0].update.message, 'original error');
    await f.call({type: 'mcp-request-abandon', hostId: 'local', requestId: 'prewarm'});
    assert.equal(f.native.length, 1); assert.equal(f.endpoint.inspect().pendingMcp.length, 0);
    await f.call({type: 'mcp-response', hostId: 'local', response: {id: 'server-approval-id', result: {approved: false}}});
    assert.equal(f.native[1].response.id, 'server-approval-id');
  } finally { f.endpoint.close(); }
});

test('default-host callers and Native exception replies preserve an owned numeric ID without guessing a host', async () => {
  const f = fixture();
  try {
    await f.call({type: 'mcp-request', request: {id: 9, method: 'config/read'}});
    await f.event({type: 'mcp-response', hostId: 'local', message: {id: f.native[0].request.id, result: {}}});
    assert.equal(f.events()[0].message.id, 9);
    await f.call({type: 'mcp-request', hostId: 'local', request: {id: 10, method: 'config/read'}});
    await f.event({type: 'mcp-request-delivery', update: {type: 'failed', delivery: {requestId: f.native[1].request.id, stage: 'not-sent'}}});
    assert.equal(f.events()[1].update.delivery.requestId, 10);
  } finally { f.endpoint.close(); }
});

test('same IDs across hosts and types stay separate while an explicit same-request dispatch keeps its Native identity', async () => {
  const f = fixture();
  try {
    const request = {type: 'mcp-request', hostId: 'local', request: {id: 1, method: 'config/read'}};
    await f.call(request); await f.call(request);
    await f.call({...request, hostId: 'remote'});
    await f.call({...request, request: {...request.request, id: '1'}});
    const [a, same, otherHost, otherType] = f.native.map(message => message.request.id);
    assert.equal(a, same); assert.equal(new Set([a, otherHost, otherType]).size, 3);
    await f.event({type: 'mcp-response', hostId: 'local', message: {id: a, result: null}});
    await f.event({type: 'mcp-request-delivery', hostId: 'local', update: {type: 'outcome-unknown', delivery: {requestId: a}}});
    assert.equal(f.events().length, 1);
    await f.call({type: 'mcp-request-abandon', hostId: 'local', requestId: 1});
    assert.equal(f.native.length, 4);
  } finally { f.endpoint.close(); }
});
