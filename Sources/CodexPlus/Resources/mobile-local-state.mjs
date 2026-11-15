// Phone UI state has one local owner. Mac drafts, selection and window state
// never seed this store and are never overwritten by these messages.
export function installMobileLocalState(bootstrap, keys, selectServices) {
  let state = bootstrap ?? {atoms: {}, application: {}}, sequence = 0, updateRecord;
  let recordReady;
  const configured = new Promise(resolve => { recordReady = resolve; });
  const pending = new Map();
  const atomKeys = new Set(keys.atoms), applicationKeys = new Set(keys.application);
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
    void native('local-state-warning', typeof key === 'string' ? {key} : {}).catch(() => {});
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
    if (!atomKeys.has(key) && !(keys.atomPrefixes ?? []).some(prefix => key.startsWith(prefix) && /^[a-zA-Z0-9_-]+$/.test(key.slice(prefix.length)))) {
      const error = Error('Unsupported phone atom key'); error.phoneStateKey = key; throw error;
    }
    if (message.recordUpdate) await configured;
    const next = await commit(next => {
      if (message.recordUpdate) next.atoms[key] = updateRecord(next.atoms[key] ?? next.atoms[message.recordUpdate.legacyStorageKey], message.recordUpdate);
      else if (message.deleted) delete next.atoms[key];
      else next.atoms[key] = message.value;
    });
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
        await enqueue(() => commit(next => { next.application[key] = value; }));
        dispatch({type: 'global-state-updated', keys: [key]}); return {success: true};
      }
    }
    const application = new ApplicationState();
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
    class Services extends rpc.TF {
      get services() {
        return {...selectServices(original, rpc.TF), applicationState: application, projectCatalog: new ProjectCatalog(),
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
