import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SPEC = importlib.util.spec_from_file_location('maintain', Path(__file__).resolve().parents[2] / 'scripts/h5p/maintain.py')
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)


def descriptor(name='H5P.Test', patch_version=1, minor=0, deps=None, core=28):
    return {'machineName': name, 'majorVersion': 1, 'minorVersion': minor,
            'patchVersion': patch_version, 'runnable': 1,
            'coreApi': {'majorVersion': 1, 'minorVersion': core},
            'preloadedJs': [{'path': 'dist/main.js'}], 'preloadedDependencies': deps or []}


def package(*descriptors, extras=None):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for d in descriptors:
            name = m.directory(d)
            z.writestr(name + '/library.json', json.dumps(d))
            z.writestr(name + '/dist/main.js', '// patch ' + str(d['patchVersion']))
        for name, data in (extras or {}).items():
            z.writestr(name, data)
    return buf.getvalue()


class MaintenanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'repo'
        (self.root / m.LIBS).mkdir(parents=True)
        m.write_json(self.root / m.MANIFEST, {'coreApi': '1.28', 'libraries': []})
        m.unpack(package(descriptor()), self.root / m.LIBS)
        m.write_json(self.root / m.LOCK, m.scan(self.root))
        self.out = Path(self.temp.name) / 'candidate'

    def prepare(self, data):
        with patch.object(m, 'download', return_value=data):
            return m.prepare(self.root, self.out, 'H5P.Test')

    def test_patch_is_staged_without_mutating_source_then_applies(self):
        before = m.digest(self.root / m.LIBS)
        plan = self.prepare(package(descriptor(patch_version=2)))
        self.assertEqual(before, m.digest(self.root / m.LIBS))
        self.assertEqual(plan['affectedRunnableLibraries'], ['H5P.Test-1.0'])
        m.apply(self.root, self.out)
        self.assertEqual(m.scan(self.root)['libraries']['H5P.Test-1.0']['version'], '1.0.2')
        m.inventory(self.root, self.out, verify=True)

    def test_new_minor_retains_old_library_and_flags_migration(self):
        plan = self.prepare(package(descriptor(minor=1)))
        self.assertEqual(plan['requiresContentMigrationReview'], ['H5P.Test-1.1'])
        m.apply(self.root, self.out)
        self.assertTrue((self.root / m.LIBS / 'H5P.Test-1.0').exists())

    def test_same_or_older_patch_does_not_overwrite_custom_bytes(self):
        target = self.root / m.LIBS / 'H5P.Test-1.0/dist/main.js'
        target.write_text('// local patch')
        plan = self.prepare(package(descriptor()))
        self.assertEqual(plan['changes'], {})
        self.assertEqual(target.read_text(), '// local patch')

    def test_missing_dependency_and_new_core_block_candidate(self):
        dep = {'machineName': 'H5P.Missing', 'majorVersion': 1, 'minorVersion': 0}
        with self.assertRaisesRegex(ValueError, 'blocked'):
            self.prepare(package(descriptor(patch_version=2, deps=[dep], core=29)))
        plan = m.read_json(self.out / 'plan.json')
        self.assertTrue(any('newer core' in p for p in plan['blockers']))
        self.assertTrue(any('missing dependency' in p for p in plan['blockers']))

    def test_shared_dependency_reports_old_parent_impact(self):
        dep = {'machineName': 'H5P.Test', 'majorVersion': 1, 'minorVersion': 0}
        m.unpack(package(descriptor('H5P.Parent', deps=[dep])), self.root / m.LIBS)
        plan = self.prepare(package(descriptor(patch_version=2)))
        self.assertIn('H5P.Parent-1.0', plan['affectedRunnableLibraries'])

    def test_stale_baseline_and_tampered_candidate_are_rejected(self):
        self.prepare(package(descriptor(patch_version=2)))
        candidate_file = self.out / 'libraries/H5P.Test-1.0/dist/main.js'
        original = candidate_file.read_text()
        candidate_file.write_text('tampered')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            m.apply(self.root, self.out)
        candidate_file.write_text(original)
        (self.root / m.LIBS / 'H5P.Test-1.0/dist/main.js').write_text('changed concurrently')
        with self.assertRaisesRegex(ValueError, 'Base libraries changed'):
            m.apply(self.root, self.out)

    def test_path_traversal_and_symlink_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            m.unpack(package(descriptor(), extras={'../outside': 'bad'}), self.out)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w') as z:
            info = zipfile.ZipInfo('H5P.Test-1.0/link')
            info.create_system = 3
            info.external_attr = 0o120777 << 16
            z.writestr(info, '/tmp/outside')
        with self.assertRaisesRegex(ValueError, 'Symlink'):
            m.unpack(buf.getvalue(), self.out)

    def test_descriptor_mismatch_rejected(self):
        data = package(extras={'H5P.Wrong-1.0/library.json': json.dumps(descriptor())})
        with self.assertRaisesRegex(ValueError, 'mismatch'):
            m.unpack(data, self.out)

    def test_css_missing_asset_and_lock_drift_reported(self):
        folder = self.root / m.LIBS / 'H5P.Test-1.0'
        d = m.read_json(folder / 'library.json')
        d['preloadedCss'] = [{'path': 'style.css'}]
        m.write_json(folder / 'library.json', d)
        (folder / 'style.css').write_text('div {background: url(images/missing.png)}')
        self.assertTrue(any('CSS' in p for p in m.scan(self.root)['libraries'][folder.name]['problems']))
        self.out.mkdir()
        with self.assertRaisesRegex(ValueError, 'lock drift'):
            m.inventory(self.root, self.out, verify=True)

    def test_unrelated_existing_defect_does_not_block_patch(self):
        m.unpack(package(descriptor('H5P.Old')), self.root / m.LIBS)
        (self.root / m.LIBS / 'H5P.Old-1.0/dist/main.js').unlink()
        plan = self.prepare(package(descriptor(patch_version=2)))
        self.assertEqual(plan['blockers'], [])

    def test_requested_library_must_be_present(self):
        with self.assertRaisesRegex(ValueError, 'absent'):
            self.prepare(package(descriptor('H5P.Wrong')))

    def test_network_failure_is_unknown_and_fails_check(self):
        self.out.mkdir()
        with patch.object(m, 'download', side_effect=TimeoutError('offline')):
            with self.assertRaisesRegex(ValueError, 'checks failed'):
                m.check(self.root, self.out, ['H5P.Test'])
        self.assertEqual(m.read_json(self.out / 'updates.json')[0]['status'], 'error')

    def test_retired_type_is_explicitly_excluded_without_network(self):
        self.out.mkdir()
        m.write_json(self.root / m.POLICY, {'excluded': {'H5P.Test': 'retired'}})
        with patch.object(m, 'download') as download:
            m.check(self.root, self.out, ['H5P.Test'])
            download.assert_not_called()
        self.assertEqual(m.read_json(self.out / 'updates.json')[0]['status'], 'excluded')

    def test_repository_fingerprint_normalizes_text_but_asset_hash_does_not(self):
        file = self.root / m.LIBS / 'H5P.Test-1.0/dist/main.js'
        file.write_bytes(b'// line\r\n')
        first = m.digest(file.parent)
        raw = m.files(file.parent)
        file.write_bytes(b'// line\n')
        self.assertEqual(first, m.digest(file.parent))
        self.assertNotEqual(raw, m.files(file.parent))

    def test_streamed_zip64_descriptors_are_supported(self):
        class Stream(io.BytesIO):
            def seek(self, *args):
                raise io.UnsupportedOperation()
        stream = Stream()
        with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
            with archive.open('H5P.Test-1.0/library.json', 'w', force_zip64=True) as entry:
                entry.write(json.dumps(descriptor()).encode())
            archive.writestr('H5P.Test-1.0/dist/main.js', '// runtime')
        self.assertIn('H5P.Test-1.0', m.unpack(stream.getvalue(), self.out))

    def test_failed_materialization_rolls_back(self):
        self.prepare(package(descriptor(patch_version=2)))
        original = m.digest(self.root)
        copy = m.shutil.copy2
        def fail_metadata(source, destination, *args, **kwargs):
            if Path(source) == self.out / 'runtime-manifest.json':
                raise OSError('simulated write failure')
            return copy(source, destination, *args, **kwargs)
        with patch.object(m.shutil, 'copy2', side_effect=fail_metadata):
            with self.assertRaises(OSError):
                m.apply(self.root, self.out)
        self.assertEqual(original, m.digest(self.root))


if __name__ == '__main__':
    unittest.main()
