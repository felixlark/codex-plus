import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSidebarLayout,sanitizeSidebarValues,resolveSidebarDisplay,adaptSidebarLayout,SidebarProfiles,needsSidebarReconnect} from '../Sources/CodexPlus/Resources/sidebar-layout.mjs';
import {openAsar,reviewedHostResource,adaptSidebar,parser,walk} from '../scripts/inspect-sidebar-model.mjs';
import {adaptBackgroundSuggestions} from '../Sources/CodexPlus/Resources/suggestion-auto-send.mjs';

const screenA='11111111-1111-1111-1111-111111111111',screenB='22222222-2222-2222-2222-222222222222';
const custom='custom:'+JSON.stringify(['account','shadow']);
function storage(){const entries=new Map();return {getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v)};}
function page({disk=storage(),id='page',onChange=()=>{}}={}){
  const map=new Map();const s={
    get(a,param){if(a.family){let members=map.get(a);if(!members){members=new Map();map.set(a,members);}if(!members.has(param))members.set(param,a.init(param));return members.get(param);}if(!map.has(a))map.set(a,a.initial());return map.get(a);},
    set(a,x,y){if(a.family){s.get(a,x);map.get(a).set(x,y);}else map.set(a,x);}
  };
  const api=createSidebarLayout({storage:disk,pageId:id,validate:sanitizeSidebarValues,makeAtom:initial=>({initial}),makeFamily:init=>({family:true,init}),readDefault:(_k,f)=>f,notify:onChange});
  const built=api.atom('builtin',{chats:false,cloud:false,pinned:false,threads:false});
  const projects=api.family(p=>'sidebar-project-expanded-v1-'+p,null);
  api.bind(s);
  const config=(displayKey,profile=null,change)=>api.configure({pageId:id,windowId:'window-'+id,displayKey,profile,...change?{change}:{}});
  return {api,s,built,projects,disk,config};
}
test('two windows isolate native section, nested project and custom collapse without shared writes',()=>{
  const a=page(),b=page({id:'b'});a.config(screenA);b.config(screenB);
  a.api.set(a.s,a.built,{...a.s.get(a.built),threads:true});
  a.api.set(a.s,a.projects,false,'codex:project');
  a.api.collapse(a.s,'account','shadow',true);
  const native={sections:[{id:'shadow'}],collapsedSectionIds:[],sectionOrder:['custom:shadow']};
  assert.equal(b.s.get(b.built).threads,false);assert.equal(b.s.get(b.projects,'codex:project'),null);
  assert.deepEqual(a.api.custom(native,a.s.get,'account').collapsedSectionIds,['shadow']);
  assert.deepEqual(b.api.custom(native,b.s.get,'account').collapsedSectionIds,[]);
  assert.deepEqual(a.api.custom(native,a.s.get,'other-account').collapsedSectionIds,[]);
  assert.deepEqual(native.collapsedSectionIds,[]);
});
test('screen profile restores on move, not on another window changing the same screen',()=>{
  const a=page();a.config(screenA);a.api.set(a.s,a.built,{threads:true});
  a.config(screenA,{builtin:{threads:false}});assert.equal(a.s.get(a.built).threads,true);
  a.config(screenB,{builtin:{threads:false},[custom]:true});assert.equal(a.s.get(a.built).threads,false);
  a.config(screenA,{builtin:{threads:true},[custom]:false});assert.equal(a.s.get(a.built).threads,true);
});
test('same target reload preserves its own snapshot, copied opener/new target adopts screen template',()=>{
  const a=page();a.config(screenA);a.api.set(a.s,a.built,{threads:true});
  const reload=page({disk:a.disk});reload.config(screenA,{builtin:{threads:false}});assert.equal(reload.s.get(reload.built).threads,true);
  const child=page({disk:a.disk,id:'child'});child.config(screenA,{builtin:{threads:false}});assert.equal(child.s.get(child.built).threads,false);
  const moved=page({disk:reload.disk});moved.config(screenB,{builtin:{threads:false}});assert.equal(moved.s.get(moved.built).threads,false);
});
test('move concurrent with user collapse rebases only its delta onto destination profile; restore is silent',()=>{
  const changes=[];const a=page({onChange:m=>changes.push(m)});a.config(screenA);a.api.set(a.s,a.built,{threads:true});
  a.config(screenB,{builtin:{threads:false},[custom]:false},{key:custom,value:true});
  assert.equal(a.s.get(a.built).threads,false);assert.equal(a.api.snapshot().values[custom],true);assert.equal(changes.length,1);
  assert.equal(a.api.configure({pageId:'old-document',windowId:'w',displayKey:screenA}),null);
  a.api.suspend();a.api.set(a.s,a.built,{threads:false});assert.equal(changes.length,1);
});
test('unknown/new screen preserves window values and unavailable sessionStorage stays usable',()=>{
  const a=page({disk:{getItem(){throw Error();},setItem(){throw Error();}}});a.config(screenA);a.api.set(a.s,a.built,{threads:true});a.config(null);a.config(screenB);
  assert.equal(a.s.get(a.built).threads,true);assert.equal(a.api.snapshot().storageReady,false);
});
test('display resolution covers negative coordinates, scale-independent rectangles, boundaries and ambiguity',()=>{
  const ds=[{uuid:screenA,x:-342,y:-1266,width:2304,height:1296},{uuid:screenB,x:1962,y:-1122,width:2048,height:1152}];
  assert.equal(resolveSidebarDisplay({x:-342,y:-1266,width:2304,height:1266},ds).uuid,screenA);
  assert.equal(resolveSidebarDisplay({x:1962,y:-1122,width:2048,height:1122},ds).uuid,screenB);
  for(const frame of [null,{x:NaN,y:0,width:10,height:10},{x:0,y:0,width:0,height:10}])assert.equal(resolveSidebarDisplay(frame,ds),null);
  assert.equal(resolveSidebarDisplay({x:0,y:-100,width:10,height:10},[...ds,ds[0]]),null);
});
test('profiles serialize atomic writes and preserve a corrupt or unwritable existing file',async()=>{
  const disk=new Map();const fs={readFile:async p=>{if(!disk.has(p))throw Object.assign(Error(),{code:'ENOENT'});return disk.get(p);},writeFile:async(p,d)=>disk.set(p,d),rename:async(a,b)=>{disk.set(b,disk.get(a));disk.delete(a);}};
  const profiles=new SidebarProfiles('profiles',fs);await profiles.load();await Promise.all([profiles.save(screenA,{builtin:{threads:true}}),profiles.save(screenB,{[custom]:true})]);
  assert.equal(JSON.parse(disk.get('profiles')).profiles[screenA].values.builtin.threads,true);
  const reloaded=new SidebarProfiles('profiles',fs);await reloaded.load();assert.deepEqual(reloaded.get(screenB),{[custom]:true});
  disk.set('profiles','not json');const corrupt=new SidebarProfiles('profiles',fs);await corrupt.load();await corrupt.save(screenA,{list:true});assert.equal(corrupt.storageReady,false);assert.equal(disk.get('profiles'),'not json');
  const failed=new SidebarProfiles('profiles',{...fs,writeFile:async()=>{throw Error();}});await failed.save(screenA,{list:true});assert.equal(failed.storageReady,false);
});
test('only expansion values are admitted, not arbitrary data, commands or unknown versions',()=>{
  for(const value of [{body:'text'},{builtin:{threads:'false'}},{list:null},{'project:x':true},{'custom:broken':true},{[custom]:null}])assert.equal(sanitizeSidebarValues(value),null);
  assert.deepEqual(sanitizeSidebarValues({builtin:{threads:true},list:false,[custom]:true}),{builtin:{threads:true},list:false,[custom]:true});
});
test('protocol5 without sidebar bridge must reload; readiness requires both bridges',()=>{
  const bg={protocol:5,registered:2};assert.equal(needsSidebarReconnect(bg,null,true,8),true);assert.equal(needsSidebarReconnect(bg,{protocol:1,bound:false},true,8),true);assert.equal(needsSidebarReconnect(bg,{protocol:1,bound:true},true,8),false);assert.equal(needsSidebarReconnect(bg,null,false,8),false);
});
test('reconnect upgrades old project ordering even when the other page bridges are ready',()=>{
  const bg={protocol:5,registered:2},sidebar={protocol:1,bound:true};
  assert.equal(needsSidebarReconnect(bg,sidebar,true,6),true);
  assert.equal(needsSidebarReconnect(bg,sidebar,true,undefined),true);
  assert.equal(needsSidebarReconnect(bg,sidebar,true,null),true);
  assert.equal(needsSidebarReconnect(bg,sidebar,true,7),true);
  assert.equal(needsSidebarReconnect(bg,sidebar,true,8),false);
});
test('actual reviewed host composes all three adapters, parses, and removes only shared collapse writers',async t=>{
  let a;try{a=await openAsar('/Applications/ChatGPT.app');}catch(e){if(e.code==='ENOENT'){t.skip();return;}throw e;}
  try{
    const original=await a.read(a.entries.find(e=>e.path===reviewedHostResource.path));
    const project=await adaptSidebar(original,{host:true,resourcePath:reviewedHostResource.path});assert.equal(project.supported,true);
    const background=adaptBackgroundSuggestions(original,project.source);assert.equal(background.supported,true);
    const result=adaptSidebarLayout(original,background.source);assert.equal(result.supported,true,result.reason);
    const ast=(await parser()).parse(result.source,{ecmaVersion:'latest',sourceType:'module'});const modules={};
    walk(ast,p=>{if(p.type==='Property'&&['RFDv','jFzS'].includes(p.key?.name))modules[p.key.name]=result.source.slice(p.start,p.end);});
    assert.ok(modules.RFDv.includes('T=__cpSidebar.family'));assert.ok(modules.RFDv.includes('C=__cpSidebar.atom'));assert.ok(modules.RFDv.includes('A=__cpSidebar.atom'));
    assert.ok(!modules.jFzS.includes('applySavedCustomSectionCommand'));assert.ok(modules.jFzS.includes('collapse(e,e.get(I.Ak),t,n)'));assert.ok(modules.jFzS.includes('custom(e(I.DW)?e(W):M,e,e(I.Ak))'));
    assert.equal(adaptSidebarLayout(original+'\n').supported,false);assert.equal(adaptSidebarLayout(original,result.source).supported,false);
  }finally{await a.close();}
});

