import { describe, expect, test } from '@jest/globals';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Readable, Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { getStudioCatalog } from '../../services/h5pStudioCatalog.js';
import { collectTemplateMedia, normalizeStudioParameters } from '../../services/h5pStudioSemantics.js';
import { saveNativeH5PDocument } from '../../services/h5pEditorService.js';

const require = createRequire(import.meta.url);
const H5P = require('@lumieducation/h5p-server');
const AdmZip = require('adm-zip');
const sourceLibraries = fileURLToPath(new URL('../../h5p-libs/', import.meta.url));

describe('Studio AI owned media persistence with real Lumi storage', () => {
  test('copies audio into an independent draft and includes it in export/reimport', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'create-studio-media-test-'));
    try {
      for (const dir of ['libraries', 'content', 'temporary']) await fs.mkdir(path.join(root, dir));
      for (const name of ['H5P.Audio-1.5', 'FontAwesome-4.5', 'H5PEditor.ShowWhen-1.0']) {
        await fs.cp(path.join(sourceLibraries, name), path.join(root, 'libraries', name), { recursive: true });
      }
      const storage = new H5P.fsImplementations.FileContentStorage(path.join(root, 'content'));
      const config = new H5P.H5PConfig();
      config.sendUsageStatistics = false;
      const editor = new H5P.H5PEditor(
        { load: async () => undefined, save: async () => {} }, config,
        new H5P.fsImplementations.FileLibraryStorage(path.join(root, 'libraries')), storage,
        new H5P.fsImplementations.DirectoryTemporaryFileStorage(path.join(root, 'temporary'))
      );
      const user = { id: 'fixture-owner', name: 'Fixture', type: 'local' };
      // A real short silent PCM WAV; no external network or user media involved.
      const wav = Buffer.alloc(844);
      wav.write('RIFF'); wav.writeUInt32LE(836, 4); wav.write('WAVEfmt ', 8);
      wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
      wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
      wav.write('data', 36); wav.writeUInt32LE(800, 40);
      const parameters = { files: [{ path: 'audios/fixture.wav', mime: 'audio/wav' }], autoplay: false };
      const metadata = { title: 'Owned audio template', license: 'U', mainLibrary: 'H5P.Audio', embedTypes: ['iframe'], preloadedDependencies: [{ machineName: 'H5P.Audio', majorVersion: 1, minorVersion: 5 }] };
      const sourceId = await storage.addContent(metadata, parameters, user);
      await storage.addFile(sourceId, 'audios/fixture.wav', Readable.from(wav), user);
      const catalog = getStudioCatalog();
      const trusted = collectTemplateMedia('H5P.Audio 1.5', parameters, catalog.libraries, sourceId);
      const copied = await saveNativeH5PDocument(editor, {
        library: 'H5P.Audio 1.5', metadata: { title: 'Independent audio draft', license: 'U' },
        parameters: normalizeStudioParameters('H5P.Audio 1.5', parameters, catalog.libraries, trusted)
      }, user);
      expect(copied.id).not.toBe(sourceId);
      const persisted = await editor.getContent(copied.id, user);
      const copiedPath = persisted.params.params.files[0].path;
      expect(copiedPath).not.toContain('..');
      expect(await editor.contentManager.contentFileExists(copied.id, copiedPath)).toBe(true);
      // Delete only our temporary test source; the derived activity stays usable.
      await storage.deleteContent(sourceId, user);
      const chunks = [];
      const output = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
      const done = finished(output);
      await editor.exportContent(copied.id, output, user);
      await done;
      const zip = new AdmZip(Buffer.concat(chunks));
      expect(zip.readFile(`content/${copiedPath}`)).toEqual(wav);
      expect(JSON.parse(zip.readAsText('h5p.json')).mainLibrary).toBe('H5P.Audio');
      const packagePath = path.join(root, 'round-trip.h5p');
      await fs.writeFile(packagePath, Buffer.concat(chunks));
      const imported = await editor.packageImporter.addPackageLibrariesAndTemporaryFiles(packagePath, user);
      const resaved = await saveNativeH5PDocument(editor, { library: 'H5P.Audio 1.5', metadata: imported.metadata, parameters: imported.parameters }, user);
      const reopened = await editor.getContent(resaved.id, user);
      expect(reopened.params.params.files).toHaveLength(1);
      expect(await editor.contentManager.contentFileExists(resaved.id, reopened.params.params.files[0].path)).toBe(true);
    } finally {
      // root is freshly allocated by mkdtemp for this test, never a user path.
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 20000);
});
