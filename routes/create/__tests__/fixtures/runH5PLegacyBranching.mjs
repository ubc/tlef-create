// Execute real vendored browser bundles in a DOM without network or a live app.
// Runs under Node because JSDOM's ESM dependencies cannot use Jest's CJS loader.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { renderLegacyH5PPreview } from '../../services/h5pLegacyPreviewService.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const document = JSON.parse(fs.readFileSync(0, 'utf8'));
const html = await renderLegacyH5PPreview(document, document.questions, 'mixed-activity');
const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', error => errors.push(error.cause?.stack || error.detail?.stack || error.message));
virtualConsole.on('error', error => errors.push(String(error)));
const dom = new JSDOM(html, { url: 'http://localhost/preview', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
const { window } = dom;
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.scrollTo = () => {};
Object.defineProperty(window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
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
  const instance = window.H5P.instances.find(item => item.libraryInfo.machineName === 'H5P.BranchingScenario');
  const outcomes = [];
  for (const target of [-1, -2]) {
    instance.trigger('started');
    instance.trigger('navigated', { nextContentId: 1 });
    const branch = instance.libraryScreen.libraryInstances[1];
    if (branch.parent !== instance) throw new Error('Branching question lost its parent');
    branch.alternativeDOMs[target === -1 ? 0 : 1].click();
    branch.alternativeDOMs[target === -1 ? 0 : 1].proceedButton?.click();

    if (!instance.currentEndScreen) throw new Error('Ending missing: ' + target);
    outcomes.push(target);
    instance.trigger('restarted');
  }
  process.stdout.write(JSON.stringify({ errors, outcomes, endScreenIds: Object.keys(instance.endScreens).sort() }));

} catch (error) { process.stdout.write(JSON.stringify({ errors: [...errors, error.message] })); }
finally { window.close(); }
