import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SuggestionCoordinator,createBackgroundSuggestionBridge,createNativeSuggestionContext,adaptBackgroundSuggestions,reviewedBackgroundResource} from '../Sources/CodexPlus/Resources/suggestion-auto-send.mjs';
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
  const bridge=createBackgroundSuggestionBridge('__testBackgroundGuard',{now:()=>clock});
  const client={},context={hostId:'local',client,probe:()=>blank,keys:()=>['mapped','local:thread'],validate:async()=>current,send:async(t,text,id,admit)=>{await admit();sent.push(text);return 'accepted';}};
  bridge.register(context);bridge.configure(policy);
  const capture=()=>bridge.capture(client,target,{sourceTurnId:'source',text:'native prediction'},()=>current);
  return {bridge,context,sent,capture,setClock:n=>clock=n,setCurrent:n=>current=n,setBlank:n=>blank=n};
}
test('only newly generated live predictions are admitted; expiry, source and generation gates',()=>{
  const f=fixture();f.capture();assert.equal(f.bridge.inspect().candidates.length,1);
  f.bridge.configure({...policy,revision:2});assert.equal(f.bridge.inspect().candidates.length,0);
  f.capture();f.setCurrent(false);assert.equal(f.bridge.inspect().candidates.length,0);
  f.setCurrent(true);f.setClock(7000);f.capture();assert.equal(f.bridge.inspect().candidates.length,0);
  f.bridge.dispose();
});
test('late controller permission must succeed each time; disable during native prepare cancels',async()=>{
  const f=fixture();let permits=0;
  globalThis.__testBackgroundGuard=payload=>{permits++;const request=JSON.parse(payload);f.bridge.resolveGuard(request.requestId,true);};
  f.capture();assert.equal((await f.bridge.submit({key,operation:'one'})).outcome,'accepted');assert.equal(permits,2);assert.deepEqual(f.sent,['native prediction']);
  const g=fixture();let release;g.context.send=async(t,text,id,admit)=>{await new Promise(r=>release=r);await admit();assert.fail('must cancel');};
  globalThis.__testBackgroundGuard=payload=>g.bridge.resolveGuard(JSON.parse(payload).requestId,true);
  g.capture();const pending=g.bridge.submit({key,operation:'two'});await new Promise(setImmediate);g.bridge.configure({...policy,revision:2,enabled:false});release();assert.equal((await pending).outcome,'unconfirmed');
  f.bridge.dispose();g.bridge.dispose();delete globalThis.__testBackgroundGuard;
});
test('foreign draft or disconnected controller denies final native admission even before lease expiry',async()=>{
  for(const foreignDraft of [true,false]){
    const f=fixture();let count=0;
    globalThis.__testBackgroundGuard=payload=>{const r=JSON.parse(payload);count++;f.bridge.resolveGuard(r.requestId,count===1||!foreignDraft&&false);};
    f.capture();const result=await f.bridge.submit({key,operation:'late'});assert.equal(result.outcome,'unconfirmed');assert.deepEqual(f.sent,[]);assert.equal(count,2);f.bridge.dispose();
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
  const c=createNativeSuggestionContext(scope,'local',client,()=>true,{drafts:{lD:()=>draft,rD:s=>s.node.attachment},identities:{JJ:()=> 'mapped',s8:()=> 'local:thread'},composer:{PR:composerToken},wrap:(token,chain,node)=>{assert.equal(chain.get('route'),route);return {node};}});
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
