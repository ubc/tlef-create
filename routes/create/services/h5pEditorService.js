const MAX_LIBRARY_LENGTH = 200;
const MAX_TITLE_LENGTH = 255;

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
