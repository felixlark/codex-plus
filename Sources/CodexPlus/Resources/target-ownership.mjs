import {randomUUID} from 'node:crypto';

// A status projection from the signed native authority, never a task database.
// The producer is implemented by SmartShadow's v4 migration. Missing evidence
// cannot authorise attaching to a renderer, even if its URL looks familiar.
export function validateOwnership(value) {
  if(value?.schema!=='codex-target-ownership/v1'||value.enhancementsOwner!=='codex-plus')throw Error('Ownership unavailable');
  const host=value.host;
  if(host?.appPath!=='/Applications/ChatGPT.app'||!Number.isSafeInteger(host.pid)||host.pid<=0||
    !Number.isSafeInteger(host.start_seconds)||host.start_seconds<=0||!Number.isSafeInteger(host.start_microseconds)||host.start_microseconds<0||host.start_microseconds>=1000000||
    !/^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^/]+$/.test(host.endpoint)||!Array.isArray(value.targets))throw Error('Invalid host ownership');
  const seen=new Set(),identities=new Map(['windowID','browserWindowId','webContentsId'].map(k=>[k,new Set()]));
  for(const target of value.targets){
    if(typeof target.targetId!=='string'||!target.targetId||seen.has(target.targetId)||
      !['human','mobile'].includes(target.purpose)||typeof target.instance!=='string'||!target.instance||
      typeof target.frameId!=='string'||!target.frameId||
      !['windowID','browserWindowId','webContentsId'].every(k=>Number.isSafeInteger(target[k])&&target[k]>0))throw Error('Invalid target ownership');
    seen.add(target.targetId);
    for(const [key,values]of identities){if(values.has(target[key]))throw Error('Conflicting target identity');values.add(target[key]);}
  }
  return {schema:value.schema,enhancementsOwner:value.enhancementsOwner,
    host:Object.fromEntries(['pid','start_seconds','start_microseconds','appPath','endpoint'].map(k=>[k,host[k]])),
    targets:value.targets.map(t=>Object.fromEntries(['targetId','purpose','windowID','browserWindowId','webContentsId','instance','frameId'].map(k=>[k,t[k]]))).sort((a,b)=>a.targetId.localeCompare(b.targetId))};
}

export class OwnershipAuthority {
  constructor(fetch,onRevoke=()=>{}) { this.fetch=fetch;this.onRevoke=onRevoke;this.epoch=0;this.scope=null;this.pending=null;this.requestGeneration=0; }
  async refresh(){
    if(this.pending)return this.pending;
    const generation=this.requestGeneration;
    this.pending=(async()=>{
      let next;try{next=validateOwnership(await this.fetch());}catch{next=null;}
      if(generation!==this.requestGeneration)return null;
      if(JSON.stringify(next)!==JSON.stringify(this.scope)){
        const previous=this.scope;this.scope=next;this.epoch++;
        await this.onRevoke(previous,next);
      }
      return this.scope;
    })();
    try{return await this.pending;}finally{this.pending=null;}
  }
  current(targetId,frameId){
    return this.scope?.targets.find(t=>t.targetId===targetId&&t.purpose==='human'&&(!frameId||t.frameId===frameId))??null;
  }
  async admit(targetId,frameId){
    await this.refresh();const claim=this.current(targetId,frameId);
    if(!claim)throw Error('Human target ownership unavailable');
    return {epoch:this.epoch,claim,host:this.scope.host};
  }
  valid(ticket){return ticket.epoch===this.epoch&&this.current(ticket.claim.targetId,ticket.claim.frameId)?.instance===ticket.claim.instance;}
  async run(targetId,frameId,effect){
    const ticket=await this.admit(targetId,frameId);
    if(!this.valid(ticket))throw Error('Ownership changed');
    const result=await effect(ticket);
    if(!this.valid(ticket))throw Error('Ownership changed');
    return result;
  }
  revoke(){const previous=this.scope;this.scope=null;this.epoch++;this.requestGeneration++;return this.onRevoke(previous,null);}
}

// Uses the existing native/controller JSON-line pipe. Each reply is matched to
// one fresh request; a late/foreign reply never resurrects an old authorisation.
export class OwnershipRequests {
  constructor(send,{timeoutMs=10000}={}){this.send=send;this.timeoutMs=timeoutMs;this.pending=new Map();this.closed=false;}
  read(){
    if(this.closed)return Promise.reject(Error('Ownership pipe closed'));
    const requestId=randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(requestId);reject(Error('Ownership request unavailable'));},this.timeoutMs);
      this.pending.set(requestId,{resolve,reject,timer});
      try{this.send({type:'target-ownership-request',version:1,requestId});}
      catch(error){clearTimeout(timer);this.pending.delete(requestId);reject(error);}
    });
  }
  receive(value){
    if(value?.type!=='target-ownership-result'||value.version!==1)return false;
    const request=this.pending.get(value.requestId);if(!request)return false;
    this.pending.delete(value.requestId);clearTimeout(request.timer);
    value.ok===true?request.resolve(value.scope):request.reject(Error('Ownership unavailable'));
    return true;
  }
  close(){this.closed=true;for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(Error('Ownership pipe closed'));}this.pending.clear();}
}
