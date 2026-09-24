import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import assert from 'node:assert/strict';
import { catalog, fixtureFor } from './h5p-fixtures.mjs';
import { generateStudioActivity } from '../routes/create/services/h5pStudioAIService.js';
import { studioMediaPaths } from '../routes/create/services/h5pStudioSemantics.js';
import { saveNativeH5PDocument } from '../routes/create/services/h5pEditorService.js';
import { H5P_CORE_API, H5P_CORE_VERSION } from '../routes/create/config/h5pRuntime.js';
const require = createRequire(import.meta.url);
const H5P = require('@lumieducation/h5p-server');

export async function fixturePackage(type) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'create-h5p-acceptance-'));
  try {
    await Promise.all(['content', 'temporary'].map(dir => fs.mkdir(path.join(root, dir))));
    const storage = new H5P.fsImplementations.FileContentStorage(path.join(root, 'content'));
    const config = new H5P.H5PConfig();
    config.sendUsageStatistics = false;
    config.coreApiVersion = { ...H5P_CORE_API };
    config.h5pVersion = H5P_CORE_VERSION;
    const editor = new H5P.H5PEditor({ load: async () => undefined, save: async () => {} }, config,
      new H5P.fsImplementations.FileLibraryStorage(fileURLToPath(new URL('../routes/create/h5p-libs/', import.meta.url))),
      storage, new H5P.fsImplementations.DirectoryTemporaryFileStorage(path.join(root, 'temporary')));
    const user = { id: 'acceptance-fixture', name: 'Acceptance', type: 'local' };
    const metadata = { title: `Acceptance ${type.title}`, license: 'U', mainLibrary: type.machineName, embedTypes: ['iframe'], preloadedDependencies: [{ machineName: type.machineName, majorVersion: Number(type.version.split('.')[0]), minorVersion: Number(type.version.split('.')[1]) }] };
    const original = fixtureFor(type.library);
    const source = await storage.addContent(metadata, original, user);
    // Known synthetic media, generated entirely locally. Never use user uploads.
    execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=32x32:d=1', '-frames:v', '1', path.join(root, 'fixture.png')]);
    execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '1', path.join(root, 'fixture.wav')]);
    execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=32x32:d=1', '-pix_fmt', 'yuv420p', path.join(root, 'fixture.mp4')]);
    for (const [folder, extension] of [['images', 'png'], ['audios', 'wav'], ['videos', 'mp4']]) {
      await storage.addFile(source, `${folder}/fixture.${extension}`, Readable.from(await fs.readFile(path.join(root, `fixture.${extension}`))), user);
    }
    // Exercise the production AI contract/validation boundary using a fixed
    // completion. This tests integration, not a paid model's teaching quality.
    const generated = await generateStudioActivity({
      library: type.library, instructions: 'Create a small acceptance activity using the supplied content.',
      template: { library: type.library, params: { params: original } }, templateContentId: source,
      catalog, complete: async () => ({ model: 'deterministic-test', content: JSON.stringify({ title: metadata.title, params: original }) })
    });
    const saved = await saveNativeH5PDocument(editor, generated.document, user);
    const persisted = await editor.getContent(saved.id, user);
    const files = studioMediaPaths(persisted.params.params);
    assert.equal(files.length, studioMediaPaths(generated.document.parameters).length, 'Native save dropped media');
    for (const file of files) {
      if (/^https:\/\//.test(file)) continue;
      assert.ok(!file.split('/').includes('..'), 'Draft still refers to its source template');
      assert.ok(await editor.contentManager.contentFileExists(saved.id, file), 'Copied media file is missing');
    }
    await storage.deleteContent(source, user);
    const chunks = [];
    const output = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
    const complete = finished(output);
    await editor.exportContent(saved.id, output, user);
    await complete;
    return Buffer.concat(chunks);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
