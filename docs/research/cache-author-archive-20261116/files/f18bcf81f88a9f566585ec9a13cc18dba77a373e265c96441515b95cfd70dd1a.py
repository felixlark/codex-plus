#!/usr/bin/env python3
"""原首批Controller两目标安装：默认只读核计划；--apply仅原部署owner同步子进程。"""
import argparse
import ast
import base64
import hashlib
import json
import os
import plistlib
from pathlib import Path
import stat
import subprocess
import sys
import uuid

SCHEMA = 'smart-shadow.ss-service-controller-install/v1'
PROVIDER_INSTALL_SCHEMA = SCHEMA+'/provider/v2'
REL = {'controller': 'bin/ss-service', 'module': 'lib/ss_service_weixin_maintenance.py'}
COW_REL = 'bin/ss-cow-backup-policy.py'
COW_SOURCE = 'dev-ops/scripts/ss-cow-backup-policy.py'
METADATA_BUILDER = 'scripts/build-metadata-current-service-adapter.py'
METADATA_NODE_LABEL = 'me.longbiaochen.smart-shadow.node-18765-candidate'
METADATA_MODULE_SHA256 = 'a3f3ad0f5126adbc86b54a282b1efca451a3b977f2c06e006d1ef28965c0a926'
SOURCE = ('scripts/build-registry-service-adapter.py', 'scripts/build-weixin-service-adapter.py',
          'dev-ops/scripts/ss-service', 'scripts/ss_service_weixin_maintenance.py')
NINE = ('service/src/main.ts', 'service/src/notify/task-decision-host.ts',
        'service/src/notify/decision-intake.ts', 'service/src/notify/signals.ts',
        'service/src/desktop-execution/host.ts', 'service/src/desktop-execution/contracts.ts',
        'service/src/notify/native-terminal.ts', 'service/src/notify/native-terminal-ledger.ts',
        'service/src/desktop-execution/ledger.ts')
SELF = 'dev-ops/scripts/ss-service-controller-install'
STAT = ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns')


class Fault(RuntimeError):
    pass


def need(value, code):
    if not value:
        raise Fault(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode() + b'\n'


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, 'duplicate_json_key')
        result[key] = value
    return result


def decode(raw):
    return json.loads(raw, object_pairs_hook=unique_object, parse_constant=lambda _: (_ for _ in ()).throw(Fault('json_constant')))


def stamp(info):
    return {key: str(getattr(info, key)) for key in STAT}


def parent_identity(path):
    info = path.lstat()
    need(path.resolve() == path and stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
         and not stat.S_IMODE(info.st_mode) & 0o022, 'parent_identity')
    metadata=permission_metadata(path)
    # 目录nlink随原Core创建自身正常子目录改变；它不是权限/身份。文件仍全stat且nlink=1。
    metadata.pop('nlink')
    return {**{key: str(getattr(info, key)) for key in ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid')},'metadata':metadata}


def metadata_command(args):
    result=subprocess.run(args,capture_output=True,env={'PATH':'/usr/bin:/bin','LC_ALL':'C','DITTOABORT':'1'})
    need(result.returncode==0,'metadata_command_failed:'+Path(args[0]).name+':exit='+str(result.returncode)+':stderr_sha256='+sha(result.stderr))
    return result.stdout


def permission_metadata(path):
    # 复用既有registry_metadata的公开macOS CLI/字段合同，不丢ACL/xattr/flags。
    info=path.lstat();attrs={}
    for name in sorted(metadata_command(['/usr/bin/xattr',str(path)]).decode().splitlines()):
        attrs[name]=sha(bytes.fromhex(metadata_command(['/usr/bin/xattr','-px',name,str(path)]).decode()))
    acl=metadata_command(['/bin/ls','-lde',str(path)]).splitlines()[1:]
    return {'mode':stat.S_IMODE(info.st_mode),'uid':info.st_uid,'gid':info.st_gid,'nlink':info.st_nlink,
            'flags':info.st_flags,'xattrs':attrs,'acl_sha256':sha(b'\n'.join(acl))}


def file_snapshot(path, private=False):
    path = Path(path)
    need(path.is_absolute() and path.resolve() == path, 'file_path_identity')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid() and before.st_nlink == 1
             and not stat.S_IMODE(before.st_mode) & 0o022, 'file_identity')
        if private:
            need(stat.S_IMODE(before.st_mode) == 0o600, 'private_file_mode')
        with os.fdopen(os.dup(fd), 'rb') as stream:
            raw = stream.read()
        metadata=permission_metadata(path)
        need(stamp(before) == stamp(os.fstat(fd)) == stamp(path.lstat()) and len(raw) == before.st_size, 'file_drift')
        return {'path': str(path), 'sha256': sha(raw), 'stat': stamp(before), 'metadata':metadata,
                'raw_base64': base64.b64encode(raw).decode('ascii')}
    finally:
        os.close(fd)


def raw_of(snapshot):
    raw = base64.b64decode(snapshot['raw_base64'], validate=True)
    need(sha(raw) == snapshot['sha256'] and str(len(raw)) == snapshot['stat']['st_size'], 'snapshot_corrupt')
    return raw


def plan_names(plan):
    return tuple(REL) + (('cow_policy',) if 'cow_policy_candidate' in plan else ())


def target_snapshot(path, optional=False):
    path=Path(path)
    if optional:
        try:path.lstat()
        except FileNotFoundError:return {'path':str(path),'absent':True}
    return file_snapshot(path)


def cow_source_pin(raw):
    tree=ast.parse(raw)
    pins=[n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='COW_OPERATOR_POLICY_SHA256' for t in n.targets)]
    need(len(pins)==1 and len(pins[0].targets)==1 and isinstance(pins[0].value,ast.Constant)
         and isinstance(pins[0].value.value,str) and len(pins[0].value.value)==64
         and all(c in '0123456789abcdef' for c in pins[0].value.value),'cow_source_pin')
    functions=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='clone_operator_policy_identity']
    expected=ast.parse("def clone_operator_policy_identity():\n    return Path(__file__).resolve().with_name('ss-cow-backup-policy.py'), COW_OPERATOR_POLICY_SHA256\n").body[0]
    need(len(functions)==1 and ast.dump(functions[0],include_attributes=False)==ast.dump(expected,include_attributes=False),'cow_source_relative_path')
    return pins[0].value.value


def targets(home, cow=False):
    logical = home / 'Library/Application Support/dev-ops'
    migration = home / 'Library/Application Support/SmartShadow/runtime-from-devops'
    info = logical.lstat()
    if stat.S_ISLNK(info.st_mode):
        text = os.readlink(logical)
        need(info.st_uid == os.getuid() and text in (str(migration), 'SmartShadow/runtime-from-devops')
             and logical.resolve() == migration, 'unsupported_runtime_alias')
        root = migration
    else:
        need(stat.S_ISDIR(info.st_mode) and logical.resolve() == logical, 'unsupported_runtime_alias')
        text = None
        root = logical
    parents = {str(p): parent_identity(p) for p in (logical.parent, root.parent, root, root/'bin', root/'lib')}
    return {'logical_root': str(logical), 'root': str(root), 'alias_stat': stamp(info),
            'alias_text': text, 'parents': parents,
            'files': {name: str(root/relative) for name, relative in ({**REL,**({'cow_policy':COW_REL} if cow else {})}).items()}}


