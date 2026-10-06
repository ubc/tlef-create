import { expect, test } from '@jest/globals';
import { validateManualActivityLibrary } from '../../services/authoring/artifactVersionService.js';
import { getStudioCatalog } from '../../services/h5pStudioCatalog.js';

test('the official Column to Page minor upgrade preserves the actual machine name and uses installed healthy assets', () => {
  const catalog = getStudioCatalog();
  expect(catalog.libraries.get('H5P.Column 1.18').descriptor.title).toBe('Column');
  expect(catalog.libraries.get('H5P.Column 1.20').descriptor.title).toBe('Page');
  expect(() => validateManualActivityLibrary('H5P.Column 1.18', 'H5P.Column 1.20', catalog)).not.toThrow();
  expect(() => validateManualActivityLibrary('H5P.Column 1.18', 'H5P.Column 1.18', catalog)).not.toThrow();
});

test.each([
  ['H5P.Column 1.18', 'H5P.Chart 1.2'],
  ['H5P.Column 1.18', 'H5P.Column 1.99'],
  ['H5P.Column 1.20', 'H5P.Column 1.18'],
  ['H5P.Column 1.18', 'H5P.Column 1.20.0']
])('rejects actual type changes, uninstalled or malformed versions and downgrades: %s -> %s', (original, edited) => {
  expect(() => validateManualActivityLibrary(original, edited)).toThrow('Keep the current activity type');
});

test('an installed-looking different major version does not bypass the saved activity type gate', () => {
  const catalog = getStudioCatalog();
  const installed = catalog.libraries.get('H5P.Column 1.20');
  const libraries = new Map(catalog.libraries);
  libraries.set('H5P.Column 2.0', { ...installed, descriptor: { ...installed.descriptor, majorVersion: 2, minorVersion: 0 } });
  expect(() => validateManualActivityLibrary('H5P.Column 1.18', 'H5P.Column 2.0', { libraries })).toThrow('Keep the current activity type');
});

test.each([
  { preloadedJs: [{ path: 'missing-manual-editor-regression.js' }] },
  { coreApi: { majorVersion: 99, minorVersion: 0 } }
])('an upgrade with missing assets or unsupported core requirements remains blocked: %j', changes => {
  const catalog = getStudioCatalog();
  const installed = catalog.libraries.get('H5P.Column 1.20');
  const libraries = new Map(catalog.libraries);
  libraries.set('H5P.Column 1.20', { ...installed, descriptor: { ...installed.descriptor, ...changes } });
  expect(() => validateManualActivityLibrary('H5P.Column 1.18', 'H5P.Column 1.20', { libraries })).toThrow('Keep the current activity type');
});
