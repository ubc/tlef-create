import {
  buildMixedActivityItemDocument,
  createMixedActivitySnapshot
} from '../../services/mixedActivityService.js';

describe('mixedActivityService', () => {
  test('creates an immutable, privacy-limited published snapshot', () => {
    const quiz = {
      name: 'Forces review',
      questions: [{
        _id: { toString: () => 'question-1' },
        type: 'multiple-choice',
        questionText: 'What is the net force?',
        content: {
          options: [
            { text: '4 N', isCorrect: true },
            { text: '8 N', isCorrect: false }
          ]
        },
        correctAnswer: '4 N',
        explanation: 'Subtract friction from the applied force.',
        order: 1,
        sourceReferences: [{ excerpt: 'private course material' }],
        generationMetadata: { generationPrompt: 'private prompt' }
      }]
    };

    const snapshot = createMixedActivitySnapshot(quiz);

    expect(snapshot).toEqual(expect.objectContaining({
      version: 1,
      title: 'Forces review'
    }));
    expect(snapshot.questions[0]._id).toBe('question-1');
    expect(snapshot.questions[0]).not.toHaveProperty('sourceReferences');
    expect(snapshot.questions[0]).not.toHaveProperty('generationMetadata');

    quiz.questions[0].content.options[0].text = 'changed later';
    expect(snapshot.questions[0].content.options[0].text).toBe('4 N');
  });

  test('builds one native H5P document for a published question', async () => {
    const snapshot = createMixedActivitySnapshot({
      name: 'Forces review',
      questions: [{
        _id: 'question-1',
        type: 'multiple-choice',
        questionText: 'What is the net force?',
        content: {
          options: [
            { text: '4 N', isCorrect: true },
            { text: '8 N', isCorrect: false }
          ]
        },
        correctAnswer: '4 N',
        explanation: 'Subtract friction from the applied force.',
        order: 1
      }]
    });

    const document = await buildMixedActivityItemDocument(snapshot, 'question-1');

    expect(document.library).toContain('H5P.Column');
    expect(document.metadata.title).toBe('Forces review');
  });

  test('rejects a question that is not part of the published version', async () => {
    await expect(buildMixedActivityItemDocument({ questions: [] }, 'missing'))
      .rejects.toMatchObject({ code: 'MIXED_ACTIVITY_QUESTION_NOT_FOUND' });
  });
});
