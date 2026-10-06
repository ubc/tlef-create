import { describe, expect, test } from '@jest/globals';
import { buildAuthoringDecisionPrompt } from '../../services/authoring/authoringDecisionPrompt.js';

const data = prompt => JSON.parse(prompt.split('\n').at(-1));
describe('authoring decision context', () => {
  test('an initial build uses an actual proposal action without conflicting revision instructions', () => {
    const prompt = buildAuthoringDecisionPrompt({ latestRequest: 'Now create 2 questions.', initial: true });
    expect(prompt).toContain('"action":"reply|build_plan"');
    expect(prompt).toContain('Never return fictional completed steps or a plan as ordinary reply text');
    expect(prompt).not.toContain('Use revise_objectives');
    expect(prompt).not.toContain('"action":"reply|revise_plan');
    expect(prompt).toContain('latest explicit build request supersedes');
    expect(prompt).toContain('A prompt-only teaching activity is supported');
    expect(prompt).toContain('do not require course materials or a new conversation');
  });
  test('keeps the latest vague request separate from plan data and asks for clarification', () => {
    const prompt = buildAuthoringDecisionPrompt({ latestRequest: 'Make it better.', current: null,
      assistant: { status: 'awaiting_approval', plan: [{ count: 1 }], objectives: [{ id: 'lo-1', text: 'Explain net force.' }] } });
    expect(prompt).toContain('ask only about critical unknown topics');
    expect(prompt).toContain('A discussion does not retry work');
    expect(data(prompt)).toMatchObject({ latestRequest: 'Make it better.', taskStatus: 'awaiting_approval', plan: [{ count: 1 }], current: null });
  });

  test('provides current question numbers and chronological bounded history without changing the caller array', () => {
    const history = [{ role: 'assistant', text: 'Newest' }, { role: 'user', text: 'Older' }];
    const prompt = buildAuthoringDecisionPrompt({ latestRequest: 'Revise question 2.',
      current: { title: 'Motion', representation: 'course-linked', snapshot: { questions: [{ questionText: 'One' }, { questionText: 'Two' }] } }, history });
    expect(data(prompt).current.questions).toEqual([{ index: 1, text: 'One' }, { index: 2, text: 'Two' }]);
    expect(data(prompt).history.map(m => m.text)).toEqual(['Older', 'Newest']);
    expect(history[0].text).toBe('Newest');
  });

  test('includes bounded private review observations and preserves the distinction from verified diagnoses', () => {
    const prompt = buildAuthoringDecisionPrompt({ latestRequest: 'Why did it fail?', current: null,
      assistant: { status: 'failed', objectives: [], generation: { items: [{ index: 1, status: 'failed', reason: 'ANSWER_INVALID',
        review: { questionText: 'x'.repeat(2000), issues: ['y'.repeat(900)], options: [{ text: 'z'.repeat(800), isCorrect: true }] } }] } } });
    const review = data(prompt).failedQuestions[0].review;
    expect(review.questionText.length).toBe(1500);
    expect(review.options[0].text.length).toBe(500);
    expect(review.issues[0].length).toBe(600);
    expect(prompt).toContain('AI judgments, not verified diagnoses');
  });
  test('includes current type, difficulty, answer mode and runtime choices for a revision', () => {
    const prompt = buildAuthoringDecisionPrompt({ latestRequest: 'Convert question 1 to true/false.', allowedQuestionTypes: ['multiple-choice', 'true-false'],
      current: { snapshot: { questions: [{ questionText: 'One', type: 'multiple-choice', difficulty: 'easy', content: { selectionMode: 'multiple' } }] } } });
    expect(data(prompt)).toMatchObject({ allowedQuestionTypes: ['multiple-choice', 'true-false'],
      current: { questions: [{ index: 1, type: 'multiple-choice', difficulty: 'easy', selectionMode: 'multiple' }] } });
    expect(prompt).toContain('omit unchanged properties');
  });
  test('gives the accepted version precedence over stale initial-plan status', () => {
    const prompt = buildAuthoringDecisionPrompt({ latestRequest: 'Make all questions harder.',
      assistant: { status: 'awaiting_approval', objectives: [], plan: [{ count: 3 }] }, current: { snapshot: { questions: [] } } });
    expect(data(prompt)).toMatchObject({ taskStatus: 'ready', plan: null });
    expect(prompt).toContain('never use revise_plan');
    expect(prompt).toContain('without starting a native fork');
  });
  test('keeps application calculations separate from the bounded AI observations', () => {
    const calculationCheck = { location: 'option 1 feedback', expression: '7 * 8', computed: 56, claimed: 54 };
    const prompt = buildAuthoringDecisionPrompt({ latestRequest: 'Explain this failure.', assistant: { status: 'failed', objectives: [],
      generation: { items: [{ index: 0, status: 'failed', review: { issues: Array(8).fill('AI observation.'), calculationCheck } }] } } });
    const review = data(prompt).failedQuestions[0].review;
    expect(review.issues).toHaveLength(4);
    expect(review.calculationCheck).toEqual(calculationCheck);
    expect(prompt).toContain('An AI observation cannot become a calculationCheck');
  });
});
