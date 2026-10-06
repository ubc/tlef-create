import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, FilePlus2, Loader2, MoreHorizontal, Upload } from 'lucide-react';

interface Props {
  disabled: boolean;
  importing?: boolean;
  onImport?: () => void;
  onNewBlank?: () => void;
  onAdvanced: () => void;
  onReturnCoursePlan?: () => void;
}

export default function AuthoringStudioActions({ disabled, importing, onImport, onNewBlank, onAdvanced, onReturnCoursePlan }: Props) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  const choose = (action: () => void) => {
    setOpen(false);
    trigger.current?.focus();
    action();
  };

  return <div className="authoring-studio-actions" ref={anchor}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}
    onKeyDown={event => {
      if (open && event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
      }
    }}>
    <button ref={trigger} className="authoring-icon" aria-label="More Studio actions" title="More Studio actions"
      aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}><MoreHorizontal size={20} /></button>
    {open && <div id={id} className="authoring-studio-actions-panel" role="group" aria-label="Other Studio actions">
      <span className="authoring-studio-actions-label">H5P Studio</span>
      {onImport && <button disabled={disabled || importing} onClick={() => choose(onImport)}>
        {importing ? <Loader2 className="spin" size={17} /> : <Upload size={17} />}<span>{importing ? 'Importing…' : 'Import .h5p'}</span>
      </button>}
      {onNewBlank && <button disabled={disabled} onClick={() => choose(onNewBlank)}><FilePlus2 size={17} /><span>New blank activity</span></button>}
      <button disabled={disabled} onClick={() => choose(onAdvanced)}><ArrowUpRight size={17} /><span>Advanced types</span></button>
      {onReturnCoursePlan && <button disabled={disabled} onClick={() => choose(onReturnCoursePlan)}><ArrowUpRight size={17} /><span>Return to course plan</span></button>}
    </div>}
  </div>;
}
