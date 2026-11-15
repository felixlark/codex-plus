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
  class AppInfo extends RpcTarget { get(...args) { return original.appInfo.get(...args); } }
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
  return services;
}
