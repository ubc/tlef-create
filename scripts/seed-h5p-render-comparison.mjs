import 'dotenv/config';
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

const commonQuestions = [
  {
    type: 'multiple-choice',
    questionText: '[Multiple Choice] Which process moves liquid water from Earth’s surface into the atmosphere?',
    content: { selectionMode: 'single', options: [
      { text: 'Evaporation', isCorrect: true, tip: 'Think about solar heating.', chosenFeedback: 'Correct: liquid water becomes water vapour.', notChosenFeedback: 'This is the process driven by heat.' },
      { text: 'Condensation', isCorrect: false, tip: 'This process forms droplets.', chosenFeedback: 'Condensation changes vapour into liquid.', notChosenFeedback: 'Correctly left unselected.' },
      { text: 'Precipitation', isCorrect: false, chosenFeedback: 'Precipitation returns water to the surface.', notChosenFeedback: 'Correctly left unselected.' }
    ] },
    correctAnswer: 'Evaporation', explanation: 'Solar energy drives evaporation.'
  },
  {
    type: 'true-false', questionText: '[True/False] Clouds form when water vapour cools and condenses.',
    content: { options: [{ text: 'True', isCorrect: true }, { text: 'False', isCorrect: false }] },
    correctAnswer: true, explanation: 'Cooling allows water vapour to condense into droplets or ice crystals.'
  },
  {
    type: 'flashcard', questionText: '[Flashcard] What is transpiration?',
    content: { front: 'What is transpiration?', back: 'The release of water vapour from plant leaves.' },
    correctAnswer: 'The release of water vapour from plant leaves.'
  },
  {
    type: 'guess-the-answer', questionText: '[Guess the Answer] I am water moving downward through soil. What am I?',
    content: { solutionLabel: 'Reveal the process', solutionText: 'Infiltration' }, correctAnswer: 'Infiltration'
  },
  {
    type: 'summary', questionText: '[Summary] Review the main water-cycle ideas.',
    content: { title: 'Water-cycle summary', keyPoints: [
      { title: 'Energy', explanation: 'Solar energy drives evaporation and transpiration.' },
      { title: 'Phase change', explanation: 'Cooling causes condensation and cloud formation.' },
      { title: 'Storage and flow', explanation: 'Water is stored and transported through surface water, groundwater, ice, and the atmosphere.' }
    ] }
  },
  {
    type: 'discussion', questionText: '[Discussion] How might paving a large watershed change infiltration, runoff, and flood risk?'
  },
  {
    type: 'matching', questionText: '[Matching] Match each process to its description.',
    content: {
      leftItems: ['Evaporation', 'Condensation', 'Runoff'],
      rightItems: ['Liquid becomes vapour', 'Vapour becomes droplets', 'Water flows over land'],
      matchingPairs: [['Evaporation', 'Liquid becomes vapour'], ['Condensation', 'Vapour becomes droplets'], ['Runoff', 'Water flows over land']]
    }
  },
  {
    type: 'ordering', questionText: '[Ordering] Put this simplified water-cycle sequence in order.',
    content: {
      items: ['Solar energy warms surface water', 'Water evaporates', 'Water vapour cools and condenses', 'Precipitation falls'],
      correctOrder: ['Solar energy warms surface water', 'Water evaporates', 'Water vapour cools and condenses', 'Precipitation falls']
    }
  },
  {
    type: 'cloze', questionText: '[Fill in the Blank] Complete the water-cycle statement.',
    content: {
      textWithBlanks: 'Water vapour cools during $$ and may return to the surface as $$.',
      correctAnswers: ['condensation', 'precipitation'],
      blankOptions: [['condensation', 'evaporation'], ['precipitation', 'infiltration']]
    },
    correctAnswer: ['condensation', 'precipitation']
  },
  {
    type: 'mark-the-words', questionText: '[Mark the Words] Select processes that move water into the atmosphere.',
    content: { text: '*Evaporation* and *transpiration* move water into the atmosphere, while runoff moves it across land.' },
    correctAnswer: ['Evaporation', 'transpiration']
  },
  {
    type: 'single-choice-set', questionText: '[Single Choice Set] Check two water-cycle ideas.',
    content: { questions: [
      { question: 'What primarily drives evaporation?', answers: ['Solar energy', 'Gravity', 'Soil texture'] },
      { question: 'What process forms clouds?', answers: ['Condensation', 'Runoff', 'Infiltration'] }
    ] }
  },
  {
    type: 'essay', questionText: '[Essay] Explain how a warmer climate can intensify parts of the water cycle.',
    content: {
      taskDescription: 'Explain how a warmer climate can affect evaporation, atmospheric moisture, and heavy precipitation.',
      keywords: [
        { keyword: 'evaporation', alternatives: ['evaporate'], points: 1 },
        { keyword: 'water vapour', alternatives: ['moisture'], points: 1 },
        { keyword: 'precipitation', alternatives: ['rainfall'], points: 1 }
      ],
      sampleAnswer: 'Warmer conditions can increase evaporation. A warmer atmosphere can hold more water vapour, providing more moisture for some heavy precipitation events.'
    }
  },
  {
    type: 'documentation-tool', questionText: '[Documentation Tool] Plan and document a watershed investigation.',
    content: { title: 'Watershed Investigation Log', pages: [
      { type: 'intro', title: 'Observe', introText: 'Record evidence about water movement in your study area.', fields: [{ label: 'What did you observe?' }, { label: 'What evidence supports it?' }] },
      { type: 'goals', title: 'Set goals' },
      { type: 'task', title: 'Interpret', introText: 'Connect your observations to water-cycle processes.', fields: [{ label: 'Which processes are involved?' }] },
      { type: 'assessment', title: 'Assess goals' },
      { type: 'export', title: 'Export reflection' }
    ] }
  }
];

const standaloneQuestions = [
  {
    type: 'sort-paragraphs', questionText: '[Sort Paragraphs] Order the stages of a storm-water journey.',
    content: { paragraphs: [
      'Rain falls on the watershed.',
      'Some water infiltrates into soil while the remainder becomes runoff.',
      'Runoff enters streams and rivers.',
      'Water eventually reaches a lake or ocean.'
    ] }
  },
  {
    type: 'crossword', questionText: '[Crossword] Complete the water-cycle vocabulary puzzle.',
    content: { words: [
      { answer: 'WATER', clue: 'A substance that cycles through Earth systems' },
      { answer: 'RAIN', clue: 'Liquid precipitation' },
      { answer: 'VAPOR', clue: 'The gaseous form of water' },
      { answer: 'RIVER', clue: 'A channel that carries runoff' },
      { answer: 'EVAPORATION', clue: 'Liquid water changing to gas' }
    ] }
  },
  {
    type: 'branching-scenario', questionText: '[Branching Scenario] Make a watershed-management decision.',
    content: {
      introText: 'A community is redesigning a paved schoolyard that produces rapid runoff during storms.',
      nodes: [
        { index: 0 },
        { index: 1, question: 'Which first action best supports infiltration?', alternatives: [
          { text: 'Install a rain garden with permeable soil', nextContentId: 2, feedback: 'This slows runoff and encourages infiltration.' },
          { text: 'Add more impervious pavement', nextContentId: -2, feedback: 'More pavement usually increases runoff.' }
        ] },
        { index: 2, question: 'How should the class evaluate the change?', alternatives: [
          { text: 'Compare runoff before and after similar storms', nextContentId: -1, feedback: 'This provides evidence of the intervention’s effect.' },
          { text: 'Judge it only by appearance', nextContentId: -2, feedback: 'Appearance alone does not measure water movement.' }
        ] }
      ]
    }
  }
];

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
