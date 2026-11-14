export const reviewedHumanRuntime=Object.freeze({path:'webview/assets/348410.374a9b8f98.js',sha256:'0524ee891262587e2605b573f75ebb1cce4df2b3db154a8f14a2f24a9e80dc0b'});

// The entry is already loaded by the host. ESM import returns its cached runtime,
// so existing windows gain native-state access without a reload or source patch.
export async function nativeWindowDefaults(operation,bounds) {
  const {__webpack_require__:require}=await import('app://-/assets/348410.374a9b8f98.js');
  const service=require('GaA7').appServices.applicationState,call=require('q77y').P;
  const key='electron-main-window-bounds';
  if(operation==='read') {
    const result=await call(service.read(key));
    return {present:Object.hasOwn(result,'value')&&result.value!==undefined,value:result.value??null};
  }
  if(operation!=='write'||!bounds||!['x','y','width','height'].every(k=>Number.isFinite(bounds[k]))||bounds.width<=0||bounds.height<=0)throw Error('Invalid human window bounds');
  const written=await call(service.write(key,{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height,isMaximized:false}));
  const after=await call(service.read(key));
  return {phase:written.success&&['x','y','width','height'].every(k=>after.value?.[k]===bounds[k])&&after.value?.isMaximized===false?'ready':'failed'};
}

export async function preserveNativeBounds(file,current,io) {
  try { await io.writeFile(file,JSON.stringify(current),{flag:'wx',mode:0o600}); }
  catch(error) { if(error.code!=='EEXIST')throw error; }
  const saved=JSON.parse(await io.readFile(file,'utf8'));
  if(typeof saved?.present!=='boolean'||!Object.hasOwn(saved,'value'))throw Error('Invalid native bounds backup');
  return saved;
}

export function preferredHumanNumbers(pages,frames) {
  const preferred={};
  for(const frame of frames) {
    if(![1,2].includes(frame.number))continue;
    const matches=pages.filter(page=>page.frame&&['x','y','width','height'].every(k=>Number.isFinite(frame[k])&&Math.abs(frame[k]-page.frame[k])<3));
    if(matches.length===1)preferred[matches[0].target]=frame.number;
  }
  return preferred;
}
