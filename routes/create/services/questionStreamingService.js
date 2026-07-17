/**
 * Question Streaming Service
 * Handles streaming question generation with real-time updates
 */

import sseService from './sseService.js';
import llmService from './llmService.js';
import questionMemoryService from './questionMemoryService.js';
import { formatContentForDatabase } from './questionContentService.js';

class QuestionStreamingService {
  buildPlannedTaskPrompt(plannedTask, attempt = 1) {
    if (!plannedTask) {
      return null;
    }

    return [
      `The slice has already been selected for you. You MUST generate a question only about "${plannedTask.sliceLabel}" using the intent "${plannedTask.questionIntent}".`,
      'You are NOT allowed to switch to another gas, another concept slice, or a broad all-in-one version of the learning objective.',
      'If the planned slice is a component such as CO2, CH4, or N2O, the question must stay on that component.',
      'If the planned slice is a comparison, the question must explicitly compare the named components.',
      'If the planned slice is a misconception task, the question must explicitly test that misconception target.',
      attempt > 1 ? `This is retry attempt ${attempt} because a previous attempt drifted away from the assigned slice.` : ''
    ].filter(Boolean).join(' ');
  }

  mergeCustomPromptWithPlannedTask(customPrompt, plannedTaskPrompt) {
    return [customPrompt, plannedTaskPrompt].filter(Boolean).join('\n\n');
  }

  buildSelectionModePrompt(questionConfig) {
    if (questionConfig.questionType !== 'multiple-choice') {
      return null;
    }

    if (questionConfig.selectionMode === 'multiple') {
      return [
        'This must be a MULTIPLE-ANSWER multiple choice question.',
        'Write the stem so students understand they should select all that apply.',
        'You MUST mark at least two options as correct.',
        'Return the correctAnswer field as an array of the correct option texts.'
      ].join(' ');
    }

    return [
      'This must be a SINGLE-ANSWER multiple choice question.',
      'You MUST mark exactly one option as correct.',
      'Return the correctAnswer field as the single correct option text.'
    ].join(' ');
  }

  buildSourceReferences(relevantContent = []) {
    const contentArray = Array.isArray(relevantContent)
      ? relevantContent
      : (relevantContent?.chunks || []);

    return contentArray.slice(0, 3).map(chunk => {
      const metadata = chunk.metadata || {};
      const content = String(chunk.content || chunk.pageContent || chunk.text || '');
      return {
        materialId: metadata.materialId || undefined,
        materialName: metadata.materialName || metadata.fileName || metadata.sourceFile || 'Course material',
        sourceFile: metadata.sourceFile || metadata.fileName || metadata.source || '',
        chunkIndex: typeof metadata.chunkIndex === 'number' ? metadata.chunkIndex : undefined,
        pageNumber: typeof metadata.pageNumber === 'number' ? metadata.pageNumber : undefined,
        pageStart: typeof metadata.pageStart === 'number' ? metadata.pageStart : undefined,
        pageEnd: typeof metadata.pageEnd === 'number' ? metadata.pageEnd : undefined,
        excerpt: content.length > 500 ? `${content.substring(0, 500)}...` : content,
        relevanceScore: typeof chunk.score === 'number' ? chunk.score : undefined,
        section: metadata.sectionTitle || metadata.section || '',
        sectionId: metadata.sectionId || undefined
      };
    }).filter(ref => ref.excerpt || ref.materialName);
  }

