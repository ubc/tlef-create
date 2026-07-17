import { describe, expect, test } from '@jest/globals';
import helpKnowledgeService from '../../services/helpKnowledgeService.js';
import { answerHelpQuestion } from '../../services/helpChatService.js';

describe('CREATE Guide knowledge retrieval', () => {
  test('loads curated help documents and generated capability facts', async () => {
    const status = await helpKnowledgeService.getStatus();

    expect(status.documents).toBeGreaterThanOrEqual(11);
    expect(status.chunks).toBeGreaterThan(status.documents);
    expect(status.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(status.refreshedAutomatically).toBe(true);
  });

  test('retrieves multiple-answer guidance for Review & Edit', async () => {
    const sources = await helpKnowledgeService.retrieve(
      'How do I make a multiple-answer MCQ?',
      {
        route: '/course/course-1/quiz/quiz-1?tab=review',
        activeTab: 'Review & Edit'
      },
      3
    );

    expect(sources[0].title).toBe('Review, Edit, and Export');
    expect(sources[0].section).toBe('Multiple-choice answer modes');
    expect(sources[0].documentId).toBe('review-and-export');
    expect(sources[0].sectionId).toBe('multiple-choice-answer-modes');
    expect(sources[0].navigationPath).toBe('/help?doc=review-and-export&section=multiple-choice-answer-modes');
  });

  test('retrieves learning-objective guidance from a Chinese query', async () => {
    const sources = await helpKnowledgeService.retrieve(
      '如何生成学习目标和 subpoints？',
      {
        route: '/course/course-1/quiz/quiz-1?tab=objectives',
        activeTab: 'Learning Objectives'
      },
      3
    );

    expect(sources.some(source => source.title === 'Learning Objectives')).toBe(true);
    expect(sources.some(source => source.navigationPath?.startsWith('/help?doc=learning-objectives&section='))).toBe(true);
  });

  test('generates compatibility facts from the canonical TypeScript source', async () => {
    const sources = await helpKnowledgeService.retrieve(
      'Which question types work in standalone?',
      { route: '/course/course-1/quiz/quiz-1?tab=generation', activeTab: 'Generate Questions' },
      5
    );

    const compatibilitySource = sources.find(source => (
      source.sourcePath === 'src/constants/questionTypeCapabilities.ts'
      && source.section === 'Delivery targets and formats'
    ));
    const catalogueSource = sources.find(source => (
      source.sourcePath === 'src/constants/questionTypeCapabilities.ts'
      && source.section === 'Question type catalogue'
    ));
    expect(compatibilitySource?.content).toContain('standalone: branching-scenario, crossword, sort-paragraphs');
    expect(compatibilitySource?.navigationPath).toBe('/help?doc=question-types&section=delivery-target-compatibility');
    expect(catalogueSource?.content).toContain('CREATE currently exposes 15 question types.');
  });

  test('retrieves the question catalogue for a natural Chinese count question', async () => {
    const sources = await helpKnowledgeService.retrieve('请问，我们现在支持多少种题目？', {}, 3);

    expect(sources.some(source => source.section === 'Question type catalogue')).toBe(true);
    expect(sources.some(source => source.content.includes('15 question types'))).toBe(true);
  });

  test('retrieves export instructions for Chinese and mixed-language queries', async () => {
    for (const query of ['如何导出', '如何 export']) {
      const sources = await helpKnowledgeService.retrieve(query, {}, 3);
      expect(sources[0].title).toBe('Review, Edit, and Export');
      expect(sources.some(source => source.section === 'PDF and Markdown export')).toBe(true);
    }
  });

  test('provides verified facts for foundational product questions', async () => {
    const typeFacts = await helpKnowledgeService.getVerifiedFacts('支持多少种题型？');
    const exportFacts = await helpKnowledgeService.getVerifiedFacts('如何 export');

    expect(typeFacts[0]).toContain('15 种题型');
    expect(exportFacts[0]).toContain('H5P Package、PDF、Markdown 和 Canvas LTI');
  });

  test('answers foundational facts without depending on an LLM', async () => {
    const chunks = [];
    const result = await answerHelpQuestion({
      message: '我们现在支持多少种题目？',
      history: [],
      context: {},
      userId: 'not-needed-for-verified-facts',
      onChunk: chunk => chunks.push(chunk)
    });

    expect(result.model).toBe('verified-product-facts');
    expect(result.answer).toContain('15 种题型');
    expect(chunks.join('')).toContain('Multiple Choice');
  });
});
