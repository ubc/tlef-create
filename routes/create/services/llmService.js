/**
 * LLM Service for Quiz Question Generation
 * Uses UBC GenAI Toolkit LLM module for real AI-powered question generation
 */

import { LLMModule } from 'ubc-genai-toolkit-llm';
import { ConsoleLogger } from 'ubc-genai-toolkit-core';
import { generateTemplateQuestion } from './templateQuestionGenerator.js';
import { QUESTION_TYPES } from '../config/constants.js';

class QuizLLMService {
  constructor() {
    // Create a custom logger that matches the interface
    this.logger = {
      debug: (message, metadata) => console.log(`[DEBUG] ${message}`, metadata || ''),
      info: (message, metadata) => console.log(`[INFO] ${message}`, metadata || ''),
      warn: (message, metadata) => console.warn(`[WARN] ${message}`, metadata || ''),
      error: (message, metadata) => console.error(`[ERROR] ${message}`, metadata || '')
    };
    
    try {
      // Initialize LLM module with configurable provider
      const provider = process.env.LLM_PROVIDER || 'ollama';
      
      if (provider === 'openai') {
        // Initialize with OpenAI
        this.llm = new LLMModule({
          provider: 'openai',
          apiKey: process.env.OPENAI_API_KEY,
          defaultModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          logger: this.logger,
          defaultOptions: {
            temperature: 0.7,
            max_completion_tokens: 2000 // Use correct OpenAI parameter
          }
        });
        console.log('✅ QuizLLMService initialized with OpenAI');
      } else {
        // Initialize with Ollama (local LLM)
        this.llm = new LLMModule({
          provider: 'ollama',
          endpoint: process.env.OLLAMA_ENDPOINT || 'http://localhost:11434',
          defaultModel: process.env.OLLAMA_MODEL || 'llama3.1:8b',
          logger: this.logger,
          defaultOptions: {
            temperature: 0.7,
            maxTokens: 2000
          }
        });
        console.log('✅ QuizLLMService initialized with Ollama (local LLM)');
      }
    } catch (error) {
      console.error('❌ Failed to initialize QuizLLMService:', error.message);
      console.error('💡 LLM features will be disabled. Ensure Ollama is running with llama3.1:8b model.');
      this.llm = null;
    }
  }

  /**
   * Get the correct options object for sendMessage based on provider and model
   * @param {Object} userPreferences - User preferences
   * @param {number} temperature - Temperature setting
   * @param {number} maxTokens - Max tokens setting
   * @returns {Object} Options object with correct parameter names
   */
  getSendMessageOptions(userPreferences, temperature, maxTokens) {
    const provider = userPreferences?.llmProvider || 'ollama';
    const model = userPreferences?.llmModel;
    
    if (provider === 'openai') {
      const options = {
        max_completion_tokens: maxTokens // OpenAI uses max_completion_tokens
      };
      
      // Some OpenAI models (like gpt-5-nano) don't support custom temperature
      if (model === 'gpt-5-nano') {
        // gpt-5-nano only supports default temperature of 1, so don't set it
        console.log('⚠️ gpt-5-nano model detected - using default temperature (1.0)');
      } else {
        // Other OpenAI models support custom temperature
        options.temperature = temperature;
      }
      
      return options;
    } else {
      return {
        temperature,
        maxTokens // Ollama uses maxTokens
      };
    }
  }

