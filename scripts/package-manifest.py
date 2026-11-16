#!/usr/bin/env python3
"""Describe or verify the immutable standalone package, never deployment."""
import hashlib,json,plistlib,subprocess,sys
from pathlib import Path

def inventory(app):
    if any(p.is_symlink() for p in app.rglob('*')): raise ValueError('unexpected package symlink')
    return {str(p.relative_to(app)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(app.rglob('*')) if p.is_file()}

def identity(app):
    info=plistlib.loads((app/'Contents/Info.plist').read_bytes())
    if info['CFBundleIdentifier']!='me.longbiaochen.codex-plus' or info['CFBundleExecutable']!='CodexPlus':raise ValueError('standalone identity mismatch')
    return info

if sys.argv[1]=='--verify':
    app,manifest=map(Path,sys.argv[2:]);info=identity(app);value=json.loads(manifest.read_text())
    if value.get('schema')!='codex-plus.native-package/v1' or value.get('path')!='/Applications/Codex Plus.app' or value.get('bundle_id')!=info['CFBundleIdentifier'] or value.get('version')!=info['CFBundleShortVersionString'] or value.get('build')!=info['CFBundleVersion'] or value.get('files')!=inventory(app):raise ValueError('package inventory mismatch')
    print('Standalone package identity and file inventory verified')
else:
    app,source,out=map(Path,sys.argv[1:]);info=identity(app)
    value={'schema':'codex-plus.native-package/v1','source_commit':subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip(),'path':'/Applications/Codex Plus.app','bundle_id':info['CFBundleIdentifier'],'version':info['CFBundleShortVersionString'],'build':info['CFBundleVersion'],'requires':{'target_ownership':'codex-target-ownership/v1','enhancementsOwner':'codex-plus'},'files':inventory(app)}
    out.write_text(json.dumps(value,indent=2)+'\n')
