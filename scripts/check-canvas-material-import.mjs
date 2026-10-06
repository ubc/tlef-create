// Local, read-only feasibility check. No Material records, embeddings, or LLM calls.
import 'dotenv/config';
import mongoose from 'mongoose';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { canvas } from '@ubc/ubc-genai-toolkit-lms-integration';
import { getMongoUri } from '../routes/create/config/database.js';
import { canvasConfig, createCanvasConnection } from '../routes/create/services/canvasToolkitConnection.js';
import { createCanvasTokenStore } from '../routes/create/services/canvasTokenStore.js';
import FileService from '../routes/create/services/fileService.js';

const [userId, courseId, fileId, expectedPdfPath] = process.argv.slice(2);
if (!mongoose.isValidObjectId(userId) || !/^\d+$/.test(courseId || '') || !/^\d+$/.test(fileId || '')) {
  console.error('Usage: node scripts/check-canvas-material-import.mjs <CREATE-user-id> <Canvas-course-id> <PDF-file-id> [expected-PDF-path]');
  process.exit(1);
}
const config = canvasConfig();
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.canvasDomain).hostname)) {
  console.error('This verification script is restricted to local Canvas.');
  process.exit(1);
}
const report = { checkedAt: new Date().toISOString(), canvasHost: new URL(config.canvasDomain).host, courseId, fileId, checks: [] };
let stage = 'connection';
let tempDir;
const checked = (name, details = {}) => report.checks.push({ name, passed: true, ...details });
try {
  await mongoose.connect(getMongoUri(), { serverSelectionTimeoutMS: 5000 });
  const connection = createCanvasConnection({ config, tokenStore: createCanvasTokenStore(config.canvasDomain) });
  const client = await connection.getClient(userId);
  stage = 'teacher-course-access';
  const courses = await canvas.getCourses(client, { enrollment_type: 'teacher' });
  assert(courses.some(c => c.id === courseId), 'Course must be in the instructor course list');
  checked(stage, { teacherCourseCount: courses.length });

  stage = 'list-files';
  const files = await canvas.getCourseFiles(client, courseId);
  assert(files.some(f => f.id === fileId));
  checked(stage, { count: files.length });

  stage = 'page-bodies';
  const pages = await client.getAll(`/courses/${courseId}/pages`);
  let bodyCount = 0;
  for (const page of pages) {
    const result = await client.get(`/courses/${courseId}/pages/${encodeURIComponent(page.url)}`);
    assert(typeof result.body === 'string');
    if (result.body.trim()) bodyCount++;
  }
  checked(stage, { count: pages.length, nonemptyBodies: bodyCount });

  stage = 'module-items';
  const modules = await client.getAll(`/courses/${courseId}/modules`);
  const types = new Set();
  let itemCount = 0;
  for (const module of modules) {
    const items = await client.getAll(`/courses/${courseId}/modules/${module.id}/items`);
    itemCount += items.length;
    for (const item of items) types.add(item.type);
  }
  checked(stage, { moduleCount: modules.length, itemCount, types: [...types].sort() });

  stage = 'signed-link-issuance';
  const link = await client.get(`/files/${fileId}/public_url`);
  assert(typeof link.public_url === 'string' && link.public_url.trim());
  checked(stage);

  // Prefer public-url for scoped Developer Keys; signed links must not be logged.
  stage = 'download-pdf';
  const download = await canvas.downloadFile(client, courseId, fileId, { maxBytes: 1024 * 1024, via: 'public-url' });
  assert.equal(download.contentType?.split(';')[0], 'application/pdf');
  assert(download.size > 0);
  const validation = FileService.validateFile({ originalname: download.filename, mimetype: 'application/pdf', size: download.size });
  assert(validation.isValid);
  const hash = createHash('sha256').update(download.data).digest('hex');
  if (expectedPdfPath) assert.equal(hash, createHash('sha256').update(await readFile(expectedPdfPath)).digest('hex'));
  checked(stage, { bytes: download.size, createUploadValidation: true, ...(expectedPdfPath ? { originalBytesMatch: true } : {}) });

  stage = 'parse-pdf-with-create';
  tempDir = await mkdtemp(path.join(tmpdir(), 'create-canvas-import-'));
  const pdfPath = path.join(tempDir, 'download.pdf');
  await writeFile(pdfPath, download.data);
  process.env.RAG_SKIP_AUTO_INIT = 'true';
  const { QuizRAGService } = await import('../routes/create/services/ragService.js');
  const parser = new QuizRAGService({ autoInitialize: false });
  const parsed = await parser.parsePdfPages(pdfPath);
  assert(parsed.some(p => p.content.trim()));
  checked(stage, { pages: parsed.length, textCharacters: parsed.reduce((sum, p) => sum + p.content.length, 0) });

  stage = 'size-limit';
  await assert.rejects(canvas.downloadFile(client, courseId, fileId, { maxBytes: 1, via: 'public-url' }), error => error.statusCode === 413);
  checked(stage, { rejectedWith: 413 });

  report.passed = true;
  report.scope = 'Canvas reads, file bytes, CREATE file validation and local PDF parsing only';
  report.llmCalls = 0;
  report.embeddingCalls = 0;
} catch (error) {
  // Error messages/URLs may contain signed links or private upstream content.
  report.passed = false;
  report.failedStage = stage;
  report.error = { status: error.statusCode || error.status || null, code: error.code || error.canvasError || 'CHECK_FAILED' };
  process.exitCode = 1;
} finally {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  await mongoose.disconnect();
  console.log(JSON.stringify(report, null, 2));
}
