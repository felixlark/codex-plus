import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {launchHost,parentIsAlive} from './launch-host.mjs';
import {parseArgs} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import readline from 'node:readline';
import {featureBinding,installFeatureEntry,validateNativeAction,reviewedFeatureResource,removeFeatureEntries} from './feature-entry.mjs';
import {createSnakeGame,openSnakeDialog} from './snake.mjs';
import {allocateWindowNumbers} from './window-number.mjs';
import {CDP} from './cdp.mjs';
import {sidebarBinding,adaptSidebarLayout,resolveSidebarDisplay,sanitizeSidebarValues,SidebarProfiles,needsSidebarReconnect} from './sidebar-layout.mjs';
import {backgroundGuardBinding,reviewedSamplingResource,reviewedBackgroundDependency,adaptBackgroundSuggestions,SuggestionCoordinator} from './suggestion-auto-send.mjs';
import {policyForBackgroundPage,reviewedBackgroundPages,canReconnectPage,inspectReconnectSafety,createReconnectGuard,normalizeAcceptanceThread} from './suggestion-review.mjs';

let adapterURL=new URL('./inspect-sidebar-model.mjs',import.meta.url);
try{await fs.access(adapterURL);}catch{adapterURL=new URL('../../../scripts/inspect-sidebar-model.mjs',import.meta.url);}
const {openAsar,adaptSidebar,adaptReloadRoute,reviewedHostResource,reviewedRouteResource}=await import(adapterURL.href);
const {values}=parseArgs({options:{app:{type:'string',default:'/Applications/ChatGPT.app'},profile:{type:'string'},state:{type:'string'},attach:{type:'boolean',default:false},'auto-send-suggestions':{type:'boolean',default:false},'suggestion-acceptance-thread':{type:'string'}}});
const acceptanceThread=normalizeAcceptanceThread(values['suggestion-acceptance-thread']);
const stateFile=values.state??path.join(os.homedir(),'Library/Application Support/codex-plus/launcher/state.json');
await fs.mkdir(path.dirname(stateFile),{recursive:true,mode:0o700});
let state={phase:'preparing',protocol:6,controllerPID:process.pid,adapted:0,attached:0,resumed:0,errors:[],windowNumbers:{}};
let publishing=Promise.resolve();
function publish(){const data=JSON.stringify(state);publishing=publishing.then(async()=>{await fs.writeFile(stateFile+'.tmp',data,{mode:0o600});await fs.rename(stateFile+'.tmp',stateFile);process.stdout.write(data+'\n');});return publishing;}
let cdp;
const sessions=new Map();
const inFlight=new Set();
let stopping=false;
const connection=randomUUID(),parentPID=process.ppid,requests=new Map();
let featureSupported=false,suggestionSupported=false,sidebarSupported=false;
let displays=[];
const sidebarProfiles=new SidebarProfiles(path.join(path.dirname(stateFile),'sidebar-layouts.json'),fs);
await sidebarProfiles.load();
let reviewDigest='';const reviewRequests=new Map();
const attemptFile=path.join(path.dirname(stateFile),'suggestion-attempts.json');
let attempts=[],attemptStoreReady=true;
try{const value=JSON.parse(await fs.readFile(attemptFile,'utf8'));if(!Array.isArray(value)||value.some(k=>typeof k!=='string'))throw Error('Invalid attempt store');attempts=value;}catch(error){if(error.code!=='ENOENT')attemptStoreReady=false;}
const suggestions=new SuggestionCoordinator({attempts,persist:async keys=>{if(!attemptStoreReady)throw Error('Attempt store unavailable');try{await fs.writeFile(attemptFile+'.tmp',JSON.stringify(keys),{mode:0o600});await fs.rename(attemptFile+'.tmp',attemptFile);}catch(error){attemptStoreReady=false;throw error;}}});
suggestions.configure(values['auto-send-suggestions']&&attemptStoreReady);
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
  if(stopping||event.name!==backgroundGuardBinding||!session?.main||!context?.auxData?.isDefault||context.auxData.frameId!==session.frame)return;
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

