"""P OFF 快照差分私件；数据比较不证明真实Core/进程/来源，不能单独签采用。

输入结构来自原38运行观测接口；factory_rows来自固定候选真实factory投影。
Root adapter必须另核physical/code/config/closure，并封存本比较器与输入字节。
"""
from __future__ import annotations
import copy
import hashlib
import json

PROVIDERS = frozenset({'feishu_task', 'feishu_approval'})
PHASES = frozenset({'quiesced_previous', 'quiesced_candidate', 'closed_candidate', 'closed_previous'})
COUNTERS = ('message_count', 'failure_count', 'historical_failure_count', 'current_failure_count', 'collector_count', 'enabled_count')
HISTORY_COUNTERS = ('message_count', 'failure_count', 'historical_failure_count')
# 原7faa合同明确列出的既有transient事故；不泛化为忽略任意旧来源失败。
INCIDENT_SOURCES = frozenset({'icloud_mail', 'xmu_mail'})


def sha(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def need(condition, reason):
    if not condition:
        raise ValueError(reason)


def index(rows, key):
    need(type(rows) is list, 'rows_missing')
    result = {}
    for row in rows:
        need(type(row) is dict and type(row.get(key)) is str and bool(row[key]), 'row_identity_missing')
        need(row[key] not in result, 'duplicate_row_identity')
        result[row[key]] = row
    return result


def same_value(left, right):
    if type(left) is not type(right):
        return False
    if isinstance(left, dict):
        return set(left) == set(right) and all(same_value(v, right[k]) for k,v in left.items())
    if isinstance(left, list):
        return len(left) == len(right) and all(same_value(a,b) for a,b in zip(left,right))
    return left == right


def collection_timestamp(value):
    return value is None or (type(value) is str and bool(value.strip()))


def integer(value):
    return type(value) is int and value >= 0


def stats_items(stats):
    need(type(stats) is dict, 'stats_missing')
    rows = index(stats.get('items'), 'source')
    for row in rows.values():
        need(all(integer(row.get(k)) for k in COUNTERS), 'stats_counter_missing_or_invalid')
        need(row['failure_count'] == row['historical_failure_count'], 'stats_historical_alias_conflict')
        need('last_collected_at' in row and collection_timestamp(row['last_collected_at']), 'stats_last_collection_missing')
    return rows


def views(observation):
    need(type(observation) is dict, 'observation_missing')
    return {
        'items': stats_items(observation['stats']),
        'stats_collectors': index(observation['stats']['collectors'], 'collector_ref'),
        'schedules': index(observation['runtime']['collector_ledger']['schedules'], 'collector_ref'),
        'controls': index(observation['controls']['collectors'], 'collector_ref'),
        'sources': index(observation['controls']['sources'], 'source'),
    }


def expected_rows(rows):
    need(type(rows) is list and len(rows) == 2, 'exact_two_factory_rows_required')
    result = {}
    for row in rows:
        need(type(row) is dict and row.get('provider') in PROVIDERS and row.get('source') == row['provider'], 'factory_provider_conflict')
        need(row.get('initially_enabled') is False, 'factory_explicit_off_required')
        definition = row.get('definition')
        need(type(definition) is dict, 'factory_definition_missing')
        ref, revision = definition.get('collector_ref'), definition.get('config_revision')
        need(type(ref) is str and bool(ref) and ref not in result and type(revision) is str and bool(revision), 'factory_definition_identity')
        result[ref] = row
    need({row['provider'] for row in result.values()} == PROVIDERS, 'exact_two_providers_required')
    return result


def history_preserved(before, after, reason):
    need(all(after[k] >= before[k] for k in HISTORY_COUNTERS), reason)
    # 时间戳是证据原件，既有last_collected_at不能被清空。
    need(before['last_collected_at'] is None or after['last_collected_at'] is not None, 'old_collection_timestamp_erased')


def failure_transition(before, after, field, source, reason):
    need(integer(before.get(field)) and integer(after.get(field)), reason)
    # 当前失败可真实改善，历史累计由items独立保全；不把last_failure换成其它原因。
    improved = after[field] <= before[field] and (
        same_value(after.get('last_failure'), before.get('last_failure'))
        or (after[field] == 0 and after.get('last_failure') is None))
    # 7faa合同保留精两旧Mail事故增量；完整release判断仍另行失败/待核。
    known_incident = source in INCIDENT_SOURCES and after.get('last_failure') == 'transient'
    need(improved or known_incident, reason)


def compare_snapshots(baseline, observation, factory_rows, *, phase, failed_stats=None):
    """纯有界比较；永远p_snapshot_verified=false，由正常adapter补真实物理出处。

    baseline是切换前已封存的正常原状态（不以临时quiesce状态冒原7ON/3OFF）。
    quiesced阶段仅验证源集合/统计/定义；临时物停与闭环由Root closure核。
    closed阶段逐项核原控制状态；允许revision单调前进，禁清零或降版。
    """
    report = {'schema': 'smart-shadow.p-off-data-comparison/v1', 'state': 'compared_untrusted',
              'p_snapshot_verified': False, 'data_comparison_passed': False,
              'phase': phase, 'reason': None, 'coverage': {}, 'full_release_accepted': False}
    try:
        need(phase in PHASES, 'unknown_phase')
        old, now, new = views(baseline), views(observation), expected_rows(factory_rows)
        need(len(old['items']) == 16 and len(old['schedules']) == 10 and len(old['controls']) == 10 and len(old['sources']) == 10,
             'baseline_denominator_conflict')
        need(all(type(c.get('enabled')) is bool for c in old['controls'].values()), 'baseline_enabled_missing')
        need(sum(c['enabled'] for c in old['controls'].values()) == 7, 'baseline_seven_on_three_off_required')
        need(not (PROVIDERS & set(old['items'])) and not (set(new) & set(old['schedules'])), 'baseline_not_initial_enrollment')
        need(all(type(s.get('collectors')) is list for s in old['sources'].values()), 'baseline_source_collectors_missing')
        candidate = phase in {'quiesced_candidate', 'closed_candidate'}
        rollback = phase == 'closed_previous'
        for key in ('controls', 'schedules', 'stats_collectors'):
            extra = set(now[key]) - set(old[key])
            need(set(old[key]) <= set(now[key]) and extra <= set(new), 'unexpected_'+key+'_set')
            # health_targets是查询子集；完整登记来自controls/schedules/items。
            if key != 'stats_collectors':
                need(extra == set(new) if candidate else rollback or not extra, 'incomplete_'+key+'_set')
        extra_sources = set(now['sources']) - set(old['sources'])
        need(set(old['sources']) <= set(now['sources']) and extra_sources <= PROVIDERS, 'unexpected_sources_set')
        need(extra_sources == PROVIDERS if candidate else rollback or not extra_sources, 'incomplete_sources_set')
        retained = stats_items(failed_stats) if failed_stats is not None else {}
        if rollback:
            need(set(old['items']) <= set(retained) <= set(old['items']) | PROVIDERS or not retained, 'failed_stats_source_set_conflict')
        required_items = set(old['items']) | (PROVIDERS if candidate else (set(retained) & PROVIDERS))
        if rollback:
            need(required_items <= set(now['items']) <= set(old['items']) | PROVIDERS, 'unexpected_stats_source_set')
            required_items = set(now['items'])
        else:
            need(set(now['items']) == required_items, 'unexpected_stats_source_set')
        # 新来源的桶只允许精两种。回退如曾登记，保留审计桶，不drop伪装旧集合。
        for source in required_items - set(old['items']):
            row = now['items'][source]
            need(row['enabled_count'] == 0, 'new_source_enabled')
            if candidate:
                need(all(row[k] == 0 for k in HISTORY_COUNTERS + ('current_failure_count',)), 'new_source_data_or_failures')
                need(row['collector_count'] == 1 and row['last_collected_at'] is None, 'new_source_not_empty_off_bucket')
            elif source in retained:
                history_preserved(retained[source], row, 'rollback_new_audit_history_lost')
        if rollback:
            for ref, projected in new.items():
                if ref in now['controls']:
                    control = now['controls'][ref]
                    need({'collector_ref','source','enabled','available','revision','state','unresolved'} <= set(control)
                         and integer(control['revision']), 'rollback_new_control_fields_invalid')
                    need(control.get('source') == projected['provider'] and control.get('enabled') is False
                         and type(control.get('available')) is bool and control.get('state') in {'stopped', 'unavailable'}
                         and type(control.get('unresolved')) is int and control['unresolved'] == 0, 'rollback_new_control_not_off')
                if ref in now['schedules']:
                    schedule = now['schedules'][ref]
                    need({'collector_ref','config_revision','enabled','failures','next_due','active_operation','last_failure'} <= set(schedule)
                         and integer(schedule['failures']), 'rollback_new_schedule_fields_invalid')
                    need(schedule.get('config_revision') == projected['definition']['config_revision']
                         and type(schedule.get('enabled')) is int and schedule['enabled'] == 0
                         and 'active_operation' in schedule and schedule['active_operation'] is None,
                         'rollback_new_schedule_not_off')
                if ref in now['stats_collectors']:
                    stat = now['stats_collectors'][ref]
                    need({'collector_ref','source','enabled','available','current_failure_count','last_failure','intake_stop_unconfirmed_count','started_at','last_collected_at'} <= set(stat)
                         and type(stat['available']) is bool and integer(stat['current_failure_count'])
                         and collection_timestamp(stat['started_at']) and collection_timestamp(stat['last_collected_at']), 'rollback_new_stats_fields_invalid')
                    need(stat.get('source') == projected['provider'] and stat.get('enabled') is False
                         and type(stat.get('intake_stop_unconfirmed_count')) is int and stat['intake_stop_unconfirmed_count'] == 0, 'rollback_new_stats_not_off')
                if projected['provider'] in now['sources']:
                    source = now['sources'][projected['provider']]
                    need({'source','revision','collectors','enabled','state'} <= set(source)
                         and integer(source['revision']) and type(source['collectors']) is list
                         and len(source['collectors']) == len(set(source['collectors'])), 'rollback_new_source_fields_invalid')
                    need(source.get('enabled') is False and source.get('state') in {'stopped', 'unavailable'}
                         and set(source.get('collectors', [])) <= {ref}, 'rollback_new_source_not_off')
        deltas = {}
        for source, before in old['items'].items():
            after = now['items'][source]
            need(set(after) == set(before), 'old_source_stats_fields_changed')
            need(all(same_value(after[k], value) for k, value in before.items() if k not in COUNTERS + ('last_collected_at',)),
                 'old_source_stats_metadata_changed')
            history_preserved(before, after, 'old_source_history_lost')
            need(after['collector_count'] == before['collector_count'], 'old_collector_count_changed')
            if phase.startswith('closed_'):
                need(after['enabled_count'] == before['enabled_count'], 'old_enabled_count_not_restored')
            else:
                need(after['enabled_count'] == 0, 'quiesced_old_enabled_count_not_zero')
            if rollback and source in retained:
                history_preserved(retained[source], after, 'rollback_failed_history_lost')
            if after['current_failure_count'] > before['current_failure_count']:
                need(source in INCIDENT_SOURCES, 'unexpected_old_source_failure')
            if after['failure_count'] > before['failure_count']:
                need(source in INCIDENT_SOURCES, 'unexpected_old_source_failure')
            deltas[source] = {k: after[k] - before[k] for k in COUNTERS}
        for key in ('controls', 'sources'):
            for identity, before in old[key].items():
                after = now[key][identity]
                need(set(after) == set(before), 'old_control_fields_changed')
                need(integer(after.get('revision')) and integer(before.get('revision')) and after['revision'] >= before['revision'], 'old_control_revision_regressed')
                if phase.startswith('quiesced_'):
                    need(after.get('enabled') is False, 'quiesced_source_not_off')
                    if before.get('enabled') is False or before.get('state') in {'paused', 'unknown'}:
                        need(after.get('state') == before.get('state'), 'quiesced_old_off_state_changed')
                for field, value in before.items():
                    if field == 'revision' or (phase.startswith('quiesced_') and field in {'state', 'enabled', 'unresolved'}):
                        continue
                    need(same_value(after[field], value), 'old_control_state_or_identity_changed')
        for ref, before in old['schedules'].items():
            after = now['schedules'][ref]
            need(set(after) == set(before), 'old_schedule_fields_changed')
            need(after['config_revision'] == before['config_revision'], 'old_schedule_config_changed')
            need('active_operation' in before and 'active_operation' in after
                 and collection_timestamp(before['active_operation']) and collection_timestamp(after['active_operation']),
                 'old_operation_shape_invalid')
            # quiesce/恢复会产生自然operation生命周期；不冻结旧UUID。
            # 实际停/恢复归属仍须Root核source journal，不能由本比较器签认。
            if phase.startswith('closed_'):
                need(same_value(after.get('enabled'), before.get('enabled')), 'old_schedule_enabled_not_restored')
            else:
                need(type(after.get('enabled')) is int and after['enabled'] == 0, 'quiesced_schedule_not_off')
            need(integer(after.get('failures')), 'old_schedule_failures_invalid')
            failure_transition(before, after, 'failures', old['controls'][ref]['source'], 'unexpected_old_schedule_failure')
        for ref, before in old['stats_collectors'].items():
            after = now['stats_collectors'][ref]
            need(set(after) == set(before), 'old_collector_stats_fields_changed')
            need('last_collected_at' in before and 'last_collected_at' in after
                 and collection_timestamp(before['last_collected_at']) and collection_timestamp(after['last_collected_at'])
                 and (before['last_collected_at'] is None or after['last_collected_at'] is not None),
                 'old_collector_collection_timestamp_erased')
            for field in ('source', 'available', 'started_at'):
                need(same_value(after.get(field), before.get(field)), 'old_collector_stats_identity_changed')
            need(type(after.get('intake_stop_unconfirmed_count')) is int and type(before.get('intake_stop_unconfirmed_count')) is int
                 and after['intake_stop_unconfirmed_count'] == before['intake_stop_unconfirmed_count'] == 0, 'physical_stop_unconfirmed')
            if phase.startswith('closed_'):
                need(after.get('enabled') is before.get('enabled'), 'old_stats_enabled_not_restored')
            else:
                need(after.get('enabled') is False, 'quiesced_stats_not_off')
            need(integer(after.get('current_failure_count')), 'old_collector_failures_invalid')
            failure_transition(before, after, 'current_failure_count', before['source'], 'unexpected_old_collector_failure')
        if candidate:
            for ref, projected in new.items():
                provider = projected['provider']
                control, schedule = now['controls'][ref], now['schedules'][ref]
                stat = now['stats_collectors'].get(ref)
                need({'collector_ref','source','enabled','available','revision','state','unresolved'} <= set(control), 'new_control_fields_missing')
                need({'collector_ref','config_revision','enabled','failures','next_due','active_operation','last_failure'} <= set(schedule), 'new_schedule_fields_missing')
                need(control.get('source') == provider and control.get('enabled') is False and control.get('available') is True
                     and control.get('state') == 'stopped' and type(control.get('unresolved')) is int and control['unresolved'] == 0 and integer(control.get('revision')), 'new_control_not_off')
                need(schedule.get('config_revision') == projected['definition']['config_revision'] and type(schedule.get('enabled')) is int
                     and schedule['enabled'] == 0 and type(schedule.get('failures')) is int and schedule['failures'] == 0 and schedule.get('last_failure') is None
                     and 'active_operation' in schedule and schedule['active_operation'] is None, 'new_schedule_not_off_or_mismatched')
                if stat is not None:
                    need({'collector_ref','source','enabled','available','current_failure_count','last_failure','intake_stop_unconfirmed_count','started_at','last_collected_at'} <= set(stat), 'new_collector_stats_fields_missing')
                    need(stat.get('source') == provider and stat.get('enabled') is False and stat.get('available') is True
                         and type(stat.get('current_failure_count')) is int and stat['current_failure_count'] == 0 and stat.get('last_failure') is None
                         and type(stat.get('intake_stop_unconfirmed_count')) is int and stat['intake_stop_unconfirmed_count'] == 0
                         and stat['started_at'] is None and stat['last_collected_at'] is None, 'new_collector_stats_not_off')
                source = now['sources'][provider]
                need(source.get('collectors') == [ref] and source.get('enabled') is False and source.get('state') == 'stopped'
                     and integer(source.get('revision')), 'new_source_control_conflict')
        report.update(data_comparison_passed=True, reason='data_only_physical_binding_and_closure_required',
                      coverage={'old_sources':len(old['items']), 'old_controls':len(old['controls']),
                                'old_on':7, 'old_off':3, 'expected_new':2, 'observed_new_buckets':len(required_items)-16,
                                'physical_binding':'not_evaluated', 'source_journal':'not_evaluated', 'core_health':'not_evaluated'},
                      old_counter_deltas=deltas, baseline_sha256=sha(baseline), observation_sha256=sha(observation),
                      factory_rows_sha256=sha(factory_rows),
                      # 原统计完整保留；不把full generic false/unknown改成P成功或健康。
                      stats=copy.deepcopy(observation['stats']), health=copy.deepcopy(observation['health']),
                      failed_stats=copy.deepcopy(failed_stats))
    except (KeyError, TypeError, ValueError) as error:
        report['reason'] = str(error) if isinstance(error, ValueError) else 'observation_schema_missing'
    return report
