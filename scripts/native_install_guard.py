#!/usr/bin/env python3
"""Refuse replacement while this exact standalone product still runs."""
import ctypes,subprocess,sys
from pathlib import Path
root=Path(sys.argv[1]).resolve()
if root!=Path('/Applications/Codex Plus.app'):raise SystemExit('unexpected standalone target')
r=subprocess.run(['/usr/bin/pgrep','-a','-f',str(root)],capture_output=True,text=True)
if r.returncode not in (0,1):raise SystemExit('process inventory unavailable')
lib=ctypes.CDLL('/usr/lib/libproc.dylib');lib.proc_pidpath.argtypes=[ctypes.c_int,ctypes.c_void_p,ctypes.c_uint32]
for value in r.stdout.split():
 if not value.isdecimal():raise SystemExit('invalid process inventory')
 buf=ctypes.create_string_buffer(4096)
 if lib.proc_pidpath(int(value),buf,len(buf))<=0:continue
 if Path(buf.value.decode()).is_relative_to(root):raise SystemExit('standalone product still running; preserve its unknown operations before adoption')
