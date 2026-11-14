export const featureProtocol=1;
export const reviewedFeatureResource=Object.freeze({
  path:'webview/assets/async/720223.d11ecd5c98.js',
  sha256:'a3fc97c5c07d47cc198605bb2a7f8535e3c31a252aa175249414a9d64a4fa671'
});

// Visible cleanup must start before unrelated requests can consume shutdown's
// existing response budget. A stale main-frame flag must not leave our UI behind.
export async function removeFeatureEntries(sessions, command) {
  await Promise.allSettled([...sessions].map(async([id,session])=>{
    const removeScript=session.script
      ? command(id,'Page.removeScriptToEvaluateOnNewDocument',{identifier:session.script}).catch(()=>{})
      : Promise.resolve();
    const removeUI=command(id,'Runtime.evaluate',{expression:'globalThis.__codexPlusFeatures?.dispose()'}).catch(()=>{});
    await Promise.allSettled([removeScript,removeUI]);
    await command(id,'Runtime.removeBinding',{name:featureBinding}).catch(()=>{});
  }));
}
export const featureBinding='__codexPlusNative';

export function validateNativeAction(message) {
  return message?.version===1&&message.action==='open-settings'&&typeof message.requestId==='string'&&/^[a-zA-Z0-9-]+$/.test(message.requestId)&&Object.keys(message).sort().join(',')==='action,requestId,version';
}

