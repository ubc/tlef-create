/**
 * RAG Service for Quiz Material Retrieval
 * Uses UBC GenAI Toolkit RAG module to retrieve relevant content from quiz materials
 */

import { RAGModule } from 'ubc-genai-toolkit-rag';
import { EmbeddingsModule } from 'ubc-genai-toolkit-embeddings';
import { DocumentParsingModule } from 'ubc-genai-toolkit-document-parsing';
import { ConsoleLogger } from 'ubc-genai-toolkit-core';
import Material from '../models/Material.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Vector Format Conversion Utilities
 * Fixes Float32Array iterator issues from UBC GenAI Toolkit FastEmbed embeddings
 */

/**
 * Convert FastEmbed Float32Array embedding to plain JavaScript array
 * @param {any} embedding - FastEmbed embedding (could be Float32Array, regular array, etc.)
 * @returns {number[]} Plain JavaScript array of numbers
 */
function convertEmbeddingToArray(embedding) {
  // Already a regular array
  if (Array.isArray(embedding)) {
    return embedding;
  }
  
  // Handle Float32Array with values() method
  if (embedding && typeof embedding === 'object' && 'values' in embedding) {
    const values = embedding.values;
    if (typeof values === 'function') {
      try {
        // Call values() with proper context to get iterator
        const iterator = values.call(embedding);
        // Convert iterator to array
        if (iterator && typeof iterator === 'object' && typeof iterator[Symbol.iterator] === 'function') {
          return Array.from(iterator);
        }
      } catch (error) {
        console.warn('Failed to convert embedding via values() method:', error.message);
        // Fallback to direct Array.from conversion
      }
    }
  }
  
  // Fallback: direct conversion (works for typed arrays)
  try {
    return Array.from(embedding);
  } catch (error) {
    console.error('Failed to convert embedding to array:', error.message);
    return [];
  }
}

/**
 * Convert array of FastEmbed embeddings to plain JavaScript arrays
 * @param {any[]} embeddings - Array of FastEmbed embeddings
 * @returns {number[][]} Array of plain JavaScript number arrays
 */
function convertEmbeddingsToArrays(embeddings) {
  return embeddings.map(convertEmbeddingToArray);
}

/**
 * Wrapper for RAGModule that fixes vector format issues
 * Intercepts embedding operations and converts Float32Array to plain arrays
 */
class FixedRAGModule {
  constructor(originalRAGModule) {
    this.originalRAGModule = originalRAGModule;
    
    // Proxy all methods and properties to the original module
    return new Proxy(this, {
      get(target, prop) {
        if (prop in target) {
          return target[prop];
        }
        return target.originalRAGModule[prop];
      }
    });
  }

  /**
   * Override addDocument to fix embedding format issues
   */
  async addDocument(content, metadata) {
    try {
      // Call original addDocument method
      const result = await this.originalRAGModule.addDocument(content, metadata);
      return result;
    } catch (error) {
      // If we get "this is not a typed array" error, it's likely in the embedding processing
      if (error.message && error.message.includes('not a typed array')) {
        console.warn('🔧 Detected vector format issue in addDocument, applying fix...');
        
        // This is a bit tricky since the error happens deep inside the UBC toolkit
        // We need to monkey-patch the embeddings module temporarily
        const originalEmbed = this.originalRAGModule.embeddingsModule?.embed;
        if (originalEmbed) {
          // Temporarily override the embed method
          this.originalRAGModule.embeddingsModule.embed = async function(texts) {
            const results = await originalEmbed.call(this, texts);
            return convertEmbeddingsToArrays(results);
          };
          
          try {
            // Retry with fixed embeddings
            const result = await this.originalRAGModule.addDocument(content, metadata);
            return result;
          } finally {
            // Restore original method
            this.originalRAGModule.embeddingsModule.embed = originalEmbed;
          }
        }
      }
      throw error;
    }
  }

