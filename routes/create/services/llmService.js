/**
 * LLM Service for Quiz Question Generation
 * Uses UBC GenAI Toolkit LLM module for real AI-powered question generation
 */

import { LLMModule } from 'ubc-genai-toolkit-llm';
import { ConsoleLogger } from 'ubc-genai-toolkit-core';
import { generateTemplateQuestion } from './templateQuestionGenerator.js';
import { planLOSlices } from './loSlicePlanner.js';
import { QUESTION_TYPES } from '../config/constants.js';
import UserApiKey from '../models/UserApiKey.js';
import User from '../models/User.js';
const ADMIN_CWLS = (process.env.ADMIN_CWLS || '').split(',').map(s => s.trim()).filter(Boolean);

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
      this.provider = process.env.LLM_PROVIDER || 'ollama';

      if (this.provider === 'openai') {
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

  // Returns { apiKey, model, provider, endpoint } from .env
  getEnvLLMConfig() {
    const provider = process.env.LLM_PROVIDER || 'openai';
    return {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      provider,
      endpoint: process.env.LLM_API_ENDPOINT || 'https://api.openai.com/v1'
    };
  }

  // Returns { apiKey, model, provider, endpoint } for a given user.
  // Priority: user's own key → canUseEnvKey fallback → error.
  async resolveUserLLMConfig(userId) {
    if (userId) {
      try {
        const userKey = await UserApiKey.findOne({ user: userId, isActive: true });
        if (userKey) {
          return {
            apiKey: userKey.getDecryptedKey(),
            model: userKey.modelName,
            provider: userKey.provider,
            endpoint: process.env.LLM_API_ENDPOINT || 'https://api.openai.com/v1'
          };
        }

        const user = await User.findById(userId);
        if (!user) throw new Error('No user found');

        const userIdentifiers = [user.cwlId, user.email, user.email?.split('@')[0]]
          .filter(Boolean).map(s => s.toLowerCase());
        const isAdmin = ADMIN_CWLS.some(a => userIdentifiers.includes(a.toLowerCase()));

        if (user.canUseEnvKey || isAdmin) return this.getEnvLLMConfig();

        const noKeyErr = new Error('No API key configured. Please add an API key in Settings.');
        noKeyErr.code = 'NO_API_KEY';
        throw noKeyErr;
      } catch (error) {
        if (error.code === 'NO_API_KEY') throw error;
        console.error('Error resolving user LLM config:', error.message);
        return this.getEnvLLMConfig();
      }
    }
    return this.getEnvLLMConfig();
  }

  // Creates a temporary LLMModule instance for a single request using the given config.
  createLLMForConfig(config) {
    return new LLMModule({
      provider: config.provider,
      apiKey: config.apiKey,
      defaultModel: config.model,
      logger: this.logger,
      defaultOptions: { temperature: 0.7, max_completion_tokens: 2000 }
    });
  }

  /**
   * Get the correct options object for sendMessage based on provider and model from .env
   * @param {number} temperature - Temperature setting
   * @param {number} maxTokens - Max tokens setting
   * @returns {Object} Options object with correct parameter names
   */
  getSendMessageOptions(temperature, maxTokens) {
    const provider = process.env.LLM_PROVIDER || 'ollama';
    const model = process.env.OPENAI_MODEL || process.env.OLLAMA_MODEL || 'llama3.1:8b';
    
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
   * Generate a question with streaming support using LLM + RAG content
   * @param {Object} questionConfig - Question configuration
   * @param {Function} onStreamChunk - Callback for streaming text chunks
   */
  async generateQuestionStreaming(questionConfig, onStreamChunk = null) {
    const {
      learningObjective,
      questionType,
      relevantContent = [],
      difficulty = 'moderate',
      courseContext = '',
      previousQuestions = [],
      customPrompt = null,
      userId = null,
      selectionMode = 'single',
      branchingLayers = 2,
      branchingChoices = 2
    } = questionConfig;

    console.log(`🎯 Generating ${questionType} question with streaming...`);
    console.log(`📝 Learning Objective: ${learningObjective ? learningObjective.substring(0, 100) + '...' : '(none — using custom prompt)'}`);
    console.log(`📚 Using ${relevantContent.length} content chunks`);

    if (!this.llm) {
      throw new Error('LLM service not initialized. Please check Ollama/OpenAI configuration.');
    }

    const provider = process.env.LLM_PROVIDER || 'ollama';
    const model = provider === 'openai' ? (process.env.OPENAI_MODEL || 'gpt-4o-mini') : (process.env.OLLAMA_MODEL || 'llama3.1:8b');
    console.log(`🤖 Using ${provider} model: ${model} (streaming mode)`);

    try {
      // Build expert-level prompt
      const prompt = await this.buildExpertPrompt(
        learningObjective,
        questionType,
        relevantContent,
        difficulty,
        courseContext,
        previousQuestions,
        customPrompt,
        selectionMode,
        branchingLayers,
        branchingChoices
      );

      console.log(`📋 Generated prompt (${prompt.length} chars)`);

      // Call LLM with streaming support
      const startTime = Date.now();
      const temperature = this.getTemperatureForQuestionType(questionType);
      const maxTokens = ['branching-scenario', 'documentation-tool'].includes(questionType) ? 4000 : 2000;
      
      let accumulatedContent = '';
      let responseModel = model;
      
      const options = this.getSendMessageOptions(temperature, maxTokens);
      
      // Add streaming option
      options.stream = true;
      
      console.log(`🌊 Starting streaming generation...`);

      let response;

      // Use direct OpenAI API for better streaming control
      if (this.provider === 'openai') {
        console.log('Using direct OpenAI streaming API');

        try {
          const llmConfig = await this.resolveUserLLMConfig(userId);
          const OpenAI = (await import('openai')).default;
          console.log('OpenAI package imported successfully');

          const createClient = (baseURL) => new OpenAI({ apiKey: llmConfig.apiKey, baseURL });

          // Try LiteLLM proxy first, fallback to direct OpenAI if unavailable
          let openai;
          const litellmUrl = process.env.LLM_API_ENDPOINT;
          const directUrl = 'https://api.openai.com/v1';
          const usingLiteLLM = litellmUrl && litellmUrl !== directUrl;

          if (usingLiteLLM) {
            try {
              const testRes = await fetch(`${litellmUrl}/models`, { signal: AbortSignal.timeout(2000) });
              if (testRes.ok) {
                console.log('✅ LiteLLM proxy reachable — using', litellmUrl);
                openai = createClient(litellmUrl);
              } else {
                throw new Error('LiteLLM returned non-OK');
              }
            } catch {
              console.warn('⚠️ LiteLLM proxy not reachable — falling back to direct OpenAI');
              openai = createClient(directUrl);
            }
          } else {
            openai = createClient(litellmUrl || directUrl);
          }
          console.log('OpenAI client created');

          console.log(`Sending request to OpenAI: model=${model}, temp=${temperature}, maxTokens=${maxTokens}`);
          
          // Add timeout for OpenAI streaming to prevent hanging
          const OPENAI_STREAM_TIMEOUT = 90000; // 90 seconds
          let streamTimeoutId;
          
          const streamPromise = (async () => {
            const stream = await openai.chat.completions.create({
              model: model,
              messages: [{ role: 'user', content: prompt }],
              temperature: temperature,
              max_tokens: maxTokens,
              stream: true
            });
            console.log('OpenAI stream created, starting to receive chunks...');

            let chunkCount = 0;
            let lastChunkTime = Date.now();
            
            for await (const chunk of stream) {
              // Reset timeout on each chunk
              lastChunkTime = Date.now();
              
              const textChunk = chunk.choices[0]?.delta?.content;
              if (textChunk) {
                chunkCount++;
                accumulatedContent += textChunk;

                // Call the streaming callback if provided
                if (onStreamChunk) {
                  onStreamChunk(textChunk, {
                    totalLength: accumulatedContent.length,
                    partial: true
                  });
                }
              }
              
              // Check for finish reason
              if (chunk.choices[0]?.finish_reason) {
                console.log(`OpenAI stream finished with reason: ${chunk.choices[0].finish_reason}`);
                break;
              }
            }

            console.log(`Streaming completed: ${chunkCount} chunks, ${accumulatedContent.length} total chars`);
            return { content: accumulatedContent, model: model };
          })();
          
          const timeoutPromise = new Promise((_, reject) => {
            streamTimeoutId = setTimeout(() => {
              reject(new Error(`OpenAI streaming timeout after ${OPENAI_STREAM_TIMEOUT/1000}s`));
            }, OPENAI_STREAM_TIMEOUT);
          });
          
          try {
            response = await Promise.race([streamPromise, timeoutPromise]);
          } finally {
            clearTimeout(streamTimeoutId);
          }
          
          responseModel = model;
        } catch (openaiError) {
          console.error('OpenAI streaming error:', openaiError.message);
          throw new Error(`OpenAI streaming failed: ${openaiError.message}`);
        }
      } else {
        // Use streamConversation for Ollama to get real streaming
        const messages = [{ role: 'user', content: prompt }];
        if (options.systemPrompt) {
          messages.unshift({ role: 'system', content: options.systemPrompt });
        }

        response = await this.llm.streamConversation(
          messages,
          (chunk) => {
            try {
              // Handle streaming chunks from Ollama
              const textChunk = typeof chunk === 'string' ? chunk : chunk.content || '';

              if (textChunk) {
                accumulatedContent += textChunk;

                // Call the streaming callback if provided
                if (onStreamChunk) {
                  onStreamChunk(textChunk, {
                    totalLength: accumulatedContent.length,
                    partial: true
                  });
                }
              }

            } catch (chunkError) {
              console.error('❌ Error processing stream chunk:', chunkError);
            }
          },
          options
        );

        responseModel = response.model;
      }

      const processingTime = Date.now() - startTime;
      console.log(`⏱️ Streaming completed in ${processingTime}ms`);
      
      // Use accumulated content if streaming worked, otherwise fallback to response content
      const finalContent = accumulatedContent || response.content || '';
      console.log(`🔍 Final content length: ${finalContent.length} chars`);

      // Final streaming callback
      if (onStreamChunk) {
        onStreamChunk('', { 
          totalLength: finalContent.length, 
          partial: false, 
          completed: true 
        });
      }

      // Parse and validate response
      const questionData = this.parseAndValidateResponse(finalContent, questionType, selectionMode);
      
      // Log generated Summary questions for debugging
      if (questionType === 'summary') {
        console.log('📋 SUMMARY QUESTION GENERATED (STREAMING):');
        console.log('🎯 Question Text:', questionData.questionText);
        console.log('📝 Explanation:', questionData.explanation);
        console.log('📚 Content Structure:', JSON.stringify(questionData.content, null, 2));
        if (questionData.content?.keyPoints) {
          console.log('🔑 Key Points Generated:');
          questionData.content.keyPoints.forEach((keyPoint, index) => {
            console.log(`   ${index + 1}. Title: "${keyPoint.title}"`);
            console.log(`      Explanation: "${keyPoint.explanation.substring(0, 100)}..."`);
          });
        }
      }
      
      return {
        success: true,
        promptUsed: prompt, // Add the prompt used for the question generation
        questionData: {
          ...questionData,
          type: questionType,
          difficulty: difficulty || 'moderate',
          prompt: prompt, // Also add it to questionData for backward compatibility
          generationMetadata: {
            llmModel: responseModel,
            generationPrompt: prompt,
            learningObjective: learningObjective,
            subObjective: this.generateSubObjective(learningObjective, questionType),
            focusArea: this.extractFocusArea(learningObjective, questionType),
            complexity: this.determineComplexity(learningObjective, questionType),
            contentSources: (Array.isArray(relevantContent) ? relevantContent : (relevantContent?.chunks || [])).map(c => c.metadata?.source || c.source || 'unknown'),
            processingTime: processingTime,
            temperature: this.getTemperatureForQuestionType(questionType),
            generationMethod: 'llm-rag-enhanced-streaming',
            contentScore: this.calculateContentRelevanceScore(relevantContent),
            confidence: this.estimateQuestionQuality(questionData),
            streamingEnabled: true,
            finalContentLength: finalContent.length
          }
        }
      };
    } catch (error) {
      console.error(`❌ Streaming generation failed: ${error.message}`);
      console.error('🔄 Falling back to non-streaming generation...');
      
      // Fallback to regular generation if streaming fails
      return this.generateQuestion(questionConfig);
    }
  }

  /**
   * Generate a high-quality question using LLM + RAG content
   */
  async generateQuestion(questionConfig) {
    const {
      learningObjective,
      questionType,
      relevantContent = [],
      difficulty = 'moderate',
      courseContext = '',
      previousQuestions = [],
      customPrompt = null,
      userId = null,
      selectionMode = 'single',
      branchingLayers = 2,
      branchingChoices = 2
    } = questionConfig;

    console.log(`🤖 Generating ${questionType} question with LLM...`);
    console.log(`📝 Learning Objective: ${learningObjective.substring(0, 100)}...`);
    console.log(`📚 Using ${relevantContent.length} content chunks`);

    if (!this.llm) {
      throw new Error('LLM service not initialized. Please check Ollama/OpenAI configuration.');
    }

    const llmConfig = await this.resolveUserLLMConfig(userId);
    const llm = this.createLLMForConfig(llmConfig);
    console.log(`🤖 Using ${llmConfig.provider} model: ${llmConfig.model}`);

    try {
      // Build expert-level prompt
      const prompt = await this.buildExpertPrompt(
        learningObjective,
        questionType,
        relevantContent,
        difficulty,
        courseContext,
        previousQuestions,
        customPrompt,
        selectionMode,
        branchingLayers,
        branchingChoices
      );

      console.log(`📋 Generated prompt (${prompt.length} chars)`);

      // Call LLM with default settings from .env
      const startTime = Date.now();
      const temperature = this.getTemperatureForQuestionType(questionType);
      const maxTokens = ['branching-scenario', 'documentation-tool'].includes(questionType) ? 4000 : 2000;

      const options = this.getSendMessageOptions(temperature, maxTokens);
      const response = await llm.sendMessage(prompt, options);

      const processingTime = Date.now() - startTime;
      console.log(`⏱️ LLM response received in ${processingTime}ms`);
      console.log(`🔍 Raw LLM response:`, response.content.substring(0, 500) + '...');

      // Parse and validate response
      const questionData = this.parseAndValidateResponse(response.content, questionType, selectionMode);
      
      // Log generated Summary questions for debugging
      if (questionType === 'summary') {
        console.log('📋 SUMMARY QUESTION GENERATED:');
        console.log('🎯 Question Text:', questionData.questionText);
        console.log('📝 Explanation:', questionData.explanation);
        console.log('📚 Content Structure:', JSON.stringify(questionData.content, null, 2));
        if (questionData.content?.keyPoints) {
          console.log('🔑 Key Points Generated:');
          questionData.content.keyPoints.forEach((keyPoint, index) => {
            console.log(`   ${index + 1}. Title: "${keyPoint.title}"`);
            console.log(`      Explanation: "${keyPoint.explanation.substring(0, 100)}..."`);
          });
        }
        console.log('📋 Full Generated Data:', JSON.stringify(questionData, null, 2));
      }
      
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
            subObjective: this.generateSubObjective(learningObjective, questionType),
            focusArea: this.extractFocusArea(learningObjective, questionType),
            complexity: this.determineComplexity(learningObjective, questionType),
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
  async buildExpertPrompt(learningObjective, questionType, relevantContent, difficulty, courseContext, previousQuestions, customPrompt, selectionMode = 'single', branchingLayers = 2, branchingChoices = 2) {
    // Handle different relevantContent formats
    const contentArray = Array.isArray(relevantContent) 
      ? relevantContent 
      : (relevantContent?.chunks || []);
    
    const contentText = contentArray
      .map((chunk, index) => `[Content ${index + 1}] (from ${chunk.metadata?.source || chunk.source || 'unknown'}, relevance: ${chunk.score?.toFixed(2) || 'N/A'})\n${chunk.content}`)
      .join('\n\n');

    const previousQuestionsText = previousQuestions.length > 0
      ? `\n\nPREVIOUS QUESTIONS TO AVOID DUPLICATION:\n${previousQuestions.map((q, i) => {
          const questionStem = q.questionText || 'Unknown question text';
          const questionTypeLabel = q.type || 'unknown';
          const explanation = q.explanation ? ` | Explanation: ${q.explanation}` : '';
          return `${i + 1}. [${questionTypeLabel}] ${questionStem}${explanation}`;
        }).join('\n')}`
      : '';

    // Delegate to type-specific builders for complex standalone types
    if (questionType === 'branching-scenario') {
      const { buildBranchingPrompt } = await import('../utils/branchingScenarioBuilder.js');
      return buildBranchingPrompt(branchingLayers, branchingChoices, learningObjective || customPrompt || '');
    }
    if (questionType === 'documentation-tool') {
      const { buildDocumentationPrompt } = await import('../utils/documentationToolBuilder.js');
      return buildDocumentationPrompt(customPrompt, learningObjective);
    }

    // Build context section: LO takes priority, customPrompt used when no LO
    const contextSection = learningObjective
      ? `LEARNING OBJECTIVE:\n${learningObjective}`
      : `TASK CONTEXT (provided by instructor):\n${customPrompt}`;

    const basePrompt = `You are an expert educational assessment designer specializing in creating high-quality, pedagogically sound quiz questions. Your task is to generate a ${questionType} question that effectively assesses student understanding.

${contextSection}

COURSE CONTEXT:
${courseContext || 'General academic course'}

RELEVANT COURSE MATERIALS:
${contentText || 'No specific course materials provided - use general knowledge related to the learning objective.'}

DIFFICULTY LEVEL: ${difficulty}

QUESTION TYPE: ${questionType}
${previousQuestionsText}

INSTRUCTIONS:${customPrompt && learningObjective ? '\n⚠️ ADDITIONAL USER REQUIREMENTS (MUST FOLLOW): ' + customPrompt + '\n' : ''}
1. Create a question that directly assesses the ${learningObjective ? 'learning objective' : 'task context'} above
2. Use the provided course materials to create realistic, contextual content
3. Ensure the question tests meaningful understanding, not just memorization
4. Make the question engaging and relevant to real-world applications
5. Follow educational best practices for ${questionType} questions
6. Avoid duplicating previous questions - create unique content, scenarios, concept focus, and reasoning patterns
7. If the learning objective contains multiple components, select ONE clear assessable slice unless synthesis is explicitly necessary
8. Prefer a narrow and concrete target over a broad catch-all question
9. Use the course materials to ground the chosen slice in specific ideas, examples, terminology, or evidence

NOVELTY AND COVERAGE REQUIREMENTS:
- First identify the specific sub-skill, sub-topic, misconception, comparison, process step, or application case that this question will assess
- Do NOT reuse the same assessed slice, scenario, comparison, or conceptual contrast used by previous questions
- Rewording a previous question is NOT enough; the assessed thinking task must be meaningfully different
- When the learning objective is broad, distribute coverage by targeting a different slice than previous questions
- Avoid broad survey-style stems if a more focused question can assess the objective better

MULTIPLE-CHOICE QUALITY REQUIREMENTS:
- The correct answer must be clearly best according to the materials and learning objective
- Each distractor must reflect a different plausible misunderstanding, partial truth, or reasoning error
- Do not create distractors that are trivially wrong, redundant with each other, or only differ cosmetically
- Prefer distractors that help an instructor diagnose what a student misunderstood
- Respect the requested answer mode for multiple-choice questions: ${selectionMode === 'multiple' ? 'multiple answers allowed; at least two options must be correct' : 'single answer only; exactly one option must be correct'}

${customPrompt && learningObjective ? 'IMPORTANT: The additional user requirements above are MANDATORY and must be implemented exactly as specified.' : ''}

RESPONSE FORMAT:
Return ONLY a valid JSON object with this exact structure (all strings must be on single lines - no line breaks within strings):`;

    const formatInstructions = this.getFormatInstructions(questionType, selectionMode);

    return basePrompt + '\n' + formatInstructions;
  }

  /**
   * Get format instructions for each question type
   */
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
2. Do not repeat the same concept focus or scenario used in previous questions.
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

IMPORTANT: Wrap correct words with asterisks (*word*) in the text field. Only the words between asterisks are considered correct. Include surrounding context words without asterisks.`,

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
    // First, remove trailing commas before closing braces/brackets
    // This is a common LLM error: {"key": "value",} or ["item",]
    let cleaned = jsonString
      .replace(/,\s*}/g, '}')  // Remove comma before }
      .replace(/,\s*]/g, ']'); // Remove comma before ]

    // The most common issue is literal newlines in string values
    // We need to carefully replace newlines only within string values

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
  parseAndValidateResponse(responseContent, questionType, selectionMode = 'single') {
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
        if (!parsed.introText || !Array.isArray(parsed.nodes)) {
          throw new Error('Branching scenario response missing introText or nodes array');
        }

        // Post-process: remove invalid leaf nodes the LLM sometimes generates.
        // A node is considered invalid if it has no question (and is not the intro).
        // Any alternative pointing to such a node — or back to the intro (index 0) —
        // is redirected to -1 (end screen) so the scenario terminates properly.
        const invalidIndices = new Set(
          parsed.nodes
            .filter(n => n.index !== 0 && !n.question)
            .map(n => n.index)
        );

        const cleanedNodes = parsed.nodes
          .filter(n => !invalidIndices.has(n.index))
          .map(n => ({
            ...n,
            alternatives: (n.alternatives || []).map(alt =>
              invalidIndices.has(alt.nextContentId) || alt.nextContentId === 0
                ? { ...alt, nextContentId: -1 }
                : alt
            )
          }));

        return {
          questionText: 'Branching Scenario',
          content: {
            introText: parsed.introText,
            nodes: cleanedNodes
          },
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

  normalizeTextForValidation(text = '') {
    return String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  extractValidationKeywords(plannedTask) {
    if (!plannedTask?.sliceLabel) return [];

    const base = plannedTask.sliceLabel
      .replace(/^Compare\s+/i, '')
      .replace(/^Distinguish\s+/i, '');

    const normalized = this.normalizeTextForValidation(base);
    const tokens = normalized.split(' ').filter(Boolean);
    const keywords = [];

    const preferredTerms = [
      'co2',
      'ch4',
      'n2o',
      'carbon dioxide',
      'methane',
      'nitrous oxide',
      'anthropogenic',
      'natural',
      'sources',
      'source'
    ];

    for (const term of preferredTerms) {
      if (normalized.includes(term)) {
        keywords.push(term);
      }
    }

    if (keywords.length === 0) {
      return tokens.slice(0, 4);
    }

    return [...new Set(keywords)];
  }

  questionMatchesPlannedTask(questionData, plannedTask) {
    if (!plannedTask?.sliceLabel || !questionData) {
      return { valid: true, reason: 'No planned task provided' };
    }

    const searchableText = this.normalizeTextForValidation([
      questionData.questionText,
      questionData.explanation,
      questionData.correctAnswer
    ].filter(Boolean).join(' '));

    const keywords = this.extractValidationKeywords(plannedTask);
    const matchedKeywords = keywords.filter(keyword => searchableText.includes(this.normalizeTextForValidation(keyword)));

    if (plannedTask.sliceKind === 'component') {
      const requiredComponentTerms = keywords.filter(keyword =>
        ['co2', 'ch4', 'n2o', 'carbon dioxide', 'methane', 'nitrous oxide'].includes(keyword)
      );
      const componentMatched = requiredComponentTerms.filter(keyword =>
        searchableText.includes(this.normalizeTextForValidation(keyword))
      );

      if (requiredComponentTerms.length > 0 && componentMatched.length === 0) {
        return {
          valid: false,
          reason: `Generated question did not stay on planned component slice "${plannedTask.sliceLabel}"`
        };
      }
    }

    if (plannedTask.sliceKind === 'comparison') {
      const componentTerms = keywords.filter(keyword =>
        ['co2', 'ch4', 'n2o', 'carbon dioxide', 'methane', 'nitrous oxide'].includes(keyword)
      );
      const uniqueMatches = componentTerms.filter(keyword =>
        searchableText.includes(this.normalizeTextForValidation(keyword))
      );

      if (uniqueMatches.length < 2) {
        return {
          valid: false,
          reason: `Comparison slice "${plannedTask.sliceLabel}" was not reflected in the generated question`
        };
      }
    }

    if (plannedTask.sliceKind === 'misconception') {
      if (matchedKeywords.length === 0) {
        return {
          valid: false,
          reason: `Misconception slice "${plannedTask.sliceLabel}" was not reflected in the generated question`
        };
      }
    }

    return { valid: true, reason: 'Question matches planned slice' };
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
      courseContext,
      onStreamChunk = null // NEW: Optional streaming callback
    } = batchConfig;

    console.log(`🎯 Generating batch of questions for LO: ${learningObjective.substring(0, 50)}...`);

    const questions = [];
    const errors = [];
    const provider = process.env.LLM_PROVIDER || 'ollama';

    for (const config of questionConfigs) {
      const slicePlan = planLOSlices({
        learningObjective,
        questionType: config.questionType,
        requestedCount: config.count
      });

      console.log(`🧩 Slice plan for ${config.questionType}:`, slicePlan.recommendedTasks.map(task => task.sliceLabel).join(' | '));

      for (let i = 0; i < config.count; i++) {
        try {
          const plannedTask = slicePlan.recommendedTasks[i];
          let result = null;
          let finalValidation = { valid: true, reason: 'Not validated' };
          const maxAttempts = plannedTask ? 3 : 1;

          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const taskPrompt = plannedTask
              ? `The slice has already been selected for you. You MUST generate a question only about "${plannedTask.sliceLabel}" using the intent "${plannedTask.questionIntent}". You are NOT allowed to switch to another gas, another concept slice, or a broad all-in-one version of the learning objective. If the planned slice is a component such as CO2, CH4, or N2O, the question must stay on that component. If the planned slice is a comparison, the question must explicitly compare the named components. If the planned slice is a misconception task, the question must explicitly test that misconception target. Do not assess a slice already used by previous questions if other planned slices remain available.${attempt > 1 ? ` This is retry attempt ${attempt} because a previous attempt drifted away from the assigned slice.` : ''}`
              : null;

            // Use streaming for Ollama only
            if (provider === 'ollama' && onStreamChunk) {
              console.log(`🌊 Using streaming generation for ${config.questionType} (Ollama), attempt ${attempt}`);
              result = await this.generateQuestionStreaming({
                learningObjective,
                questionType: config.questionType,
                relevantContent,
                difficulty,
                courseContext,
                previousQuestions: questions,
                customPrompt: taskPrompt
              }, (chunk, metadata) => {
                onStreamChunk({
                  questionType: config.questionType,
                  questionIndex: i + 1,
                  chunk,
                  metadata
                });
              });
            } else {
              result = await this.generateQuestion({
                learningObjective,
                questionType: config.questionType,
                relevantContent,
                difficulty,
                courseContext,
                previousQuestions: questions,
                customPrompt: taskPrompt
              });
            }

            if (!result?.success) {
              continue;
            }

            finalValidation = this.questionMatchesPlannedTask(result.questionData, plannedTask);
            if (finalValidation.valid) {
              break;
            }

            console.warn(`⚠️ Generated question drifted from planned slice on attempt ${attempt}: ${finalValidation.reason}`);
            result = null;
          }
          
          if (result?.success) {
            const questionWithMetadata = {
              ...result.questionData,
              type: config.questionType,
              order: questions.length,
              plannedSlice: plannedTask?.sliceLabel || null,
              plannedIntent: plannedTask?.questionIntent || null
            };
            
            // Additional logging for Summary questions in batch
            if (config.questionType === 'summary') {
              console.log('🔄 BATCH: Summary question added to results');
              console.log('📋 Batch Summary Data:', JSON.stringify(questionWithMetadata, null, 2));
            }
            
            questions.push(questionWithMetadata);
          } else if (plannedTask && !finalValidation.valid) {
            throw new Error(`Failed to generate a question that matches the planned slice "${plannedTask.sliceLabel}": ${finalValidation.reason}`);
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
   * Generate learning objectives from course materials
   * @param {Array} materials - Course materials
   * @param {String} courseContext - Course context string
   * @param {Number} targetCount - Target number of objectives
   * @param {Object} userPreferences - User preferences for LLM
   * @param {String} customPrompt - Optional custom prompt to guide generation
   */
  async generateLearningObjectives(materials, courseContext = '', targetCount = null, userPreferences = null, customPrompt = null) {
    console.log(`🎯 Generating learning objectives from ${materials.length} materials`);
    if (customPrompt) {
      console.log(`📝 Custom prompt provided: ${customPrompt}`);
    }

    if (!this.llm) {
      throw new Error('LLM service not initialized. Please check LLM configuration.');
    }

    const provider = process.env.LLM_PROVIDER || 'ollama';
    const model = provider === 'openai' ? (process.env.OPENAI_MODEL || 'gpt-4o-mini') : (process.env.OLLAMA_MODEL || 'llama3.1:8b');
    console.log(`🤖 Using ${provider} model: ${model}`);

    // Import and use RAG service to retrieve relevant chunks from vector database
    let materialsContent = '';
    try {
      const { default: ragService } = await import('./ragService.js');
      await ragService.initialize();

      // Query the vector database for relevant content about course/learning objectives
      const searchQuery = `course content learning objectives topics concepts ${courseContext}`;
      console.log(`🔍 Retrieving relevant chunks from vector database with query: "${searchQuery}"`);

      // Extract material IDs to filter RAG results
      const materialIds = materials.map(m => m._id.toString());
      console.log(`🎯 Filtering by ${materialIds.length} material IDs:`, materialIds);

      // Use the underlying ragModule to call retrieveContext with higher limit
      // We'll filter afterward since Qdrant filter syntax might not work
      const ragResultsRaw = await ragService.ragModule.retrieveContext(searchQuery, {
        limit: 50, // Get more chunks to ensure we have enough after filtering
        scoreThreshold: 0.3 // Lower threshold for learning objectives
      });

      console.log(`📥 Retrieved ${ragResultsRaw.length} total chunks from vector database`);

      // Filter results to only include chunks from selected materials
      const ragResults = ragResultsRaw.filter(result => {
        const resultMaterialId = result.metadata?.materialId;
        const isIncluded = materialIds.includes(resultMaterialId);
        if (!isIncluded) {
          console.log(`🚫 Excluding chunk from material: ${result.metadata?.materialName} (ID: ${resultMaterialId})`);
        }
        return isIncluded;
      }).slice(0, 15); // Take top 15 after filtering

      console.log(`✅ After filtering: ${ragResults.length} chunks from selected materials`);

      if (ragResults && ragResults.length > 0) {
        console.log(`✅ Using ${ragResults.length} relevant chunks from selected materials`);

        // Debug: Log the structure of the first result
        if (ragResults.length > 0) {
          console.log('🔍 First RAG result structure:', JSON.stringify({
            keys: Object.keys(ragResults[0]),
            metadata: ragResults[0].metadata,
            contentPreview: {
              content: ragResults[0].content ? ragResults[0].content.substring(0, 100) : null,
              pageContent: ragResults[0].pageContent ? ragResults[0].pageContent.substring(0, 100) : null,
              text: ragResults[0].text ? ragResults[0].text.substring(0, 100) : null
            }
          }, null, 2));
        }

        materialsContent = ragResults.map((result, idx) => {
          const materialName = result.metadata?.materialName || result.metadata?.fileName || 'Material';
          // Handle both content and pageContent field names
          const content = result.content || result.pageContent || result.text || '';
          console.log(`📄 Chunk ${idx + 1} content length: ${content.length}, preview: ${content.substring(0, 50)}`);
          return `**Excerpt ${idx + 1} from ${materialName}**\n${content}`;
        }).join('\n\n---\n\n');
      } else {
        console.warn('⚠️ No chunks retrieved from vector database, falling back to material names only');
        materialsContent = materials.map(material => `**${material.name}** (${material.type})`).join('\n\n');
      }
    } catch (error) {
      console.error('❌ Error retrieving from RAG:', error);
      console.error('❌ Error stack:', error.stack);
      // Fallback to using material names if RAG fails
      console.warn('⚠️ Falling back to material names only');
      materialsContent = materials.map(material => `**${material.name}** (${material.type})`).join('\n\n');
    }

    const countInstruction = targetCount ? `exactly ${targetCount}` : '4-6';
    const customInstructions = customPrompt ? `\n\nAdditional Instructions from User:\n${customPrompt}` : '';
    const prompt = `You are an educational expert helping to create learning objectives for a university course. Based on the provided course materials, generate ${countInstruction} specific, measurable learning objectives that students should achieve.

Course Materials:
${materialsContent}

${courseContext ? `Course Context: ${courseContext}` : ''}${customInstructions}

Please generate learning objectives that:
1. Use action verbs (analyze, evaluate, create, apply, etc.)
2. Are specific and measurable
3. Are appropriate for university-level students
4. Cover the key concepts from the materials
5. Follow Bloom's taxonomy principles

Format your response as a JSON array of strings, like this:
["Students will be able to analyze...", "Students will demonstrate understanding of...", "Students will evaluate..."]

Learning Objectives:`;

    // Log the complete prompt being sent to the LLM
    console.log('\n==================== LLM PROMPT ====================');
    console.log(prompt);
    console.log('====================================================\n');

    try {
      const temperature = 0.6;
      const maxTokens = 1000;

      const options = this.getSendMessageOptions(temperature, maxTokens);
      const response = await this.llm.sendMessage(prompt, options);

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
   * Classify user-provided text into individual learning objectives
   * @param {String} inputText - User input text
   */
  async classifyLearningObjectives(inputText) {
    if (!this.llm) {
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
      const temperature = 0.5;
      const maxTokens = 800;
      
      const options = this.getSendMessageOptions(temperature, maxTokens);
      const response = await this.llm.sendMessage(prompt, options);

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
   * Regenerate a single learning objective
   * @param {String} currentObjective - Current objective text
   * @param {Array} materials - Course materials
   * @param {String} courseContext - Course context
   * @param {Object} userPreferences - User's LLM preferences
   * @param {String} customPrompt - Optional custom prompt for regeneration
   */
  async regenerateSingleObjective(currentObjective, materials, courseContext = '', userPreferences = null, customPrompt = null) {
    if (!this.llm) {
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

    const basePrompt = `You are an educational expert. Based on the provided course materials, improve and regenerate this learning objective to be more specific, measurable, and aligned with the content.

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

${customPrompt ? `\nADDITIONAL INSTRUCTIONS:\n${customPrompt}\n` : ''}

Provide only the improved learning objective as your response (no additional text or formatting):`;

    try {
      const temperature = 0.6;
      const maxTokens = 200;

      const options = this.getSendMessageOptions(temperature, maxTokens);
      const response = await this.llm.sendMessage(basePrompt, options);

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
   * Generate multiple questions in a batch
   * @param {Object} batchConfig - Configuration for batch generation
   * @returns {Promise<Object>} Batch generation results
   */
  async generateQuestionBatch(batchConfig) {
    const { learningObjective, questionConfigs, relevantContent, difficulty, courseContext } = batchConfig;
    
    // Validate questionConfigs early to prevent undefined errors
    if (!questionConfigs || !Array.isArray(questionConfigs) || questionConfigs.length === 0) {
      console.error(`❌ Invalid questionConfigs:`, questionConfigs);
      throw new Error('questionConfigs must be a non-empty array');
    }
    
    console.log(`🔄 Generating batch of ${questionConfigs.length} questions`);
    const provider = process.env.LLM_PROVIDER || 'ollama';
    const model = provider === 'openai' ? (process.env.OPENAI_MODEL || 'gpt-4o-mini') : (process.env.OLLAMA_MODEL || 'llama3.1:8b');
    console.log(`🤖 Using ${provider} model: ${model}`);

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

        const questionResult = await this.generateQuestion(questionConfig);
        
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

  /**
   * Generate sub-objective based on learning objective and question type
   */
  generateSubObjective(learningObjective, questionType) {
    const types = {
      'multiple-choice': 'conceptual understanding and application',
      'true-false': 'validation of key principles and facts',
      'flashcard': 'recall and memorization of important concepts',
      'discussion': 'critical thinking and analysis',
      'summary': 'synthesis and comprehensive understanding'
    };
    const loText = typeof learningObjective === 'string' ? learningObjective : learningObjective.text || 'learning objective';
    return `Students will demonstrate ${types[questionType] || 'understanding'} of ${loText.substring(0, 50)}${loText.length > 50 ? '...' : ''}`;
  }

  /**
   * Extract focus area from learning objective
   */
  extractFocusArea(learningObjective, questionType) {
    const loText = typeof learningObjective === 'string' ? learningObjective : learningObjective.text || '';
    const focusKeywords = [
      'conceptual understanding', 'practical application', 'analytical thinking',
      'synthesis', 'evaluation', 'problem-solving', 'real-world relevance',
      'critical analysis', 'knowledge integration', 'skill development'
    ];
    
    for (const keyword of focusKeywords) {
      if (loText.toLowerCase().includes(keyword)) {
        return keyword;
      }
    }
    
    // Default based on question type
    const typeDefaults = {
      'multiple-choice': 'conceptual understanding',
      'true-false': 'knowledge validation',
      'flashcard': 'recall and memorization',
      'discussion': 'critical analysis',
      'summary': 'synthesis'
    };
    
    return typeDefaults[questionType] || 'general knowledge';
  }

  /**
   * Determine complexity level based on learning objective and question type
   */
  determineComplexity(learningObjective, questionType) {
    const loText = typeof learningObjective === 'string' ? learningObjective : learningObjective.text || '';
    const complexityIndicators = {
      high: ['synthesis', 'evaluation', 'analysis', 'compare', 'evaluate', 'synthesize', 'create', 'design'],
      medium: ['application', 'apply', 'demonstrate', 'solve', 'use', 'implement', 'calculate'],
      low: ['recall', 'memorize', 'identify', 'define', 'list', 'describe', 'explain']
    };
    
    const lowerText = loText.toLowerCase();
    for (const [level, indicators] of Object.entries(complexityIndicators)) {
      if (indicators.some(indicator => lowerText.includes(indicator))) {
        return level;
      }
    }
    
    // Default based on question type
    const typeDefaults = {
      'multiple-choice': 'medium',
      'true-false': 'low',
      'flashcard': 'low',
      'discussion': 'high',
      'summary': 'high'
    };
    
    return typeDefaults[questionType] || 'medium';
  }
}

// Export singleton instance
const llmService = new QuizLLMService();
export default llmService;
