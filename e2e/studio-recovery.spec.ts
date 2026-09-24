import { expect, test } from '@playwright/test';
import AdmZip from 'adm-zip';

test('Studio recovers a generation after refresh, edits, previews, exports and reimports', async ({ page, request }) => {
  const ids = new Set<string>();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto('/h5p-studio?create=ai');
    await page.getByLabel('Activity type', { exact: true }).selectOption('H5P.Chart 1.2');
    await page.getByLabel('Teaching instructions').fill('Chart the tree survey: Oak 12 and Pine 8.');
    const accepted = page.waitForResponse(r => r.url().endsWith('/ai/jobs') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Generate AI draft' }).click();
    const receipt = (await (await accepted).json()).data.job;
    await page.reload();
    await expect(page.getByText('Independent Studio draft', { exact: true })).toBeVisible({ timeout: 30000 });
    const id = new URL(page.url()).searchParams.get('contentId')!;
    ids.add(id);
    // Repeating the same request must recover the existing receipt, not charge again.
    const repeated = await request.post('http://localhost:8051/api/create/h5p-editor/ai/jobs', { data: { requestId: receipt.requestId } });
    expect((await repeated.json()).data.job.contentId).toBe(id);
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeEnabled({ timeout: 30000 });
    await page.frameLocator('iframe.h5p-editor-iframe').getByRole('textbox').first().fill('Reviewed tree survey');
    await page.getByRole('button', { name: 'Save & preview' }).click();
    const preview = page.frameLocator('iframe.h5p-studio-preview');
    await expect(preview.locator('.h5p-container')).toBeVisible({ timeout: 30000 });
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const file = await (await downloaded).path();
    expect(file).toBeTruthy();
    const zip = new AdmZip(file!);
    expect(JSON.parse(zip.readAsText('h5p.json')).mainLibrary).toBe('H5P.Chart');
    expect(JSON.parse(zip.readAsText('h5p.json')).title).toBe('Reviewed tree survey');
    expect(zip.readAsText('content/content.json')).toContain('Oak');
    const imported = page.waitForResponse(r => r.url().endsWith('/contents/import'));
    await page.locator('input[type=file]').setInputFiles({ name: 'tree-survey.h5p', mimeType: 'application/zip', buffer: zip.toBuffer() });
    const importBody = await (await imported).json();
    expect(importBody.data.content.contentId).not.toBe(id);
    ids.add(importBody.data.content.contentId);
    await expect(save).toBeEnabled();
    expect(errors).toEqual([]);
  } finally {
    for (const id of ids) await request.delete(`http://localhost:8051/api/create/h5p-editor/contents/${id}`);
  }
});
