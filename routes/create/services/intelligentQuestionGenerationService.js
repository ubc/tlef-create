/**
 * Intelligent Question Generation Service
 * Combines RAG (material retrieval) + LLM (question generation) for high-quality quiz questions
 */

import ragService from './ragService.js';
import llmService from './llmService.js';
import Quiz from '../models/Quiz.js';
import Material from '../models/Material.js';
import LearningObjective from '../models/LearningObjective.js';

class IntelligentQuestionGenerationService {
  constructor() {
    console.log('🧠 Intelligent Question Generation Service initialized');
  }

  /**
   * Generate questions for a quiz using RAG + LLM
   */
  async generateQuestionsForQuiz(quizId, generationConfig, userPreferences = null) {
    console.log(`🎯 Starting intelligent question generation for quiz ${quizId}`);
    
    try {
      // Step 1: Load quiz data and materials
      const quizData = await this.loadQuizData(quizId);
      console.log(`📚 Loaded quiz: ${quizData.quiz.name}`);
      console.log(`📝 Learning objectives: ${quizData.learningObjectives.length}`);
      console.log(`📄 Materials: ${quizData.materials.length}`);

      // Step 2: Verify materials are already processed and embedded
      const processedMaterials = quizData.materials.filter(m => m.processingStatus === 'completed');
      console.log(`📊 Materials status: ${processedMaterials.length}/${quizData.materials.length} processed and embedded`);
      
      if (processedMaterials.length === 0) {
        console.log('⚠️ No processed materials found for RAG retrieval');
      }

      // Step 3: Generate questions for each learning objective
      const allQuestions = [];
      const generationErrors = [];
      
      for (const [index, learningObjective] of quizData.learningObjectives.entries()) {
        console.log(`\n📝 Processing LO ${index + 1}/${quizData.learningObjectives.length}`);
        console.log(`Target: ${learningObjective.text.substring(0, 100)}...`);

        try {
          // Get question types and counts for this LO from generation plan
          const questionConfigs = this.getQuestionConfigsForLO(
            learningObjective, 
            quizData.generationPlan,
            generationConfig
          );

          if (!questionConfigs || !Array.isArray(questionConfigs) || questionConfigs.length === 0) {
            console.error(`❌ Failed to get question configs for LO:`, learningObjective._id);
            console.error(`❌ questionConfigs result:`, questionConfigs);
            console.error(`❌ generationPlan:`, quizData.generationPlan);
            throw new Error(`Failed to get question configs for learning objective: ${learningObjective._id}`);
          }

          console.log(`❓ Question types for this LO:`, 
            questionConfigs.map(c => `${c.count}x ${c.questionType}`).join(', '));

          // Retrieve relevant content from RAG using processed materials
          const materialIds = processedMaterials.map(m => m._id.toString());
          const relevantContent = await ragService.retrieveRelevantContent(
            learningObjective.text,
            questionConfigs[0]?.questionType || 'multiple-choice',
            {
              topK: 5,
              materialIds: materialIds, // Filter by specific materials
              minScore: 0.3
            }
          );

          // Handle different formats of relevantContent response
          const chunks = relevantContent?.chunks || (Array.isArray(relevantContent) ? relevantContent : []);
          console.log(`📊 Retrieved ${chunks.length} relevant content chunks`);

          // Generate questions using LLM with user preferences
          const batchResult = await llmService.generateQuestionBatch({
            learningObjective: learningObjective.text,
            questionConfigs: questionConfigs,
            relevantContent: chunks, // Use the safely extracted chunks
            difficulty: generationConfig.difficulty || 'moderate',
            courseContext: this.buildCourseContext(quizData)
          }, userPreferences);

          console.log(`✅ Generated ${batchResult.totalGenerated}/${batchResult.totalRequested} questions`);

          // Add learning objective ID to questions
          batchResult.questions.forEach(question => {
            question.learningObjectiveId = learningObjective._id;
            question.learningObjectiveText = learningObjective.text;
          });

          allQuestions.push(...batchResult.questions);
          
          if (batchResult.errors.length > 0) {
            generationErrors.push(...batchResult.errors.map(error => ({
              ...error,
              learningObjective: learningObjective.text
            })));
          }

        } catch (error) {
          console.error(`❌ Failed to generate questions for LO ${index + 1}:`, error.message);
          generationErrors.push({
            learningObjective: learningObjective.text,
            error: error.message
          });
        }
      }

      console.log(`\n🎉 Question generation completed!`);
      console.log(`✅ Total questions generated: ${allQuestions.length}`);
      console.log(`❌ Total errors: ${generationErrors.length}`);

      return {
        success: true,
        questions: allQuestions,
        errors: generationErrors,
        metadata: {
          quizId: quizId,
          totalLearningObjectives: quizData.learningObjectives.length,
          totalMaterials: quizData.materials.length,
          questionsGenerated: allQuestions.length,
          generationMethod: 'intelligent-rag-llm',
          ragEnabled: quizData.materials.length > 0,
          courseContext: this.buildCourseContext(quizData)
        }
      };

    } catch (error) {
      console.error('❌ Intelligent question generation failed:', error);
      return {
        success: false,
        error: error.message,
        questions: [],
        errors: [{ error: error.message }]
      };
    }
  }

