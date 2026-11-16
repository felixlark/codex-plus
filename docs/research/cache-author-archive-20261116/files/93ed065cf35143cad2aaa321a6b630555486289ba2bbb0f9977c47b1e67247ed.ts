import {trustedNewSourceMessage,signalProvider,bindWireIdentity,knownProviderScope,hasProviderHistory} from '../channels/source-intake/source-identity.ts';
import {channelRegistry,parseRegistryJson,registryHash,canonicalJson} from './channel-routing.ts';
import type Database from 'better-sqlite3';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {signalMessageHash,signalMessageBody,signalMessageContent} from './signal-message-contract.ts';
import {DomainError} from '../errors.ts';
import {decisionInput,initializeDecisionIntake,DecisionIntakeLedger,target} from './decision-intake.ts';
import {RetryAfterMilliseconds,externalRetryAt} from './retry-after.ts';
import {initializeNativeTerminals,nativeInput,NativeTerminalLedger} from './native-terminal-ledger.ts';
const mode=z.enum(['legacy','3layer']);
const input=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('replay_decision'),delivery_id:z.uuid(),items:z.array(z.object({entity_id:z.string().min(1),signal_id:z.string().min(1),revision:z.number().int().positive()}).strict()).min(1),target,registry:channelRegistry.optional()}).strict(),
 z.object({operation:z.literal('mode'),mode}).strict(),
 z.object({operation:z.literal('status')}).strict(),
 z.object({operation:z.literal('next'),formal_only:z.boolean().default(false),formal_registry_raw:z.string().optional(),now:z.iso.datetime()}).strict(),
 z.object({operation:z.literal('settle'),formal_only:z.boolean().default(false),delivery_id:z.string().uuid(),http_status:z.number().int().min(0).max(599),now:z.iso.datetime(),retry_after_ms:RetryAfterMilliseconds.default(0)}).strict(),
 z.object({operation:z.literal('ingress'),id:z.string().min(1).max(256),kind:z.enum(['message','calendar','contact','moments','codex.run','action.sent','system.health']),source:z.string().min(1).max(256),source_account:z.string().max(256),source_ref:z.string().min(1).max(1024),occurred_at:z.iso.datetime(),content:z.object({text:z.string().max(8*1024*1024),attachments:z.array(z.record(z.string(),z.unknown())).max(100).default([])}),causation_id:z.string().max(256).optional(),privacy:z.enum(['normal','sensitive']).default('normal')}).strict(),
]);
export function initializeSignals(db:Database.Database){
 initializeDecisionIntake(db);
 initializeNativeTerminals(db);
 db.function('signal_message_hash',{deterministic:true},(source,ref,revision)=>signalMessageHash(String(source),String(ref),Number(revision)));
 db.function('signal_message_body',{deterministic:true},body=>JSON.stringify(signalMessageBody(JSON.parse(String(body)))));
 db.function('signal_message_content',{deterministic:true},body=>signalMessageContent(String(body)));
 db.function('source_identity_new_message',id=>trustedNewSourceMessage(db,id)?1:0);
 db.exec(`CREATE TABLE IF NOT EXISTS signal_pipeline(singleton INTEGER PRIMARY KEY CHECK(singleton=1),mode TEXT NOT NULL); INSERT OR IGNORE INTO signal_pipeline VALUES(1,'legacy');
 CREATE TABLE IF NOT EXISTS signals(signal_id TEXT PRIMARY KEY,source TEXT NOT NULL,source_account TEXT NOT NULL,source_ref TEXT NOT NULL,kind TEXT NOT NULL,revision INTEGER NOT NULL,content_hash TEXT NOT NULL,body_json TEXT NOT NULL,occurred_at TEXT NOT NULL,ingested_at TEXT NOT NULL,UNIQUE(source,source_account,source_ref));
 CREATE TABLE IF NOT EXISTS signal_outbox(signal_id TEXT NOT NULL REFERENCES signals(signal_id),revision INTEGER NOT NULL,body_json TEXT NOT NULL,delivery_id TEXT,next_attempt_at TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,PRIMARY KEY(signal_id,revision));
 CREATE TABLE IF NOT EXISTS signal_deliveries(delivery_id TEXT PRIMARY KEY,envelope_json TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at TEXT NOT NULL,created_at TEXT NOT NULL,sent_at TEXT,http_status INTEGER);
 CREATE TABLE IF NOT EXISTS signal_ingress_log(id TEXT PRIMARY KEY,content_hash TEXT NOT NULL,signal_id TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS signal_outbox_due ON signal_outbox(state,next_attempt_at);
 `);
 // 仅重建本模块自有触发器；不删业务表/记录，保证旧候选副本升级也采用当前全文合同。
 for(const name of ['signal_message_insert','signal_message_update','signal_codex_state','signal_task_approval','signal_action_sent'])db.exec('DROP TRIGGER IF EXISTS '+name);
 const enqueue=(name:string,table:string,event:string,condition:string,source:string,account:string,ref:string,kind:string,body:string,hash:string,occurred:string,entity:string="NULL",trustedNew=false)=>{
  const entityRef=entity==='NULL'?"'message_signal_'||signal_id||'_'||revision":entity;
  const materialize=table==='entity_message_entities'?'':`INSERT OR IGNORE INTO entity_message_entities(id,source,source_account,source_ref,source_version,content_hash,occurred_at,collected_at,delivery_state,body_json,revision,created_at,updated_at) SELECT 'message_signal_'||signal_id||'_'||revision,source,source_account,source_ref,'signal/v2:'||revision,signal_message_hash(source,source_ref,revision),occurred_at,ingested_at,'pending',signal_message_body(body_json),1,ingested_at,ingested_at FROM signals WHERE source=${source} AND source_account=${account} AND source_ref=${ref};`;
  if(trustedNew)db.exec('DROP TRIGGER IF EXISTS temp.'+name);
  db.exec(`CREATE ${trustedNew?'TEMP ':''}TRIGGER IF NOT EXISTS ${name} ${trustedNew?'BEFORE':'AFTER'} ${event} ON ${table} WHEN (SELECT mode FROM signal_pipeline WHERE singleton=1)='3layer' AND (${condition}) BEGIN
   INSERT INTO signals VALUES('sig_'||lower(hex(randomblob(16))),${source},${account},${ref},${kind},1,${hash},${body},${occurred},strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(source,source_account,source_ref) DO UPDATE SET revision=signals.revision+1,content_hash=excluded.content_hash,body_json=excluded.body_json,occurred_at=excluded.occurred_at,ingested_at=excluded.ingested_at WHERE signals.content_hash<>excluded.content_hash${trustedNew?' OR 1':''};
   ${materialize}
   INSERT OR IGNORE INTO signal_outbox(signal_id,revision,body_json,next_attempt_at,created_at)
    SELECT signal_id,revision,json_object('signal_id',signal_id,'source',source,'source_account',source_account,'source_ref',source_ref,'kind',kind,'revision',revision,'body',json(body_json),'occurred_at',occurred_at,'ingested_at',ingested_at,'entity_id',${entityRef}),ingested_at,ingested_at FROM signals WHERE source=${source} AND source_account=${account} AND source_ref=${ref}; END;`);
 };
 for(const event of ['INSERT','UPDATE'])enqueue('signal_message_'+event.toLowerCase(),'entity_message_entities',event,`NEW.deleted_at IS NULL AND ${event==='UPDATE'?"((NEW.content_hash<>OLD.content_hash AND NEW.body_json=OLD.body_json) OR signal_message_content(NEW.body_json)<>signal_message_content(OLD.body_json))":"NEW.source_version NOT LIKE 'signal/v2:%'"}`,'NEW.source','NEW.source_account','NEW.source_ref',"CASE WHEN json_extract(NEW.body_json,'$.signal_kind') IN ('message','calendar','contact','moments','codex.run','action.sent','system.health') THEN json_extract(NEW.body_json,'$.signal_kind') WHEN NEW.source='calendar' THEN 'calendar' WHEN NEW.source='contact' THEN 'contact' WHEN NEW.source='moments' THEN 'moments' ELSE 'message' END",'NEW.body_json','NEW.content_hash','NEW.occurred_at','NEW.id');
 // 连接专属TEMP触发器不写sqlite_schema，旧二进制/其他连接仍只见原持久去重逻辑。
 enqueue('source_identity_message_insert','entity_message_entities','INSERT',"NEW.deleted_at IS NULL AND source_identity_new_message(NEW.id)=1",'NEW.source','NEW.source_account','NEW.source_ref',"CASE WHEN json_extract(NEW.body_json,'$.signal_kind') IN ('message','calendar','contact','moments','codex.run','action.sent','system.health') THEN json_extract(NEW.body_json,'$.signal_kind') WHEN NEW.source='calendar' THEN 'calendar' WHEN NEW.source='contact' THEN 'contact' WHEN NEW.source='moments' THEN 'moments' ELSE 'message' END",'NEW.body_json','NEW.content_hash','NEW.occurred_at','NEW.id',true);
 // 保留 final_answer 原文（含 PR URL），终态没有结果/原因时显式报告缺件。
 const finalAnswer="CASE WHEN json_type(NEW.result_json,'$.final_answer')='text' THEN NULLIF(json_extract(NEW.result_json,'$.final_answer'),'') END";
 const terminalText="CASE WHEN NEW.status='completed' THEN COALESCE("+finalAnswer+",NULLIF(NEW.reason,''),'completed: final_answer_missing') ELSE COALESCE(("+finalAnswer+")||char(10)||char(10),'')||COALESCE(NULLIF(NEW.reason,''),NEW.status||': reason_missing') END";
 enqueue('signal_codex_state','desktop_executions','UPDATE',"NEW.status<>OLD.status AND NEW.status IN ('completed','failed','cancelled','expired')","'codex'","'sol'","NEW.id||':'||NEW.status","'codex.run'","json_object('message',"+terminalText+",'reason',NEW.reason,'signal_kind','codex.run','run_id',NEW.id,'task_id',NEW.task_id,'state',NEW.status,'causation_id',NEW.id)","NEW.id||':'||NEW.status",'NEW.updated_at');
 enqueue('signal_task_approval','entity_tasks','UPDATE',"NEW.status<>OLD.status AND NEW.status='awaiting_approval'","'codex'","'sol'","NEW.id||':needs_approval'","'codex.run'","json_object('message','needs_approval','signal_kind','codex.run','task_id',NEW.id,'state','needs_approval','causation_id',NEW.id)","NEW.id||':needs_approval'",'NEW.updated_at');
 enqueue('signal_action_sent','reply_deliveries','UPDATE',"NEW.status<>OLD.status AND NEW.status IN ('sent','delivered','confirmed') AND NEW.provider_receipt IS NOT NULL","'action'","'sol'",'NEW.delivery_id',"'action.sent'","json_object('message',NEW.payload,'signal_kind','action.sent','causation_id',NEW.delivery_id)",'NEW.payload_hash',"strftime('%Y-%m-%dT%H:%M:%fZ','now')");
}
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
function wire(raw:any,db:Database.Database){
 const textBound=(v:unknown,max:number)=>{const b=Buffer.from(typeof v==='string'?v:'');let n=Math.min(max,b.length);while(n>0&&n<b.length&&(b[n]!&0xc0)===0x80)n--;return b.subarray(0,n).toString();};
 const body=raw.body??{},text=typeof body.message==='string'?body.message:typeof body.text==='string'?body.text:JSON.stringify(body);
 let clipped=text,truncated=false;
 if(Buffer.byteLength(text)>65536){let end=65536;const bytes=Buffer.from(text);while(end>0&&(bytes[end]!&0xc0)===0x80)end--;clipped=bytes.subarray(0,end).toString();truncated=true;}
 const envelope={signal_id:raw.signal_id,kind:raw.kind,source:raw.source,source_account:raw.source_account,source_ref:raw.source_ref,dedup_key:hash(JSON.stringify([raw.source,raw.source_account,raw.source_ref])),revision:raw.revision,occurred_at:raw.occurred_at,ingested_at:raw.ingested_at,conversation:body.conversation?{id:textBound(body.conversation.id,512),title:textBound(body.conversation.title,512),type:['dm','group'].includes(body.conversation.type)?body.conversation.type:null}:null,actor:{display:textBound(typeof body.sender==='string'?body.sender:body.sender?.display??body.actor?.display,512),source_uid:textBound(body.sender?.source_uid??body.actor?.source_uid,512)},content:{text:clipped,attachments:(Array.isArray(body.attachments)?body.attachments:[]).slice(0,100).map((a:any,i:number)=>({name:textBound(a?.name??a?.filename,256),mime:textBound(a?.mime,128),ss_url:typeof a?.ss_url==='string'&&a.ss_url.startsWith('/api/v2/')&&Buffer.byteLength(a.ss_url)<=1024?a.ss_url:'/api/v2/entities/message-entities/'+encodeURIComponent(raw.entity_id??raw.signal_id)+'#attachment-'+i}))},causation_id:typeof body.causation_id==='string'?textBound(body.causation_id,256):null,privacy:body.privacy==='sensitive'?'sensitive':'normal',truncated, ...(truncated?{message_ref:'/api/v2/entities/message-entities/'+encodeURIComponent(raw.entity_id??raw.signal_id)}:{})};
 // JSON转义后的字节也计入256KB合同；超额保留现message回查，不让单条撑破批次。
 while(Buffer.byteLength(JSON.stringify(envelope))>240000){
  envelope.truncated=true;(envelope as any).message_ref='/api/v2/entities/message-entities/'+encodeURIComponent(raw.entity_id??raw.signal_id);
  if(envelope.content.attachments.length)envelope.content.attachments.pop();
  else envelope.content.text=textBound(envelope.content.text,Math.floor(Buffer.byteLength(envelope.content.text)/2));
 }
 // Verified source metadata, not text matching: the decision thread's own Codex
 // output is stored as a result observation and must not wake itself forever.
 if(raw.source==='codex'&&typeof body.sender_thread_uuid==='string'&&z.uuid().safeParse(body.sender_thread_uuid).success)(envelope as any).origin_thread_id=body.sender_thread_uuid;
 if(raw.source==='codex'&&body.native_result?.verified_by==='codex_app_server_v1'&&body.native_result.observation_only===true)(envelope as any).native_observation_only=true;
 if(raw.source==='codex'&&body.native_result?.verified_by==='codex_app_server_v1'&&typeof body.native_result.receipt_id==='string')(envelope as any).native_receipt_id=body.native_result.receipt_id;
 if(raw.source==='codex'&&body.native_result?.verified_by==='codex_app_server_v1'&&Array.isArray(body.native_result.notification_items))(envelope as any).native_notification_items=body.native_result.notification_items;
 if(typeof raw.entity_id==='string')(envelope as any).message_ref='/api/v2/entities/message-entities/'+encodeURIComponent(raw.entity_id);
 let provider:string|undefined,conflict=false;
 try{provider=signalProvider(db,raw);}catch{conflict=true;}
 const tagged=['feishu_approval','feishu_task'].includes(body.reader_metadata?.provider);
 if(provider)(envelope as any).source_provider=provider;
 else if(conflict||Object.hasOwn(raw,'source_provider')||Object.hasOwn(body,'source_provider')||tagged||knownProviderScope(raw.source,raw.source_ref)||hasProviderHistory(db,raw.signal_id,raw.entity_id))
  (envelope as any).source_provider=null;
 if(provider)bindWireIdentity(db,raw,envelope);
 return envelope;
}
export class SignalLedger{
 private db:Database.Database;constructor(db:Database.Database){this.db=db;}
  run(raw:unknown):any{const c=z.union([input,decisionInput,nativeInput]).parse(raw);return this.db.transaction(()=>{
  if(c.operation.startsWith('native_'))return new NativeTerminalLedger(this.db).run(c);
  if(c.operation.startsWith('decision_'))return new DecisionIntakeLedger(this.db).run(c);
  const legacy=input.parse(c);
  return this.runSignal(legacy);
 }).immediate();}
 private runSignal(c:z.infer<typeof input>):any{
  if(c.operation==='replay_decision'){
   // Explicit business reconciliation of existing identities. Never reset source
   // cursors, synthesize messages, or re-send to the former HTTP consumer.
   const requestDigest=hash(JSON.stringify({items:c.items,target:c.target}));
   const previous=this.db.prepare('SELECT digest FROM decision_replay_requests WHERE delivery_id=?').get(c.delivery_id) as any;
   if(previous&&previous.digest!==requestDigest)throw new DomainError('decision_delivery_conflict',409);
   const rows=c.items.map(item=>{
    const row=this.db.prepare("SELECT body_json FROM signal_outbox WHERE json_extract(body_json,'$.entity_id')=? AND signal_id=? AND revision=?").get(item.entity_id,item.signal_id,item.revision) as any;
    if(!row)throw new DomainError('decision_source_signal_not_found',404);return JSON.parse(row.body_json);
   });
   // Same v2 wire budget as next(); larger selections must use separate batches.
   const signals=rows.map(raw=>wire(raw,this.db));if(signals.length>50||Buffer.byteLength(JSON.stringify(signals))>250000)throw new DomainError('signal_batch_budget_exceeded',422);
   const envelope={schema:'smart-shadow.signal/v2',delivery_id:c.delivery_id,sent_at:rows.map(r=>r.ingested_at).sort().at(-1),signals};
   const result=new DecisionIntakeLedger(this.db).run(c.registry?{operation:'decision_enqueue_routed',registry:c.registry,envelope}:{operation:'decision_enqueue',target:c.target,envelope});
   this.db.prepare('INSERT OR IGNORE INTO decision_replay_requests VALUES(?,?)').run(c.delivery_id,requestDigest);return result;
  }
  if(c.operation==='mode'){this.db.prepare('UPDATE signal_pipeline SET mode=? WHERE singleton=1').run(c.mode);return {mode:c.mode};}
  if(c.operation==='status')return {schema:'smart-shadow.signal/v2',schema_version:1,mode:(this.db.prepare('SELECT mode FROM signal_pipeline').get() as any).mode,states:this.db.prepare('SELECT state,COUNT(*) count FROM signal_outbox GROUP BY state').all(),pending_by_source:this.db.prepare("SELECT s.source,s.source_account,COUNT(*) count FROM signal_outbox o JOIN signals s USING(signal_id) WHERE o.state='pending' GROUP BY s.source,s.source_account").all()};
  if(c.operation==='ingress'){
   const body=JSON.stringify({message:c.content.text,attachments:c.content.attachments,causation_id:c.causation_id,privacy:c.privacy,signal_kind:c.kind}),digest=hash(JSON.stringify(c)),old=this.db.prepare('SELECT * FROM signal_ingress_log WHERE id=?').get(c.id) as any;
   if(old){if(old.content_hash!==digest)throw new DomainError('signal_ingress_conflict',409);return {signal_id:old.signal_id,replayed:true};}
   const id='sig_'+randomUUID();this.db.prepare('INSERT INTO signals VALUES(?,?,?,?,?,1,?,?,?,?) ON CONFLICT(source,source_account,source_ref) DO UPDATE SET revision=signals.revision+1,content_hash=excluded.content_hash,body_json=excluded.body_json,occurred_at=excluded.occurred_at,ingested_at=excluded.ingested_at WHERE signals.content_hash<>excluded.content_hash').run(id,c.source,c.source_account,c.source_ref,c.kind,hash(body),body,c.occurred_at,new Date().toISOString());
   const s=this.db.prepare('SELECT * FROM signals WHERE source=? AND source_account=? AND source_ref=?').get(c.source,c.source_account,c.source_ref) as any;
   this.db.prepare('INSERT OR IGNORE INTO signal_outbox(signal_id,revision,body_json,next_attempt_at,created_at) VALUES(?,?,?,?,?)').run(s.signal_id,s.revision,JSON.stringify({...s,entity_id:'message_signal_'+s.signal_id+'_'+s.revision,body:JSON.parse(s.body_json)}),s.ingested_at,s.ingested_at);
   this.db.prepare('INSERT OR IGNORE INTO entity_message_entities(id,source,source_account,source_ref,source_version,content_hash,occurred_at,collected_at,delivery_state,body_json,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?)').run('message_signal_'+s.signal_id+'_'+s.revision,s.source,s.source_account,s.source_ref,'signal/v2:'+s.revision,signalMessageHash(s.source,s.source_ref,s.revision),s.occurred_at,s.ingested_at,'pending',JSON.stringify(signalMessageBody(JSON.parse(s.body_json))),s.ingested_at,s.ingested_at);
   this.db.prepare('INSERT INTO signal_ingress_log VALUES(?,?,?)').run(c.id,digest,s.signal_id);return {signal_id:s.signal_id,replayed:false};
  }
  if(c.operation==='next'){
   const active=!!this.db.prepare('SELECT 1 FROM decision_formal_activation').get()||!!this.db.prepare('SELECT 1 FROM decision_provider_activations').get();
   if(active!==c.formal_only)throw new DomainError('formal_dispatch_mode_conflict',409);
   if(c.formal_only){
    const prior=this.db.prepare("SELECT d.* FROM signal_deliveries d JOIN decision_formal_owned_deliveries f USING(delivery_id) WHERE d.state='pending' AND d.next_attempt_at<=? ORDER BY d.next_attempt_at,d.attempts,d.created_at,d.delivery_id LIMIT 1").get(c.now) as any;
    if(prior)return JSON.parse(prior.envelope_json);
    const registry=c.formal_registry_raw===undefined?undefined:channelRegistry.parse(parseRegistryJson(c.formal_registry_raw));
    const intake=new DecisionIntakeLedger(this.db);
    // 原协议每帧50保持；不能先取50个旧/无关row让独立provider永远饿死。
    const candidates=this.db.prepare("SELECT o.* FROM signal_outbox o WHERE o.state='pending' AND o.delivery_id IS NULL AND o.next_attempt_at<=? AND NOT EXISTS(SELECT 1 FROM decision_formal_legacy_outbox f WHERE f.signal_id=o.signal_id AND f.revision=o.revision) ORDER BY o.created_at,o.signal_id,o.revision").iterate(c.now);
    const rows:any[]=[];for(const row of candidates as Iterable<any>){if(!intake.formalOutboxEligible(row.signal_id,row.revision,registry))continue;rows.push(row);if(rows.length===50)break;}
    if(!rows.length)return null;
    const delivery_id=randomUUID(),signals:any[]=[],providerItems:any[]=[];for(const row of rows){const s=wire(JSON.parse(row.body_json),this.db);if(Buffer.byteLength(JSON.stringify([...signals,s]))>250000&&signals.length)break;signals.push(s);const proof=intake.providerSelectionProof(s);if(proof)providerItems.push(proof);intake.noteProviderWire(s);}
    const envelope={schema:'smart-shadow.signal/v2',delivery_id,sent_at:c.now,signals},bytes=JSON.stringify(envelope);
    this.db.prepare('INSERT INTO signal_deliveries(delivery_id,envelope_json,next_attempt_at,created_at) VALUES(?,?,?,?)').run(delivery_id,bytes,c.now,c.now);
    this.db.prepare('INSERT INTO decision_formal_owned_deliveries VALUES(?,?)').run(delivery_id,hash(bytes));
    if(signals.some(s=>Object.hasOwn(s,'source_provider')||knownProviderScope(s.source,s.source_ref)||hasProviderHistory(this.db,s.signal_id))){
     if(!registry||c.formal_registry_raw===undefined)throw new DomainError('provider_registry_snapshot_required',409);
     const snapshot=canonicalJson({schema:'provider-delivery-registry/v1',registry_raw:c.formal_registry_raw,registry_raw_hash:hash(c.formal_registry_raw),registry_hash:registryHash(registry),envelope_hash:hash(bytes),provider_items:providerItems});
     this.db.prepare('INSERT INTO decision_provider_delivery_registry VALUES(?,?,?)').run(delivery_id,snapshot,hash(snapshot));
    }
    for(const item of signals)this.db.prepare('UPDATE signal_outbox SET delivery_id=? WHERE signal_id=? AND revision=?').run(delivery_id,item.signal_id,item.revision);
    return envelope;
   }
   // One configured HTTP target: an explicit peer Retry-After still covers it.
   if(this.db.prepare("SELECT 1 FROM signal_deliveries WHERE state='pending' AND next_attempt_at>? LIMIT 1").get(c.now))return null;
   const prior=this.db.prepare("SELECT * FROM signal_deliveries WHERE state='pending' AND next_attempt_at<=? ORDER BY next_attempt_at,attempts,created_at,delivery_id LIMIT 1").get(c.now) as any;
   const rows=this.db.prepare("SELECT * FROM signal_outbox WHERE state='pending' AND delivery_id IS NULL AND next_attempt_at<=? ORDER BY created_at,signal_id,revision LIMIT 50").all(c.now) as any[];
   // Failure updates the existing delivery's ready time, not a local delay.
   // Merge retries and fresh outbox work by age so a poison batch cannot monopolize next().
   if(prior&&(!rows.length||prior.next_attempt_at<rows[0].next_attempt_at))return JSON.parse(prior.envelope_json);
   if(!rows.length)return null;
   const delivery_id=randomUUID(),signals:any[]=[];for(const row of rows){const s=wire(JSON.parse(row.body_json),this.db);if(Buffer.byteLength(JSON.stringify([...signals,s]))>250000&&signals.length)break;signals.push(s);}
   const envelope={schema:'smart-shadow.signal/v2',delivery_id,sent_at:c.now,signals};this.db.prepare('INSERT INTO signal_deliveries(delivery_id,envelope_json,next_attempt_at,created_at) VALUES(?,?,?,?)').run(delivery_id,JSON.stringify(envelope),c.now,c.now);
   for(const s of signals)this.db.prepare('UPDATE signal_outbox SET delivery_id=? WHERE signal_id=? AND revision=?').run(delivery_id,s.signal_id,s.revision);return envelope;
  }
  const active=!!this.db.prepare('SELECT 1 FROM decision_formal_activation').get()||!!this.db.prepare('SELECT 1 FROM decision_provider_activations').get();
  if(active!==c.formal_only||c.formal_only&&!this.db.prepare('SELECT 1 FROM decision_formal_owned_deliveries WHERE delivery_id=?').get(c.delivery_id))throw new DomainError('formal_dispatch_mode_conflict',409);
  const d=this.db.prepare('SELECT * FROM signal_deliveries WHERE delivery_id=?').get(c.delivery_id) as any;if(!d)throw new DomainError('signal_delivery_not_found',404);if(d.state!=='pending')return {state:d.state,replayed:true};
  const sent=c.http_status>=200&&c.http_status<300,overdue=!sent&&Date.parse(c.now)-Date.parse(d.created_at)>=86400000,state=sent?'sent':'pending',delay=c.retry_after_ms /* HTTP Retry-After, RFC 9110 section 10.2.3; no local backoff */;
  this.db.prepare('UPDATE signal_deliveries SET state=?,attempts=attempts+1,next_attempt_at=?,sent_at=?,http_status=? WHERE delivery_id=?').run(state,externalRetryAt(c.now,delay),sent?c.now:null,c.http_status,c.delivery_id);
  if(sent)this.db.prepare('UPDATE signal_outbox SET state=? WHERE delivery_id=?').run(state,c.delivery_id);
  // The former age budget is observation only: warn once without ending retries.
  const deadAlert=overdue&&!this.db.prepare("SELECT 1 FROM signals WHERE source='shadowd' AND source_ref=?").get('dead:'+c.delivery_id)&&!JSON.parse(d.envelope_json).signals.every((s:any)=>s.kind==='system.health'&&s.source_ref.startsWith('dead:'));
  if(deadAlert)this.run({operation:'ingress',id:'dead:'+c.delivery_id,kind:'system.health',source:'shadowd',source_account:'sol',source_ref:'dead:'+c.delivery_id,occurred_at:c.now,content:{text:'signal_delivery_dead:'+c.delivery_id,attachments:[]},causation_id:c.delivery_id,privacy:'normal'});
  return {state,attempts:d.attempts+1,dead_alert:deadAlert};
 }
}
