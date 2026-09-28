import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import PDFDocument from 'pdfkit';
import AdmZip from 'adm-zip';
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';

const api = 'http://localhost:8152/api/create';
const reportDir = path.resolve(process.env.LUNA_STRESS_FIX_VERIFICATION === '1'
  ? 'docs/reports/gpt-6-luna-2026-09-28-fix-assets' : 'docs/reports/gpt-6-luna-2026-09-28-assets');

type Session = {
  id: string; status: string; error?: string; revision: number; currentVersionId: string | null;
  assistant?: { id: string; revision: number; objectives: Array<{ text: string; sourceReferences?: Array<{ materialId: string }> }>;
    plan: Array<{ title: string; questionType: string; count: number; instructions: string }>;
    errorCode?: string; generation?: { requestId: string; status: string; message: string; completedQuestions: number; reusedQuestions?: number;
      failedQuestions: number; items: Array<{ index: number; status: string; code?: string; message?: string }> } };
  versions: Array<{ id: string; number: number; questions: Array<{ type: string; text: string;
    explanation?: string; sourceReferences: Array<{ materialId: string }> }> }>;
};

async function pdf(title: string, paragraphs: string[]) {
  const document = new PDFDocument({ size: 'LETTER', margin: 55 });
  const chunks: Buffer[] = [];
  document.on('data', (part: Buffer) => chunks.push(part));
  document.fontSize(19).text(title).moveDown().fontSize(11);
  for (const paragraph of paragraphs) document.text(paragraph, { paragraphGap: 14 });
  const ended = once(document, 'end');
  document.end();
  await ended;
  return Buffer.concat(chunks);
}

async function readSession(request: APIRequestContext, id: string): Promise<Session> {
  const response = await request.get(`${api}/h5p-editor/authoring/sessions/${id}`);
  expect(response.ok(), `read authoring session: ${response.status()}`).toBe(true);
  return (await response.json()).data.session;
}

async function waitSession(request: APIRequestContext, id: string, statuses: string[], timeout: number) {
  let latest: Session | undefined;
  await expect.poll(async () => {
    latest = await readSession(request, id);
    return statuses.includes(latest.status);
  }, { timeout, intervals: [1500, 3000, 5000] }).toBe(true);
  return latest!;
}

async function createCourse(request: APIRequestContext, title: string) {
  const response = await request.post(`${api}/folders`, { data: { name: `${title} ${Date.now()}`, quizCount: 1 } });
  expect(response.ok(), `create isolated course: ${response.status()}`).toBe(true);
  return (await response.json()).data.folder._id as string;
}

async function waitForMaterials(request: APIRequestContext, courseId: string, count: number, timeout: number) {
  let latest: Array<{ _id: string; processingStatus: string }> = [];
  await expect.poll(async () => {
    const response = await request.get(`${api}/materials/folder/${courseId}`);
    expect(response.ok()).toBe(true);
    latest = (await response.json()).data.materials;
    return { count: latest.length, ready: latest.filter(material => material.processingStatus === 'completed').length,
      failed: latest.filter(material => material.processingStatus === 'failed').length };
  }, { timeout, intervals: [2000, 4000, 6000] }).toEqual({ count, ready: count, failed: 0 });
  return latest;
}

async function capture(page: Page, filename: string) {
  await page.screenshot({ path: path.join(reportDir, filename), fullPage: true });
}

