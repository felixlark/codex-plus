import {createHash} from 'node:crypto';

export const reviewedSuggestionResource=Object.freeze({
  path:'webview/assets/async/864380.74f4445879.js',
  sha256:'63ad0177e7b2d888cbf80db7ed6167c73f0012a652fc6ecd10f34052a1e87ff0',
});

export function adaptSuggestions(source) {
  if(createHash('sha256').update(source).digest('hex')!==reviewedSuggestionResource.sha256)return {supported:false,reason:'unreviewed-suggestion-source'};
  source=source.toString();
  const widget='i.dataset.cumberbatch="",i.inert=!0',reuse='if(r.text===o?.prediction.text)return{...o,prediction:r};';
  if(source.split(widget).length!==2||source.split(reuse).length!==2)return {supported:false,reason:'suggestion-structure'};
  const metadata='i.dataset.cumberbatch="",!("kind"in l)&&l.sourceTurnId&&(()=>{const s=e.get(f.ww);if(s?.latestTurnId===l.sourceTurnId)i.dataset.codexPlusSuggestion=JSON.stringify({protocol:1,hostId:s.hostId,threadId:s.threadId,sourceTurnId:l.sourceTurnId,expected:n.textContent});})(),i.inert=!0';
  source=source.replace(widget,metadata).replace(reuse,'if(r.text===o?.prediction.text&&r.sourceTurnId===o?.prediction.sourceTurnId&&("kind"in r)===("kind"in o.prediction))return{...o,prediction:r};');
  return {supported:true,source:'globalThis.__codexPlusSuggestionHost=1;'+source};
}

