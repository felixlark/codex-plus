import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SuggestionCoordinator,createBackgroundSuggestionBridge,createNativeSuggestionContext,adaptBackgroundSuggestions,reviewedBackgroundResource} from '../Sources/CodexPlus/Resources/suggestion-auto-send.mjs';
import {createSuggestionReviewPolicy} from '../Sources/CodexPlus/Resources/suggestion-review.mjs';
import {openAsar,parser,adaptSidebar} from '../scripts/inspect-sidebar-model.mjs';
const target={hostId:'local',threadId:'thread',latestTurnId:'source',generationTrigger:'live'};
const key=JSON.stringify(['local','thread','source']);
const pages=[{id:'a',snapshot:{candidates:[{key,target}]}},{id:'b',snapshot:{candidates:[{key,target}]}}];
const policy={connection:'connection',revision:1,enabled:true};

test('single durable attempt across windows and recovery; unknown never replays',async()=>{
  const writes=[],calls=[],c=new SuggestionCoordinator({persist:async a=>writes.push(a)});
  const actions={probe:async()=>true,submit:async()=>{calls.push('send');assert.ok(writes.at(-1).includes(key));return {outcome:'unconfirmed'};}};
  await c.tick(pages,actions);assert.deepEqual(calls,[]);c.configure(true);
  await c.tick(pages,actions);await c.tick(pages,actions);assert.equal(calls.length,1);assert.equal(c.status().unknown,1);
  const restored=new SuggestionCoordinator({attempts:writes.at(-1),persist:async()=>{}});restored.configure(true);await restored.tick(pages,actions);assert.equal(calls.length,1);
});
test('closed during durable claim, failed storage and foreign draft prevent send',async()=>{
  let release;const c=new SuggestionCoordinator({persist:()=>new Promise(r=>release=r)}),calls=[];
  const actions={probe:async()=>true,submit:async()=>calls.push('send')};c.configure(true);const pending=c.tick(pages,actions);await new Promise(setImmediate);c.configure(false);release();await pending;assert.deepEqual(calls,[]);
  const d=new SuggestionCoordinator({persist:async()=>{throw Error('disk');}});d.configure(true);await d.tick(pages,actions);assert.equal(d.status().enabled,false);
  const e=new SuggestionCoordinator({persist:async()=>assert.fail('draft must block claim')});e.configure(true);await e.tick(pages,{...actions,probe:async()=>false});assert.deepEqual(calls,[]);
});
function fixture(){
  let clock=1000,current=true,blank=true;const sent=[];
  const bridge=createBackgroundSuggestionBridge('__testBackgroundGuard',{now:()=>clock,reviewPolicy:createSuggestionReviewPolicy()});
  const client={},context={hostId:'local',client,probe:()=>blank,keys:()=>['mapped','local:thread'],validate:async()=>current,snapshot:async()=>({permissions:{mode:'readOnly'},sandbox:{type:'readOnly'},history:{title:'test',isComplete:true},sourceInput:['source']}),review:async()=>({decision:'low-risk',contextSufficient:true,action:'分析代码',target:'本地代码',scope:'仅分析'}),send:async(t,text,id,admit)=>{await admit();sent.push(text);return 'accepted';}};
  bridge.register(context);bridge.configure(policy);
  const capture=async(text='native prediction',t=target)=>{bridge.capture(client,t,{sourceTurnId:t.latestTurnId,text},()=>current);for(let n=0;n<100&&bridge.inspect().review.reviewing;n++)await new Promise(r=>setTimeout(r,2));assert.equal(bridge.inspect().review.reviewing,0);};
  const submit=operation=>bridge.submit({...bridge.inspect().candidates[0],operation});
  return {bridge,context,sent,capture,submit,setClock:n=>clock=n,setCurrent:n=>current=n,setBlank:n=>blank=n};
}
test('only newly generated live predictions are admitted; expiry, source and generation gates',async()=>{
  const f=fixture();await f.capture();assert.equal(f.bridge.inspect().candidates.length,1);
  f.bridge.configure({...policy,revision:2});assert.equal(f.bridge.inspect().candidates.length,0);
  await f.capture();f.setCurrent(false);assert.equal(f.bridge.inspect().candidates.length,0);
  f.setCurrent(true);f.setClock(7000);await f.capture();assert.equal(f.bridge.inspect().candidates.length,0);
  f.bridge.dispose();
});
test('late controller permission must succeed each time; disable during native prepare cancels',async()=>{
  const f=fixture();let permits=0;
  globalThis.__testBackgroundGuard=payload=>{permits++;const request=JSON.parse(payload);f.bridge.resolveGuard(request.requestId,true);};
  await f.capture();assert.equal((await f.submit('one')).outcome,'accepted');assert.equal(permits,2);assert.deepEqual(f.sent,['native prediction']);
  const g=fixture();let release;g.context.send=async(t,text,id,admit)=>{await new Promise(r=>release=r);await admit();assert.fail('must cancel');};
  globalThis.__testBackgroundGuard=payload=>g.bridge.resolveGuard(JSON.parse(payload).requestId,true);
  await g.capture();const pending=g.submit('two');for(let n=0;n<100&&!release;n++)await new Promise(r=>setTimeout(r,2));g.bridge.configure({...policy,revision:2,enabled:false});release();assert.equal((await pending).outcome,'unconfirmed');
  f.bridge.dispose();g.bridge.dispose();delete globalThis.__testBackgroundGuard;
});
test('foreign draft or disconnected controller denies final native admission even before lease expiry',async()=>{
  for(const foreignDraft of [true,false]){
    const f=fixture();let count=0;
    globalThis.__testBackgroundGuard=payload=>{const r=JSON.parse(payload);count++;f.bridge.resolveGuard(r.requestId,count===1||!foreignDraft&&false);};
    await f.capture();const result=await f.submit('late');assert.equal(result.outcome,'unconfirmed');assert.deepEqual(f.sent,[]);assert.equal(count,2);f.bridge.dispose();
  }
  delete globalThis.__testBackgroundGuard;
});
test('native validation accepts only source completion plus its own optimistic turn and preserves settings',async()=>{
  let draft=false,own='ours';const rootToken={id:'root'},routeToken={id:'route'},composerToken={id:'composer'},root={token:rootToken,retainedScopeEntries:new Map()},route={token:routeToken,parent:root,key:'other-route',retainedScopeEntries:new Map()},node={token:composerToken,parent:route,key:'mapped',retainedScopeEntries:new Map(),attachment:false};root.retainedScopeEntries.set(routeToken,new Map([['other-route',{node:route}]]));route.retainedScopeEntries.set(composerToken,new Map([['mapped',{node}]]));const scope={node:root,chain:new Map([[rootToken.id,root]])};const client={
    getCachedConversationMetadata:async()=>({streamRole:{role:'owner'}}),getFollowUpContext:async()=>({resumeState:'resumed'}),
    getLoadedConversationHistory:async()=>({turns:[{turnId:'source',status:'completed',params:{}},{turnId:null,status:'inProgress',params:{clientUserMessageId:own}}]}),
    getThreadExecutionState:async()=>({inProgress:true,activeTurnId:null}),isConversationArchiving:async()=>false,
    startTurnWithOutcome:async(id,operation)=>{assert.equal(id,'thread');assert.equal(operation.context.inheritThreadSettings,true);assert.equal(operation.request.model,undefined);assert.equal(operation.request.approvalPolicy,undefined);assert.equal(operation.request.clientUserMessageId,'ours');return 'accepted';},
  };
  const c=createNativeSuggestionContext(scope,'local',client,()=>true,{drafts:{lD:()=>draft,rD:s=>s.node.attachment},identities:{JJ:()=> 'mapped',s8:()=> 'local:thread'},composer:{PR:composerToken},identity:()=>['account','user',1],wrap:(token,chain,node)=>{assert.equal(chain.get('route'),route);return {node};}});
  assert.equal(await c.validate(target,'ours'),true);own='other';assert.equal(await c.validate(target,'ours'),false);own='ours';draft=true;assert.equal(await c.validate(target,'ours'),false);draft=false;node.attachment=true;assert.equal(c.probe(target),false);node.attachment=false;assert.equal(c.probe(target),true);
  assert.equal(await c.send(target,'native prediction','ours',async()=>{}),'accepted');
});
test('reviewed original host composes sidebar and background capture inside native guarded cache branch',async ctx=>{
  let archive;try{archive=await openAsar('/Applications/ChatGPT.app');}catch(error){if(error.code==='ENOENT'){ctx.skip();return;}throw error;}
  try{
    const source=await archive.read(archive.entries.find(e=>e.path===reviewedBackgroundResource.path));
    const sidebar=await adaptSidebar(source,{host:true,resourcePath:reviewedBackgroundResource.path});assert.equal(sidebar.supported,true);
    const result=adaptBackgroundSuggestions(source,sidebar.source);assert.equal(result.supported,true);
    const {parse}=await parser();parse(result.source,{ecmaVersion:'latest',sourceType:'module'});
    assert.ok(result.source.includes('&&('+'e.queryClient.setQueryData((0,t_.pv)(u,d,l),f),globalThis.__codexPlusBackgroundSuggestions.capture'));
    assert.ok(result.source.includes('globalThis.__codexPlusProjectOrder.sort('));assert.equal(adaptBackgroundSuggestions(source+'\n').supported,false);
  }finally{await archive.close();}
});


