#!/usr/bin/env python3
"""Describe or verify the immutable standalone package, never deployment."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True
specification = importlib.util.spec_from_file_location(
    "codex_plus_compatibility_input", Path(__file__).with_name("compatibility-input.py"))
compatibility = importlib.util.module_from_spec(specification)
specification.loader.exec_module(compatibility)

def inventory(app):
    if any(path.is_symlink() for path in app.rglob("*")):
        raise ValueError("unexpected package symlink")
    return {str(path.relative_to(app)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(app.rglob("*")) if path.is_file()}

def generate(app, source, output, fields):
    info = compatibility.verify_app(app, fields)
    value = {
        "schema": "codex-plus.native-package/v1",
        "source_commit": subprocess.check_output(
            ["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip(),
        "path": "/Applications/Codex Plus.app",
        "bundle_id": info["CFBundleIdentifier"],
        "version": info["CFBundleShortVersionString"],
        "build": info["CFBundleVersion"],
        "requires": {"target_ownership": "codex-target-ownership/v1",
                     "enhancementsOwner": "codex-plus"},
        "files": inventory(app),
    }
    output.write_text(json.dumps(value, indent=2) + "\n")
    return value

def verify(app, manifest, fields):
    info = compatibility.verify_app(app, fields)
    value = json.loads(manifest.read_text())
    if (value.get("schema") != "codex-plus.native-package/v1"
            or value.get("path") != "/Applications/Codex Plus.app"
            or value.get("bundle_id") != info["CFBundleIdentifier"]
            or value.get("version") != info["CFBundleShortVersionString"]
            or value.get("build") != info["CFBundleVersion"]
            or value.get("files") != inventory(app)):
        raise ValueError("package inventory mismatch")
    return value

def main(argv=None):
    parser = compatibility._Parser(description=__doc__)
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--compatibility-input", type=Path, required=True)
    parser.add_argument("paths", type=Path, nargs="+")
    try:
        arguments = parser.parse_args(argv)
        expected_count = 2 if arguments.verify else 3
        if len(arguments.paths) != expected_count:
            raise compatibility.InputError("compatibility_arguments_invalid", "arguments")
        fields = compatibility.read_input_file(arguments.compatibility_input)
        if arguments.verify:
            verify(*arguments.paths, fields)
            print("Standalone package identity and file inventory verified")
        else:
            generate(*arguments.paths, fields)
        return 0
    except compatibility.InputError as error:
        print(str(error), file=sys.stderr)
        return 2
    except (OSError, ValueError, TypeError, subprocess.SubprocessError):
        print("package_verification_failed", file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
