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
  let footer=null,game=null,pending=null,disposed=false,queued=false,lastRoute=new URL(location.href).searchParams.get('initialRoute')??'/';
  const buttons=new Map(),observers=[];
  const style=document.createElement('style');style.dataset.codexPlusStyle='';style.textContent=`
    [data-codex-plus-entry]{display:grid;place-items:center;position:relative;width:36px;height:36px;min-width:28px;flex-shrink:0;border:0;border-radius:10px;background:transparent;color:var(--color-text-secondary,currentColor);cursor:pointer;padding:8px}
    [data-codex-plus-entry]:hover{background:var(--color-background-hover,#8882);color:var(--color-text-primary,currentColor)}
    [data-codex-plus-entry]:focus-visible{outline:2px solid #36a889;outline-offset:2px}[data-codex-plus-entry] svg{width:20px;height:20px}
    [data-codex-plus-entry] span{position:absolute;clip-path:inset(50%);width:1px;height:1px;overflow:hidden;white-space:nowrap}
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
  const icons={settings:'<path d="m9.5 3-.8 2.1-2.1.8-2-.9-1.7 3 1.6 1.5-.3 2.3L2.5 13l1.7 3 2.1-.4 1.8 1.4.3 2.2h3.5l.8-2.1 2.1-.8 2 .9 1.7-3-1.6-1.5.3-2.3 1.7-1.2-1.7-3-2.1.4-1.8-1.4L13 3Z"/><circle cx="10.5" cy="11" r="3"/>',snake:'<path d="M5 4h9a4 4 0 0 1 0 8H7a4 4 0 0 0 0 8h10M5 4v4m3-4v2"/><circle cx="17" cy="20" r="1"/>'};
  for(const [id,label,action] of [['settings','Codex Plus',settings],['snake','贪吃蛇',()=>{if(game){game.focus();return;}game=openGame(createGame,()=>{game=null;});}]]){
    const b=document.createElement('button');b.type='button';b.dataset.codexPlusEntry=id;b.title=label;b.setAttribute('aria-label',label);
    // Icons are fixed product markup, never host or message content.
    b.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[id]}</svg>`;
    const span=document.createElement('span');span.textContent=label;b.append(span);b.addEventListener('click',action);buttons.set(id,b);
  }
  function mount(){
    queued=false;if(disposed)return;
    const rails=[...document.querySelectorAll('nav[data-app-navigation-rail="true"]')];
    if(rails.length!==1){state.phase='sidebar-unavailable';return;}
    const rail=rails[0],candidate=rail.lastElementChild?.firstElementChild;
    if(!candidate||!candidate.classList.contains('flex-col')||!candidate.querySelector('button[aria-haspopup="menu"]')){state.phase='footer-unavailable';return;}
    if(footer!==candidate){footer=candidate;observe();}
    const first=buttons.get('settings'),last=buttons.get('snake');
    if(footer.firstElementChild!==first)footer.prepend(first);
    if(footer.lastElementChild!==last)footer.append(last);
    if(!style.isConnected)(document.head??document.documentElement).append(style);
    state.phase='active';
    const route=new URL(location.href).searchParams.get('initialRoute')??'/';if(route!==lastRoute){lastRoute=route;game?.dispose();}
  }
  function schedule(){if(!queued&&!disposed){queued=true;queueMicrotask(mount);}}
  function observe(){for(const o of observers)o.disconnect();observers.length=0;
    const watch=(target,config)=>{const o=new MutationObserver(schedule);o.observe(target,config);observers.push(o);};
    if(footer){watch(footer,{childList:true,subtree:true});watch(footer.parentElement,{childList:true});watch(footer.parentElement.parentElement,{childList:true});watch(footer.parentElement.parentElement.parentElement,{childList:true});}
    else watch(document.documentElement??document,{childList:true,subtree:true});
  }
  function dispose(){if(disposed)return;disposed=true;for(const o of observers)o.disconnect();game?.dispose();for(const b of buttons.values())b.remove();style.remove();notice?.remove();clearTimeout(noticeTimer);if(pending)clearTimeout(pending.timer);pending=null;window.removeEventListener('popstate',schedule);window.removeEventListener('codex-plus-route',schedule);if(globalThis.__codexPlusFeatures===api)delete globalThis.__codexPlusFeatures;}
  function routeChanged(next){lastRoute=next?next.pathname+next.search+next.hash:new URL(location.href).searchParams.get('initialRoute')??'/';game?.dispose();schedule();}
  const api={protocol:1,connection:options.connection,ack:complete,routeChanged,dispose,status:()=>({...state,pending:!!pending,entries:[...buttons.values()].filter(b=>b.isConnected).map(b=>b.dataset.codexPlusEntry),game:game?.status()??null})};
  globalThis.__codexPlusFeatures=api;window.addEventListener('popstate',schedule);window.addEventListener('codex-plus-route',schedule);observe();mount();return api.status();
}
