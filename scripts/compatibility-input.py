#!/usr/bin/env python3
'''Explicit build metadata for source-only Codex Plus compatibility checks.'''
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import stat
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
REPO_ROOT = Path(__file__).resolve().parents[1]
INFO_KEY = 'CodexPlusCompatibility'
PUBLIC_BUNDLE = 'io.github.felixlark.codex-plus'
STRING_KEYS = ('selfBundleID', 'selfTeamID', 'enhancementDomain', 'legacyDomain',
               'authorityBundleID', 'authorityTeamID', 'smartShadowBundleID')
KEYS = frozenset(('version', *STRING_KEYS))
NAME_PATTERN = re.compile(r'[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+', re.ASCII)
TEAM_PATTERN = re.compile(r'[A-Z0-9]{10}', re.ASCII)


class CompatibilityError(ValueError):
    def __init__(self, code, field=''):
        self.code, self.field = code, field
        super().__init__(code + (':' + field if field else ''))


class InputError(CompatibilityError):
    pass


class VerificationError(CompatibilityError):
    pass


def validate_dictionary(value):
    if type(value) is not dict or set(value) != KEYS:
        raise InputError('compatibility_input_invalid', 'keys')
    if type(value['version']) is not int or value['version'] != 1:
        raise InputError('compatibility_input_invalid', 'version')
    for key in STRING_KEYS:
        item = value[key]
        pattern = TEAM_PATTERN if key.endswith('TeamID') else NAME_PATTERN
        if type(item) is not str or pattern.fullmatch(item) is None:
            raise InputError('compatibility_input_invalid', key)
    if len({value[k] for k in ('selfBundleID', 'authorityBundleID', 'smartShadowBundleID')}) != 3:
        raise InputError('compatibility_input_invalid', 'bundleIDs')
    if value['enhancementDomain'] == value['legacyDomain']:
        raise InputError('compatibility_input_invalid', 'preferenceDomains')
    return dict(value)


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise InputError('compatibility_input_invalid', 'keys')
        result[key] = value
    return result


def parse_input_bytes(data):
    try:
        text = data.decode('utf-8', errors='strict')
        value = json.loads(text, object_pairs_hook=_unique_object)
    except InputError:
        raise
    except (UnicodeError, ValueError, TypeError, RecursionError):
        raise InputError('compatibility_input_invalid', 'json') from None
    return validate_dictionary(value)


def _inside(path, directory):
    candidate, root = str(path.resolve()).casefold(), str(directory.resolve()).casefold()
    return os.path.commonpath((candidate, root)) == root


def _outside_private_locations(path, field):
    if _inside(path, REPO_ROOT) or _inside(path, Path.home() / 'Documents'):
        raise InputError('compatibility_location_invalid', field)


def read_input_file(path):
    path = Path(path)
    if not path.is_absolute():
        raise InputError('compatibility_input_file_invalid', 'input')
    _outside_private_locations(path, 'input')
    try:
        attributes = path.lstat()
    except OSError:
        raise InputError('compatibility_input_file_invalid', 'input') from None
    if (not stat.S_ISREG(attributes.st_mode) or path.is_symlink()
            or attributes.st_uid != os.getuid() or stat.S_IMODE(attributes.st_mode) != 0o600):
        raise InputError('compatibility_input_file_invalid', 'input')
    return parse_input_bytes(path.read_bytes())


def render_info(template_bytes, fields):
    fields = validate_dictionary(fields)
    try:
        info = plistlib.loads(template_bytes)
    except Exception:
        raise InputError('template_identity', 'template') from None
    if (type(info) is not dict or info.get('CFBundleIdentifier') != PUBLIC_BUNDLE
            or INFO_KEY in info):
        raise InputError('template_identity', 'template')
    info['CFBundleIdentifier'] = fields['selfBundleID']
    info[INFO_KEY] = fields
    return plistlib.dumps(info, fmt=plistlib.FMT_XML, sort_keys=True)


