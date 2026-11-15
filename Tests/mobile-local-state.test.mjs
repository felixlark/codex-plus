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
    assert.ok(f.messages.some(message => message.operation === 'local-state-warning'));
    assert.equal(f.messages.some(message => message.operation === 'refs-warning'), false);
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

test('reviewed per-thread activity and account-scoped profile keys persist while malformed identities are rejected', async () => {
  const f = setup();
  try {
    const entries = [
      ['aeon-last-activity-v1:thread-id', 123456],
      ['aeon-appearance-v2:thread-id', {avatar: 'sunglasses', color: 'blue'}],
      ['cloud-aeon-profiles-v1:["account","user"]', {profile: {id: 'own-profile'}, status: 'available'}],
    ];
    for (const [key, value] of entries) f.api.handleMessage({type: 'persisted-atom-update', key, value});
    await flush(); await flush(); await flush();
    const saved = f.messages.filter(m => m.operation === 'local-state-save').at(-1).state;
    for (const [key, value] of entries) assert.deepEqual(saved.atoms[key], value);
    for (const key of ['cloud-aeon-profiles-v1:[]', 'cloud-aeon-profiles-v1:["a",1]', 'cloud-aeon-profiles-v1:["a",""]', 'cloud-aeon-profiles-v1:{"token":"PRIVATE"}']) {
      f.api.handleMessage({type: 'persisted-atom-update', key, value: 'PRIVATE_VALUE'});
    }
    await flush(); await flush();
    const warnings = f.messages.filter(m => m.operation === 'local-state-warning');
    assert.equal(warnings.length, 4);
    assert.ok(warnings.every(m => m.key === 'cloud-aeon-profiles-v1'));
    assert.equal(JSON.stringify(warnings).includes('PRIVATE'), false);
    assert.equal(f.messages.filter(m => m.operation === 'local-state-save').length, 3);
  } finally { f.cleanup(); }
});

test('model cache uses exactly two encoded identity segments and personal history stays phone-local', async () => {
  const f = setup();
  try {
    const entries = [
      ['chatgpt-work-models-v1/user%2Fid/account', {fetchedAt: 123, response: {models: [{slug: 'real-model'}]}}],
      ['prompt-history', {global: [{plain: '中文🙂', document: {type: 'doc'}}]}],
      ['thread-user-activity-times-v1', {'["local","thread"]': 123}],
      ['thread-descriptions-v1', {thread: 'own chat summary'}],
    ];
    for (const [key, value] of entries) f.api.handleMessage({type: 'persisted-atom-update', key, value});
    await flush(); await flush(); await flush();
    const saved = f.messages.filter(m => m.operation === 'local-state-save').at(-1).state;
    for (const [key, value] of entries) assert.deepEqual(saved.atoms[key], value);
    for (const key of ['chatgpt-work-models-v1/', 'chatgpt-work-models-v1/a', 'chatgpt-work-models-v1/a/', 'chatgpt-work-models-v1/a/b/c', 'chatgpt-work-models-v1/%GG/b', 'chatgpt-work-models-v1/%ED%A0%80/b', 'prompt-history-extra']) {
      f.api.handleMessage({type: 'persisted-atom-update', key, value: 'PRIVATE_VALUE'});
    }
    await flush(); await flush(); await flush();
    assert.equal(f.messages.filter(m => m.operation === 'local-state-save').length, entries.length);
    const warnings = f.messages.filter(m => m.operation === 'local-state-warning');
    assert.equal(warnings.length, 7);
    assert.ok(warnings.slice(0,6).every(m => m.key === 'chatgpt-work-models-v1'));
    assert.equal(JSON.stringify(warnings).includes('PRIVATE'), false);
  } finally { f.cleanup(); }
});

