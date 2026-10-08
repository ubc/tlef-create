import 'dotenv/config';
import { commonQuestions, standaloneQuestions } from './fixtures/h5p-render-questions.mjs';
import mongoose from 'mongoose';
import User from '../routes/create/models/User.js';
import Folder from '../routes/create/models/Folder.js';
import Quiz from '../routes/create/models/Quiz.js';
import Question from '../routes/create/models/Question.js';
import LearningObjective from '../routes/create/models/LearningObjective.js';
import { buildNativeH5PDocument } from '../routes/create/services/h5pExportService.js';

const COURSE_NAME = 'H5P Renderer Comparison';
const USER_CWL = process.env.QA_CWL_ID
  || process.env.ADMIN_CWLS?.split(',').map(value => value.trim()).find(Boolean)
  || 'faculty';

async function replaceLearningObject({ folder, owner, name, targetFormat, deliveryTarget, questions }) {
  const existing = await Quiz.findOne({ folder: folder._id, name });
  const quiz = existing || new Quiz({ folder: folder._id, createdBy: owner._id, name });

  if (existing) {
    await Promise.all([
      Question.deleteMany({ quiz: quiz._id }),
      LearningObjective.deleteMany({ quiz: quiz._id })
    ]);
  }

  quiz.name = name;
  quiz.createdBy = owner._id;
  quiz.folder = folder._id;
  quiz.materials = [];
  quiz.questions = [];
  quiz.learningObjectives = [];
  quiz.containerMode = targetFormat === 'column' ? 'column' : 'column';
  quiz.settings = {
    ...(quiz.settings?.toObject?.() || quiz.settings || {}),
    pedagogicalApproach: 'assess',
    difficulty: 'moderate',
    deliveryTarget,
    targetFormat,
    questionTypes: questions.map(question => ({ type: question.type, count: 1, scope: 'whole-quiz', percentage: 0 })),
    totalPerLO: 0,
    totalWholeQuiz: questions.length,
    planMode: 'manual',
    planItems: []
  };
  quiz.status = 'completed';
  quiz.progress = {
    materialsAssigned: false,
    objectivesSet: true,
    planGenerated: true,
    planApproved: true,
    questionsGenerated: true,
    reviewCompleted: true
  };
  await quiz.save();

  const objective = await LearningObjective.create({
    quiz: quiz._id,
    createdBy: owner._id,
    order: 0,
    text: 'Compare how CREATE Preview and the official H5P Studio render equivalent water-cycle learning activities.',
    generationMetadata: { isAIGenerated: false, bloomLevel: 'analyze' }
  });
  const records = await Question.insertMany(questions.map((question, index) => ({
    ...question,
    quiz: quiz._id,
    learningObjective: objective._id,
    createdBy: owner._id,
    difficulty: 'moderate',
    order: index,
    reviewStatus: 'approved',
    generationMetadata: { generationMethod: 'qa-render-comparison' }
  })));
  quiz.learningObjectives = [objective._id];
  quiz.questions = records.map(record => record._id);
  quiz.questionRevision = (quiz.questionRevision || 0) + 1;
  await quiz.save();
  return quiz;
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  await mongoose.connect(process.env.MONGODB_URI);
  const owner = await User.findOne({ cwlId: USER_CWL });
  if (!owner) throw new Error(`Local QA user ${USER_CWL} was not found.`);

  let folder = await Folder.findOne({ instructor: owner._id, name: COURSE_NAME });
  if (!folder) folder = await Folder.create({ name: COURSE_NAME, instructor: owner._id });

  const mixedQuestions = [...commonQuestions, ...standaloneQuestions];
  const definitions = [
    {
      name: 'H5P Comparison · Mixed Activity · All 16 types',
      targetFormat: 'mixed-activity', deliveryTarget: 'canvas-lti', questions: mixedQuestions
    },
    {
      name: 'H5P Comparison · Column · 13 compatible types',
      targetFormat: 'column', deliveryTarget: 'h5p-package', questions: commonQuestions
    },
    ...standaloneQuestions.map(question => ({
      name: `H5P Comparison · Standalone · ${question.type}`,
      targetFormat: 'standalone', deliveryTarget: 'h5p-package', questions: [question]
    }))
  ];

  const quizzes = [];
  for (const definition of definitions) {
    const validationQuiz = {
      name: definition.name,
      questions: definition.questions,
      learningObjectives: [],
      chapters: [],
      settings: { targetFormat: definition.targetFormat },
      containerMode: 'column'
    };
    if (definition.targetFormat !== 'mixed-activity') await buildNativeH5PDocument(validationQuiz);
    quizzes.push(await replaceLearningObject({ folder, owner, ...definition }));
  }

  folder.quizzes = [...new Set([
    ...folder.quizzes.map(String),
    ...quizzes.map(quiz => String(quiz._id))
  ])];
  await folder.updateStats();
  await User.updateOne({ _id: owner._id }, {
    $set: { 'stats.lastActivity': new Date() },
    $inc: { 'stats.questionsCreated': mixedQuestions.length + commonQuestions.length + standaloneQuestions.length }
  });

  console.log(JSON.stringify({
    courseId: String(folder._id),
    quizzes: quizzes.map(quiz => ({ id: String(quiz._id), name: quiz.name }))
  }, null, 2));
}

main()
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
