export function createSnakeGame(size = 18, random = Math.random) {
  let body, direction, queued, food, score, phase;
  const vectors = {up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]};
  const same = (a,b) => a[0] === b[0] && a[1] === b[1];
  function placeFood() {
    const free=[];
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(!body.some(p=>same(p,[x,y])))free.push([x,y]);
    food=free.length?free[Math.floor(random()*free.length)]:null;
    if(!food)phase='won';
  }
  function reset() {
    const y=Math.floor(size/2),x=Math.max(2,Math.floor(size/2)-2);
    body=[[x,y],[x-1,y],[x-2,y]];direction='right';queued=null;score=0;phase='ready';placeFood();return snapshot();
  }
  function snapshot(){return {size,body:body.map(p=>[...p]),direction,food:food?[...food]:null,score,phase};}
  return {
    reset, snapshot,
    start(){if(phase==='ready'||phase==='paused')phase='running';return snapshot();},
    pause(){if(phase==='running')phase='paused';return snapshot();},
    turn(next){if(!vectors[next]||queued||!['ready','running','paused'].includes(phase))return;const a=vectors[direction],b=vectors[next];if(a[0]+b[0]!==0||a[1]+b[1]!==0)queued=next;},
    step(){
      if(phase!=='running')return snapshot();
      direction=queued??direction;queued=null;const d=vectors[direction],head=[body[0][0]+d[0],body[0][1]+d[1]],eating=food&&same(head,food);
      if(head.some(p=>p<0||p>=size)||body.slice(0,eating?body.length:-1).some(p=>same(p,head))){phase='over';return snapshot();}
      body.unshift(head);if(eating){score++;placeFood();}else body.pop();return snapshot();
    },
  };
}

