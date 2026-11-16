#!/usr/bin/env python3
"""固定现役控制面只读事实；不把观察签成normal publication或兼容权源。"""
from pathlib import Path
import datetime as dt
import hashlib
import json
import os
import plistlib
import stat
import subprocess
import sys
import types
import uuid

HOME=Path.home()
ROOT=HOME/'Library/Application Support/SmartShadow'
CTL=HOME/'Library/Application Support/dev-ops/bin/ss-service'
API=HOME/'Library/Application Support/dev-ops/bin/ss-api'
REGISTRY=ROOT/'runtime/channel-task-targets.json'
CORE_SHA='1302dd3a917c58e2bd08485c2d62e9d746aba04237d655babcd6210a0449a8d7'
MODULE=ROOT/'runtime-from-devops/lib/ss_service_weixin_maintenance.py'
MODULE_SHA='a3f3ad0f5126adbc86b54a282b1efca451a3b977f2c06e006d1ef28965c0a926'
NINE=('service/src/main.ts','service/src/notify/task-decision-host.ts',
      'service/src/notify/decision-intake.ts','service/src/notify/signals.ts',
      'service/src/desktop-execution/host.ts','service/src/desktop-execution/contracts.ts',
      'service/src/notify/native-terminal.ts','service/src/notify/native-terminal-ledger.ts',
      'service/src/desktop-execution/ledger.ts')
ROUTES={'runtime':'/api/v2/runtime','health':'/api/v2/health',
        'stats':'/api/v2/collector-stats','controls':'/api/v2/collector-control'}

class CurrentSourceUnavailable(RuntimeError):pass

def need(value,code):
    if not value:raise CurrentSourceUnavailable(code)

