// 私有P元数据投影；只调用精候选原factory，不构造真实Store/Worker或平台读取。
import {readFileSync,mkdirSync,realpathSync,lstatSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {homedir,userInfo} from 'node:os';
import {createHash} from 'node:crypto';

const hash=raw=>createHash('sha256').update(raw).digest('hex');
const requireCondition=(ok,reason)=>{if(!ok)throw new Error(reason);};

async function projectPFactories(candidateRoot,targetConfig,scratch){
  const cache=join(userInfo().homedir,'Library/Caches/me.longbiaochen.smart-shadow/p-off-enrollment');
  const rel=relative(cache,scratch),info=lstatSync(scratch);
  requireCondition(isAbsolute(scratch)&&rel&&!rel.startsWith('../')&&!isAbsolute(rel)
    &&realpathSync(scratch)===scratch&&info.isDirectory()&&!info.isSymbolicLink()
    &&info.uid===process.getuid()&&(info.mode&0o777)===0o700,'p_projection_private_scratch_required');
  requireCondition(realpathSync(candidateRoot)===candidateRoot,'p_projection_candidate_alias');
  requireCondition(targetConfig&&typeof targetConfig==='object'&&!Array.isArray(targetConfig),'p_projection_config_required');
  const paths={feishu_task:'service/src/channels/feishu-task.ts',feishu_approval:'service/src/channels/feishu-approval.ts'};
  const dependencyPaths=[...Object.values(paths),
    'service/src/channels/source-intake/source-identity.ts','service/src/channels/source-intake/task-reader.ts',
    'service/src/channels/source-intake/approval-reader.ts','service/src/channels/source-intake/contracts.ts',
    'service/src/canonical.ts','service/src/contracts.ts','service/src/channels/collector-host.ts',
    'service/src/process/x-process-contract.ts','service/src/paths.ts','service/src/channels/source-intake/archive.ts',
    'service/src/documents-root.ts'];
  const pins=Object.fromEntries(dependencyPaths.map(path=>[path,hash(readFileSync(join(candidateRoot,path)))]));
  const actual={};
  for(const [provider,path] of Object.entries(paths))actual[provider]=await import(pathToFileURL(join(candidateRoot,path)).href);
  const schemas={feishu_task:actual.feishu_task.FeishuTaskConfig,feishu_approval:actual.feishu_approval.FeishuApprovalConfig};
  const factories={feishu_task:actual.feishu_task.feishuTaskRegistrations,feishu_approval:actual.feishu_approval.feishuApprovalRegistrations};
  const configs={};
  for(const provider of Object.keys(paths)){
    const c=schemas[provider].parse(targetConfig[provider]);
    requireCondition(c.enabled===true&&c.entries.length>0,'p_projection_exact_enabled_channels_required');
    requireCondition(c.entries.every(e=>e.initially_enabled===false),'p_projection_explicit_off_required');
    configs[provider]=c;
  }
  requireCondition(configs.feishu_task.archive_root===configs.feishu_approval.archive_root,'p_projection_archive_roots_conflict');
  // 本地内存对象只能承接factory定义；任意Store方法调用立即失败。
  const noStore=new Proxy(Object.create(null),{get(){throw new Error('p_projection_store_call_forbidden');}});
  const rows=[],overrides={};
  for(const provider of Object.keys(paths)){
    const localArchive=join(scratch,provider);mkdirSync(localArchive,{mode:0o700});
    overrides[provider]={configured_archive_root:configs[provider].archive_root,projection_archive_root:localArchive};
    const registrations=factories[provider](noStore,{...configs[provider],archive_root:localArchive},()=>{
      throw new Error('p_projection_guard_call_forbidden');
    });
    requireCondition(registrations.length===configs[provider].entries.length,'p_projection_entry_count_conflict');
    for(const registration of registrations){
      const entry=configs[provider].entries.find(e=>e.collector_ref===registration.definition.collector_ref);
      requireCondition(entry&&registration.source===provider&&registration.initially_enabled===false,'p_projection_factory_mismatch');
      // 丢弃open/prepareIdentity等所有闭包；不序列化或冒造当前Worker资格。
      rows.push({provider,source:registration.source,initially_enabled:false,definition:registration.definition,
        helpers:registration.helpers,reader:entry.reader,process_guard:entry.process_guard});
    }
  }
  requireCondition(new Set(rows.map(r=>r.definition.collector_ref)).size===rows.length,'p_projection_duplicate_collector');
  requireCondition(dependencyPaths.every(path=>hash(readFileSync(join(candidateRoot,path)))===pins[path]),'p_projection_source_changed');
  return {schema:'smart-shadow.p-off-factory-projection/v1',state:'projected_untrusted',
    factory_files:pins,
    configured_channels:configs,projection_overrides:{archive_roots:overrides,child_home:homedir()},
    original_archive_physical_identity_verified:false,
    rows:rows.sort((a,b)=>a.definition.collector_ref.localeCompare(b.definition.collector_ref)),
    actual_store_or_platform_called:false,current_worker_identity_verified:false,checkpoint_created:false};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    requireCondition(process.argv.length===5,'p_projection_exact_arguments_required');
    const [candidate,configFile,scratch]=process.argv.slice(2);
    const raw=readFileSync(configFile),value=await projectPFactories(candidate,JSON.parse(raw),scratch);
    console.log(JSON.stringify({...value,input_raw_sha256:hash(raw)}));
  }catch(error){console.error(JSON.stringify({message:error.message,code:error.code,
    permission:error.permission,resource:error.resource}));process.exitCode=1;}
}
