import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateNativeAction,installFeatureEntry,removeFeatureEntries,reviewedFeatureResource} from '../Sources/CodexPlus/Resources/feature-entry.mjs';
import {createSnakeGame,openSnakeDialog} from '../Sources/CodexPlus/Resources/snake.mjs';
import {parser,walk,adaptSidebar,adaptReloadRoute,openAsar,reviewedHostResource,reviewedRouteResource} from '../scripts/inspect-sidebar-model.mjs';

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
    const adapted=await adaptSidebar(sidebar,{host:true,resourcePath:reviewedHostResource.path});
    assert.equal(adapted.supported,true);
    // Execute the injected native selection read with the real model's import
    // alias shadowed, as it is in the installed host. Parsing alone misses this.
    const {parse}=await parser();let capture,selection,title;
    walk(parse(adapted.source,{ecmaVersion:'latest',sourceType:'module'}),node=>{
      if(node.type==='VariableDeclaration'&&node.declarations.some(d=>d.id.name==='__codexPlusSelectedThreadKey'))capture=node;
      if(node.type==='CallExpression'&&node.callee.type==='MemberExpression'&&node.callee.property.name==='sort'&&node.callee.object.property?.name==='__codexPlusProjectOrder'){selection=node.arguments[4];title=node.arguments[5];}
    });
    assert.ok(capture);assert.ok(selection);
    const alias=adapted.match.selectionModule.name,reads=[];
    const read=new Function('nativeSelection','readNative',`const ${alias}=nativeSelection;${adapted.source.slice(capture.start,capture.end)}return(()=>{let ${alias};const ${selection.callee.name}=readNative;return ${adapted.source.slice(selection.start,selection.end)}})()`);
    assert.equal(read({oN:'native-current-thread'},selector=>{reads.push(selector);return 'local:selected';}),'local:selected');
    assert.deepEqual(reads,['native-current-thread']);
    assert.ok(title);
    const titles=[];
    let summaryCall;
    walk(title,node=>{if(node.type==='CallExpression'&&node.callee.property?.name==='oB')summaryCall=node;});
    assert.ok(summaryCall);
    const titleRead=new Function('nativeSummary','readNative',`const ${summaryCall.callee.object.name}=nativeSummary;const ${summaryCall.arguments[0].name}=readNative;return (${adapted.source.slice(title.start,title.end)})`);
    assert.equal(titleRead({oB:(get,key)=>{titles.push(key);return get('summary',key);}},(selector,key)=>({summary:{title:'经理｜'+key}}))('local:task'),'经理｜local:task');
    assert.deepEqual(titles,['local:task']);
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
