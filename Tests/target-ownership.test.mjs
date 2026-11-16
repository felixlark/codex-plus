import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {OwnershipAuthority,OwnershipRequests,validateOwnership} from '../Sources/CodexPlus/Resources/target-ownership.mjs';
const scope=()=>({schema:'codex-target-ownership/v1',enhancementsOwner:'codex-plus',host:{pid:123,start_seconds:1,start_microseconds:2,appPath:'/Applications/ChatGPT.app',endpoint:'ws://127.0.0.1:1234/devtools/browser/original'},targets:[{targetId:'human',purpose:'human',windowID:7,browserWindowId:8,webContentsId:9,instance:'claim',frameId:'frame'},{targetId:'phone',purpose:'mobile',windowID:17,browserWindowId:18,webContentsId:19,instance:'phone',frameId:'phone-frame'}]});
test('absent, incomplete, mobile and unknown claims cannot cause an effect',async()=>{
 let next=null,count=0;const authority=new OwnershipAuthority(async()=>next);
 for(const target of ['human','phone','unknown'])await assert.rejects(authority.run(target,undefined,()=>count++));
 next=scope();await assert.rejects(authority.run('phone',undefined,()=>count++));
 next.targets[0].purpose='unknown';await assert.rejects(authority.run('human',undefined,()=>count++));
 next=scope();delete next.targets[0].webContentsId;await assert.rejects(authority.run('human',undefined,()=>count++));
 assert.equal(count,0);
});
test('host birth, target instance and frame changes invalidate prior tickets',async()=>{
 let next=scope(),revocations=0;const authority=new OwnershipAuthority(async()=>next,()=>revocations++);
 const first=await authority.admit('human','frame');assert.ok(authority.valid(first));
 next=structuredClone(next);next.host.start_microseconds++;await authority.refresh();assert.equal(authority.valid(first),false);
 const second=await authority.admit('human','frame');next.targets[0].instance='replacement';await authority.refresh();assert.equal(authority.valid(second),false);
 await assert.rejects(authority.admit('human','wrong-frame'));
 assert.equal(revocations,3);
});
test('purpose loss during awaited work rejects its late result and never repeats the effect',async()=>{
 let next=scope(),finish,started;const running=new Promise(r=>started=r),authority=new OwnershipAuthority(async()=>next);let effects=0;
 const work=authority.run('human','frame',async()=>{effects++;started();await new Promise(r=>finish=r);return 'late';});
 await running;next=null;await authority.refresh();finish();await assert.rejects(work,/Ownership changed/);assert.equal(effects,1);assert.equal(authority.scope,null);
});
test('a late authority response after close cannot reauthorise anything',async()=>{
 let deliver;const authority=new OwnershipAuthority(()=>new Promise(r=>deliver=r));const pending=authority.refresh();await authority.revoke();deliver(scope());assert.equal(await pending,null);assert.equal(authority.scope,null);
});
test('stable projections ignore producer list order without repeatedly revoking valid pages',async()=>{
 let next=scope();const authority=new OwnershipAuthority(async()=>next);const ticket=await authority.admit('human','frame');next=structuredClone(next);next.targets.reverse();next.timestamp=123;
 await authority.refresh();assert.ok(authority.valid(ticket));
 assert.throws(()=>validateOwnership({...scope(),targets:[scope().targets[0],scope().targets[0]]}));
});
test('pipe requests correlate exact replies; timeout and closed pipes reject late replies',async()=>{
 const sent=[],pipe=new OwnershipRequests(v=>sent.push(v),{timeoutMs:5});
 const p=pipe.read();assert.equal(pipe.receive({type:'target-ownership-result',version:1,requestId:'foreign',ok:true,scope:scope()}),false);
 pipe.receive({type:'target-ownership-result',version:1,requestId:sent[0].requestId,ok:true,scope:scope()});assert.equal((await p).schema,'codex-target-ownership/v1');
 const timeout=pipe.read();await assert.rejects(timeout);assert.equal(pipe.receive({type:'target-ownership-result',version:1,requestId:sent[1].requestId,ok:true,scope:scope()}),false);
 const closed=pipe.read();pipe.close();await assert.rejects(closed);await assert.rejects(pipe.read());
});
const source=await fs.readFile(new URL('../Sources/CodexPlus/Resources/controller.mjs',import.meta.url),'utf8');
const commandSource=source.slice(source.indexOf('async function command('),source.indexOf('const ownershipRequests='));
test('real controller command binds the captured world and rejects an implicit new document',async()=>{
 const calls=[],sessions=new Map([['s',{target:'human',frame:'frame',main:true,contexts:new Map([[42,{id:42,auxData:{isDefault:true,frameId:'frame'}}]])}]]);
 const context=vm.createContext({sessions,stopping:false,ownership:new OwnershipAuthority(async()=>scope()),cdp:{call:async(...args)=>{calls.push(args);return {result:{value:true}};}}});
 vm.runInContext(commandSource,context);await context.command('s','Runtime.evaluate',{expression:'own-feature'});assert.equal(calls[0][1].contextId,42);
 sessions.get('s').contexts.clear();await assert.rejects(context.command('s','Runtime.evaluate',{expression:'must-not-run'}));assert.equal(calls.length,1);
});
test('real controller command never reaches transport for a phone target',async()=>{
 const calls=[],context=vm.createContext({sessions:new Map([['s',{target:'phone',frame:'phone-frame',contexts:new Map()}]]),stopping:false,ownership:new OwnershipAuthority(async()=>scope()),cdp:{call:async(...v)=>calls.push(v)}});
 vm.runInContext(commandSource,context);await assert.rejects(context.command('s','Fetch.enable',{}));assert.equal(calls.length,0);
});

test('real controller rejects a document replaced while authority is awaited',async()=>{
 let deliver;const calls=[],world={id:42,auxData:{isDefault:true,frameId:'frame'}};
 const session={target:'human',frame:'frame',main:true,contexts:new Map([[42,world]])};
 const context=vm.createContext({sessions:new Map([['s',session]]),stopping:false,ownership:new OwnershipAuthority(()=>new Promise(r=>deliver=r)),cdp:{call:async(...v)=>calls.push(v)}});
 vm.runInContext(commandSource,context);const work=context.command('s','Runtime.evaluate',{expression:'old-feature',contextId:42});
 session.contexts.set(42,{...world});deliver(scope());await assert.rejects(work);assert.equal(calls.length,0);
});

test('a native window claimed as both human and mobile grants no effects',async()=>{
 const next=scope();next.targets[1].windowID=next.targets[0].windowID;let effects=0;
 const authority=new OwnershipAuthority(async()=>next);await assert.rejects(authority.run('human','frame',()=>effects++));assert.equal(effects,0);
});