test('business account stubs survive the phone-only service session and preserve callback leases', async t => {
  const rpc = await rpcLibrary(t); if (!rpc) return;
  const f = setup(), wire = new MessageChannel();
  class Lease extends rpc.TF {}
  class Account extends rpc.TF {
    getAccount() { return {account: {type: 'chatgpt'}, requiresOpenaiAuth: true}; }
    getAuthMethod() { return 'chatgpt'; }
    subscribeAuthStatus(callback) { callback({authMethod: 'chatgpt'}); return new Lease(); }
  }
  class Managers extends rpc.TF { openAccount() { return new Account(); } }
  class AccountInfo extends rpc.TF { readAccountInfo() { return {status: 'ready', data: {hasChatGptToken: true}}; } }
  class AppInfo extends rpc.TF {
    getSystemInfo() { return {platform: 'darwin', osRelease: '25.0.0', isCodexRunningInsideWsl: false}; }
    getLocaleInfo() { return {ideLocale: 'en-US', systemLocale: 'zh-CN'}; }
    getPackagingInfo() { return {isPackaged: true}; }
  }
  class HttpFetch extends rpc.TF {
    fetch() { return {response: new Response(JSON.stringify({ready: true}), {headers: {'content-type': 'application/json'}})}; }
  }
  class Root extends rpc.TF { get services() { return {appServerManagers: new Managers(), accountInfo: new AccountInfo(), accessInputs: new AccountInfo(), appInfo: new AppInfo(), httpFetch: new HttpFetch()}; } }
  const server = rpc.ab(wire.port1, new Root()), client = rpc.ab(wire.port2, new rpc.TF());
  const original = await client.services;
  const module = {appServices: original, setAppServices(value) { this.appServices = value; }};
  try {
    await f.api.install(module, rpc, () => ({}));
    assert.equal((await module.appServices.accountInfo.readAccountInfo()).data.hasChatGptToken, true);
    assert.equal((await module.appServices.appInfo.getSystemInfo()).platform, 'darwin');
    assert.equal((await module.appServices.appInfo.getLocaleInfo()).systemLocale, 'zh-CN');
    assert.equal((await module.appServices.appInfo.getPackagingInfo()).isPackaged, true);
    const response = await module.appServices.httpFetch.fetch('phone-request', {method: 'GET'});
    assert.deepEqual(await response.response.json(), {ready: true});
    response[Symbol.dispose]?.();
    await assert.rejects(async () => await module.appServices.appInfo.getThirdPartyNotices());
    assert.equal(module.appServices.accessInputs, undefined);
    await assert.rejects(async () => await module.appServices.accountInfo.readLocalChatGptAuth());
    const account = module.appServices.appServerManagers.openAccount('local');
    assert.equal((await account.getAccount({priority: 'critical'})).requiresOpenaiAuth, true);
    assert.equal(await account.getAuthMethod({priority: 'critical'}), 'chatgpt');
    let observed;
    const lease = await account.subscribeAuthStatus(value => { observed = value.authMethod; });
    await flush(); assert.equal(observed, 'chatgpt');
    lease[Symbol.dispose](); account[Symbol.dispose]();
  } finally {
    f.cleanup(); original[Symbol.dispose]?.(); client[Symbol.dispose]?.(); server[Symbol.dispose]?.(); wire.port1.close(); wire.port2.close();
  }
});