  /**
   * Override retrieveContext to fix embedding format issues
   */
  async retrieveContext(queryText, options = {}) {
    try {
      return await this.originalRAGModule.retrieveContext(queryText, options);
    } catch (error) {
      if (error.message && error.message.includes('not a typed array')) {
        console.warn('🔧 Detected vector format issue in retrieveContext, applying fix...');
        
        const originalEmbed = this.originalRAGModule.embeddingsModule?.embed;
        if (originalEmbed) {
          this.originalRAGModule.embeddingsModule.embed = async function(texts) {
            const results = await originalEmbed.call(this, texts);
            return convertEmbeddingsToArrays(results);
          };
          
          try {
            return await this.originalRAGModule.retrieveContext(queryText, options);
          } finally {
            this.originalRAGModule.embeddingsModule.embed = originalEmbed;
          }
        }
      }
      throw error;
    }
  }
}

class QuizRAGService {
  constructor() {
    // Use the proper UBC GenAI Toolkit logger
    this.logger = new ConsoleLogger('RAG');
    this.isInitialized = false;
    
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
        console.log('🔑 Using Qdrant API key from environment:', process.env.QDRANT_API_KEY);
        console.log('🔧 Final qdrantConfig:', JSON.stringify(qdrantConfig, null, 2));
      } else {
        console.log('❌ No QDRANT_API_KEY found in environment');
        console.log('🔍 Available env vars:', Object.keys(process.env).filter(k => k.includes('QDRANT')));
      }
      
      // Create RAG module instance using static create method
      const originalRagModule = await RAGModule.create({
        provider: 'qdrant',
        qdrantConfig: {
          ...qdrantConfig,
          vectorSize: 384, // Correct size for fast-bge-small-en-v1.5 embeddings
          distanceMetric: 'Cosine'
        },
        embeddingsConfig: {
          providerType: 'fastembed',
          model: 'fast-bge-small-en-v1.5',
          logger: this.logger
        },
        logger: this.logger
      });
      
      // Apply vector format fix proactively to the embeddings module
      if (originalRagModule.embeddingsModule && originalRagModule.embeddingsModule.embed) {
        const originalEmbed = originalRagModule.embeddingsModule.embed.bind(originalRagModule.embeddingsModule);
        
        originalRagModule.embeddingsModule.embed = async function(texts) {
          console.log('🔧 Applying proactive vector format conversion...');
          const results = await originalEmbed(texts);
          const convertedResults = convertEmbeddingsToArrays(results);
          console.log(`✅ Converted ${convertedResults.length} embeddings from FastEmbed format to plain arrays`);
          return convertedResults;
        };
        
        console.log('🔧 Proactive vector format conversion applied to embeddings module');
      }
      
      // Wrap with our vector format fixer (as additional safety)
      this.ragModule = new FixedRAGModule(originalRagModule);
      
