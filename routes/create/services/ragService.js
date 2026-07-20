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
import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const execFileAsync = promisify(execFile);

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

export class QuizRAGService {
  constructor({ autoInitialize = true } = {}) {
    // Use the proper UBC GenAI Toolkit logger
    this.logger = new ConsoleLogger('RAG');
    this.isInitialized = false;
    
    if (autoInitialize) {
      this.initializeAsync();
    }
  }

  async initializeAsync() {
    try {
      console.log('🚀 Initializing QuizRAGService...');

      // fastembed skips download when the cache dir exists, even if the .onnx
      // file is missing (e.g. after an interrupted download). Delete the dir so
      // fastembed re-downloads the full archive on the next init call.
      const modelCacheDir = path.join(process.cwd(), 'local_cache', 'fast-bge-small-en-v1.5');
      const requiredModelFiles = [
        'model_optimized.onnx',
        'tokenizer.json',
        'config.json'
      ];

      let isModelCacheComplete = true;
      for (const filename of requiredModelFiles) {
        try {
          await fs.access(path.join(modelCacheDir, filename));
        } catch {
          isModelCacheComplete = false;
          console.log(`⚠️  FastEmbed cache missing required file: ${filename}`);
          break;
        }
      }

      if (!isModelCacheComplete) {
        console.log('⚠️  FastEmbed model cache is incomplete — clearing and re-downloading...');
        await fs.rm(modelCacheDir, { recursive: true, force: true });
      }

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
        console.log('🔑 Using Qdrant API key from environment (value hidden)');
        console.log('🔧 Qdrant target:', {
          url: qdrantConfig.url,
          collectionName: qdrantConfig.collectionName,
          hasApiKey: true
        });
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
            content = await this.parseDocumentContent(absolutePath, material.type, 'text');
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
      minScore = 0.3,
      quizId = null
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
        const similarity = typeof chunk.score === 'number' ? `${(chunk.score * 100).toFixed(1)}%` : 'n/a';
        const pageLabel = chunk.metadata?.pageNumber ? `page ${chunk.metadata.pageNumber}` : 'no page';
        const chunkLabel = typeof chunk.metadata?.chunkIndex === 'number' ? `chunk ${chunk.metadata.chunkIndex + 1}` : 'no chunk index';
        const sectionLabel = chunk.metadata?.sectionTitle || chunk.metadata?.section || 'no section';
        console.log(`  ${index + 1}. ${chunk.source} | ${pageLabel} | ${chunkLabel} | ${sectionLabel} | similarity ${similarity}`);
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

  async parseDocumentContent(filePath, materialType, outputFormat = 'text') {
    if (materialType === 'pdf') {
      const pages = await this.parsePdfPages(filePath);
      if (pages.length > 0) {
        const pdfText = pages.map(page => page.content).join('\n\n');
        console.log(`✅ Parsed pdf file with pdftotext: ${pdfText.length} characters across ${pages.length} pages`);
        return pdfText;
      }

      console.log('⚠️ pdftotext did not return usable text; falling back to toolkit parser');
    }

    const parseResult = await this.documentParser.parse(
      { filePath },
      outputFormat
    );
    return parseResult.content;
  }

  async parsePdfWithPdftotext(filePath) {
    const pages = await this.parsePdfPages(filePath);
    return pages.map(page => page.content).join('\n\n');
  }

  async parsePdfPages(filePath) {
    try {
      const { stdout } = await execFileAsync('pdftotext', ['-layout', filePath, '-'], {
        timeout: 30000,
        maxBuffer: 20 * 1024 * 1024
      });

      const rawPages = stdout.split('\f');
      if (rawPages.length > 1 && !rawPages[rawPages.length - 1].trim()) {
        rawPages.pop();
      }

      return rawPages.map((content, index) => ({
        pageNumber: index + 1,
        content: content.trim()
      }));
    } catch (error) {
      console.warn(`⚠️ pdftotext failed for ${filePath}: ${error.message}`);
      return [];
    }
  }

  detectSectionHeading(line) {
    const numbered = line.match(/^\s*(\d+)\.\s+(.+?)\s*$/)
      || line.match(/^\s*(\d+(?:\.\d+)+)(?:\.)?\s+(.+?)\s*$/);
    if (numbered) {
      const headingText = numbered[2].trim();
      const isNestedHeading = numbered[1].includes('.');
      const looksLikeNumberedStep = !isNestedHeading && (headingText.endsWith('.') || headingText.length > 80);
      if (looksLikeNumberedStep) {
        return null;
      }

      return {
        number: numbered[1],
        title: `${numbered[1]}. ${headingText}`,
        level: numbered[1].split('.').length
      };
    }

    const part = line.match(/^\s*(Part\s+[A-Z0-9]+)\s*:\s*(.+?)\s*$/i);
    if (part) {
      return {
        number: part[1],
        title: `${part[1]}: ${part[2].trim()}`,
        level: 1
      };
    }

    return null;
  }

  splitSectionContent(sectionContent, metadata = {}, maxChunkSize = 1200) {
    const cleanContent = sectionContent.trim();
    if (!cleanContent) {
      return [];
    }

    const baseChunk = {
      section: metadata.sectionTitle || 'main',
      sectionTitle: metadata.sectionTitle || 'Main',
      sectionNumber: metadata.sectionNumber,
      sectionLevel: metadata.sectionLevel,
      pageNumber: metadata.pageNumber,
      pageStart: metadata.pageNumber,
      pageEnd: metadata.pageNumber
    };

    if (cleanContent.length <= maxChunkSize) {
      return [{ ...baseChunk, content: cleanContent }];
    }

    const chunks = [];
    const paragraphs = cleanContent.split(/\n\s*\n/).filter(Boolean);
    let current = '';

    const pushCurrent = () => {
      if (current.trim()) {
        chunks.push({ ...baseChunk, content: current.trim() });
        current = '';
      }
    };

    for (const paragraph of paragraphs) {
      if (paragraph.length <= maxChunkSize && current.length + paragraph.length + 2 <= maxChunkSize) {
        current += `${current ? '\n\n' : ''}${paragraph}`;
        continue;
      }

      pushCurrent();

      if (paragraph.length <= maxChunkSize) {
        current = paragraph;
        continue;
      }

      const sentences = paragraph.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [paragraph];
      for (const sentence of sentences) {
        if (current.length + sentence.length + 1 > maxChunkSize) {
          pushCurrent();
        }
        current += `${current ? ' ' : ''}${sentence.trim()}`;
      }
    }

    pushCurrent();
    return chunks;
  }

  chunkPdfPages(pages, material) {
    const chunks = [];
    let activeSection = {
      title: 'Introduction',
      number: null,
      level: 0
    };

    for (const page of pages) {
      const lines = page.content.split('\n');
      let segmentLines = [];

      const flushSegment = () => {
        const segment = segmentLines.join('\n').trim();
        if (!segment) {
          segmentLines = [];
          return;
        }

        chunks.push(...this.splitSectionContent(segment, {
          sectionTitle: activeSection.title,
          sectionNumber: activeSection.number,
          sectionLevel: activeSection.level,
          pageNumber: page.pageNumber
        }));
        segmentLines = [];
      };

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        let line = lines[lineIndex];
        const heading = this.detectSectionHeading(line);
        if (heading) {
          if (heading.title.endsWith('-') && lines[lineIndex + 1]?.trim() && !this.detectSectionHeading(lines[lineIndex + 1])) {
            const continuation = lines[lineIndex + 1].trim();
            heading.title = `${heading.title}${continuation}`;
            line = `${line}\n${continuation}`;
            lineIndex += 1;
          }
          flushSegment();
          activeSection = heading;
        }
        segmentLines.push(line);
      }

      flushSegment();
    }

    console.log(`🧭 Page-aware chunking detected ${chunks.length} chunks across ${pages.length} pages for "${material.name}"`);
    return chunks;
  }

  async loadMaterialChunks(material) {
    if (material.type === 'text' || material.type === 'url') {
      const content = material.content || '';
      const chunks = this.chunkContent(content, material).map((chunk, chunkIndex) => ({ ...chunk, chunkIndex }));
      return {
        content,
        pages: [],
        chunks
      };
    }

    if (!material.filePath) {
      const chunks = this.chunkContent(material.content || '', material).map((chunk, chunkIndex) => ({ ...chunk, chunkIndex }));
      return { content: material.content || '', pages: [], chunks };
    }

    const absolutePath = path.isAbsolute(material.filePath)
      ? material.filePath
      : path.resolve(__dirname, '../../../', material.filePath);

    if (material.type === 'pdf') {
      const pages = await this.parsePdfPages(absolutePath);
      if (pages.length > 0) {
        const content = pages.map(page => page.content).join('\n\n');
        return {
          content,
          pages,
          chunks: this.chunkPdfPages(pages, material).map((chunk, chunkIndex) => ({ ...chunk, chunkIndex }))
        };
      }
    }

    const content = await this.parseDocumentContent(absolutePath, material.type, 'text');
    return {
      content,
      pages: [],
      chunks: this.chunkContent(content, material).map((chunk, chunkIndex) => ({ ...chunk, chunkIndex }))
    };
  }

  async buildLearningObjectiveInventory(materials, options = {}) {
    const maxCharacters = options.maxCharacters || 60000;
    const sections = [];
    let totalChunks = 0;

    for (const [materialIndex, material] of materials.entries()) {
      const parsed = await this.loadMaterialChunks(material);
      const grouped = new Map();
      const materialLabel = `${material.name || ''} ${material.originalFileName || ''}`;
      const materialRole = /(problem[\s_-]*set|assignment|worksheet|practice|exam|test|quiz|solution)/i.test(materialLabel)
        ? 'assessment-evidence'
        : 'instructional-content';
      totalChunks += parsed.chunks.length;

      for (const chunk of parsed.chunks) {
        const rawSectionTitle = chunk.sectionTitle || chunk.section || 'Main';
        const isGeneratedChunkTitle = /^(Chunk \d+|Complete material|Main)$/i.test(rawSectionTitle);
        const sectionTitle = isGeneratedChunkTitle ? 'Main content' : rawSectionTitle;
        const key = isGeneratedChunkTitle ? '__main_content__' : `${chunk.sectionNumber || ''}:${sectionTitle}`;
        if (!grouped.has(key)) {
          grouped.set(key, {
            title: sectionTitle,
            sectionNumber: chunk.sectionNumber,
            sectionLevel: chunk.sectionLevel ?? 1,
            hasExplicitHeading: Boolean(chunk.sectionNumber) || /^Part\s+/i.test(sectionTitle),
            chunks: []
          });
        }
        grouped.get(key).chunks.push(chunk);
      }

      let sectionIndex = 0;
      for (const group of grouped.values()) {
        sectionIndex += 1;
        const sectionId = `M${materialIndex + 1}-S${sectionIndex}`;
        const pageNumbers = [...new Set(group.chunks.map(chunk => chunk.pageNumber).filter(Boolean))];
        const combinedContent = group.chunks.map(chunk => chunk.content).join('\n\n');
        sections.push({
          id: sectionId,
          materialId: material._id.toString(),
          materialName: material.name,
          materialType: material.type,
          materialRole,
          sourceFile: material.originalFileName || material.name,
          title: group.title,
          sectionNumber: group.sectionNumber,
          sectionLevel: group.sectionLevel,
          isMajor: group.title === 'Main content' || (group.hasExplicitHeading && group.sectionLevel <= 1),
          pageNumbers,
          chunks: group.chunks,
          content: combinedContent
        });
      }
    }

    const requiredSections = sections.filter(section => section.isMajor);
    const availablePerSection = Math.max(600, Math.floor(maxCharacters / Math.max(sections.length, 1)));
    let truncated = false;
    const promptContent = sections.map(section => {
      const excerpt = section.content.length > availablePerSection
        ? `${section.content.substring(0, availablePerSection)}\n[Section excerpt truncated]`
        : section.content;
      truncated ||= excerpt.length < section.content.length;
      const pageLabel = section.pageNumbers.length > 0 ? ` | pages ${section.pageNumbers.join(', ')}` : '';
      const requirementLabel = section.isMajor ? ' | MAJOR SECTION' : '';
      return `[${section.id}] ${section.materialName} | role: ${section.materialRole} | ${section.title}${pageLabel}${requirementLabel}\n${excerpt}`;
    }).join('\n\n---\n\n');

    const conceptSectionCount = requiredSections.filter(section => section.materialRole === 'instructional-content').length;
    const assessmentSectionCount = requiredSections.length - conceptSectionCount;
    const suggestedObjectiveCount = Math.min(12, Math.max(1, Math.round(conceptSectionCount * 0.8) || 1));
    const recommendedObjectiveRange = {
      min: Math.min(suggestedObjectiveCount, Math.max(1, Math.ceil(conceptSectionCount * 0.65) || 1)),
      max: Math.max(suggestedObjectiveCount, Math.min(12, conceptSectionCount || suggestedObjectiveCount)),
      suggested: suggestedObjectiveCount
    };

    console.log(`🗺️ LO inventory: ${materials.length} materials, ${sections.length} sections, ${requiredSections.length} major sections (${conceptSectionCount} instructional, ${assessmentSectionCount} assessment-evidence), ${totalChunks} chunks${truncated ? ' (context truncated evenly by section)' : ''}`);
    sections.forEach(section => {
      const pages = section.pageNumbers.length ? `pages ${section.pageNumbers.join(',')}` : 'no page';
      console.log(`  ${section.id} | ${section.isMajor ? 'major' : 'supporting'} | ${pages} | ${section.title} | ${section.chunks.length} chunk(s)`);
    });

    return {
      sections,
      requiredSections,
      totalChunks,
      promptContent,
      truncated,
      conceptSectionCount,
      assessmentSectionCount,
      recommendedObjectiveRange
    };
  }

  /**
   * Chunk content into manageable pieces for RAG indexing
   */
  chunkContent(content, material) {
    const chunks = [];
    const maxChunkSize = 900; // Characters per chunk
    // const overlapSize = 50;   // Overlap between chunks (unused for now)

    const splitLongSection = (sectionContent, sectionTitle) => {
      if (sectionContent.length <= maxChunkSize) {
        return [{
          content: sectionContent.trim(),
          section: sectionTitle || 'main',
          sectionTitle: sectionTitle || 'Main'
        }];
      }

      const sectionChunks = [];
      const paragraphs = sectionContent.split(/\n\s*\n/).filter(p => p.trim().length > 0);
      let currentChunk = '';
      let partIndex = 1;

      for (const paragraph of paragraphs) {
        if (currentChunk.length + paragraph.length <= maxChunkSize) {
          currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
          continue;
        }

        if (currentChunk.trim()) {
          sectionChunks.push({
            content: currentChunk.trim(),
            section: sectionTitle ? `${sectionTitle} / part ${partIndex++}` : `part_${partIndex++}`,
            sectionTitle: sectionTitle || 'Main'
          });
        }

        currentChunk = paragraph;
      }

      if (currentChunk.trim()) {
        sectionChunks.push({
          content: currentChunk.trim(),
          section: sectionTitle ? `${sectionTitle} / part ${partIndex}` : `part_${partIndex}`,
          sectionTitle: sectionTitle || 'Main'
        });
      }

      return sectionChunks;
    };

    const buildSectionChunks = () => {
      const lines = content.split('\n');
      const headingPattern = /^\s*(\d+(?:\.\d+)*)\.\s+(.+?)\s*$/;
      const sections = [];
      let currentSection = null;

      for (const line of lines) {
        const headingMatch = line.match(headingPattern);

        if (headingMatch) {
          if (currentSection?.lines.length) {
            sections.push(currentSection);
          }

          currentSection = {
            title: `${headingMatch[1]}. ${headingMatch[2].trim()}`,
            lines: [line]
          };
          continue;
        }

        if (!currentSection) {
          currentSection = {
            title: 'Introduction',
            lines: []
          };
        }

        currentSection.lines.push(line);
      }

      if (currentSection?.lines.length) {
        sections.push(currentSection);
      }

      if (sections.filter(section => section.title !== 'Introduction').length < 2) {
        return [];
      }

      return sections.flatMap(section => splitLongSection(section.lines.join('\n'), section.title));
    };

    const structuredChunks = buildSectionChunks();
    if (structuredChunks.length > 0) {
      console.log(`🧭 Section-aware chunking detected ${structuredChunks.length} chunks for "${material.name}"`);
      return structuredChunks;
    }
    
    // Simple chunking strategy - can be enhanced with semantic chunking
    if (content.length <= maxChunkSize) {
      chunks.push({
        content: content.trim(),
        section: 'complete',
        sectionTitle: 'Complete material'
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
              section: `chunk_${chunkIndex}`,
              sectionTitle: `Chunk ${chunkIndex++}`
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
                    section: `chunk_${chunkIndex}`,
                    sectionTitle: `Chunk ${chunkIndex++}`
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
          section: `chunk_${chunkIndex}`,
          sectionTitle: `Chunk ${chunkIndex}`
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
      let preparedChunks = null;
      let parsedPages = [];
      
      // Extract content based on material type
      if (material.type === 'text') {
        content = material.content;
      } else if (material.type === 'url') {
        // Use cached content if already extracted, otherwise fetch from URL
        if (material.content && material.content !== 'URL content not available') {
          content = material.content;
          console.log(`📋 Using cached URL content (${content.length} chars)`);
        } else {
          console.log(`🌐 Fetching URL content: ${material.url}`);
          const urlExtractService = (await import('./urlExtractService.js')).default;
          const extractResult = await urlExtractService.extract(material.url);

          if (extractResult.tempFilePath) {
            // PDF URL — parse the downloaded temp file with DocumentParsingModule
            try {
              console.log(`📄 Parsing downloaded PDF: ${extractResult.tempFilePath}`);
              content = await this.parseDocumentContent(extractResult.tempFilePath, 'pdf', 'text');
              console.log(`✅ Parsed PDF from URL: ${content.length} characters`);
            } finally {
              // Always clean up temp file
              await fs.unlink(extractResult.tempFilePath).catch(() => {});
            }
          } else {
            content = extractResult.content;
          }

          // Cache extracted content on the material document for future use
          if (content && content.trim().length > 0) {
            material.content = content;
            await material.save();
            console.log(`💾 Cached extracted content (${content.length} chars) on material`);
          }
        }
      } else if (material.filePath && (material.type === 'pdf' || material.type === 'docx')) {
        // Parse documents using UBC toolkit
        try {
          console.log(`🔍 Parsing file at: ${material.filePath}`);
          const parsedMaterial = await this.loadMaterialChunks(material);
          content = parsedMaterial.content;
          preparedChunks = parsedMaterial.chunks;
          parsedPages = parsedMaterial.pages;
          console.log(`✅ Parsed ${material.type} file: ${content.length} characters`);
          if (content && content.trim().length > 0) {
            material.content = content;
            material.processingMetadata = {
              ...(material.processingMetadata?.toObject?.() || material.processingMetadata || {}),
              pageCount: parsedPages.length || undefined,
              parserVersion: parsedPages.length ? 'page-aware-v1' : 'section-aware-v1',
              processedAt: new Date()
            };
            await material.save();
            console.log(`💾 Cached parsed ${material.type} content (${content.length} chars) on material`);
          }
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
      const chunks = preparedChunks || this.chunkContent(content, material);
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
            sectionTitle: chunk.sectionTitle || chunk.section || 'main',
            sectionNumber: chunk.sectionNumber || undefined,
            sectionLevel: typeof chunk.sectionLevel === 'number' ? chunk.sectionLevel : undefined,
            pageNumber: chunk.pageNumber || undefined,
            pageStart: chunk.pageStart || chunk.pageNumber || undefined,
            pageEnd: chunk.pageEnd || chunk.pageNumber || undefined,
            sourceFile: material.originalFileName || material.name,
            uploadedBy: material.uploadedBy.toString(),
            folderId: material.folder.toString(),
            processedAt: new Date().toISOString()
          };
          
          // Add document to RAG system
          const chunkIds = await this.ragModule.addDocument(chunk.content, metadata);
          successCount++;
          const pageLabel = metadata.pageNumber ? `page ${metadata.pageNumber}, ` : '';
          console.log(`✅ Added chunk ${successCount}/${chunks.length}: ${pageLabel}${metadata.sectionTitle}, ${chunkIds.length} embeddings created`);
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

      material.processingMetadata = {
        ...(material.processingMetadata?.toObject?.() || material.processingMetadata || {}),
        pageCount: parsedPages.length || material.processingMetadata?.pageCount,
        chunkCount: chunks.length,
        parserVersion: parsedPages.length ? 'page-aware-v1' : 'section-aware-v1',
        processedAt: new Date()
      };
      await material.save();
      
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
        const collectionName = 'quiz-materials';
        
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
                key: "metadata.materialId",
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

  /**
   * DEBUG: Log all chunks stored in Qdrant for debugging
   * @param {number} limit - Maximum number of chunks to retrieve (default: 50)
   */
  async debugLogAllChunks(limit = 50) {
    console.log('\n========== DEBUGGING QDRANT CHUNKS ==========');

    if (!this.ragModule) {
      console.log('❌ RAG module not available');
      return;
    }

    try {
      // Try to retrieve chunks using a wildcard query
      const results = await this.ragModule.retrieveContext('*', {
        limit: limit,
        scoreThreshold: 0.0 // Get all chunks regardless of score
      });

      console.log(`\n📊 Total chunks retrieved: ${results.length}\n`);

      results.forEach((result, idx) => {
        console.log(`\n--- Chunk ${idx + 1} ---`);
        console.log('Metadata:', JSON.stringify(result.metadata, null, 2));
        console.log('Score:', result.score);

        // Try different field names for content
        const content = result.content || result.pageContent || result.text || result.payload?.content || '[No content found]';
        console.log('Content length:', content.length);
        console.log('Content preview (first 200 chars):');
        console.log(content.substring(0, 200));
        console.log('Content preview (last 100 chars):');
        console.log(content.substring(Math.max(0, content.length - 100)));

        // Log all keys in the result object
        console.log('Available keys in result:', Object.keys(result));
      });

      console.log('\n========== END DEBUG ==========\n');

      return results;
    } catch (error) {
      console.error('❌ Error retrieving chunks:', error);
      console.error('Error stack:', error.stack);
    }
  }
}

// Export singleton instance
const ragService = new QuizRAGService({
  autoInitialize: process.env.RAG_SKIP_AUTO_INIT !== 'true'
});
export default ragService;
