import { expect, test } from '@playwright/test';
import PDFDocument from 'pdfkit';
import AdmZip from 'adm-zip';
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';

const api = 'http://localhost:8051/api/create';
const reportDir = path.resolve('docs/reports/gpt-6-luna-2026-09-28-assets');
const documents = [
  { name: '01-hydrology.pdf', title: 'Rain Gardens: Hydrology Notes', facts: [
    'Runoff is rainwater flowing over a surface. Infiltration is rainwater entering soil. These processes can happen at the same site, but the surface and soil conditions affect their balance.',
    'A rain garden is a shallow planted area designed to receive runoff and allow some water to infiltrate. It does not guarantee that every storm will produce no surface water.',
    'Compacted soil admits water more slowly than loose, healthy soil. A paved surface offers little direct infiltration, so water often moves toward nearby drains or low points.',
    'The purpose of a site assessment is to follow water flow and check soils, not to assume every green patch is a suitable rain-garden location.'
  ] },
  { name: '02-campus-site.pdf', title: 'Campus Site Observation', facts: [
    'North Plaza has a large paved area and a downspout that sends roof runoff toward a low edge beside the plaza. Water often pools at that edge after heavy rain.',
    'East Lawn has an existing grass surface and receives less visible runoff. Its soil is not known to be suitable without an infiltration test.',
    'A rain garden near North Plaza could intercept a known runoff path if its soil and drainage are checked. Simply placing a garden on East Lawn would not necessarily address the plaza runoff.',
    'These observations are qualitative. No storm volume, infiltration rate, or flood reduction percentage was measured.'
  ] },
  { name: '03-maintenance-access.pdf', title: 'Maintenance and Access Constraints', facts: [
    'The accessible route around North Plaza must remain clear and firm. A planting area cannot obstruct this route or direct standing water across it.',
    'Rain gardens need periodic checks for sediment buildup, blocked inlets, plant health, and safe overflow paths. Neglect can reduce performance.',
    'A viable proposal should use local site observation, soil testing, an accessible design, and a maintenance owner. Choosing a location from pooling alone is insufficient.',
    'Communicate uncertainty honestly: a rain garden can reduce some runoff under suitable conditions, but it cannot be promised to eliminate flooding in every storm.'
  ] }
];

type Reference = { materialId: string; materialName?: string; pageNumber?: number };
type Objective = { id: string; text: string; sourceReferences: Reference[] };
type PlanRow = { id: string; title: string; questionType: string; count: number; objectiveIds: string[]; instructions: string; difficulty: string };
type Version = { id: string; number: number; contentId: string; questions: Array<{ index: number; type: string; text: string; sourceReferences: Reference[] }> };
type Session = { id: string; quizId: string | null; revision: number; status: string; error?: string;
  currentVersionId: string | null; candidateVersionId: string | null; versions: Version[];
  assistant?: { id: string; revision: number; objectives: Objective[]; plan: PlanRow[]; status: string } };

async function pdf(title: string, facts: string[]) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 55 });
  const chunks: Buffer[] = [];
  doc.on('data', (part: Buffer) => chunks.push(part));
  doc.fontSize(19).text(title).moveDown().fontSize(11);
  for (const fact of facts) doc.text(fact, { paragraphGap: 14 });
  const ended = once(doc, 'end');
  doc.end();
  await ended;
  return Buffer.concat(chunks);
}

