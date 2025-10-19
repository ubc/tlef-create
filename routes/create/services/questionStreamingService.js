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
          // Stream the text chunk to the client
          console.log(`📤 Sending text chunk to SSE for ${questionId}: "${textChunk.substring(0, 50)}..."`);
          const sent = sseService.streamTextChunk(sessionId, questionId, textChunk, {
            totalLength: metadata.totalLength,
            isPartial: true,
            timestamp: new Date().toISOString()
          });
          console.log(`📡 SSE send result: ${sent}`);
        } else if (metadata.completed) {
          // Generation completed
          console.log(`🌊 Streaming completed for ${questionId}, total length: ${metadata.totalLength}`);
        }
      };

      // Use real LLM streaming generation
      const result = await llmService.generateQuestionStreaming({
        learningObjective: learningObjective.text || learningObjective,
        questionType: questionConfig.questionType,
        relevantContent: relevantContent || [],
        difficulty: questionConfig.difficulty || 'moderate',
        courseContext: questionConfig.courseContext || '',
        previousQuestions: questionConfig.previousQuestions || [],
        customPrompt: questionConfig.customPrompt
      }, onStreamChunk);

      if (result.success) {
        // Save question to database
        const Question = (await import('../models/Question.js')).default;
        const Quiz = (await import('../models/Quiz.js')).default;
        
        // Get current question count for proper ordering
        const existingQuestionsCount = await Question.countDocuments({ quiz: quizId });
        
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
          options: result.questionData.options || [],
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
          savedQuestion = await newQuestion.save();
          console.log(`💾 Saved streaming question to database: ${savedQuestion._id}`);
          console.log(`🔍 DEBUG - Saved question with learningObjective:`, savedQuestion.learningObjective);

          // Add question to quiz using the proper method (like in main branch)
          const quiz = await Quiz.findById(quizId);
          console.log(`🔍 DEBUG - Quiz before addQuestion:`, {
            id: quiz._id,
            questionCount: quiz.questions?.length,
            questions: quiz.questions
          });

          const addResult = await quiz.addQuestion(savedQuestion._id);
          console.log(`📊 Added question to quiz ${quizId} using addQuestion method`);
          console.log(`🔍 DEBUG - addQuestion result:`, addResult);

          // Verify the question was added
          const updatedQuiz = await Quiz.findById(quizId);
          console.log(`🔍 DEBUG - Quiz after addQuestion:`, {
            id: updatedQuiz._id,
            questionCount: updatedQuiz.questions?.length,
            questions: updatedQuiz.questions
          });
        } catch (saveError) {
          console.error(`❌ ERROR saving question or adding to quiz:`, saveError);
          // Notify error via SSE
          sseService.emitError(sessionId, questionId, `Failed to save question: ${saveError.message}`, 'database-error');
          throw saveError;
        }

        // Only notify completion if save was successful
        if (savedQuestion) {
          // Notify completion with the saved question
          sseService.notifyQuestionComplete(sessionId, questionId, {
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

          console.log(`✅ Completed streaming generation for question: ${questionId}`);
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