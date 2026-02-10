import mongoose from 'mongoose';
import SystemPromptTemplate from '../models/SystemPromptTemplate.js';
import dotenv from 'dotenv';

dotenv.config();

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
This approach emphasizes helping students memorize and understand key concepts through flashcards and summaries.

Question Type Rules:
- ONLY use these types: flashcard, summary
- Flashcards should be the MAJORITY (approximately 80-90%)
- Summaries should be the MINORITY (approximately 10-20%)
- Each learning objective should have AT MOST 1 summary question
- Distribute flashcards evenly across all learning objectives

Design Guidelines:
- Flashcards for key terms, definitions, and concepts
- Summaries for broader understanding and synthesis`,
    questionTypeRules: {
      allowedTypes: ['flashcard', 'summary'],
      distribution: new Map([['flashcard', 0.85], ['summary', 0.15]]),
      maxPerLO: new Map([['summary', 1]])
    },
    description: 'Support Learning: Focus on memorization and understanding through flashcards and summaries',
    exampleOutput: 'Mostly flashcards (85%) with occasional summaries (15%), max 1 summary per LO'
  },
  {
    approach: 'assess',
    outerPrompt: OUTER_PROMPT,
    innerPrompt: `Pedagogical Approach: Assess Understanding
This approach emphasizes evaluating student comprehension through multiple-choice and true/false questions.

Question Type Rules:
- ONLY use these types: multiple-choice, true-false
- Multiple-choice should be the MAJORITY (approximately 60-70%)
- True/false should complement (approximately 30-40%)
- Distribute both types across all learning objectives

Design Guidelines:
- Multiple-choice for complex understanding and application
- True/false for fundamental concepts and quick checks
- Mix question types within each learning objective for variety`,
    questionTypeRules: {
      allowedTypes: ['multiple-choice', 'true-false'],
      distribution: new Map([['multiple-choice', 0.65], ['true-false', 0.35]]),
      maxPerLO: new Map()
    },
    description: 'Assess Understanding: Evaluate comprehension with multiple-choice and true/false questions',
    exampleOutput: 'Mix of multiple-choice (65%) and true/false (35%), distributed across all LOs'
  },
  {
    approach: 'gamify',
    outerPrompt: OUTER_PROMPT,
    innerPrompt: `Pedagogical Approach: Gamify Learning
This approach emphasizes creating engaging, game-like experiences through interactive question types.

Question Type Rules:
- Use DIVERSE types: matching, ordering, cloze, discussion
- DO NOT use: multiple-choice, true-false, flashcard, summary
- Create a VARIED distribution - avoid having all questions of the same type
- Each learning objective should have AT LEAST 2 different question types

Design Guidelines:
- Matching for connecting concepts and relationships
- Ordering for sequences, processes, and hierarchies
- Cloze for fill-in-the-blank and context understanding
- Discussion for critical thinking and analysis
- Aim for visual variety and engagement
- Distribute question types so no single type dominates`,
    questionTypeRules: {
      allowedTypes: ['matching', 'ordering', 'cloze', 'discussion'],
      distribution: new Map([
        ['matching', 0.3],
        ['ordering', 0.25],
        ['cloze', 0.25],
        ['discussion', 0.2]
      ]),
      maxPerLO: new Map()
    },
    description: 'Gamify Learning: Create engaging experiences with interactive question types',
    exampleOutput: 'Diverse mix of matching (30%), ordering (25%), cloze (25%), and discussion (20%)'
  }
];

async function initializeSystemPrompts() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Clear existing templates
    await SystemPromptTemplate.deleteMany({});
    console.log('🗑️  Cleared existing templates');

    // Insert new templates
    for (const template of TEMPLATES) {
      await SystemPromptTemplate.create(template);
      console.log(`✅ Created template for approach: ${template.approach}`);
    }

    console.log('🎉 System prompts initialized successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error initializing system prompts:', error);
    process.exit(1);
  }
}

initializeSystemPrompts();