test('sensitive review is independent of short dispatch lifetime and one approval permits one operation',async()=>{
  const f=fixture();await f.capture('给联系人发微信');
  assert.equal(f.bridge.inspect().candidates.length,0);
  let [review]=f.bridge.reviews();assert.equal(review.canApprove,true);
  f.setClock(90000);f.bridge.configure(policy);assert.equal(f.bridge.reviews().length,1);
  assert.equal(await f.bridge.decide({...review,action:'approve'}),true);
  globalThis.__testBackgroundGuard=payload=>f.bridge.resolveGuard(JSON.parse(payload).requestId,true);
  const first=f.submit('one');assert.equal((await f.submit('two')).outcome,'rejected');
  assert.equal((await first).outcome,'accepted');assert.equal(f.sent.length,1);
  assert.equal((await f.bridge.submit({key,operation:'three',token:review.id,reviewId:review.snapshotId})).outcome,'rejected');
  f.bridge.dispose();delete globalThis.__testBackgroundGuard;
});
test('review failures, missing history and uncertain scope cannot be approved or consume an attempt',async()=>{
  for(const failure of ['model','history','uncertain']){
    const f=fixture();if(failure==='model')f.context.review=async()=>{throw Error('offline');};
    if(failure==='history')f.context.snapshot=async()=>({history:{isComplete:false}});
    if(failure==='uncertain')f.context.review=async()=>({decision:'uncertain',contextSufficient:false,action:'unknown',target:'unknown',scope:'unknown'});
    await f.capture();const [review]=f.bridge.reviews();assert.equal(review.canApprove,false);
    assert.equal(await f.bridge.decide({...review,action:'approve'}),false);
    const coordinator=new SuggestionCoordinator({persist:async()=>assert.fail('must not claim unreviewed suggestion')});coordinator.configure(true);
    await coordinator.tick([{id:'page',snapshot:f.bridge.inspect()}],{probe:async()=>true,submit:async()=>assert.fail('no send')});
    assert.equal(await f.bridge.decide({...review,action:'reject'}),true);assert.deepEqual(f.bridge.reviews(),[]);f.bridge.dispose();
  }
});
test('source, account or permission changes revoke approval and no rejected candidate resurrects',async()=>{
  for(const field of ['sourceInput','principal','permissions']){
    const f=fixture();await f.capture('发邮件');const [r]=f.bridge.reviews();const base=await f.context.snapshot();
    f.context.snapshot=async()=>({...base,[field]:['changed']});
    assert.equal(await f.bridge.decide({...r,action:'approve'}),false);assert.deepEqual(f.bridge.inspect().candidates,[]);f.bridge.dispose();
  }
});
test('sensitive task risk survives a later indirect continue even if classifier calls it low risk',async()=>{
  const f=fixture();await f.capture('付款');const [first]=f.bridge.reviews();await f.bridge.decide({...first,action:'reject'});
  await f.capture('继续',{...target,latestTurnId:'next'});assert.equal(f.bridge.inspect().candidates.length,0);assert.equal(f.bridge.reviews().length,1);
  assert.match(f.bridge.reviews()[0].reason,/此任务涉及敏感/);f.bridge.dispose();
});
test('review snapshot changes during native preparation revoke late admission',async()=>{
  const f=fixture();await f.capture();let permits=0;
  globalThis.__testBackgroundGuard=payload=>{permits++;f.bridge.resolveGuard(JSON.parse(payload).requestId,true);};
  f.context.send=async(t,text,id,admit)=>{const base=await f.context.snapshot();f.context.snapshot=async()=>({...base,permissions:{mode:'full'}});await admit();assert.fail('changed permission cannot send');};
  assert.equal((await f.submit('one')).outcome,'unconfirmed');assert.equal(permits,1);assert.deepEqual(f.sent,[]);f.bridge.dispose();delete globalThis.__testBackgroundGuard;
});
test('semantic response schema, stale source and keyword-free indirection default to review',()=>{
  const p=createSuggestionReviewPolicy(),good={decision:'low-risk',contextSufficient:true,action:'分析',target:'代码',scope:'只读'};
  assert.deepEqual(p.parse({sourceTurnId:'source',text:JSON.stringify(good)},'source'),good);
  for(const response of [{sourceTurnId:'other',text:JSON.stringify(good)},{sourceTurnId:'source',text:'```json {} ```'},{sourceTurnId:'source',text:JSON.stringify({...good,extra:true})},{sourceTurnId:'source',text:JSON.stringify({...good,decision:'allow'})}])assert.throws(()=>p.parse(response,'source'));
  assert.equal(p.reasonFor('继续'),null);assert.match(p.prompt('继续'),/unresolved sensitive work/);assert.match(p.prompt('继续'),/not user authorization/);
});