  /**
   * Generate a question with streaming progress updates
   */
  async generateQuestionWithStreaming({
    quizId,
    questionId,
    questionConfig,
    learningObjective,
    relevantContent,
    sessionId,
    userId
  }) {
    console.log(`🎯 Starting streaming generation for question: ${questionId}`);
    console.log(`🔍 DEBUG - learningObjective received:`, typeof learningObjective, learningObjective);
    console.log(`🔍 DEBUG - quizId:`, quizId);
    console.log(`🔍 DEBUG - userId:`, userId);
    
    try {
      const resolvedLLMConfig = await llmService.resolveUserLLMConfig(userId);

      // Send diagnostic info to frontend
      sseService.streamQuestionProgress(sessionId, questionId, {
        status: 'diagnostic',
        llmProvider: resolvedLLMConfig.provider,
        llmModel: resolvedLLMConfig.model,
        environment: process.env.NODE_ENV
      });

      // Notify start of question generation
      const loText = learningObjective?.text || (typeof learningObjective === 'string' ? learningObjective : null);
      sseService.streamQuestionProgress(sessionId, questionId, {
        status: 'started',
        type: questionConfig.questionType,
        learningObjective: loText || questionConfig.customPrompt || 'custom prompt'
      });

      // Create streaming callback
      const onStreamChunk = (textChunk, metadata) => {
        console.log(`📝 onStreamChunk called for ${questionId}: partial=${metadata.partial}, textLength=${textChunk?.length}, totalLength=${metadata.totalLength}`);

        if (metadata.partial && textChunk) {
          // Stream the text chunk to the client (real-time streaming)
          console.log(`📤 Sending text chunk to SSE for ${questionId}: "${textChunk.substring(0, 50)}..."`);
          const sent = sseService.streamTextChunk(sessionId, questionId, textChunk, {
            totalLength: metadata.totalLength,
            isPartial: true,
            timestamp: new Date().toISOString()
          });
          console.log(`📡 SSE send result: ${sent}`);
        } else if (metadata.completed && metadata.totalLength > 0) {
          // Generation completed without streaming chunks (Ollama bulk response)
          // Send a final "progress" indicator showing generation is done
          console.log(`🌊 Streaming completed for ${questionId}, total length: ${metadata.totalLength}`);
          console.log(`📤 Sending completion indicator to SSE`);
          sseService.streamQuestionProgress(sessionId, questionId, {
            status: 'completed',
            message: 'Question generated successfully',
            totalLength: metadata.totalLength
          });
        }
      };

      // Use real LLM streaming generation
      console.log(`[${questionId}] Calling llmService.generateQuestionStreaming...`);
      sseService.streamQuestionProgress(sessionId, questionId, {
        status: 'llm-started',
        message: 'Calling LLM service...'
      });

      const plannedTask = questionConfig.plannedTask || null;
      const maxAttempts = 3;
      let result = null;
      let finalValidation = { valid: true, reason: 'No planned task validation required' };
      let noveltyResult = {
        novel: true,
        threshold: 0.76,
        similarity: 0,
        noveltyScore: 1,
        mostSimilarQuestionId: null,
        mostSimilarQuestionText: ''
      };
      let retryGuidance = '';
      let finalFailureReason = 'LLM generation failed';

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (attempt > 1) {
          sseService.streamTextReset(sessionId, questionId, {
            attempt,
            reason: 'validation-retry'
          });
        }

        const plannedTaskPrompt = this.buildPlannedTaskPrompt(plannedTask, attempt);
        const selectionModePrompt = this.buildSelectionModePrompt(questionConfig);
        const customPrompt = this.mergeCustomPromptWithPlannedTask(
          this.mergeCustomPromptWithPlannedTask(
            this.mergeCustomPromptWithPlannedTask(questionConfig.customPrompt, selectionModePrompt),
            plannedTaskPrompt
          ),
          retryGuidance
        );

        if (plannedTask) {
          sseService.streamQuestionProgress(sessionId, questionId, {
            status: 'slice-planned',
            message: `Generating planned slice: ${plannedTask.sliceLabel}`,
            plannedSlice: plannedTask.sliceLabel,
            attempt
          });
        }

        const attemptChunks = [];
        const attemptStreamCallback = (textChunk, metadata) => {
          if (metadata?.partial && textChunk) {
            attemptChunks.push(textChunk);
            onStreamChunk(textChunk, { ...metadata, attempt });
          }
        };

        result = await llmService.generateQuestionStreaming({
          learningObjective: learningObjective?.text || (typeof learningObjective === 'string' ? learningObjective : null),
          questionType: questionConfig.questionType,
          relevantContent: relevantContent || [],
          difficulty: questionConfig.difficulty || 'moderate',
          courseContext: questionConfig.courseContext || '',
          previousQuestions: questionConfig.previousQuestions || [],
          customPrompt,
          userId,
          llmConfig: resolvedLLMConfig,
          selectionMode: questionConfig.selectionMode,
          branchingLayers: questionConfig.branchingLayers ?? 2,
          branchingChoices: questionConfig.branchingChoices ?? 2
        }, attemptStreamCallback);

        if (!result?.success) {
          finalFailureReason = result?.error || 'LLM generation failed';
          continue;
        }

        finalValidation = llmService.questionMatchesPlannedTask(result.questionData, plannedTask);
        if (!finalValidation.valid) {
          finalFailureReason = `Failed to match the planned slice: ${finalValidation.reason}`;
          retryGuidance = [
            'RETRY CORRECTION:',
            finalValidation.reason,
            `Stay strictly within the assigned slice "${plannedTask?.sliceLabel}".`
          ].join(' ');
          console.warn(`[${questionId}] Planned slice validation failed on attempt ${attempt}: ${finalValidation.reason}`);
          sseService.streamQuestionProgress(sessionId, questionId, {
            status: 'slice-retry',
            message: finalValidation.reason,
            plannedSlice: plannedTask?.sliceLabel,
            attempt
          });
          result = null;
          continue;
        }

        noveltyResult = await questionMemoryService.reserveIfNovel({
          sessionId,
          questionId,
          candidate: result.questionData.questionText,
          existingQuestions: questionConfig.duplicateCheckQuestions
            || questionConfig.previousQuestions
            || []
        });

        if (!noveltyResult.novel) {
          const similarStem = noveltyResult.mostSimilarQuestionText?.slice(0, 240) || 'an existing question';
          finalFailureReason = `Generated question was too similar to an existing question (${Math.round(noveltyResult.similarity * 100)}% similarity)`;
          retryGuidance = [
            'NOVELTY RETRY REQUIRED:',
            `The previous candidate was too similar to: "${similarStem}".`,
            'Assess a different fact, subpoint, misconception, application context, or reasoning step.',
            'Use a meaningfully different stem structure and answer-option pattern while preserving the assigned learning objective and planned slice.'
          ].join(' ');
          console.warn(`[${questionId}] Novelty validation failed on attempt ${attempt}: similarity=${noveltyResult.similarity}`);
          sseService.streamQuestionProgress(sessionId, questionId, {
            status: 'novelty-retry',
            message: finalFailureReason,
            similarity: noveltyResult.similarity,
            threshold: noveltyResult.threshold,
            attempt
          });
          result = null;
          continue;
        }

        const acceptedStreamText = attemptChunks.join('') || result.rawContent || '';
        if (!attemptChunks.length && acceptedStreamText) {
          onStreamChunk(acceptedStreamText, {
            totalLength: acceptedStreamText.length,
            partial: true,
            buffered: true,
            attempt
          });
        }
        onStreamChunk('', {
          totalLength: acceptedStreamText.length,
          partial: false,
          completed: true,
          attempt
        });
        break;
      }
      
      if (!result?.success) {
        throw new Error(finalFailureReason);
      }

      console.log(`[${questionId}] LLM returned, success=${result.success}`);
      sseService.streamQuestionProgress(sessionId, questionId, {
        status: 'llm-complete',
        message: `LLM returned, success=${result.success}`
      });

      if (result.success) {
        if (questionConfig.questionType === 'multiple-choice') {
          result.questionData.content = {
            ...(result.questionData.content || {}),
            selectionMode: questionConfig.selectionMode || 'single'
          };
        }

        console.log(`[${questionId}] Starting database save...`);
        sseService.streamQuestionProgress(sessionId, questionId, {
          status: 'db-save-started',
          message: 'Starting database save...'
        });
        
        // Save question to database
        const Question = (await import('../models/Question.js')).default;
        const Quiz = (await import('../models/Quiz.js')).default;
        
        // Get current question count for proper ordering
        console.log(`[${questionId}] Counting existing questions...`);
        const existingQuestionsCount = await Question.countDocuments({ quiz: quizId });
        console.log(`[${questionId}] Existing questions count: ${existingQuestionsCount}`);
        
        // Generate metadata fields to match non-streaming implementation
        console.log(`🔍 DEBUG - questionConfig received:`, questionConfig);
        const questionType = questionConfig.questionType || result.questionData.type || 'multiple-choice';
        console.log(`🔍 DEBUG - questionType resolved:`, questionType);
        
        const generateSubObjective = (lo, questionType) => {
          const types = {
            'multiple-choice': 'conceptual understanding and application',
            'true-false': 'validation of key principles and facts',
            'flashcard': 'recall and memorization of important concepts',
            'discussion': 'critical thinking and analysis',
            'summary': 'synthesis and comprehensive understanding'
          };
          const loText = String(typeof lo === 'string'
            ? lo
            : (lo?.text || questionConfig.focusArea || questionConfig.customPrompt || 'learning objective'));
          return `Students will demonstrate ${types[questionType] || 'understanding'} of ${loText.substring(0, 50)}${loText.length > 50 ? '...' : ''}`;
        };

        const extractFocusArea = (subObjective) => {
          const focusKeywords = [
            'conceptual understanding', 'practical application', 'analytical thinking',
            'synthesis', 'evaluation', 'problem-solving', 'real-world relevance',
            'critical analysis', 'knowledge integration', 'skill development'
          ];
          for (const keyword of focusKeywords) {
            if (subObjective.toLowerCase().includes(keyword)) {
              return keyword;
            }
          }
          return 'general knowledge';
        };

        const determineComplexity = (subObjective, questionType) => {
          const complexityIndicators = {
            high: ['synthesis', 'evaluation', 'analysis', 'compare', 'evaluate', 'synthesize'],
            medium: ['application', 'apply', 'demonstrate', 'solve', 'use'],
            low: ['recall', 'memorize', 'identify', 'define', 'list']
          };
          const lowerText = subObjective.toLowerCase();
          for (const [level, indicators] of Object.entries(complexityIndicators)) {
            if (indicators.some(indicator => lowerText.includes(indicator))) {
              return level;
            }
          }
          return 'medium';
        };

        const subObjective = generateSubObjective(learningObjective, questionType);
        const focusArea = questionConfig.focusArea || extractFocusArea(subObjective);
        const complexity = determineComplexity(subObjective, questionType);
        const sourceReferences = this.buildSourceReferences(relevantContent);

        const newQuestion = new Question({
          quiz: quizId,
          type: result.questionData.type,
          questionText: result.questionData.questionText,
          correctAnswer: result.questionData.correctAnswer,
          explanation: result.questionData.explanation,
          content: formatContentForDatabase(result.questionData, result.questionData.type),
          difficulty: result.questionData.difficulty,
          ...(learningObjective && { learningObjective: learningObjective._id || learningObjective }),
          order: existingQuestionsCount, // Proper ordering
          reviewStatus: 'pending',
          createdBy: userId, // Add the required createdBy field
          generationMetadata: {
            llmModel: result.questionData.generationMetadata?.llmModel || resolvedLLMConfig.model,
            generationPrompt: result.promptUsed || result.questionData.prompt,
            generatedFrom: sourceReferences
              .map(ref => ref.materialId)
              .filter(Boolean),
            sourceReferences,
            subObjective: subObjective,
            generationMethod: 'AI-streaming-generation',
            focusArea: focusArea,
            complexity: complexity,
            pedagogicalIntent: questionConfig.pedagogicalIntent || null,
            bloomLevel: questionConfig.bloomLevel || null,
            planRationale: questionConfig.planRationale || null,
            confidence: 0.9,
            processingTime: result.metadata?.processingTime || 2000,
            streamingGenerated: true,
            plannedSlice: plannedTask?.sliceLabel || null,
            plannedIntent: plannedTask?.questionIntent || null,
            plannedSliceValidation: finalValidation,
            noveltyScore: noveltyResult.noveltyScore,
            duplicateCheck: noveltyResult,
            generatedAt: new Date().toISOString()
          }
        });

        let savedQuestion;
        try {
          console.log(`[${questionId}] Saving question to database...`);
          sseService.streamQuestionProgress(sessionId, questionId, {
            status: 'db-saving',
            message: 'Saving question to database...'
          });
          
          // Add timeout for database save operation
          const DB_SAVE_TIMEOUT = 30000; // 30 seconds
          const savePromise = newQuestion.save();
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Database save timeout after 30s')), DB_SAVE_TIMEOUT)
          );
          
          savedQuestion = await Promise.race([savePromise, timeoutPromise]);
          console.log(`[${questionId}] Question saved: ${savedQuestion._id}`);
          sseService.streamQuestionProgress(sessionId, questionId, {
            status: 'db-saved',
            message: `Question saved: ${savedQuestion._id}`
          });

          // Add question to quiz using the proper method (like in main branch)
          console.log(`[${questionId}] Finding quiz...`);
          const quiz = await Quiz.findById(quizId);
          
          if (!quiz) {
            throw new Error(`Quiz not found: ${quizId}`);
          }

          console.log(`[${questionId}] Adding question to quiz...`);
          sseService.streamQuestionProgress(sessionId, questionId, {
            status: 'adding-to-quiz',
            message: 'Adding question to quiz...'
          });
          
          // Add timeout for addQuestion operation
          const addPromise = quiz.addQuestion(savedQuestion._id);
          const addTimeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Add to quiz timeout after 30s')), DB_SAVE_TIMEOUT)
          );
          
          await Promise.race([addPromise, addTimeoutPromise]);
          console.log(`[${questionId}] Question added to quiz successfully`);
          sseService.streamQuestionProgress(sessionId, questionId, {
            status: 'added-to-quiz',
            message: 'Question added to quiz successfully'
          });
        } catch (saveError) {
          console.error(`[${questionId}] ERROR saving question:`, saveError.message);
          saveError.errorType = saveError.errorType || 'database-error';
          saveError.message = `Failed to save question: ${saveError.message}`;
          throw saveError;
        }

