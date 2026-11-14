import {createHash} from 'node:crypto';
import {createSuggestionReviewPolicy} from './suggestion-review.mjs';
export const reviewedSamplingResource=Object.freeze({path:'.vite/build/early-bootstrap-631-9880b56d55f301d1.js',sha256:'bce29a615bb1ab7019b9db27acdff7018ddaae8a2c7d6ede4b6c983b01f90ebe',binaryPath:'Contents/Resources/codex-cli/bin/codex',binarySHA256:'50ab38ba21d0d9f8346f32f41848382f15b556190f3c7a07e885a4fb73e379c8'});
export const backgroundGuardBinding='__codexPlusBackgroundGuard';
export const reviewedBackgroundDependency=Object.freeze({path:'webview/assets/async/514766.2d2f1ddc86.js',sha256:'943016fbef25cbfe62703ea7ab5ee7d2e9971b8db3681147fb983e7bd12e6f39'});
export const reviewedBackgroundResource=Object.freeze({path:'webview/assets/async/739301.37a39f26d6.js',sha256:'acc2174e4ed3d2068af26c1731f08e8978c853864aea9c0a917ae9d246885058'});

export function adaptBackgroundSuggestions(original,adapted=original.toString()) {
  if(createHash('sha256').update(original).digest('hex')!==reviewedBackgroundResource.sha256)return {supported:false,reason:'unreviewed-background-source'};
  const register='function nG(e,t,I,C){',cache='e.queryClient.setQueryData((0,t_.pv)(u,d,l),f)';
  if(adapted.split(register).length!==2||adapted.split(cache).length!==2)return {supported:false,reason:'background-structure'};
  const registration='globalThis.__codexPlusBackgroundSuggestions.register(globalThis.__codexPlusBackgroundNative(e,t,I,()=>nH&&(C?.()??!0),{drafts:n("TSib"),identities:n("V3rO"),composer:n("Sd8U"),wrap:n("GNwQ").GB,identity:()=>[e.get(G.chatGptAuthenticatedAccountId$),e.get(G.o8),e.get(t_.S8)]}));';
  const captured=`(${cache},globalThis.__codexPlusBackgroundSuggestions.capture(t,c,f,()=>a()&&e.get(t_.S8)===h&&e.get(G.chatGptAuthenticatedAccountId$)===u&&e.get(G.o8)===d))`;
  const prefix=`;globalThis.__codexPlusSuggestionReviewPolicy=(${createSuggestionReviewPolicy.toString()})();globalThis.__codexPlusBackgroundNative=(${createNativeSuggestionContext.toString()});globalThis.__codexPlusBackgroundSuggestions??=(${createBackgroundSuggestionBridge.toString()})(${JSON.stringify(backgroundGuardBinding)});\n`;
  return {supported:true,source:prefix+adapted.replace(register,register+registration).replace(cache,captured)};
}

