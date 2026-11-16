import assert from 'node:assert/strict';
import {isAbsolute} from 'node:path';
export const PUBLISHER='01a15a14-24dd-7363-9eba-2b2c72e2c930';
export const TARGETS=Object.freeze([
 Object.freeze({task_id:'transmission-channel-feishu-im',thread_id:'01a18a42-4ca1-73b3-8367-da2c709ad527',project_id:'transmission'}),
 Object.freeze({task_id:'transmission-channel-weixin',thread_id:'01a18a42-a777-79d3-b9d2-a50069d9c8c7',project_id:'transmission'}),
]);
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const text=x=>typeof x==='string'&&x.length>0;
export function validatePreparation(p){
 assert.equal(p?.schema,'ss393.warm-pair-preparation/v1','preparation_schema');
 assert.equal(p.publisher_thread_id,PUBLISHER,'publisher_identity');
 assert.equal(p.foreground_left_scope,'business_threads_not_current','foreground_left_scope');
 for(const flag of ['code_registry_p_ready','candidate_review_cleared','warm_navigation_complete','foreground_left'])assert.equal(p.readiness?.[flag],true,'not_ready:'+flag);
 assert(uuid(p.publication?.id)&&/^[a-f0-9]{40}$/.test(p.publication.candidate_sha),'publication_identity');
 assert(isAbsolute(p.publication.release_path)&&digest(p.publication.manifest_sha256),'publication_release');
 assert(p.publication.runtime_client_service_release!==undefined,'prepared_runtime_release_required');
 assert(p.publication.source_nine&&Object.values(p.publication.source_nine).every(digest),'prepared_source_pins');
 for(const identity of [p.node,p.desktop])assert(Number.isSafeInteger(identity?.pid)&&identity.pid>0&&text(identity.birth),'fresh_process_identity');
 assert(isAbsolute(p.desktop.app_path)&&p.desktop.app_path.endsWith('.app')&&digest(p.desktop.asar_sha256)&&text(p.desktop.version),'desktop_artifact_identity');
 assert(digest(p.registry?.hash)&&digest(p.registry?.raw_hash),'final_registry_hash');
 assert(Array.isArray(p.targets)&&p.targets.length===2,'target_scope');
 const seen=new Set();
 for(const t of p.targets){const allowed=TARGETS.find(a=>a.task_id===t.task_id);assert(allowed&&!seen.has(t.task_id),'target_scope');seen.add(t.task_id);
  assert.equal(t.thread_id,allowed.thread_id,'target_thread');assert.equal(t.project_id,allowed.project_id,'source_project');
  assert(text(t.codex_project_id)&&isAbsolute(t.cwd)&&uuid(t.binding_execution_id)&&Number.isSafeInteger(t.task_revision)&&t.task_revision>0&&Number.isSafeInteger(t.execution_revision)&&t.execution_revision>0,'fresh_current_tuple');
 }
 return p;
}
export function verifyCurrentTuple(t,task,row){
 assert.equal(task?.id,t.task_id,'source_task_changed');assert.equal(task.project_id,t.project_id,'source_project_changed');assert.equal(task.revision,t.task_revision,'task_revision_changed');
 assert(!task.needs_approval&&!['paused','cancelled','done','rejected'].includes(task.status),'task_not_admissible');
 assert.equal(row?.id,t.binding_execution_id,'execution_identity_changed');assert.equal(row.task_id,t.task_id,'execution_source_task');assert.equal(row.revision,t.execution_revision,'execution_revision_changed');
 for(const k of ['project_id','codex_project_id','thread_id','cwd'])assert.equal(row.project_binding?.[k],t[k],'current_binding_changed:'+k);
}
/** Task-scoped read only: never query an arbitrary execution UUID before checking its source Task. */
export async function readScopedExecution(t,getPage){
 let after=null;const seen=new Set();
 for(;;){const page=await getPage(t.task_id,after);assert(Array.isArray(page?.items),'task_execution_page');
  assert(page.items.every(row=>row.task_id===t.task_id),'execution_page_source_task');
  const found=page.items.find(row=>row.id===t.binding_execution_id);if(found)return found;
  const next=page.next_after;if(next===null||next===undefined)throw new Error('prepared_execution_not_in_source_task');
  assert(uuid(next)&&!seen.has(next),'execution_cursor_invalid');seen.add(next);after=next;
 }
}
/** Only injected readback and owner-discovery; this function cannot submit, navigate, bind or resume. */
export async function measurePair(preparation,ports){
 const p=validatePreparation(preparation);await ports.verifyContext(p); // gate precedes IPC creation
 const ipc=await ports.connect();const observations=[];
 try{
  for(const allowed of TARGETS){const t=p.targets.find(t=>t.task_id===allowed.task_id);const started=ports.now();
   const o={task_id:t.task_id,project_id:t.project_id,thread_id:t.thread_id,codex_project_id:t.codex_project_id,cwd:t.cwd,checked_at:started,resultType:null,handledByClientId:null,located:false};
   try{const reply=await ipc.ownerDiscovery(t.thread_id);o.resultType=['success','error'].includes(reply?.resultType)?reply.resultType:'invalid';o.handledByClientId=typeof reply?.handledByClientId==='string'?reply.handledByClientId:null;o.located=o.resultType==='success'&&!!o.handledByClientId;}
   catch(error){o.resultType='transport_error';o.error_class=['Unavailable','EffectUnknown'].includes(error?.name)?error.name:'probe_failed';}
   o.completed_at=ports.now();observations.push(o);
  }
 }finally{await ipc.close();}
 let context_consistent=true;try{await ports.verifyContext(p);}catch{context_consistent=false;}
 return {schema:'ss393.warm-pair-observation/v1',publication:p.publication,node:p.node,desktop:p.desktop,observer_client_id:ipc.clientId,
  observations,context_consistent,both_located_during_observation_window:context_consistent&&observations.every(o=>o.located),
  scope:{methods:['initialize/v0','thread-owner-discovery/v1'],load:false,resume:false,navigation:false,business:false,binding_write:false},
  foreground_left_scope:'business_threads_not_current',codex_app_os_foreground:'unknown',os_background_verified:false,
  business_delivery_verified:false,persistent_cold_recovery_verified:false};
}
