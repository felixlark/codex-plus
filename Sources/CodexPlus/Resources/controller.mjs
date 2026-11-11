import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {CDP} from './cdp.mjs';

let adapterURL=new URL('./inspect-sidebar-model.mjs',import.meta.url);
try{await fs.access(adapterURL);}catch{adapterURL=new URL('../../../scripts/inspect-sidebar-model.mjs',import.meta.url);}
const {openAsar,adaptSidebar,adaptReloadRoute,reviewedHostResource,reviewedRouteResource}=await import(adapterURL.href);
const {values}=parseArgs({options:{app:{type:'string',default:'/Applications/ChatGPT.app'},profile:{type:'string'},state:{type:'string'},attach:{type:'boolean',default:false}}});
const stateFile=values.state??path.join(os.homedir(),'Library/Application Support/codex-plus/launcher/state.json');
await fs.mkdir(path.dirname(stateFile),{recursive:true,mode:0o700});
let state={phase:'preparing',protocol:6,controllerPID:process.pid,adapted:0,attached:0,resumed:0,errors:[]};
let publishing=Promise.resolve();
function publish(){const data=JSON.stringify(state);publishing=publishing.then(async()=>{await fs.writeFile(stateFile+'.tmp',data,{mode:0o600});await fs.rename(stateFile+'.tmp',stateFile);process.stdout.write(data+'\n');});return publishing;}
let cdp,child;
const sessions=new Map();
const inFlight=new Set();
let stopping=false;
const resources=[reviewedHostResource,reviewedRouteResource].map(resource=>({...resource,url:'app://-/'+resource.path.replace(/^webview\//,'')}));
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
  try{for(const resource of resources){
    const entry=archive.entries.find(e=>e.path===resource.path);if(!entry)throw new Error('Unsupported resource');
    const source=await archive.read(entry);
    const adaptation=resource===resources[0]?await adaptSidebar(source,{host:true,resourcePath:resource.path}):await adaptReloadRoute(source);
    if(!adaptation.supported)throw new Error('Unsupported adapter: '+adaptation.reason);
    resource.replacement=Buffer.from(adaptation.source).toString('base64');
  }}finally{await archive.close();}
  if(values.attach){
    const saved=JSON.parse(await fs.readFile(stateFile,'utf8'));assertOwner(saved.pid,saved.endpoint);
    state={...saved,protocol:6,controllerPID:process.pid,phase:'reconnecting',adapted:0,errors:[]};cdp=await CDP.connect(saved.endpoint);
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
    if(message.method==='Target.detachedFromTarget')sessions.delete(message.params.sessionId);
    if(message.method==='Fetch.requestPaused'){
      const work=response(message.sessionId,message.params).catch(fail);
      inFlight.add(work);void work.finally(()=>inFlight.delete(work));
    }
    if(message.method==='connectionClosed'){state.phase='disconnected';void publish().then(()=>process.exit(1));}
  });
  async function attach({sessionId,targetInfo,waitingForDebugger}){
    sessions.set(sessionId,{target:targetInfo.targetId});state.attached++;
    try{
      if(targetInfo.type==='page'&&!stopping){
        // Queue Fetch before releasing startup. Awaiting a page-domain reply first
        // deadlocks targets whose renderer has not started yet.
        const fetchReady=command(sessionId,'Fetch.enable',{patterns:resources.map(resource=>({urlPattern:resource.url,resourceType:'Script',requestStage:'Response'}))});
        const networkReady=command(sessionId,'Network.enable');
        const cacheReady=command(sessionId,'Network.setCacheDisabled',{cacheDisabled:true});
        await command(sessionId,'Runtime.runIfWaitingForDebugger');
        await Promise.all([fetchReady,networkReady,cacheReady]);
        state.lastAttach={waitingForDebugger,fetchBeforeResume:true};
        if(targetInfo.url&&mainURL(targetInfo.url)){
          const executed=await command(sessionId,'Runtime.evaluate',{expression:'globalThis.__codexPlusProjectOrder?.protocol',returnByValue:true});
          if(executed.result.value===6)state.phase='active';
        }
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
      await command(sessionId,'Fetch.fulfillRequest',{requestId:event.requestId,responseCode:200,responseHeaders:headers(event),body:resource.replacement});finished=true;state.adapted++;state.phase='active';
    }catch(error){state.errors.push('Response adaptation failed');try{await original();}catch{await cdp.call('Target.detachFromTarget',{sessionId}).catch(()=>{});}}
    finally{await publish();}
  }
  await cdp.call('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true,filter:[{type:'page',exclude:false}]});
  // Verify the kernel-owned socket after the early hook, not through shared discovery files.
  assertOwner(state.pid,state.endpoint);await publish();
  const monitor=setInterval(()=>{try{process.kill(state.pid,0);}catch{clearInterval(monitor);state.phase='host-exited';void publish().then(()=>process.exit(0));}},1000);
}
function headers(event){return event.responseHeaders.filter(header=>!['content-length','content-encoding'].includes(header.name.toLowerCase()));}
function fail(error){state.errors.push(error.message);void publish();}
async function shutdown(){
  if(stopping)return;stopping=true;
  if(cdp?.open){
    for(const session of sessions.keys())await command(session,'Runtime.runIfWaitingForDebugger').catch(()=>{});
    while(inFlight.size)await Promise.allSettled([...inFlight]);
    for(const session of sessions.keys())await command(session,'Fetch.disable').catch(()=>{});
    await cdp.call('Target.setAutoAttach',{autoAttach:false,waitForDebuggerOnStart:false,flatten:true}).catch(()=>{});cdp.close();
  }
  state.phase='stopped';await publish();process.exit(0);
}
process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
main().catch(async error=>{state.phase='failed';state.error=error.message;if(cdp)cdp.close();await publish();process.exit(1);});
