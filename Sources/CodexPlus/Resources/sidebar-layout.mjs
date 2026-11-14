import {createHash} from 'node:crypto';

export const sidebarBinding='__codexPlusSidebarChanged';
export const sidebarProtocol=1;
const resourceSHA256='eba5577e16a50a8106a64a05025fa23d0a589d8b4f775a6fe065ba7d916e6b1c';

// Only identifiers and expansion values cross this boundary; never UI text.
export function sanitizeSidebarValues(input) {
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  const output={};
  for(const [key,value] of Object.entries(input)){
    if(key==='builtin'){
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['chats','cloud','pinned','threads'].includes(k)||typeof value[k]!=='boolean'))return null;
      output[key]={...value};
    }else if(key==='list'||key.startsWith('custom:')){
      if(typeof value!=='boolean')return null;
      if(key.startsWith('custom:')){try{const pair=JSON.parse(key.slice(7));if(!Array.isArray(pair)||pair.length!==2||pair.some(v=>typeof v!=='string'))return null;}catch{return null;}}
      output[key]=value;
    }else if(key.startsWith('project:sidebar-project-expanded-v1-')){
      if(value!==null&&typeof value!=='boolean')return null;output[key]=value;
    }else return null;
  }
  return output;
}

export function resolveSidebarDisplay(frame,displays) {
  if(!frame||!['x','y','width','height'].every(k=>Number.isFinite(frame[k]))||frame.width<=0||frame.height<=0)return null;
  const x=frame.x+frame.width/2,y=frame.y+frame.height/2;
  const matches=displays.filter(d=>d&&[d.x,d.y,d.width,d.height].every(Number.isFinite)&&d.width>0&&d.height>0&&x>=d.x&&x<d.x+d.width&&y>=d.y&&y<d.y+d.height);
  const d=matches.length===1?matches[0]:null;
  return d&&typeof d.uuid==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(d.uuid)&&displays.filter(v=>v.uuid===d.uuid).length===1?d:null;
}

// Serialized into RFDv, using the host's own scoped atom implementation.
export function createSidebarLayout(options) {
  const validate=options.validate;
  const storage=options.storage??(()=>{try{return globalThis.sessionStorage}catch{return null}})();
  const key='codex-plus.sidebar-window.v1';
  const pageId=options.pageId??globalThis.crypto.randomUUID();
  let saved;try{const v=JSON.parse(storage?.getItem(key)??'null');if(v?.version===1&&validate(v.values))saved=v;}catch{}
  let values=saved?.values??{},displayKey=saved?.displayKey??null,windowId=saved?.windowId??null,sequence=0,store=null,configured=false,storageReady=true,enabled=true;
  const defaults={},entries=new Map(),definitions=new Map();
  const customAtom=options.makeAtom(()=>({}));
  function initial(k,fallback){if(!Object.hasOwn(defaults,k))defaults[k]=fallback;return Object.hasOwn(values,k)?values[k]:defaults[k];}
  function remember(){try{storage?.setItem(key,JSON.stringify({version:1,windowId,displayKey,values}));if(!storage)storageReady=false;}catch{storageReady=false;}}
  function atom(k,fallback){const a=options.makeAtom(()=>initial(k,options.readDefault(k,fallback)));entries.set(k,{atom:a});definitions.set(a,()=>k);return a;}
  function family(keyFor,fallback){
    const a=options.makeFamily(param=>{const k='project:'+keyFor(param);entries.set(k,{atom:a,param});return initial(k,options.readDefault(k,fallback));});
    definitions.set(a,param=>'project:'+keyFor(param));return a;
  }
  function write(s,a,value,param){
    store=s;const k=definitions.get(a)(param);
    if(arguments.length===4)s.get(a,param);else s.get(a);
    if(arguments.length===4)s.set(a,param,value);else s.set(a,value);
    changed(k,value);
  }
  function changed(k,value){
    if(!validate({[k]:value}))return;
    const previous=Object.hasOwn(values,k)?values[k]:defaults[k];
    if(JSON.stringify(previous)===JSON.stringify(value))return;
    values={...values,[k]:value};remember();
    if(!configured||!enabled)return;
    const delta=k==='builtin'?Object.fromEntries(Object.entries(value).filter(([field,v])=>previous?.[field]!==v)):value;
    const message={version:1,pageId,sequence:++sequence,change:{key:k,value:delta}};
    try{(options.notify??(message=>globalThis.__codexPlusSidebarChanged?.(JSON.stringify(message))))(message);}catch{}
  }
  function custom(state,get,account){
    const overrides=get(customAtom),collapsedSectionIds=[];
    for(const section of state.sections){
      const k='custom:'+JSON.stringify([account??'accountless',section.id]);
      const base=initial(k,state.collapsedSectionIds.includes(section.id));
      if(Object.hasOwn(overrides,k)?overrides[k]:base)collapsedSectionIds.push(section.id);
    }
    return {...state,collapsedSectionIds};
  }
  function collapse(s,account,id,value){
    store=s;const k='custom:'+JSON.stringify([account??'accountless',id]);
    s.set(customAtom,{...s.get(customAtom),[k]:value});changed(k,value);
  }
  function bind(s){store=s;}
  function snapshot(){return {protocol:1,pageId,bound:!!store,configured,displayKey,windowId,storageReady,enabled,values:{...defaults,...values}};}
  function configure(config){
    if(config.pageId!==pageId||!store)return null;
    enabled=true;
    const newWindow=windowId!==null&&windowId!==config.windowId;
    const moved=displayKey!==config.displayKey;
    const apply=newWindow||moved||!configured;
    if(newWindow||moved||!configured&&!saved){
      const profile=validate(config.profile);
      if(profile)values=profile;
      else if(newWindow)values={};
      // No known destination profile: carry this window's layout forward.
    }
    windowId=config.windowId;displayKey=config.displayKey;
    if(config.change&&validate({[config.change.key]:config.change.value})){const {key:k,value}=config.change;values={...values,[k]:k==='builtin'?{...(values[k]??defaults[k]),...value}:value};}
    if(!apply&&!config.change)return snapshot();
    for(const [k,e]of entries){if(Object.hasOwn(e,'param'))store.get(e.atom,e.param);else store.get(e.atom);const value=Object.hasOwn(values,k)?values[k]:defaults[k];if(Object.hasOwn(e,'param'))store.set(e.atom,e.param,value);else store.set(e.atom,value);}
    store.set(customAtom,Object.fromEntries(Object.entries(values).filter(([k])=>k.startsWith('custom:'))));
    configured=true;remember();return snapshot();
  }
  function suspend(){enabled=false;}
  return {protocol:1,atom,family,set:write,custom,collapse,bind,configure,snapshot,suspend};
}