def _cache_directory(path):
    if path.is_symlink():
        raise InputError('compatibility_cache_invalid', 'cacheRoot')
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    attributes = path.stat()
    if not path.is_dir() or attributes.st_uid != os.getuid():
        raise InputError('compatibility_cache_invalid', 'cacheRoot')
    path.chmod(0o700)


def render_cached(input_path, template_path, cache_root):
    fields = read_input_file(input_path)
    template, cache = Path(template_path), Path(cache_root)
    if (not template.is_absolute() or template.is_symlink()
            or template.resolve() != (REPO_ROOT / 'AppInfo.plist').resolve()):
        raise InputError('template_identity', 'template')
    if not cache.is_absolute():
        raise InputError('compatibility_location_invalid', 'cacheRoot')
    _outside_private_locations(cache, 'cacheRoot')
    data = render_info(template.read_bytes(), fields)
    _cache_directory(cache)
    directory = cache / hashlib.sha256(data).hexdigest()
    _cache_directory(directory)
    output = directory / 'AppInfo.plist'

    def require_existing():
        attributes = output.lstat()
        if (output.is_symlink() or not stat.S_ISREG(attributes.st_mode)
                or attributes.st_uid != os.getuid() or stat.S_IMODE(attributes.st_mode) != 0o600
                or output.read_bytes() != data):
            raise VerificationError('compatibility_cache_mismatch', 'info')

    if output.exists() or output.is_symlink():
        require_existing()
        return output
    descriptor, temporary = tempfile.mkstemp(prefix='.AppInfo-', dir=directory)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, output)
        except FileExistsError:
            require_existing()
    finally:
        Path(temporary).unlink(missing_ok=True)
    return output


def requirement(bundle_id, team_id):
    if (type(bundle_id) is not str or NAME_PATTERN.fullmatch(bundle_id) is None
            or type(team_id) is not str or TEAM_PATTERN.fullmatch(team_id) is None):
        raise InputError('compatibility_input_invalid', 'requirement')
    return f'anchor apple generic and identifier "{bundle_id}" and certificate leaf[subject.OU] = "{team_id}"'


def _framed_blocks(output, executable_path):
    escaped = re.escape(str(executable_path))
    frame = re.compile(r'^' + escaped + r'(?: \(architecture ([^\r\n)]+)\))?:$')
    blocks, key, lines = {}, None, []
    found = False
    for line in output.splitlines():
        match = frame.fullmatch(line)
        if match:
            if found:
                blocks[key] = '\n'.join(lines)
            elif any(part.strip() for part in lines):
                raise VerificationError('embedded_info_invalid', 'framing')
            key = match.group(1) or 'thin'
            if key in blocks:
                raise VerificationError('embedded_info_invalid', 'duplicateSlice')
            lines, found = [], True
        else:
            lines.append(line)
    if not found:
        raise VerificationError('embedded_info_invalid', 'slices')
    if key in blocks:
        raise VerificationError('embedded_info_invalid', 'duplicateSlice')
    blocks[key] = '\n'.join(lines)
    if 'thin' in blocks and len(blocks) != 1:
        raise VerificationError('embedded_info_invalid', 'framing')
    return blocks


def parse_otool_infos(header_output, plist_output, executable_path):
    executable_path = Path(executable_path)
    if not executable_path.is_absolute():
        raise VerificationError('embedded_info_invalid', 'executable')
    headers = _framed_blocks(header_output, executable_path)
    sections = _framed_blocks(plist_output, executable_path)
    if set(headers) != set(sections):
        raise VerificationError('embedded_info_invalid', 'slices')
    result = {}
    for architecture, block in headers.items():
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if (len(lines) != 3 or lines[0] != 'Mach header' or not lines[1].startswith('magic ')
                or not lines[2].startswith('0x')):
            raise VerificationError('embedded_info_invalid', 'machHeader')
        section = sections[architecture].strip()
        marker = '(__TEXT,__info_plist) section'
        if not section.startswith(marker + '\n'):
            raise VerificationError('embedded_info_invalid', 'section')
        xml = section[len(marker):].strip()
        try:
            info = plistlib.loads(xml.encode('utf-8'))
        except Exception:
            raise VerificationError('embedded_info_invalid', 'plist') from None
        if type(info) is not dict:
            raise VerificationError('embedded_info_invalid', 'plist')
        result[architecture] = info
    return result


