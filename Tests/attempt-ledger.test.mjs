import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAttemptLedger} from '../Sources/CodexPlus/Resources/attempt-ledger.mjs';
function io(own,legacy){const files=new Map([['legacy',legacy],...own===undefined?[]:[['own',own]]]),writes=[];return {files,writes,async readFile(p){if(!files.has(p)){const e=Error('missing');e.code='ENOENT';throw e;}return files.get(p);},async mkdir(){},async writeFile(p,v){writes.push(p);files.set(p,v);},async rename(a,b){files.set(b,files.get(a));files.delete(a);}};}
test('independent journal imports unknown keys without writing the legacy source',async()=>{
 const disk=io(undefined,'["unknown-original","known"]');assert.deepEqual(await loadAttemptLedger(disk,'own','legacy'),['unknown-original','known']);assert.equal(disk.files.get('legacy'),'["unknown-original","known"]');assert.deepEqual(disk.writes,['own.tmp']);
});
test('existing independent and legacy journals form a union; corrupted or missing legacy never enables an empty journal',async()=>{
 const disk=io('["new","unknown-original"]','["unknown-original","old"]');assert.deepEqual(await loadAttemptLedger(disk,'own','legacy'),['new','unknown-original','old']);
 for(const value of ['broken','{}','[1]',undefined]){const bad=io(undefined,value);if(value===undefined)bad.files.delete('legacy');await assert.rejects(loadAttemptLedger(bad,'own','legacy'));assert.equal(bad.writes.length,0);}
});
