import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateNativeAction,installFeatureEntry} from '../Sources/CodexPlus/Resources/feature-entry.mjs';
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