export function openSnakeDialog(createGame, onClose) {
  const game=createGame();game.reset();
  const dialog=document.createElement('dialog');dialog.id='codex-plus-snake';dialog.lang='zh-CN';
  dialog.setAttribute('aria-labelledby','codex-plus-snake-title');
  const style=document.createElement('style');style.textContent=`
    #codex-plus-snake{position:fixed;inset:0;margin:auto;color:var(--color-text-primary,#202123);background:var(--color-surface,#fff);color-scheme:light dark;border:1px solid var(--color-border-default,#8885);border-radius:22px;padding:24px;width:min(440px,calc(100vw - 40px));max-height:calc(100dvh - 48px);overflow:auto;box-shadow:0 24px 90px #0004;overscroll-behavior:contain;font:14px system-ui}
    #codex-plus-snake::backdrop{background:#0006;overflow:hidden;overscroll-behavior:contain}
    #codex-plus-snake h2{font-size:22px;font-weight:650;margin:0}#codex-plus-snake p{margin:10px 0;color:var(--color-text-secondary,#727272)}
    #codex-plus-snake canvas{display:block;width:100%;aspect-ratio:1;border-radius:12px;background:#111e1c;margin:16px 0}
    #codex-plus-snake button{border:1px solid #8885;border-radius:9px;padding:9px 14px;min-height:36px;background:transparent;color:inherit;cursor:pointer;font:inherit}
    #codex-plus-snake button:hover{background:#8882}#codex-plus-snake button:focus-visible{outline:2px solid #36a889;outline-offset:3px}
    #codex-plus-snake [data-snake-actions]{display:flex;gap:8px;flex-wrap:wrap}#codex-plus-snake [data-snake-directions]{display:flex;gap:8px;justify-content:center;margin-top:14px}
    #codex-plus-snake [data-primary]{background:#1d765f;color:white;border-color:transparent}#codex-plus-snake [data-snake-heading]{display:flex;align-items:center;justify-content:space-between;gap:12px}
  `;
  const node=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
  const heading=node('div');heading.dataset.snakeHeading='';
  const title=node('h2','贪吃蛇');title.id='codex-plus-snake-title';
  const close=node('button','关闭');close.type='button';close.addEventListener('click',()=>dialog.close());heading.append(title,close);
  const instructions=node('p','方向键 / WASD 移动 · 空格暂停 · Esc 关闭');instructions.id='codex-plus-snake-help';
  const canvas=node('canvas');canvas.width=canvas.height=540;canvas.setAttribute('aria-label','贪吃蛇棋盘');canvas.setAttribute('aria-describedby',instructions.id);
  const status=node('p');status.setAttribute('role','status');
  const actions=node('div');actions.dataset.snakeActions='';
  const start=node('button','开始游戏');start.type='button';start.autofocus=true;start.dataset.primary='';
  const restart=node('button','重新开始');restart.type='button';actions.append(start,restart);
  const directions=node('div');directions.dataset.snakeDirections='';
  for(const [key,label] of [['left','← 左'],['up','↑ 上'],['down','↓ 下'],['right','→ 右']]){const b=node('button',label);b.type='button';b.addEventListener('click',()=>game.turn(key));directions.append(b);}
  dialog.append(style,heading,instructions,canvas,status,actions,directions);document.body.append(dialog);
  let timer=null,closed=false;
  const context=canvas.getContext('2d');
  function render(){
    const s=game.snapshot(),cell=540/s.size;
    context.fillStyle='#111e1c';context.fillRect(0,0,540,540);
    context.strokeStyle='#ffffff09';context.lineWidth=1;
    for(let n=1;n<s.size;n++){context.beginPath();context.moveTo(n*cell,0);context.lineTo(n*cell,540);context.moveTo(0,n*cell);context.lineTo(540,n*cell);context.stroke();}
    s.body.forEach(([x,y],i)=>{context.fillStyle=i?'#4ca68c':'#b3f1cf';context.fillRect(x*cell+2,y*cell+2,cell-4,cell-4);});
    if(s.food){context.fillStyle='#ffaf7c';context.beginPath();context.arc((s.food[0]+.5)*cell,(s.food[1]+.5)*cell,cell*.3,0,Math.PI*2);context.fill();}
    const labels={ready:'准备开始',running:'进行中',paused:'已暂停',over:'游戏结束',won:'你赢了'};
    status.textContent=`${labels[s.phase]} · 得分 ${s.score}`;start.textContent=s.phase==='running'?'暂停':s.phase==='paused'?'继续':'开始游戏';
    if(s.phase!=='running'&&timer!==null){clearInterval(timer);timer=null;}
  }
  function toggle(){
    if(game.snapshot().phase==='running')game.pause();
    else {if(['over','won'].includes(game.snapshot().phase))game.reset();game.start();if(timer===null)timer=setInterval(()=>{game.step();render();},140);}
    render();
  }
  const pause=()=>{game.pause();render();};
  const hide=()=>{if(document.hidden)pause();};
  start.addEventListener('click',toggle);restart.addEventListener('click',()=>{pause();game.reset();render();});
  dialog.addEventListener('keydown',event=>{
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='n'){dispose();return;}
    if(event.metaKey||event.ctrlKey||event.altKey)return;
    const key=event.key.toLowerCase(),direction={arrowup:'up',w:'up',arrowdown:'down',s:'down',arrowleft:'left',a:'left',arrowright:'right',d:'right'}[key];
    if(direction){event.preventDefault();event.stopPropagation();game.turn(direction);}
    else if(event.code==='Space'){event.preventDefault();event.stopPropagation();if(!event.repeat)toggle();}
    else if(event.key==='Escape')event.stopPropagation();
  });
  // Native dialog owns Esc, focus containment and focus return.
  dialog.addEventListener('cancel',event=>event.stopPropagation());
  window.addEventListener('blur',pause);document.addEventListener('visibilitychange',hide);
  function dispose(){if(closed)return;closed=true;if(timer!==null)clearInterval(timer);timer=null;window.removeEventListener('blur',pause);document.removeEventListener('visibilitychange',hide);if(dialog.open)dialog.close();dialog.remove();onClose?.();}
  dialog.addEventListener('close',dispose,{once:true});render();dialog.showModal();
  return {close:()=>dialog.close(),dispose,focus:()=>start.focus(),status:()=>({...game.snapshot(),timerActive:timer!==null})};
}
