import 'dotenv/config';
import fs from 'node:fs/promises';
import mongoose from 'mongoose';
import User from '../routes/create/models/User.js';
import Folder from '../routes/create/models/Folder.js';
import Quiz from '../routes/create/models/Quiz.js';
import Question from '../routes/create/models/Question.js';
import LearningObjective from '../routes/create/models/LearningObjective.js';
import H5PContent from '../routes/create/models/H5PContent.js';
import { commonQuestions, standaloneQuestions } from './fixtures/h5p-render-questions.mjs';
import { getH5PTypesForContainer, getH5PTypeAdapter } from '../routes/create/config/h5pTypeAdapterRegistry.js';
import { buildNativeH5PDocument } from '../routes/create/services/h5pExportService.js';
import { buildH5PSourceFingerprint, getH5PSourceUpdatedAt, saveNativeH5PDocumentAndRecord } from '../routes/create/services/h5pEditorService.js';
import { finalizeContentOwnership, getEditor, getSystemUser, initializeLumi, toLumiUser } from '../routes/create/services/lumiService.js';

// Creates a fresh course every run. Never deletes or replaces instructor work.
const output = process.argv[2];
if (!output) throw new Error('Usage: node scripts/seed-h5p-preview-matrix.mjs <manifest.json>');
const samples = [...commonQuestions, ...standaloneQuestions];
const multi = {
  type: 'multiple-choice', questionText: '[Multiple answers] Select both processes that move water into the atmosphere.',
  content: { selectionMode: 'multiple', options: [
    { text: 'Evaporation', isCorrect: true, chosenFeedback: 'Correct: liquid water becomes vapour.', notChosenFeedback: 'Evaporation should be selected.' },
    { text: 'Transpiration', isCorrect: true, chosenFeedback: 'Correct: plants release water vapour.', notChosenFeedback: 'Transpiration should be selected.' },
    { text: 'Runoff', isCorrect: false, chosenFeedback: 'Runoff moves water across land.', notChosenFeedback: 'Correctly left unselected.' }
  ] }, correctAnswer: ['Evaporation', 'Transpiration'], explanation: 'Both evaporation and transpiration move water into the atmosphere.'
};
const formats = ['column', 'interactive-book', 'question-set', 'standalone'];
const labels = { column: 'Column', 'interactive-book': 'Interactive Book', 'question-set': 'Question Set', standalone: 'Standalone' };

try {
  await mongoose.connect(process.env.MONGODB_URI);
  const reference = await H5PContent.findOne({ lumiContentId: process.env.QA_REFERENCE_CONTENT || '407354634' });
  const owner = reference ? await User.findById(reference.owner) : await User.findOne({ cwlId: process.env.QA_CWL_ID || 'faculty' });
  if (!owner) throw new Error('Signed-in reference content owner was not found.');
  const folder = await Folder.create({ name: `H5P Preview QA ${new Date().toISOString()}`, instructor: owner._id });
  await initializeLumi();
  const definitions = formats.flatMap(format => getH5PTypesForContainer(format).map(type => ({
    format, type, variant: 'standard', questions: [samples.find(q => q.type === type)]
  })));
  for (const format of formats.filter(f => f !== 'standalone')) {
    definitions.push({ format, type: 'multiple-choice', variant: 'multiple-answers', questions: [multi] });
    definitions.push({ format, type: 'combined', variant: 'journey', questions: format === 'question-set'
      ? [samples[0], multi, samples[1], samples.find(q => q.type === 'cloze'), samples.find(q => q.type === 'mark-the-words'), samples.find(q => q.type === 'essay')]
      : [...commonQuestions, multi] });
  }
  const manifest = { courseId: String(folder._id), courseName: folder.name, createdAt: new Date().toISOString(), aiCalls: 0, formats, samples: [] };
  for (const definition of definitions) {
    if (definition.questions.some(q => !q)) throw new Error(`Missing fixture for ${definition.type}`);
    const label = definition.type === 'combined' ? 'All compatible types' : getH5PTypeAdapter(definition.type).label;
    const quiz = await Quiz.create({ name: `${labels[definition.format]} · ${label} · ${definition.variant}`, folder: folder._id, createdBy: owner._id,
      status: 'completed', settings: { targetFormat: definition.format, deliveryTarget: 'h5p-package', pedagogicalApproach: 'assess' },
      progress: { objectivesSet: true, planGenerated: true, planApproved: true, questionsGenerated: true, reviewCompleted: true } });
    const objective = await LearningObjective.create({ quiz: quiz._id, createdBy: owner._id, order: 0,
      text: 'Explain water-cycle processes and compare native H5P interaction states.', generationMetadata: { isAIGenerated: false } });
    const questions = await Question.insertMany(definition.questions.map((q, order) => ({ ...structuredClone(q), quiz: quiz._id,
      createdBy: owner._id, learningObjective: objective._id, order, difficulty: 'moderate', reviewStatus: 'approved' })));
    quiz.questions = questions.map(q => q._id);
    quiz.learningObjectives = [objective._id];
    if (definition.format === 'interactive-book' && definition.variant === 'journey') {
      quiz.chapters = [
        { title: 'Water-cycle concepts', questionIds: questions.slice(0, 6).map(q => q._id), containerType: 'column' },
        { title: 'Practice and reflect', questionIds: questions.slice(6).map(q => q._id), containerType: 'column' }
      ];
    }
    await quiz.save();
    const source = quiz.toObject();
    source.questions = questions.map(q => q.toObject());
    source.learningObjectives = [objective.toObject()];
    const document = await buildNativeH5PDocument(source);
    const saved = await saveNativeH5PDocumentAndRecord({ editor: getEditor(), document, user: toLumiUser(owner), cleanupUser: getSystemUser(),
      createRecord: result => H5PContent.create({ owner: owner._id, folder: folder._id, quiz: quiz._id, lumiContentId: result.id,
        title: quiz.name, mainLibrary: document.library.split(' ')[0], source: 'generated', status: 'draft',
        sourceQuizUpdatedAt: getH5PSourceUpdatedAt(source), sourceFingerprint: buildH5PSourceFingerprint(source), lastEditedAt: new Date() }) });
    finalizeContentOwnership(saved.result.id);
    folder.quizzes.push(quiz._id);
    manifest.samples.push({ ...definition, questions: questions.map(q => ({ id: String(q._id), type: q.type, text: q.questionText })), label,
      quizId: String(quiz._id), contentId: saved.result.id,
      currentUrl: `http://localhost:8092/course/${folder._id}/quiz/${quiz._id}?tab=preview`,
      studioUrl: `http://localhost:8092/h5p-studio?contentId=${saved.result.id}&view=preview` });
    await folder.save();
    await fs.writeFile(output, JSON.stringify(manifest, null, 2));
    console.log(`Created ${manifest.samples.length}/${definitions.length}: ${quiz.name}`);
  }
  await folder.updateStats();
  console.log(`Completed ${manifest.samples.length} comparisons without AI calls.`);
} finally {
  await mongoose.disconnect();
}
