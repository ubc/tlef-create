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

      // Import and use the REAL RAG service (not mock!)
      const { default: ragService } = await import('./ragService.js');
      await ragService.initialize();

      // Use real RAG module for storage
      this.ragModule = ragService.ragModule;

      // Use real embeddings module
      this.embeddingsModule = ragService.embeddings;

      // Create a simple chunking function since RAG module doesn't expose chunkText
      this.chunkText = (text, chunkSize = 512, overlap = 50) => {
        const chunks = [];
        let startIndex = 0;

        while (startIndex < text.length) {
          const endIndex = Math.min(startIndex + chunkSize, text.length);
          const chunkText = text.substring(startIndex, endIndex);

          if (chunkText.trim()) {
            chunks.push({
              text: chunkText.trim(),
              startIndex,
              endIndex,
              chunkIndex: chunks.length
            });
          }

          startIndex += (chunkSize - overlap);
        }

        return chunks;
      };

      console.log('✅ DocumentProcessingService: Initialization complete with REAL RAG service');
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
      
      // Step 2: Store document in Qdrant using RAG module
      // The RAG module will handle chunking, embedding, and storage internally
      const documentMetadata = {
        materialId: material._id.toString(),
        materialName: material.name,
        materialType: material.type,
        sourceFile: `${material.name}.pdf`,
        uploadedBy: material.uploadedBy.toString(),
        folderId: material.folder.toString(),
        processedAt: new Date().toISOString()
      };

      console.log(`📊 Storing document in Qdrant via RAG module (will be chunked automatically)...`);

      // Call addDocument ONCE with the full text
      await this.ragModule.addDocument(
        extractionResult.text,
        documentMetadata
      );

      console.log(`✅ Document processing complete for ${material.name} - stored in Qdrant`);
      
      return {
        success: true,
        extractedText: extractionResult.text,
        chunks: 1, // RAG module handles chunking internally
        embeddings: 1, // RAG module handles this
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
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🌐 PROCESSING URL MATERIAL`);
    console.log(`${'='.repeat(80)}`);
    console.log(`📍 URL: ${url}`);
    console.log(`📋 Material ID: ${material._id}`);
    console.log(`📝 Material Name: ${material.name}`);
    console.log(`📁 Folder ID: ${material.folder}`);
    console.log(`${'='.repeat(80)}\n`);

    try {
      // Step 1: Detect content type
      console.log(`🔍 Step 1: Detecting content type...`);
      const contentType = await this.detectUrlContentType(url);
      console.log(`✅ Content type detected: ${contentType.type}`);
      console.log(`   MIME type: ${contentType.mimeType || 'N/A'}`);
      console.log(`   Size: ${contentType.size ? `${(contentType.size / 1024).toFixed(2)} KB` : 'Unknown'}\n`);

      let extractedContent = '';
      let metadata = {};

      // Step 2: Process based on content type
      if (contentType.type === 'pdf') {
        console.log(`📄 Step 2: Processing as PDF...`);
        const result = await this.processPdfUrl(url, material);
        extractedContent = result.content;
        metadata = result.metadata;
      } else if (contentType.type === 'html') {
        console.log(`🌐 Step 2: Processing as HTML...`);
        const result = await this.processHtmlUrl(url, material);
        extractedContent = result.content;
        metadata = result.metadata;
      } else {
        console.log(`⚠️  Step 2: Unknown content type, attempting generic text extraction...`);
        const result = await this.processGenericUrl(url, material);
        extractedContent = result.content;
        metadata = result.metadata;
      }

      console.log(`\n📊 Extracted Content Summary:`);
      console.log(`   Total characters: ${extractedContent.length}`);
      console.log(`   Total words: ${extractedContent.split(/\s+/).filter(w => w.length > 0).length}`);
      console.log(`   Preview (first 200 chars): ${extractedContent.substring(0, 200)}...`);
      if (metadata.title) console.log(`   Title: ${metadata.title}`);
      if (metadata.description) console.log(`   Description: ${metadata.description}`);

      // Step 3: Process the extracted content using existing RAG pipeline
      console.log(`\n🔄 Step 3: Processing content through RAG pipeline...`);
      const result = await this.processTextContent(extractedContent, material);

      console.log(`\n${'='.repeat(80)}`);
      console.log(`✅ URL PROCESSING COMPLETE`);
      console.log(`${'='.repeat(80)}`);
      console.log(`📊 Final Statistics:`);
      console.log(`   Chunks created: ${result.chunks}`);
      console.log(`   Embeddings generated: ${result.embeddings}`);
      console.log(`   Qdrant operation ID: ${result.qdrantOperationId || 'N/A'}`);
      console.log(`${'='.repeat(80)}\n`);

      return {
        ...result,
        extractedText: extractedContent,
        metadata: metadata,
        contentType: contentType.type
      };

    } catch (error) {
      console.error(`\n❌ URL PROCESSING FAILED`);
      console.error(`URL: ${url}`);
      console.error(`Error: ${error.message}`);
      console.error(`Stack trace:`, error.stack);
      console.error(`${'='.repeat(80)}\n`);
      throw error;
    }
  }

  /**
   * Detect URL content type by making a HEAD request
   */
  async detectUrlContentType(url) {
    try {
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(url, {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TLEF-Create-Bot/1.0)',
        },
        timeout: 10000
      });

      const contentType = response.headers.get('content-type') || '';
      const contentLength = response.headers.get('content-length');

      let type = 'unknown';
      if (contentType.includes('application/pdf')) {
        type = 'pdf';
      } else if (contentType.includes('text/html')) {
        type = 'html';
      } else if (contentType.includes('text/plain')) {
        type = 'text';
      }

      return {
        type,
        mimeType: contentType,
        size: contentLength ? parseInt(contentLength) : null
      };
    } catch (error) {
      console.warn(`⚠️  Could not detect content type via HEAD request: ${error.message}`);
      // Fallback: guess from URL extension
      if (url.toLowerCase().endsWith('.pdf')) {
        return { type: 'pdf', mimeType: 'application/pdf', size: null };
      } else {
        return { type: 'html', mimeType: 'text/html', size: null };
      }
    }
  }

  /**
   * Ensure service is initialized before use
   */
  async ensureInitialized() {
    if (!this.documentParser) {
      console.log('⚠️  DocumentProcessingService not initialized, initializing now...');
      await this.initialize();
    }
  }

  /**
   * Process PDF URL by downloading and parsing
   */
  async processPdfUrl(url, material) {
    // Ensure service is initialized
    await this.ensureInitialized();

    console.log(`   📥 Downloading PDF from URL...`);
    const fetch = (await import('node-fetch')).default;
    const crypto = await import('crypto');
    const os = await import('os');

    try {
      // Download PDF to temporary file
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TLEF-Create-Bot/1.0)',
        },
        timeout: 60000 // 60 seconds for large PDFs
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const buffer = await response.buffer();
      console.log(`   ✅ Downloaded ${(buffer.length / 1024).toFixed(2)} KB`);

      // Save to temporary file
      const tempFileName = `url-pdf-${crypto.randomBytes(8).toString('hex')}.pdf`;
      const tempFilePath = path.join(os.tmpdir(), tempFileName);
      await fs.writeFile(tempFilePath, buffer);
      console.log(`   💾 Saved to temporary file: ${tempFilePath}`);

      try {
        // Parse PDF using UBC toolkit
        console.log(`   📖 Parsing PDF with UBC GenAI Toolkit...`);
        const parseResult = await this.documentParser.parse(
          { filePath: tempFilePath },
          'text'
        );

        console.log(`   ✅ PDF parsed successfully`);
        console.log(`      Content length: ${parseResult.content.length} characters`);

        return {
          content: parseResult.content,
          metadata: {
            title: parseResult.metadata?.title || material.name,
            source: url,
            contentType: 'pdf'
          }
        };
      } finally {
        // Clean up temporary file
        try {
          await fs.unlink(tempFilePath);
          console.log(`   🗑️  Cleaned up temporary file`);
        } catch (cleanupError) {
          console.warn(`   ⚠️  Could not delete temporary file: ${cleanupError.message}`);
        }
      }
    } catch (error) {
      throw new Error(`PDF download/parse failed: ${error.message}`);
    }
  }

  /**
   * Process HTML URL by fetching and parsing
   */
  async processHtmlUrl(url, material) {
    console.log(`   📥 Fetching HTML content...`);
    const fetch = (await import('node-fetch')).default;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TLEF-Create-Bot/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
        },
        timeout: 30000
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      console.log(`   ✅ Fetched ${(html.length / 1024).toFixed(2)} KB of HTML`);

      // Extract text from HTML
      console.log(`   🧹 Extracting text from HTML...`);
      const extracted = await this.extractTextFromHtml(html);

      console.log(`   ✅ Extracted ${(extracted.content.length / 1024).toFixed(2)} KB of text`);

      return {
        content: extracted.content,
        metadata: {
          title: extracted.title || material.name,
          description: extracted.description,
          source: url,
          contentType: 'html'
        }
      };
    } catch (error) {
      throw new Error(`HTML fetch/parse failed: ${error.message}`);
    }
  }

  /**
   * Process generic URL
   */
  async processGenericUrl(url, material) {
    console.log(`   📥 Fetching generic content...`);
    const fetch = (await import('node-fetch')).default;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TLEF-Create-Bot/1.0)',
        },
        timeout: 30000
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const content = await response.text();
      console.log(`   ✅ Fetched ${(content.length / 1024).toFixed(2)} KB`);

      return {
        content: content.substring(0, 50000), // Limit to 50KB
        metadata: {
          title: material.name,
          source: url,
          contentType: 'text'
        }
      };
    } catch (error) {
      throw new Error(`Generic fetch failed: ${error.message}`);
    }
  }

  /**
   * Extract text from HTML
   */
  async extractTextFromHtml(html) {
    // Simple HTML text extraction without external dependencies
    // Remove scripts and styles
    let text = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<head\b[^<]*(?:(?!<\/head>)<[^<]*)*<\/head>/gi, '');

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : null;

    // Extract meta description
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
    const description = descMatch ? descMatch[1].trim() : null;

    // Remove all HTML tags
    text = text.replace(/<[^>]+>/g, ' ');

    // Decode HTML entities
    text = text
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'");

    // Clean up whitespace
    text = text
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();

    // Check if content seems too short (might be dynamic site)
    if (text.length < 500) {
      console.warn(`   ⚠️  Extracted content is very short (${text.length} chars). Might be a dynamic website.`);
    }

    return {
      content: text,
      title,
      description
    };
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
      // Ensure service is initialized
      await this.ensureInitialized();

      // Prepare metadata for the entire document
      const documentMetadata = {
        materialId: material._id.toString(),
        materialName: material.name,
        materialType: material.type,
        folderId: material.folder.toString(),
        uploadedBy: material.uploadedBy.toString(),
        processedAt: new Date().toISOString()
      };

      console.log(`📊 Storing document in Qdrant via RAG module (will be chunked automatically)...`);

      // Call addDocument ONCE with the full text
      // The RAG module will handle chunking, embedding, and storage
      await this.ragModule.addDocument(
        content,
        documentMetadata
      );

      console.log(`✅ Text processing complete for ${material.name} - stored in Qdrant`);

      return {
        success: true,
        extractedText: content,
        chunks: 1, // RAG module handles chunking internally
        embeddings: 1, // RAG module handles this
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