def load_code(raw, path):
    namespace = {'__name__': 'ss_composition_install_readonly_import', '__file__': str(path)}
    exec(compile(raw, str(path), 'exec', dont_inherit=True), namespace)
    return namespace


class Context:
    """CLI固定home/repo；构造注入只供隔离FS单测，不是CLI target/权限参数。"""
    def __init__(self, home, repo):
        self.home, self.repo = home, repo
        self.checkpoint = lambda _point: None

    def source(self, commit, relative):
        return subprocess.check_output(['git', '-C', str(self.repo), 'show', commit+':'+relative])

    def core(self, raw, logical):
        return load_code(raw, logical)

    def owner_adapter(self, core):
        return core['_weixin_staged_adapter']()

    def assert_current_source(self, commit, paths=None):
        need(subprocess.check_output(['git','-C',str(self.repo),'rev-parse','HEAD']).decode().strip() == commit, 'source_head_changed')
        for relative in (paths if paths is not None else SOURCE + NINE + (SELF,)):
            path = self.repo/relative
            need(path.resolve() == path and raw_of(file_snapshot(path)) == self.source(commit, relative), 'source_working_copy_drift')

    def compositions(self, plan):
        commit = plan['source_commit']
        if plan['phase']=='metadata-current':
            need(isinstance(commit,str) and len(commit)==40 and all(c in '0123456789abcdef' for c in commit),'metadata_source_commit')
            self.assert_current_source(commit,('dev-ops/scripts/ss-service',COW_SOURCE,METADATA_BUILDER,SELF))
            core=self.source(commit,'dev-ops/scripts/ss-service');helper=self.source(commit,COW_SOURCE)
            need(plan['source_hashes']=={'dev-ops/scripts/ss-service':sha(core)},'metadata_source_lineage')
            need(plan['installer_source_sha256']==sha(self.source(commit,SELF)),'installer_source_lineage')
            builder_raw=self.source(commit,METADATA_BUILDER)
            need(plan['metadata_builder_sha256']==sha(builder_raw),'metadata_builder_lineage')
            builder=load_code(builder_raw,self.repo/METADATA_BUILDER)
            try:derived=builder['build_metadata_current'](raw_of(plan['build_base']),core,helper)
            except (ValueError,KeyError,SyntaxError) as error:raise Fault('metadata_builder_rejected') from error
            metadata_core_contract(derived)
            need(cow_source_pin(derived)==sha(helper)==plan['cow_policy_source_sha256'],'cow_source_lineage')
            need(plan['family']=={p:v['sha256'] for p,v in plan['metadata_current']['nine'].items()},'metadata_family_not_observation')
            need(self.current_runtime(plan)==plan['metadata_current'],'metadata_current_drift')
            module=raw_of(plan['preimage']['module'])
            need(sha(module)==METADATA_MODULE_SHA256,'metadata_module_not_installed_a3')
            return {'metadata-current':derived,'module':module,'cow_policy':helper}
        self.assert_current_source(commit)
        need(isinstance(commit, str) and len(commit) == 40 and all(c in '0123456789abcdef' for c in commit), 'source_commit')
        code = {p: self.source(commit, p) for p in SOURCE}
        need({p: sha(v) for p, v in code.items()} == plan['source_hashes'], 'source_lineage')
        need(sha(self.source(commit, SELF)) == plan['installer_source_sha256'], 'installer_source_lineage')
        family = {p: sha(self.source(commit, p)) for p in NINE}
        need(family == plan['family'], 'final_nine_family')
        base = raw_of(plan['build_base'])
        b9 = load_code(code[SOURCE[0]], self.repo/SOURCE[0])
        pentry = load_code(code[SOURCE[1]], self.repo/SOURCE[1])
        result = {}
        for policy in ('standby', 'armed'):
            first = b9['build'](base, sha(base), code[SOURCE[2]], [family], policy)[0]
            result[policy] = pentry['build_existing_entry'](first, sha(first), code[SOURCE[3]])[0]
        result['module'] = code[SOURCE[3]]
        if 'cow_policy_candidate' in plan:
            path=self.repo/COW_SOURCE
            helper=self.source(commit,COW_SOURCE)
            need(path.resolve()==path and raw_of(file_snapshot(path))==helper,'cow_source_working_copy_drift')
            need(plan['cow_policy_source_sha256']==sha(helper)==cow_source_pin(code[SOURCE[2]]),'cow_source_lineage')
            for policy in ('standby','armed'):
                need(cow_source_pin(result[policy])==sha(helper),'cow_composed_pin')
            result['cow_policy']=helper
        return result



    def current_runtime(self, plan):
        # 只读固定LaunchAgent与其当前release；不把观测投影解释成normal/registry/provider资格。
        root=self.home/'Library/Application Support/SmartShadow'
        # 观察只用固定实际LaunchAgent；不执行或解读计划内preimage源码。
        path=self.home/'Library/LaunchAgents'/(METADATA_NODE_LABEL+'.plist')
        plist=file_snapshot(path);value=plistlib.loads(raw_of(plist));release=Path(value['WorkingDirectory'])
        need(value.get('Label')==METADATA_NODE_LABEL and value.get('KeepAlive') is True
             and release.parent==root/'releases' and release.name.startswith('node-18765-')
             and release.resolve()==release,'metadata_current_release_identity')
        def observation(p):
            snap=file_snapshot(p);return {k:v for k,v in snap.items() if k!='raw_base64'}
        return {'scope':'current-preservation-only','release_identity':parent_identity(release),'plist':{k:v for k,v in plist.items() if k!='raw_base64'},
                'release_path':str(release),'nine':{p:observation(release/p) for p in NINE},
                'config':observation(release/'service.json')}


