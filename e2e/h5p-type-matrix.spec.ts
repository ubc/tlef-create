import { expect, test } from '@playwright/test';
import AdmZip from 'adm-zip';
import { catalog } from './h5p-fixtures.mjs';
import { fixturePackage } from './h5p-package-fixture.mjs';

interface AcceptanceEditorElement extends HTMLElement {
  acceptanceErrors: unknown[];
  save: () => Promise<unknown>;
}

for (const type of catalog.types) {
  test(`native acceptance: ${type.title} ${type.version}`, async ({ page, request }) => {
    test.setTimeout(45000);
    test.skip(type.mode === 'unavailable', 'Installed runtime dependencies are incomplete; this type remains gated.');
    test.skip(type.category === 'External content', 'Requires authorized third-party service/embed acceptance, not a synthetic local fixture.');
    const ids: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.stack || error.message));
    page.on('console', message => {
      if (/Failed to create instance|rendering placeholder/.test(message.text())) errors.push(message.text());
    });
    try {
      const buffer = await fixturePackage(type);
      const imported = await request.post('http://localhost:8051/api/create/h5p-editor/contents/import', { multipart: { file: { name: 'acceptance.h5p', mimeType: 'application/zip', buffer } } });
      expect(imported.ok(), await imported.text()).toBeTruthy();
      const content = (await imported.json()).data.content;
      ids.push(content.contentId);
      await page.goto(`/h5p-studio?contentId=${content.contentId}`);
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled({ timeout: 15000 });
      await page.evaluate(() => {
        const element = document.querySelector<AcceptanceEditorElement>('h5p-editor');
        if (!element) throw new Error('H5P editor is missing');
        element.acceptanceErrors = [];
        for (const name of ['save-error', 'validation-error']) element.addEventListener(name, (event: Event) => element.acceptanceErrors.push((event as CustomEvent<unknown>).detail));
      });
      await page.getByRole('button', { name: 'Save & preview', exact: true }).click();
      try {
        await expect(page.frameLocator('iframe.h5p-studio-preview').locator('.h5p-container')).toBeVisible({ timeout: 10000 });
      } catch (error) {
        console.log(type.title, 'Save diagnostic:', await page.evaluate(async () => {
          const element = document.querySelector<AcceptanceEditorElement>('h5p-editor');
          if (element?.acceptanceErrors?.length) return element.acceptanceErrors;
          try { return await element?.save(); }
          catch (failure) { return String(failure); }
        }).catch(() => 'unavailable'));
        throw error;
      }
      const download = await request.get(`http://localhost:8051/api/create/h5p-editor/contents/${content.contentId}/download`);
      expect(download.ok()).toBeTruthy();
      const exported = await download.body();
      const zip = new AdmZip(exported);
      expect(JSON.parse(zip.readAsText('h5p.json')).mainLibrary).toBe(type.machineName);
      const reimport = await request.post('http://localhost:8051/api/create/h5p-editor/contents/import', { multipart: { file: { name: 'roundtrip.h5p', mimeType: 'application/zip', buffer: exported } } });
      expect(reimport.ok(), await reimport.text()).toBeTruthy();
      ids.push((await reimport.json()).data.content.contentId);
      expect(errors).toEqual([]);
    } catch (error) {
      console.log(type.title, 'browser errors:', errors);
      throw error;
    } finally {
      for (const id of ids) await request.delete(`http://localhost:8051/api/create/h5p-editor/contents/${id}`);
    }
  });
}
