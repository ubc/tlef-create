import { canvas } from '@ubc/ubc-genai-toolkit-lms-integration';
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import sanitizeHtml from 'sanitize-html';
import Material from '../models/Material.js';
import Folder from '../models/Folder.js';
import { FILE_CONFIG } from '../config/constants.js';
import processingJobs from './processingJobService.js';
import { getClient, getBaseUrl } from './canvasApiService.js';

export const CANVAS_IMPORT_BATCH_LIMIT = 10;
const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const fail = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
const id = value => /^\d+$/.test(String(value ?? ''));
const cleanName = name => path.basename(String(name || 'Canvas material').replaceAll('\\', '/')).slice(0, 255);

export function canvasImportFailure(error) {
  if (error.code === 'CANVAS_RECONNECT_REQUIRED' || error.statusCode === 401) {
    return { code: 'CANVAS_RECONNECT_REQUIRED', message: 'Reconnect Canvas and try again. If this continues, ask the administrator to enable material read permissions.' };
  }
  if (error.statusCode === 403) return { code: 'CANVAS_IMPORT_PERMISSION', message: 'Canvas denied access. Reconnect Canvas; the administrator may need to enable file and page read permissions.' };
  if (error.statusCode === 404) return { code: 'CANVAS_RESOURCE_UNAVAILABLE', message: 'This Canvas material is no longer available in the selected course.' };
  if (error.statusCode === 413) return { code: 'CANVAS_FILE_TOO_LARGE', message: 'This file exceeds the configured material size limit.' };
  if (error.code?.startsWith('CANVAS_IMPORT_')) return { code: error.code, message: error.message };
  return { code: 'CANVAS_IMPORT_FAILED', message: 'This material could not be imported. Try again; successful materials are kept.' };
}

