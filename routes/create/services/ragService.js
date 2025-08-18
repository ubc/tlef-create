/**
 * RAG Service for Quiz Material Retrieval
 * Uses UBC GenAI Toolkit RAG module to retrieve relevant content from quiz materials
 */

import { RAGModule } from 'ubc-genai-toolkit-rag';
import { EmbeddingsModule } from 'ubc-genai-toolkit-embeddings';
import { DocumentParsingModule } from 'ubc-genai-toolkit-document-parsing';
import { ConsoleLogger } from 'ubc-genai-toolkit-core';
import Material from '../models/Material.js';
import fs from 'fs/promises';
import path from 'path';

class QuizRAGService {
  constructor() {
    // Use the proper UBC GenAI Toolkit logger
    this.logger = new ConsoleLogger('RAG');
    
    this.initializeAsync();
  }

  async initializeAsync() {
    try {
      console.log('🚀 Initializing QuizRAGService...');
      
      // Initialize embeddings module using the static create method
      console.log('📊 Initializing EmbeddingsModule...');
      this.embeddings = await EmbeddingsModule.create({
        providerType: 'fastembed',
        model: 'sentence-transformers/all-MiniLM-L6-v2',
        logger: this.logger
      });
      console.log('✅ EmbeddingsModule initialized');

      // Initialize document parser
      console.log('📄 Initializing DocumentParsingModule...');
      this.documentParser = new DocumentParsingModule({
        logger: this.logger,
        debug: true
      });
      console.log('✅ DocumentParsingModule initialized');

      // Initialize RAG module
      console.log('🔍 Initializing RAGModule...');
      const qdrantConfig = {
        url: process.env.QDRANT_URL || 'http://localhost:6333',
        collectionName: 'quiz-materials'
      };
      
      // Add API key if available
      if (process.env.QDRANT_API_KEY) {
        qdrantConfig.apiKey = process.env.QDRANT_API_KEY;
        console.log('🔑 Using Qdrant API key from environment');
      }
      
      this.ragModule = new RAGModule({
        provider: 'qdrant',
        qdrantConfig: {
          ...qdrantConfig,
          vectorSize: 384, // Size for fast-bge-small-en-v1.5 embeddings
          distanceMetric: 'Cosine'
        },
        embeddingsConfig: {
          providerType: 'fastembed',
          model: 'sentence-transformers/all-MiniLM-L6-v2',
          logger: this.logger
        },
        logger: this.logger
      });
      console.log('✅ RAGModule initialized');

      console.log('✅ QuizRAGService initialized with UBC GenAI Toolkit');
    } catch (error) {
      console.error('❌ Failed to initialize QuizRAGService:', error.message);
      console.error('❌ Error details:', error);
      console.error('💡 RAG features will be disabled. Ensure Qdrant is running and dependencies are installed.');
      // Initialize with null services to prevent crashes
      this.embeddings = null;
      this.documentParser = null;
      this.ragModule = null;
    }
  }

