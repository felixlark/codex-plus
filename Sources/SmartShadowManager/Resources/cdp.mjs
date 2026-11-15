export class CDP {
  constructor(socket) {
    this.socket=socket; this.sequence=0; this.pending=new Map(); this.listeners=new Set(); this.open=true;
    socket.addEventListener('message',event=>{
      const message=JSON.parse(event.data);
      if(message.id!==undefined){const request=this.pending.get(message.id);if(!request)return;this.pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(new Error(message.error.message)):request.resolve(message.result);}
      else for(const listener of this.listeners)listener(message);
    });
    socket.addEventListener('close',()=>{this.open=false;for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(new Error('CDP closed'));}this.pending.clear();for(const listener of this.listeners)listener({method:'connectionClosed'});});
  }
  static async connect(url) {
    const parsed=new URL(url);if(parsed.protocol!=='ws:'||parsed.hostname!=='127.0.0.1')throw new Error('Non-loopback endpoint');
    const socket=new WebSocket(url);
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.close();reject(new Error('CDP connect timeout'));},10000);socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});socket.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('CDP connection failed'));},{once:true});});
    return new CDP(socket);
  }
  call(method,params={},sessionId) {
    if(!this.open)return Promise.reject(new Error('CDP closed'));
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('CDP timeout: '+method));},10000);this.pending.set(id,{resolve,reject,timer});this.socket.send(JSON.stringify({id,method,params,...sessionId?{sessionId}:{}}));});
  }
  close(){this.socket.close();}
}
