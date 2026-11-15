// Phone UI state has one local owner. Mac drafts, selection and window state
// never seed this store and are never overwritten by these messages.
export function installMobileLocalState(bootstrap, keys, selectServices) {
  let state = bootstrap ?? {atoms: {}, application: {}}, sequence = 0, updateRecord;
  let recordReady;
  const configured = new Promise(resolve => { recordReady = resolve; });
  const pending = new Map();
  const atomKeys = new Set(keys.atoms), applicationKeys = new Set(keys.application);
  function allowedAtom(key) {
    if (typeof key !== 'string') return false;
    if (atomKeys.has(key) || (keys.atomPrefixes ?? []).some(prefix => key.startsWith(prefix) && /^[a-zA-Z0-9_-]+$/.test(key.slice(prefix.length)))) return true;
    return (keys.identityAtomPrefixes ?? []).some(prefix => {
      if (!key.startsWith(prefix)) return false;
      try { const ids = JSON.parse(key.slice(prefix.length)); return Array.isArray(ids) && ids.length === 2 && ids.every(id => typeof id === 'string' && id.length > 0); }
      catch { return false; }
    });
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
  function warning(error) {
    const key = error?.phoneStateKey;
    // Dynamic keys can include a chat identity. Report only their static
    // protocol prefix, never the suffix or the associated persisted value.
    const prefix = typeof key === 'string' ? key.split(':')[0] : 'unknown-key';
    void native('local-state-warning', {key: prefix}).catch(() => {});
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
    if (!allowedAtom(key)) {
      const error = Error('Unsupported phone atom key'); error.phoneStateKey = key; throw error;
    }
    if (message.recordUpdate) await configured;
    let next;
    try {
      next = await commit(next => {
        if (message.recordUpdate) next.atoms[key] = updateRecord(next.atoms[key] ?? next.atoms[message.recordUpdate.legacyStorageKey], message.recordUpdate);
        else if (message.deleted) delete next.atoms[key];
        else next.atoms[key] = message.value;
      });
    } catch (error) { error.phoneStateKey = key; throw error; }
    dispatch({type: 'persisted-atom-updated', key, value: message.deleted ? null : next.atoms[key], deleted: !!message.deleted});
  }
  function handleMessage(message) {
    if (message?.type === 'persisted-atom-sync-request') {
      queueMicrotask(() => dispatch({type: 'persisted-atom-sync', state: JSON.parse(JSON.stringify(state.atoms)), canWritePrimaryWindowTabPersistence: false}));
      return {handled: true};
    }
    if (message?.type === 'persisted-atom-update') {
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
      read(key) { return {value: applicationKeys.has(key) && Object.hasOwn(state.application, key) ? state.application[key] : undefined}; }
      async write(key, value) {
        if (!applicationKeys.has(key)) throw Error(`Unsupported phone application state: ${key}`);
        await enqueue(async () => {
          try { return await commit(next => { next.application[key] = value; }); }
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
      readSelection() { return application.read('selected-project').value; }
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
    resolve(message) {
      const call = pending.get(message.id); if (!call) return;
      pending.delete(message.id); message.ok ? call.resolve(message.value) : call.reject(Error('Phone local operation failed'));
    },
    close() { for (const dispose of owned.splice(0)) dispose(); },
  };
  window.addEventListener('pagehide', () => globalThis.__codexPlusMobileLocal.close(), {once: true});
}
