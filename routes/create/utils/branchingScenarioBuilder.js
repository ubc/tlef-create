/**
 * Builds a flat branching scenario skeleton using BFS ordering.
 *
 * Node layout:
 *   Index 0      — intro text node (nextContentId: 1)
 *   Index 1..N   — BranchingQuestion nodes in BFS order
 *
 * nextContentId: -1 means the path ends (default end screen).
 *
 * @param {number} layers  - Number of branching question layers (2–4)
 * @param {number} choices - Number of choices per branching question (2–3)
 * @returns {Array} Flat array of node descriptors
 */
export function buildBranchingStructure(layers, choices) {
  const nodes = [];

  // Node 0: intro text — always leads to the first branching question
  nodes.push({
    index: 0,
    type: 'text',
    nextContentId: 1
  });

  // BFS queue entries: { index, layer }
  const queue = [{ index: 1, layer: 1 }];
  let nextIndex = 2;

  while (queue.length > 0) {
    const { index, layer } = queue.shift();

    if (layer === layers) {
      // Leaf layer: all choices end the scenario
      nodes.push({
        index,
        type: 'bq',
        layer,
        alternatives: Array.from({ length: choices }, (_, i) => ({
          choiceIndex: i,
          nextContentId: -1
        }))
      });
    } else {
      // Internal layer: each choice leads to a child BQ node
      const childIndices = Array.from({ length: choices }, (_, i) => nextIndex + i);

      nodes.push({
        index,
        type: 'bq',
        layer,
        alternatives: childIndices.map((childIndex, i) => ({
          choiceIndex: i,
          nextContentId: childIndex
        }))
      });

      childIndices.forEach(ci => queue.push({ index: ci, layer: layer + 1 }));
      nextIndex += choices;
    }
  }

  return nodes;
}

/**
 * Converts the skeleton into a prompt string describing the structure,
 * so the LLM knows exactly which fields to fill in.
 *
 * @param {number} layers
 * @param {number} choices
 * @param {string} learningObjective - LO text for context
 * @returns {string} Prompt fragment describing the required JSON
 */
export function buildBranchingPrompt(layers, choices, learningObjective) {
  const nodes = buildBranchingStructure(layers, choices);

  const nodeDescriptions = nodes.map(node => {
    if (node.type === 'text') {
      return `  Node ${node.index} (Intro Text):
    - "introText": "[FILL: 1-2 sentences setting the scene, relevant to the learning objective]"
    - nextContentId is fixed at ${node.nextContentId} — do not change`;
    }

    const altDescriptions = node.alternatives.map(alt => {
      const dest = alt.nextContentId === -1 ? 'end of scenario' : `Node ${alt.nextContentId}`;
      return `      Choice ${alt.choiceIndex + 1}: "[FILL: option text]" → ${dest}${alt.nextContentId === -1 ? ', feedback: "[FILL: outcome/consequence]"' : ''}`;
    }).join('\n');

    return `  Node ${node.index} (Branching Question, Layer ${node.layer}):
    - "question": "[FILL: decision-point question based on the scenario]"
    - nextContentId values are fixed — do not change
    - Alternatives:\n${altDescriptions}`;
  }).join('\n\n');

  return `Generate a Branching Scenario for the following learning objective:
"${learningObjective}"

The scenario has ${layers} decision layers with ${choices} choices each.
Total nodes: ${nodes.length} (1 intro text + ${nodes.length - 1} branching questions).

RULES:
1. Only fill in [FILL] fields. Do NOT change any nextContentId values.
2. Make the scenario realistic and relevant to the learning objective.
3. Each choice should lead to meaningfully different consequences.
4. Leaf-node choices (→ end of scenario) must include a "feedback" field explaining the outcome.
5. Return valid JSON only — no explanation outside the JSON.

Node structure to fill in:

${nodeDescriptions}

Return this exact JSON shape:
{
  "introText": "...",
  "nodes": [
    {
      "index": <number>,
      "question": "..." | null (null for text node — use introText instead),
      "alternatives": [
        { "text": "...", "nextContentId": <number>, "feedback": "..." | null }
      ]
    }
  ]
}`;
}