test('original settings initialization reads all values and retains a read-only subscription across both RPC sessions', async t => {
  const rpc = await rpcLibrary(t); if (!rpc) return;
  const f = setup(), channel = new MessageChannel();
  let notify, disposed = 0;
  class Watch extends rpc.TF {
    constructor(callback) { super(); this.callback = callback; }
    [Symbol.dispose]() { this.callback[Symbol.dispose](); disposed++; }
  }
  class Settings extends rpc.TF {
    readAll() { return {values: {'conversation-detail-mode': 'normal'}}; }
    subscribe(key, callback) {
      const held = callback.dup(); notify = effective => held({effective}); return new Watch(held);
    }
    write() { throw Error('Mac settings writes must remain inaccessible'); }
  }
  class Root extends rpc.TF { get services() { return {settings: new Settings()}; } }
  const server = rpc.ab(channel.port1, new Root()), client = rpc.ab(channel.port2, new rpc.TF());
  const original = await client.services;
  const module = {appServices: original, setAppServices(value) { this.appServices = value; }};
  try {
    await f.api.install(module, rpc, () => ({}));
    assert.equal((await module.appServices.settings.readAll()).values['conversation-detail-mode'], 'normal');
    let observed;
    const pending = module.appServices.settings.subscribe('conversation-detail-mode', value => { observed = value.effective; });
    const lease = await pending;
    await notify('detailed'); await flush();
    assert.equal(observed, 'detailed');
    await assert.rejects(async () => await module.appServices.settings.write('conversation-detail-mode', 'changed'));
    lease[Symbol.dispose](); pending[Symbol.dispose]();
    await module.appServices.settings.readAll();
    for (let i=0;i<8;i++) await flush(); assert.equal(disposed, 1);
  } finally { f.cleanup(); original[Symbol.dispose]?.(); client[Symbol.dispose]?.(); server[Symbol.dispose]?.(); channel.port1.close(); channel.port2.close(); }
});

test('original evaluation publication reaches permission readiness with its real disposable subscription', async t => {
  const rpc = await rpcLibrary(t); if (!rpc) return;
  const f = setup(), channel = new MessageChannel();
  let notify, disposed = 0;
  class Subscription extends rpc.TF {
    constructor(callback) { super(); this.callback = callback; }
    [Symbol.dispose]() { this.callback[Symbol.dispose](); disposed++; }
  }
  class Evaluations extends rpc.TF {
    subscribe(callback) {
      const held = callback.dup(); notify = value => held(value);
      void held({hasEvaluations: undefined}); return new Subscription(held);
    }
    hasReadyExecutionAssignments() { return true; }
    readExecutionAssignments() { return {permissionRefresh: {enabled: true}}; }
    publish() { throw Error('Phone must not publish Mac evaluations'); }
  }
  class Root extends rpc.TF { get services() { return {statsigEvaluations: new Evaluations()}; } }
  const server = rpc.ab(channel.port1, new Root()), client = rpc.ab(channel.port2, new rpc.TF());
  const original = await client.services;
  const module = {appServices: original, setAppServices(value) { this.appServices = value; }};
  try {
    await f.api.install(module, rpc, () => ({}));
    const snapshots = [];
    const pending = module.appServices.statsigEvaluations.subscribe(value => { snapshots.push(value); });
    const lease = await pending;
    await notify({hasEvaluations: false});
    const ready = {hasEvaluations: true, defaultEnableFeatures: {guardian_approval: true}, executionValues: {permissionRefresh: {enabled: true}}};
    await notify(ready); await flush();
    assert.deepEqual(snapshots, [{hasEvaluations: undefined}, {hasEvaluations: false}, ready]);
    assert.equal(await module.appServices.statsigEvaluations.hasReadyExecutionAssignments(), true);
    assert.deepEqual(await module.appServices.statsigEvaluations.readExecutionAssignments(), {permissionRefresh: {enabled: true}});
    await assert.rejects(async () => await module.appServices.statsigEvaluations.publish({}));
    lease[Symbol.dispose](); pending[Symbol.dispose]();
    await module.appServices.statsigEvaluations.hasReadyExecutionAssignments();
    for (let i=0;i<8;i++) await flush(); assert.equal(disposed, 1);
  } finally { f.cleanup(); original[Symbol.dispose]?.(); client[Symbol.dispose]?.(); server[Symbol.dispose]?.(); channel.port1.close(); channel.port2.close(); }
});

