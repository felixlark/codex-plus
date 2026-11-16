from pathlib import Path
import subprocess,json,hashlib
r=Path(__file__).parent
ids=json.loads((r/'FAILED-NODEIDS.json').read_text())
args=['/Users/longbiao/Library/Caches/me.longbiaochen.smart-shadow/issue31-migration-test-venv/bin/python','-m','pytest','-q','-p','no:cacheprovider',*ids,'--junitxml='+str(r/'V16-MISSING-INPUTS-RECHECK.xml')]
result=subprocess.run(args)
(r/'V16-MISSING-INPUTS-RECHECK-RESULT.json').write_text(json.dumps({'returncode':result.returncode,'unique_failed_cases_rechecked':len(ids)},indent=2)+'\n')
raise SystemExit(result.returncode)
