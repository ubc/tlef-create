import fs from 'node:fs';
import { describe, test, expect, jest } from '@jest/globals';
import { getStudioCatalog, libraryProblems } from '../../services/h5pStudioCatalog.js';
import { generateStudioActivity } from '../../services/h5pStudioAIService.js';
import { initializeLumi, getEditor } from '../../services/lumiService.js';
const targets = JSON.parse(fs.readFileSync(new URL('../../config/h5p-studio-targets.json', import.meta.url)));
const catalog = getStudioCatalog();

describe('expanded official Studio editor', () => {
  test('every named public target is usable and exposed to an ordinary author', async () => {
    expect(new Set(targets.types.map(type => type.machineName)).size).toBe(54);
    await initializeLumi();
    const hub = jest.spyOn(getEditor().contentTypeCache, 'get').mockResolvedValue([]);
    try {
      const picker = await getEditor().getContentTypeCache({ id: 'expansion-test', name: 'Teacher', type: 'local' });
      for (const target of targets.types) {
        const type = catalog.types.find(type => type.machineName === target.machineName);
        expect(type).toBeDefined();
        expect(type.mode).not.toBe('unavailable');
        expect(libraryProblems(type.library, catalog.libraries)).toEqual([]);
        expect(picker.libraries.find(item => item.machineName === target.machineName)).toMatchObject({ installed: true, canInstall: false });
      }
      expect(picker.libraries.some(item => item.machineName === 'H5P.TwitterUserFeed')).toBe(false);
    } finally { hub.mockRestore(); }
  });
  test.each(targets.types.filter(type => type.editorOnly))('$machineName remains manual until its AI contract is validated', async target => {
    const type = catalog.types.find(item => item.machineName === target.machineName);
    expect(type.mode).toBe('manual');
    const complete = jest.fn();
    await expect(generateStudioActivity({ library: type.library, instructions: 'Create a sample learning activity.', complete })).rejects.toThrow('manually');
    expect(complete).not.toHaveBeenCalled();
  });
});