export function installFeatureEntry(options, createGame, openGame) {
  const old=globalThis.__codexPlusFeatures;
  if(old?.connection===options.connection&&old?.protocol===1)return old.status();
  old?.dispose();
  const state={phase:'waiting-for-sidebar',connection:options.connection};
  let footer=null,toolGroup=null,game=null,pending=null,disposed=false,queued=false,lastRoute=new URL(location.href).searchParams.get('initialRoute')??'/';
  const buttons=new Map(),observers=[];
  const style=document.createElement('style');style.dataset.codexPlusStyle='';style.textContent=`
    [data-codex-plus-entry] svg{pointer-events:none}
    #codex-plus-notice{position:fixed;bottom:20px;left:68px;max-width:340px;padding:12px 16px;border-radius:12px;background:var(--color-surface,#fff);color:var(--color-text-primary,#222);border:1px solid #8885;box-shadow:0 6px 28px #0002;z-index:2147483647;font:13px system-ui}
  `;
  let notice=null,noticeTimer=null;
  function notify(message){notice?.remove();clearTimeout(noticeTimer);notice=document.createElement('div');notice.id='codex-plus-notice';notice.setAttribute('role','status');notice.textContent=message;document.body.append(notice);noticeTimer=setTimeout(()=>{notice?.remove();notice=null;},5000);}
  function complete(requestId,ok){if(pending?.id!==requestId)return;clearTimeout(pending.timer);pending=null;buttons.get('settings')?.removeAttribute('aria-busy');if(!ok)notify('Codex Plus 连接暂不可用，请从菜单栏打开设置。');}
  function settings(){
    if(pending)return;
    const id=crypto.randomUUID();pending={id,timer:setTimeout(()=>complete(id,false),5000)};
    buttons.get('settings')?.setAttribute('aria-busy','true');
    try{globalThis[options.binding](JSON.stringify({version:1,action:'open-settings',requestId:id}));}catch{complete(id,false);}
  }
  const ring='<circle cx="10" cy="10" r="7.25"/>';
  const icons={settings:`<circle cx="10" cy="10" r="9.25"/><path d="M10 6.75v6.5M6.75 10h6.5"/>`,snake:`${ring}<path d="M7 6.5h4.5c2.3 0 2.3 3.5 0 3.5h-3c-2.3 0-2.3 3.5 0 3.5H13"/>`};
  for(const [id,label,action] of [['settings','Codex Plus',settings],['snake','贪吃蛇',()=>{if(game){game.focus();return;}game=openGame(createGame,()=>{game=null;});}]]){
    const b=document.createElement('button');b.type='button';b.dataset.codexPlusEntry=id;b.title=label;b.setAttribute('aria-label',label);
    // Icons are fixed product markup, never host or message content.
    const inner=document.createElement('span');
    inner.innerHTML=`<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${icons[id]}</svg>`;
    const span=document.createElement('span');span.className='sr-only';span.textContent=label;inner.append(span);b.append(inner);b.addEventListener('click',action);buttons.set(id,b);
  }
  function applyPresentation(button,template){
    button.className=template.className.replace(/\btouch-none\b/g,'').trim();
    for(const name of ['data-color','data-variant','data-squircle','data-uniform','data-size','data-icon-size']){
      const value=template.getAttribute(name);if(value!==null)button.setAttribute(name,value);
    }
    button.firstElementChild.className=template.firstElementChild.className;
    button.querySelector('svg').setAttribute('class',template.querySelector('svg')?.getAttribute('class')??'');
  }
  function mount(){
    queued=false;if(disposed)return;
    const rails=[...document.querySelectorAll('nav[data-app-navigation-rail="true"]')];
    if(rails.length!==1){state.phase='sidebar-unavailable';return;}
    const rail=rails[0],candidate=rail.lastElementChild?.firstElementChild;
    if(!candidate||!candidate.classList.contains('flex-col')||!candidate.querySelector('button[aria-haspopup="menu"]')){state.phase='footer-unavailable';return;}
    const projects=rail.querySelector('button[data-sidebar-destination="builtin:projects"]');
    if(!projects?.firstElementChild||!projects.querySelector('svg')){state.phase='projects-unavailable';return;}
    if(footer!==candidate||toolGroup!==projects.parentElement){footer=candidate;toolGroup=projects.parentElement;observe();}
    const first=buttons.get('settings'),snake=buttons.get('snake');
    const avatar=footer.querySelector('button[aria-haspopup="menu"] img');
    const footerTemplate=avatar?.closest('button')??footer.querySelector('button[aria-haspopup="menu"]');
    applyPresentation(first,footerTemplate);applyPresentation(snake,projects);
    // Footer avatars/usage circles have a larger visual footprint than the
    // navigation glyphs. Opt out of the host's automatic 20px SVG sizing.
    const diameter=avatar?.getBoundingClientRect().width||24;
    const svg=first.querySelector('svg');svg.setAttribute('data-no-autosize','true');
    svg.setAttribute('width',String(diameter));svg.setAttribute('height',String(diameter));
    svg.style.width=`${diameter}px`;svg.style.height=`${diameter}px`;
    svg.setAttribute('stroke-width','1.5');
    if(footer.firstElementChild!==first)footer.prepend(first);
    if(projects.nextElementSibling!==snake)projects.after(snake);
    if(!style.isConnected)(document.head??document.documentElement).append(style);
    state.phase='active';
    const route=new URL(location.href).searchParams.get('initialRoute')??'/';if(route!==lastRoute){lastRoute=route;game?.dispose();}
  }
  function schedule(){if(!queued&&!disposed){queued=true;queueMicrotask(mount);}}
  function observe(){for(const o of observers)o.disconnect();observers.length=0;
    const watch=(target,config)=>{const o=new MutationObserver(schedule);o.observe(target,config);observers.push(o);};
    if(footer){watch(footer,{childList:true,subtree:true});watch(toolGroup,{childList:true});watch(footer.parentElement,{childList:true});watch(footer.parentElement.parentElement,{childList:true});watch(footer.parentElement.parentElement.parentElement,{childList:true});}
    else watch(document.documentElement??document,{childList:true,subtree:true});
  }
  function dispose(){if(disposed)return;disposed=true;for(const o of observers)o.disconnect();game?.dispose();for(const b of buttons.values())b.remove();style.remove();notice?.remove();clearTimeout(noticeTimer);if(pending)clearTimeout(pending.timer);pending=null;window.removeEventListener('popstate',schedule);window.removeEventListener('codex-plus-route',schedule);if(globalThis.__codexPlusFeatures===api)delete globalThis.__codexPlusFeatures;}
  function routeChanged(next){lastRoute=next?next.pathname+next.search+next.hash:new URL(location.href).searchParams.get('initialRoute')??'/';game?.dispose();schedule();}
  const api={protocol:1,connection:options.connection,ack:complete,routeChanged,dispose,status:()=>({...state,pending:!!pending,entries:[...buttons.values()].filter(b=>b.isConnected).map(b=>b.dataset.codexPlusEntry),game:game?.status()??null})};
  globalThis.__codexPlusFeatures=api;window.addEventListener('popstate',schedule);window.addEventListener('codex-plus-route',schedule);observe();mount();return api.status();
}
