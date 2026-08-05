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
