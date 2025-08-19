import fs from 'fs/promises';
import path from 'path';
import { DocumentParsingModule } from 'ubc-genai-toolkit-document-parsing';
import { ConsoleLogger } from 'ubc-genai-toolkit-core';
import { PROCESSING_STATUS } from '../config/constants.js';

/**
 * Document Processing Service
 * Integrates with UBC GenAI Toolkit for text extraction, embeddings, and vector storage
 */
class DocumentProcessingService {
  constructor() {
    // UBC GenAI Toolkit modules
    this.documentParser = null;
    this.embeddingsModule = null;
    this.ragModule = null;
    this.qdrantClient = null;
    
    // Configuration
    this.config = {
      // Document parsing settings
      chunkSize: 512,
      chunkOverlap: 50,
      preserveFormatting: true,
      extractImages: false,
      
      // Embeddings settings
      embeddingModel: 'sentence-transformers/all-MiniLM-L6-v2',
      batchSize: 32,
      
      // Qdrant settings
      collectionName: 'course-materials',
      vectorSize: 384, // For all-MiniLM-L6-v2
      
      // Processing settings
      maxRetries: 3,
      retryDelay: 1000, // milliseconds
    };
  }

  /**
   * Initialize UBC GenAI Toolkit modules
   */
  async initialize() {
    try {
      console.log('📚 DocumentProcessingService: Initializing UBC GenAI Toolkit...');
      
      // Initialize UBC GenAI Toolkit Document Parsing Module
      const docParsingConfig = {
        logger: new ConsoleLogger(),
        debug: true
      };
      
      this.documentParser = new DocumentParsingModule(docParsingConfig);
      console.log('✅ UBC GenAI Toolkit Document Parser initialized');
      
      // Mock Embeddings Module
      this.embeddingsModule = {
        generateEmbeddings: async (texts) => {
          // Mock embeddings - in reality this would call the actual embedding model
          return texts.map(text => ({
            text,
            embedding: Array(this.config.vectorSize).fill(0).map(() => Math.random() - 0.5),
            metadata: {
              model: this.config.embeddingModel,
              dimensions: this.config.vectorSize
            }
          }));
        }
      };
      
      // Mock Qdrant Client
      this.qdrantClient = {
        ensureCollection: async (collectionName) => {
          console.log(`📊 Mock Qdrant: Collection "${collectionName}" ready`);
          return true;
        },
        
        upsertPoints: async (collectionName, points) => {
          console.log(`📊 Mock Qdrant: Upserted ${points.length} points to "${collectionName}"`);
          return { operation_id: Date.now() };
        },
        
        search: async (collectionName, vector, limit = 5) => {
          console.log(`🔍 Mock Qdrant: Searching in "${collectionName}" with limit ${limit}`);
          return {
            result: Array(Math.min(limit, 3)).fill(0).map((_, i) => ({
              id: `mock-result-${i}`,
              score: 0.95 - (i * 0.1),
              payload: {
                text: `Mock search result ${i + 1}`,
                materialId: `material-${i + 1}`,
                source: 'mock-document.pdf'
              }
            }))
          };
        }
      };
      
      // Mock RAG Module
      this.ragModule = {
        chunkText: (text, chunkSize = 512, overlap = 50) => {
          const words = text.split(' ');
          const chunks = [];
          const wordsPerChunk = Math.floor(chunkSize / 6); // Rough estimate: 6 chars per word
          const overlapWords = Math.floor(overlap / 6);
          
          for (let i = 0; i < words.length; i += wordsPerChunk - overlapWords) {
            const chunk = words.slice(i, i + wordsPerChunk).join(' ');
            if (chunk.trim()) {
              chunks.push({
                text: chunk,
                startIndex: i,
                endIndex: Math.min(i + wordsPerChunk, words.length),
                chunkIndex: chunks.length
              });
            }
          }
          
          return chunks;
        }
      };
      
      // Ensure Qdrant collection exists
      await this.qdrantClient.ensureCollection(this.config.collectionName);
      
      console.log('✅ DocumentProcessingService: Initialization complete');
      return true;
      
    } catch (error) {
      console.error('❌ DocumentProcessingService: Initialization failed:', error);
      throw new Error(`Failed to initialize document processing: ${error.message}`);
    }
  }