def metadata_core_contract(raw):
    tree=ast.parse(raw)
    loaders=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='_weixin_staged_adapter']
    need(len(loaders)==1,'metadata_loader_identity')
    pins=[n.value for n in ast.walk(loaders[0]) if isinstance(n,ast.Constant) and isinstance(n.value,str)
          and len(n.value)==64 and all(c in '0123456789abcdef' for c in n.value)]
    need(pins==[METADATA_MODULE_SHA256],'metadata_loader_not_a3')
    for name,allowed in (('_REGISTRY_ADOPTION_POLICY',('standby',)),('_REGISTRY_PROVIDER_PHASE',('template','off'))):
        assignments=[n for n in tree.body if isinstance(n,(ast.Assign,ast.AnnAssign))
                     and any(isinstance(t,ast.Name) and t.id==name for t in (n.targets if isinstance(n,ast.Assign) else [n.target]))]
        need(len(assignments)<=1,'metadata_adoption_ambiguous')
        if assignments:need(isinstance(assignments[0].value,ast.Constant) and assignments[0].value.value in allowed,'metadata_adoption_not_off')


    def provider_metadata_composition(self, commit, compatible_previous_commit, build_base):
        """只生成获准 metadata B9/WX 字节，不选根/造 normal exports/授发布权。

        新阶段的安装计划与前后发布资格另核；旧 v1 compositions 不切入此函数。
        两组九域来自各自精确 Git source，不把九域写成新 provider 完整 profile。
        """
        for revision in (commit, compatible_previous_commit):
            need(isinstance(revision, str) and len(revision) == 40
                 and all(c in '0123456789abcdef' for c in revision), 'provider_source_commit')
        self.assert_current_source(commit)
        code = {p: self.source(commit, p) for p in SOURCE}
        current = {p: sha(self.source(commit, p)) for p in NINE}
        previous = {p: sha(self.source(compatible_previous_commit, p)) for p in NINE}
        base = raw_of(build_base)
        b9 = load_code(code[SOURCE[0]], self.repo/SOURCE[0])
        wx = load_code(code[SOURCE[1]], self.repo/SOURCE[1])
        first = b9['build'](base, sha(base), code[SOURCE[2]], [current, previous], 'armed')[0]
        controller = wx['build_existing_entry'](first, sha(first), code[SOURCE[3]])[0]
        return {'schema': SCHEMA+'/provider-metadata-composition/v2', 'phase': 'provider-metadata',
                'controller': controller, 'module': code[SOURCE[3]],
                'source_commit': commit, 'compatible_previous_commit': compatible_previous_commit,
                'source_hashes': {p: sha(v) for p, v in code.items()},
                'approved_nine_families': [current, previous],
                'metadata_only': True, 'publication_authority': 'not_inferred'}


    def provider_bootstrap_composition(self, commit, compatible_previous_commit, build_base):
        """仅复用实际四参 bootstrap compiler；缺真实导出即拒，不补 stub。

        这是下一阶段的组合接缝，尚未开放安装/请求路由，也不产生根或写权。
        """
        provider_revisions({'source_commit':commit,'compatible_previous_commit':compatible_previous_commit})
        self.assert_current_source(commit)
        code={path:self.source(commit,path) for path in SOURCE}
        compiler=load_code(code[SOURCE[0]],self.repo/SOURCE[0])
        compile_bootstrap=compiler.get('build_provider_bootstrap')
        need(callable(compile_bootstrap),'provider_normal_bootstrap_compiler_unavailable')
        tree=ast.parse(code[SOURCE[0]])
        definitions=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='build_provider_bootstrap']
        need(len(definitions)==1 and not definitions[0].decorator_list,'provider_bootstrap_compiler_contract')
        args=definitions[0].args
        need([arg.arg for arg in args.args]==['base_raw','expected_base_sha256','provider_source_raw','transport_manifest']
             and not args.posonlyargs and not args.vararg and not args.kwarg and not args.kwonlyargs and not args.defaults,
             'provider_bootstrap_compiler_contract')
        common,specific=compiler.get('PROVIDER_PIN_COMMON'),compiler.get('PROVIDER_PIN_SPECIFIC')
        need(isinstance(common,frozenset) and len(common)==39 and isinstance(specific,dict)
             and set(specific)=={'feishu_task','feishu_approval'} and all(isinstance(paths,frozenset) and len(paths)==2 for paths in specific.values()),
             'provider_profile_catalog_missing')
        families={provider:[{path:sha(self.source(revision,path)) for path in sorted(common|paths)}
                            for revision in (commit,compatible_previous_commit)] for provider,paths in specific.items()}
        metadata=self.provider_metadata_composition(commit,compatible_previous_commit,build_base)
        before=metadata['controller']
        document={'schema':compiler['PROVIDER_SCHEMA'],'families':families}
        # 实际编译器须自行核正常exports/完整模块/唯一phase、空consumer与无anchor；这里不注入它们。
        controller=compile_bootstrap(before,sha(before),code[SOURCE[2]],document)[0]
        return {**metadata,'schema':SCHEMA+'/provider-history-bootstrap-composition/v2',
                'phase':'provider-history-bootstrap','controller':controller,'provider_families':families,
                'controller_anchor':None,'expected_consumer_contracts':{},'publication_authority':'not_inferred'}



def provider_revisions(plan):
    for key in ('source_commit','compatible_previous_commit'):
        revision=plan.get(key)
        need(isinstance(revision,str) and len(revision)==40 and all(c in '0123456789abcdef' for c in revision),'provider_source_commit')


def provider_phase(plan):
    return isinstance(plan,dict) and plan.get('schema')==PROVIDER_INSTALL_SCHEMA


def checked_ref(ref, private=False):
    need(isinstance(ref,dict) and set(ref)=={'path','sha256'},'provider_ref_shape')
    actual=file_snapshot(Path(ref['path']),private)
    need(actual['sha256']==ref['sha256'],'provider_ref_drift')
    return actual


def provider_static_releases(plan,context):
    provider_revisions(plan)
    releases=plan['static_releases']
    need(isinstance(releases,list) and len(releases)==2
         and {r.get('role') for r in releases if isinstance(r,dict)}=={'current','compatible_previous'},'provider_release_pair')
    code=context.source(plan['source_commit'],SOURCE[0]);compiler=load_code(code,context.repo/SOURCE[0])
    common,specific=compiler.get('PROVIDER_PIN_COMMON'),compiler.get('PROVIDER_PIN_SPECIFIC')
    need(isinstance(common,frozenset) and len(common)==39 and set(NINE)<=common and isinstance(specific,dict) and set(specific)=={'feishu_task','feishu_approval'}
         and all(isinstance(paths,frozenset) and len(paths)==2 and not paths&common for paths in specific.values()),'provider_profile_catalog_missing')
    paths=set(NINE)|set(common)|set().union(*specific.values())
    need(all(isinstance(path,str) and path.startswith('service/') and '..' not in Path(path).parts for path in paths),'provider_profile_catalog_scope')
    families=[]
    release_paths=[]
    for r in releases:
        need(set(r)=={'role','release_path','source_commit','configuration','projection','source_files'},'provider_release_shape')
        expected_commit=plan['source_commit'] if r['role']=='current' else plan['compatible_previous_commit']
        need(r['source_commit']==expected_commit,'provider_release_source_commit')
        release=Path(r['release_path']);need(release.is_absolute() and release.resolve()==release
            and release.parent==context.home/'Library/Application Support/SmartShadow/releases'
            and release.name.startswith('node-18765-'),'provider_release_path')
        actual={path:sha(context.source(expected_commit,path)) for path in sorted(paths)}
        need(r['source_files']==actual,'provider_static_source_inventory')
        for path,digest in actual.items():need(file_snapshot(release/path)['sha256']==digest,'provider_static_code_drift')
        config=checked_ref(r['configuration']);need(config['path']==str(release/'service.json'),'provider_static_config_path')
        parsed=decode(raw_of(config))
        need(isinstance(parsed,dict) and isinstance(parsed.get('codex_decision'),dict)
             and parsed['codex_decision'].get('provider_registry_history') is None,'provider_metadata_selected_history')
        # 投影由其实际producer产生并由具名publisher核收；这里固定完整原件hash，不把JSON当权源。
        checked_ref(r['projection'])
        families.append({path:actual[path] for path in NINE});release_paths.append(str(release))
    need(len(set(release_paths))==2,'provider_release_pair')
    current=next(i for i,r in enumerate(releases) if r['role']=='current')
    ordered=[families[current],families[1-current]]
    need(plan['family']==ordered[0] and plan['approved_nine_families']==ordered,'provider_nine_source_binding')


