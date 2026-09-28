#!/usr/bin/env python3
"""CREATE's H5P release tooling. Python 3.10+ and curl; no Python packages."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.parse
import zipfile
import io

ROOT = Path(__file__).resolve().parents[2]
LIBS = 'routes/create/h5p-libs'
MANIFEST = 'routes/create/config/h5p-runtime-manifest.json'
LOCK = 'routes/create/config/h5p-library-lock.json'
POLICY = 'routes/create/config/h5p-maintenance-policy.json'
HUB = 'https://hub-api.h5p.org/v1/content-types/'
NAME = re.compile(r'^[A-Za-z][A-Za-z0-9_.]*$')
DIR = re.compile(r'^[A-Za-z][A-Za-z0-9_.]*-\d+\.\d+$')
MAX_DOWNLOAD = 100 * 1024 * 1024
MAX_EXPANDED = 400 * 1024 * 1024
DEPENDENCIES = ('preloadedDependencies', 'editorDependencies', 'dynamicDependencies')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def normalize_text(data):
    if b'\x00' not in data:
        try:
            data.decode('utf8')
            return data.replace(b'\r\n', b'\n')
        except UnicodeDecodeError:
            pass
    return data


def read_json(file):
    return json.loads(Path(file).read_text())


def write_json(file, data):
    file = Path(file)
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')


def version(d):
    fields = [d.get(k) for k in ('majorVersion', 'minorVersion', 'patchVersion')]
    if any(type(v) is not int or v < 0 for v in fields):
        raise ValueError('Invalid library version')
    return tuple(fields)


def directory(d):
    if not NAME.fullmatch(d.get('machineName', '')):
        raise ValueError('Invalid machineName')
    v = version(d)
    return f"{d['machineName']}-{v[0]}.{v[1]}"


def files(root, normalize=False):
    result = {}
    for p in sorted(Path(root).rglob('*')):
        if any(part in ('.git', 'node_modules', '.DS_Store') for part in p.relative_to(root).parts):
            continue
        if p.is_symlink():
            raise ValueError(f'Symlink is not supported: {p}')
        if p.name.endswith('.d.ts'):
            continue  # Generated type declarations are not browser runtime assets.
        if p.is_file():
            data = p.read_bytes()
            if normalize:
                data = normalize_text(data)
            result[p.relative_to(root).as_posix()] = sha(data)
    return result


def digest(root):
    return sha(json.dumps(files(root, normalize=True), sort_keys=True).encode())


def safe_file(root, relative):
    p = PurePosixPath(relative)
    if p.is_absolute() or '..' in p.parts or '\\' in relative or not relative:
        raise ValueError(f'Unsafe relative path: {relative}')
    target = Path(root).joinpath(*p.parts)
    if not target.resolve().is_relative_to(Path(root).resolve()):
        raise ValueError(f'Path escapes library: {relative}')
    return target


def scan(root):
    root = Path(root)
    core = tuple(map(int, read_json(root / MANIFEST)['coreApi'].split('.')))
    entries = {}
    for folder in sorted((root / LIBS).iterdir()):
        if not folder.is_dir() or not DIR.fullmatch(folder.name):
            continue
        if folder.is_symlink():
            raise ValueError(f'Symlink library: {folder.name}')
        d = read_json(folder / 'library.json')
        if directory(d) != folder.name:
            raise ValueError(f'Library directory/descriptor mismatch: {folder.name}')
        problems = []
        required = d.get('coreApi', {})
        if (required.get('majorVersion', 0), required.get('minorVersion', 0)) > core:
            problems.append('requires newer core')
        for asset in d.get('preloadedJs', []) + d.get('preloadedCss', []):
            p = safe_file(folder, asset['path'])
            if not p.is_file():
                problems.append(f"missing asset: {asset['path']}")
                continue
            if p.suffix == '.css':
                css = re.sub(r'/\*[\s\S]*?\*/', '', p.read_text(errors='replace'))
                for ref in re.findall(r'url\(\s*[\'"]?([^\'"\s)]+)', css):
                    if re.match(r'^(?:data:|https?:|//|#)', ref):
                        continue
                    target = (p.parent / re.split(r'[?#]', ref)[0]).resolve()
                    if not target.is_relative_to(folder.resolve()) or not target.is_file():
                        problems.append(f'missing/unsafe CSS asset: {asset["path"]} -> {ref}')
        deps = []
        for kind in DEPENDENCIES:
            for dep in d.get(kind, []):
                key = directory({**dep, 'patchVersion': 0})
                deps.append(key)
                if not (root / LIBS / key / 'library.json').is_file():
                    problems.append(f'missing dependency: {key}')
        entries[folder.name] = {
            'machineName': d['machineName'], 'version': '.'.join(map(str, version(d))),
            'runnable': bool(d.get('runnable')), 'coreApi': required or None,
            'dependencies': sorted(set(deps)), 'sha256': digest(folder),
            'problems': sorted(set(problems))
        }
    runtime = {name: digest(root / 'routes/create' / name) for name in ('h5p-core', 'h5p-editor-core')
               if (root / 'routes/create' / name).is_dir()}
    return {'schemaVersion': 1, 'coreApi': '.'.join(map(str, core)), 'runtimeSha256': runtime, 'libraries': entries}


def closure(entries, key):
    seen, todo = set(), [key]
    while todo:
        item = todo.pop()
        if item in seen:
            continue
        seen.add(item)
        todo.extend(entries.get(item, {}).get('dependencies', []))
    return seen


def problems(snapshot):
    return {f'{name}: {problem}' for name, d in snapshot['libraries'].items() for problem in d['problems']}


def inventory(root, out, verify=False):
    data = scan(root)
    manifest = read_json(root / MANIFEST)
    known = {x['directory'] for x in manifest['libraries']}
    lock = read_json(root / LOCK) if (root / LOCK).exists() else {'libraries': {}}
    drift = [name for name, d in data['libraries'].items()
             if lock['libraries'].get(name, {}).get('sha256') != d['sha256']]
    drift += [name for name in lock['libraries'] if name not in data['libraries']]
    if data['runtimeSha256'] != lock.get('runtimeSha256', {}):
        drift.append('Core/Editor runtime')
    data['lockDrift'] = sorted(drift)
    data['withoutUpstreamProvenance'] = sorted(name for name in data['libraries']
        if name not in known and not lock['libraries'].get(name, {}).get('source'))
    write_json(out / 'inventory.json', data)
    lines = ['# CREATE H5P inventory', '', f"Core API: {data['coreApi']}",
             f"Libraries: {len(data['libraries'])}; lock drift: {len(drift)}; "
             f"without upstream provenance: {len(data['withoutUpstreamProvenance'])}", '',
             'Installed does not mean browser-tested or current upstream.', '',
             '| Library | Version | Direct integrity findings |', '| --- | --- | --- |']
    for name, d in data['libraries'].items():
        lines.append(f"| {name} | {d['version']} | {'; '.join(d['problems']) or 'none'} |")
    (out / 'inventory.md').write_text('\n'.join(lines) + '\n')
    if verify and drift:
        raise ValueError('Library lock drift; inspect inventory.json before updating the baseline')
    return data


def download(name):
    if not NAME.fullmatch(name):
        raise ValueError('Invalid library name')
    url = HUB + name
    # curl uses the OS trust store on macOS; never disable certificate checks.
    with tempfile.TemporaryDirectory(prefix='create-h5p-download-') as temp:
        target = Path(temp) / 'package.h5p'
        response = subprocess.run([
            'curl', '--fail', '--silent', '--show-error', '--location',
            '--proto', '=https', '--proto-redir', '=https', '--max-redirs', '3',
            '--max-time', '45', '--max-filesize', str(MAX_DOWNLOAD),
            '--user-agent', 'CREATE-H5P-maintenance/1.0', '--output', str(target),
            '--write-out', '%{url_effective}', url
        ], capture_output=True, text=True, timeout=50, check=True)
        final = urllib.parse.urlparse(response.stdout)
        if final.scheme != 'https' or final.hostname not in ('hub-api.h5p.org', 'api.h5p.org'):
            raise ValueError('Unexpected package redirect host')
        with target.open('rb') as file:
            data = file.read(MAX_DOWNLOAD + 1)
    if len(data) > MAX_DOWNLOAD:
        raise ValueError('Package exceeds download limit')
    return data


def unpack(data, destination):
    """Extract library files only; never execute package scripts or import content."""
    if len(data) > MAX_DOWNLOAD:
        raise ValueError('Package exceeds download limit')
    libraries = {}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        infos = archive.infolist()
        if len(infos) > 20000 or sum(i.file_size for i in infos) > MAX_EXPANDED:
            raise ValueError('Package expansion limit exceeded')
        seen = set()
        for info in infos:
            name = info.filename
            safe_file(destination, name)
            if name in seen:
                raise ValueError('Duplicate archive path')
            seen.add(name)
            if stat.S_ISLNK(info.external_attr >> 16) or info.flag_bits & 1:
                raise ValueError('Symlink/encrypted ZIP entry is not supported')
            parts = PurePosixPath(name).parts
            if len(parts) == 2 and parts[1] == 'library.json':
                d = json.loads(archive.read(info))
                if directory(d) != parts[0]:
                    raise ValueError('Package descriptor/directory mismatch')
                libraries[parts[0]] = d
        if not libraries:
            raise ValueError('No libraries in package')
        for info in infos:
            parts = PurePosixPath(info.filename).parts
            if info.is_dir() or parts[0] not in libraries:
                continue
            # Source npm manifests cause duplicate package discovery in Jest.
            if len(parts) == 2 and parts[1] in ('package.json', 'package-lock.json'):
                continue
            target = safe_file(destination, info.filename)
            target.parent.mkdir(parents=True, exist_ok=True)
            # zipfile checks CRC, including ZIP64 descriptors. Canonical text
            # prevents git autocrlf=input from invalidating installed hashes.
            target.write_bytes(normalize_text(archive.read(info)))
    return libraries


def check(root, out, names):
    local = scan(root)
    names = names or sorted({d['machineName'] for d in local['libraries'].values() if d['runnable']})
    results = []
    excluded = read_json(root / POLICY).get('excluded', {}) if (root / POLICY).exists() else {}
    for name in names:
        if name in excluded:
            results.append({'library': name, 'status': 'excluded', 'reason': excluded[name], 'changes': []})
            continue
        try:
            data = download(name)
            with tempfile.TemporaryDirectory(prefix='create-h5p-check-') as temp:
                upstream = unpack(data, Path(temp))
                matching = [d for d in upstream.values() if d['machineName'] == name]
                if not matching:
                    raise ValueError('Requested library absent from package')
                changes = []
                for key, d in upstream.items():
                    previous = local['libraries'].get(key)
                    if previous is None or version(d) > tuple(map(int, previous['version'].split('.'))):
                        changes.append({'library': key, 'installed': previous and previous['version'],
                                        'upstream': '.'.join(map(str, version(d)))})
                results.append({'library': name, 'status': 'update-available' if changes else 'no-newer-packaged-version',
                                'source': HUB + name, 'packageSha256': sha(data), 'changes': changes})
        except Exception as exc:
            results.append({'library': name, 'status': 'error', 'error': str(exc)})
    write_json(out / 'updates.json', results)
    lines = ['# CREATE H5P upstream check', '',
             'Compared official Hub packages, including their dependencies. No installation performed.',
             'This feed is not a complete GitHub/Core/Lumi release feed. Errors are unknown status, never up-to-date.', '',
             '| Activity | Result | Package changes / error |', '| --- | --- | --- |']
    for row in results:
        detail = row.get('error') or row.get('reason') or ', '.join(f"{c['library']} → {c['upstream']}" for c in row['changes']) or 'none'
        lines.append(f"| {row['library']} | {row['status']} | {detail.replace('|', '/')} |")
    (out / 'updates.md').write_text('\n'.join(lines) + '\n')
    if any(row['status'] == 'error' for row in results):
        raise ValueError('Some upstream checks failed; see updates.json')


def prepare(root, out, name, package=None):
    if not NAME.fullmatch(name):
        raise ValueError('Invalid library name')
    excluded = read_json(root / POLICY).get('excluded', {}) if (root / POLICY).exists() else {}
    if name in excluded:
        raise ValueError(f'Excluded activity: {excluded[name]}')
    if out.exists():
        raise ValueError('Candidate output must not exist; use a fresh directory')
    before = scan(root)
    data = Path(package).read_bytes() if package else download(name)
    source = 'local-package (manual provenance verification required)' if package else HUB + name
    with tempfile.TemporaryDirectory(prefix='create-h5p-prepare-') as temp:
        temp = Path(temp)
        extracted = temp / 'extracted'
        incoming = unpack(data, extracted)
        requested = [key for key, d in incoming.items() if d['machineName'] == name]
        if not requested:
            raise ValueError('Requested library absent from package')
        overlay = temp / 'overlay'
        shutil.copytree(root / LIBS, overlay / LIBS)
        (overlay / MANIFEST).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / MANIFEST, overlay / MANIFEST)
        changed, retained = [], []
        for key, descriptor in incoming.items():
            old = before['libraries'].get(key)
            if old and version(descriptor) <= tuple(map(int, old['version'].split('.'))):
                retained.append(key)
                continue
            target = overlay / LIBS / key
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(extracted / key, target)
            changed.append(key)
        after = scan(overlay)
        introduced = sorted(problems(after) - problems(before))
        for key in requested:
            for dependency in closure(after['libraries'], key):
                if dependency not in after['libraries']:
                    introduced.append(f'{key}: missing dependency {dependency}')
                else:
                    introduced.extend(f"{dependency}: {p}" for p in after['libraries'][dependency]['problems'])
        affected = sorted(key for key, d in after['libraries'].items()
                          if d['runnable'] and closure(after['libraries'], key).intersection(changed))
        migration = [key for key in changed if key not in before['libraries']
                     and any(d['machineName'] == after['libraries'][key]['machineName']
                             for d in before['libraries'].values())]
        out.mkdir(parents=True)
        plan = {'schemaVersion': 1, 'requested': name, 'source': source, 'packageSha256': sha(data),
                'baseLibraries': {k: d['sha256'] for k, d in before['libraries'].items()},
                'baseRuntimeSha256': before['runtimeSha256'],
                'baseManifestSha256': sha((root / MANIFEST).read_bytes()),
                'baseLockSha256': sha((root / LOCK).read_bytes()) if (root / LOCK).exists() else None,
                'changes': {k: after['libraries'][k] for k in sorted(changed)},
                'retainedSameOrNewer': sorted(retained), 'affectedRunnableLibraries': affected,
                'requiresContentMigrationReview': migration,
                'blockers': sorted(set(introduced)), 'status': 'blocked' if introduced else 'prepared',
                'acceptance': 'not run; prepared is not release approval'}
        write_json(out / 'plan.json', plan)
        (out / 'candidate.md').write_text('# CREATE H5P candidate\n\n' +
            f"Requested: {name}\n\nStatus: {plan['status']}\n\n" +
            f"Changed: {', '.join(sorted(changed)) or 'none'}\n\n" +
            f"Affected activities: {', '.join(affected) or 'none'}\n\n" +
            f"Content migration review: {', '.join(migration) or 'none'}\n\n" +
            'Existing content is not migrated. Same/newer installed patches are retained.\n\n' +
            '\n'.join('- ' + p for p in plan['blockers']) + '\n')
        if introduced:
            raise ValueError('Candidate blocked; see plan.json')
        for key in changed:
            shutil.copytree(overlay / LIBS / key, out / 'libraries' / key)
        manifest = read_json(root / MANIFEST)
        manifest['libraries'] = [entry for entry in manifest['libraries'] if entry['directory'] not in changed]
        for key in sorted(changed):
            manifest['libraries'].append({'directory': key, 'source': source,
                'archiveSha256': sha(data),
                'transformations': ['UTF-8 CRLF normalized to LF', 'source npm manifests omitted'],
                'installedAssetSha256': files(out / 'libraries' / key)})
        write_json(out / 'runtime-manifest.json', manifest)
        lock = read_json(root / LOCK) if (root / LOCK).exists() else before
        for key in changed:
            lock['libraries'][key] = {**after['libraries'][key], 'source': source, 'archiveSha256': sha(data)}
        write_json(out / 'library-lock.json', lock)
        plan['manifestSha256'] = sha((out / 'runtime-manifest.json').read_bytes())
        plan['lockSha256'] = sha((out / 'library-lock.json').read_bytes())
        write_json(out / 'plan.json', plan)
        return plan


def apply(root, candidate):
    """Materialize a reviewed candidate in a disposable checkout, with rollback."""
    plan = read_json(candidate / 'plan.json')
    if plan['status'] != 'prepared' or plan['blockers']:
        raise ValueError('Candidate is blocked')
    current = scan(root)
    if {k: d['sha256'] for k, d in current['libraries'].items()} != plan['baseLibraries']:
        raise ValueError('Base libraries changed; prepare a new candidate')
    if current['runtimeSha256'] != plan['baseRuntimeSha256']:
        raise ValueError('Core/Editor changed; prepare a new candidate')
    for rel, expected in [(MANIFEST, plan['baseManifestSha256']), (LOCK, plan['baseLockSha256'])]:
        actual = sha((root / rel).read_bytes()) if (root / rel).exists() else None
        if actual != expected:
            raise ValueError('Base manifest/lock changed; prepare a new candidate')
    for file, expected in [('runtime-manifest.json', plan['manifestSha256']), ('library-lock.json', plan['lockSha256'])]:
        if sha((candidate / file).read_bytes()) != expected:
            raise ValueError('Candidate metadata checksum mismatch')
    for key, d in plan['changes'].items():
        if not DIR.fullmatch(key) or digest(candidate / 'libraries' / key) != d['sha256']:
            raise ValueError('Candidate library checksum mismatch')
    with tempfile.TemporaryDirectory(prefix='create-h5p-rollback-') as temp:
        backup = Path(temp)
        paths = [f'{LIBS}/{key}' for key in plan['changes']] + [MANIFEST, LOCK]
        for rel in paths:
            old = root / rel
            saved = backup / rel
            saved.parent.mkdir(parents=True, exist_ok=True)
            if old.is_dir():
                shutil.copytree(old, saved)
            elif old.exists():
                shutil.copy2(old, saved)
        try:
            for key in plan['changes']:
                target = root / LIBS / key
                if target.exists():
                    shutil.rmtree(target)
                shutil.copytree(candidate / 'libraries' / key, target)
            shutil.copy2(candidate / 'runtime-manifest.json', root / MANIFEST)
            shutil.copy2(candidate / 'library-lock.json', root / LOCK)
        except Exception:
            for rel in paths:
                target, saved = root / rel, backup / rel
                if target.is_dir():
                    shutil.rmtree(target)
                elif target.exists():
                    target.unlink()
                if saved.is_dir():
                    shutil.copytree(saved, target)
                elif saved.exists():
                    shutil.copy2(saved, target)
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['inventory', 'baseline', 'check', 'prepare', 'apply'])
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--out', type=Path, default=ROOT / 'artifacts/h5p-maintenance')
    parser.add_argument('--library')
    parser.add_argument('--package', type=Path)
    parser.add_argument('--candidate', type=Path)
    parser.add_argument('--verify-lock', action='store_true')
    parser.add_argument('--allow-worktree-write', action='store_true')
    args = parser.parse_args()
    root, out = args.root.resolve(), args.out.resolve()
    if args.command == 'prepare':
        if not args.library:
            parser.error('--library is required')
        prepare(root, out, args.library, args.package)
    elif args.command == 'apply':
        if not args.allow_worktree_write or not args.candidate:
            parser.error('apply requires --candidate and --allow-worktree-write; use a disposable checkout')
        apply(root, args.candidate.resolve())
    elif args.command == 'baseline':
        if not args.allow_worktree_write:
            parser.error('baseline requires --allow-worktree-write after inspecting inventory')
        data = scan(root)
        old = read_json(root / LOCK) if (root / LOCK).exists() else {'libraries': {}}
        for key, entry in data['libraries'].items():
            previous = old['libraries'].get(key, {})
            if previous.get('sha256') == entry['sha256']:
                entry.update({k: previous[k] for k in ('source', 'archiveSha256') if k in previous})
        write_json(root / LOCK, data)
    else:
        out.mkdir(parents=True, exist_ok=True)
        if args.command == 'inventory':
            inventory(root, out, args.verify_lock)
        else:
            check(root, out, [args.library] if args.library else None)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'H5P maintenance failed: {error}', file=sys.stderr)
        sys.exit(1)