  /**
   * Load all quiz data needed for generation
   */
  async loadQuizData(quizId) {
    const quiz = await Quiz.findById(quizId)
      .populate('materials')
      .populate('learningObjectives')
      .populate('activePlan');

    if (!quiz) {
      throw new Error(`Quiz ${quizId} not found`);
    }

    // Get processed materials only
    const materials = quiz.materials.filter(material => 
      material.processingStatus === 'completed'
    );

    return {
      quiz: quiz,
      learningObjectives: quiz.learningObjectives || [],
      materials: materials,
      generationPlan: quiz.activePlan
    };
  }

  /**
   * Get question configurations for a learning objective based on generation plan
   */
  getQuestionConfigsForLO(learningObjective, generationPlan, generationConfig) {
    // If we have a generation plan, use it
    if (generationPlan && generationPlan.breakdown) {
      const breakdown = generationPlan.breakdown.find(
        item => item.learningObjective.toString() === learningObjective._id.toString()
      );
      
      if (breakdown && breakdown.questionTypes && Array.isArray(breakdown.questionTypes) && breakdown.questionTypes.length > 0) {
        const configs = breakdown.questionTypes.map(qt => ({
          questionType: qt.type,
          count: qt.count || 1
        }));
        return configs.filter(config => config.count > 0); // Remove zero-count items
      }
    }

    // Fallback to generation config or defaults
    let fallbackConfig = null;
    
    if (generationConfig?.questionTypes && Array.isArray(generationConfig.questionTypes) && generationConfig.questionTypes.length > 0) {
      fallbackConfig = generationConfig.questionTypes;
    } else {
      // Robust fallback that includes all question types
      fallbackConfig = [
        { type: 'multiple-choice', count: 1 },
        { type: 'true-false', count: 1 },
        { type: 'flashcard', count: 1 },
        { type: 'discussion', count: 1 },
        { type: 'summary', count: 1 }
      ];
    }

    const result = fallbackConfig.map(config => ({
      questionType: config.type,
      count: config.count || 1
    })).filter(config => config.count > 0); // Remove zero-count items
    
    return result;
  }

  /**
   * Build course context string from quiz data
   */
  buildCourseContext(quizData) {
    const context = [];
    
    if (quizData.quiz.name) {
      context.push(`Quiz: ${quizData.quiz.name}`);
    }
    
    if (quizData.materials && quizData.materials.length > 0) {
      const materialTypes = [...new Set(quizData.materials.map(m => m.type))];
      context.push(`Materials: ${materialTypes.join(', ')}`);
      
      const materialNames = quizData.materials.slice(0, 3).map(m => m.name);
      if (materialNames.length > 0) {
        context.push(`Sources: ${materialNames.join(', ')}${quizData.materials.length > 3 ? ' and others' : ''}`);
      }
    }

    return context.join(' | ');
  }

  /**
   * Regenerate a single question with improved context
   */
  async regenerateQuestion(questionId, options = {}) {
    console.log(`🔄 Regenerating question ${questionId}`);
    
    try {
      // This would require implementing question lookup and regeneration
      // For now, return a placeholder
      throw new Error('Question regeneration not yet implemented');
      
    } catch (error) {
      console.error('❌ Question regeneration failed:', error);
      throw error;
    }
  }

  /**
   * Test the complete pipeline
   */
  async testPipeline(quizId) {
    console.log(`🧪 Testing RAG + LLM pipeline for quiz ${quizId}`);
    
    try {
      // Test RAG connection
      console.log('1. Testing RAG system...');
      const quizMaterialsInfo = await ragService.getQuizMaterialsInfo(quizId);
      console.log(`✅ RAG test: ${quizMaterialsInfo.totalChunks} chunks indexed`);

      // Test LLM connection
      console.log('2. Testing LLM connection...');
      const llmTest = await llmService.testConnection();
      if (!llmTest.success) {
        throw new Error(`LLM connection failed: ${llmTest.error}`);
      }
      console.log(`✅ LLM test: Connected to ${llmTest.model}`);

      // Test content retrieval
      console.log('3. Testing content retrieval...');
      const testQuery = "test learning objective";
      const retrievalTest = await ragService.retrieveRelevantContent(testQuery, 'multiple-choice', {
        topK: 2,
        quizId: quizId
      });
      console.log(`✅ RAG retrieval test: ${retrievalTest.chunks.length} chunks retrieved`);

      return {
        success: true,
        ragStatus: 'connected',
        llmStatus: 'connected',
        ragChunks: quizMaterialsInfo.totalChunks,
        llmModel: llmTest.model
      };

    } catch (error) {
      console.error('❌ Pipeline test failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get generation statistics
   */
  async getGenerationStats(quizId) {
    try {
      const materialInfo = await ragService.getQuizMaterialsInfo(quizId);
      const llmTest = await llmService.testConnection();
      
      return {
        quizId: quizId,
        ragEnabled: materialInfo.totalChunks > 0,
        llmEnabled: llmTest.success,
        totalContentChunks: materialInfo.totalChunks,
        materialsIndexed: materialInfo.materials.length,
        llmModel: llmTest.model || 'disconnected',
        generationMethod: 'intelligent-rag-llm'
      };
    } catch (error) {
      console.error('❌ Failed to get generation stats:', error);
      return {
        quizId: quizId,
        ragEnabled: false,
        llmEnabled: false,
        error: error.message
      };
    }
  }
}

// Export singleton instance
const intelligentQuestionGenerationService = new IntelligentQuestionGenerationService();
export default intelligentQuestionGenerationService;