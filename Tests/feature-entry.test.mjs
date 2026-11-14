import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateNativeAction,installFeatureEntry,removeFeatureEntries,reviewedFeatureResource} from '../Sources/CodexPlus/Resources/feature-entry.mjs';
import {createSnakeGame,openSnakeDialog} from '../Sources/CodexPlus/Resources/snake.mjs';
import {parser,adaptSidebar,adaptReloadRoute,openAsar,reviewedHostResource,reviewedRouteResource} from '../scripts/inspect-sidebar-model.mjs';

test('native bridge accepts only the exact settings action shape',()=>{
  const action={version:1,action:'open-settings',requestId:'a-b-123'};
  assert.equal(validateNativeAction(action),true);
  for(const bad of [null,{}, {...action,version:2},{...action,action:'exec'},{...action,path:'/tmp/a'},{...action,requestId:'a\nb'}])assert.equal(validateNativeAction(bad),false);
});
test('bundled browser functions are valid standalone scripts',async()=>{
  const {parse}=await parser();
  parse(`(${installFeatureEntry.toString()})({connection:'test',binding:'test'},${createSnakeGame.toString()},${openSnakeDialog.toString()})`,{ecmaVersion:'latest'});
});
test('reviewed installed host preserves the sidebar and route structural contracts',async context=>{
  let archive;try{archive=await openAsar('/Applications/ChatGPT.app');}catch(error){if(error.code==='ENOENT'){context.skip('Official macOS host is not installed');return;}throw error;}
  try{
    const sidebar=await archive.read(archive.entries.find(e=>e.path===reviewedHostResource.path));
    const route=await archive.read(archive.entries.find(e=>e.path===reviewedRouteResource.path));
    assert.equal((await adaptSidebar(sidebar,{host:true,resourcePath:reviewedHostResource.path})).supported,true);
    assert.equal((await adaptReloadRoute(route)).supported,true);
    assert.equal((await adaptSidebar(sidebar+'\n',{host:true,resourcePath:reviewedHostResource.path})).supported,false);
  }finally{await archive.close();}
});


test('exit disposes entries in every tracked page before waiting on script removal',async()=>{
  const calls=[];let release;
  const pending=removeFeatureEntries(new Map([['current',{main:true,script:'s1'}],['stale',{main:false,script:'s2'}]]),(id,method,args)=>{
    calls.push({id,method,args});
    if(id==='stale'&&method==='Page.removeScriptToEvaluateOnNewDocument')return new Promise(r=>release=r);
    return Promise.resolve({});
  });
  assert.deepEqual(calls.filter(c=>c.method==='Runtime.evaluate').map(c=>c.id),['current','stale']);
  assert.ok(calls.filter(c=>c.method==='Runtime.evaluate').every(c=>c.args.expression==='globalThis.__codexPlusFeatures?.dispose()'));
  release();await pending;
  assert.equal(calls.filter(c=>c.method==='Runtime.removeBinding').length,2);
});
test('one vanished page does not block removal in another page',async()=>{
  const removed=[];
  await removeFeatureEntries(new Map([['closed',{}],['live',{}]]),(id,method)=>{
    if(id==='closed')return Promise.reject(Error('Target closed'));
    if(method==='Runtime.evaluate')removed.push(id);
    return Promise.resolve({});
  });
  assert.deepEqual(removed,['live']);
});
test('reviewed footer exists in the updated installed host',async context=>{
  const {createHash}=await import('node:crypto');let a;try{a=await openAsar('/Applications/ChatGPT.app');}catch(error){if(error.code==='ENOENT'){context.skip();return;}throw error;}
  try{const e=a.entries.find(e=>e.path===reviewedFeatureResource.path);assert.ok(e);assert.equal(createHash('sha256').update(await a.read(e)).digest('hex'),reviewedFeatureResource.sha256);}finally{await a.close();}
});
