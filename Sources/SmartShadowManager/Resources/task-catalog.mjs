import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {CDP} from './cdp.mjs';

const home=os.homedir(),app='/Applications/ChatGPT.app';
const hostPath=app+'/Contents/MacOS/ChatGPT';
const binary=app+'/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
const pins={
 '.vite/build/early-bootstrap-631-c364c4eef36b8fb5.js':'3d33823eff6f760caed93a06c7bd580a2ed7631c961bf7f4454622c47205fc2c',
 'webview/assets/async/907538.0572f09d40.js':'eba5577e16a50a8106a64a05025fa23d0a589d8b4f775a6fe065ba7d916e6b1c',
 'webview/assets/348410.374a9b8f98.js':'0524ee891262587e2605b573f75ebb1cce4df2b3db154a8f14a2f24a9e80dc0b',
};
const binaryHash='3ea20787e106af94573d3d6c19480aed93a1334b0dd32b6b04e2f780ce82cf4b';
const moduleURL='app://-/assets/348410.374a9b8f98.js';
const launcher=path.join(home,'Library/Application Support/codex-plus/launcher/state.json');
const hash=v=>createHash('sha256').update(v).digest('hex');
async function privateJSON(file){const s=await fs.lstat(file);if(!s.isFile()||s.uid!==process.getuid()||(s.mode&0o077)!==0)throw Error('private configuration required');return JSON.parse(await fs.readFile(file,'utf8'));}
async function readAsar(name){
 const f=await fs.open(app+'/Contents/Resources/app.asar');
 const read=async(n,pos)=>{const b=Buffer.alloc(n);let off=0;while(off<n){const r=await f.read(b,off,n-off,pos+off);if(!r.bytesRead)throw Error('short resource');off+=r.bytesRead;}return b;};
 try{const p=await read(16,0),h=JSON.parse(await read(p.readUInt32LE(12),16));let e=h;for(const k of name.split('/'))e=e.files?.[k];if(!e||e.unpacked||!Number.isSafeInteger(e.size))throw Error('resource unavailable');return await read(e.size,8+p.readUInt32LE(4)+Number(e.offset));}finally{await f.close();}
}
// Map taskd's host name only when its installed, private configuration names
// exactly this original backend and reviewed resource set.
async function mappedHost(){try{
 const m=await privateJSON(path.join(home,'Library/Application Support/SmartShadow/services/installed.json'));
 const c=m.components?.taskd;if(!c?.source_commit)return null;
 const h=(await privateJSON(c.configuration)).host,t=h.transport;
 return c.source_commit===process.argv[2]&&h.hostname===os.hostname()&&h.binary===binary&&h.version==='codex-cli 0.169.0-alpha.11.1'&&t?.kind==='electron'&&t.app_path===app&&t.host_executable===hostPath&&t.launcher_state===launcher&&t.module_url===moduleURL&&t.module_sha256===pins['webview/assets/348410.374a9b8f98.js']&&t.resource_path==='webview/assets/async/907538.0572f09d40.js'&&t.resource_sha256===pins[t.resource_path]&&t.binary_sha256===binaryHash?{id:h.id,sourceCommit:c.source_commit}:null;
 }catch{return null;}}
