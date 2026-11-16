// The caller has already attested this exact human target. No persistent code
// is registered for later documents; navigation requires a fresh authorisation.
export async function initializePageSession(command,{patterns=[],bindings=[],source}={}) {
  if(source!==undefined)throw Error('Persistent document injection is not authorised');
  await Promise.all([command('Page.enable'),command('Runtime.enable')]);
  if(patterns.length){await command('Fetch.enable',{patterns});await command('Network.enable');await command('Network.setCacheDisabled',{cacheDisabled:true});}
  for(const name of bindings)await command('Runtime.addBinding',{name});
}
