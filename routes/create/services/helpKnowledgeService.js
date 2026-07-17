import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const HELP_DOCS_DIR = path.join(PROJECT_ROOT, 'docs', 'help');
const CAPABILITIES_PATH = path.join(PROJECT_ROOT, 'src', 'constants', 'questionTypeCapabilities.ts');

const DOCUMENT_METADATA = {
  'overview.md': { routes: ['/'], keywords: ['start', 'workflow', 'how to use', 'create quiz', 'learning object'] },
  'materials.md': { routes: ['/course', '/quiz'], keywords: ['upload', 'file', 'pdf', 'docx', 'url', 'text', 'chunk', 'page', 'reference'] },
  'learning-objectives.md': { routes: ['/quiz'], keywords: ['learning objective', 'lo', 'subpoint', 'bloom', 'coverage', 'enrich'] },
  'quiz-blueprint.md': { routes: ['/quiz'], keywords: ['blueprint', 'plan', 'question count', 'automatic', 'delivery target', 'package format', 'generate'] },
  'question-types.md': { routes: ['/quiz'], keywords: ['question type', 'format', 'column', 'standalone', 'canvas', 'h5p', 'compatibility'] },
  'review-and-export.md': { routes: ['/quiz'], keywords: ['review', 'edit', 'feedback', 'hint', 'export', 'multiple answer', 'canvas'] },
  'coverage-and-references.md': { routes: ['/quiz'], keywords: ['coverage', 'graph', 'reference', 'citation', 'evidence', 'highlight', 'source'] },
  'course-prompts.md': { routes: ['/course'], keywords: ['prompt', 'validate', 'reset', 'history', 'course setting', 'instruction'] },
  'account-and-support.md': { routes: ['/account', '/help'], keywords: ['account', 'api key', 'help', 'support', 'report', 'bug', 'feedback'] },
  'troubleshooting.md': { routes: ['/'], keywords: ['troubleshoot', 'error', 'failed', 'disabled', 'missing', 'retry', 'problem'] },
  'question-type-capabilities': {
    routes: ['/quiz'],
    documentationId: 'question-types',
    documentationSectionMap: {
      'Question Type Compatibility': 'question-type-catalogue',
      'Delivery targets and formats': 'delivery-target-compatibility',
      'Teaching purposes': 'teaching-purpose-defaults'
    },
    retrievalBoost: 8,
    retrievalBoostKeywords: ['compatibility', 'format', 'column', 'standalone', 'canvas', 'h5p', 'set', 'mixed', 'interactive', 'support', 'assess', 'gamify'],
    keywords: ['question type', 'format', 'column', 'standalone', 'canvas', 'h5p']
  }
};

const SYNONYMS = {
  lo: ['learning', 'objective'],
  los: ['learning', 'objectives'],
  mcq: ['multiple', 'choice'],
  quiz: ['question', 'blueprint'],
  rag: ['retrieval', 'material', 'evidence'],
  source: ['reference', 'evidence', 'material'],
  answer: ['option', 'feedback'],
  多选: ['multiple', 'answers'],
  单选: ['single', 'answer'],
  学习目标: ['learning', 'objectives'],
  题目: ['question', 'quiz'],
  题型: ['question', 'type', 'compatibility'],
  问题类型: ['question', 'type', 'compatibility'],
  支持: ['supported', 'compatibility'],
  多少种: ['count', 'question', 'type'],
  材料: ['material', 'source'],
  导出: ['export', 'download'],
  怎么导出: ['export', 'download'],
  如何导出: ['export', 'download']
};

function tokenize(value = '') {
  const normalized = String(value).toLowerCase();
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) || [];
  // Chinese phrases are not whitespace-delimited, so expand known concepts
  // found inside a longer token such as "我们支持多少种题目".
  const phraseExpansions = Object.entries(SYNONYMS)
    .filter(([phrase]) => normalized.includes(phrase))
    .flatMap(([phrase, synonyms]) => [phrase, ...synonyms]);
  const expanded = [...tokens.flatMap(token => [token, ...(SYNONYMS[token] || [])]), ...phraseExpansions];
  return [...new Set(expanded.filter(token => token.length > 1))];
}

function titleFromMarkdown(content, fallback) {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback;
}

function slugifyHeading(value = '') {
  return String(value)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}

