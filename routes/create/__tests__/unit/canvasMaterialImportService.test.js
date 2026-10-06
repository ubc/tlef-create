import { beforeEach, afterEach, expect, jest, test } from '@jest/globals';
import { canvas } from '@ubc/ubc-genai-toolkit-lms-integration';
import AdmZip from 'adm-zip';
import { createCanvasMaterialImportService, canvasPageText } from '../../services/canvasMaterialImportService.js';

const folderId = '507f1f77bcf86cd799439011';
let client, Materials, Folders, queue, storage, service, clientFor;
beforeEach(() => {
  client = { getAll: jest.fn(), get: jest.fn() };
  client.getAll.mockResolvedValue([{ id: 2, name: 'Teacher course' }]);
  Materials = { findOne: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ _id: 'new-material', markAsFailed: jest.fn() }), deleteOne: jest.fn() };
  Folders = { findOne: jest.fn().mockResolvedValue({ _id: folderId }), updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }) };
  queue = { enqueueProcessingJob: jest.fn() };
  storage = { mkdir: jest.fn(), writeFile: jest.fn(), unlink: jest.fn().mockResolvedValue() };
  clientFor = jest.fn().mockResolvedValue(client);
  service = createCanvasMaterialImportService({ clientFor, baseUrl: () => 'https://canvas.example.edu', Materials, Folders, queue, storage, uploadPath: '/test/uploads' });
});
afterEach(() => jest.restoreAllMocks());