test('native snapshot hydrates a closed task without navigation and detects incomplete history',async()=>{
  const root={token:{id:'root'},retainedScopeEntries:new Map()},calls=[];
  let loaded=false,draft=false;
  const client={
    ensureConversationFirstPage:async id=>{calls.push(['first',id]);loaded=true;return true;},
    ensureConversationHistoryLoaded:async(id,parents,options)=>calls.push(['full',id,options.force]),
    getCachedConversationMetadata:async()=>({streamRole:{role:'owner'}}),
    getFollowUpContext:async()=>({resumeState:'resumed',mode:'local'}),
    getLoadedConversationHistory:async()=>loaded?{title:'background',isComplete:true,turns:[{turnId:'source',status:'completed',params:{input:[{type:'text',text:'只分析代码'}]}}]}:null,
    getCurrentPermissions:async()=>({mode:'readOnly'}),getTurnSandboxPolicy:async()=>({type:'readOnly'}),
    getThreadExecutionState:async()=>({inProgress:false,activeTurnId:null}),isConversationArchiving:async()=>false,
  };
  const c=createNativeSuggestionContext({node:root,chain:new Map()},'local',client,()=>true,{drafts:{lD:()=>draft},identities:{JJ:()=> 'mapped',s8:()=> 'alias'},composer:{PR:{}},wrap:()=>{},identity:()=>['account','user',1]});
  const snapshot=await c.snapshot(target,true);assert.equal(snapshot.history.isComplete,true);
  assert.deepEqual(calls,[['first','thread'],['full','thread',true]]);
  assert.equal(snapshot.principal[0],'account');assert.equal(snapshot.sourceInput[0].text,'只分析代码');
  await c.snapshot(target);assert.equal(calls.length,2);
  draft=true;
  assert.equal(await c.validate(target),false);
  assert.equal(await c.validateReadOnly(target),true);
  assert.equal((await c.snapshot(target)).history.isComplete,true);
});
test('rejected, disabled and expired reviews cannot be approved later',async()=>{
  for(const action of ['reject','disable','expire']){
    const f=fixture();await f.capture('发邮件');const [r]=f.bridge.reviews();
    if(action==='reject')await f.bridge.decide({...r,action:'reject'});
    if(action==='disable')f.bridge.configure({...policy,enabled:false,revision:2});
    if(action==='expire'){f.setClock(1000000);f.bridge.configure(policy);}
    assert.equal(await f.bridge.decide({...r,action:'approve'}),false);assert.equal(f.sent.length,0);f.bridge.dispose();
  }
});