function splitMarkdown(content, document) {
  const lines = content.split(/\r?\n/);
  const chunks = [];
  let section = document.title;
  let buffer = [];

  const flush = () => {
    const text = buffer.join('\n').trim();
    if (!text) return;

    for (let start = 0; start < text.length; start += 1500) {
      chunks.push({
        ...document,
        id: `${document.id}:${chunks.length}`,
        documentId: document.id,
        section,
        content: text.slice(start, start + 1800)
      });
    }
    buffer = [];
  };

  for (const line of lines) {
    const heading = line.match(/^#{2,4}\s+(.+)$/);
    if (heading) {
      flush();
      section = heading[1].trim();
    } else if (!line.startsWith('# ')) {
      buffer.push(line);
    }
  }
  flush();
  return chunks;
}

function parseNamedArrays(source, constantName) {
  const start = source.indexOf(`export const ${constantName}`);
  if (start < 0) return [];
  const end = source.indexOf('\n};', start);
  if (end < 0) return [];
  const block = source.slice(start, end);
  const entries = [];
  const matcher = /^\s*(?:'([^']+)'|([\w-]+)):\s*\[([\s\S]*?)\]/gm;
  let match;
  while ((match = matcher.exec(block)) !== null) {
    entries.push({
      name: match[1] || match[2],
      values: [...match[3].matchAll(/'([^']+)'/g)].map(value => value[1])
    });
  }
  return entries;
}

function parseQuestionTypeOptions(source) {
  const start = source.indexOf('export const QUESTION_TYPES:');
  if (start < 0) return [];
  const end = source.indexOf('\n];', start);
  if (end < 0) return [];
  return [...source.slice(start, end).matchAll(/value:\s*'([^']+)'\s*,\s*label:\s*'([^']+)'/g)]
    .map(match => ({ value: match[1], label: match[2] }));
}

function buildCapabilitiesDocument(source) {
  const questionTypes = parseQuestionTypeOptions(source);
  const targets = parseNamedArrays(source, 'QUESTION_TYPES_BY_TARGET');
  const approaches = parseNamedArrays(source, 'QUESTION_TYPES_BY_APPROACH');
  const lines = [
    '# Question Type Compatibility',
    '',
    'These compatibility facts are generated directly from questionTypeCapabilities.ts.',
    '',
    '## Question type catalogue',
    `CREATE currently exposes ${questionTypes.length} question types.`,
    ...questionTypes.map((entry, index) => `${index + 1}. ${entry.label} (${entry.value})`),
    '',
    '## Delivery targets and formats',
    ...targets.map(entry => `${entry.name}: ${entry.values.join(', ')}`),
    '',
    '## Teaching purposes',
    ...approaches.map(entry => `${entry.name}: ${entry.values.join(', ')}`)
  ];
  return lines.join('\n');
}

function documentationTarget(chunk) {
  const documentId = chunk.documentationId || chunk.documentId;
  const mappedSection = chunk.documentationSectionMap?.[chunk.section];
  const section = mappedSection || slugifyHeading(chunk.section);
  return {
    documentId,
    section,
    navigationPath: `/help?doc=${encodeURIComponent(documentId)}&section=${encodeURIComponent(section)}`
  };
}

class HelpKnowledgeService {
  constructor() {
    this.contentHash = null;
    this.chunks = [];
    this.documents = [];
    this.questionTypes = [];
  }

  async loadKnowledge() {
    const fileNames = (await fs.readdir(HELP_DOCS_DIR)).filter(name => name.endsWith('.md')).sort();
    const files = await Promise.all(fileNames.map(async fileName => ({
      fileName,
      content: await fs.readFile(path.join(HELP_DOCS_DIR, fileName), 'utf8')
    })));
    const capabilitiesSource = await fs.readFile(CAPABILITIES_PATH, 'utf8');
    this.questionTypes = parseQuestionTypeOptions(capabilitiesSource);
    files.push({ fileName: 'question-type-capabilities', content: buildCapabilitiesDocument(capabilitiesSource) });

    const nextHash = crypto.createHash('sha256')
      .update(files.map(file => `${file.fileName}\n${file.content}`).join('\n---\n'))
      .digest('hex');

    if (nextHash === this.contentHash) return;

    this.documents = files.map(file => {
      const metadata = DOCUMENT_METADATA[file.fileName] || {};
      return {
        id: file.fileName.replace(/\.[^.]+$/, ''),
        fileName: file.fileName,
        sourcePath: file.fileName === 'question-type-capabilities'
          ? 'src/constants/questionTypeCapabilities.ts'
          : `docs/help/${file.fileName}`,
        title: titleFromMarkdown(file.content, file.fileName),
        content: file.content,
        ...metadata
      };
    });
    this.chunks = this.documents.flatMap(document => splitMarkdown(document.content, document));
    this.contentHash = nextHash;
    console.info('[CREATE Guide] Help knowledge refreshed', {
      documents: this.documents.length,
      chunks: this.chunks.length,
      hash: nextHash.slice(0, 12)
    });
  }

