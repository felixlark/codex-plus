import assert from 'node:assert/strict';
import {readFile,writeFile,realpath,lstat} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {validatePreparation,verifyCurrentTuple,readScopedExecution,measurePair} from './core.mjs';
const exec=promisify(execFile),hash=b=>createHash('sha256').update(b).digest('hex');
const SOURCE_NINE=['service/src/main.ts','service/src/notify/task-decision-host.ts','service/src/notify/decision-intake.ts','service/src/notify/signals.ts','service/src/desktop-execution/host.ts','service/src/desktop-execution/contracts.ts','service/src/notify/native-terminal.ts','service/src/notify/native-terminal-ledger.ts','service/src/desktop-execution/ledger.ts'];
let stage='arguments';
try{
 const [preparationPath,expectedHash,output]=process.argv.slice(2);
 assert(preparationPath&&/^[a-f0-9]{64}$/.test(expectedHash)&&output,'explicit_preparation_hash_and_output_required');
 stage='preparation';const bytes=await readFile(preparationPath);assert.equal(hash(bytes),expectedHash,'preparation_hash_changed');
 const p=validatePreparation(JSON.parse(bytes));
 const outputPath=resolve(output),logRoot=join(homedir(),'Library/Logs/me.longbiaochen.smart-shadow');
 const outputParent=await realpath(dirname(outputPath));assert(outputParent===logRoot||outputParent.startsWith(logRoot+'/'),'project_log_output_required');
 try{await lstat(outputPath);throw new Error('output_exists');}catch(error){assert.equal(error.code,'ENOENT','output_must_be_new');}
 const support=join(homedir(),'Library/Application Support/SmartShadow'),release=await realpath(p.publication.release_path);
 assert.equal(dirname(release),join(support,'releases'),'actual_installed_release_required');
 assert.equal(release,p.publication.release_path,'release_realpath_changed');
 assert.equal(await realpath(process.execPath),await realpath(join(release,'node-runtime/node')),'run_actual_release_node');
 assert.deepEqual(Object.keys(p.publication.source_nine).sort(),[...SOURCE_NINE].sort(),'exact_nine_source_scope');
 const api=join(homedir(),'Library/Application Support/dev-ops/bin/ss-api');
 const env={...process.env,LC_ALL:'C',TZ:'UTC'};
 // Promisified execFile buffers are explicitly unlimited; no new timeout/slot budget is introduced.
 async function command(file,args){const r=await exec(file,args,{env,maxBuffer:Infinity});assert.equal(r.stderr.trim(),'','readonly_command_stderr');return r.stdout.trim();}
 async function get(path){assert(path.startsWith('/api/v2/'));return JSON.parse(await command(api,['GET',path]));}
 async function processIdentity(expected){
  assert.equal(await command('/bin/ps',['-p',String(expected.pid),'-o','lstart=']),expected.birth,'process_birth_changed');
 }
 const context={};
 async function verifyContext(){
  stage='context_readback';assert.equal(hash(await readFile(preparationPath)),expectedHash,'preparation_changed');
  await processIdentity(p.node);await processIdentity(p.desktop);
  const expectedCommand=[join(release,'node-runtime/node'),join(release,'service/src/main.ts'),'--config',join(release,'service.json')].join(' ');
  assert.equal(await command('/bin/ps',['-p',String(p.node.pid),'-o','command=']),expectedCommand,'actual_node_release_changed');
  const database=join(support,'node-service/runtime/state.sqlite');
  const databaseOwners=new Set((await command('/usr/sbin/lsof',['-t','--',database])).split(/\s+/));
  const listeners=new Set((await command('/usr/sbin/lsof',['-nP','-t','-iTCP:18765','-sTCP:LISTEN'])).split(/\s+/));
  assert.deepEqual([...databaseOwners],[String(p.node.pid)],'actual_database_owner_changed');assert.deepEqual([...listeners],[String(p.node.pid)],'actual_listener_changed');
  const argv=await command('/bin/ps',['-p',String(p.desktop.pid),'-o','command=']);assert(argv.includes(p.desktop.app_path+'/Contents/MacOS/'),'desktop_process_changed');
  assert.equal(hash(await readFile(join(p.desktop.app_path,'Contents/Resources/app.asar'))),p.desktop.asar_sha256,'desktop_client_hash_changed');
  const manifestBytes=await readFile(join(release,'github-delivery-manifest.json'));assert.equal(hash(manifestBytes),p.publication.manifest_sha256,'release_manifest_changed');assert.equal(JSON.parse(manifestBytes).sha,p.publication.candidate_sha,'candidate_manifest_changed');
  const actualSources={};for(const relative of SOURCE_NINE){actualSources[relative]=hash(await readFile(join(release,relative)));assert.equal(actualSources[relative],p.publication.source_nine[relative],'installed_source_changed');}
  const ipcHashes={};for(const relative of ['service/src/desktop-execution/ipc.ts','service/src/desktop-execution/transport.ts'])ipcHashes[relative]=hash(await readFile(join(release,relative)));
  assert.equal(ipcHashes['service/src/desktop-execution/ipc.ts'],'a1320d92c8c9d4d8015371a4407733881fc235ecc1ca455eed09b22ce00a1492','reviewed393_ipc_changed');
  assert.equal(ipcHashes['service/src/desktop-execution/transport.ts'],'17a77388b4ed85b441d67aff20304178b994f3681f60c430ce1e9fcf0150f613','reviewed393_transport_changed');
  assert.equal(hash(await readFile(join(support,'runtime/channel-task-targets.json'))),p.registry.raw_hash,'registry_raw_changed');
  const runtime=await get('/api/v2/runtime');assert.deepEqual(runtime.client_service?.release,p.publication.runtime_client_service_release,'fresh_runtime_release_changed');
  const routing=await get('/api/v2/decision-intake/routing');assert.equal(routing.registry_hash,p.registry.hash,'fresh_registry_hash_changed');
  for(const t of p.targets){const task=await get('/api/v2/entities/tasks/'+t.task_id);assert.equal(task.id,t.task_id);assert.equal(task.project_id,t.project_id);const row=await readScopedExecution(t,(taskId,after)=>get('/api/v2/entities/tasks/'+taskId+'/executions'+(after?'?after='+encodeURIComponent(after):'')));verifyCurrentTuple(t,task,row);}
  Object.assign(context,{verified_at:new Date().toISOString(),release,manifest_sha256:p.publication.manifest_sha256,source_nine:actualSources,ipc_source_hashes:ipcHashes,node_binary_sha256:hash(await readFile(process.execPath)),desktop_asar_sha256:p.desktop.asar_sha256,registry:p.registry});
 }
 const result=await measurePair(p,{verifyContext,now:()=>new Date().toISOString(),connect:async()=>{
  stage='readonly_owner_discovery';const {DesktopIPC}=await import(pathToFileURL(join(release,'service/src/desktop-execution/ipc.ts')).href);const ipc=new DesktopIPC(join(homedir(),'.codex/ipc/ipc.sock'));
  try{await ipc.initialize();}catch(e){ipc.close();throw e;}
  return {clientId:ipc.clientId,ownerDiscovery:id=>ipc.request('thread-owner-discovery',1,{hostId:'local',conversationId:id}),close:()=>ipc.close()};
 }});
 stage='output';Object.assign(result,{preparation_sha256:expectedHash,actual_context:context});await writeFile(resolve(output),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({output:resolve(output),both_located_during_observation_window:result.both_located_during_observation_window,context_consistent:result.context_consistent}));
 if(!result.both_located_during_observation_window)process.exitCode=2;
}catch(error){console.error(JSON.stringify({code:'warm_pair_readonly_not_completed',stage,error_class:error?.name==='AssertionError'?'verification_rejected':'readback_unavailable'}));process.exitCode=2;}