test('atom baseline is read lazily after native persistence initializes, including first configure',()=>{
  let initialized=false;const values=new Map();
  const s={get(a){if(!values.has(a))values.set(a,a.init());return values.get(a);},set(a,value){s.get(a);values.set(a,value);}};
  const api=createSidebarLayout({pageId:'lazy',storage:storage(),validate:sanitizeSidebarValues,makeAtom:init=>({init}),makeFamily:init=>({init}),readDefault(_k,fallback){assert.equal(initialized,true);return fallback;}});
  const builtin=api.atom('builtin',{threads:true});assert.equal(values.size,0);
  initialized=true;api.bind(s);api.configure({pageId:'lazy',windowId:'lazy',displayKey:screenA,profile:null});
  assert.deepEqual(s.get(builtin),{threads:true});
});
test('builtin move-and-click delta preserves unrelated destination expansion fields',()=>{
  const messages=[];const a=page({onChange:m=>messages.push(m)});a.config(screenA);
  a.api.set(a.s,a.built,{chats:false,cloud:false,pinned:false,threads:true});
  assert.deepEqual(messages.at(-1).change,{key:'builtin',value:{threads:true}});
  a.config(screenB,{builtin:{chats:true,cloud:false,pinned:true,threads:false}},messages.at(-1).change);
  assert.deepEqual(a.s.get(a.built),{chats:true,cloud:false,pinned:true,threads:true});
});