test('known sensitive scope survives failed hydration or inference before an indirect next turn',async()=>{
  for(const failure of ['snapshot','review']){
    const f=fixture(),original=f.context[failure];
    f.context[failure]=async()=>{throw Error('unavailable');};
    await f.capture('付款');assert.equal(f.bridge.reviews()[0].canApprove,false);
    f.context[failure]=original;
    await f.capture('继续',{...target,latestTurnId:'next'});
    assert.equal(f.bridge.inspect().candidates.length,0);assert.equal(f.bridge.reviews().length,1);
    assert.match(f.bridge.reviews()[0].reason,/此任务涉及敏感/);f.bridge.dispose();
  }
});

test('upgrade leaves old window drafts readable but never leases or submits through its unreviewed bridge',async()=>{
  const {policyForBackgroundPage,reviewedBackgroundPages}=await import('../Sources/CodexPlus/Resources/suggestion-review.mjs');
  assert.equal(policyForBackgroundPage(policy,2).enabled,false);
  assert.equal(policyForBackgroundPage(policy,5).enabled,true);
  assert.equal(policyForBackgroundPage({...policy,enabled:false},5).enabled,false);
  const old={id:'old',snapshot:{protocol:2,registered:1,candidates:[{key:'unsafe',target}]}};
  const fresh={id:'new',snapshot:{protocol:5,registered:1,candidates:[]}};
  const mixed=reviewedBackgroundPages([old,fresh]);assert.equal(mixed.pageReady,true);assert.equal(mixed.legacyPages,1);assert.deepEqual(mixed.ready,[fresh]);
  assert.equal(reviewedBackgroundPages([old]).pageReady,false);
  assert.deepEqual(reviewedBackgroundPages([fresh,{snapshot:{protocol:6,registered:1}}]).ready,[]);
  assert.equal(reviewedBackgroundPages([fresh,{snapshot:{}}]).pageReady,false);
  const c=new SuggestionCoordinator({persist:async()=>assert.fail('legacy candidate must not be claimed')});c.configure(true);
  await c.tick(mixed.ready,{probe:async()=>true,submit:async()=>assert.fail('legacy bridge cannot send')});
});


