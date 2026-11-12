export const featureProtocol=1;
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
  const icons={settings:'<rect x="2.5" y="3.5" width="15" height="13" rx="3"/><path d="M7 3.5v13m5.25-8.75v5.5m-2.75-2.75H15"/>',snake:'<path d="M4 3.5h8.5a3 3 0 0 1 0 6h-5a3.5 3.5 0 0 0 0 7H16M4 3.5v3m3-3v1.5"/><circle cx="16" cy="16.5" r=".65" fill="currentColor" stroke="none"/>'};
  for(const [id,label,action] of [['settings','Codex Plus',settings],['snake','贪吃蛇',()=>{if(game){game.focus();return;}game=openGame(createGame,()=>{game=null;});}]]){
    const b=document.createElement('button');b.type='button';b.dataset.codexPlusEntry=id;b.title=label;b.setAttribute('aria-label',label);
    // Icons are fixed product markup, never host or message content.
    const inner=document.createElement('span');
    inner.innerHTML=`<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${icons[id]}</svg>`;
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
    applyPresentation(first,projects);applyPresentation(snake,projects);
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
