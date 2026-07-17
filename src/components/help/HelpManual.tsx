import { Fragment, ReactNode, useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronRight, Flag, Search, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import '../../styles/components/HelpManual.css';

const markdownModules = import.meta.glob('../../../docs/help/*.md', {
  eager: true,
  query: '?raw',
  import: 'default'
}) as Record<string, string>;

const DOCUMENT_ORDER = [
  'overview',
  'materials',
  'learning-objectives',
  'quiz-blueprint',
  'question-types',
  'review-and-export',
  'coverage-and-references',
  'course-prompts',
  'account-and-support',
  'troubleshooting'
];

interface ManualSection {
  title: string;
  level: number;
  slug: string;
  lines: string[];
  searchableText: string;
}

interface ManualDocument {
  id: string;
  title: string;
  sections: ManualSection[];
  searchableText: string;
}

function slugifyHelpHeading(value: string) {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}

function parseDocument(id: string, markdown: string): ManualDocument {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const titleLine = lines.find(line => /^#\s+/.test(line));
  const title = titleLine?.replace(/^#\s+/, '').trim() || id;
  const sections: ManualSection[] = [];
  let current: ManualSection = {
    title,
    level: 1,
    slug: slugifyHelpHeading(title),
    lines: [],
    searchableText: ''
  };

  const flush = () => {
    const searchableText = `${current.title} ${current.lines.join(' ')}`.toLowerCase();
    sections.push({ ...current, searchableText });
  };

  for (const line of lines) {
    if (/^#\s+/.test(line)) continue;
    const heading = line.match(/^(#{2,4})\s+(.+)$/);
    if (heading) {
      flush();
      current = {
        title: heading[2].trim(),
        level: heading[1].length,
        slug: slugifyHelpHeading(heading[2]),
        lines: [],
        searchableText: ''
      };
    } else {
      current.lines.push(line);
    }
  }
  flush();

  return {
    id,
    title,
    sections,
    searchableText: `${title} ${sections.map(section => section.searchableText).join(' ')}`
  };
}

function splitTableRow(line: string) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
}

function isBlockStart(lines: string[], index: number) {
  const line = lines[index] || '';
  const next = lines[index + 1] || '';
  return /^\s*(?:[-*]\s+|\d+\.\s+|>\s?|```)/.test(line)
    || (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(next));
}

function renderInline(value: string, keyPrefix: string): ReactNode[] {
  const tokenPattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  return value.split(tokenPattern).filter(Boolean).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const external = /^https?:\/\//.test(link[2]);
      return (
        <a key={key} href={link[2]} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}>
          {link[1]}
        </a>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

function renderBlocks(lines: string[], keyPrefix: string) {
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.trim().startsWith('```')) {
      const language = line.trim().slice(3);
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(<pre key={`${keyPrefix}-code-${index}`} data-language={language || undefined}><code>{code.join('\n')}</code></pre>);
      continue;
    }

    if (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] || '')) {
      const headers = splitTableRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push(
        <div className="help-manual-table-wrap" key={`${keyPrefix}-table-${index}`}>
          <table>
            <thead><tr>{headers.map((cell, cellIndex) => <th key={cellIndex}>{renderInline(cell, `${keyPrefix}-th-${cellIndex}`)}</th>)}</tr></thead>
            <tbody>{rows.map((row, rowIndex) => (
              <tr key={rowIndex}>{headers.map((_, cellIndex) => <td key={cellIndex}>{renderInline(row[cellIndex] || '', `${keyPrefix}-td-${rowIndex}-${cellIndex}`)}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      );
      continue;
    }

    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    if (unordered) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s*[-*]\s+(.+)$/);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      blocks.push(<ul key={`${keyPrefix}-ul-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item, `${keyPrefix}-uli-${itemIndex}`)}</li>)}</ul>);
      continue;
    }

    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ordered) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s*\d+\.\s+(.+)$/);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      blocks.push(<ol key={`${keyPrefix}-ol-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item, `${keyPrefix}-oli-${itemIndex}`)}</li>)}</ol>);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push(<blockquote key={`${keyPrefix}-quote-${index}`}>{renderInline(quote.join(' '), `${keyPrefix}-quote`)}</blockquote>);
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(<p key={`${keyPrefix}-p-${index}`}>{renderInline(paragraph.join(' '), `${keyPrefix}-p`)}</p>);
  }

  return blocks;
}

function sectionElementId(documentId: string, sectionSlug: string) {
  return `help-${documentId}-${sectionSlug}`;
}

let citationHighlightTimer: number | undefined;

function highlightHelpSection(documentId: string, sectionSlug: string) {
  const target = document.getElementById(sectionElementId(documentId, sectionSlug));
  if (!target) return;

  document.querySelectorAll('.help-manual-section.is-citation-highlight').forEach(element => {
    element.classList.remove('is-citation-highlight');
  });
  if (citationHighlightTimer) window.clearTimeout(citationHighlightTimer);
  window.requestAnimationFrame(() => {
    target.classList.add('is-citation-highlight');
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  citationHighlightTimer = window.setTimeout(() => target.classList.remove('is-citation-highlight'), 6000);
}

const HelpManual = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const targetDocument = searchParams.get('doc') || '';
  const targetSection = searchParams.get('section') || '';

  const documents = useMemo(() => {
    const parsed = Object.entries(markdownModules).map(([path, content]) => {
      const id = path.split('/').pop()?.replace(/\.md$/, '') || path;
      return parseDocument(id, content);
    });
    return parsed.sort((left, right) => {
      const leftIndex = DOCUMENT_ORDER.indexOf(left.id);
      const rightIndex = DOCUMENT_ORDER.indexOf(right.id);
      return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex) || left.title.localeCompare(right.title);
    });
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleDocuments = useMemo(() => {
    if (!normalizedQuery) return documents;
    return documents.map(document => ({
      ...document,
      sections: document.sections.filter(section => section.searchableText.includes(normalizedQuery))
    })).filter(document => document.title.toLowerCase().includes(normalizedQuery) || document.sections.length > 0);
  }, [documents, normalizedQuery]);

  const matchingSections = visibleDocuments.reduce((count, document) => count + document.sections.length, 0);

  useEffect(() => {
    if (!targetDocument || !targetSection) return;
    highlightHelpSection(targetDocument, targetSection);
  }, [targetDocument, targetSection]);

  useEffect(() => {
    const handleReference = (event: Event) => {
      const detail = (event as CustomEvent<{ documentId?: string; sectionId?: string }>).detail;
      if (detail?.documentId && detail.sectionId) {
        setQuery('');
        window.setTimeout(() => highlightHelpSection(detail.documentId!, detail.sectionId!), 0);
      }
    };
    window.addEventListener('tlef:help-reference', handleReference);
    return () => window.removeEventListener('tlef:help-reference', handleReference);
  }, []);

  const openSection = (documentId: string, sectionSlug: string) => {
    setQuery('');
    setSearchParams({ doc: documentId, section: sectionSlug });
  };

  return (
    <div className="help-manual-page">
      <header className="help-manual-hero">
        <div className="help-manual-eyebrow"><BookOpen size={15} /> CREATE product manual</div>
        <div className="help-manual-hero-row">
          <div>
            <h1>Help Center</h1>
            <p>One guide for materials, learning objectives, question planning, references, review, export, and support.</p>
          </div>
          <Link className="help-manual-report-link" to="/account?report=1"><Flag size={16} /> Report an issue</Link>
        </div>
        <label className="help-manual-search">
          <Search size={18} />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search the CREATE manual" aria-label="Search the CREATE manual" />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X size={16} /></button>}
        </label>
        {normalizedQuery && <p className="help-manual-result-count">{matchingSections} matching section{matchingSections === 1 ? '' : 's'}</p>}
      </header>

      <div className="help-manual-layout">
        <aside className="help-manual-toc" aria-label="Help topics">
          <strong>In this guide</strong>
          <nav>
            {documents.map(document => (
              <div className="help-manual-toc-group" key={document.id}>
                <button type="button" onClick={() => openSection(document.id, document.sections[0].slug)}>
                  <span>{document.title}</span><ChevronRight size={14} />
                </button>
                <div>
                  {document.sections.filter(section => section.level === 2).map(section => (
                    <button type="button" key={section.slug} onClick={() => openSection(document.id, section.slug)}>{section.title}</button>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        <main className="help-manual-content">
          {visibleDocuments.length === 0 ? (
            <div className="help-manual-empty">
              <Search size={28} />
              <h2>No matching help section</h2>
              <p>Try a shorter term such as “question count”, “reference”, “Canvas”, or “report”.</p>
              <button type="button" onClick={() => setQuery('')}>Clear search</button>
            </div>
          ) : visibleDocuments.map(document => (
            <article className="help-manual-document" key={document.id} data-help-document={document.id}>
              {document.sections.map(section => {
                const heading = section.level === 1
                  ? <h1>{section.title}</h1>
                  : section.level === 2
                    ? <h2>{section.title}</h2>
                    : section.level === 3
                      ? <h3>{section.title}</h3>
                      : <h4>{section.title}</h4>;
                return (
                  <section
                    className={`help-manual-section level-${section.level}`}
                    id={sectionElementId(document.id, section.slug)}
                    data-help-doc={document.id}
                    data-help-section={section.slug}
                    key={`${document.id}-${section.slug}`}
                  >
                    {heading}
                    {renderBlocks(section.lines, `${document.id}-${section.slug}`)}
                  </section>
                );
              })}
            </article>
          ))}
        </main>
      </div>
    </div>
  );
};

export default HelpManual;
