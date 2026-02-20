/**
 * URL Extract Service
 * Fetches URL content and extracts text for material processing.
 * Supports HTML pages (wikis, articles) and PDF URLs.
 */

import { JSDOM } from 'jsdom';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const MAX_CONTENT_SIZE = 10 * 1024 * 1024; // 10MB
const FETCH_TIMEOUT = 30000; // 30 seconds
const USER_AGENT = 'Mozilla/5.0 (compatible; TLEF-Create-Bot/1.0; +https://tlef.ubc.ca)';

// Selectors for elements that typically contain the main content
const MAIN_CONTENT_SELECTORS = [
  '#mw-content-text',       // MediaWiki (Wikipedia, etc.)
  'article',
  '[role="main"]',
  'main',
  '#content',
  '.post-content',
  '.entry-content',
  '.article-content',
  '.page-content',
  '#bodyContent',            // Older MediaWiki
];

// Elements to remove before text extraction
const REMOVE_SELECTORS = [
  'script', 'style', 'noscript', 'iframe', 'svg',
  'nav', 'footer', 'header', 'aside',
  '.sidebar', '.nav', '.menu', '.toc',
  '.advertisement', '.ad', '.ads',
  '.mw-editsection',        // MediaWiki edit links
  '.navbox', '.catlinks',   // MediaWiki navigation boxes
  '.noprint',               // MediaWiki non-printable content
  '#siteNotice', '#jump-to-nav',
  '[role="navigation"]',
  '[role="banner"]',
  '[aria-hidden="true"]',
];

class UrlExtractService {
  /**
   * Fetch a URL and extract its text content.
   * @param {string} url - The URL to fetch
   * @returns {Promise<{content?: string, tempFilePath?: string}>}
   *   For HTML/text: returns { content: string }
   *   For PDF: returns { tempFilePath: string } (caller must clean up)
   */
  async extract(url) {
    const fetch = (await import('node-fetch')).default;

    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: FETCH_TIMEOUT,
      redirect: 'follow',
      size: MAX_CONTENT_SIZE,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch URL (HTTP ${response.status}): ${response.statusText}`);
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();

    if (contentType.includes('application/pdf')) {
      return this._handlePdf(response);
    }

    if (contentType.includes('text/plain')) {
      const text = await response.text();
      return { content: text.trim() };
    }

    // Default: treat as HTML
    return this._handleHtml(response, url);
  }

  /**
   * Extract text from an HTML response using jsdom.
   */
  async _handleHtml(response, url) {
    const html = await response.text();

    if (!html || html.trim().length === 0) {
      throw new Error('Empty HTML response from URL');
    }

    const dom = new JSDOM(html, { url });
    const document = dom.window.document;

    // Remove non-content elements
    for (const selector of REMOVE_SELECTORS) {
      try {
        document.querySelectorAll(selector).forEach(el => el.remove());
      } catch {
        // Skip invalid selectors silently
      }
    }

    // Try to find main content area
    let contentElement = null;
    for (const selector of MAIN_CONTENT_SELECTORS) {
      contentElement = document.querySelector(selector);
      if (contentElement) break;
    }

    // Fall back to body
    if (!contentElement) {
      contentElement = document.body;
    }

    if (!contentElement) {
      throw new Error('Could not find any content in the page');
    }

    // Extract and clean text
    let text = contentElement.textContent || '';

    // Collapse runs of whitespace but preserve paragraph breaks
    text = text
      .replace(/[ \t]+/g, ' ')           // collapse horizontal whitespace
      .replace(/\n\s*\n/g, '\n\n')       // normalize paragraph breaks
      .replace(/\n{3,}/g, '\n\n')        // max 2 consecutive newlines
      .trim();

    if (text.length === 0) {
      throw new Error('No text content found after parsing HTML');
    }

    console.log(`✅ Extracted ${text.length} characters from HTML URL: ${url}`);
    return { content: text };
  }

  /**
   * Download a PDF response to a temp file.
   * Returns the temp file path — caller is responsible for cleanup.
   */
  async _handlePdf(response) {
    const buffer = Buffer.from(await response.arrayBuffer());
    const tempFileName = `tlef-url-${crypto.randomBytes(8).toString('hex')}.pdf`;
    const tempFilePath = path.join(os.tmpdir(), tempFileName);

    await fs.writeFile(tempFilePath, buffer);
    console.log(`✅ Downloaded PDF (${buffer.length} bytes) to temp file: ${tempFilePath}`);

    return { tempFilePath };
  }
}

export default new UrlExtractService();
