import { expect, test } from '@playwright/test';

test('authenticated instructor can create a course through the production build', async ({ page, request }) => {
  const pageErrors: string[] = [];
  const serverErrors: string[] = [];
  let createdCourseId = '';

  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
  });

  try {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Create Course' })).toBeVisible();

    await page.getByRole('button', { name: 'Create Course' }).click();
    await page.getByLabel('Course Name').fill(`E2E Course ${Date.now()}`);
    await page.getByRole('button', { name: /Next/ }).click();

    const createResponsePromise = page.waitForResponse(response => (
      response.request().method() === 'POST'
      && response.url().includes('/api/create/folders')
    ));
    await page.getByRole('button', { name: 'Skip for Now' }).click();
    const createResponse = await createResponsePromise;
    expect(createResponse.status()).toBe(201);

    const createBody = await createResponse.json();
    createdCourseId = createBody.data?.folder?._id || '';
    expect(createdCourseId).not.toBe('');
    await expect(page).toHaveURL(new RegExp(`/course/${createdCourseId}`));
    expect(pageErrors).toEqual([]);
    expect(serverErrors).toEqual([]);
  } finally {
    if (createdCourseId) {
      await request.delete(`http://localhost:8051/api/create/folders/${createdCourseId}`);
    }
  }
});
