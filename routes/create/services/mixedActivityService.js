import { getH5PTypeAdapter } from '../config/h5pTypeAdapterRegistry.js';
import { buildNativeH5PDocument } from './h5pExportService.js';

const SNAPSHOT_QUESTION_FIELDS = [
  '_id', 'type', 'questionText', 'content', 'correctAnswer', 'explanation',
  'difficulty', 'order'
];

function copyQuestion(question) {
  const source = question?.toObject ? question.toObject() : question;
  return Object.fromEntries(
    SNAPSHOT_QUESTION_FIELDS
      .filter(field => source?.[field] !== undefined)
      .map(field => [field, field === '_id' ? String(source[field]) : structuredClone(source[field])])
  );
}

export function createMixedActivitySnapshot(quiz) {
  return {
    version: 1,
    title: String(quiz?.name || 'Mixed Activity'),
    questions: (quiz?.questions || []).map(copyQuestion)
  };
}

export async function buildMixedActivityItemDocument(snapshot, questionId, options = {}) {
  const question = snapshot?.questions?.find(item => String(item._id) === String(questionId));
  if (!question) {
    const error = new Error('The requested Mixed Activity question is not in this published version.');
    error.code = 'MIXED_ACTIVITY_QUESTION_NOT_FOUND';
    throw error;
  }

  const adapter = getH5PTypeAdapter(question.type);
  const containerMode = adapter?.containers.includes('standalone') ? 'standalone' : 'column';
  return buildNativeH5PDocument({
    name: snapshot.title,
    questions: [question],
    chapters: [],
    settings: { targetFormat: containerMode },
    containerMode
  }, { ...options, containerMode });
}

export async function validateMixedActivitySnapshot(snapshot, options = {}) {
  for (const question of snapshot.questions || []) {
    await buildMixedActivityItemDocument(snapshot, question._id, options);
  }
  return snapshot;
}
