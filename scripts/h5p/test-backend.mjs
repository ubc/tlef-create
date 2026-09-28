import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const backend = path.join(root, 'routes/create');
const testDirectory = path.join(backend, '__tests__/unit');
const tests = fs.readdirSync(testDirectory)
  .filter(name => /^h5p.*\.test\.js$/.test(name))
  .sort()
  .map(name => path.join(testDirectory, name));
if (!tests.length) throw new Error('No H5P regression tests found');

// Exact paths avoid matching every test when a checkout directory contains h5p.
const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'create-h5p-regression-'));
try {
  const result = spawnSync(process.execPath, [
    '--experimental-vm-modules', path.join(root, 'node_modules/jest/bin/jest.js'),
    '--config', 'jest.unit.config.js', '--runInBand', '--runTestsByPath', ...tests
  ], {
    cwd: backend,
    env: { ...process.env, H5P_STORAGE_ROOT: storage },
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(storage, { recursive: true, force: true });
}
