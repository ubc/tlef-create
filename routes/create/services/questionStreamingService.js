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
    sessionId
  }) {
    console.log(`🎯 Starting streaming generation for question: ${questionId}`);
    
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
          order: 0, // Will be set properly later
          reviewStatus: 'pending',
          metadata: result.questionData.generationMetadata
        });

        const savedQuestion = await newQuestion.save();
        console.log(`💾 Saved streaming question to database: ${savedQuestion._id}`);

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