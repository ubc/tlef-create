import { expect, test } from '@playwright/test';
import PDFDocument from 'pdfkit';
import AdmZip from 'adm-zip';
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';

const reportDir = path.resolve('docs/reports/gpt-6-luna-2026-09-28-assets');
const api = 'http://localhost:8051/api/create';
type LiveSession = {
  status: string; error?: string; revision: number; currentVersionId: string | null;
  candidateVersionId: string | null;
  assistant?: { id: string; revision: number; objectives: unknown[]; plan: Array<Record<string, unknown>> };
  versions: Array<{ id: string; questions?: unknown[] }>;
};
const facts = [
  'The water cycle moves water among Earth’s surface, the atmosphere, and living things.',
  'Evaporation changes liquid water into water vapour when energy warms the water. It does not turn water into oxygen.',
  'Condensation changes water vapour into liquid droplets when humid air cools. Condensation is the reverse change from evaporation.',
  'Precipitation occurs when water droplets or ice crystals become heavy enough to fall from clouds.',
  'Runoff carries water over land back to rivers, lakes, and oceans. Infiltration moves water into soil.',
  'A useful everyday observation is droplets forming on the outside of a cold drink: water vapour in the air condenses on the cold surface.',
  'In the water cycle, the Sun provides much of the energy driving evaporation. Gravity helps precipitation and runoff move water downward.'
];

async function syntheticPdf() {
  const doc = new PDFDocument({ size: 'LETTER', margin: 55 });
  const chunks: Buffer[] = [];
  doc.on('data', (part: Buffer) => chunks.push(part));
  doc.fontSize(20).text('Water Cycle: Instructor QA Material');
  doc.moveDown().fontSize(11);
  for (const fact of facts) doc.text(fact, { paragraphGap: 12 });
  const ended = once(doc, 'end');
  doc.end();
  await ended;
  return Buffer.concat(chunks);
}