let cdp,sid,closing=false;
const key='__cpTaskCatalog_'+randomUUID().replaceAll('-','');
async function close(){if(closing)return;closing=true;try{if(cdp?.open&&sid){await cdp.call('Runtime.evaluate',{expression:`globalThis[${JSON.stringify(key)}]?.close()`},sid);await cdp.call('Target.detachFromTarget',{sessionId:sid});}}finally{cdp?.close();}}
process.once('SIGTERM',()=>void close().finally(()=>process.exit(0)));
process.once('SIGINT',()=>void close().finally(()=>process.exit(0)));
try{
 for(const [name,expected] of Object.entries(pins))if(hash(await readAsar(name))!==expected)throw Error('original resource changed');
 if(hash(await fs.readFile(binary))!==binaryHash)throw Error('original backend changed');
 const state=await privateJSON(launcher),endpoint=new URL(state.endpoint);
 if(endpoint.protocol!=='ws:'||endpoint.hostname!=='127.0.0.1')throw Error('non-local endpoint');
 const rows=execFileSync('/bin/ps',['-axo','pid=,ppid=,uid=,comm='],{encoding:'utf8'}).trim().split('\n').map(s=>{const m=s.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);return m&&{pid:+m[1],ppid:+m[2],uid:+m[3],path:m[4]};}).filter(Boolean);
 if(!rows.some(r=>r.pid===state.pid&&r.uid===process.getuid()&&r.path===hostPath))throw Error('host identity changed');
 const commands=execFileSync('/bin/ps',['-axo','pid=,command='],{encoding:'utf8'}).split('\n');
 const backends=rows.filter(r=>r.ppid===state.pid&&r.uid===process.getuid()&&r.path===binary&&commands.some(s=>new RegExp('^\\s*'+r.pid+'\\s+').test(s)&&/\sapp-server(?:\s|$)/.test(s)));
 if(backends.length!==1)throw Error('backend identity changed');
 const sockets=execFileSync('/usr/sbin/lsof',['-nP','-a','-p',String(state.pid),'-iTCP','-sTCP:LISTEN','-Fn'],{encoding:'utf8'});
 if(!sockets.split('\n').includes('n127.0.0.1:'+endpoint.port))throw Error('listener identity changed');
 const host=await mappedHost();if(closing)throw Error('cancelled');
 cdp=await CDP.connect(state.endpoint);if(closing)throw Error('cancelled');
 const {targetInfos}=await cdp.call('Target.getTargets');if(closing)throw Error('cancelled');
 const target=targetInfos.find(t=>t.type==='page'&&t.url.startsWith('app://-/index.html')&&t.targetId!==state.mobile?.targetId&&!t.url.includes('workbench'));
 if(!target)throw Error('original renderer unavailable');
 ({sessionId:sid}=await cdp.call('Target.attachToTarget',{targetId:target.targetId,flatten:true}));if(closing)throw Error('cancelled');
 const read=async(key,moduleURL)=>{
  let manager,pending,lease,rejectWait,closed=false;
  const close=()=>{if(!closed){closed=true;rejectWait?.(Error('cancelled'));manager?.[Symbol.dispose]?.();lease?.[Symbol.dispose]?.();pending?.[Symbol.dispose]?.();}delete globalThis[key];};
  globalThis[key]={close};
  try{
   const r=(await import(moduleURL)).__webpack_require__;if(closed)throw Error('cancelled');
   if(window.electronBridge.getSentryInitOptions().appVersion!=='26.1111.21308')throw Error('original version changed');
   const services=r('GaA7').appServices;
   await new Promise((resolve,reject)=>{rejectWait=reject;pending=services.appServerManagers.subscribe('local',e=>{if(closed)return;if(e.status==='ready'&&!manager){manager=e.manager.dup();resolve();}});pending.then(value=>{if(closed)value?.[Symbol.dispose]?.();},()=>{});pending.onRpcBroken(()=>reject(Error('backend unavailable')));});
   lease=await pending;if(closed){lease?.[Symbol.dispose]?.();throw Error('cancelled');}
   const rows=[],seen=new Set();let cursor=null;
   do{const p=await manager.sendRequest('thread/list',{archived:false,currentAccountOnly:true,useStateDbOnly:true,cursor,limit:100,sortKey:'updated_at',sourceKinds:['cli','vscode','exec','appServer','subAgent','subAgentReview','subAgentCompact','subAgentThreadSpawn','subAgentOther','unknown']});if(closed)throw Error('cancelled');rows.push(...p.data);cursor=p.nextCursor;if(cursor&&seen.has(cursor))throw Error('cursor repeated');if(cursor)seen.add(cursor);}while(cursor);
   if(new Set(rows.map(t=>t.id)).size!==rows.length)throw Error('duplicate thread identity');
   const result=[];
   for(const t of rows.filter(t=>['active','systemError'].includes(t.status.type))){
    const row={id:t.id,name:t.name??'Codex 会话',parentThreadId:t.parentThreadId??null,status:t.status.type,activeFlags:t.status.activeFlags??[],runId:null,parentRunId:null,unknown:false};
    try{const {thread}=await manager.sendRequest('thread/read',{threadId:t.id,includeTurns:false});if(closed)throw Error('cancelled');if(!['active','systemError'].includes(thread.status.type))continue;row.status=thread.status.type;row.activeFlags=thread.status.activeFlags??[];
     if(row.status==='active'){const p=await manager.sendRequest('thread/turns/list',{threadId:t.id,sortDirection:'desc',limit:1,itemsView:'notLoaded'});if(closed)throw Error('cancelled');const latest=p.data[0];if(latest?.status==='inProgress')row.runId=latest.id;else row.unknown=true;}
    }catch{if(closed)throw Error('cancelled');row.status='unknown';row.activeFlags=[];row.unknown=true;}
    result.push(row);
   }
   return {threads:result,complete:!result.some(t=>t.unknown)};
  }finally{close();}
 };
 const result=await cdp.call('Runtime.evaluate',{expression:`(${read.toString()})(${JSON.stringify(key)},${JSON.stringify(moduleURL)})`,awaitPromise:true,returnByValue:true},sid);
 if(result.exceptionDetails||!result.result?.value)throw Error('catalog unavailable');
 process.stdout.write(JSON.stringify({...result.result.value,hostId:'local',mappedHost:host,hostPid:state.pid,backendPid:backends[0].pid})+'\n');
}catch{process.stdout.write(JSON.stringify({error:'Codex 当前任务读取不可用',threads:[],complete:false})+'\n');process.exitCode=1;}finally{await close();}
