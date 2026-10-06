// Read-only local QA report. Never prints configuration secrets or source text.
import 'dotenv/config';
import mongoose from 'mongoose';
import { writeFile, mkdir } from 'node:fs/promises';
import { getMongoUri } from '../routes/create/config/database.js';
import { AuthoringSession, AuthoringRun } from '../routes/create/models/StudioAuthoring.js';
import Receipt from '../routes/create/models/ModelTokenReceipt.js';
import Job from '../routes/create/models/QuestionGenerationJob.js';
import Question from '../routes/create/models/Question.js';
import Quiz from '../routes/create/models/Quiz.js';
const sessionId = process.argv[2];
if (!mongoose.isValidObjectId(sessionId)) throw new Error('Provide an authoring session ID');
await mongoose.connect(getMongoUri());
try {
  const session = await AuthoringSession.findById(sessionId).lean();
  if (!session) throw new Error('Session not found');
  const [runs, receipts, jobs, questions, quiz] = await Promise.all([
    AuthoringRun.find({ sessionId }).sort({ createdAt: 1 }).lean(),
    Receipt.find({ sessionId }).sort({ startedAt: 1 }).lean(),
    Job.find({ quiz: session.quizId }).sort({ createdAt: 1 }).lean(),
    Question.find({ quiz: session.quizId }).sort({ order: 1 }).lean(),
    Quiz.findById(session.quizId).select('questions').lean()
  ]);
  const publishedIds = new Set((quiz?.questions || []).map(String));
  const published = questions.filter(q => publishedIds.has(String(q._id)));
  const report = {
    sessionId, status: session.status, quizId: session.quizId,
    createdAt: session.createdAt, updatedAt: session.updatedAt,
    elapsedSeconds: (new Date(session.updatedAt) - new Date(session.createdAt)) / 1000,
    requirements: session.teachingRequirements, workflow: session.workflow,
    runs: runs.map(r => ({ id: r._id, status: r.status, checkpoint: r.checkpoint,
      errorCode: r.errorCode, createdAt: r.createdAt, updatedAt: r.updatedAt,
      operations: r.operations, agentStep: r.agentState?.step })),
    receipts: receipts.map(r => ({ stage: r.stage, model: r.model, status: r.status, outcome: r.outcome,
      seconds: r.completedAt ? (new Date(r.completedAt) - new Date(r.startedAt)) / 1000 : null,
      input: r.inputTokens, output: r.outputTokens, total: r.totalTokens, cached: r.cachedInputTokens,
      cacheWrites: r.cacheWriteTokens, reasoning: r.reasoningTokens })),
    tokens: receipts.reduce((sum, r) => ({ input: sum.input + (r.inputTokens || 0),
      output: sum.output + (r.outputTokens || 0), total: sum.total + (r.totalTokens || 0) }), { input: 0, output: 0, total: 0 }),
    jobs: jobs.map(j => ({ id: j._id, status: j.status, createdAt: j.createdAt, updatedAt: j.updatedAt, items: j.items })),
    savedCount: published.length, preparedRecordCount: questions.length,
    questions: published.map(q => ({ id: q._id, type: q.type, questionText: q.questionText,
      content: q.content, explanation: q.explanation, reviewSummary: q.generationMetadata?.reviewSummary,
      sourceReferences: q.generationMetadata?.sourceReferences?.map(s => ({ materialId: s.materialId, chunkIndex: s.chunkIndex })),
      generationMetadata: { qualityReview: q.generationMetadata?.qualityReview, processingTime: q.generationMetadata?.processingTime,
        plannedSlice: q.generationMetadata?.plannedSlice, noveltyScore: q.generationMetadata?.noveltyScore } }))
  };
  if (process.argv[3]) {
    await mkdir('artifacts/agent-audit-2026-10-03', { recursive: true });
    await writeFile(`artifacts/agent-audit-2026-10-03/${process.argv[3]}.json`, JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ ...report, questions: undefined, requirements: undefined }, null, 2));
} finally { await mongoose.disconnect(); }
