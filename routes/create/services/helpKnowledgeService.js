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
  'quiz-blueprint.md': { routes: ['/quiz'], keywords: ['blueprint', 'plan', 'question count', 'automatic', 'delivery target', 'package format', 'generate', 'layout preview', 'teaching purpose', 'assess', 'support', 'gamify', 'back to ai plan configuration'] },
  'question-types.md': { routes: ['/quiz'], keywords: ['question type', 'format', 'column', 'standalone', 'canvas', 'h5p', 'compatibility'] },
  'review-and-export.md': { routes: ['/quiz'], keywords: ['review', 'edit', 'feedback', 'hint', 'export', 'multiple answer', 'canvas'] },
  'h5p-studio.md': { routes: ['/h5p-studio', '/quiz'], keywords: ['h5p studio', 'advanced editor', 'upload h5p', 'native h5p', 'semantics', 'content type', 'create with ai', 'ai draft', 'saved template', 'memory game', 'activity type', 'needs maintenance'] },
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

const QUERY_STOP_WORDS = new Set('a an and are as at be by did do does for from how i if in is it my of on or that the these this to was what when where which why will with you your'.split(' '));

function tokenize(value = '') {
  const normalized = String(value).toLowerCase();
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) || [];
  // Chinese phrases are not whitespace-delimited, so expand known concepts
  // found inside a longer token such as "我们支持多少种题目".
  const phraseExpansions = Object.entries(SYNONYMS)
    .filter(([phrase]) => /[\u3400-\u9fff]/.test(phrase) && normalized.includes(phrase))
    .flatMap(([phrase, synonyms]) => [phrase, ...synonyms]);
  const expanded = [...tokens.flatMap(token => [token, ...(SYNONYMS[token] || [])]), ...phraseExpansions];
  return [...new Set(expanded.filter(token => token.length > 1))];
}

function phraseWords(value = '') {
  return (String(value).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).join(' ');
}

