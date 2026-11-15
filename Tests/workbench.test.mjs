import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Workbench, workbenchMarker} from '../Sources/CodexPlus/Resources/workbench.mjs';
import {isHumanWindowURL} from '../Sources/CodexPlus/Resources/human-window.mjs';
import {workspacePath, TaskWorkspaceClient} from '../Sources/CodexPlus/Resources/task-workspace.mjs';

const open = () => ({version: 1, request_id: randomUUID(), origin_runtime: randomUUID()});
function fixture(previous) {
  const events = [], targets = [], contexts = new Map([[1, {id: 1, auxData: {isDefault: true, frameId: 'frame'}}]]);
  const sessions = new Map([['human', {target: 'human', main: true, contexts, frame: 'frame'}]]);
  const cdp = {call: async method => { assert.equal(method, 'Target.getTargets'); return {targetInfos: targets}; }};
  let workbench;
  const command = async (id, method, params) => {
    events.push({id, method, params});
    if (method === 'Page.navigate') { targets[0].url = params.url; return {}; }
    return {result: {value: params?.expression?.includes('mobileStartupReadiness') ? 'ready' : params?.expression?.includes('installWorkbenchView') ? {ready: true, nonce: workbench.window.nonce} : true}};
  };
  workbench = new Workbench({cdp, command, sessions, hostPID: process.pid, previous,
    persist: async () => events.push({persist: JSON.parse(JSON.stringify(workbench.status()))}),
    requestPlacement: message => events.push({placement: message}), client: {close() {}}});
  function target() {
    const url = new URL('app://-/index.html'); url.searchParams.set('initialRoute', `/plugins/installed?codexPlusWorkbench=${workbench.window.nonce}`);
    targets.push({type: 'page', targetId: 'owned', url: url.href}); sessions.set('owned-session', {target: 'owned', contexts, frame: 'frame', main: false});
  }
  return {workbench, events, targets, contexts, sessions, target};
}

test('owned workbench marker never participates in human windows or numbers', () => {
  const nonce = randomUUID(), outer = `app://-/index.html?codexPlusWorkbench=${nonce}`;
  const inner = new URL('app://-/index.html'); inner.searchParams.set('initialRoute', '/plugins/installed?codexPlusWorkbench=' + nonce);
  for (const url of [outer, inner.href]) { assert.equal(workbenchMarker(url), nonce); assert.equal(isHumanWindowURL(url), false); }
  assert.equal(workbenchMarker('https://example.org/index.html?codexPlusWorkbench=' + nonce), null);
});

test('unreviewed original host resources cannot dispatch a workbench creation', async () => {
  const f = fixture(); f.workbench.supported = false;
  f.workbench.open(open()); await f.workbench.tick();
  assert.equal(f.workbench.status().supported, false);
  assert.equal(f.workbench.status().requests.length, 0);
  assert.equal(f.events.length, 0);
});

test('native creation and layout effects follow durable nonce and CG capture, never ACK alone', async () => {
  const f = fixture(), request = open(); f.workbench.open(request); f.workbench.open(request);
  await f.workbench.tick();
  const create = f.events.findIndex(e => e.params?.expression?.includes('sendMessageFromView'));
  assert.ok(create > f.events.findIndex(e => e.persist?.window.creationDispatched));
  assert.equal(f.events.filter(e => e.params?.expression?.includes('sendMessageFromView')).length, 1);
  f.target(); await f.workbench.tick();
  assert.equal(f.events.at(-1).placement.operation, 'identify');
  f.workbench.placementResult({...f.events.at(-1).placement, windowID: 77, phase: 'identified'});
  await f.workbench.tick();
  assert.equal(f.events.at(-1).placement.operation, 'place');
  assert.equal(f.events.at(-2).persist.window.windowID, 77);
  assert.equal(f.events.at(-2).persist.window.placementDispatched, true);
  assert.notEqual(f.workbench.status().requests[0].phase, 'ready');
  f.workbench.placementResult({...f.events.at(-1).placement, windowID: 77, phase: 'ready'});
  await f.workbench.tick(); await f.workbench.tick();
  assert.equal(f.workbench.status().requests[0].phase, 'ready');
  const second = open(); f.workbench.open(second);
  assert.equal(f.workbench.status().requests.length, 2);
  assert.ok(f.workbench.status().requests.every(r => r.phase === 'ready' && r.window === 77));
  assert.equal(f.events.filter(e => e.params?.expression?.includes('sendMessageFromView')).length, 1);
});

