import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {selectMobileServices} from '../Sources/CodexPlus/Resources/mobile-services.mjs';
import {installMobileLocalState} from '../Sources/CodexPlus/Resources/mobile-local-state.mjs';
import {openAsar} from '../scripts/inspect-sidebar-model.mjs';
const keys = JSON.parse(await fs.readFile(new URL('../mobile/Shared/MobileStateKeys.json', import.meta.url)));
const flush = () => new Promise(resolve => setImmediate(resolve));
async function rpcLibrary(t) {
  try { await fs.access('/Applications/ChatGPT.app/Contents/Resources/app.asar'); }
  catch { t.skip('Requires the pinned installed original RPC library'); return null; }
  const archive = await openAsar('/Applications/ChatGPT.app');
  try {
    const source = await archive.read(archive.entries.find(e => e.path === 'webview/assets/async/648541.32f5c72f21.js'));
    const module = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
    const exports = {}, require = id => { throw Error('Unselected dependency: ' + id); };
    require.d = (target, getters, values) => { Object.assign(target, values); for (const [key, get] of Object.entries(getters ?? {})) Object.defineProperty(target, key, {get}); };
    module.__webpack_modules__.ZG9f({}, exports, require); return exports;
  } finally { await archive.close(); }
}
function setup({rejectSave = () => false} = {}) {
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  const messages = [], events = [], window = new EventTarget();
  window.webkit = {messageHandlers: {lifecycle: {postMessage: value => {
    messages.push(value); queueMicrotask(() => globalThis.__codexPlusMobileLocal.resolve({id: value.id, ok: value.operation === 'local-state-save' ? !rejectSave(value) : true}));
  }}}};
  window.addEventListener('message', event => events.push(event.data));
  globalThis.window = window; globalThis.document = {title: 'Phone'};
  globalThis.__codexPlusMobileBootstrap = {connection: 'phone-epoch'};
  installMobileLocalState({atoms: {}, application: {}}, keys, selectMobileServices);
  return {messages, events, api: globalThis.__codexPlusMobileLocal, cleanup() { globalThis.__codexPlusMobileLocal.close(); globalThis.window = oldWindow; globalThis.document = oldDocument; delete globalThis.__codexPlusMobileLocal; }};
}

test('the actual original RPC loopback isolates project selection, title and drafts from Mac UI services', async t => {
  const rpc = await rpcLibrary(t); if (!rpc) return;
  const f = setup(); let lists = 0;
  const forbidden = () => { throw Error('Mac UI service must not be called'); };
  const module = {appServices: {projectCatalog: {readLocalProjects: () => { lists++; return [{id: 'real-project'}]; }, readRemoteProjects: () => [], readSelection: forbidden},
    applicationState: {read: forbidden, write: forbidden}, windowTitle: {setTitle: forbidden}, windowNavigation: {navigateInOwnerWindow: forbidden}, clipboard: {writeText: forbidden}, downloads: {open: forbidden}, fileAttachments: {pickFiles: forbidden}},
    setAppServices(services) { this.appServices = services; }};
  try {
    await f.api.install(module, rpc, (base, update) => ({...(base ?? {}), ...update.entries}));
    assert.deepEqual(await module.appServices.projectCatalog.readLocalProjects(), [{id: 'real-project'}]); assert.equal(lists, 1);
    assert.equal(await module.appServices.projectCatalog.readSelection(), undefined);
    assert.equal((await module.appServices.applicationState.read('__proto__')).value, undefined);
    assert.equal(module.appServices.downloads, undefined); assert.equal(module.appServices.fileAttachments, undefined);
    assert.equal((await module.appServices.applicationState.write('selected-project', {type: 'local', projectId: 'phone-project'})).success, true);
    assert.equal((await module.appServices.projectCatalog.readSelection()).projectId, 'phone-project');
    assert.deepEqual(f.events.find(event => event.type === 'global-state-updated').keys, ['selected-project']);
    await module.appServices.windowTitle.setTitle('Phone test'); assert.equal(document.title, 'Phone test');
    f.api.handleMessage({type: 'persisted-atom-update', key: 'composer-prompt-drafts-v2', value: {'own-thread': '中文🙂'}, deleted: false});
    await flush(); await flush();
    const saves = f.messages.filter(m => m.operation === 'local-state-save');
    assert.equal(saves.at(-1).state.atoms['composer-prompt-drafts-v2']['own-thread'], '中文🙂');
    f.api.handleMessage({type: 'persisted-atom-sync-request'}); await flush();
    assert.equal(f.events.at(-1).state['composer-prompt-drafts-v2']['own-thread'], '中文🙂');
    assert.equal(f.api.handleMessage({type: 'open-in-new-window'}).handled, false);
  } finally { f.cleanup(); }
});


test('a rejected atomic write is neither published nor carried into the next committed state', async t => {
  const rpc = await rpcLibrary(t); if (!rpc) return;
  let reject = true;
  const f = setup({rejectSave: () => reject});
  const module = {appServices: {projectCatalog: {readLocalProjects: () => [], readRemoteProjects: () => []}}, setAppServices(value) { this.appServices = value; }};
  try {
    await f.api.install(module, rpc, (base, update) => ({...(base ?? {}), ...update.entries}));
    await assert.rejects(async () => await module.appServices.applicationState.write('selected-project', {type: 'local', projectId: 'failed'}));
    assert.equal(await module.appServices.projectCatalog.readSelection(), undefined);
    f.api.handleMessage({type: 'persisted-atom-update', key: 'composer-prompt-drafts-v2', value: {thread: 'failed draft'}});
    await flush(); await flush();
    f.api.handleMessage({type: 'persisted-atom-sync-request'}); await flush();
    assert.equal(f.events.at(-1).state['composer-prompt-drafts-v2'], undefined);
    reject = false;
    await module.appServices.applicationState.write('selected-project', {type: 'local', projectId: 'committed'});
    const saved = f.messages.filter(m => m.operation === 'local-state-save').at(-1).state;
    assert.equal(saved.application['selected-project'].projectId, 'committed');
    assert.equal(saved.atoms['composer-prompt-drafts-v2'], undefined);
    // Conditional record updates and reset share the same receipt-order queue.
    f.api.handleMessage({type: 'persisted-atom-update', key: 'draft-thread-identities-v1', recordUpdate: {entries: {one: 'first'}}});
    f.api.handleMessage({type: 'persisted-atom-reset'});
    await flush(); await flush(); await flush();
    assert.deepEqual(f.messages.filter(m => m.operation === 'local-state-save').at(-1).state.atoms, {});
  } finally { f.cleanup(); }
});
