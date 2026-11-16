import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEndpoint,verifyHost} from '../Sources/CodexPlus/Resources/launch-host.mjs';
const app='/Applications/ChatGPT.app',executable=app+'/Contents/MacOS/ChatGPT';
const endpoint='ws://127.0.0.1:49231/devtools/browser/selected';
function run({binary=executable,listeners='p200\nn127.0.0.1:49231\n'}={}){return(command,args)=>{if(command==='/bin/ps')return args.at(-1)==='comm='?binary:executable;if(command==='/usr/sbin/lsof')return listeners;throw Error('unexpected effect');};}
test('selected backend is read and verified without starting any application',()=>{
 assert.deepEqual(parseEndpoint('49231\n/devtools/browser/selected\n'),{port:'49231',endpoint});
 assert.equal(parseEndpoint('bad\n/devtools/browser/selected\n'),null);
 verifyHost({app,pid:200,endpoint},run());
});
test('foreign executable or nonloopback listener cannot be selected',()=>{
 assert.throws(()=>verifyHost({app,pid:200,endpoint},run({binary:'/tmp/impostor'})));
 assert.throws(()=>verifyHost({app,pid:200,endpoint},run({listeners:'p200\nn*:49231\n'})));
});
