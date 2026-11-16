import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import {MobileAccess} from '../Sources/CodexPlus/Resources/mobile-access.mjs';

// Execute the real controller entry point without launching a host, creating
// windows or opening its transport. The slice is bounded by adjacent functions.
const source = await fs.readFile(new URL('../Sources/CodexPlus/Resources/controller.mjs', import.meta.url), 'utf8');
const start = source.indexOf('async function lifecycleCommand(');
const end = source.indexOf('\nasync function shutdown(', start);
assert.ok(start >= 0 && end > start);
function harness({targets = [], creations = new Map(), pending, queryError = false} = {}) {
  const replies = [], calls = [], saved = [];
  const context = vm.createContext({
    quiesced: false, stopping: false, startupReady: true, startupWork: Promise.resolve(), monitorWork: Promise.resolve(),
    inFlight: new Set(), lifecycleOperations: new Set(pending ? [pending] : []), humanCreations: creations,
    state: {}, stateFile: '/unused/state.json', connection: 'controller-instance', path,
    fs: {async writeFile() {}, async rename() {}},
    humanMarker(value) { return new URL(value).searchParams.get('codexPlusHumanWindow'); },
    cdp: {async call(method) { calls.push(method); if (queryError) throw Error('unavailable'); return {targetInfos: targets}; }},
    mobile: {quiesced: false, async prepareStop() { return {targetId: 'phone-anchor'}; }, async verifyStop() { return {targetId:'phone-anchor'}; }, resume() { this.quiesced = false; }},
    publish: async () => { saved.push(JSON.parse(JSON.stringify(context.state))); },
    process: {stdout: {write: line => replies.push(JSON.parse(line))}},
  });
  vm.runInContext(source.slice(start, end), context);
  const settleStart = source.indexOf('async function settleHumanCreations(');
  vm.runInContext(source.slice(settleStart, source.indexOf('\nasync function repairNativeWindowDefaults(', settleStart)), context);
  return {context, replies, calls, saved, run: action => context.lifecycleCommand({action, requestId: 'same-request'})};
}

test('acknowledged but unresolved F6 creation is preserved without blocking mobile preparation', async () => {
  const creations = new Map([['old-nonce', {phase: 'requested'}]]);
  const h = harness({creations});
  await h.run('prepare');
  assert.equal(h.replies[0].ok, true);
  assert.equal(h.replies[0].mobile.targetId, 'phone-anchor');
  assert.deepEqual(h.calls, ['Target.getTargets']);
  assert.equal(creations.get('old-nonce').phase, 'requested');
  assert.equal(creations.get('old-nonce').preserved, true);
  const outcomes = h.replies[0].human_creation_outcomes;
  assert.equal(outcomes[0].nonce, 'old-nonce');
  assert.equal(outcomes[0].outcome, 'unknown');
  assert.deepEqual(outcomes[0].matchingTargets, []);
  assert.deepEqual(h.saved.at(-1).humanCreationOutcomes, outcomes);
  await h.run('resume');
  await h.context.settleHumanCreations();
  assert.deepEqual(h.calls, ['Target.getTargets']);
});

test('a late unknown human window remains untouched after prepare and resume', async () => {
  const targets = [], creations = new Map([['late', {phase: 'requested'}]]);
  const h = harness({targets, creations});
  await h.run('prepare');
  targets.push({type: 'page', targetId: 'late-window-with-user-draft', url: 'app://-/index.html?codexPlusHumanWindow=late'});
  await h.run('resume');
  await h.context.settleHumanCreations();
  assert.deepEqual(h.calls, ['Target.getTargets']);
  assert.deepEqual(h.replies[0].human_creation_outcomes[0].matchingTargets, []);
});

test('prepare drains an in-flight native request before recording its readonly target census', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const creations = new Map([['nonce', {phase: 'creating'}]]);
  const h = harness({pending, creations, targets: [{type: 'page', targetId: 'human', url: 'app://-/index.html?codexPlusHumanWindow=nonce'}]});
  const prepare = h.run('prepare');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.replies.length, 0); assert.equal(h.calls.length, 0);
  creations.set('nonce', {phase: 'requested'}); release(); await prepare;
  assert.equal(h.replies[0].ok, true);
  assert.deepEqual(h.replies[0].human_creation_outcomes[0].matchingTargets, ['human']);
  assert.equal(h.replies[0].human_creation_outcomes[0].outcome, 'observed');
  assert.deepEqual(h.calls, ['Target.getTargets']);
});

test('a failed target census remains unknown and resume does not repeat a window creation', async () => {
  const h = harness({creations: new Map([['nonce', {phase: 'requested'}]]), queryError: true});
  await h.run('prepare');
  assert.equal(h.replies[0].ok, false);
  assert.equal(h.context.quiesced, true);
  assert.equal(h.saved.length, 0);
  await h.run('resume');
  assert.equal(h.context.quiesced, false);
  assert.deepEqual(h.calls, ['Target.getTargets']);
});

test('controller verification propagates a fresh terminal resource proof and refuses a changed proof', async () => {
  const h=harness();let closed=true,verifications=0;
  h.context.mobile.verifyStop=async()=>{verifications++;if(!closed)throw Error('target reappeared');return {targetId:'sticky',terminalClosed:true,gatewayPID:null};};
  await h.run('prepare');await h.run('verify');
  assert.equal(h.replies.at(-1).ok,true);assert.equal(h.replies.at(-1).mobile.terminalClosed,true);
  closed=false;await h.run('verify');assert.equal(h.replies.at(-1).ok,false);assert.equal(verifications,2);
});

test('an idle transport disconnect publishes its mobile cause before exit without needing a detach event',async()=>{
  const state={},snapshots=[],exits=[];
  const publish=async()=>{snapshots.push(JSON.parse(JSON.stringify(state)));};
  const mobile=new MobileAccess({anchor:'a'},{stateFile:'/unused',cdp:{},sessions:new Map(),publish:async()=>{state.mobile=mobile.status();await publish();}});
  const start=source.indexOf('function hostDisconnected('),end=source.indexOf('\nfunction fail(',start);
  assert.ok(start>=0&&end>start);
  const context=vm.createContext({state,mobile,publish,process:{exit:code=>exits.push(code)}});
  vm.runInContext(source.slice(start,end),context);context.hostDisconnected();
  await new Promise(r=>setImmediate(r));
  assert.equal(snapshots[0].mobile.terminalCause.kind,'transport-closed');
  assert.equal(snapshots.at(-1).phase,'disconnected');assert.deepEqual(exits,[1]);
  await mobile.close();
  // A later connectionClosed also cannot overwrite an already recorded cause.
  const first=mobile.terminalCause;context.hostDisconnected();await new Promise(r=>setImmediate(r));assert.equal(mobile.terminalCause,first);
});