def canonical(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()

def sha(raw):return hashlib.sha256(raw).hexdigest()

def stamp(info):
    return {key:str(getattr(info,key)) for key in ('st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns')}

def snapshot(path,*,raw=False,alias=False):
    path=Path(path)
    need(path.is_absolute() and path.name!='smart-shadow.json','source_path_forbidden')
    logical=path.lstat();physical=path.resolve(strict=True)
    need(alias or path==physical,'source_alias_not_allowed')
    fd=os.open(physical,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        before=os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_uid in (0,os.getuid())
             and not stat.S_IMODE(before.st_mode)&0o022,'source_file_untrusted')
        digest=hashlib.sha256();parts=[] if raw else None
        while True:
            block=os.read(fd,1024*1024)
            if not block:break
            digest.update(block)
            if raw:parts.append(block)
        need(stamp(before)==stamp(os.fstat(fd))==stamp(physical.lstat())
             and stamp(logical)==stamp(path.lstat()) and path.resolve()==physical,'source_file_changed')
        ref={'path':str(path),'physical_path':str(physical),'sha256':digest.hexdigest(),
             'physical_stat':stamp(before),'logical_stat':stamp(logical)}
        return (ref,b''.join(parts)) if raw else ref
    finally:os.close(fd)

def api_get(key):
    # 现有Main/ss-api的元数据入口与120秒调用预算；不回显凭据/错误原文。
    r=subprocess.run([str(API),'GET',ROUTES[key]],capture_output=True,timeout=120)
    need(r.returncode==0,'metadata_get_failed:'+key+':'+str(r.returncode))
    return json.loads(r.stdout)

FROZEN_OBSERVER_BASE=Path('/Users/longbiao/Library/Caches/me.longbiaochen.smart-shadow/pn-native-final-20261102/metadata-cow-9f7d2563-17be-4272-956a-afba658cf646/base.py')

def source_module():
    # 独立恢复观察只执行固定已审旧观察器；现用候选/新helper字节不参与观察资格。
    ref=snapshot(CTL,alias=True)
    module_ref=snapshot(MODULE)
    base_ref,raw=snapshot(FROZEN_OBSERVER_BASE,raw=True)
    need(base_ref['sha256']==CORE_SHA,'frozen_observer_changed')
    core=types.ModuleType('ss_metadata_frozen_observer_'+uuid.uuid4().hex)
    core.__file__=str(CTL)
    exec(compile(raw,str(CTL),'exec'),core.__dict__)
    return core,ref,module_ref

def observe_current():
    """无调用者路径/源事实输入；只调用现役ss-service只读方法与正式ss-api GET。"""
    getter_ref=snapshot(Path(__file__))
    api_ref=snapshot(API,alias=True)
    core,controller_ref,module_ref=source_module()
    ctl=core.Controller('node','normal-current-source','fixed-source readonly observation')
    plist_ref,plist_raw=snapshot(ctl.plist,raw=True)
    plist=plistlib.loads(plist_raw);release=Path(plist['WorkingDirectory'])
    pins=ctl.node_release_files(plist_raw)
    need(release.parent==ROOT/'releases' and release.resolve()==release,'release_source_untrusted')
    host=ctl.job();node=ctl.node_owner();birth=core.process_birth(host) if type(host)is int else None
    need(type(host)is int and host>0 and birth and isinstance(node,dict)
         and node.get('ppid')==host and node.get('pgid')==host
         and ctl.node_identity(node['pid'])==node,'current_process_binding_unknown')
    ctl._ordinary_host_identity(plist_raw,host,birth)
    ctl.assert_node_listener(node,'normal_current_source_readonly')
    files={path:snapshot(Path(path),alias=True) for path in sorted(pins)}
    need({p:r['sha256'] for p,r in files.items()}==pins,'startup_files_changed')
    family={rel:snapshot(release/rel) for rel in NINE}
    config_ref,raw=snapshot(release/'service.json',raw=True)
    config=json.loads(raw);decision=config.get('codex_decision')
    need(isinstance(decision,dict) and type(decision.get('enabled'))is bool,'decision_config_flag_unknown')
    # 只声明保存的flag。registry_path亦可能选择formal dispatch，不能据false宣称D运行OFF。
    need(decision.get('registry_path')==str(REGISTRY),'registry_source_path_unqualified')
    registry_ref=snapshot(REGISTRY)
    projection={'configuration_sha256':config_ref['sha256'],
                'codex_decision_enabled_flag':decision['enabled'],
                'registry_path_configured':True,'registry_sha256':registry_ref['sha256']}
    actual={key:api_get(key) for key in ROUTES}
    runtime=actual['runtime']
    need(actual['health'].get('status')=='ok'
         and runtime.get('client_service',{}).get('release')==release.name,'current_api_release_unhealthy')
    need(snapshot(ctl.plist)==plist_ref and ctl.job()==host and ctl.node_owner()==node
         and core.process_birth(host)==birth and snapshot(CTL,alias=True)==controller_ref
         and snapshot(MODULE)==module_ref and snapshot(REGISTRY)==registry_ref
         and snapshot(API,alias=True)==api_ref and snapshot(Path(__file__))==getter_ref,
         'current_control_plane_changed')
    need(all(snapshot(Path(path),alias=True)==ref for path,ref in files.items()),'current_startup_files_changed')
    need(all(snapshot(release/rel)==ref for rel,ref in family.items()),'current_transport_files_changed')
    stable={'release':str(release),'controller':controller_ref,'module':module_ref,'plist':plist_ref,
            'host':{'pid':host,'birth':birth},'node':node,'startup_files':files,'transport_nine':family,
            'configuration':config_ref,'observed_configuration_binding':projection,'registry':registry_ref,
            'entity_schema':runtime.get('entity_schema'),'desktop_execution_schema':runtime.get('desktop_execution_schema')}
    return {'schema':'smart-shadow.actual-normal-current-source/v1',
            'observation_id':'normal-current-observation-'+uuid.uuid4().hex,
            'observed_at':dt.datetime.now(dt.timezone.utc).isoformat(),
            'source':'frozen reviewed ss-service readonly observer + fixed ss-api GET + physical files',
            'stat_encoding':'decimal_strings',
            'configuration_semantics':'whole file and registry binding only; not providerConfigurationProjection',
            'facts':stable,'stable_fingerprint_sha256':sha(canonical(stable)),
            'actual_api':actual,'official_api':api_ref,'getter_source':getter_ref,
            'same_current_rollback_preimage':{'release':str(release),'configuration':config_ref,
                'observed_configuration_binding_sha256':sha(canonical(projection)),
                'transport_nine':family,'support_verified':None},
            'normal_publication_operation_id':None,'authority_state':'observed_current_only_not_normal_authority',
            'remaining':['normal_publication_formal_source_unbound','normal_v2_wire_resolver_compatibility_unverified'],
            'source_or_auth_probe':False,'lifecycle_or_configuration_write':False}

def verify_current_facts(reference):
    """仅验证current，不返回可误作normal authority的64hex。"""
    fresh=observe_current()
    need(reference.get('schema')==fresh['schema'] and reference.get('stable_fingerprint_sha256')==fresh['stable_fingerprint_sha256'],
         'current_fingerprint_changed')
    return {'current_facts_verified':True,'stable_fingerprint_sha256':fresh['stable_fingerprint_sha256'],
            'normal_authority_verified':False,'normal_publication_operation_id':None}

if __name__=='__main__':
    try:print(json.dumps(observe_current(),ensure_ascii=False,indent=2))
    except CurrentSourceUnavailable as exc:
        print(json.dumps({'schema':'smart-shadow.actual-normal-current-source/error','error':str(exc),
                          'normal_authority_verified':False}));raise SystemExit(1)
