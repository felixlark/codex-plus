import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import readline from 'node:readline';
import {featureBinding,installFeatureEntry,validateNativeAction} from './feature-entry.mjs';
import {createSnakeGame,openSnakeDialog} from './snake.mjs';
import {CDP} from './cdp.mjs';
import {reviewedSuggestionResource,adaptSuggestions,installSuggestionReader,SuggestionCoordinator} from './suggestion-auto-send.mjs';

let adapterURL=new URL('./inspect-sidebar-model.mjs',import.meta.url);
try{await fs.access(adapterURL);}catch{adapterURL=new URL('../../../scripts/inspect-sidebar-model.mjs',import.meta.url);}
const {openAsar,adaptSidebar,adaptReloadRoute,reviewedHostResource,reviewedRouteResource}=await import(adapterURL.href);
const {values}=parseArgs({options:{app:{type:'string',default:'/Applications/ChatGPT.app'},profile:{type:'string'},state:{type:'string'},attach:{type:'boolean',default:false},'auto-send-suggestions':{type:'boolean',default:false}}});
const stateFile=values.state??path.join(os.homedir(),'Library/Application Support/codex-plus/launcher/state.json');
await fs.mkdir(path.dirname(stateFile),{recursive:true,mode:0o700});
let state={phase:'preparing',protocol:6,controllerPID:process.pid,adapted:0,attached:0,resumed:0,errors:[]};
let publishing=Promise.resolve();
function publish(){const data=JSON.stringify(state);publishing=publishing.then(async()=>{await fs.writeFile(stateFile+'.tmp',data,{mode:0o600});await fs.rename(stateFile+'.tmp',stateFile);process.stdout.write(data+'\n');});return publishing;}
let cdp,child;
const sessions=new Map();
const inFlight=new Set();
let stopping=false;
const connection=randomUUID(),parentPID=process.ppid,requests=new Map();
let featureSupported=false,suggestionSupported=false;
const attemptFile=path.join(path.dirname(stateFile),'suggestion-attempts.json');
let attempts=[],attemptStoreReady=true;
try{const value=JSON.parse(await fs.readFile(attemptFile,'utf8'));if(!Array.isArray(value)||value.some(k=>typeof k!=='string'))throw Error('Invalid attempt store');attempts=value;}catch(error){if(error.code!=='ENOENT')attemptStoreReady=false;}
const suggestions=new SuggestionCoordinator({attempts,persist:async keys=>{if(!attemptStoreReady)throw Error('Attempt store unavailable');try{await fs.writeFile(attemptFile+'.tmp',JSON.stringify(keys),{mode:0o600});await fs.rename(attemptFile+'.tmp',attemptFile);}catch(error){attemptStoreReady=false;throw error;}}});
suggestions.configure(values['auto-send-suggestions']&&attemptStoreReady);
const suggestionSource=`if(location.protocol==='app:'&&location.hostname==='-'&&location.pathname==='/index.html'){(${installSuggestionReader.toString()})();}`;
function suggestionSettings(line){try{const message=JSON.parse(line);if(message.type==='suggestion-settings'&&message.version===1&&typeof message.enabled==='boolean')suggestions.configure(message.enabled&&attemptStoreReady);}catch{}}