test('live gpt-6-luna authoring from PDF to H5P with approval and version restoration', async ({ page, request }) => {
  test.setTimeout(600000);
  await fs.mkdir(reportDir, { recursive: true });
  const started = new Date();
  const steps: Array<{ title: string; status: string; detail: string; screenshot?: string; elapsedMs?: number }> = [];
  let taskId = '';
  let quizId = '';
  let materialId = '';
  let questionCount = 0;
  let versionCount = 0;
  const screenshot = async (filename: string) => {
    await page.screenshot({ path: path.join(reportDir, filename), fullPage: true });
    return filename;
  };
  const step = async (title: string, detail: string, filename?: string) => {
    const image = filename ? await screenshot(filename) : undefined;
    steps.push({ title, status: 'passed', detail, screenshot: image, elapsedMs: Date.now() - +started });
  };
  const task = async () => {
    const response = await request.get(`${api}/h5p-editor/authoring/sessions/${taskId}`);
    expect(response.ok()).toBe(true);
    return (await response.json()).data.session as LiveSession;
  };
  const waitStatus = async (expected: string, timeout = 180000) => {
    let latest: LiveSession | undefined;
    await expect.poll(async () => {
      latest = await task();
      if (latest.status === 'needs_attention') throw new Error(`Authoring task needs attention: ${latest.error}`);
      return latest.status;
    }, { timeout, intervals: [1000, 2500, 4000] }).toBe(expected);
    return latest!;
  };
  try {
    const created = await request.post(`${api}/folders`, { data: { name: `Luna QA Water Cycle ${Date.now()}`, quizCount: 1 } });
    expect(created.ok()).toBe(true);
    const folder = (await created.json()).data.folder;
    quizId = folder.quizzes[0]._id;
    const courseId = folder._id;
    await page.goto(`/h5p-studio?create=workspace&courseId=${courseId}`);
    await expect(page.getByRole('region', { name: 'Studio AI workspace' })).toBeVisible();
    const skip = page.getByRole('button', { name: 'Skip tutorials' });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await step('打开对话工作区', '真实前端页面显示 Create with AI 新入口。', '01-workspace.png');

    await page.getByRole('button', { name: 'Add course materials' }).click();
    await page.locator('input[aria-label="Upload course materials"]').setInputFiles({
      name: 'water-cycle-qa.pdf', mimeType: 'application/pdf', buffer: await syntheticPdf()
    });
    await expect(page.getByRole('checkbox', { name: /water-cycle-qa Ready/ })).toBeVisible({ timeout: 30000 });
    const materialResponse = await request.get(`${api}/materials/folder/${courseId}`);
    materialId = (await materialResponse.json()).data.materials[0]._id;
    await expect.poll(async () => {
      const response = await request.get(`${api}/materials/${materialId}/status`);
      if (!response.ok()) {
        const listing = await request.get(`${api}/materials/folder/${courseId}`);
        return (await listing.json()).data.materials.find((m: { _id: string; processingStatus: string }) => m._id === materialId)?.processingStatus;
      }
      const body = await response.json();
      return body.data?.material?.processingStatus || body.data?.status;
    }, { timeout: 180000, intervals: [2000, 3000, 5000] }).toBe('completed');
    await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 15000 });
    await step('上传并处理 PDF', '浏览器上传合成课程材料；Mongo 状态为 completed，材料进入隔离 Qdrant collection。', '02-material-ready.png');

    const lo = await request.post(`${api}/objectives`, { data: [{ quizId,
      text: 'Explain the difference between evaporation and condensation using the supplied water-cycle evidence.' }] });
    expect(lo.ok(), `create objective: ${lo.status()}`).toBe(true);
    await page.getByLabel('Learning Object').selectOption(quizId);
    await page.getByRole('textbox', { name: 'Message Studio AI' }).fill('Create a short, source-grounded first-year self-check. Ask about evaporation versus condensation; include useful explanations.');
    await page.getByRole('button', { name: 'Start learning activity' }).click();
    await expect(page).toHaveURL(/authoringSession=/);
    taskId = new URL(page.url()).searchParams.get('authoringSession') || '';
    expect(taskId).toBeTruthy();
    const planned = await waitStatus('awaiting_approval', 240000);
    expect(planned.assistant?.plan?.length).toBeGreaterThan(0);
    await page.reload();
    await expect(page.getByRole('button', { name: /Accept plan & generate/ })).toBeVisible();
    await step('模型提出教学计划', '真实 gpt-6-luna 在已有课程 LO 与 PDF 证据基础上生成计划，并等待教师确认。', '03-plan-review.png');

    const first = planned.assistant.plan[0];
    const planUpdate = await request.put(`${api}/h5p-editor/assistant/sessions/${planned.assistant.id}/plan`, { data: {
      revision: planned.assistant.revision,
      objectives: planned.assistant.objectives,
      plan: [{ ...first, title: 'Evaporation or condensation', questionType: 'multiple-choice', count: 1,
        instructions: 'Ask exactly one evidence-grounded question contrasting evaporation and condensation. Include one correct answer, plausible distractors, and feedback.' }]
    } });
    expect(planUpdate.ok(), `save bounded plan: ${planUpdate.status()}`).toBe(true);
    await page.reload();
    await expect(page.getByRole('button', { name: /Accept plan & generate/ })).toBeEnabled();
    await page.getByRole('button', { name: /Accept plan & generate/ }).click();
    const ready = await waitStatus('ready', 360000);
    expect(ready.currentVersionId).toBeTruthy();
    questionCount = ready.versions.find(v => v.id === ready.currentVersionId)?.questions?.length || 0;
    expect(questionCount).toBeGreaterThan(0);
    await page.reload();
    await page.getByRole('tab', { name: 'Preview' }).click();
    await expect(page.locator('iframe.h5p-studio-preview')).toBeVisible({ timeout: 30000 });
    await expect(page.frameLocator('iframe.h5p-studio-preview').locator('.h5p-container')).toBeVisible({ timeout: 30000 });
    await step('确认后生成 H5P', `真实模型生成 ${questionCount} 道问题，并保存可运行的 H5P 活动。`, '04-h5p-preview.png');
    await page.getByRole('tab', { name: 'Questions & sources' }).click();
    await expect(page.getByText(/QUESTION 1/i)).toBeVisible();
    await step('检查问题与来源', '核对生成问题、解释及来源面板。', '05-questions-sources.png');
    await page.getByRole('tab', { name: 'Preview' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download H5P' }).click();
    const file = await (await download).path();
    expect(file).toBeTruthy();
    const zip = new AdmZip(file!);
    expect(JSON.parse(zip.readAsText('h5p.json')).mainLibrary).toBe('H5P.Column');
    expect(zip.readAsText('content/content.json')).toContain('H5P.MultiChoice');
    await step('下载标准 H5P 包', '验证归档包含 h5p.json、content/content.json 和 H5P Column/MultiChoice。');

    await page.getByRole('textbox', { name: 'Message Studio AI' }).fill('Please shorten the wording of question 1. Keep the cold drink scenario, the evaporation-versus-condensation topic, and the correct science.');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect.poll(async () => {
      const now = await task();
      if (now.status === 'needs_attention') throw new Error(`Revision failed: ${now.error}`);
      return now.candidateVersionId;
    }, { timeout: 240000, intervals: [1500, 3000] }).not.toBeNull();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Accept changes' })).toBeVisible();
    await expect(page.frameLocator('iframe.h5p-studio-preview').locator('.h5p-container')).toBeVisible({ timeout: 30000 });
    await step('提出单题修改', '模型将修改生成为候选版本；原版本仍可在预览中选择。', '06-proposed-version.png');
    await page.getByRole('button', { name: 'Accept changes' }).click();
    const accepted = await expect.poll(async () => (await task()).candidateVersionId,
      { timeout: 60000, intervals: [1000, 2000] }).toBeNull();
    void accepted;
    const afterAccept = await task();
    versionCount = afterAccept.versions.length;
    expect(versionCount).toBeGreaterThanOrEqual(2);
    await expect(page.getByRole('button', { name: 'Accept changes' })).toBeHidden();
    await expect(page.getByText('v2', { exact: true })).toBeVisible();
    await step('接受候选版本', '候选版本被明确接受，历史内容保留。', '07-accepted-version.png');
    const originalId = ready.currentVersionId;
    const restored = await request.post(`${api}/h5p-editor/authoring/sessions/${taskId}/restore`, { data: {
      requestId: crypto.randomUUID(), revision: afterAccept.revision, versionId: originalId
    } });
    expect(restored.ok()).toBe(true);
    await expect.poll(async () => (await task()).versions.length, { timeout: 60000 }).toBeGreaterThan(versionCount);
    versionCount = (await task()).versions.length;
    await page.reload();
    await expect(page.getByRole('region', { name: 'Studio AI workspace' })).toBeVisible();
    await expect(page.getByText(`v${versionCount}`, { exact: true })).toBeVisible();
    await expect(page.frameLocator('iframe.h5p-studio-preview').locator('.h5p-container')).toBeVisible({ timeout: 30000 });
    await step('恢复旧版本', `恢复创建了新版本；版本历史现在有 ${versionCount} 项。`, '08-restored-version.png');
  } catch (error) {
    steps.push({ title: '测试中断', status: 'failed', detail: error instanceof Error ? error.message : String(error), elapsedMs: Date.now() - +started });
    await screenshot('failure.png').catch(() => {});
    throw error;
  } finally {
    await fs.writeFile(path.join(reportDir, 'result.json'), JSON.stringify({
      model: 'gpt-6-luna', startedAt: started.toISOString(), finishedAt: new Date().toISOString(),
      passed: !steps.some(s => s.status === 'failed'), taskId, quizId, materialId,
      questionCount, versionCount, steps
    }, null, 2));
  }
});