  /**
   * Create a user-specific LLM instance based on their preferences
   * @param {Object} userPreferences - User's AI model preferences
   * @returns {LLMModule} Configured LLM instance
   */
  createUserLLMInstance(userPreferences) {
    try {
      const provider = userPreferences?.llmProvider || 'ollama';
      const settings = userPreferences?.llmSettings || { temperature: 0.7, maxTokens: 2000 };

      if (provider === 'openai' && process.env.OPENAI_API_KEY) {
        const defaultOptions = {
          max_completion_tokens: settings.maxTokens // Use correct OpenAI parameter
        };
        
        const model = userPreferences?.llmModel || 'gpt-4o-mini';
        
        // Some models don't support custom temperature
        if (model !== 'gpt-5-nano') {
          defaultOptions.temperature = settings.temperature;
        }
        
        return new LLMModule({
          provider: 'openai',
          apiKey: process.env.OPENAI_API_KEY,
          defaultModel: model,
          logger: this.logger,
          defaultOptions
        });
      } else if (provider === 'openai' && !process.env.OPENAI_API_KEY) {
        // Fallback to Ollama if OpenAI is requested but no API key is available
        console.log('⚠️ OpenAI requested but no API key found, falling back to Ollama');
        return new LLMModule({
          provider: 'ollama',
          endpoint: process.env.OLLAMA_ENDPOINT || 'http://localhost:11434',
          defaultModel: 'llama3.1:8b', // Use Ollama model as fallback
          logger: this.logger,
          defaultOptions: {
            temperature: settings.temperature,
            maxTokens: settings.maxTokens
          }
        });
      } else {
        return new LLMModule({
          provider: 'ollama',
          endpoint: process.env.OLLAMA_ENDPOINT || 'http://localhost:11434',
          defaultModel: userPreferences?.llmModel || 'llama3.1:8b',
          logger: this.logger,
          defaultOptions: {
            temperature: settings.temperature,
            maxTokens: settings.maxTokens
          }
        });
      }
    } catch (error) {
      console.error('Failed to create user LLM instance:', error);
      return this.llm; // Fallback to default instance
    }
  }

  /**
   * Generate a high-quality question using LLM + RAG content
   * @param {Object} userPreferences - User's AI model preferences
   */
  async generateQuestion(questionConfig, userPreferences = null) {
    const {
      learningObjective,
      questionType,
      relevantContent = [],
      difficulty = 'moderate',
      courseContext = '',
      previousQuestions = []
    } = questionConfig;

    console.log(`🤖 Generating ${questionType} question with LLM...`);
    console.log(`📝 Learning Objective: ${learningObjective.substring(0, 100)}...`);
    console.log(`📚 Using ${relevantContent.length} content chunks`);

    // Use user-specific LLM instance or fallback to default
    const llmInstance = userPreferences ? this.createUserLLMInstance(userPreferences) : this.llm;
    
    if (!llmInstance) {
      throw new Error('LLM service not initialized. Please check Ollama/OpenAI configuration.');
    }

    if (userPreferences?.llmProvider === 'openai') {
      console.log(`🤖 Using OpenAI model: ${userPreferences.llmModel || 'gpt-4o-mini'}`);
    } else {
      console.log(`🤖 Using Ollama model: ${userPreferences?.llmModel || 'llama3.1:8b'}`);
    }

    try {
      // Build expert-level prompt
      const prompt = this.buildExpertPrompt(
        learningObjective, 
        questionType, 
        relevantContent, 
        difficulty,
        courseContext,
        previousQuestions
      );

      console.log(`📋 Generated prompt (${prompt.length} chars)`);

      // Call LLM with user-specific settings
      const startTime = Date.now();
      const temperature = userPreferences?.llmSettings?.temperature || this.getTemperatureForQuestionType(questionType);
      const maxTokens = userPreferences?.llmSettings?.maxTokens || 2000;
      
      const options = this.getSendMessageOptions(userPreferences, temperature, maxTokens);
      const response = await llmInstance.sendMessage(prompt, options);

      const processingTime = Date.now() - startTime;
      console.log(`⏱️ LLM response received in ${processingTime}ms`);
      console.log(`🔍 Raw LLM response:`, response.content.substring(0, 500) + '...');

      // Parse and validate response
      const questionData = this.parseAndValidateResponse(response.content, questionType);
      
      return {
        success: true,
        questionData: {
          ...questionData,
          type: questionType, // Add the question type explicitly
          difficulty: difficulty || 'moderate',
          generationMetadata: {
            llmModel: response.model || 'llama3.1:8b',
            generationPrompt: prompt,
            learningObjective: learningObjective,
            contentSources: (Array.isArray(relevantContent) ? relevantContent : (relevantContent?.chunks || [])).map(c => c.metadata?.source || c.source || 'unknown'),
            processingTime: processingTime,
            temperature: this.getTemperatureForQuestionType(questionType),
            generationMethod: 'llm-rag-enhanced',
            contentScore: this.calculateContentRelevanceScore(relevantContent),
            confidence: this.estimateQuestionQuality(questionData),
            usage: response.usage
          }
        }
      };

    } catch (error) {
      console.error('❌ LLM question generation failed:', error);
      throw error;
    }
  }

