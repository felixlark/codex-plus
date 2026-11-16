import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {parentIsAlive,verifyHost} from './launch-host.mjs';
import {parseArgs} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import readline from 'node:readline';
import {featureBinding,installFeatureEntry,validateNativeAction,reviewedFeatureResource,removeFeatureEntries} from './feature-entry.mjs';
import {createSnakeGame,openSnakeDialog} from './snake.mjs';
import {allocateWindowNumbers} from './window-number.mjs';
import {reviewedHumanRuntime,nativeWindowDefaults,preserveNativeBounds,preferredHumanNumbers,isHumanWindowURL} from './human-window.mjs';
import {CDP} from './cdp.mjs';
import {initializePageSession} from './page-session.mjs';
import {sidebarBinding,adaptSidebarLayout,resolveSidebarDisplay,sanitizeSidebarValues,SidebarProfiles,needsSidebarReconnect} from './sidebar-layout.mjs';
import {backgroundGuardBinding,reviewedSamplingResource,reviewedBackgroundDependency,adaptBackgroundSuggestions,SuggestionCoordinator} from './suggestion-auto-send.mjs';
import {policyForBackgroundPage,reviewedBackgroundPages,canReconnectPage,inspectReconnectSafety,createReconnectGuard,normalizeAcceptanceThread} from './suggestion-review.mjs';
import {OwnershipAuthority,OwnershipRequests} from './target-ownership.mjs';
import {loadAttemptLedger} from './attempt-ledger.mjs';

let adapterURL=new URL('./inspect-sidebar-model.mjs',import.meta.url);
try{await fs.access(adapterURL);}catch{adapterURL=new URL('../../../scripts/inspect-sidebar-model.mjs',import.meta.url);}
const {openAsar,adaptSidebar,adaptReloadRoute,reviewedHostResource,reviewedRouteResource}=await import(adapterURL.href);
const {values}=parseArgs({options:{app:{type:'string',default:'/Applications/ChatGPT.app'},profile:{type:'string'},state:{type:'string'},attach:{type:'boolean',default:false},'auto-send-suggestions':{type:'boolean',default:false},'suggestion-acceptance-thread':{type:'string'}}});
const acceptanceThread=normalizeAcceptanceThread(values['suggestion-acceptance-thread']);
const stateFile=values.state??path.join(os.homedir(),'Library/Application Support/codex-plus/enhancements/launcher/state.json');
await fs.mkdir(path.dirname(stateFile),{recursive:true,mode:0o700});
const controllerVersion='sha256:'+createHash('sha256').update(await fs.readFile(new URL(import.meta.url))).digest('hex');
let state={phase:'preparing',protocol:6,version:controllerVersion,controllerPID:process.pid,adapted:0,attached:0,resumed:0,errors:[],windowNumbers:{},humanTargets:{}};
let publishing=Promise.resolve();
function publish(){const data=JSON.stringify(state);publishing=publishing.then(async()=>{await fs.writeFile(stateFile+'.tmp',data,{mode:0o600});await fs.rename(stateFile+'.tmp',stateFile);process.stdout.write(data+'\n');});return publishing;}
let cdp;

