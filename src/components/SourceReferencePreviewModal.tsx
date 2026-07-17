import { useEffect, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { MaterialReferenceDetail, materialsApi, SourceReference } from '../services/api';
import PdfPagePreview from './PdfPagePreview';
import '../styles/components/SourceReferencePreviewModal.css';

interface SourceReferencePreviewModalProps {
  reference: SourceReference;
  onClose: () => void;
}

export default function SourceReferencePreviewModal({ reference, onClose }: SourceReferencePreviewModalProps) {
  const [detail, setDetail] = useState<MaterialReferenceDetail | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    const loadPreview = async () => {
      try {
        const referenceDetail = await materialsApi.getReference(reference);
        if (!active) return;
        setDetail(referenceDetail);

        if (referenceDetail.hasSourceFile && reference.materialId) {
          const file = await materialsApi.getSourceFile(reference.materialId);
          if (!active) return;
          objectUrl = URL.createObjectURL(file);
          setFileUrl(objectUrl);
        }
      } catch (previewError) {
        console.error('Failed to load source reference preview:', previewError);
        if (active) setError('The source preview could not be loaded.');
      } finally {
        if (active) setLoading(false);
      }
    };

    loadPreview();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [reference]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const pageNumber = detail?.pageNumber || reference.pageNumber;
  const isPdf = detail?.previewKind === 'pdf' && Boolean(fileUrl);
  const citedExcerpt = reference.excerpt || detail?.excerpt || '';
  const locationLabel = pageNumber
    ? `Page ${pageNumber}`
    : detail?.previewKind === 'url'
      ? 'Web source'
      : detail?.previewKind === 'document'
        ? 'Word document'
        : 'Text source';

  return (
    <div className="source-preview-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="source-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-preview-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="source-preview-header">
          <div>
            <span className="source-preview-eyebrow">Source evidence</span>
            <h3 id="source-preview-title">{detail?.materialName || reference.materialName || 'Course material'}</h3>
            <p>
              {[locationLabel, detail?.section || reference.section].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close source preview">
            <X size={20} />
          </button>
        </header>

        {loading && <div className="source-preview-status">Loading the cited source...</div>}
        {error && <div className="source-preview-status source-preview-error">{error}</div>}

        {!loading && !error && (
          <div className={`source-preview-body ${isPdf ? 'has-pdf' : 'has-text-preview'}`}>
            {isPdf && fileUrl && (
              <div className="source-preview-document">
                <PdfPagePreview
                  fileUrl={fileUrl}
                  initialPage={pageNumber || 1}
                  excerpt={citedExcerpt}
                />
              </div>
            )}
            {!isPdf && (
              <div className="source-preview-text-document">
                <div className="source-preview-text-heading">
                  <span>{locationLabel}</span>
                  <strong>{detail?.section || 'Extracted material context'}</strong>
                </div>
                <HighlightedContext
                  context={detail?.pageContext || detail?.excerpt || ''}
                  excerpt={citedExcerpt}
                />
              </div>
            )}
            <aside className="source-preview-evidence">
              <div className="source-preview-location">
                <strong>Cited passage</strong>
                {detail?.pageCount && pageNumber && <span>Page {pageNumber} of {detail.pageCount}</span>}
              </div>
              <blockquote><mark>{citedExcerpt || 'No extracted text is available for this reference.'}</mark></blockquote>
              {detail?.pageContext && detail.pageContext !== detail.excerpt && (
                <details>
                  <summary>Show page context</summary>
                  <p>{detail.pageContext}</p>
                </details>
              )}
              {isPdf && fileUrl && (
                <a className="source-preview-open" href={`${fileUrl}#page=${pageNumber || 1}`} target="_blank" rel="noreferrer">
                  Open full PDF <ExternalLink size={15} />
                </a>
              )}
              {detail?.previewKind === 'url' && detail.sourceUrl && (
                <a className="source-preview-open" href={detail.sourceUrl} target="_blank" rel="noreferrer">
                  Open original webpage <ExternalLink size={15} />
                </a>
              )}
              {detail?.previewKind === 'document' && fileUrl && (
                <a className="source-preview-open" href={fileUrl} download={detail.sourceFile || detail.materialName}>
                  Download original Word file <ExternalLink size={15} />
                </a>
              )}
            </aside>
          </div>
        )}
      </section>
    </div>
  );
}

function HighlightedContext({ context, excerpt }: { context: string; excerpt: string }) {
  if (!context) {
    return <p className="source-preview-empty">No extracted text is available for this material.</p>;
  }

  const directIndex = excerpt ? context.toLowerCase().indexOf(excerpt.toLowerCase()) : -1;
  if (directIndex < 0) {
    return (
      <div className="source-preview-context-copy">
        {excerpt && <mark className="source-preview-citation-fallback">{excerpt}</mark>}
        <p>{context}</p>
      </div>
    );
  }

  return (
    <p className="source-preview-context-copy">
      {context.slice(0, directIndex)}
      <mark>{context.slice(directIndex, directIndex + excerpt.length)}</mark>
      {context.slice(directIndex + excerpt.length)}
    </p>
  );
}
