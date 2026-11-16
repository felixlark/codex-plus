"""P Main/事务接线测试：真实函数，明确合成OS/API/proof；不作生产验收。"""
import contextlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

D=Path(__file__).parent
G=Path.home()/'Projects/smart-shadow'
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);return module
fixture=D/'fixtures/scripts/tests/test_ss_deploy_mail_main.py'
base=load('p_flow_original_fixture',fixture if fixture.exists() else G/'scripts/tests/test_ss_deploy_mail_main.py')
main=load('p_flow_private_actual_main',D/'ss-deploy-main.py')
transaction=load('p_flow_actual_transaction',D/'p-source-off-publication.py')
proof_module=load('p_flow_actual_proof_put',D/'p-off-proof.py')

class PFlowTests(unittest.TestCase):
    def setUp(self):
        self.fixture=base.Main();self.fixture.setUp();self.addCleanup(self.fixture.tearDown)
        logs=Path.home()/'Library/Logs/me.longbiaochen.smart-shadow/unit-test-fixtures'
        logs.mkdir(parents=True,exist_ok=True,mode=0o700)
        temporary=tempfile.TemporaryDirectory(prefix='p-main-flow-',dir=logs)
        self.addCleanup(temporary.cleanup);self.fixture.log=Path(temporary.name)
        self.phase_failure=None;self.helper_failure=False;self.receipt_failure=False
        self.binding_physical=[];self.restore_calls=[];self.phases=[];self.helper_physical=[]
        case=self
        class SyntheticProof:
            subject=transaction.SUBJECT
            def __init__(self,**kwargs):pass
            def verify_binding(self,**kwargs):case.binding_physical.append(case.fixture.state['physical'])
            def verify_snapshot(self,observation,*,phase,closure=None,failed_stats=None):
                case.phases.append(phase)
                if observation.get('stats') is None:raise RuntimeError('synthetic statistics unavailable')
                if phase.startswith('quiesced_'):
                    case.assertFalse(any(row['enabled'] for row in case.fixture.controls.values()))
                if phase.startswith('closed_'):
                    case.assertIsNotNone(closure)
                    case.assertEqual([row['enabled'] for row in case.fixture.controls.values()],[True,True,False])
                if phase==case.phase_failure:raise RuntimeError('synthetic snapshot gate rejection')
                return {'p_snapshot_verified':True,'synthetic_proof_only':True}
        self.synthetic=types.SimpleNamespace(POffProof=SyntheticProof,put=self.put)

    def put(self,path,payload):
        if self.receipt_failure and payload.get('status')=='p_metadata_adopted':
            raise OSError('synthetic candidate receipt write failed')
        return proof_module.put(path,payload)

    def run_flow(self,mode='normal',unknown_previous_stats=False):
        parser=main.build_parser
        def p_parser():
            result=parser();result.set_defaults(p_off_enrollment=True);return result
        original_restore=main.MailSourceTransaction.restore
        def restored(instance,*args,**kwargs):
            self.restore_calls.append(self.fixture.state['release'])
            return original_restore(instance,*args,**kwargs)
        original_api=self.fixture.api
        original_cli=self.fixture.cli
        def cli(log,holder,reason,args,**kwargs):
            result=original_cli(log,holder,reason,args,**kwargs)
            if result is not None:return result
            payload={'status':'candidate_quiesced','read_only':False,'health':'not_proven'} if args[-1]=='quiesce-switched' else {}
            return subprocess.CompletedProcess([],0,json.dumps(payload),'')
        def api(method,path,*args,**kwargs):
            if unknown_previous_stats and self.fixture.state['physical']==3 and path=='/api/v2/collector-stats':
                raise ConnectionError('synthetic previous statistics unavailable')
            return original_api(method,path,*args,**kwargs)
        def helper(*args,**kwargs):
            physical=self.fixture.state['physical'];self.helper_physical.append(physical)
            if self.helper_failure and physical==2:raise RuntimeError('synthetic helper binding mismatch')
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(base,'r',main))
            stack.enter_context(patch.object(main,'build_parser',side_effect=p_parser))
            stack.enter_context(patch.object(main,'load_p_off_components',return_value=(transaction,self.synthetic,object())))
            stack.enter_context(patch.object(main.MailSourceTransaction,'restore',restored))
            stack.enter_context(patch.object(self.fixture,'api',side_effect=api))
            stack.enter_context(patch.object(self.fixture,'cli',side_effect=cli))
            # 原fixture内也patch此方法；包住实际P事务入口后设置本测试helper反例。
            original_transaction=transaction.transaction
            def actual_transaction(**kwargs):
                kwargs['verify_helper']=helper
                return original_transaction(**kwargs)
            stack.enter_context(patch.object(transaction,'transaction',side_effect=actual_transaction))
            return self.fixture.run_main(mode)

    def receipts(self):
        return [json.loads(path.read_bytes()) for path in self.fixture.log.glob('p-off-enrollment-*.json')]

    def test_success_is_private_p_receipt_and_never_full_delivery(self):
        self.assertEqual(self.run_flow(),0)
        receipt=self.receipts()[0]
        self.assertEqual(receipt['status'],'p_metadata_adopted')
        self.assertFalse(receipt['full_release']['accepted'])
        self.assertEqual(self.fixture.verify_calls,0)
        self.assertEqual(self.fixture.actions,['switch'])
        self.assertEqual(self.restore_calls,['candidate-fixture'])
        self.assertFalse(list(self.fixture.log.glob('github-delivery-receipt-*.json')))

    def test_quiesced_candidate_gate_failure_compensates_once(self):
        self.phase_failure='quiesced_candidate'
        self.assertEqual(self.run_flow(),2)
        self.assertEqual(self.receipts()[0]['status'],'p_enrollment_rolled_back')
        self.assertEqual(self.fixture.actions,['switch','quiesce-switched','restore-switched-previous'])
        self.assertEqual(self.restore_calls,['previous-fixture'])
        self.assertNotIn(3,self.binding_physical)

    def test_closed_candidate_gate_failure_requiesces_and_preserves_new_data(self):
        self.phase_failure='closed_candidate'
        self.assertEqual(self.run_flow(),2)
        self.assertEqual(self.restore_calls,['candidate-fixture','previous-fixture'])
        self.assertEqual(self.fixture.state['seq'],2010)
        self.assertEqual(self.fixture.actions.count('restore-switched-previous'),1)

    def test_bad_candidate_helper_cannot_block_previous_verification(self):
        self.helper_failure=True
        self.assertEqual(self.run_flow(),2)
        self.assertEqual(self.receipts()[0]['status'],'p_enrollment_rolled_back')
        self.assertNotIn(3,self.helper_physical)

    def test_candidate_receipt_io_failure_enters_compensation(self):
        self.receipt_failure=True
        self.assertEqual(self.run_flow(),2)
        self.assertEqual(self.receipts()[0]['status'],'p_enrollment_rolled_back')
        self.assertEqual(self.fixture.actions.count('restore-switched-previous'),1)

    def test_unknown_previous_stats_restores_safe_sources_but_never_repeats_close(self):
        self.phase_failure='quiesced_candidate'
        self.assertEqual(self.run_flow(unknown_previous_stats=True),1)
        self.assertEqual(self.restore_calls,['previous-fixture'])
        self.assertFalse(self.receipts())
        evidence=json.loads(next(self.fixture.log.glob('p-off-compensation-unknown-*.json')).read_bytes())
        self.assertIsNone(evidence['rollback_stats'])
        self.assertEqual(self.fixture.actions.count('restore-switched-previous'),1)

    def test_known_wrong_previous_with_unknown_stats_never_restores_sources(self):
        self.phase_failure='quiesced_candidate'
        self.assertEqual(self.run_flow('previous_release_bad',unknown_previous_stats=True),1)
        self.assertEqual(self.restore_calls,[])
        self.assertFalse(any(row['enabled'] for row in self.fixture.controls.values()))
        self.assertFalse(self.receipts())

if __name__=='__main__':unittest.main()
