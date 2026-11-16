import {ReaderMessage} from '../channels/source-intake/message.ts';
import {currentSourceIdentityPreparation,SourceRegistration,SourceIdentityLedger,sourceIdentityEvidence,verifiedWireIdentity,verifiedLegacyIdentity,hasProviderHistory,knownProviderScope} from '../channels/source-intake/source-identity.ts';
import type Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {DomainError} from '../errors.ts';
import {digest as sourceDigest} from '../canonical.ts';
import {SourceVersion,CollectorDefinition} from '../contracts.ts';
type FormalQualification={task_id:string;purpose:'direct'|'exception';source_scope:('feishu_im'|'weixin'|'feishu_task'|'feishu_approval')[];source_evidence:any[]};
import {formalDecisionEligibility,formalDecisionTasks,providerDecisionTasks,parseFrozenSubmission} from './task-decision-host.ts';
import {decisionView} from './decision-view.ts';
import {channelRegistry,registryHash,resolveChannel,canonicalJson,parseRegistryJson,type ChannelRegistry} from './channel-routing.ts';

const key=z.string().min(1);
const identity=z.object({signal_id:key,revision:z.number().int().positive()}).strict();
export const target=z.object({host:key,thread_id:key,project_id:key,cwd:key}).strict();
type DecisionTarget=z.infer<typeof target>;
const routing=z.object({registry_hash:z.string().regex(/^[0-9a-f]{64}$/),registry_version:z.union([z.literal(1),z.literal(2)]),target_name:key,parent_delivery_id:z.uuid(),reason:key}).strict();
const signal=identity.extend({kind:key,causation_id:z.string().nullable().optional()}).passthrough();
const verifiedTarget=z.object({task_id:key,task_revision:z.number().int().positive(),binding:z.object({project_id:key,codex_project_id:key,thread_id:key,cwd:key}).strict(),verification:z.object({verifier:z.literal('official_thread_read'),cwd_matches:z.literal(true),project_matches:z.literal(true),codex_project_id:key}).strict()}).strict();
const envelope=z.object({schema:z.literal('smart-shadow.signal/v2'),delivery_id:z.string().uuid(),signals:z.array(signal).min(1)}).passthrough();
export const decisionInput=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('decision_enqueue'),target,envelope,routing:routing.optional()}).strict(),
 z.object({operation:z.literal('decision_enqueue_routed'),registry:z.unknown(),envelope,formal_registry_raw:z.string().optional()}).strict(),
 z.object({operation:z.literal('decision_formal_activation_status')}).strict(),
 z.object({operation:z.literal('decision_provider_activation_status'),registration_id:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict(),
 z.object({operation:z.literal('decision_provider_activate'),provider:z.enum(['feishu_task','feishu_approval']),registration_id:z.string().regex(/^[a-f0-9]{64}$/),registry_raw:z.string(),target_name:key,verified_target:verifiedTarget,observed_at:z.iso.datetime()}).strict(),
 z.object({operation:z.literal('decision_formal_activate'),registry_raw:z.string(),binding:z.object({project_id:key,codex_project_id:key,thread_id:key,cwd:key}).strict(),task_revision:z.number().int().positive(),verified_targets:z.record(z.enum(['feishu_im','weixin','exception']),verifiedTarget).optional(),observed_at:z.iso.datetime()}).strict(),
 z.object({operation:z.literal('decision_formal_claim'),paused_thread_ids:z.array(z.string()).default([])}).strict(),
 z.object({operation:z.literal('decision_formal_freeze'),wake_id:key,intent:z.record(z.string(),z.unknown())}).strict(),
 z.object({operation:z.literal('decision_formal_report'),wake_id:key,outcome:z.enum(['unknown','accepted']),execution_id:key.optional(),request_id:key.optional(),turn_id:key.optional(),evidence:z.record(z.string(),z.unknown()).optional()}).strict(),
 z.object({operation:z.literal('decision_claim'),paused_thread_ids:z.array(z.uuid().transform(v=>v.toLowerCase())).default([])}).strict(),
 z.object({operation:z.literal('decision_report'),wake_id:key,outcome:z.enum(['accepted','busy','unknown']),submission_id:key.optional(),turn_id:key.optional()}).strict(),
 z.object({operation:z.literal('decision_status'),delivery_id:z.string().uuid().optional()}).strict(),
 z.object({operation:z.literal('decision_view'),delivery_id:z.string().uuid()}).strict(),
 z.object({operation:z.literal('decision_source'),entity_id:key}).strict(),
 z.object({operation:z.literal('decision_source_identity'),signal_id:key,revision:z.number().int().positive(),wire_hash:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict(),
 z.object({operation:z.literal('decision_receipt'),receipt_id:key,stage:z.enum(['durable_received','host_completed','judged','owner_accepted','result','received']),items:z.array(identity).min(1),causation_id:key,evidence_ref:key,owner_ref:key.optional()}).strict(),
]);
const sha256=(s:string)=>createHash('sha256').update(s).digest('hex');
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
// JSON member order is not part of signal identity. Array order and every value are.
function canonical(v:unknown):unknown{
 if(Array.isArray(v))return v.map(canonical);
 if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,canonical(x)]));
 return v;
}
export function initializeDecisionIntake(db:Database.Database){
 db.exec(`CREATE TABLE IF NOT EXISTS decision_target(singleton INTEGER PRIMARY KEY CHECK(singleton=1),body_json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS decision_batches(delivery_id TEXT PRIMARY KEY,digest TEXT NOT NULL,envelope_json TEXT NOT NULL,wake_id TEXT NOT NULL UNIQUE,state TEXT NOT NULL DEFAULT 'queued',turn_id TEXT,submission_id TEXT);
 CREATE TABLE IF NOT EXISTS decision_items(signal_id TEXT NOT NULL,revision INTEGER NOT NULL,digest TEXT NOT NULL,delivery_id TEXT NOT NULL,wake_required INTEGER NOT NULL,PRIMARY KEY(signal_id,revision));
 CREATE TABLE IF NOT EXISTS decision_batch_items(delivery_id TEXT NOT NULL,signal_id TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(delivery_id,signal_id,revision));
 CREATE TABLE IF NOT EXISTS decision_receipts(receipt_id TEXT PRIMARY KEY,digest TEXT NOT NULL,body_json TEXT NOT NULL);`);
 // Additive migration: bind every legacy batch before a multi-target intake.
 const columns=db.prepare('PRAGMA table_info(decision_batches)').all() as {name:string}[];
 if(!columns.some(c=>c.name==='target_json'))db.exec('ALTER TABLE decision_batches ADD COLUMN target_json TEXT');
 if(!columns.some(c=>c.name==='routing_json'))db.exec('ALTER TABLE decision_batches ADD COLUMN routing_json TEXT');
 db.exec(`UPDATE decision_batches SET target_json=(SELECT body_json FROM decision_target WHERE singleton=1) WHERE target_json IS NULL;
 CREATE TABLE IF NOT EXISTS decision_consumers(thread_id TEXT PRIMARY KEY);
 INSERT OR IGNORE INTO decision_consumers SELECT json_extract(body_json,'$.thread_id') FROM decision_target;
 CREATE TABLE IF NOT EXISTS decision_routed_deliveries(delivery_id TEXT PRIMARY KEY,digest TEXT NOT NULL,registry_hash TEXT NOT NULL,children_json TEXT NOT NULL);`);
 db.exec(`CREATE TABLE IF NOT EXISTS decision_formal_activation(singleton INTEGER PRIMARY KEY CHECK(singleton=1),body_json TEXT NOT NULL);CREATE TABLE IF NOT EXISTS decision_formal_legacy_outbox(signal_id TEXT NOT NULL,revision INTEGER NOT NULL,row_hash TEXT NOT NULL,PRIMARY KEY(signal_id,revision));CREATE TABLE IF NOT EXISTS decision_formal_legacy_deliveries(delivery_id TEXT PRIMARY KEY,row_hash TEXT NOT NULL);CREATE TABLE IF NOT EXISTS decision_formal_legacy_batches(delivery_id TEXT PRIMARY KEY,row_hash TEXT NOT NULL);CREATE TABLE IF NOT EXISTS decision_formal_owned_deliveries(delivery_id TEXT PRIMARY KEY,envelope_hash TEXT NOT NULL);`);
 db.exec(`CREATE TABLE IF NOT EXISTS decision_formal_intents(delivery_id TEXT PRIMARY KEY,transport_kind TEXT NOT NULL,eligibility_json TEXT NOT NULL,eligibility_hash TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'fresh',intent_json TEXT,intent_hash TEXT,execution_id TEXT,request_id TEXT,evidence_json TEXT)`);
 // 独立版本化域；旧singleton/旧freeze协议与bytes不扩写。
 db.transaction(()=>{
  const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE name='decision_provider_metadata'").get();
  if(exists){const row=db.prepare("SELECT value FROM decision_provider_metadata WHERE key='schema'").get() as any;if(row?.value!=='1')throw new DomainError('provider_activation_schema_unsupported',409);}
  else if(db.prepare("SELECT 1 FROM sqlite_master WHERE name LIKE 'decision_provider_%'").get())throw new DomainError('provider_activation_namespace_collision',409);
  db.exec(`CREATE TABLE IF NOT EXISTS decision_provider_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS decision_provider_activations(domain_id TEXT PRIMARY KEY,provider TEXT NOT NULL,registration_id TEXT NOT NULL UNIQUE,body_json TEXT NOT NULL,body_hash TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS decision_provider_observations(domain_id TEXT NOT NULL,fact_id TEXT NOT NULL,source_ref TEXT NOT NULL,observation_revision INTEGER NOT NULL,state_hash TEXT NOT NULL,PRIMARY KEY(domain_id,fact_id));
   CREATE TABLE IF NOT EXISTS decision_provider_delivery_registry(delivery_id TEXT PRIMARY KEY,body_json TEXT NOT NULL,body_hash TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS decision_provider_observation_order ON decision_provider_observations(domain_id,source_ref,observation_revision);
   INSERT OR IGNORE INTO decision_provider_metadata VALUES('schema','1');`);
 })();
 db.exec('CREATE TABLE IF NOT EXISTS decision_replay_requests(delivery_id TEXT PRIMARY KEY,digest TEXT NOT NULL);');
}
/** Only called by SignalLedger inside the existing serial SQLite Worker transaction. */
export class DecisionIntakeLedger{
 private db:Database.Database;
 constructor(db:Database.Database){this.db=db;}
 run(raw:unknown):unknown{
  const c=decisionInput.parse(raw);
  if(c.operation==='decision_enqueue_routed')return this.route(c.envelope,c.registry,c.formal_registry_raw);
  if(c.operation==='decision_provider_activation_status'||c.operation==='decision_provider_activate')return this.provider(c);
  if(c.operation==='decision_formal_activation_status'||c.operation==='decision_formal_activate'||c.operation==='decision_formal_claim'||c.operation==='decision_formal_freeze'||c.operation==='decision_formal_report')return this.formal(c);
  if(c.operation==='decision_source_identity')return sourceIdentityEvidence(this.db,c.signal_id,c.revision,c.wire_hash);
  if(c.operation==='decision_source'){
   const row=this.db.prepare("SELECT body_json FROM signal_outbox WHERE json_extract(body_json,'$.entity_id')=? ORDER BY revision DESC LIMIT 1").get(c.entity_id) as any;
   if(!row)throw new DomainError('decision_source_signal_not_found',404);const raw=JSON.parse(row.body_json);
   return {entity_id:c.entity_id,signal_id:raw.signal_id,revision:raw.revision,source:raw.source,source_account:raw.source_account,source_ref:raw.source_ref};
  }
  if(c.operation==='decision_enqueue'){
   const binding=JSON.stringify(canonical(c.target));
   const current=this.db.prepare('SELECT body_json FROM decision_target WHERE singleton=1').get() as any;
   if(!c.routing&&current&&current.body_json!==binding)throw new DomainError('decision_target_conflict',409);
   if(!c.routing)this.db.prepare('INSERT OR IGNORE INTO decision_target VALUES(1,?)').run(binding);
   this.db.prepare('INSERT OR IGNORE INTO decision_consumers VALUES(?)').run(c.target.thread_id);
   const value=digest(canonical(c.envelope)),id=c.envelope.delivery_id;
   const old=this.db.prepare('SELECT digest,target_json,routing_json FROM decision_batches WHERE delivery_id=?').get(id) as any;
   if(old){if(old.digest!==value||old.target_json!==binding||old.routing_json!==(c.routing?canonicalJson(c.routing):null))throw new DomainError('decision_delivery_conflict',409);return this.status(id);}
   // A transport retry keeps delivery_id; overlapping batches share signal+revision.
   this.db.prepare('INSERT INTO decision_batches(delivery_id,digest,envelope_json,wake_id,target_json,routing_json) VALUES(?,?,?,?,?,?)').run(id,value,JSON.stringify(c.envelope),'decision:'+id,binding,c.routing?canonicalJson(c.routing):null);
   const seen=new Set<string>();
   for(const s of c.envelope.signals){
    const token=JSON.stringify([s.signal_id,s.revision]);
    if(seen.has(token))throw new DomainError('decision_duplicate_item',422);seen.add(token);
    const d=digest(canonical(s)),prior=this.db.prepare('SELECT digest FROM decision_items WHERE signal_id=? AND revision=?').get(s.signal_id,s.revision) as any;
    if(prior&&prior.digest!==d)throw new DomainError('decision_signal_conflict',409);
    const notificationItems=s.source==='codex'&&Array.isArray(s.native_notification_items)?s.native_notification_items:[];
    const alreadyReceived=notificationItems.length>0&&notificationItems.every((i:any)=>this.db.prepare("SELECT 1 FROM decision_receipts r,json_each(r.body_json,'$.items') j WHERE json_extract(r.body_json,'$.stage')='received' AND json_extract(j.value,'$.signal_id')=? AND json_extract(j.value,'$.revision')=?").get(i.signal_id,i.revision));
    const selfResult=s.source==='codex'&&(!!this.db.prepare('SELECT 1 FROM decision_consumers WHERE thread_id=?').get(s.origin_thread_id??'')||s.native_observation_only===true||alreadyReceived);
    this.db.prepare('INSERT OR IGNORE INTO decision_items VALUES(?,?,?,?,?)').run(s.signal_id,s.revision,d,id,selfResult?0:1);
    this.db.prepare('INSERT OR IGNORE INTO decision_batch_items VALUES(?,?,?)').run(id,s.signal_id,s.revision);
   }
   return this.status(id);
  }
  if(c.operation==='decision_view'){
   const batch=this.db.prepare('SELECT envelope_json FROM decision_batches WHERE delivery_id=?').get(c.delivery_id) as any;
   if(!batch)throw new DomainError('decision_delivery_not_found',404);
   const view=decisionView(JSON.parse(batch.envelope_json),batch.envelope_json,s=>{
    const row=this.db.prepare('SELECT body_json FROM signal_outbox WHERE signal_id=? AND revision=?').get(s.signal_id,s.revision) as any;
    const frozen=row?JSON.parse(row.body_json):undefined;
    const current=frozen?.entity_id?this.db.prepare("SELECT id,revision,source_version,content_hash,delivery_state,deleted_at,json_extract(body_json,'$.triage.routed_to') routed_to,json_extract(body_json,'$.triage.status') triage_status,json_extract(body_json,'$.triage.task_id') task_id,json_extract(body_json,'$.withdrawn') withdrawn,json_extract(body_json,'$.manual.control') manual_control,json_extract(body_json,'$.manual.expires_at') manual_expires_at FROM entity_message_entities WHERE id=?").get(frozen.entity_id):undefined;
    const bindings=frozen?.body?.native_result?this.db.prepare('SELECT b.receipt_id,r.body_json FROM native_terminal_bindings b JOIN native_terminal_observations o USING(identity) JOIN decision_receipts r USING(receipt_id) WHERE o.entity_id=? ORDER BY b.rowid').all(frozen.entity_id).map((row:any)=>{const r=JSON.parse(row.body_json);return {receipt_id:row.receipt_id,stage:r.stage,items:r.items,owner_ref:r.owner_ref??null};}):undefined;
    return {body:frozen?.body,current,nativeBindings:bindings};
   });
   return {...view,receipts:this.status(c.delivery_id).receipts};
  }
  if(c.operation==='decision_status')return this.status(c.delivery_id,!!c.delivery_id);
  if(c.operation==='decision_claim'){
   if(this.db.prepare('SELECT 1 FROM decision_formal_activation').get())throw new DomainError('formal_legacy_transport_disabled',409);
   // Unknown freezes its own wake, not unrelated identities. Native queueing is
   // safe while another turn is busy; no lease expiry or duplicate submission.
   const next=this.db.prepare("SELECT b.* FROM decision_batches b WHERE b.state='queued' AND lower(json_extract(b.target_json,'$.thread_id')) NOT IN (SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM decision_items i WHERE i.delivery_id=b.delivery_id AND i.wake_required=1) ORDER BY b.rowid LIMIT 1").get(JSON.stringify(c.paused_thread_ids)) as any;
   if(!next){const unresolved=this.db.prepare("SELECT * FROM decision_batches WHERE state IN ('submitting','unknown') ORDER BY rowid LIMIT 1").get() as any;return unresolved?{...this.work(unresolved),action:'reconcile'}:null;}
   this.db.prepare("UPDATE decision_batches SET state='submitting' WHERE delivery_id=?").run(next.delivery_id);
   return {...this.work(next),action:'submit'};
  }
  if(c.operation==='decision_report'){
   if(this.db.prepare('SELECT 1 FROM decision_formal_activation').get())throw new DomainError('formal_legacy_transport_disabled',409);
   const row=this.db.prepare('SELECT * FROM decision_batches WHERE wake_id=?').get(c.wake_id) as any;
   if(!row)throw new DomainError('decision_wake_not_found',404);
   if(c.outcome==='accepted'&&!c.submission_id)throw new DomainError('decision_submission_required',422);
   if(row.state==='accepted'){
    if(c.outcome==='accepted'&&row.submission_id?.startsWith('receipt:')&&c.submission_id){
     this.db.prepare('UPDATE decision_batches SET submission_id=?,turn_id=COALESCE(turn_id,?) WHERE wake_id=?').run(c.submission_id,c.turn_id??null,c.wake_id);return this.status(row.delivery_id);
    }
    if(c.outcome!=='accepted'||row.submission_id!==c.submission_id||(row.turn_id&&c.turn_id&&row.turn_id!==c.turn_id))throw new DomainError('decision_receipt_conflict',409);
    return this.status(row.delivery_id);
   }
   if(!['submitting','unknown'].includes(row.state))throw new DomainError('decision_attempt_not_started',409);
   // "busy" is only valid for a definitive no-effect atomic idle-only submission.
   // Once unknown, absence in history or a busy thread does not prove no effect.
   if(row.state==='unknown'&&c.outcome==='busy')throw new DomainError('decision_unknown_requires_reconciliation',409);
   this.db.prepare('UPDATE decision_batches SET state=?,turn_id=?,submission_id=? WHERE wake_id=?').run(c.outcome==='busy'?'queued':c.outcome,c.turn_id??null,c.submission_id??null,c.wake_id);
   return this.status(row.delivery_id);
  }
  const body=JSON.stringify(canonical(c)),d=digest(body);
  const old=this.db.prepare('SELECT digest FROM decision_receipts WHERE receipt_id=?').get(c.receipt_id) as any;
  if(old){if(old.digest!==d)throw new DomainError('decision_receipt_conflict',409);return {recorded:true,replayed:true};}
  if(['owner_accepted','result'].includes(c.stage)&&!c.owner_ref)throw new DomainError('decision_owner_required',422);
  const previous=this.db.prepare('SELECT body_json FROM decision_receipts').all().map((r:any)=>JSON.parse(r.body_json));
  const cause=previous.find(p=>p.receipt_id===c.causation_id);
  const predecessor={host_completed:['durable_received'],judged:['durable_received'],owner_accepted:['judged'],result:['owner_accepted'],received:['result','judged']} as const;
  if(c.stage==='durable_received'){
   const wake=this.db.prepare('SELECT * FROM decision_batches WHERE wake_id=?').get(c.causation_id) as any;
   if(!wake||!['accepted','submitting','unknown'].includes(wake.state))throw new DomainError('decision_cause_not_accepted',409);
   // An authenticated D receipt for the exact original wake is reconciliation
   // evidence even when the CLI persisted input but lost its stdout.
   if(wake.state!=='accepted'&&!this.db.prepare('SELECT 1 FROM decision_formal_intents WHERE delivery_id=?').get(wake.delivery_id)&&!this.db.prepare('SELECT 1 FROM decision_formal_legacy_batches WHERE delivery_id=?').get(wake.delivery_id))this.db.prepare("UPDATE decision_batches SET state='accepted',submission_id=? WHERE wake_id=?").run('receipt:'+c.receipt_id,c.causation_id);
  }else if(!cause||!(predecessor[c.stage] as readonly string[]).includes(cause.stage))throw new DomainError('decision_cause_not_found',409);
  if(c.stage==='result'&&cause.owner_ref!==c.owner_ref)throw new DomainError('decision_owner_conflict',409);
  for(const item of c.items){
   if(!this.db.prepare('SELECT 1 FROM decision_items WHERE signal_id=? AND revision=?').get(item.signal_id,item.revision))throw new DomainError('decision_item_not_found',404);
   if(c.stage==='durable_received'){
    if(!this.db.prepare('SELECT 1 FROM decision_batch_items bi JOIN decision_batches b USING(delivery_id) WHERE b.wake_id=? AND bi.signal_id=? AND bi.revision=?').get(c.causation_id,item.signal_id,item.revision))throw new DomainError('decision_cause_item_mismatch',409);
   }else if(!cause.items.some((i:any)=>i.signal_id===item.signal_id&&i.revision===item.revision))throw new DomainError('decision_cause_item_mismatch',409);
   // The unique handler is a persisted acceptance fact, never inferred by P.
   if(c.stage==='owner_accepted'&&previous.some(p=>p.stage==='owner_accepted'&&p.owner_ref!==c.owner_ref&&p.items.some((i:any)=>i.signal_id===item.signal_id&&i.revision===item.revision)))throw new DomainError('decision_owner_conflict',409);
   if(c.stage==='received'&&cause.stage==='judged'&&previous.some(p=>p.stage==='owner_accepted'&&p.items.some((i:any)=>i.signal_id===item.signal_id&&i.revision===item.revision)))throw new DomainError('decision_owner_result_required',409);
  }
  // Receipts are facts in this ledger, not new source signals: no self-wakeup.
  this.db.prepare('INSERT INTO decision_receipts VALUES(?,?,?)').run(c.receipt_id,d,body);
  return {recorded:true,replayed:false};
 }
 private providerDomains(provider?:'feishu_task'|'feishu_approval'){
  const rows=provider?this.db.prepare('SELECT * FROM decision_provider_activations WHERE provider=? ORDER BY domain_id').all(provider):this.db.prepare('SELECT * FROM decision_provider_activations ORDER BY domain_id').all();
  return (rows as any[]).map(row=>{
   if(sha256(row.body_json)!==row.body_hash)throw new DomainError('provider_activation_integrity',409);
   const body=JSON.parse(row.body_json);if(body.schema!=='smart-shadow.provider-task-activation/v1'||body.domain_id!==row.domain_id||body.provider!==row.provider||body.registration_id!==row.registration_id)throw new DomainError('provider_activation_integrity',409);
   return {...body,body_hash:row.body_hash};
  });
 }
 private provider(c:any){
  const domains=this.providerDomains();
  if(c.operation==='decision_provider_activation_status')return {domains:domains.filter(d=>!c.registration_id||d.registration_id===c.registration_id).map(d=>({...d,current_ready:!!currentSourceIdentityPreparation(this.db,d.registration_id)}))};
  const current=currentSourceIdentityPreparation(this.db,c.registration_id);if(!current||current.registration.provider!==c.provider)throw new DomainError('provider_current_factory_required',409);
  const r=current.registration,prefix=c.provider==='feishu_task'?'task':'approval';
  if(r.scope.scope_ref!==`${prefix}-user-visible/v1`||!r.scope.reader_revision.startsWith(`${prefix}-cli/v2:`)||!r.definition.config_revision.startsWith(`${prefix}/v2:`))throw new DomainError('provider_current_version_conflict',409);
  const registry=channelRegistry.parse(parseRegistryJson(c.registry_raw)),account=r.scope.account;
  const name=registry.schema_version===2&&Object.hasOwn(registry.provider_sources.feishu??{},account)?registry.provider_sources.feishu![account]?.[c.provider as keyof typeof providerDecisionTasks]:undefined;
  const t=typeof name==='string'?registry.targets[name]:undefined,b=c.verified_target.binding,v=c.verified_target.verification;
  if(name!==c.target_name||t?.task_id!==providerDecisionTasks[c.provider as keyof typeof providerDecisionTasks]||c.verified_target.task_id!==t.task_id||b.project_id!=='transmission'
   ||canonicalJson({host:t.host,thread_id:t.thread_id,project_id:t.project_id,cwd:t.cwd})!==canonicalJson({host:'local',thread_id:b.thread_id,project_id:b.codex_project_id,cwd:b.cwd})
   ||v.verifier!=='official_thread_read'||v.cwd_matches!==true||v.project_matches!==true||v.codex_project_id!==b.codex_project_id)throw new DomainError('provider_activation_target_conflict',409);
  if(domains.some(d=>d.provider===c.provider&&d.producer?.scope?.account===account&&d.producer?.scope?.scope_ref===r.scope.scope_ref&&d.registration_id!==c.registration_id))throw new DomainError('provider_activation_successor_required',409);
  const old=domains.find(d=>d.registration_id===c.registration_id);
  if(old){if(old.provider!==c.provider||canonicalJson(old.producer)!==canonicalJson(r)||old.target_name!==c.target_name||canonicalJson(old.target)!==canonicalJson(t)||canonicalJson(old.verified_target.binding)!==canonicalJson(b))throw new DomainError('provider_activation_rebind_forbidden',409);return {activation:old,replayed:true};}
  // 首次域只在真实OFF/物理attempt已结之后；普通合法ON重启在上分支返回。
  const control=this.db.prepare('SELECT enabled,available FROM collector_controls WHERE collector_ref=?').get(r.definition.collector_ref) as any;
  const schedule=this.db.prepare('SELECT active_operation FROM collector_schedules WHERE collector_ref=?').get(r.definition.collector_ref) as any;
  if(!control||control.enabled!==0||control.available!==1||!schedule||schedule.active_operation!==null
   ||this.db.prepare("SELECT 1 FROM collector_attempts WHERE collector_ref=? AND state<>'settled' LIMIT 1").get(r.definition.collector_ref)
   ||this.db.prepare('SELECT 1 FROM x_process_attempts x JOIN collector_attempts a USING(attempt_ref) WHERE a.collector_ref=? AND (x.accepting<>0 OR x.stopped_receipt IS NULL) LIMIT 1').get(r.definition.collector_ref))throw new DomainError('provider_activation_source_not_stopped',409);
  const frontier=this.db.prepare("SELECT seq FROM sqlite_sequence WHERE name='entity_audit_events'").get() as any;
  const sequence=frontier?.seq??0;if(!Number.isSafeInteger(sequence)||sequence<0)throw new DomainError('provider_activation_allocator_unknown',409);
  const entities=(this.db.prepare('SELECT id,source_ref,body_json FROM entity_message_entities WHERE source=? AND source_account=? ORDER BY id').all(r.scope.source,account) as any[]).filter(e=>{try{return JSON.parse(e.source_ref)[0]===r.scope.scope_ref;}catch{return false;}});
  const observation_origins:any[]=[],captures:any[]=[],heads=new Map<string,{source_ref:string;observation_revision:number;state_hash:string}>();
  const remember=(ref:string,metadata:any)=>{
   if(!metadata||metadata.provider!==c.provider||!Number.isSafeInteger(metadata.observation_revision)||metadata.observation_revision<1||!(/^[a-f0-9]{64}$/.test(metadata.state_hash??'')))return;
   const old=heads.get(ref);if(!old||metadata.observation_revision>old.observation_revision)heads.set(ref,{source_ref:ref,observation_revision:metadata.observation_revision,state_hash:metadata.state_hash});
   else if(old.observation_revision===metadata.observation_revision&&old.state_hash!==metadata.state_hash)throw new DomainError('provider_observation_boundary_conflict',409);
  };
  for(const e of entities){
   const row=this.db.prepare('SELECT id FROM source_identity_facts WHERE entity_id=?').get(e.id) as any;
   const proof=row?new SourceIdentityLedger(this.db).readonlyCommittedFact(row.id):null;
   const receipt=this.db.prepare("SELECT payload_hash,response_json FROM entity_write_receipts WHERE actor='l1-source-intake' AND idempotency_key=?").get('intake:'+e.id) as any;
   const audits=this.db.prepare("SELECT sequence,request_id FROM entity_audit_events WHERE object_type='message-entities' AND object_id=? AND actor='l1-source-intake' AND idempotency_key=? AND action='create' AND before_revision IS NULL AND after_revision=1 AND result='committed'").all(e.id,'intake:'+e.id) as any[];
   if(!proof||!receipt||audits.length!==1||!(/^[a-f0-9]{64}$/.test(receipt.payload_hash)))throw new DomainError('provider_observation_original_unknown',409);
   const original=JSON.parse(receipt.response_json),fact=proof.fact;
   const projection=sourceDigest([original.source,original.source_account,original.source_ref,original.source_version,original.content_hash,original.occurred_at,original.body?.message,original.body?.sender,original.body?.withdrawn,original.body?.reader_metadata??null]);
   if(original.id!==e.id||original.source_ref!==e.source_ref||original.source!==r.scope.source||original.source_account!==account||original.revision!==1||original.body?.processing_version!=='l1-source-intake/v1'||fact.provider!==c.provider||fact.source_version!==original.source_version||fact.l1_hash!==original.content_hash||fact.l1_projection_hash!==projection||audits[0].request_id!=='intake:'+fact.page_id)throw new DomainError('provider_observation_original_conflict',409);
   remember(original.source_ref,original.body.reader_metadata);
   observation_origins.push({entity_id:e.id,fact_id:row.id,creation_sequence:audits[0].sequence,creation_payload_hash:receipt.payload_hash,creation_receipt_hash:sourceDigest(original)});
  }
  const scopeBindings=new Set([current.preparation.scope_binding]);
  for(const row of this.db.prepare('SELECT body_json FROM source_identity_registrations').all() as any[]){try{const old=JSON.parse(row.body_json);if(old.provider===c.provider&&old.scope?.source===r.scope.source&&old.scope?.account===account&&old.scope?.scope_ref===r.scope.scope_ref)scopeBindings.add(sourceDigest(old.scope));}catch{/* 无关损坏row不替当前factory签权。 */}}
  for(const table of ['source_intake_pending','source_intake_quarantine']){
   const rows=this.db.prepare(`SELECT p.*,s.scope_binding FROM ${table} p JOIN source_intake_streams s USING(stream_ref) WHERE s.account_binding=? ORDER BY p.stream_ref,p.page_id`).all(sourceDigest([r.scope.source,account])) as any[];
   for(const row of rows){
    if(!scopeBindings.has(row.scope_binding)){captures.push({table,stream_ref:row.stream_ref,page_id:row.page_id,payload_hash:row.payload_hash,entity_ids:[],unclassified_scope:true});continue;}
    if(sha256(row.payload_json)!==row.payload_hash)throw new DomainError('provider_capture_boundary_unknown',409);
    const captured=new SourceIdentityLedger(this.db).readonlyCapturedPage(row.page_id);if(!captured||captured.page.payload_hash!==row.payload_hash||captured.registration.provider!==c.provider||captured.registration.scope.source!==r.scope.source||captured.registration.scope.account!==account||captured.registration.scope.scope_ref!==r.scope.scope_ref)throw new DomainError('provider_capture_boundary_unverified',409);
    let items:any;try{items=JSON.parse(row.payload_json).items;}catch{throw new DomainError('provider_capture_boundary_unknown',409);}if(!Array.isArray(items))throw new DomainError('provider_capture_boundary_unknown',409);
    const ids:string[]=[];
    for(const item of items){const parsed=ReaderMessage.safeParse(item?.message);if(!parsed.success||parsed.data.source!==r.scope.source||parsed.data.account!==account||parsed.data.conversation_id!==r.scope.scope_ref)throw new DomainError('provider_capture_boundary_unknown',409);
     const m=parsed.data,ref=JSON.stringify([m.conversation_id,m.object_id]),entity_id='message_'+sourceDigest([m.source,m.account,ref,m.revision]);
     const expected={entity_id,source:m.source,source_account:m.account,source_ref:ref,source_version:m.revision,l1_hash:item.original_ref?.sha256,l1_projection_hash:sourceDigest([m.source,m.account,ref,m.revision,item.original_ref?.sha256,m.occurred_at,m.text,m.sender,m.withdrawn??false,m.reader_metadata??null])};
     if(captured.messages.filter((v:any)=>canonicalJson(v)===canonicalJson(expected)).length!==1)throw new DomainError('provider_capture_projection_conflict',409);
     ids.push(entity_id);remember(ref,m.reader_metadata);}
    captures.push({table,stream_ref:row.stream_ref,page_id:row.page_id,payload_hash:row.payload_hash,entity_ids:[...new Set(ids)].sort()});
   }
  }
  const ids=(table:string,key:string)=>(this.db.prepare(`SELECT ${key} AS id FROM ${table} ORDER BY ${key}`).all() as any[]).map(row=>row.id);
  const boundary={schema:'provider-observation-boundary/v1',entity_audit_sequence:sequence,entity_ids:entities.map(e=>e.id),fact_ids:ids('source_identity_facts','id'),page_ids:ids('source_identity_pages','page_id'),attempt_ids:ids('x_process_attempts','attempt_ref'),request_ids:ids('x_process_requests','request_ref'),observation_origins,captures,observations:[...heads.values()].sort((a,b)=>a.source_ref.localeCompare(b.source_ref))};
  const domain_id=sourceDigest([c.provider,c.registration_id,c.target_name,t,b]),body={schema:'smart-shadow.provider-task-activation/v1',domain_id,provider:c.provider,registration_id:c.registration_id,producer:r,prepared_context:current.preparation,observed_at:c.observed_at,target_name:c.target_name,target:t,verified_target:c.verified_target,registry_raw:c.registry_raw,registry_raw_hash:sha256(c.registry_raw),registry_hash:registryHash(registry),boundary};
  const bytes=canonicalJson(body);this.db.prepare('INSERT INTO decision_provider_activations VALUES(?,?,?,?,?)').run(domain_id,c.provider,c.registration_id,bytes,sha256(bytes));return {activation:{...body,body_hash:sha256(bytes)},replayed:false};
 }
 /** 旧首次采用只分类保护provider；不签身份、不改provider或旧既有行。 */
 private legacyProviderIsolation(){
  const scoped=(signal:any)=>!!signal&&typeof signal==='object'&&(Object.hasOwn(signal,'source_provider')||knownProviderScope(signal.source,signal.source_ref)||hasProviderHistory(this.db,signal.signal_id,signal.entity_id)||['feishu_task','feishu_approval'].includes(signal.body?.reader_metadata?.provider));
  const envelope=(raw:string)=>{try{const value=JSON.parse(raw);if(!Array.isArray(value.signals))throw new Error();return value.signals as any[];}catch{throw new DomainError('formal_provider_lineage_unknown',409);}};
  const deliveries=new Set<string>(),batches=new Set<string>(),scopeBindings=new Map<string,{provider:string;source:string;account:string;logical_scope:string}>(),registrations=new Map<string,any>(),capturedPages=new Map<string,any>();
  for(const row of this.db.prepare('SELECT * FROM decision_provider_delivery_registry').all() as any[]){
   try{const value=JSON.parse(row.body_json);if(sha256(row.body_json)!==row.body_hash||value.schema!=='provider-delivery-registry/v1'||!Array.isArray(value.provider_items))throw new Error();deliveries.add(row.delivery_id);}catch{throw new DomainError('formal_provider_lineage_unknown',409);}
  }
  for(const row of this.db.prepare('SELECT delivery_id,envelope_json FROM signal_deliveries').all() as any[])if(envelope(row.envelope_json).some(scoped))deliveries.add(row.delivery_id);
  for(const row of this.db.prepare('SELECT delivery_id,children_json FROM decision_routed_deliveries').all() as any[])if(deliveries.has(row.delivery_id)){
   try{const children=JSON.parse(row.children_json);if(!Array.isArray(children)||children.some(v=>typeof v!=='string'))throw new Error();for(const id of children)batches.add(id);}catch{throw new DomainError('formal_provider_lineage_unknown',409);}
  }
  for(const row of this.db.prepare('SELECT delivery_id,envelope_json FROM decision_batches').all() as any[])if(envelope(row.envelope_json).some(scoped))batches.add(row.delivery_id);
  for(const row of this.db.prepare('SELECT delivery_id,eligibility_json,eligibility_hash FROM decision_formal_intents').all() as any[]){
   try{const value=JSON.parse(row.eligibility_json);if(sha256(row.eligibility_json)!==row.eligibility_hash||!Array.isArray(value.source_scope))throw new Error();if(value.source_scope.some((v:any)=>['feishu_task','feishu_approval'].includes(v)))batches.add(row.delivery_id);}catch{throw new DomainError('formal_provider_lineage_unknown',409);}
  }
  const rememberScope=(r:any)=>{const logical_scope=(r.provider==='feishu_task'?'task':'approval')+'-user-visible/v1';if(r.scope.source!=='feishu'||r.scope.scope_ref!==logical_scope)throw new DomainError('formal_provider_lineage_unknown',409);const key=sourceDigest(r.scope),value={provider:r.provider,source:r.scope.source,account:r.scope.account,logical_scope};const old=scopeBindings.get(key);if(old&&canonicalJson(old)!==canonicalJson(value))throw new DomainError('formal_provider_lineage_unknown',409);scopeBindings.set(key,value);};
  for(const domain of this.providerDomains()){const r=SourceRegistration.parse(domain.producer);if(sourceDigest(r)!==domain.registration_id)throw new DomainError('formal_provider_lineage_unknown',409);rememberScope(r);}
  if(this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='source_identity_registrations'").get())for(const row of this.db.prepare('SELECT id,body_json FROM source_identity_registrations').all() as any[]){
   try{const r=SourceRegistration.parse(JSON.parse(row.body_json));if(sourceDigest(r)!==row.id)throw new Error();rememberScope(r);registrations.set(row.id,r);}catch{throw new DomainError('formal_provider_lineage_unknown',409);}
  }
  if(this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='source_identity_pages'").get())for(const row of this.db.prepare('SELECT page_id,registration_id,stream_ref,scope_binding,payload_hash FROM source_identity_pages').all() as any[]){
   const r=registrations.get(row.registration_id);if(!r||sourceDigest(r.scope)!==row.scope_binding||!(/^[a-f0-9]{64}$/.test(row.payload_hash)))throw new DomainError('formal_provider_lineage_unknown',409);
   capturedPages.set(row.page_id,row);
  }
  return {scoped,deliveries,batches,scopeBindings,capturedPages};
 }
 private formal(c:any):unknown{
  const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
  if(c.operation==='decision_formal_activation_status'){const old=this.db.prepare('SELECT body_json FROM decision_formal_activation WHERE singleton=1').get() as any;return old?JSON.parse(old.body_json):null;}
  if(c.operation==='decision_formal_activate'){
   const old=this.db.prepare('SELECT body_json FROM decision_formal_activation WHERE singleton=1').get() as any;
   if(old)return {...JSON.parse(old.body_json),replayed:true};
   const registry=channelRegistry.parse(parseRegistryJson(c.registry_raw)),t=registry.targets.feishu_im;
   if(t?.task_id!=='transmission-channel-feishu-im'||t.host!=='local'||t.thread_id!==c.binding.thread_id||t.project_id!==c.binding.codex_project_id||t.cwd!==c.binding.cwd||c.binding.project_id!=='transmission')throw new DomainError('formal_activation_binding_conflict',409);
   if(c.verified_targets!==undefined){
    if(canonicalJson(Object.keys(c.verified_targets).sort())!==canonicalJson(Object.keys(formalDecisionTasks).sort()))throw new DomainError('formal_activation_target_set_conflict',409);
    for(const name of Object.keys(formalDecisionTasks) as (keyof typeof formalDecisionTasks)[]){
     const observed=c.verified_targets[name],configured=registry.targets[name],v=observed?.verification,b=observed?.binding;
     if(observed?.task_id!==formalDecisionTasks[name]||configured?.task_id!==formalDecisionTasks[name]||!Number.isSafeInteger(observed.task_revision)||observed.task_revision<1||b?.project_id!=='transmission'||canonicalJson({host:'local',thread_id:b?.thread_id,project_id:b?.codex_project_id,cwd:b?.cwd})!==canonicalJson({host:configured?.host,thread_id:configured?.thread_id,project_id:configured?.project_id,cwd:configured?.cwd})||v?.verifier!=='official_thread_read'||v.cwd_matches!==true||v.project_matches!==true||v.codex_project_id!==b.codex_project_id)throw new DomainError('formal_activation_target_binding_conflict',409);
    }
    if(c.verified_targets.feishu_im.task_revision!==c.task_revision||canonicalJson(c.verified_targets.feishu_im.binding)!==canonicalJson(c.binding))throw new DomainError('formal_activation_im_proof_conflict',409);
   }
   const provider=this.legacyProviderIsolation();
   let outbox=0,deliveries=0,batches=0;
   let signalId='',revision=0;for(;;){const row=this.db.prepare("SELECT * FROM signal_outbox WHERE state='pending' AND (signal_id>? OR (signal_id=? AND revision>?)) ORDER BY signal_id,revision LIMIT 1").get(signalId,signalId,revision) as any;if(!row)break;signalId=row.signal_id;revision=row.revision;
    let raw:any;try{raw=JSON.parse(row.body_json);}catch{throw new DomainError('formal_provider_lineage_unknown',409);}if(provider.deliveries.has(row.delivery_id)||provider.scoped(raw))continue;
    this.db.prepare('INSERT INTO decision_formal_legacy_outbox VALUES(?,?,?)').run(row.signal_id,row.revision,sha(canonicalJson(row)));outbox++;
   }
   let deliveryId='';for(;;){const row=this.db.prepare("SELECT * FROM signal_deliveries WHERE state='pending' AND delivery_id>? ORDER BY delivery_id LIMIT 1").get(deliveryId) as any;if(!row)break;deliveryId=row.delivery_id;if(provider.deliveries.has(row.delivery_id))continue;
    this.db.prepare('INSERT INTO decision_formal_legacy_deliveries VALUES(?,?)').run(row.delivery_id,sha(canonicalJson(row)));deliveries++;
   }
   deliveryId='';for(;;){const row=this.db.prepare('SELECT * FROM decision_batches WHERE delivery_id>? ORDER BY delivery_id LIMIT 1').get(deliveryId) as any;if(!row)break;deliveryId=row.delivery_id;if(provider.batches.has(row.delivery_id))continue;
    this.db.prepare('INSERT INTO decision_formal_legacy_batches VALUES(?,?)').run(row.delivery_id,sha(canonicalJson(row)));batches++;
   }
   // A durable producer-version boundary, not occurred_at/updated_at or outbox revision.
   // Existing activations are returned above byte-for-byte and are never backfilled.
   const frontier=(table:'entity_audit_events'|'source_versions')=>{
    const exists=this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
    if(!exists)return 0;
    // Both production tables use INTEGER PRIMARY KEY AUTOINCREMENT. The allocator
    // survives row retention; MAX(rows) alone could forget a deleted high watermark.
    const sequence=(this.db.prepare('SELECT seq FROM sqlite_sequence WHERE name=?').get(table) as any)?.seq??0;
    if(!Number.isSafeInteger(sequence)||sequence<0)throw new DomainError('formal_native_boundary_unknown',409);
    return sequence;
   };
   // stage() durably captures native versions before their entity projection. Capture
   // both pending and quarantined pages in this same SQLite transaction; retain their
   // version keys, so changing pages or completing materials cannot make them new.
   const captures:{table:string;stream_ref:string;page_id:string;payload_hash:string;entity_ids:string[]}[]=[];
   for(const table of ['source_intake_pending','source_intake_quarantine']){
    if(!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
    for(const account of Object.keys(registry.sources.feishu??{}).sort()){
     const rows=this.db.prepare(`SELECT p.stream_ref,p.page_id,p.payload_json,p.payload_hash,s.scope_binding AS capture_scope_binding FROM ${table} p JOIN source_intake_streams s USING(stream_ref) WHERE s.account_binding=? ORDER BY p.stream_ref,p.page_id`).all(sourceDigest(['feishu',account])) as any[];
     for(const row of rows){
      if(typeof row.payload_json!=='string'||sha(row.payload_json)!==row.payload_hash)throw new DomainError('formal_native_capture_unknown',409);
      let items:any;try{items=JSON.parse(row.payload_json).items;}catch{throw new DomainError('formal_native_capture_unknown',409);}
      if(!Array.isArray(items))throw new DomainError('formal_native_capture_unknown',409);
      const ids:string[]=[],providerScopes=new Set<string>(),taggedProviders=new Set<string>();let ordinary=false;
      for(const item of items){
       const parsed=ReaderMessage.safeParse(item?.message);
       if(!parsed.success||parsed.data.source!=='feishu'||parsed.data.account!==account)throw new DomainError('formal_native_capture_unknown',409);
       const m=parsed.data,ref=JSON.stringify([m.conversation_id,m.object_id]);if(knownProviderScope(m.source,ref))providerScopes.add(m.conversation_id);else ordinary=true;
       if(['feishu_task','feishu_approval'].includes(m.reader_metadata?.provider as any))taggedProviders.add(m.reader_metadata!.provider as string);
       ids.push('message_'+sourceDigest([m.source,m.account,ref,m.revision]));
      }
      const signed=provider.capturedPages.get(row.page_id);if(signed&&(signed.stream_ref!==row.stream_ref||signed.scope_binding!==row.capture_scope_binding||signed.payload_hash!==row.payload_hash))throw new DomainError('formal_provider_capture_scope_unknown',409);
      const declared=provider.scopeBindings.get(row.capture_scope_binding),suspected=!!declared||!!signed||providerScopes.size>0||taggedProviders.size>0;
      if(suspected&&(!declared||declared.account!==account||declared.source!=='feishu'||JSON.parse(row.payload_json).scope_binding!==row.capture_scope_binding||ordinary||[...providerScopes].some(scope=>scope!==declared.logical_scope)||[...taggedProviders].some(kind=>kind!==declared.provider)))throw new DomainError('formal_provider_capture_scope_unknown',409);
      if(suspected)continue;
      captures.push({table,stream_ref:row.stream_ref,page_id:row.page_id,payload_hash:row.payload_hash,entity_ids:[...new Set(ids)].sort()});
     }
    }
   }
   const native_creation_boundary={schema:'producer-observation-boundary/v2',entity_audit_sequence:frontier('entity_audit_events'),source_version_sequence:frontier('source_versions'),captures};
   const proof={native_creation_boundary,transport_kind:'formal_task/v1',custodian:'decision-task-host',observed_at:c.observed_at,registry_hash:registryHash(registry),registry_raw_hash:sha(c.registry_raw),binding:c.binding,task_revision:c.task_revision,...(c.verified_targets===undefined?{}:{verified_targets:c.verified_targets}),inventory:{pending_outbox:outbox,pending_deliveries:deliveries,existing_batches:batches}};
   this.db.prepare('INSERT INTO decision_formal_activation VALUES(1,?)').run(canonicalJson(proof));return {...proof,replayed:false};
  }
  if(c.operation==='decision_formal_claim'){
   const rows=this.db.prepare("SELECT f.*,b.wake_id,b.target_json,b.envelope_json,b.routing_json,b.turn_id,b.submission_id FROM decision_formal_intents f JOIN decision_batches b USING(delivery_id) WHERE f.state<>'verified' AND EXISTS(SELECT 1 FROM decision_items i WHERE i.delivery_id=f.delivery_id AND i.wake_required=1) ORDER BY CASE f.state WHEN 'fresh' THEN 0 WHEN 'prepared' THEN 1 ELSE 2 END,f.rowid").all() as any[];
   for(const row of rows){
    if(c.paused_thread_ids.includes(JSON.parse(row.target_json).thread_id))continue;
    if(sha(row.eligibility_json)!==row.eligibility_hash)throw new DomainError('formal_eligibility_corrupt',409);
    if(row.state==='prepared'){
     this.db.prepare("UPDATE decision_formal_intents SET state='submitting' WHERE delivery_id=? AND state='prepared'").run(row.delivery_id);
     this.db.prepare("UPDATE decision_batches SET state='submitting' WHERE delivery_id=?").run(row.delivery_id);
    }
    return {...this.work(row),eligibility:JSON.parse(row.eligibility_json),intent:row.intent_json?JSON.parse(row.intent_json):null,execution_id:row.execution_id,request_id:row.request_id,action:row.state==='fresh'?'prepare':row.state==='prepared'?'submit':'reconcile'};
   }
   return null;
  }
  const row=this.db.prepare('SELECT f.*,b.wake_id FROM decision_formal_intents f JOIN decision_batches b USING(delivery_id) WHERE b.wake_id=?').get(c.wake_id) as any;
  if(!row)throw new DomainError('formal_wake_not_found',404);
  if(c.operation==='decision_formal_freeze'){
   const intent=c.intent,eligibility=JSON.parse(row.eligibility_json);
   const input=parseFrozenSubmission(intent);
   if(intent.eligibility_hash!==row.eligibility_hash||intent.binding?.thread_id!==eligibility.target.thread_id||intent.binding?.cwd!==eligibility.target.cwd||intent.binding?.codex_project_id!==eligibility.target.project_id||intent.binding?.project_id!=='transmission'||input.transport!=='desktop')throw new DomainError('formal_binding_conflict',409);
   if(sha(row.eligibility_json)!==row.eligibility_hash||intent.transport_kind!=='formal_task/v1'||intent.wake_id!==row.wake_id||intent.task_id!==eligibility.task_id||intent.intent_id!=='formal:'+row.delivery_id||intent.idempotency_key!==intent.intent_id||intent.actor!=='decision-task-host'||typeof intent.submission_json!=='string'||sha(intent.submission_json)!==intent.submission_hash)throw new DomainError('formal_intent_conflict',409);
   const bytes=canonicalJson(intent);
   if(row.intent_json){if(bytes!==row.intent_json)throw new DomainError('formal_intent_conflict',409);return {frozen:true,replayed:true};}
   if(row.state!=='fresh')throw new DomainError('formal_intent_state_conflict',409);
   this.db.prepare("UPDATE decision_formal_intents SET intent_json=?,intent_hash=?,state='prepared' WHERE delivery_id=?").run(bytes,sha(bytes),row.delivery_id);
   return {frozen:true,replayed:false};
  }
  if(!['submitting','unknown','verified'].includes(row.state)||!row.intent_json||sha(row.intent_json)!==row.intent_hash)throw new DomainError('formal_attempt_not_started',409);
  if(row.execution_id&&c.execution_id&&row.execution_id!==c.execution_id||row.request_id&&c.request_id&&row.request_id!==c.request_id)throw new DomainError('formal_execution_conflict',409);
  if(c.outcome==='accepted'&&(!c.execution_id||!c.request_id||!c.turn_id||!c.evidence||c.evidence.verifier!=='official_thread_read'||c.evidence.execution_id!==c.execution_id||c.evidence.request_id!==c.request_id||c.evidence.turn_id!==c.turn_id||c.evidence.submission_hash!==JSON.parse(row.intent_json).submission_hash))throw new DomainError('formal_input_evidence_required',422);
  if(row.state==='verified'&&(c.outcome!=='accepted'||row.evidence_json!==canonicalJson(c.evidence)))throw new DomainError('formal_evidence_conflict',409);
  this.db.prepare('UPDATE decision_formal_intents SET state=?,execution_id=COALESCE(execution_id,?),request_id=COALESCE(request_id,?),evidence_json=COALESCE(?,evidence_json) WHERE delivery_id=?').run(c.outcome==='accepted'?'verified':'unknown',c.execution_id??null,c.request_id??null,c.evidence?canonicalJson(c.evidence):null,row.delivery_id);
  this.db.prepare('UPDATE decision_batches SET state=?,submission_id=COALESCE(submission_id,?),turn_id=COALESCE(turn_id,?) WHERE delivery_id=?').run(c.outcome,c.execution_id??null,c.turn_id??null,row.delivery_id);
  return {recorded:true};
 }
 /** 原生资格来自实际P创建及完整受支持写入链；外部PATCH/新建都不能自签来源。
  * signal revision不等于entity revision，故不按二者数值/时间猜测对应关系。
  * 已冻结delivery在route前段直接重放，不以当前历史重算既有intent。 */
 private sourceOrigin(signal:any,providerOrigin?:{fact:any;boundary:any}):{raw:any;entity:any;creation:any;original:any;origin_hash:string;native_creation_sequence:number;native_creation_boundary_hash:string}|null{
  try{
   const outbox=this.db.prepare('SELECT body_json FROM signal_outbox WHERE signal_id=? AND revision=?').get(signal.signal_id,signal.revision) as any;
   if(!outbox)return null;const raw=JSON.parse(outbox.body_json);
   const entity=this.db.prepare('SELECT * FROM entity_message_entities WHERE id=?').get(raw.entity_id) as any;
   if(!entity||entity.deleted_at!==null||entity.source!==signal.source||entity.source_account!==signal.source_account||entity.source_ref!==signal.source_ref)return null;
   const creation=this.db.prepare('SELECT payload_hash,response_json FROM entity_write_receipts WHERE actor=? AND idempotency_key=?').get('l1-source-intake','intake:'+entity.id) as any;
   if(!creation||!(/^[a-f0-9]{64}$/.test(creation.payload_hash)))return null;
   const original=JSON.parse(creation.response_json);
   const sameSource=(v:any)=>['id','source','source_account','source_ref','source_version','occurred_at'].every(k=>v[k]===original[k]);
   const origin=(v:any)=>sourceDigest([v.source,v.source_account,v.source_ref,v.source_version,v.body?.l1_snapshot?.content_hash??v.content_hash,v.occurred_at,v.body?.l1_snapshot?.message??v.body?.message,v.body?.sender,v.body?.withdrawn,v.body?.reader_metadata??null]);
   if(original.revision!==1||!sameSource(entity)||entity.id!=='message_'+sourceDigest([entity.source,entity.source_account,entity.source_ref,entity.source_version])||original.body?.processing_version!=='l1-source-intake/v1'||!(providerOrigin?original.body?.reader_metadata?.provider===providerOrigin.fact.provider&&original.content_hash===providerOrigin.fact.l1_hash:original.body?.reader_metadata?.content_format===(signal.source==='feishu'?'lark_message_json':'weixin_message_json')))return null;
   const body=JSON.parse(entity.body_json),originHash=origin(original);
   if(origin({...entity,body})!==originHash||origin({...original,body:raw.body,occurred_at:raw.occurred_at})!==originHash)return null;
   const history=this.db.prepare("SELECT sequence,actor,request_id,idempotency_key,action,before_revision,after_revision,changed_fields_json FROM entity_audit_events WHERE object_type='message-entities' AND object_id=? AND result='committed' ORDER BY sequence").all(entity.id) as any[];
   const activation=this.db.prepare('SELECT body_json FROM decision_formal_activation WHERE singleton=1').get() as any;
   const boundary=providerOrigin?.boundary??(activation?JSON.parse(activation.body_json).native_creation_boundary:null);
   if(boundary?.schema!==(providerOrigin?'provider-observation-boundary/v1':'producer-observation-boundary/v2')||!Number.isSafeInteger(boundary.entity_audit_sequence)||boundary.entity_audit_sequence<0||!Number.isSafeInteger(history[0]?.sequence)||history[0].sequence<=boundary.entity_audit_sequence)return null;
   if(!Array.isArray(boundary.captures)||boundary.captures.some((capture:any)=>!Array.isArray(capture.entity_ids)||capture.entity_ids.some((id:any)=>typeof id!=='string')||capture.entity_ids.includes(entity.id)))return null;
   const sourceFields=new Set(['source','source_account','source_ref','source_version','content_hash','occurred_at','collected_at',...['message','sender','withdrawn','attachments','original_path','reader_metadata','l1_snapshot','coverage','processing_version','context_state','material_status','material_refill_pending_l2','pending_l1_coverage','dedup_key','signal_kind','signal_content'].map(k=>'body.'+k)]);
   let revision=0,previous:any=null;
   for(const event of history){
    if(event.before_revision!==(revision||null)||event.after_revision!==revision+1||event.action!==(revision===0?'create':'update'))return null;
    const receipt=this.db.prepare('SELECT payload_hash,response_json FROM entity_write_receipts WHERE actor=? AND idempotency_key=?').get(event.actor,event.idempotency_key) as any;
    if(!receipt||!(/^[a-f0-9]{64}$/.test(receipt.payload_hash)))return null;
    const response=JSON.parse(receipt.response_json),fields=JSON.parse(event.changed_fields_json);
    if(!sameSource(response)||response.revision!==event.after_revision||!Array.isArray(fields)||fields.some((x:any)=>typeof x!=='string')||origin(response)!==originHash)return null;
    if(revision===0){
     if(event.actor!=='l1-source-intake'||event.idempotency_key!=='intake:'+entity.id||!event.request_id?.startsWith(signal.source==='weixin'?'weixin:':'intake:')||sourceDigest(response)!==sourceDigest(original))return null;
     if(providerOrigin&&(event.request_id!=='intake:'+providerOrigin.fact.page_id||originHash!==providerOrigin.fact.l1_projection_hash))return null;
    }else if(fields.some((field:string)=>sourceFields.has(field))){
     const material=event.actor==='l2-material-pipeline'&&event.request_id==='materials:'+entity.id&&response.content_hash===sourceDigest(response.body)&&event.idempotency_key==='materials:'+sourceDigest([entity.id,event.before_revision,response.content_hash]);
     const refillFields=new Set(['body.original_path','body.attachments','body.coverage','body.material_refill_pending_l2','body.pending_l1_coverage']);
     const refillPatch={original_path:response.body.original_path,attachments:response.body.attachments,...(previous?.body.context_state==='pending_l2'?{coverage:response.body.coverage}:{material_refill_pending_l2:true,pending_l1_coverage:response.body.pending_l1_coverage})};
     const refill=event.actor==='l1-source-intake'&&event.request_id?.startsWith('intake:')&&event.idempotency_key==='material-refill:'+sourceDigest([entity.id,event.request_id.slice('intake:'.length),refillPatch])&&fields.every((field:string)=>refillFields.has(field));
     if(!material&&!refill)return null;
    }
    revision=event.after_revision;previous=response;
   }
   if(revision!==entity.revision)return null;
   return {raw,entity,creation,original,origin_hash:originHash,native_creation_sequence:history[0].sequence,native_creation_boundary_hash:sourceDigest(boundary)};
  }catch{return null;}
 }
 /** raw阶段只读原fact；normal build bind之后再用wire精hash复核，不把null当永久拒绝。 */
 private providerSource(signal:any,wireRequired=false,allowUnchangedObservation=false,allowUnpreparedForHold=false):any{
  try{
   const evidence=sourceIdentityEvidence(this.db,signal.signal_id,signal.revision,wireRequired?sourceDigest(signal):undefined);
   if(!evidence.verified||!Object.hasOwn(providerDecisionTasks,evidence.identity.source_provider))return null;
   const proof=new SourceIdentityLedger(this.db).readonlyCommittedFact(evidence.identity.fact_hash);if(!proof)return null;
   const {fact,registration,page,checkpoint}=proof,domain=this.providerDomains().find(d=>d.registration_id===fact.registration_id&&d.provider===fact.provider);
   if(!domain||canonicalJson(domain.producer)!==canonicalJson(registration))return null;
   const current=currentSourceIdentityPreparation(this.db,fact.registration_id);
   if(!current){
    // 仅分类为hold；不授wire/意图资格。仍实核当前定义且下方完整原P链。
    if(!allowUnpreparedForHold)return null;
    const schedule=this.db.prepare('SELECT definition,config_revision FROM collector_schedules WHERE collector_ref=?').get(registration.definition.collector_ref) as any;
    const runtime=this.db.prepare('SELECT owner FROM collector_runtime WHERE singleton=1').get() as any;
    const normalized=(value:any)=>{const d=CollectorDefinition.parse(value);return {...d,resource_refs:[...new Set(d.resource_refs)].sort()};};
    if(!schedule||!runtime?.owner||schedule.config_revision!==registration.definition.config_revision||canonicalJson(normalized(JSON.parse(schedule.definition)))!==canonicalJson(normalized(registration.definition)))return null;
   }else if(canonicalJson(current.registration)!==canonicalJson(registration))return null;
   const boundary=domain.boundary;
   if(boundary?.schema!=='provider-observation-boundary/v1'||!Array.isArray(boundary.fact_ids)||!Array.isArray(boundary.entity_ids)||!Array.isArray(boundary.page_ids)||!Array.isArray(boundary.attempt_ids)||!Array.isArray(boundary.request_ids)||!Array.isArray(boundary.observations)||!Array.isArray(boundary.captures))return null;
   if(boundary.fact_ids.includes(evidence.identity.fact_hash)||boundary.entity_ids.includes(fact.entity_id)||boundary.page_ids.includes(fact.page_id)||boundary.attempt_ids.includes(page.attempt_ref)||proof.request_refs.some((id:string)=>boundary.request_ids.includes(id))||boundary.captures.some((c:any)=>c.page_id===fact.page_id||c.entity_ids?.includes(fact.entity_id)))return null;
   const origin=this.sourceOrigin(signal,{fact,boundary});if(!origin)return null;
   const metadata=origin.original.body?.reader_metadata,sequence=metadata?.observation_revision,state=metadata?.state_hash;
   if(metadata?.provider!==fact.provider||metadata.snapshot!==true||!Number.isSafeInteger(sequence)||sequence<1||!(/^[a-f0-9]{64}$/.test(state??''))||typeof checkpoint.window?.end!=='string')return null;
   const cut=fact.source_version.lastIndexOf(':'),kind=fact.source_version.slice(0,cut),version=fact.source_version.slice(cut+1);if(cut<1||version!==sourceDigest([state,checkpoint.window.end,sequence])||(fact.provider==='feishu_task'?kind!=='snapshot':kind!==metadata.approval?.status))return null;
   const seen=this.db.prepare('SELECT 1 FROM decision_provider_observations WHERE domain_id=? AND fact_id=?').get(domain.domain_id,evidence.identity.fact_hash);
   const floor=boundary.observations.find((h:any)=>h.source_ref===fact.source_ref);
   if(!seen&&floor){
    if(sequence<=floor.observation_revision)return null;
    if(state===floor.state_hash&&!allowUnchangedObservation){
     // 观察顺序来自P单调sequence，不依赖D先消费B或墙钟created_at排序。
     const candidates=this.db.prepare('SELECT o.body_json FROM signal_outbox o JOIN source_identity_signals i USING(signal_id,revision) WHERE o.signal_id=? AND i.fact_id<>? ORDER BY o.revision').all(signal.signal_id,evidence.identity.fact_hash) as any[];
     let changed=false;for(const candidate of candidates){const raw=JSON.parse(candidate.body_json),m=raw.body?.reader_metadata;
      if(m?.provider===fact.provider&&m.state_hash!==state&&m.observation_revision>floor.observation_revision&&m.observation_revision<sequence&&this.providerSource(raw)){changed=true;break;}}
     if(!changed)return null;
    }
   }
   return {scope:fact.provider,domain,observation:{fact_id:evidence.identity.fact_hash,source_ref:fact.source_ref,observation_revision:sequence,state_hash:state},evidence:{evidence_type:'formal_provider_fact',...evidence.identity,provider_domain_id:domain.domain_id,provider_activation_hash:domain.body_hash,producer_registration_hash:fact.registration_id,page_hash:sourceDigest(page),checkpoint_hash:sourceDigest(checkpoint),physical_request_refs:proof.request_refs,physical_stop_receipt:page.stopped_receipt,creation_receipt_hash:sourceDigest(origin.original),creation_payload_hash:origin.creation.payload_hash,source_origin_hash:origin.origin_hash,native_creation_sequence:origin.native_creation_sequence,native_creation_boundary_hash:origin.native_creation_boundary_hash}};
  }catch{return null;}
 }
 private providerMaterialTarget(signal:any,wireRequired=false):{target:DecisionTarget;qualification?:FormalQualification;formal_pending?:true}|null{
  try{
   const proof=sourceIdentityEvidence(this.db,signal.signal_id,signal.revision,wireRequired?sourceDigest(signal):undefined),identity=proof.identity;
   if(!proof.verified||!Object.hasOwn(providerDecisionTasks,identity.source_provider)||!Number.isSafeInteger(identity.parent_revision)||identity.parent_revision>=signal.revision)return null;
   const parent=this.db.prepare('SELECT fact_id FROM source_identity_signals WHERE signal_id=? AND revision=?').get(signal.signal_id,identity.parent_revision) as any;if(parent?.fact_id!==identity.fact_hash)return null;
   const batch=this.db.prepare('SELECT b.* FROM decision_items i JOIN decision_batches b ON b.delivery_id=i.delivery_id WHERE i.signal_id=? AND i.revision=? AND i.wake_required=1').get(signal.signal_id,identity.parent_revision) as any;if(!batch?.target_json)return null;
   const formal=this.db.prepare("SELECT * FROM decision_formal_intents WHERE delivery_id=? AND transport_kind='formal_task/v1'").get(batch.delivery_id) as any;if(!formal||sha256(formal.eligibility_json)!==formal.eligibility_hash)return null;
   const e=JSON.parse(formal.eligibility_json),target=JSON.parse(batch.target_json);
   if(!formalDecisionEligibility(e)||e.task_id!==providerDecisionTasks[identity.source_provider as keyof typeof providerDecisionTasks]||canonicalJson(e.target)!==canonicalJson(target)||!e.source_evidence?.some((v:any)=>v.fact_hash===identity.fact_hash&&v.source_version===identity.source_version&&v.l1_hash===identity.l1_hash))return null;
   const committed=new SourceIdentityLedger(this.db).readonlyCommittedFact(identity.fact_hash),domain=this.providerDomains().find(d=>d.registration_id===committed?.fact.registration_id);
   if(!committed||!domain||!this.sourceOrigin(signal,{fact:committed.fact,boundary:domain.boundary}))return null;
   if(!formal.intent_json||sha256(formal.intent_json)!==formal.intent_hash||formal.state!=='verified')return {target,formal_pending:true};
   const intent=JSON.parse(formal.intent_json);parseFrozenSubmission(intent);
   if(intent.task_id!==e.task_id||intent.eligibility_hash!==formal.eligibility_hash||canonicalJson(target)!==canonicalJson({host:'local',thread_id:intent.binding.thread_id,project_id:intent.binding.codex_project_id,cwd:intent.binding.cwd}))return null;
   return {target,qualification:{task_id:e.task_id,purpose:'direct',source_scope:[identity.source_provider],source_evidence:[{evidence_type:'original_provider_fact_parent',...identity,provider_domain_id:domain.domain_id,provider_activation_hash:domain.body_hash,parent_revision:identity.parent_revision,delivery_id:batch.delivery_id,intent_hash:formal.intent_hash,eligibility_hash:formal.eligibility_hash}]}};
  }catch{return null;}
 }
 private providerAnomalyCandidate(raw:any):boolean{
  // 仅完整当前域/P创建/原page停止证明均合法但同state未成新观察时hold。
  // provider/scope/current-definition或原P链错误仍走原异常；identity单独不能盖过。
  if(this.providerSource(raw,false,true,true))return false;
  try{
   const entity=this.db.prepare('SELECT id,source,source_account,source_ref,source_version FROM entity_message_entities WHERE id=?').get(raw.entity_id) as any;if(!entity)return false;
   const ref=JSON.parse(entity.source_ref),domains=this.providerDomains().filter(d=>d.producer.scope.source===entity.source&&d.producer.scope.account===entity.source_account&&d.producer.scope.scope_ref===ref[0]);
   if(!domains.length)return false;
   const creation=this.db.prepare("SELECT sequence,request_id FROM entity_audit_events WHERE object_type='message-entities' AND object_id=? AND actor='l1-source-intake' AND idempotency_key=? AND action='create' AND before_revision IS NULL AND after_revision=1 AND result='committed' ORDER BY sequence").all(entity.id,'intake:'+entity.id) as any[];
   if(creation.length!==1)return false;
   const receipt=this.db.prepare("SELECT response_json FROM entity_write_receipts WHERE actor='l1-source-intake' AND idempotency_key=?").get('intake:'+entity.id) as any;if(!receipt)return false;
   const original=JSON.parse(receipt.response_json);if(['id','source','source_account','source_ref','source_version'].some(k=>original[k]!==entity[k])||original.revision!==1||original.body?.processing_version!=='l1-source-intake/v1')return false;
   const signed=this.db.prepare('SELECT i.fact_id,f.body_json FROM source_identity_signals i LEFT JOIN source_identity_facts f ON f.id=i.fact_id WHERE i.signal_id=? AND i.revision=?').get(raw.signal_id,raw.revision) as any;
   const fact=signed?.body_json?JSON.parse(signed.body_json):null;
   return domains.some(d=>{const b=d.boundary;
    if(!Number.isSafeInteger(b?.entity_audit_sequence)||creation[0].sequence<=b.entity_audit_sequence||b.entity_ids.includes(entity.id)||b.captures.some((c:any)=>c.entity_ids?.includes(entity.id)))return false;
    const pageId=creation[0].request_id?.startsWith('intake:')?creation[0].request_id.slice(7):null;
    if(!pageId||b.page_ids.includes(pageId)||b.captures.some((c:any)=>c.page_id===pageId))return false;
    if(fact&&(b.fact_ids.includes(signed.fact_id)||b.page_ids.includes(fact.page_id)))return false;
    const page=this.db.prepare('SELECT attempt_ref,requests_json FROM source_identity_pages WHERE page_id=?').get(fact?.page_id??pageId) as any;
    if(page&&(b.attempt_ids.includes(page.attempt_ref)||JSON.parse(page.requests_json).some((r:any)=>b.request_ids.includes(r.request_ref))))return false;
    return true;
   });
  }catch{return false;}
 }
 /** 只从原outbox读取；provider旧页不借legacy全局模式排空，新缺身份仍能进原异常元数据。 */
 formalOutboxEligible(signalId:string,revision:number,registry?:ChannelRegistry):boolean{
  const row=this.db.prepare('SELECT body_json FROM signal_outbox WHERE signal_id=? AND revision=?').get(signalId,revision) as any;if(!row)return false;
  if(this.db.prepare('SELECT 1 FROM decision_formal_legacy_outbox WHERE signal_id=? AND revision=?').get(signalId,revision))return false;
  const raw=JSON.parse(row.body_json);
  const material=this.providerMaterialTarget(raw);if(material?.formal_pending)return false;if(material?.qualification)return true;
  const provider=this.providerSource(raw);
  if(provider)return !!registry&&this.providerRegistryMatches(provider,registry,{...raw,source_provider:provider.scope});
  if(knownProviderScope(raw.source,raw.source_ref)||hasProviderHistory(this.db,signalId,raw.entity_id)||['feishu_task','feishu_approval'].includes(raw.body?.reader_metadata?.provider))return !!registry&&this.providerAnomalyCandidate(raw);
  if(this.db.prepare('SELECT 1 FROM decision_formal_activation').get())return true;
  if(raw.source==='codex'){
   const native=raw.body?.native_result,probe={...raw,...(native?.verified_by==='codex_app_server_v1'?{native_receipt_id:native.receipt_id}:{})};
   const cause=this.causalTarget(probe);return !!cause?.qualification&&formalDecisionEligibility(cause.qualification)&&!cause.formal_pending;
  }
  return false;
 }
 /** 仅normal build选中并精wire绑定的真实fact留独立观察账，不给旧页/异常补签。 */
 providerSelectionProof(signal:any){
  const source=this.providerSource(signal,true);if(!source)return null;
  return {signal_id:signal.signal_id,revision:signal.revision,wire_hash:sourceDigest(signal),domain_id:source.domain.domain_id,activation_hash:source.domain.body_hash,fact_hash:source.evidence.fact_hash};
 }
 noteProviderWire(signal:any){
  const source=this.providerSource(signal,true);if(!source)return;
  const o=source.observation;this.db.prepare('INSERT OR IGNORE INTO decision_provider_observations VALUES(?,?,?,?,?)').run(source.domain.domain_id,o.fact_id,o.source_ref,o.observation_revision,o.state_hash);
 }
 private providerRegistryMatches(source:any,registry:ChannelRegistry,signal:any):boolean{
  const resolved=resolveChannel(registry,signal);
  return resolved.reason==='source_account_provider'&&resolved.target_name===source.domain.target_name&&resolved.task_id===providerDecisionTasks[source.scope as keyof typeof providerDecisionTasks]&&canonicalJson({...resolved.target,task_id:resolved.task_id})===canonicalJson(source.domain.target);
 }
 private providerQualification(signal:any,registry:ChannelRegistry):FormalQualification|null{
  const source=this.providerSource(signal,true);if(!source)return null;
  const resolved=resolveChannel(registry,signal);
  if(!this.providerRegistryMatches(source,registry,signal))return null;
  return {task_id:resolved.task_id,purpose:'direct',source_scope:[source.scope],source_evidence:[source.evidence]};
 }
 /** 只读原outbox及既有P身份；调用方body/group名不能签发来源资格。 */
 private directQualification(signal:any,registry:ChannelRegistry):{scope:'feishu_im'|'weixin';evidence:any}|null{
  if(signal.kind!=='message'||!['feishu','weixin'].includes(signal.source)||!verifiedLegacyIdentity(this.db,signal))return null;
  const accounts=(registry.sources as any)[signal.source];
  if(!accounts||!Object.hasOwn(accounts,signal.source_account))return null;
  const evidence=sourceIdentityEvidence(this.db,signal.signal_id,signal.revision,sourceDigest(signal));
  if(!evidence.unsigned_snapshot||evidence.unsigned_snapshot.provider_required!==false)return null;
  const owned=this.sourceOrigin(signal);if(!owned)return null;
  if(signal.source==='feishu')return {scope:'feishu_im',evidence:{evidence_type:'legacy_source_outbox',...evidence.unsigned_snapshot,source_origin_hash:owned.origin_hash,creation_receipt_hash:sourceDigest(owned.original),creation_payload_hash:owned.creation.payload_hash,native_creation_sequence:owned.native_creation_sequence,native_creation_boundary_hash:owned.native_creation_boundary_hash}};
  try{
   const raw=JSON.parse((this.db.prepare('SELECT body_json FROM signal_outbox WHERE signal_id=? AND revision=?').get(signal.signal_id,signal.revision) as any).body_json);
   const entity=this.db.prepare('SELECT id,source,source_account,source_ref,source_version,content_hash,body_json,deleted_at FROM entity_message_entities WHERE id=?').get(raw.entity_id) as any;
   if(!entity||entity.deleted_at!==null||entity.source!=='weixin'||entity.source_account!==signal.source_account||entity.source_ref!==signal.source_ref)return null;
   const creation=this.db.prepare('SELECT payload_hash,response_json FROM entity_write_receipts WHERE actor=? AND idempotency_key=?').get('l1-source-intake','intake:'+entity.id) as any;
   if(!creation||!(/^[a-f0-9]{64}$/.test(creation.payload_hash)))return null;
   const original=JSON.parse(creation.response_json);
   if(['id','source','source_account','source_ref','source_version'].some(k=>original[k]!==entity[k]))return null;
   const pair=JSON.parse(signal.source_ref),locator=raw.body?.reader_metadata?.locator;
   if(sourceDigest(raw.body?.reader_metadata??null)!==sourceDigest(original.body?.reader_metadata??null)||sourceDigest(raw.body?.sender??null)!==sourceDigest(original.body?.sender??null))return null;
   if(!Array.isArray(pair)||pair.length!==2||pair.some(v=>typeof v!=='string')||JSON.stringify(pair)!==signal.source_ref||!locator||pair[0]!==locator.peer||pair[1]!=='weixin-local-v1:'+sourceDigest(locator))return null;
   const eventId='source_'+sourceDigest(['weixin',signal.source_account,pair[0],pair[1]]),versionId='version_'+sourceDigest([eventId,entity.source_version]);
   const row=this.db.prepare('SELECT v.*,e.current_version FROM source_versions v JOIN source_events e USING(event_id) WHERE version_id=?').get(versionId) as any;
   if(!row||row.event_id!==eventId||row.current_version!==versionId)return null;
   const activation=JSON.parse((this.db.prepare('SELECT body_json FROM decision_formal_activation WHERE singleton=1').get() as any).body_json),boundary=activation.native_creation_boundary;
   if(!Number.isSafeInteger(boundary?.source_version_sequence)||boundary.source_version_sequence<0||!Number.isSafeInteger(row.sequence)||row.sequence<=boundary.source_version_sequence)return null;

   if(!this.db.prepare("SELECT 1 FROM entity_audit_events WHERE object_type='message-entities' AND object_id=? AND actor='l1-source-intake' AND request_id=? AND idempotency_key=? AND action='create' AND before_revision IS NULL AND after_revision=1 AND result='committed'").get(entity.id,'weixin:'+versionId,'intake:'+entity.id))return null;
   const source=SourceVersion.omit({content_ref:true}).parse(JSON.parse(row.metadata)),body=JSON.parse(entity.body_json);
   const originalHash=body.l1_snapshot?.content_hash??entity.content_hash;
   if(source.channel!=='weixin'||source.account_ref!==signal.source_account||source.conversation_ref!==pair[0]||source.source_message_id!==pair[1]||source.source_revision!==entity.source_version||row.source_revision!==source.source_revision||row.content_hash!==source.content_hash||original.content_hash!==source.content_hash||originalHash!==source.content_hash||source.content_format!=='weixin_message_json'||source.conversation_type!=='private'||source.withdrawn||raw.body?.withdrawn||body.withdrawn||entity.id!=='message_'+sourceDigest(['weixin',signal.source_account,signal.source_ref,entity.source_version])||raw.body?.reader_metadata?.content_format!=='weixin_message_json')return null;
   // coverage/material不作为正式投递门槛；由原Task根据完整来源降级判读。
   return {scope:'weixin',evidence:{evidence_type:'weixin_source_version',...evidence.unsigned_snapshot,source_event_ref:eventId,source_version_ref:versionId,source_metadata_hash:sourceDigest(source),source_content_hash:source.content_hash,creation_receipt_hash:sourceDigest(original),creation_payload_hash:creation.payload_hash,native_creation_sequence:owned.native_creation_sequence,native_creation_boundary_hash:owned.native_creation_boundary_hash,source_version_sequence:row.sequence}};
  }catch{return null;}
 }
 private route(envelope:any,rawRegistry:unknown,formalRaw?:string){
  const value=digest(canonical(envelope));
  const old=this.db.prepare('SELECT * FROM decision_routed_deliveries WHERE delivery_id=?').get(envelope.delivery_id) as any;
  if(old){if(old.digest!==value)throw new DomainError('decision_delivery_conflict',409);return {delivery_id:envelope.delivery_id,registry_hash:old.registry_hash,children:JSON.parse(old.children_json),replayed:true};}
  // Upgrade/restart window: an outbox batch already accepted under the legacy
  // binding must remain there, including an unknown external submit.
  const legacy=this.db.prepare('SELECT digest FROM decision_batches WHERE delivery_id=?').get(envelope.delivery_id) as any;
  if(legacy){if(legacy.digest!==value)throw new DomainError('decision_delivery_conflict',409);return {delivery_id:envelope.delivery_id,children:[envelope.delivery_id],replayed:true};}
  const frozen=this.db.prepare('SELECT body_json,body_hash FROM decision_provider_delivery_registry WHERE delivery_id=?').get(envelope.delivery_id) as any;
  if(frozen){
   const snapshot=JSON.parse(frozen.body_json);
   const original=this.db.prepare('SELECT envelope_json FROM signal_deliveries WHERE delivery_id=?').get(envelope.delivery_id) as any;
   if(sha256(frozen.body_json)!==frozen.body_hash||snapshot.schema!=='provider-delivery-registry/v1'||!original||snapshot.envelope_hash!==sha256(original.envelope_json)||canonicalJson(JSON.parse(original.envelope_json))!==canonicalJson(envelope)||snapshot.registry_raw_hash!==sha256(snapshot.registry_raw))throw new DomainError('provider_delivery_registry_conflict',409);
   const selected=channelRegistry.parse(parseRegistryJson(snapshot.registry_raw));if(registryHash(selected)!==snapshot.registry_hash)throw new DomainError('provider_delivery_registry_conflict',409);
   rawRegistry=selected;formalRaw=snapshot.registry_raw;
  }
  const registry=channelRegistry.parse(rawRegistry);
  if(frozen){
   const snapshot=JSON.parse(frozen.body_json);if(!Array.isArray(snapshot.provider_items))throw new DomainError('provider_delivery_registry_conflict',409);
   for(const item of snapshot.provider_items){
    const selected=envelope.signals.filter((s:any)=>s.signal_id===item.signal_id&&s.revision===item.revision);
    if(selected.length!==1||sourceDigest(selected[0])!==item.wire_hash)throw new DomainError('provider_delivery_registry_conflict',409);
    const proof=this.providerSelectionProof(selected[0]);
    if(!proof||canonicalJson(proof)!==canonicalJson(item)||!this.providerQualification(selected[0],registry))return {delivery_id:envelope.delivery_id,deferred:true,reason:'provider_selected_fact_not_ready'};
   }
  }
  const hash=registryHash(registry);
  for(const t of Object.values(registry.targets))this.db.prepare('INSERT OR IGNORE INTO decision_consumers VALUES(?)').run(t.thread_id);
  const groups=new Map<string,{target:DecisionTarget;name:string;reason:string;signals:any[];qualification:FormalQualification|null}>();
  for(const signal of envelope.signals){
   const required=Object.hasOwn(signal,'source_provider')||knownProviderScope(signal.source,signal.source_ref)||hasProviderHistory(this.db,signal.signal_id);
   const trusted=required?verifiedWireIdentity(this.db,signal):['feishu','weixin'].includes(signal.source)?verifiedLegacyIdentity(this.db,signal):true;
   const providerQualification=required&&formalRaw!==undefined?this.providerQualification(signal,registry):null;
   const resolved=trusted&&(!required||formalRaw===undefined||providerQualification)?resolveChannel(registry,signal):{...resolveChannel(registry,{...signal,source_provider:null}),reason:trusted?'provider_admission_unverified':'unverified_source_provider'};
   // A verified native receipt follows its original durable D binding, even
   // after the source registry changes. Text never selects a return target.
   const cause=signal.source==='codex'?this.causalTarget(signal):required?this.providerMaterialTarget(signal,true):null;
   if(cause?.formal_pending)return {delivery_id:envelope.delivery_id,deferred:true,reason:'formal_parent_input_unverified'};
   const binding=cause?.target??resolved.target;
   const source=cause?null:this.directQualification(signal,registry);
   const purpose=resolved.target_name===registry.exception_target&&resolved.task_id===formalDecisionTasks.exception?'exception':'direct';
   const direct=source&&resolved.reason==='source_account'&&(purpose==='exception'||resolved.target_name===source.scope&&resolved.task_id===formalDecisionTasks[source.scope])?{task_id:resolved.task_id,purpose,source_scope:[source.scope],source_evidence:[source.evidence]} as FormalQualification:null;
   const qualification=cause?.qualification??providerQualification??direct;
   // 不同Task/用途/来源资格分别冻结；旧replay在前面返回，不能升级旧child。
   const token=canonicalJson(formalRaw===undefined?binding:{target:binding,formal_task:qualification?.task_id??null,purpose:qualification?.purpose??null,source_scope:qualification?.source_scope??null}),group=groups.get(token)??{target:binding,name:cause?'causal_return':resolved.target_name,reason:cause?'receipt_chain':resolved.reason,signals:[],qualification:qualification?{...qualification,source_evidence:[]}:null};
   if(group.qualification&&qualification)group.qualification.source_evidence.push(...qualification.source_evidence);
   const reason=cause?'receipt_chain':resolved.reason;if(group.reason!==reason)group.reason='mixed_routes';
   group.signals.push(signal);groups.set(token,group);
  }
  const children:string[]=[];
  for(const [binding,group] of groups){
   const hex=digest([envelope.delivery_id,hash,binding]);
   const id=hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-8'+hex.slice(17,20)+'-'+hex.slice(20,32);
   this.run({operation:'decision_enqueue',target:group.target,routing:{registry_hash:hash,registry_version:registry.schema_version,parent_delivery_id:envelope.delivery_id,target_name:group.name,reason:group.reason},envelope:{...envelope,delivery_id:id,signals:group.signals}});
   if(formalRaw!==undefined&&group.qualification&&formalDecisionEligibility(group.qualification)&&this.db.prepare('SELECT 1 FROM decision_items WHERE delivery_id=? AND wake_required=1').get(id)){
    // 只在全新父delivery事务中赋资格；旧父/子批从前面的replay分支返回。
    const parsed=channelRegistry.parse(parseRegistryJson(formalRaw));
    if(registryHash(parsed)!==hash)throw new DomainError('formal_registry_snapshot_conflict',409);
    const original=this.db.prepare('SELECT envelope_json FROM signal_deliveries WHERE delivery_id=?').get(envelope.delivery_id) as any;
    const owned=this.db.prepare('SELECT envelope_hash FROM decision_formal_owned_deliveries WHERE delivery_id=?').get(envelope.delivery_id) as any;
    if(!original||!owned||sha256(original.envelope_json)!==owned.envelope_hash||canonicalJson(JSON.parse(original.envelope_json))!==canonicalJson(envelope))throw new DomainError('formal_delivery_not_owned',409);
    const wire=original.envelope_json,frozen=JSON.stringify({...envelope,delivery_id:id,signals:group.signals});
    const eligibility={transport_kind:'formal_task/v1',wake_id:'decision:'+id,delivery_id:id,parent_delivery_id:envelope.delivery_id,...group.qualification,target:group.target,registry_raw:formalRaw,registry_hash:hash,registry_raw_hash:createHash('sha256').update(formalRaw).digest('hex'),wire,wire_hash:createHash('sha256').update(wire).digest('hex'),envelope:frozen,envelope_hash:createHash('sha256').update(frozen).digest('hex')};
    const bytes=canonicalJson(eligibility);
    this.db.prepare("INSERT INTO decision_formal_intents(delivery_id,transport_kind,eligibility_json,eligibility_hash) VALUES(?,'formal_task/v1',?,?)").run(id,bytes,createHash('sha256').update(bytes).digest('hex'));
   }
   children.push(id);
  }
  this.db.prepare('INSERT INTO decision_routed_deliveries VALUES(?,?,?,?)').run(envelope.delivery_id,value,hash,JSON.stringify(children));
  return {delivery_id:envelope.delivery_id,registry_hash:hash,children,replayed:false};
 }
 private causalTarget(signal:any):{target:DecisionTarget;qualification?:FormalQualification;formal_pending?:true}|null{
  const receiptId=signal.native_receipt_id;if(typeof receiptId!=='string')return null;
  // The source identity must have an official persisted observation binding;
  // a source body containing a receipt ID is not an authority to reroute.
  if(!this.db.prepare('SELECT 1 FROM native_terminal_bindings WHERE receipt_id=? AND identity=?').get(receiptId,signal.source_account+':'+signal.source_ref))return null;
  const seen=new Set<string>();let id=receiptId;
  while(!seen.has(id)){
   seen.add(id);const row=this.db.prepare('SELECT body_json FROM decision_receipts WHERE receipt_id=?').get(id) as any;
   if(!row)return null;const receipt=JSON.parse(row.body_json);
   if(receipt.stage==='durable_received'){
    const batch=this.db.prepare('SELECT delivery_id,target_json FROM decision_batches WHERE wake_id=?').get(receipt.causation_id) as any;
    if(!batch?.target_json)return null;const target=JSON.parse(batch.target_json);
    const formal=this.db.prepare("SELECT * FROM decision_formal_intents WHERE delivery_id=? AND transport_kind='formal_task/v1'").get(batch.delivery_id) as any;
    if(formal?.intent_json&&createHash('sha256').update(formal.intent_json).digest('hex')===formal.intent_hash){
     const intent=JSON.parse(formal.intent_json);parseFrozenSubmission(intent);
     if(sha256(formal.eligibility_json)===formal.eligibility_hash){
      const eligibility=JSON.parse(formal.eligibility_json);
      if(formalDecisionEligibility(eligibility)&&eligibility.task_id===intent.task_id&&intent.eligibility_hash===formal.eligibility_hash&&canonicalJson(target)===canonicalJson(eligibility.target)&&canonicalJson(target)===canonicalJson({host:'local',thread_id:intent.binding.thread_id,project_id:intent.binding.codex_project_id,cwd:intent.binding.cwd})){
       if(formal.state!=='verified')return {target,formal_pending:true};
       return {target,qualification:{task_id:intent.task_id,purpose:eligibility.purpose??'direct',source_scope:eligibility.source_scope??['feishu_im'],source_evidence:[{evidence_type:'original_formal_intent',receipt_id:receiptId,delivery_id:batch.delivery_id,intent_hash:formal.intent_hash,eligibility_hash:formal.eligibility_hash}]}};
      }
     }
    }
    return {target};
   }
   id=receipt.causation_id;
  }
  return null;
 }
 private work(row:any){
  const original=JSON.parse(row.envelope_json);
  const own=this.db.prepare('SELECT signal_id,revision FROM decision_items WHERE delivery_id=? AND wake_required=1').all(row.delivery_id) as {signal_id:string;revision:number}[];
  return {wake_id:row.wake_id,target:JSON.parse(row.target_json),routing:row.routing_json?JSON.parse(row.routing_json):null,envelope:{...original,signals:original.signals.filter((s:any)=>own.some(i=>i.signal_id===s.signal_id&&i.revision===s.revision))},turn_id:row.turn_id,submission_id:row.submission_id};
 }
 private frozenIntegrity(){
  // 仅显式按delivery读取status时按需全量核证；不加入tick，不读出原文到响应。
  const result:any={};
  for(const [name,frozen,source,keys] of [
   ['outbox','decision_formal_legacy_outbox','signal_outbox',['signal_id','revision']],
   ['deliveries','decision_formal_legacy_deliveries','signal_deliveries',['delivery_id']],
   ['batches','decision_formal_legacy_batches','decision_batches',['delivery_id']],
  ] as const){
   const entries=this.db.prepare('SELECT * FROM '+frozen+' ORDER BY '+keys.join(',')).all() as any[],digest=createHash('sha256');
   const report:any={expected:entries.length,checked:0,unchanged:0,missing:[],changed:[]};
   for(const entry of entries){
    const id=keys.map(k=>entry[k]),row=this.db.prepare('SELECT * FROM '+source+' WHERE '+keys.map(k=>k+'=?').join(' AND ')).get(...id);
    const current=row?createHash('sha256').update(canonicalJson(row)).digest('hex'):null;
    report.checked++;if(current===entry.row_hash)report.unchanged++;else (row?report.changed:report.missing).push(id);
    digest.update(canonicalJson([id,entry.row_hash,current])+'\n');
   }
   report.inventory_digest=digest.digest('hex');result[name]=report;
  }
  return result;
 }
 /** 只读Worker元证；observed仅覆盖已观测registration，不授采集/D，不导出opaque context。 */
 private providerAdoptionMetadata(){
  const providers=(['feishu_task','feishu_approval'] as const).map(provider=>{
   try{
    if(!this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='source_identity_registrations'").get())throw new Error('source_metadata_unavailable');
    const factories:any[]=[];
    for(const row of this.db.prepare('SELECT id,body_json FROM source_identity_registrations ORDER BY id').all() as any[]){
     const raw=JSON.parse(row.body_json);if(!['feishu_task','feishu_approval'].includes(raw?.provider))throw new Error('registration_kind_unknown');if(raw.provider!==provider)continue;
     const r=SourceRegistration.parse(raw);if(sourceDigest(r)!==row.id||r.provider!==provider||r.scope.source!=='feishu'||r.scope.scope_ref!==(provider==='feishu_task'?'task':'approval')+'-user-visible/v1'||r.definition.channel!==r.scope.source||r.definition.account_ref!==r.scope.account||r.definition.intake_scope_binding!==sourceDigest(r.scope)||r.definition.intake_stream_ref!=='l1:'+sourceDigest([r.scope.source,r.scope.account,r.scope.scope_ref]))throw new Error('registration_integrity_unknown');
     const current=currentSourceIdentityPreparation(this.db,row.id),control=this.db.prepare('SELECT source,enabled,available,revision FROM collector_controls WHERE collector_ref=?').get(r.definition.collector_ref) as any;
     const schedule=this.db.prepare('SELECT active_operation FROM collector_schedules WHERE collector_ref=?').get(r.definition.collector_ref) as any;
     factories.push({registration_id:row.id,provider,account:r.scope.account,logical_scope:r.scope.scope_ref,collector_ref:r.definition.collector_ref,entry_hash:r.entry_hash,definition_hash:sourceDigest({...r.definition,resource_refs:[...new Set(r.definition.resource_refs)].sort()}),scope_binding:r.definition.intake_scope_binding,current_ready:!!current,
      control:control&&schedule&&control.source===provider&&[0,1].includes(control.enabled)&&[0,1].includes(control.available)&&Number.isSafeInteger(control.revision)&&control.revision>0&&(schedule.active_operation===null||typeof schedule.active_operation==='string'&&schedule.active_operation.length>0)?{state:'observed',enabled:!!control.enabled,available:!!control.available,revision:control.revision,active_operation:!!schedule.active_operation,
       unsettled_attempts:(this.db.prepare("SELECT count(*) AS n FROM collector_attempts WHERE collector_ref=? AND state<>'settled'").get(r.definition.collector_ref) as any).n,
       unconfirmed_physical:(this.db.prepare('SELECT count(*) AS n FROM x_process_attempts x JOIN collector_attempts a USING(attempt_ref) WHERE a.collector_ref=? AND (x.accepting<>0 OR x.stopped_receipt IS NULL)').get(r.definition.collector_ref) as any).n}: {state:'unknown'}});
    }
    const domains=this.providerDomains(provider).map(d=>{
     const r=SourceRegistration.parse(d.producer),v=verifiedTarget.parse(d.verified_target),b=v.binding;
     if(r.provider!==provider||sourceDigest(r)!==d.registration_id||r.scope.source!=='feishu'||r.scope.scope_ref!==(provider==='feishu_task'?'task':'approval')+'-user-visible/v1'
      ||r.definition.channel!==r.scope.source||r.definition.account_ref!==r.scope.account||r.definition.intake_scope_binding!==sourceDigest(r.scope)||r.definition.intake_stream_ref!=='l1:'+sourceDigest([r.scope.source,r.scope.account,r.scope.scope_ref])
      ||d.target?.task_id!==providerDecisionTasks[provider]||v.task_id!==d.target.task_id||b.project_id!=='transmission'||v.verification.codex_project_id!==b.codex_project_id
      ||canonicalJson({host:'local',thread_id:b.thread_id,project_id:b.codex_project_id,cwd:b.cwd})!==canonicalJson({host:d.target.host,thread_id:d.target.thread_id,project_id:d.target.project_id,cwd:d.target.cwd})
      ||d.domain_id!==sourceDigest([provider,d.registration_id,d.target_name,d.target,b]))throw new Error('domain_metadata_integrity_unknown');
     return {domain_id:d.domain_id,provider,registration_id:d.registration_id,activation_hash:d.body_hash,account:r.scope.account,logical_scope:r.scope.scope_ref,collector_ref:r.definition.collector_ref,task_id:d.target.task_id,original_task_revision:v.task_revision,target_hash:sourceDigest(d.target),binding_hash:sourceDigest(b),current_ready:!!currentSourceIdentityPreparation(this.db,d.registration_id)};
    });
    return {provider,state:factories.length?'observed':'unknown',reason:factories.length?null:'no_factory_metadata_observed',coverage:'observed_registrations_only',factories,domains};
   }catch{return {provider,state:'unknown',reason:'provider_metadata_integrity_or_availability_unknown',coverage:'unknown'};}
  });
  return {schema:'smart-shadow.provider-adoption-metadata/v1',providers};
 }
 private status(id?:string,auditFreeze=false){
  const batches=id?this.db.prepare('SELECT delivery_id,wake_id,state,turn_id,submission_id,target_json,routing_json FROM decision_batches WHERE delivery_id=?').all(id):this.db.prepare('SELECT delivery_id,wake_id,state,turn_id,submission_id,target_json,routing_json FROM decision_batches ORDER BY rowid').all();
  const activation=this.db.prepare('SELECT body_json FROM decision_formal_activation WHERE singleton=1').get() as any;
  const inventory=Object.fromEntries([['intents','decision_formal_intents'],['owned_deliveries','decision_formal_owned_deliveries'],['legacy_outbox','decision_formal_legacy_outbox'],['legacy_deliveries','decision_formal_legacy_deliveries'],['legacy_batches','decision_formal_legacy_batches']].map(([name,table])=>[name,(this.db.prepare('SELECT count(*) AS count FROM '+table).get() as any).count]));
  const result={provider_adoption:this.providerAdoptionMetadata(),provider_registry_history:{schema:'smart-shadow.provider-registry-history-metadata/v1',state:'unknown',reason:'main_history_projection_unavailable'},formal_adoption:{schema:'smart-shadow.formal-task-adoption/v1',activation:activation?JSON.parse(activation.body_json):null,inventory,frozen_integrity:auditFreeze&&activation?this.frozenIntegrity():null},...(activation?{formal_activation:JSON.parse(activation.body_json)}:{}),batches:batches.map((b:any)=>{const needs=!!this.db.prepare('SELECT 1 FROM decision_batch_items bi JOIN decision_items i USING(signal_id,revision) WHERE bi.delivery_id=? AND i.wake_required=1').get(b.delivery_id);const {target_json,routing_json,...metadata}=b;const formal=this.db.prepare('SELECT transport_kind,state,eligibility_hash,intent_hash,execution_id,request_id,evidence_json FROM decision_formal_intents WHERE delivery_id=?').get(b.delivery_id) as any;return {...metadata,...(formal?{formal_intent:{transport_kind:formal.transport_kind,state:formal.state,eligibility_hash:formal.eligibility_hash,intent_hash:formal.intent_hash,execution_id:formal.execution_id,request_id:formal.request_id,evidence:formal.evidence_json?JSON.parse(formal.evidence_json):null}}:{}),target:JSON.parse(target_json),routing:routing_json?JSON.parse(routing_json):null,observed_only:!needs,host_accepted:needs&&!(this.db.prepare("SELECT 1 FROM decision_batch_items bi JOIN decision_items i USING(signal_id,revision) JOIN decision_batches b ON b.delivery_id=i.delivery_id WHERE bi.delivery_id=? AND i.wake_required=1 AND b.state<>'accepted' LIMIT 1").get(b.delivery_id))};}),receipts:this.db.prepare('SELECT body_json FROM decision_receipts ORDER BY rowid').all().map((r:any)=>JSON.parse(r.body_json)),native_terminal_checks:this.db.prepare('SELECT receipt_id,state,reason,checked_at FROM native_terminal_checks ORDER BY rowid').all(),native_terminal_bindings:this.db.prepare('SELECT b.receipt_id,b.identity,o.entity_id FROM native_terminal_bindings b JOIN native_terminal_observations o USING(identity) ORDER BY b.rowid').all()};
  if(!id)return result;
  const row=this.db.prepare('SELECT envelope_json FROM decision_batches WHERE delivery_id=?').get(id) as any;
  const keys=this.db.prepare('SELECT signal_id,revision FROM decision_batch_items WHERE delivery_id=?').all(id) as any[];
  return {...result,envelope:row?JSON.parse(row.envelope_json):null,receipts:result.receipts.filter(p=>p.items.some((i:any)=>keys.some(k=>k.signal_id===i.signal_id&&k.revision===i.revision)))};
 }
}

/** Public host must queue durably without steering active work. Never read→turn/start. */
export interface DecisionHost{
 enqueue(work:any):Promise<{outcome:'busy'}|{outcome:'accepted';submission_id:string;turn_id?:string}|{outcome:'unknown'}>;
 lookup(work:any):Promise<{outcome:'accepted';submission_id:string;turn_id?:string}|{outcome:'unknown'}>;
}
export interface FormalDecisionHost{activation(registry:ChannelRegistry):Promise<any>;providerActivation?(registry:ChannelRegistry,provider:keyof typeof providerDecisionTasks,account:string):Promise<any>;prepare(work:any):Promise<any>;enqueue(work:any):Promise<any>;lookup(work:any):Promise<any>;}
/** Driven by the existing signal dispatch tick; never starts a timer or a server. */
export class DecisionIntakePump{
 private running=false;
 private port:(input:unknown)=>Promise<any>;private target:DecisionTarget;private host:DecisionHost|FormalDecisionHost;private registry?:()=>ChannelRegistry;private pausedThreadIds:readonly string[];private formalRegistryRaw?:()=>string;
 constructor(port:(input:unknown)=>Promise<any>,target:DecisionTarget,host:DecisionHost,registry?:()=>ChannelRegistry,pausedThreadIds?:readonly string[]);
 constructor(port:(input:unknown)=>Promise<any>,target:DecisionTarget,host:FormalDecisionHost,registry:undefined,pausedThreadIds:readonly string[],formalRegistryRaw:()=>string);
 constructor(port:(input:unknown)=>Promise<any>,target:DecisionTarget,host:DecisionHost|FormalDecisionHost,registry?:()=>ChannelRegistry,pausedThreadIds:readonly string[]=[],formalRegistryRaw?:()=>string){this.port=port;this.target=target;this.host=host;this.registry=registry;this.pausedThreadIds=pausedThreadIds;this.formalRegistryRaw=formalRegistryRaw;}
 async tick(){
  if(this.running)return;
  this.running=true;
  try{
   // Durable receipt first; reuse exact existing outbox identity and checkpoint.
   let registry:ChannelRegistry|undefined,registryFailed=false,formalRaw:string|undefined,formalSelectionReady=true;
   try{if(this.formalRegistryRaw){formalRaw=this.formalRegistryRaw();registry=channelRegistry.parse(parseRegistryJson(formalRaw));}else registry=this.registry?.();}catch{registryFailed=true;}
   const now=new Date().toISOString();
   if(this.formalRegistryRaw&&!registryFailed&&formalRaw!==undefined){
    const activation=await this.port({operation:'decision_formal_activation_status'});
    if(!activation){
     const providers=await this.port({operation:'decision_provider_activation_status'});
     if(!Array.isArray(providers?.domains))throw new Error('provider_domain_status_unknown');
     // 独立provider采用不因旧三binding可读而授权旧singleton/全局freeze。
     const providerPlanned=registry!.schema_version===2&&Object.values(registry!.provider_sources).some(accounts=>Object.values(accounts??{}).some(providers=>Object.keys(providers).length>0));
     if(!providers.domains.length&&providerPlanned)formalSelectionReady=false;
     else if(!providers.domains.length){const proof=await (this.host as FormalDecisionHost).activation(registry!);await this.port({operation:'decision_formal_activate',registry_raw:formalRaw,...proof,observed_at:now});}
    }
   }
   const batch=registryFailed||!formalSelectionReady?null:await this.port({operation:'next',now,...(this.formalRegistryRaw?{formal_only:true,...(formalRaw===undefined?{}:{formal_registry_raw:formalRaw})}:{})});
   if(batch){const routed=await this.port(registry?{operation:'decision_enqueue_routed',registry,envelope:batch,...(formalRaw===undefined?{}:{formal_registry_raw:formalRaw})}:{operation:'decision_enqueue',target:this.target,envelope:batch});if(!routed?.deferred)await this.port({operation:'settle',delivery_id:batch.delivery_id,http_status:200,now,...(this.formalRegistryRaw?{formal_only:true}:{})});}
   if(this.formalRegistryRaw){
    const work=await this.port({operation:'decision_formal_claim',paused_thread_ids:this.pausedThreadIds});
    if(work){
     const host=this.host as FormalDecisionHost;
     if(work.action==='prepare'){
      // prepare只有只读调用；未冻结前不能投递。失败保留fresh供后续只读核验。
      const intent=await host.prepare(work);
      await this.port({operation:'decision_formal_freeze',wake_id:work.wake_id,intent});
     }else{
      let result;try{result=work.action==='submit'?await host.enqueue(work):await host.lookup(work);}catch{result={outcome:'unknown'};}
      await this.port({operation:'decision_formal_report',wake_id:work.wake_id,...result});
     }
    }
    if(registryFailed)throw new Error('decision_registry_unavailable');
    return;
   }
   const work=await this.port({operation:'decision_claim',paused_thread_ids:this.pausedThreadIds});
   if(!work){if(registryFailed)throw new Error('decision_registry_unavailable');return;}
   let result;
   try{result=work.action==='reconcile'?await this.host.lookup(work):await this.host.enqueue(work);}catch{result={outcome:'unknown' as const};}
   await this.port({operation:'decision_report',wake_id:work.wake_id,...result});
   if(registryFailed)throw new Error('decision_registry_unavailable');
  }finally{this.running=false;}
 }
}