test('checks CREATE ownership before consulting Canvas', async () => {
  Folders.findOne.mockResolvedValue(null);
  await expect(service.importBatch('other', folderId, '2', [{ id: '4', resourceType: 'file' }])).rejects.toMatchObject({ status: 404 });
  expect(clientFor).not.toHaveBeenCalled();
  expect(Materials.create).not.toHaveBeenCalled();
});
test('requires teacher membership even when a caller knows another course ID', async () => {
  await expect(service.importBatch('owner', folderId, '99', [{ id: '4', resourceType: 'file' }])).rejects.toMatchObject({ status: 403 });
  expect(client.get).not.toHaveBeenCalled();
});
test('rejects an invalid or oversized batch before downloads', async () => {
  for (const resources of [[], [{ id: '../files/9', resourceType: 'file' }], Array.from({ length: 11 }, (_, i) => ({ id: String(i), resourceType: 'page' }))]) {
    await expect(service.importBatch('owner', folderId, '2', resources)).rejects.toMatchObject({ status: 400 });
  }
  expect(clientFor).not.toHaveBeenCalled();
});
test('shows a denied file listing while retaining available pages and excluding private fields', async () => {
  client.getAll.mockImplementation(async route => {
    if (route === '/courses') return [{ id: 2 }];
    if (route.endsWith('/files')) throw new canvas.CanvasApiError('private signed URL', 403);
    return [{ page_id: 1, title: 'Lesson', body: 'private body', url: 'signed URL' }];
  });
  const catalog = await service.catalog('owner', folderId, '2');
  expect(catalog.resources).toEqual([{ id: '1', resourceType: 'page', name: 'Lesson', materialType: 'text', supported: true }]);
  expect(catalog.warnings[0].code).toBe('CANVAS_IMPORT_PERMISSION');
  expect(JSON.stringify(catalog)).not.toContain('private');
});
test('converts page HTML to readable text and removes scripts, styles, and markup', () => {
  expect(canvasPageText('<h2>Force &amp; motion</h2><p>F = ma&nbsp;.</p><script>secret()</script><style>.secret {}</style><p>&#945; &lt; 2</p>'))
    .toBe('Force & motion\nF = ma .\nα < 2');
});
test('imports a page through the shared Material queue with stable provenance', async () => {
  client.get.mockResolvedValue({ page_id: 1, title: 'Lesson', body: '<p>F = ma</p>', updated_at: '2026-10-05' });
  const result = await service.importBatch('owner', folderId, '2', [{ id: '1', resourceType: 'page', injected: 'ignored' }]);
  expect(result.summary).toEqual({ imported: 1, skipped: 0, failed: 0 });
  expect(Materials.create).toHaveBeenCalledWith(expect.objectContaining({
    type: 'text', content: 'F = ma', folder: folderId, uploadedBy: 'owner',
    canvasSource: expect.objectContaining({ instance: 'https://canvas.example.edu', courseId: '2', resourceType: 'page', resourceId: '1', updatedAt: '2026-10-05' })
  }));
  expect(queue.enqueueProcessingJob).toHaveBeenCalledWith('new-material', 'text');
  expect(JSON.stringify(result)).not.toContain('injected');
});
test('skips unchanged content without saving or spending embedding calls', async () => {
  client.get.mockResolvedValue({ title: 'Lesson', body: 'same source' });
  Materials.findOne.mockResolvedValue({ _id: 'existing' });
  const result = await service.importBatch('owner', folderId, '2', [{ id: '1', resourceType: 'page' }, { id: '1', resourceType: 'page' }]);
  expect(result.summary.skipped).toBe(1);
  expect(Materials.create).not.toHaveBeenCalled();
  expect(queue.enqueueProcessingJob).not.toHaveBeenCalled();
});
test('a changed source creates a snapshot without changing the existing Material', async () => {
  client.get.mockResolvedValue({ title: 'Lesson', body: 'updated source' });
  Materials.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ _id: 'old-version' });
  const result = await service.importBatch('owner', folderId, '2', [{ id: '1', resourceType: 'page' }]);
  expect(result.results[0].name).toBe('Lesson (Canvas update)');
  expect(Materials.deleteOne).not.toHaveBeenCalled();
});
test('keeps successful imports when another selected source fails and sanitizes the error', async () => {
  client.get.mockRejectedValueOnce(new canvas.CanvasApiError('private course detail', 403))
    .mockResolvedValueOnce({ title: 'Lesson', body: 'readable content' });
  const result = await service.importBatch('owner', folderId, '2', [{ id: '1', resourceType: 'page' }, { id: '2', resourceType: 'page' }]);
  expect(result.summary).toEqual({ imported: 1, skipped: 0, failed: 1 });
  expect(result.results[0].code).toBe('CANVAS_IMPORT_PERMISSION');
  expect(JSON.stringify(result)).not.toContain('private');
});
test.each(['pdf', 'docx'])('saves a bounded %s file in CREATE storage', async type => {
  let data = Buffer.from('%PDF-1.7 synthetic');
  if (type === 'docx') {
    const zip = new AdmZip(); zip.addFile('word/document.xml', Buffer.from('<w:document/>')); zip.addFile('[Content_Types].xml', Buffer.from('<Types/>')); data = zip.toBuffer();
  }
  client.get.mockResolvedValue({ id: 4, filename: `lesson.${type}`, display_name: 'Lesson', size: data.length });
  jest.spyOn(canvas, 'downloadFile').mockResolvedValue({ data, size: data.length });
  const result = await service.importBatch('owner', folderId, '2', [{ id: '4', resourceType: 'file' }]);
  expect(result.summary.imported).toBe(1);
  expect(storage.writeFile).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`\\.${type}$`)), data, { flag: 'wx' });
  expect(queue.enqueueProcessingJob).toHaveBeenCalledWith('new-material', 'document');
  expect(Materials.create.mock.calls[0][0].filePath).toMatch(new RegExp(`\\.${type}$`));
});
test('does not trust a renamed HTML file or allow unsupported slides', async () => {
  client.get.mockResolvedValueOnce({ filename: 'fake.pdf' }).mockResolvedValueOnce({ filename: 'slides.pptx' });
  jest.spyOn(canvas, 'downloadFile').mockResolvedValue({ data: Buffer.from('<html>Sign in</html>') });
  const result = await service.importBatch('owner', folderId, '2', [{ id: '4', resourceType: 'file' }, { id: '5', resourceType: 'file' }]);
  expect(result.summary.failed).toBe(2);
  expect(Materials.create).not.toHaveBeenCalled();
});
test('cleans a saved file if registration fails before a Material exists', async () => {
  client.get.mockResolvedValue({ filename: 'lesson.pdf' });
  jest.spyOn(canvas, 'downloadFile').mockResolvedValue({ data: Buffer.from('%PDF-1.7 synthetic') });
  Materials.create.mockRejectedValue(new Error('database unavailable'));
  const result = await service.importBatch('owner', folderId, '2', [{ id: '4', resourceType: 'file' }]);
  expect(result.summary.failed).toBe(1);
  expect(storage.unlink).toHaveBeenCalledWith(storage.writeFile.mock.calls[0][0]);
});
test('retains a registered material with a recoverable failure when indexing cannot be queued', async () => {
  client.get.mockResolvedValue({ title: 'Lesson', body: 'readable source' });
  queue.enqueueProcessingJob.mockRejectedValue(new Error('queue unavailable'));
  const result = await service.importBatch('owner', folderId, '2', [{ id: '1', resourceType: 'page' }]);
  expect(result.summary.imported).toBe(1);
  expect((await Materials.create.mock.results[0].value).markAsFailed).toHaveBeenCalled();
});