  /**
   * Process uploaded document file
   * @param {Object} material - Material document from database
   * @returns {Promise<Object>} - Processing result
   */
  async processDocument(material) {
    if (!this.documentParser) {
      await this.initialize();
    }

    console.log(`📄 Processing document: ${material.name} (${material.type})`);
    
    try {
      // Step 1: Extract text from document
      const extractionResult = await this.extractText(material.filePath, material.type);
      
      // Step 2: Chunk the text for vector storage
      const chunks = this.ragModule.chunkText(
        extractionResult.text,
        this.config.chunkSize,
        this.config.chunkOverlap
      );
      
      console.log(`📝 Created ${chunks.length} text chunks for ${material.name}`);
      
      // Step 3: Generate embeddings for chunks
      const embeddings = await this.embeddingsModule.generateEmbeddings(
        chunks.map(chunk => chunk.text)
      );
      
      // Step 4: Prepare points for Qdrant
      const points = embeddings.map((embedding, index) => ({
        id: `${material._id}-chunk-${index}`,
        vector: embedding.embedding,
        payload: {
          materialId: material._id.toString(),
          materialName: material.name,
          materialType: material.type,
          chunkIndex: index,
          text: chunks[index].text,
          startIndex: chunks[index].startIndex,
          endIndex: chunks[index].endIndex,
          folderId: material.folder.toString(),
          uploadedBy: material.uploadedBy.toString(),
          createdAt: material.createdAt,
          metadata: {
            ...extractionResult.metadata,
            chunkSize: this.config.chunkSize,
            chunkOverlap: this.config.chunkOverlap
          }
        }
      }));
      
      // Step 5: Store vectors in Qdrant
      const upsertResult = await this.qdrantClient.upsertPoints(
        this.config.collectionName,
        points
      );
      
      console.log(`✅ Document processing complete for ${material.name}`);
      
      return {
        success: true,
        extractedText: extractionResult.text,
        chunks: chunks.length,
        embeddings: embeddings.length,
        qdrantOperationId: upsertResult.operation_id,
        qdrantDocumentId: `${material._id}-doc`,
        metadata: {
          ...extractionResult.metadata,
          processingTime: Date.now(),
          embeddingModel: this.config.embeddingModel,
          vectorDimensions: this.config.vectorSize
        }
      };
      
    } catch (error) {
      console.error(`❌ Document processing failed for ${material.name}:`, error);
      throw error;
    }
  }

  /**
   * Extract text from document file
   * @param {string} filePath - Path to document file
   * @param {string} fileType - Type of document (pdf, docx)
   * @returns {Promise<Object>} - Extracted text and metadata
   */
  async extractText(filePath, fileType) {
    try {
      // Check if file exists
      await fs.access(filePath);
      
      console.log(`📄 Extracting text from ${fileType.toUpperCase()}: ${path.basename(filePath)}`);
      
      // Parse document using UBC GenAI Toolkit Document Parsing Module
      const parseResult = await this.documentParser.parse({ filePath }, 'text');
      
      if (!parseResult.content || parseResult.content.trim().length === 0) {
        throw new Error('No text content extracted from document');
      }
      
      // Output extracted text to console for testing
      console.log('📝 EXTRACTED TEXT CONTENT:');
      console.log('=' * 50);
      console.log(parseResult.content);
      console.log('=' * 50);
      console.log(`📊 Word count: ${parseResult.content.split(/\s+/).length}`);
      
      // Convert to our expected format
      return {
        text: parseResult.content,
        metadata: {
          wordCount: parseResult.content.split(/\s+/).length,
          extractionMethod: 'ubc-genai-toolkit',
          fileType: fileType,
          success: parseResult.success || true
        }
      };
      
    } catch (error) {
      console.error(`❌ Text extraction failed for ${filePath}:`, error);
      if (error.code === 'ENOENT') {
        throw new Error('Document file not found');
      }
      throw new Error(`Text extraction failed: ${error.message}`);
    }
  }

  /**
   * Search for similar content using RAG
   * @param {string} query - Search query
   * @param {string} folderId - Optional folder ID to limit search
   * @param {number} limit - Number of results to return
   * @returns {Promise<Array>} - Search results
   */
  async searchContent(query, folderId = null, limit = 5) {
    if (!this.embeddingsModule || !this.qdrantClient) {
      await this.initialize();
    }

    try {
      // Generate embedding for query
      const queryEmbeddings = await this.embeddingsModule.generateEmbeddings([query]);
      const queryVector = queryEmbeddings[0].embedding;
      
      // Search in Qdrant
      const searchResult = await this.qdrantClient.search(
        this.config.collectionName,
        queryVector,
        limit
      );
      
      // Filter by folder if specified
      let results = searchResult.result;
      if (folderId) {
        results = results.filter(result => result.payload.folderId === folderId);
      }
      
      return results.map(result => ({
        materialId: result.payload.materialId,
        materialName: result.payload.materialName,
        materialType: result.payload.materialType,
        text: result.payload.text,
        score: result.score,
        chunkIndex: result.payload.chunkIndex,
        startIndex: result.payload.startIndex,
        endIndex: result.payload.endIndex
      }));
      
    } catch (error) {
      console.error('❌ Content search failed:', error);
      throw new Error(`Search failed: ${error.message}`);
    }
  }

