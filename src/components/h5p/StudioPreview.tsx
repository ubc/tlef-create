import { useEffect, useRef } from 'react';

/** H5P's embed protocol, scoped to this authenticated, same-origin preview. */
export default function StudioPreview({ contentId, title }: { contentId: string; title: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const origin = window.location.origin;
    const respond = (action: string) => frame.contentWindow?.postMessage({ context: 'h5p', action }, origin);
    const setHeight = (height: unknown) => {
      if (typeof height === 'number' && Number.isFinite(height) && height > 0 && height <= 100000) {
        frame.style.height = `${Math.ceil(height)}px`;
      }
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.origin !== origin || event.data?.context !== 'h5p') return;
      const data = event.data;
      if (data.action === 'hello') respond('hello');
      if (data.action === 'prepareResize') {
        // Let the iframe shrink before H5P measures its final scroll height.
        setHeight(data.clientHeight);
        respond('resizePrepared');
      }
      if (data.action === 'resize') setHeight(data.scrollHeight);
    };
    const ready = () => respond('ready');
    const resize = () => respond('resize');
    let width = frame.clientWidth;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (frame.clientWidth !== width) {
        width = frame.clientWidth;
        resize();
      }
    });
    observer?.observe(frame);
    window.addEventListener('message', receive);
    window.addEventListener('resize', resize);
    frame.addEventListener('load', ready);
    ready();
    return () => {
      observer?.disconnect();
      window.removeEventListener('message', receive);
      window.removeEventListener('resize', resize);
      frame.removeEventListener('load', ready);
    };
  }, [contentId]);

  return <iframe
    ref={frameRef}
    className="h5p-studio-preview"
    src={`/api/create/h5p-editor/contents/${encodeURIComponent(contentId)}/preview`}
    title={`Preview ${title}`}
    allowFullScreen
  />;
}
