"""合成结构矩阵；4710仅取观测形状，绝非fresh运行证明。"""
import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('comparison', Path(__file__).with_name('p-off-comparison.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
def baseline_fixture():
    # 合成值，仅沿4710结构，完全独立于本机private Logs和生产数据。
    sources = ['chatgpt','codex','feishu','feishu_calendar','feishu_mail','github','gmail','google_calendar',
               'icloud_calendar','icloud_mail','imessage','manual','selftest','shadowd','weixin','xmu_mail']
    entries = [('feishu-all-user-visible-v1','feishu',True),('feishu-inbox-partial','feishu_mail',True),
               ('feishu-primary-calendar','feishu_calendar',True),('google-daily','google_calendar',True),
               ('icloud-inbox','icloud_mail',True),('icloud-personal','icloud_calendar',True),('xmu-inbox','xmu_mail',True),
               ('feishu-private-cutover-approved','feishu',False),('gmail-owner-inbox','gmail',False),
               ('weixin-filehelper-7d','weixin',False)]
    controls=[];source_controls=[];schedules=[];stats_collectors=[]
    for ref,source,enabled in entries:
        failure = 40 if source in {'icloud_mail','xmu_mail'} else 157 if source=='weixin' else 0
        last_failure = 'transient' if source in {'icloud_mail','xmu_mail'} else 'identity_conflict' if source=='weixin' else None
        available=ref!='feishu-private-cutover-approved'
        controls.append({'collector_ref':ref,'source':source,'enabled':enabled,'available':available,'revision':1,'state':'unavailable' if not available else 'running' if enabled else 'stopped','unresolved':0})
        if available:
            source_controls.append({'source':source,'revision':1,'collectors':[ref],'enabled':enabled,'state':'running' if enabled else 'stopped'})
        schedules.append({'collector_ref':ref,'config_revision':'synthetic-old','enabled':int(enabled),'failures':failure,'next_due':None,'active_operation':None,'last_failure':last_failure})
        if ref!='feishu-private-cutover-approved':
            stats_collectors.append({'collector_ref':ref,'source':source,'enabled':enabled,'available':True,'current_failure_count':failure,'last_failure':last_failure,'intake_stop_unconfirmed_count':0,'started_at':'synthetic-earlier','last_collected_at':None})
    source_controls.append({'source':'imessage','revision':1,'collectors':[],'enabled':False,'state':'unavailable'})
    items=[]
    for source in sources:
        members=[c for c in controls if c['source']==source]
        failure = 40 if source in {'icloud_mail','xmu_mail'} else 157 if source=='weixin' else 0
        items.append({'source':source,'message_count':3,'last_collected_at':'synthetic-earlier',
                      'failure_count':failure,'historical_failure_count':failure,'current_failure_count':failure,
                      'collector_count':len(members),'enabled_count':sum(c['enabled'] for c in members)})
    return {'runtime':{'collector_ledger':{'schedules':schedules}},'controls':{'collectors':controls,'sources':source_controls},
            'stats':{'items':items,'collectors':stats_collectors},'health':{'status':'ok','channel_health':{'status':'warning','synthetic':True}}}



class ComparisonTests(unittest.TestCase):
    def setUp(self):
        self.before = baseline_fixture()
        self.after = copy.deepcopy(self.before)
        self.factory = []
        for provider in sorted(module.PROVIDERS):
            ref = provider+'-synthetic-off'
            definition = {'collector_ref':ref, 'config_revision':'synthetic-v1'}
            self.factory.append({'provider':provider,'source':provider,'initially_enabled':False,'definition':definition})
            self.after['stats']['items'].append({'source':provider, **{k:0 for k in module.COUNTERS}, 'collector_count':1,'last_collected_at':None})
            self.after['controls']['collectors'].append({'collector_ref':ref,'source':provider,'enabled':False,'available':True,'revision':1,'state':'stopped','unresolved':0})
            self.after['controls']['sources'].append({'source':provider,'revision':1,'collectors':[ref],'enabled':False,'state':'stopped'})
            self.after['runtime']['collector_ledger']['schedules'].append({**definition,'enabled':0,'failures':0,'next_due':None,'active_operation':None,'last_failure':None})
            self.after['stats']['collectors'].append({'collector_ref':ref,'source':provider,'enabled':False,'available':True,'current_failure_count':0,'last_failure':None,'intake_stop_unconfirmed_count':0,'started_at':None,'last_collected_at':None})

    def run_compare(self, **kwargs):
        return module.compare_snapshots(self.before,self.after,self.factory,phase=kwargs.pop('phase','closed_candidate'),**kwargs)

    def test_candidate_preserves_generic_warning_and_never_grants_trust(self):
        result=self.run_compare()
        self.assertTrue(result['data_comparison_passed'],result)
        self.assertFalse(result['p_snapshot_verified'])
        self.assertFalse(result['full_release_accepted'])
        self.assertEqual(result['health'],self.after['health'])
        self.assertEqual(result['stats'],self.after['stats'])
        self.assertEqual(result['coverage']['old_sources'],16)

    def test_new_off_matrix(self):
        cases=[('items','enabled_count',1),('items','message_count',1),('items','historical_failure_count',1),
               ('items','current_failure_count',1),('items','collector_count',0),('items','last_collected_at','synthetic'),
               ('collectors','enabled',True),('collectors','available',False),('collectors','last_failure','transient'),
               ('collectors','current_failure_count',1),('collectors','intake_stop_unconfirmed_count',1)]
        for section,field,value in cases:
            with self.subTest(section=section,field=field):
                saved=copy.deepcopy(self.after)
                self.after['stats'][section][-1][field]=value
                self.assertFalse(self.run_compare()['data_comparison_passed'])
                self.after=saved

    def test_new_control_schedule_source_matrix(self):
        cases=[('controls','enabled',True),('controls','state','running'),('controls','source','feishu'),
               ('sources','collectors',['wrong']),('sources','enabled',True),('sources','state','running'),
               ('schedules','enabled',1),('schedules','enabled',False),('schedules','failures',1),
               ('schedules','active_operation','synthetic-op'),('schedules','config_revision','wrong')]
        for section,field,value in cases:
            with self.subTest(section=section,field=field):
                saved=copy.deepcopy(self.after)
                rows=(self.after['controls']['collectors'] if section=='controls' else self.after['controls']['sources'] if section=='sources' else self.after['runtime']['collector_ledger']['schedules'])
                rows[-1][field]=value
                self.assertFalse(self.run_compare()['data_comparison_passed'])
                self.after=saved

    def test_old_source_counts_not_decreased(self):
        row=next(r for r in self.after['stats']['items'] if r['message_count']>0)
        row['message_count']-=1
        self.assertEqual(self.run_compare()['reason'],'old_source_history_lost')

    def test_historical_failure_not_decreased(self):
        row=next(r for r in self.after['stats']['items'] if r['failure_count']>0)
        row['failure_count']-=1;row['historical_failure_count']-=1
        self.assertEqual(self.run_compare()['reason'],'old_source_history_lost')

    def test_old_paused_or_unknown_control_preserved(self):
        for state in ['paused','unknown']:
            with self.subTest(state=state):
                self.before['controls']['collectors'][0]['state']=state
                self.after['controls']['collectors'][0]['state']=state
                self.assertTrue(self.run_compare()['data_comparison_passed'])
                self.after['controls']['collectors'][0]['state']='running'
                self.assertFalse(self.run_compare()['data_comparison_passed'])

    def test_legacy_off_never_enabled(self):
        row=next(c for c in self.after['controls']['collectors'] if c['collector_ref']=='gmail-owner-inbox')
        row['enabled']=True
        self.assertFalse(self.run_compare()['data_comparison_passed'])

    def test_missing_foreign_or_duplicate_rows_rejected(self):
        for mode in ['missing','foreign','duplicate']:
            with self.subTest(mode=mode):
                saved=copy.deepcopy(self.after)
                if mode=='missing':self.after['stats']['items'].pop(0)
                elif mode=='foreign':self.after['stats']['items'][0]['source']='foreign'
                else:self.after['stats']['items'].append(copy.deepcopy(self.after['stats']['items'][0]))
                self.assertFalse(self.run_compare()['data_comparison_passed'])
                self.after=saved

    def test_known_transient_visible_generic_unchanged(self):
        row=next(r for r in self.after['stats']['items'] if r['source']=='xmu_mail')
        for k in ['failure_count','historical_failure_count','current_failure_count']:row[k]+=1
        result=self.run_compare()
        self.assertTrue(result['data_comparison_passed'],result)
        self.assertEqual(result['old_counter_deltas']['xmu_mail']['failure_count'],1)
        self.assertEqual(result['health'],self.after['health'])

    def test_unexpected_failure_not_hidden(self):
        row=next(r for r in self.after['stats']['items'] if r['source']=='github')
        row['failure_count']+=1;row['historical_failure_count']+=1
        self.assertEqual(self.run_compare()['reason'],'unexpected_old_source_failure')

    def test_rollback_retains_new_audit_buckets_and_failed_history(self):
        failed=copy.deepcopy(self.after['stats'])
        self.after=copy.deepcopy(self.before)
        self.after['stats']['items']+=copy.deepcopy(failed['items'][-2:])
        result=self.run_compare(phase='closed_previous',failed_stats=failed)
        self.assertTrue(result['data_comparison_passed'],result)
        self.assertEqual(result['failed_stats'],failed)
        self.after['stats']['items'].pop()
        self.assertFalse(self.run_compare(phase='closed_previous',failed_stats=failed)['data_comparison_passed'])

    def test_rollback_failure_history_cannot_disappear(self):
        failed=copy.deepcopy(self.after['stats'])
        row=next(r for r in failed['items'] if r['source']=='xmu_mail')
        row['failure_count']+=1;row['historical_failure_count']+=1
        self.after=copy.deepcopy(self.before)
        self.after['stats']['items']+=copy.deepcopy(failed['items'][-2:])
        self.assertEqual(self.run_compare(phase='closed_previous',failed_stats=failed)['reason'],'rollback_failed_history_lost')

    def test_unknown_failed_stats_explicit_not_empty_forgery(self):
        self.after=copy.deepcopy(self.before)
        result=self.run_compare(phase='closed_previous',failed_stats=None)
        self.assertTrue(result['data_comparison_passed'],result)
        self.assertIsNone(result['failed_stats'])
        self.assertFalse(result['p_snapshot_verified'])
        self.assertFalse(self.run_compare(phase='closed_previous',failed_stats={})['data_comparison_passed'])

    def test_factory_cannot_self_extend_scope_or_grant_adoption(self):
        for mutate in ['enable','foreign','duplicate','third','selfproof']:
            with self.subTest(mutate=mutate):
                saved=copy.deepcopy(self.factory)
                if mutate=='enable':self.factory[0]['initially_enabled']=True
                elif mutate=='foreign':self.factory[0]['provider']='feishu'
                elif mutate=='duplicate':self.factory[1]=copy.deepcopy(self.factory[0])
                elif mutate=='third':self.factory.append(copy.deepcopy(self.factory[0]))
                else:self.factory[0]['p_snapshot_verified']=True
                result=self.run_compare()
                self.assertFalse(result['p_snapshot_verified'])
                if mutate!='selfproof':self.assertFalse(result['data_comparison_passed'])
                self.factory=saved

    def test_missing_identity_or_invalid_counter_rejected(self):
        for value in [None,False,-1,1.5,'0']:
            with self.subTest(value=value):
                self.after['stats']['items'][-1]['message_count']=value
                self.assertFalse(self.run_compare()['data_comparison_passed'])

    def test_quiesced_previous_does_not_require_new_registration(self):
        self.after=copy.deepcopy(self.before)
        for key in ['collectors','sources']:
            for row in self.after['controls'][key]:
                row['enabled']=False
                if row['state']=='running':row['state']='stopped'
        for row in self.after['stats']['collectors']:row['enabled']=False
        for row in self.after['runtime']['collector_ledger']['schedules']:row['enabled']=0
        self.assertTrue(self.run_compare(phase='quiesced_previous')['data_comparison_passed'])
        self.assertFalse(self.run_compare(phase='closed_previous')['data_comparison_passed'])

    def test_rollback_preserves_partial_enrollment_and_rejects_active_remnants(self):
        failed=copy.deepcopy(self.after['stats'])
        # 已登记的精两来源可保留审计行，不要求回退删集合。
        self.assertTrue(self.run_compare(phase='closed_previous',failed_stats=failed)['data_comparison_passed'])
        self.after['controls']['collectors'][-1]['enabled']=True
        self.assertEqual(self.run_compare(phase='closed_previous',failed_stats=failed)['reason'],'rollback_new_control_not_off')

    def test_quiesced_cannot_turn_original_off_on(self):
        self.after=copy.deepcopy(self.before)
        for key in ['collectors','sources']:
            for row in self.after['controls'][key]:
                row['enabled']=False
                if row['state']=='running':row['state']='stopped'
        for row in self.after['stats']['collectors']:row['enabled']=False
        for row in self.after['runtime']['collector_ledger']['schedules']:row['enabled']=0
        row=next(c for c in self.after['controls']['collectors'] if c['collector_ref']=='gmail-owner-inbox')
        row['enabled']=True
        self.assertEqual(self.run_compare(phase='quiesced_previous')['reason'],'quiesced_source_not_off')

    def test_candidate_requires_all_new_rows_in_registration_views(self):
        for section in ['controls','sources','schedules']:
            with self.subTest(section=section):
                saved=copy.deepcopy(self.after)
                if section=='controls':rows=self.after['controls']['collectors']
                elif section=='sources':rows=self.after['controls']['sources']
                elif section=='schedules':rows=self.after['runtime']['collector_ledger']['schedules']
                else:rows=self.after['stats']['collectors']
                del rows[-2:]
                self.assertFalse(self.run_compare()['data_comparison_passed'])
                self.after=saved

    def test_new_nullable_fields_cannot_be_omitted(self):
        for section,fields in [('stats',['last_collected_at','last_failure','started_at']),
                               ('schedule',['last_failure','active_operation','next_due'])]:
            for field in fields:
                with self.subTest(section=section,field=field):
                    saved=copy.deepcopy(self.after)
                    row=(self.after['stats']['collectors'] if section=='stats' else self.after['runtime']['collector_ledger']['schedules'])[-1]
                    del row[field]
                    self.assertFalse(self.run_compare()['data_comparison_passed'])
                    self.after=saved

    def test_old_collector_timestamp_cannot_be_erased(self):
        self.before['stats']['collectors'][0]['last_collected_at']='synthetic-earlier'
        self.after['stats']['collectors'][0]['last_collected_at']='synthetic-updated'
        self.assertTrue(self.run_compare()['data_comparison_passed'])
        self.after['stats']['collectors'][0]['last_collected_at']=None
        self.assertEqual(self.run_compare()['reason'],'old_collector_collection_timestamp_erased')

    def test_boolean_zero_cannot_hide_new_unknown_counts(self):
        for section,field in [('stats','intake_stop_unconfirmed_count'),('stats','current_failure_count'),
                              ('control','unresolved'),('schedule','failures')]:
            with self.subTest(section=section,field=field):
                saved=copy.deepcopy(self.after)
                rows=self.after['stats']['collectors'] if section=='stats' else self.after['controls']['collectors'] if section=='control' else self.after['runtime']['collector_ledger']['schedules']
                rows[-1][field]=False
                self.assertFalse(self.run_compare()['data_comparison_passed'])
                self.after=saved

    def test_old_owner_metadata_cannot_drift_unnoticed(self):
        self.before['stats']['items'][0]['owner_failure_count']=0
        self.after['stats']['items'][0]['owner_failure_count']=1
        self.assertEqual(self.run_compare()['reason'],'old_source_stats_metadata_changed')

    def test_rollback_retained_schedule_revision_remains_exact(self):
        failed=copy.deepcopy(self.after['stats'])
        self.after['runtime']['collector_ledger']['schedules'][-1]['config_revision']='foreign-revision'
        self.assertEqual(self.run_compare(phase='closed_previous',failed_stats=failed)['reason'],'rollback_new_schedule_not_off')

    def test_protected_json_types_cannot_change(self):
        for section,field in [('control','enabled'),('control','available'),('schedule','enabled'),('source','enabled')]:
            with self.subTest(section=section,field=field):
                saved=copy.deepcopy(self.after)
                rows=self.after['controls']['collectors'] if section=='control' else self.after['controls']['sources'] if section=='source' else self.after['runtime']['collector_ledger']['schedules']
                value=rows[0][field]
                rows[0][field]=int(value) if type(value) is bool else bool(value)
                self.assertFalse(self.run_compare()['data_comparison_passed'])
                self.after=saved

    def test_rollback_zero_fields_require_integer(self):
        for section,field in [('control','unresolved'),('stats','intake_stop_unconfirmed_count')]:
            with self.subTest(section=section,field=field):
                saved=copy.deepcopy(self.after)
                failed=copy.deepcopy(self.after['stats'])
                rows=self.after['controls']['collectors'] if section=='control' else self.after['stats']['collectors']
                rows[-1][field]=False
                self.assertFalse(self.run_compare(phase='closed_previous',failed_stats=failed)['data_comparison_passed'])
                self.after=saved

    def test_old_timestamp_requires_observed_text_or_null(self):
        for value in [False,0,{},[], '', '   ']:
            with self.subTest(value=value):
                self.after['stats']['collectors'][0]['last_collected_at']=value
                self.assertFalse(self.run_compare()['data_comparison_passed'])

    def test_rollback_present_rows_require_observed_fields(self):
        sections=[('control',['available','revision','state','unresolved']),
                  ('schedule',['config_revision','failures','next_due','active_operation','last_failure']),
                  ('stats',['available','current_failure_count','last_failure','intake_stop_unconfirmed_count','started_at','last_collected_at']),
                  ('source',['revision','collectors','enabled','state'])]
        for section,fields in sections:
            for field in fields:
                with self.subTest(section=section,field=field):
                    saved=copy.deepcopy(self.after);failed=copy.deepcopy(self.after['stats'])
                    rows=self.after['controls']['collectors'] if section=='control' else self.after['controls']['sources'] if section=='source' else self.after['stats']['collectors'] if section=='stats' else self.after['runtime']['collector_ledger']['schedules']
                    del rows[-1][field]
                    self.assertFalse(self.run_compare(phase='closed_previous',failed_stats=failed)['data_comparison_passed'])
                    self.after=saved

    def test_inputs_immutable(self):
        expected=copy.deepcopy((self.before,self.after,self.factory))
        result=self.run_compare();result['stats']['items'].clear()
        self.assertEqual((self.before,self.after,self.factory),expected)


    def test_real_health_target_subset_stays_nine_for_twelve_registrations(self):
        del self.after['stats']['collectors'][-2:]
        self.assertEqual(len(self.after['stats']['collectors']),9)
        self.assertEqual(len(self.after['runtime']['collector_ledger']['schedules']),12)
        self.assertTrue(self.run_compare()['data_comparison_passed'])

    def test_no_optional_stats_cannot_hide_new_control_or_operation(self):
        del self.after['stats']['collectors'][-2:]
        for section,field,value in [('controls','enabled',True),('controls','unresolved',1),
                                    ('schedules','active_operation','new-op'),('schedules','failures',1)]:
            with self.subTest(section=section,field=field):
                saved=copy.deepcopy(self.after)
                rows=self.after['controls']['collectors'] if section=='controls' else self.after['runtime']['collector_ledger']['schedules']
                rows[-1][field]=value
                self.assertFalse(self.run_compare()['data_comparison_passed'])
                self.after=saved

    def test_original_on_operation_drains_before_quiesced_snapshot(self):
        self.before['runtime']['collector_ledger']['schedules'][0]['active_operation']='prior-natural-op'
        self.after=copy.deepcopy(self.before)
        for row in self.after['runtime']['collector_ledger']['schedules']:
            row['enabled']=0;row['active_operation']=None
        for group in self.after['controls'].values():
            for row in group:
                row['enabled']=False
                if row['state']=='running':row['state']='stopped'
        for row in self.after['stats']['items']:row['enabled_count']=0
        for row in self.after['stats']['collectors']:row['enabled']=False
        self.assertTrue(self.run_compare(phase='quiesced_previous')['data_comparison_passed'])
        self.after['runtime']['collector_ledger']['schedules'][0]['active_operation']='not-drained'
        self.assertFalse(self.run_compare(phase='quiesced_previous')['data_comparison_passed'])

    def test_restored_original_on_can_have_new_natural_operation(self):
        self.before['runtime']['collector_ledger']['schedules'][0]['active_operation']='prior-natural-op'
        self.after['runtime']['collector_ledger']['schedules'][0]['active_operation']='next-natural-op'
        self.assertTrue(self.run_compare()['data_comparison_passed'])

    def test_original_off_operation_cannot_be_replayed(self):
        self.after['runtime']['collector_ledger']['schedules'][-3]['active_operation']='unexpected-old-off-op'
        self.assertFalse(self.run_compare()['data_comparison_passed'])

    def test_real_success_can_clear_old_current_failure_without_erasing_history(self):
        for row in self.after['stats']['items']:
            if row['source']=='weixin':row['current_failure_count']=0
        for row in self.after['stats']['collectors']:
            if row['source']=='weixin':row['current_failure_count']=0;row['last_failure']=None
        for row in self.after['runtime']['collector_ledger']['schedules']:
            if row['collector_ref']=='weixin-filehelper-7d':row['failures']=0;row['last_failure']=None
        self.assertTrue(self.run_compare()['data_comparison_passed'])
        row=next(r for r in self.after['stats']['items'] if r['source']=='weixin')
        row['historical_failure_count']-=1;row['failure_count']-=1
        self.assertFalse(self.run_compare()['data_comparison_passed'])

    def test_partial_failure_counter_lowering_is_not_a_success_reset(self):
        row=next(r for r in self.after['stats']['collectors'] if r['source']=='weixin')
        row['current_failure_count']-=1
        self.assertFalse(self.run_compare()['data_comparison_passed'])

    def test_source_aggregate_partial_lowering_is_not_a_success_reset(self):
        row=next(r for r in self.after['stats']['items'] if r['source']=='weixin')
        row['current_failure_count']-=1
        self.assertEqual(self.run_compare()['reason'],'old_source_reset_unexplained')

    def test_quiesced_previous_rejects_unregistered_new_health_target(self):
        new_stat=copy.deepcopy(self.after['stats']['collectors'][-1])
        self.after=copy.deepcopy(self.before)
        for row in self.after['runtime']['collector_ledger']['schedules']:row['enabled']=0
        for group in self.after['controls'].values():
            for row in group:
                row['enabled']=False
                if row['state']=='running':row['state']='stopped'
        for row in self.after['stats']['items']:row['enabled_count']=0
        for row in self.after['stats']['collectors']:row['enabled']=False
        self.assertTrue(self.run_compare(phase='quiesced_previous')['data_comparison_passed'])
        new_stat.update(enabled=True,current_failure_count=19,last_failure='unexpected',intake_stop_unconfirmed_count=1)
        self.after['stats']['collectors'].append(new_stat)
        self.assertEqual(self.run_compare(phase='quiesced_previous')['reason'],'previous_unregistered_stats_collector')


if __name__=='__main__':unittest.main()
