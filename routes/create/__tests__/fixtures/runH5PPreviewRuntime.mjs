// Execute real vendored browser bundles in a DOM without network or a live app.
// Runs under Node because JSDOM's ESM dependencies cannot use Jest's CJS loader.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { renderNativeH5PPreview } from '../../services/h5pNativePreviewService.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const document = JSON.parse(fs.readFileSync(0, 'utf8'));
const html = await renderNativeH5PPreview(document);
const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', error => errors.push(error.message));
virtualConsole.on('error', error => errors.push(String(error)));
const dom = new JSDOM(html, { url: 'http://localhost/preview', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
const { window } = dom;
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.scrollTo = () => {};
try {
  for (const script of window.document.querySelectorAll('script')) {
    const url = script.getAttribute('src');
    if (url) {
      const pathname = new URL(url, window.location.href).pathname;
      const filename = pathname.replace('/api/create/h5p-preview/core', path.join(root, 'h5p-core'))
        .replace('/api/create/h5p-preview/libs', path.join(root, 'h5p-libs'));
      window.eval(fs.readFileSync(filename, 'utf8'));
    } else window.eval(script.textContent);
  }
  await new Promise(resolve => window.setTimeout(resolve, 40));
  const instance = window.H5P.instances[0];
  process.stdout.write(JSON.stringify({
    errors, instanceCount: window.H5P.instances.length,
    library: instance?.libraryInfo?.versionedName,
    targets: instance?.params?.content?.[1]?.type?.params?.branchingQuestion?.alternatives.map(alternative => alternative.nextContentId),
    text: window.document.querySelector('#h5p-native-preview').textContent,
    endScreenIds: Object.keys(instance?.endScreens || {}).sort()
  }));
} catch (error) { process.stdout.write(JSON.stringify({ errors: [...errors, error.message] })); }
finally { window.close(); }
