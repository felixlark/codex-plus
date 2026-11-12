import {createHash} from 'node:crypto';
export const backgroundGuardBinding='__codexPlusBackgroundGuard';
export const reviewedBackgroundDependency=Object.freeze({path:'webview/assets/async/514766.2d2f1ddc86.js',sha256:'943016fbef25cbfe62703ea7ab5ee7d2e9971b8db3681147fb983e7bd12e6f39'});
export const reviewedBackgroundResource=Object.freeze({path:'webview/assets/async/739301.37a39f26d6.js',sha256:'acc2174e4ed3d2068af26c1731f08e8978c853864aea9c0a917ae9d246885058'});

export function adaptBackgroundSuggestions(original,adapted=original.toString()) {
  if(createHash('sha256').update(original).digest('hex')!==reviewedBackgroundResource.sha256)return {supported:false,reason:'unreviewed-background-source'};
  const register='function nG(e,t,I,C){',cache='e.queryClient.setQueryData((0,t_.pv)(u,d,l),f)';
  if(adapted.split(register).length!==2||adapted.split(cache).length!==2)return {supported:false,reason:'background-structure'};
  const registration='globalThis.__codexPlusBackgroundSuggestions.register(globalThis.__codexPlusBackgroundNative(e,t,I,()=>nH&&(C?.()??!0)&&(0,nr.oI)(),{drafts:n("TSib"),identities:n("V3rO"),composer:n("Sd8U"),wrap:n("GNwQ").GB}));';
  const captured=`(${cache},globalThis.__codexPlusBackgroundSuggestions.capture(t,c,f,()=>a()&&e.get(t_.S8)===h&&e.get(G.chatGptAuthenticatedAccountId$)===u&&e.get(G.o8)===d))`;
  const prefix=`;globalThis.__codexPlusBackgroundNative=(${createNativeSuggestionContext.toString()});globalThis.__codexPlusBackgroundSuggestions??=(${createBackgroundSuggestionBridge.toString()})(${JSON.stringify(backgroundGuardBinding)});\n`;
  return {supported:true,source:prefix+adapted.replace(register,register+registration).replace(cache,captured)};
}

// These adapters only use the reviewed host's native client and existing scope.
export function createNativeSuggestionContext(scope,hostId,client,isCurrent,{drafts,identities,composer,wrap}) {
  const dispose=value=>value?.[Symbol.dispose]?.();
  function probe(target){
    if(target.hostId!==hostId||!isCurrent())return false;
    const aliases=new Set(keys(target));
    if([...aliases].some(key=>drafts.lD(scope,key)))return false;
    let root=scope.node;while(root.parent)root=root.parent;
    const seen=new Set();
    function visit(node,ancestors){
      if(seen.has(node))return true;seen.add(node);
      const chain=new Map(ancestors);chain.set(node.token.id,node);
      if(node.token===composer.PR&&aliases.has(node.key)&&drafts.rD(wrap(composer.PR,chain,node)))return false;
      for(const entries of node.retainedScopeEntries.values())for(const entry of entries.values())if(!visit(entry.node,chain))return false;
      return true;
    }
    return visit(root,scope.chain);
  }
  function keys(target){return [...new Set([identities.JJ(scope,target.threadId),identities.s8(target.threadId)])];}
  async function validate(target,ownMessageId){
    const values=[];
    try{
      const meta=await client.getCachedConversationMetadata(target.threadId);values.push(meta);
      const follow=await client.getFollowUpContext(target.threadId);values.push(follow);
      const history=await client.getLoadedConversationHistory(target.threadId);values.push(history);
      const execution=await client.getThreadExecutionState(target.threadId);values.push(execution);
      const archiving=await client.isConversationArchiving(target.threadId);
      if(!probe(target)||archiving||meta?.streamRole?.role!=='owner'||meta.ephemeral||meta.sideConversation||follow?.resumeState!=='resumed'||follow.isClosedSubagent||follow.mode==='durable'||follow.latestCollaborationMode?.mode==='plan')return false;
      const turns=history?.turns;if(!Array.isArray(turns))return false;
      const latest=turns.filter(t=>t.turnId!=null).at(-1);
      if(latest?.turnId!==target.latestTurnId||latest.status!=='completed'||latest.automationKind!=null||latest.params?.turnTrigger?.startsWith('automation_'))return false;
      const pending=turns.filter(t=>t.status==='inProgress');
      if(pending.some(t=>t.turnId!=null||!ownMessageId||t.params?.clientUserMessageId!==ownMessageId)||pending.length>1)return false;
      // Before native dispatch its own optimistic turn is present. Other work
      // must never be steered, queued behind, or mistaken for that turn.
      if(execution?.hasMisalignmentPolicyViolation||execution?.activeTurnId!=null||execution?.inProgress&&pending.length!==1)return false;
      return probe(target);
    }finally{for(const value of values.reverse())dispose(value);}
  }
  return {hostId,client,probe,keys,validate,send:(target,text,messageId,assertCurrent)=>client.startTurnWithOutcome(target.threadId,{request:{threadId:target.threadId,input:[{type:'text',text,text_elements:[]}],clientUserMessageId:messageId},context:{inheritThreadSettings:true,assertRequestCurrent:assertCurrent}})};
}