function containsPhrase(text, phrase) {
  const normalized = phraseWords(phrase);
  return normalized.split(' ').length >= 2 && ` ${phraseWords(text)} `.includes(` ${normalized} `);
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
  const available = new Set(targets.flatMap(entry => entry.values));
  const lines = [
    '# Question Type Compatibility',
    '',
    'These compatibility facts are generated directly from questionTypeCapabilities.ts.',
    '',
    '## Question type catalogue',
    `CREATE's catalogue contains ${questionTypes.length} question types; ${questionTypes.filter(entry => available.has(entry.value)).length} are currently available for new activities.`,
    ...questionTypes.map((entry, index) => `${index + 1}. ${entry.label} (${entry.value})${available.has(entry.value) ? '' : ' — temporarily unavailable; existing records are retained'}`),
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

function citationSource(chunk, citationIndex, score = 0) {
  const target = documentationTarget(chunk);
  return {
    id: chunk.id,
    citationIndex,
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
}

class HelpKnowledgeService {
  constructor() {
    this.contentHash = null;
    this.chunks = [];
    this.documents = [];
    this.questionTypes = [];
    this.availableQuestionTypes = [];
  }

  async loadKnowledge() {
    const fileNames = (await fs.readdir(HELP_DOCS_DIR)).filter(name => name.endsWith('.md')).sort();
    const files = await Promise.all(fileNames.map(async fileName => ({
      fileName,
      content: await fs.readFile(path.join(HELP_DOCS_DIR, fileName), 'utf8')
    })));
    const capabilitiesSource = await fs.readFile(CAPABILITIES_PATH, 'utf8');
    this.questionTypes = parseQuestionTypeOptions(capabilitiesSource);
    const available = new Set(parseNamedArrays(capabilitiesSource, 'QUESTION_TYPES_BY_TARGET').flatMap(entry => entry.values));
    this.availableQuestionTypes = this.questionTypes.filter(type => available.has(type.value));
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
    this.tokenDocumentFrequency = new Map();
    for (const chunk of this.chunks) {
      for (const token of tokenize(chunk.content)) {
        this.tokenDocumentFrequency.set(token, (this.tokenDocumentFrequency.get(token) || 0) + 1);
      }
    }
    this.contentHash = nextHash;
    console.info('[CREATE Guide] Help knowledge refreshed', {
      documents: this.documents.length,
      chunks: this.chunks.length,
      hash: nextHash.slice(0, 12)
    });
  }

  scoreChunk(chunk, queryTokens, context = {}, boostTokens = queryTokens, query = '') {
    const titleTokens = tokenize(`${chunk.title} ${chunk.section} ${(chunk.keywords || []).join(' ')}`);
    const sectionTokens = tokenize(chunk.section);
    const contentTokens = tokenize(chunk.content);
    const route = context.route || '';
    let score = 0;

    for (const token of queryTokens) {
      if (titleTokens.includes(token)) score += 4;
      // Break broad-keyword ties in favor of the section about the action,
      // without displacing the established content/context ranking.
      if (sectionTokens.includes(token)) score += 0.1;
      if (contentTokens.includes(token)) score += 1;
      if (chunk.content.toLowerCase().includes(token)) score += 0.5;
    }

    // Specific user terms (for example a provider error) distinguish an answer
    // from new pages that repeat broad workflow labels. Context and expanded
    // document keywords must not receive this rarity bonus.
    for (const token of boostTokens) {
      if (!QUERY_STOP_WORDS.has(token) && contentTokens.includes(token)) {
        score += Math.log(1 + this.chunks.length / (this.tokenDocumentFrequency?.get(token) || 1));
      }
    }
    if (containsPhrase(query, chunk.section)) score += 20;
    const matchedLabels = [...chunk.content.matchAll(/\*\*([^*\n]+)\*\*/g)]
      .map(match => phraseWords(match[1])).filter(label => containsPhrase(query, label));
    score += Math.min(new Set(matchedLabels).size * 6, 12);

    if ((chunk.routes || []).some(prefix => route.includes(prefix))) score += 2;
    if (context.activeTab && tokenize(chunk.section).includes(context.activeTab.toLowerCase())) score += 1;
    // An explicitly active help surface should not be displaced by several
    // generic "Quiz" matches when new documentation is added to the corpus.
    if (context.activeTab && tokenize(context.activeTab).some(token => tokenize(chunk.section).includes(token))) score += 4;
    const activeTokens = tokenize(context.activeTab || '');
    if (activeTokens.length && activeTokens.every(token => tokenize(chunk.title).includes(token))) score += 4;
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
      .map(chunk => ({ chunk, score: this.scoreChunk(chunk, queryTokens, context, boostTokens, query) }))
      .sort((left, right) => right.score - left.score);
    const selected = ranked.filter(result => result.score > 0).slice(0, limit);
    const fallback = selected.length ? selected : ranked.slice(0, Math.min(3, limit));

    return fallback.map(({ chunk, score }, index) => citationSource(chunk, index + 1, score));
  }

  async getVerifiedFacts(query) {
    return (await this.getVerifiedAnswer(query)).facts;
  }

  async getVerifiedAnswer(query) {
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
    const sources = [];
    // Deterministic statements must cite the documents they were derived from,
    // not whichever unrelated page won the ambient-context lexical ranking.
    const cite = (fileName, section) => {
      const chunk = this.chunks.find(item => item.fileName === fileName && item.section === section);
      if (!chunk) return '';
      let source = sources.find(item => item.id === chunk.id);
      if (!source) {
        source = citationSource(chunk, sources.length + 1);
        sources.push(source);
      }
      return `[${source.citationIndex}]`;
    };

    if (asksQuestionTypes && this.questionTypes.length) {
      const catalogue = cite('question-type-capabilities', 'Question type catalogue');
      const compatibility = cite('question-types.md', 'Teaching-purpose defaults');
      const paused = this.questionTypes.filter(type => !this.availableQuestionTypes.some(available => available.value === type.value));
      if (catalogue && compatibility) facts.push(isChinese
        ? `CREATE 目录共有 ${this.questionTypes.length} 种题型，目前 ${this.availableQuestionTypes.length} 种可用于新建活动：${this.availableQuestionTypes.map(type => type.label).join('、')}。${paused.length ? `${paused.map(type => type.label).join('、')} 暂停使用，已有记录保留。` : ''}${catalogue}实际可用题型还会根据 Delivery Target、Package Format 和 Teaching Purpose 过滤。${compatibility}`
        : `CREATE's catalogue contains ${this.questionTypes.length} question types; ${this.availableQuestionTypes.length} are currently available for new activities: ${this.availableQuestionTypes.map(type => type.label).join(', ')}.${paused.length ? ` ${paused.map(type => type.label).join(', ')} is temporarily unavailable; existing records are retained.` : ''} ${catalogue} Availability is also filtered by delivery target, package format, and teaching purpose. ${compatibility}`);
    }
    if (asksExport) {
      const workflow = cite('review-and-export.md', 'Review, Edit, and Export');
      const handout = cite('review-and-export.md', 'PDF and Markdown export');
      const h5p = cite('review-and-export.md', 'H5P export');
      const canvas = cite('review-and-export.md', 'Canvas export');
      if (workflow && handout && h5p && canvas) facts.push(isChinese
        ? `CREATE 支持 H5P Package、PDF、Markdown 和 Canvas LTI 导出。生成并检查题目后，进入第 5 步 Preview & Export。${workflow}\nPDF 和 Markdown 可选择 Questions（仅题目，不含答案区）、Answers 或 Combined。${handout}\nH5P 会下载 \`.h5p\` 文件。${h5p} Canvas LTI 需要有效的 Canvas 连接，然后按界面选择目标位置。${canvas}`
        : `CREATE supports H5P Package, PDF, Markdown, and Canvas LTI export. After generating and reviewing questions, open Step 5, Preview & Export. ${workflow}\nPDF and Markdown offer Questions (without the answer section), Answers, or Combined output. ${handout}\nH5P downloads a \`.h5p\` file. ${h5p} Canvas LTI requires a valid Canvas connection; follow its destination workflow. ${canvas}`);
    }
    const used = new Set(facts.join('\n').match(/\[\d+\]/g) || []);
    return { facts, sources: sources.filter(source => used.has(`[${source.citationIndex}]`)) };
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