def provider_qualification_binding(plan):
    keys=('phase','source_commit','compatible_previous_commit','owner','source_hashes','installer_source_sha256',
          'family','approved_nine_families','static_releases','source_preservation','targets','core_contract')
    result={key:plan[key] for key in keys}
    result.update({'candidate_sha256':plan['candidate']['sha256'],'module_sha256':plan['module_candidate']['sha256'],
                   'build_base_sha256':plan['build_base']['sha256'],'preimage':{k:v['sha256'] for k,v in plan['preimage'].items()}})
    return result


def provider_publication_evidence(plan):
    need(set(plan['evidence'])=={'candidate_review','named_approval','writer_cohort','phase_qualification'},'evidence_scope')
    snapshots={name:checked_ref(ref) for name,ref in plan['evidence'].items()}
    coverage=decode(raw_of(snapshots['writer_cohort']))
    need(isinstance(coverage,dict) and coverage.get('schema')==SCHEMA+'/writer-cohort'
         and coverage.get('targets')==plan['targets']['files'] and coverage.get('holder')==plan['owner']['holder']
         and coverage.get('unknowns')==[] and isinstance(coverage.get('writers'),list) and bool(coverage['writers'])
         and all(isinstance(w,dict) and w.get('actor') and w.get('entrypoint') and w.get('lock_evidence') for w in coverage['writers']),'writer_cohort_unresolved')
    checked_ref(plan['source_preservation'])
    phase=decode(raw_of(snapshots['phase_qualification']))
    need(isinstance(phase,dict) and set(phase)=={'schema','binding','publisher','evidence_kind'}
         and phase['schema']==PROVIDER_INSTALL_SCHEMA+'/preinstall-qualification'
         and phase['binding']==provider_qualification_binding(plan) and isinstance(phase['publisher'],str) and bool(phase['publisher'])
         and phase['evidence_kind']=='named-reviewed-static-package-only','provider_preinstall_qualification')


def prepare_provider_plan(request,context):
    request_keys={'schema','operation_id','phase','source_commit','compatible_previous_commit','owner','evidence','evidence_directory',
                  'build_base','candidate','module_candidate','static_releases','source_preservation'}
    need(set(request)==request_keys and request['schema']==PROVIDER_INSTALL_SCHEMA+'/request'
         and request['phase']=='provider-history-bootstrap','provider_request_schema')
    provider_revisions(request)
    plan={key:request[key] for key in request_keys-{'schema','build_base','candidate','module_candidate'}}
    plan.update({'schema':PROVIDER_INSTALL_SCHEMA,'targets':targets(context.home),
                 'source_hashes':{path:sha(context.source(plan['source_commit'],path)) for path in SOURCE},
                 'installer_source_sha256':sha(context.source(plan['source_commit'],SELF)),
                 'family':{path:sha(context.source(plan['source_commit'],path)) for path in NINE},
                 'approved_nine_families':[{path:sha(context.source(commit,path)) for path in NINE}
                     for commit in (plan['source_commit'],plan['compatible_previous_commit'])],
                 'preimage':{name:file_snapshot(Path(path)) for name,path in targets(context.home)['files'].items()}})
    plan['core_contract']=core_contract(plan['preimage']);plan['build_base']=checked_ref(request['build_base'],True)
    for key in ('candidate','module_candidate'):
        checked_ref(request[key],True);plan[key]=dict(request[key])
    validate_provider_plan(plan,context)
    return plan


def validate_provider_plan(plan,context,check_preimage=True):
    keys={'schema','operation_id','phase','source_commit','compatible_previous_commit','owner','evidence','evidence_directory',
          'build_base','candidate','module_candidate','static_releases','source_preservation','targets','source_hashes',
          'installer_source_sha256','family','approved_nine_families','preimage','core_contract'}
    need(set(plan)==keys and provider_phase(plan) and plan['phase']=='provider-history-bootstrap','provider_plan_schema')
    provider_revisions(plan)
    need(isinstance(plan['operation_id'],str) and str(uuid.UUID(plan['operation_id']))==plan['operation_id'],'operation_id')
    need(targets(context.home)==plan['targets'],'target_or_parent_drift')
    code={path:context.source(plan['source_commit'],path) for path in SOURCE}
    need({path:sha(raw) for path,raw in code.items()}==plan['source_hashes']
         and sha(context.source(plan['source_commit'],SELF))==plan['installer_source_sha256'],'provider_source_lineage')
    provider_static_releases(plan,context);provider_publication_evidence(plan)
    composed=context.provider_bootstrap_composition(plan['source_commit'],plan['compatible_previous_commit'],plan['build_base'])
    need(composed['approved_nine_families']==plan['approved_nine_families'],'provider_nine_source_binding')
    need(checked_ref(plan['candidate'],True)['sha256']==sha(composed['controller']),'candidate_not_normal_composition')
    need(checked_ref(plan['module_candidate'],True)['sha256']==sha(composed['module']),'module_not_git_source')
    old=plan['preimage'];need(set(old)==set(REL) and core_contract(old)==plan['core_contract'],'core_lock_contract_drift')
    for name in REL:
        need(old[name]['path']==plan['targets']['files'][name],'preimage_target');raw_of(old[name])
        need(stat.S_IMODE(int(old[name]['stat']['st_mode']))==(0o755 if name=='controller' else 0o600),'preimage_mode')
        if check_preimage:need(file_snapshot(Path(old[name]['path']))==old[name],'preimage_changed')
    need(raw_of(old['module'])==composed['module'],'provider_wx_readonly_preimage')
    need(raw_of(old['controller'])==raw_of(plan['build_base']),'provider_bootstrap_exact_current_base_required')
    # metadata不能剥旧provider层以降级；正常base也不得是已合成controller。
    need(b'# BEGIN PROVIDER_TASK_REGISTRY_V1' not in raw_of(old['controller']),'provider_metadata_downgrade_forbidden')
    return {'provider-history-bootstrap':composed['controller'],'module':composed['module']}



