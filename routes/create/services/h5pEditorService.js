import crypto from 'node:crypto';
import { resolveNativeH5PContainerMode } from './h5pNativeDocumentConfig.js';

const MAX_LIBRARY_LENGTH = 200;
const MAX_TITLE_LENGTH = 255;

function asValidTimestamp(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

/**
 * Return the newest source timestamp that can change a generated H5P draft.
 * Questions and Learning Objectives are separate Mongo documents, so relying on
 * Quiz.updatedAt alone misses edits, regenerations, and reorder operations.
 */
export function getH5PSourceUpdatedAt(quiz) {
  const timestamps = [
    quiz?.updatedAt,
    ...(quiz?.questions || []).map(question => question?.updatedAt),
    ...(quiz?.learningObjectives || []).map(objective => objective?.updatedAt)
  ]
    .map(asValidTimestamp)
    .filter(timestamp => timestamp !== null);

  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps));
}

function normalizeFingerprintValue(value) {
  if (value === undefined || typeof value === 'function') return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toHexString === 'function') return value.toHexString();
  if (Array.isArray(value)) {
    return value.map(item => normalizeFingerprintValue(item));
  }

  const source = typeof value.toObject === 'function'
    ? value.toObject({ getters: false, virtuals: false })
    : value;
  return Object.keys(source)
    .sort()
    .reduce((normalized, key) => {
      const nextValue = normalizeFingerprintValue(source[key]);
      if (nextValue !== undefined) normalized[key] = nextValue;
      return normalized;
    }, {});
}

/**
 * Hash only fields that can change the generated native H5P document. This
 * avoids marking a Studio draft stale when export history, download counters,
 * progress, or other unrelated Quiz metadata updates the parent timestamp.
 */
export function buildH5PSourceFingerprint(quiz) {
  const source = {
    name: quiz?.name || '',
    containerMode: resolveNativeH5PContainerMode(quiz),
    chapters: (quiz?.chapters || []).map(chapter => ({
      title: chapter?.title || '',
      questionIds: (chapter?.questionIds || []).map(id => id?.toString?.() || String(id)),
      containerType: chapter?.containerType || 'column',
      passPercentage: chapter?.passPercentage ?? 50,
      disableBackwardsNavigation: Boolean(chapter?.disableBackwardsNavigation),
      randomizeQuestions: Boolean(chapter?.randomizeQuestions)
    })),
    learningObjectives: (quiz?.learningObjectives || []).map(objective => ({
      id: objective?._id?.toString?.() || '',
      order: objective?.order ?? 0,
      text: objective?.text || ''
    })),
    questions: (quiz?.questions || []).map(question => ({
      id: question?._id?.toString?.() || '',
      order: question?.order ?? 0,
      type: question?.type || '',
      questionText: question?.questionText || '',
      content: question?.content || {},
      correctAnswer: question?.correctAnswer ?? null,
      explanation: question?.explanation || ''
    }))
  };
  const serialized = JSON.stringify(normalizeFingerprintValue(source));
  return `v1:${crypto.createHash('sha256').update(serialized).digest('hex')}`;
}

export function isGeneratedH5PDraftOutdated(content, quiz) {
  if (!content?.sourceFingerprint) return true;
  return content.sourceFingerprint !== buildH5PSourceFingerprint(quiz);
}

export function normalizeEditorPayload(body = {}) {
  const library = typeof body.library === 'string' ? body.library.trim() : '';
  const metadata = body.params?.metadata;
  const parameters = body.params?.params;

  if (!library || library.length > MAX_LIBRARY_LENGTH || !metadata || parameters === undefined) {
    const error = new Error('The H5P editor payload is malformed.');
    error.code = 'INVALID_H5P_EDITOR_PAYLOAD';
    throw error;
  }

  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    const error = new Error('H5P metadata must be an object.');
    error.code = 'INVALID_H5P_EDITOR_PAYLOAD';
    throw error;
  }

  const rawTitle = typeof metadata.title === 'string' ? metadata.title.trim() : '';
  const title = (rawTitle || 'Untitled H5P content').slice(0, MAX_TITLE_LENGTH);

  return { library, metadata, parameters, title };
}

export function serializeH5PContent(content) {
  return {
    id: content._id.toString(),
    contentId: content.lumiContentId,
    title: content.title,
    mainLibrary: content.mainLibrary,
    source: content.source,
    status: content.status,
    folderId: content.folder?.toString() || null,
    quizId: content.quiz?.toString() || null,
    sourceQuizUpdatedAt: content.sourceQuizUpdatedAt || null,
    sourceFingerprint: content.sourceFingerprint || null,
    lastEditedAt: content.lastEditedAt,
    createdAt: content.createdAt,
    updatedAt: content.updatedAt
  };
}

export function buildLumiSaveResult(result, record) {
  return {
    contentId: result.id,
    metadata: result.metadata,
    content: serializeH5PContent(record)
  };
}

/**
 * Persist a generated native H5P document through the same Lumi API used by
 * the official editor. The caller remains responsible for the Mongo record
 * and rollback so ownership can be committed atomically at the application
 * boundary.
 */
export async function saveNativeH5PDocument(editor, document, user) {
  if (
    !editor?.saveOrUpdateContentReturnMetaData
    || typeof document?.library !== 'string'
    || !document.library.trim()
    || !document.metadata
    || typeof document.metadata !== 'object'
    || document.parameters === undefined
  ) {
    const error = new Error('The generated native H5P document is malformed.');
    error.code = 'INVALID_NATIVE_H5P_DOCUMENT';
    throw error;
  }

  return editor.saveOrUpdateContentReturnMetaData(
    undefined,
    document.parameters,
    document.metadata,
    document.library,
    user
  );
}

/**
 * Save a native document and create its application record as one logical
 * operation. If record creation fails, the new Lumi content is removed and the
 * original database error is preserved.
 */
export async function saveNativeH5PDocumentAndRecord({
  editor,
  document,
  user,
  cleanupUser = user,
  createRecord
}) {
  if (typeof createRecord !== 'function') {
    const error = new Error('A native H5P record factory is required.');
    error.code = 'INVALID_NATIVE_H5P_RECORD_FACTORY';
    throw error;
  }

  const result = await saveNativeH5PDocument(editor, document, user);

  try {
    const record = await createRecord(result, document);
    return { result, record };
  } catch (error) {
    try {
      await editor.deleteContent(result.id, cleanupUser);
    } catch (cleanupError) {
      console.error('Failed to roll back generated H5P content:', cleanupError.message);
    }
    throw error;
  }
}
