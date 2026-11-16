"""本批OFF原提案/候选绑定；仅自建私有合成文件，无实际reader/来源操作。"""
import copy
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('p_input_contract_tested',Path(__file__).with_name('p-off-proof.py'))
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)

class InputContractTests(unittest.TestCase):
    def setUp(self):
        self.root=Path.home()/'Library/Caches/me.longbiaochen.smart-shadow/p-off-enrollment-tests'
        self.root.mkdir(parents=True,exist_ok=True,mode=0o700)
        temp=tempfile.TemporaryDirectory(prefix='input-',dir=self.root);self.addCleanup(temp.cleanup)
        self.directory=Path(temp.name);self.candidate='a'*40;self.target='node-18765-test-only'
        self.blocks={provider:{'enabled':True,'archive_root':'/synthetic/unused','entries':[{'account_ref':'synthetic'}]}
                     for provider in p.PROVIDERS}
        self.doc={'schema':'smart-shadow.p-off-input-contract/v1','candidate_sha':self.candidate,'target_release':self.target,'providers':{}}
        for provider,block in self.blocks.items():
            path=self.directory/(provider+'-proposal.json');self.write(path,block)
            self.doc['providers'][provider]={'path':str(path),'sha256':p.digest(path.read_bytes())}
        self.path=self.directory/'p-off-input-contract.json';self.write(self.path,self.doc)
    def write(self,path,obj):
        path.write_text(json.dumps(obj));path.chmod(0o600)
    def check(self):
        return p.input_contract(self.directory,candidate=self.candidate,target_release=self.target,target_config=self.blocks)

    def test_exact_two_off_proposals_and_candidate_bind(self):
        result=self.check();self.assertEqual(result['proposals'],self.doc['providers'])
        self.assertEqual(result['reference']['sha256'],p.digest(self.path.read_bytes()))
    def test_synthetic_registration_on_proposals_need_no_entry_control_field(self):
        # 自包含unit不读取owner配置；真实获准提案摘要另存私有绑定证据。
        for provider,block in self.blocks.items():
            self.assertIs(block['enabled'],True)
            self.assertNotIn('enabled',block['entries'][0])
        self.assertEqual(self.check()['proposals'],self.doc['providers'])

    def test_proposal_byte_drift_rejected(self):
        path=Path(self.doc['providers']['feishu_task']['path']);path.write_text('{}')
        with self.assertRaisesRegex(RuntimeError,'p_input_proposal_digest'):self.check()
    def test_target_config_must_equal_approved_proposal(self):
        self.blocks['feishu_task']['entries'][0]['account_ref']='other-synthetic'
        with self.assertRaisesRegex(RuntimeError,'p_input_config_not_approved_off'):self.check()
    def test_disabled_provider_cannot_register_off_collectors(self):
        block=self.blocks['feishu_task'];block['enabled']=False;source=Path(self.doc['providers']['feishu_task']['path']);self.write(source,block)
        self.doc['providers']['feishu_task']['sha256']=p.digest(source.read_bytes());self.write(self.path,self.doc)
        with self.assertRaisesRegex(RuntimeError,'p_input_config_not_approved_off'):self.check()
    def test_subject_and_extra_provider_are_rejected(self):
        self.doc['candidate_sha']='b'*40;self.write(self.path,self.doc)
        with self.assertRaisesRegex(RuntimeError,'p_input_subject'):self.check()
        self.doc['candidate_sha']=self.candidate;self.doc['providers']['third']={};self.write(self.path,self.doc)
        with self.assertRaisesRegex(RuntimeError,'p_input_provider_denominator'):self.check()
    def test_contract_world_readable_or_proposal_symlink_rejected(self):
        self.path.chmod(0o644)
        with self.assertRaisesRegex(RuntimeError,'p_private_file_mode'):self.check()
        self.path.chmod(0o600);source=Path(self.doc['providers']['feishu_task']['path']);target=source.with_suffix('.original');source.rename(target);source.symlink_to(target)
        with self.assertRaisesRegex(RuntimeError,'p_file_identity'):self.check()
    def test_contract_replacement_during_proposal_read_rejected(self):
        original=p.pinned;changed=False
        def drift(path,**kwargs):
            nonlocal changed
            value=original(path,**kwargs)
            if Path(path)!=self.path and not changed:
                changed=True;new=copy.deepcopy(self.doc);new['target_release']='changed-during-read';self.write(self.path,new)
            return value
        with patch.object(p,'pinned',side_effect=drift),self.assertRaisesRegex(RuntimeError,'p_input_contract_changed_during_read'):
            self.check()

if __name__=='__main__':unittest.main()
