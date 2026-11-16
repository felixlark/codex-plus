import importlib.util, pathlib, tempfile, unittest, os, stat, hashlib
from unittest.mock import patch
from types import SimpleNamespace
P=pathlib.Path(__file__).with_name('ss-normal-current-source.py')
spec=importlib.util.spec_from_file_location('current_source_under_test',P)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class CurrentSource(unittest.TestCase):
 def test_regular_same_fd_reference_and_bytes(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d).resolve()/'source.py';p.write_bytes(b'public source');p.chmod(0o600)
   ref,raw=m.snapshot(p,raw=True)
   self.assertEqual(raw,b'public source');self.assertEqual(ref['sha256'],hashlib.sha256(raw).hexdigest())
   self.assertEqual(ref['physical_stat']['st_ino'],str(p.stat().st_ino))
 def test_forbidden_config_never_opens(self):
  with patch.object(m.os,'open') as opened:
   with self.assertRaisesRegex(m.CurrentSourceUnavailable,'source_path_forbidden'):
    m.snapshot(pathlib.Path('/synthetic/smart-shadow.json'))
   opened.assert_not_called()
 def test_fifo_rejected_without_read(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d).resolve()/'fifo';os.mkfifo(p,0o600)
   with patch.object(m.os,'read') as read:
    with self.assertRaisesRegex(m.CurrentSourceUnavailable,'source_file_untrusted'):m.snapshot(p)
    read.assert_not_called()
 def test_unapproved_alias_rejected_and_approved_alias_bound(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d).resolve()/'real';p.write_bytes(b'code');p.chmod(0o600);a=p.with_name('alias');a.symlink_to(p)
   with self.assertRaisesRegex(m.CurrentSourceUnavailable,'source_alias_not_allowed'):m.snapshot(a)
   ref=m.snapshot(a,alias=True);self.assertEqual(ref['physical_path'],str(p));self.assertEqual(ref['path'],str(a))
 def test_writable_source_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d).resolve()/'bad';p.write_bytes(b'x');p.chmod(0o666)
   with self.assertRaisesRegex(m.CurrentSourceUnavailable,'source_file_untrusted'):m.snapshot(p)
 def test_path_swap_during_read_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d).resolve()/'source';p.write_bytes(b'a');p.chmod(0o600);original=os.read;changed=False
   def read(fd,count):
    nonlocal changed
    data=original(fd,count)
    if not changed:
     changed=True;p.rename(p.with_name('old'));p.write_bytes(b'b');p.chmod(0o600)
    return data
   with patch.object(m.os,'read',read):
    with self.assertRaisesRegex(m.CurrentSourceUnavailable,'source_file_changed'):m.snapshot(p)
 def test_api_failure_does_not_expose_stderr_or_credentials(self):
  with patch.object(m.subprocess,'run',return_value=SimpleNamespace(returncode=17,stdout=b'',stderr=b'credential-never-output')) as run:
   with self.assertRaisesRegex(m.CurrentSourceUnavailable,'metadata_get_failed:health:17') as caught:m.api_get('health')
   self.assertNotIn('credential',str(caught.exception));self.assertEqual(run.call_args.args[0],[str(m.API),'GET','/api/v2/health'])
 def test_current_match_explicitly_does_not_sign_normal_authority(self):
  value={'schema':'smart-shadow.actual-normal-current-source/v1','stable_fingerprint_sha256':'a'*64}
  with patch.object(m,'observe_current',return_value=value):r=m.verify_current_facts(value)
  self.assertTrue(r['current_facts_verified']);self.assertFalse(r['normal_authority_verified']);self.assertIsNone(r['normal_publication_operation_id'])
 def test_current_changed_rejected(self):
  value={'schema':'smart-shadow.actual-normal-current-source/v1','stable_fingerprint_sha256':'b'*64}
  with patch.object(m,'observe_current',return_value=value):
   with self.assertRaisesRegex(m.CurrentSourceUnavailable,'current_fingerprint_changed'):m.verify_current_facts({**value,'stable_fingerprint_sha256':'a'*64})
if __name__=='__main__':unittest.main()