  /**
   * Process URL content
   * @param {string} url - URL to process
   * @param {Object} material - Material document
   * @returns {Promise<Object>} - Processing result
   */
  async processUrl(url, material) {
    console.log(`🌐 Processing URL: ${url}`);
    
    try {
      // Mock URL content extraction
      // In reality, this would fetch and parse the URL content
      const mockContent = `[MOCK] Content extracted from URL: ${url}\n\nThis would contain the actual webpage content extracted using the UBC GenAI Toolkit's web scraping capabilities. The content would be cleaned, formatted, and prepared for embedding generation.`;
      
      // Process as text content
      const chunks = this.ragModule.chunkText(
        mockContent,
        this.config.chunkSize,
        this.config.chunkOverlap
      );
      
      const embeddings = await this.embeddingsModule.generateEmbeddings(
        chunks.map(chunk => chunk.text)
      );
      
      const points = embeddings.map((embedding, index) => ({
        id: `${material._id}-chunk-${index}`,
        vector: embedding.embedding,
        payload: {
          materialId: material._id.toString(),
          materialName: material.name,
          materialType: material.type,
          chunkIndex: index,
          text: chunks[index].text,
          url: url,
          folderId: material.folder.toString(),
          uploadedBy: material.uploadedBy.toString(),
          createdAt: material.createdAt
        }
      }));
      
      const upsertResult = await this.qdrantClient.upsertPoints(
        this.config.collectionName,
        points
      );
      
      console.log(`✅ URL processing complete for ${url}`);
      
      return {
        success: true,
        extractedText: mockContent,
        chunks: chunks.length,
        embeddings: embeddings.length,
        qdrantOperationId: upsertResult.operation_id,
        qdrantDocumentId: `${material._id}-url`
      };
      
    } catch (error) {
      console.error(`❌ URL processing failed for ${url}:`, error);
      throw error;
    }
  }

  /**
   * Process text content
   * @param {string} content - Text content
   * @param {Object} material - Material document
   * @returns {Promise<Object>} - Processing result
   */
  async processTextContent(content, material) {
    console.log(`📝 Processing text content: ${material.name}`);
    
    try {
      const chunks = this.ragModule.chunkText(
        content,
        this.config.chunkSize,
        this.config.chunkOverlap
      );
      
      const embeddings = await this.embeddingsModule.generateEmbeddings(
        chunks.map(chunk => chunk.text)
      );
      
      const points = embeddings.map((embedding, index) => ({
        id: `${material._id}-chunk-${index}`,
        vector: embedding.embedding,
        payload: {
          materialId: material._id.toString(),
          materialName: material.name,
          materialType: material.type,
          chunkIndex: index,
          text: chunks[index].text,
          folderId: material.folder.toString(),
          uploadedBy: material.uploadedBy.toString(),
          createdAt: material.createdAt
        }
      }));
      
      const upsertResult = await this.qdrantClient.upsertPoints(
        this.config.collectionName,
        points
      );
      
      console.log(`✅ Text processing complete for ${material.name}`);
      
      return {
        success: true,
        extractedText: content,
        chunks: chunks.length,
        embeddings: embeddings.length,
        qdrantOperationId: upsertResult.operation_id,
        qdrantDocumentId: `${material._id}-text`
      };
      
    } catch (error) {
      console.error(`❌ Text processing failed for ${material.name}:`, error);
      throw error;
    }
  }

  /**
   * Delete document vectors from Qdrant
   * @param {string} materialId - Material ID
   * @returns {Promise<boolean>} - Success status
   */
  async deleteDocumentVectors(materialId) {
    if (!this.qdrantClient) {
      await this.initialize();
    }

    try {
      console.log(`🗑️ Deleting vectors for material: ${materialId}`);
      
      // In a real implementation, you would delete points with materialId filter
      // For now, just log the operation
      console.log(`✅ Mock deletion of vectors for material: ${materialId}`);
      
      return true;
      
    } catch (error) {
      console.error(`❌ Failed to delete vectors for material ${materialId}:`, error);
      return false;
    }
  }

  /**
   * Get processing statistics
   * @returns {Promise<Object>} - Statistics
   */
  async getProcessingStats() {
    try {
      // Mock statistics - in reality this would query Qdrant for collection info
      return {
        totalDocuments: 42,
        totalChunks: 256,
        totalVectors: 256,
        collectionName: this.config.collectionName,
        embeddingModel: this.config.embeddingModel,
        vectorSize: this.config.vectorSize,
        lastUpdate: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('❌ Failed to get processing stats:', error);
      throw error;
    }
  }
}

// Export singleton instance
export default new DocumentProcessingService();