  /**
   * Process and index quiz materials for RAG retrieval
   */
  async indexQuizMaterials(quizId, materialIds) {
    console.log(`🔍 Indexing materials for quiz ${quizId}...`);
    
    if (!this.ragModule || !this.embeddings || !this.documentParser) {
      console.log('⚠️ RAG services not available - skipping indexing');
      return {
        success: false,
        error: 'RAG services not initialized',
        documentsIndexed: 0,
        materialsProcessed: 0
      };
    }
    
    try {
      const materials = await Material.find({ 
        _id: { $in: materialIds },
        processingStatus: 'completed'
      });

      console.log(`📚 Found ${materials.length} processed materials to index`);

      const documents = [];
      
      for (const material of materials) {
        console.log(`📄 Processing material: ${material.name}`);
        
        let content = '';
        
        if (material.type === 'text') {
          content = material.content;
        } else if (material.type === 'url') {
          // For URL materials, we'd need to fetch and parse the content
          // For now, use any stored content
          content = material.content || 'URL content not available';
        } else if (material.filePath && (material.type === 'pdf' || material.type === 'docx')) {
          // Parse documents using UBC toolkit
          try {
            const parseResult = await this.documentParser.parse(
              { filePath: material.filePath },
              'text'
            );
            content = parseResult.content;
            console.log(`✅ Parsed ${material.type} file: ${content.length} characters`);
          } catch (parseError) {
            console.error(`❌ Failed to parse ${material.name}:`, parseError.message);
            continue;
          }
        }

        if (content && content.trim().length > 0) {
          // Split content into chunks for better retrieval
          const chunks = this.chunkContent(content, material);
          
          for (const [index, chunk] of chunks.entries()) {
            documents.push({
              pageContent: chunk.content,
              metadata: {
                materialId: material._id.toString(),
                materialName: material.name,
                materialType: material.type,
                quizId: quizId,
                chunkIndex: index,
                totalChunks: chunks.length,
                section: chunk.section || 'main',
                sourceFile: material.originalFileName || material.name
              }
            });
          }
        }
      }

      console.log(`📊 Created ${documents.length} document chunks for indexing`);

      if (documents.length > 0) {
        // Add documents to RAG vector store
        await this.ragModule.addDocuments(documents, this.embeddings);
        console.log(`✅ Successfully indexed ${documents.length} chunks in RAG system`);
        
        return {
          success: true,
          documentsIndexed: documents.length,
          materialsProcessed: materials.length
        };
      } else {
        console.log('⚠️ No content available for indexing');
        return {
          success: false,
          error: 'No content available for indexing',
          documentsIndexed: 0,
          materialsProcessed: materials.length
        };
      }

    } catch (error) {
      console.error('❌ Error indexing quiz materials:', error);
      throw error;
    }
  }

  /**
   * Retrieve relevant content chunks for question generation
   */
  async retrieveRelevantContent(learningObjective, questionType, options = {}) {
    const { 
      topK = 5, 
      quizId = null,
      minScore = 0.3 
    } = options;

    console.log(`🔍 Retrieving content for LO: "${learningObjective.substring(0, 50)}..."`);
    console.log(`❓ Question type: ${questionType}, Top-K: ${topK}`);

    if (!this.ragModule || !this.embeddings) {
      console.log('⚠️ RAG services not available - returning empty results');
      return {
        query: this.buildSearchQuery(learningObjective, questionType),
        chunks: [],
        totalResults: 0,
        filteredResults: 0
      };
    }

    try {
      // Create search query combining learning objective and question type context
      const searchQuery = this.buildSearchQuery(learningObjective, questionType);
      console.log(`🔎 Search query: "${searchQuery}"`);

      // Query RAG system
      const results = await this.ragModule.query(searchQuery, this.embeddings, {
        topK: topK * 2, // Get more results to filter by quiz if needed
        filter: quizId ? { quizId: quizId } : undefined
      });

      console.log(`📊 RAG returned ${results.length} results`);

      // Filter and process results
      const relevantChunks = results
        .filter(result => result.score >= minScore)
        .slice(0, topK)
        .map(result => ({
          content: result.pageContent,
          score: result.score,
          metadata: result.metadata,
          source: `${result.metadata?.materialName || 'Unknown'} (${result.metadata?.materialType || 'unknown'})`
        }));

      console.log(`✅ Retrieved ${relevantChunks.length} relevant chunks (min score: ${minScore})`);
      
      relevantChunks.forEach((chunk, index) => {
        console.log(`  ${index + 1}. ${chunk.source} (score: ${chunk.score.toFixed(3)})`);
        console.log(`     ${chunk.content.substring(0, 100)}...`);
      });

      return {
        query: searchQuery,
        chunks: relevantChunks,
        totalResults: results.length,
        filteredResults: relevantChunks.length
      };

    } catch (error) {
      console.error('❌ Error retrieving content from RAG:', error);
      throw error;
    }
  }