test('phone renderer readiness waits for the original local phase without advancing the Mac startup service', async t => {
  const rpc = await rpcLibrary(t); if (!rpc) return;
  const f = setup(); let nativeReads = 0;
  const forbidden = () => { throw Error('Must not advance Mac startup'); };
  const module = {appServices: {startup: {whenReady: forbidden, reach: forbidden, isSentryEnabled() { nativeReads++; return false; }}}, setAppServices(value) { this.appServices = value; }};
  try {
    await f.api.install(module, rpc, () => ({}));
    const pending = module.appServices.startup.whenReady(); let completed = 0;
    pending.then(() => { completed++; });
    await module.appServices.startup.reach('first_content_visible');
    await flush(); assert.equal(completed, 0);
    await module.appServices.startup.reach('renderer_ready'); await pending;
    await module.appServices.startup.reach('renderer_ready'); await flush();
    assert.equal(completed, 1);
    assert.equal(await module.appServices.startup.isSentryEnabled(), false); assert.equal(nativeReads, 1);
    await assert.rejects(async () => await module.appServices.startup.reach('invented'));
    pending[Symbol.dispose]();
  } finally { f.cleanup(); }
});


test('HTTP bodies stream across both original RPC sessions and cancel only phone-owned requests', {timeout: 10000}, async t => {
  const rpc = await rpcLibrary(t); if (!rpc) return;
  const f = setup(), wire = new MessageChannel();
  const cancelled = [], bodyCancelled = [], enc = new TextEncoder();
  let progress;
  class HTTP extends rpc.TF {
    async fetch(id, request, callback) {
      if (callback) { await callback({loaded: 3}); progress = true; }
      if (id === 'late') await new Promise(resolve => { late = resolve; });
      if (id === 'error') return {error: 'test failure', status: 503};
      let index = 0;
      return {response: new Response(new ReadableStream({
        pull(controller) { if (index < 2) controller.enqueue(enc.encode(['中文', '🙂'][index++])); else if (id === 'normal') controller.close(); },
        cancel() { bodyCancelled.push(id); },
      }), {status: 201, headers: {'x-test': 'original'}})};
    }
    cancel(id) { cancelled.push(id); }
  }
  let late;
  class Root extends rpc.TF { get services() { return {httpFetch: new HTTP()}; } }
  const server = rpc.ab(wire.port1, new Root()), client = rpc.ab(wire.port2, new rpc.TF());
  const original = await client.services;
  const module = {appServices: original, setAppServices(value) { this.appServices = value; }};
  try {
    await f.api.install(module, rpc, () => ({}));
    let loaded;
    const normal = await module.appServices.httpFetch.fetch('normal', {method: 'GET'}, value => { loaded = value.loaded; });
    assert.equal(normal.response.status, 201); assert.equal(normal.response.headers.get('x-test'), 'original');
    assert.equal(await normal.response.text(), '中文🙂'); assert.equal(loaded, 3); assert.equal(progress, true); normal[Symbol.dispose]();
    await module.appServices.httpFetch.cancel('unknown'); await flush(); assert.deepEqual(cancelled, []);
    const active = await module.appServices.httpFetch.fetch('active', {method: 'GET'});
    const reader = active.response.body.getReader(); assert.equal(new TextDecoder().decode((await reader.read()).value), '中文');
    await reader.cancel(); active[Symbol.dispose]();
    for (let i=0;i<8;i++) await flush(); assert.equal(cancelled.filter(id => id === 'active').length, 1);
    const error = await module.appServices.httpFetch.fetch('error', {method: 'GET'}); assert.equal(error.status, 503); error[Symbol.dispose]();
    const delayed = module.appServices.httpFetch.fetch('late', {method: 'GET'});
    while (!late) await flush();
    const caught = Promise.resolve(delayed).then(() => null, error => error);
    await module.appServices.httpFetch.cancel('late'); late();
    assert.ok(await caught); for (let i=0;i<8;i++) await flush();
    assert.equal(cancelled.filter(id => id === 'late').length, 1);
  } finally { f.cleanup(); original[Symbol.dispose]?.(); client[Symbol.dispose]?.(); server[Symbol.dispose]?.(); wire.port1.close(); wire.port2.close(); }
});
