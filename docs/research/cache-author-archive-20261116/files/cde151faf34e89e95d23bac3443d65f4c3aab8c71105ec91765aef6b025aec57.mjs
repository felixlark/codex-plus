import {readFileSync} from 'node:fs';
import {providerConfigurationProjection} from '/Users/longbiao/Projects/smart-shadow/service/src/notify/task-decision-host.ts';
const cases=JSON.parse(readFileSync(new URL('./PROJECTION-VECTORS.json',import.meta.url),'utf8'));
const results=cases.map(c=>{
 const providers=['feishu_task','feishu_approval'].map(provider=>{
  const factories=c.scopes.filter(s=>s.provider===provider).map(s=>({...s,registration_id:c.inventory.find(i=>Object.keys(s).every(k=>i[k]===s[k])).authority_sha256,current_ready:true,control:{state:'observed'}}));
  return {provider,state:factories.length?'observed':'unknown',reason:factories.length?null:'no_factory_metadata_observed',coverage:'observed_registrations_only',factories,domains:[]};
 });
 const actual=providerConfigurationProjection(c.scopes,{state:'configured',raw:JSON.stringify(c.registry)},{schema:'smart-shadow.provider-adoption-metadata/v1',providers});
 if(actual.state!=='projected_metadata'||actual.configuration.projection_hash!==c.expected)throw new Error('cross_language_projection_mismatch');
 return {expected:c.expected,actual:actual.configuration.projection_hash,match:true};
});
console.log(JSON.stringify({synthetic_unit_only:true,actual_node_function:true,results},null,2));
