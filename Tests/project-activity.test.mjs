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
test('each project orders explicit roles before status, with stable native ties and unlabelled tasks last',()=>{
  const runtime=createProjectActivityRuntime(null,()=>999,sortProjectGroups);
  const rows=[
    ['plain','评估经理方案','input'],['specialist','专员｜采集','input'],
    ['manager-idle','经理：交付','idle'],['director-idle','总监','idle'],
    ['manager-active','经理｜开发','active'],['manager-unread','经理 / 审查','unread'],
    ['manager-approval','经理（系统）','approval'],['manager-error','经理｜修复','error'],
    ['manager-input','经理｜决策','input'],['misleading','总监控程序','active'],
    ['missing',undefined,'idle'],
  ];
  const titles=Object.fromEntries(rows.map(([key,title])=>[key,title]));
  const states=Object.fromEntries(rows.map(([key,,status])=>[key,status]));
  const keys=rows.map(([key])=>key);
  const input=[{projectId:'mixed',threadKeys:keys},{projectId:'second',threadKeys:['specialist','director-idle']}];
  const render=()=>runtime.sort(input,()=>1,()=>1,key=>states[key],null,key=>titles[key]);
  const result=render();
  assert.deepEqual(result[0].threadKeys,['director-idle','manager-approval','manager-error','manager-input','manager-unread','manager-active','manager-idle','specialist','plain','misleading','missing']);
  assert.deepEqual(result[1].threadKeys,['director-idle','specialist']);
  assert.deepEqual(result[0].threadKeys.slice(0,5),['director-idle','manager-approval','manager-error','manager-input','manager-unread'],'role and status precede native preview truncation');
  assert.strictEqual(input[0].threadKeys,keys);
  titles.specialist='总监｜新标题';
  assert.deepEqual(render()[0].threadKeys.slice(0,2),['specialist','director-idle'],'renaming updates the role on the next model projection');
});
test('role priority preserves selected-read deferral and does not change project status ordering',()=>{
  const runtime=createProjectActivityRuntime(null,()=>100,sortProjectGroups);
  const input=[{projectId:'director-only',threadKeys:['director']},{projectId:'mixed',threadKeys:['active','read','manager']}];
  const states={director:'idle',active:'active',read:'unread',manager:'idle'};
  const titles={director:'总监',active:'专员｜采集',read:'专员｜分析',manager:'经理'};
  const render=selected=>runtime.sort(input,()=>1,()=>1,key=>states[key],selected,key=>titles[key]);
  assert.deepEqual(ids(render('active')),['mixed','director-only'],'roles only change ordering inside each project');
  states.read='idle';
  assert.deepEqual(render('read')[0].threadKeys,['manager','read','active']);
  assert.deepEqual(render('active')[0].threadKeys,['manager','active','read']);
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
test('reading the selected task defers demotion until selection changes, without changing read state or activity',()=>{
  const disk=storage(),runtime=createProjectActivityRuntime(disk,()=>100,sortProjectGroups);
  const input=[{projectId:'reading',threadKeys:['idle','read-first']},{projectId:'working',threadKeys:['active']}];
  const states={idle:'idle','read-first':'unread',active:'active'};
  const render=selected=>runtime.sort(input,()=>1,()=>1,key=>states[key],selected);
  assert.deepEqual(ids(render('active')),['reading','working']);
  states['read-first']='idle';
  for(let i=0;i<3;i++){
    const result=render('read-first');
    assert.deepEqual(ids(result),['reading','working']);
    assert.deepEqual(result[0].threadKeys,['read-first','idle']);
    assert.deepEqual(runtime.stats.groups[0].status,['idle','idle']);
    assert.equal(runtime.stats.deferredReadKey,'read-first');
  }
  assert.equal(disk.length,0,'reading must not fabricate activity or persist a priority');
  const next=render('active');
  assert.deepEqual(ids(next),['working','reading']);
  assert.deepEqual(next[1].threadKeys,['idle','read-first']);
  assert.equal(runtime.stats.deferredReadKey,null);
  assert.deepEqual(ids(render('read-first')),['working','reading'],'returning to an already-read task does not promote it');
});
test('rapidly reading the next task releases the previous hold and returning home releases the last one',()=>{
  const runtime=createProjectActivityRuntime(null,()=>100,sortProjectGroups);
  const input=[{projectId:'mixed',threadKeys:['active','A','B']}];
  const states={active:'active',A:'unread',B:'unread'};
  const render=selected=>runtime.sort(input,()=>1,()=>1,key=>states[key],selected)[0].threadKeys;
  assert.deepEqual(render('active'),['A','B','active']);
  states.A='idle';assert.deepEqual(render('A'),['A','B','active']);
  states.B='idle';assert.deepEqual(render('B'),['B','active','A']);
  assert.equal(runtime.stats.deferredReadKey,'B');
  assert.deepEqual(render(null),['active','A','B']);
});
test('deferred reads are window-local, and new work replaces the deferred priority immediately',()=>{
  const disk=storage(),a=createProjectActivityRuntime(disk,()=>100,sortProjectGroups),b=createProjectActivityRuntime(disk,()=>100,sortProjectGroups);
  const input=[{projectId:'mixed',threadKeys:['active','task']}];
  let task='unread';
  const render=(runtime,selected)=>runtime.sort(input,()=>1,()=>1,key=>key==='task'?task:'active',selected)[0].threadKeys;
  render(a,'active');render(b,'active');task='idle';
  assert.deepEqual(render(a,'task'),['task','active']);
  assert.deepEqual(render(b,'active'),['active','task']);
  task='approval';assert.deepEqual(render(a,'task'),['task','active']);
  assert.equal(a.stats.deferredReadKey,null);
  task='idle';assert.deepEqual(render(a,'task'),['active','task']);
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
