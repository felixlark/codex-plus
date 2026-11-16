import {LarkCollector} from '../channels/lark.ts';
import {messageItem} from '../channels/mail-lark-ingest.ts';
import {adaptLark} from '../channels/source-intake/adapters.ts';
import {EntityStore} from '../entities/store.ts';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {initializeDecisionIntake,DecisionIntakeLedger} from './decision-intake.ts';
import {it,expect,vi} from 'vitest';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {initializeSignals,SignalLedger} from './signals.ts';
import {entitySchema} from '../entities/schema.ts';
import {DecisionIntakePump,type DecisionHost} from './decision-intake.ts';
const target={host:'local-fixture',thread_id:'existing-thread',project_id:'existing-project',cwd:'/fixture/project'};
const signal=(id='one',revision=1)=>({signal_id:id,revision,kind:'message',causation_id:null,content:{text:'synthetic original',attachments:[]}});
const envelope=(signals:any[]=[signal()])=>({schema:'smart-shadow.signal/v2',delivery_id:randomUUID(),signals});
function fixture(path=':memory:'){
 const db=new Database(path);db.exec(entitySchema);db.exec('CREATE TABLE IF NOT EXISTS desktop_executions(id TEXT,task_id TEXT,status TEXT,result_json TEXT,updated_at TEXT,reason TEXT);CREATE TABLE IF NOT EXISTS reply_deliveries(delivery_id TEXT,status TEXT,provider_receipt TEXT,payload TEXT,payload_hash TEXT);');initializeSignals(db);
 const ledger=new SignalLedger(db);return {db,run:(c:any)=>ledger.run(c) as any};
}
function enqueue(f:ReturnType<typeof fixture>,e=envelope()){f.run({operation:'decision_enqueue',target,envelope:e});return e;}
function accept(f:ReturnType<typeof fixture>){const w=f.run({operation:'decision_claim'});f.run({operation:'decision_report',wake_id:w.wake_id,outcome:'accepted',submission_id:'queue-fixture',turn_id:'turn:'+w.wake_id});return w;}
function receipt(f:ReturnType<typeof fixture>,stage:string,cause:string,items=[{signal_id:'one',revision:1}],extra={}){
 const c={operation:'decision_receipt',receipt_id:randomUUID(),stage,items,causation_id:cause,evidence_ref:'fixture://evidence/'+stage,...extra};f.run(c);return c;
}
it('same delivery and overlapping batches keep one signal-version, while changed content conflicts atomically',()=>{
 const f=fixture(),a=enqueue(f),b=envelope([signal(),signal('two')]);enqueue(f,a);enqueue(f,b);
 const first=accept(f),second=accept(f);expect(first.envelope.signals).toEqual([signal()]);expect(second.envelope.signals).toEqual([signal('two')]);expect(f.run({operation:'decision_claim'})).toBeNull();
 expect(()=>enqueue(f,{...a,signals:[signal('changed')]})).toThrow('decision_delivery_conflict');
 const conflict=envelope([signal('new'),{...signal(),kind:'calendar'}]);expect(()=>enqueue(f,conflict)).toThrow('decision_signal_conflict');
 expect(f.db.prepare('SELECT COUNT(*) n FROM decision_items').get()).toEqual({n:2});expect(f.run({operation:'decision_status'}).batches.every((r:any)=>r.host_accepted)).toBe(true);f.db.close();
});
it('all duplicate delivery creates no second wake and follows its canonical receipt',()=>{
 const f=fixture();enqueue(f);const b=enqueue(f,envelope());expect(f.run({operation:'decision_status',delivery_id:b.delivery_id}).batches[0].host_accepted).toBe(false);accept(f);expect(f.run({operation:'decision_claim'})).toBeNull();expect(f.run({operation:'decision_status',delivery_id:b.delivery_id}).batches[0].host_accepted).toBe(true);f.db.close();
});
it('target is fixed; revision changes remain distinct; duplicate entries roll back',()=>{
 const f=fixture(),e=enqueue(f);expect(()=>f.run({operation:'decision_enqueue',target:{...target,thread_id:'other'},envelope:envelope()})).toThrow('decision_target_conflict');
 enqueue(f,envelope([signal('one',2)]));expect(accept(f).envelope.signals[0].revision).toBe(1);expect(accept(f).envelope.signals[0].revision).toBe(2);
 expect(()=>enqueue(f,envelope([signal('dup'),signal('dup')]))).toThrow('decision_duplicate_item');expect(f.run({operation:'decision_status'}).batches).toHaveLength(2);expect(e.delivery_id).toBeTruthy();f.db.close();
});
it('busy keeps durable work, unknown cannot be reset or retransmitted, acceptance is monotone',()=>{
 const f=fixture();enqueue(f);const first=f.run({operation:'decision_claim'});f.run({operation:'decision_report',wake_id:first.wake_id,outcome:'busy'});const retry=f.run({operation:'decision_claim'});expect(retry.wake_id).toBe(first.wake_id);
 f.run({operation:'decision_report',wake_id:first.wake_id,outcome:'unknown'});enqueue(f,envelope([signal('later')]));const independent=accept(f);expect(independent).toMatchObject({action:'submit'});expect(independent.envelope.signals[0].signal_id).toBe('later');expect(f.run({operation:'decision_claim'})).toMatchObject({action:'reconcile',wake_id:first.wake_id});
 expect(()=>f.run({operation:'decision_report',wake_id:first.wake_id,outcome:'busy'})).toThrow('decision_unknown_requires_reconciliation');
 f.run({operation:'decision_report',wake_id:first.wake_id,outcome:'accepted',submission_id:'queue-fixture',turn_id:'exact-turn'});expect(()=>f.run({operation:'decision_report',wake_id:first.wake_id,outcome:'accepted',submission_id:'queue-fixture',turn_id:'different-turn'})).toThrow('decision_receipt_conflict');expect(f.run({operation:'decision_claim'})).toBeNull();f.db.close();
});
it('crash before/after external submit reopens only as reconciliation with original wake',()=>{
 const dir=mkdtempSync(join(tmpdir(),'decision-intake-')),path=join(dir,'state.db');try{
  const a=fixture(path);enqueue(a);const w=a.run({operation:'decision_claim'});a.db.close();const b=fixture(path);expect(b.run({operation:'decision_claim'})).toMatchObject({action:'reconcile',wake_id:w.wake_id});b.run({operation:'decision_report',wake_id:w.wake_id,outcome:'unknown'});b.db.close();const c=fixture(path);expect(c.run({operation:'decision_claim'})).toMatchObject({action:'reconcile',wake_id:w.wake_id});c.run({operation:'decision_report',wake_id:w.wake_id,outcome:'accepted',submission_id:'queue-fixture',turn_id:'observed-original-turn'});expect(c.run({operation:'decision_claim'})).toBeNull();c.db.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
it('receipt chain keeps durable acceptance, decision, unique owner, result and final receipt distinct without signals',()=>{
 const f=fixture();enqueue(f);const w=accept(f),received=receipt(f,'durable_received',w.wake_id),judged=receipt(f,'judged',received.receipt_id),owner=receipt(f,'owner_accepted',judged.receipt_id,undefined,{owner_ref:'fixture://handler/existing-task'});
 expect(f.run(owner)).toMatchObject({replayed:true});expect(()=>receipt(f,'owner_accepted',judged.receipt_id,undefined,{owner_ref:'fixture://other/task'})).toThrow('decision_owner_conflict');
 expect(()=>receipt(f,'received',judged.receipt_id)).toThrow('decision_owner_result_required');
 expect(()=>receipt(f,'result',judged.receipt_id,undefined,{owner_ref:'fixture://handler/existing-task'})).toThrow('decision_cause_not_found');
 const result=receipt(f,'result',owner.receipt_id,undefined,{owner_ref:'fixture://handler/existing-task'});receipt(f,'received',result.receipt_id);expect(f.run({operation:'decision_status'}).receipts).toHaveLength(5);expect(f.db.prepare('SELECT COUNT(*) n FROM signals').get()).toEqual({n:0});f.db.close();
});
it('FYI and missing-material decisions can be received without owner, final delivery or invented execution',()=>{
 const f=fixture();enqueue(f);const w=accept(f),r=receipt(f,'durable_received',w.wake_id),d=receipt(f,'judged',r.receipt_id);receipt(f,'received',d.receipt_id);expect(f.run({operation:'decision_status'}).receipts.map((r:any)=>r.stage)).toEqual(['durable_received','judged','received']);f.db.close();
});
it('receipt requires exact causal membership and evidence; invalid facts roll back',()=>{
 const f=fixture();enqueue(f);enqueue(f,envelope([signal('other')]));const w=accept(f);accept(f);
 expect(()=>receipt(f,'durable_received',w.wake_id,[{signal_id:'other',revision:1}])).toThrow('decision_cause_item_mismatch');
 const r=receipt(f,'durable_received',w.wake_id);expect(()=>receipt(f,'judged',r.receipt_id,[{signal_id:'other',revision:1}])).toThrow('decision_cause_item_mismatch');
 expect(()=>f.run({...r,evidence_ref:'changed'})).toThrow('decision_receipt_conflict');expect(()=>receipt(f,'owner_accepted',r.receipt_id)).toThrow();expect(f.run({operation:'decision_status'}).receipts).toHaveLength(1);f.db.close();
});
it('pump acknowledges existing outbox only after durable intake; host failure keeps original for lookup and never repeats submit',async()=>{
 const f=fixture();f.run({operation:'ingress',id:'source-event',kind:'message',source:'fixture',source_account:'fixture',source_ref:'original',occurred_at:'2026-10-19T00:00:00Z',content:{text:'synthetic original',attachments:[]}});
 let submits=0,lookups=0;const host:DecisionHost={enqueue:async()=>{submits++;throw new Error('transport unknown');},lookup:async()=>{lookups++;return {outcome:'accepted',submission_id:'queue-fixture',turn_id:'same-turn'};}};
 const pump=new DecisionIntakePump(async c=>f.run(c),target,host);await pump.tick();expect(submits).toBe(1);expect(f.run({operation:'next',now:new Date().toISOString()})).toBeNull();await pump.tick();expect(submits).toBe(1);expect(lookups).toBe(1);expect(f.run({operation:'decision_status'}).batches[0]).toMatchObject({state:'accepted',turn_id:'same-turn',host_accepted:true});f.db.close();
});
it('failed durable intake cannot acknowledge source; concurrent ticks have one writer',async()=>{
 const f=fixture();f.run({operation:'ingress',id:'p',kind:'message',source:'fixture',source_account:'fixture',source_ref:'p',occurred_at:'2026-10-19T00:00:00Z',content:{text:'synthetic',attachments:[]}});let submits=0;const host:DecisionHost={enqueue:async()=>{submits++;return {outcome:'busy'};},lookup:async()=>({outcome:'unknown'})};
 const broken=new DecisionIntakePump(async(c:any)=>{if(c.operation==='decision_enqueue')throw new Error('disk failure');return f.run(c);},target,host);await expect(broken.tick()).rejects.toThrow('disk failure');expect(submits).toBe(0);expect(f.run({operation:'next',now:new Date().toISOString()})).not.toBeNull();
 const pump=new DecisionIntakePump(async c=>f.run(c),target,host);await Promise.all([pump.tick(),pump.tick()]);expect(submits).toBe(1);expect(f.run({operation:'decision_status'}).batches[0].state).toBe('queued');f.db.close();
});
it('own decision-thread Codex output is observed without a new wake; other projects still return results',()=>{
 const f=fixture();enqueue(f,envelope([{...signal('own'),source:'codex',origin_thread_id:target.thread_id}]));expect(f.run({operation:'decision_claim'})).toBeNull();expect(f.run({operation:'decision_status'}).batches[0]).toMatchObject({observed_only:true,host_accepted:false});enqueue(f,envelope([{...signal('project'),source:'codex',origin_thread_id:'project-thread'}]));expect(accept(f).envelope.signals[0].signal_id).toBe('project');f.db.close();
});
it('explicit natural reconciliation reuses exact existing signal/revision without resetting collection or HTTP state',()=>{
 const f=fixture();f.run({operation:'ingress',id:'original',kind:'message',source:'fixture',source_account:'fixture',source_ref:'original',occurred_at:'2026-10-19T00:00:00Z',content:{text:'synthetic original',attachments:[]}});
 const batch=f.run({operation:'next',now:new Date().toISOString()});f.run({operation:'settle',delivery_id:batch.delivery_id,http_status:200,now:new Date().toISOString()});const original=batch.signals[0],id=decodeURIComponent(original.message_ref.split('/').at(-1)),delivery_id=randomUUID();
 const request={operation:'replay_decision',target,delivery_id,items:[{entity_id:id,signal_id:original.signal_id,revision:original.revision}]};f.run(request);f.run(request);const work=accept(f);expect(work.envelope.signals[0]).toEqual(original);expect(f.run({operation:'next',now:new Date().toISOString()})).toBeNull();expect(f.run({operation:'decision_claim'})).toBeNull();expect(()=>f.run({...request,delivery_id:randomUUID(),items:[{entity_id:'not-an-existing-entity',signal_id:original.signal_id,revision:original.revision}]})).toThrow('decision_source_signal_not_found');f.db.close();
});
it('safe view reads exact original outbox revision, keeps raw receipt contract intact, and survives reopen',()=>{
 const root=mkdtempSync(join(tmpdir(),'decision-view-')),path=join(root,'db');let f=fixture(path);
 try{
  f.run({operation:'ingress',id:'original-image',kind:'message',source:'fixture',source_account:'fixture',source_ref:'original',occurred_at:'2026-10-19T00:00:00Z',content:{text:'source text data:image/png;base64,'+'A'.repeat(70000),attachments:[]}});
  const batch=f.run({operation:'next',now:new Date().toISOString()});enqueue(f,batch);const before=f.run({operation:'decision_status',delivery_id:batch.delivery_id});const view=f.run({operation:'decision_view',delivery_id:batch.delivery_id});
  expect(view.signals[0].content.text).toContain('source text');expect(view.signals[0].content.text).not.toContain('data:image');expect(view.signals[0].representation.original_text_bytes).toBeGreaterThan(65536);expect(view.signals[0].entity_current.revision).toBe(1);
  expect(f.run({operation:'decision_status',delivery_id:batch.delivery_id})).toEqual(before);f.db.close();f=fixture(path);expect(f.run({operation:'decision_view',delivery_id:batch.delivery_id})).toEqual(view);expect(()=>f.run({operation:'decision_view',delivery_id:randomUUID()})).toThrow('decision_delivery_not_found');
 }finally{f.db.close();rmSync(root,{recursive:true,force:true});}
});

it('formal intent freezes before submit and file reopen only reconciles while legacy bytes remain unchanged',()=>{
const temp=mkdtempSync(join(tmpdir(),'formal-intent-synthetic-')),dbpath=join(temp,'test.db');let db=new Database(dbpath);db.exec(entitySchema);initializeDecisionIntake(db);db.exec('CREATE TABLE signal_outbox(signal_id TEXT,revision INTEGER,body_json TEXT,delivery_id TEXT);CREATE TABLE signal_deliveries(delivery_id TEXT PRIMARY KEY,envelope_json TEXT);CREATE TABLE native_terminal_observations(identity TEXT,entity_id TEXT);CREATE TABLE native_terminal_bindings(receipt_id TEXT,identity TEXT);CREATE TABLE native_terminal_checks(receipt_id TEXT,state TEXT,reason TEXT,checked_at TEXT);');let ledger=new DecisionIntakeLedger(db);const run=(c:any)=>db.transaction(()=>ledger.run(c) as any).immediate();
const tuple={host:'local',thread_id:randomUUID(),project_id:randomUUID(),cwd:'/synthetic'};
const registry={schema_version:1,sources:{feishu:{synthetic:'feishu_im'}},targets:{feishu_im:{...tuple,task_id:'transmission-channel-feishu-im'}},exception_target:'feishu_im'};
const env=(id:string)=>({schema:'smart-shadow.signal/v2',delivery_id:randomUUID(),signals:[{signal_id:id,revision:1,kind:'message',source:'feishu',source_account:'synthetic',source_ref:'synthetic:'+id}]});
const old=env('old');run({operation:'decision_enqueue',target:tuple,envelope:old});const bytes=JSON.stringify(db.prepare('SELECT * FROM decision_batches WHERE delivery_id=?').get(old.delivery_id));
// 新Feishu须读到准确原outbox及冻结wire；合成fixture不以自填source冒可信IM。
db.prepare('INSERT INTO decision_formal_activation VALUES(1,?)').run(JSON.stringify({native_creation_boundary:{schema:'producer-observation-boundary/v2',entity_audit_sequence:0,captures:[]}}));
const native=createNativeImFixture(db,'fresh','synthetic original'),fresh=env('fresh');fresh.signals[0]!.source_ref=native.source_ref;const freshRaw=JSON.stringify(fresh);db.prepare('INSERT INTO signal_outbox VALUES(?,?,?,?)').run('fresh',1,JSON.stringify({...fresh.signals[0],body:native.body,entity_id:native.id,occurred_at:native.occurred_at}),fresh.delivery_id);db.prepare('INSERT INTO signal_deliveries VALUES(?,?)').run(fresh.delivery_id,freshRaw);db.prepare('INSERT INTO decision_formal_owned_deliveries VALUES(?,?)').run(fresh.delivery_id,createHash('sha256').update(freshRaw).digest('hex'));run({operation:'decision_enqueue_routed',registry,envelope:fresh,formal_registry_raw:JSON.stringify(registry)});
let w=run({operation:'decision_formal_claim'});assert.equal(w.action,'prepare');assert.equal(w.envelope.signals[0].signal_id,'fresh');
assert.equal(run({operation:'decision_formal_claim'}).action,'prepare');
const raw=JSON.stringify({agent:'codex',transport:'desktop',instruction:'SHADOW_DECISION_INTENT=formal:'+w.envelope.delivery_id,acceptance_criteria:['synthetic'],expected_task_revision:1,context_refs:[],attachment_refs:[],required_capabilities:[]});
const intent={transport_kind:'formal_task/v1',intent_id:'formal:'+w.envelope.delivery_id,eligibility_hash:createHash('sha256').update((db.prepare('SELECT eligibility_json FROM decision_formal_intents').get() as any).eligibility_json).digest('hex'),idempotency_key:'formal:'+w.envelope.delivery_id,wake_id:w.wake_id,task_id:'transmission-channel-feishu-im',actor:'decision-task-host',submission_json:raw,submission_hash:createHash('sha256').update(raw).digest('hex'),binding:{project_id:'transmission',codex_project_id:tuple.project_id,thread_id:tuple.thread_id,cwd:tuple.cwd}};
run({operation:'decision_formal_freeze',wake_id:w.wake_id,intent});assert.equal(run({operation:'decision_formal_claim'}).action,'submit');db.close();db=new Database(dbpath);initializeDecisionIntake(db);ledger=new DecisionIntakeLedger(db);assert.equal(run({operation:'decision_formal_claim'}).action,'reconcile');
run({operation:'decision_formal_report',wake_id:w.wake_id,outcome:'unknown',execution_id:'exact-id',request_id:'request'});assert.equal(run({operation:'decision_formal_claim'}).action,'reconcile');
assert.throws(()=>run({operation:'decision_formal_report',wake_id:w.wake_id,outcome:'unknown',execution_id:'different'}));
assert.equal(JSON.stringify(db.prepare('SELECT * FROM decision_batches WHERE delivery_id=?').get(old.delivery_id)),bytes);
run({operation:'decision_enqueue_routed',registry,envelope:fresh,formal_registry_raw:JSON.stringify(registry)});assert.equal((db.prepare('SELECT count(*) n FROM decision_formal_intents').get() as any).n,1);
assert.throws(()=>run({operation:'decision_formal_freeze',wake_id:'decision:'+old.delivery_id,intent}));
db.close();rmSync(temp,{recursive:true,force:true});
});

it('activation preserves original unknown attempt bytes while legitimate historical D receipts remain appendable',()=>{
 const f=fixture();const old=enqueue(f);const work=f.run({operation:'decision_claim'});f.run({operation:'decision_report',wake_id:work.wake_id,outcome:'unknown'});
 const before=f.db.prepare('SELECT * FROM decision_batches WHERE delivery_id=?').get(old.delivery_id);
 expect(f.run({operation:'decision_status'}).formal_adoption).toEqual({schema:'smart-shadow.formal-task-adoption/v1',activation:null,inventory:{intents:0,owned_deliveries:0,legacy_outbox:0,legacy_deliveries:0,legacy_batches:0},frozen_integrity:null});
 const tuple={host:'local',thread_id:randomUUID(),project_id:randomUUID(),cwd:'/synthetic'};
 const registry={schema_version:1,sources:{feishu:{synthetic:'feishu_im'}},targets:{feishu_im:{...tuple,task_id:'transmission-channel-feishu-im'}},exception_target:'feishu_im'};
 f.run({operation:'decision_formal_activate',registry_raw:JSON.stringify(registry),binding:{project_id:'transmission',codex_project_id:tuple.project_id,thread_id:tuple.thread_id,cwd:tuple.cwd},task_revision:1,observed_at:'2026-11-01T14:00:00.000Z'});
 expect(f.run({operation:'decision_status'}).formal_adoption.inventory.legacy_batches).toBe(1);
 expect(()=>f.run({operation:'decision_claim'})).toThrow('formal_legacy_transport_disabled');expect(()=>f.run({operation:'decision_report',wake_id:work.wake_id,outcome:'accepted',submission_id:'synthetic-old-cli'})).toThrow('formal_legacy_transport_disabled');
 const received=receipt(f,'durable_received',work.wake_id);receipt(f,'judged',received.receipt_id);
 expect(f.db.prepare('SELECT * FROM decision_batches WHERE delivery_id=?').get(old.delivery_id)).toEqual(before);
 expect(f.run({operation:'decision_status',delivery_id:old.delivery_id}).receipts.map((r:any)=>r.stage)).toEqual(['durable_received','judged']);f.db.close();
});

it.each([false,true])('real private WX P projection and ordinary Store rewrite/clone rejection (external=%s)',async tamper=>{
 const {Store}=await import('../storage/client.ts'),{WeixinScope,WeixinIdentity,transitionWeixin}=await import('../channels/weixin-state.ts');
 const {weixinRegistrations}=await import('../channels/weixin-registration.ts'),{commitMessageDelta}=await import('../channels/mail-lark-ingest.ts'),{digest:sourceDigest}=await import('../canonical.ts');
 const {mkdirSync,copyFileSync,realpathSync}=await import('node:fs');
 const root=realpathSync(mkdtempSync(join(tmpdir(),'formal-wx-private-'))),dbpath=join(root,'source.db'),now=new Date().toISOString(),end=Math.floor(Date.parse(now)/1000),sha='a'.repeat(64),peer='fixture_peer';mkdirSync(join(root,'originals'),{mode:0o700});
 const scope=WeixinScope.parse({account_ref:'fixture_self',socket_path:'/fixture/unused.sock',account_epoch:sha,reader_sha256:sha,provider_sha256:sha,identity_evidence_ref:'synthetic-only',existing_authorization_ref:'synthetic-only',activation_at:now,history_days:7,peer_allowlist:['filehelper',peer]});
 const {socket_path,existing_authorization_ref,activation_at,...rest}=scope,readerIdentity=WeixinIdentity.parse({protocol:'weixin-reader-v1',...rest});
 const tuple={host:'local',thread_id:randomUUID(),project_id:randomUUID(),cwd:'/synthetic'},registry:any={schema_version:1,sources:{feishu:{fixture_im:'feishu_im'},weixin:{[scope.account_ref]:'weixin'}},targets:{feishu_im:{...tuple,task_id:'transmission-channel-feishu-im'},weixin:{...tuple,thread_id:randomUUID(),task_id:'transmission-channel-weixin'},exception:{...tuple,thread_id:randomUUID(),task_id:'transmission-channel-exception-catch'}},exception_target:'exception'};
 const store=new Store(dbpath,join(root,'content'),{sourceIntakeRoot:join(root,'originals')});let parent:any;
 try{
  await store.signals({operation:'mode',mode:'3layer'});
  await store.signals({operation:'decision_formal_activate',registry_raw:JSON.stringify(registry),binding:{project_id:'transmission',codex_project_id:tuple.project_id,thread_id:tuple.thread_id,cwd:tuple.cwd},task_revision:1,observed_at:now});
  const registration=weixinRegistrations(store,{enabled:true,entity_intake:true,entries:[{collector_ref:'synthetic-only',scope}]})[0]!;
  let checkpoint=await store.command({type:'lease_stream',stream_ref:registration.definition.stream_ref,channel:'weixin',account_ref:scope.account_ref,owner:'fixture',expected_generation:0,lease_ms:600000},'system'),context={definition:registration.definition,checkpoint,signal:new AbortController().signal};
  const manifest={identity:readerIdentity,start:end-7*86400,end,shards:{'message/message_0.db':sha},partitions:[{shard:'message/message_0.db',shard_epoch:sha,peer,high:1}]};
  await commitMessageDelta(store,context,sourceDigest(scope),transitionWeixin(scope,null,{scope,kind:'inventory',received_at:now,response:{manifest,manifest_hash:sourceDigest(manifest)}}));
  checkpoint=await store.query({type:'source_stream',stream_ref:registration.definition.stream_ref});context={...context,checkpoint};
  const locator={account_epoch:sha,shard:'message/message_0.db',shard_epoch:sha,peer,local_id:1,timestamp:end};
  await commitMessageDelta(store,context,sourceDigest(scope),transitionWeixin(scope,checkpoint.received_cursor,{scope,kind:'page',received_at:now,response:{identity:readerIdentity,manifest_hash:sourceDigest(manifest),index:0,after:0,next:1,done:true,items:[{locator,sender:peer,direction:'incoming',material:{complete:false,parts:[{kind:'text',text:'Synthetic private source, no platform probe'},{kind:'missing',code:'fixture_attachment_unavailable'}]}}]}}));
  expect(await store.command({type:'materialize_weixin_entities',stream_ref:registration.definition.stream_ref,generation:checkpoint.generation,scope},'system')).toMatchObject({created:1});
  parent=await store.signals({operation:'next',now:new Date().toISOString(),formal_only:true});expect(parent.signals.length).toBeGreaterThan(0);
  expect(JSON.parse(parent.signals[0].source_ref)).toEqual([peer,'weixin-local-v1:'+sourceDigest(locator)]);
  if(tamper){
   const routed=async(batch:any)=>{await store.signals({operation:'decision_enqueue_routed',registry,envelope:batch,formal_registry_raw:JSON.stringify(registry)});await store.signals({operation:'settle',delivery_id:batch.delivery_id,http_status:200,formal_only:true,now:'2099-01-01T00:00:00.000Z'});};
   await routed(parent);expect(await store.signals({operation:'decision_formal_claim'})).toMatchObject({action:'prepare',eligibility:{task_id:'transmission-channel-weixin'}});
   const frozen=JSON.stringify(await store.signals({operation:'decision_formal_claim'}));
   let entity=(await store.entities({operation:'list',collection:'message-entities'},'external-caller') as any).items.find((e:any)=>e.source==='weixin');expect(entity).toBeDefined();
   const original=structuredClone(entity.body);
   for(const [key,body,hash] of [['patch',{message:'External WX replacement without a new native version'},'b'.repeat(64)],['clone',original,sourceDigest(original)]] as const){
    await store.entities({operation:'update',collection:'message-entities',id:entity.id,revision:entity.revision,request_id:key,idempotency_key:key,data:{body,content_hash:hash}},'external-caller');
    const batch=await store.signals({operation:'next',formal_only:true,now:'2099-01-01T00:00:00.000Z'});expect(batch).not.toBeNull();await routed(batch);
    expect(JSON.stringify(await store.signals({operation:'decision_formal_claim'}))).toBe(frozen);
    expect((await store.signals({operation:'decision_status'})).formal_adoption.inventory.intents).toBe(1);
    entity=await store.entities({operation:'get',collection:'message-entities',id:entity.id},'external-caller');
   }
   return;
  }
 }finally{await store.close();if(tamper)rmSync(root,{recursive:true,force:true});}
 try{
  const cases=['direct','exception','locator_forgery','missing_version','stale_version','group','wrong_hash','body_provider','wire_forgery','wrong_account','wrong_actor','missing_audit','wx_to_im','wrong_task','exception_as_im','sender_forgery'] as const;
  for(const name of cases){
   const path=join(root,name+'.db');copyFileSync(dbpath,path);const f=fixture(path),selected=structuredClone(registry),input=structuredClone(parent);
   try{
    if(name==='exception')selected.sources.weixin[scope.account_ref]='exception';
    if(name==='wx_to_im')selected.sources.weixin[scope.account_ref]='feishu_im';
    if(name==='wrong_task')selected.targets.weixin.task_id='transmission-channel-feishu-im';
    if(name==='exception_as_im'){selected.sources.weixin[scope.account_ref]='exception';selected.targets.exception.task_id='transmission-channel-feishu-im';}
    if(name==='wrong_actor')f.db.prepare('UPDATE entity_write_receipts SET actor=? WHERE actor=?').run('external-caller','l1-source-intake');
    if(name==='missing_audit')f.db.exec("DELETE FROM entity_audit_events WHERE actor='l1-source-intake'");
    if(name==='missing_version')f.db.exec('DELETE FROM source_versions');
    if(name==='stale_version')f.db.prepare('UPDATE source_events SET current_version=?').run('different-version');
    if(name==='group')f.db.exec("UPDATE source_versions SET metadata=json_set(metadata,'$.conversation_type','group')");
    if(name==='wrong_hash')f.db.prepare('UPDATE source_versions SET content_hash=?').run('b'.repeat(64));
    if(name==='locator_forgery'||name==='body_provider'||name==='sender_forgery')for(const row of f.db.prepare('SELECT * FROM signal_outbox').all() as any[]){const raw=JSON.parse(row.body_json);if(name==='locator_forgery')raw.body.reader_metadata.locator.local_id=999;else if(name==='sender_forgery')raw.body.sender='caller-forged';else raw.body.reader_metadata.provider='feishu_task';f.db.prepare('UPDATE signal_outbox SET body_json=? WHERE signal_id=? AND revision=?').run(JSON.stringify(raw),row.signal_id,row.revision);}
    if(name==='wire_forgery')input.signals[0].content.text='Caller clone';
    if(name==='wrong_account')selected.sources.weixin={other_fixture_account:'weixin'};
    if(name==='wire_forgery')expect(()=>f.run({operation:'decision_enqueue_routed',registry:selected,envelope:input,formal_registry_raw:JSON.stringify(selected)})).toThrow('formal_delivery_not_owned');
    else f.run({operation:'decision_enqueue_routed',registry:selected,envelope:input,formal_registry_raw:JSON.stringify(selected)});
    const rows=f.db.prepare('SELECT eligibility_json FROM decision_formal_intents').all() as any[];
    if(name==='direct'||name==='exception'){
     expect(rows).toHaveLength(1);const eligibility=JSON.parse(rows[0].eligibility_json);
     expect(eligibility).toMatchObject({task_id:name==='direct'?'transmission-channel-weixin':'transmission-channel-exception-catch',purpose:name==='direct'?'direct':'exception',source_scope:['weixin']});
     expect(eligibility.source_evidence.every((e:any)=>e.evidence_type==='weixin_source_version'&&e.source_version_ref.startsWith('version_'))).toBe(true);
     const body=JSON.parse((f.db.prepare('SELECT body_json FROM entity_message_entities WHERE source=?').get('weixin') as any).body_json);expect(body.coverage.complete).toBe(false);
     // 原父件重放不能随新registry获得另一Task/用途。
     const before=JSON.stringify(f.db.prepare('SELECT * FROM decision_formal_intents').all());selected.sources.weixin[scope.account_ref]=name==='direct'?'exception':'weixin';f.run({operation:'decision_enqueue_routed',registry:selected,envelope:parent,formal_registry_raw:JSON.stringify(selected)});expect(JSON.stringify(f.db.prepare('SELECT * FROM decision_formal_intents').all())).toBe(before);
    }else expect(rows).toHaveLength(0);
   }finally{f.db.close();}
  }
 }finally{rmSync(root,{recursive:true,force:true});}
},180000);

// Ledger/causal unit fixture: actual normalizer/adapter and EntityStore creation;
// synthetic actor here is not evidence of a real installed/native observation.
function createNativeImFixture(db:any,ref:string,text:string,account='synthetic'){
 const collector=new LarkCollector('ou_fixture_self','/synthetic/no-io',async()=>{throw new Error('unexpected_native_io');});
 const item=messageItem(collector.normalize('oc_fixture',{message_id:ref,msg_type:'text',create_time:'2026-11-01T00:00:00.000Z',deleted:false,sender:{id:'ou_fixture_peer'},content:JSON.stringify({text})},'2026-11-01T00:01:00.000Z','ou_fixture_peer','user'));
 const entity=adaptLark({...item,source:{...item.source,account_ref:account}}).entity;
 new EntityStore(db).write({operation:'create',collection:'message-entities',data:entity,actor:'l1-source-intake',request_id:'intake:synthetic-page',idempotency_key:'intake:'+entity.id});
 return entity;
}

it.each([false,true])('real IM receiver/material chain admits partial=%s; normal Store external rewrites/clones/new creates cannot gain native authority',async partial=>{
 const {database}=await import('../channels/source-intake/testing.ts'),{scopeBinding}=await import('../channels/source-intake/contracts.ts'),{FixtureArchive}=await import('../channels/source-intake/archive.ts');
 const {processIntakeMaterials}=await import('../materials/intake-pipeline.ts'),{Store}=await import('../storage/client.ts'),{digest}=await import('../canonical.ts');
 const d=database(),run=(c:any)=>d.engine.signals(c) as any,account='ou_fixture_self';let store:any;
 try{
  run({operation:'mode',mode:'3layer'});
  const tuple={host:'local',thread_id:randomUUID(),project_id:randomUUID(),cwd:'/synthetic'},registry={schema_version:1,sources:{feishu:{[account]:'feishu_im'}},targets:{feishu_im:{...tuple,task_id:'transmission-channel-feishu-im'}},exception_target:'feishu_im'};
  run({operation:'decision_formal_activate',registry_raw:JSON.stringify(registry),binding:{project_id:'transmission',codex_project_id:tuple.project_id,thread_id:tuple.thread_id,cwd:tuple.cwd},task_revision:1,observed_at:'2026-11-02T00:00:00.000Z'});
  const collector=new LarkCollector(account,'/synthetic/no-io',async()=>{throw new Error('unexpected_native_io');});
  const item=messageItem(collector.normalize('oc_fixture',{message_id:'om_receiver',msg_type:'text',create_time:'2026-10-08T22:00:00.000Z',deleted:false,sender:{id:'ou_fixture_peer'},content:JSON.stringify({text:'Synthetic producer original'})},'2026-10-08T22:10:00.000Z','ou_fixture_peer','user'));
  const source=partial?{...item.source,coverage:{status:'coverage_gap' as const,complete:false,gaps:['synthetic_source_gap']}}:item.source;
  const a=adaptLark({...item,source},new FixtureArchive(d.root)),scope={source:'feishu' as const,account,scope_ref:'oc_fixture',reader_revision:'synthetic-feishu/v1',authorization_ref:'synthetic-only'},lease=d.receiver.claim(scope,'synthetic-owner');
  const page={scope_binding:scopeBinding(scope),before:null,after:'synthetic-page:1',window:{start:'2026-10-08T22:00:00.000Z',end:'2026-10-08T22:10:00.000Z'},continuation:false,coverage:{complete:true,gaps:[],through:'2026-10-08T22:10:00.000Z'},items:[{message:a.message,original:a.original}]};
  d.receiver.stage(scope,lease,page);expect(d.receiver.commit(scope,lease,page).created).toBe(1);
  const material=processIntakeMaterials(d.engine.db,a.entity.id,new FixtureArchive(d.root),()=> '2026-10-08T22:11:00.000Z');expect(['ready','partial']).toContain(material.status);
  const signalPort=(c:any)=>store?store.signals(c):Promise.resolve(run(c));
  const route=async()=>{const batch=await signalPort({operation:'next',formal_only:true,now:'2099-01-01T00:00:00.000Z'});expect(batch).not.toBeNull();await signalPort({operation:'decision_enqueue_routed',registry,envelope:batch,formal_registry_raw:JSON.stringify(registry)});await signalPort({operation:'settle',delivery_id:batch.delivery_id,http_status:200,formal_only:true,now:'2099-01-01T00:00:00.000Z'});return batch;};
  d.engine.close();
  store=new Store(join(d.root,'db.sqlite'));
  // The worker actor is the real server-side context; caller JSON never supplies it.
  let entity=await store.entities({operation:'get',collection:'message-entities',id:a.entity.id},'external-caller');
  await store.entities({operation:'update',collection:'message-entities',id:entity.id,revision:entity.revision,request_id:'external:0',idempotency_key:'external:0',data:{body:{context:'Ordinary D13 context'}}},'external-caller');
  entity=await store.entities({operation:'get',collection:'message-entities',id:a.entity.id},'external-caller');
  const originalBody=structuredClone(entity.body);
  await route();expect(await store.signals({operation:'decision_formal_claim'})).toMatchObject({action:'prepare',eligibility:{task_id:'transmission-channel-feishu-im'}});
  const intents=async()=>{const status=await store.signals({operation:'decision_status'});return JSON.stringify({count:status.formal_adoption.inventory.intents,work:await store.signals({operation:'decision_formal_claim'}),batches:status.batches.filter((b:any)=>b.formal_intent)});},frozen=await intents();
  await store.entities({operation:'update',collection:'message-entities',id:entity.id,revision:entity.revision,request_id:'external:1',idempotency_key:'external:1',data:{body:{message:'External body replacement; not a new native observation'},content_hash:'b'.repeat(64)}},'external-caller');
  await route();expect(await intents()).toBe(frozen);
  entity=await store.entities({operation:'get',collection:'message-entities',id:a.entity.id},'external-caller');
  await store.entities({operation:'update',collection:'message-entities',id:entity.id,revision:entity.revision,request_id:'external:2',idempotency_key:'external:2',data:{body:originalBody,content_hash:digest(originalBody)}},'external-caller');
  await route();expect(await intents()).toBe(frozen);
  const fakeItem=messageItem(collector.normalize('oc_fixture',{message_id:'om_external_create',msg_type:'text',create_time:'2026-10-08T22:00:00.000Z',deleted:false,sender:{id:'ou_fixture_peer'},content:JSON.stringify({text:'Caller supplied source/account/reader metadata'})},'2026-10-08T22:10:00.000Z','ou_fixture_peer','user'));
  await store.entities({operation:'create',collection:'message-entities',request_id:'external:3',idempotency_key:'external:3',data:adaptLark(fakeItem).entity},'external-caller');await route();expect(await intents()).toBe(frozen);
 }finally{await store?.close();d.close();}
});

it.each([false,true])('supported IM material refill remains native before/after L2 (processed=%s)',async processed=>{
 const {database}=await import('../channels/source-intake/testing.ts'),{scopeBinding}=await import('../channels/source-intake/contracts.ts'),{FixtureArchive}=await import('../channels/source-intake/archive.ts'),{processIntakeMaterials}=await import('../materials/intake-pipeline.ts');
 const d=database(),run=(c:any)=>d.engine.signals(c) as any,account='ou_fixture_self',archive=new FixtureArchive(d.root);
 try{
  run({operation:'mode',mode:'3layer'});const tuple={host:'local',thread_id:randomUUID(),project_id:randomUUID(),cwd:'/synthetic'},registry={schema_version:1,sources:{feishu:{[account]:'feishu_im'}},targets:{feishu_im:{...tuple,task_id:'transmission-channel-feishu-im'}},exception_target:'feishu_im'};
  run({operation:'decision_formal_activate',registry_raw:JSON.stringify(registry),binding:{project_id:'transmission',codex_project_id:tuple.project_id,thread_id:tuple.thread_id,cwd:tuple.cwd},task_revision:1,observed_at:'2026-11-02T00:00:00.000Z'});
  const collector=new LarkCollector(account,'/synthetic/no-io',async()=>{throw new Error('unexpected_native_io');});
  const item=messageItem(collector.normalize('oc_fixture',{message_id:'om_refill',msg_type:'file',create_time:'2026-10-08T22:00:00.000Z',deleted:false,sender:{id:'ou_fixture_peer'},content:JSON.stringify({file_key:'fixture-file',file_name:'synthetic.txt'})},'2026-10-08T22:10:00.000Z','ou_fixture_peer','user'));
  const first=adaptLark(item,archive),next=adaptLark(item,archive,new Map([['file_key:fixture-file',Buffer.from('Synthetic file original')]]));
  const scope={source:'feishu' as const,account,scope_ref:'oc_fixture',reader_revision:'synthetic-feishu/v1',authorization_ref:'synthetic-only'},lease=d.receiver.claim(scope,'synthetic-owner');
  const page=(a:typeof first,before:string|null,after:string)=>({scope_binding:scopeBinding(scope),before,after,window:{start:'2026-10-08T22:00:00.000Z',end:'2026-10-08T22:10:00.000Z'},continuation:false,coverage:{complete:true,gaps:[],through:'2026-10-08T22:10:00.000Z'},items:[{message:a.message,original:a.original}]});
  const one=page(first,null,'synthetic-page:1');d.receiver.stage(scope,lease,one);d.receiver.commit(scope,lease,one);
  if(processed)processIntakeMaterials(d.engine.db,first.entity.id,archive,()=> '2026-10-08T22:11:00.000Z');
  const two=page(next,'synthetic-page:1','synthetic-page:2');d.receiver.stage(scope,lease,two);expect(d.receiver.commit(scope,lease,two).materials_updated).toBe(1);
  processIntakeMaterials(d.engine.db,first.entity.id,archive,()=> '2026-10-08T22:12:00.000Z');
  const batch=run({operation:'next',formal_only:true,now:'2099-01-01T00:00:00.000Z'});run({operation:'decision_enqueue_routed',registry,envelope:batch,formal_registry_raw:JSON.stringify(registry)});
  expect(run({operation:'decision_formal_claim'})).toMatchObject({action:'prepare',eligibility:{task_id:'transmission-channel-feishu-im'}});
  const history=d.engine.db.prepare('SELECT actor,idempotency_key FROM entity_audit_events WHERE object_id=? ORDER BY sequence').all(first.entity.id) as any[];
  expect(history.some(x=>x.actor==='l1-source-intake'&&x.idempotency_key.startsWith('material-refill:'))).toBe(true);
 }finally{d.close();}
});

it.each(['committed','pending','quarantine','mixed'].flatMap(kind=>[false,true].map(restart=>({kind,restart}))))('old native $kind stays excluded, genuine new version qualifies (restart=$restart)',async({kind,restart})=>{
 const partial=false;
 const {database}=await import('../channels/source-intake/testing.ts'),{scopeBinding}=await import('../channels/source-intake/contracts.ts'),{FixtureArchive}=await import('../channels/source-intake/archive.ts');
 const {processIntakeMaterials}=await import('../materials/intake-pipeline.ts'),{Store}=await import('../storage/client.ts'),{digest}=await import('../canonical.ts');
 const d=database();let engine=d.engine,receiver=d.receiver;const run=(c:any)=>engine.signals(c) as any,account='ou_fixture_self';let store:any;
 try{
  run({operation:'mode',mode:'3layer'});
  const tuple={host:'local',thread_id:randomUUID(),project_id:randomUUID(),cwd:'/synthetic'},registry={schema_version:1,sources:{feishu:{[account]:'feishu_im'}},targets:{feishu_im:{...tuple,task_id:'transmission-channel-feishu-im'}},exception_target:'feishu_im'};
  const collector=new LarkCollector(account,'/synthetic/no-io',async()=>{throw new Error('unexpected_native_io');});
  const item=messageItem(collector.normalize('oc_fixture',{message_id:'om_receiver',msg_type:'text',create_time:'2026-10-08T22:00:00.000Z',deleted:false,sender:{id:'ou_fixture_peer'},content:JSON.stringify({text:'Synthetic producer original'})},'2026-10-08T22:10:00.000Z','ou_fixture_peer','user'));
  const source=partial?{...item.source,coverage:{status:'coverage_gap' as const,complete:false,gaps:['synthetic_source_gap']}}:item.source;
  const a=adaptLark({...item,source},new FixtureArchive(d.root)),scope={source:'feishu' as const,account,scope_ref:'oc_fixture',reader_revision:'synthetic-feishu/v1',authorization_ref:'synthetic-only'},lease=receiver.claim(scope,'synthetic-owner');
  const page={scope_binding:scopeBinding(scope),before:null,after:'synthetic-page:1',window:{start:'2026-10-08T22:00:00.000Z',end:'2026-10-08T22:10:00.000Z'},continuation:false,coverage:{complete:true,gaps:[],through:'2026-10-08T22:10:00.000Z'},items:[{message:a.message,original:a.original}]};
  receiver.stage(scope,lease,page);let oldPage=page;
  if(kind==='committed')expect(receiver.commit(scope,lease,page).created).toBe(1);
  let restoreOriginal:(()=>void)|undefined;
  if(kind==='quarantine'){
   const pending=engine.db.prepare('SELECT payload_json FROM source_intake_pending WHERE stream_ref=?').get(lease.stream_ref) as any;
   const path=JSON.parse(pending.payload_json).items[0].original_ref.path,bytes=readFileSync(path);
   writeFileSync(path,'corrupted synthetic archive');expect(receiver.pendingStatus(scope).quarantine.count).toBe(1);
   restoreOriginal=()=>writeFileSync(path,bytes);oldPage={...page,after:'synthetic-page:recovered'};
  }
  const captured=JSON.stringify({pending:engine.db.prepare('SELECT * FROM source_intake_pending').all(),quarantine:engine.db.prepare('SELECT * FROM source_intake_quarantine').all()});

  run({operation:'decision_formal_activate',registry_raw:JSON.stringify(registry),binding:{project_id:'transmission',codex_project_id:tuple.project_id,thread_id:tuple.thread_id,cwd:tuple.cwd},task_revision:1,observed_at:'2026-11-02T00:00:00.000Z'});
  expect(JSON.stringify({pending:engine.db.prepare('SELECT * FROM source_intake_pending').all(),quarantine:engine.db.prepare('SELECT * FROM source_intake_quarantine').all()})).toBe(captured);
  const legacy=JSON.stringify(engine.db.prepare('SELECT * FROM signal_outbox ORDER BY signal_id,revision').all());
  if(restart){engine.close();const {Engine}=await import('../storage/engine.ts'),{IntakeReceiver}=await import('../channels/source-intake/receiver.ts');engine=new Engine(join(d.root,'db.sqlite'));receiver=new IntakeReceiver(engine.db,()=>Date.parse('2026-10-08T22:10:00.000Z'),new FixtureArchive(d.root));}
  if(kind!=='committed'){
   if(restoreOriginal){restoreOriginal();receiver.stage(scope,lease,oldPage);}
   expect(receiver.commit(scope,lease,oldPage).created).toBe(1);
  }
  const material=processIntakeMaterials(engine.db,a.entity.id,new FixtureArchive(d.root),()=> '2026-10-08T22:11:00.000Z');expect(['ready','partial']).toContain(material.status);
  const signalPort=(c:any)=>store?store.signals(c):Promise.resolve(run(c));
  const route=async()=>{const batch=await signalPort({operation:'next',formal_only:true,now:'2099-01-01T00:00:00.000Z'});expect(batch).not.toBeNull();await signalPort({operation:'decision_enqueue_routed',registry,envelope:batch,formal_registry_raw:JSON.stringify(registry)});await signalPort({operation:'settle',delivery_id:batch.delivery_id,http_status:200,formal_only:true,now:'2099-01-01T00:00:00.000Z'});return batch;};
  if(kind!=='mixed'){await route();expect(run({operation:'decision_formal_claim'})).toBeNull();}
  const oldRows=engine.db.prepare('SELECT o.* FROM signal_outbox o JOIN decision_formal_legacy_outbox l USING(signal_id,revision) ORDER BY o.signal_id,o.revision').all();expect(JSON.stringify(oldRows)).toBe(legacy);
  const newItem=messageItem(collector.normalize('oc_fixture',{message_id:'om_receiver',msg_type:'text',create_time:'2026-10-08T22:00:00.000Z',update_time:'2026-10-08T22:12:00.000Z',deleted:false,sender:{id:'ou_fixture_peer'},content:JSON.stringify({text:'Genuine changed native source version'})},'2026-10-08T22:13:00.000Z','ou_fixture_peer','user'));
  const newer=adaptLark(newItem,new FixtureArchive(d.root));expect(newer.entity.id).not.toBe(a.entity.id);expect(newer.entity.source_ref).toBe(a.entity.source_ref);
  const next={...page,before:oldPage.after,after:'synthetic-page:2',items:[{message:newer.message,original:newer.original}]};receiver.stage(scope,lease,next);expect(receiver.commit(scope,lease,next).created).toBe(1);
  processIntakeMaterials(engine.db,newer.entity.id,new FixtureArchive(d.root),()=> '2026-10-08T22:14:00.000Z');
  await route();expect(run({operation:'decision_formal_claim'})).toMatchObject({action:'prepare',eligibility:{task_id:'transmission-channel-feishu-im'}});
  const work=run({operation:'decision_formal_claim'});expect(work.envelope.signals.every((signal:any)=>signal.message_ref.endsWith(encodeURIComponent(newer.entity.id)))).toBe(true);


 }finally{if(engine!==d.engine&&engine.db.open)engine.close();d.close();}
});

it('WX received before activation cannot become new through delayed projection',async()=>{
 const {Store}=await import('../storage/client.ts'),{WeixinScope,WeixinIdentity,transitionWeixin}=await import('../channels/weixin-state.ts');
 const {weixinRegistrations}=await import('../channels/weixin-registration.ts'),{commitMessageDelta}=await import('../channels/mail-lark-ingest.ts'),{digest:sourceDigest}=await import('../canonical.ts');
 const {mkdirSync,copyFileSync,realpathSync}=await import('node:fs');
 const root=realpathSync(mkdtempSync(join(tmpdir(),'formal-wx-private-'))),dbpath=join(root,'source.db'),now=new Date().toISOString(),end=Math.floor(Date.parse(now)/1000),sha='a'.repeat(64),peer='fixture_peer';mkdirSync(join(root,'originals'),{mode:0o700});
 const scope=WeixinScope.parse({account_ref:'fixture_self',socket_path:'/fixture/unused.sock',account_epoch:sha,reader_sha256:sha,provider_sha256:sha,identity_evidence_ref:'synthetic-only',existing_authorization_ref:'synthetic-only',activation_at:now,history_days:7,peer_allowlist:['filehelper',peer]});
 const {socket_path,existing_authorization_ref,activation_at,...rest}=scope,readerIdentity=WeixinIdentity.parse({protocol:'weixin-reader-v1',...rest});
 const tuple={host:'local',thread_id:randomUUID(),project_id:randomUUID(),cwd:'/synthetic'},registry:any={schema_version:1,sources:{feishu:{fixture_im:'feishu_im'},weixin:{[scope.account_ref]:'weixin'}},targets:{feishu_im:{...tuple,task_id:'transmission-channel-feishu-im'},weixin:{...tuple,thread_id:randomUUID(),task_id:'transmission-channel-weixin'},exception:{...tuple,thread_id:randomUUID(),task_id:'transmission-channel-exception-catch'}},exception_target:'exception'};
 const store=new Store(dbpath,join(root,'content'),{sourceIntakeRoot:join(root,'originals')});let parent:any;
 try{
  await store.signals({operation:'mode',mode:'3layer'});
  const registration=weixinRegistrations(store,{enabled:true,entity_intake:true,entries:[{collector_ref:'synthetic-only',scope}]})[0]!;
  let checkpoint=await store.command({type:'lease_stream',stream_ref:registration.definition.stream_ref,channel:'weixin',account_ref:scope.account_ref,owner:'fixture',expected_generation:0,lease_ms:600000},'system'),context={definition:registration.definition,checkpoint,signal:new AbortController().signal};
  const manifest={identity:readerIdentity,start:end-7*86400,end,shards:{'message/message_0.db':sha},partitions:[{shard:'message/message_0.db',shard_epoch:sha,peer,high:1}]};
  await commitMessageDelta(store,context,sourceDigest(scope),transitionWeixin(scope,null,{scope,kind:'inventory',received_at:now,response:{manifest,manifest_hash:sourceDigest(manifest)}}));
  checkpoint=await store.query({type:'source_stream',stream_ref:registration.definition.stream_ref});context={...context,checkpoint};
  const locator={account_epoch:sha,shard:'message/message_0.db',shard_epoch:sha,peer,local_id:1,timestamp:end};
  await commitMessageDelta(store,context,sourceDigest(scope),transitionWeixin(scope,checkpoint.received_cursor,{scope,kind:'page',received_at:now,response:{identity:readerIdentity,manifest_hash:sourceDigest(manifest),index:0,after:0,next:1,done:true,items:[{locator,sender:peer,direction:'incoming',material:{complete:false,parts:[{kind:'text',text:'Synthetic private source, no platform probe'},{kind:'missing',code:'fixture_attachment_unavailable'}]}}]}}));
  await store.signals({operation:'decision_formal_activate',registry_raw:JSON.stringify(registry),binding:{project_id:'transmission',codex_project_id:tuple.project_id,thread_id:tuple.thread_id,cwd:tuple.cwd},task_revision:1,observed_at:now});
  expect(await store.command({type:'materialize_weixin_entities',stream_ref:registration.definition.stream_ref,generation:checkpoint.generation,scope},'system')).toMatchObject({created:1});
  parent=await store.signals({operation:'next',now:new Date().toISOString(),formal_only:true});expect(parent.signals.length).toBeGreaterThan(0);
  expect(JSON.parse(parent.signals[0].source_ref)).toEqual([peer,'weixin-local-v1:'+sourceDigest(locator)]);
  await store.signals({operation:'decision_enqueue_routed',registry,envelope:parent,formal_registry_raw:JSON.stringify(registry)});
  expect(await store.signals({operation:'decision_formal_claim'})).toBeNull();
 }finally{await store.close();rmSync(root,{recursive:true,force:true});}
});

// Synthetic native/OS responses only; real Engine/opaque metadata/P stage-stop-commit.
// No user source, native executable, platform request, Task write or runtime DB.
import {FixtureArchive as ProviderArchive} from '../channels/source-intake/archive.ts';
import {Engine as ProviderEngine} from '../storage/engine.ts';
import {CollectorDefinition as ProviderDefinition} from '../contracts.ts';
import {digest as providerDigest,canonical as providerCanonical} from '../canonical.ts';
import {taskCollectorIdentity,approvalCollectorIdentity,collectorIdentityPayload,SourceIdentityPreparation,currentSourceIdentityPreparation,SourceIdentityLedger} from '../channels/source-intake/source-identity.ts';
import {scopeBinding as providerScopeBinding,streamRef as providerStreamRef} from '../channels/source-intake/contracts.ts';
import {providerDecisionTasks,formalDecisionTasks,taskDecisionHost} from './task-decision-host.ts';
function providerFixture(provider:'feishu_task'|'feishu_approval'='feishu_task',disk=false){
 const root=mkdtempSync(join(tmpdir(),'provider-domain-fixture-')),dbpath=disk?join(root,'source.db'):':memory:',databasePath=dbpath,engine=new ProviderEngine(dbpath,undefined,undefined,false,root),db=engine.db;
 const owner='synthetic-provider-owner',prefix=provider==='feishu_task'?'task':'approval';
 const guard={binary:'/synthetic/guard',sha256:'a'.repeat(64),receipts_root:'/synthetic/receipts',target_sha256:'b'.repeat(64),target_requirement:'synthetic-reader-DR'};
 const entry={collector_ref:'synthetic-'+provider,reader:{account:'synthetic-account',profile:'synthetic-profile',binary:'/synthetic/reader',page_size:20,authorization_ref:'synthetic-authority',...(provider==='feishu_task'?{tenant_key:'synthetic-tenant'}:{})},process_guard:guard,activation_at:'2026-11-01T00:00:00Z',poll_ms:300000,initially_enabled:false};
 const scope={source:'feishu' as const,account:entry.reader.account,scope_ref:prefix+'-user-visible/v1',reader_revision:prefix+'-cli/v2:'+providerDigest(provider==='feishu_task'?[entry.reader.profile,'synthetic-tenant',20]:[entry.reader.profile,20,['initiated','1','2','17','18']]),authorization_ref:entry.reader.authorization_ref};
 const definition=ProviderDefinition.parse({collector_ref:entry.collector_ref,config_revision:prefix+'/v2:'+providerDigest(entry),channel:'feishu',account_ref:scope.account,stream_ref:'synthetic-scheduler-'+provider,intake_stream_ref:providerStreamRef(scope),intake_scope_binding:providerScopeBinding(scope),resource_refs:['synthetic-resource-'+provider]});
 engine.execute({type:'configure_collectors',owner,definitions:[definition]},'system');
 engine.collectorControl({operation:'initialize',entries:[{collector_ref:definition.collector_ref,source:provider,enabled:false}]});
 engine.signals({operation:'mode',mode:'3layer'});
 const bridge={} as any;bridge.sourceIntakeFromCollector=(identity:any,request:any)=>engine.sourceIdentity({registration:collectorIdentityPayload(identity,bridge),request});
 const opaque=(provider==='feishu_task'?taskCollectorIdentity:approvalCollectorIdentity)(bridge,{entry,definition,scope,guard}),registration=collectorIdentityPayload(opaque,bridge);
 const prepared=SourceIdentityPreparation.parse(bridge.sourceIntakeFromCollector(opaque,{type:'identity_status'}));
 const target={host:'local',thread_id:randomUUID(),project_id:randomUUID(),cwd:root,task_id:providerDecisionTasks[provider]};
 const registry:any={schema_version:2,sources:{feishu:{[scope.account]:'feishu_im'}},provider_sources:{feishu:{[scope.account]:{[provider]:provider}}},targets:{[provider]:target,...Object.fromEntries(Object.entries(formalDecisionTasks).map(([name,task_id])=>[name,{host:'local',thread_id:randomUUID(),project_id:randomUUID(),cwd:'/synthetic/paused',task_id}]))},exception_target:'exception'};
 const binding={project_id:'transmission',codex_project_id:target.project_id,thread_id:target.thread_id,cwd:target.cwd};
 const host=taskDecisionHost({task:async id=>{if(id!==target.task_id)throw Error('legacy-paused');return {id,revision:2,project_id:'transmission',status:'new'};},read:async()=>({items:[{project_binding:binding}],next_after:null}),diagnose:async(task,thread)=>({task_id:task,thread_id:thread,verification:{verifier:'official_thread_read',cwd_matches:true,project_matches:true,codex_project_id:target.project_id}}),submit:async()=>{throw Error('unit-no-submit');},actualInput:async()=>{throw Error('unit-no-native-input');}});
 const raw=JSON.stringify(registry),activate=async()=>engine.signals({operation:'decision_provider_activate',provider,registration_id:prepared.registration_id,registry_raw:raw,...await host.providerActivation(registry,provider,scope.account),observed_at:new Date().toISOString()});
 const toggle=(enabled:boolean)=>{const c=engine.collectorControl({operation:'status',selector:{kind:'collector',id:definition.collector_ref}});return engine.collectorControl({operation:'set',selector:{kind:'collector',id:definition.collector_ref},data:{enabled,expected_revision:c.revision,reason:'validation'},idempotency_key:'synthetic-control-'+randomUUID()});};
 let n=0;
 const capture=(state='A',observation=1,object='synthetic-native-object')=>{
  const serial=++n,operation_id='synthetic-op-'+serial,attempt_ref='synthetic-attempt-'+serial,generation=serial,now=new Date().toISOString();
  db.prepare("INSERT INTO operations(operation_id,operation_key,kind,payload,owner_generation,status,next_eligible_at,created_at) VALUES(?,?,?,?,?,'running',?,?)").run(operation_id,operation_id,'collect_sources',JSON.stringify({collector_ref:definition.collector_ref,config_revision:definition.config_revision}),3,now,now);
  db.prepare('UPDATE collector_schedules SET active_operation=? WHERE collector_ref=?').run(operation_id,definition.collector_ref);
  db.prepare("INSERT INTO collector_attempts(attempt_ref,operation_id,operation_generation,collector_ref,owner,state,lease_generation,failures,created_at) VALUES(?,?,?,?,?,'started',?,0,?)").run(attempt_ref,operation_id,3,definition.collector_ref,owner,generation,now);
  db.prepare("INSERT INTO collector_checkpoints(stream_ref,channel,account_ref,owner,generation,lease_until,received_cursor,processed_sequence) VALUES(?,?,?,?,?,?,NULL,0) ON CONFLICT(stream_ref) DO UPDATE SET owner=excluded.owner,generation=excluded.generation,lease_until=excluded.lease_until").run(definition.stream_ref,'feishu',scope.account,owner,generation,new Date(Date.now()+3600000).toISOString());
  const binding={attempt_ref,operation_id,attempt_generation:3,stream_ref:definition.stream_ref,lease_generation:generation};
  const birth={boot_uuid:'11111111-1111-4111-8111-111111111111',pid:123,start_sec:'1',start_usec:'0'},request_ref=randomUUID(),nonce=providerDigest([serial,'native-request']);
  const ready={version:1,request_ref,nonce,guardian:birth,target:{...birth,pid:124}},terminal={...ready,released:true,trace_complete:true,fork_observed:false,exit_observed:true,exit_code:0,guardian_exit:{checked_boot_uuid:birth.boot_uuid,observed:null}};
  db.prepare('INSERT INTO x_process_attempts(attempt_ref,binding,service_birth) VALUES(?,?,?)').run(attempt_ref,providerCanonical(binding),providerCanonical(birth));
  db.prepare('INSERT INTO x_process_requests VALUES(?,?,?,?,?,?)').run(request_ref,attempt_ref,nonce,JSON.stringify(ready),JSON.stringify(terminal),'stopped');
  const lease=engine.sourceIntake({type:'claim',scope,owner:'collector:'+owner+':'+generation}) as any;
  const call=(request:any)=>bridge.sourceIntakeFromCollector(opaque,request);
  call({type:'begin',lease});
  const end='2026-11-02T01:00:00.000Z',hash=providerDigest([object,state]),original=Buffer.from(JSON.stringify({object,state})),metadata={provider,snapshot:true,state_hash:hash,observation_revision:observation,...(provider==='feishu_approval'?{approval:{status:'PENDING'}}:{object_kind:'task'})};
  const archived=new ProviderArchive(root).put(original);
  const message={source:'feishu',account:scope.account,conversation_id:scope.scope_ref,object_id:object,revision:(provider==='feishu_task'?'snapshot:':'PENDING:')+providerDigest([hash,end,observation]),occurred_at:end,collected_at:now,sender:null,text:original.toString(),original_path:archived.path,original_sha256:archived.sha256,withdrawn:false,attachments:[],coverage:{complete:true,gaps:[]},reader_metadata:metadata};
  const cursor=(db.prepare('SELECT cursor FROM source_intake_streams WHERE stream_ref=?').get(lease.stream_ref) as any).cursor;
  const page={scope_binding:providerScopeBinding(scope),before:cursor,after:'synthetic-after-'+serial,window:{start:'2026-11-02T00:00:00.000Z',end},continuation:false,coverage:{complete:true,gaps:[],through:end},items:[{message,original}]};
  const staged=call({type:'stage',scope,lease,page}),stop=engine.execute({type:'close_x_process_attempt',binding},'system') as any;
  call({type:'finish',lease,stopped_receipt:stop.stopped_receipt});
  const settle=()=>{db.prepare("UPDATE collector_attempts SET state='settled' WHERE attempt_ref=?").run(attempt_ref);db.prepare('UPDATE collector_schedules SET active_operation=NULL WHERE collector_ref=?').run(definition.collector_ref);};
  const commit=()=>{const result=call({type:'commit',scope,lease,page});call({type:'release',lease});settle();return result;};
  return {commit,settle,staged,attempt_ref,request_ref,stop,message,page};
 };
 return {root,dbpath,databasePath,engine,db,owner,entry,definition,guard,bridge,opaque,scope,registration,prepared,host,registry,raw,target,activate,toggle,capture,close:()=>{if(db.open)engine.close();rmSync(root,{recursive:true,force:true});}};
}
it.each(['feishu_task','feishu_approval'] as const)('fresh %s domain qualifies initial observation without old three bindings and binds normal null wire',async provider=>{
 const f=providerFixture(provider);try{
  const old=f.engine.signals({operation:'ingress',id:'old-unrelated',kind:'message',source:'mail',source_account:'old',source_ref:'old',occurred_at:new Date().toISOString(),content:{text:'synthetic old',attachments:[]}});
  const before=f.db.prepare('SELECT * FROM signal_outbox WHERE signal_id=?').get(old.signal_id);
  await f.activate();f.toggle(true);const p=f.capture();expect(p.commit().receipt.created).toBe(1);
  expect(f.db.prepare('SELECT wire_hash FROM source_identity_signals').all()).toEqual([{wire_hash:null},{wire_hash:null}]);
  const batch=f.engine.signals({operation:'next',formal_only:true,formal_registry_raw:f.raw,now:'2999-01-01T00:00:00.000Z'});expect(batch.signals).toHaveLength(2);expect(batch.signals.every((s:any)=>s.source_provider===provider)).toBe(true);
  const routed=f.engine.signals({operation:'decision_enqueue_routed',registry:f.registry,envelope:batch,formal_registry_raw:f.raw});
  expect(routed.children).toHaveLength(1);const intent=f.db.prepare('SELECT eligibility_json FROM decision_formal_intents').get() as any;
  expect(JSON.parse(intent.eligibility_json)).toMatchObject({task_id:providerDecisionTasks[provider],source_scope:[provider],purpose:'direct'});
  expect(f.db.prepare('SELECT * FROM signal_outbox WHERE signal_id=?').get(old.signal_id)).toEqual(before);
  expect(f.db.prepare('SELECT * FROM decision_formal_activation').all()).toEqual([]);
  expect(f.db.prepare('SELECT wire_hash FROM source_identity_signals').all().every((v:any)=>typeof v.wire_hash==='string')).toBe(true);
 }finally{f.close();}
});
it('late committed pre-domain native capture keeps its original source and never gets a wire binding',async()=>{
 const f=providerFixture();try{
  f.toggle(true);const old=f.capture();old.settle();f.toggle(false);await f.activate();
  expect(old.commit().receipt.created).toBe(1);
  const before=f.db.prepare('SELECT * FROM signal_outbox ORDER BY revision').all();
  expect(f.engine.signals({operation:'next',formal_only:true,formal_registry_raw:f.raw,now:'2999-01-01T00:00:00.000Z'})).toBeNull();
  expect(f.db.prepare('SELECT * FROM signal_outbox ORDER BY revision').all()).toEqual(before);
  expect(f.db.prepare('SELECT wire_hash FROM source_identity_signals').all()).toEqual([{wire_hash:null},{wire_hash:null}]);
  expect(f.db.prepare('SELECT * FROM decision_formal_intents').all()).toEqual([]);
 }finally{f.close();}
});


// Task379-only synthetic boundary tests. Core is the unmodified original1717 WIP.
// Deferred L2 is a test-only fault/scheduling seam; the captured callback later
// runs the original SourceIdentityLedger and material pipeline, without OS/API IO.
function task379DeferL2(commit:()=>unknown){
 const original=SourceIdentityLedger.prototype.processL2,callbacks:Array<()=>unknown>=[];
 const spy=vi.spyOn(SourceIdentityLedger.prototype,'processL2').mockImplementation(function(this:SourceIdentityLedger,id,run){callbacks.push(()=>original.call(this,id,run));return {test_only_deferred:true};});
 try{commit();}finally{spy.mockRestore();}
 expect(callbacks).toHaveLength(1);return ()=>callbacks[0]!();
}
function task379Freeze(f:ReturnType<typeof providerFixture>){
 const work=f.engine.signals({operation:'decision_formal_claim'}) as any;
 expect(work).toMatchObject({action:'prepare',eligibility:{task_id:'transmission-channel-feishu-task'}});
 const submission_json=JSON.stringify({agent:'codex',transport:'desktop',instruction:'SHADOW_DECISION_INTENT=formal:'+work.envelope.delivery_id,acceptance_criteria:['synthetic Task unit only'],expected_task_revision:2,context_refs:[],attachment_refs:[],required_capabilities:[]});
 const intent={transport_kind:'formal_task/v1',intent_id:'formal:'+work.envelope.delivery_id,eligibility_hash:(f.db.prepare('SELECT eligibility_hash FROM decision_formal_intents WHERE delivery_id=?').get(work.envelope.delivery_id) as any).eligibility_hash,idempotency_key:'formal:'+work.envelope.delivery_id,wake_id:work.wake_id,task_id:'transmission-channel-feishu-task',actor:'decision-task-host',submission_json,submission_hash:createHash('sha256').update(submission_json).digest('hex'),binding:{project_id:'transmission',codex_project_id:f.target.project_id,thread_id:f.target.thread_id,cwd:f.target.cwd}};
 f.engine.signals({operation:'decision_formal_freeze',wake_id:work.wake_id,intent});
 expect(f.engine.signals({operation:'decision_formal_claim'})).toMatchObject({action:'submit',wake_id:work.wake_id});return {work,intent};
}
function task379Report(f:ReturnType<typeof providerFixture>,frozen:ReturnType<typeof task379Freeze>,outcome:'unknown'|'accepted'){
 const execution_id='synthetic-task-execution',request_id='synthetic-task-request',turn_id='synthetic-task-turn';
 return f.engine.signals({operation:'decision_formal_report',wake_id:frozen.work.wake_id,outcome,execution_id,request_id,...(outcome==='accepted'?{turn_id,evidence:{verifier:'official_thread_read',execution_id,request_id,turn_id,submission_hash:frozen.intent.submission_hash}}:{})});
}
function task379Route(f:ReturnType<typeof providerFixture>,batch:any,registry=f.registry){
 const result=f.engine.signals({operation:'decision_enqueue_routed',registry,envelope:batch,formal_registry_raw:JSON.stringify(registry)});
 f.engine.signals({operation:'settle',delivery_id:batch.delivery_id,http_status:200,formal_only:true,now:'2999-01-01T00:00:00.000Z'});return result;
}
it('Task379 complete stopped preboundary capture remains excluded after late commit and repeated selector',async()=>{
 const f=providerFixture();try{
  f.toggle(true);const old=f.capture('A',1);old.settle();
  const pending=f.db.prepare('SELECT page_id,payload_hash FROM source_intake_pending').get() as any;
  expect(f.db.prepare('SELECT count(*) n FROM source_identity_facts').get()).toEqual({n:0});
  f.toggle(false);const activation=await f.activate() as any;
  expect(activation.activation.boundary.captures).toEqual(expect.arrayContaining([expect.objectContaining(pending)]));
  const domainBytes=f.db.prepare('SELECT * FROM decision_provider_activations').all();
  expect(old.commit().receipt.created).toBe(1);
  const outbox=f.db.prepare('SELECT * FROM signal_outbox ORDER BY revision').all();
  const identities=f.db.prepare('SELECT * FROM source_identity_signals ORDER BY revision').all();
  for(let i=0;i<2;i++)expect(f.engine.signals({operation:'next',formal_only:true,formal_registry_raw:f.raw,now:'2999-01-01T00:00:00.000Z'})).toBeNull();
  expect(f.db.prepare('SELECT * FROM signal_outbox ORDER BY revision').all()).toEqual(outbox);
  expect(f.db.prepare('SELECT * FROM source_identity_signals ORDER BY revision').all()).toEqual(identities);
  expect(identities.every((r:any)=>r.wire_hash===null)).toBe(true);
  expect(f.db.prepare('SELECT * FROM decision_provider_activations').all()).toEqual(domainBytes);
  expect(f.db.prepare('SELECT * FROM decision_formal_intents').all()).toEqual([]);
 }finally{f.close();}
});
it('Task379 A to B to A uses committed P sequence without requiring D to consume B first',async()=>{
 const f=providerFixture();try{
  f.toggle(true);f.capture('A',1).commit();f.toggle(false);await f.activate();f.toggle(true);
  f.capture('A',2).commit();
  const b=f.capture('B',3);b.commit();const a=f.capture('A',4);a.commit();
  expect(f.db.prepare('SELECT * FROM decision_provider_observations').all()).toEqual([]);
  const batch=f.engine.signals({operation:'next',formal_only:true,formal_registry_raw:f.raw,now:'2999-01-01T00:00:00.000Z'}) as any;
  const versions=new Set(batch.signals.map((s:any)=>JSON.parse((f.db.prepare('SELECT f.body_json FROM source_identity_signals i JOIN source_identity_facts f ON f.id=i.fact_id WHERE i.signal_id=? AND i.revision=?').get(s.signal_id,s.revision) as any).body_json).source_version));expect([...versions]).toEqual(expect.arrayContaining([b.message.revision,a.message.revision]));
  expect(batch.signals.every((s:any)=>s.source_provider==='feishu_task')).toBe(true);
  expect(f.db.prepare('SELECT count(*) n FROM decision_formal_intents').get()).toEqual({n:0});
 }finally{f.close();}
});
it('Task379 same boundary A state never qualifies from sequence inflation without a genuine intervening B',async()=>{
 const f=providerFixture();try{
  f.toggle(true);f.capture('A',1).commit();f.toggle(false);await f.activate();f.toggle(true);
  f.capture('A',2).commit();f.capture('A',4).commit();
  const outbox=f.db.prepare('SELECT * FROM signal_outbox ORDER BY revision').all(),identities=f.db.prepare('SELECT * FROM source_identity_signals ORDER BY revision').all();
  expect(identities.every((r:any)=>r.wire_hash===null)).toBe(true);
  const batch=f.engine.signals({operation:'next',formal_only:true,formal_registry_raw:f.raw,now:'2999-01-01T00:00:00.000Z'}) as any;
  expect(batch).toBeNull();
  expect(f.db.prepare('SELECT * FROM signal_outbox ORDER BY revision').all()).toEqual(outbox);
  expect(f.db.prepare('SELECT * FROM source_identity_signals ORDER BY revision').all()).toEqual(identities);
  expect(f.db.prepare('SELECT * FROM decision_formal_intents').all()).toEqual([]);
 }finally{f.close();}
});
it('Task379 L2 with unknown original parent remains held and cannot become a fresh direct observation',async()=>{
 const f=providerFixture();try{
  await f.activate();f.toggle(true);const p=f.capture(),completeL2=task379DeferL2(()=>p.commit());
  const parent=f.engine.signals({operation:'next',formal_only:true,formal_registry_raw:f.raw,now:'2999-01-01T00:00:00.000Z'}) as any;expect(parent.signals).toHaveLength(1);
  task379Route(f,parent);const frozen=task379Freeze(f);task379Report(f,frozen,'unknown');
  const before=f.db.prepare('SELECT * FROM decision_formal_intents').all();completeL2();
  expect(f.db.prepare('SELECT parent_revision FROM source_identity_signals ORDER BY revision').all()).toEqual([{parent_revision:null},{parent_revision:parent.signals[0].revision}]);
  expect(f.engine.signals({operation:'next',formal_only:true,formal_registry_raw:f.raw,now:'2999-01-01T00:00:00.000Z'})).toBeNull();
  expect(f.db.prepare('SELECT * FROM decision_formal_intents').all()).toEqual(before);
 }finally{f.close();}
});
it('Task379 verified parent keeps its original Task target through registry drift for genuine L2',async()=>{
 const f=providerFixture();try{
  await f.activate();f.toggle(true);const p=f.capture(),completeL2=task379DeferL2(()=>p.commit());
  const parent=f.engine.signals({operation:'next',formal_only:true,formal_registry_raw:f.raw,now:'2999-01-01T00:00:00.000Z'}) as any;task379Route(f,parent);
  const frozen=task379Freeze(f);task379Report(f,frozen,'accepted');
  const parentBytes=f.db.prepare('SELECT * FROM decision_formal_intents').all();completeL2();
  const batch=f.engine.signals({operation:'next',formal_only:true,formal_registry_raw:f.raw,now:'2999-01-01T00:00:00.000Z'}) as any;expect(batch.signals).toHaveLength(1);
  const drift=structuredClone(f.registry);drift.targets.feishu_task.thread_id=randomUUID();
  task379Route(f,batch,drift);
  const child=f.db.prepare('SELECT eligibility_json FROM decision_formal_intents WHERE delivery_id<>?').get(frozen.work.envelope.delivery_id) as any;
  const proof=JSON.parse(child.eligibility_json);expect(proof.target).toEqual({host:f.target.host,thread_id:f.target.thread_id,project_id:f.target.project_id,cwd:f.target.cwd});
  expect(proof.source_evidence[0]).toMatchObject({evidence_type:'original_provider_fact_parent',parent_revision:parent.signals[0].revision,delivery_id:frozen.work.envelope.delivery_id});
  expect(f.db.prepare('SELECT * FROM decision_formal_intents WHERE delivery_id=?').all(frozen.work.envelope.delivery_id)).toEqual(parentBytes);
 }finally{f.close();}
});
it.each([false,true])('Task379 Engine reopen preserves owner OFF or legal ON without autoenable or re-epoch (enabled=%s)',async enabled=>{
 const f=providerFixture('feishu_task',true);let reopened:ProviderEngine|undefined;try{
  const initial=await f.activate() as any;f.toggle(true);if(!enabled)f.toggle(false);
  const control=f.engine.collectorControl({operation:'status',selector:{kind:'collector',id:f.definition.collector_ref}}),domains=f.db.prepare('SELECT * FROM decision_provider_activations').all();f.engine.close();
  reopened=new ProviderEngine(f.dbpath,undefined,undefined,false,f.root);
  expect((reopened.signals({operation:'decision_provider_activation_status'}) as any).domains[0].current_ready).toBe(false);
  reopened.collectorControl({operation:'initialize',entries:[{collector_ref:f.definition.collector_ref,source:'feishu_task',enabled:false}]});
  const engine=reopened,bridge={} as any;bridge.sourceIntakeFromCollector=(identity:any,request:any)=>engine.sourceIdentity({registration:collectorIdentityPayload(identity,bridge),request});
  const opaque=taskCollectorIdentity(bridge,{entry:f.entry,definition:f.definition,scope:f.scope,guard:f.guard});
  const current=SourceIdentityPreparation.parse(bridge.sourceIntakeFromCollector(opaque,{type:'identity_status'}));expect(current.registration_id).toBe(f.prepared.registration_id);expect(current.worker_context).not.toBe(f.prepared.worker_context);
  const replay=engine.signals({operation:'decision_provider_activate',provider:'feishu_task',registration_id:current.registration_id,registry_raw:f.raw,...await f.host.providerActivation(f.registry,'feishu_task',f.scope.account),observed_at:new Date().toISOString()}) as any;
  expect(replay).toMatchObject({replayed:true,activation:{domain_id:initial.activation.domain_id}});
  expect(engine.collectorControl({operation:'status',selector:{kind:'collector',id:f.definition.collector_ref}})).toEqual(control);
  expect(engine.db.prepare('SELECT * FROM decision_provider_activations').all()).toEqual(domains);
  expect(engine.db.prepare('SELECT count(*) n FROM x_process_requests').get()).toEqual({n:0});
 }finally{reopened?.close();f.close();}
});

it('Task379 genuinely missing exact signal identity stays metadata-visible with zero formal authority',async()=>{
 const f=providerFixture();try{
  await f.activate();f.toggle(true);f.capture('A',1).commit();
  // Synthetic storage-fault injection only: retain actual P/L1/audit/page/stop,
  // deliberately remove exact per-signal binding. Ordinary metadata cannot sign it.
  f.db.prepare('DELETE FROM source_identity_signals').run();
  const facts=f.db.prepare('SELECT * FROM source_identity_facts').all();
  const batch=f.engine.signals({operation:'next',formal_only:true,formal_registry_raw:f.raw,now:'2999-01-01T00:00:00.000Z'}) as any;expect(batch.signals).toHaveLength(2);
  task379Route(f,batch);
  const child=f.db.prepare('SELECT routing_json,target_json FROM decision_batches').get() as any;
  expect(JSON.parse(child.routing_json)).toMatchObject({target_name:'exception',reason:'unverified_source_provider'});
  expect(JSON.parse(child.target_json)).toEqual({host:f.registry.targets.exception.host,thread_id:f.registry.targets.exception.thread_id,project_id:f.registry.targets.exception.project_id,cwd:f.registry.targets.exception.cwd});
  expect(f.db.prepare('SELECT * FROM decision_formal_intents').all()).toEqual([]);
  expect(f.db.prepare('SELECT * FROM source_identity_facts').all()).toEqual(facts);
  expect(f.db.prepare('SELECT * FROM source_identity_signals').all()).toEqual([]);
 }finally{f.close();}
});

// 合成只读平台边界：实际Engine/Archive/SQL；不调用真实审批、Task或原生提交。
it('approval44 domain: pre-activation stopped capture committed late never gains formal eligibility',async()=>{
 const f=providerFixture('feishu_approval');try{
  f.toggle(true);const old=f.capture('A',1);old.settle();f.toggle(false);await f.activate();old.commit();
  const rows=f.db.prepare('SELECT * FROM signal_outbox ORDER BY signal_id,revision').all();
  expect(f.engine.signals({operation:'next',formal_only:true,formal_registry_raw:f.raw,now:'2999-01-01T00:00:00Z'})).toBeNull();
  expect(f.db.prepare('SELECT * FROM signal_outbox ORDER BY signal_id,revision').all()).toEqual(rows);
  expect(f.db.prepare('SELECT wire_hash FROM source_identity_signals').all()).toEqual([{wire_hash:null},{wire_hash:null}]);
  expect(f.db.prepare('SELECT * FROM decision_formal_intents').all()).toEqual([]);
 }finally{f.close();}
});

it('approval44 domain: first admission of P-only ON fails without silently stopping it',async()=>{
 const f=providerFixture('feishu_approval');try{
  f.toggle(true);const before=f.engine.collectorControl({operation:'status'});
  await expect(f.activate()).rejects.toThrow('provider_activation_source_not_stopped');
  expect(f.engine.collectorControl({operation:'status'})).toEqual(before);
  expect(f.db.prepare('SELECT * FROM decision_provider_activations').all()).toEqual([]);
  expect(f.db.prepare('SELECT * FROM source_identity_facts').all()).toEqual([]);
  expect(f.db.prepare('SELECT * FROM decision_formal_activation').all()).toEqual([]);
 }finally{f.close();}
});

it('approval44 domain: Engine DB reopen refreshes current factory while existing ON epoch and explicit OFF persist',async()=>{
 const f=providerFixture('feishu_approval',true);let reopened:ProviderEngine|undefined;
 try{
  await f.activate();f.toggle(true);
  const domains=f.db.prepare('SELECT * FROM decision_provider_activations').all();
  const on=f.engine.collectorControl({operation:'status'});
  f.engine.close();reopened=new ProviderEngine(f.databasePath,undefined,undefined,false,f.root);
  expect(currentSourceIdentityPreparation(reopened.db,f.prepared.registration_id)).toBeNull();
  reopened.execute({type:'configure_collectors',owner:'synthetic-reopened-approval-owner',definitions:[f.definition]},'system');
  reopened.collectorControl({operation:'initialize',entries:[{collector_ref:f.entry.collector_ref,source:'feishu_approval',enabled:false}]});
  const bridge:any={};bridge.sourceIntakeFromCollector=(identity:any,request:any)=>reopened!.sourceIdentity({registration:collectorIdentityPayload(identity,bridge),request});
  const opaque=approvalCollectorIdentity(bridge,{entry:f.entry,definition:f.definition,scope:f.scope,guard:f.guard});
  const fresh=SourceIdentityPreparation.parse(bridge.sourceIntakeFromCollector(opaque,{type:'identity_status'}));
  expect(fresh.worker_context).not.toBe(f.prepared.worker_context);expect(fresh.runtime_owner).not.toBe(f.prepared.runtime_owner);
  const activate=async()=>reopened!.signals({operation:'decision_provider_activate',provider:'feishu_approval',registration_id:fresh.registration_id,registry_raw:f.raw,...await f.host.providerActivation(f.registry,'feishu_approval',f.scope.account),observed_at:new Date().toISOString()});
  expect((await activate()).replayed).toBe(true);expect(reopened.collectorControl({operation:'status'})).toEqual(on);
  expect(reopened.db.prepare('SELECT * FROM decision_provider_activations').all()).toEqual(domains);
  const selector={kind:'collector',id:f.entry.collector_ref} as const;const c=reopened.collectorControl({operation:'status',selector}) as any;
  reopened.collectorControl({operation:'set',selector,data:{enabled:false,expected_revision:c.revision,reason:'validation'},idempotency_key:randomUUID()});
  const off=reopened.collectorControl({operation:'status'});expect((await activate()).replayed).toBe(true);
  expect(reopened.collectorControl({operation:'status'})).toEqual(off);
  expect(reopened.db.prepare('SELECT * FROM decision_provider_activations').all()).toEqual(domains);
 }finally{reopened?.close();if(f.db.open)f.engine.close();rmSync(f.root,{recursive:true,force:true});}
});

it('approval44 domain: pre-boundary A replay is excluded but native observation A to B to A remains eligible',async()=>{
 const f=providerFixture('feishu_approval');try{
  f.toggle(true);f.capture('A',1).commit();f.toggle(false);await f.activate();f.toggle(true);
  const repetitions=[];for(const observation of [2,4]){
   const repeated=f.capture('A',observation);repeated.commit();repetitions.push(repeated);
   // 精身份已签但重复状态不够正式资格，留原位；不借异常selector排空。
   const rows=f.db.prepare('SELECT * FROM signal_outbox ORDER BY signal_id,revision').all();
   expect(f.engine.signals({operation:'next',formal_only:true,formal_registry_raw:f.raw,now:'2999-01-01T00:00:00Z'})).toBeNull();
   expect(f.db.prepare('SELECT * FROM signal_outbox ORDER BY signal_id,revision').all()).toEqual(rows);
   expect(f.db.prepare('SELECT * FROM decision_formal_intents').all()).toEqual([]);
   expect(f.db.prepare('SELECT * FROM decision_provider_observations').all()).toEqual([]);
  }
  const b=f.capture('B',5);b.commit();const a=f.capture('A',6);a.commit();
  const batch:any=f.engine.signals({operation:'next',formal_only:true,formal_registry_raw:f.raw,now:'2999-01-01T00:00:00Z'});
  expect(batch.signals).toHaveLength(4);
  const qualified=new Set(batch.signals.map((s:any)=>(f.db.prepare('SELECT fact_id FROM source_identity_signals WHERE signal_id=? AND revision=?').get(s.signal_id,s.revision) as any).fact_id));
  const facts=f.db.prepare("SELECT id fact_id FROM source_identity_facts WHERE json_extract(body_json,'$.source_version') IN (?,?)").all(b.message.revision,a.message.revision) as any[];
  expect(qualified).toEqual(new Set(facts.map(x=>x.fact_id)));expect(qualified.size).toBe(2);
  for(const repeated of repetitions){
   const repeatedFact=f.db.prepare("SELECT id fact_id FROM source_identity_facts WHERE json_extract(body_json,'$.source_version')=?").get(repeated.message.revision) as any;
   expect(f.db.prepare('SELECT * FROM decision_provider_observations WHERE fact_id=?').all(repeatedFact.fact_id)).toEqual([]);
   expect(f.db.prepare('SELECT wire_hash FROM source_identity_signals WHERE fact_id=?').all(repeatedFact.fact_id)).toEqual([{wire_hash:null},{wire_hash:null}]);
  }
  const routed:any=f.engine.signals({operation:'decision_enqueue_routed',registry:f.registry,envelope:batch,formal_registry_raw:f.raw});
  const eligible=f.db.prepare('SELECT eligibility_json FROM decision_formal_intents').all() as any[];
  const eligibleFacts=new Set(eligible.flatMap(row=>JSON.parse(row.eligibility_json).source_evidence.map((e:any)=>e.fact_hash)));
  expect(eligibleFacts).toEqual(qualified);expect(routed.children).toHaveLength(1);
  expect(f.db.prepare('SELECT * FROM decision_formal_activation').all()).toEqual([]);
 }finally{f.close();}
});

it('approval44 domain: later material L2 waits for original formal proof then follows the original parent target',async()=>{
 const f=providerFixture('feishu_approval');try{
  await f.activate();f.toggle(true);f.capture().commit();
  const original:any=f.engine.signals({operation:'next',formal_only:true,formal_registry_raw:f.raw,now:'2999-01-01T00:00:00Z'});
  f.engine.signals({operation:'decision_enqueue_routed',registry:f.registry,envelope:original,formal_registry_raw:f.raw});
  f.engine.signals({operation:'settle',delivery_id:original.delivery_id,http_status:200,formal_only:true,now:'2999-01-01T00:00:00Z'});
  const domains=f.db.prepare('SELECT * FROM decision_provider_activations').all();
  const entity:any=f.db.prepare('SELECT * FROM entity_message_entities').get(),body={...JSON.parse(entity.body_json),message:'synthetic later material extraction'};
  const content_hash=providerDigest(body);
  new SourceIdentityLedger(f.db).processL2(entity.id,()=>new EntityStore(f.db).write({operation:'update',collection:'message-entities',id:entity.id,revision:entity.revision,data:{content_hash,body},actor:'l2-material-pipeline',request_id:'materials:'+entity.id,idempotency_key:'materials:'+providerDigest([entity.id,entity.revision,content_hash])}));
  expect(f.engine.signals({operation:'next',formal_only:true,formal_registry_raw:f.raw,now:'2999-01-01T00:00:00Z'})).toBeNull();
  const work:any=f.engine.signals({operation:'decision_formal_claim'}),intent=await f.host.prepare(work);
  f.engine.signals({operation:'decision_formal_freeze',wake_id:work.wake_id,intent});f.engine.signals({operation:'decision_formal_claim'});
  // 仅fixture内模拟已核输入，绝非真实native回执或业务接受。
  f.engine.signals({operation:'decision_formal_report',wake_id:work.wake_id,outcome:'accepted',execution_id:'synthetic-parent-execution',request_id:'synthetic-parent-request',turn_id:'synthetic-parent-turn',evidence:{verifier:'official_thread_read',execution_id:'synthetic-parent-execution',request_id:'synthetic-parent-request',turn_id:'synthetic-parent-turn',submission_hash:intent.submission_hash}});
  const changed=JSON.parse(f.raw);changed.targets.feishu_approval={...changed.targets.feishu_approval,thread_id:randomUUID(),project_id:randomUUID(),cwd:'/synthetic/new-unadopted-target'};
  const material:any=f.engine.signals({operation:'next',formal_only:true,formal_registry_raw:f.raw,now:'2999-01-01T00:00:00Z'});expect(material.signals).toHaveLength(1);
  const routed:any=f.engine.signals({operation:'decision_enqueue_routed',registry:changed,envelope:material,formal_registry_raw:JSON.stringify(changed)});expect(routed.children).toHaveLength(1);
  const child:any=f.db.prepare('SELECT b.target_json,f.eligibility_json FROM decision_batches b JOIN decision_formal_intents f USING(delivery_id) WHERE b.delivery_id=?').get(routed.children[0]);
  expect(JSON.parse(child.target_json)).toEqual({host:f.target.host,thread_id:f.target.thread_id,project_id:f.target.project_id,cwd:f.target.cwd});
  const eligibility=JSON.parse(child.eligibility_json);expect(eligibility.source_evidence).toHaveLength(1);
  expect(eligibility.source_evidence[0].evidence_type).toBe('original_provider_fact_parent');expect(eligibility.source_evidence[0].parent_revision).toBe(2);
  expect(f.db.prepare('SELECT count(*) n FROM source_identity_facts').get()).toEqual({n:1});
  expect(f.db.prepare('SELECT * FROM decision_provider_activations').all()).toEqual(domains);expect(f.db.prepare('SELECT * FROM decision_formal_activation').all()).toEqual([]);
 }finally{f.close();}
});

it('approval44 domain: unknown formal attempt retains exact original key and bytes through readonly reconciliation',async()=>{
 const f=providerFixture('feishu_approval');try{
  await f.activate();f.toggle(true);f.capture().commit();
  const batch:any=f.engine.signals({operation:'next',formal_only:true,formal_registry_raw:f.raw,now:'2999-01-01T00:00:00Z'});
  f.engine.signals({operation:'decision_enqueue_routed',registry:f.registry,envelope:batch,formal_registry_raw:f.raw});
  const work:any=f.engine.signals({operation:'decision_formal_claim'});const intent=await f.host.prepare(work);
  f.engine.signals({operation:'decision_formal_freeze',wake_id:work.wake_id,intent});
  expect((f.engine.signals({operation:'decision_formal_claim'}) as any).action).toBe('submit');
  f.engine.signals({operation:'decision_formal_report',wake_id:work.wake_id,outcome:'unknown',execution_id:'synthetic-original-execution',request_id:'synthetic-original-request'});
  const before=f.db.prepare('SELECT * FROM decision_formal_intents').all();const batches=f.db.prepare('SELECT * FROM decision_batches').all();
  const again:any=f.engine.signals({operation:'decision_formal_claim'});expect(again.action).toBe('reconcile');
  expect(again.intent).toEqual(intent);expect(again.execution_id).toBe('synthetic-original-execution');expect(again.request_id).toBe('synthetic-original-request');
  const result=await f.host.lookup(again);expect(result.outcome).toBe('unknown');
  expect(f.db.prepare('SELECT * FROM decision_formal_intents').all()).toEqual(before);expect(f.db.prepare('SELECT * FROM decision_batches').all()).toEqual(batches);
  expect(()=>f.engine.signals({operation:'decision_formal_report',wake_id:work.wake_id,outcome:'unknown',execution_id:'synthetic-substitute'})).toThrow('formal_execution_conflict');
  expect(f.db.prepare('SELECT * FROM decision_formal_intents').all()).toEqual(before);
 }finally{f.close();}
});

// Boundary authority is original P creation + captured page, never mutable L2.
it('provider floor keeps immutable P state when current L2 metadata is corrupted',async()=>{
 const f=providerFixture();try{
  f.toggle(true);f.capture('A',1).commit();f.toggle(false);
  const row=f.db.prepare('SELECT id,body_json FROM entity_message_entities').get() as any,body=JSON.parse(row.body_json);
  const original={...body.reader_metadata};body.reader_metadata={...original,state_hash:'b'.repeat(64),observation_revision:999};
  f.db.prepare('UPDATE entity_message_entities SET body_json=? WHERE id=?').run(JSON.stringify(body),row.id);
  const adopted=await f.activate() as any;
  expect(adopted.activation.boundary.observations).toEqual([{source_ref:JSON.stringify(['task-user-visible/v1','synthetic-native-object']),observation_revision:1,state_hash:original.state_hash}]);
  expect(adopted.activation.boundary.observation_origins).toHaveLength(1);
  f.toggle(true);f.capture('A',2).commit();const before=f.db.prepare('SELECT * FROM signal_outbox ORDER BY revision').all();
  expect(f.engine.signals({operation:'next',formal_only:true,formal_registry_raw:f.raw,now:'2999-01-01T00:00:00Z'})).toBeNull();
  expect(f.db.prepare('SELECT * FROM signal_outbox ORDER BY revision').all()).toEqual(before);
 }finally{f.close();}
});
it('provider floor rejects P creation receipt conflicting with immutable original fact',async()=>{
 const f=providerFixture();try{
  f.toggle(true);f.capture('A',1).commit();f.toggle(false);
  const row=f.db.prepare("SELECT idempotency_key,response_json FROM entity_write_receipts WHERE actor='l1-source-intake'").get() as any,original=JSON.parse(row.response_json);
  original.body.reader_metadata={...original.body.reader_metadata,state_hash:'c'.repeat(64),observation_revision:777};
  f.db.prepare("UPDATE entity_write_receipts SET response_json=? WHERE actor='l1-source-intake' AND idempotency_key=?").run(JSON.stringify(original),row.idempotency_key);
  const controls=f.db.prepare('SELECT * FROM collector_controls').all();await expect(f.activate()).rejects.toThrow('provider_observation_original_conflict');
  expect(f.db.prepare('SELECT * FROM decision_provider_activations').all()).toEqual([]);expect(f.db.prepare('SELECT * FROM collector_controls').all()).toEqual(controls);
 }finally{f.close();}
});
it('provider floor refuses recanonicalized pending metadata without original physical page hash',async()=>{
 const f=providerFixture();try{
  f.toggle(true);const captured=f.capture('A',1);captured.settle();f.toggle(false);
  const row=f.db.prepare('SELECT page_id,payload_json FROM source_intake_pending').get() as any,payload=JSON.parse(row.payload_json);
  payload.items[0].message.reader_metadata.observation_revision=999;const raw=JSON.stringify(payload);
  f.db.prepare('UPDATE source_intake_pending SET payload_json=?,payload_hash=? WHERE page_id=?').run(raw,createHash('sha256').update(raw).digest('hex'),row.page_id);
  const pending=f.db.prepare('SELECT * FROM source_intake_pending').all();await expect(f.activate()).rejects.toThrow('provider_capture_boundary_unverified');
  expect(f.db.prepare('SELECT * FROM source_intake_pending').all()).toEqual(pending);expect(f.db.prepare('SELECT * FROM decision_provider_activations').all()).toEqual([]);
 }finally{f.close();}
});

it.each(['missing','corrupt'] as const)('approval44 anomaly: %s exact identity remains exception metadata with no IM fallback or formal authority',async(kind)=>{
 const f=providerFixture('feishu_approval');try{
  await f.activate();f.toggle(true);f.capture().commit();
  // 仅破坏合成私库，验证真实selector/wire/router；不改生产或给旧事实补签。
  if(kind==='missing')f.db.prepare('DELETE FROM source_identity_signals').run();
  else f.db.prepare('UPDATE source_identity_signals SET raw_hash=?').run('0'.repeat(64));
  const control=f.engine.collectorControl({operation:'status'}),domains=f.db.prepare('SELECT * FROM decision_provider_activations').all();
  const batch:any=f.engine.signals({operation:'next',formal_only:true,formal_registry_raw:f.raw,now:'2999-01-01T00:00:00Z'});
  expect(batch.signals).toHaveLength(2);for(const s of batch.signals)expect(s.source_provider).toBeNull();
  const routed:any=f.engine.signals({operation:'decision_enqueue_routed',registry:f.registry,envelope:batch,formal_registry_raw:f.raw});expect(routed.children).toHaveLength(1);
  const row:any=f.db.prepare('SELECT target_json,routing_json FROM decision_batches WHERE delivery_id=?').get(routed.children[0]);
  const target=JSON.parse(row.target_json);expect(target.thread_id).toBe(f.registry.targets.exception.thread_id);expect(target.thread_id).not.toBe(f.registry.targets.feishu_im.thread_id);expect(target.thread_id).not.toBe(f.target.thread_id);
  expect(JSON.parse(row.routing_json).target_name).toBe('exception');
  expect(f.db.prepare('SELECT * FROM decision_formal_intents').all()).toEqual([]);expect(f.engine.signals({operation:'decision_formal_claim'})).toBeNull();
  expect(f.db.prepare('SELECT * FROM decision_provider_observations').all()).toEqual([]);
  expect(f.db.prepare('SELECT * FROM decision_formal_activation').all()).toEqual([]);expect(f.engine.collectorControl({operation:'status'})).toEqual(control);
  expect(f.db.prepare('SELECT * FROM decision_provider_activations').all()).toEqual(domains);
 }finally{f.close();}
});
it('provider existing scope cannot silently re-epoch after producer definition changes',async()=>{
 const f=providerFixture();try{
  const original=await f.activate() as any;
  const entry={...f.entry,poll_ms:600000},definition={...f.definition,config_revision:'task/v2:'+providerDigest(entry)};
  f.engine.execute({type:'configure_collectors',owner:f.owner,definitions:[definition]},'system');
  const opaque=taskCollectorIdentity(f.bridge,{entry,definition,scope:f.scope,guard:f.guard});
  const preparation=SourceIdentityPreparation.parse(f.bridge.sourceIntakeFromCollector(opaque,{type:'identity_status'}));
  const verified=await f.host.providerActivation(f.registry,'feishu_task',f.scope.account);
  expect(()=>f.engine.signals({operation:'decision_provider_activate',provider:'feishu_task',registration_id:preparation.registration_id,registry_raw:f.raw,...verified,observed_at:new Date().toISOString()})).toThrow('provider_activation_successor_required');
  const stored=f.db.prepare('SELECT body_hash,body_json FROM decision_provider_activations').all() as any[];
  expect(stored).toHaveLength(1);expect(stored[0].body_hash).toBe(original.activation.body_hash);expect(JSON.parse(stored[0].body_json)).toEqual(Object.fromEntries(Object.entries(original.activation).filter(([key])=>key!=='body_hash')));
 }finally{f.close();}
});
it('provider selection holds intact P under missing or removed mapping without wire or exception drain',async()=>{
 const f=providerFixture();try{
  await f.activate();f.toggle(true);f.capture().commit();
  const before=f.db.prepare('SELECT * FROM signal_outbox').all(),identity=f.db.prepare('SELECT * FROM source_identity_signals').all();
  expect(f.engine.signals({operation:'next',formal_only:true,now:'2999-01-01T00:00:00Z'})).toBeNull();
  const removed=structuredClone(f.registry);delete removed.provider_sources.feishu;
  expect(f.engine.signals({operation:'next',formal_only:true,formal_registry_raw:JSON.stringify(removed),now:'2999-01-01T00:00:00Z'})).toBeNull();
  expect(f.db.prepare('SELECT * FROM signal_outbox').all()).toEqual(before);expect(f.db.prepare('SELECT * FROM source_identity_signals').all()).toEqual(identity);
  expect(f.db.prepare('SELECT * FROM decision_batches').all()).toEqual([]);
  expect((f.engine.signals({operation:'next',formal_only:true,formal_registry_raw:f.raw,now:'2999-01-01T00:00:00Z'}) as any).signals[0].source_provider).toBe('feishu_task');
 }finally{f.close();}
});
it('provider restart before metadata holds genuine signed P instead of classifying an exception',async()=>{
 const f=providerFixture('feishu_task',true);let reopened:ProviderEngine|undefined;try{
  await f.activate();f.toggle(true);f.capture().commit();f.toggle(false);
  const before=f.db.prepare('SELECT * FROM signal_outbox').all(),identities=f.db.prepare('SELECT * FROM source_identity_signals').all();f.engine.close();
  reopened=new ProviderEngine(f.dbpath,undefined,undefined,false,f.root);
  expect((reopened.signals({operation:'decision_provider_activation_status'}) as any).domains[0].current_ready).toBe(false);
  expect(reopened.signals({operation:'next',formal_only:true,formal_registry_raw:f.raw,now:'2999-01-01T00:00:00Z'})).toBeNull();
  expect(reopened.db.prepare('SELECT * FROM signal_outbox').all()).toEqual(before);expect(reopened.db.prepare('SELECT * FROM source_identity_signals').all()).toEqual(identities);
  expect(reopened.db.prepare('SELECT * FROM decision_batches').all()).toEqual([]);
 }finally{reopened?.close();f.close();}
});
it('provider selected registry survives restart and later registry drift without changing original Task',async()=>{
 const f=providerFixture('feishu_task',true);let reopened:ProviderEngine|undefined;try{
  await f.activate();f.toggle(true);f.capture().commit();f.toggle(false);
  const batch:any=f.engine.signals({operation:'next',formal_only:true,formal_registry_raw:f.raw,now:'2999-01-01T00:00:00Z'});
  const snapshot=f.db.prepare('SELECT * FROM decision_provider_delivery_registry').all(),outbox=f.db.prepare('SELECT * FROM signal_outbox').all();f.engine.close();
  reopened=new ProviderEngine(f.dbpath,undefined,undefined,false,f.root);
  const changed=structuredClone(f.registry);changed.targets.feishu_task.thread_id=randomUUID();
  const route=()=>reopened!.signals({operation:'decision_enqueue_routed',envelope:batch,registry:changed,formal_registry_raw:JSON.stringify(changed)}) as any;
  expect(route()).toMatchObject({deferred:true,reason:'provider_selected_fact_not_ready'});
  expect(reopened.db.prepare('SELECT * FROM decision_batches').all()).toEqual([]);expect(reopened.db.prepare('SELECT * FROM signal_outbox').all()).toEqual(outbox);
  const bridge={} as any;bridge.sourceIntakeFromCollector=(identity:any,request:any)=>reopened!.sourceIdentity({registration:collectorIdentityPayload(identity,bridge),request});
  const opaque=taskCollectorIdentity(bridge,{entry:f.entry,definition:f.definition,scope:f.scope,guard:f.guard});bridge.sourceIntakeFromCollector(opaque,{type:'identity_status'});
  expect(route().deferred).not.toBe(true);
  const eligibility=JSON.parse((reopened.db.prepare('SELECT eligibility_json FROM decision_formal_intents').get() as any).eligibility_json);
  expect(eligibility.registry_raw).toBe(f.raw);expect(eligibility.task_id).toBe(providerDecisionTasks.feishu_task);expect(eligibility.target.thread_id).toBe(f.target.thread_id);
  expect(reopened.db.prepare('SELECT * FROM decision_provider_delivery_registry').all()).toEqual(snapshot);
 }finally{reopened?.close();f.close();}
});
it('provider Pump does not autoactivate legacy singleton even when all old three bindings verify',async()=>{
 const f=providerFixture();try{
  const old:any=f.engine.signals({operation:'ingress',id:'synthetic-pre-provider-mail',kind:'message',source:'mail',source_account:'old-mail',source_ref:'old-mail',occurred_at:new Date().toISOString(),content:{text:'synthetic old source',attachments:[]}});
  const oldRow=f.db.prepare('SELECT * FROM signal_outbox WHERE signal_id=?').get(old.signal_id);
  await f.activate();f.toggle(true);f.capture().commit();
  const activation=vi.fn(async()=>{
   const verified_targets=Object.fromEntries(Object.entries(formalDecisionTasks).map(([name,task_id])=>{const t=f.registry.targets[name];return [name,{task_id,task_revision:1,binding:{project_id:'transmission',codex_project_id:t.project_id,thread_id:t.thread_id,cwd:t.cwd},verification:{verifier:'official_thread_read',cwd_matches:true,project_matches:true,codex_project_id:t.project_id}}];}));
   return {binding:verified_targets.feishu_im!.binding,task_revision:1,verified_targets};
  });
  const proof=await activation(),check=new ProviderEngine(':memory:',undefined,undefined,false,f.root);
  try{check.signals({operation:'mode',mode:'3layer'});expect(check.signals({operation:'decision_formal_activate',registry_raw:f.raw,...proof,observed_at:new Date().toISOString()})).toBeTruthy();}finally{check.close();}
  activation.mockClear();
  const host={...f.host,activation};
  const pump=new DecisionIntakePump(async input=>f.engine.signals(input),f.registry.targets.feishu_im,host,undefined,[],()=>f.raw);
  await pump.tick();expect(activation).not.toHaveBeenCalled();
  for(const table of ['decision_formal_activation','decision_formal_legacy_outbox','decision_formal_legacy_deliveries','decision_formal_legacy_batches'])expect(f.db.prepare('SELECT * FROM '+table).all()).toEqual([]);
  expect(f.db.prepare('SELECT * FROM signal_outbox WHERE signal_id=?').get(old.signal_id)).toEqual(oldRow);
  const intent=f.db.prepare('SELECT state,intent_json FROM decision_formal_intents').get() as any;expect(intent.state).toBe('prepared');expect(JSON.parse(intent.intent_json).task_id).toBe(providerDecisionTasks.feishu_task);
 }finally{f.close();}
});
it('provider Pump after restart preserves selected pending and five inventories without activating legacy',async()=>{
 const f=providerFixture('feishu_task',true);let reopened:ProviderEngine|undefined;try{
  await f.activate();f.toggle(true);f.capture().commit();f.toggle(false);
  f.engine.signals({operation:'next',formal_only:true,formal_registry_raw:f.raw,now:new Date().toISOString()});
  const tables=['decision_formal_activation','decision_formal_intents','decision_formal_owned_deliveries','decision_formal_legacy_outbox','decision_formal_legacy_deliveries','decision_formal_legacy_batches','decision_provider_delivery_registry','signal_outbox','signal_deliveries'];
  const before=Object.fromEntries(tables.map(t=>[t,f.db.prepare('SELECT * FROM '+t).all()]));f.engine.close();reopened=new ProviderEngine(f.dbpath,undefined,undefined,false,f.root);
  const activation=vi.fn(async()=>{const verified_targets=Object.fromEntries(Object.entries(formalDecisionTasks).map(([name,task_id])=>{const t=f.registry.targets[name];return [name,{task_id,task_revision:1,binding:{project_id:'transmission',codex_project_id:t.project_id,thread_id:t.thread_id,cwd:t.cwd},verification:{verifier:'official_thread_read',cwd_matches:true,project_matches:true,codex_project_id:t.project_id}}];}));return {binding:verified_targets.feishu_im!.binding,task_revision:1,verified_targets};});
  const prepare=vi.fn(async()=>{throw Error('unprepared metadata cannot prepare a Task');});
  const operations:string[]=[],routes:any[]=[];
  const pump=new DecisionIntakePump(async input=>{const request=input as any;operations.push(request.operation);const result=reopened!.signals(input);if(request.operation==='decision_enqueue_routed')routes.push(result);return result;},f.registry.targets.feishu_im,{...f.host,activation,prepare},undefined,[],()=>f.raw);
  await pump.tick();expect(operations).toContain('decision_enqueue_routed');expect(routes).toEqual([expect.objectContaining({deferred:true,reason:'provider_selected_fact_not_ready'})]);expect(activation).not.toHaveBeenCalled();expect(prepare).not.toHaveBeenCalled();
  for(const table of tables)expect(reopened.db.prepare('SELECT * FROM '+table).all()).toEqual(before[table]);
  expect((reopened.signals({operation:'decision_provider_activation_status'}) as any).domains[0].current_ready).toBe(false);
 }finally{reopened?.close();f.close();}
});
it('provider Pump waits for planned provider domain without bootstrapping legacy or selecting pending',async()=>{
 const f=providerFixture();try{
  const activation=vi.fn(async()=>{const verified_targets=Object.fromEntries(Object.entries(formalDecisionTasks).map(([name,task_id])=>{const t=f.registry.targets[name];return [name,{task_id,task_revision:1,binding:{project_id:'transmission',codex_project_id:t.project_id,thread_id:t.thread_id,cwd:t.cwd},verification:{verifier:'official_thread_read',cwd_matches:true,project_matches:true,codex_project_id:t.project_id}}];}));return {binding:verified_targets.feishu_im!.binding,task_revision:1,verified_targets};});
  const operations:string[]=[];const pump=new DecisionIntakePump(async input=>{operations.push((input as any).operation);return f.engine.signals(input);},f.registry.targets.feishu_im,{...f.host,activation},undefined,[],()=>f.raw);
  await pump.tick();expect(activation).not.toHaveBeenCalled();expect(operations).not.toContain('next');
  for(const table of ['decision_formal_activation','decision_formal_intents','decision_formal_owned_deliveries','decision_formal_legacy_outbox','decision_formal_legacy_deliveries','decision_formal_legacy_batches','decision_provider_activations'])expect(f.db.prepare('SELECT * FROM '+table).all()).toEqual([]);
 }finally{f.close();}
});
it('provider Pump preserves original legacy bootstrap when no provider domain or mapping is present',async()=>{
 const f=providerFixture();try{
  const registry=structuredClone(f.registry);registry.schema_version=1;delete registry.provider_sources;
  const activation=vi.fn(async()=>{const verified_targets=Object.fromEntries(Object.entries(formalDecisionTasks).map(([name,task_id])=>{const t=registry.targets[name];return [name,{task_id,task_revision:1,binding:{project_id:'transmission',codex_project_id:t.project_id,thread_id:t.thread_id,cwd:t.cwd},verification:{verifier:'official_thread_read',cwd_matches:true,project_matches:true,codex_project_id:t.project_id}}];}));return {binding:verified_targets.feishu_im!.binding,task_revision:1,verified_targets};});
  const pump=new DecisionIntakePump(async input=>f.engine.signals(input),registry.targets.feishu_im,{...f.host,activation},undefined,[],()=>JSON.stringify(registry));
  await pump.tick();expect(activation).toHaveBeenCalledTimes(1);expect(f.db.prepare('SELECT * FROM decision_formal_activation').all()).toHaveLength(1);expect(f.db.prepare('SELECT * FROM decision_provider_activations').all()).toEqual([]);
 }finally{f.close();}
});

function explicitLegacyProof(f:ReturnType<typeof providerFixture>,registry:any=f.registry){
 const verified_targets=Object.fromEntries(Object.entries(formalDecisionTasks).map(([name,task_id])=>{const t=registry.targets[name];return [name,{task_id,task_revision:1,binding:{project_id:'transmission',codex_project_id:t.project_id,thread_id:t.thread_id,cwd:t.cwd},verification:{verifier:'official_thread_read',cwd_matches:true,project_matches:true,codex_project_id:t.project_id}}];}));
 return {operation:'decision_formal_activate',registry_raw:JSON.stringify(registry),binding:verified_targets.feishu_im!.binding,task_revision:1,verified_targets,observed_at:'2026-11-02T03:00:00.000Z'};
}
const adoptionTables=['decision_formal_intents','decision_formal_owned_deliveries','decision_formal_legacy_outbox','decision_formal_legacy_deliveries','decision_formal_legacy_batches'];
function adoptionRows(db:Database.Database,tables=adoptionTables){return Object.fromEntries(tables.map(t=>[t,db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()]));}
it.each(['feishu_task','feishu_approval'] as const)('explicit legacy first adoption freezes only ordinary rows and leaves %s P eligible for its original Task',async(provider)=>{
 const f=providerFixture(provider);try{
  const old:any=f.engine.signals({operation:'ingress',id:'synthetic-ordinary-before-provider',kind:'message',source:'mail',source_account:'synthetic-mail',source_ref:'synthetic-mail',occurred_at:new Date().toISOString(),content:{text:'synthetic ordinary original',attachments:[]}});
  await f.activate();f.toggle(true);f.capture().commit();
  const oldRow=f.db.prepare('SELECT * FROM signal_outbox WHERE signal_id=?').get(old.signal_id),providerRows=f.db.prepare('SELECT * FROM signal_outbox WHERE signal_id<>?').all(old.signal_id),domains=f.db.prepare('SELECT * FROM decision_provider_activations').all();
  const activation:any=f.engine.signals(explicitLegacyProof(f));expect(activation.inventory).toEqual({pending_outbox:1,pending_deliveries:0,existing_batches:0});
  expect(f.db.prepare('SELECT signal_id FROM decision_formal_legacy_outbox').all()).toEqual([{signal_id:old.signal_id}]);
  expect(f.db.prepare('SELECT * FROM signal_outbox WHERE signal_id=?').get(old.signal_id)).toEqual(oldRow);expect(f.db.prepare('SELECT * FROM signal_outbox WHERE signal_id<>?').all(old.signal_id)).toEqual(providerRows);expect(f.db.prepare('SELECT * FROM decision_provider_activations').all()).toEqual(domains);
  const batch:any=f.engine.signals({operation:'next',formal_only:true,formal_registry_raw:f.raw,now:new Date().toISOString()});expect(batch.signals.every((s:any)=>s.source_provider===provider)).toBe(true);expect(batch.signals.some((s:any)=>s.signal_id===old.signal_id)).toBe(false);
  f.engine.signals({operation:'decision_enqueue_routed',registry:f.registry,envelope:batch,formal_registry_raw:f.raw});expect(f.engine.signals({operation:'decision_formal_claim'})).toMatchObject({action:'prepare',eligibility:{task_id:providerDecisionTasks[provider]}});
 }finally{f.close();}
});
it.each(['feishu_task','feishu_approval'] as const)('explicit legacy first adoption preserves selected %s children and unknown intent bytes across restart and mapping removal',async(provider)=>{
 const f=providerFixture(provider,true);let reopened:ProviderEngine|undefined;try{
  await f.activate();f.toggle(true);f.capture().commit();f.toggle(false);
  const batch:any=f.engine.signals({operation:'next',formal_only:true,formal_registry_raw:f.raw,now:new Date().toISOString()});f.engine.signals({operation:'decision_enqueue_routed',registry:f.registry,envelope:batch,formal_registry_raw:f.raw});
  const work:any=f.engine.signals({operation:'decision_formal_claim'}),intent=await f.host.prepare(work);f.engine.signals({operation:'decision_formal_freeze',wake_id:work.wake_id,intent});expect(f.engine.signals({operation:'decision_formal_claim'})).toMatchObject({action:'submit'});f.engine.signals({operation:'decision_formal_report',wake_id:work.wake_id,outcome:'unknown'});
  const tables=[...adoptionTables,'decision_batches','decision_batch_items','decision_routed_deliveries','decision_provider_delivery_registry','signal_outbox','signal_deliveries','source_identity_signals'],before=adoptionRows(f.db,tables);f.engine.close();reopened=new ProviderEngine(f.dbpath,undefined,undefined,false,f.root);
  const changed=structuredClone(f.registry);delete changed.provider_sources.feishu;const activation:any=reopened.signals(explicitLegacyProof(f,changed));expect(activation.inventory).toEqual({pending_outbox:0,pending_deliveries:0,existing_batches:0});
  expect(adoptionRows(reopened.db,tables)).toEqual(before);expect(reopened.signals({operation:'decision_formal_claim'})).toMatchObject({action:'reconcile',intent:{task_id:providerDecisionTasks[provider],idempotency_key:intent.idempotency_key,submission_hash:intent.submission_hash}});
 }finally{reopened?.close();f.close();}
});
it.each((['feishu_task','feishu_approval'] as const).flatMap(provider=>['pending','quarantine'].map(kind=>({provider,kind}))))('explicit legacy native boundary excludes $provider $kind capture without reading or changing its P page',async({provider,kind})=>{
 const f=providerFixture(provider);try{
  await f.activate();f.toggle(true);const captured=f.capture();captured.settle();f.toggle(false);
  if(kind==='quarantine'){
   const row=f.db.prepare('SELECT * FROM source_intake_pending').get() as any;
   f.db.prepare('INSERT INTO source_intake_quarantine(stream_ref,page_id,payload_hash,payload_json,created_at,reason,quarantined_at) VALUES(?,?,?,?,?,?,?)').run(row.stream_ref,row.page_id,row.payload_hash,row.payload_json,row.created_at,'synthetic-explicit-adoption','2026-11-02T03:00:00.000Z');f.db.prepare('DELETE FROM source_intake_pending').run();
  }
  const tables=[...adoptionTables,'source_intake_pending','source_intake_quarantine','source_intake_pages','source_identity_pages','source_identity_signals'],before=adoptionRows(f.db,tables);
  const result:any=f.engine.signals(explicitLegacyProof(f));expect(result.native_creation_boundary.captures).toEqual([]);expect(adoptionRows(f.db,tables)).toEqual(before);
 }finally{f.close();}
});
it.each(['mixed','bad-hash','bad-lineage','missing-parent','scope-conflict'])('explicit legacy ambiguous %s evidence rolls back every first-adoption row',async(fault)=>{
 const f=providerFixture();try{
  f.engine.signals({operation:'ingress',id:'synthetic-before-failing-adoption',kind:'message',source:'mail',source_account:'synthetic-mail',source_ref:'synthetic-mail',occurred_at:new Date().toISOString(),content:{text:'synthetic ordinary original',attachments:[]}});
  await f.activate();f.toggle(true);const captured=f.capture();captured.settle();f.toggle(false);
  const row=f.db.prepare('SELECT * FROM source_intake_pending').get() as any;
  if(fault==='mixed'){const body=JSON.parse(row.payload_json);body.items.push({...body.items[0],message:{...body.items[0].message,conversation_id:'oc_synthetic-ordinary',object_id:'om_synthetic-ordinary',reader_metadata:{}}});const raw=JSON.stringify(body);f.db.prepare('UPDATE source_intake_pending SET payload_json=?,payload_hash=?').run(raw,createHash('sha256').update(raw).digest('hex'));}
  if(fault==='bad-hash')f.db.prepare('UPDATE source_intake_pending SET payload_hash=?').run('0'.repeat(64));
  if(fault==='bad-lineage')f.db.prepare('UPDATE source_identity_registrations SET body_json=?').run('{}');
  if(fault==='missing-parent')f.db.prepare('DELETE FROM source_identity_registrations').run();
  if(fault==='scope-conflict')f.db.prepare('UPDATE source_identity_pages SET scope_binding=?').run('0'.repeat(64));
  const tables=[...adoptionTables,'decision_formal_activation','source_intake_pending','source_intake_quarantine','signal_outbox','decision_provider_activations'],before=adoptionRows(f.db,tables);
  expect(()=>f.engine.signals(explicitLegacyProof(f))).toThrow(fault==='mixed'?'formal_provider_capture_scope_unknown':fault==='bad-hash'?'formal_native_capture_unknown':'formal_provider_lineage_unknown');expect(adoptionRows(f.db,tables)).toEqual(before);
 }finally{f.close();}
});
it('explicit legacy with ordinary-only data matches the original SQL inventory and replays singleton before later evidence inspection',()=>{
 const f=providerFixture();try{
  const registry=structuredClone(f.registry);registry.schema_version=1;delete registry.provider_sources;
  const old:any=f.engine.signals({operation:'ingress',id:'synthetic-ordinary-only',kind:'message',source:'mail',source_account:'synthetic-mail',source_ref:'synthetic-mail',occurred_at:new Date().toISOString(),content:{text:'synthetic ordinary original',attachments:[]}});
  const selected:any=f.engine.signals({operation:'next',now:new Date().toISOString()});const {task_id:unusedTask,...legacyTarget}=registry.targets.feishu_im;f.engine.signals({operation:'decision_enqueue',target:legacyTarget,envelope:selected});const legacy:any=f.engine.signals({operation:'decision_claim'});f.engine.signals({operation:'decision_report',wake_id:legacy.wake_id,outcome:'unknown'});
  const oldRows={outbox:f.db.prepare("SELECT * FROM signal_outbox WHERE state='pending' ORDER BY signal_id,revision").all(),deliveries:f.db.prepare("SELECT * FROM signal_deliveries WHERE state='pending' ORDER BY delivery_id").all(),batches:f.db.prepare('SELECT * FROM decision_batches ORDER BY delivery_id').all()};
  const result:any=f.engine.signals(explicitLegacyProof(f,registry));const sha=(v:unknown)=>createHash('sha256').update(providerCanonical(v)).digest('hex');expect(result.inventory).toEqual({pending_outbox:oldRows.outbox.length,pending_deliveries:oldRows.deliveries.length,existing_batches:oldRows.batches.length});
  expect(f.db.prepare('SELECT * FROM decision_formal_legacy_outbox ORDER BY signal_id,revision').all()).toEqual(oldRows.outbox.map((r:any)=>({signal_id:r.signal_id,revision:r.revision,row_hash:sha(r)})));
  expect(f.db.prepare('SELECT * FROM decision_formal_legacy_deliveries ORDER BY delivery_id').all()).toEqual(oldRows.deliveries.map((r:any)=>({delivery_id:r.delivery_id,row_hash:sha(r)})));
  expect(f.db.prepare('SELECT * FROM decision_formal_legacy_batches ORDER BY delivery_id').all()).toEqual(oldRows.batches.map((r:any)=>({delivery_id:r.delivery_id,row_hash:sha(r)})));
  expect(f.db.prepare('SELECT * FROM decision_batches ORDER BY delivery_id').all()).toEqual(oldRows.batches);expect(f.engine.signals({operation:'decision_formal_claim'})).toBeNull();expect(old.signal_id).toBeTruthy();
  const stored=f.db.prepare('SELECT * FROM decision_formal_activation').all();f.db.prepare('UPDATE source_identity_registrations SET body_json=?').run('{}');expect(f.engine.signals(explicitLegacyProof(f,registry))).toEqual({...result,replayed:true});expect(f.db.prepare('SELECT * FROM decision_formal_activation').all()).toEqual(stored);
 }finally{f.close();}
});

function unsignedHistoricalProviderPage(f:ReturnType<typeof providerFixture>,kind:string,change?:(payload:any)=>void){
 f.toggle(true);const captured=f.capture();captured.settle();f.toggle(false);const row=f.db.prepare('SELECT * FROM source_intake_pending').get() as any;
 f.db.prepare('DELETE FROM source_identity_pages WHERE page_id=?').run(row.page_id);const payload=JSON.parse(row.payload_json);change?.(payload);const raw=JSON.stringify(payload),digest=createHash('sha256').update(raw).digest('hex');f.db.prepare('UPDATE source_intake_pending SET payload_json=?,payload_hash=?').run(raw,digest);
 if(kind==='quarantine'){f.db.prepare('INSERT INTO source_intake_quarantine(stream_ref,page_id,payload_hash,payload_json,created_at,reason,quarantined_at) VALUES(?,?,?,?,?,?,?)').run(row.stream_ref,row.page_id,digest,raw,row.created_at,'synthetic-historical','2026-11-02T03:00:00.000Z');f.db.prepare('DELETE FROM source_intake_pending').run();}
 return row;
}
it.each((['feishu_task','feishu_approval'] as const).flatMap(provider=>['pending','quarantine'].map(kind=>({provider,kind}))))('explicit legacy rejects unsigned $provider $kind with another provider logical scope and rolls back ordinary freeze',async({provider,kind})=>{
 const f=providerFixture(provider);try{
  f.engine.signals({operation:'ingress',id:'synthetic-conflict-ordinary',kind:'message',source:'mail',source_account:'synthetic-mail',source_ref:'synthetic-mail',occurred_at:new Date().toISOString(),content:{text:'synthetic ordinary original',attachments:[]}});
  unsignedHistoricalProviderPage(f,kind,payload=>{const other=provider==='feishu_task'?'feishu_approval':'feishu_task';payload.items[0].message.conversation_id=(other==='feishu_task'?'task':'approval')+'-user-visible/v1';payload.items[0].message.reader_metadata.provider=other;});
  const tables=[...adoptionTables,'decision_formal_activation','signal_outbox','source_intake_pending','source_intake_quarantine','source_identity_pages'],before=adoptionRows(f.db,tables);expect(()=>f.engine.signals(explicitLegacyProof(f))).toThrow('formal_provider_capture_scope_unknown');expect(adoptionRows(f.db,tables)).toEqual(before);
 }finally{f.close();}
});
it.each(['feishu_task','feishu_approval'] as const)('explicit legacy protects consistent unsigned historical %s capture without minting a domain or private P proof',async(provider)=>{
 const f=providerFixture(provider);try{
  unsignedHistoricalProviderPage(f,'pending');const tables=[...adoptionTables,'source_intake_pending','source_intake_quarantine','source_identity_pages','decision_provider_activations','source_identity_facts'],before=adoptionRows(f.db,tables);
  const result:any=f.engine.signals(explicitLegacyProof(f));expect(result.native_creation_boundary.captures).toEqual([]);expect(adoptionRows(f.db,tables)).toEqual(before);expect(f.engine.signals({operation:'next',formal_only:true,formal_registry_raw:f.raw,now:new Date().toISOString()})).toBeNull();expect(f.engine.signals({operation:'decision_formal_claim'})).toBeNull();
 }finally{f.close();}
});
it('explicit legacy refuses a suspected provider page whose registered stream scope cannot be identified',()=>{
 const f=providerFixture();try{
  const row=unsignedHistoricalProviderPage(f,'pending',payload=>{payload.scope_binding='7'.repeat(64);});f.db.prepare('UPDATE source_intake_streams SET scope_binding=? WHERE stream_ref=?').run('7'.repeat(64),row.stream_ref);
  const tables=[...adoptionTables,'decision_formal_activation','source_intake_streams','source_intake_pending'],before=adoptionRows(f.db,tables);expect(()=>f.engine.signals(explicitLegacyProof(f))).toThrow('formal_provider_capture_scope_unknown');expect(adoptionRows(f.db,tables)).toEqual(before);
 }finally{f.close();}
});
it.each(['feishu_task','feishu_approval'] as const)('explicit legacy refuses conflicting %s metadata on a consistent historical logical scope',provider=>{
 const f=providerFixture(provider);try{
  unsignedHistoricalProviderPage(f,'pending',payload=>{payload.items[0].message.reader_metadata.provider=provider==='feishu_task'?'feishu_approval':'feishu_task';});const before=adoptionRows(f.db,[...adoptionTables,'decision_formal_activation','source_intake_pending']);expect(()=>f.engine.signals(explicitLegacyProof(f))).toThrow('formal_provider_capture_scope_unknown');expect(adoptionRows(f.db,[...adoptionTables,'decision_formal_activation','source_intake_pending'])).toEqual(before);
 }finally{f.close();}
});

// 只在真实私Engine/SQLite元数据面验证；不启动平台reader/native，不给JSON回写权源。
function providerMetadataRows(db:Database.Database){return {changes:db.prepare('SELECT total_changes() n').get(),rows:adoptionRows(db,[...adoptionTables,'decision_formal_activation','decision_provider_activations','source_identity_registrations','source_identity_pages','source_identity_facts','source_identity_signals','collector_runtime','collector_schedules','collector_controls','collector_attempts','x_process_attempts','x_process_requests','collector_checkpoints','source_intake_streams','source_intake_pending','source_intake_quarantine','entity_message_entities','entity_audit_events','signal_outbox','signal_deliveries'])};}
function providerMetadata(engine:ProviderEngine,provider:string){return (engine.signals({operation:'decision_status'}) as any).provider_adoption.providers.find((p:any)=>p.provider===provider);}
it.each(['feishu_task','feishu_approval'] as const)('readonly provider metadata exposes current %s factory without reading or changing corrupt pending original',provider=>{
 const f=providerFixture(provider);try{
  f.toggle(true);f.capture().settle();f.toggle(false);f.db.prepare('UPDATE source_intake_pending SET payload_json=?').run('synthetic-unreadable-original');
  const before=providerMetadataRows(f.db),spy=vi.spyOn(f.db,'prepare');const metadata=providerMetadata(f.engine,provider),queries=spy.mock.calls.map(v=>v[0]);spy.mockRestore();
  expect(metadata).toMatchObject({state:'observed',coverage:'observed_registrations_only',factories:[{registration_id:f.prepared.registration_id,current_ready:true,account:f.scope.account,logical_scope:f.scope.scope_ref,control:{state:'observed',enabled:false,available:true,active_operation:false,unsettled_attempts:0,unconfirmed_physical:0}}],domains:[]});
  expect(queries.some(q=>/FROM (source_identity_pages|source_identity_facts|source_intake_pending|source_intake_quarantine|entity_message_entities)\b/.test(q))).toBe(false);
  expect(JSON.stringify(metadata)).not.toMatch(/"(worker_context|runtime_owner|prepared_context|guard|producer|entry|original_path|registry_raw)":/);
  expect(providerMetadataRows(f.db)).toEqual(before);
 }finally{f.close();}
});
it.each(['feishu_task','feishu_approval'] as const)('readonly provider metadata retains exact %s domain target hashes but no preparation/context authority',async provider=>{
 const f=providerFixture(provider);try{
  const activated:any=await f.activate(),before=providerMetadataRows(f.db),metadata=providerMetadata(f.engine,provider);
  expect(metadata.domains).toEqual([{domain_id:activated.activation.domain_id,provider,registration_id:f.prepared.registration_id,activation_hash:activated.activation.body_hash,account:f.scope.account,logical_scope:f.scope.scope_ref,collector_ref:f.definition.collector_ref,task_id:providerDecisionTasks[provider],original_task_revision:2,target_hash:providerDigest(f.target),binding_hash:providerDigest(activated.activation.verified_target.binding),current_ready:true}]);
  expect(JSON.stringify(metadata)).not.toContain(f.prepared.worker_context);expect(JSON.stringify(metadata)).not.toContain(f.prepared.runtime_owner);
  expect((f.engine.signals({operation:'decision_status'}) as any).provider_registry_history).toMatchObject({state:'unknown',reason:'main_history_projection_unavailable'});
  expect(providerMetadataRows(f.db)).toEqual(before);
 }finally{f.close();}
});
it.each(['feishu_task','feishu_approval'] as const)('readonly provider metadata after %s restart does not recreate current Worker qualification',async provider=>{
 const f=providerFixture(provider,true);let reopened:ProviderEngine|undefined;try{
  await f.activate();f.engine.close();reopened=new ProviderEngine(f.dbpath,undefined,undefined,false,f.root);const before=providerMetadataRows(reopened.db),metadata=providerMetadata(reopened,provider);
  expect(metadata.factories[0].current_ready).toBe(false);expect(metadata.domains[0].current_ready).toBe(false);expect(providerMetadataRows(reopened.db)).toEqual(before);
 }finally{reopened?.close();f.close();}
});
it.each(['producer','task','domain'] as const)('readonly provider metadata rejects recanonicalized invalid %s domain without changing old status rows',async kind=>{
 const f=providerFixture();try{
  await f.activate();const row=f.db.prepare('SELECT * FROM decision_provider_activations').get() as any,body=JSON.parse(row.body_json);
  if(kind==='producer')body.producer.provider='feishu_approval';if(kind==='task')body.target.task_id=providerDecisionTasks.feishu_approval;if(kind==='domain')body.domain_id='a'.repeat(64);
  const raw=providerCanonical(body);f.db.prepare('UPDATE decision_provider_activations SET body_json=?,body_hash=?').run(raw,createHash('sha256').update(raw).digest('hex'));
  const before=providerMetadataRows(f.db);expect(providerMetadata(f.engine,'feishu_task')).toMatchObject({state:'unknown',coverage:'unknown'});expect(providerMetadataRows(f.db)).toEqual(before);
 }finally{f.close();}
});
it('readonly provider metadata does not coerce invalid control fields to false or true',()=>{
 const f=providerFixture();try{
  f.db.prepare('UPDATE collector_controls SET enabled=2').run();const before=providerMetadataRows(f.db),metadata=providerMetadata(f.engine,'feishu_task');expect(metadata.factories[0].control).toEqual({state:'unknown'});expect(providerMetadataRows(f.db)).toEqual(before);
 }finally{f.close();}
});
it('readonly provider metadata keeps another provider corrupt domain unknown without hiding a valid current factory',async()=>{
 const f=providerFixture();try{
  await f.activate();f.db.prepare('INSERT INTO decision_provider_activations VALUES(?,?,?,?,?)').run('b'.repeat(64),'feishu_approval','c'.repeat(64),'synthetic-invalid-json','d'.repeat(64));
  const before=providerMetadataRows(f.db);expect(providerMetadata(f.engine,'feishu_task').state).toBe('observed');expect(providerMetadata(f.engine,'feishu_approval')).toMatchObject({state:'unknown',coverage:'unknown'});expect(providerMetadataRows(f.db)).toEqual(before);
 }finally{f.close();}
});
it('readonly provider metadata leaves missing factory metadata and Main history explicitly unknown',()=>{
 const f=fixture();try{
  const before=f.db.prepare('SELECT total_changes() n').get(),status=f.run({operation:'decision_status'});expect(status.provider_adoption.providers).toHaveLength(2);
  for(const provider of status.provider_adoption.providers)expect(provider).toMatchObject({state:'unknown',coverage:'unknown'});
  expect(status.provider_registry_history.state).toBe('unknown');expect(f.db.prepare('SELECT total_changes() n').get()).toEqual(before);
 }finally{f.db.close();}
});
