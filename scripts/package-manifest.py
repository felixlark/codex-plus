#!/usr/bin/env python3
"""Describe the final signed container, without modifying any signed bytes."""
import hashlib
import json
import plistlib
import subprocess
import sys
from pathlib import Path


def describe(app: Path, source: Path) -> dict:
    helper = app / "Contents/Library/LoginItems/SmartShadowInteraction.app"
    info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
    helper_info = plistlib.loads((helper / "Contents/Info.plist").read_bytes())
    if info["CFBundleIdentifier"] != "me.longbiaochen.smart-shadow.app" or helper_info["CFBundleIdentifier"] != "me.longbiaochen.smart-shadow.interactiond":
        raise ValueError("package identity mismatch")
    return {
        "schema": "smart-shadow.native-package/v1",
        "source_commit": subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip(),
        "container": {"path": "/Applications/SmartShadow.app", "bundle_id": info["CFBundleIdentifier"], "executable": info["CFBundleExecutable"]},
        "runtime": {"bundle_path": str(helper.relative_to(app)), "bundle_id": helper_info["CFBundleIdentifier"], "executable": str((helper / "Contents/MacOS" / helper_info["CFBundleExecutable"]).relative_to(app)), "resources": str((helper / "Contents/Resources").relative_to(app)), "arguments": ["--managed-runtime"]},
        "version": helper_info["CFBundleShortVersionString"], "build": helper_info["CFBundleVersion"],
        "container_build": info["CFBundleVersion"],
        "login_item": helper_info["CFBundleIdentifier"],
        "files": {str(p.relative_to(app)): hashlib.sha256(p.read_bytes()).hexdigest()
                  for p in sorted(app.rglob("*")) if p.is_file()},
    }


if __name__ == "__main__":
    Path(sys.argv[3]).write_text(json.dumps(describe(Path(sys.argv[1]), Path(sys.argv[2])), indent=2) + "\n")
