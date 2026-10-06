import { QUESTION_TYPES } from '../config/constants.js';
import { normalizeGeneratedQuestionText } from '../utils/questionTextLimits.js';
import { buildBranchingPrompt, validateBranchingDraft } from '../utils/branchingScenarioBuilder.js';
import { extractBalancedJson } from '../utils/openAIRequestUtils.js';

// Compatibility strategy for existing CREATE Question contracts. Type-specific
// migration can proceed one adapter at a time without changing LLM orchestration.
export class LegacyQuestionAIStrategy {
  id = 'legacy-create-question';

  getFormatInstructions(questionType, selectionMode = 'single') {
    const formats = {
      'multiple-choice': selectionMode === 'multiple' ? `{
  "questionText": "Your question here (make it clear learners should select all that apply when more than one answer is correct)",
  "options": [
    {"text": "Correct answer 1 (substantive and detailed)", "isCorrect": true, "tip": "Short hint before checking", "chosenFeedback": "Why selecting this option is appropriate", "notChosenFeedback": "Why this correct option matters if missed"},
    {"text": "Correct answer 2 (also genuinely correct and non-overlapping)", "isCorrect": true, "tip": "Short hint before checking", "chosenFeedback": "Why selecting this option is appropriate", "notChosenFeedback": "Why this correct option matters if missed"},
    {"text": "Plausible distractor 1 (misconception type 1)", "isCorrect": false, "tip": "Short hint before checking", "chosenFeedback": "Why this selected option is not correct", "notChosenFeedback": "Why skipping this distractor was a good choice"},
    {"text": "Plausible distractor 2 (reasoning error type 2)", "isCorrect": false, "tip": "Short hint before checking", "chosenFeedback": "Why this selected option is not correct", "notChosenFeedback": "Why skipping this distractor was a good choice"}
  ],
  "correctAnswer": ["Correct answer 1 (substantive and detailed)", "Correct answer 2 (also genuinely correct and non-overlapping)"],
  "explanation": "Detailed explanation of why each correct option is right and why each distractor is wrong, referencing course materials"
}

IMPORTANT REQUIREMENTS FOR MULTIPLE-ANSWER QUESTIONS:
1. The stem must clearly signal that more than one answer can be selected.
2. You MUST mark at least 2 options as correct.
3. Each correct option should contribute a distinct valid idea, not a paraphrase of another correct option.
4. Each distractor must represent a DIFFERENT plausible error pattern.
5. The explanation must briefly clarify each correct choice and each distractor.
6. Every option MUST include tip, chosenFeedback, and notChosenFeedback fields.
7. Keep tip concise and actionable. Keep feedback specific to that option.` : `{
  "questionText": "Your question here (should be clear, specific, narrow in scope when appropriate, and test understanding)",
  "options": [
    {"text": "Correct answer (substantive and detailed)", "isCorrect": true, "tip": "Short hint before checking", "chosenFeedback": "Why selecting this option is appropriate", "notChosenFeedback": "Why this correct option matters if missed"},
    {"text": "Plausible distractor 1 (misconception type 1)", "isCorrect": false, "tip": "Short hint before checking", "chosenFeedback": "Why this selected option is not correct", "notChosenFeedback": "Why skipping this distractor was a good choice"},
    {"text": "Plausible distractor 2 (partial-truth error type 2)", "isCorrect": false, "tip": "Short hint before checking", "chosenFeedback": "Why this selected option is not correct", "notChosenFeedback": "Why skipping this distractor was a good choice"},
    {"text": "Plausible distractor 3 (reasoning error type 3)", "isCorrect": false, "tip": "Short hint before checking", "chosenFeedback": "Why this selected option is not correct", "notChosenFeedback": "Why skipping this distractor was a good choice"}
  ],
  "correctAnswer": "Correct answer text (exact match)",
  "explanation": "Detailed explanation of why the correct answer is right and why distractors are wrong, referencing course materials"
}

IMPORTANT REQUIREMENTS FOR MULTIPLE-CHOICE QUESTIONS:
1. If the learning objective is broad, target one specific assessable slice instead of trying to assess everything at once.
2. Follow the current instructor request first. When it specifies a scenario or topic, keep that scenario or topic and vary the reasoning or assessable slice within it. Otherwise avoid repeating previous concept focuses or scenarios.
3. Each distractor must represent a DIFFERENT plausible error pattern.
4. Avoid distractors that are synonyms of each other or obviously wrong on sight.
5. The explanation must briefly clarify why each distractor is wrong, not only why the correct answer is right.
6. You MUST mark exactly 1 option as correct.
7. Every option MUST include tip, chosenFeedback, and notChosenFeedback fields.
8. Keep tip concise and actionable. Keep feedback specific to that option.`,

      'true-false': `{
  "questionText": "Your true/false statement here (should be clear and test nuanced understanding)",
  "options": [
    {"text": "True", "isCorrect": true},
    {"text": "False", "isCorrect": false}
  ],
  "correctAnswer": "True",
  "explanation": "Detailed explanation of why the statement is true/false, with specific references to course concepts"
}

IMPORTANT REQUIREMENTS FOR TRUE/FALSE QUESTIONS:
1. Prefer a narrow claim that tests one meaningful idea.
2. Avoid statements that are so broad they collapse multiple concepts into one judgment.
3. Do not restate the same conceptual claim used in previous questions.`,

      'flashcard': `{
  "questionText": "Review this concept",
  "content": {
    "front": "Clear question or prompt about the concept",
    "back": "Comprehensive answer with key details and context"
  },
  "correctAnswer": "The back content",
  "explanation": "Additional context about why this concept is important and how it connects to the learning objective"
}`,

      'guess-the-answer': `{
  "questionText": "A concise prompt that asks the learner to predict or recall the answer before revealing it",
  "content": {
    "solutionLabel": "Click to reveal the answer",
    "solutionText": "A clear, grounded answer to the prompt"
  },
  "correctAnswer": "The same clear answer shown in solutionText",
  "explanation": "Brief teaching context that explains why this answer matters"
}

IMPORTANT: This is a self-check activity, not a scored multiple-choice question. The prompt must be answerable from the supplied evidence. Keep solutionText concise and do not include answer choices.`,

      'summary': `{
  "questionText": "Study Guide: Essential Knowledge Points",
  "explanation": "This study guide covers the key concepts and knowledge points that students should understand to master this learning objective",
  "content": {
    "title": "Essential Knowledge Points",
    "additionalNotes": "Interactive study guide with expandable sections covering the fundamental concepts students need to master",
    "keyPoints": [
      {
        "title": "Specific knowledge point 1 that students must understand (e.g., 'Core Principles and Definitions')",
        "explanation": "Detailed explanation of this essential concept, including definitions, key principles, and fundamental understanding students need to develop"
      },
      {
        "title": "Specific knowledge point 2 that students must understand (e.g., 'Implementation Methods and Techniques')",
        "explanation": "Comprehensive explanation covering how this concept works in practice, including methods, techniques, and step-by-step processes"
      },
      {
        "title": "Specific knowledge point 3 that students must understand (e.g., 'Common Challenges and Solutions')",
        "explanation": "Detailed coverage of typical problems, challenges, error scenarios, and proven solutions that students should be aware of"
      },
      {
        "title": "Specific knowledge point 4 that students must understand (e.g., 'Real-world Applications and Examples')",
        "explanation": "Concrete examples, case studies, and practical applications that demonstrate how this concept is used in real scenarios"
      },
      {
        "title": "Specific knowledge point 5 that students must understand (e.g., 'Evaluation and Assessment Criteria')",
        "explanation": "How to evaluate, measure, or assess this concept, including criteria for determining success, quality metrics, and evaluation methods"
      }
    ]
  }
}

IMPORTANT: Generate 4-6 specific, educational sub-titles that represent actual knowledge points students need to learn about this topic. Each title should be a concrete learning point, not a generic category. The titles should clearly state what students will learn (e.g., "Understanding Callback Function Syntax and Structure", "Comparing Promise.then() vs Async/Await Patterns", "Handling Error Cases in Asynchronous Code"). Each explanation should be comprehensive enough to serve as a mini-lesson on that specific topic.`,

      'discussion': `{
  "questionText": "Thought-provoking discussion question that encourages critical thinking and analysis",
  "explanation": "Discussion points to consider, different perspectives, and evaluation criteria"
}`,

      'matching': `{
  "questionText": "Match the concepts to their correct definitions or characteristics",
  "leftItems": ["Concept A", "Concept B", "Concept C", "Concept D"],
  "rightItems": ["Definition W", "Definition X", "Definition Y", "Definition Z"],
  "matchingPairs": [["Concept A", "Definition X"], ["Concept B", "Definition Y"], ["Concept C", "Definition Z"], ["Concept D", "Definition W"]],
  "correctAnswer": "Concept A - Definition X, Concept B - Definition Y, Concept C - Definition Z, Concept D - Definition W",
  "explanation": "Detailed explanation of why each concept matches its definition"
}`,

      'ordering': `{
  "questionText": "Arrange the following items in the correct order (e.g., chronological, complexity, process steps)",
  "items": ["Item 1", "Item 2", "Item 3", "Item 4"],
  "correctOrder": ["Item 3", "Item 1", "Item 4", "Item 2"],
  "correctAnswer": "Item 3, Item 1, Item 4, Item 2",
  "explanation": "Detailed explanation of why this is the correct order"
}`,

      'cloze': `{
  "questionText": "Fill in the blanks: In programming, $$ is used for handling asynchronous operations while $$ provides more predictable error handling and better readability.",
  "textWithBlanks": "In programming, $$ is used for handling asynchronous operations while $$ provides more predictable error handling and better readability.",
  "blankOptions": [["callbacks", "promises", "async/await"], ["promises", "callbacks", "events"]],
  "correctAnswers": ["callbacks", "promises"],
  "correctAnswer": "callbacks, promises",
  "explanation": "Callbacks are used for handling asynchronous operations, while promises provide more predictable error handling and better readability compared to callback-based code."
}

IMPORTANT REQUIREMENTS FOR CLOZE QUESTIONS:
1. Use $$ to mark blanks in the textWithBlanks field. Each $$ represents one fill-in field.
2. Do not use _____ or [blank] - only use $$.
3. You MUST provide blankOptions array with multiple choice options for each blank.
4. You MUST provide correctAnswers array with the correct answer for each blank.
5. CRITICAL: The number of blankOptions arrays must EXACTLY match the number of $$ markers in textWithBlanks.
6. CRITICAL: The number of correctAnswers must EXACTLY match the number of $$ markers in textWithBlanks.
7. Each blankOptions array should contain 2-4 realistic options including the correct answer.
8. Count the $$ markers carefully - if you have 2 $$ markers, you need exactly 2 blankOptions arrays and 2 correctAnswers.

EXAMPLE: If textWithBlanks has "In programming, $$ is used for $$ operations", then you need:
- blankOptions: [["callbacks", "promises"], ["asynchronous", "synchronous"]]
- correctAnswers: ["callbacks", "asynchronous"]`,

      'mark-the-words': `{
  "questionText": "Click on the correct words that match the definition/concept",
  "text": "The process of *photosynthesis* converts *sunlight* into chemical energy in *chloroplasts* using *carbon dioxide* and water.",
  "correctAnswer": "photosynthesis, sunlight, chloroplasts, carbon dioxide",
  "explanation": "These are the key terms related to the process of photosynthesis"
}

IMPORTANT: Wrap EACH correct word with its own asterisk pair (*word*) in the text field. For a multi-word answer, write *normal* *force*, never *normal force*. Only individually marked words are selectable. Include surrounding context words without asterisks.`,

      'single-choice-set': `{
  "questionText": "Quick quiz: Answer these rapid-fire questions",
  "questions": [
    {
      "question": "What is the primary function of the mitochondria?",
      "answers": ["Energy production", "Protein synthesis", "Cell division", "Waste removal"]
    },
    {
      "question": "Which organelle contains DNA?",
      "answers": ["Nucleus", "Ribosome", "Golgi apparatus", "Lysosome"]
    }
  ],
  "correctAnswer": "Energy production; Nucleus",
  "explanation": "The mitochondria produce ATP (energy), and the nucleus contains the cell's DNA."
}

IMPORTANT: Generate 2-4 sub-questions. The FIRST answer in each answers array is ALWAYS the correct one. Answers must be plain strings (NOT objects). Include 3-4 answer options per question. Make the sub-questions cover different slices of the learning objective instead of repeating the same fact pattern.`,

      'essay': `{
  "questionText": "Write an essay about the topic below",
  "taskDescription": "Explain the role of feedback loops in maintaining homeostasis. Include specific examples of negative and positive feedback mechanisms.",
  "keywords": [
    {"keyword": "homeostasis", "alternatives": ["equilibrium", "balance"], "points": 2},
    {"keyword": "negative feedback", "alternatives": ["negative loop"], "points": 2},
    {"keyword": "positive feedback", "alternatives": ["positive loop"], "points": 1},
    {"keyword": "temperature regulation", "alternatives": ["thermoregulation"], "points": 1}
  ],
  "sampleAnswer": "Homeostasis is the process by which biological systems maintain stability. Negative feedback loops, such as temperature regulation, counteract changes to return to a set point. Positive feedback loops, such as blood clotting, amplify changes to reach a specific outcome.",
  "correctAnswer": "See sample answer",
  "explanation": "A good essay should cover both types of feedback with specific biological examples"
}

IMPORTANT: Include 3-6 keywords with optional alternatives. Each keyword has a point value. The sampleAnswer should be a model response.`,

      'free-text': `{
  "questionText": "Answer the following open-ended question",
  "question": "In your own words, describe how neural networks learn from data.",
  "placeholder": "Type your answer here...",
  "correctAnswer": "Open-ended question - no single correct answer",
  "explanation": "A good answer should mention training data, weights adjustment, loss functions, and backpropagation"
}`,

      'open-ended': `{
  "questionText": "Reflect on the following topic",
  "question": "How might artificial intelligence impact the field of healthcare in the next decade?",
  "placeholderText": "Share your thoughts...",
  "correctAnswer": "Open-ended question - no single correct answer",
  "explanation": "Consider diagnostics, treatment planning, drug discovery, patient monitoring, and ethical implications"
}`,

      'simple-multi-choice': `{
  "questionText": "Select the correct answer(s)",
  "question": "Which of the following are renewable energy sources?",
  "alternatives": [
    {"text": "Solar power", "correct": true},
    {"text": "Coal", "correct": false},
    {"text": "Wind power", "correct": true},
    {"text": "Natural gas", "correct": false}
  ],
  "correctAnswer": "Solar power, Wind power",
  "explanation": "Solar and wind power are renewable because they come from naturally replenishing sources"
}

IMPORTANT: Mark correct alternatives with "correct": true. At least one alternative must be correct.`,

      'sort-paragraphs': `{
  "questionText": "Arrange the following paragraphs in the correct logical order",
  "taskDescription": "Put these steps of the scientific method in the correct order",
  "paragraphs": [
    "Make an observation about a phenomenon in the natural world",
    "Formulate a hypothesis that could explain the observation",
    "Design and conduct an experiment to test the hypothesis",
    "Analyze the data collected from the experiment",
    "Draw conclusions and communicate the results"
  ],
  "correctAnswer": "Observation, Hypothesis, Experiment, Analysis, Conclusion",
  "explanation": "The scientific method follows a logical sequence from observation through conclusion"
}

IMPORTANT: The paragraphs array must be in the CORRECT order. The system will shuffle them for display. Generate 3-6 paragraphs.`,

      'crossword': `{
  "questionText": "Complete the crossword puzzle using the clues provided",
  "taskDescription": "Key terms from this chapter",
  "words": [
    {"answer": "Photosynthesis", "clue": "The process by which plants convert light energy into chemical energy"},
    {"answer": "Chlorophyll", "clue": "The green pigment found in plant cells that captures light"},
    {"answer": "Glucose", "clue": "The simple sugar produced as a result of carbon fixation"},
    {"answer": "Oxygen", "clue": "The gas released as a byproduct of water splitting"},
    {"answer": "Carbon", "clue": "The element fixed from CO2 during the Calvin cycle"}
  ],
  "correctAnswer": "Photosynthesis, Chlorophyll, Glucose, Oxygen, Carbon",
  "explanation": "These are essential terms for understanding how plants produce energy"
}

IMPORTANT: Generate 4-8 words. Each word must be a single word (no spaces). Use standard capitalization (e.g., "Observer" not "OBSERVER"). Clues should be clear and educational.`,

      'dictation': `{
  "questionText": "Type each sentence correctly from memory",
  "taskDescription": "Practice these key definitions by typing them accurately",
  "sentences": [
    {"text": "Photosynthesis is the process by which green plants convert sunlight into chemical energy."},
    {"text": "The mitochondria are often called the powerhouse of the cell."},
    {"text": "DNA replication occurs during the S phase of the cell cycle."}
  ],
  "correctAnswer": "Type each sentence accurately",
  "explanation": "Typing key definitions helps reinforce understanding and memorization of important concepts"
}

IMPORTANT: Generate 2-5 sentences. Each sentence should be educational and contain key concepts. Keep sentences concise (under 120 characters each).`,

      'arithmetic-quiz': `{
  "questionText": "Practice your arithmetic skills",
  "quizType": "addition",
  "maxNumber": 20,
  "numQuestions": 10,
  "correctAnswer": "Complete all arithmetic problems correctly",
  "explanation": "Practice with arithmetic operations to build fluency and speed"
}

IMPORTANT: quizType must be one of: "addition", "subtraction", "multiplication", "division". maxNumber sets the upper bound for generated numbers (5-100). numQuestions is how many problems to generate (5-20).`,

      'branching-scenario': `{
  "questionText": "Interactive branching scenario",
  "content": {},
  "correctAnswer": "Complete all branches of the scenario",
  "explanation": "This branching scenario lets students explore different decision paths and their consequences"
}

NOTE: Branching scenarios are complex container types. Generate a simple placeholder. The instructor will customize the branching content manually.`
    };

    return formats[questionType] || formats['multiple-choice'];
  }