def source_piece(raw, name, class_name=None):
    tree=ast.parse(raw);nodes=tree.body
    if class_name is not None:
        classes=[n for n in nodes if isinstance(n,ast.ClassDef) and n.name==class_name];need(len(classes)==1,'core_class_identity');nodes=classes[0].body
    found=[n for n in nodes if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name==name];need(len(found)==1,'core_method_identity')
    node=found[0];return b''.join(raw.splitlines(keepends=True)[node.lineno-1:node.end_lineno])


def core_contract(preimage):
    code=raw_of(preimage['controller']);module=raw_of(preimage['module'])
    return {'controller_sha256':sha(code),'acquire_coordination_lock_sha256':sha(source_piece(code,'acquire_coordination_lock','Controller')),
            'execute_owned_sha256':sha(source_piece(code,'_execute_owned','Controller')),'process_birth_sha256':sha(source_piece(code,'process_birth')),
            'owner_module_sha256':sha(module),'owner_method_sha256':sha(source_piece(module,'owner'))}


def evidence(plan):
    if provider_phase(plan):return provider_publication_evidence(plan)
    # 只核具名publisher已实核证据的准确字节；不把文件存在/hash解释成版本或业务批准。
    need(set(plan['evidence']) == {'candidate_review', 'named_approval', 'writer_cohort', 'phase_qualification'}, 'evidence_scope')
    for ref in plan['evidence'].values():
        need(file_snapshot(Path(ref['path']))['sha256'] == ref['sha256'], 'evidence_drift')
    coverage=decode(raw_of(file_snapshot(Path(plan['evidence']['writer_cohort']['path']))))
    need(isinstance(coverage,dict) and coverage.get('schema')==SCHEMA+'/writer-cohort'
         and coverage.get('targets')==plan['targets']['files'] and coverage.get('holder')==plan['owner']['holder']
         and coverage.get('unknowns')==[] and isinstance(coverage.get('writers'),list) and bool(coverage['writers'])
         and all(isinstance(w,dict) and w.get('actor') and w.get('entrypoint') and w.get('lock_evidence') for w in coverage['writers']), 'writer_cohort_unresolved')
    phase=decode(raw_of(file_snapshot(Path(plan['evidence']['phase_qualification']['path']))))
    expected={key:plan[key] for key in ('phase','source_commit','owner')}
    expected.update({'candidate_sha256':plan['candidate']['sha256'],'module_sha256':plan['module_candidate']['sha256'],
                     'family_sha256':sha(canonical(plan['family'])),'preimage':{k:v.get('sha256') for k,v in plan['preimage'].items()}})
    if plan['phase']=='metadata-current':
        expected['metadata_current']=plan['metadata_current']
        expected['metadata_builder_sha256']=plan['metadata_builder_sha256']
    if 'cow_policy_candidate' in plan:
        expected['cow_policy_candidate']=plan['cow_policy_candidate']
        expected['cow_policy_source_sha256']=plan['cow_policy_source_sha256']
    if plan['phase']=='metadata-current':
        need(isinstance(phase,dict) and phase.get('schema')==SCHEMA+'/metadata-current-qualification'
             and phase.get('binding')==expected and phase.get('publisher')
             and phase.get('releases')==[] and phase.get('authority')=='preservation-only','metadata_qualification_binding')
        return
    need(isinstance(phase,dict) and phase.get('schema')==SCHEMA+'/publication-qualification'
         and phase.get('binding')==expected and phase.get('publisher') and isinstance(phase.get('releases'),list)
         and len(phase['releases'])==(1 if plan['phase']=='standby' else 2), 'publication_qualification_binding')
    releases=phase['releases']
    need(len({r.get('release_path') for r in releases if isinstance(r,dict)})==len(releases)
         and all(isinstance(r,dict) and isinstance(r.get('release_path'),str) and Path(r['release_path']).is_absolute()
                 and r.get('runtime_nine')==plan['family'] and r.get('health')=='ok' and r.get('source_off') is True
                 and isinstance(r.get('receipt'),dict) for r in releases),'publication_pair_binding')
    for release in releases:
        ref=release['receipt'];need(file_snapshot(Path(ref['path']))['sha256']==ref['sha256'],'publication_receipt_drift')



def prepare_plan(request, context):
    if request.get('schema')==PROVIDER_INSTALL_SCHEMA+'/request':return prepare_provider_plan(request,context)
    need(request.get('schema') == SCHEMA+'/request', 'request_schema')
    plan = {key:request[key] for key in ('operation_id','phase','source_commit','owner','evidence','evidence_directory')}
    if plan['phase']=='metadata-current':
        need(isinstance(plan.get('source_commit'),str) and len(plan['source_commit'])==40 and all(c in '0123456789abcdef' for c in plan['source_commit']),'metadata_source_commit')
    plan.update({'schema':SCHEMA,'targets':targets(context.home,'cow_policy_candidate' in request),
                 'source_hashes':{p:sha(context.source(plan['source_commit'],p)) for p in (('dev-ops/scripts/ss-service',) if plan['phase']=='metadata-current' else SOURCE)},
                 'installer_source_sha256':sha(context.source(plan['source_commit'],SELF)),
                 'family':({} if plan['phase']=='metadata-current' else {p:sha(context.source(plan['source_commit'],p)) for p in NINE})})
    if 'cow_policy_candidate' in request:
        plan['cow_policy_candidate']=file_snapshot(Path(request['cow_policy_candidate']['path']),True)
        need(plan['cow_policy_candidate']['sha256']==request['cow_policy_candidate']['sha256'],'cow_candidate_input_changed')
        plan['cow_policy_source_sha256']=sha(context.source(plan['source_commit'],COW_SOURCE))
    plan['preimage']={name:target_snapshot(Path(plan['targets']['files'][name]),name=='cow_policy') for name in plan_names(plan)}
    if plan['phase']=='metadata-current':
        plan['metadata_builder_sha256']=sha(context.source(plan['source_commit'],METADATA_BUILDER))
        plan['metadata_current']=context.current_runtime(plan)
        plan['family']={p:v['sha256'] for p,v in plan['metadata_current']['nine'].items()}
    plan['core_contract']=core_contract(plan['preimage'])
    plan['build_base']=file_snapshot(Path(request['build_base']['path']),True)
    need(plan['build_base']['sha256']==request['build_base']['sha256'],'build_base_input_changed')
    for key in ('candidate','module_candidate'):
        observed=file_snapshot(Path(request[key]['path']),True)
        need(observed['sha256']==request[key]['sha256'],'candidate_input_changed')
        plan[key]={'path':observed['path'],'sha256':observed['sha256']}
    validate_plan(plan,context)
    return plan  # 只读输出完整可审核计划，调用方以0600保存；无日志/锁/文件创建。


