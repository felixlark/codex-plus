"""P OFF 专项事务。私候选；尚未接入正式 Main，不能用于生产。

限定 Task/Approval OFF enrollment，不改变 normal github-deploy.transaction。
Main 必须绑定同候选的固定 proof verifier、真实 ss-service 回调与持锁上下文。
observe 只读运行态；坏候选 helper 不参与 previous 的独立恢复验真。
"""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

SUBJECT = 'feishu-task-approval-off/v1'
SCHEMA = 'smart-shadow.p-off-enrollment/v1'


class PTransactionFailure(RuntimeError):
    def __init__(self, code, evidence):
        super().__init__(code)
        self.failure_code = code
        self.evidence = evidence


def release(observation):
    return observation['runtime']['client_service']['release']


def full_verdict(github, before, after):
    """原 generic 判定原样保留；本专项从不发行 full-release accepted。"""
    try:
        passed = github.healthy(before['stats'], after['stats'], after['health'])
        return {'health_stats_evaluated': True, 'generic_health_stats_passed': passed,
                'accepted': False, 'acceptance_scope': 'p_off_only'}
    except Exception as error:
        return {'health_stats_evaluated': False, 'generic_health_stats_passed': None,
                'accepted': False, 'error_type': type(error).__name__}


def checked_snapshot(verifier, observation, phase, *, closure=None, failed_stats=None):
    health = observation.get('health')
    if not isinstance(health, dict) or health.get('status') != 'ok':
        raise PTransactionFailure('p_health_unverified', {'phase': phase})
    result = verifier.verify_snapshot(copy.deepcopy(observation), phase=phase,
                                      closure=closure, failed_stats=failed_stats)
    if not isinstance(result, dict) or result.get('p_snapshot_verified') is not True:
        raise PTransactionFailure('p_snapshot_unverified', {'phase': phase, 'result': result})
    return result


def persist(commit, payload):
    """回执必须真实落私有 Logs、字节摘要及 JSON 独立回读一致。"""
    reference = commit(copy.deepcopy(payload))
    if not isinstance(reference, dict) or set(reference) != {'path', 'sha256'}:
        raise RuntimeError('p_receipt_reference_invalid')
    path = Path(reference['path'])
    logs = Path.home() / 'Library/Logs/me.longbiaochen.smart-shadow'
    if not path.is_absolute() or path.is_symlink() or not path.resolve().is_relative_to(logs):
        raise RuntimeError('p_private_receipt_path_invalid')
    raw = path.read_bytes()
    if (hashlib.sha256(raw).hexdigest() != reference['sha256']
            or json.loads(raw) != payload or path.stat().st_mode & 0o077):
        raise RuntimeError('p_receipt_readback_failed')
    return reference


def transaction(*, github, verifier, switch, rollback, rollback_failed_start,
                observe, close_sources, verify_helper, commit, target_release,
                candidate_sha, gh_config_user, links, known_failed_stats):
    """由正式 Main 在原部署锁内调用；本模块不提供 CLI 或任意 source 放行开关。"""
    if verifier.subject != SUBJECT:
        raise RuntimeError('p_fixed_subject_required')
    before = copy.deepcopy(observe())
    previous = release(before)
    if target_release == previous or not target_release:
        raise RuntimeError('distinct_target_release_required')
    verifier.verify_binding(candidate_sha=candidate_sha, previous=previous, target=target_release)
    checked_snapshot(verifier, before, 'quiesced_previous')
    verify_helper()
    failed_stats = None
    context = {'schema': SCHEMA, 'subject': SUBJECT, 'sha': candidate_sha,
               'links': copy.deepcopy(links), 'previous_release': previous,
               'target_release': target_release, 'before_stats': before['stats'],
               'gh_config_user': copy.deepcopy(gh_config_user)}
    try:
        switch()
        candidate = copy.deepcopy(observe())
        if release(candidate) != target_release:
            raise RuntimeError('p_target_release_mismatch')
        failed_stats = candidate['stats']
        verify_helper()
        verifier.verify_binding(candidate_sha=candidate_sha, previous=previous, target=target_release)
        checked_snapshot(verifier, candidate, 'quiesced_candidate')
        closed = close_sources('candidate')
        final = copy.deepcopy(observe())
        if release(final) != target_release:
            raise RuntimeError('p_final_release_mismatch')
        failed_stats = final['stats']
        proof = checked_snapshot(verifier, final, 'closed_candidate', closure=closed)
        # 只有真实 source 收尾、独立 after 与持久回执全部成立才返回 adopted。
        payload = {**context, 'status': 'p_metadata_adopted',
                   'current_release': target_release, 'observation': final,
                   'p_verification': proof, 'source_closure': closed,
                   'full_release': full_verdict(github, before, final)}
        pointer = persist(commit, payload)
        return {**payload, 'receipt': pointer}
    except BaseException as primary:
        failure = github._failure_code(primary)
        capture_error = None
        # switch 内部可能已读到 stats 后才抛异常；不得伪报未读到。
        try:
            known = known_failed_stats()
            if known is not None:
                failed_stats = copy.deepcopy(known)
        except Exception as error:
            capture_error = type(error).__name__
        evidence = {**context, 'status': 'p_enrollment_failed',
                    'failure_code': failure, 'error_type': type(primary).__name__,
                    'failed_stats': failed_stats, 'rollback_stats': None,
                    'known_stats_capture_error_type': capture_error,
                    'rollback_observation': None, 'source_closure': None}
        try:
            if failure == github.SWITCH_BACKUP_FAILURE:
                # 绝不重复备份、普通 rollback 或切 fallback；只验真实 previous。
                evidence['rollback_path'] = 'switch_backup_sqlite_failed'
            elif failure in github.FAILED_START_FAILURES:
                rollback_failed_start()
                evidence['rollback_path'] = 'rollback-failed-start'
            else:
                rollback()
                evidence['rollback_path'] = 'rollback'
            # stats 失败不阻挡原源安全收尾，但未知不能写成回退验真成功。
            read_error = None
            observed_release = None
            try:
                restored = copy.deepcopy(observe())
                evidence['rollback_observation'] = restored
                observed_release = release(restored)
                evidence['rollback_stats'] = restored['stats']
            except Exception as error:
                read_error = error
            # 已知不是 previous，绝不可把它混入 stats 未知的安全收尾路径。
            if observed_release is not None and observed_release != previous:
                raise RuntimeError('p_previous_release_mismatch')
            evidence['source_closure'] = close_sources('previous')
            if read_error is not None:
                raise read_error
            restored = copy.deepcopy(observe())
            evidence['rollback_observation'] = restored
            evidence['rollback_stats'] = restored['stats']
            if release(restored) != previous:
                raise RuntimeError('p_previous_release_mismatch')
            # 此处只用封存 proof/实际旧运行像；不再碰坏候选 helper/binding。
            proof = checked_snapshot(verifier, restored, 'closed_previous',
                                     closure=evidence['source_closure'], failed_stats=failed_stats)
            payload = {**evidence, 'status': 'p_enrollment_rolled_back',
                       'current_release': previous, 'p_verification': proof,
                       'full_release': full_verdict(github, before, restored)}
            pointer = persist(commit, payload)
            return {**payload, 'receipt': pointer}
        except BaseException as recovery:
            evidence['rollback_failure_type'] = type(recovery).__name__
            # 不二次 bootstrap/restore；原 Main 保全已证安全的源，未知原样留下。
            raise PTransactionFailure('p_compensation_unverified', evidence) from None
