// Dispatch every startup hook before resuming, but do not wait for renderer
// acknowledgements while that renderer is still paused at target attachment.
export async function initializePageSession(command, {patterns = [], bindings = [], source} = {}) {
  const work = [command('Page.enable'), command('Runtime.enable')];
  if (patterns.length) work.push(
    command('Fetch.enable', {patterns}),
    command('Network.enable'),
    command('Network.setCacheDisabled', {cacheDisabled: true}),
  );
  for (const name of bindings) work.push(command('Runtime.addBinding', {name}));
  let script;
  if (source) work.push(command('Page.addScriptToEvaluateOnNewDocument', {source}).then(result => { script = result.identifier; }));
  // These calls are synchronous sends. Resume must reach the wire before the
  // first await; Page/Runtime setup may only acknowledge after startup runs.
  const resumed = command('Runtime.runIfWaitingForDebugger');
  await Promise.all([...work, resumed]);
  return script;
}