  /**
   * Simple JSON cleaning that handles the most common issues
   */
  simpleJsonClean(jsonString) {
    // Track escapes: an escaped backslash can precede a closing quotation mark.
    let inString = false;
    let escaped = false;
    let result = '';
    for (let i = 0; i < jsonString.length; i++) {
      const char = jsonString[i];
      if (inString) {
        if (escaped) {
          result += char;
          escaped = false;
        } else if (char === '\\') {
          result += char;
          escaped = true;
        } else if (char === '"') {
          result += char;
          inString = false;
        } else {
          result += char === '\n' ? '\\n' : char === '\r' ? '\\r' : char === '\t' ? '\\t' : char;
        }
      } else if (char === '"') {
        result += char;
        inString = true;
      } else if (char === ',' && /^\s*[}\]]/.test(jsonString.slice(i + 1))) {
        // Remove only structural trailing commas; preserve punctuation in text.
        continue;
      } else {
        result += char;
      }
    }

    return result;
  }

  extractCorrectAnswerCandidates(correctAnswer, allowCommaSeparatedList = false) {
    if (Array.isArray(correctAnswer)) {
      return correctAnswer.map(answer => String(answer).trim()).filter(Boolean);
    }

    if (typeof correctAnswer === 'string') {
      if (allowCommaSeparatedList) {
        return correctAnswer
          .split(',')
          .map(answer => answer.trim())
          .filter(Boolean);
      }

      return [correctAnswer.trim()].filter(Boolean);
    }

    return [];
  }

  /**
   * Parse and validate LLM response
   */
  parseAndValidateResponse(responseContent, questionType, selectionMode = 'single', branchingLayers = 2, branchingChoices = 2, sourceChoiceCounts = null) {
    try {
      console.log(`🔍 Parsing LLM response for ${questionType}:`, responseContent.substring(0, 200) + '...');

      // Clean the response - remove any markdown formatting and explanatory text
      let cleanContent = responseContent.trim();

      // Remove markdown code blocks
      if (cleanContent.startsWith('```json')) {
        cleanContent = cleanContent.replace(/```json\n?/, '').replace(/```$/, '');
      }

      // Find JSON object - look for first { and last } more carefully
      const firstBrace = cleanContent.indexOf('{');
      if (firstBrace === -1) {
        throw new Error('No JSON object found in response');
      }

      // Learner text can contain braces and escaped quotes (for example LaTeX).
      // Only structural JSON braces determine the end of the response object.
      const balancedJson = extractBalancedJson(cleanContent);
      let lastBrace = balancedJson ? firstBrace + balancedJson.length - 1 : -1;

      if (lastBrace === -1) {
        console.log('❌ No matching closing brace found');
        console.log('🔍 Raw content length:', cleanContent.length);
        console.log('🔍 Content preview:', cleanContent.substring(0, 1000));
        console.log('🔍 Content ending:', cleanContent.substring(Math.max(0, cleanContent.length - 200)));

        // Try to repair the JSON by adding missing closing braces
        const openBraces = (cleanContent.match(/\{/g) || []).length;
        const closeBraces = (cleanContent.match(/\}/g) || []).length;
        const openBrackets = (cleanContent.match(/\[/g) || []).length;
        const closeBrackets = (cleanContent.match(/\]/g) || []).length;
        const missingBraces = openBraces - closeBraces;
        const missingBrackets = openBrackets - closeBrackets;

        console.log(`🔧 JSON repair analysis: ${openBraces} open braces, ${closeBraces} close braces, ${missingBraces} missing braces`);
        console.log(`🔧 JSON repair analysis: ${openBrackets} open brackets, ${closeBrackets} close brackets, ${missingBrackets} missing brackets`);

        if (missingBraces > 0 || missingBrackets > 0) {
          console.log(`🔧 Attempting to repair JSON: adding ${missingBraces} closing braces and ${missingBrackets} closing brackets`);

          // Add missing brackets first, then braces
          if (missingBrackets > 0) {
            cleanContent = cleanContent + ']'.repeat(missingBrackets);
          }
          if (missingBraces > 0) {
            cleanContent = cleanContent + '}'.repeat(missingBraces);
          }

          // Reset brace count and try to find the last brace again
          braceCount = 0;
          for (let i = firstBrace; i < cleanContent.length; i++) {
            if (cleanContent[i] === '{') {
              braceCount++;
            } else if (cleanContent[i] === '}') {
              braceCount--;
              if (braceCount === 0) {
                lastBrace = i;
                break;
              }
            }
          }

          console.log(`🔧 After repair, found last brace at position: ${lastBrace}`);
        }

        if (lastBrace === -1) {
          console.log('❌ JSON repair failed - still no matching closing brace');
          console.log('💀 Repaired content preview:', cleanContent.substring(0, 500));
          throw new Error('No matching closing brace found in JSON after repair attempt');
        }
      }

      cleanContent = cleanContent.substring(firstBrace, lastBrace + 1);

      // Simple but effective JSON cleaning
      cleanContent = this.simpleJsonClean(cleanContent);

      console.log(`🧹 Cleaned content:`, cleanContent.substring(0, 200) + '...');

      const parsed = JSON.parse(cleanContent);
      console.log(`✅ Successfully parsed JSON:`, {
        hasQuestionText: !!parsed.questionText,
        hasOptions: !!parsed.options,
        hasCorrectAnswer: !!parsed.correctAnswer,
        hasExplanation: !!parsed.explanation,
        hasContent: !!parsed.content,
        hasKeyPoints: !!(parsed.content && parsed.content.keyPoints)
      });

      // Special logging for Summary questions
      if (questionType === 'summary' && parsed.content) {
        console.log('🎯 SUMMARY QUESTION PARSING SUCCESS:');
        console.log('📝 Content structure:', JSON.stringify(parsed.content, null, 2));
        if (parsed.content.keyPoints && Array.isArray(parsed.content.keyPoints)) {
          console.log(`🔑 KeyPoints count: ${parsed.content.keyPoints.length}`);
          parsed.content.keyPoints.forEach((kp, idx) => {
            console.log(`   ${idx + 1}. ${kp.title ? kp.title.substring(0, 50) : 'No title'}...`);
          });
        } else {
          console.log('❌ keyPoints missing or not an array in content');
        }
      }

      // Validate required fields - correctAnswer is optional for discussion and summary questions
      // Branching scenario has its own structure — skip standard field validation
      if (questionType === 'branching-scenario') {
        const validated = validateBranchingDraft(parsed, branchingLayers, branchingChoices, sourceChoiceCounts);

        return {
          questionText: 'Branching Scenario',
          content: validated,
          correctAnswer: null,
          explanation: null
        };
      }

      if (questionType === 'documentation-tool') {
        if (!parsed.title || !Array.isArray(parsed.pages)) {
          throw new Error('Documentation tool response missing title or pages array');
        }
        return {
          questionText: 'Documentation Tool',
          content: {
            title: parsed.title,
            pages: parsed.pages
          },
          correctAnswer: null,
          explanation: null
        };
      }

      const requiresCorrectAnswer = !['discussion', 'summary'].includes(questionType);

      // Special handling for Cloze questions - accept answerKey as explanation
      if (questionType === 'cloze' && parsed.answerKey && !parsed.explanation) {
        parsed.explanation = parsed.answerKey;
        delete parsed.answerKey;
      }

      // Post-process Cloze questions to ensure $$ markers are used and content structure is correct
      if (questionType === 'cloze') {
        // Convert any remaining _____ markers to $$
        if (parsed.textWithBlanks) {
          parsed.textWithBlanks = parsed.textWithBlanks.replace(/_{3,}/g, '$$');
        }
        // Also update questionText if it contains the same pattern
        if (parsed.questionText) {
          parsed.questionText = parsed.questionText.replace(/_{3,}/g, '$$');
        }

        // Move Cloze-specific fields into content object if they're at root level
        if (parsed.textWithBlanks || parsed.blankOptions || parsed.correctAnswers) {
          parsed.content = {
            textWithBlanks: parsed.textWithBlanks,
            blankOptions: parsed.blankOptions,
            correctAnswers: parsed.correctAnswers,
            ...parsed.content // Preserve any existing content
          };

          // Remove from root level
          delete parsed.textWithBlanks;
          delete parsed.blankOptions;
          delete parsed.correctAnswers;
        }
      }

      if (!parsed.questionText || !parsed.explanation) {
        throw new Error('Missing required fields: questionText and explanation are required');
      }

      if (requiresCorrectAnswer && !parsed.correctAnswer) {
        throw new Error('Missing required field: correctAnswer is required for this question type');
      }

      // Type-specific validation
      if (questionType === QUESTION_TYPES.MULTIPLE_CHOICE || questionType === QUESTION_TYPES.TRUE_FALSE) {
        // Move options into content object if they're at root level
        if (parsed.options) {
          parsed.content = {
            options: parsed.options,
            ...parsed.content // Preserve any existing content
          };
          delete parsed.options; // Remove from root level
        }

        if (!parsed.content?.options || !Array.isArray(parsed.content.options)) {
          throw new Error('Missing or invalid options array');
        }

        // Normalize options - set missing isCorrect to false
        parsed.content.options.forEach(option => {
          if (option.isCorrect === undefined || option.isCorrect === null) {
            option.isCorrect = false;
          }

          option.tip = typeof option.tip === 'string' ? option.tip.trim() : '';
          option.chosenFeedback = typeof option.chosenFeedback === 'string' ? option.chosenFeedback.trim() : '';
          option.notChosenFeedback = typeof option.notChosenFeedback === 'string' ? option.notChosenFeedback.trim() : '';
        });

        const resolvedSelectionMode = questionType === QUESTION_TYPES.TRUE_FALSE
          ? 'single'
          : (selectionMode === 'multiple' ? 'multiple' : 'single');

        parsed.content.selectionMode = resolvedSelectionMode;

        const correctOptions = parsed.content.options.filter(opt => opt.isCorrect === true);

        // If no options are marked correct, try to find them from correctAnswer
        if (correctOptions.length === 0 && parsed.correctAnswer) {
          const correctAnswerCandidates = this.extractCorrectAnswerCandidates(
            parsed.correctAnswer,
            resolvedSelectionMode === 'multiple'
          )
            .map(answer => answer.toLowerCase());

          parsed.content.options.forEach(option => {
            const normalizedOptionText = option.text.toLowerCase().trim();
            const matches = correctAnswerCandidates.some(candidate =>
              normalizedOptionText.includes(candidate) || candidate.includes(normalizedOptionText)
            );

            if (matches) {
              option.isCorrect = true;
              console.log(`🔧 Auto-corrected missing isCorrect flag for option: "${option.text}"`);
            }
          });
        }

        // Final validation
        const finalCorrectOptions = parsed.content.options.filter(opt => opt.isCorrect === true);
        if (resolvedSelectionMode === 'multiple') {
          if (finalCorrectOptions.length < 2) {
            throw new Error(`Multiple-answer question must have at least 2 correct options, found ${finalCorrectOptions.length}`);
          }
          parsed.correctAnswer = finalCorrectOptions.map(option => option.text);
        } else {
          if (finalCorrectOptions.length !== 1) {
            throw new Error(`Exactly one option must be marked as correct, found ${finalCorrectOptions.length}`);
          }
          parsed.correctAnswer = finalCorrectOptions[0].text;
        }

        console.log(`✅ Multiple-choice/True-false question validated: ${parsed.content.options.length} options`);
      }

      if (questionType === QUESTION_TYPES.FLASHCARD) {
        if (!parsed.content || !parsed.content.front || !parsed.content.back) {
          throw new Error('Flashcard missing front/back content');
        }
      }

      if (questionType === QUESTION_TYPES.GUESS_THE_ANSWER) {
        if (!parsed.content?.solutionText) {
          throw new Error('Guess the Answer content is missing solutionText');
        }
        parsed.content.solutionLabel = parsed.content.solutionLabel?.trim()
          || 'Click to reveal the answer';
        parsed.correctAnswer = parsed.content.solutionText;
      }

      if (questionType === 'cloze') {
        // Validate Cloze question structure
        const textWithBlanks = parsed.content?.textWithBlanks || parsed.textWithBlanks;
        const blankOptions = parsed.content?.blankOptions || parsed.blankOptions;
        const correctAnswers = parsed.content?.correctAnswers || parsed.correctAnswers;

        if (!textWithBlanks) {
          throw new Error('Cloze question missing textWithBlanks field');
        }

        if (!blankOptions || !Array.isArray(blankOptions)) {
          throw new Error('Cloze question missing blankOptions array');
        }

        if (!correctAnswers || !Array.isArray(correctAnswers)) {
          throw new Error('Cloze question missing correctAnswers array');
        }

        // Count $$ markers in textWithBlanks
        const blankCount = (textWithBlanks.match(/\$\$/g) || []).length;

        if (blankCount === 0) {
          throw new Error('Cloze question textWithBlanks must contain at least one $$ marker');
        }

        if (blankOptions.length !== blankCount) {
          throw new Error(`Cloze question has ${blankCount} blanks but ${blankOptions.length} blankOptions arrays`);
        }

        if (correctAnswers.length !== blankCount) {
          throw new Error(`Cloze question has ${blankCount} blanks but ${correctAnswers.length} correctAnswers`);
        }

        // Validate each blankOptions array
        blankOptions.forEach((options, index) => {
          if (!Array.isArray(options) || options.length < 2) {
            throw new Error(`Blank ${index + 1} must have at least 2 options`);
          }

          const correctAnswer = correctAnswers[index];
          if (!options.includes(correctAnswer)) {
            throw new Error(`Blank ${index + 1} correct answer "${correctAnswer}" not found in options: ${options.join(', ')}`);
          }
        });
      }

      if (questionType === 'matching') {
        // Move matching-specific fields into content object if they're at root level
        if (parsed.leftItems || parsed.rightItems || parsed.matchingPairs) {
          parsed.content = {
            leftItems: parsed.leftItems,
            rightItems: parsed.rightItems,
            matchingPairs: parsed.matchingPairs,
            ...parsed.content // Preserve any existing content
          };

          // Remove from root level
          delete parsed.leftItems;
          delete parsed.rightItems;
          delete parsed.matchingPairs;
        }

        // Validate matching question structure
        if (!parsed.content?.leftItems || !Array.isArray(parsed.content.leftItems)) {
          throw new Error('Matching question missing leftItems array');
        }

        if (!parsed.content?.rightItems || !Array.isArray(parsed.content.rightItems)) {
          throw new Error('Matching question missing rightItems array');
        }

        if (!parsed.content?.matchingPairs || !Array.isArray(parsed.content.matchingPairs)) {
          throw new Error('Matching question missing matchingPairs array');
        }

        if (parsed.content.leftItems.length !== parsed.content.rightItems.length) {
          throw new Error(`Matching question has ${parsed.content.leftItems.length} left items but ${parsed.content.rightItems.length} right items - must be equal`);
        }

        if (parsed.content.matchingPairs.length !== parsed.content.leftItems.length) {
          throw new Error(`Matching question has ${parsed.content.leftItems.length} items but ${parsed.content.matchingPairs.length} matching pairs`);
        }

        console.log(`✅ Matching question validated: ${parsed.content.leftItems.length} pairs`);
      }

      if (questionType === 'ordering') {
        // Move ordering-specific fields into content object if they're at root level
        if (parsed.items || parsed.correctOrder) {
          parsed.content = {
            items: parsed.items,
            correctOrder: parsed.correctOrder,
            ...parsed.content // Preserve any existing content
          };

          // Remove from root level
          delete parsed.items;
          delete parsed.correctOrder;
        }

        // Validate ordering question structure
        if (!parsed.content?.items || !Array.isArray(parsed.content.items)) {
          throw new Error('Ordering question missing items array');
        }

        if (!parsed.content?.correctOrder || !Array.isArray(parsed.content.correctOrder)) {
          throw new Error('Ordering question missing correctOrder array');
        }

        if (parsed.content.items.length !== parsed.content.correctOrder.length) {
          throw new Error(`Ordering question has ${parsed.content.items.length} items but ${parsed.content.correctOrder.length} in correctOrder - must be equal`);
        }

        // Validate that correctOrder contains all items from items array
        const itemsSet = new Set(parsed.content.items.map(item => item.trim().toLowerCase()));
        const orderSet = new Set(parsed.content.correctOrder.map(item => item.trim().toLowerCase()));

        if (itemsSet.size !== orderSet.size) {
          throw new Error('Ordering question correctOrder must contain exactly the same items as items array');
        }

        for (const item of parsed.content.correctOrder) {
          if (!itemsSet.has(item.trim().toLowerCase())) {
            throw new Error(`Ordering question correctOrder contains item "${item}" not found in items array`);
          }
        }

        console.log(`✅ Ordering question validated: ${parsed.content.items.length} items`);
      }

      console.log('✅ LLM response validated successfully');
      return normalizeGeneratedQuestionText(parsed);

    } catch (error) {
      console.error('❌ Question response failed format validation.');
      throw Object.assign(new Error('The model returned an unreadable or invalid question. No question was saved. Retry explicitly to generate a new draft.'), {
        code: 'QUESTION_INVALID_RESPONSE', cause: error
      });
    }
  }

  async buildPrompt({ questionType, branchingLayers = 2, branchingChoices = 2,
    learningObjective, customPrompt, relevantContent, courseContext, instructorPrompt, previousQuestions }) {
    if (questionType === 'branching-scenario') {
      return buildBranchingPrompt(branchingLayers, branchingChoices, learningObjective || customPrompt || '', {
        relevantContent, courseContext, customPrompt, instructorPrompt, previousQuestions
      });
    }
    if (questionType === 'documentation-tool') {
      const { buildDocumentationPrompt } = await import('../utils/documentationToolBuilder.js');
      return buildDocumentationPrompt(customPrompt, learningObjective);
    }
    return null;
  }
}

export const legacyQuestionAIStrategy = new LegacyQuestionAIStrategy();