// These adapters only use the reviewed host's native client and existing scope.
export function createNativeSuggestionContext(scope,hostId,client,isCurrent,{drafts,identities,composer,wrap,identity}) {
  const dispose=value=>value?.[Symbol.dispose]?.();
  function probe(target){
    const principal=identity?.();
    if(target.hostId!==hostId||!isCurrent()||!principal||principal[0]==null||principal[1]==null)return false;
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
  async function validate(target,ownMessageId,readOnly=false){
    const eligible=()=>{const principal=identity?.();return target.hostId===hostId&&isCurrent()&&principal?.[0]!=null&&principal?.[1]!=null&&(readOnly||probe(target));};
    const values=[];
    try{
      const meta=await client.getCachedConversationMetadata(target.threadId);values.push(meta);
      const follow=await client.getFollowUpContext(target.threadId);values.push(follow);
      const history=await client.getLoadedConversationHistory(target.threadId);values.push(history);
      const execution=await client.getThreadExecutionState(target.threadId);values.push(execution);
      const archiving=await client.isConversationArchiving(target.threadId);
      if(!eligible()||archiving||meta?.streamRole?.role!=='owner'||meta.ephemeral||meta.sideConversation||follow?.resumeState!=='resumed'||follow.isClosedSubagent||follow.mode==='durable'||follow.latestCollaborationMode?.mode==='plan')return false;
      const turns=history?.turns;if(!Array.isArray(turns))return false;
      const latest=turns.filter(t=>t.turnId!=null).at(-1);
      if(latest?.turnId!==target.latestTurnId||latest.status!=='completed'||latest.automationKind!=null||latest.params?.turnTrigger?.startsWith('automation_'))return false;
      const pending=turns.filter(t=>t.status==='inProgress');
      if(pending.some(t=>t.turnId!=null||!ownMessageId||t.params?.clientUserMessageId!==ownMessageId)||pending.length>1)return false;
      // Before native dispatch its own optimistic turn is present. Other work
      // must never be steered, queued behind, or mistaken for that turn.
      if(execution?.hasMisalignmentPolicyViolation||execution?.activeTurnId!=null||execution?.inProgress&&pending.length!==1)return false;
      return eligible();
    }finally{for(const value of values.reverse())dispose(value);}
  }
  async function snapshot(target,hydrate=false) {
    // Hydration is a native data operation, never a route/focus/composer change.
    if(target.hostId!==hostId||!isCurrent())throw Error('background-host-unavailable');
    if(hydrate){
      if(!await client.ensureConversationFirstPage(target.threadId))throw Error('background-history-unavailable');
      await client.ensureConversationHistoryLoaded(target.threadId,[],{force:true});
    }
    const values=[];
    try{
      const meta=await client.getCachedConversationMetadata(target.threadId);values.push(meta);
      const follow=await client.getFollowUpContext(target.threadId);values.push(follow);
      const history=await client.getLoadedConversationHistory(target.threadId);values.push(history);
      const permissions=await client.getCurrentPermissions(target.threadId);values.push(permissions);
      const sandbox=await client.getTurnSandboxPolicy(target.threadId,target.latestTurnId);values.push(sandbox);
      const principal=identity?.();
      if(!principal||principal[0]==null||principal[1]==null||!history?.turns||!follow||!meta||!isCurrent())throw Error('review-context-unavailable');
      // Own native optimistic turn appears during preparation; only completed
      // source history belongs in the review identity. validate() checks work.
      const turns=history.turns.filter(t=>t.turnId!=null);
      const latest=turns.at(-1);
      if(latest?.turnId!==target.latestTurnId||latest.status!=='completed')throw Error('source-changed');
      const pickInput=t=>t.params?.input??t.items?.filter(i=>i.type==='userMessage').flatMap(i=>i.content??[])??[];
      return JSON.parse(JSON.stringify({principal,meta:{owner:meta.streamRole?.role,ephemeral:meta.ephemeral,sideConversation:meta.sideConversation},follow,permissions,sandbox,history:{title:history.title,isComplete:history.isComplete,turns},sourceInput:pickInput(latest)}));
    }finally{for(const value of values.reverse())dispose(value);}
  }
  async function review(target,text) {
    const policy=globalThis.__codexPlusSuggestionReviewPolicy;
    if(!policy||typeof client.sendRequest!=='function')throw Error('review-unavailable');
    const prompt=policy.prompt(text);
    // The reviewed upstream thread/sample protocol accepts at most 4,000 bytes.
    if(new TextEncoder().encode(prompt).length>4000)throw Error('review-prompt-too-long');
    const response=await client.sendRequest('thread/sample',{threadId:target.threadId,expectedTurnId:target.latestTurnId,prompt,disableMcp:true,threadSource:'composer_predictions',turnTrigger:'composer_predictions'});
    try{return policy.parse(response,target.latestTurnId);}finally{dispose(response);}
  }
  return {hostId,client,probe,keys,validate,validateReadOnly:target=>validate(target,undefined,true),snapshot,review,send:(target,text,messageId,assertCurrent)=>client.startTurnWithOutcome(target.threadId,{request:{threadId:target.threadId,input:[{type:'text',text,text_elements:[]}],clientUserMessageId:messageId},context:{inheritThreadSettings:true,assertRequestCurrent:assertCurrent}})};
}

export function createBackgroundSuggestionBridge(binding,environment={}) {
  const now=environment.now??Date.now,contexts=new Map(),candidates=new Map(),guards=new Map(),sensitiveThreads=new Set();
  const policy=environment.reviewPolicy??globalThis.__codexPlusSuggestionReviewPolicy;
  // Human reviews must not inherit the 60-second immediate-dispatch lifetime.
  const reviewLifetimeMs=15*60*1000;
  const counts={captured:0,reviewing:0,reviewed:0,blocked:0,expired:0};
  let settings=null,expires=0,inputRevision=0,lastReason='waiting-for-new-suggestion';
  const changed=event=>{if(event.isTrusted)inputRevision++;};
  const doc=environment.document??globalThis.document;
  for(const type of ['beforeinput','pointerdown','compositionstart','keydown'])doc?.addEventListener(type,changed,true);
  const live=()=>settings?.enabled===true&&now()<expires;
  const keyFor=t=>JSON.stringify([t.hostId,t.threadId,t.latestTurnId]);
  const threadKey=t=>JSON.stringify([t.hostId,t.threadId]);
  const current=c=>live()&&candidates.get(c.key)===c&&c.current()&&c.context===contexts.get(c.target.hostId)&&settings.connection===c.settings.connection&&settings.revision===c.settings.revision;
  async function fingerprint(c,snapshot){
    const bytes=new TextEncoder().encode(JSON.stringify({version:policy?.version,target:c.target,text:c.prediction.text,snapshot}));
    const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
    return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
  }
  function configure(next){
    if(settings?.connection===next.connection&&next.revision<settings.revision)return;
    if(!settings||settings.connection!==next.connection||settings.revision!==next.revision||settings.enabled!==next.enabled){candidates.clear();for(const resolve of guards.values())resolve(false);guards.clear();}
    settings={...next};expires=now()+5000;
  }
  function register(context){contexts.set(context.hostId,context);}
  function prune(){
    for(const [key,c]of candidates){
      if(now()>c.deadline||!c.current()||c.context!==contexts.get(c.target.hostId)){candidates.delete(key);counts.expired++;}
    }
  }
  async function assess(c){
    counts.reviewing++;lastReason='reviewing';
    try{
      if(!policy)throw Error('review-unavailable');
      const snapshot=await c.context.snapshot(c.target,true);
      if(!current(c))return;
      c.title=snapshot.history?.title??'未命名任务';
      c.sourceInput=JSON.stringify(snapshot.sourceInput??[]);
      c.snapshotId=await fingerprint(c,snapshot);
      c.token=globalThis.crypto.randomUUID();
      c.deadline=now()+reviewLifetimeMs;
      if(snapshot.history?.isComplete!==true||snapshot.permissions==null||snapshot.sandbox==null)throw Error('review-context-incomplete');
      if(!await c.context.validate(c.target))throw Error('draft-or-state-changed');
      const hardReason=c.hardReason;
      const result=await c.context.review(c.target,c.prediction.text);
      if(!current(c))return;
      if(result.decision==='sensitive'||hardReason)sensitiveThreads.add(threadKey(c.target));
      const latest=await c.context.snapshot(c.target);
      if(!current(c)||await fingerprint(c,latest)!==c.snapshotId)throw Error('review-source-changed');
      c.assessment=result;
      c.canApprove=result.contextSufficient===true&&result.decision!=='uncertain';
      const risky=hardReason||sensitiveThreads.has(threadKey(c.target))||result.decision!=='low-risk';
      c.phase=!risky&&result.contextSufficient?'allowed':'needs-review';
      c.reason=hardReason??(sensitiveThreads.has(threadKey(c.target))?'此任务涉及敏感事项，每次续跑均需审查。':result.contextSufficient?'本次行动需人工审查。':'行动范围或上下文不明确，请回原任务核实。');
      counts.reviewed++;if(c.phase==='needs-review')counts.blocked++;
      c.deadline=now()+(c.phase==='allowed'?60000:reviewLifetimeMs);
      lastReason=c.phase==='allowed'?'review-allowed':'needs-review';
    }catch(error){
      if(current(c)){
        c.phase='needs-review';c.canApprove=false;c.reason='审查或上下文暂不可用，未自动发送；请重新审查或回原任务处理。';
        c.token??=globalThis.crypto.randomUUID();c.deadline=now()+reviewLifetimeMs;
        c.failure=['review-context-incomplete','draft-or-state-changed','review-source-changed'].includes(error.message)?error.message:'review-unavailable';
        lastReason=c.failure;counts.blocked++;
      }
    }finally{counts.reviewing--;}
  }
  function capture(client,target,prediction,currentTarget){
    const context=contexts.get(target.hostId);
    if(settings?.acceptanceThread&&target.threadId!==settings.acceptanceThread)return;
    if(!live()||context?.client!==client||target.generationTrigger!=='live'||prediction.sourceTurnId!==target.latestTurnId||typeof prediction.text!=='string'||!prediction.text.trim()||!currentTarget())return;
    const key=keyFor(target);
    // Preserve already-observed risk even when hydration/inference fails or
    // when this candidate is superseded before its asynchronous review ends.
    const hardReason=policy?.reasonFor(prediction.text);
    if(hardReason)sensitiveThreads.add(threadKey(target));
    // A duplicate cache write cannot reset a pending or consumed approval.
    const old=candidates.get(key);if(old?.prediction.text===prediction.text&&old.context===context)return;
    for(const [k,c]of candidates)if(threadKey(c.target)===threadKey(target))candidates.delete(k);
    const c={key,target:{...target},prediction:{text:prediction.text},hardReason,current:currentTarget,context,born:now(),deadline:now()+reviewLifetimeMs,settings:{...settings},phase:'reviewing'};
    candidates.set(key,c);counts.captured++;void assess(c);
  }
  function inspect(){
    prune();
    return {supported:true,protocol:5,registered:contexts.size,inputRevision,review:{...counts,pending:[...candidates.values()].filter(c=>c.phase==='needs-review').length,reason:lastReason},candidates:live()?[...candidates.values()].filter(c=>['allowed','approved'].includes(c.phase)).map(c=>({key:c.key,target:c.target,reviewId:c.snapshotId,token:c.token})):[]};
  }
  // Only this deliberate in-memory UI channel includes prompt content. inspect,
  // state.json, durable attempts and diagnostic status never include it.
  function reviews(){
    prune();return live()?[...candidates.values()].filter(c=>c.phase==='needs-review').map(c=>({id:c.token,snapshotId:c.snapshotId??'',title:c.title??'待核实任务',text:c.prediction.text,sourceInput:c.sourceInput??'',reason:c.reason,action:c.assessment?.action??'行动尚未核实',target:c.assessment?.target??'对象尚未核实',scope:c.assessment?.scope??'范围尚未核实',canApprove:c.canApprove===true,expiresAt:c.deadline})):[];
  }
  async function decide({id,snapshotId,action}){
    prune();const c=[...candidates.values()].find(c=>c.token===id&&c.phase==='needs-review');
    if(!c||!current(c)||(c.snapshotId??'')!==snapshotId)return false;
    if(action==='reject'){candidates.delete(c.key);lastReason='review-rejected';return true;}
    if(action==='retry'){c.phase='reviewing';c.token=null;c.canApprove=false;void assess(c);return true;}
    if(action!=='approve'||!c.canApprove)return false;
    // Remove from the approvable state before awaiting, so double clicks cannot
    // approve twice or race a newer decision.
    c.phase='revalidating';
    try{
      if(!await c.context.validate(c.target)||!current(c)||await fingerprint(c,await c.context.snapshot(c.target))!==c.snapshotId)throw Error('approval-stale');
      if(!current(c)||now()>c.deadline)throw Error('approval-expired');
      c.phase='approved';lastReason='review-approved';return true;
    }catch{candidates.delete(c.key);lastReason='approval-stale';return false;}
  }
  function probe(target){try{return {ok:contexts.get(target.hostId)?.probe(target)===true,inputRevision};}catch{return {ok:false,inputRevision};}}
  function requestGuard(c,operation){
    if(!current(c))return Promise.resolve(false);
    const requestId=globalThis.crypto.randomUUID();
    return new Promise(resolve=>{
      const timer=setTimeout(()=>{guards.delete(requestId);resolve(false);},2000);
      guards.set(requestId,ok=>{clearTimeout(timer);resolve(ok===true);});
      try{globalThis[binding](JSON.stringify({protocol:5,requestId,operation,key:c.key,reviewId:c.snapshotId,token:c.token,connection:settings.connection,revision:settings.revision}));}catch{clearTimeout(timer);guards.delete(requestId);resolve(false);}
    });
  }
  function resolveGuard(requestId,ok){const resolve=guards.get(requestId);guards.delete(requestId);resolve?.(ok);}
  // Read-only native integration probe used before enabling the installed
  // candidate. It cannot capture, approve, claim or send a follow-up.
  async function preview(target,text){
    const context=contexts.get(target.hostId);
    if(!context||!policy)throw Error('review-unavailable');
    const before=await context.snapshot(target,true);
    if(!await context.validateReadOnly(target))throw Error('source-not-idle');
    const assessment=await context.review(target,text);
    const after=await context.snapshot(target);
    if(JSON.stringify(before)!==JSON.stringify(after))throw Error('sample-source-changed');
    return {assessment,sourceUnchanged:true,historyComplete:after.history?.isComplete===true};
  }
  async function submit({key,operation,reviewId,token}){
    const c=candidates.get(key);
    if(!c||!['allowed','approved'].includes(c.phase)||c.snapshotId!==reviewId||c.token!==token||!current(c)||now()>c.deadline)return {outcome:'rejected',reason:'review-not-current'};
    c.phase='claimed';c.operation=operation;
    const messageId=globalThis.crypto.randomUUID();
    const valid=()=>current(c)&&c.phase==='claimed'&&c.operation===operation&&now()<c.deadline&&probe(c.target).ok;
    const assertCurrent=async()=>{
      if(!valid()||!await c.context.validate(c.target,messageId)||!valid()||await fingerprint(c,await c.context.snapshot(c.target))!==c.snapshotId||!valid()||!await requestGuard(c,operation)||!valid())throw Error('Codex Plus suggestion admission cancelled');
    };
    try{
      await assertCurrent();
      const outcome=await c.context.send(c.target,c.prediction.text,messageId,assertCurrent);
      return {outcome:['accepted','rejected','unconfirmed'].includes(outcome)?outcome:'unconfirmed'};
    }catch{return {outcome:'unconfirmed'};}
    finally{if(candidates.get(key)===c)candidates.delete(key);}
  }
  function dispose(){configure({connection:settings?.connection,revision:(settings?.revision??0)+1,enabled:false});for(const type of ['beforeinput','pointerdown','compositionstart','keydown'])doc?.removeEventListener(type,changed,true);}
  return {protocol:5,configure,register,capture,inspect,probe,submit,resolveGuard,decide,reviews,preview,dispose};
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
      const operation=globalThis.crypto.randomUUID();this.pending={id:page.id,key:candidate.key,target:candidate.target,reviewId:candidate.reviewId,token:candidate.token,operation,revision};this.counts.attempted++;
      try{const result=await submit(page.id,{key:candidate.key,operation,reviewId:candidate.reviewId,token:candidate.token});if(result?.outcome==='accepted'){this.counts.accepted++;this.counts.submitted++;this.reason='submitted-in-background';}else if(result?.outcome==='rejected')this.reason='native-rejected';else{this.counts.unknown++;this.reason='submission-unconfirmed';}}catch{this.counts.unknown++;this.reason='submission-unconfirmed';}finally{this.pending=null;}
      return;
    }
  }
  status(){return {enabled:this.enabled,phase:this.pending?'pending':this.enabled?'watching':'disabled',...this.counts,reason:this.reason};}
}
