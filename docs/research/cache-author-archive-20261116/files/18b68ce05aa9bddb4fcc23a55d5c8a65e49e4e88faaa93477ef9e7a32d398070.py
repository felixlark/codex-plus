"""P OFF 的正式 Main 物理绑定层私候选；无 CLI、无来源或生命周期写入。"""
from __future__ import annotations
import copy
import hashlib
import json
import os
from pathlib import Path
import plistlib
import stat
import subprocess
import uuid

SUBJECT = 'feishu-task-approval-off/v1'
PROVIDERS = frozenset({'feishu_task', 'feishu_approval'})
SIBLINGS = ('ss-deploy-main.py', 'p-source-off-publication.py', 'p-off-proof.py',
            'p-off-comparison.py', 'p-factory-projection.mjs')

def need(ok, code):
    if not ok:
        raise RuntimeError(code)

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def pinned(path, *, private=False):
    path = Path(path)
    info = path.lstat()
    need(path.resolve() == path and stat.S_ISREG(info.st_mode)
         and info.st_uid == os.getuid() and not info.st_mode & 0o022, 'p_file_identity')
    need(not private or not info.st_mode & 0o077, 'p_private_file_mode')
    return path.read_bytes()

def reference(path):
    return {'path':str(path), 'sha256':digest(pinned(path, private=True))}

