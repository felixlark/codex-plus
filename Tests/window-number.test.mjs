import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allocateWindowNumbers} from '../Sources/CodexPlus/Resources/window-number.mjs';

test('two windows get distinct numbers stable across target order and saved-state restart',()=>{
  const first=allocateWindowNumbers(['external','right']);
  assert.deepEqual(first,{external:1,right:2});
  assert.deepEqual(allocateWindowNumbers(['right','external'],JSON.parse(JSON.stringify(first))),{right:2,external:1});
});
test('closing a window releases its number without renumbering survivors',()=>{
  const previous={external:1,right:2};
  assert.deepEqual(allocateWindowNumbers(['right'],previous),{right:2});
  assert.deepEqual(allocateWindowNumbers(['right','new'],previous),{right:2,new:1});
  assert.deepEqual(previous,{external:1,right:2});
});
test('invalid or duplicate saved numbers recover to a unique positive allocation',()=>{
  const targets=['a','b','c','d','e','f'];
  const repaired=allocateWindowNumbers(targets,{a:2,b:2,c:0,d:-1,e:1.2,f:'3'});
  assert.equal(repaired.a,2);
  assert.equal(new Set(Object.values(repaired)).size,targets.length);
  assert.ok(Object.values(repaired).every(n=>Number.isSafeInteger(n)&&n>0));
  for(const bad of [null,[],3,'bad'])assert.deepEqual(allocateWindowNumbers(['a','b'],bad),{a:1,b:2});
});
test('repeated targets are one window and an empty live list retires all allocations',()=>{
  assert.deepEqual(allocateWindowNumbers(['a','a','b']),{a:1,b:2});
  assert.deepEqual(allocateWindowNumbers([],{a:1,b:2}),{});
});