  scoreChunk(chunk, queryTokens, context = {}, boostTokens = queryTokens) {
    const titleTokens = tokenize(`${chunk.title} ${chunk.section} ${(chunk.keywords || []).join(' ')}`);
    const contentTokens = tokenize(chunk.content);
    const route = context.route || '';
    let score = 0;

    for (const token of queryTokens) {
      if (titleTokens.includes(token)) score += 4;
      if (contentTokens.includes(token)) score += 1;
      if (chunk.content.toLowerCase().includes(token)) score += 0.5;
    }

    if ((chunk.routes || []).some(prefix => route.includes(prefix))) score += 2;
    if (context.activeTab && tokenize(chunk.section).includes(context.activeTab.toLowerCase())) score += 1;
    if ((chunk.retrievalBoostKeywords || []).some(keyword => boostTokens.includes(keyword))) {
      score += chunk.retrievalBoost || 0;
    }
    if (queryTokens.includes('count') && chunk.section === 'Question type catalogue') score += 12;
    return score;
  }

  async retrieve(query, context = {}, limit = 5) {
    await this.loadKnowledge();
    const queryTokens = tokenize(`${query} ${context.pageTitle || ''} ${context.activeTab || ''}`);
    const boostTokens = tokenize(query);
    const ranked = this.chunks
      .map(chunk => ({ chunk, score: this.scoreChunk(chunk, queryTokens, context, boostTokens) }))
      .sort((left, right) => right.score - left.score);
    const selected = ranked.filter(result => result.score > 0).slice(0, limit);
    const fallback = selected.length ? selected : ranked.slice(0, Math.min(3, limit));

    return fallback.map(({ chunk, score }, index) => {
      const target = documentationTarget(chunk);
      return {
        id: chunk.id,
        citationIndex: index + 1,
        title: chunk.title,
        section: chunk.section,
        excerpt: chunk.content.replace(/\s+/g, ' ').trim().slice(0, 520),
        content: chunk.content,
        sourcePath: chunk.sourcePath,
        documentId: target.documentId,
        sectionId: target.section,
        navigationPath: target.navigationPath,
        score: Number(score.toFixed(2))
      };
    });
  }

  async getVerifiedFacts(query) {
    await this.loadKnowledge();
    const normalized = String(query || '').toLowerCase();
    const tokens = tokenize(normalized);
    const asksQuestionTypes = (
      normalized.includes('题型')
      || normalized.includes('题目')
      || normalized.includes('问题类型')
      || (tokens.includes('question') && tokens.includes('type'))
    ) && (
      normalized.includes('多少')
      || normalized.includes('几种')
      || normalized.includes('支持')
      || normalized.includes('list')
      || normalized.includes('how many')
      || normalized.includes('available')
    );
    const asksExport = normalized.includes('export') || normalized.includes('导出');
    const isChinese = /[\u3400-\u9fff]/.test(normalized);
    const facts = [];

    if (asksQuestionTypes && this.questionTypes.length) {
      facts.push(isChinese
        ? `CREATE 目前支持 ${this.questionTypes.length} 种题型：${this.questionTypes.map(type => type.label).join('、')}。实际可用题型会根据 Delivery Target、Package Format 和 Teaching Purpose 过滤。[1]`
        : `CREATE currently exposes ${this.questionTypes.length} question types: ${this.questionTypes.map(type => type.label).join(', ')}. Availability is filtered by delivery target, package format, and teaching purpose. [1]`);
    }
    if (asksExport) {
      facts.push(isChinese
        ? 'CREATE 支持 H5P Package、PDF、Markdown 和 Canvas LTI 导出。生成题目后进入 Review & Edit 页面底部的 Export 区域：H5P 会下载 `.h5p` 文件；PDF 和 Markdown 可选择 Questions、Answers 或 Combined；Canvas LTI 会让你选择 Canvas course 和 module。[1][2][3]'
        : 'CREATE supports H5P Package, PDF, Markdown, and Canvas LTI export. After generating questions, use the Export section at the bottom of Review & Edit. H5P downloads a `.h5p` file; PDF and Markdown offer Questions, Answers, or Combined output; Canvas LTI asks for a Canvas course and module. [1][2][3]');
    }
    return facts;
  }

  async getStatus() {
    await this.loadKnowledge();
    return {
      documents: this.documents.length,
      chunks: this.chunks.length,
      contentHash: this.contentHash,
      refreshedAutomatically: true
    };
  }
}

export const helpKnowledgeService = new HelpKnowledgeService();
export default helpKnowledgeService;
