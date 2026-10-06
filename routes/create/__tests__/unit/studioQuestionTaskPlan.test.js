import { describe, expect, test } from '@jest/globals';
import mongoose from 'mongoose';
import Quiz from '../../models/Quiz.js';
import { expandAssistantQuestionPlan } from '../../services/studioAssistantGeneration.js';
import { attachPlannedTasksToQuestionConfigs, normalizeGenerationConfigs } from '../../services/questionBatchGeneration.js';
import { questionGenerationRequestHash } from '../../services/questionGenerationJobs.js';
import { assertQuestionTaskAllocation, needsQuestionTaskReallocation, resolveQuestionTaskEvidence, validateQuestionTasks } from '../../services/studioQuestionTaskPlan.js';

const source = { id: 'src-friction', materialId: 'material-1', materialName: 'Lecture notes', sourceFile: 'notes.pdf', chunkIndex: 3,
  pageNumber: 4, pageStart: 4, pageEnd: 5, section: 'Friction', sectionId: 'friction', relevanceScore: 0.9, excerpt: 'Friction opposes relative motion between contacting surfaces.' };
const tasks = [
  { id: 'task-identify', focus: 'Identify the friction force', instructions: 'Identify the force opposing a sliding book using a fully described text scenario.', sourceIds: [source.id], visualRequirement: 'none' },
  { id: 'task-misconception', focus: 'Distinguish motion from applied force', instructions: 'Correct the misconception that friction necessarily points opposite the applied force.', sourceIds: [source.id], visualRequirement: 'none' }
];
const row = { id: 'activity-1', type: 'multiple-choice', learningObjective: '507f1f77bcf86cd799439011', count: 2,
  customPrompt: 'Exclude inclined planes. Choose exactly one answer.', questionTasks: tasks };

describe('per-question task planning and real evidence', () => {
  test('expansion hands each generator its own task while retaining common teacher constraints', () => {
    const configs = normalizeGenerationConfigs(expandAssistantQuestionPlan({ settings: { planItems: [row] } }));
    expect(configs).toHaveLength(2);
    expect(configs.map(config => config.focusArea)).toEqual(tasks.map(task => task.focus));
    expect(configs.map(config => config.questionTaskId)).toEqual(tasks.map(task => task.id));
    expect(configs[0].customPrompt).toContain(tasks[0].instructions);
    expect(configs[0].customPrompt).not.toContain(tasks[1].instructions);
    expect(configs[1].customPrompt).toContain(tasks[1].instructions);
    for (const config of configs) {
      expect(config.customPrompt).toContain(row.customPrompt);
      expect(config.taskSourceIds).toEqual([source.id]);
      expect(config.plannedTask.sliceLabel).toBe(config.focusArea);
    }
    const changed = configs.map((config, index) => index ? config : { ...config, plannedTask: { ...config.plannedTask, questionIntent: 'Revised task' } });
    expect(questionGenerationRequestHash({ quizId: 'quiz', mode: 'append', questionConfigs: configs })).not.toBe(questionGenerationRequestHash({ quizId: 'quiz', mode: 'append', questionConfigs: changed }));
  });

  test('task evidence resolves only the stored owned excerpt and retains full page and section metadata', () => {
    const chunks = resolveQuestionTaskEvidence({ sourceIds: [source.id], trustedSources: [source], materialIds: ['material-1'] });
    expect(chunks).toEqual([{ content: source.excerpt, score: 0.9, metadata: Object.fromEntries(Object.entries(source).filter(([key]) => !['id', 'excerpt'].includes(key))) }]);
  });

  test('automatic legacy slice allocation keeps an explicit approved per-item task', () => {
    const configs = normalizeGenerationConfigs(expandAssistantQuestionPlan({ settings: { planItems: [row] } }))
      .map(config => ({ ...config, learningObjective: 'Identify friction and tension.', customPrompt: 'Common row instructions.' }));
    const result = attachPlannedTasksToQuestionConfigs(configs);
    expect(result.map(config => config.plannedTask)).toEqual(configs.map(config => config.plannedTask));
    expect(result.map(config => config.taskSourceIds)).toEqual([[source.id], [source.id]]);
  });

  test.each([
    { sourceIds: ['invented'], trustedSources: [source], materialIds: ['material-1'] },
    { sourceIds: [source.id], trustedSources: [source], materialIds: ['someone-elses-material'] },
    { sourceIds: [source.id], trustedSources: [], materialIds: ['material-1'] },
    { sourceIds: [source.id], trustedSources: [{ id: source.id, materialId: 'material-1', pageNumber: 4 }], materialIds: ['material-1'] }
  ])('does not turn client IDs or location-only metadata into evidence', args => {
    expect(() => resolveQuestionTaskEvidence(args)).toThrow();
  });

  test.each([
    [], tasks.slice(0, 1), [tasks[0], tasks[0]],
    tasks.map(task => ({ ...task, sourceIds: ['outside-snapshot'] })),
    tasks.map(task => ({ ...task, sourceIds: [] })),
    tasks.map(task => ({ ...task, visualRequirement: 'image' })),
    tasks.map(task => ({ ...task, instructions: 'As shown in the diagram, identify the force.' }))
  ].map(questionTasks => [questionTasks]))('rejects incomplete, repeated, ungrounded or missing-visual allocations', questionTasks => {
    expect(() => validateQuestionTasks({ ...row, questionTasks }, { required: true, trustedSources: [source] })).toThrow();
  });

  test('prompt-only tasks stay ungrounded and legacy plan rows remain usable', () => {
    expect(validateQuestionTasks({ ...row, questionTasks: tasks.map(task => ({ ...task, sourceIds: [] })) }, { required: true, promptBased: true, trustedSources: [] })[0].sourceIds).toEqual([]);
    const { questionTasks: _tasks, ...legacy } = row;
    expect(expandAssistantQuestionPlan({ settings: { planItems: [legacy] } })).toHaveLength(2);
  });

  test('persisted blueprint tasks survive casting and reject count edits that leave missing task allocations', () => {
    const quiz = new Quiz({ name: 'Plan', createdBy: new mongoose.Types.ObjectId(), folder: new mongoose.Types.ObjectId(), settings: { planItems: [row] } });
    expect(quiz.validateSync()).toBeUndefined();
    expect(quiz.toObject().settings.planItems[0].questionTasks).toEqual(tasks);
    quiz.settings.planItems[0].count = 3;
    expect(quiz.validateSync()?.errors['settings.planItems.0.questionTasks']).toBeDefined();
  });

  test('an edited count requests fresh tasks, while a replan cannot silently change teacher allocation', () => {
    const requested = [{ ...row, questionType: row.type, objectiveIds: [row.learningObjective], count: 3 }];
    expect(needsQuestionTaskReallocation(requested)).toBe(true);
    expect(needsQuestionTaskReallocation([{ ...requested[0], questionTasks: undefined }])).toBe(false);
    const rebuilt = [{ ...requested[0], questionTasks: [...tasks, { ...tasks[0], id: 'new-task', focus: 'Explain a force balance' }] }];
    expect(needsQuestionTaskReallocation(rebuilt)).toBe(false);
    expect(assertQuestionTaskAllocation(requested, rebuilt)).toBe(rebuilt);
    for (const change of [{ count: 2 }, { questionType: 'essay' }, { difficulty: 'hard' }, { objectiveIds: ['other-goal'] }]) {
      expect(() => assertQuestionTaskAllocation(requested, [{ ...rebuilt[0], ...change }])).toThrow();
    }
  });
});
