// Installed in the dedicated original renderer or before the iOS original UI.
// Function dependencies are injected as source by Plus, never supplied by peers.
export function installMobileEndpoint(config, encode, decode) {
  if (globalThis.__codexPlusMobileEndpoint) throw Error('Mobile endpoint already installed');
  const phone = config.side === 'phone', original = phone ? null : window.electronBridge;
  const calls = new Map(), ports = new Map(), workers = new Map(), ids = new Map(), gitRequests = new Map();
  let sequence = 0, appPort, closed = false, outbound = Promise.resolve(), inbound = Promise.resolve();
  const binding = phone ? '__codexPlusMobileNativeSend' : '__codexPlusMobileOutbound';
  function send(message) {
    if (closed) return;
    outbound = outbound.then(() => { if (!closed) globalThis[binding](JSON.stringify({...message, connection: config.connection})); }).catch(() => close());
  }
  function sendValue(message, value) {
    if (closed) return;
    outbound = outbound.then(async () => {
      if (closed) return;
      const encoded = await encode(value);
      if (!closed) globalThis[binding](JSON.stringify({...message, value: encoded, connection: config.connection}));
    }).catch(() => close());
  }
  function fatal() { if (!closed) globalThis[binding](JSON.stringify({kind: 'fatal', connection: config.connection})); close(); }
  function invoke(method, args) {
    if (closed) return Promise.reject(Error('Connection closed; reconcile any submitted action before retrying'));
    const id = `${config.connection}:${++sequence}`;
    return new Promise((resolve, reject) => { calls.set(id, {resolve, reject}); sendValue({kind: 'call', id, method}, args); });
  }
  function attachPort(port, id) {
    if (ports.has(id)) throw Error('Duplicate mobile port');
    ports.set(id, port);
    port.onmessage = event => {
      sendValue({kind: 'port-frame', id}, event.data);
      if (event.data === null && appPort === id) fatal();
    };
    port.addEventListener('close', () => { if (appPort === id) fatal(); });
    port.onmessageerror = () => close();
    port.start();
  }
  function dispatch(data, transferred = [], sameWindow = false) {
    window.dispatchEvent(new MessageEvent('message', {data, ports: transferred, source: transferred.length || sameWindow ? window : null, origin: location.origin}));
  }
  const methods = new Set(['sendMessageFromView', 'acknowledgeChunkedMessage', 'sendWorkerMessageFromView', 'connectGitWorker', 'getFastModeRolloutMetrics']);
  async function receive(message) {
    if (closed) return;
    if (message.connection !== config.connection) return;
    switch (message.kind) {
      case 'call': {
        if (phone || !methods.has(message.method) || typeof message.id !== 'string') throw Error('Unsupported mobile call');
        let args = decode(message.value);
        if (!Array.isArray(args)) throw Error('Invalid call arguments');
        if (message.method === 'connectGitWorker') {
          if (args.length !== 1 || typeof args[0] !== 'string' || !args[0] || gitRequests.has(args[0])) throw Error('Invalid original Git connection');
          gitRequests.set(args[0], {phase: 'pending'});
        }
        if (message.method === 'sendMessageFromView' && args[0]?.type === 'mcp-request') {
          const request = args[0].request;
          if (!request || !['string', 'number'].includes(typeof request.id)) throw Error('Invalid original request');
          const id = `${config.connection}:${++sequence}`; ids.set(id, request.id);
          args = [{...args[0], request: {...request, id}}];
        }
        try {
          const result = await original[message.method](...args);
          if (message.method === 'connectGitWorker' && result === false) gitRequests.delete(args[0]);
          sendValue({kind: 'result', id: message.id, ok: true}, result);
        } catch { if (message.method === 'connectGitWorker') gitRequests.delete(args[0]); send({kind: 'result', id: message.id, ok: false}); }
        break;
      }
      case 'result': {
        if (!phone) throw Error('Unexpected mobile result');
        const call = calls.get(message.id); if (!call) return;
        calls.delete(message.id); message.ok ? call.resolve(decode(message.value)) : call.reject(Error('Original host call failed; check the original conversation before retrying'));
        break;
      }
      case 'port-open': {
        if (phone || appPort || typeof message.id !== 'string' || ports.has(message.id)) throw Error('Invalid app-host port');
        appPort = message.id;
        const channel = new MessageChannel(); attachPort(channel.port1, message.id);
        // This literal same-window handoff on our captured blank page cannot
        // address another window. The original preload checks event.source.
        if (location.href !== 'about:blank' || location.origin !== 'null' ||
            document.querySelector('meta[name="codex-plus-mobile-anchor"]')?.content !== config.anchor ||
            document.querySelector('meta[name="codex-plus-mobile-instance"]')?.content !== config.instance) throw Error('Original blank host unavailable');
        window.postMessage({type: 'connect-app-host', port: channel.port2}, '*', [channel.port2]);
        break;
      }
      case 'worker-subscribe': {
        if (phone || typeof message.worker !== 'string') throw Error('Invalid worker subscription');
        if (!workers.has(message.worker)) workers.set(message.worker, original.subscribeToWorkerMessages(message.worker, value => sendValue({kind: 'worker', worker: message.worker}, value)));
        break;
      }
      case 'worker-unsubscribe': workers.get(message.worker)?.(); workers.delete(message.worker); break;
      case 'worker': if (phone) for (const callback of workers.get(message.worker) ?? []) callback(decode(message.value)); break;
      case 'port-frame': {
        const port = ports.get(message.id); if (!port) throw Error('Unknown mobile port');
        port.postMessage(decode(message.value)); break;
      }
      case 'git-port': {
        if (!phone || typeof message.id !== 'string' || gitRequests.get(message.metadata?.requestId)?.phase !== 'pending') throw Error('Invalid Git port');
        const channel = new MessageChannel(); attachPort(channel.port1, message.id);
        gitRequests.set(message.metadata.requestId, {phase: 'active', id: message.id});
        dispatch(message.metadata, [channel.port2]); break;
      }
      case 'event': if (phone) {
        const value = decode(message.value);
        if (value?.type === 'codex_desktop:git-worker-port') {
          const request = gitRequests.get(value.requestId); if (!request || value.closed !== true) break;
          gitRequests.delete(value.requestId); ports.get(request.id)?.close(); ports.delete(request.id);
          dispatch(value, [], true);
        } else dispatch(value);
      } break;
      case 'theme': if (phone) { config.snapshot.theme = message.theme; for (const callback of themes) callback(); } break;
      default: throw Error('Invalid mobile message');
    }
  }
  const themes = new Set();
  const onMessage = event => {
    if (phone) return;
    let value = event.data;
    if (!value || typeof value !== 'object') return;
    if (value.type === 'codex_desktop:git-worker-port') {
      const request = gitRequests.get(value.requestId);
      if (event.source !== window || event.origin !== location.origin || !request) { for (const port of event.ports) port.close(); return; }
      if (request.phase === 'pending' && value.closed === undefined && event.ports.length === 1) {
        const id = `${config.connection}:git:${++sequence}`;
        gitRequests.set(value.requestId, {phase: 'active', id});
        send({kind: 'git-port', id, metadata: value}); attachPort(event.ports[0], id);
      } else if (value.closed === true && event.ports.length === 0) {
        gitRequests.delete(value.requestId); ports.get(request.id)?.close(); ports.delete(request.id);
        sendValue({kind: 'event'}, value);
      } else for (const port of event.ports) port.close();
      return;
    }
    if (event.source !== null) return;
    if (value.type === 'mcp-response') {
      const id = String(value.message?.id);
      if (!ids.has(id)) return; // Discard fallback broadcasts from other views.
      value = {...value, message: {...value.message, id: ids.get(id)}}; ids.delete(id);
    }
    sendValue({kind: 'event'}, value);
  };
  let restorePostMessage, themeUnsubscribe;
  if (phone) {
    const s = config.snapshot;
    if (!s || s.version !== config.hostVersion) throw Error('Missing matching original bootstrap');
    window.codexWindowType = 'electron';
    window.electronBridge = {
      windowType: 'electron', usesStagingWidgetSandbox: false,
      getPreloadStartedAtMs: () => performance.timeOrigin,
      getSystemThemeVariant: () => s.theme,
      getSentryInitOptions: () => s.sentry,
      getBuildFlavor: () => s.buildFlavor,
      getDesktopUserAgent: () => s.userAgent,
      getAppSessionId: () => s.appSessionId,
      getInitialSidebarBootstrap: () => s.sidebar,
      isDeviceCheckSupported: () => false, isIntelMacBuild: () => false,
      getPathForFile: () => null,
      subscribeToSystemThemeVariant: callback => { themes.add(callback); return () => themes.delete(callback); },
      subscribeToWorkerMessages: (worker, callback) => {
        if (!workers.has(worker)) { workers.set(worker, new Set()); send({kind: 'worker-subscribe', worker}); }
        workers.get(worker).add(callback);
        return () => { const set = workers.get(worker); set?.delete(callback); if (set?.size === 0) { workers.delete(worker); send({kind: 'worker-unsubscribe', worker}); } };
      },
      ...Object.fromEntries([...methods].map(method => [method, (...args) => {
        if (method === 'sendMessageFromView' && globalThis.__codexPlusMobileLocal) {
          const local = globalThis.__codexPlusMobileLocal.handleMessage(args[0]);
          if (local.handled) return Promise.resolve(local.value);
          // The original renderer explicitly requests this read-only connection /
          // initialization snapshot when its host advertises window events.
          const allowed = new Set(['mcp-request', 'mcp-response', 'mcp-notification', 'mcp-request-abandon', 'thread-prewarm-start', 'request-app-server-state', 'fetch', 'cancel-fetch']);
          if (!allowed.has(args[0]?.type)) return Promise.reject(Error(`Unsupported phone host message: ${args[0]?.type}`));
        }
        if (method === 'connectGitWorker') {
          if (typeof args[0] !== 'string' || !args[0] || gitRequests.has(args[0])) return Promise.reject(Error('Invalid original Git connection'));
          gitRequests.set(args[0], {phase: 'pending'});
          return invoke(method, args).then(result => { if (result === false) gitRequests.delete(args[0]); return result; }, error => { gitRequests.delete(args[0]); throw error; });
        }
        return invoke(method, args);
      }])),
    };
    const post = window.postMessage.bind(window);
    window.postMessage = function(message, target, transfer) {
      if (message?.type === 'connect-app-host') {
        // WK custom schemes may serialize to opaque origins. This specific local
        // port handoff never leaves this window and does not accept external posts.
        const targetOrigin = typeof target === 'object' ? target.targetOrigin : target;
        const transfers = typeof target === 'object' ? target.transfer : transfer;
        if (targetOrigin !== location.origin || !(message.port instanceof MessagePort) || transfers?.length !== 1 || transfers[0] !== message.port) throw Error('Invalid local app-host handoff');
        const id = `${config.connection}:app:${++sequence}`;
        if (appPort) { fatal(); throw Error('App-host already connected'); }
        appPort = id;
        send({kind: 'port-open', id}); attachPort(message.port, id); return;
      }
      return post(message, target, transfer);
    };
    restorePostMessage = () => { window.postMessage = post; };
  } else {
    if (!original) throw Error('Original preload unavailable');
    window.addEventListener('message', onMessage);
    themeUnsubscribe = original.subscribeToSystemThemeVariant(() => send({kind: 'theme', theme: original.getSystemThemeVariant()}));
  }
  function close() {
    if (closed) return; closed = true;
    for (const {reject} of calls.values()) reject(Error('Connection lost; submitted actions have unknown results until reconciled'));
    calls.clear(); ids.clear(); gitRequests.clear();
    for (const port of ports.values()) { try { port.postMessage(null); } catch {} port.close(); } ports.clear();
    if (!phone) for (const unsubscribe of workers.values()) unsubscribe();
    workers.clear(); themes.clear(); themeUnsubscribe?.(); restorePostMessage?.();
    window.removeEventListener('message', onMessage);
    window.dispatchEvent(new CustomEvent('codex-plus-mobile-disconnected'));
  }
  globalThis.__codexPlusMobileEndpoint = {connection: config.connection, reportRoute: route => { if (phone) send({kind: 'view-route', route}); }, receive: text => { inbound = inbound.then(() => receive(JSON.parse(text))).catch(fatal); }, close, inspect: () => ({connection: config.connection, closed, ports: ports.size, pendingCalls: calls.size})};
  window.addEventListener('pagehide', fatal, {once: true});
}