test('upper-bound live run: 20 PDFs, a 20-question plan, durable H5P output', async ({ page, request }) => {
  test.setTimeout(1_800_000);
  await fs.mkdir(reportDir, { recursive: true });
  const typeOnly = process.env.LUNA_STRESS_QUESTION_MIX === 'true-false';
  const result: Record<string, unknown> = { model: 'gpt-6-luna', startedAt: new Date().toISOString(),
    materialCount: 0, questionCount: 0, questionMix: typeOnly ? 'true-false' : 'mixed', passed: false };
  try {
    const courseId = await createCourse(request, 'Luna 20-material stress QA');
    result.courseId = courseId;
    await page.goto(`/h5p-studio?create=workspace&courseId=${courseId}`);
    await expect(page.getByRole('region', { name: 'Studio AI workspace' })).toBeVisible();
    const skip = page.getByRole('button', { name: 'Skip tutorials' });
    if (await skip.isVisible().catch(() => false)) await skip.click();

    const files = [];
    for (let index = 1; index <= 20; index++) {
      const number = String(index).padStart(2, '0');
      files.push({ name: `rain-garden-card-${number}.pdf`, mimeType: 'application/pdf', buffer: await pdf(`Rain Garden Card ${number}`, [
        `Card ${number} records a distinct observation for a campus rain garden. The monitored location is Plot ${number}.`,
        `At Plot ${number}, runoff reaches the planting bed from a paved path. The inlet needs inspection after storms so sediment does not block it.`,
        `A rain garden can slow some runoff at Plot ${number} when the soil accepts water, but it cannot promise to stop flooding in every storm.`,
        `The accessible route beside Plot ${number} must stay firm, clear and free of standing water. A maintenance owner must check plants, sediment and overflow.`
      ]) });
    }
    await page.getByRole('button', { name: 'Add tools and materials' }).click();
    await page.getByLabel('Upload course materials').setInputFiles(files);
    await expect(page.getByRole('button', { name: '20 materials attached' })).toBeVisible({ timeout: 180000 });
    await capture(page, '21-limit-20-uploaded.png');
    const materials = await waitForMaterials(request, courseId, 20, 300000);
    result.materialCount = materials.length;
    result.materialProcessing = '20/20 completed';
    await capture(page, '22-limit-20-ready.png');

    await page.getByLabel('Upload course materials').setInputFiles({ name: 'rain-garden-card-21.pdf', mimeType: 'application/pdf',
      buffer: await pdf('Rain Garden Card 21', ['This is an intentionally rejected 21st source.']) });
    await expect(page.getByRole('alert')).toContainText('up to 20 materials');
    await expect(page.getByRole('button', { name: '20 materials attached' })).toBeVisible();
    result.twentyFirstRejected = true;
    await capture(page, '23-limit-21st-rejected.png');

    await page.getByRole('textbox', { name: 'Message Studio AI' }).fill(
      'Create exactly 20 first-year self-check questions from the 20 attached rain-garden cards. ' +
      (typeOnly ? 'Use only True/False questions. ' : 'Use a mix of Multiple Choice and True/False. ') +
      'Generate learning objectives from the materials. ' +
      (process.env.LUNA_STRESS_GROUNDED_SCOPE === '1'
        ? 'Test only facts explicitly stated in the cards: runoff versus infiltration, keeping accessible routes clear, inlet inspections and the maintenance owner checking overflow. Do not ask students to determine safe-overflow design criteria, which are not supplied. '
        : 'Test runoff versus infiltration, safe overflow, accessible routes and maintenance. ') +
      'Do not invent measured runoff reductions or claim any garden prevents all flooding. ' +
      'Use the material evidence in each explanation. Let me review the plan before generating.');
    await page.getByRole('button', { name: 'Start learning activity' }).click();
    await expect(page).toHaveURL(/authoringSession=/);
    const taskId = new URL(page.url()).searchParams.get('authoringSession')!;
    result.taskId = taskId;
    await page.reload();
    await expect(page.getByRole('region', { name: 'Studio AI workspace' })).toBeVisible();
    const planned = await waitSession(request, taskId, ['awaiting_approval', 'needs_attention'], 360000);
    result.planningStatus = planned.status;
    result.planningError = planned.error || '';
    result.groundedScope = process.env.LUNA_STRESS_GROUNDED_SCOPE === '1';
    result.proposedPlan = planned.assistant?.plan.map(row => ({ type: row.questionType, count: row.count }));
    expect(planned.status, planned.error || 'Planning did not complete').toBe('awaiting_approval');
    await expect(page.getByRole('button', { name: /Accept plan & generate/ })).toBeVisible({ timeout: 30000 });
    await capture(page, '24-limit-plan.png');
    const planRows = planned.assistant?.plan || [];
    const proposedTotal = planRows.reduce((sum, row) => sum + row.count, 0);
    result.proposedQuestionCount = proposedTotal;
    if (typeOnly) expect(planRows.every(row => row.questionType === 'true-false'), 'Requested True/False-only plan').toBe(true);
    if (proposedTotal !== 20) {
      const counts = planRows.map((_, index) => index === 0 ? 21 - planRows.length : 1);
      for (let index = 0; index < counts.length; index++) {
        await page.getByRole('spinbutton', { name: `Question count for plan row ${index + 1}` }).fill(String(counts[index]));
      }
      await page.getByRole('button', { name: 'Save plan' }).click();
      await expect(page.getByRole('button', { name: 'Save plan' })).toHaveCount(0);
      result.manuallyAdjustedPlan = true;
    }
    await expect(page.getByRole('button', { name: /Accept plan & generate/ })).toBeEnabled();
    await capture(page, '25-limit-approved-plan.png');
    await page.getByRole('button', { name: /Accept plan & generate/ }).click();
    await page.reload();
    let completed = await waitSession(request, taskId, ['ready', 'needs_attention'], 900000);
    if (completed.status === 'needs_attention' && process.env.LUNA_STRESS_RETRY_FAILED === '1') {
      result.firstAttempt = completed.assistant?.generation;
      const firstRequestId = completed.assistant?.generation?.requestId;
      await expect(page.getByRole('button', { name: 'Resume task' })).toBeVisible({ timeout: 30000 });
      await page.getByRole('region', { name: 'Questions needing attention' }).scrollIntoViewIfNeeded();
      await capture(page, '26-limit-first-attempt.png');
      await page.getByRole('button', { name: 'Resume task' }).click();
      await expect.poll(async () => (await readSession(request, taskId)).assistant?.generation?.requestId,
        { timeout: 30000 }).not.toBe(firstRequestId);
      completed = await waitSession(request, taskId, ['ready', 'needs_attention'], 900000);
      result.retryCount = 1;
      expect(completed.assistant?.generation?.reusedQuestions).toBe((result.firstAttempt as { completedQuestions: number }).completedQuestions);
    }
    result.finalStatus = completed.status;
    result.finalError = completed.error || '';
    result.generation = completed.assistant?.generation;
    result.assistantErrorCode = completed.assistant?.errorCode;
    if (completed.status !== 'ready') {
      await page.reload();
      await expect(page.getByRole('alert')).toContainText('question batch failed', { timeout: 30000 });
      await page.getByRole('alert').scrollIntoViewIfNeeded();
      await capture(page, '26-limit-needs-attention.png');
    }
    expect(completed.status, completed.error || 'Question generation did not complete').toBe('ready');
    const version = completed.versions.find(item => item.id === completed.currentVersionId);
    expect(version).toBeTruthy();
    result.questionCount = version!.questions.length;
    result.questionTypes = [...new Set(version!.questions.map(question => question.type))];
    result.citedMaterialCount = new Set(version!.questions.flatMap(question => question.sourceReferences.map(ref => ref.materialId))).size;
    result.questions = version!.questions.map(question => ({ type: question.type, text: question.text,
      explanation: question.explanation, sourceMaterialIds: question.sourceReferences.map(ref => ref.materialId) }));
    expect(version!.questions).toHaveLength(20);
    await page.reload();
    await page.getByRole('tab', { name: 'Questions & sources' }).click();
    await capture(page, '27-limit-20-questions.png');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download H5P' }).click();
    const download = await downloadPromise;
    const zip = new AdmZip((await download.path())!);
    result.packageEntries = zip.getEntries().length;
    result.packageHasManifest = !!zip.getEntry('h5p.json');
    expect(result.packageHasManifest).toBe(true);
    result.passed = true;
  } catch (error) {
    result.failure = error instanceof Error ? error.message : String(error);
    await capture(page, '28-limit-failure.png').catch(() => {});
    throw error;
  } finally {
    result.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(reportDir, 'stress-20-result.json'), JSON.stringify(result, null, 2));
  }
});

