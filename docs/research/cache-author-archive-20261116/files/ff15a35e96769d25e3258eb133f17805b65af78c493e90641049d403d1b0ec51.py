"""源账真实形状的纯合成反例；不代表持锁物理/实际Core验收。"""
import copy, hashlib, importlib.util, json, os, tempfile, unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location('proof_under_test',Path(__file__).with_name('p-off-proof.py'))
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)

class JournalTests(unittest.TestCase):
    def setUp(self):
        root=Path.home()/'Library/Caches/me.longbiaochen.smart-shadow/p-off-proof-units'
        root.mkdir(parents=True,exist_ok=True,mode=0o700)
        self.temp=tempfile.TemporaryDirectory(dir=root);self.addCleanup(self.temp.cleanup)
        self.directory=Path(self.temp.name)
        self.baseline=[{'collector_ref':'on','source':'synthetic','enabled':True,'available':True,'revision':7},
                       {'collector_ref':'off','source':'synthetic-off','enabled':False,'available':True,'revision':9}]
        self.value={'schema':'smart-shadow.mail-source-transaction/v1','run_id':'synthetic-run',
            'baseline':copy.deepcopy(self.baseline),'records':[{'before':copy.deepcopy(self.baseline[0]),
                'disable_ack':True,'disable_revision':8,'disable_receipt':{'selector':{'kind':'collector','id':'on'},
                'collector_refs':['on'],'enabled':False,'revision':8},'restored':True}],
            'events':[{'event':'restore_complete','gaps':[],'actual_sources':copy.deepcopy(self.baseline)}]}

    def check(self,phase='closed_candidate'):
        dest=self.directory/'mail-source-journal-0001.json'
        raw=json.dumps(self.value).encode();dest.write_bytes(raw);dest.chmod(0o600)
        ref={'path':str(dest),'sha256':hashlib.sha256(raw).hexdigest()}
        return p.journal_proof(ref,directory=self.directory,run_id='synthetic-run',baseline=self.baseline,phase=phase)

    def test_closed_original_on_and_off_real_shape(self):
        self.assertEqual(self.check()['owned_record_count'],1)

    def test_boolean_closed_without_actual_terminal_is_not_proof(self):
        self.value['closed']=True;self.value['events'][-1]['event']='restore_incomplete'
        with self.assertRaisesRegex(RuntimeError,'terminal_event'):self.check()

    def test_foreign_run_and_baseline_never_reused(self):
        for key in ['run_id','baseline']:
            with self.subTest(key=key):
                old=copy.deepcopy(self.value);self.value[key]='foreign' if key=='run_id' else []
                with self.assertRaisesRegex(RuntimeError,'run_or_baseline'):self.check()
                self.value=old

    def test_restored_boolean_cannot_hide_old_off_on_or_missing_row(self):
        for change in ['enabled','missing']:
            with self.subTest(change=change):
                old=copy.deepcopy(self.value)
                if change=='enabled':self.value['events'][-1]['actual_sources'][1]['enabled']=True
                else:self.value['events'][-1]['actual_sources'].pop()
                with self.assertRaisesRegex(RuntimeError,'original_source_state'):self.check()
                self.value=old

    def test_unknown_disable_or_ack_revision_refuses(self):
        for change in ['ack','revision']:
            with self.subTest(change=change):
                old=copy.deepcopy(self.value)
                if change=='ack':self.value['records'][0]['disable_ack']=False
                else:self.value['records'][0]['disable_receipt']['revision']=True
                with self.assertRaises(RuntimeError):self.check()
                self.value=old

    def test_pre_source_quiet_uses_current_run_intent_ack(self):
        self.value['events']=[{'event':'quiet_verified'}]
        self.assertEqual(self.check('quiesced_previous')['terminal_event'],'quiet_verified')
        self.value['records']=[]
        with self.assertRaisesRegex(RuntimeError,'owned_records'):self.check('quiesced_previous')

    def test_reference_digest_and_parent_are_independently_checked(self):
        dest=self.directory/'mail-source-journal-0002.json';dest.write_text('{}');dest.chmod(0o600)
        with self.assertRaisesRegex(RuntimeError,'digest'):
            p.journal_proof({'path':str(dest),'sha256':'0'*64},directory=self.directory,
                           run_id='synthetic-run',baseline=self.baseline,phase='closed_previous')
        with self.assertRaisesRegex(RuntimeError,'path'):
            p.journal_proof({'path':str(dest),'sha256':hashlib.sha256(b'{}').hexdigest()},
                           directory=self.directory/'other',run_id='synthetic-run',
                           baseline=self.baseline,phase='closed_previous')

if __name__=='__main__':unittest.main()
