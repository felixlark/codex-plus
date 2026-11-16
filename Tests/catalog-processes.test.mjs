import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogBackend} from '../Sources/SmartShadowManager/Resources/catalog-processes.mjs';

const hostPath='/Applications/ChatGPT.app/Contents/MacOS/ChatGPT';
const binary='/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
function fixture({host=`10 1 501 ${hostPath}`,children=`20 10 501 ${binary}\n21 10 501 ${binary}`,commands=`20 ${binary} app-server\n21 ${binary} exec-server`,pgrepError}={}) {
 const calls=[];
 const run=(file,args)=>{
  calls.push({file,args});assert.ok(!args.includes('-axo'));
  if(file==='/usr/bin/pgrep'){
   assert.deepEqual(args.slice(0,4),['-a','-P','10','-f']);
   assert.equal(args[4],'^'+binary.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'( |$)');
   if(pgrepError)throw pgrepError;return '20\n21\n';
  }
  assert.equal(file,'/bin/ps');assert.equal(args[0],'-p');assert.equal(args[2],'-o');
  if(args[1]==='10')return host;
  assert.equal(args[1],'20,21');return args[3].includes('ppid')?children:commands;
 };
 return {calls,read:()=>catalogBackend({hostPID:10,uid:501,hostPath,binary,run})};
}

test('targeted census includes backend ancestors and excludes exec-server without a full ps scan',()=>{
 const h=fixture();assert.equal(h.read().pid,20);assert.equal(h.calls.length,4);
});
test('host executable or account mismatch stops before candidate discovery',()=>{
 for(const host of [`10 1 502 ${hostPath}`,'10 1 501 /tmp/ChatGPT']){
  const h=fixture({host});assert.throws(h.read,/host identity/);assert.equal(h.calls.length,1);
 }
});
test('candidate UID, exact executable, parent and unique app-server remain mandatory',()=>{
 for(const children of [`20 9 501 ${binary}`,`20 10 502 ${binary}`,`20 10 501 ${binary}-other`])assert.throws(fixture({children}).read,/backend identity/);
 assert.throws(fixture({commands:`20 ${binary} exec-server\n21 ${binary} exec-server`}).read,/backend identity/);
 assert.throws(fixture({commands:`20 ${binary} app-server\n21 ${binary} app-server`}).read,/backend identity/);
});
test('no candidate or failed census never returns an unverified process',()=>{
 assert.throws(fixture({pgrepError:Object.assign(Error('no match'),{status:1})}).read,/backend identity/);
 assert.throws(fixture({pgrepError:Object.assign(Error('unknown'),{status:2})}).read,/unknown/);
});
