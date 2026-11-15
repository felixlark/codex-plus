// The consumer list is pinned to the reviewed original host. UI/system services
// are supplied on iOS; this boundary never exposes arbitrary Mac window control.
export function selectMobileServices(original, RpcTarget) {
  const fields = [
    'appServerManagers', 'executionHosts', 'executionPaths', 'remoteConnections',
    'threadConfiguration', 'permissionPolicy', 'localThreadCatalog', 'threadProjectAssignments',
    'threadTurnSummaries', 'threadArchive', 'queuedFollowUps', 'queuedSendLocks',
    'projectlessThreads', 'workspaceRoots', 'workspaceSearch', 'workspaceFiles',
    'managedWorktrees', 'worktreeOwnership', 'repositoryOrigins', 'gitFiles', 'gitRepository',
    'threadMetadataGeneration', 'dynamicToolCalls', 'commentAttachments', 'hostedThreadFiles',
    'cloudThreadAttachments', 'threadReadState', 'histogramCollector', 'statsig', 'queryCache', 'pinnedThreads',
  ];
  const services = Object.fromEntries(fields.filter(key => original[key] != null).map(key => [key, original[key]]));
  // A Response imported by the first RPC session cannot be re-exported as an
  // owned payload by the second. Give each streamed body a local owner and keep
  // both original leases until consumption/cancellation; never buffer the body.
  class HttpFetch extends RpcTarget {
    requests = new Map();
    closed = false;
    async fetch(id, request, progress) {
      if (this.closed) throw Error('Phone HTTP service closed');
      if (this.requests.has(id)) throw Error('Duplicate phone HTTP request');
      let call, result, reader, cancelled = false, settled = false, cancellation;
      const release = () => {
        if (settled && this.requests.get(id) === entry) this.requests.delete(id);
        const ownedReader = reader; reader = undefined;
        try { ownedReader?.releaseLock(); } catch {}
        const ownedResult = result; result = undefined;
        const ownedCall = call; call = undefined;
        try { ownedResult?.[Symbol.dispose]?.(); } finally { ownedCall?.[Symbol.dispose]?.(); }
      };
      const cancel = reason => cancellation ??= (async () => {
        cancelled = true;
        const host = Promise.resolve().then(() => original.httpFetch.cancel(id));
        void host.catch(() => {});
        try { await reader?.cancel(reason); } finally { release(); }
        await host;
      })();
      const entry = {cancel}; this.requests.set(id, entry);
      try {
        call = original.httpFetch.fetch(id, request, progress);
        result = await call; settled = true;
        if (cancelled) {
          try { await result.response?.body?.cancel(); } finally { release(); }
          throw new DOMException('HTTP request cancelled', 'AbortError');
        }
        if (!('response' in result)) { const error = {...result}; release(); return error; }
        const response = result.response;
        if (!response.body) { const value = new Response(null, response); release(); return {response: value}; }
        reader = response.body.getReader();
        const body = new ReadableStream({
          async pull(controller) {
            try { const next = await reader.read(); if (next.done) { controller.close(); release(); } else controller.enqueue(next.value); }
            catch (error) { controller.error(error); release(); }
          },
          cancel,
        });
        return {response: new Response(body, response)};
      } catch (error) { settled = true; release(); throw error; }
    }
    cancel(id) { return this.requests.get(id)?.cancel(); }
    [Symbol.dispose]() {
      this.closed = true;
      for (const request of this.requests.values()) void request.cancel().catch(() => {});
    }
  }
  class Catalog extends RpcTarget {
    readLocalProjects() { return original.projectCatalog.readLocalProjects(); }
    readRemoteProjects() { return original.projectCatalog.readRemoteProjects(); }
  }
  class Settings extends RpcTarget {
    read(...args) { return original.settings.read(...args); }
    readAll(...args) { return original.settings.readAll(...args); }
    subscribe(...args) { return original.settings.subscribe(...args); }
  }
  class Evaluations extends RpcTarget { readExecutionAssignments(...args) { return original.statsigEvaluations.readExecutionAssignments(...args); } }
  class AppInfo extends RpcTarget {
    get(...args) { return original.appInfo.get(...args); }
    // Original platform query describes the execution host (paths and tools),
    // not the phone shell. This method only reads OS/packaging metadata.
    getSystemInfo(...args) { return original.appInfo.getSystemInfo(...args); }
    getPackagingInfo(...args) { return original.appInfo.getPackagingInfo(...args); }
    getLocaleInfo(...args) { return original.appInfo.getLocaleInfo(...args); }
  }
  // The original host derives this account summary on the Mac. Unlike
  // accessInputs.readLocalChatGptAuth(), it does not return an access token.
  class AccountInfo extends RpcTarget { readAccountInfo(...args) { return original.accountInfo.readAccountInfo(...args); } }
  class Coordination extends RpcTarget {
    getIdeContext(...args) { return original.clientCoordination.getIdeContext(...args); }
    findThreadOwner(...args) { return original.clientCoordination.findThreadOwner(...args); }
    requestThreadFollower(...args) { return original.clientCoordination.requestThreadFollower(...args); }
  }
  if (original.projectCatalog) services.projectCatalog = new Catalog();
  if (original.settings) services.settings = new Settings();
  if (original.statsigEvaluations) services.statsigEvaluations = new Evaluations();
  if (original.appInfo) services.appInfo = new AppInfo();
  if (original.accountInfo) services.accountInfo = new AccountInfo();
  if (original.clientCoordination) services.clientCoordination = new Coordination();
  if (original.httpFetch) { const http = new HttpFetch(); services.httpFetch = http; Object.defineProperty(services, Symbol.dispose, {value: () => http[Symbol.dispose]()}); }
  return services;
}
