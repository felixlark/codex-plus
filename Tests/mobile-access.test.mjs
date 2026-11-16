import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {isTailIPv4, isAnchorURL, MobileAccess, prepareMobileAnchor, probeUnclaimedMobileThread, mobileStartupReadiness, mobileAnchorRoute} from '../Sources/CodexPlus/Resources/mobile-access.mjs';
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
  const document = {querySelector: selector => ({content: selector.includes('instance') ? 'fixture' : 'anchor'})};
  const context = vm.createContext({window, document, location: {origin: 'null', href: 'about:blank'}, MessageChannel, MessageEvent: EventMessage, CustomEvent, MessagePort,
    __codexPlusMobileOutbound: text => sent.push(JSON.parse(text))});
  vm.runInContext(`(${installMobileEndpoint.toString()})({side:'host',connection:'test',anchor:'anchor',instance:'fixture'},${encodeMobileValue.toString()},${decodeMobileValue.toString()})`, context);
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

function blankHarness() {
  const commands = [], contexts = new Map([[1, {id: 1, auxData: {isDefault: true, frameId: 'root'}}]]);
  const state = {loader: 'old', target: 'owned', starts: 0, probes: [], ready: false};
  const manager = new MobileAccess({threadId: 'thread', anchor: 'anchor'}, {
    instance: 'fixture', cdp: {call: async (method, args) => {
      commands.push({method, params: args});
      return method === 'Target.getTargets' ? {targetInfos: [{type: 'page', targetId: state.target, url: state.url}]} : {};
    }}, command: async (session, method, params) => {
      commands.push({session, method, params});
      if (method === 'Page.getFrameTree') return {frameTree: {frame: {id: 'root', loaderId: state.loader, url: state.frameURL}}};
      return {};
    }, sessions: new Map([['anchor', {target: 'owned', frame: 'root', contexts}]]), stateFile: '/unused', publish: async () => {},
  });
  const initial = new URL('app://-/index.html'); initial.searchParams.set('initialRoute', mobileAnchorRoute(manager.config));
  state.url = state.frameURL = initial.href;
  manager.evaluate = async (source, _, context) => {
    state.probes.push(context);
    if (source.includes('installMobileGitOriginRepair')) return state.repair !== false;
    return {blank: true, complete: state.ready, preload: true, isolated: true, ui: false};
  };
  manager.startGateway = async () => { state.starts++; manager.gateway = {stdin: {end() {}}}; };
  const commit = () => {
    state.loader = 'new'; state.url = state.frameURL = 'about:blank';
    contexts.clear(); contexts.set(2, {id: 2, auxData: {isDefault: true, frameId: 'root'}});
    contexts.set(3, {id: 3, name: 'Electron Isolated Context', auxData: {isDefault: false, frameId: 'root'}});
  };
  return {manager, state, commands, contexts, commit};
}

test('mobile window waits for exact current right-screen acknowledgement before losing its nonce document', async () => {
  const h = blankHarness(), requests = [];
  h.manager.requestWindowPlacement = request => requests.push(request);
  await h.manager.tick(); await h.manager.tick();
  assert.equal(requests.length, 1);
  assert.equal(h.commands.some(c => c.method === 'Page.navigate'), false);
  h.manager.windowPlacementResult({...requests[0], instance: 'old', phase: 'ready', windowID: 42});
  await h.manager.tick(); assert.equal(h.manager.windowPlaced, undefined);
  h.manager.windowPlacementResult({...requests[0], phase: 'ready', windowID: 42});
  await h.manager.tick();
  assert.equal(h.manager.status().windowID, 42);
  assert.deepEqual(h.commands.filter(c => c.method === 'Page.navigate').map(c => c.params.url), ['about:blank']);
  const unknown = blankHarness(); unknown.manager.requestWindowPlacement = () => {};
  await unknown.manager.tick();
  const reply = {anchor: unknown.manager.config.anchor, instance: unknown.manager.config.instance, targetId: unknown.manager.anchorTarget};
  unknown.manager.windowPlacementResult({...reply, phase: 'unknown', windowID: 42});
  unknown.manager.windowPlacementResult({...reply, phase: 'ready', windowID: 43});
  await unknown.manager.tick();
  assert.equal(unknown.manager.phase, 'window-placement-unknown');
  assert.equal(unknown.commands.some(c => c.method === 'Page.navigate'), false);
  unknown.manager.windowPlacementResult({...reply, phase: 'ready', windowID: 42});
  await unknown.manager.tick();
  assert.equal(unknown.manager.windowPlaced, true);
  assert.equal(unknown.commands.filter(c => c.method === 'Page.navigate').length, 1);
});

