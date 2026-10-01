import Folder from '../../models/Folder.js';
import Material from '../../models/Material.js';
import Quiz from '../../models/Quiz.js';
import LearningObjective from '../../models/LearningObjective.js';
import { stableId, objectId, fail } from './authoringContracts.js';

export async function ensureDraftCourse(owner) {
  const id = stableId(`authoring-drafts:${owner}`);
  await Folder.updateOne({ _id: id, instructor: owner }, { $setOnInsert: { name: 'Studio drafts', instructor: owner } },
    { upsert: true, runValidators: true, setDefaultsOnInsert: true });
  return Folder.findOne({ _id: id, instructor: owner });
}

// Resolve IDs afresh on the server; client labels and previews are never trusted.
export async function resolveAuthoringContext(owner, { courseId, materialIds = [], objectiveIds = [] }) {
  for (const ids of [materialIds, objectiveIds]) if (!Array.isArray(ids) || ids.length > 20 || ids.some(id => !objectId(id)) || new Set(ids).size !== ids.length) fail('Choose up to 20 distinct context items.', 400);
  if (objectiveIds.length > 8) fail('Choose up to 8 learning objectives.', 400);
  if (courseId && !objectId(courseId)) fail('Choose a valid course.', 400);
  let course = courseId ? await Folder.findOne({ _id: courseId, instructor: owner }) : null;
  if (courseId && !course) fail('Course not found.', 404);
  const materials = await Material.find({ _id: { $in: materialIds }, uploadedBy: owner });
  const objectives = await LearningObjective.find({ _id: { $in: objectiveIds }, createdBy: owner });
  if (materials.length !== materialIds.length || objectives.length !== objectiveIds.length) fail('A context item is not available.', 404);
  const quizzes = await Quiz.find({ _id: { $in: objectives.map(lo => lo.quiz) }, createdBy: owner });
  if (objectives.some(lo => !quizzes.some(q => String(q._id) === String(lo.quiz) && q.learningObjectives.some(id => String(id) === String(lo._id))))) fail('An objective is no longer available.', 404);
  const folders = new Set([...(course ? [String(course._id)] : []), ...materials.map(m => String(m.folder)), ...quizzes.map(q => String(q.folder))]);
  if (folders.size > 1) fail('Use context from one course in this activity. Start another conversation to work with a different course.', 400);
  if (!course && folders.size) course = await Folder.findOne({ _id: [...folders][0], instructor: owner });
  if (folders.size && !course) fail('Course not found.', 404);
  return { course, materials, objectives };
}

export async function listAuthoringContext(owner, courseId) {
  const courses = await Folder.find({ instructor: owner }).sort({ updatedAt: -1 }).select('name description').lean();
  if (!courseId) return { courses: courses.map(c => ({ id: String(c._id), name: c.name, description: c.description || '' })), materials: [], objectives: [] };
  if (!objectId(courseId) || !courses.some(c => String(c._id) === courseId)) fail('Course not found.', 404);
  const quizzes = await Quiz.find({ folder: courseId, createdBy: owner }).select('name learningObjectives').lean();
  const [materials, objectives] = await Promise.all([
    Material.find({ folder: courseId, uploadedBy: owner }).sort({ createdAt: -1 }).select('name type processingStatus content').lean(),
    LearningObjective.find({ _id: { $in: quizzes.flatMap(q => q.learningObjectives) }, createdBy: owner }).select('text quiz generationMetadata.sourceReferences').lean()
  ]);
  return { courses: courses.map(c => ({ id: String(c._id), name: c.name, description: c.description || '' })),
    materials: materials.map(m => ({ id: String(m._id), name: m.name, type: m.type, status: m.processingStatus, preview: String(m.content || '').slice(0, 6000) })),
    objectives: objectives.map(lo => ({ id: String(lo._id), name: lo.text, quizId: String(lo.quiz), quizName: quizzes.find(q => String(q._id) === String(lo.quiz) && q.learningObjectives.some(id => String(id) === String(lo._id)))?.name || '', sourceReferences: lo.generationMetadata?.sourceReferences || [] })) };
}