  /**
   * Build expert-level prompt for question generation
   */
  buildExpertPrompt(learningObjective, questionType, relevantContent, difficulty, courseContext, previousQuestions) {
    // Handle different relevantContent formats
    const contentArray = Array.isArray(relevantContent) 
      ? relevantContent 
      : (relevantContent?.chunks || []);
    
    const contentText = contentArray
      .map((chunk, index) => `[Content ${index + 1}] (from ${chunk.metadata?.source || chunk.source || 'unknown'}, relevance: ${chunk.score?.toFixed(2) || 'N/A'})\n${chunk.content}`)
      .join('\n\n');

    const previousQuestionsText = previousQuestions.length > 0 
      ? `\n\nPREVIOUS QUESTIONS TO AVOID DUPLICATION:\n${previousQuestions.map((q, i) => `${i + 1}. ${q.questionText}`).join('\n')}`
      : '';

    const basePrompt = `You are an expert educational assessment designer specializing in creating high-quality, pedagogically sound quiz questions. Your task is to generate a ${questionType} question that effectively assesses student understanding.

LEARNING OBJECTIVE:
${learningObjective}

COURSE CONTEXT:
${courseContext || 'General academic course'}

RELEVANT COURSE MATERIALS:
${contentText || 'No specific course materials provided - use general knowledge related to the learning objective.'}

DIFFICULTY LEVEL: ${difficulty}

QUESTION TYPE: ${questionType}
${previousQuestionsText}

INSTRUCTIONS:
1. Create a question that directly assesses the learning objective
2. Use the provided course materials to create realistic, contextual content
3. Ensure the question tests meaningful understanding, not just memorization
4. Make the question engaging and relevant to real-world applications
5. Follow educational best practices for ${questionType} questions
6. Avoid duplicating previous questions - create unique content and scenarios

RESPONSE FORMAT:
Return ONLY a valid JSON object with this exact structure (all strings must be on single lines - no line breaks within strings):`;

    const formatInstructions = this.getFormatInstructions(questionType);
    
    return basePrompt + '\n' + formatInstructions;
  }

  /**
   * Get format instructions for each question type
   */
  getFormatInstructions(questionType) {
    const formats = {
      'multiple-choice': `{
  "questionText": "Your question here (should be clear, specific, and test understanding)",
  "options": [
    {"text": "Correct answer (substantive and detailed)", "isCorrect": true},
    {"text": "Plausible distractor 1 (common misconception)", "isCorrect": false},
    {"text": "Plausible distractor 2 (partially correct but incomplete)", "isCorrect": false},
    {"text": "Plausible distractor 3 (logical but incorrect)", "isCorrect": false}
  ],
  "correctAnswer": "Correct answer text (exact match)",
  "explanation": "Detailed explanation of why the correct answer is right and why distractors are wrong, referencing course materials"
}`,

      'true-false': `{
  "questionText": "Your true/false statement here (should be clear and test nuanced understanding)",
  "options": [
    {"text": "True", "isCorrect": true},
    {"text": "False", "isCorrect": false}
  ],
  "correctAnswer": "True",
  "explanation": "Detailed explanation of why the statement is true/false, with specific references to course concepts"
}`,

      'flashcard': `{
  "questionText": "Review this concept",
  "content": {
    "front": "Clear question or prompt about the concept",
    "back": "Comprehensive answer with key details and context"
  },
  "correctAnswer": "The back content",
  "explanation": "Additional context about why this concept is important and how it connects to the learning objective"
}`,

      'summary': `{
  "questionText": "Comprehensive summary question that requires synthesis of multiple concepts",
  "correctAnswer": "Model answer that demonstrates complete understanding (3-4 sentences)",
  "explanation": "Key points that should be included in a complete answer, assessment criteria"
}`,

      'discussion': `{
  "questionText": "Thought-provoking discussion question that encourages critical thinking",
  "correctAnswer": "Sample response that demonstrates deep engagement with the topic",
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
  "questionText": "Fill in the blanks: In programming, _____ is used for _____ while _____ provides _____.",
  "textWithBlanks": "In programming, _____ is used for _____ while _____ provides _____.",
  "blankOptions": [["async", "sync", "callback"], ["error handling", "data processing", "user interaction"], ["promises", "callbacks", "events"], ["better readability", "more complexity", "faster execution"]],
  "correctAnswers": ["async", "error handling", "promises", "better readability"],
  "correctAnswer": "async, error handling, promises, better readability",
  "explanation": "Detailed explanation of why these are the correct answers for each blank"
}`
    };

    return formats[questionType] || formats['multiple-choice'];
  }

