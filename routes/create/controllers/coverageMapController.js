import express from 'express';
import Quiz from '../models/Quiz.js';
import LearningObjective from '../models/LearningObjective.js';
import Question from '../models/Question.js';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { successResponse, errorResponse, notFoundResponse } from '../utils/responseFormatter.js';
import { HTTP_STATUS } from '../config/constants.js';

const router = express.Router();

function inferTopicFromText(text = '') {
  const cleaned = text
    .replace(/^(describe|explain|identify|analyze|evaluate|compare|understand|apply)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return 'General Coverage';
  }

  const words = cleaned.split(' ').slice(0, 6).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function normalizeSourceReferences(references = []) {
  return references
    .filter(Boolean)
    .map(reference => ({
      materialId: reference.materialId?.toString?.() || reference.materialId,
      materialName: reference.materialName,
      sourceFile: reference.sourceFile,
      chunkIndex: reference.chunkIndex,
      pageNumber: reference.pageNumber,
      pageStart: reference.pageStart,
      pageEnd: reference.pageEnd,
      excerpt: reference.excerpt,
      relevanceScore: reference.relevanceScore,
      section: reference.section,
      sectionId: reference.sectionId
    }));
}

function dedupeSourceReferences(references = []) {
  const seen = new Set();

  return references.filter(reference => {
    const key = [
      reference.materialId || reference.materialName || reference.sourceFile || 'unknown',
      reference.pageNumber ?? 'no-page',
      reference.chunkIndex ?? 'no-chunk',
      reference.excerpt || ''
    ].join('::');

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

router.get('/quiz/:quizId', authenticateToken, asyncHandler(async (req, res) => {
  const { quizId } = req.params;
  const userId = req.user.id;

  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId })
    .populate('materials')
    .populate({ path: 'learningObjectives', options: { sort: { order: 1 } } });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  const quizObjectives = (quiz.learningObjectives || [])
    .filter(objective => objective && typeof objective === 'object' && objective._id)
    .map(objective => objective.toObject ? objective.toObject() : objective)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  const [fallbackObjectives, questions] = await Promise.all([
    quizObjectives.length > 0
      ? Promise.resolve([])
      : LearningObjective.find({ quiz: quizId }).sort({ order: 1 }).lean(),
    Question.find({ quiz: quizId })
      .select('questionText type learningObjective generationMetadata order difficulty')
      .sort({ order: 1 })
      .lean()
  ]);
  const learningObjectives = quizObjectives.length > 0 ? quizObjectives : fallbackObjectives;

  if (learningObjectives.length === 0) {
    return errorResponse(
      res,
      'Quiz must have learning objectives before building a coverage map',
      'NO_OBJECTIVES',
      HTTP_STATUS.BAD_REQUEST
    );
  }

  const questionsByObjective = questions.reduce((acc, question) => {
    const key = question.learningObjective?.toString?.();
    if (!key) {
      return acc;
    }
    if (!acc.has(key)) {
      acc.set(key, []);
    }
    acc.get(key).push(question);
    return acc;
  }, new Map());

  const topicsByLabel = new Map();

  for (const objective of learningObjectives) {
    const metadata = objective.generationMetadata || {};
    const linkedQuestions = questionsByObjective.get(objective._id.toString()) || [];
    const topicLabel = metadata.topic || inferTopicFromText(objective.text);
    const subtopicLabel = metadata.subtopic || metadata.bloomLevel || 'Core objective';
    const loRefs = normalizeSourceReferences(metadata.sourceReferences || []);
    const questionRefs = linkedQuestions.flatMap(question =>
      normalizeSourceReferences(question.generationMetadata?.sourceReferences || [])
    );
    const sourceReferences = dedupeSourceReferences([...loRefs, ...questionRefs]).slice(0, 5);

    if (!topicsByLabel.has(topicLabel)) {
      topicsByLabel.set(topicLabel, {
        id: `topic-${topicsByLabel.size + 1}`,
        label: topicLabel,
        sourceReferences: [],
        linkedLearningObjectiveIds: [],
        linkedQuestionIds: [],
        subtopics: []
      });
    }

    const topic = topicsByLabel.get(topicLabel);
    const questionSummaries = linkedQuestions.map(question => ({
      id: question._id.toString(),
      type: question.type,
      text: question.questionText,
      order: question.order,
      difficulty: question.difficulty,
      focusArea: question.generationMetadata?.focusArea,
      subObjective: question.generationMetadata?.subObjective,
      plannedSlice: question.generationMetadata?.plannedSlice,
      bloomLevel: question.generationMetadata?.bloomLevel,
      sourceReferences: normalizeSourceReferences(
        question.generationMetadata?.sourceReferences || []
      )
    }));

    topic.linkedLearningObjectiveIds.push(objective._id.toString());
    topic.linkedQuestionIds.push(...questionSummaries.map(question => question.id));
    topic.sourceReferences = dedupeSourceReferences([
      ...topic.sourceReferences,
      ...sourceReferences
    ]).slice(0, 5);
    topic.subtopics.push({
      id: `subtopic-${objective._id}`,
      label: subtopicLabel,
      learningObjective: {
        id: objective._id.toString(),
        text: objective.text,
        order: objective.order,
        bloomLevel: metadata.bloomLevel,
        rationale: metadata.rationale,
        subpoints: metadata.subpoints || [],
        sourceReferences: loRefs
      },
      sourceReferences,
      linkedQuestions: questionSummaries,
      coverageStatus: questionSummaries.length > 0 ? 'covered' : 'needs-questions'
    });
  }

  const topics = Array.from(topicsByLabel.values());
  const totalLinkedQuestions = topics.reduce((sum, topic) => sum + topic.linkedQuestionIds.length, 0);
  const uncoveredLearningObjectives = topics.flatMap(topic =>
    topic.subtopics
      .filter(subtopic => subtopic.coverageStatus === 'needs-questions')
      .map(subtopic => subtopic.learningObjective.id)
  );

  return successResponse(res, {
    quizId,
    generatedAt: new Date().toISOString(),
    materials: (quiz.materials || []).map(material => ({
      id: material._id.toString(),
      name: material.name || material.title || material.originalFileName || 'Untitled material',
      type: material.type,
      processingStatus: material.processingStatus
    })),
    summary: {
      topicCount: topics.length,
      learningObjectiveCount: learningObjectives.length,
      linkedQuestionCount: totalLinkedQuestions,
      uncoveredLearningObjectiveCount: uncoveredLearningObjectives.length
    },
    topics,
    uncoveredLearningObjectiveIds: uncoveredLearningObjectives
  }, 'Coverage map generated successfully', HTTP_STATUS.OK);
}));

export default router;