        // Only notify completion if save was successful
        if (savedQuestion) {
          console.log(`[${questionId}] Sending question-complete SSE event...`);
          sseService.streamQuestionProgress(sessionId, questionId, {
            status: 'sending-complete',
            message: 'Sending question-complete event...'
          });
          
          // Notify completion with the saved question
          const sent = sseService.notifyQuestionComplete(sessionId, questionId, {
            _id: savedQuestion._id,
            questionText: savedQuestion.questionText,
            type: savedQuestion.type,
            options: savedQuestion.options,
            correctAnswer: savedQuestion.correctAnswer,
            explanation: savedQuestion.explanation,
            content: savedQuestion.content,
            difficulty: savedQuestion.difficulty,
            streamingGenerated: true
          });

          console.log(`[${questionId}] question-complete sent: ${sent}`);
          sseService.streamQuestionProgress(sessionId, questionId, {
            status: 'complete-sent',
            message: `question-complete sent: ${sent}`
          });
          
          return savedQuestion;
        } else {
          throw new Error('Question save failed - savedQuestion is undefined');
        }
        
      } else {
        throw new Error('LLM generation failed');
      }
      
    } catch (error) {
      console.error(`❌ Streaming generation failed for question ${questionId}:`, error);
      throw error;
    }
  }

  /**
   * Simulate streaming generation (placeholder)
   * Will be replaced with actual LLM streaming in next task
   */
  async simulateStreamingGeneration(sessionId, questionId, questionConfig) {
    const sampleTexts = [
      "Generating question based on learning objective...",
      "Analyzing course materials for relevant content...",
      "Creating question structure...",
      "Formulating answer options...",
      "Adding detailed explanations...",
      "Finalizing question format..."
    ];

    for (let i = 0; i < sampleTexts.length; i++) {
      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Stream progress update
      sseService.streamTextChunk(sessionId, questionId, sampleTexts[i], {
        step: i + 1,
        totalSteps: sampleTexts.length,
        progress: Math.round(((i + 1) / sampleTexts.length) * 100)
      });
    }

    // Simulate final question creation
    const mockQuestion = {
      questionText: `Sample ${questionConfig.questionType} question about the learning objective`,
      type: questionConfig.questionType,
      options: questionConfig.questionType === 'multiple-choice' ? [
        { text: "Option A", isCorrect: true },
        { text: "Option B", isCorrect: false },
        { text: "Option C", isCorrect: false },
        { text: "Option D", isCorrect: false }
      ] : [],
      correctAnswer: "Option A",
      explanation: "This is the explanation for the correct answer."
    };

    // Notify completion
    sseService.notifyQuestionComplete(sessionId, questionId, mockQuestion);
  }
}

// Create singleton instance
const questionStreamingService = new QuestionStreamingService();

export default questionStreamingService;
