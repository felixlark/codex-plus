// Phone UI state has one local owner. Mac drafts, selection and window state
// never seed this store and are never overwritten by these messages.
export function installMobileLocalState(bootstrap, selectServices) {
  let state = bootstrap ?? {atoms: {}, application: {}}, sequence = 0, updateRecord;
  let recordReady;
  const configured = new Promise(resolve => { recordReady = resolve; });
  const pending = new Map();
  const own = (object, key) => Object.hasOwn(object, key) ? object[key] : undefined;
  function validKey(key) {
    if (typeof key !== 'string') return false;
    try { encodeURIComponent(key); return true; } catch { return false; }
  }
  function put(object, key, value) {
    Object.defineProperty(object, key, {value, writable: true, enumerable: true, configurable: true});
  }
  // Same exceptions as the pinned original host: this phone is not the Mac's
  // primary tab-persistence owner. Actual unread state uses threadReadState.
  function ignoredAtom(key) {
    return key === 'unread-thread-ids-by-host-v1' || key === 'page-sidebar-expansion-v1'
      || key.startsWith('thread-browser-tabs-v1:') || key.startsWith('thread-tab-routes-v1:');
  }
  function cacheRevision(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return typeof value.accountId === 'string' && (typeof value.userId === 'string' || value.userId === null)
      && typeof value.hostId === 'string' && (typeof value.revision === 'string' || value.revision === null)
      && (value.refreshStartedAtMs === undefined || typeof value.refreshStartedAtMs === 'number' && Number.isFinite(value.refreshStartedAtMs))
      && (value.removalBaseRevision === undefined || value.removalBaseRevision === null || typeof value.removalBaseRevision === 'string');
  }
  function acceptsReplacement(key, old, incoming) {
    // Original 71817/erC guard precedes its record reducer. Undefined raw value
    // from recordUpdate intentionally bypasses whole-cache revision comparison.
    if (key !== 'cloud-aeon-sidebar-cache-v1' || incoming == null || !cacheRevision(old) || !cacheRevision(incoming)) return true;
    if (old.accountId !== incoming.accountId || old.userId !== incoming.userId || old.hostId !== incoming.hostId) return true;
    return incoming.removalBaseRevision !== undefined
      ? incoming.removalBaseRevision === old.revision && incoming.refreshStartedAtMs === old.refreshStartedAtMs
      : incoming.revision === old.revision && (incoming.refreshStartedAtMs ?? 0) > (old.refreshStartedAtMs ?? 0);
  }
  let updates = Promise.resolve();
  function enqueue(operation) {
    const result = updates.catch(() => {}).then(operation);
    updates = result; void result.catch(warning); return result;
  }
  function native(operation, extra = {}) {
    const id = `local:${++sequence}`;
    return new Promise((resolve, reject) => {
      pending.set(id, {resolve, reject});
      window.webkit.messageHandlers.lifecycle.postMessage({connection: globalThis.__codexPlusMobileBootstrap.connection, operation, id, ...extra});
    });
  }
  function dispatch(data) { window.dispatchEvent(new MessageEvent('message', {data, source: null})); }
  function warning() {
    // Opaque original keys can themselves contain identities. Native logs only
    // OSStatus, byte count/timing and this static label, never keys or values.
    void native('local-state-warning', {key: 'phone-kv'}).catch(() => {});
  }
  async function commit(change) {
    const next = JSON.parse(JSON.stringify(state));
    change(next);
    await native('local-state-save', {state: next});
    state = next;
    return next;
  }
  async function update(message) {
    const key = message.key;
    if (!validKey(key)) {
      const error = Error('Invalid phone atom key'); error.phoneStateKey = key; throw error;
    }
    if (message.recordUpdate) await configured;
    const current = own(state.atoms, key);
    if (!acceptsReplacement(key, current, message.value)) {
      dispatch({type: 'persisted-atom-updated', key, value: current, deleted: false}); return;
    }
    let next;
    try {
      next = await commit(next => {
        if (message.recordUpdate) put(next.atoms, key, updateRecord(own(next.atoms, key) ?? (message.recordUpdate.legacyStorageKey == null ? undefined : own(next.atoms, message.recordUpdate.legacyStorageKey)), message.recordUpdate));
        else if (message.deleted) delete next.atoms[key];
        else put(next.atoms, key, message.value);
      });
    } catch (error) { error.phoneStateKey = key; throw error; }
    dispatch({type: 'persisted-atom-updated', key, value: message.deleted ? null : next.atoms[key], deleted: !!message.deleted});
  }
  function handleMessage(message) {
    if (message?.type === 'persisted-atom-sync-request') {
      enqueue(() => dispatch({type: 'persisted-atom-sync', state: JSON.parse(JSON.stringify(state.atoms)), canWritePrimaryWindowTabPersistence: false}));
      return {handled: true};
    }
    if (message?.type === 'persisted-atom-update') {
      if (typeof message.key === 'string' && ignoredAtom(message.key)) return {handled: true};
      enqueue(() => update(message)); return {handled: true};
    }
    if (message?.type === 'persisted-atom-reset') {
      enqueue(async () => { await commit(next => { next.atoms = {}; }); dispatch({type: 'persisted-atom-sync', state: {}, canWritePrimaryWindowTabPersistence: false}); });
      return {handled: true};
    }
    // These are desktop shell notifications, not backend business calls. The
    // phone owns its document/keyboard lifecycle and never changes Mac state.
    if (new Set(['ready', 'app-shell-shortcut-state-changed', 'keyboard-layout-map-changed', 'electron-window-zoom-changed',
      'electron-set-window-mode', 'electron-set-badge-count', 'power-save-blocker-set', 'tray-menu-threads-changed',
      'electron-desktop-features-changed', 'remote-hosted-pip-active-thread-changed']).has(message?.type)) return {handled: true};
    return {handled: false};
  }
  const owned = [];
  async function install(module, rpc, applyRecordUpdate) {
    updateRecord = applyRecordUpdate; recordReady();
    const original = module.appServices;
    class ApplicationState extends rpc.TF {
      async read(key) { await updates.catch(() => {}); return {value: validKey(key) ? own(state.application, key) : undefined}; }
      async write(key, value) {
        if (!validKey(key)) throw Error('Invalid phone application state key');
        await enqueue(async () => {
          try { return await commit(next => { put(next.application, key, value); }); }
          catch (error) { error.phoneStateKey = key; throw error; }
        });
        dispatch({type: 'global-state-updated', keys: [key]}); return {success: true};
      }
    }
    const application = new ApplicationState();
    // The original renderer reports its own phase through this service. The
    // phone gate never advances the Mac window's startup or invents host timing.
    let acknowledgeRenderer;
    const rendererReady = new Promise(resolve => { acknowledgeRenderer = resolve; });
    class Startup extends rpc.TF {
      whenReady() { return rendererReady; }
      reach(phase) {
        if (!['renderer_ready', 'first_content_visible', 'background_ready'].includes(phase)) throw Error('Unsupported phone startup phase');
        if (phase === 'renderer_ready') acknowledgeRenderer();
      }
      isSentryEnabled() { return original.startup?.isSentryEnabled?.() ?? false; }
    }
    const startup = new Startup();
    class ProjectCatalog extends rpc.TF {
      readLocalProjects() { return original.projectCatalog.readLocalProjects(); }
      readRemoteProjects() { return original.projectCatalog.readRemoteProjects(); }
      async readSelection() { return (await application.read('selected-project')).value; }
    }
    class WindowTitle extends rpc.TF { setTitle(title) { document.title = title ?? 'Codex'; } }
    class WindowNavigation extends rpc.TF {
      setHistorySwipeNavigationState(value) { globalThis.__codexPlusMobileHistorySwipe = value; }
      // Desktop DevTools have no iOS equivalent. Keep no callback references or
      // fabricated events; WebKit inspection remains a native developer action.
      subscribeDevToolsFirstOpened() {}
      unsubscribeDevToolsFirstOpened() {}
      setDevToolsInsetBackgroundColor() {}
      navigateInOwnerWindow(request) { return native('local-navigate', {route: request.path}); }
    }
    class Clipboard extends rpc.TF {
      get bookmark() { return undefined; }
      readText() { return native('clipboard-read'); }
      writeText(text) { return native('clipboard-write', {text}); }
    }
    const selected = selectServices(original, rpc.TF);
    owned.push(() => selected[Symbol.dispose]?.());
    class Services extends rpc.TF {
      get services() {
        return {...selected, applicationState: application, startup, projectCatalog: new ProjectCatalog(),
          windowTitle: new WindowTitle(), windowNavigation: new WindowNavigation(), clipboard: new Clipboard()};
      }
    }
    const channel = new MessageChannel();
    const server = rpc.ab(channel.port1, new Services()), client = rpc.ab(channel.port2, new rpc.TF());
    const services = await client.services;
    module.setAppServices(services);
    owned.push(() => { services[Symbol.dispose]?.(); client[Symbol.dispose]?.(); server[Symbol.dispose]?.(); channel.port1.close(); channel.port2.close(); });
  }
  globalThis.__codexPlusMobileLocal = {handleMessage, install, native,
    initialSidebarBootstrap(sidebar) {
      if (sidebar == null) return sidebar;
      if (!Array.isArray(sidebar.globalStateEntries)) throw Error('Unreviewed original sidebar bootstrap');
      // Genuine project catalog/assignment metadata stays on its real backend.
      // The Mac's current UI selection must never seed this phone's query cache.
      return {...sidebar, globalStateEntries: [
        ...sidebar.globalStateEntries.filter(entry => entry.key !== 'selected-project'),
        {key: 'selected-project', value: own(state.application, 'selected-project')},
      ]};
    },
    resolve(message) {
      const call = pending.get(message.id); if (!call) return;
      pending.delete(message.id); message.ok ? call.resolve(message.value) : call.reject(Error('Phone local operation failed'));
    },
    close() { for (const dispose of owned.splice(0)) dispose(); },
  };
  window.addEventListener('pagehide', () => globalThis.__codexPlusMobileLocal.close(), {once: true});
}
