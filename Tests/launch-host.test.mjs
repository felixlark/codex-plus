import test from 'node:test';
import assert from 'node:assert/strict';
import {launchHost, parseEndpoint, verifyHost} from '../Sources/CodexPlus/Resources/launch-host.mjs';

const app='/Applications/ChatGPT.app', executable=app+'/Contents/MacOS/ChatGPT';
const endpoint='ws://127.0.0.1:49231/devtools/browser/new';
function fixture(options={}) {
  let reads=0, clock=0;
  const calls=[];
  const deps={
    now:()=>clock,
    pause:async()=>{clock+=25;},
    readFile:async()=>{
      const value=(options.files??['49230\n/devtools/browser/old\n','49231\n/devtools/browser/new\n'])[reads++] ?? '49231\n/devtools/browser/new\n';
      if(value===null)throw Object.assign(Error('not ready'),{code:'ENOENT'});
      return value;
    },
    run:(command,args)=>{
      calls.push({command,args});
      if(command==='/usr/bin/open') { if(options.openError)throw Error('launch failed'); return ''; }
      if(command==='/bin/ps') {
        if(args[0]==='-axo')return `100 ${executable}\n`;
        return args.at(-1)==='comm='?(options.executable??executable):`${executable} --user-data-dir=/profile/user-data`;
      }
      if(args.includes('-Fpn'))return options.listeners??'p200\nn127.0.0.1:49231\nn[::1]:49231\n';
      return options.pids??'200\n';
    }
  };
  return {deps,calls};
}

test('launch uses LaunchServices and authenticates the new process, not open PID', async()=>{
  const {deps,calls}=fixture();
  assert.deepEqual(await launchHost({app,environment:{}},deps),{pid:200,endpoint});
  assert.equal(calls.filter(c=>c.command==='/usr/bin/open').length,1);
  assert.ok(calls.find(c=>c.command==='/usr/bin/open').args.includes('--remote-debugging-port=0'));
});
test('preserves profile settings without passing unrelated environment in argv',async()=>{
  const {deps,calls}=fixture();
  await launchHost({app,profile:'/profile',environment:{UNRELATED_SECRET:'do-not-forward'}},deps);
  const args=calls.find(c=>c.command==='/usr/bin/open').args;
  assert.ok(args.includes('CODEX_HOME=/profile/codex-home'));
  assert.ok(args.includes('CODEX_ELECTRON_USER_DATA_PATH=/profile/user-data'));
  assert.ok(args.includes('--user-data-dir=/profile/user-data'));
  assert.ok(!args.join(' ').includes('do-not-forward'));
});
test('waits through a stale file, missing file and partial rewrite',async()=>{
  const {deps}=fixture({files:['49230\n/devtools/browser/old\n','49230\n/devtools/browser/old\n',null,'49231\n','49231\n/devtools/browser/new\n']});
  assert.equal((await launchHost({app,environment:{}},deps)).pid,200);
});
test('does not attach an old host even after a file rewrite',async()=>{
  const {deps}=fixture({pids:'100\n'});
  await assert.rejects(launchHost({app,environment:{},timeoutMs:50},deps),/timeout/);
});
test('rejects ambiguous host listeners',async()=>{
  const {deps}=fixture({pids:'200\n201\n'});
  await assert.rejects(launchHost({app,environment:{}},deps),/Ambiguous/);
});
test('rejects executable prefix collisions',async()=>{
  const {deps}=fixture({executable:executable+'-other'});
  await assert.rejects(launchHost({app,environment:{}},deps),/executable/);
});
test('rejects a host bound to both localhost and a specific LAN address',async()=>{
  const {deps}=fixture({listeners:'p200\nn127.0.0.1:49231\nn192.0.2.1:49231\n'});
  await assert.rejects(launchHost({app,environment:{}},deps),/loopback/);
});
test('rejects wildcard listening',async()=>{
  const {deps}=fixture({listeners:'p200\nn*:49231\n'});
  await assert.rejects(launchHost({app,environment:{}},deps),/loopback/);
});
test('reports open failure without attaching or terminating any process',async()=>{
  const {deps,calls}=fixture({openError:true});
  await assert.rejects(launchHost({app,environment:{}},deps),/launch failed/);
  assert.ok(!calls.some(c=>c.command.includes('kill')||c.command.includes('lsof')));
});
test('rejects partial and malformed endpoint files',()=>{
  for(const value of ['','1\n','70000\n/devtools/browser/a','12\nhttps://example.com','12\n/devtools/browser/a?query=1'])assert.equal(parseEndpoint(value),null);
});
test('requires a loopback listener for the actual debug port',()=>{
  assert.throws(()=>verifyHost({app,pid:200,endpoint},(command,args)=>command==='/bin/ps'?executable:'p200\nn[::1]:49231\n'),/loopback/);
});

test('parent liveness checks the OS rather than a cached startup ppid',async()=>{
  const {parentIsAlive}=await import('../Sources/CodexPlus/Resources/launch-host.mjs');
  const {spawn}=await import('node:child_process');const {once}=await import('node:events');
  const parent=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  try{await once(parent,'spawn');assert.equal(parentIsAlive(parent.pid),true);const exited=once(parent,'exit');parent.kill('SIGTERM');await exited;assert.equal(parentIsAlive(parent.pid),false);}
  finally{if(parent.exitCode===null&&parent.signalCode===null)parent.kill('SIGKILL');}
});
