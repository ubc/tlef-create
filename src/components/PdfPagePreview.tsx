import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react';
import {
  getDocument,
  GlobalWorkerOptions,
  Util,
  type PDFDocumentProxy,
  type TextItem
} from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfPagePreviewProps {
  fileUrl: string;
  initialPage: number;
  excerpt?: string;
}

const HIGHLIGHT_STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'been', 'before', 'being', 'between',
  'from', 'have', 'into', 'that', 'their', 'there', 'these', 'they', 'this',
  'those', 'through', 'using', 'were', 'what', 'when', 'where', 'which', 'with'
]);

function normalizedTokens(value = '') {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter(token => token.length >= 4 && !HIGHLIGHT_STOP_WORDS.has(token)) || [];
}

export default function PdfPagePreview({ fileUrl, initialPage, excerpt = '' }: PdfPagePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(Math.max(1, initialPage || 1));
  const [containerWidth, setContainerWidth] = useState(760);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const highlightTokens = useMemo(() => new Set(normalizedTokens(excerpt)), [excerpt]);

  useEffect(() => {
    setPageNumber(Math.max(1, initialPage || 1));
  }, [initialPage]);

  useEffect(() => {
    const loadingTask = getDocument(fileUrl);
    let active = true;

    loadingTask.promise
      .then(document => {
        if (active) setPdf(document);
      })
      .catch(loadError => {
        console.error('Failed to load cited PDF:', loadError);
        if (active) setError('The PDF page could not be rendered.');
      });

    return () => {
      active = false;
      loadingTask.destroy();
    };
  }, [fileUrl]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width;
      if (width) setContainerWidth(width);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf || !canvasRef.current || !textLayerRef.current) return;
    let active = true;
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | null = null;

    const renderPage = async () => {
      setRendering(true);
      setError(null);
      const safePageNumber = Math.min(Math.max(1, pageNumber), pdf.numPages);
      if (safePageNumber !== pageNumber) setPageNumber(safePageNumber);

      try {
        const page = await pdf.getPage(safePageNumber);
        if (!active) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(1.8, Math.max(0.72, (containerWidth - 32) / baseViewport.width));
        const viewport = page.getViewport({ scale });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = canvasRef.current!;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas is unavailable');

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        renderTask = page.render({
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0]
        });
        await renderTask.promise;

        const textContent = await page.getTextContent();
        if (!active) return;
        const textLayer = textLayerRef.current!;
        textLayer.replaceChildren();
        textLayer.style.width = `${viewport.width}px`;
        textLayer.style.height = `${viewport.height}px`;

        for (const item of textContent.items) {
          if (!('str' in item) || !item.str.trim()) continue;
          const textItem = item as TextItem;
          const transform = Util.transform(viewport.transform, textItem.transform);
          const angle = Math.atan2(transform[1], transform[0]);
          const fontHeight = Math.hypot(transform[2], transform[3]);
          const span = document.createElement('span');
          span.textContent = textItem.str;
          span.style.left = `${transform[4]}px`;
          span.style.top = `${transform[5] - fontHeight}px`;
          span.style.fontSize = `${fontHeight}px`;
          span.style.transform = `rotate(${angle}rad)`;

          const itemTokens = normalizedTokens(textItem.str);
          if (safePageNumber === initialPage && itemTokens.some(token => highlightTokens.has(token))) {
            span.classList.add('is-cited-text');
          }
          textLayer.appendChild(span);
        }
      } catch (renderError) {
        if ((renderError as Error).name !== 'RenderingCancelledException') {
          console.error('Failed to render cited PDF page:', renderError);
          if (active) setError('The cited page could not be rendered.');
        }
      } finally {
        if (active) setRendering(false);
      }
    };

    renderPage();
    return () => {
      active = false;
      renderTask?.cancel();
    };
  }, [containerWidth, excerpt, highlightTokens, initialPage, pageNumber, pdf]);

  return (
    <div className="pdf-page-preview" ref={containerRef}>
      <div className="pdf-page-toolbar">
        <button
          type="button"
          onClick={() => setPageNumber(current => Math.max(1, current - 1))}
          disabled={!pdf || pageNumber <= 1}
          aria-label="Previous PDF page"
        >
          <ChevronLeft size={17} />
        </button>
        <span>Page {pageNumber}{pdf ? ` of ${pdf.numPages}` : ''}</span>
        <button
          type="button"
          onClick={() => setPageNumber(current => Math.min(pdf?.numPages || current, current + 1))}
          disabled={!pdf || pageNumber >= pdf.numPages}
          aria-label="Next PDF page"
        >
          <ChevronRight size={17} />
        </button>
      </div>
      <div className="pdf-page-scroll">
        {rendering && <div className="pdf-page-loading"><LoaderCircle size={20} /> Rendering cited page...</div>}
        {error && <div className="pdf-page-error">{error}</div>}
        <div className="pdf-page-surface">
          <canvas ref={canvasRef} />
          <div ref={textLayerRef} className="pdf-citation-text-layer" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
