import { useEffect, useRef } from 'react';
import { studioAssistantApi } from '../../../services/api';

export default function PreparedQuestionPreview({ id, version }: { id: string; version: number }) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const resize = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow
        || event.data?.type !== 'tlef:h5p-preview-height') return;
      const height = event.data.height;
      if (typeof height === 'number' && Number.isFinite(height)) frame.current.style.height = `${Math.max(320, Math.min(20000, Math.ceil(height)))}px`;
    };
    window.addEventListener('message', resize);
    return () => window.removeEventListener('message', resize);
  }, []);
  return <iframe ref={frame} className="authoring-prepared-preview" title="Checked question set preview"
    src={studioAssistantApi.previewUrl(id, version)} sandbox="allow-scripts" />;
}
