import SystemPromptTemplate from '../models/SystemPromptTemplate.js';

const OUTER_PROMPT = `Create a question distribution plan for a quiz.

Learning Objectives:
{{learningObjectives}}

{{materialsContext}}

TASK: Distribute EXACTLY {{totalQuestions}} questions across the learning objectives.

{{innerPrompt}}

CRITICAL REQUIREMENTS:
1. The sum of ALL counts MUST equal EXACTLY {{totalQuestions}}
2. Distribute across ALL learning objectives proportionally
3. Each item must have count >= 1
4. Return ONLY the JSON object below (no text, no markdown, no explanations)

{
  "planItems": [
    { "type": "multiple-choice", "learningObjectiveIndex": 0, "count": 5 },
    { "type": "flashcard", "learningObjectiveIndex": 1, "count": 3 }
  ]
}`;

const TEMPLATES = [
  {
    approach: 'support',
    outerPrompt: OUTER_PROMPT,
    innerPrompt: `Pedagogical Approach: Support Learning
This approach emphasizes helping students memorize and understand key concepts through flashcards, summaries, and reinforcement activities.

Question Type Rules:
- ONLY use these types: flashcard, summary, mark-the-words, dictation, free-text
- Flashcards should be the MAJORITY (approximately 60-70%)
- Summaries should be a MINORITY (approximately 10-15%)
- Mark-the-words for key term identification (approximately 10-15%)
- Dictation for reinforcing definitions (approximately 5-10%)
- Free-text for reflection (approximately 5%)
- Each learning objective should have AT MOST 1 summary question

Design Guidelines:
- Flashcards for key terms, definitions, and concepts
- Summaries for broader understanding and synthesis
- Mark-the-words to help students identify important terms in context
- Dictation to reinforce accurate recall of definitions
- Free-text for personal reflection and connection`,
    questionTypeRules: {
      allowedTypes: ['flashcard', 'summary', 'mark-the-words', 'dictation', 'free-text'],
      distribution: new Map([['flashcard', 0.65], ['summary', 0.12], ['mark-the-words', 0.12], ['dictation', 0.06], ['free-text', 0.05]]),
      maxPerLO: new Map([['summary', 1]])
    },
    description: 'Support Learning: Focus on memorization and understanding through flashcards and summaries',
    exampleOutput: 'Mostly flashcards (85%) with occasional summaries (15%), max 1 summary per LO',
    isActive: true
  },
  {
    approach: 'assess',
    outerPrompt: OUTER_PROMPT,
    innerPrompt: `Pedagogical Approach: Assess Understanding
This approach emphasizes evaluating student comprehension through varied assessment question types.

Question Type Rules:
- ONLY use these types: multiple-choice, true-false, single-choice-set, simple-multi-choice, essay
- Multiple-choice should be the MAJORITY (approximately 40-50%)
- True/false for quick checks (approximately 15-20%)
- Single-choice-set for rapid-fire assessment (approximately 15-20%)
- Simple-multi-choice for multi-select questions (approximately 10-15%)
- Essay for deeper analysis (approximately 5-10%)
- Each learning objective should have AT MOST 1 essay question
- Distribute types across all learning objectives

Design Guidelines:
- Multiple-choice for complex understanding and application
- True/false for fundamental concepts and quick checks
- Single-choice-set for timed quizzes and quick recall
- Simple-multi-choice when multiple answers are correct
- Essay for in-depth comprehension evaluation
- Mix question types within each learning objective for variety`,
    questionTypeRules: {
      allowedTypes: ['multiple-choice', 'true-false', 'single-choice-set', 'simple-multi-choice', 'essay'],
      distribution: new Map([['multiple-choice', 0.45], ['true-false', 0.18], ['single-choice-set', 0.17], ['simple-multi-choice', 0.12], ['essay', 0.08]]),
      maxPerLO: new Map([['essay', 1]])
    },
    description: 'Assess Understanding: Evaluate comprehension with multiple-choice and true/false questions',
    exampleOutput: 'Mix of multiple-choice (65%) and true/false (35%), distributed across all LOs',
    isActive: true
  },
  {
    approach: 'gamify',
    outerPrompt: OUTER_PROMPT,
    innerPrompt: `Pedagogical Approach: Gamify Learning
This approach emphasizes creating engaging, game-like experiences through interactive question types.

Question Type Rules:
- Use DIVERSE types: matching, ordering, cloze, discussion, crossword, sort-paragraphs, mark-the-words
- DO NOT use: multiple-choice, true-false, flashcard, summary, essay
- Create a VARIED distribution - avoid having all questions of the same type
- Each learning objective should have AT LEAST 2 different question types

Design Guidelines:
- Matching for connecting concepts and relationships
- Ordering for sequences, processes, and hierarchies
- Cloze for fill-in-the-blank and context understanding
- Discussion for critical thinking and analysis
- Crossword for vocabulary and term reinforcement
- Sort-paragraphs for logical sequencing of ideas
- Mark-the-words for identifying key terms in context
- Aim for visual variety and engagement
- Distribute question types so no single type dominates`,
    questionTypeRules: {
      allowedTypes: ['matching', 'ordering', 'cloze', 'discussion', 'crossword', 'sort-paragraphs', 'mark-the-words'],
      distribution: new Map([
        ['matching', 0.20],
        ['ordering', 0.15],
        ['cloze', 0.20],
        ['discussion', 0.10],
        ['crossword', 0.15],
        ['sort-paragraphs', 0.10],
        ['mark-the-words', 0.10]
      ]),
      maxPerLO: new Map()
    },
    description: 'Gamify Learning: Create engaging experiences with interactive question types',
    exampleOutput: 'Diverse mix of matching (30%), ordering (25%), cloze (25%), and discussion (20%)',
    isActive: true
  }
];

/**
 * Initialize system prompt templates if they don't exist
 * This runs automatically on server startup
 */
export async function initializePromptTemplates() {
  try {
    // Check if templates already exist
    const existingCount = await SystemPromptTemplate.countDocuments();
    
    if (existingCount >= 3) {
      console.log(`✅ System prompt templates already initialized (${existingCount} templates found)`);
      return;
    }

    console.log('🔧 Initializing system prompt templates...');

    // Check which templates are missing
    const existingApproaches = await SystemPromptTemplate.find({}, 'approach').lean();
    const existingApproachNames = new Set(existingApproaches.map(t => t.approach));

    let createdCount = 0;
    for (const template of TEMPLATES) {
      if (!existingApproachNames.has(template.approach)) {
        await SystemPromptTemplate.create(template);
        console.log(`✅ Created template for approach: ${template.approach}`);
        createdCount++;
      }
    }

    if (createdCount > 0) {
      console.log(`🎉 Successfully initialized ${createdCount} system prompt template(s)`);
    }
  } catch (error) {
    console.error('❌ Error initializing system prompt templates:', error.message);
    console.error('💡 You may need to run the initialization script manually:');
    console.error('   node routes/create/scripts/initializeSystemPrompts.js');
  }
}

export default { initializePromptTemplates };