test('complex live Luna task: three materials, generated objectives, four mixed questions and H5P', async ({ page, request }) => {
  test.setTimeout(900000);
  await fs.mkdir(reportDir, { recursive: true });
  const started = new Date();
  const result: {
    model: string; startedAt: string; finishedAt?: string; passed?: boolean; courseId?: string; taskId?: string; quizId?: string;
    materialIds: string[]; objectiveCount?: number; objectiveEvidenceMaterials?: number; proposedPlan?: Array<{ type: string; count: number }>;
    approvedPlan?: Array<{ type: string; count: number }>; questionCount?: number; questionTypes?: string[];
    questionEvidenceMaterials?: number; evidenceByMaterial?: Record<string, number>; retryCount: number;
    steps: Array<{ title: string; detail: string; screenshot?: string; elapsedMs: number; status: 'passed' | 'failed' }>;
    failure?: string;
  } = { model: 'gpt-6-luna', startedAt: started.toISOString(), materialIds: [], retryCount: 0, steps: [] };
  const capture = async (filename: string) => { await page.screenshot({ path: path.join(reportDir, filename), fullPage: true }); return filename; };
  const step = async (title: string, detail: string, image?: string) => result.steps.push({ title, detail,
    screenshot: image ? await capture(image) : undefined, elapsedMs: Date.now() - +started, status: 'passed' });
  const session = async () => {
    const response = await request.get(`${api}/h5p-editor/authoring/sessions/${result.taskId}`);
    expect(response.ok(), `task read: ${response.status()}`).toBe(true);
    return (await response.json()).data.session as Session;
  };
  const waitFor = async (expected: string, timeout: number) => {
    let latest: Session | undefined;
    await expect.poll(async () => {
      latest = await session();
      if (latest.status === 'needs_attention') throw new Error(latest.error || 'Task needs attention');
      return latest.status;
    }, { timeout, intervals: [1500, 3000, 5000] }).toBe(expected);
    return latest!;
  };
  try {
    const created = await request.post(`${api}/folders`, { data: { name: `Luna complex rain-garden QA ${Date.now()}`, quizCount: 1 } });
    expect(created.ok()).toBe(true);
    result.courseId = (await created.json()).data.folder._id;
    await page.goto(`/h5p-studio?create=workspace&courseId=${result.courseId}`);
    await expect(page.getByRole('region', { name: 'Studio AI workspace' })).toBeVisible();
    const skip = page.getByRole('button', { name: 'Skip tutorials' });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.getByRole('button', { name: 'Add course materials' }).click();
    for (const document of documents) {
      await page.locator('input[aria-label="Upload course materials"]').setInputFiles({ name: document.name,
        mimeType: 'application/pdf', buffer: await pdf(document.title, document.facts) });
      await expect(page.getByRole('checkbox', { name: new RegExp(document.name.replace('.pdf', '') + ' Ready') })).toBeVisible({ timeout: 60000 });
    }
    await expect.poll(async () => {
      const response = await request.get(`${api}/materials/folder/${result.courseId}`);
      const materials = (await response.json()).data.materials as Array<{ _id: string; processingStatus: string }>;
      if (materials.length === 3 && materials.every(m => m.processingStatus === 'completed')) result.materialIds = materials.map(m => m._id);
      return result.materialIds.length;
    }, { timeout: 180000, intervals: [2000, 3000] }).toBe(3);
    await step('三份材料已处理', '从 Studio 页面上传原理、场地观察与维护约束 PDF；三份材料均达到 completed。', '09-complex-materials.png');

    await page.getByRole('textbox', { name: 'Message Studio AI' }).fill(
      'Create a four-question first-year self-check about choosing and maintaining a campus rain garden. Use all three attached materials. Generate the learning objectives from the materials. Include exactly two Multiple Choice and two True/False questions. Ask learners to distinguish infiltration from runoff, compare North Plaza with East Lawn, and weigh drainage benefit against accessible-route and maintenance constraints. Ground explanations in the sources. Do not invent measurements or promise that a rain garden eliminates flooding. Let me review the plan before generating.');
    await page.getByRole('button', { name: 'Start learning activity' }).click();
    await expect(page).toHaveURL(/authoringSession=/);
    result.taskId = new URL(page.url()).searchParams.get('authoringSession') || '';
    expect(result.taskId).toBeTruthy();
    await page.reload();
    await expect(page.getByRole('region', { name: 'Studio AI workspace' })).toBeVisible();
    await step('长任务可恢复', '在模型建立学习目标与计划时刷新页面，再从保存的 session 继续观察进度。', '10-complex-running.png');

    const planned = await waitFor('awaiting_approval', 480000);
    expect(planned.assistant?.objectives.length).toBeGreaterThan(0);
    expect(planned.assistant?.plan.length).toBeGreaterThan(0);
    result.quizId = planned.quizId || undefined;
    result.objectiveCount = planned.assistant!.objectives.length;
    result.objectiveEvidenceMaterials = new Set(planned.assistant!.objectives.flatMap(lo => lo.sourceReferences.map(ref => ref.materialId))).size;
    result.proposedPlan = planned.assistant!.plan.map(row => ({ type: row.questionType, count: row.count }));
    await page.reload();
    await expect(page.getByRole('button', { name: /Accept plan & generate/ })).toBeVisible();
    await page.getByRole('tab', { name: 'Teaching plan' }).click();
    await step('自动生成 LO 与计划', `从三份 PDF 自动建立 ${result.objectiveCount} 个 LO，提出 ${planned.assistant!.plan.length} 行题目计划，并等待教师审批。`, '11-complex-plan.png');

    const proposed = planned.assistant!.plan;
    const proposedTypes = proposed.flatMap(row => Array.from({ length: row.count }, () => row.questionType)).sort();
    const desiredTypes = ['multiple-choice', 'multiple-choice', 'true-false', 'true-false'];
    const planMatches = JSON.stringify(proposedTypes) === JSON.stringify(desiredTypes) && proposed.every(row => row.count === 1);
    let approved = proposed;
    if (!planMatches) {
      const objectives = planned.assistant!.objectives;
      const choose = (expression: RegExp, fallback: number) => objectives.find(lo => expression.test(lo.text))?.id || objectives[Math.min(fallback, objectives.length - 1)].id;
      const mechanism = choose(/infiltrat|runoff|soil|water/i, 0);
      const decision = choose(/site|garden|mainten|access|design|plaza/i, 1);
      approved = [
        { id: 'complex-mc-1', title: 'Distinguish water movement', questionType: 'multiple-choice', count: 1,
          objectiveIds: [mechanism], difficulty: 'moderate', instructions: 'Ask one source-grounded question contrasting infiltration and runoff. Include plausible distractors and feedback; do not invent measurements.' },
        { id: 'complex-mc-2', title: 'Compare campus sites', questionType: 'multiple-choice', count: 1,
          objectiveIds: [decision], difficulty: 'moderate', instructions: 'Ask one source-grounded question comparing North Plaza and East Lawn using observed water movement and uncertainty. Include plausible distractors and feedback.' },
        { id: 'complex-tf-1', title: 'Protect access and maintain the garden', questionType: 'true-false', count: 1,
          objectiveIds: [decision], difficulty: 'moderate', instructions: 'Ask one source-grounded true/false question on accessible-route and maintenance constraints at North Plaza. Explain the answer.' },
        { id: 'complex-tf-2', title: 'Communicate limits honestly', questionType: 'true-false', count: 1,
          objectiveIds: [mechanism], difficulty: 'moderate', instructions: 'Ask one source-grounded true/false question explaining why a rain garden cannot be promised to eliminate all flooding. Explain the answer.' }
      ];
      const saved = await request.put(`${api}/h5p-editor/assistant/sessions/${planned.assistant!.id}/plan`, { data: {
        revision: planned.assistant!.revision, objectives, plan: approved
      } });
      expect(saved.ok(), `save four-question plan: ${saved.status()} ${await saved.text()}`).toBe(true);
    }
    result.approvedPlan = approved.map(row => ({ type: row.questionType, count: row.count }));
    await page.reload();
    await expect(page.getByRole('button', { name: /Accept plan & generate/ })).toBeEnabled();
    await page.getByRole('tab', { name: 'Teaching plan' }).click();
    await step('教师核对复杂计划', planMatches
      ? '模型本身建议 2 道多选 + 2 道判断题；教师在审批边界核对后直接接受。'
      : '模型建议与要求不符；教师在审批边界改为四行各一道题，并核对题型与数量。', '12-complex-approved-plan.png');
    await page.getByRole('button', { name: /Accept plan & generate/ }).click();
    let ready: Session;
    try { ready = await waitFor('ready', 660000); }
    catch (error) {
      const now = await session();
      if (now.status !== 'needs_attention') throw error;
      await page.reload();
      await expect(page.getByRole('button', { name: 'Resume task' })).toBeVisible();
      await step('显式恢复失败步骤', `任务遇到质量/生成错误，系统保留已保存状态；测试点击 Resume task 一次。错误：${now.error}`, '13-complex-needs-attention.png');
      result.retryCount = 1;
      await page.getByRole('button', { name: 'Resume task' }).click();
      ready = await waitFor('ready', 480000);
    }
    expect(ready.currentVersionId).toBeTruthy();
    const version = ready.versions.find(item => item.id === ready.currentVersionId)!;
    result.questionCount = version.questions.length;
    result.questionTypes = [...new Set(version.questions.map(q => q.type))].sort();
    const evidence = version.questions.flatMap(q => q.sourceReferences);
    result.questionEvidenceMaterials = new Set(evidence.map(ref => ref.materialId)).size;
    result.evidenceByMaterial = Object.fromEntries(result.materialIds.map(id => [id, evidence.filter(ref => ref.materialId === id).length]));
    expect(result.questionCount).toBe(4);
    expect(result.questionTypes).toEqual(['multiple-choice', 'true-false']);
    await page.reload();
    await expect(page.getByRole('region', { name: 'Studio AI workspace' })).toBeVisible();
    await page.getByRole('tab', { name: 'Preview' }).click();
    await expect(page.frameLocator('iframe.h5p-studio-preview').locator('.h5p-container')).toBeVisible({ timeout: 60000 });
    await step('四题混合 H5P 可运行', `系统保存 ${result.questionCount} 道题，包含 ${result.questionTypes.join(' 和 ')}；正式 H5P 预览可运行。`, '14-complex-preview.png');
    await page.getByRole('tab', { name: 'Questions & sources' }).click();
    await expect(page.getByText(/QUESTION 4/i)).toBeVisible();
    await step('逐题核对来源', `最终问题引用 ${result.questionEvidenceMaterials}/3 份材料；每题的来源与解释可在页面查看。`, '15-complex-sources.png');

    await page.getByRole('tab', { name: 'Preview' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download H5P' }).click();
    const zipPath = await (await download).path();
    expect(zipPath).toBeTruthy();
    const zip = new AdmZip(zipPath!);
    expect(JSON.parse(zip.readAsText('h5p.json')).mainLibrary).toBe('H5P.Column');
    const content = zip.readAsText('content/content.json');
    expect(content).toContain('H5P.MultiChoice');
    expect(content).toContain('H5P.TrueFalse');
    await step('下载多题型 H5P 包', '下载文件包含 H5P.Column、MultiChoice 与 TrueFalse 运行内容。');
    result.passed = true;
  } catch (error) {
    result.failure = error instanceof Error ? error.message : String(error);
    result.steps.push({ title: '测试中断', detail: result.failure, elapsedMs: Date.now() - +started, status: 'failed',
      screenshot: await capture('complex-failure.png').catch(() => undefined) });
    result.passed = false;
    throw error;
  } finally {
    result.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(reportDir, 'complex-result.json'), JSON.stringify(result, null, 2));
  }
});