test('the captured blank host repairs only its original preload world before opening the gateway', async () => {
  const h = blankHarness(); await h.manager.tick();
  assert.deepEqual(h.commands.filter(c => c.method === 'Page.navigate').map(c => c.params.url), ['about:blank']);
  await h.manager.tick(); assert.equal(h.state.probes.length, 0);
  h.commit(); await h.manager.tick(); assert.equal(h.state.starts, 0);
  h.state.ready = true; await h.manager.tick(); await h.manager.tick();
  assert.equal(h.state.starts, 1); assert.equal(h.manager.gitOriginContext, 3);
  assert.equal(h.state.probes.filter(id => id === 3).length, 1);
  assert.equal(h.commands.some(c => c.method === 'Page.createIsolatedWorld'), false);
});

test('a missing, ambiguous or failed preload repair never opens the gateway', async () => {
  for (const variant of ['missing', 'ambiguous', 'failed']) {
    const h = blankHarness(); await h.manager.tick(); h.commit(); h.state.ready = true;
    if (variant === 'missing') h.contexts.delete(3);
    if (variant === 'ambiguous') h.contexts.set(4, {id: 4, name: 'Electron Isolated Context', auxData: {isDefault: false, frameId: 'root'}});
    if (variant === 'failed') h.state.repair = false;
    await h.manager.tick(); assert.equal(h.manager.stopped, true); assert.equal(h.state.starts, 0);
    assert.deepEqual(h.commands.filter(c => c.method === 'Target.closeTarget').map(c => c.params.targetId), ['owned']);
  }
});

test('losing the repaired preload context closes only the sticky target and never adopts a replacement', async () => {
  const h = blankHarness(); await h.manager.tick(); h.commit(); h.state.ready = true; await h.manager.tick();
  h.manager.contextLost('human', 3); assert.equal(h.manager.stopped, false);
  h.manager.contextLost('anchor', 3); await h.manager.anchorQueue;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.manager.stopped, true);
  assert.deepEqual(h.commands.filter(c => c.method === 'Target.closeTarget').map(c => c.params.targetId), ['owned']);
});

function terminalHarness() {
  const state={targets:[{targetId:'sticky'}],events:[],closed:0};let manager;
  manager=new MobileAccess({anchor:'a'}, {instance:'same-instance',stateFile:'/unused',sessions:new Map(),
    cdp:{async call(method) {
      if(method==='Target.closeTarget') {state.events.push('cleanup');state.closed++;manager.contextLost('anchor',undefined,'Target.detachedFromTarget');state.targets=[];return {};}
      assert.equal(method,'Target.getTargets');return {targetInfos:state.targets};
    }},
    command:async()=>{},publish:async()=>{state.events.push(JSON.parse(JSON.stringify(manager.status())));},
  });
  manager.anchorTarget='sticky';manager.anchorSession='anchor';manager.creationAttempted=true;
  manager.gateway={pid:123,stdin:{end(){}}};manager.gitOriginContext=7;manager.stage='gateway';
  return {manager,state};
}

test('gateway exit publishes its first cause before cleanup and detach cannot overwrite it',async()=>{
  const {manager,state}=terminalHarness();manager.gatewayExited(17,null);await manager.close();
  assert.equal(state.events[0].terminalCause.kind,'gateway-exit');assert.deepEqual(state.events[0].gatewayExit,{code:17,signal:null});
  assert.equal(state.events[1],'cleanup');assert.equal(manager.phase,'gateway-exited');
  assert.equal(manager.status().gatewayPID,null);assert.equal(manager.terminalCause.kind,'gateway-exit');
  assert.equal(manager.close(),manager.close());assert.equal(state.closed,1);
});

test('context-loss event is published even while quiesced and later exit only adds exit facts',async()=>{
  const {manager,state}=terminalHarness();manager.quiesced=true;
  manager.contextLost('anchor',7,'Runtime.executionContextDestroyed');await manager.close();
  assert.equal(state.events[0].terminalCause.event,'Runtime.executionContextDestroyed');
  manager.gatewayExited(null,'SIGTERM');
  assert.equal(manager.terminalCause.event,'Runtime.executionContextDestroyed');
  assert.equal(state.events.at(-1).gatewayExit.signal,'SIGTERM');
});

test('terminal prepare and verify retain sticky identity and prove absence anew',async()=>{
  const {manager,state}=terminalHarness();manager.gatewayExited(0,null);await manager.close();
  const scope=await manager.prepareStop();assert.equal(scope.terminalClosed,true);assert.equal(scope.targetId,'sticky');assert.equal(scope.gatewayPID,null);
  assert.equal((await manager.verifyStop()).terminalClosed,true);assert.throws(()=>manager.resume(),/resume unavailable/);
  state.targets=[{targetId:'sticky'}];await assert.rejects(manager.verifyStop(),/anchor still live/);assert.equal(manager.status().terminalClosed,false);
});

