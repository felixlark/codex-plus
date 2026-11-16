import test from 'node:test';
import assert from 'node:assert/strict';
import {initializePageSession} from '../Sources/CodexPlus/Resources/page-session.mjs';
test('explicit human attachment registers hooks without persistent document code or debugger control',async()=>{
 const calls=[];await initializePageSession(async(method,params)=>{calls.push([method,params]);return {};},{patterns:[{urlPattern:'app://-/index.html*'}],bindings:['bridge']});
 assert.ok(calls.some(([m])=>m==='Fetch.enable'));assert.ok(calls.some(([m])=>m==='Runtime.addBinding'));
 assert.equal(calls.some(([m])=>m==='Page.addScriptToEvaluateOnNewDocument'||m==='Runtime.runIfWaitingForDebugger'),false);
});
test('an old persistent-source caller is rejected before any command is dispatched',async()=>{
 const calls=[];await assert.rejects(initializePageSession(async m=>calls.push(m),{source:'old-unbounded-code'}));assert.equal(calls.length,0);
});
