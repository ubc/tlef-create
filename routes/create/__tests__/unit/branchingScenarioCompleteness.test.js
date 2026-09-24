import { describe, expect, test } from '@jest/globals';
import { buildBranchingPrompt, buildBranchingStructure, sourceScenarioChoiceCounts, validateBranchingDraft } from '../../utils/branchingScenarioBuilder.js';
import { buildNativeH5PDocument } from '../../services/h5pExportService.js';
import { renderNativeH5PPreview } from '../../services/h5pNativePreviewService.js';
import llmService from '../../services/llmService.js';
import Quiz from '../../models/Quiz.js';
import mongoose from 'mongoose';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function completeDraft() {
  return {
    introText: 'A group is deciding how to use AI.',
    nodes: buildBranchingStructure(2, 2).map(node => node.type === 'text'
      ? { index: node.index, question: null, alternatives: [] }
      : { index: node.index, question: `Decision ${node.index}?`, alternatives: node.alternatives.map((choice, index) => ({
        text: `Choice ${node.index}.${index + 1}`,
        nextContentId: choice.nextContentId,
        feedback: choice.nextContentId < 0 ? `Consequence of choice ${node.index}.${index + 1}` : null
      })) })
  };
}

describe('Branching Scenario completeness', () => {
  test('uses teaching instructions and source evidence in the model request', () => {
    const prompt = buildBranchingPrompt(2, 2, 'Negotiate a group agreement', {
      customPrompt: 'Address disagreements about AI use',
      instructorPrompt: 'Keep the consequences constructive',
      relevantContent: [{ content: 'Speak privately before escalating.' }]
    });
    expect(prompt).toContain('Address disagreements about AI use');
    expect(prompt).toContain('Keep the consequences constructive');
    expect(prompt).toContain('Speak privately before escalating.');
    expect(prompt).toContain('"nextContentId": 3');
  });

  test('the question generator passes course evidence into the Branching prompt', async () => {
    const prompt = await llmService.buildExpertPrompt(
      'Resolve an AI policy concern', 'branching-scenario',
      [{ content: 'Ask a clarifying question in private.' }], 'moderate',
      'Group projects', [], 'Show several plausible decisions', 'single', 2, 2
    );
    expect(prompt).toContain('Ask a clarifying question in private.');
    expect(prompt).toContain('Show several plausible decisions');
    expect(prompt).toContain('Group projects');
  });

  test('refuses incomplete branches instead of silently saving broken navigation', () => {
    const draft = completeDraft();
    expect(validateBranchingDraft(draft, 2, 2).nodes).toHaveLength(4);
    draft.nodes[3].question = '';
    expect(() => validateBranchingDraft(draft, 2, 2)).toThrow(/node 3 has no question/);
    draft.nodes[3].question = 'Decision 3?';
    draft.nodes[3].alternatives[0].feedback = '';
    expect(() => validateBranchingDraft(draft, 2, 2)).toThrow(/no outcome feedback/);
  });

  test('accepts three and five source-backed outcomes within one two-layer scenario', () => {
    const draft = completeDraft();
    draft.nodes[2].alternatives.push({ text: 'Third group-agreement response', nextContentId: -1, feedback: 'A distinct outcome.' });
    draft.nodes[3].alternatives.push(...[3, 4, 5].map(index => ({
      text: `Integrity response ${index}`, nextContentId: -1, feedback: `Consequence ${index}`
    })));
    expect(validateBranchingDraft(draft, 2, 2).nodes.map(node => node.alternatives.length)).toEqual([0, 2, 3, 5]);
  });

  test('preserves explicitly numbered choices from a complete source', () => {
    const source = [{ content: `Scenario A: Agree on group AI use\nOption 1: Discuss\nOption 2: Switch groups\nOption 3: Persuade\nScenario B: Suspected policy issue\nOption 1: Accuse\nOption 2: Speak privately\nOption 3: Group chat\nOption 4: Tell instructor\nOption 5: Take no action` }];
    expect(sourceScenarioChoiceCounts(source, 2, 2)).toEqual([3, 5]);
    const prompt = buildBranchingPrompt(2, 2, 'Use AI responsibly', { relevantContent: source });
    expect(prompt).toContain('exactly 3 numbered options');
    expect(prompt).toContain('second has exactly 5');
    const draft = completeDraft();
    draft.nodes[2].alternatives.push({ text: 'Third', nextContentId: -1, feedback: 'Third consequence' });
    draft.nodes[3].alternatives.push(...[3, 4, 5].map(index => ({ text: `Option ${index}`, nextContentId: -1, feedback: `Consequence ${index}` })));
    expect(validateBranchingDraft(draft, 2, 2, [3, 5]).nodes).toHaveLength(4);
    draft.nodes[3].alternatives.pop();
    expect(() => validateBranchingDraft(draft, 2, 2, [3, 5])).toThrow(/preserve 5 numbered source options/);
  });

  test('persists several objective references on one planned Branching Scenario row', () => {
    const [primary, secondary] = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
    const quiz = new Quiz({ settings: { planItems: [{
      type: 'branching-scenario', learningObjective: primary, supportingLearningObjectives: [secondary],
      count: 1, branchingLayers: 2, branchingChoices: 2
    }] } });
    expect(quiz.settings.planItems).toHaveLength(1);
    expect(quiz.settings.planItems[0].supportingLearningObjectives.map(String)).toEqual([String(secondary)]);
  });

  test('repairs legacy node gaps and gives every ending its own visible outcome', async () => {
    const draft = completeDraft();
    draft.nodes[2].question = '';
    const quiz = {
      _id: 'branching-completeness', name: 'Group agreements', containerMode: 'standalone',
      questions: [{ type: 'branching-scenario', questionText: 'Group agreements', content: draft }]
    };
    const document = await buildNativeH5PDocument(quiz);
    const scenario = document.parameters.branchingScenario;
    expect(scenario.content).toHaveLength(3);
    const targets = scenario.content.flatMap(node => node.type.params.branchingQuestion?.alternatives?.map(choice => choice.nextContentId) || []);
    expect(targets).toContain(-1);
    expect(targets.every(target => target < 0 || target < scenario.content.length)).toBe(true);
    expect(scenario.endScreens.length).toBeGreaterThan(0);
    expect(scenario.endScreens.every(end => end.endScreenTitle && end.endScreenSubtitle)).toBe(true);
    await expect(renderNativeH5PPreview(document)).resolves.toContain('H5P.BranchingScenario-1.10');
  });

  test('preserves different choice counts in the two situations from the instructor example', async () => {
    const quiz = {
      _id: 'branching-source-example', name: 'Navigating Group Projects', containerMode: 'standalone',
      questions: [{ type: 'branching-scenario', questionText: 'Navigating Group Projects', content: {
        introText: 'Choose a group-project situation.',
        nodes: [
          { index: 0 },
          { index: 1, question: 'Which situation would you like to explore?', alternatives: [
            { text: 'Group agreement', nextContentId: 2 },
            { text: 'Possible AI policy violation', nextContentId: 3 }
          ] },
          { index: 2, question: 'How will you handle differing views on AI use?', alternatives: [
            { text: 'Discuss the reasons', nextContentId: -1, feedback: 'Seek common ground.' },
            { text: 'Ask to switch groups', nextContentId: -1, feedback: 'Discuss first, then ask for help.' },
            { text: 'Insist you are right', nextContentId: -1, feedback: 'Curiosity can work better than confrontation.' }
          ] },
          { index: 3, question: 'What will you do about a possible policy violation?', alternatives: Array.from({ length: 5 }, (_, index) => ({
            text: `Option ${index + 1}`, nextContentId: -1, feedback: `Outcome ${index + 1}`
          })) }
        ]
      } }]
    };
    const document = await buildNativeH5PDocument(quiz);
    const scenario = document.parameters.branchingScenario;
    expect(scenario.content[2].type.params.branchingQuestion.alternatives).toHaveLength(3);
    expect(scenario.content[3].type.params.branchingQuestion.alternatives).toHaveLength(5);
    expect(scenario.endScreens).toHaveLength(8);
    const runtime = JSON.parse(execFileSync(process.execPath, [
      fileURLToPath(new URL('../fixtures/runH5PPreviewRuntime.mjs', import.meta.url))
    ], { input: JSON.stringify(document), encoding: 'utf8', timeout: 10000 }));
    expect(runtime.errors).toEqual([]);
    expect(runtime.instanceCount).toBe(1);
  });
});