test('controller recovery only inspects the same captured CG window and preserves original request', async () => {
  const request = open(), nonce = randomUUID(), instance = randomUUID();
  const previous = {pid: process.pid, workbench: {protocol: 1, window: {nonce, instance, targetId: 'owned', windowID: 77, placementDispatched: true}, requests: [{...request, nonce}]}};
  const f = fixture(previous); f.target(); await f.workbench.tick();
  assert.equal(f.events.at(-1).placement.operation, 'inspect');
  assert.equal(f.events.at(-1).placement.windowID, 77);
  assert.equal(f.events.some(e => e.params?.expression?.includes('sendMessageFromView')), false);
  assert.equal(f.workbench.status().requests[0].origin_runtime, request.origin_runtime);
  f.workbench.placementResult({...f.events.at(-1).placement, phase: 'ready', windowID: 78});
  assert.notEqual(f.workbench.window.phase, 'loading');
});

test('creation response lost before target capture waits for the same nonce instead of creating again', async () => {
  const request = open(), nonce = randomUUID();
  const f = fixture({pid: process.pid, workbench: {protocol: 1, window: {nonce, instance: randomUUID(), phase: 'creating', creationDispatched: true}, requests: [{...request, nonce}]}});
  f.workbench.open(open()); await f.workbench.tick(); await f.workbench.tick();
  assert.equal(f.events.length, 0);
  f.target(); await f.workbench.tick(); assert.equal(f.events.at(-1).placement.operation, 'identify');
});

test('target disappearance requires native CG absence readback before a new explicit window', async () => {
  const f = fixture(); f.workbench.open(open()); await f.workbench.tick(); f.target(); await f.workbench.tick();
  f.workbench.placementResult({...f.events.at(-1).placement, phase: 'identified', windowID: 77});
  f.targets.length = 0; await f.workbench.tick();
  const absence = f.events.at(-1).placement; assert.equal(absence.operation, 'inspect-absence');
  assert.equal(f.workbench.window.phase, 'unknown');
  f.workbench.placementResult({...absence, phase: 'closed'});
  const oldNonce = f.workbench.window.nonce; f.workbench.open(open());
  assert.notEqual(f.workbench.window.nonce, oldNonce);
  assert.equal(f.workbench.status().requests[0].phase, 'closed');
});

test('late API response is not delivered after the owning default context is destroyed', async () => {
  const f = fixture(); f.workbench.open(open()); f.target(); f.workbench.window.targetId = 'owned';
  let resolve; f.workbench.client = {read: () => new Promise(r => { resolve = r; })};
  const pending = f.workbench.onBinding({sessionId: 'owned-session', params: {name: '__codexPlusWorkbenchOutbound', executionContextId: 1,
    payload: JSON.stringify({version: 1, nonce: f.workbench.window.nonce, requestId: randomUUID(), action: 'read', operation: 'issues'})}});
  f.contexts.delete(1); resolve({items: []}); await pending;
  assert.equal(f.events.length, 0);
});

test('workspace reader accepts only fixed GET scopes and preserves explicit pagination', () => {
  assert.equal(workspacePath({operation: 'coordination', repository: 'felixlark/smart-shadow', number: 578}), '/api/v2/event-workspace/issues/578/coordination?repository=felixlark%2Fsmart-shadow');
  for (const request of [{operation: 'issues', repository: '../x'}, {operation: 'issues', repository: 'a/b', page: 0}, {operation: 'issue', repository: 'a/b', number: 1.5}, {operation: 'control', repository: 'a/b', number: 1}]) assert.throws(() => workspacePath(request));
});

test('formal API human identity is checked and transport failures never become empty task lists', async () => {
  const calls = [], responses = [JSON.stringify({status: 'ok', authentication: 'cloudflare_access', subject: 'test-subject'}) + '\n200', JSON.stringify({items: [], next_page: 2}) + '\n200'];
  const client = new TaskWorkspaceClient((file, args, options, callback) => { calls.push({file, args}); setImmediate(() => callback(null, responses.shift())); return {kill() {}}; });
  const value = await client.read({operation: 'issues', repository: 'felixlark/smart-shadow'});
  assert.equal(value.next_page, 2); assert.equal(calls[0].file, '/opt/homebrew/bin/cloudflared');
  assert.equal(calls[1].args[2].startsWith('https://smartshadow.ai/api/v2/'), true);
  assert.ok(calls[1].args.includes('Origin: https://smartshadow.ai'));
  client.readJSON = async () => ({status: 'ok', authentication: 'service', subject: 'test-subject'});
  await assert.rejects(client.read({operation: 'issues', repository: 'a/b'}), /human_session_required/);
});

test('a real non-JSON gateway failure is reported as HTTP failure, not a login error or empty list', async () => {
  const client = new TaskWorkspaceClient((file, args, options, callback) => { setImmediate(() => callback(null, 'error code: 502\n502')); return {kill() {}}; });
  await assert.rejects(client.readJSON('/api/v2/session'), /workspace_http_502/);
});