export function createBackgroundSuggestionBridge(binding,environment={}) {
  const now=environment.now??Date.now,contexts=new Map(),candidates=new Map(),guards=new Map();
  let settings=null,expires=0,inputRevision=0;
  const changed=event=>{if(event.isTrusted)inputRevision++;};
  const doc=environment.document??globalThis.document;
  for(const type of ['beforeinput','pointerdown','compositionstart','keydown'])doc?.addEventListener(type,changed,true);
  const live=()=>settings?.enabled===true&&now()<expires;
  const keyFor=t=>JSON.stringify([t.hostId,t.threadId,t.latestTurnId]);
  function configure(next){
    if(settings?.connection===next.connection&&next.revision<settings.revision)return;
    if(!settings||settings.connection!==next.connection||settings.revision!==next.revision||settings.enabled!==next.enabled){candidates.clear();for(const resolve of guards.values())resolve(false);guards.clear();}
    settings={...next};expires=now()+5000;
  }
  function register(context){contexts.set(context.hostId,context);}
  function capture(client,target,prediction,current){
    const context=contexts.get(target.hostId);
    if(!live()||context?.client!==client||target.generationTrigger!=='live'||prediction.sourceTurnId!==target.latestTurnId||typeof prediction.text!=='string'||!prediction.text.trim()||!current())return;
    const key=keyFor(target);
    for(const [k,c]of candidates)if(c.target.hostId===target.hostId&&c.target.threadId===target.threadId)candidates.delete(k);
    candidates.set(key,{key,target,prediction,current,context,born:now(),settings:{...settings}});
  }
  function inspect(){
    for(const [key,c]of candidates)if(now()-c.born>60000||!c.current())candidates.delete(key);
    return {supported:true,protocol:2,registered:contexts.size,inputRevision,candidates:live()?[...candidates.values()].map(c=>({key:c.key,target:c.target})):[]};
  }
  function probe(target){try{return {ok:contexts.get(target.hostId)?.probe(target)===true,inputRevision};}catch{return {ok:false,inputRevision};}}
  function requestGuard(c,operation){
    if(!live()||settings.connection!==c.settings.connection||settings.revision!==c.settings.revision)return Promise.resolve(false);
    const requestId=globalThis.crypto.randomUUID();
    return new Promise(resolve=>{
      const timer=setTimeout(()=>{guards.delete(requestId);resolve(false);},2000);
      guards.set(requestId,ok=>{clearTimeout(timer);resolve(ok===true);});
      try{globalThis[binding](JSON.stringify({protocol:2,requestId,operation,key:c.key,connection:settings.connection,revision:settings.revision}));}catch{clearTimeout(timer);guards.delete(requestId);resolve(false);}
    });
  }
  function resolveGuard(requestId,ok){const resolve=guards.get(requestId);guards.delete(requestId);resolve?.(ok);}
  async function submit({key,operation}){
    const c=candidates.get(key);candidates.delete(key);
    if(!c)return {outcome:'rejected',reason:'candidate-gone'};
    const messageId=globalThis.crypto.randomUUID();
    const valid=()=>live()&&settings.connection===c.settings.connection&&settings.revision===c.settings.revision&&c.current()&&c.context===contexts.get(c.target.hostId)&&probe(c.target).ok;
    const assertCurrent=async()=>{
      if(!valid()||!await c.context.validate(c.target,messageId)||!valid()||!await requestGuard(c,operation)||!valid())throw Error('Codex Plus suggestion admission cancelled');
    };
    try{
      await assertCurrent();
      const outcome=await c.context.send(c.target,c.prediction.text,messageId,assertCurrent);
      return {outcome:['accepted','rejected','unconfirmed'].includes(outcome)?outcome:'unconfirmed'};
    }catch{return {outcome:'unconfirmed'};}
  }
  function dispose(){configure({connection:settings?.connection,revision:(settings?.revision??0)+1,enabled:false});for(const type of ['beforeinput','pointerdown','compositionstart','keydown'])doc?.removeEventListener(type,changed,true);}
  return {protocol:2,configure,register,capture,inspect,probe,submit,resolveGuard,dispose};
}

export class SuggestionCoordinator {
  constructor({attempts=[],persist}){this.attempts=new Set(attempts);this.persist=persist;this.enabled=false;this.revision=0;this.pending=null;this.counts={attempted:0,accepted:0,submitted:0,unknown:0};this.reason='disabled';}
  configure(enabled){if(this.enabled===enabled)return;this.enabled=enabled;this.revision++;this.reason=enabled?'waiting-for-new-suggestion':'disabled';}
  async tick(pages,{probe,submit}){
    if(!this.enabled||this.pending)return;
    const revision=this.revision;
    for(const page of pages)for(const candidate of page.snapshot.candidates??[]){
      if(this.attempts.has(candidate.key))continue;
      if(!await probe(candidate.target)||!this.enabled||revision!==this.revision){this.reason='draft-or-state-changed';continue;}
      this.attempts.add(candidate.key);
      try{await this.persist([...this.attempts]);}catch{this.configure(false);this.reason='attempt-storage-unavailable';return;}
      if(!this.enabled||revision!==this.revision)return;
      const operation=globalThis.crypto.randomUUID();this.pending={id:page.id,key:candidate.key,target:candidate.target,operation,revision};this.counts.attempted++;
      try{const result=await submit(page.id,{key:candidate.key,operation});if(result?.outcome==='accepted'){this.counts.accepted++;this.counts.submitted++;this.reason='submitted-in-background';}else if(result?.outcome==='rejected')this.reason='native-rejected';else{this.counts.unknown++;this.reason='submission-unconfirmed';}}catch{this.counts.unknown++;this.reason='submission-unconfirmed';}finally{this.pending=null;}
      return;
    }
  }
  status(){return {enabled:this.enabled,phase:this.pending?'pending':this.enabled?'watching':'disabled',...this.counts,reason:this.reason};}
}
