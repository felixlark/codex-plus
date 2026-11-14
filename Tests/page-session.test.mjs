import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initializePageSession} from '../Sources/CodexPlus/Resources/page-session.mjs';

test('paused page dispatches every hook and resume before waiting for any setup acknowledgement', async () => {
  const sent = [], held = [];
  const startup = initializePageSession((method, params) => {
    sent.push({method, params});
    if (method === 'Runtime.runIfWaitingForDebugger') return Promise.resolve({});
    return new Promise(resolve => held.push(() => resolve(method === 'Page.addScriptToEvaluateOnNewDocument' ? {identifier: 'script'} : {})));
  }, {patterns: [{urlPattern: 'app://-/index.html*', resourceType: 'Document'}], bindings: ['bridge'], source: 'source'});
  assert.deepEqual(sent.map(c => c.method), ['Page.enable', 'Runtime.enable', 'Fetch.enable', 'Network.enable', 'Network.setCacheDisabled', 'Runtime.addBinding', 'Page.addScriptToEvaluateOnNewDocument', 'Runtime.runIfWaitingForDebugger']);
  let probing = false; startup.then(() => { probing = true; });
  await Promise.resolve(); assert.equal(probing, false);
  for (const acknowledge of held) acknowledge();
  assert.equal(await startup, 'script'); assert.equal(probing, true);
});

test('setup failure still dispatches resume and rejects before page probing', async () => {
  const sent = [];
  const startup = initializePageSession(method => {
    sent.push(method); return method === 'Page.enable' ? Promise.reject(Error('closed')) : Promise.resolve({});
  });
  await assert.rejects(startup, /closed/);
  assert.deepEqual(sent, ['Page.enable', 'Runtime.enable', 'Runtime.runIfWaitingForDebugger']);
});
