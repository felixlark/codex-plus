import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProjectActivityRuntime,sortProjectGroups,restoreChatRoute} from '../scripts/inspect-sidebar-model.mjs';

function storage() {
  const entries=new Map();
  return {get length(){return entries.size},key:index=>[...entries.keys()][index],getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key)};
}
const groups=[{projectId:'A',threadKeys:['A']},{projectId:'B',threadKeys:['B']},{projectId:'C',threadKeys:['C']}];
const ids=result=>result.map(group=>group.projectId);
test('background completion beats a later foreground message despite unchanged native timestamps',()=>{
  const disk=storage();let now=100;const runtime=createProjectActivityRuntime(disk,()=>now,sortProjectGroups);
  const times={A:1,B:2,C:3},states={A:'idle',B:'idle',C:'idle'};
  const render=()=>ids(runtime.sort(groups,key=>times[key],key=>times[key],key=>states[key]));
  assert.deepEqual(render(),['C','B','A']);assert.equal(disk.length,0);
  states.B='active';now=10;assert.deepEqual(render(),['B','C','A']);
  times.C=20;assert.deepEqual(render(),['B','C','A']);
  states.B='unread';now=30;assert.deepEqual(render(),['B','C','A']);
  states.B='idle';now=40;render();assert.equal(runtime.stats.groups[1].activity[0],30);
  const reloaded=createProjectActivityRuntime(disk,()=>50,sortProjectGroups);
  assert.deepEqual(ids(reloaded.sort(groups,key=>times[key],key=>times[key],key=>states[key])),['B','C','A']);
});
test('attention, unread and active projects precede newer idle projects on first render',()=>{
  const runtime=createProjectActivityRuntime(storage(),()=>999,sortProjectGroups);
  const input=['idle','unread','active','input','approval','error'].map((state,index)=>({projectId:state,threadKeys:[state],timestamp:100-index}));
  const times=Object.fromEntries(input.map(g=>[g.projectId,g.timestamp]));
  assert.deepEqual(ids(runtime.sort(input,key=>times[key],key=>times[key],key=>key)),['input','approval','error','unread','active','idle']);
  assert.ok(runtime.stats.groups.every(g=>g.activity[0]===0),'initial status sampling must not fabricate activity');
});
test('complete thread model promotes old work before previews and keyboard navigation are derived',()=>{
  const runtime=createProjectActivityRuntime(storage(),()=>999,sortProjectGroups);
  const keys=['idle-new','idle-2','idle-3','idle-4','idle-5','active-old','unread-old','approval-old','error-old','input-old'];
  const input=[{projectId:'mixed',threadKeys:keys}];
  const state=key=>key.split('-')[0];
  const result=runtime.sort(input,()=>1,()=>1,state);
  assert.deepEqual(result[0].threadKeys,['approval-old','error-old','input-old','unread-old','active-old',...keys.slice(0,5)]);
  assert.deepEqual(result[0].threadKeys.slice(0,5),['approval-old','error-old','input-old','unread-old','active-old']);
  assert.strictEqual(input[0].threadKeys,keys);assert.equal(keys[0],'idle-new');
  assert.deepEqual(runtime.stats.order,[0]);
  assert.strictEqual(runtime.sort(result,()=>1,()=>1,state),result,'unchanged order keeps model identity');
});
test('highest priority task determines project class even when metadata is incomplete',()=>{
  const input=[{projectId:'unknown-idle',threadKeys:['unknown']},{projectId:'idle',threadKeys:['idle']},{projectId:'mixed',threadKeys:['idle','active']},{projectId:'attention',threadKeys:['input']}];
  const runtime=createProjectActivityRuntime(storage(),()=>1,sortProjectGroups);
  assert.deepEqual(ids(runtime.sort(input,key=>key==='unknown'?undefined:1,key=>key==='unknown'?undefined:1,key=>key)),['attention','mixed','unknown-idle','idle']);
  const old=[{threadKeys:['A']},{threadKeys:['B']},{threadKeys:['C']}];
  assert.deepEqual(sortProjectGroups(old,key=>({A:1,C:3})[key]),[old[2],old[1],old[0]],'unknown clocks retain slots within a class');
});
test('finishing and reading a task removes its priority; unknown status does not become attention',()=>{
  const runtime=createProjectActivityRuntime(storage(),()=>100,sortProjectGroups);
  const input=[{projectId:'A',threadKeys:['idle','task']},{projectId:'B',threadKeys:['active']}];
  let task='approval';
  const render=()=>runtime.sort(input,()=>1,()=>1,key=>key==='task'?task:key==='active'?'active':undefined);
  assert.deepEqual(ids(render()),['A','B']);task='unread';assert.deepEqual(ids(render()),['A','B']);
  task='idle';assert.deepEqual(render()[1].threadKeys,['idle','task']);
  task=undefined;assert.deepEqual(ids(render()),['B','A']);
});
test('independent windows preserve both activity ledgers through reload',()=>{
  const disk=storage();let time=10;
  const a=createProjectActivityRuntime(disk,()=>time,sortProjectGroups),b=createProjectActivityRuntime(disk,()=>time,sortProjectGroups);
  const stateA={A:'idle',B:'idle',C:'idle'},stateB={...stateA};
  const render=(runtime,state)=>runtime.sort(groups,()=>1,()=>1,key=>state[key]);
  render(a,stateA);render(b,stateB);
  stateA.A='active';render(a,stateA);time=20;stateB.B='active';render(b,stateB);
  const reloaded=createProjectActivityRuntime(disk,()=>99,sortProjectGroups);
  assert.deepEqual(ids(render(reloaded,stateB)),['B','A','C']);
  assert.equal(disk.length,2);
});
test('chat route restoration follows sidebar navigation and clears only its own stale route',()=>{
  const previousWindow=globalThis.window,previousStorage=globalThis.sessionStorage;
  globalThis.sessionStorage=storage();
  globalThis.window={location:{href:'app://-/index.html'},history:{state:null,replaceState(_state,_title,url){window.location.href=url;}}};
  try{
    restoreChatRoute({pathname:'/local/test-chat',search:'?hostId=local',hash:''});
    assert.equal(new URL(window.location.href).searchParams.get('initialRoute'),'/local/test-chat?hostId=local');
    restoreChatRoute({pathname:'/settings',search:'',hash:''});
    assert.equal(new URL(window.location.href).searchParams.has('initialRoute'),false);
    window.location.href='app://-/index.html?initialRoute=%2Fsettings';
    restoreChatRoute({pathname:'/settings',search:'',hash:''});
    assert.equal(new URL(window.location.href).searchParams.get('initialRoute'),'/settings');
    restoreChatRoute({pathname:'/',search:'',hash:''});
    assert.equal(new URL(window.location.href).searchParams.get('initialRoute'),'/');
  }finally{globalThis.window=previousWindow;globalThis.sessionStorage=previousStorage;}
});
