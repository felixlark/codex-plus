import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SuggestionCoordinator,adaptSuggestions,installSuggestionReader,reviewedSuggestionResource} from '../Sources/CodexPlus/Resources/suggestion-auto-send.mjs';
import {openAsar,parser} from '../scripts/inspect-sidebar-model.mjs';
const page=(key,extra={})=>({id:'a',snapshot:{key,route:'/local/thread',revision:1,supported:true,eligible:true,focused:true,...extra}});
const ready=(key,extra={})=>page(key,{pending:true,valid:true,ready:true,...extra});

test('default off, enabling seeds old suggestions and later accepts and submits once',async()=>{
  const writes=[],calls=[],c=new SuggestionCoordinator({persist:async a=>writes.push(a)}),act=async(id,action,arg)=>{calls.push(action);return {ok:true,revision:1};};
  await c.tick([page('old')],act);assert.deepEqual(calls,[]);
  c.configure(true);await c.tick([page('old')],act);await c.tick([page('old')],act);assert.deepEqual(calls,[]);
  await c.tick([page('new')],act);assert.deepEqual(calls,['accept']);assert.ok(writes.at(-1).includes('new'));
  await c.tick([ready('new')],act);assert.deepEqual(calls,['accept','submit']);
  await c.tick([ready('new',{empty:true,focused:false,revision:4})],act);assert.equal(c.status().submitted,1);
  await c.tick([page('new')],act);assert.equal(calls.filter(a=>a==='accept').length,1);
});
test('two sessions sharing a turn get a single persistent claim',async()=>{
  const c=new SuggestionCoordinator({persist:async()=>{}}),calls=[],act=async(id,a)=>{calls.push([id,a]);return {ok:true,revision:1};};c.configure(true);
  await c.tick([page(null),{...page(null),id:'b'}],act);
  await c.tick([page('same'),{...page('same'),id:'b'}],act);
  await c.tick([ready('same',{valid:false}),{...page('same'),id:'b'}],act);
  await c.tick([page('same'),{...page('same'),id:'b'}],act);
  assert.equal(calls.filter(([,a])=>a==='accept').length,1);
});
test('disable during claim persistence and storage failure prevent actions',async()=>{
  let release;const c=new SuggestionCoordinator({persist:()=>new Promise(r=>release=r)}),calls=[],act=async(id,a)=>calls.push(a);c.configure(true);await c.tick([page(null)],act);
  const pending=c.tick([page('turn')],act);c.configure(false);release();await pending;assert.deepEqual(calls,[]);
  const d=new SuggestionCoordinator({persist:async()=>{throw Error('disk');}});d.configure(true);await d.tick([page(null)],act);await d.tick([page('turn')],act);assert.equal(d.status().enabled,false);assert.deepEqual(calls,[]);
});
test('user input, navigation, disable, lost focus and absent send cancel accepted drafts',async()=>{
  for(const extra of [{revision:2},{route:'/local/other'},{focused:false},{valid:false},{ready:false}]){
    const c=new SuggestionCoordinator({persist:async()=>{}}),calls=[],act=async(id,a)=>{calls.push(a);return {ok:true,revision:1};};c.configure(true);await c.tick([page(null)],act);await c.tick([page('turn')],act);await c.tick([ready('turn',extra)],act);assert.deepEqual(calls,['accept','cancel']);
  }
  const c=new SuggestionCoordinator({persist:async()=>{}}),calls=[],act=async(id,a)=>{calls.push(a);return {ok:true,revision:1};};c.configure(true);await c.tick([page(null)],act);await c.tick([page('turn')],act);c.configure(false);await c.tick([ready('turn')],act);assert.deepEqual(calls,['accept','cancel']);
});
test('controller recovery and unknown submission never replay the source turn',async()=>{
  const c=new SuggestionCoordinator({attempts:['old'],persist:async()=>{}}),calls=[],act=async(id,a)=>{calls.push(a);if(a==='submit')throw Error('connection closed');return {ok:true,revision:1};};c.configure(true);await c.tick([page(null)],act);await c.tick([page('old')],act);await c.tick([page('new')],act);await c.tick([ready('new')],act);await c.tick([page('new')],act);assert.equal(c.status().unknown,1);assert.deepEqual(calls,['accept','submit']);
});
test('official native source adds current-turn metadata and refreshes same-text identities',async ctx=>{
  let a;try{a=await openAsar('/Applications/ChatGPT.app');}catch(e){if(e.code==='ENOENT'){ctx.skip();return;}throw e;}
  try{const source=await a.read(a.entries.find(e=>e.path===reviewedSuggestionResource.path)),result=adaptSuggestions(source),{parse}=await parser();assert.equal(result.supported,true);parse(result.source,{ecmaVersion:'latest',sourceType:'module'});assert.ok(result.source.includes('r.sourceTurnId===o?.prediction.sourceTurnId'));assert.equal(adaptSuggestions(source+'\n').supported,false);parse(`(${installSuggestionReader.toString()})()`,{ecmaVersion:'latest'});}finally{await a.close();}
});
