import { test, expect, type Page } from '@playwright/test';

const task = {
  id: 'task1', title: 'Water cycles · first-year self-check', courseId: 'course1', quizId: 'quiz1', materialIds: ['material1'],
  instructions: 'Create a short first-year activity about the water cycle.', autoApprove: false, revision: 4,
  status: 'awaiting_approval', error: '', currentVersionId: null, candidateVersionId: null, versions: [],
  messages: [
    { id: 'm1', role: 'user', text: 'Create a short first-year activity about the water cycle. Focus on common misconceptions.', createdAt: '2026-09-27' },
    { id: 'm2', role: 'assistant', text: 'Your teaching plan is ready. Review the learning objectives, evidence and question mix, then choose Accept plan & generate. You can also tell me what to change.', createdAt: '2026-09-27' }
  ],
  assistant: { id: 'assistant1', courseId: 'course1', quizId: 'quiz1', materialIds: ['material1'], revision: 2, status: 'awaiting_approval',
    objectives: [
      { id: 'lo1', text: 'Explain how evaporation and condensation move water through the environment.', sourceReferences: [{ materialId: 'material1', materialName: 'Water cycle lecture.pdf', pageNumber: 3 }] },
      { id: 'lo2', text: 'Apply the water cycle to explain a familiar everyday observation.', sourceReferences: [] }
    ],
    plan: [
      { id: 'row1', title: 'Recognise the processes', questionType: 'multiple-choice', count: 3, objectiveIds: ['lo1'], instructions: 'Use plausible distractors based on common misconceptions.' },
      { id: 'row2', title: 'Connect the ideas', questionType: 'true-false', count: 2, objectiveIds: ['lo2'], instructions: 'Use everyday examples and explain each answer.' }
    ], outputs: [], events: [] },
  run: { id: 'run1', status: 'succeeded', checkpoint: 'planning' }, updatedAt: '2026-09-27'
};
async function fixture(page: Page, state: Record<string, unknown> = task) {
  const calls: Array<{ path: string; body: unknown }> = [];
  const uploaded: Array<{ _id: string; name: string; processingStatus: string }> = [];
  await page.route('**/api/create/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/create', '');
    const body = route.request().method() === 'POST' && route.request().headers()['content-type']?.includes('application/json') ? route.request().postDataJSON() : undefined;
    if (path.endsWith('/preview')) return route.fulfill({ contentType: 'text/html', body: '<html><body style="font:16px system-ui;padding:24px;color:#28443a"><h2>Water cycle practice</h2><p>H5P preview fixture</p><p>Which process changes liquid water into water vapour?</p><p>◯ Evaporation</p><p>◯ Condensation</p></body></html>' });
    if (body) calls.push({ path, body });
    if (path === '/materials/upload') calls.push({ path, body: 'multipart' });
    let data: Record<string, unknown> = {};
    if (path === '/auth/me') data = { authenticated: true, user: { _id: 'owner1', id: 'owner1', cwlId: 'qa', displayName: 'Demo instructor', canUseEnvKey: true } };
    else if (path === '/folders') data = { folders: [{ _id: 'course1', name: 'Introduction to Earth Science', quizzes: [], materials: [], stats: {} }] };
    else if (path === '/materials/upload') { const material = { _id: `material${uploaded.length + 2}`, name: `New course material ${uploaded.length + 1}`, processingStatus: 'processing' }; uploaded.push(material); data = { materials: [material] }; }
    else if (path === '/materials' || path.includes('/materials')) data = { materials: [{ _id: 'material1', name: 'Water cycle lecture.pdf', processingStatus: 'completed' }, ...uploaded] };
    else if (path === '/h5p-editor/contents') data = { contents: [] };
    else if (path === '/h5p-editor/authoring/sessions') data = body ? { session: state } : { sessions: [state] };
    else if (path.startsWith('/h5p-editor/authoring/sessions/')) data = { session: state };
    await route.fulfill({ contentType: 'application/json', json: { success: true, data } });
  });
  return calls;
}