def validate_plan(plan, context, check_preimage=True):
    if provider_phase(plan):return validate_provider_plan(plan,context,check_preimage)
    need(plan.get('schema') == SCHEMA and plan.get('phase') in ('standby', 'armed','metadata-current'), 'plan_schema')
    if plan['phase']=='metadata-current':need('cow_policy_candidate' in plan,'metadata_helper_required')
    need(isinstance(plan.get('operation_id'),str) and str(uuid.UUID(plan['operation_id'])) == plan['operation_id'], 'operation_id')
    actual_targets = targets(context.home,'cow_policy_candidate' in plan)
    need(actual_targets == plan['targets'], 'target_or_parent_drift')
    evidence(plan)
    composed = context.compositions(plan)
    desired = composed[plan['phase']]
    need(file_snapshot(Path(plan['candidate']['path']), True)['sha256'] == sha(desired) == plan['candidate']['sha256'], 'candidate_not_normal_composition')
    need(file_snapshot(Path(plan['module_candidate']['path']), True)['sha256'] == sha(composed['module']) == plan['module_candidate']['sha256'], 'module_not_git_source')
    if 'cow_policy_candidate' in plan:
        need(file_snapshot(Path(plan['cow_policy_candidate']['path']),True)==plan['cow_policy_candidate'],'cow_candidate_changed')
        need(plan['cow_policy_candidate']['sha256']==sha(composed['cow_policy']),'cow_candidate_not_git_source')
    old = plan['preimage']
    need(set(old)==set(plan_names(plan)),'preimage_scope')
    need(core_contract(old) == plan['core_contract'], 'core_lock_contract_drift')
    for name in plan_names(plan):
        need(old[name]['path'] == actual_targets['files'][name], 'preimage_target')
        if name=='cow_policy' and old[name].get('absent') is True:
            need(old[name]=={'path':actual_targets['files'][name],'absent':True},'cow_absent_preimage')
            if check_preimage:need(target_snapshot(Path(old[name]['path']),True)==old[name],'preimage_changed')
            continue
        raw_of(old[name])
        expected_mode = 0o755 if name == 'controller' else 0o600
        need(stat.S_IMODE(int(old[name]['stat']['st_mode'])) == expected_mode, 'preimage_mode')
        if check_preimage:
            need(file_snapshot(Path(old[name]['path'])) == old[name], 'preimage_changed')
    if plan['phase']=='metadata-current':
        metadata_core_contract(raw_of(old['controller']))
        need(raw_of(old['module'])==composed['module'] and plan['module_candidate']['sha256']==METADATA_MODULE_SHA256,'metadata_module_preservation')
        need(raw_of(plan['build_base'])==raw_of(old['controller']),'metadata_build_base_not_current')
    elif plan['phase'] == 'standby':
        need(raw_of(old['controller']) == raw_of(plan['build_base']), 'standby_install_preimage_not_build_base')
        need(b'_REGISTRY_ADOPTION_POLICY' not in raw_of(old['controller']), 'standby_downgrade_forbidden')
    else:
        need(raw_of(old['controller']) == composed['standby'] and raw_of(old['module']) == composed['module'], 'arm_preimage_not_exact_standby')
        before = composed['standby'].replace(b"_REGISTRY_ADOPTION_POLICY = 'standby'", b"_REGISTRY_ADOPTION_POLICY = 'armed'")
        need(before == composed['armed'] and composed['standby'].count(b"_REGISTRY_ADOPTION_POLICY = 'standby'") == 1, 'arm_non_policy_delta')
    return composed