      console.log('✅ RAGModule initialized with vector format fixes');
      console.log('🔧 Available RAG methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(originalRagModule)));

      this.isInitialized = true;
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
   * @deprecated This method is no longer used. Materials are now processed immediately upon upload.
   * Use processAndEmbedMaterial() during upload instead.
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
            // Resolve absolute path for document parsing
            const absolutePath = path.isAbsolute(material.filePath) 
              ? material.filePath 
              : path.resolve(__dirname, '../../../', material.filePath);
            
            console.log(`🔍 Parsing file at: ${absolutePath}`);
            const parseResult = await this.documentParser.parse(
              { filePath: absolutePath },
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
        // RAG indexing with fixed UBC GenAI Toolkit
        console.log('📝 Using addDocument method (UBC GenAI Toolkit interface with vector format fix)');
        let successCount = 0;
        
        for (const document of documents) {
          try {
            // UBC GenAI Toolkit addDocument signature: (content: string, metadata?: Record<string, any>)
            const chunkIds = await this.ragModule.addDocument(document.pageContent, document.metadata);
            successCount++;
            console.log(`✅ Added document chunk ${successCount}/${documents.length}: ${chunkIds.length} embeddings created`);
          } catch (addError) {
            console.error(`❌ Failed to add document chunk ${successCount + 1}:`, addError.message);
            // Continue with other documents even if one fails
          }
        }
        
        console.log(`✅ Successfully indexed ${successCount}/${documents.length} chunks in RAG system`);
        
        return {
          success: successCount > 0,
          documentsIndexed: successCount,
          materialsProcessed: materials.length,
          errors: documents.length - successCount
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
      materialIds = [],
      minScore = 0.3 
    } = options;

    console.log(`🔍 Retrieving content for LO: "${learningObjective.substring(0, 50)}..."`);
    console.log(`❓ Question type: ${questionType}, Top-K: ${topK}`);
    if (materialIds.length > 0) {
      console.log(`📋 Filtering by ${materialIds.length} specific materials`);
    }

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

      // Query RAG system - check which method is available
      let results;
      try {
        if (typeof this.ragModule.query === 'function') {
          console.log('🔍 Using query method');
          results = await this.ragModule.query(searchQuery, this.embeddings, {
            topK: topK * 2, // Get more results to filter by quiz if needed
            filter: quizId ? { quizId: quizId } : undefined
          });
        } else if (typeof this.ragModule.retrieveContext === 'function') {
          console.log('🔍 Using retrieveContext method');
          // Since UBC toolkit filters are broken, always search without filter and filter manually
          results = await this.ragModule.retrieveContext(searchQuery, {
            limit: topK * 2, // Use 'limit' instead of 'topK' to match toolkit interface
            scoreThreshold: minScore
          });
          
          console.log(`📊 RAG returned ${results.length} unfiltered results`);
          
          // Filter results by specific material IDs (much more precise than quiz filtering)
          if (materialIds.length > 0 && results && results.length > 0) {
            console.log(`📊 Got ${results.length} total results, filtering by ${materialIds.length} material IDs`);
            
            // Filter by specific material IDs from the quiz
            results = results.filter(result => 
              result.metadata?.materialId && // Must have material ID
              materialIds.includes(result.metadata.materialId) // Must be from one of the quiz materials
            );
            console.log(`📊 Filtered to ${results.length} results from quiz materials`);
          } else if (results && results.length > 0) {
            // Fallback: filter by materials processed through our new system
            results = results.filter(result => 
              result.metadata?.materialId && // Must have material ID
              result.metadata?.processedAt    // Must be from our new processing system
            );
            console.log(`📊 Filtered to ${results.length} results from processed materials (fallback)`);
          }
        } else {
          throw new Error('No suitable method found for querying RAG module');
        }
      } catch (error) {
        console.error('❌ RAG search failed completely:', error.message);
        console.log('🔄 Returning empty results to allow fallback to template generation');
        return {
          query: searchQuery,
          chunks: [],
          totalResults: 0,
          filteredResults: 0,
          error: 'RAG search unavailable'
        };
      }

      console.log(`📊 RAG returned ${results.length} results`);

      // Filter and process results
      const relevantChunks = results
        .filter(result => result.score >= minScore)
        .slice(0, topK)
        .map(result => ({
          content: result.content || result.pageContent, // Try both field names for compatibility
          score: result.score,
          metadata: result.metadata,
          source: `${result.metadata?.materialName || 'Unknown'} (${result.metadata?.materialType || 'unknown'})`
        }));

      console.log(`✅ Retrieved ${relevantChunks.length} relevant chunks (min score: ${minScore})`);
      
      relevantChunks.forEach((chunk, index) => {
        console.log(`  ${index + 1}. ${chunk.source} (score: ${chunk.score.toFixed(3)})`);
        console.log(`     Content preview: ${chunk.content ? chunk.content.substring(0, 100) + '...' : '[No content available]'}`);
        
        // Debug chunk structure if content is missing
        if (!chunk.content) {
          console.log(`     ⚠️  Missing content in chunk ${index + 1}:`, {
            hasContent: !!chunk.content,
            contentType: typeof chunk.content,
            chunkKeys: Object.keys(chunk),
            metadataKeys: chunk.metadata ? Object.keys(chunk.metadata) : 'No metadata'
          });
        }
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
      let results;
      if (typeof this.ragModule.query === 'function') {
        results = await this.ragModule.query('*', this.embeddings, {
          topK: 1000, // Large number to get all
          filter: { quizId: quizId }
        });
      } else if (typeof this.ragModule.retrieveContext === 'function') {
        results = await this.ragModule.retrieveContext('*', {
          topK: 1000,
          filter: { quizId: quizId }
        });
      } else {
        throw new Error('No suitable method found for querying RAG module');
      }

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
   * Process and embed a single material immediately upon upload
   * This replaces the job queue approach with immediate processing
   */
  async processAndEmbedMaterial(material) {
    console.log(`🔄 Processing and embedding material: ${material.name}`);
    
    if (!this.ragModule || !this.embeddings || !this.documentParser) {
      return {
        success: false,
        error: 'RAG services not initialized',
        chunksCount: 0
      };
    }
    
    try {
      let content = '';
      
      // Extract content based on material type
      if (material.type === 'text') {
        content = material.content;
      } else if (material.type === 'url') {
        content = material.content || 'URL content not available';
      } else if (material.filePath && (material.type === 'pdf' || material.type === 'docx')) {
        // Parse documents using UBC toolkit
        try {
          const absolutePath = path.isAbsolute(material.filePath) 
            ? material.filePath 
            : path.resolve(__dirname, '../../../', material.filePath);
          
          console.log(`🔍 Parsing file at: ${absolutePath}`);
          const parseResult = await this.documentParser.parse(
            { filePath: absolutePath },
            'text'
          );
          content = parseResult.content;
          console.log(`✅ Parsed ${material.type} file: ${content.length} characters`);
        } catch (parseError) {
          console.error(`❌ Failed to parse ${material.name}:`, parseError.message);
          return {
            success: false,
            error: `Failed to parse file: ${parseError.message}`,
            chunksCount: 0
          };
        }
      }

      if (!content || content.trim().length === 0) {
        return {
          success: false,
          error: 'No content found to process',
          chunksCount: 0
        };
      }

      // Split content into chunks for better retrieval
      const chunks = this.chunkContent(content, material);
      console.log(`📊 Created ${chunks.length} chunks from material`);
      
      let successCount = 0;
      
      // Add each chunk to the vector database
      for (const [index, chunk] of chunks.entries()) {
        try {
          const metadata = {
            materialId: material._id.toString(),
            materialName: material.name,
            materialType: material.type,
            chunkIndex: index,
            totalChunks: chunks.length,
            section: chunk.section || 'main',
            sourceFile: material.originalFileName || material.name,
            uploadedBy: material.uploadedBy.toString(),
            folderId: material.folder.toString(),
            processedAt: new Date().toISOString()
          };
          
          // Add document to RAG system
          const chunkIds = await this.ragModule.addDocument(chunk.content, metadata);
          successCount++;
          console.log(`✅ Added chunk ${successCount}/${chunks.length}: ${chunkIds.length} embeddings created`);
        } catch (addError) {
          console.error(`❌ Failed to add chunk ${index + 1}:`, addError.message);
          // Continue with other chunks even if one fails
        }
      }

      if (successCount === 0) {
        return {
          success: false,
          error: 'Failed to embed any chunks',
          chunksCount: chunks.length
        };
      }

      console.log(`✅ Successfully processed material: ${successCount}/${chunks.length} chunks embedded`);
      
      return {
        success: true,
        chunksCount: successCount,
        totalChunks: chunks.length,
        message: `Successfully embedded ${successCount} chunks`
      };
      
    } catch (error) {
      console.error('❌ Error processing material:', error);
      return {
        success: false,
        error: error.message,
        chunksCount: 0
      };
    }
  }

  /**
   * Clean up vector embeddings for a specific material
   * @param {string} materialId - Material ID to cleanup
   */
  async cleanupMaterialEmbeddings(materialId) {
    try {
      console.log(`🧹 Cleaning up vector embeddings for material: ${materialId}`);
      
      if (!this.ragModule) {
        console.log('⚠️ RAG module not available - skipping vector cleanup');
        return { success: false, error: 'RAG module not initialized' };
      }

      // Try to use direct Qdrant API for vector cleanup
      try {
        const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
        const qdrantApiKey = process.env.QDRANT_API_KEY;
        const collectionName = 'quiz_materials'; // Default collection name
        
        console.log(`🔧 Attempting direct Qdrant cleanup via REST API`);
        
        const headers = {
          'Content-Type': 'application/json'
        };
        
        if (qdrantApiKey) {
          headers['api-key'] = qdrantApiKey;
        }
        
        // Delete points by material ID filter
        const deleteUrl = `${qdrantUrl}/collections/${collectionName}/points/delete`;
        const deletePayload = {
          filter: {
            must: [
              {
                key: "materialId",
                match: {
                  value: materialId
                }
              }
            ]
          }
        };
        
        console.log(`🔄 Making DELETE request to: ${deleteUrl}`);
        console.log(`📄 Payload:`, JSON.stringify(deletePayload, null, 2));
        
        const response = await fetch(deleteUrl, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(deletePayload)
        });
        
        if (response.ok) {
          const result = await response.json();
          console.log(`✅ Successfully deleted vector embeddings for material ${materialId}`);
          console.log(`📊 Deletion result:`, result);
          
          return {
            success: true,
            message: `Vector embeddings deleted for material ${materialId}`,
            deletedCount: result.result?.operation_id || 'unknown',
            method: 'direct_qdrant_api'
          };
        } else {
          const errorText = await response.text();
          console.error(`❌ Qdrant API error (${response.status}):`, errorText);
          
          // Fall back to logging if direct API fails
          console.log(`📝 Falling back to cleanup logging for material ${materialId}`);
          return {
            success: true,
            message: `Cleanup logged for material ${materialId} (API fallback)`,
            note: `Direct API failed: ${response.status} ${errorText}`,
            method: 'fallback_logging'
          };
        }
        
      } catch (apiError) {
        console.error(`❌ Direct Qdrant API error:`, apiError.message);
        
        // Fall back to logging if API approach fails
        console.log(`📝 Falling back to cleanup logging for material ${materialId}`);
        return {
          success: true,
          message: `Cleanup logged for material ${materialId} (error fallback)`,
          note: `Direct API failed: ${apiError.message}`,
          method: 'fallback_logging'
        };
      }
    } catch (error) {
      console.error('❌ Error cleaning up material embeddings:', error);
      return { success: false, error: error.message };
    }
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

  /**
   * Reset the RAG collection (useful when encountering persistent errors)
   */
  async resetCollection() {
    try {
      console.log('🔄 Attempting to reset RAG collection...');
      
      if (!this.ragModule) {
        console.log('⚠️ RAG module not initialized, cannot reset collection');
        return { success: false, error: 'RAG module not initialized' };
      }

      // Delete the existing collection storage
      await this.ragModule.deleteStorage();
      console.log('🗑️ Deleted existing collection');

      // Reinitialize the RAG module to recreate the collection
      await this.initializeAsync();
      console.log('✅ Collection reset complete');

      return { success: true, message: 'Collection reset successfully' };
    } catch (error) {
      console.error('❌ Error resetting collection:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Public initialization method for external use
   */
  async initialize() {
    if (this.isInitialized) {
      return false; // Already initialized
    }
    await this.initializeAsync();
    return true;
  }

  /**
   * Index content directly (for testing or manual indexing)
   */
  async indexContent({ documentId, content, metadata }) {
    if (!this.isInitialized) {
      await this.initializeAsync();
    }

    if (!this.ragModule) {
      return { success: false, error: 'RAG module not available' };
    }

    try {
      // Chunk the content
      const chunks = [];
      const chunkSize = 500;
      const chunkOverlap = 50;
      
      for (let i = 0; i < content.length; i += (chunkSize - chunkOverlap)) {
        chunks.push({
          content: content.substring(i, i + chunkSize),
          metadata: {
            ...metadata,
            chunkIndex: chunks.length,
            documentId
          }
        });
      }

      // Index chunks using the correct method
      for (const chunk of chunks) {
        if (this.ragModule.addDocument) {
          await this.ragModule.addDocument(
            chunk.content,
            chunk.metadata
          );
        } else if (this.ragModule.add) {
          await this.ragModule.add(
            chunk.content,
            chunk.metadata
          );
        }
      }

      return { 
        success: true, 
        chunksIndexed: chunks.length,
        documentId 
      };
    } catch (error) {
      console.error('❌ Error indexing content:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete content for a quiz (for cleanup)
   */
  async deleteQuizContent(quizId) {
    if (!this.ragModule) {
      return { success: false, error: 'RAG module not available' };
    }

    try {
      // Note: This is a simplified implementation
      // In production, you'd want to track document IDs and delete them specifically
      console.log(`🗑️ Deleting content for quiz ${quizId}`);
      
      // For now, we'll just return success
      // Real implementation would filter and delete by quizId metadata
      return { success: true, message: `Content for quiz ${quizId} marked for deletion` };
    } catch (error) {
      console.error('❌ Error deleting quiz content:', error);
      return { success: false, error: error.message };
    }
  }
}

// Export singleton instance
const ragService = new QuizRAGService();
export default ragService;