test('composer tools and drag-and-drop upload work with a deferred course choice', async ({ page }, info) => {
  const calls = await fixture(page);
  await page.goto('/h5p-studio?create=workspace');
  const skip = page.getByRole('button', { name: 'Skip tutorials' });
  await skip.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
  if (await skip.isVisible()) await skip.click();
  await page.getByRole('button', { name: 'Task history' }).click();
  await expect(page.getByRole('textbox', { name: 'Search task history' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('conversation-history.png'), fullPage: true });
  await page.getByRole('button', { name: 'Task history' }).click();
  await page.getByRole('button', { name: 'Add tools and materials' }).click();
  await expect(page.getByRole('menuitem', { name: /Upload files/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath('tools-menu.png'), fullPage: true });
  await page.getByLabel('Upload course materials').setInputFiles({ name: 'Lecture.pdf', mimeType: 'application/pdf', buffer: Buffer.from('Lecture notes') });
  await expect(page.getByText('Files waiting for a course')).toBeVisible();
  await page.getByRole('region', { name: 'Studio AI workspace' }).evaluate(element => {
    const data = new DataTransfer();
    data.items.add(new File(['Second material'], 'Practice.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: data }));
  });
  await expect(page.getByText('Files waiting for a course')).toBeVisible();
  await expect(page.getByText('2 files')).toBeVisible();
  expect(calls.filter(call => call.path === '/materials/upload')).toHaveLength(0);
  await page.screenshot({ path: info.outputPath('files-waiting-for-course.png'), fullPage: true });
  await expect(page.getByRole('button', { name: 'Start learning activity' })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Course' }).selectOption('course1');
  await expect(page.getByRole('button', { name: '2 materials attached' })).toBeVisible();
  expect(calls.filter(call => call.path === '/materials/upload')).toHaveLength(2);
  await expect(page.getByLabel('Upload course materials')).toBeHidden();
  await page.screenshot({ path: info.outputPath('uploaded-material.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await skip.isVisible()) await skip.click();
  await page.getByRole('button', { name: 'Add tools and materials' }).click();
  await expect(page.getByRole('menuitem', { name: /Choose course materials/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath('tools-menu-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('materials-first welcome fits desktop and mobile and creates a saved task', async ({ page }, info) => {
  const calls = await fixture(page);
  await page.goto('/h5p-studio?create=workspace&courseId=course1');
  await expect(page.getByRole('region', { name: 'Studio AI workspace' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /What will your students/ })).toBeVisible();
  const skip = page.getByRole('button', { name: 'Skip tutorials' });
  if (await skip.isVisible()) await skip.click();
  await page.screenshot({ path: info.outputPath('welcome-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Add course materials' }).click();
  await page.getByRole('checkbox', { name: /Water cycle lecture.pdf/ }).check();
  await page.getByRole('button', { name: 'Start learning activity' }).click();
  await expect(page).toHaveURL(/authoringSession=task1/);
  expect(calls[0].body).toMatchObject({ courseId: 'course1', materialIds: ['material1'], instructions: '', autoApprove: false });
  await expect(page.getByRole('button', { name: 'Accept plan & generate' })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('teaching-plan-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('teaching-plan-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('restores saved tasks without mutation and refuses to approve unsaved plan edits', async ({ page }, info) => {
  const calls = await fixture(page);
  await page.goto('/h5p-studio?create=workspace&authoringSession=task1');
  const objective = page.getByRole('textbox', { name: 'Learning objective 1' });
  await expect(objective).toBeVisible();
  expect(calls).toHaveLength(0);
  await objective.fill('Explain why condensation appears on a cold surface.');
  await expect(page.getByRole('button', { name: 'Accept plan & generate' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('plan-edit.png'), fullPage: true });
});

test('compares a proposal with the current version and sends an explicit acceptance', async ({ page }, info) => {
  const version = { id: 'v1', number: 1, parentId: null, restoredFromId: null, contentId: 'content1', title: 'Water cycle practice',
    summary: 'Initial activity', changes: [], representation: 'course-linked', state: 'accepted', createdAt: '2026-09-27',
    questions: [{ id: 'q1', index: 1, type: 'multiple-choice', text: 'Which process changes liquid water into water vapour?', sourceReferences: [] }] };
  const state = { ...task, status: 'ready', currentVersionId: 'v1', candidateVersionId: 'v2',
    versions: [version, { ...version, id: 'v2', number: 2, parentId: 'v1', contentId: 'content2', state: 'candidate', changes: ['Revised question 1; all other questions are preserved.'] }] };
  const calls = await fixture(page, state);
  await page.goto('/h5p-studio?create=workspace&authoringSession=task1');
  const viewing = page.getByLabel('Viewing');
  await expect(viewing).toHaveValue('v2');
  const skip = page.getByRole('button', { name: 'Skip tutorials' });
  if (await skip.isVisible()) await skip.click();
  await viewing.selectOption('v1');
  await expect(page.locator('iframe[title="Preview Water cycle practice"]')).toHaveAttribute('src', /content1/);
  await viewing.selectOption('v2');
  await page.screenshot({ path: info.outputPath('proposed-version.png'), fullPage: true });
  expect(calls).toHaveLength(0);
  await page.getByRole('button', { name: 'Accept changes', exact: true }).click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0]).toMatchObject({ path: '/h5p-editor/authoring/sessions/task1/accept', body: { versionId: 'v2', revision: 4 } });
});