  /**
   * Simple JSON cleaning that handles the most common issues
   */
  simpleJsonClean(jsonString) {
    // The most common issue is literal newlines in string values
    // We need to carefully replace newlines only within string values
    
    let cleaned = jsonString;
    let inString = false;
    let result = '';
    let i = 0;
    
    while (i < cleaned.length) {
      const char = cleaned[i];
      
      if (char === '"' && (i === 0 || cleaned[i-1] !== '\\')) {
        // Toggle string state
        inString = !inString;
        result += char;
      } else if (inString && char === '\n') {
        // Replace literal newline with escaped newline in strings
        result += '\\n';
      } else if (inString && char === '\r') {
        // Replace literal carriage return with escaped version
        result += '\\r';
      } else if (inString && char === '\t') {
        // Replace literal tab with escaped version
        result += '\\t';
      } else {
        result += char;
      }
      
      i++;
    }
    
    return result;
  }

  /**
   * Parse and validate LLM response
   */
  parseAndValidateResponse(responseContent, questionType) {
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
      
      // Find the matching closing brace by counting braces
      let braceCount = 0;
      let lastBrace = -1;
      
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
      
      if (lastBrace === -1) {
        throw new Error('No matching closing brace found in JSON');
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
        hasExplanation: !!parsed.explanation
      });
      
      // Validate required fields
      if (!parsed.questionText || !parsed.correctAnswer || !parsed.explanation) {
        throw new Error('Missing required fields in LLM response');
      }

      // Type-specific validation
      if (questionType === QUESTION_TYPES.MULTIPLE_CHOICE || questionType === QUESTION_TYPES.TRUE_FALSE) {
        if (!parsed.options || !Array.isArray(parsed.options)) {
          throw new Error('Missing or invalid options array');
        }
        
        // Normalize options - set missing isCorrect to false
        parsed.options.forEach(option => {
          if (option.isCorrect === undefined || option.isCorrect === null) {
            option.isCorrect = false;
          }
        });
        
        // Check if exactly one option is marked correct
        const correctOptions = parsed.options.filter(opt => opt.isCorrect === true);
        
        // If no options are marked correct, try to find the correct one from correctAnswer
        if (correctOptions.length === 0 && parsed.correctAnswer) {
          const correctAnswerText = parsed.correctAnswer.toLowerCase().trim();
          const matchingOption = parsed.options.find(opt => 
            opt.text.toLowerCase().trim().includes(correctAnswerText) ||
            correctAnswerText.includes(opt.text.toLowerCase().trim())
          );
          
          if (matchingOption) {
            matchingOption.isCorrect = true;
            console.log(`🔧 Auto-corrected missing isCorrect flag for option: "${matchingOption.text}"`);
          }
        }
        
        // Final validation
        const finalCorrectOptions = parsed.options.filter(opt => opt.isCorrect === true);
        if (finalCorrectOptions.length !== 1) {
          throw new Error(`Exactly one option must be marked as correct, found ${finalCorrectOptions.length}`);
        }
      }

