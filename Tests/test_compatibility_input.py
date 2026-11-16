import copy
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]


def load_script(name, filename):
    specification = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


compatibility = load_script("test_compatibility", "compatibility-input.py")
manifest = load_script("test_manifest", "package-manifest.py")


def fixture():
    return {"version": 1, "selfBundleID": "test.compat.legacy.plus", "selfTeamID": "A1B2C3D4E5",
            "enhancementDomain": "test.compat.legacy.enhancements", "legacyDomain": "test.compat.legacy.plus",
            "authorityBundleID": "test.compat.authority", "authorityTeamID": "F6G7H8J9K0",
            "smartShadowBundleID": "test.compat.smart-shadow"}


def framed(executable, text, architecture=None):
    suffix = f" (architecture {architecture})" if architecture else ""
    return f"{executable}{suffix}:\n{text}\n"


def header(executable, architecture=None):
    return framed(executable, "Mach header\nmagic cputype cpusubtype caps filetype ncmds sizeofcmds flags\n"
                  "0xfeedfacf 1 2 3 4 5 6 7", architecture)


def section(executable, info, architecture=None):
    return framed(executable, "(__TEXT,__info_plist) section\n"
                  + plistlib.dumps(info).decode(), architecture)


class CompatibilityInputTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="codex-plus-identity-test-")
        self.directory = Path(self.temporary.name)
        self.fields = fixture()

    def tearDown(self):
        self.temporary.cleanup()

    def input_file(self, value=None):
        path = self.directory / "input.json"
        path.write_text(json.dumps(self.fields if value is None else value))
        path.chmod(0o600)
        return path

    def fake_app(self, fields=None):
        fields = self.fields if fields is None else fields
        app = self.directory / "Fixture.app"
        (app / "Contents/MacOS").mkdir(parents=True, exist_ok=True)
        info = {"CFBundleIdentifier": fields["selfBundleID"], "CFBundleExecutable": "CodexPlus",
                "CFBundleVersion": "1", "CFBundleShortVersionString": "1.0",
                compatibility.INFO_KEY: fields}
        (app / "Contents/Info.plist").write_bytes(plistlib.dumps(info))
        (app / "Contents/MacOS/CodexPlus").write_bytes(b"synthetic executable")
        return app, info

    def test_strict_json_schema_and_no_partial_fallback(self):
        self.assertEqual(compatibility.parse_input_bytes(json.dumps(self.fields).encode()), self.fields)
        for key in self.fields:
            invalid = dict(self.fields)
            del invalid[key]
            with self.subTest(key=key), self.assertRaises(compatibility.InputError):
                compatibility.validate_dictionary(invalid)
        for value in [True, 1.0, "1", None]:
            invalid = dict(self.fields, version=value)
            with self.assertRaises(compatibility.InputError):
                compatibility.validate_dictionary(invalid)
        for value in [[], {}, None, {"version": 1, **self.fields, "extra": "value"}]:
            with self.assertRaises(compatibility.InputError):
                compatibility.validate_dictionary(value)
        duplicate = json.dumps(self.fields)[:-1] + ', "version": 1}'
        with self.assertRaises(compatibility.InputError):
            compatibility.parse_input_bytes(duplicate.encode())
        with self.assertRaises(compatibility.InputError):
            compatibility.parse_input_bytes(b"\xff")

    def test_invalid_values_and_collisions(self):
        for value in ["", "white space", 'test.quote"', "test.line\n", "test.\\path", "test.*", "test.中文", 1, True, None]:
            with self.subTest(value=value), self.assertRaises(compatibility.InputError):
                compatibility.validate_dictionary(dict(self.fields, selfBundleID=value))
        for value in ["", "*", "short", "a1b2c3d4e5", "A1B2C3D4E5\n"]:
            with self.assertRaises(compatibility.InputError):
                compatibility.validate_dictionary(dict(self.fields, authorityTeamID=value))
        for key in ["authorityBundleID", "smartShadowBundleID"]:
            with self.assertRaises(compatibility.InputError):
                compatibility.validate_dictionary(dict(self.fields, **{key: self.fields["selfBundleID"]}))
        with self.assertRaises(compatibility.InputError):
            compatibility.validate_dictionary(dict(self.fields, legacyDomain=self.fields["enhancementDomain"]))
        compatibility.validate_dictionary(dict(self.fields, authorityTeamID=self.fields["selfTeamID"]))
        compatibility.validate_dictionary(dict(self.fields, selfBundleID="com.openai.codex"))

    def test_explicit_file_privacy_and_location_rules(self):
        path = self.input_file()
        self.assertEqual(compatibility.read_input_file(path), self.fields)
        path.chmod(0o644)
        with self.assertRaises(compatibility.InputError):
            compatibility.read_input_file(path)
        path.chmod(0o600)
        alias = self.directory / "alias.json"
        alias.symlink_to(path)
        for invalid in [alias, Path("relative.json"), self.directory, self.directory / "missing.json",
                        ROOT / "private.json", Path.home() / "Documents/private.json"]:
            with self.subTest(path=invalid.name), self.assertRaises(compatibility.InputError):
                compatibility.read_input_file(invalid)

    def test_render_and_content_addressed_cache(self):
        template = (ROOT / "AppInfo.plist").read_bytes()
        original = plistlib.loads(template)
        rendered = plistlib.loads(compatibility.render_info(template, self.fields))
        self.assertEqual(rendered["CFBundleIdentifier"], self.fields["selfBundleID"])
        self.assertEqual(rendered.pop(compatibility.INFO_KEY), self.fields)
        rendered["CFBundleIdentifier"] = original["CFBundleIdentifier"]
        self.assertEqual(rendered, original)
        path = self.input_file()
        cache = self.directory / "cache"
        output = compatibility.render_cached(path, ROOT / "AppInfo.plist", cache)
        self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(output.parent.stat().st_mode), 0o700)
        path.write_text(json.dumps(dict(reversed(list(self.fields.items()))), indent=4))
        self.assertEqual(compatibility.render_cached(path, ROOT / "AppInfo.plist", cache), output)
        path.write_text(json.dumps(dict(self.fields, selfTeamID="Z9Y8X7W6V5")))
        self.assertNotEqual(compatibility.render_cached(path, ROOT / "AppInfo.plist", cache), output)
        output.write_bytes(b"tampered")
        path.write_text(json.dumps(self.fields))
        with self.assertRaises(compatibility.VerificationError):
            compatibility.render_cached(path, ROOT / "AppInfo.plist", cache)

    def test_otool_reads_every_reported_slice(self):
        executable = self.directory / "CodexPlus"
        info = {"value": "fixture"}
        headers = header(executable, "arm64") + header(executable, "x86_64")
        sections = section(executable, info, "arm64") + section(executable, info, "x86_64")
        self.assertEqual(compatibility.parse_otool_infos(headers, sections, executable),
                         {"arm64": info, "x86_64": info})
        self.assertEqual(compatibility.parse_otool_infos(header(executable), section(executable, info), executable),
                         {"thin": info})
        for invalid in [section(executable, info, "arm64"), sections + section(executable, info, "arm64"),
                        framed(executable, "", "arm64"), sections + "unexpected"]:
            with self.assertRaises(compatibility.VerificationError):
                compatibility.parse_otool_infos(headers, invalid, executable)
        with self.assertRaises(compatibility.VerificationError):
            compatibility.parse_otool_infos(headers, sections.replace("<dict>", "<bad>"), executable)
        with self.assertRaises(compatibility.VerificationError):
            compatibility.parse_otool_infos("", "", executable)

    def test_otool_failures_and_missing_section_are_not_success(self):
        executable = self.directory / "CodexPlus"
        executable.write_bytes(b"fixture")
        for result in [subprocess.CompletedProcess([], 1, "", ""),
                       subprocess.CompletedProcess([], 0, "", "diagnostic"),
                       subprocess.CompletedProcess([], 0, header(executable), "")]:
            with patch.object(compatibility.subprocess, "run", return_value=result):
                with self.assertRaises(compatibility.VerificationError):
                    compatibility.read_embedded_infos(executable)
        with patch.object(compatibility.subprocess, "run", side_effect=OSError):
            with self.assertRaises(compatibility.VerificationError):
                compatibility.read_embedded_infos(executable)

    def test_candidate_cannot_supply_its_own_expected_identity(self):
        app, info = self.fake_app()
        with patch.object(compatibility, "read_embedded_infos", return_value={"thin": info}):
            self.assertEqual(compatibility.verify_app(app, self.fields), info)
            for key, value in [("selfTeamID", "Z9Y8X7W6V5"),
                               ("authorityTeamID", "Z9Y8X7W6V5"),
                               ("enhancementDomain", "test.forged.preferences")]:
                forged = dict(self.fields, **{key: value})
                with self.assertRaises(compatibility.VerificationError):
                    compatibility.verify_app(app, forged)
            changed = copy.deepcopy(info)
            changed[compatibility.INFO_KEY]["authorityTeamID"] = "Z9Y8X7W6V5"
            with patch.object(compatibility, "read_embedded_infos", return_value={"thin": changed}):
                with self.assertRaises(compatibility.VerificationError):
                    compatibility.verify_app(app, self.fields)

    def test_manifest_preserves_inventory_and_independent_expected_input(self):
        app, info = self.fake_app()
        output = self.directory / "package.json"
        with patch.object(manifest.compatibility, "read_embedded_infos", return_value={"thin": info}):
            generated = manifest.generate(app, ROOT, output, self.fields)
            self.assertEqual(generated["schema"], "codex-plus.native-package/v1")
            self.assertEqual(len(generated["files"]), 2)
            manifest.verify(app, output, self.fields)
            for key in ["schema", "path", "bundle_id", "version", "build", "files"]:
                invalid = dict(generated, **{key: None})
                output.write_text(json.dumps(invalid))
                with self.subTest(key=key), self.assertRaises(ValueError):
                    manifest.verify(app, output, self.fields)

    def test_build_and_install_early_failures_have_no_effects(self):
        tools = self.directory / "bin"
        tools.mkdir()
        sentinel = self.directory / "effect"
        for name in ["swift", "codesign", "ditto", "mkdir", "mv", "rmdir"]:
            path = tools / name
            path.write_text('#!/bin/sh\nprintf touched >> "$SENTINEL"\nexit 97\n')
            path.chmod(0o700)
        environment = dict(os.environ, PATH=str(tools) + ":" + os.environ["PATH"],
                           SENTINEL=str(sentinel), PYTHONDONTWRITEBYTECODE="1")
        environment.pop("CSC_NAME", None)
        profile = self.input_file()
        cases = [("build", []), ("build", ["--compatibility-input", str(profile)]),
                 ("install", []), ("install", ["--compatibility-input", str(profile), "/relative/not-an-app"])]
        for script, arguments in cases:
            result = subprocess.run(["/bin/bash", str(ROOT / "scripts" / script), *arguments],
                                    env=environment, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(sentinel.exists())
        environment["CSC_NAME"] = "-"
        result = subprocess.run(["/bin/bash", str(ROOT / "scripts/build"),
                                 "--compatibility-input", str(profile)],
                                env=environment, capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertFalse(sentinel.exists())

    def test_source_consumers_keep_their_security_and_storage_contract(self):
        client = (ROOT / "Sources/CodexPlus/HostOwnershipClient.swift").read_text()
        self.assertEqual(client.count("SecCodeCheckValidity(code, [], requirement)"), 2)
        self.assertEqual(client.count("CodexPlusIdentity.current.authorityRequirement()"), 2)
        self.assertIn('identifier \\"com.openai.codex\\"', client)
        self.assertIn("2DC432GLL2", client)
        main = (ROOT / "Sources/CodexPlus/CodexPlusApp.swift").read_text()
        guard = main.index("CodexPlusIdentity.current.requireOperational()")
        for operation in ["LifecycleCommand.run(args)", 'args.first?.hasPrefix("--tool-")',
                          'args == ["--status"]', "createDirectory(at: EnhancementPaths.root"]:
            self.assertLess(guard, main.index(operation))
        build = (ROOT / "scripts/build").read_text()
        self.assertEqual(build.count('CODEX_PLUS_LINK_INFO_PLIST="$SELECTED_INFO" swift build'), 2)
        self.assertIn('cp "$SELECTED_INFO" "$APP/Contents/Info.plist"', build)
        self.assertIn('-R="$EXPECTED_REQUIREMENT"', build)
        install = (ROOT / "scripts/install").read_text()
        self.assertEqual(install.count('-R="$EXPECTED_REQUIREMENT"'), 3)
        identity = (ROOT / "Sources/CodexPlusCore/CodexPlusIdentity.swift").read_text()
        self.assertNotIn("ProcessInfo", identity)
        self.assertNotIn("contentsOf", identity)
        self.assertNotIn("UserDefaults(", identity)
        guide = (ROOT / "docs/compatibility-input.md").read_text()
        self.assertIn("--compatibility-input", guide)
        self.assertIn("CSC_NAME", guide)

    def test_package_manifest_rejects_special_linker_input(self):
        fifo = self.directory / "input.fifo"
        os.mkfifo(fifo, 0o600)
        for path in [Path("/dev/null"), fifo]:
            environment = dict(os.environ, CODEX_PLUS_LINK_INFO_PLIST=str(path))
            result = subprocess.run(
                ["swift", "package", "--scratch-path", str(self.directory / "manifest-scratch"),
                 "--cache-path", str(self.directory / "manifest-cache"), "dump-package"],
                cwd=ROOT, env=environment, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Invalid Codex Plus linker metadata", result.stderr)


if __name__ == "__main__":
    unittest.main()
