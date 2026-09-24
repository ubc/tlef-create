import { expect, test } from '@playwright/test';
import AdmZip from 'adm-zip';

test('materials → objectives → blueprint → questions → review → native export', async ({ page, request }) => {
  test.setTimeout(120000);
  const api = 'http://localhost:8051/api/create';
  const created = await request.post(`${api}/folders`, { data: { name: `Workflow acceptance ${Date.now()}`, quizCount: 1 } });
  const folder = (await created.json()).data.folder;
  const quizId = folder.quizzes[0]._id;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`/course/${folder._id}`);
    const skipTour = page.getByRole('button', { name: 'Skip tutorials', exact: true }).first();
    await skipTour.waitFor({ state: 'visible', timeout: 5000 }).then(() => skipTour.click()).catch(() => {});
    await page.getByRole('button', { name: 'Add Text', exact: true }).click();
    await page.getByPlaceholder('Paste your text content here...').fill('Photosynthesis. Plants use sunlight, carbon dioxide and water to produce glucose and oxygen. Chlorophyll captures light energy in chloroplasts. Glucose stores chemical energy that plants use for growth. Sunlight is the energy source, while carbon dioxide supplies the carbon used in sugar.');
    const materialRequest = page.waitForResponse(r => r.url().endsWith('/materials/text') && r.request().method() === 'POST');
    await page.locator('.text-form').getByRole('button', { name: 'Add Text', exact: true }).click();
    const materialId = (await (await materialRequest).json()).data.material._id;
    await expect.poll(async () => {
      const result = await request.get(`${api}/materials/${materialId}/status`);
      return (await result.json()).data?.material?.processingStatus;
    }, { timeout: 45000 }).toBe('completed');
    await page.goto(`/course/${folder._id}/quiz/${quizId}?tab=materials`);
    await page.getByText('Click to assign', { exact: true }).click();
    await page.getByRole('button', { name: 'Next: Set Learning Objectives' }).click();
    await page.getByRole('button', { name: 'Generate Complete Learning Objectives' }).click();
    await expect(page.getByRole('button', { name: 'Next: Generate Questions' })).toBeVisible({ timeout: 45000 });
    await page.getByRole('button', { name: 'Next: Generate Questions' }).click();
    await expect(page.getByRole('radio', { name: 'ASSESS', exact: true })).toBeVisible();
    await page.locator('label').filter({ has: page.getByRole('radio', { name: 'ASSESS', exact: true }) }).click();
    await page.locator('label.generation-layout-choice').filter({ has: page.getByRole('radio', { name: 'Question Set', exact: true }) }).click();
    await page.getByRole('button', { name: 'AI Auto Mode', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Let CREATE recommend the quiz length based on LO complexity and materials' }).uncheck();
    await page.getByLabel('How many questions do you want to generate?').fill('1');
    await page.getByRole('button', { name: 'Generate Plan', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Generate 1 Question', exact: true })).toBeEnabled({ timeout: 30000 });
    await page.getByRole('button', { name: 'Generate 1 Question', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Continue to Review' })).toBeVisible({ timeout: 45000 });
    await page.getByRole('button', { name: 'Back to AI Plan Configuration' }).click();
    await expect(page.getByRole('radio', { name: 'Question Set', exact: true })).toBeChecked();
    await page.reload();
    await page.getByRole('button', { name: 'Continue to Review' }).click();
    await expect(page.getByRole('heading', { name: 'Review Questions', exact: true })).toBeVisible();
    await page.getByRole('navigation', { name: 'Quiz creation steps' }).getByRole('button', { name: /^Preview/ }).click();
    await expect(page.frameLocator('iframe[title="H5P Quiz Preview"]').locator('#h5p-native-preview')).toBeVisible({ timeout: 30000 });
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export to H5P', exact: true }).click();
    const file = await (await download).path();
    const zip = new AdmZip(file!);
    expect(JSON.parse(zip.readAsText('h5p.json')).mainLibrary).toBe('H5P.QuestionSet');
    expect(zip.readAsText('content/content.json')).toContain('Sunlight');
    expect(errors).toEqual([]);
  } finally {
    await request.delete(`${api}/folders/${folder._id}`).catch(() => {});
  }
});