def fsync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_new(path, raw, mode=0o600):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        os.fchmod(fd, mode)  # 恢复原mode，不能让调用者umask静默改变正式目标权限。
        with os.fdopen(os.dup(fd), 'wb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
    finally:
        os.close(fd)
    fsync_directory(path.parent)


def journal_path(plan):
    need(isinstance(plan.get('operation_id'),str) and str(uuid.UUID(plan['operation_id']))==plan['operation_id'],'operation_id')
    directory = Path(plan['evidence_directory'])
    info = directory.lstat()
    need(directory.resolve() == directory and stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
         and stat.S_IMODE(info.st_mode) == 0o700, 'evidence_directory')
    return directory / plan['operation_id']


def owned_ready(current, ready):
    if current.get('absent') or ready.get('absent'):return False
    a, b = current['stat'], ready['stat']
    return current['sha256'] == ready['sha256'] and current['metadata'] == ready['metadata'] and all(a[k] == b[k] for k in ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink', 'st_size', 'st_mtime_ns'))


def reconcile(plan, context):
    journal = journal_path(plan)
    try:
        need(decode(raw_of(file_snapshot(journal/'plan.json', True))) == plan, 'operation_plan_changed')
        intent = decode(raw_of(file_snapshot(journal/'intent.json', True)))
        need(intent['plan_sha256'] == sha(canonical(plan)), 'intent_plan_changed')
        need(targets(context.home,'cow_policy_candidate' in plan) == plan['targets'], 'target_or_parent_drift')
        if plan['phase']=='metadata-current':need(context.current_runtime(plan)==plan['metadata_current'],'metadata_current_drift')
        states, observed = {}, {}
        for name in plan_names(plan):
            current = target_snapshot(Path(plan['targets']['files'][name]),name=='cow_policy');observed[name] = current
            if current == plan['preimage'][name]:
                states[name] = 'old'
            elif (journal/(name+'-ready.json')).exists() and owned_ready(current, decode(raw_of(file_snapshot(journal/(name+'-ready.json'), True)))):
                states[name] = 'new'
            elif name in ('module','cow_policy') and (journal/(name+'-restore-ready.json')).exists() and owned_ready(current, decode(raw_of(file_snapshot(journal/(name+'-restore-ready.json'), True)))):
                states[name] = 'restored'
            else:
                states[name] = 'third'
        def sealed(name,label):
            try:return decode(raw_of(file_snapshot(journal/(label+'-after.json'),True))) == observed[name]
            except (OSError,ValueError,KeyError,TypeError,Fault):return False
        installed = states['controller'] == 'new' and sealed('controller','controller') and (states['module'] == 'new' and sealed('module','module') or (plan['phase'] in ('armed','metadata-current') or provider_phase(plan)) and states['module'] == 'old')
        if 'cow_policy_candidate' in plan:
            installed=installed and states['cow_policy']=='new' and sealed('cow_policy','cow_policy')
            auxiliary={k:v for k,v in states.items() if k!='controller'}
            restore_marks={k for k in auxiliary if (journal/(k+'-restore-after.json')).exists() or (journal/(k+'-restore-after.json')).is_symlink()}
            remove_intent=journal/'cow_policy-remove-intent.json'
            removal_pending=remove_intent.exists() or remove_intent.is_symlink()
            seals_valid=all(sealed(k,k+'-restore') for k in restore_marks) and all(sealed(k,k+'-restore') for k,v in auxiliary.items() if v=='restored')
            if removal_pending:
                removal=decode(raw_of(file_snapshot(remove_intent,True)))
                need(removal.get('operation_id')==plan['operation_id'] and removal.get('preimage')==plan['preimage']['cow_policy'] and removal.get('preimage',{}).get('absent') is True,'remove_intent_identity')
                need(owned_ready(removal['owned'],decode(raw_of(file_snapshot(journal/'cow_policy-ready.json',True)))),'remove_intent_owned')
                seals_valid=seals_valid and states['cow_policy']=='old' and sealed('cow_policy','cow_policy-restore')
            restored=seals_valid and bool(restore_marks) and all(v in ('old','restored') for v in auxiliary.values())
            state=('unknown' if not seals_valid else 'installed_code_only' if installed else 'compensated_auxiliary_only' if states['controller']=='old' and restored
                   else 'not_installed' if set(states.values())=={'old'}
                   else 'partial_auxiliary_only' if states['controller']=='old' and all(v in ('old','new','restored') for v in auxiliary.values()) and 'new' in auxiliary.values()
                   else 'unknown')
        else:
            state = ('installed_code_only' if installed else 'not_installed' if set(states.values()) == {'old'}
                 else 'compensated_module_only' if states == {'controller':'old','module':'restored'} and sealed('module','module-restore')
                 else 'partial_module_only' if states == {'controller':'old','module':'new'} else 'unknown')
        return {'schema':SCHEMA, 'operation_id':plan['operation_id'], 'state':state, 'files':states,
                'read_only_reconciliation':True, 'business_acceptance':False,
                'observed':{k:({'absent':True} if v.get('absent') else {'sha256':v['sha256'],'stat':v['stat']}) for k,v in observed.items()}}
    except (OSError, ValueError, KeyError, TypeError, Fault):
        return {'schema':SCHEMA, 'operation_id':plan.get('operation_id'), 'state':'unknown', 'read_only_reconciliation':True, 'business_acceptance':False}


def apply(plan, context):
    journal = journal_path(plan)
    if journal.exists() or journal.is_symlink():
        return reconcile(plan, context)  # 同key已有任何进度都只读；不重发/补写。
    composed = validate_plan(plan, context)
    logical = Path(plan['targets']['logical_root'])/'bin/ss-service'
    core = context.core(raw_of(plan['preimage']['controller']), logical)
    controller = core['Controller']('node', plan['owner']['holder'], 'reviewed-controller-composition-install')
    try:coordination_fd = controller.acquire_coordination_lock()
    except Exception as error:raise Fault('current_core_serialization_unverified') from error
    # 原Core同一serialization锁，无新锁/退避。
    try:
        serial = stamp(os.fstat(coordination_fd))
        need(stamp(controller.coordination_lock.lstat()) == serial, 'serialization_identity')
        try:adapter = context.owner_adapter(core)
        except Exception as error:raise Fault('current_core_loader_unverified') from error
        expected_targets=dict(plan['preimage'])
        def verify():
            evidence(plan)
            if plan['phase']=='metadata-current':need(context.current_runtime(plan)==plan['metadata_current'],'metadata_current_drift')
            need(stamp(os.fstat(coordination_fd)) == stamp(controller.coordination_lock.lstat()) == serial, 'serialization_drift')
            try:actual = adapter.owner(controller, core)
            except Exception as error:raise Fault('held_owner_unverified') from error
            for key in ('holder','owner_pid','owner_birth','lock_inode','owner_sha256'):
                need(actual[key] == plan['owner'][key], 'held_owner_changed')
            need(targets(context.home,'cow_policy_candidate' in plan) == plan['targets'], 'target_or_parent_drift')
            if 'cow_policy_candidate' in plan or provider_phase(plan):
                for name,expected in expected_targets.items():
                    need(target_snapshot(Path(plan['targets']['files'][name]),name=='cow_policy')==expected,'all_targets_changed')
        verify()
        # 锁前读/compile不授资格；锁内再完整重核来源、前像与审批文件。
        validate_plan(plan, context)
        journal.mkdir(mode=0o700);fsync_directory(journal.parent)
        write_new(journal/'plan.json', canonical(plan))
        for name in plan_names(plan):
            if not plan['preimage'][name].get('absent'):
                write_new(journal/(name+'-before.bin'), raw_of(plan['preimage'][name]))
        write_new(journal/'intent.json', canonical({'plan_sha256':sha(canonical(plan)), 'targets':plan['targets']['files'], 'owner':plan['owner']}))
        def install_one(name, raw, expected, label):
            verify();path = Path(plan['targets']['files'][name])
            need(target_snapshot(path,name=='cow_policy') == expected, 'preimage_changed')
            staged = path.with_name('.'+path.name+'.'+plan['operation_id']+'.'+label)
            metadata_source=plan['cow_policy_candidate'] if expected.get('absent') else expected
            mode = stat.S_IMODE(int(metadata_source['stat']['st_mode']))
            write_new(staged, b'', mode)
            metadata_command(['/usr/bin/ditto','--rsrc','--extattr','--acl','--qtn',metadata_source['path'],str(staged)])
            copied=file_snapshot(staged);need(copied['metadata']==metadata_source['metadata'],'staged_copy_metadata')
            fd=os.open(staged,os.O_WRONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
            try:
                need(stamp(os.fstat(fd))==copied['stat'],'staged_copy_drift')
                os.ftruncate(fd,0)
                with os.fdopen(os.dup(fd),'wb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
            finally:os.close(fd)
            ready = file_snapshot(staged)
            need(ready['metadata']==metadata_source['metadata'],'staged_write_metadata')
            need(ready['stat']['st_uid'] == metadata_source['stat']['st_uid'] and ready['stat']['st_gid'] == metadata_source['stat']['st_gid']
                 and stat.S_IMODE(int(ready['stat']['st_mode'])) == mode, 'staged_metadata_not_preserved')
            write_new(journal/(label+'-ready.json'), canonical(ready))
            context.checkpoint('before-'+label+'-replace')
            verify();need(target_snapshot(path,name=='cow_policy') == expected, 'preimage_changed')
            # 应用级CAS依赖上述全writer排他/完整前像；replace只是单文件原子步骤。
            parent_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                expected_parent=plan['targets']['parents'][str(path.parent)]
                need(all(str(getattr(os.fstat(parent_fd),key))==expected_parent[key] for key in ('st_dev','st_ino','st_mode','st_uid','st_gid')), 'parent_fd_identity')
                need(parent_identity(path.parent) == expected_parent, 'parent_identity')
                # ready封存之后的checkpoint/读取可能发生漂移；最后持有同一FD核路径与完整ready。
                staged_fd=os.open(staged.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent_fd)
                try:
                    verify();need(target_snapshot(path,name=='cow_policy')==expected,'preimage_changed')
                    need(parent_identity(path.parent)==expected_parent,'parent_identity')
                    staged_now=file_snapshot(staged)
                    need(stamp(os.fstat(staged_fd))==staged_now['stat'] and staged_now==ready,'staged_ready_drift')
                    os.replace(staged.name, path.name, src_dir_fd=parent_fd, dst_dir_fd=parent_fd)
                finally:os.close(staged_fd)
                context.checkpoint('after-'+label+'-replace')
                fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent_fd)
                try:
                    opened=os.fstat(fd)
                    need(stat.S_ISREG(opened.st_mode) and opened.st_uid==os.getuid() and opened.st_nlink==1, 'installed_fd_identity')
                    current=file_snapshot(path)
                    need(stamp(opened)==current['stat'] and owned_ready(current,ready), 'installed_fd_drift')
                    os.fsync(fd)
                finally:
                    os.close(fd)
                os.fsync(parent_fd)
            finally:
                os.close(parent_fd)
            after = file_snapshot(path);need(owned_ready(after, ready), 'installed_readback_unknown')
            write_new(journal/(label+'-after.json'), canonical(after))
            expected_targets[name]=after
            context.checkpoint('after-'+label+'-readback')
            return after
        try:
            if 'cow_policy_candidate' in plan:
                install_one('cow_policy',composed['cow_policy'],plan['preimage']['cow_policy'],'cow_policy')
            if plan['phase'] == 'standby':
                install_one('module', composed['module'], plan['preimage']['module'], 'module')
            install_one('controller', composed[plan['phase']], plan['preimage']['controller'], 'controller')
            verify();result = reconcile(plan, context)
            need(result['state'] == 'installed_code_only', 'installed_readback_unknown')
            write_new(journal/'complete.json', canonical(result))
            return result
        except BaseException as error:
            # 只在确定owned module部分态、Controller仍完整old、原锁owner仍在时补偿。
            result = reconcile(plan, context)
            if result['state']=='partial_auxiliary_only':
                try:
                    # 只对由ready同inode/hash/metadata证明owned的已知辅助文件补偿；unknown不触。
                    guarded={}
                    for n in plan_names(plan):
                        current=target_snapshot(Path(plan['targets']['files'][n]),n=='cow_policy')
                        state=result['files'][n]
                        if state=='old':need(current==plan['preimage'][n],'restore_old_drift')
                        elif state=='new':need(owned_ready(current,decode(raw_of(file_snapshot(journal/(n+'-ready.json'),True)))),'restore_owned_drift')
                        elif state=='restored':need(current==decode(raw_of(file_snapshot(journal/(n+'-restore-after.json'),True))),'restore_seal_drift')
                        else:raise Fault('restore_unproven_state')
                        guarded[n]=current
                    expected_targets.update(guarded)
                    for name in ('module','cow_policy'):
                        if result['files'][name]!='new':continue
                        verify();path=Path(plan['targets']['files'][name]);current=expected_targets[name]
                        if plan['preimage'][name].get('absent'):
                            need(name=='cow_policy','absence_scope')
                            need(owned_ready(current,decode(raw_of(file_snapshot(journal/(name+'-ready.json'),True)))),'restore_not_owned')
                            context.checkpoint('before-cow_policy-remove')
                            verify();need(target_snapshot(path,True)==current,'restore_changed')
                            parent_fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
                            try:
                                expected_parent=plan['targets']['parents'][str(path.parent)]
                                need(all(str(getattr(os.fstat(parent_fd),k))==expected_parent[k] for k in ('st_dev','st_ino','st_mode','st_uid','st_gid')),'restore_parent_fd_identity')
                                need(parent_identity(path.parent)==expected_parent,'restore_parent_identity')
                                need(stamp(os.stat(path.name,dir_fd=parent_fd,follow_symlinks=False))==current['stat'],'restore_fd_drift')
                                write_new(journal/'cow_policy-remove-intent.json',canonical({'operation_id':plan['operation_id'],'preimage':plan['preimage'][name],'owned':current}))
                                # intent耐久写入后重新核owner/完整owned目标/父目录；漂移保持unknown。
                                verify();need(target_snapshot(path,True)==current,'restore_changed')
                                need(all(str(getattr(os.fstat(parent_fd),k))==expected_parent[k] for k in ('st_dev','st_ino','st_mode','st_uid','st_gid')),'restore_parent_fd_identity')
                                need(parent_identity(path.parent)==expected_parent,'restore_parent_identity')
                                need(stamp(os.stat(path.name,dir_fd=parent_fd,follow_symlinks=False))==current['stat'],'restore_fd_drift')
                                os.unlink(path.name,dir_fd=parent_fd)
                                context.checkpoint('after-cow_policy-remove')
                                os.fsync(parent_fd)
                            finally:os.close(parent_fd)
                            after=target_snapshot(path,True);need(after==plan['preimage'][name],'restore_absence_unknown')
                            expected_targets[name]=after;write_new(journal/(name+'-restore-after.json'),canonical(after))
                        else:install_one(name,raw_of(plan['preimage'][name]),current,name+'-restore')
                    result=reconcile(plan,context)
                except BaseException:result=reconcile(plan,context)
            if result['state'] == 'partial_module_only':
                try:
                    verify();current = file_snapshot(Path(plan['targets']['files']['module']))
                    install_one('module', raw_of(plan['preimage']['module']), current, 'module-restore')
                    result = reconcile(plan, context)
                except BaseException:
                    result = reconcile(plan, context)
            result['failure_code'] = str(error) if isinstance(error,Fault) else type(error).__name__
            return result
    finally:
        os.close(coordination_fd)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    inputs=parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument('--plan', type=Path)
    inputs.add_argument('--request', type=Path)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--reconcile', action='store_true')
    args = parser.parse_args(argv)
    need(not(args.apply and args.reconcile), 'action_conflict')
    need(not(args.request and (args.apply or args.reconcile)), 'request_is_readonly')
    plan = decode(raw_of(file_snapshot(args.plan or args.request, True)))
    repo = Path.home()/'Projects/smart-shadow'
    need(Path(__file__).resolve() == repo/SELF and repo.resolve() == repo, 'canonical_installer_required')
    context = Context(Path.home(), repo)
    if args.request:
        result=prepare_plan(plan,context)
        print(json.dumps(result,ensure_ascii=False,sort_keys=True))
        return 0
    if args.reconcile:
        result = reconcile(plan, context)
    elif args.apply:
        need(file_snapshot(repo/SELF)['sha256'] == plan['installer_source_sha256'], 'running_installer_drift')
        result = apply(plan, context)
    else:
        validate_plan(plan, context)
        result = {'schema':SCHEMA, 'operation_id':plan['operation_id'], 'state':'plan_bytes_validated',
                  'read_only':True, 'phase_qualification':'publisher_must_verify_actual_evidence', 'business_acceptance':False}
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0 if result['state'] not in ('unknown','partial_module_only','partial_auxiliary_only') else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (Fault,OSError,ValueError,KeyError,TypeError) as error:
        print(json.dumps({'state':'unknown','code':str(error) if isinstance(error,Fault) else type(error).__name__, 'business_acceptance':False}))
        sys.exit(1)