const sessions=new Map();
const inFlight=new Set();
let stopping=false,quiesced=false;
const lifecycleOperations=new Set();
let monitorWork=Promise.resolve();
let startupWork;
function trackLifecycle(work){lifecycleOperations.add(work);void work.finally(()=>lifecycleOperations.delete(work)).catch(()=>{});return work;}
const connection=randomUUID(),parentPID=process.ppid,requests=new Map();
let featureSupported=false,suggestionSupported=false,sidebarSupported=false;
let displays=[];let humanNativeSupported=false;
const humanCreations=new Map();
let humanFrames=[];
async function createHumanWindow(nonce){
  if(stopping||quiesced||typeof nonce!=='string'||!/^[0-9a-f-]{36}$/i.test(nonce)||humanCreations.has(nonce))return;
  humanCreations.set(nonce,{phase:'creating'});
  try{
    const source=[...sessions].find(([,s])=>s.main);
    if(!source)throw Error('No native main renderer');
    const probe=await command(source[0],'Runtime.evaluate',{expression:'new URL(location.href).searchParams.get("initialRoute")',returnByValue:true});
    if(stopping||quiesced){humanCreations.delete(nonce);return;}
    const previous=probe.result.value;
    // Root + query is rejected by the host's route validator. The accepted
    // plugins route carries the token until the owned new target is navigated home.
    const route=(typeof previous==='string'&&/^\/local\//.test(previous)?previous.split(/[?#]/)[0]:'/plugins/installed')+'?codexPlusHumanWindow='+nonce;
    const result=await command(source[0],'Runtime.evaluate',{expression:`window.electronBridge.sendMessageFromView(${JSON.stringify({type:'open-in-new-window',path:route})})`,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails)throw Error('Native window request failed');
    humanCreations.set(nonce,{phase:'requested'});
  }catch(error){humanCreations.set(nonce,{phase:'failed',error:error.message});}
}
function humanMarker(value){try{const u=new URL(value);return u.searchParams.get('codexPlusHumanWindow')??new URL(u.searchParams.get('initialRoute')??'/','https://codex.invalid').searchParams.get('codexPlusHumanWindow');}catch{return null;}}
async function settleHumanCreations(){
  if(stopping||quiesced)return;
  if(![...humanCreations.values()].some(r=>r.phase==='requested'&&!r.preserved))return;
  const {targetInfos}=await cdp.call('Target.getTargets');if(stopping||quiesced)return;
  for(const [nonce,request] of humanCreations){
    if(request.phase!=='requested'||request.preserved)continue;
    const matching=targetInfos.filter(t=>t.type==='page'&&mainURL(t.url)&&humanMarker(t.url)===nonce);
    if(matching.length!==1)continue;
    const target=matching[0];
    const session=[...sessions].find(([,s])=>s.target===target.targetId);
    if(!session)continue;
    // Do not cancel the native window's initial intercepted module requests.
    // The nonce-bound page must finish bootstrapping before normalization.
    const ready=await command(session[0],'Runtime.evaluate',{expression:'({complete:document.readyState==="complete",enhanced:globalThis.__codexPlusFeatures?.status()?.phase==="active"})',returnByValue:true});
    if(!ready.result.value?.complete||featureSupported&&!ready.result.value.enhanced)continue;
    // Navigate only the nonce-bound, newly-created human window. Existing pages,
    // drafts and navigation are never used as a reload surface.
    const url=new URL('app://-/index.html');url.searchParams.set('initialRoute','/');url.searchParams.set('codexPlusHumanWindow',nonce);
    humanCreations.set(nonce,{phase:'created',target:target.targetId});session[1].human=true;
    if(stopping||quiesced)return;
    await command(session[0],'Page.navigate',{url:url.href});
  }
}


const sidebarProfiles=new SidebarProfiles(path.join(path.dirname(stateFile),'sidebar-layouts.json'),fs);
await sidebarProfiles.load();
let reviewDigest='';const reviewRequests=new Map();
const attemptFile=path.join(path.dirname(stateFile),'suggestion-attempts.json');
let attempts=[],attemptStoreReady=false;
const legacyAttemptFile=path.join(os.homedir(),'Library/Application Support/codex-plus/launcher/suggestion-attempts.json');
const suggestions=new SuggestionCoordinator({attempts,persist:async keys=>{if(!attemptStoreReady)throw Error('Attempt store unavailable');try{await fs.writeFile(attemptFile+'.tmp',JSON.stringify(keys),{mode:0o600});await fs.rename(attemptFile+'.tmp',attemptFile);}catch(error){attemptStoreReady=false;throw error;}}});
suggestions.configure(false);
const suggestionPolicy=()=>({connection,revision:suggestions.revision,enabled:suggestions.enabled&&suggestionSupported&&attemptStoreReady,...acceptanceThread?{acceptanceThread}:{}});
async function updateSuggestionPolicy(){const policy=suggestionPolicy();await Promise.allSettled([...sessions].filter(([,s])=>s.main).map(([id])=>command(id,'Runtime.evaluate',{expression:`(()=>{const bridge=globalThis.__codexPlusBackgroundSuggestions;bridge?.configure((${policyForBackgroundPage.toString()})(${JSON.stringify(policy)},bridge.protocol));})()`})));
}
function pageSet(){return JSON.stringify([...sessions].filter(([,s])=>s.main).map(([id,s])=>[id,s.frame,[...s.contexts.values()].filter(c=>c.auxData?.isDefault).map(c=>c.id)]));}
async function probeSuggestions(target){

  const generation=suggestions.revision,initial=pageSet(),ids=[...sessions].filter(([,s])=>s.main).map(([id])=>id);
  if(!ids.length)return false;
  const probe=async()=>Promise.all(ids.map(async id=>{const r=await command(id,'Runtime.evaluate',{expression:`globalThis.__codexPlusBackgroundSuggestions?.probe(${JSON.stringify(target)})`,returnByValue:true});return r.result.value;}));
  try{const first=await probe();if(first.some(p=>!p?.ok))return false;const last=await probe();return suggestions.enabled&&generation===suggestions.revision&&initial===pageSet()&&last.every((p,i)=>p?.ok&&p.inputRevision===first[i].inputRevision);}catch{return false;}
}
async function suggestionGuard(message){
  const session=sessions.get(message.sessionId),event=message.params,context=session?.contexts.get(event.executionContextId);
  if(stopping||quiesced||event.name!==backgroundGuardBinding||!session?.main||!context?.auxData?.isDefault||context.auxData.frameId!==session.frame)return;
  let request;try{request=JSON.parse(event.payload);}catch{return;}
  if(request.protocol!==5||typeof request.requestId!=='string'||request.requestId.length>100)return;
  const p=suggestions.pending;
  let ok=!!p&&message.sessionId===p.id&&request.operation===p.operation&&request.key===p.key&&request.reviewId===p.reviewId&&request.token===p.token&&request.connection===connection&&request.revision===p.revision&&suggestions.revision===p.revision&&suggestions.enabled;
  if(ok)ok=await probeSuggestions(p.target);
  ok=ok&&suggestions.pending===p&&suggestions.revision===p.revision&&suggestions.enabled&&!stopping;
  await command(message.sessionId,'Runtime.evaluate',{expression:`globalThis.__codexPlusBackgroundSuggestions?.resolveGuard(${JSON.stringify(request.requestId)},${ok})`,contextId:event.executionContextId});
}
async function reviewDecision(message){
  if(message.type!=='suggestion-review'||message.version!==1||!['approve','reject','retry'].includes(message.action))return;
  const request=reviewRequests.get(message.id);
  let ok=false;
  if(request&&request.snapshotId===message.snapshotId){
    reviewRequests.delete(message.id);
    const arg={id:message.id,snapshotId:message.snapshotId,action:message.action};
    try{
      const result=await command(request.session,'Runtime.evaluate',{expression:`globalThis.__codexPlusBackgroundSuggestions?.decide(${JSON.stringify(arg)})`,returnByValue:true,awaitPromise:true});
      ok=result.result.value===true;
    }catch{}
  }
  process.stdout.write(JSON.stringify({type:'suggestion-review-result',version:1,id:message.id,ok})+'\n');
}
let reconnecting=false;
async function reconnectEnhancements(){
  if(reconnecting||stopping||suggestions.enabled||suggestions.pending)return;
  reconnecting=true;let ok=false,reason='unavailable';const operation=randomUUID(),reloaded=new Set();
  const windowSet=()=>JSON.stringify([...sessions].filter(([,s])=>s.main).map(([id,s])=>[id,s.target]));
  const allIds=[...sessions].filter(([,s])=>s.main).map(([id])=>id),ids=[],before=windowSet();
  const evaluate=async(id,expression)=>{
    const result=await command(id,'Runtime.evaluate',{expression,returnByValue:true});
    if(result.exceptionDetails)throw Error('unavailable');return result.result.value;
  };
  try{
    if(!allIds.length)throw Error('unavailable');
    for(const id of allIds){const state=await evaluate(id,'({background:globalThis.__codexPlusBackgroundSuggestions?.inspect(),sidebar:globalThis.__codexPlusSidebarLayout?.snapshot(),order:globalThis.__codexPlusProjectOrder?.protocol})');if(needsSidebarReconnect(state.background,state.sidebar,sidebarSupported,state.order))ids.push(id);}
    for(const id of allIds)await evaluate(id,`(()=>{globalThis.__codexPlusReconnectGuard?.dispose();globalThis.__codexPlusReconnectGuard=(${createReconnectGuard.toString()})(${JSON.stringify(operation)},${inspectReconnectSafety.toString()},${canReconnectPage.toString()});return true;})()`);
    for(const id of ids){
      if(before!==windowSet()||stopping||suggestions.enabled)throw Error('state-changed');
      for(const remaining of allIds.filter(value=>!reloaded.has(value))){
        const state=await evaluate(remaining,'globalThis.__codexPlusReconnectGuard?.check()');
        if(state?.operation!==operation||!state.safe)throw Error('unsubmitted-content');
      }
      const started=await evaluate(id,`globalThis.__codexPlusReconnectGuard?.reload(${JSON.stringify(operation)})`);
      if(started!==true)throw Error('state-changed');reloaded.add(id);
    }
    // A navigation acknowledgement is not proof that the new hooks loaded.
    const deadline=Date.now()+30000;
    while(Date.now()<deadline){
      if(before!==windowSet()||stopping||suggestions.enabled)throw Error('state-changed');
      let ready=true;
      for(const id of allIds){try{const state=await evaluate(id,'({background:globalThis.__codexPlusBackgroundSuggestions?.inspect(),sidebar:globalThis.__codexPlusSidebarLayout?.snapshot(),order:globalThis.__codexPlusProjectOrder?.protocol})');if(needsSidebarReconnect(state.background,state.sidebar,sidebarSupported,state.order))ready=false;}catch{ready=false;}}
      if(ready){ok=true;reason='reconnected';break;}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!ok)reason='not-ready';
  }catch(error){reason=['unsubmitted-content','state-changed'].includes(error.message)?error.message:'unavailable';}
  finally{
    for(const id of allIds)await evaluate(id,`(()=>{const guard=globalThis.__codexPlusReconnectGuard;if(guard?.operation===${JSON.stringify(operation)}){guard.dispose();delete globalThis.__codexPlusReconnectGuard;}})()`).catch(()=>{});
    reconnecting=false;process.stdout.write(JSON.stringify({type:'enhancement-reconnect-result',version:1,ok,reason,reloaded:reloaded.size})+'\n');
  }
}

function suggestionSettings(line){try{const message=JSON.parse(line);if(message.type==='suggestion-settings'&&message.version===1&&typeof message.enabled==='boolean'){values['auto-send-suggestions']=message.enabled;suggestions.configure(message.enabled&&attemptStoreReady&&!!ownership.scope);void updateSuggestionPolicy();}}catch{}}

const featureSource=`if((${isHumanWindowURL.toString()})(location.href)){(${installFeatureEntry.toString()})(${JSON.stringify({connection,binding:featureBinding})},${createSnakeGame.toString()},${openSnakeDialog.toString()});}`;
const replies=readline.createInterface({input:process.stdin});
replies.on('close',()=>{ownershipRequests.close();void shutdown();});
replies.on('line',line=>{try{const m=JSON.parse(line);if(ownershipRequests.receive(m))return;if(m.type==='lifecycle'){void lifecycleCommand(m);return;}}catch{}if(quiesced||stopping)return;suggestionSettings(line);try{const reply=JSON.parse(line);if(reply.type==='sidebar-displays'&&reply.version===1&&Array.isArray(reply.displays)){displays=reply.displays;humanFrames=Array.isArray(reply.humanWindows)?reply.humanWindows:[];return;}if(reply.type==='create-human-window'){void trackLifecycle(createHumanWindow(reply.nonce));return;}if(reply.type==='reconnect-enhancements'&&reply.version===1){void reconnectEnhancements();return;}if(reply.type==='suggestion-review'){void reviewDecision(reply).catch(()=>{});return;}const request=requests.get(reply.requestId);if(reply.type!=='ui-result'||!request)return;requests.delete(reply.requestId);const current=sessions.get(request.session);if(!current?.contexts.has(request.context))return;void command(request.session,'Runtime.evaluate',{expression:`globalThis.__codexPlusFeatures?.ack(${JSON.stringify(request.pageID)},${reply.ok===true})`,contextId:request.context}).catch(()=>{});}catch{}});
function queueSidebar(id,event){
  const session=sessions.get(id);if(!session)return Promise.resolve();
  const task=(session.sidebarQueue??Promise.resolve()).catch(()=>{}).then(()=>syncSidebar(id,event));
  session.sidebarQueue=task;return task;
}
async function syncSidebar(id,event){
  const session=sessions.get(id);if(!sidebarSupported||stopping||!session?.main)return;
  if(event&&(!session.contexts.has(event.context)||session.contexts.get(event.context)?.auxData?.frameId!==session.frame))return;
  const result=await command(id,'Runtime.evaluate',{expression:'(()=>{const s=globalThis.__codexPlusSidebarLayout?.snapshot();return {sidebar:s,frame:{x:screenX,y:screenY,width:outerWidth,height:outerHeight}};})()',returnByValue:true});
  const current=result.result.value?.sidebar;
  if(current?.protocol!==1||!current.bound){session.sidebarStatus={phase:'page-reload-required'};return;}
  let change;
  if(event){
    if(current.pageId!==event.pageId)return;
    if(session.sidebarPage!==current.pageId){session.sidebarPage=current.pageId;session.sidebarSequence=0;}
    if(event.sequence<=session.sidebarSequence)return;
    session.sidebarSequence=event.sequence;change=event.change;
  }
  const display=resolveSidebarDisplay(result.result.value.frame,displays);
  const config={pageId:current.pageId,windowId:session.target,displayKey:display?.uuid??null,profile:display?sidebarProfiles.get(display.uuid):null,...change?{change}:{}};
  const response=await command(id,'Runtime.evaluate',{expression:`globalThis.__codexPlusSidebarLayout?.configure(${JSON.stringify(config)})`,returnByValue:true});
  const applied=response.result.value;
  if(!applied||sessions.get(id)!==session||stopping)return;
  if(change&&display)await sidebarProfiles.save(display.uuid,applied.values);
  session.sidebarStatus={phase:display?'active':'unknown-display',displayName:display?.name??null,windowStorageReady:applied.storageReady};
}
async function sidebarAction(message){
  const session=sessions.get(message.sessionId),event=message.params,context=session?.contexts.get(event.executionContextId);
  if(stopping||quiesced||event.name!==sidebarBinding||!session?.main||!context?.auxData?.isDefault||context.auxData.frameId!==session.frame)return;
  let value;try{value=JSON.parse(event.payload);}catch{return;}
  if(value.version!==1||typeof value.pageId!=='string'||!Number.isSafeInteger(value.sequence)||value.sequence<1||typeof value.change?.key!=='string'||!sanitizeSidebarValues({[value.change.key]:value.change.value}))return;
  await queueSidebar(message.sessionId,{...value,context:event.executionContextId});
}
function forgetRequests(session,context){for(const [id,r]of requests)if(r.session===session&&(context===undefined||r.context===context))requests.delete(id);}
async function nativeAction(message){
  const session=sessions.get(message.sessionId),event=message.params,context=session?.contexts.get(event.executionContextId);
  if(stopping||quiesced||event.name!==featureBinding||!context?.auxData?.isDefault||context.auxData.frameId!==session.frame||!session.main)return;
  let action;try{action=JSON.parse(event.payload);}catch{return;}
  if(!validateNativeAction(action))return;
  if([...requests.values()].some(r=>r.session===message.sessionId&&r.context===event.executionContextId&&r.pageID===action.requestId))return;
  const requestId=randomUUID();requests.set(requestId,{session:message.sessionId,context:event.executionContextId,pageID:action.requestId});
  process.stdout.write(JSON.stringify({type:'ui-action',version:1,action:'open-settings',requestId})+'\n');
}

const resources=[reviewedHostResource,reviewedRouteResource].map((resource,index)=>({...resource,kind:'project-order',adapt:index===0?source=>adaptSidebar(source,{host:true,resourcePath:resource.path}):adaptReloadRoute,url:'app://-/'+resource.path.replace(/^webview\//,'')}));
async function samplingSupported(archive){
  const entry=archive.entries.find(e=>e.path===reviewedSamplingResource.path);
  if(!entry||createHash('sha256').update(await archive.read(entry)).digest('hex')!==reviewedSamplingResource.sha256)return false;
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(path.join(values.app,reviewedSamplingResource.binaryPath)))hash.update(chunk);
  return hash.digest('hex')===reviewedSamplingResource.binarySHA256;
}
function mainURL(value){return isHumanWindowURL(value);}
async function refreshWindowNumbers(){
  const {targetInfos}=await cdp.call('Target.getTargets');
  const targets=targetInfos.filter(t=>t.type==='page'&&t.url.startsWith('app://-/index.html')&&mainURL(t.url)).map(t=>t.targetId);
  const pages=[];
  for(const [id,s]of sessions)if(s.main&&targets.includes(s.target)){
    const r=await command(id,'Runtime.evaluate',{expression:'({x:screenX,y:screenY,width:outerWidth,height:outerHeight})',returnByValue:true});pages.push({target:s.target,frame:r.result.value});
  }
  const preferred=preferredHumanNumbers(pages,humanFrames,state.humanTargets);
  const bindingChanged=JSON.stringify(preferred)!==JSON.stringify(state.humanTargets);
  state.humanTargets=preferred;
  const numbers=allocateWindowNumbers(targets,state.windowNumbers,preferred,humanFrames.length?[1,2]:[]);
  if(bindingChanged||Object.keys(numbers).length!==Object.keys(state.windowNumbers).length||Object.entries(numbers).some(([target,number])=>state.windowNumbers[target]!==number)){state.windowNumbers=numbers;await publish();}
}
async function command(id,method,params={}){
  const session=sessions.get(id);if(!session||stopping)throw Error('Session unavailable');
  const frame=session.frame;
  let world;
  if(method==='Runtime.evaluate'){
    world=params.contextId===undefined?[...session.contexts.values()].find(c=>c.auxData?.isDefault&&c.auxData.frameId===frame):session.contexts.get(params.contextId);
    if(!session.main||!world?.auxData?.isDefault||world.auxData.frameId!==frame)throw Error('Document context unavailable');
    params={...params,contextId:world.id};
  }
  const current=()=>sessions.get(id)===session&&session.frame===frame&&(!world||(session.main&&session.contexts.get(world.id)===world));
  return ownership.run(session.target,frame,async()=>{
    if(!current())throw Error('Session or document changed');
    const result=await cdp.call(method,params,id);
    if(!current())throw Error('Session or document changed');return result;
  });
}
const ownershipRequests=new OwnershipRequests(message=>process.stdout.write(JSON.stringify(message)+'\n'));
const ownership=new OwnershipAuthority(()=>ownershipRequests.read(),async()=>{
  suggestions.configure(false);reviewRequests.clear();requests.clear();attemptStoreReady=false;
  await Promise.allSettled([...sessions].map(([id,session])=>disposeSession(id,session)));
});
async function disposeSession(id,session){
  sessions.delete(id);
  if(!cdp?.open)return;
  // This is bounded disposal of our own previously installed hooks in their
  // exact old world. It cannot execute against a replacement document.
  const context=[...session.contexts.values()].find(c=>c.auxData?.isDefault&&c.auxData.frameId===session.frame);
  if(context)await cdp.call('Runtime.evaluate',{contextId:context.id,expression:'globalThis.__codexPlusBackgroundSuggestions?.dispose();globalThis.__codexPlusFeatures?.dispose();globalThis.__codexPlusSidebarLayout?.suspend()'},id).catch(()=>{});
  for(const name of [backgroundGuardBinding,featureBinding,sidebarBinding])await cdp.call('Runtime.removeBinding',{name},id).catch(()=>{});
  await cdp.call('Fetch.disable',{},id).catch(()=>{});
  await cdp.call('Target.detachFromTarget',{sessionId:id}).catch(()=>{});
}
async function loadAttempts(){
  try{const keys=await loadAttemptLedger(fs,attemptFile,legacyAttemptFile);for(const key of keys)suggestions.attempts.add(key);attemptStoreReady=true;}
  catch{attemptStoreReady=false;}
  suggestions.configure(values['auto-send-suggestions']&&attemptStoreReady&&!!ownership.scope);
}

function assertOwner(pid,endpoint){verifyHost({app:values.app,pid,endpoint});}
async function main(){
  execFileSync('/usr/bin/codesign',['--verify','--deep','--strict','-R=anchor apple generic and identifier "com.openai.codex" and certificate leaf[subject.OU] = "2DC432GLL2"',values.app],{stdio:'pipe'});
  const archive=await openAsar(values.app);
  try{
    const runtimeEntry=archive.entries.find(e=>e.path===reviewedHumanRuntime.path);humanNativeSupported=!!runtimeEntry&&createHash('sha256').update(await archive.read(runtimeEntry)).digest('hex')===reviewedHumanRuntime.sha256;state.nativeWindowDefaults={phase:humanNativeSupported?'waiting-for-human-windows':'unsupported-host'};
    const footer=archive.entries.find(e=>e.path===reviewedFeatureResource.path);
    featureSupported=!!footer&&createHash('sha256').update(await archive.read(footer)).digest('hex')===reviewedFeatureResource.sha256;
    state.pageEntries={supported:featureSupported,phase:featureSupported?'waiting':'unsupported-host'};
    state.projectOrder={supported:true,phase:'waiting'};
    for(const resource of resources){
      try{
        const entry=archive.entries.find(e=>e.path===resource.path);if(!entry)throw new Error('Unsupported resource');
        const source=await archive.read(entry);
        let adaptation=await resource.adapt(source);
        if(resource.path===reviewedHostResource.path&&adaptation.supported){
          const dependency=archive.entries.find(e=>e.path===reviewedBackgroundDependency.path);
          if(dependency&&createHash('sha256').update(await archive.read(dependency)).digest('hex')===reviewedBackgroundDependency.sha256&&await samplingSupported(archive)){const background=adaptBackgroundSuggestions(source,adaptation.source);suggestionSupported=background.supported;if(background.supported)adaptation=background;}
        }
        if(!adaptation.supported)throw new Error('Unsupported adapter: '+adaptation.reason);
        if(resource.path===reviewedHostResource.path){const sidebar=adaptSidebarLayout(source,adaptation.source);sidebarSupported=sidebar.supported;if(sidebar.supported)adaptation=sidebar;else state.sidebarLayout={supported:false,phase:'unsupported-host',reason:sidebar.reason};}
        resource.replacement=Buffer.from(adaptation.source).toString('base64');
      }catch(error){state.projectOrder={supported:false,phase:'unsupported-host',reason:error.message};}
    }
    if(!state.projectOrder.supported){resources.length=0;suggestionSupported=false;sidebarSupported=false;state.sidebarLayout={supported:false,phase:'unsupported-host'};}
    state.suggestionAutoSend={...suggestions.status(),supported:suggestionSupported,storageReady:attemptStoreReady};
  }finally{await archive.close();}

  await publish();
  let inspecting=false;
  const monitor=setInterval(async()=>{
    if(process.ppid!==parentPID||!parentIsAlive(parentPID)){clearInterval(monitor);void shutdown();return;}
    if(inspecting||stopping||quiesced)return;inspecting=true;
    let done;monitorWork=new Promise(resolve=>{done=resolve;});
    try{
      await synchronizeOwnership();
      if(!cdp?.open||!ownership.scope)return;
      await trackLifecycle(settleHumanCreations());
      if(state.projectOrder.supported){
        const pages=[];
        for(const [id,s]of sessions)if(s.main){const r=await command(id,'Runtime.evaluate',{expression:'globalThis.__codexPlusProjectOrder?.protocol',returnByValue:true});pages.push({protocol:r.result.value??null});}
        const status={supported:true,protocol:10,phase:pages.length&&pages.every(p=>p.protocol===10)?'active':pages.some(p=>p.protocol!==null)?'page-reload-required':'waiting',pages};
        if(JSON.stringify(status)!==JSON.stringify(state.projectOrder)){state.projectOrder=status;await publish();}
      }
      if(sidebarSupported){
        for(const [id,s]of sessions)if(s.main)await queueSidebar(id);
        const pages=[...sessions.values()].filter(s=>s.main).map(s=>s.sidebarStatus??{phase:'waiting'});
        const status={supported:true,phase:pages.length&&pages.every(p=>p.phase==='active')?'active':'waiting',storageReady:sidebarProfiles.storageReady,profiles:Object.keys(sidebarProfiles.profiles).length,pages};
        if(JSON.stringify(status)!==JSON.stringify(state.sidebarLayout)){state.sidebarLayout=status;await publish();}
      }
      if(featureSupported){await refreshWindowNumbers();const pages=[];for(const [id,session]of sessions)if(session.main){const number=state.windowNumbers[session.target];const r=await command(id,'Runtime.evaluate',{expression:`globalThis.__codexPlusFeatures?.setWindowNumber(${JSON.stringify(number)??'null'});globalThis.__codexPlusFeatures?.status()`,returnByValue:true});if(r.result.value)pages.push(r.result.value);}
        const entries={supported:true,phase:pages.some(p=>p.phase==='active')?'active':'waiting-for-sidebar',pages};
        if(JSON.stringify(entries)!==JSON.stringify(state.pageEntries)){state.pageEntries=entries;await publish();}}
      if(suggestionSupported){
        const pages=[];for(const [id,session]of sessions)if(session.main){const r=await command(id,'Runtime.evaluate',{expression:'globalThis.__codexPlusBackgroundSuggestions?.inspect()',returnByValue:true});pages.push({id,snapshot:r.result.value??{protocol:null,registered:0,candidates:[]}});}
        const reviewItems=[];reviewRequests.clear();
        for(const {id}of pages){const result=await command(id,'Runtime.evaluate',{expression:'globalThis.__codexPlusBackgroundSuggestions?.reviews()',returnByValue:true});for(const item of result.result.value??[]){reviewRequests.set(item.id,{session:id,snapshotId:item.snapshotId});reviewItems.push(item);}}
        const digest=JSON.stringify(reviewItems);if(digest!==reviewDigest){reviewDigest=digest;process.stdout.write(JSON.stringify({type:'suggestion-reviews',version:1,items:reviewItems})+'\n');}

        const readiness=reviewedBackgroundPages(pages);
        await suggestions.tick(readiness.ready.map(page=>({...page,snapshot:{...page.snapshot,candidates:(page.snapshot.candidates??[]).filter(c=>!acceptanceThread||c.target.threadId===acceptanceThread)}})),{probe:probeSuggestions,submit:async(id,arg)=>{
          if(stopping||quiesced||!cdp.open)throw Error('Controller disconnected');
          const r=await command(id,'Runtime.evaluate',{expression:`globalThis.__codexPlusBackgroundSuggestions?.submit(${JSON.stringify(arg)})`,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('Suggestion action failed');return r.result.value;
        }});
        const snapshot={...suggestions.status(),supported:true,storageReady:attemptStoreReady,mode:'background-native-reviewed',review:{pending:pages.reduce((n,p)=>n+(p.snapshot.review?.pending??0),0),reviewing:pages.reduce((n,p)=>n+(p.snapshot.review?.reviewing??0),0),captured:pages.reduce((n,p)=>n+(p.snapshot.review?.captured??0),0),reasons:[...new Set(pages.map(p=>p.snapshot.review?.reason).filter(Boolean))]},pageReady:readiness.pageReady,legacyPages:readiness.legacyPages};
        if(!snapshot.pageReady)snapshot.reason='page-reload-required';
        if(JSON.stringify(snapshot)!==JSON.stringify(state.suggestionAutoSend)){state.suggestionAutoSend=snapshot;await publish();}
      }

    }catch{}finally{inspecting=false;done();}
  },1000);
}
async function synchronizeOwnership(){
  const scope=await ownership.refresh();
  if(!scope){state.phase='waiting-for-target-ownership';await publish();return;}
  if(cdp&&(!cdp.open||state.pid!==scope.host.pid||state.endpoint!==scope.host.endpoint)){
    cdp.close();cdp=null;
  }
  if(!cdp){
    assertOwner(scope.host.pid,scope.host.endpoint);
    state.pid=scope.host.pid;state.endpoint=scope.host.endpoint;
    cdp=await CDP.connect(scope.host.endpoint);
    installTransportEvents();
  }
  if(!attemptStoreReady)await loadAttempts();
  const {targetInfos}=await cdp.call('Target.getTargets');
  for(const target of targetInfos){
    if(stopping||quiesced)return;
    if(target.type!=='page'||!mainURL(target.url)||!ownership.current(target.targetId)||[...sessions.values()].some(s=>s.target===target.targetId))continue;
    await ownership.run(target.targetId,undefined,async ticket=>{
      const {sessionId}=await cdp.call('Target.attachToTarget',{targetId:target.targetId,flatten:true});
      if(!ownership.valid(ticket)){await cdp.call('Target.detachFromTarget',{sessionId});return;}
      await attach({sessionId,targetInfo:target});
    });
  }
  state.phase='active';await publish();
}
function installTransportEvents(){
  cdp.listeners.add(message=>{
    const session=sessions.get(message.sessionId);
    if(message.method==='Target.detachedFromTarget'){forgetRequests(message.params.sessionId);sessions.delete(message.params.sessionId);}
    if(message.method==='Runtime.executionContextCreated'){session?.contexts.set(message.params.context.id,message.params.context);if(session&&message.params.context.auxData?.isDefault){session.main=false;void refreshDocument(message.sessionId).catch(()=>{});}}
    if(message.method==='Runtime.executionContextDestroyed'){session?.contexts.delete(message.params.executionContextId);forgetRequests(message.sessionId,message.params.executionContextId);}
    if(message.method==='Runtime.executionContextsCleared'){session?.contexts.clear();forgetRequests(message.sessionId);}
    if(message.method==='Runtime.bindingCalled'){void nativeAction(message).catch(fail);void suggestionGuard(message).catch(()=>{});void sidebarAction(message).catch(()=>{});}
    if(message.method==='Page.frameNavigated'&&!message.params.frame.parentId&&session){session.frame=message.params.frame.id;session.main=false;}
    if(message.method==='Fetch.requestPaused'){const work=response(message.sessionId,message.params).catch(fail);inFlight.add(work);void work.finally(()=>inFlight.delete(work));}
    if(message.method==='connectionClosed'&&!stopping)hostDisconnected();
  });
}
async function refreshDocument(id){
  const session=sessions.get(id);if(!session||stopping||quiesced)return;
  const {frameTree}=await command(id,'Page.getFrameTree');
  if(!mainURL(frameTree.frame.url)||!ownership.current(session.target,frameTree.frame.id))return;
  session.frame=frameTree.frame.id;session.main=true;
  if(featureSupported)await command(id,'Runtime.evaluate',{expression:featureSource});
}
async function attach({sessionId,targetInfo}){
  const claim=ownership.current(targetInfo.targetId);if(!claim){await cdp.call('Target.detachFromTarget',{sessionId});return;}
  const session={target:targetInfo.targetId,frame:claim.frameId,contexts:new Map(),main:false,human:true};sessions.set(sessionId,session);state.attached++;
  try{
    await initializePageSession((method,params)=>command(sessionId,method,params),{
      patterns:resources.map(resource=>({urlPattern:resource.url,resourceType:'Script',requestStage:'Response'})),
      bindings:[...suggestionSupported?[backgroundGuardBinding]:[],...sidebarSupported?[sidebarBinding]:[],...featureSupported?[featureBinding]:[]],
    });
    const {frameTree}=await command(sessionId,'Page.getFrameTree');
    if(frameTree.frame.id!==claim.frameId||!mainURL(frameTree.frame.url))throw Error('Document ownership changed');
    session.main=true;
    if(featureSupported)await command(sessionId,'Runtime.evaluate',{expression:featureSource});
    if(suggestionSupported)await updateSuggestionPolicy();
    const runtime=await command(sessionId,'Runtime.evaluate',{expression:'globalThis.__codexPlusProjectOrder?.protocol',returnByValue:true});
    state.projectOrder.phase=runtime.result.value===10?'active':'page-reload-required';
  }catch{await disposeSession(sessionId,session);}
}
  async function response(sessionId,event){
    let body,finished=false;
    const original=async()=>{if(finished)return;if(body)await command(sessionId,'Fetch.fulfillRequest',{requestId:event.requestId,responseCode:event.responseStatusCode,responseHeaders:headers(event),body:body.base64Encoded?body.body:Buffer.from(body.body).toString('base64')});else await cdp.call('Fetch.continueRequest',{requestId:event.requestId},sessionId);finished=true;};
    try{
      if(stopping||quiesced){await original();return;}
      const {frameTree}=await command(sessionId,'Page.getFrameTree');
      const resource=resources.find(resource=>resource.url===event.request.url);
      if(!mainURL(frameTree.frame.url)||frameTree.frame.id!==event.frameId||!resource||event.resourceType!=='Script'||event.responseStatusCode!==200){await original();return;}
      body=await command(sessionId,'Fetch.getResponseBody',{requestId:event.requestId});
      if(stopping||quiesced){await original();return;}
      const bytes=body.base64Encoded?Buffer.from(body.body,'base64'):Buffer.from(body.body);
      if(createHash('sha256').update(bytes).digest('hex')!==resource.sha256){state.errors.push('Unreviewed response');await original();return;}
      await command(sessionId,'Fetch.fulfillRequest',{requestId:event.requestId,responseCode:200,responseHeaders:headers(event),body:resource.replacement});finished=true;state.adapted++;state.phase='active';if(resource.kind==='project-order')state.projectOrder.phase='active';
    }catch(error){state.errors.push('Response adaptation failed');try{await original();}catch{await cdp.call('Target.detachFromTarget',{sessionId}).catch(()=>{});}}
    finally{await publish();}
  }
function headers(event){return event.responseHeaders.filter(header=>!['content-length','content-encoding'].includes(header.name.toLowerCase()));}
function hostDisconnected(){void ownership.revoke().then(()=>{state.phase='disconnected';return publish();});}
function fail(error){state.errors.push(error.message);void publish();}
async function lifecycleCommand(message){
 if(typeof message.requestId!=='string')return;
 try{
  if(message.action==='verify'){
   if(!quiesced)throw Error('Not prepared');
   const status=null;
   process.stdout.write(JSON.stringify({type:'lifecycle-result',requestId:message.requestId,ok:true})+'\n');
  }else if(message.action==='prepare'){
   const preparingDuringStartup=!startupReady;
   quiesced=true;suggestions.configure(false);
   await startupWork;
   if(preparingDuringStartup)throw Error('Startup was still in progress');
   await monitorWork;
   if(inFlight.size)await Promise.allSettled([...inFlight]);
   if(lifecycleOperations.size)await Promise.allSettled([...lifecycleOperations]);
   // Native invokes above have drained. An acknowledged F6 request can remain
   // "requested" after its AX owner timed out; it is an unknown human window,
   // not a live operation or a resource that this controller may close.
   let outcomes=state.humanCreationOutcomes??[];
   if([...humanCreations.values()].some(r=>!r.preserved)){
    const {targetInfos}=await cdp.call('Target.getTargets');
    outcomes=[...outcomes];
    for(const [nonce,request] of humanCreations){
     if(request.preserved)continue;
     if(request.phase==='creating')throw Error('Native request still in flight');
     const matchingTargets=targetInfos.filter(t=>t.type==='page'&&humanMarker(t.url)===nonce).map(t=>t.targetId);
     outcomes.push({nonce,phase:request.phase,outcome:matchingTargets.length?'observed':'unknown',matchingTargets});
    }
    const file=path.join(path.dirname(stateFile),`human-creation-outcomes-${connection}.json`);
    await fs.writeFile(file+'.tmp',JSON.stringify(outcomes),{mode:0o600});await fs.rename(file+'.tmp',file);
    // Permanent for this nonce, including after resume: never navigate a late
    // window that the user may already have adopted or filled with a draft.
    for(const request of humanCreations.values())request.preserved=true;
    state.humanCreationOutcomes=outcomes;await publish();
   }

   process.stdout.write(JSON.stringify({type:'lifecycle-result',requestId:message.requestId,ok:true,human_creation_outcomes:outcomes})+'\n');
  }else if(message.action==='resume'){
   if(stopping)throw Error('Stopping');quiesced=false;
   process.stdout.write(JSON.stringify({type:'lifecycle-result',requestId:message.requestId,ok:true})+'\n');
  }
 }catch{process.stdout.write(JSON.stringify({type:'lifecycle-result',requestId:message.requestId,ok:false})+'\n');}
}
async function shutdown(){
  if(stopping)return;stopping=true;suggestions.configure(false);ownershipRequests.close();
  await ownership.revoke();
  if(inFlight.size)await Promise.allSettled([...inFlight]);
  await sidebarProfiles.writes;requests.clear();cdp?.close();state.phase='stopped';await publish().catch(()=>{});process.exit(0);
}
process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
let startupReady=false;
startupWork=main().then(()=>{startupReady=true;});
startupWork.catch(async error=>{state.phase='failed';state.error=error.message;if(cdp)cdp.close();await publish();process.exit(1);});
