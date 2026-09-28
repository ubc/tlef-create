/** Real native editor acceptance, isolated storage and an ephemeral loopback port. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import express from 'express';
import { chromium } from '@playwright/test';
const require = createRequire(import.meta.url);
const renderEditor = require('@lumieducation/h5p-server/build/src/renderers/default.js').default;
const targets = JSON.parse(fs.readFileSync(new URL('../../routes/create/config/h5p-studio-targets.json', import.meta.url)));
const out = path.resolve(process.argv[2] || 'artifacts/h5p-maintenance/editor');
fs.mkdirSync(out, { recursive: true });
const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'create-h5p-editor-'));
process.env.H5P_STORAGE_ROOT = storage;
const { initializeLumi, getEditor, getH5PExpressRouter } = await import('../../routes/create/services/lumiService.js');
const { getStudioCatalog } = await import('../../routes/create/services/h5pStudioCatalog.js');
const user = { id: 'editor-acceptance', name: 'Editor acceptance', type: 'local' };
let server, browser;
const report = { scope: 'Installed picker and blank official editor forms; not completed learner activities or external services', targets: targets.types.length, picker: [], results: [] };
try {
  await initializeLumi();
  // The installed-library list must work when the remote Hub is unavailable.
  getEditor().contentTypeCache.get = async () => [];
  const app = express();
  app.use(express.json(), express.urlencoded({ extended: true }), (req, _res, next) => { req.user = user; next(); });
  app.get('/editor', async (req, res, next) => {
    try {
      const library = getStudioCatalog().types.find(type => type.library === req.query.library)?.library;
      const model = await getEditor().render(undefined, 'en', user);
      const html = renderEditor(model).replaceAll('h5peditor = new ns.Editor(undefined, undefined, $editor[0]);',
        `h5peditor = window.acceptanceEditor = new ns.Editor(${JSON.stringify(library) || 'undefined'}, undefined, $editor[0]);`);
      res.send(html);
    } catch (error) { next(error); }
  });
  app.use('/api/create/h5p-editor/runtime', getH5PExpressRouter());
  server = await new Promise((resolve, reject) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); listener.on('error', reject); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${origin}/editor`);
  await page.waitForFunction(() => window.acceptanceEditor?.selector?.libraries, null, { timeout: 20000 });
  report.picker = await page.evaluate(() => {
    const libraries = window.acceptanceEditor.selector.libraries;
    return (libraries.libraries || libraries).map(item => item.machineName);
  });
  report.missingFromPicker = targets.types.filter(type => !report.picker.includes(type.machineName)).map(type => type.machineName);
  await page.screenshot({ path: path.join(out, 'native-picker.png'), fullPage: true });
  report.icons = [];
  const iconTargets = [
    ['H5P.ImageMultipleHotspotQuestion', 'Find Multiple Hotspots'],
    ['H5P.ImpressPresentation', 'Impressive Presentation'],
    ['H5P.PersonalityQuiz', 'Personality Quiz']
  ];
  const pickerFrame = page.frameLocator('.h5p-editor-iframe');
  const search = pickerFrame.getByRole('textbox', { name: 'Search for content type to create' });
  for (const [machineName, title] of iconTargets) {
    await search.fill('');
    await search.pressSequentially(title);
    const card = pickerFrame.locator(`#h5p-${machineName.slice(4).toLowerCase()}`);
    await card.waitFor({ state: 'visible' });
    const icon = card.locator('img');
    const src = await icon.getAttribute('src');
    const loaded = await icon.evaluate(image => image.complete && image.naturalWidth > 0);
    report.icons.push({ machineName, src, loaded });
    await page.screenshot({ path: path.join(out, `${machineName}-icon.png`) });
  }
  await search.fill('');
  for (const target of targets.types) {
    const type = getStudioCatalog().types.find(item => item.machineName === target.machineName);
    const errors = [];
    const onError = error => errors.push(error.message);
    const onResponse = response => { if (response.status() >= 400 && response.url().startsWith(origin)) errors.push(`${response.status()} ${response.url().slice(origin.length)}`); };
    page.on('pageerror', onError); page.on('response', onResponse);
    let fields = 0;
    try {
      if (!type || type.mode === 'unavailable') throw new Error(type?.guidance || 'Missing library');
      await page.goto(`${origin}/editor?library=${encodeURIComponent(type.library)}`);
      await page.waitForFunction(() => {
        const editor = window.acceptanceEditor;
        const runtime = editor?.iframeWindow?.H5PEditor;
        return editor?.selector?.form && runtime && !(runtime.$?.active > 0) &&
          Object.entries(runtime.libraryCache || {}).every(([name, value]) => value !== 0 && runtime.libraryLoaded?.[name]);
      }, null, { timeout: 20000 });
      fields = await page.frameLocator('.h5p-editor-iframe').locator('input,textarea,select,[contenteditable=true]').count();
      if (!fields) throw new Error('No rendered form fields');
      if (target.editorOnly) await page.screenshot({ path: path.join(out, `${type.machineName}.png`), fullPage: true });
    } catch (error) { errors.push(error.message); }
    page.off('pageerror', onError); page.off('response', onResponse);
    report.results.push({ machineName: target.machineName, library: type?.library, version: type?.version, fields, errors, passed: errors.length === 0 });
    console.log(`${errors.length ? 'FAIL' : 'PASS'} ${target.machineName}${errors.length ? ': ' + errors.join('; ') : ''}`);
  }
  report.passed = !report.missingFromPicker.length && report.results.every(result => result.passed) && report.icons.every(icon => icon.loaded);
  if (!report.passed) process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(out, 'editor-acceptance.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  fs.rmSync(storage, { recursive: true, force: true });
}