function suggestionSettings(line){try{const message=JSON.parse(line);if(message.type==='suggestion-settings'&&message.version===1&&typeof message.enabled==='boolean'){suggestions.configure(message.enabled&&attemptStoreReady);void updateSuggestionPolicy();}}catch{}}

const featureSource=`if(location.protocol==='app:'&&location.hostname==='-'&&location.pathname==='/index.html'&&!/^\\/(avatar-overlay|spotlight|global-dictation|hotkey-window)(\\/|$)/.test(new URL(location.href).searchParams.get('initialRoute')??'')){(${installFeatureEntry.toString()})(${JSON.stringify({connection,binding:featureBinding})},${createSnakeGame.toString()},${openSnakeDialog.toString()});}`;
const replies=readline.createInterface({input:process.stdin});
replies.on('close',()=>void shutdown());
replies.on('line',line=>{suggestionSettings(line);try{const reply=JSON.parse(line);if(reply.type==='sidebar-displays'&&reply.version===1&&Array.isArray(reply.displays)){displays=reply.displays;return;}if(reply.type==='reconnect-enhancements'&&reply.version===1){void reconnectEnhancements();return;}if(reply.type==='suggestion-review'){void reviewDecision(reply).catch(()=>{});return;}const request=requests.get(reply.requestId);if(reply.type!=='ui-result'||!request)return;requests.delete(reply.requestId);const current=sessions.get(request.session);if(!current?.contexts.has(request.context))return;void command(request.session,'Runtime.evaluate',{expression:`globalThis.__codexPlusFeatures?.ack(${JSON.stringify(request.pageID)},${reply.ok===true})`,contextId:request.context}).catch(()=>{});}catch{}});
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
  if(stopping||event.name!==sidebarBinding||!session?.main||!context?.auxData?.isDefault||context.auxData.frameId!==session.frame)return;
  let value;try{value=JSON.parse(event.payload);}catch{return;}
  if(value.version!==1||typeof value.pageId!=='string'||!Number.isSafeInteger(value.sequence)||value.sequence<1||typeof value.change?.key!=='string'||!sanitizeSidebarValues({[value.change.key]:value.change.value}))return;
  await queueSidebar(message.sessionId,{...value,context:event.executionContextId});
}
function forgetRequests(session,context){for(const [id,r]of requests)if(r.session===session&&(context===undefined||r.context===context))requests.delete(id);}
async function nativeAction(message){
  const session=sessions.get(message.sessionId),event=message.params,context=session?.contexts.get(event.executionContextId);
  if(stopping||event.name!==featureBinding||!context?.auxData?.isDefault||context.auxData.frameId!==session.frame||!session.main)return;
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
function mainURL(value){const url=new URL(value);return url.protocol==='app:'&&url.hostname==='-'&&url.pathname==='/index.html'&&!/^\/(avatar-overlay|spotlight|global-dictation|hotkey-window)(\/|$)/.test(url.searchParams.get('initialRoute')??'');}
async function refreshWindowNumbers(){
  const {targetInfos}=await cdp.call('Target.getTargets');
  const targets=targetInfos.filter(t=>t.type==='page'&&t.url.startsWith('app://-/index.html')&&mainURL(t.url)).map(t=>t.targetId);
  const numbers=allocateWindowNumbers(targets,state.windowNumbers);
  if(Object.keys(numbers).length!==Object.keys(state.windowNumbers).length||Object.entries(numbers).some(([target,number])=>state.windowNumbers[target]!==number)){state.windowNumbers=numbers;await publish();}
}
function command(session,method,params={}){return cdp.call(method,params,session);}
function assertOwner(pid,endpoint){
  const command=execFileSync('/bin/ps',['-p',String(pid),'-o','args='],{encoding:'utf8'});
  const expected=path.join(values.app,'Contents/MacOS/ChatGPT');
  if(!command.startsWith(expected)||(values.profile&&!command.includes(`--user-data-dir=${values.profile}/user-data`)))throw new Error('Host identity mismatch');
  const port=new URL(endpoint).port;
  const listener=execFileSync('/usr/sbin/lsof',['-nP','-a','-p',String(pid),`-iTCP:${port}`,'-sTCP:LISTEN'],{encoding:'utf8'});
  if(!listener.includes(`127.0.0.1:${port}`)||listener.includes(`*:${port}`))throw new Error('Host listener mismatch');
}
async function main(){
  execFileSync('/usr/bin/codesign',['--verify','--deep','--strict','-R=anchor apple generic and identifier "com.openai.codex" and certificate leaf[subject.OU] = "2DC432GLL2"',values.app],{stdio:'pipe'});
  const archive=await openAsar(values.app);
  try{
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
  if(stopping)return;
  if(values.attach){
    const saved=JSON.parse(await fs.readFile(stateFile,'utf8'));assertOwner(saved.pid,saved.endpoint);
    state={...state,pid:saved.pid,endpoint:saved.endpoint,windowNumbers:saved.windowNumbers??{},phase:'reconnecting'};cdp=await CDP.connect(saved.endpoint);
  }else{
    await publish();
    state.phase='launching';state.launchMethod='launch-services';await publish();
    const launched=await launchHost({app:values.app,profile:values.profile});
    state.pid=launched.pid;state.endpoint=launched.endpoint;
    await publish();
    // The freshly written endpoint is authenticated against the real signed
    // app process and all its listeners before any debug connection is made.
    cdp=await CDP.connect(launched.endpoint);
  }
  cdp.listeners.add(message=>{
    if(message.method==='Target.attachedToTarget'){
      const work=attach(message.params).catch(fail);inFlight.add(work);void work.finally(()=>inFlight.delete(work));
    }
    if(message.method==='Target.detachedFromTarget'){forgetRequests(message.params.sessionId);sessions.delete(message.params.sessionId);}
    if(message.method==='Runtime.executionContextCreated')sessions.get(message.sessionId)?.contexts.set(message.params.context.id,message.params.context);
    if(message.method==='Runtime.executionContextDestroyed'){sessions.get(message.sessionId)?.contexts.delete(message.params.executionContextId);forgetRequests(message.sessionId,message.params.executionContextId);}
    if(message.method==='Runtime.executionContextsCleared'){sessions.get(message.sessionId)?.contexts.clear();forgetRequests(message.sessionId);}
    if(message.method==='Runtime.bindingCalled'){void nativeAction(message).catch(fail);void suggestionGuard(message).catch(()=>{});void sidebarAction(message).catch(()=>{});}
    if(message.method==='Page.frameNavigated'&&!message.params.frame.parentId){const session=sessions.get(message.sessionId);if(session){session.frame=message.params.frame.id;session.main=mainURL(message.params.frame.url);}}
    if(message.method==='Fetch.requestPaused'){
      const work=response(message.sessionId,message.params).catch(fail);
      inFlight.add(work);void work.finally(()=>inFlight.delete(work));
    }
    if(message.method==='connectionClosed'&&!stopping){state.phase='disconnected';void publish().then(()=>process.exit(1));}
  });
  async function attach({sessionId,targetInfo,waitingForDebugger}){
    const session={target:targetInfo.targetId,contexts:new Map(),main:false};
    sessions.set(sessionId,session);state.attached++;
    try{
      if(targetInfo.type==='page'&&!stopping){
        const work=[command(sessionId,'Runtime.enable'),command(sessionId,'Page.enable')];
        if(resources.length){work.push(command(sessionId,'Fetch.enable',{patterns:resources.map(resource=>({urlPattern:resource.url,resourceType:'Script',requestStage:'Response'}))}),command(sessionId,'Network.enable'),command(sessionId,'Network.setCacheDisabled',{cacheDisabled:true}));}
        if(suggestionSupported)work.push(command(sessionId,'Runtime.addBinding',{name:backgroundGuardBinding}));
        if(sidebarSupported)work.push(command(sessionId,'Runtime.addBinding',{name:sidebarBinding}));
        if(featureSupported){work.push(command(sessionId,'Runtime.addBinding',{name:featureBinding}),command(sessionId,'Page.addScriptToEvaluateOnNewDocument',{source:featureSource}).then(result=>{session.script=result.identifier;}));}
        await command(sessionId,'Runtime.runIfWaitingForDebugger');
        await Promise.all(work);
        const {frameTree}=await command(sessionId,'Page.getFrameTree');session.frame=frameTree.frame.id;session.main=mainURL(frameTree.frame.url);
        if(session.main){
          if(suggestionSupported)await updateSuggestionPolicy();
          if(featureSupported)await command(sessionId,'Runtime.evaluate',{expression:featureSource});
          const runtime=await command(sessionId,'Runtime.evaluate',{expression:'globalThis.__codexPlusProjectOrder?.protocol',returnByValue:true});
          if(runtime.result.value===8)state.projectOrder.phase='active';
          else if(runtime.result.value)state.projectOrder.phase='page-reload-required';
        }
        state.lastAttach={waitingForDebugger,fetchBeforeResume:true};state.phase='active';
      }
    }finally{
      await command(sessionId,'Runtime.runIfWaitingForDebugger').catch(()=>{});state.resumed++;await publish();
    }
  }
  async function response(sessionId,event){
    let body,finished=false;
    const original=async()=>{if(finished)return;if(body)await command(sessionId,'Fetch.fulfillRequest',{requestId:event.requestId,responseCode:event.responseStatusCode,responseHeaders:headers(event),body:body.base64Encoded?body.body:Buffer.from(body.body).toString('base64')});else await command(sessionId,'Fetch.continueRequest',{requestId:event.requestId});finished=true;};
    try{
      if(stopping){await original();return;}
      const {frameTree}=await command(sessionId,'Page.getFrameTree');
      const resource=resources.find(resource=>resource.url===event.request.url);
      if(!mainURL(frameTree.frame.url)||frameTree.frame.id!==event.frameId||!resource||event.resourceType!=='Script'||event.responseStatusCode!==200){await original();return;}
      body=await command(sessionId,'Fetch.getResponseBody',{requestId:event.requestId});
      if(stopping){await original();return;}
      const bytes=body.base64Encoded?Buffer.from(body.body,'base64'):Buffer.from(body.body);
      if(createHash('sha256').update(bytes).digest('hex')!==resource.sha256){state.errors.push('Unreviewed response');await original();return;}
      await command(sessionId,'Fetch.fulfillRequest',{requestId:event.requestId,responseCode:200,responseHeaders:headers(event),body:resource.replacement});finished=true;state.adapted++;state.phase='active';if(resource.kind==='project-order')state.projectOrder.phase='active';
    }catch(error){state.errors.push('Response adaptation failed');try{await original();}catch{await cdp.call('Target.detachFromTarget',{sessionId}).catch(()=>{});}}
    finally{await publish();}
  }
  if(stopping){cdp.close();return;}
  await cdp.call('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true,filter:[{type:'page',exclude:false}]});
  // Verify the kernel-owned socket after the early hook, not through shared discovery files.
  assertOwner(state.pid,state.endpoint);await publish();
  const suggestionHeartbeat=setInterval(()=>{if(!stopping)void updateSuggestionPolicy();},1000);
  let inspecting=false;
  const monitor=setInterval(async()=>{
    if(process.ppid!==parentPID||!parentIsAlive(parentPID)){clearInterval(monitor);void shutdown();return;}
    try{process.kill(state.pid,0);}catch{clearInterval(monitor);state.phase='host-exited';void publish().then(()=>process.exit(0));return;}
    if(inspecting||stopping)return;inspecting=true;
    try{
      if(state.projectOrder.supported){
        const pages=[];
        for(const [id,s]of sessions)if(s.main){const r=await command(id,'Runtime.evaluate',{expression:'globalThis.__codexPlusProjectOrder?.protocol',returnByValue:true});pages.push({protocol:r.result.value??null});}
        const status={supported:true,protocol:8,phase:pages.length&&pages.every(p=>p.protocol===8)?'active':pages.some(p=>p.protocol!==null)?'page-reload-required':'waiting',pages};
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
          if(stopping||!cdp.open)throw Error('Controller disconnected');
          const r=await command(id,'Runtime.evaluate',{expression:`globalThis.__codexPlusBackgroundSuggestions?.submit(${JSON.stringify(arg)})`,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('Suggestion action failed');return r.result.value;
        }});
        const snapshot={...suggestions.status(),supported:true,storageReady:attemptStoreReady,mode:'background-native-reviewed',review:{pending:pages.reduce((n,p)=>n+(p.snapshot.review?.pending??0),0),reviewing:pages.reduce((n,p)=>n+(p.snapshot.review?.reviewing??0),0),captured:pages.reduce((n,p)=>n+(p.snapshot.review?.captured??0),0),reasons:[...new Set(pages.map(p=>p.snapshot.review?.reason).filter(Boolean))]},pageReady:readiness.pageReady,legacyPages:readiness.legacyPages};
        if(!snapshot.pageReady)snapshot.reason='page-reload-required';
        if(JSON.stringify(snapshot)!==JSON.stringify(state.suggestionAutoSend)){state.suggestionAutoSend=snapshot;await publish();}
      }
    }catch{}finally{inspecting=false;}
  },1000);
}
function headers(event){return event.responseHeaders.filter(header=>!['content-length','content-encoding'].includes(header.name.toLowerCase()));}
function fail(error){state.errors.push(error.message);void publish();}
async function shutdown(){
  if(stopping)return;stopping=true;suggestions.configure(false);
  // Cleanup is best effort after leases and admissions are revoked. Reuse the
  // existing 10s CDP response budget; dead browser targets must not orphan us.
  let timer;
  const cleanup=(async()=>{
    if(!cdp?.open)return;
    // Revoke visible entry points first, even if a page is no longer marked main.
    const resumed=Promise.allSettled([...sessions.keys()].map(id=>command(id,'Runtime.runIfWaitingForDebugger')));
    await removeFeatureEntries(sessions,command);
    await resumed;
    if(inFlight.size)await Promise.allSettled([...inFlight]);
    await Promise.allSettled([...sessions].map(async([id,session])=>{
      if(suggestionSupported){if(session.main)await command(id,'Runtime.evaluate',{expression:'globalThis.__codexPlusBackgroundSuggestions?.dispose()'}).catch(()=>{});await command(id,'Runtime.removeBinding',{name:backgroundGuardBinding}).catch(()=>{});}
      if(sidebarSupported){await command(id,'Runtime.evaluate',{expression:'globalThis.__codexPlusSidebarLayout?.suspend()'}).catch(()=>{});await command(id,'Runtime.removeBinding',{name:sidebarBinding}).catch(()=>{});}
      await command(id,'Fetch.disable').catch(()=>{});
    }));
    await cdp.call('Target.setAutoAttach',{autoAttach:false,waitForDebuggerOnStart:false,flatten:true}).catch(()=>{});
  })();
  await Promise.race([cleanup,new Promise(resolve=>{timer=setTimeout(resolve,10000);})]);
  await sidebarProfiles.writes;
  clearTimeout(timer);requests.clear();cdp?.close();
  state.phase='stopped';
  await publish().catch(()=>{});process.exit(0);
}

process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
main().catch(async error=>{state.phase='failed';state.error=error.message;if(cdp)cdp.close();await publish();process.exit(1);});
