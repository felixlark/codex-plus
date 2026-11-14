import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {preferredHumanNumbers,preserveNativeBounds,reviewedHumanRuntime,nativeWindowDefaults,isHumanWindowURL} from '../Sources/CodexPlus/Resources/human-window.mjs';
import {allocateWindowNumbers} from '../Sources/CodexPlus/Resources/window-number.mjs';
import {openAsar,parser} from '../scripts/inspect-sidebar-model.mjs';
const external={x:-392,y:-1266,width:2304,height:1266},right={x:1912,y:-1122,width:2048,height:1122},hidden={x:1512,y:30,width:1920,height:1050};
test('explicit human frames take 1/2 while existing hidden targets remain unique',()=>{
  const frames=[{...external,number:1},{...right,number:2}];
  const pages=[{target:'agent',frame:hidden},{target:'right',frame:right},{target:'external',frame:external}];
  const preferred=preferredHumanNumbers(pages,frames);
  assert.deepEqual(preferred,{external:1,right:2});
  assert.deepEqual(allocateWindowNumbers(pages.map(p=>p.target),{agent:1,right:4,external:3},preferred,[1,2]),{external:1,right:2,agent:3});
  assert.deepEqual(allocateWindowNumbers(['agent'],{agent:1},{},[1,2]),{agent:3});
});
test('overlapping same-frame targets never produce a guessed human binding',()=>{
  assert.deepEqual(preferredHumanNumbers([{target:'a',frame:right},{target:'b',frame:right}],[{...right,number:2}]),{});
  assert.deepEqual(preferredHumanNumbers([{target:'a',frame:{...right,x:2000}}],[{...right,number:2}]),{});
});
test('native bounds backup survives repeated controller instances and remembers absent values',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'codex-plus-native-bounds-'));
  try{
    const file=path.join(dir,'bounds.json'),original={present:true,value:hidden};
    assert.deepEqual(await preserveNativeBounds(file,original,fs),original);
    assert.deepEqual(await preserveNativeBounds(file,{present:true,value:external},fs),original);
    const absent=path.join(dir,'absent.json');
    assert.deepEqual(await preserveNativeBounds(absent,{present:false,value:null},fs),{present:false,value:null});
    await fs.writeFile(file,'broken');
    await assert.rejects(preserveNativeBounds(file,{present:true,value:external},fs));
    assert.equal(await fs.readFile(file,'utf8'),'broken');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('installed entry exports cached runtime and native helper is standalone',async context=>{
  const {parse}=await parser();parse(`(${nativeWindowDefaults.toString()})`,{ecmaVersion:'latest'});
  let archive;try{archive=await openAsar('/Applications/ChatGPT.app');}catch(error){if(error.code==='ENOENT'){context.skip('Official host unavailable');return;}throw error;}
  try{
    const source=await archive.read(archive.entries.find(e=>e.path===reviewedHumanRuntime.path));
    assert.equal(createHash('sha256').update(source).digest('hex'),reviewedHumanRuntime.sha256);
    assert.match(source,/export\{h as __webpack_require__\}/);
  }finally{await archive.close();}
});

test('native initialRoute mobile anchor stays outside human features and numbers',()=>{
  for(const route of ['/?codexPlusMobileAnchor=agent','/local/thread?codexPlusMobileAnchor=agent','/local/thread?x=1&codexPlusMobileAnchor=agent']){
    const url=new URL('app://-/index.html');url.searchParams.set('initialRoute',route);assert.equal(isHumanWindowURL(url.href),false);
  }
  assert.equal(isHumanWindowURL('app://-/index.html?codexPlusMobileAnchor=agent'),false);
  assert.equal(isHumanWindowURL('app://-/index.html?initialRoute=%2Flocal%2Fthread%3FcodexPlusHumanWindow%3Dhuman'),true);
});

test('a native New Window at the same frame retains the established human target',()=>{
  const pages=[{target:'external',frame:external},{target:'native-new',frame:external},{target:'right',frame:right}];
  const frames=[{...external,number:1},{...right,number:2}],previous={external:1,right:2};
  const preferred=preferredHumanNumbers(pages,frames,JSON.parse(JSON.stringify(previous)));
  assert.deepEqual(preferred,previous);
  assert.deepEqual(allocateWindowNumbers(pages.map(p=>p.target),{external:1,'native-new':3,right:2},preferred,[1,2]),{external:1,right:2,'native-new':3});
});
