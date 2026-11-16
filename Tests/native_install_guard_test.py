import errno
import importlib.util
import subprocess
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('native_install_guard', Path(__file__).resolve().parents[1] / 'scripts/native_install_guard.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class NativeInstallGuardTests(unittest.TestCase):
    target = Path('/Applications/SmartShadow.app')

    def test_live_main_nested_helper_and_gateway_block_but_namesake_does_not(self):
        paths = {10: str(self.target / 'Contents/MacOS/SmartShadowManager'),
                 20: str(self.target / 'Contents/Library/LoginItems/SmartShadowInteraction.app/Contents/MacOS/SmartShadowInteraction'),
                 30: str(self.target / 'Contents/Library/LoginItems/SmartShadowInteraction.app/Contents/Resources/MobileGateway'),
                 40: '/unrelated/SmartShadowManager', 50: None}
        def query(args, **kwargs):
            self.assertEqual(args[:2], ['/usr/bin/pgrep', '-f'])
            return subprocess.CompletedProcess(args, 0, '10\n20\n30\n40\n50\n')
        self.assertEqual(guard.running_package_pids(self.target, run=query, read_path=paths.__getitem__), [10, 20, 30])

    def test_no_candidates_needs_no_process_path_reads(self):
        def unexpected(pid): self.fail('no candidate must not query libproc')
        self.assertEqual(guard.running_package_pids(self.target, run=lambda *a, **kw: subprocess.CompletedProcess(a, 1, ''), read_path=unexpected), [])

    def test_census_or_path_unknown_refuses_installation(self):
        for status, output in [(2, ''), (0, 'invalid'), (0, '')]:
            with self.assertRaises(RuntimeError):
                guard.running_package_pids(self.target, run=lambda *a, **kw: subprocess.CompletedProcess(a, status, output))
        def unavailable(pid): raise OSError(errno.EPERM, 'fixture unavailable')
        with self.assertRaises(OSError):
            guard.running_package_pids(self.target, run=lambda *a, **kw: subprocess.CompletedProcess(a, 0, '10'), read_path=unavailable)


if __name__ == '__main__':
    unittest.main()
