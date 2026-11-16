#!/usr/bin/env python3
"""Smart Shadow 本机唯一部署入口（t1404u / issue #315）。

合入 main 精确 SHA 后，在 sol 上跑本脚本（或 ss-deploy-main.sh）：
  短租约锁 → 正式 collector quiesce → 有限 prepare → switch → 最小读回。

t1408u 规约 v1：G＝备份父目录强制 0o700（不合规禁重试）；
H＝prepare 前正式 quiesce（超时 quiesce_*，不进 prepare 风暴）；
I＝成功门禁 health∧schema∧release∧receipt；observe 瞬时失败 live 再读。
omit consistent-backup 默认禁（须另旨＋emergency 旗）。

红线：禁未合入／错 SHA；禁跳过 backup／rollback；禁 Cursor 云差；
禁第二路抢同一 deploy.lock；禁把网页 GitHub Deploy 当权威。
Desktop Execution 不是 deploy 主路径（见 docs/GITHUB_DELIVERY.md、dev-ops/docs/agent-queue.md）。
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
import plistlib
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path

HOME = Path.home()
SS_ROOT = HOME / 'Library/Application Support/SmartShadow'
LOCK = SS_ROOT / 'deploy.lock'
CTL = HOME / 'Library/Application Support/dev-ops/bin/ss-service'
API = HOME / 'Library/Application Support/dev-ops/bin/ss-api'
DB = SS_ROOT / 'node-service/runtime/state.sqlite'
DEFAULT_LOG_ROOT = HOME / 'Library/Logs/me.longbiaochen.smart-shadow'
NODE_PLIST = HOME / 'Library/LaunchAgents/me.longbiaochen.smart-shadow.node-18765-candidate.plist'

# B / D budgets (proposal defaults)
LOCK_WAIT_SECONDS = 120
TOTAL_BUDGET_SECONDS = 900  # 15 min after lock
PREPARE_RETRY_MAX = 5
PREPARE_RETRY_WINDOW_SECONDS = 60
QUIESCE_STABLE_SECONDS = 3
QUIESCE_TIMEOUT_SECONDS = 180

# G／C5: mode／backup_target_invalid 是确定性失败，禁重试（见 HARD_NO_RETRY_PREPARE）
RETRYABLE_PREPARE = (
    'switch_active_collector_or_storage_unknown',
    'switch_node_child_group_mismatch',
    'node_database_owner_ambiguous',
    'switch_preparation_changed',
    'switch_children_unknown',
)

HARD_NO_RETRY_PREPARE = (
    'switch_backup_target_invalid',
    'backup_parent_mode_invalid',
    'omit_backup_forbidden',
    'backup_preflight_rejected',
)

NEXT_STEPS = {
    'deploy_lock_busy': '等对家放锁或另旨收束其对家进程；勿第二路抢同一 deploy.lock',
    'deploy_lock_acquire_timeout': '核对 deploy.lock/owner 与 retention；勿 kill 未知 pid',
    'quiesce_timeout': '查 collector-control 未停项、runtime.active、storage_outcome_unknown',
    'quiesce_unstable': '采集器抖动：重跑本入口或先人工 collector-control 全关再切',
    'prepare_retry_exhausted': '读 transaction.log 末次 failure_code；修根因后重开本入口',
    'prepare_switch_timeout': '同 prepare_retry_exhausted',
    'total_budget_exhausted': '本轮短租约耗尽已放锁；查日志后另开一轮',
    'entity_schema_mismatch': '候选未达预期 schema：走 rollback 后核 release／health',
    'release_name_mismatch': '切后 release 名≠目标：走既有 rollback 合同',
    'helper_not_installed': '先按 github-deploy 合同安装 gh-config-user helper',
    'missing_plist': '准备下一版 LaunchAgent plist 后再跑',
    'quiet_window_timeout': '同 quiesce_timeout',
    'switch_backup_target_invalid': '备份父目录 mode 须为 0o700：chmod 700 后重开本入口；禁对同一码重试',
    'backup_parent_mode_invalid': 'mkdir 后强制 chmod 0o700 并 stat 断言；禁重试掩盖',
    'omit_backup_forbidden': 'omit consistent-backup 默认禁；须另旨＋--emergency-omit-consistent-backup＋承认旗',
    'backup_preflight_rejected': '读取 storage-retention preflight 的错误；控制面不可用时不得无备份继续切换',
    'observe_transient_exhausted': '切后 observe 瞬时失败已耗尽 live 再读；先 live 核 release 再决定是否 rollback',
    'receipt_missing': '成功门禁缺 receipt：禁报 deployed',
    'deployed_masked_as_rollback': 'live 已是目标 release：禁假报 rolled_back；写 STATUS 并人工对账',
}


class DeployFailure(RuntimeError):
    def __init__(self, code: str, detail: str = '', next_step: str | None = None):
        self.failure_code = code
        self.detail = detail or code
        self.next_step = next_step or NEXT_STEPS.get(code, '查 transaction.log／STATUS.json 后另旨')
        super().__init__(self.detail)


def now_iso() -> str:
    return dt.datetime.now().astimezone().isoformat(timespec='seconds')


def load_github_deploy(path: Path):
    spec = importlib.util.spec_from_file_location('ghdeploy', path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def controller_supports_producer_quiesce(ctl: Path = CTL) -> bool:
    try:
        p = subprocess.run([str(ctl), '-h'], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return False
    text = (p.stdout or '') + (p.stderr or '')
    return '--producer-quiesce' in text


class ServiceCommandFailure(RuntimeError):
    """保留正式控制器真实流，供github-deploy按结构化码/流分类；末行仅为显示。"""
    def __init__(self, command, completed):
        self.cmd = tuple(command)
        self.returncode = completed.returncode
        self.stdout = completed.stdout or ''
        self.stderr = completed.stderr or ''
        text = (self.stderr or self.stdout or 'ss_service_failed').strip()
        super().__init__(text.splitlines()[-1] if text else 'ss_service_failed')


def controller_supports_plan_recovery(ctl: Path = CTL) -> bool:
    try:
        result = subprocess.run([str(ctl), '-h'], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return False
    text = (result.stdout or '') + (result.stderr or '')
    return result.returncode == 0 and all(name in text for name in (
        'quiesce-switched', 'restore-switched-previous', '--previous-desktop-execution-schema'))


"""093只读门：正式previous启动命令非零后，仅准外层独立observe；不是成功证明。"""
from pathlib import Path
import datetime as dt
import hashlib
import json
import os
import re
import stat
import subprocess

MAIL_RECOVERY_OBSERVATION_ONLY='independent_previous_observe_required'

class MailRecoveryInvalidIntent(Exception):pass

def _mail_intent_need(condition):
    if not condition:raise MailRecoveryInvalidIntent()

def _mail_intent_stamp(info):
    return tuple(getattr(info,k) for k in ('st_dev','st_ino','st_mode','st_uid','st_nlink','st_size','st_mtime_ns','st_ctime_ns'))

def _mail_intent_read(path,maximum=2*1024*1024,*,private=True):
    path=Path(path)
    if private:_mail_intent_need(path.is_absolute() and path.resolve()==path)
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        before=os.fstat(fd)
        _mail_intent_need(stat.S_ISREG(before.st_mode) and before.st_uid==os.getuid() and before.st_nlink==1
              and (maximum is None or before.st_size<=maximum) and (not private or stat.S_IMODE(before.st_mode)==0o600))
        with os.fdopen(os.dup(fd),'rb') as stream:raw=stream.read((before.st_size if maximum is None else maximum)+1)
        _mail_intent_need((maximum is None or len(raw)<=maximum) and _mail_intent_stamp(before)==_mail_intent_stamp(os.fstat(fd)) and _mail_intent_stamp(before)==_mail_intent_stamp(path.lstat()))
        return raw
    finally:os.close(fd)

def _mail_intent_json(path,maximum=2*1024*1024):
    raw=_mail_intent_read(path,maximum);value=json.loads(raw);_mail_intent_need(isinstance(value,dict));return raw,value

def _mail_intent_sha(raw):return hashlib.sha256(raw).hexdigest()

def _mail_intent_process_birth(pid):
    """只读原caller的lstart，沿正式控制器15秒process预算；不读env/argv。"""
    result=subprocess.run(['ps','-p',str(pid),'-o','lstart='],capture_output=True,text=True,timeout=15,
                          env={'LC_ALL':'C','TZ':'UTC'})
    _mail_intent_need(result.returncode==0 and not result.stderr.strip() and len(result.stdout.strip().splitlines())==1)
    value=' '.join(result.stdout.split())
    dt.datetime.strptime(value,'%a %b %d %H:%M:%S %Y')
    return value

def _mail_intent_command(failure,action,controller,holder,plan,lock):
    _mail_intent_need(type(getattr(failure,'returncode',None)) is int and failure.returncode!=0)
    command=getattr(failure,'cmd',None)
    _mail_intent_need(isinstance(command,(tuple,list)) and command and command[0]==str(controller)
          and all(isinstance(value,str) for value in command))
    flags={};actions=[];index=1
    allowed={'--component','--holder','--reason','--plan','--held-lock-inode','--owner-birth'}
    while index<len(command):
        item=command[index]
        if item in allowed:
            _mail_intent_need(item not in flags and index+1<len(command));flags[item]=command[index+1];index+=2
        else:
            _mail_intent_need(item==action);actions.append(item);index+=1
    _mail_intent_need(actions==[action] and set(flags)==allowed and flags['--component']=='node'
          and flags['--holder']==holder and flags['--plan']==str(plan)
          and flags['--held-lock-inode']==str(lock['inode']) and flags['--owner-birth']==lock['birth']
          and bool(flags['--reason'].strip()))

def _mail_intent_verify(failure,*,action,plan_path,expected_plan_sha256,holder,baseline_proof,controller_path,support_root):
    _mail_intent_need(action in ('restore-switched-previous','rollback-failed-start'))
    plan_path=Path(plan_path);controller_path=Path(controller_path);support_root=Path(support_root)
    _mail_intent_need(plan_path.is_absolute() and plan_path.resolve()==plan_path and plan_path.name=='switch-plan.json'
          and support_root.is_absolute() and support_root.resolve()==support_root)
    _mail_intent_need(re.fullmatch('[a-f0-9]{64}',expected_plan_sha256) is not None)
    lock=baseline_proof['lock'];controller_sha=baseline_proof['controller_sha256']
    _mail_intent_need(type(lock['pid']) is int and lock['pid']==os.getpid() and lock['pid']>0
          and re.fullmatch('[a-f0-9]{64}',controller_sha) is not None)
    _mail_intent_command(failure,action,controller_path,holder,plan_path,lock)
    lock_path=support_root/'deploy.lock';info=lock_path.lstat();owner_raw=_mail_intent_read(lock_path/'owner',4096)
    _mail_intent_need(stat.S_ISDIR(info.st_mode) and not lock_path.is_symlink() and lock_path.resolve()==lock_path
          and info.st_uid==os.getuid() and stat.S_IMODE(info.st_mode)==0o700
          and info.st_dev==lock['device'] and info.st_ino==lock['inode']
          and _mail_intent_sha(owner_raw)==lock['owner_sha256'] and _mail_intent_sha(_mail_intent_read(controller_path,maximum=None,private=False))==controller_sha)
    owner_text=owner_raw.decode()
    matches=re.findall(r'(?:^|\s)pid=([1-9][0-9]*)(?=\s|$)',owner_text)
    _mail_intent_need(matches==[str(lock['pid'])] and owner_text.startswith(holder+' ')
          and _mail_intent_process_birth(lock['pid'])==lock['birth'])
    owner={'holder':holder,'pid':lock['pid'],'birth':lock['birth'],'lock_dev':lock['device'],
           'lock_inode':lock['inode'],'owner_sha256':lock['owner_sha256'],'controller_sha256':controller_sha}
    raw,plan=_mail_intent_json(plan_path);_mail_intent_need(_mail_intent_sha(raw)==expected_plan_sha256 and plan.get('version')==1 and plan.get('holder')==holder)
    descriptor={'schema':'ss-service.previous-runtime-compatibility/v1','metadata_key':'desktop_execution_schema','expected_value':'2'}
    descriptor_sha=_mail_intent_sha(json.dumps(descriptor,sort_keys=True,separators=(',',':')).encode())
    _mail_intent_need(plan.get('previous_runtime_compatibility')==descriptor and plan.get('previous_runtime_compatibility_sha256')==descriptor_sha)
    directory=support_root/'ordinary-switch-recovery'/expected_plan_sha256
    for path in (directory.parent,directory):
        value=path.lstat();_mail_intent_need(path.resolve()==path and stat.S_ISDIR(value.st_mode) and value.st_uid==os.getuid() and stat.S_IMODE(value.st_mode)==0o700)
    binding={'owner':owner,'plan_path':str(plan_path),'plan_sha256':expected_plan_sha256}
    snapshots={plan_path:_mail_intent_sha(raw),controller_path:controller_sha,lock_path/'owner':_mail_intent_sha(owner_raw)}
    def phase(name):
        path=directory/(name+'.json');data,value=_mail_intent_json(path);snapshots[path]=_mail_intent_sha(data)
        _mail_intent_need(value.get('schema')=='ss-service-ordinary-switch/v1' and value.get('phase')==name
              and all(value.get(key)==item for key,item in binding.items()))
        return value
    begin=phase('switch-requested')
    for key in ('old_pins','new_pins','ordinary_publication'):_mail_intent_need(begin.get(key)==plan.get(key))
    _mail_intent_need(begin.get('original_plist_sha256')==_mail_intent_sha(bytes.fromhex(plan['original_plist']))
          and begin.get('target_plist_sha256')==_mail_intent_sha(bytes.fromhex(plan['target_plist']))
          and begin.get('original_host')=={'pid':plan['host_pid'],'birth':plan['host_birth']}
          and begin.get('original_node')==plan['node']
          and begin.get('previous_runtime_compatibility')==descriptor
          and begin.get('previous_runtime_compatibility_sha256')==descriptor_sha)
    intent=phase('restore-requested' if action=='restore-switched-previous' else 'failed-start-requested')
    routes=('prestart_baseline_abort','restore-switched-previous','original_switch_internal_rollback') if action=='restore-switched-previous' else ('rollback-failed-start',)
    _mail_intent_need(intent.get('bootstrap_outcome')=='unknown_until_readback' and intent.get('route') in routes)
    compatibility=intent.get('previous_compatibility',{})
    _mail_intent_need(compatibility.get('descriptor_sha256')==descriptor_sha and compatibility.get('metadata_key')=='desktop_execution_schema'
          and compatibility.get('expected_value')=='2' and compatibility.get('actual_value')=='2'
          and compatibility.get('sqlite_mode')=='ro' and compatibility.get('query_only') is True
          and compatibility.get('only_metadata_read') is True)
    logdir=plan_path.parent;reference=plan['ordinary_publication'];opened=logdir/'maintenance-publication-open.json'
    _mail_intent_need(reference.get('path')==str(opened));opened_raw,publication=_mail_intent_json(opened,65536);snapshots[opened]=_mail_intent_sha(opened_raw)
    log_info=logdir.lstat()
    _mail_intent_need(_mail_intent_sha(opened_raw)==reference.get('sha256') and publication.get('schema')=='ss-service.ordinary-publication/v1'
          and publication.get('owner')==owner and publication.get('plan_path')==str(plan_path)
          and publication.get('logdir')=={'path':str(logdir),'device':log_info.st_dev,'inode':log_info.st_ino}
          and logdir.resolve()==logdir and stat.S_ISDIR(log_info.st_mode) and log_info.st_uid==os.getuid()
          and not stat.S_IMODE(log_info.st_mode)&0o022 and not list(logdir.glob('maintenance-window-closed*.json')))
    source=publication['cohort_source'];source_path=Path(source['path'])
    _mail_intent_need(source_path.parent==logdir and source_path.resolve()==source_path)
    source_raw=_mail_intent_read(source_path,65536);_mail_intent_need(_mail_intent_sha(source_raw)==source['sha256']);snapshots[source_path]=_mail_intent_sha(source_raw)
    # 不调用Controller/坏helper/数据库/API；不把TTL/metadata再用于阻止旧previous独立读回。
    for path,digest in snapshots.items():
        maximum=None if path==controller_path else (65536 if path in (opened,source_path) else 2*1024*1024)
        _mail_intent_need(_mail_intent_sha(_mail_intent_read(path,maximum,private=path!=controller_path))==digest)
    after=lock_path.lstat();_mail_intent_need(_mail_intent_stamp(after)==_mail_intent_stamp(info) and _mail_intent_process_birth(lock['pid'])==lock['birth']
                                and not list(logdir.glob('maintenance-window-closed*.json')))
    return MAIL_RECOVERY_OBSERVATION_ONLY

def recovery_intent_allows_observe(failure,*,action,plan_path,expected_plan_sha256,holder,baseline_proof,
                                   controller_path=None,support_root=None):
    """True只允许外层transaction独立observe，绝不代表success/healthy/已回退。

    baseline_proof和plan SHA必须是原Root在switch前内存冻结的事实，不能从切后现场重建。
    调用点仅放在这两个正式ss_run的except ServiceCommandFailure；False原样raise原异常。
    """
    home=Path.home()
    try:
        return _mail_intent_verify(failure,action=action,plan_path=plan_path,expected_plan_sha256=expected_plan_sha256,
            holder=holder,baseline_proof=baseline_proof,
            controller_path=controller_path or home/'Library/Application Support/dev-ops/bin/ss-service',
            support_root=support_root or home/'Library/Application Support/SmartShadow')==MAIL_RECOVERY_OBSERVATION_ONLY
    # 任何只读核验/诊断自身异常均拒准，由调用点原样raise原正式命令异常；不吞BaseException。
    except Exception:return False


def mail_preaction_snapshot(plan_path, holder, context):
    """子进程仅复用已验Core只读guard；其真实parent仍为原held-lock owner。"""
    if context is None:
        return None
    try:
        pipe_read, pipe_write = os.pipe()
    except OSError:
        return None
    try:
        pid = os.fork()
    except OSError:
        os.close(pipe_read);os.close(pipe_write)
        return None
    if pid == 0:
        os.close(pipe_read)
        value = None
        try:
            import types
            baseline = context['baseline_proof']
            expected_sha = context['expected_plan_sha256']
            raw = _mail_intent_read(CTL, maximum=None, private=False)
            _mail_intent_need(_mail_intent_sha(raw) == baseline['controller_sha256'])
            _mail_intent_need(baseline['lock']['pid'] == os.getppid())
            module = types.ModuleType('actual_core_readonly_preaction')
            module.__file__ = str(CTL)
            sys.modules[module.__name__] = module
            exec(compile(raw, str(CTL), 'exec'), module.__dict__)
            ctl = module.Controller('node', holder, 'read-only original-cap pre-action verification')
            # window=True沿Core既有created_at/1800检查，不续期nonforward或plan。
            plan, original, target, paths, binding = ctl._ordinary_context(plan_path, window=True)
            lock = baseline['lock']
            expected_owner = {'holder':holder,'pid':lock['pid'],'birth':lock['birth'],
                'lock_dev':lock['device'],'lock_inode':lock['inode'],
                'owner_sha256':lock['owner_sha256'],'controller_sha256':baseline['controller_sha256']}
            _mail_intent_need(binding['owner'] == expected_owner and binding['plan_sha256'] == expected_sha)
            # 此额外机会只在原plan预算投影内；不改变Core的独立计时定义。
            _mail_intent_need(0 <= time.time()-plan['created_at'] < plan['switch_budget_seconds'])
            names = {'switch-requested','bootstrap-requested','bootstrap-call-requested','bootstrap-result'}
            directory = paths['switch-requested'].parent
            _mail_intent_need({p.name for p in directory.iterdir()} == {n+'.json' for n in names})
            phases = {n:ctl._ordinary_read(paths[n],binding,n) for n in names}
            _mail_intent_need(phases['bootstrap-result'].get('outcome') == 'accepted'
                and phases['bootstrap-result'].get('returncode') == 0)
            candidate = ctl._ordinary_candidate(plan,target,binding,phases['bootstrap-requested'])
            tracked = [Path(plan_path),CTL,ctl.lock/'owner',*(paths[n] for n in sorted(names)),
                Path(plan['ordinary_publication']['path'])]
            opened = json.loads(_mail_intent_read(tracked[-1]))
            tracked.append(Path(opened['cohort_source']['path']))
            stamps = {str(p):{'stat':_mail_intent_stamp(p.lstat()),
                'sha256':_mail_intent_sha(_mail_intent_read(p,maximum=None,private=p != CTL))} for p in tracked}
            # 在同一次快照内再次核Core原上下文、全部四phase及实际核心PID/listener。
            again = ctl._ordinary_context(plan_path, window=True)
            _mail_intent_need(again[0] == plan and again[4] == binding
                and ctl._ordinary_candidate(plan,target,binding,phases['bootstrap-requested']) == candidate)
            _mail_intent_need({p.name for p in directory.iterdir()} == {n+'.json' for n in names})
            _mail_intent_need(all(_mail_intent_stamp(Path(p).lstat()) == tuple(v['stat'])
                and _mail_intent_sha(_mail_intent_read(Path(p),maximum=None,private=Path(p) != CTL)) == v['sha256']
                for p,v in stamps.items()))
            value = {'binding':binding,'candidate':candidate,'target_sha256':_mail_intent_sha(target),
                'pins':ctl.node_release_files(target),'stamps':stamps,
                'plan_budget_projection_deadline':plan['created_at']+plan['switch_budget_seconds'],
                'core_created_at_window_deadline':plan['created_at']+1800,
                'retry_before':min(plan['created_at']+plan['switch_budget_seconds'],plan['created_at']+1800)}
        except BaseException:
            pass  # 不输出错误正文/凭据；unknown只表示不准额外重发。
        try:
            with os.fdopen(pipe_write,'w') as stream:
                json.dump(value,stream)
        finally:
            os._exit(0)
    os.close(pipe_write)
    try:
        with os.fdopen(pipe_read,'rb') as stream:
            raw = stream.read()
    except Exception:
        raw = b''
    finally:
        _, status = os.waitpid(pid,0)
    if status != 0:
        return None
    try:
        return json.loads(raw)
    except (ValueError,TypeError):
        return None


def mail_known_no_action(error):
    """额外重发只接收单一、完整的真实拒绝协议；诊断码或混合输出不代准入。"""
    if (not isinstance(error, ServiceCommandFailure)
            or type(error.returncode) is not int or error.returncode != 1):
        return False
    streams = [value.strip() for value in (error.stderr,error.stdout) if value.strip()]
    if len(streams) != 1:
        return False
    if streams[0] == 'ordinary_switch_group_changed':
        return True
    try:
        value = json.loads(streams[0])
    except (ValueError,TypeError):
        return False
    return (isinstance(value,dict) and set(value) <= {'code','failure_code','status'}
        and bool(set(value) & {'code','failure_code'})
        and all(value[key] == 'ordinary_switch_group_changed' for key in ('code','failure_code') if key in value)
        and value.get('status','error') in ('error','failed'))


def quiesce_started_candidate(log_dir, holder, reason, plan_path, inode, birth, context=None):
    """首次正式补偿无条件尝试；仅精零动作拒绝可在原窗口重核后续试。"""
    try:
        proof = mail_preaction_snapshot(plan_path,holder,context)
    except Exception:
        proof = None
    args = ['--plan',str(plan_path),'--held-lock-inode',str(inode),'--owner-birth',birth,'quiesce-switched']
    prior_error = None
    while True:
        # 最后一项资格检查紧邻额外真实CLI；首次调用不受新重核资格/窗口限制。
        if prior_error is not None and time.time() >= proof['retry_before']:
            raise prior_error
        try:
            return ss_run(log_dir,holder,reason,args)
        except ServiceCommandFailure as error:
            if (proof is None or not mail_known_no_action(error)
                    or time.time() >= proof['retry_before']):
                raise
            try:
                _mail_intent_command(error,'quiesce-switched',CTL,holder,Path(plan_path),context['baseline_proof']['lock'])
            except Exception:
                raise error
            try:
                current = mail_preaction_snapshot(plan_path,holder,context)
            except Exception:
                raise error
            if current is None or current != proof or time.time() >= current['retry_before']:
                raise
            # 下一调用仍执行完整原Core guard；不修改cap/phase、没有新TTL/count/backoff。
            log_line(log_dir,'ordinary_quiesce_known_no_action_rechecked; original_cap_and_candidate_unchanged')
            prior_error = error


def recover_started_candidate(log_dir, holder, reason, plan_path, inode, birth, pause_policy=None, recovery_intent_context=None):
    """同原plan/holder/锁的正式恢复；控制器负责能力、OS精停及停后DB兼容核。"""
    if pause_policy:
        pause_policy.before_recovery(plan_path)
    bound = ['--plan', str(plan_path), '--held-lock-inode', str(inode), '--owner-birth', birth]
    # 不先要求失联候选的API/旧cohort；quiesce未知或失败时绝不继续bootstrap。
    quiesced=quiesce_started_candidate(log_dir,holder,reason,plan_path,inode,birth,recovery_intent_context)
    stdout=getattr(quiesced,'stdout',None)
    if (getattr(quiesced,'returncode',None)!=0 or not isinstance(stdout,str) or not stdout.strip()):
        raise DeployFailure('ordinary_quiesce_response_unknown')
    try: outcome=json.loads(stdout)
    except (ValueError,TypeError):raise DeployFailure('ordinary_quiesce_response_unknown') from None
    if (not isinstance(outcome,dict) or outcome.get('status') not in
            {'candidate_not_started','candidate_quiesced','candidate_quiesced_historical','baseline_recovery_already_requested'}):
        raise DeployFailure('ordinary_quiesce_response_unknown')
    if (outcome['status']=='candidate_not_started' and outcome.get('next_action') not in
            {'independent_previous_readback','restore-switched-previous'}):
        raise DeployFailure('ordinary_quiesce_response_unknown')
    if (isinstance(outcome,dict) and outcome.get('status')=='candidate_not_started'
            and outcome.get('next_action')=='independent_previous_readback'):
        if (outcome.get('schema')!='ss-service-ordinary-switch/v1'
                or outcome.get('read_only') is not True or outcome.get('previous_pointer') is not True
                or outcome.get('candidate_bootstrap_proven') is not False or recovery_intent_context is None):
            raise DeployFailure('ordinary_unstarted_readback_binding_invalid')
        raw=Path(plan_path).read_bytes()
        if hashlib.sha256(raw).hexdigest()!=recovery_intent_context['expected_plan_sha256']:
            raise DeployFailure('ordinary_unstarted_plan_changed')
        frozen=json.loads(raw);original=bytes.fromhex(frozen['original_plist'])
        try:
            proof=mail_runtime_proof(log_dir,holder,inode,birth,
                recovery_intent_context['baseline_proof']['controller_sha256'],
                expected_plist=original,expected_pins=frozen['old_pins'])
        except DeployFailure as error:
            if error.failure_code!='mail_runtime_node_identity_unknown':raise
            # 是否可恢复停下的previous只交正式Core原plan guard决定，不从指针推健康。
        else:
            try:
                runtime=api_json('GET','/api/v2/runtime');health=api_json('GET','/api/v2/health')
            except (RuntimeError,subprocess.TimeoutExpired):
                pass
            else:
                expected=Path(plistlib.loads(original)['WorkingDirectory']).name
                if (proof['release']==expected and runtime['client_service']['release']==expected
                        and health.get('status')=='ok'):
                    log_line(log_dir,'ordinary_candidate_not_started_previous_readback_ok; no_restore_lifecycle')
                    return outcome
    try:
        ss_run(log_dir, holder, reason, [*bound, 'restore-switched-previous'])
    except ServiceCommandFailure as primary:
        if recovery_intent_context is None or not recovery_intent_allows_observe(primary,
                action='restore-switched-previous',plan_path=plan_path,holder=holder,
                controller_path=CTL,support_root=SS_ROOT,**recovery_intent_context):
            raise
        # 真实启动intent已封证，只交外层transaction独立读回；不自称恢复成功、不重复bootstrap。



# 临时Mail profile的原源开关事务；默认generic发布不采用。统一兼容3/九pin后退役。
def mail_runtime_proof(log_dir, holder, inode, birth, controller_sha256, expected_plist=None, expected_pins=None):
    """沿已验控制器只读核OS/启动文件/原锁；不调用任何生命周期或候选helper。"""
    import types
    assert_maintenance_window_open(log_dir)
    raw = CTL.read_bytes()
    if hashlib.sha256(raw).hexdigest() != controller_sha256:
        raise DeployFailure('mail_controller_identity_changed')
    module = types.ModuleType('mail_runtime_readonly_' + uuid.uuid4().hex)
    module.__file__ = str(CTL)
    sys.modules[module.__name__] = module
    try:
        exec(compile(raw, str(CTL), 'exec'), module.__dict__)
        owner = module.pinned_file(LOCK / 'owner', 8192, private=True)
        lock = LOCK.lstat()
        if (LOCK.is_symlink() or lock.st_ino != inode or lock.st_uid != os.getuid()
                or module.process_birth(os.getpid()) != birth
                or not owner.decode().startswith(f'{holder} pid={os.getpid()} ')):
            raise DeployFailure('mail_original_lock_identity_changed')
        ctl = module.Controller('node', holder, 'mail source restore read-only identity proof')
        owner_proof = ctl._ordinary_owner(allow_self=True)
        if (owner_proof['pid'] != os.getpid() or owner_proof['birth'] != birth
                or owner_proof['lock_inode'] != inode or owner_proof['controller_sha256'] != controller_sha256):
            raise DeployFailure('mail_original_lock_identity_changed')
        plist = NODE_PLIST.read_bytes()
        if expected_plist is not None and plist != expected_plist:
            raise DeployFailure('mail_runtime_plist_changed')
        pins = ctl.node_release_files(plist)
        if expected_pins is not None and pins != expected_pins:
            raise DeployFailure('mail_runtime_start_files_changed')
        job, node = ctl.job(), ctl.node_owner()
        if (type(job) is not int or job <= 0 or not isinstance(node, dict)
                or node.get('ppid') != job or node.get('pgid') != job
                or ctl.node_identity(node['pid']) != node):
            raise DeployFailure('mail_runtime_node_identity_unknown')
        host_birth = module.process_birth(job)
        if host_birth is None:
            raise DeployFailure('mail_runtime_host_identity_unknown')
        ctl._ordinary_host_identity(plist, job, host_birth)
        ctl.assert_node_listener(node, 'mail_source_restore')
        release = Path(plistlib.loads(plist)['WorkingDirectory']).name
        proof = {'controller_sha256': controller_sha256, 'release': release,
                 'lock': {'device':lock.st_dev, 'inode':inode, 'owner_sha256':hashlib.sha256(owner).hexdigest(),
                          'pid':os.getpid(), 'birth':birth},
                 'plist_sha256':hashlib.sha256(plist).hexdigest(), 'pins':pins,
                 'host':{'pid':job, 'birth':host_birth}, 'node':node}
        if (CTL.read_bytes() != raw or LOCK.lstat().st_ino != inode
                or module.pinned_file(LOCK / 'owner', 8192, private=True) != owner
                or NODE_PLIST.read_bytes() != plist or ctl.node_release_files(plist) != pins
                or ctl.job() != job or ctl.node_owner() != node
                or module.process_birth(job) != host_birth):
            raise DeployFailure('mail_runtime_identity_changed_during_read')
        assert_maintenance_window_open(log_dir)
        return proof
    finally:
        sys.modules.pop(module.__name__, None)


def mail_delivery_evidence(log_dir, plan_path, observation, source_transaction, controller_sha256):
    def reference(path):
        path = Path(path)
        if not path.exists():
            return None
        raw = path.read_bytes()
        return {'path':str(path.resolve()),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
    raw = plan_path.read_bytes()
    plan = json.loads(raw)
    plan_sha = hashlib.sha256(raw).hexdigest()
    phases = SS_ROOT/'ordinary-switch-recovery'/plan_sha
    names = ('switch-requested','backup-failed','forward-declined','bootstrap-requested','bootstrap-call-requested',
             'bootstrap-result','candidate-observed','quiesce-requested','host-exited','node-stop-requested',
             'quiesced','restore-requested','restore-result','failed-start-entry-requested','failed-start-requested','failed-start-result')
    backup = plan.get('consistent_backup')
    backup_receipt = reference(Path(backup['path']).with_suffix('.proof.json')) if isinstance(backup,dict) else None
    return {'controller':{'path':str(CTL),'sha256':controller_sha256},
            'plan':{'path':str(plan_path),'sha256':plan_sha}, 'backup':{'plan':backup,'receipt':backup_receipt},
            'build':{'release':reference(log_dir/'release-build.json'),'controller':reference(log_dir/'controller-build.json')},
            'switch_and_rollback':{name:ref for name in names if (ref:=reference(phases/(name+'.json'))) is not None},
            'health':observation, 'sources':source_transaction.last_receipt}


class MailDeploymentEvidence:
    """保留真实已读API与原始失败；补偿失败不能覆盖前一阶段的证据。"""
    SERVICE_CODES = frozenset({
        'ordinary_switch_group_changed','switch_backup_sqlite_failed','rollback-failed-start',
        'bootstrap_failed_job_present','bootstrap_failed_job_absent','switch_start_failed',
        'ordinary_switch_previous_metadata_incompatible','ordinary_switch_quiesce_outcome_unknown',
        'ordinary_switch_foreign_group_member','ordinary_switch_owner_identity',
        'ordinary_switch_candidate_generation_changed','ordinary_switch_target_changed',
    })
    def __init__(self, log_dir, forward_deadline):
        self.log_dir, self.forward_deadline = log_dir, forward_deadline
        self.before = self.candidate = self.primary = None
        self.references = {}

    def _write(self, phase, payload):
        path = self.log_dir / f'mail-deployment-evidence-{phase}-{uuid.uuid4().hex}.json'
        fd = os.open(path, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as stream:
            json.dump({'schema':'smart-shadow.mail-deployment-evidence/v1',
                'phase':phase,'observed_at':now_iso(),
                'remaining_forward_seconds':self.forward_deadline-time.time(),
                **payload}, stream, ensure_ascii=False, indent=2)
            stream.write('\n');stream.flush();os.fsync(stream.fileno())
        ref = {'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
        self.references[phase] = ref
        return ref

    def observation(self, phase, observation):
        # JSON拷贝冻结本次已读结果；不补齐尚未读到的routing/后续API。
        value = json.loads(json.dumps(observation))
        if phase == 'before_switch':
            self.before = value
        elif phase == 'candidate':
            self.candidate = value
        else:
            raise ValueError('mail_evidence_phase_invalid')
        return self._write(phase, {'actual_api_observation':value})

    @staticmethod
    def failure_info(error):
        if error is None:
            return None
        code = error.failure_code if isinstance(error, DeployFailure) else None
        if not isinstance(code, str) or re.fullmatch('[a-z][a-z0-9_]*', code) is None:
            code = None
        # generic异常即使正文长得像标识符也不是可信错误码；只保类型。
        result = {'type':type(error).__name__,'code':code}
        if isinstance(error, ServiceCommandFailure):
            # 正式命令只解析真实流；不能从异常显示末行推定controller失败码。
            for origin, text in (('stderr',error.stderr),('stdout',error.stdout)):
                for line in text.splitlines():
                    value = line.strip()
                    try:
                        obj = json.loads(value[value.index('{'):])
                    except (ValueError, TypeError):
                        obj = None
                    if isinstance(obj, dict):
                        value = obj.get('failure_code',obj.get('code'))
                    if isinstance(value, str) and value in MailDeploymentEvidence.SERVICE_CODES:
                        result['code'],result['code_origin'] = value,origin
                        break
                if result['code'] is not None:
                    break
            result['returncode'] = error.returncode
            if error.cmd and error.cmd[-1] in ('switch','quiesce-switched','restore-switched-previous','rollback-failed-start'):
                result['service_action'] = error.cmd[-1]
        return result

    def failure(self, phase, error):
        info = {'phase':phase,'error':self.failure_info(error),'at':now_iso()}
        if self.primary is None:
            self.primary = info
        return self._write('failure', {'primary_failure':self.primary,'current_failure':info,
            'before_stats':self.before['stats'] if self.before is not None else None,
            'failed_stats':self.candidate['stats'] if self.candidate is not None else None,
            'api_observation_references':dict(self.references),
            'not_a_success_receipt':True})


def mail_off_source_availability(plan, runtime_proof, baseline):
    """仅冻结正常 A/B 的配置与实际候选允许原 WX OFF 的派生 available 改变。"""
    if plan is None:
        return None
    rows = [row for row in baseline if row['collector_ref'] == 'weixin-filehelper-7d']
    if len(rows) != 1 or rows[0]['source'] != 'weixin' or rows[0]['enabled'] is not False:
        return None
    original = bytes.fromhex(plan['original_plist'])
    target = bytes.fromhex(plan['target_plist'])
    paths = [Path(plistlib.loads(raw)['WorkingDirectory']) / 'service.json' for raw in (original, target)]
    configs = []
    digests = []
    for path, pins in zip(paths, (plan['old_pins'], plan['new_pins'])):
        raw = _mail_intent_read(path)
        digest = _mail_intent_sha(raw)
        if pins.get(str(path)) != digest:
            raise DeployFailure('mail_availability_config_pin_changed')
        configs.append(json.loads(raw))
        digests.append(digest)
    before, after = configs
    old_enabled = before.get('weixin_collectors', {}).get('enabled')
    new_enabled = after.get('weixin_collectors', {}).get('enabled')
    if (type(old_enabled) is not bool or type(new_enabled) is not bool
            or old_enabled == new_enabled or rows[0]['available'] is not old_enabled):
        return None
    if (runtime_proof.get('release') != paths[1].parent.name
            or runtime_proof.get('plist_sha256') != _mail_intent_sha(target)
            or runtime_proof.get('pins') != plan['new_pins']):
        raise DeployFailure('mail_availability_runtime_binding_changed')
    if old_enabled:
        unchanged = json.loads(json.dumps(after))
        unchanged['weixin_collectors']['enabled'] = True
        unchanged['web_root'] = before.get('web_root')
        if 'web_root' not in before:
            unchanged.pop('web_root', None)
        canonical = lambda value: json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
        if (canonical(unchanged) != canonical(before)
                or after.get('web_root') != str(paths[1].parent / 'web/dist')):
            return None
    else:
        # B 复用精 Git 包的私聊配置合同，不在部署器另写一份宽松的字段清单。
        node = paths[1].parent / 'node-runtime/node'
        contract = paths[1].parent / 'service/src/channels/weixin-private-scope.ts'
        manifest = json.loads(_mail_intent_read(paths[1].parent / 'github-delivery-manifest.json', private=False))
        if (plan['new_pins'].get(str(node)) != _mail_intent_sha(_mail_intent_read(node, maximum=None, private=False))
                or manifest.get('files', {}).get('service/src/channels/weixin-private-scope.ts')
                != _mail_intent_sha(_mail_intent_read(contract, private=False))):
            raise DeployFailure('mail_availability_private_contract_pin_changed')
        script = """import fs from 'node:fs';import {pathToFileURL} from 'node:url';
