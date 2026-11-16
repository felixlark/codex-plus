"""Read only the installed package's candidate processes; never signal them."""
import ctypes
import errno
import re
import subprocess
from pathlib import Path


def process_path(pid):
    lib = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
    lib.proc_pidpath.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
    lib.proc_pidpath.restype = ctypes.c_int
    # PROC_PIDPATHINFO_MAXSIZE from the public macOS libproc/proc_info headers.
    buffer = ctypes.create_string_buffer(4096)
    ctypes.set_errno(0)
    size = lib.proc_pidpath(pid, buffer, len(buffer))
    if size <= 0:
        code = ctypes.get_errno()
        if code == errno.ESRCH:
            return None  # The listed process has already exited.
        raise OSError(code, 'installed package process path unavailable')
    return buffer.value.decode('utf-8')


def running_package_pids(target, *, run=subprocess.run, read_path=process_path):
    # Match known executable basenames even when argv[0] is not an absolute path.
    # libproc then verifies the real executable, excluding namesakes/argv matches.
    pattern = r'(^|/)(SmartShadowManager|SmartShadowInteraction|MobileGateway)( |$)'
    result = run(['/usr/bin/pgrep', '-f', pattern], capture_output=True, text=True)
    if result.returncode == 1 and not result.stdout.strip():
        return []
    if result.returncode != 0:
        raise RuntimeError('installed package process census unavailable')
    rows = result.stdout.split()
    if not rows or any(not re.fullmatch(r'[1-9][0-9]*', row) for row in rows):
        raise RuntimeError('installed package process census invalid')
    prefix = str(Path(target)) + '/Contents/'
    active = []
    for pid in sorted({int(row) for row in rows}):
        path = read_path(pid)
        if path is not None and path.startswith(prefix):
            active.append(pid)
    return active