  /**
   * Get all materials indexed for a specific quiz
   */
  async getQuizMaterialsInfo(quizId) {
    try {
      // Query with quiz filter to get all chunks for this quiz
      const results = await this.ragModule.query('*', this.embeddings, {
        topK: 1000, // Large number to get all
        filter: { quizId: quizId }
      });

      const materialsMap = new Map();
      
      results.forEach(result => {
        const materialId = result.metadata?.materialId;
        if (materialId) {
          if (!materialsMap.has(materialId)) {
            materialsMap.set(materialId, {
              materialId,
              materialName: result.metadata?.materialName,
              materialType: result.metadata?.materialType,
              chunks: 0,
              totalContent: 0
            });
          }
          const material = materialsMap.get(materialId);
          material.chunks++;
          material.totalContent += result.pageContent.length;
        }
      });

      return {
        quizId,
        totalChunks: results.length,
        materials: Array.from(materialsMap.values())
      };

    } catch (error) {
      console.error('❌ Error getting quiz materials info:', error);
      throw error;
    }
  }

  /**
   * Build search query for RAG retrieval
   */
  buildSearchQuery(learningObjective, questionType) {
    // Create a focused search query that combines the learning objective
    // with question-type specific keywords to retrieve relevant content
    
    const questionTypeKeywords = {
      'multiple-choice': 'concepts, definitions, examples, comparisons, applications',
      'true-false': 'facts, statements, principles, rules, claims',
      'flashcard': 'key terms, definitions, important facts, concepts',
      'summary': 'main ideas, key points, overview, important concepts',
      'discussion': 'analysis, interpretation, critical thinking, perspectives',
      'matching': 'relationships, connections, pairs, associations',
      'ordering': 'sequences, processes, steps, chronology',
      'cloze': 'specific terms, key words, important details'
    };

    const keywords = questionTypeKeywords[questionType] || 'concepts, examples, applications';
    
    return `${learningObjective} ${keywords}`;
  }

  /**
   * Chunk content into manageable pieces for RAG indexing
   */
  chunkContent(content, material) {
    const chunks = [];
    const maxChunkSize = 512; // Characters per chunk
    // const overlapSize = 50;   // Overlap between chunks (unused for now)
    
    // Simple chunking strategy - can be enhanced with semantic chunking
    if (content.length <= maxChunkSize) {
      chunks.push({
        content: content.trim(),
        section: 'complete'
      });
    } else {
      // Split by paragraphs first, then by sentences if needed
      const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0);
      let currentChunk = '';
      let chunkIndex = 0;
      
      for (const paragraph of paragraphs) {
        if (currentChunk.length + paragraph.length <= maxChunkSize) {
          currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
        } else {
          if (currentChunk) {
            chunks.push({
              content: currentChunk.trim(),
              section: `chunk_${chunkIndex++}`
            });
          }
          
          // Handle long paragraphs by splitting them
          if (paragraph.length > maxChunkSize) {
            const sentences = paragraph.split(/[.!?]+/).filter(s => s.trim().length > 0);
            currentChunk = '';
            
            for (const sentence of sentences) {
              if (currentChunk.length + sentence.length <= maxChunkSize) {
                currentChunk += (currentChunk ? '. ' : '') + sentence.trim();
              } else {
                if (currentChunk) {
                  chunks.push({
                    content: currentChunk.trim() + '.',
                    section: `chunk_${chunkIndex++}`
                  });
                }
                currentChunk = sentence.trim();
              }
            }
          } else {
            currentChunk = paragraph;
          }
        }
      }
      
      // Add final chunk
      if (currentChunk.trim()) {
        chunks.push({
          content: currentChunk.trim(),
          section: `chunk_${chunkIndex}`
        });
      }
    }
    
    console.log(`📝 Chunked "${material.name}" into ${chunks.length} pieces`);
    return chunks;
  }

  /**
   * Clean up RAG data for a quiz (when quiz is deleted)
   */
  async cleanupQuizData(quizId) {
    try {
      console.log(`🧹 Cleaning up RAG data for quiz ${quizId}`);
      
      // Note: This would require implementing a delete by filter method in the RAG module
      // For now, we log the cleanup request
      console.log(`⚠️ RAG cleanup for quiz ${quizId} logged - manual cleanup may be required`);
      
      return { success: true, message: 'Cleanup requested' };
    } catch (error) {
      console.error('❌ Error cleaning up RAG data:', error);
      throw error;
    }
  }
}

// Export singleton instance
const ragService = new QuizRAGService();
export default ragService;