def read_embedded_infos(executable_path):
    executable = Path(executable_path)
    if not executable.is_absolute() or executable.is_symlink() or not executable.is_file():
        raise VerificationError('embedded_info_invalid', 'executable')
    outputs = []
    for flag in ('-h', '-P'):
        try:
            result = subprocess.run(['/usr/bin/otool', '-arch', 'all', flag, str(executable)],
                                    capture_output=True, text=True, encoding='utf-8')
        except (OSError, UnicodeError):
            raise VerificationError('embedded_info_invalid', 'otool') from None
        if result.returncode != 0 or result.stderr.strip():
            raise VerificationError('embedded_info_invalid', 'otool')
        outputs.append(result.stdout)
    return parse_otool_infos(*outputs, executable)


def verify_app(app, fields):
    fields = validate_dictionary(fields)
    app = Path(app)
    if app.is_symlink() or not app.is_dir() or any(path.is_symlink() for path in app.rglob('*')):
        raise VerificationError('package_identity_invalid', 'app')
    try:
        info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    except Exception:
        raise VerificationError('package_identity_invalid', 'info') from None
    if (type(info) is not dict or info.get('CFBundleIdentifier') != fields['selfBundleID']
            or info.get('CFBundleExecutable') != 'CodexPlus'
            or 'CFBundleShortVersionString' not in info or 'CFBundleVersion' not in info):
        raise VerificationError('package_identity_invalid', 'info')
    try:
        selected = validate_dictionary(info.get(INFO_KEY))
    except InputError:
        raise VerificationError('package_identity_invalid', 'compatibility') from None
    if selected != fields:
        raise VerificationError('package_identity_invalid', 'compatibility')
    expected = plistlib.dumps(info, sort_keys=True)
    embedded = read_embedded_infos(app / 'Contents/MacOS/CodexPlus')
    for candidate in embedded.values():
        try:
            validate_dictionary(candidate.get(INFO_KEY))
            same = plistlib.dumps(candidate, sort_keys=True) == expected
        except Exception:
            raise VerificationError('package_identity_invalid', 'embeddedInfo') from None
        if not same:
            raise VerificationError('package_identity_invalid', 'embeddedInfo')
    return info


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise InputError('compatibility_arguments_invalid', 'arguments')


def main(argv=None):
    parser = _Parser(description=__doc__)
    subcommands = parser.add_subparsers(dest='operation', required=True)
    render = subcommands.add_parser('render')
    render.add_argument('--input', required=True, type=Path)
    render.add_argument('--template', required=True, type=Path)
    render.add_argument('--cache-root', required=True, type=Path)
    verify = subcommands.add_parser('verify-app')
    verify.add_argument('--input', required=True, type=Path)
    verify.add_argument('--app', required=True, type=Path)
    trust = subcommands.add_parser('requirement')
    trust.add_argument('--input', required=True, type=Path)
    try:
        args = parser.parse_args(argv)
        if args.operation == 'render':
            print(render_cached(args.input, args.template, args.cache_root))
        elif args.operation == 'requirement':
            fields = read_input_file(args.input)
            print(requirement(fields['selfBundleID'], fields['selfTeamID']))
        else:
            verify_app(args.app, read_input_file(args.input))
        return 0
    except InputError as error:
        print(str(error), file=sys.stderr)
        return 2
    except CompatibilityError as error:
        print(str(error), file=sys.stderr)
        return 1
    except (OSError, ValueError, TypeError):
        print('compatibility_io_error:file', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