test('EOF without observed gateway exit and uncaptured creation never become closed proof',{timeout:1000},async()=>{
  const h=terminalHarness();await h.manager.close();await assert.rejects(h.manager.prepareStop(),/gateway still live/);
  assert.equal(h.manager.status().gatewayPID,123);assert.equal(h.manager.status().terminalClosed,false);
  const unknown=terminalHarness();unknown.manager.anchorTarget=null;unknown.manager.gateway=null;
  await unknown.manager.close();await assert.rejects(unknown.manager.prepareStop(),/cleanup outcome unknown/);
  assert.equal(unknown.state.closed,0);assert.equal(unknown.manager.status().terminalClosed,false);
});

test('terminal prepare waits for the existing cleanup before claiming target absence',async()=>{
  const {manager,state}=terminalHarness();let release,entered;
  const gate=new Promise(r=>{release=r;}),ready=new Promise(r=>{entered=r;});
  manager.cdp.call=async method=>{if(method==='Target.closeTarget'){entered();await gate;state.targets=[];return {};}return {targetInfos:state.targets};};
  manager.gatewayEnded=true;const closing=manager.close();await ready;
  let prepared=false;const preparing=manager.prepareStop().then(v=>{prepared=true;return v;});
  await new Promise(r=>setImmediate(r));assert.equal(prepared,false);release();await closing;
  assert.equal((await preparing).terminalClosed,true);
});

test('per-controller nonce routes exclude orphan anchors and human enhancement entry points', () => {
  const h = blankHarness(), old = {...h.manager.config, instance: 'previous'};
  const url = new URL('app://-/index.html'); url.searchParams.set('initialRoute', mobileAnchorRoute(old));
  assert.equal(isAnchorURL(url.href, h.manager.config), false);
  assert.equal(isHumanWindowURL(h.state.url), false);
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

test('stop while startup readiness is pending never creates a new host', async () => {
  let release, entered, creates = 0;
  const ready = new Promise(r => { entered = r; });
  const gate = new Promise(r => { release = r; });
  const sessions = new Map([['human', {main:true, frame:'f', contexts:new Map([[1,{id:1,auxData:{isDefault:true,frameId:'f'}}]])}]]);
  const mobile = new MobileAccess({anchor:'a'}, {cdp:{call:async()=>({targetInfos:[]})},sessions,stateFile:'/unused',publish:async()=>{},command:async(_,__,p)=>{if(p.expression.includes('mobileStartupReadiness')){entered();await gate;return {result:{value:'ready'}};}creates++;return {};}});
  const work=mobile.tick();await ready;await mobile.close();release();await work;
  assert.equal(creates,0);assert.equal(mobile.creationAttempted,false);
});

test('prepare freezes new startup while retaining the existing connection', async () => {
  const mobile = new MobileAccess({anchor:'a',instance:'i'}, {cdp:{call:async()=>({targetInfos:[]})},sessions:new Map(),stateFile:'/unused',publish:async()=>{},command:async()=>{throw Error('must not create');}});
  mobile.clients.set('connected',{phase:'active'});
  const scope=await mobile.prepareStop();await mobile.tick();
  assert.equal(scope.connections,1);assert.equal(mobile.stopped,false);assert.equal(mobile.quiesced,true);
  mobile.resume();assert.equal(mobile.quiesced,false);
});

test('preparation rejects later frames on the existing peer and drains previously accepted work', async () => {
  const mobile = new MobileAccess({}, {cdp:{},sessions:new Map(),stateFile:'/unused',publish:async()=>{},command:async()=>{}});
  mobile.clients.set('phone',{id:'phone',phase:'active',connection:'same'});
  let release, entered;
  const gate = new Promise(r => { release = r; });
  const started = new Promise(r => { entered = r; });
  let effects = 0; const drops = [];
  mobile.evaluate = async () => { effects++; entered(); await gate; };
  mobile.drop = id => drops.push(id);
  const frame = JSON.stringify({type:'frame',id:'phone',text:JSON.stringify({connection:'same',kind:'port-data'})});
  const accepted = mobile.gatewayEvent(frame); await started;
  let prepared = false; const preparation = mobile.prepareStop().then(() => { prepared = true; });
  await mobile.gatewayEvent(frame);
  assert.equal(effects,1); assert.deepEqual(drops,['phone']); assert.equal(prepared,false);
  release(); await accepted; await preparation; assert.equal(prepared,true);
});

test('resume cannot report an already stopped or pending-handshake phone as running', () => {
  for (const state of ['stopped','pending']) {
    const mobile = new MobileAccess({}, {cdp:{},sessions:new Map(),stateFile:'/unused',publish:async()=>{},command:async()=>{}});
    mobile.quiesced = true;
    if(state==='stopped') mobile.stopped=true;
    else mobile.clients.set('phone',{phase:'activating'});
    assert.throws(() => mobile.resume(),/unavailable/);
    assert.equal(mobile.quiesced,true);
  }
});