// The renderer exposes observations and synchronous guarded actions. Only the
// connected controller schedules actions; losing it leaves any accepted draft.
export function installSuggestionReader() {
  if(globalThis.__codexPlusSuggestions?.protocol===1)return;
  let revision=0,pending=null,composing=false;
  const events=['keydown','pointerdown','beforeinput','compositionstart','compositionend','focusout'];
  const changed=e=>{if(e.type==='compositionstart')composing=true;if(e.type==='compositionend')composing=false;if(e.isTrusted)revision++;};
  for(const event of events)document.addEventListener(event,changed,true);
  const blurred=()=>{revision++;};window.addEventListener('blur',blurred);
  function route(){return new URL(location.href).searchParams.get('initialRoute')??'/';}
  function visible(e){return !!e&&e.isConnected&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';}
  function blocked(root){return [...document.querySelectorAll('dialog[open],[role="dialog"],[role="alertdialog"]')].some(visible)||!!root.querySelector('[data-attachment-id],[data-composer-attachments-row] > *,[data-composer-takeover]');}
  function editorText(editor){return editor.pmViewDesc?.node?.textContent??editor.textContent;}
  function sendButton(root){const buttons=[...root.querySelectorAll('button[aria-label="Send"],button[aria-label="发送"]')].filter(visible);return buttons.length===1&&!buttons[0].disabled?buttons[0]:null;}
  function context(editor,meta){
    const current=route(),match=current.match(/^\/(local|remote)\/([^/?#]+)(?:[?#].*)?$/);
    const root=editor.closest('[data-codex-composer-root]');
    if(!match||match[2]!==meta.threadId||!root||root.querySelectorAll('[data-codex-composer="true"]').length!==1)return null;
    return {root,route:current};
  }
  function eligible(editor,root){return !composing&&document.visibilityState==='visible'&&document.hasFocus()&&visible(editor)&&editor.contentEditable==='true'&&!blocked(root)&&(document.activeElement===editor||document.activeElement===document.body);}
  function inspect(){
    const base={supported:globalThis.__codexPlusSuggestionHost===1,route:route(),revision,focused:document.hasFocus()&&document.visibilityState==='visible'};
    if(!base.supported)return {...base,reason:'page-reload-required'};
    if(pending){const {editor,meta,root}=pending;return {...base,pending:true,key:pending.key,valid:pending.revision===revision&&pending.route===base.route&&eligible(editor,root)&&editorText(editor)===meta.expected&&!editor.querySelector('[data-cumberbatch]'),ready:!!sendButton(root),empty:editorText(editor)==='',working:[...root.querySelectorAll('button[aria-label="Stop"],button[aria-label="停止"]')].some(visible)};}
    const widgets=[...document.querySelectorAll('[data-cumberbatch][data-codex-plus-suggestion]')].filter(visible);
    const candidates=[];
    for(const widget of widgets){try{
      const meta=JSON.parse(widget.dataset.codexPlusSuggestion),editor=widget.closest('[data-codex-composer="true"]');
      if(meta.protocol!==1||typeof meta.expected!=='string'||!meta.expected.trim()||typeof meta.hostId!=='string'||typeof meta.threadId!=='string'||typeof meta.sourceTurnId!=='string'||!editor)continue;
      const ctx=context(editor,meta);if(!ctx)continue;
      const key=JSON.stringify([meta.hostId,meta.threadId,meta.sourceTurnId]);
      // A prediction is a decoration, so its visible text is outside the doc.
      const empty=editor.pmViewDesc?.node?editor.pmViewDesc.node.textContent==='':editor.cloneNode(true);
      let blank=empty===true;if(empty instanceof Node){empty.querySelectorAll('[data-cumberbatch]').forEach(e=>e.remove());blank=empty.textContent.trim()==='';}
      candidates.push({key,revision,route:ctx.route,eligible:blank&&eligible(editor,ctx.root),meta,editor,root:ctx.root,widget});
    }catch{}}
    if(candidates.length!==1)return {...base,reason:candidates.length?'ambiguous-composer':'no-suggestion'};
    const c=candidates[0];return {...base,key:c.key,eligible:c.eligible,reason:c.eligible?'ready':'inactive-or-user-content'};
  }
  function accept(expected){
    const snapshot=inspect();if(!snapshot.eligible||snapshot.key!==expected.key||snapshot.route!==expected.route||snapshot.revision!==expected.revision)return {ok:false,reason:'changed-before-accept'};
    const widget=[...document.querySelectorAll('[data-codex-plus-suggestion]')].find(e=>{try{const m=JSON.parse(e.dataset.codexPlusSuggestion);return JSON.stringify([m.hostId,m.threadId,m.sourceTurnId])===expected.key&&visible(e);}catch{return false;}});
    if(!widget)return {ok:false,reason:'suggestion-gone'};
    const editor=widget.closest('[data-codex-composer="true"]'),meta=JSON.parse(widget.dataset.codexPlusSuggestion),ctx=context(editor,meta);
    editor.focus({preventScroll:true});
    pending={editor,meta,root:ctx.root,key:expected.key,route:ctx.route,revision};
    editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',code:'Tab',keyCode:9,which:9,bubbles:true,cancelable:true}));
    editor.dispatchEvent(new KeyboardEvent('keyup',{key:'Tab',code:'Tab',keyCode:9,which:9,bubbles:true}));
    return {ok:true,revision};
  }
  function submit(key){const snapshot=inspect();if(!pending||pending.key!==key||!snapshot.valid||!snapshot.ready)return {ok:false,reason:'changed-before-send'};const button=sendButton(pending.root);button.click();return {ok:true};}
  function cancel(){pending=null;}
  function dispose(){cancel();for(const event of events)document.removeEventListener(event,changed,true);window.removeEventListener('blur',blurred);delete globalThis.__codexPlusSuggestions;}
  globalThis.__codexPlusSuggestions={protocol:1,inspect,accept,submit,cancel,dispose};
}

export class SuggestionCoordinator {
  constructor({attempts=[],persist}){this.attempts=new Set(attempts);this.persist=persist;this.enabled=false;this.revision=0;this.baselines=new Set();this.pending=null;this.cancellations=[];this.counts={attempted:0,accepted:0,submitted:0,unknown:0};this.reason='disabled';}
  configure(enabled){if(this.enabled===enabled)return;this.enabled=enabled;this.revision++;this.baselines.clear();if(this.pending)this.cancellations.push(this.pending.id);this.pending=null;this.reason=enabled?'waiting-for-new-suggestion':'disabled';}
  async tick(pages,act){
    const revision=this.revision;
    for(const id of this.cancellations.splice(0))await act(id,'cancel').catch(()=>{});
    if(!this.enabled)return;
    if(this.pending){
      const p=this.pending,page=pages.find(p=>p.id===this.pending.id),s=page?.snapshot;
      // Native submission can move focus and clear/recreate the editor. Once
      // sent, observe the result without scheduling another action.
      if(p.sent){if(s&&s.key===p.key&&s.route===p.route&&(s.empty||s.working)){this.counts.submitted++;this.reason='submitted';}else{this.counts.unknown++;this.reason='submission-unconfirmed';}this.pending=null;await act(p.id,'cancel');return;}
      if(!s||s.key!==p.key||s.route!==p.route||!s.focused||s.revision!==p.inputRevision||!s.valid){this.pending=null;await act(p.id,'cancel');this.reason='cancelled';return;}
      if(!s.ready){this.pending=null;await act(p.id,'cancel');this.reason='send-unavailable';return;}
      if(!this.enabled||revision!==this.revision)return;
      // Clear before awaiting so a failed command is never retried.
      this.pending=null;
      let result;try{result=await act(p.id,'submit',p.key);}catch{this.counts.unknown++;this.reason='submission-unconfirmed';return;}
      if(result?.ok&&this.enabled&&revision===this.revision)this.pending={...p,sent:true};
      else this.reason=result?.reason??'cancelled';
      return;
    }
    for(const page of pages){const s=page.snapshot;
      if(!this.baselines.has(page.id)){this.baselines.add(page.id);if(s.key)this.attempts.add(s.key);continue;}
      if(!s.supported||!s.eligible||!s.key||this.attempts.has(s.key))continue;
      this.attempts.add(s.key);
      try{await this.persist([...this.attempts]);}catch{this.enabled=false;this.revision++;this.reason='attempt-storage-unavailable';return;}
      if(!this.enabled||this.revision!==revision)return;
      this.counts.attempted++;
      let result;try{result=await act(page.id,'accept',{key:s.key,route:s.route,revision:s.revision});}catch{this.reason='accept-unconfirmed';return;}
      if(result?.ok&&this.enabled&&revision===this.revision){this.counts.accepted++;this.pending={id:page.id,key:s.key,route:s.route,inputRevision:result.revision??s.revision,sent:false};this.reason='accepted';}else this.reason=result?.reason??'cancelled';
      return;
    }
  }
  status(){return {enabled:this.enabled,phase:this.pending?'pending':this.enabled?'watching':'disabled',...this.counts,reason:this.reason};}
}