const featureSource=`if(location.protocol==='app:'&&location.hostname==='-'&&location.pathname==='/index.html'&&!/^\\/(avatar-overlay|spotlight|global-dictation|hotkey-window)(\\/|$)/.test(new URL(location.href).searchParams.get('initialRoute')??'')){(${installFeatureEntry.toString()})(${JSON.stringify({connection,binding:featureBinding})},${createSnakeGame.toString()},${openSnakeDialog.toString()});}`;
const replies=readline.createInterface({input:process.stdin});
replies.on('line',line=>{suggestionSettings(line);try{const reply=JSON.parse(line),request=requests.get(reply.requestId);if(reply.type!=='ui-result'||!request)return;requests.delete(reply.requestId);const current=sessions.get(request.session);if(!current?.contexts.has(request.context))return;void command(request.session,'Runtime.evaluate',{expression:`globalThis.__codexPlusFeatures?.ack(${JSON.stringify(request.pageID)},${reply.ok===true})`,contextId:request.context}).catch(()=>{});}catch{}});
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
function mainURL(value){const url=new URL(value);return url.protocol==='app:'&&url.hostname==='-'&&url.pathname==='/index.html'&&!/^\/(avatar-overlay|spotlight|global-dictation|hotkey-window)(\/|$)/.test(url.searchParams.get('initialRoute')??'');}
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
    const footer=archive.entries.find(e=>e.path==='webview/assets/async/885910.79b4f4977c.js');
    featureSupported=!!footer&&createHash('sha256').update(await archive.read(footer)).digest('hex')==='1011c180e813ef95373b33f53ec234baa941d748dd1110f4de4538a42a550feb';
    state.pageEntries={supported:featureSupported,phase:featureSupported?'waiting':'unsupported-host'};
    state.projectOrder={supported:true,phase:'waiting'};
    for(const resource of resources){
      try{
        const entry=archive.entries.find(e=>e.path===resource.path);if(!entry)throw new Error('Unsupported resource');
        const source=await archive.read(entry);
        const adaptation=await resource.adapt(source);
        if(!adaptation.supported)throw new Error('Unsupported adapter: '+adaptation.reason);
        resource.replacement=Buffer.from(adaptation.source).toString('base64');
      }catch(error){state.projectOrder={supported:false,phase:'unsupported-host',reason:error.message};}
    }
    if(!state.projectOrder.supported)resources.length=0;
    const entry=archive.entries.find(e=>e.path===reviewedSuggestionResource.path);
    if(entry&&state.projectOrder.supported){const adaptation=adaptSuggestions(await archive.read(entry));if(adaptation.supported){suggestionSupported=true;resources.push({...reviewedSuggestionResource,kind:'suggestion',url:'app://-/'+reviewedSuggestionResource.path.replace(/^webview\//,''),replacement:Buffer.from(adaptation.source).toString('base64')});}}
    state.suggestionAutoSend={...suggestions.status(),supported:suggestionSupported,storageReady:attemptStoreReady};
  }finally{await archive.close();}
  if(values.attach){
    const saved=JSON.parse(await fs.readFile(stateFile,'utf8'));assertOwner(saved.pid,saved.endpoint);
    state={...state,pid:saved.pid,endpoint:saved.endpoint,phase:'reconnecting'};cdp=await CDP.connect(saved.endpoint);
  }else{
    await publish();
    const args=['--remote-debugging-address=127.0.0.1','--remote-debugging-port=0'];
    const env={...process.env};if(values.profile){args.push(`--user-data-dir=${values.profile}/user-data`);env.CODEX_HOME=values.profile+'/codex-home';env.CODEX_ELECTRON_USER_DATA_PATH=values.profile+'/user-data';}
    child=spawn(path.join(values.app,'Contents/MacOS/ChatGPT'),args,{env,detached:true,stdio:['ignore','ignore','pipe']});
    state.pid=child.pid;state.phase='launching';await publish();
    const endpoint=await new Promise((resolve,reject)=>{
      let line='';const timer=setTimeout(()=>reject(new Error('Host debug listener timeout')),30000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(new Error('Host exited before listener'));});
      child.stderr.on('data',bytes=>{line+=bytes.toString();for(const complete of line.split('\n').slice(0,-1)){const match=complete.match(/^DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}}line=line.slice(line.lastIndexOf('\n')+1);});
    });
    state.endpoint=endpoint;
    await publish();
    // This unguessable endpoint arrives from the verified child before its first page.
    cdp=await CDP.connect(endpoint);
    child.stderr.removeAllListeners('data');child.stderr.resume();child.unref();
  }
  cdp.listeners.add(message=>{
    if(message.method==='Target.attachedToTarget'){
      const work=attach(message.params).catch(fail);inFlight.add(work);void work.finally(()=>inFlight.delete(work));
    }
    if(message.method==='Target.detachedFromTarget'){forgetRequests(message.params.sessionId);sessions.delete(message.params.sessionId);}
    if(message.method==='Runtime.executionContextCreated')sessions.get(message.sessionId)?.contexts.set(message.params.context.id,message.params.context);
    if(message.method==='Runtime.executionContextDestroyed'){sessions.get(message.sessionId)?.contexts.delete(message.params.executionContextId);forgetRequests(message.sessionId,message.params.executionContextId);}
    if(message.method==='Runtime.executionContextsCleared'){sessions.get(message.sessionId)?.contexts.clear();forgetRequests(message.sessionId);}
    if(message.method==='Runtime.bindingCalled')void nativeAction(message).catch(fail);
    if(message.method==='Page.frameNavigated'&&!message.params.frame.parentId){const session=sessions.get(message.sessionId);if(session){session.frame=message.params.frame.id;session.main=mainURL(message.params.frame.url);}}
    if(message.method==='Fetch.requestPaused'){
      const work=response(message.sessionId,message.params).catch(fail);
      inFlight.add(work);void work.finally(()=>inFlight.delete(work));
    }
    if(message.method==='connectionClosed'){state.phase='disconnected';void publish().then(()=>process.exit(1));}
  });
  async function attach({sessionId,targetInfo,waitingForDebugger}){
    const session={target:targetInfo.targetId,contexts:new Map(),main:false};
    sessions.set(sessionId,session);state.attached++;
    try{
      if(targetInfo.type==='page'&&!stopping){
        const work=[command(sessionId,'Runtime.enable'),command(sessionId,'Page.enable')];
        if(resources.length){work.push(command(sessionId,'Fetch.enable',{patterns:resources.map(resource=>({urlPattern:resource.url,resourceType:'Script',requestStage:'Response'}))}),command(sessionId,'Network.enable'),command(sessionId,'Network.setCacheDisabled',{cacheDisabled:true}));}
        if(suggestionSupported)work.push(command(sessionId,'Page.addScriptToEvaluateOnNewDocument',{source:suggestionSource}).then(result=>{session.suggestionScript=result.identifier;}));
        if(featureSupported){work.push(command(sessionId,'Runtime.addBinding',{name:featureBinding}),command(sessionId,'Page.addScriptToEvaluateOnNewDocument',{source:featureSource}).then(result=>{session.script=result.identifier;}));}
        await command(sessionId,'Runtime.runIfWaitingForDebugger');
        await Promise.all(work);
        const {frameTree}=await command(sessionId,'Page.getFrameTree');session.frame=frameTree.frame.id;session.main=mainURL(frameTree.frame.url);
        if(session.main){
          if(suggestionSupported){await command(sessionId,'Runtime.evaluate',{expression:suggestionSource});await command(sessionId,'Runtime.evaluate',{expression:'globalThis.__codexPlusSuggestions?.cancel()'});}
          if(featureSupported)await command(sessionId,'Runtime.evaluate',{expression:featureSource});
          const runtime=await command(sessionId,'Runtime.evaluate',{expression:'globalThis.__codexPlusProjectOrder?.protocol',returnByValue:true});
          if(runtime.result.value===6)state.projectOrder.phase='active';
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
  await cdp.call('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true,filter:[{type:'page',exclude:false}]});
  // Verify the kernel-owned socket after the early hook, not through shared discovery files.
  assertOwner(state.pid,state.endpoint);await publish();
  let inspecting=false;
  const monitor=setInterval(async()=>{
    if(process.ppid!==parentPID){clearInterval(monitor);void shutdown();return;}
    try{process.kill(state.pid,0);}catch{clearInterval(monitor);state.phase='host-exited';void publish().then(()=>process.exit(0));return;}
    if(inspecting||stopping)return;inspecting=true;
    try{
      if(featureSupported){const pages=[];for(const [id,session]of sessions)if(session.main){const r=await command(id,'Runtime.evaluate',{expression:'globalThis.__codexPlusFeatures?.status()',returnByValue:true});if(r.result.value)pages.push(r.result.value);}
        const entries={supported:true,phase:pages.some(p=>p.phase==='active')?'active':'waiting-for-sidebar',pages};
        if(JSON.stringify(entries)!==JSON.stringify(state.pageEntries)){state.pageEntries=entries;await publish();}}
      if(suggestionSupported){
        const pages=[];for(const [id,session]of sessions)if(session.main){const r=await command(id,'Runtime.evaluate',{expression:'globalThis.__codexPlusSuggestions?.inspect()',returnByValue:true});if(r.result.value)pages.push({id,snapshot:r.result.value});}
        await suggestions.tick(pages,async(id,action,arg)=>{
          if(stopping||!cdp.open)throw Error('Controller disconnected');
          const expression=`globalThis.__codexPlusSuggestions?.${action}(${arg===undefined?'':JSON.stringify(arg)})`;
          const r=await command(id,'Runtime.evaluate',{expression,returnByValue:true});if(r.exceptionDetails)throw Error('Suggestion action failed');return r.result.value;
        });
        const snapshot={...suggestions.status(),supported:true,storageReady:attemptStoreReady,pageReady:pages.some(p=>p.snapshot.supported)};
        if(!snapshot.pageReady)snapshot.reason='page-reload-required';
        if(JSON.stringify(snapshot)!==JSON.stringify(state.suggestionAutoSend)){state.suggestionAutoSend=snapshot;await publish();}
      }
    }catch{}finally{inspecting=false;}
  },1000);
}
function headers(event){return event.responseHeaders.filter(header=>!['content-length','content-encoding'].includes(header.name.toLowerCase()));}
function fail(error){state.errors.push(error.message);void publish();}
async function shutdown(){
  if(stopping)return;stopping=true;
  if(cdp?.open){
    for(const session of sessions.keys())await command(session,'Runtime.runIfWaitingForDebugger').catch(()=>{});
    while(inFlight.size)await Promise.allSettled([...inFlight]);
    for(const [id,session]of sessions){
      if(suggestionSupported){await command(id,'Runtime.evaluate',{expression:'globalThis.__codexPlusSuggestions?.dispose()'}).catch(()=>{});if(session.suggestionScript)await command(id,'Page.removeScriptToEvaluateOnNewDocument',{identifier:session.suggestionScript}).catch(()=>{});}
      if(featureSupported){await command(id,'Runtime.evaluate',{expression:'globalThis.__codexPlusFeatures?.dispose()'}).catch(()=>{});if(session.script)await command(id,'Page.removeScriptToEvaluateOnNewDocument',{identifier:session.script}).catch(()=>{});await command(id,'Runtime.removeBinding',{name:featureBinding}).catch(()=>{});}
      await command(id,'Fetch.disable').catch(()=>{});
    }
    requests.clear();
    await cdp.call('Target.setAutoAttach',{autoAttach:false,waitForDebuggerOnStart:false,flatten:true}).catch(()=>{});cdp.close();
  }
  state.phase='stopped';await publish();process.exit(0);
}
process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
main().catch(async error=>{state.phase='failed';state.error=error.message;if(cdp)cdp.close();await publish();process.exit(1);});
