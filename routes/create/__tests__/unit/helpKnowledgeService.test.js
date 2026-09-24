import { describe, expect, test } from '@jest/globals';
import helpKnowledgeService from '../../services/helpKnowledgeService.js';
import { answerHelpQuestion } from '../../services/helpChatService.js';

describe('CREATE Guide knowledge retrieval', () => {
  test.each([
    ['Recovered unsaved edits View recovered content Copy draft Download draft Save as new question', 'review-and-export', 'Recovered unsaved edits'],
    ['Create with AI', 'h5p-studio', 'Create with AI'],
    ['One activity Question collection multiple question type cards Add course evidence', 'h5p-studio', 'Create with AI'],
    ['AI Link Missing', 'learning-objectives', 'Evidence and enrichment'],
    ['rate limit timeout incomplete Blueprint', 'troubleshooting', 'AI generation does not start']
  ])('ranks the specific action or error above broad workflow mentions: %s', async (query, documentId, section) => {
    const [first] = await helpKnowledgeService.retrieve(query, {}, 1);
    expect(first).toMatchObject({ documentId, section });
    expect(first.navigationPath).toContain(`/help?doc=${documentId}&section=`);
  });
  test.each([
    ['Create with AI Use course materials Quick activity keep teaching task unsaved plan New blank activity Import .h5p', 'h5p-studio', 'Create with AI'],
    ['Question collection select multiple types AI chooses when no cards selected quantities plan', 'h5p-studio', 'Create with AI'],
    ['Prompt helper conversation context selected objectives Yes generate prompt Not now Copy prompt Use this prompt', 'h5p-studio', 'Create with AI'],
    ['Quick activity Generate AI draft independent Quiz questions native activity Find a type Teaching instructions', 'h5p-studio', 'Quick activity'],
    ['AI assistant Upload PDF or DOCX Ready Course Learning Object Teaching task Plan learning objectives questions', 'h5p-studio', 'Use course materials: course and teaching task'],
    ['Approve generate questions Save plan Number of questions Linked learning objectives eight twenty', 'h5p-studio', 'Review and approve an assistant question plan'],
    ['Question progress prepared Question preview combined Column Edit activity Preview activity', 'h5p-studio', 'Watch assistant question progress and open the Studio draft'],
    ['Live AI draft live updates connected interrupted Check status durable task no duplicate generation', 'h5p-studio', 'Watch assistant question progress and open the Studio draft'],
    ['Retry same request Retry planning Retry question batch Retry Studio draft Recent tasks Check status', 'h5p-studio', 'Recover an AI assistant task'],
    ['Add Question AI Generate 30 seconds unconfirmed Question Saved refresh duplicate', 'review-and-export', 'Add or regenerate a question'],
    ['Custom Prompt scenario exclusions instruction-check failure novelty constraints', 'review-and-export', 'Add or regenerate a question'],
    ['Generation task status Check task status safe Replace Existing Questions Saved questions preserved after refresh', 'quiz-blueprint', 'Recover question generation and safely replace questions'],
    ['Close unregistered request no saved receipt delayed submission accepted generation', 'quiz-blueprint', 'Close unregistered request'],
    ['Recovered unsaved edits View recovered content Copy draft Download draft Save as new question', 'review-and-export', 'Recovered unsaved edits'],
    ['Safely replace learning objectives invalid input failed save previous objectives questions preserved', 'learning-objectives', 'Safely replace learning objectives'],
    ['H5P Studio activities Continue in Studio Course source Separate Studio version course page', 'h5p-studio', 'Find Studio activities from a course'],
    ['URL request failed retain input Retry incomplete embedding Premature close', 'materials', 'Upload and processing states'],
    ['Generate Plan fixed count empty fractional minimum maximum 100', 'quiz-blueprint', 'Set a fixed question count'],
    ['failed pending materials generation replaces existing questions custom-prompt-only', 'quiz-blueprint', 'Generate questions'],
    ['Cancel unsaved question edits restore options feedback', 'review-and-export', 'Cancel edits and delete questions'],
    ['Move up Move down reorder All Objectives saves automatically', 'review-and-export', 'Reorder questions'],
    ['Mark review complete exclamation mark step four check all objectives', 'review-and-export', 'Review order and completeness'],
    ['AI feedback check selecting omitting option instructor review', 'review-and-export', 'Multiple-choice answer modes'],
    ['deleting objective confirmation no linked questions warning preference', 'learning-objectives', 'Editing and deleting objectives'],
    ['Administrator per-user statistics currently saved deleted content excluded', 'account-and-support', 'Administrator content statistics'],
    ['Create a new activity saved brief different template Documentation Tool pages', 'h5p-studio', 'Return to Quick activity'],
    ['Preview Save changes and preview unchanged Edited time no save notification', 'h5p-studio', 'Preview and download'],
    ['Mixed Activity isolated H5P players standalone types not Column Canvas preview', 'review-and-export', 'H5P export'],
    ['Mixed Activity shared minimal H5P core question libraries once standalone runnable instances', 'review-and-export', 'H5P export'],
    ['Coverage Map LO 1 Chunk 1 displayed sequence named sections', 'coverage-and-references', 'Coverage Map'],
    ['Question retrieval assigned materials before most relevant other course evidence', 'coverage-and-references', 'Resolve weak or missing evidence']
  ])('retrieves recovery guidance: %s', async (query, documentId, section) => {
    const sources = await helpKnowledgeService.retrieve(query, {}, 5);
    expect(sources.some(source => source.documentId === documentId && source.section === section)).toBe(true);
  });
  test('retrieves Studio preview width and automatic height guidance', async () => {
    const sources = await helpKnowledgeService.retrieve('H5P Studio preview cut off fixed height inner scrolling Back to editor fullscreen', { route: '/h5p-studio' }, 4);
    expect(sources.some(source => source.documentId === 'h5p-studio' && source.section === 'Media preview and save troubleshooting')).toBe(true);
  });
  test('explains retained teaching instructions and missing Documentation Tool elements', async () => {
    const sources = await helpKnowledgeService.retrieve('Return to Quick activity Teaching instructions Documentation Tool Elements Heading', { route: '/h5p-studio' }, 5);
    expect(sources.some(source => source.section === 'Return to Quick activity')).toBe(true);
  });
  test('retrieves media save rules and retired external services', async () => {
    const media = await helpKnowledgeService.retrieve('Multimedia Choice Poster image hidden picture options Image Hotspots save', { route: '/h5p-studio' }, 5);
    expect(media.some(source => source.section === 'Media preview and save troubleshooting')).toBe(true);
    const retired = await helpKnowledgeService.retrieve('Twitter User Feed no longer supported API needs maintenance', { route: '/h5p-studio' }, 5);
    expect(retired.some(source => source.section === 'AI media templates and availability')).toBe(true);
  });
  test('retrieves Studio receipt recovery and independent draft boundaries', async () => {
    const recovered = await helpKnowledgeService.retrieve('Check generation status after refresh or disconnection in Studio', { route: '/h5p-studio' }, 5);
    expect(recovered.some(source => source.section === 'Recover a Studio generation after refresh or disconnection')).toBe(true);
    const sources = await helpKnowledgeService.retrieve('Independent Studio draft source Quiz has changed', { route: '/h5p-studio' }, 5);
    expect(sources.some(source => source.section === 'Independent Studio draft and source Quiz')).toBe(true);
  });
  test('loads curated help documents and generated capability facts', async () => {
    const status = await helpKnowledgeService.getStatus();

    expect(status.documents).toBeGreaterThanOrEqual(11);
    expect(status.chunks).toBeGreaterThan(status.documents);
    expect(status.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(status.refreshedAutomatically).toBe(true);
  });

  test('retrieves multiple-answer guidance for Review', async () => {
    const sources = await helpKnowledgeService.retrieve(
      'How do I make a multiple-answer MCQ?',
      {
        route: '/course/course-1/quiz/quiz-1?tab=review',
        activeTab: 'Review'
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

  test('retrieves incomplete Blueprint retry and provider-error guidance', async () => {
    const sources = await helpKnowledgeService.retrieve(
      'Why did the AI Blueprint stop with incomplete JSON, rate limit, or timeout, and will CREATE retry?',
      { route: '/course/course-1/quiz/quiz-1?tab=generation', activeTab: 'Generate Questions' },
      5
    );

    expect(sources.some(source => (
      source.title === 'Troubleshooting and Recovery'
      && source.section === 'AI generation does not start'
    ))).toBe(true);
  });

  test('retrieves cross-tab question-count synchronization guidance', async () => {
    const sources = await helpKnowledgeService.retrieve(
      'Why did my Question Plan count change after I added or deleted questions in Review & Edit?',
      { route: '/course/course-1/quiz/quiz-1?tab=generation', activeTab: 'Generate Questions' },
      4
    );

    expect(sources.some(source => (
      source.title === 'AI Blueprint and Question Generation'
      && source.section === 'Read and edit Blueprint rows'
    ))).toBe(true);
  });

  test('retrieves the H5P package format order and Question Set description', async () => {
    const sources = await helpKnowledgeService.retrieve(
      'How are H5P Package formats ordered in the Generate Questions Delivery target and format section?',
      { route: '/course/course-1/quiz/quiz-1?tab=generation', activeTab: 'Generate Questions' },
      4
    );

    const deliverySource = sources.find(source => (
      source.title === 'AI Blueprint and Question Generation'
      && source.section === 'Delivery target and format'
    ));
    expect(deliverySource?.content).toContain('Question Set, Interactive Book, Column, and Standalone, in that order');
    expect(deliverySource?.content).toContain('text or video feedback');
  });

  test('retrieves visual layout previews rather than promising generated screenshots', async () => {
    const sources = await helpKnowledgeService.retrieve(
      'What do the visual layout previews mean: chapters and pages or one scrolling page?',
      { route: '/course/course-1/quiz/quiz-1?tab=generation', activeTab: 'Blueprint & Generate' }, 4
    );
    const source = sources.find(item => item.documentId === 'quiz-blueprint' && item.section === 'Visual layout previews');
    expect(source?.content).toContain('not screenshots');
    expect(source?.content).toContain('Standalone');
    expect(source?.content).toContain('Branching Scenario');
    expect(source?.navigationPath).toBe('/help?doc=quiz-blueprint&section=visual-layout-previews');
  });

  test('retrieves safe return to the three teaching streams', async () => {
    const sources = await helpKnowledgeService.retrieve(
      'Does Back to AI Plan Configuration return to ASSESS SUPPORT GAMIFY and delete my questions?',
      { route: '/course/course-1/quiz/quiz-1?tab=generation', activeTab: 'Blueprint & Generate' }, 4
    );
    const source = sources.find(item => item.documentId === 'quiz-blueprint' && item.section === 'Back to AI Plan Configuration');
    expect(source?.content).toContain('does not call AI');
    expect(source?.content).toContain('Cancel either confirmation');
  });

  test('retrieves the next action and optional prompt details on generation results', async () => {
    const sources = await helpKnowledgeService.retrieve(
      'What is Continue to Review and how do I Show Details in Generation Prompt Analysis?',
      { route: '/course/course-1/quiz/quiz-1?tab=generation', activeTab: 'Blueprint & Generate' }, 4
    );
    expect(sources.some(source => source.documentId === 'quiz-blueprint'
      && source.section === 'Generate questions' && source.content.includes('collapsed by default'))).toBe(true);
  });

  test('retrieves H5P Studio advanced-editor guidance', async () => {
    const sources = await helpKnowledgeService.retrieve(
      'How do I upload an H5P package and edit it with the advanced official editor?',
      { route: '/h5p-studio', activeTab: 'H5P Studio' },
      4
    );

    expect(sources.some(source => (
      source.title === 'H5P Studio'
      && ['Upload an H5P package', 'Create new H5P content'].includes(source.section)
    ))).toBe(true);
  });

  test('retrieves the unified AI entrance and distinguishes its two saving boundaries', async () => {
    const sources = await helpKnowledgeService.retrieve(
      'How do I Create with AI in H5P Studio and does the new AI draft replace my Quiz questions?',
      { route: '/h5p-studio', activeTab: 'H5P Studio' }, 4
    );
    expect(sources.some(source => source.documentId === 'h5p-studio' && source.section === 'Create with AI' && source.content.includes('native AI draft does not replace or update Quiz questions'))).toBe(true);
  });

  test('retrieves real-media template and maintenance limitations for Studio AI', async () => {
    const sources = await helpKnowledgeService.retrieve(
      'Why does Memory Game need a saved template with real media, and what does Needs maintenance mean?',
      { route: '/h5p-studio', activeTab: 'H5P Studio' }, 4
    );
    expect(sources.some(source => source.documentId === 'h5p-studio' && source.section === 'AI media templates and availability')).toBe(true);
  });

  test('retrieves H5P Studio fresh-draft and Preview synchronization guidance', async () => {
    const sources = await helpKnowledgeService.retrieve(
      'Should I open the existing H5P Studio draft or create a fresh draft, and does Preview use the export version?',
      { route: '/course/course-1/quiz/quiz-1?tab=review', activeTab: 'Review & Edit' },
      5
    );

    expect(sources.some(source => (
      source.title === 'H5P Studio'
      && source.content.includes('Create fresh draft')
    ))).toBe(true);
    expect(sources.some(source => (
      source.title === 'Review, Edit, and Export'
      && source.content.includes('same native H5P builder')
    ))).toBe(true);
  });

  test('retrieves Coverage Map viewport recovery guidance', async () => {
    const sources = await helpKnowledgeService.retrieve(
      'How do I center the Coverage Map and fit every node back into view?',
      { route: '/course/course-1/quiz/quiz-1?tab=coverage', activeTab: 'Coverage Map' },
      4
    );

    expect(sources.some(source => (
      source.title === 'Coverage Map and Source References'
      && source.section === 'Coverage Map'
    ))).toBe(true);
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

    expect(sources.some(source => source.section === 'Create and open Quizzes')).toBe(true);
  });

  test('retrieves dynamic Dashboard guidance', async () => {
    const sources = await helpKnowledgeService.retrieve(
      'What do Continue where you left off and Needs attention show on the Dashboard?',
      { route: '/', activeTab: 'Dashboard' },
      4
    );

    expect(sources.some(source => (
      source.title === 'Getting Started with CREATE'
      && source.section === 'Dashboard and recommended work'
      && source.content.includes('Your courses')
    ))).toBe(true);
  });

  test('retrieves numbered Course and Quiz workflow guidance', async () => {
    const workflowSources = await helpKnowledgeService.retrieve(
      'What do the numbered Course steps and five Quiz steps mean?',
      { route: '/course/course-1', activeTab: 'Course Home' },
      6
    );

    expect(workflowSources.some(source => (
      source.title === 'Getting Started with CREATE'
      && source.section === 'Recommended end-to-end workflow'
      && source.content.includes('Preview & Export')
    ))).toBe(true);

    const coverageSources = await helpKnowledgeService.retrieve(
      'Where is Coverage Map in the Learning Object workflow?',
      { route: '/course/course-1/quiz/quiz-1?tab=coverage', activeTab: 'Coverage Map' },
      6
    );
    expect(coverageSources.some(source => (
      source.title === 'Coverage Map and Source References'
      && source.section === 'Coverage Map'
      && source.content.includes('supporting quality tool')
    ))).toBe(true);
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

  test('retrieves in-app dialog and destructive confirmation guidance', async () => {
    const sources = await helpKnowledgeService.retrieve(
      'What happens when a destructive confirmation dialog opens instead of a browser alert?',
      { route: '/course/course-1', activeTab: 'Materials' },
      4
    );

    expect(sources.some(source => (
      source.title === 'Troubleshooting and Recovery'
      && source.section === 'Dialogs and confirmations'
    ))).toBe(true);
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
    expect(compatibilitySource?.content).toContain('standalone: crossword, sort-paragraphs');
    expect(compatibilitySource?.content).toMatch(/standalone:.*branching-scenario/);
    expect(compatibilitySource?.navigationPath).toBe('/help?doc=question-types&section=delivery-target-compatibility');
    expect(catalogueSource?.content).toContain('16 question types; 16 are currently available');
    expect(catalogueSource?.content).toContain('Branching Scenario (branching-scenario)');
    expect(catalogueSource?.content).not.toContain('temporarily unavailable');
  });

  test('retrieves the question catalogue for a natural Chinese count question', async () => {
    const sources = await helpKnowledgeService.retrieve('请问，我们现在支持多少种题目？', {}, 3);

    expect(sources.some(source => source.section === 'Question type catalogue')).toBe(true);
    expect(sources.some(source => source.content.includes('16 question types'))).toBe(true);
  });

  test('retrieves export instructions for Chinese and mixed-language queries', async () => {
    for (const query of ['如何导出', '如何 export']) {
      const sources = await helpKnowledgeService.retrieve(query, {}, 3);
      expect(sources.some(source => source.title === 'Review, Edit, and Export')).toBe(true);
      expect(sources.some(source => source.section === 'PDF and Markdown export')).toBe(true);
    }
  });

  test('provides verified facts for foundational product questions', async () => {
    const typeFacts = await helpKnowledgeService.getVerifiedFacts('支持多少种题型？');
    const exportFacts = await helpKnowledgeService.getVerifiedFacts('如何 export');

    expect(typeFacts[0]).toContain('16 种题型');
    expect(typeFacts[0]).toContain('16 种可用于新建');
    expect(typeFacts[0]).toContain('Branching Scenario');
    expect(typeFacts[0]).not.toContain('暂停使用');
    expect(exportFacts[0]).toContain('H5P Package、PDF、Markdown 和 Canvas LTI');
    expect(exportFacts[0]).toContain('第 5 步 Preview & Export');
    expect(exportFacts[0]).not.toContain('Review & Edit 页面底部');
    const english = await helpKnowledgeService.getVerifiedFacts('How do I export questions without answers?');
    expect(english[0]).toContain('Step 5, Preview & Export');
    expect(english[0]).toContain('without the answer section');
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
    expect(result.answer).toContain('16 种题型');
    expect(chunks.join('')).toContain('Multiple Choice');
  });

  test('cites actual export guidance for a Chinese handout question from Dashboard', async () => {
    const result = await answerHelpQuestion({
      message: '如何导出不带答案的题目？', history: [],
      context: { route: '/', pageTitle: 'Dashboard', activeTab: 'Dashboard' }, userId: 'not-needed'
    });
    expect(result.model).toBe('verified-product-facts');
    expect(result.sources.map(source => source.section)).toEqual([
      'Review, Edit, and Export', 'PDF and Markdown export', 'H5P export', 'Canvas export'
    ]);
    const handout = result.sources.find(source => source.section === 'PDF and Markdown export');
    expect(result.answer).toContain(`Questions（仅题目，不含答案区）、Answers 或 Combined。[${handout.citationIndex}]`);
    expect(handout.navigationPath).toBe('/help?doc=review-and-export&section=pdf-and-markdown-export');
    expect(handout.content).toContain('questions-only for a learner handout');
    expect(result.sources.every(source => source.documentId === 'review-and-export')).toBe(true);
  });

  test('combined type-count and export answers keep distinct supporting citation indexes', async () => {
    const result = await answerHelpQuestion({
      message: '现在支持多少种题型？如何导出不带答案的题目？', history: [],
      context: { route: '/', pageTitle: 'Dashboard', activeTab: 'Dashboard' }, userId: 'not-needed'
    });
    const catalogue = result.sources.find(source => source.section === 'Question type catalogue');
    const handout = result.sources.find(source => source.section === 'PDF and Markdown export');
    expect(catalogue.sourcePath).toBe('src/constants/questionTypeCapabilities.ts');
    expect(catalogue.navigationPath).toBe('/help?doc=question-types&section=question-type-catalogue');
    expect(handout.citationIndex).not.toBe(catalogue.citationIndex);
    expect(result.answer).toContain(`Documentation Tool。[${catalogue.citationIndex}]`);
    expect(result.answer).toContain(`Questions（仅题目，不含答案区）、Answers 或 Combined。[${handout.citationIndex}]`);
    const markers = [...result.answer.matchAll(/\[(\d+)\]/g)].map(match => Number(match[1]));
    expect(new Set(markers)).toEqual(new Set(result.sources.map(source => source.citationIndex)));
    expect(result.sources.some(source => source.documentId === 'overview')).toBe(false);
  });
});