test('page reconnect refuses pending input, files, dialogs and unfinished loading',async()=>{
 const {canReconnectPage}=await import('../Sources/CodexPlus/Resources/suggestion-review.mjs');
 const blank={ready:true,editorLengths:[0,0],attachments:0,dialogs:0};assert.equal(canReconnectPage(blank),true);
 for(const changed of [{ready:false},{editorLengths:[0,1]},{attachments:1},{dialogs:1},{editorLengths:null}])assert.equal(canReconnectPage({...blank,...changed}),false);
});

test('reconnect input invalidation survives type-and-clear and final same-task check precedes reload',async()=>{
 const {createReconnectGuard,canReconnectPage}=await import('../Sources/CodexPlus/Resources/suggestion-review.mjs');
 const events=new Map();let text=0,reloads=0;
 const document={addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)};
 const inspect=()=>({ready:true,editorLengths:[text],attachments:0,dialogs:0});
 const guard=createReconnectGuard('one',inspect,canReconnectPage,{document,reload:()=>reloads++});
 assert.equal(guard.check().safe,true);text=1;events.get('beforeinput')({isTrusted:true});text=0;
 assert.equal(guard.reload('one'),false);assert.equal(reloads,0);guard.dispose();assert.equal(events.size,0);
 const fresh=createReconnectGuard('two',inspect,canReconnectPage,{document,reload:()=>reloads++});
 assert.equal(fresh.reload('other'),false);assert.equal(fresh.reload('two'),true);assert.equal(reloads,1);assert.equal(fresh.reload('two'),false);assert.equal(events.size,0);
});

test('explicit acceptance scope never reviews or emits candidates from unrelated production threads',async()=>{
 const f=fixture();f.bridge.configure({...policy,acceptanceThread:'allowed-test'});
 await f.capture();assert.equal(f.bridge.inspect().review.captured,0);assert.deepEqual(f.bridge.reviews(),[]);
 await f.capture('只分析测试结果',{...target,threadId:'allowed-test'});
 assert.equal(f.bridge.inspect().review.captured,1);assert.equal(f.bridge.inspect().candidates[0].target.threadId,'allowed-test');f.bridge.dispose();
});

test('explicit empty or malformed acceptance scope cannot become an unrestricted controller',async()=>{
 const {normalizeAcceptanceThread}=await import('../Sources/CodexPlus/Resources/suggestion-review.mjs');
 assert.equal(normalizeAcceptanceThread(undefined),undefined);
 assert.equal(normalizeAcceptanceThread('A1111111-2222-4333-8444-555555555555'),'a1111111-2222-4333-8444-555555555555');
 for(const value of ['',null,'bad','--settings'])assert.throws(()=>normalizeAcceptanceThread(value));
});
