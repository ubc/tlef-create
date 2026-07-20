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

  test('retrieves AI Link Missing recovery guidance', async () => {
    const sources = await helpKnowledgeService.retrieve(
      'AI Link Missing failed to add source references',
      { route: '/course/course-1/quiz/quiz-1?tab=objectives', activeTab: 'Learning Objectives' },
      4
    );

    expect(sources.some(source => source.section === 'Evidence and enrichment')).toBe(true);
  });

  test('retrieves learning-objective generation log guidance', async () => {
    const sources = await helpKnowledgeService.retrieve(
      'What happens before the Live model draft? Explain the source inventory and instructional clusters.',
      { route: '/course/course-1/quiz/quiz-1?tab=objectives', activeTab: 'Learning Objectives' },
      4
    );

    expect(sources.some(source => source.section === 'Understand the generation log')).toBe(true);
  });

  test('retrieves GPT-5 output-budget retry guidance for learning objectives', async () => {
    const sources = await helpKnowledgeService.retrieve(
      'Why did GPT-5 stop before returning learning objective text, and will CREATE retry the output budget?',
      { route: '/course/course-1/quiz/quiz-1?tab=objectives', activeTab: 'Learning Objectives' },
      4
    );

    expect(sources.some(source => source.section === 'Understand the generation log')).toBe(true);
  });

  test('retrieves source-type material preview guidance', async () => {
    const sources = await helpKnowledgeService.retrieve(
      'Does the material eye icon open the PDF and show extracted text for a URL?',
      { route: '/course/course-1', activeTab: 'Materials' },
      4
    );

    expect(sources.some(source => source.section === 'Preview extracted content')).toBe(true);
  });

  test('explains editable and locked course prompt layers', async () => {
    const sources = await helpKnowledgeService.retrieve(
      'What are locked CREATE instructions in Course Prompts?',
      { route: '/course/course-1', activeTab: 'Course Prompts' },
      4
    );

    expect(sources.some(source => source.section === 'Editable and locked instructions')).toBe(true);
  });

  test('retrieves prompt validation and Apply Changes guidance', async () => {
    const sources = await helpKnowledgeService.retrieve(
      'Why did the default prompt get a warning, and what does Apply Changes do after Validate?',
      { route: '/course/course-1', activeTab: 'Course Prompts' },
      4
    );

    expect(sources.some(source => source.section === 'Validate before saving')).toBe(true);
  });

  test('retrieves how to add another quiz from a populated course', async () => {
    const sources = await helpKnowledgeService.retrieve(
      'How do I add another quiz when my course already has quizzes?',
      { route: '/course/course-1', activeTab: 'Quizzes' },
      4
    );

    expect(sources.some(source => source.section === 'Create and open quizzes')).toBe(true);
  });

  test('retrieves the CREATE Guide launcher tutorial', async () => {
    const sources = await helpKnowledgeService.retrieve(
      'How do I replay the tutorial for the AI chat button in the bottom-right corner?',
      { route: '/course/course-1', activeTab: 'Materials' },
      4
    );

    expect(sources.some(source => source.section === 'Using CREATE Guide')).toBe(true);
  });

  test('retrieves manual Bloom, subpoint, and single-objective enrichment guidance', async () => {
    const sources = await helpKnowledgeService.retrieve(
      'How do I manually choose Bloom create, add subpoints, and AI enrich one LO?',
      { route: '/course/course-1/quiz/quiz-1?tab=objectives', activeTab: 'Learning Objectives' },
      4
    );

    expect(sources.some(source => source.section === 'Add existing or manual objectives')).toBe(true);
    expect(sources.some(source => source.section === 'Evidence and enrichment')).toBe(true);
  });

  test('retrieves stale search result recovery guidance', async () => {
    const sources = await helpKnowledgeService.retrieve(
      'Global Search opened Quiz not found and returned 404',
      { route: '/course/missing-course/quiz/missing-quiz', activeTab: 'Search' },
      4
    );

    expect(sources.some(source => source.section === 'A search result is no longer available')).toBe(true);
  });

  test('retrieves the individual AI Enrich tutorial guidance', async () => {
    const sources = await helpKnowledgeService.retrieve(
      'Why does the sparkle button tutorial appear after I manually add an LO, and how do I use Enrich this LO?',
      { route: '/course/course-1/quiz/quiz-1?tab=objectives', activeTab: 'Learning Objectives' },
      4
    );

    expect(sources.some(source => source.section === 'Evidence and enrichment')).toBe(true);
  });

  test('retrieves linked-question guidance after an objective is edited', async () => {
    const sources = await helpKnowledgeService.retrieve(
      'Should I regenerate linked questions after editing a learning objective?',
      { route: '/course/course-1/quiz/quiz-1?tab=objectives', activeTab: 'Learning Objectives' },
      4
    );

    expect(sources.some(source => source.section === 'Editing and deleting objectives')).toBe(true);
  });

  test('retrieves PDF guidance for structured question types', async () => {
    const sources = await helpKnowledgeService.retrieve(
      'Does PDF export include Mark the Words, Documentation Tool, Summary, and Essay content?',
      { route: '/course/course-1/quiz/quiz-1?tab=review', activeTab: 'Review & Edit' },
      4
    );

    expect(sources.some(source => source.section === 'PDF and Markdown export')).toBe(true);
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
