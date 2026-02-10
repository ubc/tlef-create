/**
 * Question Streaming Service
 * Handles streaming question generation with real-time updates
 */

import sseService from './sseService.js';
import llmService from './llmService.js';

class QuestionStreamingService {
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
      // Send diagnostic info to frontend
      sseService.streamQuestionProgress(sessionId, questionId, {
        status: 'diagnostic',
        llmProvider: process.env.LLM_PROVIDER || 'not set',
        llmModel: process.env.OPENAI_MODEL || process.env.OLLAMA_MODEL || 'not set',
        environment: process.env.NODE_ENV
      });

      // Notify start of question generation
      sseService.streamQuestionProgress(sessionId, questionId, {
        status: 'started',
        type: questionConfig.questionType,
        learningObjective: learningObjective.text || learningObjective
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
      
      const result = await llmService.generateQuestionStreaming({
        learningObjective: learningObjective.text || learningObjective,
        questionType: questionConfig.questionType,
        relevantContent: relevantContent || [],
        difficulty: questionConfig.difficulty || 'moderate',
        courseContext: questionConfig.courseContext || '',
        previousQuestions: questionConfig.previousQuestions || [],
        customPrompt: questionConfig.customPrompt
      }, onStreamChunk);
      
      console.log(`[${questionId}] LLM returned, success=${result.success}`);
      sseService.streamQuestionProgress(sessionId, questionId, {
        status: 'llm-complete',
        message: `LLM returned, success=${result.success}`
      });

      if (result.success) {
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
          const loText = typeof lo === 'string' ? lo : lo.text || 'learning objective';
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
        const focusArea = extractFocusArea(subObjective);
        const complexity = determineComplexity(subObjective, questionType);

        const newQuestion = new Question({
          quiz: quizId,
          type: result.questionData.type,
          questionText: result.questionData.questionText,
          correctAnswer: result.questionData.correctAnswer,
          explanation: result.questionData.explanation,
          content: result.questionData.content || {},
          difficulty: result.questionData.difficulty,
          learningObjective: learningObjective._id || learningObjective,
          order: existingQuestionsCount, // Proper ordering
          reviewStatus: 'pending',
          createdBy: userId, // Add the required createdBy field
          generationMetadata: {
            llmModel: 'gpt-4o-mini',
            generationPrompt: result.promptUsed || result.questionData.prompt,
            subObjective: subObjective,
            generationMethod: 'AI-streaming-generation',
            focusArea: focusArea,
            complexity: complexity,
            confidence: 0.9,
            processingTime: result.metadata?.processingTime || 2000,
            streamingGenerated: true,
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
          
          savedQuestion = await newQuestion.save();
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
          
          await quiz.addQuestion(savedQuestion._id);
          console.log(`[${questionId}] Question added to quiz successfully`);
          sseService.streamQuestionProgress(sessionId, questionId, {
            status: 'added-to-quiz',
            message: 'Question added to quiz successfully'
          });
        } catch (saveError) {
          console.error(`[${questionId}] ERROR saving question:`, saveError.message);
          sseService.emitError(sessionId, questionId, `Failed to save question: ${saveError.message}`, 'database-error');
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
      sseService.emitError(sessionId, questionId, error.message);
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