const {assertPrivateConfigurationTransition}=await import(pathToFileURL(process.argv[1]).href);
const i=JSON.parse(fs.readFileSync(0,'utf8'));assertPrivateConfigurationTransition(i.before,i.after);
console.log(JSON.stringify({verified:true}));"""
        result = subprocess.run([str(node), '--input-type=module', '-e', script, str(contract)],
            input=json.dumps({'before':before, 'after':after}), capture_output=True, text=True)
        if result.returncode != 0 or result.stdout.strip() != '{"verified":true}':
            return None
    return {'collector_ref':'weixin-filehelper-7d', 'source':'weixin', 'enabled':False,
            'before_available':old_enabled, 'expected_available':new_enabled,
            'original_config_sha256':digests[0], 'candidate_config_sha256':digests[1],
            'candidate_release':runtime_proof['release']}


class MailSourceTransaction:
    """本轮逐行intent/ack/postimage账；unknown不重复PUT，不覆盖其他writer停用。"""
    def __init__(self, log_dir, run_id):
        self.log_dir, self.run_id = log_dir, run_id
        self.baseline, self.records, self.events = [], [], []
        self.sequence = 0
        self.last_receipt = None

    def save(self, event, **fields):
        self.events.append({'event':event, 'at':now_iso(), **fields})
        self.sequence += 1
        path = self.log_dir / f'mail-source-journal-{self.sequence:04d}.json'
        payload = {'schema':'smart-shadow.mail-source-transaction/v1', 'run_id':self.run_id,
                   'baseline':self.baseline, 'records':self.records, 'events':self.events}
        fd = os.open(path, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as stream:
            json.dump(payload, stream, ensure_ascii=False, indent=2);stream.write('\n');stream.flush();os.fsync(stream.fileno())
        self.last_receipt = {'path':str(path), 'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}

    @staticmethod
    def identity(row):
        if (not isinstance(row, dict) or not isinstance(row.get('collector_ref'), str)
                or not isinstance(row.get('source'), str) or type(row.get('enabled')) is not bool
                or type(row.get('revision')) is not int or row['revision'] <= 0
                or type(row.get('available')) is not bool):
            raise DeployFailure('mail_source_metadata_invalid')
        return {key:row[key] for key in ('collector_ref','source','enabled','revision','available')}

    @staticmethod
    def path(ref):
        from urllib.parse import quote
        return '/api/v2/collector-control/collectors/' + quote(ref, safe='')

    @staticmethod
    def valid_ack(value, ref, enabled, revision):
        return (isinstance(value, dict) and value.get('selector') == {'kind':'collector','id':ref}
                and value.get('enabled') is enabled and type(value.get('revision')) is int and value.get('revision') == revision
                and value.get('collector_refs') == [ref])

    def quiesce(self, *, stable_seconds, timeout):
        rows = api_json('GET', '/api/v2/collector-control')['collectors']
        self.baseline = [self.identity(row) for row in rows]
        if len({row['collector_ref'] for row in self.baseline}) != len(self.baseline):
            raise DeployFailure('mail_source_duplicate_identity')
        self.save('baseline')
        for before in self.baseline:
            if not before['enabled'] or not before['available']:
                continue
            ref = before['collector_ref']
            rec = {'before':before, 'disable_key':f'ss-deploy-quiesce-{self.run_id}-{hashlib.sha256(ref.encode()).hexdigest()}',
                   'disable_revision':before['revision']+1, 'disable_ack':False, 'restore_requested':False}
            self.records.append(rec);self.save('disable_requested', collector_ref=ref)
            try:
                ack = api_json('PUT', self.path(ref), {'enabled':False, 'expected_revision':before['revision'],
                    'reason':'maintenance'}, idem=rec['disable_key'])
                if not self.valid_ack(ack, ref, False, rec['disable_revision']):
                    raise DeployFailure('mail_source_disable_receipt_unbound')
                rec['disable_ack'] = True;rec['disable_receipt'] = ack
                self.save('disable_acknowledged', collector_ref=ref)
                current = self.identity(api_json('GET', self.path(ref)))
                rec['disable_observation'] = current
                if current != {**before, 'enabled':False, 'revision':rec['disable_revision']}:
                    raise DeployFailure('mail_source_quiesce_postimage_changed')
                self.save('disable_verified', collector_ref=ref)
            except Exception as exc:
                rec['disable_error_type'] = type(exc).__name__
                self.save('disable_failed_or_unknown', collector_ref=ref)
                raise
        # 账已归main持有；此处失败不会丢失已禁/unknown的各行。
        wait_stable_quiet(self.log_dir, stable_seconds=stable_seconds, timeout=timeout)
        self.save('quiet_verified')

    def requiesce_owned_restored(self, check_runtime):
        """补偿前尽力关本轮已ack恢复的源；API未知不阻挡正式Core精停/Node0证明。"""
        for rec in self.records:
            if 'restore_receipt' not in rec:
                continue
            ref, before = rec['before']['collector_ref'], rec['before']
            try:
                current = self.identity(api_json('GET', self.path(ref)))
                expected = {**before,'enabled':True,'revision':rec['disable_revision']+1}
                if current != expected:
                    self.save('requiesce_postimage_changed_no_write',collector_ref=ref)
                    continue
                if rec.get('requiesce_for_revision') == current['revision']:
                    self.save('requiesce_already_requested_no_repeat',collector_ref=ref)
                    continue
                check_runtime()
                rec['requiesce_requested'] = True
                rec['requiesce_for_revision'] = current['revision']
                revision = current['revision']+1
                rec['requiesce_expected_revision'] = revision
                self.save('requiesce_requested',collector_ref=ref)
                # 新回执前不声称新的OFF归本轮所有。
                rec['prior_restore_receipt'] = rec.pop('restore_receipt')
                rec['disable_ack'] = False
                ack=api_json('PUT',self.path(ref),{'enabled':False,'expected_revision':current['revision'],
                    'reason':'maintenance'},idem=f'ss-deploy-compensate-{self.run_id}-{hashlib.sha256(ref.encode()).hexdigest()}-{current["revision"]}')
                if not self.valid_ack(ack,ref,False,revision):
                    raise DeployFailure('mail_source_requiesce_receipt_unbound')
                rec['disable_ack']=True;rec['disable_revision']=revision;rec['disable_receipt']=ack
                rec['restore_requested']=False;rec['restored']=False
                self.save('requiesce_acknowledged_not_physical_stop',collector_ref=ref)
            except Exception as exc:
                self.save('requiesce_unknown_requires_formal_physical_stop',collector_ref=ref,
                    error_type=type(exc).__name__)
                return  # 一次未知即交正式Core，不轮询/依赖坏API继续关源。

    def restore(self, check_runtime, *, frozen_candidate_plan=None):
        proof = check_runtime()
        availability = mail_off_source_availability(frozen_candidate_plan, proof, self.baseline)
        self.save('restore_runtime_verified', runtime_proof=proof, off_source_availability=availability)
        gaps = []
        for rec in self.records:
            before, ref = rec['before'], rec['before']['collector_ref']
            try:
                current = self.identity(api_json('GET', self.path(ref)))
                rec['restore_observation'] = current
                if current['source'] != before['source'] or current['available'] != before['available']:
                    raise DeployFailure('mail_source_identity_changed')
                if current['enabled']:
                    # 只读确认目标原态；不声称unknown请求的因果、不重复PUT。
                    rec['restored'] = True
                    self.save('original_enabled_state_observed', collector_ref=ref)
                    continue
                own_postimage = {**before, 'enabled':False, 'revision':rec['disable_revision']}
                if not rec['disable_ack'] or current != own_postimage or rec['restore_requested']:
                    raise DeployFailure('mail_source_restore_ownership_or_outcome_unknown')
                check_runtime()
                rec['restore_requested'] = True
                rec['restore_key'] = f'ss-deploy-restore-{self.run_id}-{hashlib.sha256(ref.encode()).hexdigest()}-{rec["disable_revision"]}'
                self.save('restore_requested', collector_ref=ref)
                try:
                    ack = api_json('PUT', self.path(ref), {'enabled':True,
                        'expected_revision':rec['disable_revision'], 'reason':'maintenance'}, idem=rec['restore_key'])
                    if not self.valid_ack(ack, ref, True, rec['disable_revision']+1):
                        raise DeployFailure('mail_source_restore_receipt_unbound')
                    rec['restore_receipt'] = ack
                except Exception as exc:
                    rec['restore_error_type'] = type(exc).__name__
                    self.save('restore_failed_or_unknown', collector_ref=ref)
                    # unknown先独立读回；绝不重复PUT。
                current = self.identity(api_json('GET', self.path(ref)))
                rec['restore_observation'] = current
                if current != {**before, 'enabled':True, 'revision':rec['disable_revision']+1}:
                    raise DeployFailure('mail_source_restore_readback_unconfirmed')
                rec['restored'] = True;self.save('restore_verified', collector_ref=ref)
            except Exception as exc:
                gaps.append({'collector_ref':ref, 'code':getattr(exc,'failure_code',type(exc).__name__)})
        # 含原已OFF来源；只核身份/原开关，不替它们写入或新设失败清零门。
        try:
            rows = [self.identity(row) for row in api_json('GET','/api/v2/collector-control')['collectors']]
            actual = {row['collector_ref']:row for row in rows}
            for before in self.baseline:
                current = actual.get(before['collector_ref'])
                expected = dict(before)
                if availability is not None and before['collector_ref'] == availability['collector_ref']:
                    expected['available'] = availability['expected_available']
                if current is None or any(current[key] != expected[key] for key in ('source','enabled','available')):
                    gaps.append({'collector_ref':before['collector_ref'],'code':'mail_source_original_state_unpreserved'})
        except Exception as exc:
            gaps.append({'code':'mail_source_final_readback_unknown','error_type':type(exc).__name__})
        self.save('restore_complete' if not gaps else 'restore_incomplete', gaps=gaps,
                  actual_sources=rows if 'rows' in locals() else None)
        if gaps:
            raise DeployFailure('mail_source_restore_incomplete', json.dumps(gaps, ensure_ascii=False))
        return self.last_receipt


class RequiredPausePolicy:
    """显式停止约束；只读配置与正式 plan，不能创造回退配置或修改控制器。"""

    def __init__(self, required, controller):
        self.required = tuple(dict.fromkeys(required))
        self.controller = controller
        self.controller_sha256 = hashlib.sha256(controller.read_bytes()).hexdigest()
        self.candidate = self.previous = None
        self.plan = None
        self.failure_code = None
        self.switch_attempted = False
        self.last_verified_release = None
        result = subprocess.run([str(controller), '-h'], stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=30)
        if result.returncode or '--preserve-on-failure' not in result.stdout:
            self.reject('required_pause_preservation_unsupported')

    def reject(self, code):
        self.failure_code = code
        raise DeployFailure(code)

    def check_controller(self):
        if hashlib.sha256(self.controller.read_bytes()).hexdigest() != self.controller_sha256:
            self.reject('required_pause_controller_changed')

    def config(self, raw):
        try:
            release = Path(plistlib.loads(raw)['WorkingDirectory'])
            if (not release.is_absolute() or release.parent != SS_ROOT / 'releases'
                    or release.resolve() != release or not release.name.startswith('node-18765-')):
                self.reject('required_pause_config_identity_invalid')
            path = release / 'service.json'
            data = path.read_bytes()
            paused = json.loads(data).get('codex_decision', {}).get('paused_thread_ids', [])
            if not isinstance(paused, list) or any(not isinstance(x, str) for x in paused):
                self.reject('required_pause_config_invalid')
            return {'path': str(path), 'sha256': hashlib.sha256(data).hexdigest(), 'paused': paused}
        except (OSError, ValueError, KeyError, TypeError, AttributeError, plistlib.InvalidFileException):
            self.reject('required_pause_config_unavailable')

    def bind_candidate(self, raw):
        self.candidate_raw = raw
        self.candidate = self.config(raw)
        if not set(self.required) <= set(self.candidate['paused']):
            self.reject('required_pause_candidate_missing')

    def bind_previous(self, raw):
        self.previous_raw = raw
        self.previous = self.config(raw)
        if not set(self.previous['paused']) <= set(self.candidate['paused']):
            self.reject('required_pause_existing_pause_removed')

    def check_plan(self, path):
        self.check_controller()
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if self.plan is not None and self.plan['sha256'] != digest:
            self.reject('required_pause_plan_changed')
        try:
            plan = json.loads(raw)
            if (plan.get('preserve_on_failure') is not True
                    or bytes.fromhex(plan['original_plist']) != self.previous_raw
                    or bytes.fromhex(plan['target_plist']) != self.candidate_raw
                    or plan['old_pins'].get(self.previous['path']) != self.previous['sha256']
                    or plan['new_pins'].get(self.candidate['path']) != self.candidate['sha256']):
                self.reject('required_pause_plan_unbound')
        except (KeyError, TypeError, ValueError):
            self.reject('required_pause_plan_invalid')
        for expected, plist in [(self.candidate, self.candidate_raw), (self.previous, self.previous_raw)]:
            if self.config(plist) != expected:
                self.reject('required_pause_config_changed')
        self.plan = {'path': str(path), 'sha256': digest}

    def check_recovery_plan(self, path, original_plan):
        self.before_recovery(original_plan)
        try:
            plan = json.loads(path.read_bytes())
            original = bytes.fromhex(plan['original_plist'])
            current = self.config(original)
            if (plan.get('preserve_on_failure') is not True
                    or original not in (self.previous_raw, self.candidate_raw)
                    or bytes.fromhex(plan['target_plist']) != self.previous_raw
                    or plan['new_pins'].get(self.previous['path']) != self.previous['sha256']
                    or plan['old_pins'].get(current['path']) != current['sha256']
                    or not set(self.required) <= set(current['paused'])):
                self.reject('required_pause_recovery_plan_unbound')
        except (OSError, KeyError, TypeError, ValueError, AttributeError):
            self.reject('required_pause_recovery_plan_invalid')

    def before_recovery(self, path):
        self.check_plan(path)
        if not set(self.required) <= set(self.previous['paused']):
            self.reject('required_pause_recovery_refused')

    def check_observation(self, observation):
        routing = observation.get('routing') or {}
        paused = routing.get('paused_thread_ids')
        if (not isinstance(paused, list) or any(not isinstance(x, str) for x in paused)
                or not set(self.required) <= set(paused)):
            self.reject('required_pause_runtime_missing')
        self.last_verified_release = observation['runtime']['client_service']['release']
        self.failure_code = None

    def receipt(self):
        return {'required_thread_ids': list(self.required), 'controller_sha256': self.controller_sha256,
                'candidate_config_sha256': (self.candidate or {}).get('sha256'),
                'previous_config_sha256': (self.previous or {}).get('sha256'),
                'plan': self.plan, 'switch_attempted': self.switch_attempted,
                'last_verified_release': self.last_verified_release}


# --- observability / failure receipt (D) ---

def write_receipt(log_dir: Path, payload: dict) -> Path:
    log_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = log_dir / 'STATUS.json'
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + '\n')
    if payload.get('status') == 'failed':
        (log_dir / 'FAILURE.json').write_text(json.dumps(payload, indent=2, ensure_ascii=False) + '\n')
    return path


def fail_receipt(log_dir: Path, code: str, detail: str, *, extra: dict | None = None) -> DeployFailure:
    err = DeployFailure(code, detail)
    payload = {
        'schema': 'smart-shadow.ss-deploy-main/v1',
        'status': 'failed',
        'failure_code': err.failure_code,
        'detail': err.detail,
        'stderr_tail': err.detail.splitlines()[-1] if err.detail else code,
        'next_step': err.next_step,
        'at': now_iso(),
    }
    if extra:
        payload.update(extra)
    write_receipt(log_dir, payload)
    return err


def log_line(log_dir: Path, msg: str) -> None:
    line = f'[{now_iso()}] {msg}'
    print(line, flush=True)
    log_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (log_dir / 'transaction.log').open('a') as fh:
        fh.write(line + '\n')


# --- lock (B) ---

def read_lock_owner() -> str | None:
    try:
        return (LOCK / 'owner').read_text()
    except OSError:
        return None


def process_birth(pid: int) -> str:
    r = subprocess.run(
        ['ps', '-p', str(pid), '-o', 'lstart='],
        capture_output=True, text=True, timeout=15,
        env={**os.environ, 'LC_ALL': 'C', 'TZ': 'UTC'},
    )
    if r.returncode or not r.stdout.strip():
        raise DeployFailure('process_birth_unknown', 'process_birth_unknown')
    # 与 ss-service 的进程出生身份格式一致；ps 对单数字日期使用补齐空格。
    return " ".join(r.stdout.split())


def acquire_lock(log_dir: Path, holder: str, reason: str, *, wait_seconds: int = LOCK_WAIT_SECONDS):
    """Wait up to wait_seconds for foreign lock; then mkdir deploy.lock. Structured progress."""
    deadline = time.time() + wait_seconds
    started = time.time()
    while time.time() < deadline:
        waited = int(time.time() - started)
        owner = read_lock_owner() if LOCK.exists() else None
        if owner and f'pid={os.getpid()}' not in owner:
            log_line(
                log_dir,
                f'lock_wait holder_foreign waited_s={waited} owner={owner.strip()!r}',
            )
            time.sleep(2)
            continue
        if LOCK.exists() and owner and f'pid={os.getpid()}' in owner:
            inode = LOCK.stat().st_ino
            birth = process_birth(os.getpid())
            log_line(log_dir, f'lock_reused inode={inode} pid={os.getpid()}')
            return inode, birth
        try:
            LOCK.mkdir(mode=0o700)
        except FileExistsError:
            log_line(log_dir, f'lock_wait raced waited_s={waited}')
            time.sleep(1)
            continue
        try:
            inode = LOCK.stat().st_ino
            fd = os.open(LOCK / 'owner', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'w') as stream:
                stream.write(
                    f'{holder} pid={os.getpid()} {now_iso()} {reason} component=node\n'
                )
                stream.flush()
            birth = process_birth(os.getpid())
            log_line(log_dir, f'lock_acquired inode={inode} birth={birth!r} pid={os.getpid()} waited_s={waited}')
            return inode, birth
        except Exception:
            try:
                (LOCK / 'owner').unlink(missing_ok=True)
                LOCK.rmdir()
            except OSError:
                pass
            raise
    owner = read_lock_owner()
    raise fail_receipt(
        log_dir,
        'deploy_lock_busy',
        f'deploy_lock_busy waited_s={wait_seconds} owner={(owner or "").strip()}',
        extra={'lock_owner': owner, 'waited_seconds': wait_seconds},
    )


def release_lock(log_dir: Path) -> None:
    try:
        owner = read_lock_owner() or ''
        if owner and f'pid={os.getpid()}' not in owner:
            log_line(log_dir, f'lock_release_skipped foreign owner={owner.strip()!r}')
            return
        (LOCK / 'owner').unlink(missing_ok=True)
        if LOCK.exists():
            LOCK.rmdir()
        log_line(log_dir, 'lock_released')
    except OSError as exc:
        log_line(log_dir, f'lock_release_err {exc}')


# --- runtime quiet / quiesce (C) ---

def api_json(method: str, path: str, body: dict | None = None, *, idem: str | None = None) -> dict:
    cmd = [str(API), method, path]
    if body is not None:
        cmd += ['--body', '-', '--idempotency-key', idem or f'ss-deploy-{uuid.uuid4()}']
    raw = json.dumps(body, ensure_ascii=False) if body is not None else None
    r = subprocess.run(cmd, input=raw, capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        tail = (r.stderr or r.stdout or '').strip().splitlines()
        raise RuntimeError(f'api_failed:{path}:{r.returncode}:{(tail[-1] if tail else "")}')
    return json.loads(r.stdout) if r.stdout.strip() else {}


def db_holders() -> set[int]:
    out = subprocess.run(['lsof', '-t', '--', str(DB)], capture_output=True, text=True, timeout=30)
    return {int(x) for x in out.stdout.split() if x.isdigit()}


def assert_maintenance_window_open(log_dir: Path) -> None:
    if any(log_dir.glob('maintenance-window-closed*.json')):
        raise DeployFailure('maintenance_owner_window_closed')


def fresh_maintenance_cohort(source: Path, log_dir: Path, holder: str, inode: int, birth: str,
                             *, phase: str, expected_controller_sha256: str | None,
                             publication: dict,
                             complete_preflight: bool = False) -> Path:
    """同锁重新观察原owner；只刷新聚合观察，不修改或续期任何owner承诺。"""
    import types
    from urllib.parse import quote
    assert_maintenance_window_open(log_dir)
    if source.resolve().parent != log_dir.resolve():
        raise DeployFailure('maintenance_owner_window_closed')
    controller = CTL.read_bytes()
    digest = hashlib.sha256(controller).hexdigest()
    if expected_controller_sha256 is None or digest != expected_controller_sha256:
        raise DeployFailure('maintenance_controller_binding_required')
    module = types.ModuleType('ss_deploy_actual_controller_' + uuid.uuid4().hex)
    module.__file__ = str(CTL)
    sys.modules[module.__name__] = module
    try:
        exec(compile(controller, str(CTL), 'exec'), module.__dict__)
        def held():
            owner = module.pinned_file(LOCK / 'owner', 8192, private=True).decode()
            if (LOCK.stat().st_ino != inode or module.process_birth(os.getpid()) != birth
                    or not owner.startswith(f'{holder} pid={os.getpid()} ')):
                raise DeployFailure('maintenance_lock_identity_changed')
        held()
        original = module.pinned_file(source, 65536, private=True)
        value = json.loads(original)
        # 原聚合可以过期；以下仅为验证原签名声明shape。scope/holder/声明全部保留。
        def fresh_time():
            now = dt.datetime.now(dt.timezone.utc)
            value['issued_at'] = now.isoformat()
            value['expires_at'] = (now + dt.timedelta(seconds=300)).isoformat()
        fresh_time()
        module.validate_cohort(value)
        uuid.UUID(publication['window_id'])
        if value['holder'] != holder:
            raise DeployFailure('maintenance_holder_conflict')
        observations = []
        for row in value['entries']:
            declaration = json.loads(module.pinned_file(Path(row['declaration']['evidence_ref']), 65536, private=True))
            if declaration.get('publication') != publication:
                raise DeployFailure('maintenance_owner_window_binding_conflict')
            live = api_json('GET', '/api/v2/executions/' + quote(row['execution_id'], safe=''))
            assert_maintenance_window_open(log_dir)
            if (any(live.get(k) != row[j] for k,j in
                    (('id','execution_id'),('task_id','task_id'),('thread_id','thread_id')))
                    or live.get('status') != 'running' or type(live.get('revision')) is not int
                    or live['revision'] <= 0):
                raise DeployFailure('maintenance_owner_identity_changed')
            row['revision'] = live['revision']
            observations.append({k:live[k] for k in ('id','task_id','thread_id','status','revision')})
        held();fresh_time();module.validate_cohort(value)
        if complete_preflight:
            ctl = module.Controller('node', holder, 'read-only owner cohort preflight before collector quiesce')
            ctl.maintenance_cohort = value
            ctl.assert_no_other_executions('maintenance_preflight', frozen_node=ctl.node_owner())
        held();assert_maintenance_window_open(log_dir);module.validate_cohort(value)
        path = log_dir / f'maintenance-cohort-{phase}-{uuid.uuid4().hex}.json'
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, indent=2);stream.write('\n');stream.flush();os.fsync(stream.fileno())
        audit = {'schema':'smart-shadow.maintenance-cohort-observation/v1','phase':phase,
                 'controller_sha256':digest,'source_path':str(source),'source_sha256':hashlib.sha256(original).hexdigest(),
                 'fresh_path':str(path),'fresh_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                 'owner_declarations_unchanged':True,'fresh_execution_observations':observations,
                 'complete_preflight':complete_preflight,'ownership':'fresh_observation_not_new_authority'}
        audit['publication'] = publication
        fd = os.open(path.with_suffix('.audit.json'), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as stream:json.dump(audit, stream, indent=2);stream.write('\n')
        assert_maintenance_window_open(log_dir)
        return path
    finally:
        sys.modules.pop(module.__name__, None)


def frozen_plan_execution_preflight(plan: Path, log_dir: Path, holder: str, inode: int,
                                    birth: str, expected_controller_sha256: str, publication: dict) -> None:
    """复用已验controller完整guard；不刷新、更改任何已冻结计划/成员revision。"""
    assert_maintenance_window_open(log_dir)
    import types
    controller = CTL.read_bytes()
    if hashlib.sha256(controller).hexdigest() != expected_controller_sha256:
        raise DeployFailure('maintenance_controller_binding_required')
    module = types.ModuleType('ss_deploy_plan_guard_' + uuid.uuid4().hex)
    module.__file__ = str(CTL);sys.modules[module.__name__] = module
    try:
        exec(compile(controller, str(CTL), 'exec'), module.__dict__)
        def held():
            owner = module.pinned_file(LOCK / 'owner', 8192, private=True).decode()
            if (LOCK.stat().st_ino != inode or module.process_birth(os.getpid()) != birth
                    or not owner.startswith(f'{holder} pid={os.getpid()} ')):
                raise DeployFailure('maintenance_lock_identity_changed')
        held()
        raw = module.pinned_file(plan, 2*1024*1024, private=True)
        value = json.loads(raw)
        if value.get('holder') != holder:
            raise DeployFailure('maintenance_holder_conflict')
        ctl = module.Controller('node', holder, 'complete frozen-plan execution guard before actual switch')
        ctl.allowed_execution,ctl.allowed_task = value.get('allowed_execution'),value.get('allowed_task')
        ctl.maintenance_cohort = module.validate_cohort(value['maintenance_cohort'])
        for row in ctl.maintenance_cohort['entries']:
            declaration = json.loads(module.pinned_file(Path(row['declaration']['evidence_ref']), 65536, private=True))
            if declaration.get('publication') != publication:
                raise DeployFailure('maintenance_owner_window_binding_conflict')
        if ctl.node_owner() != value['node']:
            raise DeployFailure('maintenance_node_identity_changed')
        ctl.assert_no_other_executions('switch_preflight', frozen_node=value['node'])
        held();assert_maintenance_window_open(log_dir)
        if module.pinned_file(plan, 2*1024*1024, private=True) != raw:
            raise DeployFailure('maintenance_frozen_plan_changed')
        audit = {'schema':'smart-shadow.frozen-plan-execution-guard/v1','controller_sha256':expected_controller_sha256,
                 'plan_path':str(plan),'plan_sha256':hashlib.sha256(raw).hexdigest(),
                 'passed':True,'frozen_plan_unchanged':True,'observed_at':now_iso()}
        path = log_dir / f'frozen-plan-guard-{uuid.uuid4().hex}.json'
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as stream:json.dump(audit, stream, indent=2);stream.write('\n')
        assert_maintenance_window_open(log_dir)
    finally:
        sys.modules.pop(module.__name__, None)


def node_child_mismatch() -> bool:
    ps = subprocess.run(['ps', '-axo', 'pid=,ppid=,pgid='], capture_output=True, text=True, timeout=15)
    if ps.returncode:
        return True
    procs: dict[int, tuple[int, int]] = {}
    for line in ps.stdout.splitlines():
        fields = line.split()
        if len(fields) != 3 or not all(f.isdecimal() for f in fields):
            continue
        pid, ppid, pgid = map(int, fields)
        if pid:
            procs[pid] = (ppid, pgid)
    holders = db_holders()
    if len(holders) != 1:
        return True
    node = next(iter(holders))
    if node not in procs:
        return True
    node_pgid = procs[node][1]
    desc = {node}
    changed = True
    while changed:
        changed = False
        for pid, (ppid, pgid) in procs.items():
            if ppid in desc and pid not in desc:
                if pgid != node_pgid:
                    return True
                desc.add(pid)
                changed = True
    return False


def quiet_snapshot() -> tuple[bool, str, dict]:
    try:
        runtime = api_json('GET', '/api/v2/runtime')
    except Exception as exc:
        return False, f'runtime:{exc}', {}
    collectors = runtime.get('collectors') or {}
    active = collectors.get('active')
    unknown = collectors.get('storage_outcome_unknown')
    detail = {
        'active': active,
        'quiescing': collectors.get('quiescing'),
        'storage_outcome_unknown': unknown,
    }
    if active != 0:
        return False, f'active={active}', detail
    if unknown is not False:
        return False, f'storage_outcome_unknown={unknown}', detail
    holders = db_holders()
    if len(holders) != 1:
        return False, f'holders={sorted(holders)}', detail
    if node_child_mismatch():
        return False, 'child_pgid_mismatch', detail
    return True, 'ok', detail


def list_enabled_collectors() -> list[dict]:
    control = api_json('GET', '/api/v2/collector-control')
    out = []
    for row in control.get('collectors') or []:
        if row.get('enabled') is True and row.get('collector_ref'):
            out.append({'collector_ref': row['collector_ref'], 'revision': row.get('revision')})
    return out


def disable_collectors(log_dir: Path, refs: list[dict], *, run_id: str) -> list[dict]:
    disabled = []
    for row in refs:
        ref = row['collector_ref']
        rev = row['revision']
        body = {'enabled': False, 'expected_revision': rev, 'reason': 'maintenance'}
        key = f'ss-deploy-quiesce-{run_id}-{ref}'
        log_line(log_dir, f'quiesce_disable {ref} expected_revision={rev}')
        api_json('PUT', f'/api/v2/collector-control/collectors/{ref}', body, idem=key)
        disabled.append(row)
    return disabled


def restore_collectors(log_dir: Path, refs: list[dict], *, run_id: str) -> None:
    for row in refs:
        ref = row['collector_ref']
        try:
            cur = api_json('GET', f'/api/v2/collector-control/collectors/{ref}')
            rev = cur.get('revision')
            if cur.get('enabled') is True:
                continue
            body = {'enabled': True, 'expected_revision': rev, 'reason': 'maintenance'}
            key = f'ss-deploy-restore-{run_id}-{ref}'
            log_line(log_dir, f'quiesce_restore {ref} expected_revision={rev}')
            api_json('PUT', f'/api/v2/collector-control/collectors/{ref}', body, idem=key)
        except Exception as exc:
            log_line(log_dir, f'quiesce_restore_err {ref}: {exc}')


def wait_stable_quiet(log_dir: Path, *, stable_seconds: float, timeout: float) -> None:
    deadline = time.time() + timeout
    stable_since: float | None = None
    last = ''
    while time.time() < deadline:
        ok, reason, detail = quiet_snapshot()
        log_line(log_dir, f'quiesce_check {reason} detail={json.dumps(detail, ensure_ascii=False)}')
        if ok:
            if stable_since is None:
                stable_since = time.time()
            elif time.time() - stable_since >= stable_seconds:
                # double-check
                time.sleep(0.5)
                ok2, reason2, _ = quiet_snapshot()
                if ok2:
                    log_line(log_dir, f'quiesce_stable seconds={stable_seconds}')
                    return
                stable_since = None
                last = reason2
                log_line(log_dir, f'quiesce_unstable_recheck {reason2}')
        else:
            if stable_since is not None and reason != last:
                raise fail_receipt(log_dir, 'quiesce_unstable', f'quiesce_unstable:{reason}')
            stable_since = None
            last = reason
        time.sleep(1)
    raise fail_receipt(log_dir, 'quiesce_timeout', f'quiesce_timeout last={last}')


def formal_quiesce(log_dir: Path, *, run_id: str, stable_seconds: float, timeout: float) -> list[dict]:
    """Disable enabled collectors via collector-control, then wait for stable quiet."""
    enabled = list_enabled_collectors()
    log_line(log_dir, f'quiesce_begin enabled_count={len(enabled)}')
    disabled = disable_collectors(log_dir, enabled, run_id=run_id) if enabled else []
    wait_stable_quiet(log_dir, stable_seconds=stable_seconds, timeout=timeout)
    return disabled



# --- G／C5 backup parent mode 0o700 ---

def ensure_backup_parent_mode_700(backup_parent: Path, log_dir: Path) -> Path:
    """mkdir 后强制 chmod 0o700 并 stat 断言；不合规立刻硬失败（禁重试）。"""
    backup_parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        os.chmod(backup_parent, 0o700)
    except OSError as exc:
        raise fail_receipt(
            log_dir,
            'backup_parent_mode_invalid',
            f'chmod_700_failed:{backup_parent}:{exc}',
        )
    mode = backup_parent.stat().st_mode & 0o777
    if mode != 0o700:
        raise fail_receipt(
            log_dir,
            'backup_parent_mode_invalid',
            f'backup_parent_mode={oct(mode)} expected=0o700 path={backup_parent}',
        )
    log_line(log_dir, f'backup_parent_mode_ok path={backup_parent} mode=0o700')
    return backup_parent


def backup_snapshot_budget() -> int:
    """按 DB、WAL、SHM 的现有字节数计算整库备份准入预算。"""
    paths = [DB, Path(str(DB) + '-wal'), Path(str(DB) + '-shm')]
    size = sum(path.stat().st_size for path in paths if path.is_file())
    return max(1, int(size * 1.05 + 0.999999))


def backup_preflight(log_dir: Path) -> dict:
    path = Path(__file__).with_name('storage-retention.py')
    spec = importlib.util.spec_from_file_location('smart_shadow_storage_retention', path)
    if spec is None or spec.loader is None:
        raise fail_receipt(log_dir, 'backup_preflight_rejected', 'storage_retention_module_unavailable')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    budget = backup_snapshot_budget()
    try:
        result = module.Policy().preflight(budget)
    except Exception as exc:
        raise fail_receipt(log_dir, 'backup_preflight_rejected', f'storage_retention_preflight_failed:{exc}')
    log_line(log_dir, f'backup_preflight admitted={result.get("backup_admitted")} reason={result.get("backup_skip_reason")} budget={budget}')
    if not result.get('backup_admitted'):
        log_line(log_dir, f'WARN consistent backup skipped by retention policy reason={result.get("backup_skip_reason")}')
        raise fail_receipt(log_dir, 'backup_preflight_rejected', str(result.get('backup_skip_reason')))
    return result


TRANSIENT_OBSERVE_MARKERS = (
    'timeout', 'timed out', 'temporarily', 'connection', 'api_failed',
    'reset', 'eof', 'broken pipe', 'unavailable', 'try again',
)


def is_transient_observe_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return any(m in msg for m in TRANSIENT_OBSERVE_MARKERS)


def live_observe(observe_fn, log_dir: Path, *, deadline: float | None, delay: float = 1.0) -> dict:
    """显式预算内持续读回；无预算的通用调用保留原五次行为。"""
    last: BaseException | None = None
    attempts = 0
    while (attempts < 5 if deadline is None else time.time() < deadline):
        attempts += 1
        try:
            obs = observe_fn()
            if deadline is not None and time.time() >= deadline:
                last = RuntimeError('observe_deadline_elapsed')
                break
            if attempts > 1:
                log_line(log_dir, f'live_observe_ok attempt={attempts}')
            return obs
        except Exception as exc:
            last = exc
            if not is_transient_observe_error(exc):
                raise
            log_line(log_dir, f'live_observe_retry attempt={attempts}: {exc}')
            if deadline is None:
                if attempts < 5:
                    time.sleep(delay)
            else:
                remaining = deadline - time.time()
                if remaining > 0:
                    time.sleep(min(delay, remaining))
    raise fail_receipt(
        log_dir,
        'observe_transient_exhausted',
        f'observe_transient_exhausted last={last}',
        extra={'observe_attempts': attempts, 'observe_deadline': deadline},
    )


# --- prepare / switch ---

def ss_run(log_dir: Path, holder: str, reason: str, args: list[str], *, producer_quiesce: bool = False) -> subprocess.CompletedProcess:
    cmd = [str(CTL), '--component', 'node', '--holder', holder, '--reason', reason]
    if producer_quiesce and controller_supports_producer_quiesce():
        cmd.append('--producer-quiesce')
    cmd.extend(args)
    log_line(log_dir, 'ss: ' + ' '.join(str(a) for a in args[:12]))
    p = subprocess.run(cmd, capture_output=True, text=True)
    log_line(log_dir, f'ss_rc={p.returncode} stdout={p.stdout[:300]!r} stderr={p.stderr[:400]!r}')
    if p.returncode != 0:
        raise ServiceCommandFailure(cmd, p)
    return p


def prepare_until_ready(
    log_dir: Path,
    holder: str,
    reason: str,
    *,
    inode: int,
    birth: str,
    plan: Path,
    plist: Path,
    backup_parent: Path,
    budget_deadline: float,
    retry_max: int,
    retry_window: float,
    producer_quiesce_flag: bool,
    omit_consistent_backup: bool = False,
    preserve_on_failure: bool = False,
    expected_controller_sha256: str | None = None,
    maintenance_cohort: Path | None = None,
    publication: dict | None = None,
    previous_desktop_execution_schema: int | None = None,
) -> None:
    ensure_backup_parent_mode_700(backup_parent, log_dir)  # G／C5
    attempt = 0
    last: Exception | None = None
    window_start = time.time()
    while True:
        if time.time() >= budget_deadline:
            raise fail_receipt(log_dir, 'total_budget_exhausted', 'total_budget_exhausted during prepare')
        if attempt >= retry_max or (attempt > 0 and time.time() - window_start >= retry_window):
            detail = str(last) if last else 'prepare_retry_exhausted'
            raise fail_receipt(
                log_dir,
                'prepare_retry_exhausted',
                detail,
                extra={'prepare_attempts': attempt, 'last_error': detail},
            )
        attempt += 1
        ok, reason_q, _ = quiet_snapshot()
        if not ok:
            log_line(log_dir, f'pre_prepare_wait {reason_q}')
            time.sleep(1)
            # waiting for quiet does not count as a failed prepare attempt credit beyond attempt++
            # but proposal: stop empty RETRYABLE loops — only count actual prepare failures below
            attempt -= 1
            if time.time() - window_start >= retry_window:
                raise fail_receipt(log_dir, 'quiesce_timeout', f'pre_prepare_quiet_lost:{reason_q}')
            continue
        time.sleep(0.4)
        ok2, reason2, _ = quiet_snapshot()
        if not ok2:
            log_line(log_dir, f'pre_prepare_recheck {reason2}')
            attempt -= 1
            continue
        backup = backup_parent / f'live-state-{dt.datetime.now().strftime("%Y%m%dT%H%M%S")}-{attempt}.sqlite'
        if (expected_controller_sha256 is not None
                and hashlib.sha256(CTL.read_bytes()).hexdigest() != expected_controller_sha256):
            raise fail_receipt(log_dir, 'required_pause_controller_changed', 'required_pause_controller_changed')
        try:
            prep_args = [
                '--plan', str(plan), '--next-plist', str(plist),
                '--switch-budget-seconds', '1800',
                '--held-lock-inode', str(inode), '--owner-birth', birth,
            ]
            if omit_consistent_backup:
                log_line(log_dir, 'WARN consistent backup omitted; policy preflight or explicit emergency flag')
            else:
                prep_args.extend(['--consistent-backup', str(backup), '--backup-reserve-seconds', '300'])
            if maintenance_cohort is not None:
                fresh = fresh_maintenance_cohort(maintenance_cohort, log_dir, holder, inode, birth,
                    phase='prepare', expected_controller_sha256=expected_controller_sha256, publication=publication, complete_preflight=True)
                prep_args.extend(['--maintenance-cohort', str(fresh)])
            if previous_desktop_execution_schema is not None:
                prep_args.extend(['--previous-desktop-execution-schema', str(previous_desktop_execution_schema)])
            if preserve_on_failure:
                prep_args.append('--preserve-on-failure')
            prep_args.append('prepare-switch')
            ss_run(
                log_dir, holder, reason,
                prep_args,
                producer_quiesce=producer_quiesce_flag,
            )
            log_line(log_dir, f'prepare_ok attempt={attempt} backup={backup.name}')
            return
        except RuntimeError as exc:
            last = exc
            msg = str(exc)
            hard = next((code for code in HARD_NO_RETRY_PREPARE if code in msg), None)
            if hard:
                raise fail_receipt(
                    log_dir, hard, msg,
                    extra={'prepare_attempts': attempt, 'no_retry': True},
                )
            if any(code in msg for code in RETRYABLE_PREPARE):
                log_line(log_dir, f'prepare_retry {attempt}/{retry_max}: {msg}')
                time.sleep(2)
                continue
            raise fail_receipt(log_dir, 'prepare_hard_failure', msg, extra={'prepare_attempts': attempt})


def assert_min_gates(observation: dict, *, target_release: str, expected_schema: int | None) -> None:
    health = observation.get('health') or {}
    runtime = observation.get('runtime') or {}
    if health.get('status') != 'ok':
        raise DeployFailure('health_not_ok', f"health_status={health.get('status')}")
    release = (runtime.get('client_service') or {}).get('release')
    if release != target_release:
        raise DeployFailure('release_name_mismatch', f'release={release} expected={target_release}')
    if expected_schema is not None and health.get('entity_schema') != expected_schema:
        raise DeployFailure(
            'entity_schema_mismatch',
            f"entity_schema={health.get('entity_schema')} expected={expected_schema}",
        )


# --- CLI ---

def load_p_off_components(candidate_sha):
    """固定同Git候选模块；先核原始字节后执行，不接受caller verifier路径。"""
    import types
    names = ('p-source-off-publication.py','p-off-proof.py','p-off-comparison.py')
    modules = []
    for name in names:
        path = Path(__file__).resolve().parent / name
        info = path.lstat()
        if (path.is_symlink() or info.st_uid != os.getuid() or info.st_mode & 0o022):
            raise DeployFailure('p_publisher_identity')
        raw = path.read_bytes()
        expected = subprocess.run(['git','show',candidate_sha+':scripts/'+name],
            capture_output=True,check=True,timeout=30).stdout
        if raw != expected:
            raise DeployFailure('p_publisher_not_candidate')
        module = types.ModuleType('p_off_' + uuid.uuid4().hex)
        module.__file__ = str(path); sys.modules[module.__name__] = module
        exec(compile(raw,str(path),'exec'),module.__dict__)
        modules.append(module)
    return modules


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description='Smart Shadow 本机唯一部署入口（A→D→B→C→E）')
    p.add_argument('--sha', required=True, help='main 精确 40 位 merge SHA')
    p.add_argument('--target-release', required=True)
    p.add_argument('--issue-url', required=True)
    p.add_argument('--pr-url')
    p.add_argument('--expected-entity-schema', type=int)
    p.add_argument('--p-off-enrollment', action='store_true',
                   help='仅Task/Approval首次OFF元数据专项；不签normal/full release')
    p.add_argument('--recovery-profile', choices=['mail-schema2'], help='临时Mail ordinary恢复；兼容3 B实际健康及统一九pin后退役')
    p.add_argument('--previous-desktop-execution-schema', type=int, choices=[2],
                   help='本批普通回退仅已审schema2；显式绑定原plan，停Node后由控制器只读核DB；不接受schema3')
    p.add_argument('--holder', default='ss-deploy-main-owner')
    p.add_argument('--maintenance-window-id', help='本次原owner具名声明的准确window UUID；不允许复用已关闭窗口')
    p.add_argument('--reason', default='ss-deploy-main unique entry t1404u')
    p.add_argument('--log-dir', type=Path)
    p.add_argument('--plist', type=Path, help='下一版 LaunchAgent plist')
    p.add_argument('--helper-build', type=Path, help='gh-config-user-build.json')
    p.add_argument('--github-deploy', type=Path, help='scripts/github-deploy.py 路径')
    p.add_argument('--lock-wait-seconds', type=int, default=LOCK_WAIT_SECONDS)
    p.add_argument('--total-budget-seconds', type=int, default=TOTAL_BUDGET_SECONDS)
    p.add_argument('--prepare-retry-max', type=int, default=PREPARE_RETRY_MAX)
    p.add_argument('--prepare-retry-window-seconds', type=int, default=PREPARE_RETRY_WINDOW_SECONDS)
    p.add_argument('--quiesce-stable-seconds', type=float, default=QUIESCE_STABLE_SECONDS)
    p.add_argument('--quiesce-timeout-seconds', type=float, default=QUIESCE_TIMEOUT_SECONDS)
    p.add_argument('--skip-collector-quiesce', action='store_true',
                   help='危险：跳过 collector-control 正式 quiesce（默认禁止）')
    p.add_argument('--emergency-omit-consistent-backup', action='store_true',
                   help='默认禁。仅另旨 emergency；须同时给 --i-acknowledge-omit-backup-risk')
    p.add_argument('--i-acknowledge-omit-backup-risk', action='store_true',
                   help='与 --emergency-omit-consistent-backup 联用的承认旗')
    p.add_argument('--maintenance-cohort', type=Path,
                   help='显式传递本轮真实owner维护声明，仅沿现有controller prepare-switch合同核验')
    p.add_argument('--required-paused-thread-id', action='append', default=[],
                   help='显式已批准停止的 thread ID，可重复；缺省不改变原回退行为')
    p.add_argument('--dry-run-plan', action='store_true', help='只打印计划，不抢锁、不切换')
    return p


def resolve_paths(args: argparse.Namespace) -> argparse.Namespace:
    here = Path(__file__).resolve().parent
    repo = here.parent
    if args.github_deploy is None:
        args.github_deploy = here / 'github-deploy.py'
    if args.log_dir is None:
        stamp = dt.datetime.now().strftime('%Y%m%dT%H%M%S')
        args.log_dir = DEFAULT_LOG_ROOT / f'ss-deploy-main-{stamp}'
    if args.helper_build is None:
        cache = HOME / 'Library/Caches/me.longbiaochen.smart-shadow' / f'gh-config-user-{args.sha[:8]}'
        args.helper_build = cache / 'gh-config-user-build.json'
    args.repo = repo
    return args


def plan_dict(args: argparse.Namespace) -> dict:
    return {
        'entry': 'scripts/ss-deploy-main.py',
        'desktop_is_deploy': False,
        'p_off_enrollment': getattr(args,'p_off_enrollment',False),
        'sha': args.sha,
        'target_release': args.target_release,
        'issue_url': args.issue_url,
        'pr_url': args.pr_url,
        'expected_entity_schema': args.expected_entity_schema,
        **({'temporary_recovery_profile': args.recovery_profile,
            'previous_desktop_execution_schema': args.previous_desktop_execution_schema,
            'retire_after': 'actual healthy schema3-compatible fallback and unified nine-pin controller'}
           if args.recovery_profile is not None else {}),
        'lock_wait_seconds': args.lock_wait_seconds,
        'total_budget_seconds': args.total_budget_seconds,
        'prepare_retry_max': args.prepare_retry_max,
        'prepare_retry_window_seconds': args.prepare_retry_window_seconds,
        'quiesce_stable_seconds': args.quiesce_stable_seconds,
        'quiesce_timeout_seconds': args.quiesce_timeout_seconds,
        'skip_collector_quiesce': args.skip_collector_quiesce,
        'emergency_omit_consistent_backup': bool(args.emergency_omit_consistent_backup),
        'omit_backup_default_banned': True,
        **({'maintenance_cohort': str(args.maintenance_cohort)} if args.maintenance_cohort is not None else {}),
        **({'required_paused_thread_ids': args.required_paused_thread_id} if args.required_paused_thread_id else {}),
        'controller_producer_quiesce': controller_supports_producer_quiesce(),
        'charter': {'G_backup_mode_700': True, 'H_formal_quiesce': True, 'I_live_observe_receipt': True},
        'order': ['A_entry', 'D_structured_failure', 'B_lock', 'C_quiesce', 'G_backup_700', 'H_quiesce', 'E_gates', 'I_receipt'],
    }


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = resolve_paths(parser.parse_args(argv))
    if args.recovery_profile == 'mail-schema2' and args.previous_desktop_execution_schema != 2:
        parser.error('mail-schema2 requires explicit --previous-desktop-execution-schema 2')
    if args.recovery_profile == 'mail-schema2' and args.maintenance_cohort is None:
        parser.error('mail-schema2 requires the original publication --maintenance-cohort')
    if args.recovery_profile == 'mail-schema2' and (args.skip_collector_quiesce or args.emergency_omit_consistent_backup):
        parser.error('mail-schema2 requires owned collector quiesce and the fresh consistent backup')
    if args.recovery_profile is None and args.previous_desktop_execution_schema is not None:
        parser.error('--previous-desktop-execution-schema belongs only to the temporary mail-schema2 recovery profile')
    if getattr(args,'p_off_enrollment',False) and (args.recovery_profile != 'mail-schema2' or not args.pr_url):
        parser.error('P OFF requires the data-preserving schema2 recovery adapter and exact PR')
    if not re.fullmatch(r'[a-f0-9]{40}', args.sha):
        print('sha must be 40 lowercase hex', file=sys.stderr)
        return 2
    log_dir: Path = args.log_dir
    log_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    plan = plan_dict(args)
    (log_dir / 'PLAN.json').write_text(json.dumps(plan, indent=2, ensure_ascii=False) + '\n')
    log_line(log_dir, f'plan {json.dumps(plan, ensure_ascii=False)}')
    if args.dry_run_plan:
        print(json.dumps({'status': 'dry_run', 'plan': plan, 'log_dir': str(log_dir)}, ensure_ascii=False))
        return 0

    if args.plist is None or not args.plist.exists():
        err = fail_receipt(log_dir, 'missing_plist', f'missing_plist:{args.plist}')
        print(err.detail, file=sys.stderr)
        return 1

    omit_backup = False
    if args.emergency_omit_consistent_backup:
        if not args.i_acknowledge_omit_backup_risk:
            err = fail_receipt(
                log_dir,
                'omit_backup_forbidden',
                'omit consistent-backup 默认禁；emergency 须同时 --i-acknowledge-omit-backup-risk',
            )
            print(err.detail, file=sys.stderr)
            return 1
        omit_backup = True
        log_line(log_dir, 'EMERGENCY omit_consistent_backup acknowledged by explicit flags')

    run_id = dt.datetime.now().strftime('%Y%m%dT%H%M%S')
    if args.recovery_profile == 'mail-schema2':
        run_id += '-' + uuid.uuid4().hex  # 每次原执行独立键，沿HTTP API既有256字节限制使用ref摘要。
    disabled: list[dict] = []
    inode = birth = None
    prepared = False
    pause_policy = None
    mail_sources = None
    mail_result = None
    mail_before = None
    mail_plan_sha = None
    mail_base_proof = None
    mail_base_plist = None
    mail_controller_sha = None
    mail_source_close_attempted = False
    mail_source_restoration_receipt = None
    mail_sources_terminal_verified = False
    mail_last_candidate_stats = None
    mail_recovery_observation_deadline = None
    mail_evidence_errors = []
    mail_evidence = None
    p_components = p_proof = None

    def capture_mail_failure(phase, error):
        if mail_evidence is None:
            return
        try:
            mail_evidence.failure(phase, error)
        except Exception as evidence_error:
            # 证据I/O故障不能阻止正式Core补偿，不把缺失快照伪记为已保存。
            mail_evidence_errors.append({'stage':'failure_evidence','phase':phase,
                'error_type':type(evidence_error).__name__})

    try:
        # B
        inode, birth = acquire_lock(log_dir, args.holder, args.reason, wait_seconds=args.lock_wait_seconds)
        budget_deadline = time.time() + args.total_budget_seconds
        if args.recovery_profile == 'mail-schema2':
            mail_evidence = MailDeploymentEvidence(log_dir, budget_deadline)
        if args.recovery_profile == 'mail-schema2' and not controller_supports_plan_recovery(CTL):
            raise fail_receipt(log_dir, 'ordinary_plan_recovery_unsupported',
                               'formal controller lacks owned-plan recovery/compatibility adapter; no quiesce or switch attempted')

        # helper binding
        if not args.helper_build.exists():
            raise fail_receipt(log_dir, 'helper_not_installed', f'missing helper build {args.helper_build}')
        build_raw = args.helper_build.read_bytes()
        build = json.loads(build_raw)
        installed_path = SS_ROOT / 'tools/gh-config-user'
        installed = hashlib.sha256(installed_path.read_bytes()).hexdigest()
        if build.get('sha256') != installed:
            raise fail_receipt(log_dir, 'helper_not_installed', 'helper_sha256_mismatch')
        gh_config_user = {
            'build_receipt': {
                'path': str(args.helper_build.resolve()),
                'sha256': hashlib.sha256(build_raw).hexdigest(),
            },
            'installed_sha256': installed,
        }

        gh = load_github_deploy(args.github_deploy)
        publication = {'window_id':args.maintenance_window_id,'candidate_sha':args.sha,'target_release':args.target_release}
        if args.required_paused_thread_id:
            pause_policy = RequiredPausePolicy(args.required_paused_thread_id, CTL)
            pause_policy.bind_candidate(args.plist.read_bytes())

        def observe_once():
            nonlocal mail_last_candidate_stats
            if getattr(args,'p_off_enrollment',False):
                # runtime已知时保全该事实；后续stats未知不能把wrong release吞掉。
                result = {'runtime':api_json('GET','/api/v2/runtime'), 'read_errors':{}}
                for key,path in [('health','/api/v2/health'),('stats','/api/v2/collector-stats'),
                                 ('controls','/api/v2/collector-control')]:
                    try: result[key] = api_json('GET',path)
                    except Exception as error:
                        result[key] = None; result['read_errors'][key] = type(error).__name__
            else:
                result = {
                    'runtime': api_json('GET', '/api/v2/runtime'),
                    'health': api_json('GET', '/api/v2/health'),
                    'stats': api_json('GET', '/api/v2/collector-stats'),
                }
            if args.recovery_profile == 'mail-schema2' and result['runtime']['client_service']['release'] == args.target_release:
                mail_last_candidate_stats = result['stats']
                # stats已读到就先保全；随后routing失败也不能把failed_stats写成null。
                mail_evidence.observation('candidate', result)
            if pause_policy:
                if getattr(args,'p_off_enrollment',False):
                    try: result['routing'] = api_json('GET','/api/v2/decision-intake/routing')
                    except Exception as error:
                        result['routing'] = None; result['read_errors']['routing'] = type(error).__name__
                else:
                    result['routing'] = api_json('GET', '/api/v2/decision-intake/routing')
            return result

        forward_observation = True

        def observe():
            nonlocal mail_before, mail_last_candidate_stats, mail_recovery_observation_deadline
            # I／C8: 传入 transaction 的 observe 也走 live 再读
            observation_deadline = budget_deadline if forward_observation else None
            if not forward_observation and args.recovery_profile == 'mail-schema2':
                if mail_recovery_observation_deadline is None:
                    # 复用调用方显式总预算的时长，独立于已耗尽的前向预算；只建一次，不续期。
                    mail_recovery_observation_deadline = time.time() + args.total_budget_seconds
                    log_line(log_dir, f'mail_recovery_readback_budget seconds={args.total_budget_seconds} deadline={mail_recovery_observation_deadline}')
                observation_deadline = mail_recovery_observation_deadline
            result = live_observe(observe_once, log_dir,
                                  deadline=observation_deadline)
            if pause_policy and pause_policy.switch_attempted and not getattr(args,'p_off_enrollment',False):
                pause_policy.check_observation(result)
            if args.recovery_profile == 'mail-schema2':
                if not prepared:
                    mail_before = result
                if result['runtime']['client_service']['release'] == args.target_release:
                    mail_last_candidate_stats = result['stats']
            return result

        before = observe()
        previous = before['runtime']['client_service']['release']
        if args.recovery_profile == 'mail-schema2' and previous == args.target_release:
            raise DeployFailure('distinct_target_release_required')
        log_line(log_dir, f'previous={previous} target={args.target_release}')

        # 默认helper完整绑定与原owner/完整execution guard，均在第一条停采之前核验。
        gh.verify_gh_config_user({'sha':args.sha,'gh_config_user':gh_config_user})
        if args.maintenance_cohort is not None:
            fresh_maintenance_cohort(args.maintenance_cohort, log_dir, args.holder, inode, birth,
                phase='before-quiesce', expected_controller_sha256=pause_policy.controller_sha256 if pause_policy else None,
                publication=publication, complete_preflight=True)

        if args.recovery_profile == 'mail-schema2':
            mail_controller_sha = hashlib.sha256(CTL.read_bytes()).hexdigest()
            mail_base_plist = NODE_PLIST.read_bytes()
            mail_base_proof = mail_runtime_proof(log_dir, args.holder, inode, birth,
                mail_controller_sha, expected_plist=mail_base_plist)
            if mail_base_proof['release'] != previous:
                raise DeployFailure('mail_baseline_runtime_binding_mismatch')
            mail_sources = MailSourceTransaction(log_dir, run_id)

        def mail_restore_sources(role):
            nonlocal forward_observation, mail_source_restoration_receipt
            forward_observation = False
            if role == 'candidate':
                actual = observe_once()
                expected = args.target_release
                if getattr(args,'p_off_enrollment',False):
                    p_proof.verify_snapshot(actual,phase='quiesced_candidate')
                elif not gh.healthy(mail_before['stats'], actual['stats'], actual['health'], issue=args.issue_url):
                    raise DeployFailure('mail_source_restore_runtime_unhealthy')
            else:
                # 原临时开关的安全收尾与完整统计验收分层；不依赖可能失败/未知的stats读取。
                actual = {'runtime':api_json('GET','/api/v2/runtime'),
                          'health':api_json('GET','/api/v2/health')}
                expected = previous
                if actual['health'].get('status') != 'ok':
                    raise DeployFailure('mail_source_restore_previous_unhealthy')
            if actual['runtime']['client_service']['release'] != expected:
                raise DeployFailure('mail_source_restore_release_mismatch')
            if role == 'untouched':
                raw, pins = mail_base_plist, mail_base_proof['pins']
            else:
                plan_raw = plan_path.read_bytes()
                if hashlib.sha256(plan_raw).hexdigest() != mail_plan_sha:
                    raise DeployFailure('mail_source_restore_frozen_plan_changed')
                frozen = json.loads(plan_raw)
                raw = bytes.fromhex(frozen['target_plist' if role == 'candidate' else 'original_plist'])
                pins = frozen['new_pins' if role == 'candidate' else 'old_pins']
            def check():
                proof = mail_runtime_proof(log_dir, args.holder, inode, birth, mail_controller_sha,
                    expected_plist=raw, expected_pins=pins)
                if proof['release'] != expected or role == 'untouched' and proof != mail_base_proof:
                    raise DeployFailure('mail_source_restore_runtime_identity_mismatch')
                if api_json('GET','/api/v2/runtime')['client_service']['release'] != expected or api_json('GET','/api/v2/health').get('status') != 'ok':
                    raise DeployFailure('mail_source_restore_runtime_health_unproven')
                return proof
            result = mail_sources.restore(check, frozen_candidate_plan=frozen if role == 'candidate' else None)
            if role != 'candidate':
                proof = check()
                path = log_dir/f'mail-source-restoration-verified-{uuid.uuid4().hex}.json'
                path.write_text(json.dumps({'schema':'smart-shadow.source-restoration/v1',
                    'status':'source_restoration_verified','current_release':previous,
                    'runtime_proof':proof,'mail_source_transaction':result,
                    'delivery_accepted':False,'at':now_iso()},ensure_ascii=False,indent=2)+'\n')
                mail_source_restoration_receipt = {'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
            return result

        def mail_close_previous_sources():
            """只恢复独立证安全previous的本轮临时开关；失败不覆盖原异常，不签统计通过。"""
            nonlocal mail_source_close_attempted, mail_source_restoration_receipt
            mail_source_close_attempted = True
            mail_source_restoration_receipt = None
            if mail_sources is None:
                return False
            try:
                mail_restore_sources('previous' if mail_plan_sha else 'untouched')
                return True
            except Exception as error:
                mail_evidence_errors.append({'stage':'safe_previous_source_close',
                    'error_type':type(error).__name__,
                    'failure_code':getattr(error,'failure_code',None)})
                return False

        if getattr(args,'p_off_enrollment',False):
            p_components = load_p_off_components(args.sha)
            p_proof = p_components[1].POffProof(main=sys.modules[__name__],github=gh,
                comparison=p_components[2],args=args,log_dir=log_dir,inode=inode,birth=birth,
                controller_sha256=mail_controller_sha,baseline=before,
                baseline_plist=mail_base_plist,baseline_physical=mail_base_proof,
                source_transaction=mail_sources,plan_path=log_dir/'switch-plan.json')

        # C
        if args.skip_collector_quiesce:
            log_line(log_dir, 'quiesce_skipped_explicit')
            wait_stable_quiet(
                log_dir,
                stable_seconds=args.quiesce_stable_seconds,
                timeout=min(args.quiesce_timeout_seconds, max(1, budget_deadline - time.time())),
            )
        elif mail_sources is not None:
            mail_sources.quiesce(stable_seconds=args.quiesce_stable_seconds,
                timeout=min(args.quiesce_timeout_seconds, max(1, budget_deadline-time.time())))
        else:
            disabled = formal_quiesce(
                log_dir,
                run_id=run_id,
                stable_seconds=args.quiesce_stable_seconds,
                timeout=min(args.quiesce_timeout_seconds, max(1, budget_deadline - time.time())),
            )

        # 切换前固定真实 previous；补偿时不可从已切换的 live plist 重建。
        prev_copy = log_dir / 'plists' / f'{previous}.plist'
        prev_copy.parent.mkdir(parents=True, exist_ok=True)
        prev_copy.write_bytes(NODE_PLIST.read_bytes())
        if pause_policy:
            pause_policy.bind_previous(prev_copy.read_bytes())

        plan_path = log_dir / 'switch-plan.json'
        backup_parent = SS_ROOT / 'Backups' / f'ss-deploy-main-{run_id}'
        use_pq = controller_supports_producer_quiesce()
        if not omit_backup:
            backup_preflight(log_dir)
        prepare_until_ready(
            log_dir, args.holder, args.reason,
            inode=inode, birth=birth, plan=plan_path, plist=args.plist,
            backup_parent=backup_parent, budget_deadline=budget_deadline,
            retry_max=args.prepare_retry_max, retry_window=args.prepare_retry_window_seconds,
            producer_quiesce_flag=use_pq,
            omit_consistent_backup=omit_backup,
            preserve_on_failure=pause_policy is not None or args.recovery_profile == 'mail-schema2',
            expected_controller_sha256=pause_policy.controller_sha256 if pause_policy else None,
            maintenance_cohort=args.maintenance_cohort,
            publication=publication,
            previous_desktop_execution_schema=args.previous_desktop_execution_schema,
        )
        if pause_policy:
            pause_policy.check_plan(plan_path)
        prepared = True
        if mail_sources is not None:
            mail_plan_sha = hashlib.sha256(plan_path.read_bytes()).hexdigest()

        def switch():
            nonlocal forward_observation, mail_before
            if mail_sources is not None:
                mail_before = observe_once()
                mail_evidence.observation('before_switch', mail_before)
            try:
                if time.time() >= budget_deadline:
                    raise DeployFailure('total_budget_exhausted')
                if pause_policy:
                    pause_policy.check_plan(plan_path)
                if args.maintenance_cohort is not None:
                    frozen_plan_execution_preflight(plan_path, log_dir, args.holder, inode, birth,
                        pause_policy.controller_sha256 if pause_policy else None, publication)
                assert_maintenance_window_open(log_dir)
                if pause_policy:
                    pause_policy.switch_attempted = True
                ss_run(
                    log_dir, args.holder, args.reason,
                    ['--plan', str(plan_path), '--held-lock-inode', str(inode), '--owner-birth', birth, 'switch'],
                    producer_quiesce=False,
                )
                obs = observe()
                assert_min_gates(obs, target_release=args.target_release, expected_schema=args.expected_entity_schema)
                if mail_sources is not None and not getattr(args,'p_off_enrollment',False):
                    # 验真对象只在内存，不提前落deployed回执；任何失败仍在原transaction补偿范围。
                    gate_receipt = {'schema':gh.SCHEMA, 'sha':args.sha,
                        'links':{'issue':args.issue_url,'pr':args.pr_url or '',
                                 'commit':f'https://github.com/felixlark/smart-shadow/commit/{args.sha}'},
                        'status':'deployed','previous_release':previous,'current_release':args.target_release,
                        'release_path':str((gh.RELEASES/args.target_release).resolve()),
                        'before_stats':mail_before['stats'],'gh_config_user':gh_config_user}
                    gh.verify(gate_receipt, obs['runtime'], obs['health'], obs['stats'])
            except Exception:
                if mail_sources is None and pause_policy and pause_policy.switch_attempted:
                    # 提交未知先读回；目标已健康且暂停生效时交原事务继续独立复验。
                    forward_observation = False
                    try:
                        reconciled = observe()
                        assert_min_gates(reconciled, target_release=args.target_release,
                                         expected_schema=args.expected_entity_schema)
                    except Exception:
                        pass
                    else:
                        log_line(log_dir, 'switch_error_target_reconciled_with_required_pause')
                        return
                # 备份失败可直接核验仍在用的 previous，不一定经过 rollback 回调。
                forward_observation = False
                raise

        def rollback():
            nonlocal forward_observation
            # transaction在其except内调用本回调；sys.exception()仍是原始switch/observe异常。
            capture_mail_failure('before_ordinary_compensation', sys.exception())
            forward_observation = False
            if args.recovery_profile == 'mail-schema2':
                try:
                    def requiesce_identity():
                        raw = plan_path.read_bytes()
                        if hashlib.sha256(raw).hexdigest() != mail_plan_sha:
                            raise DeployFailure('mail_requiesce_frozen_plan_changed')
                        frozen = json.loads(raw)
                        return mail_runtime_proof(log_dir,args.holder,inode,birth,mail_controller_sha,
                            expected_plist=bytes.fromhex(frozen['target_plist']),expected_pins=frozen['new_pins'])
                    mail_sources.requiesce_owned_restored(requiesce_identity)
                except Exception as source_error:
                    # 坏API/证据IO不阻挡正式Core精停；Core仍必须证所有Node/native/DB writer已退出。
                    mail_evidence_errors.append({'stage':'requiesce','error_type':type(source_error).__name__})
                recover_started_candidate(log_dir, args.holder, args.reason, plan_path, inode, birth, pause_policy,
                    {'expected_plan_sha256':mail_plan_sha,'baseline_proof':mail_base_proof})
                return
            if pause_policy:
                pause_policy.before_recovery(plan_path)
            prev_plist = prev_copy
            if not prev_plist.exists():
                raise RuntimeError('previous_plist_missing_for_rollback')
            wait_stable_quiet(log_dir, stable_seconds=args.quiesce_stable_seconds, timeout=120)
            rb_plan = log_dir / 'rollback-plan.json'
            rollback_cohort = fresh_maintenance_cohort(args.maintenance_cohort, log_dir, args.holder, inode, birth,
                phase='rollback-prepare', expected_controller_sha256=pause_policy.controller_sha256 if pause_policy else None,
                publication=publication, complete_preflight=True
            ) if args.maintenance_cohort is not None else None
            ss_run(
                log_dir, args.holder, args.reason,
                [
                    '--plan', str(rb_plan), '--next-plist', str(prev_plist),
                    '--switch-budget-seconds', '1800',
                    *(['--maintenance-cohort', str(rollback_cohort)] if rollback_cohort is not None else []),
                    *(['--preserve-on-failure'] if pause_policy else []),
                    '--held-lock-inode', str(inode), '--owner-birth', birth, 'prepare-switch',
                ],
                producer_quiesce=use_pq,
            )
            if pause_policy:
                pause_policy.check_recovery_plan(rb_plan, plan_path)
            if rollback_cohort is not None:
                frozen_plan_execution_preflight(rb_plan, log_dir, args.holder, inode, birth,
                    pause_policy.controller_sha256 if pause_policy else None, publication)
            assert_maintenance_window_open(log_dir)
            ss_run(
                log_dir, args.holder, args.reason,
                ['--plan', str(rb_plan), '--held-lock-inode', str(inode), '--owner-birth', birth, 'switch'],
            )

        def rollback_failed_start():
            nonlocal forward_observation
            capture_mail_failure('before_failed_start_compensation', sys.exception())
            forward_observation = False
            if pause_policy:
                pause_policy.before_recovery(plan_path)
            if args.recovery_profile == 'mail-schema2':
                # 启动命令非零仍可能留活候选；正式quiesce也须识别job0/absent的只读专用恢复状态。
                ss_run(log_dir, args.holder, args.reason,
                    ['--plan', str(plan_path), '--held-lock-inode', str(inode), '--owner-birth', birth, 'quiesce-switched'])
            try:
                ss_run(
                    log_dir, args.holder, args.reason,
                    ['--plan', str(plan_path), '--held-lock-inode', str(inode), '--owner-birth', birth, 'rollback-failed-start'],
                )
            except ServiceCommandFailure as primary:
                if args.recovery_profile != 'mail-schema2' or not recovery_intent_allows_observe(primary,
                        action='rollback-failed-start',plan_path=plan_path,expected_plan_sha256=mail_plan_sha,
                        holder=args.holder,baseline_proof=mail_base_proof,controller_path=CTL,support_root=SS_ROOT):
                    raise
                # 仅准原transaction独立observe；quiesce错误不进入此分支。


        def mail_compensate_terminal_failure(primary):
            nonlocal forward_observation, mail_result, mail_sources_terminal_verified
            forward_observation = False
            mail_sources_terminal_verified = False
            try:
                mail_sources.save('terminal_acceptance_failed', primary_code=getattr(primary,'failure_code',type(primary).__name__))
            except Exception as evidence_error:
                mail_evidence_errors.append({'stage':'terminal_acceptance','error_type':type(evidence_error).__name__})
            restored = None
            before_source_restore = None
            previous_identity = None
            try:
                rollback()
                restored = observe()
                def previous_identity():
                    raw=plan_path.read_bytes()
                    if hashlib.sha256(raw).hexdigest()!=mail_plan_sha:
                        raise DeployFailure('mail_previous_frozen_plan_changed')
                    frozen=json.loads(raw)
                    return mail_runtime_proof(log_dir,args.holder,inode,birth,mail_controller_sha,
                        expected_plist=bytes.fromhex(frozen['original_plist']),expected_pins=frozen['old_pins'])
                before_source_restore = restored
                restored = None  # 未读到恢复源后的完整快照须显式null，不拿旧healthy冒新观测。
                mail_restore_sources('previous')
                # previous恢复源后也必须实读；不能复用源仍OFF时的健康/统计签回退。
                restored = observe()
                if (restored['runtime']['client_service']['release'] != previous
                        or not gh.rollback_healthy(mail_before['stats'],restored['stats'],restored['health'],mail_last_candidate_stats)):
                    raise DeployFailure('mail_previous_post_source_restore_unhealthy')
                rb = {'schema':gh.SCHEMA,'sha':args.sha,
                    'links':{'issue':args.issue_url,'pr':args.pr_url or '',
                             'commit':f'https://github.com/felixlark/smart-shadow/commit/{args.sha}'},
                    'status':'rolled_back','previous_release':previous,'current_release':previous,
                    'release_path':str((gh.RELEASES/previous).resolve()),'before_stats':mail_before['stats'],
                    'rollback_stats':restored['stats'],'failed_stats':mail_last_candidate_stats,
                    'rollback_path':'terminal_acceptance_failure','primary_failure':getattr(primary,'failure_code',type(primary).__name__),
                    'mail_source_transaction':mail_sources.last_receipt}
                rb['evidence'] = mail_delivery_evidence(log_dir,plan_path,restored,mail_sources,mail_controller_sha)
                gh.verify(rb,restored['runtime'],restored['health'],restored['stats'])
                mail_sources_terminal_verified = True
                path=log_dir/f'github-delivery-rollback-{args.sha[:12]}-{uuid.uuid4().hex}.json'
                path.write_text(json.dumps(rb,ensure_ascii=False,indent=2)+'\n')
                mail_result={'status':'rolled_back'}
                write_receipt(log_dir,{'schema':'smart-shadow.ss-deploy-main/v1','status':'rolled_back',
                    'receipt_path':str(path),'sha':args.sha,'current_release':previous,'primary_failure':rb['primary_failure'],
                    'at':now_iso()})
                return 2
            except Exception as recovery:
                # 统计拒签或stats未知不再关掉已独立证明安全previous的原开关。
                # 身份/health/原态CAS未证时仍精保全本轮自己的新ON，不第二次bootstrap。
                source_safe = mail_close_previous_sources()
                if not source_safe and previous_identity is not None:
                    try:
                        mail_sources.requiesce_owned_restored(previous_identity)
                    except Exception as preserve_error:
                        mail_evidence_errors.append({'stage':'previous_source_preservation','error_type':type(preserve_error).__name__})
                try:
                    mail_sources.save('terminal_compensation_unknown', primary_code=getattr(primary,'failure_code',type(primary).__name__),
                        recovery_code=getattr(recovery,'failure_code',type(recovery).__name__))
                except Exception as evidence_error:
                    mail_evidence_errors.append({'stage':'terminal_compensation','error_type':type(evidence_error).__name__})
                write_receipt(log_dir,{'schema':'smart-shadow.ss-deploy-main/v1','status':'failed',
                    'failure_code':'mail_terminal_compensation_unknown','primary_failure':getattr(primary,'failure_code',type(primary).__name__),
                    'recovery_failure':getattr(recovery,'failure_code',type(recovery).__name__),'rollback_observation':restored,
                    'before_source_restore_observation':before_source_restore,
                    'source_restoration_verified':source_safe,
                    'source_restoration_receipt':mail_source_restoration_receipt if source_safe else None,
                    'mail_source_transaction':mail_sources.last_receipt,'evidence_errors':mail_evidence_errors,'at':now_iso()})
                return 1

        if getattr(args,'p_off_enrollment',False):
            def commit_p_receipt(payload):
                return p_components[1].put(log_dir/('p-off-enrollment-'+uuid.uuid4().hex+'.json'),payload)
            try:
                p_result = p_components[0].transaction(github=gh,verifier=p_proof,
                    switch=switch,rollback=rollback,rollback_failed_start=rollback_failed_start,
                    observe=observe,close_sources=mail_restore_sources,
                    verify_helper=lambda:gh.verify_gh_config_user({'sha':args.sha,'gh_config_user':gh_config_user}),
                    commit=commit_p_receipt,target_release=args.target_release,candidate_sha=args.sha,
                    gh_config_user=gh_config_user,
                    links={'issue':args.issue_url,'pr':args.pr_url,
                           'commit':f'https://github.com/felixlark/smart-shadow/commit/{args.sha}'},
                    known_failed_stats=lambda:mail_last_candidate_stats)
            except p_components[0].PTransactionFailure as error:
                # 专项内部已执行一次正式补偿；外壳不再重复bootstrap/restore。
                mail_source_close_attempted = True
                p_components[1].put(log_dir/('p-off-compensation-unknown-'+uuid.uuid4().hex+'.json'),error.evidence)
                raise DeployFailure(error.failure_code)
            mail_sources_terminal_verified = True
            # 回执已在专项事务内独立读回；此后无必须成功的新I/O。
            return 0 if p_result['status'] == 'p_metadata_adopted' else 2

        result = gh.transaction(
            switch, rollback, observe, args.target_release,
            issue=args.issue_url, candidate_sha=args.sha, gh_config_user=gh_config_user,
            rollback_failed_start=rollback_failed_start,
        )

        if mail_sources is not None and result['status'] == 'rolled_back':
            # switch自身已读到的实际候选快照也要保留，不能只取transaction内较晚的observe。
            result = {**result, 'failed_stats':mail_last_candidate_stats}
        mail_result = result if mail_sources is not None else None

        # 事务终态仍须独立读现场，不能被已经耗尽的前向预算跳过。
        forward_observation = False
        # E／I — 成功门禁 health∧schema∧release；假回滚掩盖检测；receipt 必落盘
        obs = result.get('observation') or observe()
        live = observe()
        live_release = (live.get('runtime') or {}).get('client_service', {}).get('release')
        if result['status'] == 'rolled_back' and live_release == args.target_release:
            log_line(log_dir, 'I_guard live_already_target; refuse masked rollback report')
            raise fail_receipt(
                log_dir,
                'deployed_masked_as_rollback',
                f'live_release={live_release} result_status=rolled_back',
                extra={'live_release': live_release, 'transaction_status': result['status']},
            )
        if result['status'] == 'deployed':
            assert_min_gates(obs, target_release=args.target_release, expected_schema=args.expected_entity_schema)
            assert_min_gates(live, target_release=args.target_release, expected_schema=args.expected_entity_schema)

        links = {
            'issue': args.issue_url,
            'pr': args.pr_url or '',
            'commit': f'https://github.com/felixlark/smart-shadow/commit/{args.sha}',
        }
        receipt = {
            'schema': gh.SCHEMA,
            'sha': args.sha,
            'links': links,
            'status': result['status'],
            'previous_release': result['previous_release'],
            'current_release': result['current_release'],
            'release_path': str((gh.RELEASES / result['current_release']).resolve()),
            'before_stats': result.get('before_stats'),
            'gh_config_user': gh_config_user,
            'health': obs.get('health'),
            'entity_schema': (obs.get('health') or {}).get('entity_schema'),
            'entry': 'ss-deploy-main',
            **({'required_pause': pause_policy.receipt()} if pause_policy else {}),
        }
        if result['status'] == 'rolled_back':
            receipt['rollback_stats'] = result.get('rollback_stats')
            receipt['failed_stats'] = result.get('failed_stats')
        if mail_sources is not None:
            receipt['rollback_path'] = result.get('rollback_path')
            # 全部必要验真先完成，源仍OFF；随后只恢复本次own postimage。
            gh.verify(receipt, live['runtime'], live['health'], live['stats'])
            mail_restore_sources('previous' if result['status'] == 'rolled_back' else 'candidate')
            receipt['mail_source_transaction'] = mail_sources.last_receipt
            source_live = observe_once()
            receipt['evidence'] = mail_delivery_evidence(log_dir,plan_path,source_live,mail_sources,mail_controller_sha)
            gh.verify(receipt, source_live['runtime'], source_live['health'], source_live['stats'])
            mail_sources_terminal_verified = True
        receipt_path = log_dir / f'github-delivery-receipt-{args.sha[:12]}.json' 
        receipt_path.write_text(json.dumps(receipt, indent=2, ensure_ascii=False) + '\n')
        if mail_sources is not None and json.loads(receipt_path.read_text()) != receipt:
            raise DeployFailure('mail_receipt_readback_mismatch')
        if result['status'] == 'deployed' and (not receipt_path.exists() or receipt_path.stat().st_size < 32):
            raise fail_receipt(log_dir, 'receipt_missing', f'receipt_missing:{receipt_path}')
        status_payload = {
            'schema': 'smart-shadow.ss-deploy-main/v1',
            'status': result['status'],
            'receipt_path': str(receipt_path),
            'sha': args.sha,
            'current_release': result['current_release'],
            'entity_schema': receipt['entity_schema'],
            'gates': {
                'health': (obs.get('health') or {}).get('status'),
                'entity_schema': receipt['entity_schema'],
                'release': result['current_release'],
                'receipt': str(receipt_path),
            },
            'charter_ghi': True,
            **({'required_pause': pause_policy.receipt()} if pause_policy else {}),
            'at': now_iso(),
        }
        write_receipt(log_dir, status_payload)
        if result['status'] == 'deployed' and not (log_dir / 'STATUS.json').exists():
            raise fail_receipt(log_dir, 'receipt_missing', 'STATUS.json missing after write')
        log_line(log_dir, f'DONE status={result["status"]} entity_schema={receipt["entity_schema"]}')
        print(json.dumps(status_payload, ensure_ascii=False))
        return 0 if result['status'] == 'deployed' else 2
    except DeployFailure as exc:
        capture_mail_failure('publisher_deploy_failure', exc)
        if mail_result is not None and mail_result['status'] == 'deployed':
            return mail_compensate_terminal_failure(exc)
        if (mail_sources is not None and 'mail_close_previous_sources' in locals()
                and not (getattr(args,'p_off_enrollment',False) and mail_source_close_attempted)):
            mail_close_previous_sources()
        log_line(log_dir, f'FAIL {exc.failure_code}: {exc.detail}')
        if not (log_dir / 'FAILURE.json').exists():
            write_receipt(log_dir, {
                'schema': 'smart-shadow.ss-deploy-main/v1',
                'status': 'failed',
                'failure_code': exc.failure_code,
                'source_restoration_receipt':mail_source_restoration_receipt,
                **({'required_pause': pause_policy.receipt()} if pause_policy else {}),
                'detail': exc.detail,
                'stderr_tail': exc.detail.splitlines()[-1],
                'next_step': exc.next_step,
                'at': now_iso(),
            })
        print(json.dumps({
            'status': 'failed',
            'failure_code': exc.failure_code,
            'next_step': exc.next_step,
            'detail': exc.detail,
        }, ensure_ascii=False), file=sys.stderr)
        return 1
    except Exception as exc:
        capture_mail_failure('publisher_exception', exc)
        if mail_result is not None and mail_result['status'] == 'deployed':
            return mail_compensate_terminal_failure(exc)
        if (mail_sources is not None and 'mail_close_previous_sources' in locals()
                and not (getattr(args,'p_off_enrollment',False) and mail_source_close_attempted)):
            mail_close_previous_sources()
        log_line(log_dir, f'FAIL {type(exc).__name__}: {exc}')
        code = pause_policy.failure_code or 'required_pause_deploy_failed' if pause_policy else 'unhandled'
        fail_receipt(log_dir, code, code if pause_policy else str(exc),
                     extra={**({'required_pause': pause_policy.receipt()} if pause_policy else {}),
                            **({'source_restoration_receipt':mail_source_restoration_receipt} if mail_sources is not None else {})})
        print(str(exc), file=sys.stderr)
        return 1
    finally:
        mail_final_gap = None
        if mail_sources is not None and not mail_sources_terminal_verified and not mail_source_close_attempted:
            try:
                # transaction统计拒签也要独立核previous；helper内精验身份/health/CAS，坏候选绝不启源。
                mail_restore_sources('previous' if mail_plan_sha else 'untouched')
            except Exception as exc:
                mail_final_gap = getattr(exc,'failure_code',type(exc).__name__)
                mail_sources.save('final_restore_incomplete', code=mail_final_gap)
                # 保留原失败证，补独立source缺口；不把它改写成正常完成。
                gap_path = log_dir / f'mail-source-final-gap-{uuid.uuid4().hex}.json'
                gap_path.write_text(json.dumps({'status':'failed','code':mail_final_gap,
                    'mail_source_transaction':mail_sources.last_receipt},indent=2)+'\n')
        if disabled:
            try:
                restore_collectors(log_dir, disabled, run_id=run_id)
            except Exception as exc:
                log_line(log_dir, f'quiesce_restore_batch_err {exc}')
        if inode is not None:
            release_lock(log_dir)
        if not prepared:
            log_line(log_dir, 'prepare_never_completed; service untouched_or_quiesced_only')



if __name__ == '__main__':
    sys.exit(main())

