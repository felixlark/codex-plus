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
  times.C=20;assert.deepEqual(render(),['C','B','A']);
  states.B='unread';now=30;assert.deepEqual(render(),['B','C','A']);
  states.B='idle';now=40;render();assert.equal(runtime.stats.groups[1].activity[0],30);
  const reloaded=createProjectActivityRuntime(disk,()=>50,sortProjectGroups);
  assert.deepEqual(ids(reloaded.sort(groups,key=>times[key],key=>times[key],key=>states[key])),['B','C','A']);
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