def put(path, payload):
    raw = (json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    need(pinned(path, private=True) == raw, 'p_proof_write_readback')
    return reference(path)

def input_contract(directory, *, candidate, target_release, target_config):
    """绑定本批私有输入及原owner提案字节；本函数不把文件声明视作新授权。"""
    path=directory/'p-off-input-contract.json'
    contract_raw=pinned(path,private=True)
    document=json.loads(contract_raw)
    need(document.get('schema') == 'smart-shadow.p-off-input-contract/v1'
         and document.get('candidate_sha') == candidate
         and document.get('target_release') == target_release, 'p_input_subject')
    providers=document.get('providers')
    need(isinstance(providers,dict) and set(providers) == PROVIDERS, 'p_input_provider_denominator')
    allowed=[Path.home()/'Library/Caches/me.longbiaochen.smart-shadow',
             Path.home()/'Library/Logs/me.longbiaochen.smart-shadow']
    proposals={}
    for provider,pointer in providers.items():
        need(isinstance(pointer,dict) and set(pointer) == {'path','sha256'}, 'p_input_proposal_reference')
        source=Path(pointer['path'])
        need(source.is_absolute() and any(source.is_relative_to(root) for root in allowed), 'p_input_proposal_path')
        raw=pinned(source)
        need(digest(raw) == pointer['sha256'], 'p_input_proposal_digest')
        block=json.loads(raw)
        need(block == target_config[provider] and block.get('enabled') is True
             and isinstance(block.get('entries'),list) and len(block['entries']) == 1,
             'p_input_config_not_approved_off')
        proposals[provider]=pointer
    need(pinned(path,private=True) == contract_raw, 'p_input_contract_changed_during_read')
    return {'reference':{'path':str(path),'sha256':digest(contract_raw)},'proposals':proposals}

def git_bytes(sha, relative):
    return subprocess.run(['git','show',sha + ':' + relative],
                          capture_output=True, check=True, timeout=30).stdout

def objects(value):
    if isinstance(value,dict):
        yield value
        for child in value.values():yield from objects(child)
    elif isinstance(value,list):
        for child in value:yield from objects(child)

def journal_proof(pointer, *, directory, run_id, baseline, phase):
    """核 Main 当次实际 journal；不以 caller 的 closed=true 代替原件。"""
    need(isinstance(pointer, dict) and set(pointer) == {'path','sha256'}, 'p_journal_reference')
    path = Path(pointer['path'])
    need(path.parent == directory and path.name.startswith('mail-source-journal-'), 'p_journal_path')
    raw = pinned(path, private=True)
    need(digest(raw) == pointer['sha256'], 'p_journal_digest')
    journal = json.loads(raw)
    need(journal.get('schema') == 'smart-shadow.mail-source-transaction/v1'
         and journal.get('run_id') == run_id and journal.get('baseline') == baseline,
         'p_journal_run_or_baseline')
    events, records = journal.get('events'), journal.get('records')
    need(isinstance(events, list) and events and isinstance(records, list), 'p_journal_shape')
    expected = 'quiet_verified' if phase.startswith('quiesced_') else 'restore_complete'
    need(events[-1].get('event') == expected, 'p_journal_terminal_event')
    originals = {row['collector_ref']:row for row in baseline}
    eligible = {ref for ref,row in originals.items() if row['enabled'] and row['available']}
    need(len(records) == len(eligible)
         and {r['before']['collector_ref'] for r in records} == eligible, 'p_journal_owned_records')
    for row in records:
        before = row['before']; ref = before['collector_ref']
        need(before == originals[ref] and row.get('disable_ack') is True, 'p_journal_disable_ownership')
        ack = row.get('disable_receipt')
        need(isinstance(ack,dict) and ack.get('selector') == {'kind':'collector','id':ref}
             and ack.get('collector_refs') == [ref] and ack.get('enabled') is False
             and type(ack.get('revision')) is int and ack['revision'] == row['disable_revision'],
             'p_journal_disable_ack')
        if phase.startswith('closed_'):
            need(row.get('restored') is True, 'p_journal_restore_unverified')
    if phase.startswith('closed_'):
        last = events[-1]
        need(last.get('gaps') == [] and isinstance(last.get('actual_sources'),list), 'p_journal_closure_gap')
        actual = {row['collector_ref']:row for row in last['actual_sources']}
        need(len(actual) == len(last['actual_sources']), 'p_journal_duplicate_actual')
        for ref,before in originals.items():
            need(ref in actual and all(actual[ref].get(k) == before[k]
                 for k in ('source','enabled','available')), 'p_journal_original_source_state')
    return {'reference':pointer, 'run_id':run_id, 'terminal_event':expected,
            'owned_record_count':len(records)}

class POffProof:
    subject = SUBJECT

    def __init__(self, *, main, github, comparison, args, log_dir, inode, birth,
                 controller_sha256, baseline, baseline_plist, baseline_physical,
                 source_transaction, plan_path):
        self.main, self.github, self.comparison, self.args = main, github, comparison, args
        self.log_dir, self.inode, self.birth = log_dir, inode, birth
        self.controller_sha256 = controller_sha256
        self.baseline = copy.deepcopy(baseline)
        self.baseline_plist, self.baseline_physical = baseline_plist, copy.deepcopy(baseline_physical)
        self.sources, self.plan_path = source_transaction, plan_path
        self.previous = baseline['runtime']['client_service']['release']
        self.target = main.SS_ROOT / 'releases' / args.target_release
        need(self.target.resolve() == self.target and self.target.name != self.previous, 'p_target_path')
        self.target_plist = pinned(args.plist)
        need(Path(plistlib.loads(self.target_plist)['WorkingDirectory']) == self.target, 'p_target_plist_path')
        old_root = Path(plistlib.loads(baseline_plist)['WorkingDirectory'])
        self.old_config = json.loads(pinned(old_root / 'service.json'))
        self.target_config_raw = pinned(self.target / 'service.json')
        self.target_config = json.loads(self.target_config_raw)
        self.input_contract=input_contract(log_dir,candidate=args.sha,
            target_release=args.target_release,target_config=self.target_config)
        unchanged = copy.deepcopy(self.target_config)
        for provider in PROVIDERS:
            need(provider not in self.old_config or self.old_config[provider] == {'enabled':False,'entries':[]},
                 'p_existing_provider_config')
            if provider in self.old_config: unchanged[provider] = self.old_config[provider]
            else: unchanged.pop(provider, None)
        if 'web_root' in self.old_config: unchanged['web_root'] = self.old_config['web_root']
        else: unchanged.pop('web_root',None)
        need(unchanged == self.old_config and self.target_config.get('web_root') == str(self.target / 'web/dist'),
             'p_non_target_config_changed')
        self.source_pins = {}
        for name in SIBLINGS:
            path = Path(main.__file__).parent / name
            expected = digest(git_bytes(args.sha,'scripts/' + name))
            need(digest(pinned(path)) == expected
                 and digest(pinned(self.target/'scripts'/name)) == expected, 'p_publisher_git_binding')
            self.source_pins[str(path)] = expected
        self.manifest_sha256 = None
        self.frozen_plan_sha256 = None
        self.verify_staged_source()
        node=self.target/'node-runtime/node'
        need(digest(pinned(node)) == self.baseline_physical['pins'].get(str(old_root/'node-runtime/node'))
             and os.access(node,os.X_OK), 'p_projection_node_not_original_runtime')
        # factory CLI 只输出真实 schema/registration 元数据，禁止 Store/guard/open/平台执行。
        scratch = Path.home()/'Library/Caches/me.longbiaochen.smart-shadow/p-off-enrollment'/uuid.uuid4().hex
        scratch.mkdir(mode=0o700, parents=True)
        proc = subprocess.run([str(self.target/'node-runtime/node'),
            str(Path(main.__file__).parent/'p-factory-projection.mjs'),
            str(self.target),str(self.target/'service.json'),str(scratch)],
            capture_output=True,text=True,check=True,timeout=120)
        projection = json.loads(proc.stdout)
        need(projection.get('state') == 'projected_untrusted'
             and projection.get('input_raw_sha256') == digest(self.target_config_raw)
             and projection.get('actual_store_or_platform_called') is False
             and projection.get('checkpoint_created') is False, 'p_projection_not_metadata')
        self.rows = projection['rows']
        need(len(self.rows) == 2 and {r['provider'] for r in self.rows} == PROVIDERS, 'p_projection_denominator')
        self.verify_readers()
        for relative,want in projection['factory_files'].items():
            need(relative.startswith('service/src/')
                 and digest(git_bytes(args.sha,relative)) == want
                 and digest(pinned(self.target/relative)) == want, 'p_factory_git_binding')
        self.projection_ref = put(log_dir/'p-off-factory-projection.json',projection)
        self.seal_ref = put(log_dir/'p-off-baseline-seal.json',
            {'schema':'smart-shadow.p-off-baseline-seal/v1','candidate_sha':args.sha,
             'previous_release':self.previous,'target_release':args.target_release,
             'baseline':self.baseline,'physical':self.baseline_physical,
             'target_config_sha256':digest(self.target_config_raw),
             'publisher_pins':self.source_pins,'projection':self.projection_ref,
             'input_contract':self.input_contract,'manifest_sha256':self.manifest_sha256})

    def verify_staged_source(self):
        raw=pinned(self.target/'github-delivery-manifest.json')
        manifest=json.loads(raw);expected=self.github.candidate_files(self.args.sha)
        need(manifest.get('sha') == self.args.sha and manifest.get('files') == expected, 'p_manifest_git_binding')
        for relative,want in expected.items():
            path=self.target/relative
            need(path.resolve().is_relative_to(self.target) and digest(pinned(path)) == want, 'p_installed_source_drift')
        need(self.manifest_sha256 is None or digest(raw) == self.manifest_sha256, 'p_manifest_drift')
        self.manifest_sha256=digest(raw)

    def verify_readers(self):
        """只核默认正式路径、当前UID执行位、字节和代码签名；不运行reader。"""
        support = self.main.SS_ROOT
        for row in self.rows:
            reader,guard = row['reader'],row['process_guard']
            binary=Path(reader['binary']);want=guard['target_sha256']
            need(binary == support/'readers/lark-reader'/want/'smart-shadow-lark-reader'
                 and digest(pinned(binary)) == want and os.access(binary,os.X_OK), 'p_reader_default_identity')
            matches=[old for old in objects(self.old_config)
                     if old.get('target_requirement') == guard.get('target_requirement')
                     and 'target_sha256' in old and {**old,'target_sha256':want} == guard]
            need(bool(matches), 'p_guard_not_preserved_from_original')
            need(digest(pinned(Path(guard['binary']))) == guard['sha256'], 'p_guard_binary_drift')
            subprocess.run(['/usr/bin/codesign','--verify','--strict','-R',guard['target_requirement'],str(binary)],
                           capture_output=True,check=True,timeout=30)
            archive=Path(self.target_config[row['provider']]['archive_root'])
            need(archive.is_absolute() and archive.resolve() == archive
                 and archive.is_relative_to(support), 'p_archive_physical_alias')
            for parent in [archive,*archive.parents]:
                if parent == support.parent:break
                if parent.exists():
                    info=parent.lstat()
                    need(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
                         and not info.st_mode&0o022, 'p_archive_parent_identity')

    def verify_binding(self, *, candidate_sha, previous, target):
        need((candidate_sha,previous,target) == (self.args.sha,self.previous,self.args.target_release), 'p_subject_binding')
        need(digest(pinned(self.target/'service.json')) == digest(self.target_config_raw), 'p_config_drift')
        need(input_contract(self.log_dir,candidate=candidate_sha,target_release=target,
             target_config=self.target_config) == self.input_contract, 'p_input_contract_drift')
        self.verify_readers()
        need(all(digest(pinned(Path(p))) == want for p,want in self.source_pins.items()), 'p_publisher_drift')
        self.verify_staged_source()
        plan_raw = pinned(self.plan_path,private=True)
        if self.frozen_plan_sha256 is None: self.frozen_plan_sha256 = digest(plan_raw)
        need(digest(plan_raw) == self.frozen_plan_sha256, 'p_plan_drift')
        plan = json.loads(plan_raw)
        need(bytes.fromhex(plan['original_plist']) == self.baseline_plist
             and bytes.fromhex(plan['target_plist']) == self.target_plist
             and plan['old_pins'] == self.baseline_physical['pins'], 'p_plan_original_binding')
        return True

    def verify_snapshot(self, observation, *, phase, closure=None, failed_stats=None):
        candidate = phase in ('quiesced_candidate','closed_candidate')
        need(phase in ('quiesced_previous','quiesced_candidate','closed_candidate','closed_previous'), 'p_phase')
        plan_raw = pinned(self.plan_path,private=True)
        need(reference(Path(self.seal_ref['path'])) == self.seal_ref, 'p_baseline_seal_drift')
        need(digest(plan_raw) == self.frozen_plan_sha256, 'p_snapshot_plan_drift')
        plan = json.loads(plan_raw)
        physical = self.main.mail_runtime_proof(self.log_dir,self.args.holder,self.inode,self.birth,
            self.controller_sha256,expected_plist=bytes.fromhex(plan['target_plist' if candidate else 'original_plist']),
            expected_pins=plan['new_pins' if candidate else 'old_pins'])
        expected_release = self.args.target_release if candidate else self.previous
        need(physical['release'] == expected_release
             and observation['runtime']['client_service']['release'] == expected_release
             and observation['health'].get('status') == 'ok', 'p_actual_runtime_binding')
        expected_schema=self.args.expected_entity_schema if candidate else self.baseline['health']['entity_schema']
        need(observation['health'].get('entity_schema') == expected_schema, 'p_actual_schema_binding')
        paused=observation.get('routing',{}).get('paused_thread_ids') if isinstance(observation.get('routing'),dict) else None
        need(isinstance(paused,list) and all(isinstance(x,str) for x in paused)
             and set(self.old_config.get('codex_decision',{}).get('paused_thread_ids',[])) <= set(paused),
             'p_paused_runtime_unknown_or_removed')
        collectors = observation['runtime']['collectors']
        need(collectors.get('storage_outcome_unknown') is False and collectors.get('stop_unconfirmed') == 0,
             'p_storage_or_stop_unknown')
        if phase.startswith('quiesced_'): need(collectors.get('active') == 0, 'p_not_physically_quiet')
        baseline_rows = [self.main.MailSourceTransaction.identity(row)
                         for row in self.baseline['controls']['collectors']]
        proof = journal_proof(closure if closure is not None else self.sources.last_receipt,
            directory=self.log_dir,run_id=self.sources.run_id,baseline=baseline_rows,phase=phase)
        comparison = self.comparison.compare_snapshots(self.baseline,observation,self.rows,
                                                       phase=phase,failed_stats=failed_stats)
        need(comparison.get('data_comparison_passed') is True, 'p_data_comparison:' + str(comparison.get('reason')))
        payload = {'schema':'smart-shadow.p-off-snapshot-proof/v1','subject':SUBJECT,
            'phase':phase,'baseline_seal':self.seal_ref,'projection':self.projection_ref,
            'physical':physical,'journal':proof,'data_comparison':comparison,
            'manifest_sha256':self.manifest_sha256,'p_snapshot_verified':True,
            'full_release_accepted':False}
        pointer = put(self.log_dir/('p-off-proof-'+phase+'-'+uuid.uuid4().hex+'.json'),payload)
        return {'p_snapshot_verified':True,'proof':pointer,'full_release_accepted':False}