test('conflicting-source live run: preserve uncertainty in the reviewed activity', async ({ page, request }) => {
  test.setTimeout(900000);
  await fs.mkdir(reportDir, { recursive: true });
  const result: Record<string, unknown> = { model: 'gpt-6-luna', startedAt: new Date().toISOString(), passed: false };
  try {
    const courseId = await createCourse(request, 'Luna contradictory evidence QA');
    result.courseId = courseId;
    await page.goto(`/h5p-studio?create=workspace&courseId=${courseId}`);
    await expect(page.getByRole('region', { name: 'Studio AI workspace' })).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Add course materials' }).click();
    await page.getByLabel('Upload course materials').setInputFiles([
      { name: 'east-lawn-study-a.pdf', mimeType: 'application/pdf', buffer: await pdf('East Lawn Study A', [
        'Study A reports an infiltration rate of 50 millimetres per hour at East Lawn on 15 September 2025, based on a field test.',
        'This suggests East Lawn may accept runoff quickly. The result is preliminary and should be checked before a rain-garden design is approved.'
      ]) },
      { name: 'east-lawn-study-b.pdf', mimeType: 'application/pdf', buffer: await pdf('East Lawn Study B', [
        'Study B reports an infiltration rate of 5 millimetres per hour at East Lawn on 15 September 2025, based on a field test.',
        'This conflicts with Study A at the same location and date. The discrepancy may reflect method or measurement error; both reports need reconciliation.'
      ]) }
    ]);
    await expect(page.getByRole('button', { name: '2 materials attached' })).toBeVisible({ timeout: 60000 });
    await waitForMaterials(request, courseId, 2, 180000);
    await capture(page, '29-conflict-sources.png');
    await page.getByRole('textbox', { name: 'Message Studio AI' }).fill(
      'Create exactly two first-year multiple-choice questions using both East Lawn studies. ' +
      'The studies report conflicting infiltration rates for the same place and date: 50 versus 5 millimetres per hour. ' +
      'Do not present either rate as settled fact. Ask learners what the discrepancy means and what evidence or retesting is needed. ' +
      'Explain the uncertainty and cite both sources. Let me review the plan first.');
    await page.getByRole('button', { name: 'Start learning activity' }).click();
    await expect(page).toHaveURL(/authoringSession=/);
    const taskId = new URL(page.url()).searchParams.get('authoringSession')!;
    result.taskId = taskId;
    let planned = await waitSession(request, taskId, ['awaiting_approval', 'needs_attention'], 300000);
    if (process.env.LUNA_STRESS_FORCE_BATCH_ROW === '1' && planned.assistant?.plan.length) {
      const previous = JSON.parse(await fs.readFile(path.resolve('docs/reports/gpt-6-luna-2026-09-28-assets/stress-conflict-first-result.json'), 'utf8'));
      const response = await request.put(`${api}/h5p-editor/assistant/sessions/${planned.assistant.id}/plan`, { data: {
        revision: planned.assistant.revision, objectives: planned.assistant.objectives,
        plan: [{ ...planned.assistant.plan[0], count: 2, instructions: previous.plan[0].instructions }]
      } });
      expect(response.ok()).toBe(true);
      planned = await readSession(request, taskId);
      result.forcedOriginalBatchInstructions = true;
      await page.reload();
    }
    result.planningStatus = planned.status;
    result.planningError = planned.error || '';
    result.groundedScope = process.env.LUNA_STRESS_GROUNDED_SCOPE === '1';
    result.objectives = planned.assistant?.objectives.map(item => item.text);
    result.plan = planned.assistant?.plan;
    await expect(page.getByRole('button', { name: /Accept plan & generate/ })).toBeVisible({ timeout: 30000 });
    const skip = page.getByRole('button', { name: 'Skip tutorials' });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await capture(page, '30-conflict-plan.png');
    expect(planned.status, planned.error || 'Conflict planning failed').toBe('awaiting_approval');
    const rows = planned.assistant?.plan || [];
    if (rows.reduce((sum, row) => sum + row.count, 0) !== 2) {
      for (let index = 0; index < rows.length; index++) {
        await page.getByRole('spinbutton', { name: `Question count for plan row ${index + 1}` }).fill(index === 0 ? String(3 - rows.length) : '1');
      }
      await page.getByRole('button', { name: 'Save plan' }).click();
      await expect(page.getByRole('button', { name: 'Save plan' })).toHaveCount(0);
      result.manuallyAdjustedPlan = true;
    }
    await page.getByRole('button', { name: /Accept plan & generate/ }).click();
    const completed = await waitSession(request, taskId, ['ready', 'needs_attention'], 420000);
    result.finalStatus = completed.status;
    result.finalError = completed.error || '';
    result.generation = completed.assistant?.generation;
    result.assistantErrorCode = completed.assistant?.errorCode;
    if (completed.status !== 'ready') {
      await expect(page.getByRole('alert')).toContainText('question batch failed', { timeout: 30000 });
      await page.getByRole('alert').scrollIntoViewIfNeeded();
      await capture(page, '31-conflict-needs-attention.png');
    }
    expect(completed.status, completed.error || 'Conflict generation failed').toBe('ready');
    const version = completed.versions.find(item => item.id === completed.currentVersionId)!;
    result.questions = version.questions;
    expect(version.questions).toHaveLength(2);
    const combined = version.questions.map(question => `${question.text} ${question.explanation || ''}`).join(' ').toLowerCase();
    result.mentionsUncertainty = /conflict|disagree|uncertain|discrepan|different|retest|reconcile|verify/.test(combined);
    result.mentionsBothRates = /50/.test(combined) && /5/.test(combined);
    result.citedMaterialCount = new Set(version.questions.flatMap(question => question.sourceReferences.map(ref => ref.materialId))).size;
    await page.reload();
    await page.getByRole('tab', { name: 'Questions & sources' }).click();
    await capture(page, '32-conflict-questions.png');
    expect(result.mentionsUncertainty, 'Generated questions should acknowledge the source conflict').toBe(true);
    expect(result.citedMaterialCount, 'The two source documents should both be cited across questions').toBe(2);
    result.passed = true;
  } catch (error) {
    result.failure = error instanceof Error ? error.message : String(error);
    await capture(page, '33-conflict-failure.png').catch(() => {});
    throw error;
  } finally {
    result.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(reportDir, 'stress-conflict-result.json'), JSON.stringify(result, null, 2));
  }
});