export function canvasPageText(html) {
  const separated = String(html || '').replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-6]|tr|section)>/gi, '\n');
  return sanitizeHtml(separated, { allowedTags: [], allowedAttributes: {}, nonTextTags: ['script', 'style', 'textarea', 'noscript'] })
    .replace(/&#(x[\da-f]+|\d+);/gi, (_match, code) => {
      const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
    })
    .replace(/&(nbsp|amp|lt|gt|quot|apos);/g, (_match, key) => ({ nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[key])
    .replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function fileType(file) {
  const ext = path.extname(cleanName(file.filename || file.name)).toLowerCase();
  const mime = file.mimeType?.split(';')[0]?.toLowerCase();
  if (ext === '.pdf' && [PDF, 'application/octet-stream', undefined].includes(mime)) return 'pdf';
  if (ext === '.docx' && [DOCX, 'application/octet-stream', undefined].includes(mime)) return 'docx';
  return null;
}

// Composition keeps Canvas retrieval separate from shared Material persistence/indexing.
export function createCanvasMaterialImportService({
  clientFor = getClient, baseUrl = getBaseUrl, Materials = Material, Folders = Folder,
  queue = processingJobs, storage = fs, uploadPath = FILE_CONFIG.UPLOAD_PATH
} = {}) {
  async function ownedFolder(userId, folderId) {
    if (!mongoose.isValidObjectId(folderId)) throw fail('CANVAS_IMPORT_INVALID_REQUEST', 'Choose a valid CREATE course.');
    const folder = await Folders.findOne({ _id: folderId, instructor: userId });
    if (!folder) throw fail('CANVAS_IMPORT_FOLDER_NOT_FOUND', 'CREATE course not found.', 404);
    return folder;
  }
  async function teacherClient(userId, courseId) {
    if (!id(courseId)) throw fail('CANVAS_IMPORT_INVALID_REQUEST', 'Choose a valid Canvas course.');
    const client = await clientFor(userId);
    const courses = await canvas.getCourses(client, { enrollment_type: 'teacher' });
    if (!courses.some(c => c.id === String(courseId))) throw fail('CANVAS_IMPORT_COURSE_ACCESS', 'Choose a Canvas course where you are enrolled as a teacher.', 403);
    return client;
  }
  async function courses(userId, folderId) {
    await ownedFolder(userId, folderId);
    const result = await canvas.getCourses(await clientFor(userId), { enrollment_type: 'teacher' });
    return result.map(c => ({ id: c.id, name: c.name, courseCode: c.code || '' }));
  }
  async function catalog(userId, folderId, courseId) {
    await ownedFolder(userId, folderId);
    const client = await teacherClient(userId, courseId);
    const results = await Promise.allSettled([
      canvas.getCourseFiles(client, courseId), client.getAll(`/courses/${courseId}/pages`)
    ]);
    const resources = [];
    const warnings = [];
    results.forEach((result, index) => {
      if (result.status === 'rejected') { warnings.push({ resourceType: index === 0 ? 'file' : 'page', ...canvasImportFailure(result.reason) }); return; }
      for (const value of result.value) {
        if (index === 0) {
          const type = fileType(value);
          const supported = Boolean(type) && !(value.size > FILE_CONFIG.MAX_FILE_SIZE);
          resources.push({ id: value.id, resourceType: 'file', name: cleanName(value.name), materialType: type,
            size: value.size, supported, reason: supported ? undefined : type ? 'File exceeds the material size limit.' : 'Convert this file to PDF or DOCX before importing.' });
        } else if (id(value.page_id)) {
          resources.push({ id: String(value.page_id), resourceType: 'page', name: cleanName(value.title), materialType: 'text', supported: true });
        }
      }
    });
    return { resources, warnings, batchLimit: CANVAS_IMPORT_BATCH_LIMIT, maxFileBytes: FILE_CONFIG.MAX_FILE_SIZE };
  }
  async function importBatch(userId, folderId, courseId, resources) {
    if (!Array.isArray(resources) || !resources.length || resources.length > CANVAS_IMPORT_BATCH_LIMIT
      || resources.some(r => !r || !id(r.id) || !['file', 'page'].includes(r.resourceType))) {
      throw fail('CANVAS_IMPORT_INVALID_REQUEST', `Select between 1 and ${CANVAS_IMPORT_BATCH_LIMIT} valid materials.`);
    }
    await ownedFolder(userId, folderId);
    const client = await teacherClient(userId, courseId);
    const unique = [...new Map(resources.map(r => [`${r.resourceType}:${r.id}`, { id: String(r.id), resourceType: r.resourceType }])).values()];
    const results = [];
    // Sequential downloads cap memory and preserve partial success; indexing uses the shared queue.
    for (const resource of unique) {
      let storedPath;
      let saved;
      let name = `${resource.resourceType === 'page' ? 'Page' : 'File'} ${resource.id}`;
      try {
        const source = { instance: baseUrl(), courseId: String(courseId), resourceType: resource.resourceType, resourceId: String(resource.id) };
        const sourceQuery = Object.fromEntries(Object.entries(source).map(([key, value]) => [`canvasSource.${key}`, value]));
        let data;
        let bytes;
        if (resource.resourceType === 'page') {
          const page = await client.get(`/courses/${courseId}/pages/${resource.id}`);
          name = cleanName(page.title);
          const content = canvasPageText(page.body);
          if (!content) throw fail('CANVAS_IMPORT_EMPTY_PAGE', 'This Canvas page has no readable text.');
          if (Buffer.byteLength(content) > 2 * 1024 * 1024) throw fail('CANVAS_IMPORT_PAGE_TOO_LARGE', 'This page is too large. Split it into smaller pages.');
          bytes = Buffer.from(content);
          data = { name, type: 'text', content, fileSize: bytes.length };
          source.updatedAt = page.updated_at;
        } else {
          const metadata = await client.get(`/courses/${courseId}/files/${resource.id}`);
          name = cleanName(metadata.display_name || metadata.filename);
          const type = fileType({ filename: metadata.filename || metadata.display_name, mimeType: metadata['content-type'] || metadata.content_type });
          if (!type) throw fail('CANVAS_IMPORT_UNSUPPORTED_FILE', 'Only PDF and DOCX files can be imported.');
          if (metadata.size > FILE_CONFIG.MAX_FILE_SIZE) throw fail('CANVAS_IMPORT_FILE_TOO_LARGE', 'This file exceeds the configured material size limit.');
          const file = await canvas.downloadFile(client, courseId, resource.id, { maxBytes: FILE_CONFIG.MAX_FILE_SIZE, via: 'public-url' });
          bytes = Buffer.from(file.data);
          if (type === 'pdf' && !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw fail('CANVAS_IMPORT_INVALID_FILE', 'The downloaded file is not a readable PDF.');
          if (type === 'docx') {
            const entries = new AdmZip(bytes).getEntries();
            if (!entries.some(e => e.entryName === 'word/document.xml') || !entries.some(e => e.entryName === '[Content_Types].xml')
              || entries.reduce((sum, e) => sum + e.header.size, 0) > 100 * 1024 * 1024) {
              throw fail('CANVAS_IMPORT_INVALID_FILE', 'The downloaded file is not a supported DOCX document.');
            }
          }
          data = { name, type, originalFileName: cleanName(metadata.filename || metadata.display_name), fileSize: bytes.length, mimeType: type === 'pdf' ? PDF : DOCX };
          source.updatedAt = metadata.updated_at;
        }
        const checksum = crypto.createHash('md5').update(bytes).digest('hex');
        const existing = await Materials.findOne({ folder: folderId, checksum });
        if (existing) {
          results.push({ ...resource, name, status: 'skipped', materialId: String(existing._id), message: 'This content is already in the CREATE course.' });
          continue;
        }
        const previous = await Materials.findOne({ folder: folderId, ...sourceQuery });
        if (previous) data.name = `${name.slice(0, 230)} (Canvas update)`;
        if (resource.resourceType === 'file') {
          await storage.mkdir(uploadPath, { recursive: true });
          storedPath = path.join(uploadPath, `canvas-${crypto.randomUUID()}.${data.type}`);
          await storage.writeFile(storedPath, bytes, { flag: 'wx' });
          data.filePath = storedPath;
        }
        saved = await Materials.create({ ...data, folder: folderId, uploadedBy: userId, checksum,
          canvasSource: { ...source, importedAt: new Date() }, processingStatus: 'pending' });
        try {
          const attached = await Folders.updateOne({ _id: folderId, instructor: userId }, {
            $addToSet: { materials: saved._id }, $inc: { 'stats.totalMaterials': 1 }, $set: { 'stats.lastActivity': new Date() }
          });
          if (attached.matchedCount === 0) throw fail('CANVAS_IMPORT_FOLDER_NOT_FOUND', 'CREATE course no longer exists.', 404);
        } catch (error) { await Materials.deleteOne({ _id: saved._id }); saved = null; throw error; }
        try { await queue.enqueueProcessingJob(saved._id, data.type === 'text' ? 'text' : 'document'); }
        catch { await saved.markAsFailed('Import saved, but processing could not start. Select Retry on the material card.'); }
        results.push({ ...resource, name: data.name, status: 'imported', materialId: String(saved._id),
          message: previous ? 'Saved as a new version. Existing materials were kept.' : 'Saved to CREATE. Check the material card for processing status.' });
      } catch (error) {
        if (storedPath && !saved) await storage.unlink(storedPath).catch(() => {});
        if (error.code === 11000) {
          results.push({ ...resource, name, status: 'skipped', message: 'This version was already imported by another request.' });
        } else results.push({ ...resource, name, status: 'failed', ...canvasImportFailure(error) });
      }
    }
    return { results, summary: { imported: results.filter(r => r.status === 'imported').length,
      skipped: results.filter(r => r.status === 'skipped').length, failed: results.filter(r => r.status === 'failed').length } };
  }
  return { courses, catalog, importBatch };
}

export default createCanvasMaterialImportService();