      if (questionType === QUESTION_TYPES.FLASHCARD) {
        if (!parsed.content || !parsed.content.front || !parsed.content.back) {
          throw new Error('Flashcard missing front/back content');
        }
      }

      console.log('✅ LLM response validated successfully');
      return parsed;

    } catch (error) {
      console.error('❌ Failed to parse LLM response:', error.message);
      console.error('Raw response:', responseContent);
      throw new Error(`Invalid LLM response format: ${error.message}`);
    }
  }

  /**
   * Get appropriate temperature for question type
   */
  getTemperatureForQuestionType(questionType) {
    const temperatures = {
      [QUESTION_TYPES.MULTIPLE_CHOICE]: 0.7,  // Balanced creativity and accuracy
      [QUESTION_TYPES.TRUE_FALSE]: 0.5,       // More factual, less creative
      [QUESTION_TYPES.FLASHCARD]: 0.6,        // Structured but clear
      [QUESTION_TYPES.SUMMARY]: 0.8,          // More creative and comprehensive
      [QUESTION_TYPES.DISCUSSION]: 0.9        // Most creative and open-ended
    };
    
    return temperatures[questionType] || 0.7;
  }

  /**
   * Calculate content relevance score
   */
  calculateContentRelevanceScore(relevantContent) {
    const contentArray = Array.isArray(relevantContent) 
      ? relevantContent 
      : (relevantContent?.chunks || []);
      
    if (!contentArray || contentArray.length === 0) return 0;
    
    const totalScore = contentArray.reduce((sum, chunk) => sum + (chunk.score || 0.5), 0);
    return totalScore / contentArray.length;
  }

  /**
   * Estimate question quality based on generated content
   */
  estimateQuestionQuality(questionData) {
    let score = 0.5; // Base score
    
    // Check question text quality
    if (questionData.questionText && questionData.questionText.length > 20) {
      score += 0.1;
    }
    if (questionData.questionText && questionData.questionText.length > 50) {
      score += 0.1;
    }
    
    // Check explanation quality
    if (questionData.explanation && questionData.explanation.length > 50) {
      score += 0.1;
    }
    if (questionData.explanation && questionData.explanation.length > 100) {
      score += 0.1;
    }
    
    // Check options quality (for MC/TF)
    if (questionData.options && questionData.options.length >= 3) {
      score += 0.1;
      
      const avgOptionLength = questionData.options.reduce((sum, opt) => 
        sum + (opt.text?.length || 0), 0) / questionData.options.length;
      
      if (avgOptionLength > 20) score += 0.1;
    }
    
    return Math.min(score, 1.0);
  }

  /**
   * Generate multiple questions in batch
   */
  async generateQuestionBatch(batchConfig) {
    const {
      learningObjective,
      questionConfigs, // Array of { questionType, count }
      relevantContent,
      difficulty,
      courseContext
    } = batchConfig;

    console.log(`🎯 Generating batch of questions for LO: ${learningObjective.substring(0, 50)}...`);
    
    const questions = [];
    const errors = [];
    
    for (const config of questionConfigs) {
      for (let i = 0; i < config.count; i++) {
        try {
          const result = await this.generateQuestion({
            learningObjective,
            questionType: config.questionType,
            relevantContent,
            difficulty,
            courseContext,
            previousQuestions: questions // Avoid duplication
          });
          
          if (result.success) {
            questions.push({
              ...result.questionData,
              type: config.questionType,
              order: questions.length
            });
          }
          
          // Small delay to avoid overwhelming the LLM
          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (error) {
          console.error(`❌ Failed to generate ${config.questionType} question ${i + 1}:`, error.message);
          errors.push({
            questionType: config.questionType,
            index: i + 1,
            error: error.message
          });
        }
      }
    }
    
    console.log(`✅ Generated ${questions.length} questions, ${errors.length} errors`);
    
    return {
      questions,
      errors,
      totalRequested: questionConfigs.reduce((sum, config) => sum + config.count, 0),
      totalGenerated: questions.length
    };
  }

  /**
   * Generate learning objectives from course materials with user preferences
   * @param {Array} materials - Course materials
   * @param {String} courseContext - Course context string
   * @param {Number} targetCount - Target number of objectives
   * @param {Object} userPreferences - User's AI model preferences
   */
  async generateLearningObjectives(materials, courseContext = '', targetCount = null, userPreferences = null) {
    console.log(`🎯 Generating learning objectives from ${materials.length} materials`);
    
    // Use user-specific LLM instance or fallback to default
    const llmInstance = userPreferences ? this.createUserLLMInstance(userPreferences) : this.llm;
    
    if (!llmInstance) {
      throw new Error('LLM service not initialized. Please check LLM configuration.');
    }

    if (userPreferences?.llmProvider === 'openai') {
      console.log(`🤖 Using OpenAI model: ${userPreferences.llmModel || 'gpt-4o-mini'}`);
    } else {
      console.log(`🤖 Using Ollama model: ${userPreferences?.llmModel || 'llama3.1:8b'}`);
    }

    // Prepare materials content for the prompt
    const materialsContent = materials.map(material => {
      let content = '';
      if (material.content) {
        content = material.content.substring(0, 3000); // Limit content length
      }
      return `**${material.name}** (${material.type})\n${content}`;
    }).join('\n\n---\n\n');

    const countInstruction = targetCount ? `exactly ${targetCount}` : '4-6';
    const prompt = `You are an educational expert helping to create learning objectives for a university course. Based on the provided course materials, generate ${countInstruction} specific, measurable learning objectives that students should achieve.

Course Materials:
${materialsContent}

${courseContext ? `Course Context: ${courseContext}` : ''}

Please generate learning objectives that:
1. Use action verbs (analyze, evaluate, create, apply, etc.)
2. Are specific and measurable
3. Are appropriate for university-level students
4. Cover the key concepts from the materials
5. Follow Bloom's taxonomy principles

Format your response as a JSON array of strings, like this:
["Students will be able to analyze...", "Students will demonstrate understanding of...", "Students will evaluate..."]

Learning Objectives:`;

    try {
      const temperature = userPreferences?.llmSettings?.temperature || 0.6;
      const maxTokens = userPreferences?.llmSettings?.maxTokens || 1000;
      
      const options = this.getSendMessageOptions(userPreferences, temperature, maxTokens);
      const response = await llmInstance.sendMessage(prompt, options);

      // Try to parse JSON response
      try {
        // Look for JSON array in the response
        const jsonMatch = response.content.match(/\[(.*?)\]/s);
        if (jsonMatch) {
          const jsonStr = jsonMatch[0];
          const objectives = JSON.parse(jsonStr);
          return objectives.filter(obj => obj && obj.trim().length > 0);
        }
      } catch (parseError) {
        console.warn('Failed to parse JSON response, falling back to text parsing');
      }

      // Fallback: Extract objectives from text response
      const lines = response.content.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('Learning Objectives:'))
        .filter(line => line.match(/^[\d\-\*]?\.?\s*Students? will/i))
        .map(line => line.replace(/^[\d\-\*]?\.?\s*/, '').trim())
        .slice(0, 6); // Limit to 6 objectives

      if (lines.length === 0) {
        throw new Error('No valid learning objectives found in response');
      }

      return lines;
    } catch (error) {
      console.error('Error generating learning objectives:', error);
      throw error;
    }
  }

  /**
   * Classify user-provided text into individual learning objectives with user preferences
   * @param {String} inputText - User input text
   * @param {Object} userPreferences - User's AI model preferences
   */
  async classifyLearningObjectives(inputText, userPreferences = null) {
    // Use user-specific LLM instance or fallback to default
    const llmInstance = userPreferences ? this.createUserLLMInstance(userPreferences) : this.llm;
    
    if (!llmInstance) {
      throw new Error('LLM service not initialized. Please check LLM configuration.');
    }

    const prompt = `You are an educational expert. The user has provided text that contains learning objectives. Please extract and classify them into individual, well-formatted learning objectives.

User Input:
"${inputText}"

Please:
1. Extract individual learning objectives from the text
2. Reformat them to start with "Students will be able to..." or "Students will..."
3. Ensure each objective is specific and measurable
4. Remove any duplicates or overlapping objectives
5. Clean up grammar and formatting

Format your response as a JSON array of strings, like this:
["Students will be able to analyze...", "Students will demonstrate understanding of...", "Students will evaluate..."]

Learning Objectives:`;

    try {
      const temperature = userPreferences?.llmSettings?.temperature || 0.5;
      const maxTokens = userPreferences?.llmSettings?.maxTokens || 800;
      
      const options = this.getSendMessageOptions(userPreferences, temperature, maxTokens);
      const response = await llmInstance.sendMessage(prompt, options);

      // Try to parse JSON response
      try {
        const jsonMatch = response.content.match(/\[(.*?)\]/s);
        if (jsonMatch) {
          const jsonStr = jsonMatch[0];
          const objectives = JSON.parse(jsonStr);
          return objectives.filter(obj => obj && obj.trim().length > 0);
        }
      } catch (parseError) {
        console.warn('Failed to parse JSON response, falling back to text parsing');
      }

      // Fallback: Extract objectives from text response
      const lines = response.content.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('Learning Objectives:'))
        .filter(line => line.match(/^[\d\-\*]?\.?\s*Students? will/i))
        .map(line => line.replace(/^[\d\-\*]?\.?\s*/, '').trim())
        .slice(0, 8); // Allow up to 8 from user input

      if (lines.length === 0) {
        // If no "Students will" format found, try to extract any objectives
        const allLines = inputText.split('\n')
          .map(line => line.trim())
          .filter(line => line && line.length > 10)
          .map(line => {
            // Add "Students will be able to" if not present
            if (!line.match(/^Students? will/i)) {
              return `Students will be able to ${line.toLowerCase()}`;
            }
            return line;
          })
          .slice(0, 8);

        return allLines;
      }

      return lines;
    } catch (error) {
      console.error('Error classifying learning objectives:', error);
      throw error;
    }
  }

  /**
   * Regenerate a single learning objective with user preferences
   * @param {String} currentObjective - Current objective text
   * @param {Array} materials - Course materials
   * @param {String} courseContext - Course context
   * @param {Object} userPreferences - User's AI model preferences
   */
  async regenerateSingleObjective(currentObjective, materials, courseContext = '', userPreferences = null) {
    // Use user-specific LLM instance or fallback to default
    const llmInstance = userPreferences ? this.createUserLLMInstance(userPreferences) : this.llm;
    
    if (!llmInstance) {
      throw new Error('LLM service not initialized. Please check LLM configuration.');
    }

    // Prepare materials content for context
    const materialsContent = materials.map(material => {
      let content = '';
      if (material.content) {
        content = material.content.substring(0, 2000); // Limit content length
      }
      return `**${material.name}** (${material.type})\n${content}`;
    }).join('\n\n---\n\n');

    const prompt = `You are an educational expert. Based on the provided course materials, improve and regenerate this learning objective to be more specific, measurable, and aligned with the content.

Course Materials:
${materialsContent}

${courseContext ? `Course Context: ${courseContext}` : ''}

Current Learning Objective:
"${currentObjective}"

Please regenerate this learning objective to:
1. Be more specific and measurable
2. Use appropriate action verbs (analyze, evaluate, create, apply, etc.)
3. Better align with the course materials provided
4. Follow Bloom's taxonomy principles
5. Be appropriate for university-level students

Provide only the improved learning objective as your response (no additional text or formatting):`;

    try {
      const temperature = userPreferences?.llmSettings?.temperature || 0.6;
      const maxTokens = userPreferences?.llmSettings?.maxTokens || 200;
      
      const options = this.getSendMessageOptions(userPreferences, temperature, maxTokens);
      const response = await llmInstance.sendMessage(prompt, options);

      // Clean up the response to get just the objective text
      const cleanedObjective = response.content
        .replace(/^["']|["']$/g, '') // Remove quotes
        .replace(/^\d+\.\s*/, '') // Remove numbering
        .replace(/^[-*]\s*/, '') // Remove bullet points
        .trim();

      if (cleanedObjective.length === 0) {
        throw new Error('No valid learning objective found in response');
      }

      return cleanedObjective;
    } catch (error) {
      console.error('Error regenerating single objective:', error);
      throw error;
    }
  }

  /**
   * Test LLM connection
   */
  async testConnection() {
    if (!this.llm) {
      return {
        success: false,
        error: 'LLM service not initialized. Please check Ollama configuration.'
      };
    }

    try {
      const response = await this.llm.sendMessage('Test connection. Reply with "OK" only.', {
        maxTokens: 10
      });
      
      return {
        success: true,
        model: response.model,
        usage: response.usage
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate multiple questions in a batch with user preferences
   * @param {Object} batchConfig - Configuration for batch generation
   * @param {Object} userPreferences - User's AI model preferences
   * @returns {Promise<Object>} Batch generation results
   */
  async generateQuestionBatch(batchConfig, userPreferences = null) {
    const { learningObjective, questionConfigs, relevantContent, difficulty, courseContext } = batchConfig;
    
    // Validate questionConfigs early to prevent undefined errors
    if (!questionConfigs || !Array.isArray(questionConfigs) || questionConfigs.length === 0) {
      console.error(`❌ Invalid questionConfigs:`, questionConfigs);
      throw new Error('questionConfigs must be a non-empty array');
    }
    
    console.log(`🔄 Generating batch of ${questionConfigs.length} questions`);
    if (userPreferences?.llmProvider === 'openai') {
      console.log(`🤖 Using OpenAI model: ${userPreferences.llmModel || 'gpt-4o-mini'}`);
    } else {
      console.log(`🤖 Using Ollama model: ${userPreferences?.llmModel || 'llama3.1:8b'}`);
    }

    const results = {
      totalRequested: questionConfigs.length,
      totalGenerated: 0,
      questions: [],
      errors: []
    };

    // Generate questions sequentially to avoid overwhelming the LLM
    for (let i = 0; i < questionConfigs.length; i++) {
      const config = questionConfigs[i];
      try {
        console.log(`📝 Generating question ${i + 1}/${questionConfigs.length}: ${config.questionType}`);
        
        const questionConfig = {
          learningObjective,
          questionType: config.questionType,
          relevantContent,
          difficulty: config.difficulty || difficulty,
          courseContext
        };

        const questionResult = await this.generateQuestion(questionConfig, userPreferences);
        
        // Extract the question data from the nested response
        const question = questionResult.success ? questionResult.questionData : questionResult;
        results.questions.push(question);
        results.totalGenerated++;

        // Small delay between questions to be nice to the API
        if (i < questionConfigs.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.error(`❌ Failed to generate question ${i + 1}:`, error.message);
        console.log(`🔄 Falling back to template generation for ${config.questionType} question`);
        
        try {
          // Generate template question as fallback
          const templateQuestion = generateTemplateQuestion(
            { text: learningObjective }, // Ensure it has text property
            config.questionType,
            config.difficulty || difficulty
          );
          
          // Add template question to results
          results.questions.push(templateQuestion);
          results.totalGenerated++;
          
          console.log(`✅ Template ${config.questionType} question generated successfully`);
        } catch (templateError) {
          console.error(`❌ Template generation also failed:`, templateError.message);
          results.errors.push({
            questionIndex: i,
            questionType: config.questionType,
            error: error.message,
            templateError: templateError.message
          });
        }
      }
    }

    console.log(`✅ Batch generation complete: ${results.totalGenerated}/${results.totalRequested} questions generated`);
    return results;
  }
}

// Export singleton instance
const llmService = new QuizLLMService();
export default llmService;