export function adaptSidebarLayout(original,adapted=original.toString()) {
  if(createHash('sha256').update(original).digest('hex')!==resourceSHA256)return {supported:false,reason:'unreviewed-sidebar-source'};
  const edits=[
    ['let g={chats:!1,cloud:!1,pinned:!1,threads:!1}',`const __cpSidebar=globalThis.__codexPlusSidebarLayout??=(${createSidebarLayout.toString()})({validate:(${sanitizeSidebarValues.toString()}),makeAtom:initialize=>{const scoped=(0,r.T1)(u.u,()=>n("ouEa").eU(initialize()));return {cache:"signal",scope:u.u,resolve:(node,chain)=>scoped.resolve(node,chain,void 0)}},makeFamily:fn=>(0,r.bD)(u.u,fn),readDefault:(key,fallback)=>(0,n("kpIY").TB)(key==='builtin'?'sidebar-collapsed-sections-v1':key==='list'?'sidebar-project-list-expanded-v1':key.slice(8),fallback)});let g={chats:!1,cloud:!1,pinned:!1,threads:!1}`],
    ['T=(0,_.Kn)(e=>{let t=e.startsWith("codex:")','T=__cpSidebar.family(e=>{let t=e.startsWith("codex:")'],
    ['C=(0,_.m3)("sidebar-project-list-expanded-v1",!1),A=(0,_.m3)("sidebar-collapsed-sections-v1",g)','C=__cpSidebar.atom("list",!1),A=__cpSidebar.atom("builtin",g)'],
    ['function z(e,t,n){e.set(A,{...e.get(R),[t]:n})}','function z(e,t,n){__cpSidebar.set(e,A,{...e.get(R),[t]:n})}'],
    ['function X(e,t,n){e.set(T,t,n)}','function X(e,t,n){__cpSidebar.set(e,T,n,t)}'],
    ['X2:function(e,t){e.set(C,t)}','X2:function(e,t){__cpSidebar.set(e,C,t)}'],
    ['Y=(0,s.un)(g.u,({get:e})=>e(I.DW)?e(W):M)','Y=(0,s.un)(g.u,({get:e})=>globalThis.__codexPlusSidebarLayout.custom(e(I.DW)?e(W):M,e,e(I.Ak)))'],
    ['function nz(e,t,i,A){','function nz(e,t,i,A){globalThis.__codexPlusSidebarLayout?.bind(e);'],
  ];
  for(const [needle,replacement]of edits){if(adapted.split(needle).length!==2)return {supported:false,reason:'sidebar-structure:'+needle.slice(0,35)};adapted=adapted.replace(needle,replacement);}
  // Replace the complete shared collapse setter, preserving all other exports.
  const start=adapted.indexOf('iL:function(e,t,n){let i=f.appServices?.savedCustomSections');
  const end=adapted.indexOf(',pp:z,qF:',start);
  if(start<0||end<start||adapted.indexOf('iL:function(e,t,n){let i=f.appServices?.savedCustomSections',start+1)!==-1)return {supported:false,reason:'custom-collapse-structure'};
  adapted=adapted.slice(0,start)+'iL:function(e,t,n){globalThis.__codexPlusSidebarLayout.collapse(e,e.get(I.Ak),t,n)}'+adapted.slice(end);
  return {supported:true,source:adapted};
}

export function needsSidebarReconnect(background,sidebar,required=true){return background?.protocol!==5||!(background.registered>0)||required&&(sidebar?.protocol!==1||sidebar.bound!==true);}

export class SidebarProfiles {
  constructor(file,fs){this.file=file;this.fs=fs;this.profiles={};this.storageReady=true;this.writes=Promise.resolve();}
  async load(){try{const v=JSON.parse(await this.fs.readFile(this.file,'utf8'));if(v?.version!==1||!v.profiles||Array.isArray(v.profiles))throw Error('invalid');for(const [k,p]of Object.entries(v.profiles)){if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(k)||!sanitizeSidebarValues(p?.values))throw Error('invalid');}this.profiles=v.profiles;}catch(e){if(e.code!=='ENOENT')this.storageReady=false;}}
  get(key){return this.profiles[key]?.values??null;}
  save(key,values){
    const clean=sanitizeSidebarValues(values);if(!key||!clean)return this.writes;
    this.profiles={...this.profiles,[key]:{values:clean}};
    if(!this.storageReady)return this.writes;
    const data=JSON.stringify({version:1,profiles:this.profiles});
    this.writes=this.writes.then(async()=>{if(!this.storageReady)return;try{await this.fs.writeFile(this.file+'.tmp',data,{mode:0o600});await this.fs.rename(this.file+'.tmp',this.file);}catch{this.storageReady=false;}});
    return this.writes;
  }
}
