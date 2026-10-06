import { useEffect, useRef, useState } from 'react';
import { BookOpen, Check, ChevronLeft, FileText, Search, Target, Upload, X } from 'lucide-react';
import { studioAuthoringApi, type AuthoringContextCatalog } from '../../../services/api';

export type ContextTool = 'tools' | 'course' | 'material' | 'objective';
export interface ContextChip { id: string; kind: 'course' | 'material' | 'objective'; name: string; preview: string; status?: string }
export const ContextIcon = ({ kind }: { kind: ContextChip['kind'] }) => kind === 'course' ? <BookOpen size={16} /> : kind === 'objective' ? <Target size={16} /> : <FileText size={16} />;

export default function AuthoringContextPicker({ courseId, initialTool = 'tools', selected, onCourse, onSelect, onUpload, onClose, mention, query = '' }: {
  courseId: string; initialTool?: ContextTool; selected: ContextChip[]; onCourse: (id: string, pin: boolean) => void;
  onSelect: (kind: 'material' | 'objective', id: string) => void; onUpload: () => void; onClose: () => void;
  mention?: { left: number; top: number }; query?: string;
}) {
  const [tool, setTool] = useState(initialTool);
  const [browseCourse, setBrowseCourse] = useState(courseId);
  const [search, setSearch] = useState(query);
  const [catalog, setCatalog] = useState<AuthoringContextCatalog>({ courses: [], materials: [], objectives: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => setSearch(query), [query]);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    studioAuthoringApi.context(browseCourse || undefined).then(result => { if (active && result.data) setCatalog(result.data); })
      .catch(() => { if (active) setError('Could not load your context. Close and reopen to retry.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [browseCourse]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !(event.target as Element).closest?.('.authoring-composer textarea')) onClose(); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [onClose]);
  const chooseTool = (next: ContextTool) => { setTool(next); setSearch(''); };
  const matching = (value: string) => value.toLowerCase().includes(search.toLowerCase());
  const selectCourse = (id: string) => {
    if (tool === 'course') { onCourse(id, true); onClose(); }
    else { setBrowseCourse(id); setSearch(''); }
  };
  const showCourses = tool === 'course' || (tool !== 'tools' && !browseCourse);
  const items = showCourses ? catalog.courses : tool === 'material' ? catalog.materials : catalog.objectives;
  return <div ref={root} className={`authoring-context-popover ${mention ? 'is-mention' : ''}`} role="dialog" aria-label="Add context"
    style={mention ? { left: mention.left, top: mention.top } : undefined}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
        const options = Array.from(root.current?.querySelectorAll('[role="option"]:not(:disabled)') || []) as HTMLButtonElement[];
        if (!options.length) return;
        event.preventDefault(); const index = options.indexOf(document.activeElement as HTMLButtonElement);
        options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length].focus();
      }
    }}>
    <header>{tool !== 'tools' && <button type="button" aria-label="Back to context tools" onClick={() => chooseTool('tools')}><ChevronLeft size={16} /></button>}<strong>{tool === 'tools' ? 'Add to your conversation' : showCourses ? 'Choose a course' : tool === 'material' ? 'Course materials' : 'Learning objectives'}</strong><button type="button" aria-label="Close context picker" onClick={onClose}><X size={16} /></button></header>
    <label className="authoring-context-search"><Search size={15} /><input aria-label="Search context" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" /></label>
    <div role="listbox" aria-label="Context options">
      {tool === 'tools' ? <>{[
        { id: 'upload', label: 'Upload files', detail: 'PDF or DOCX · add teaching material', icon: <Upload size={18} /> },
        { id: 'course', label: 'Course', detail: 'Explore your materials and LOs in a course', icon: <BookOpen size={18} /> },
        { id: 'material', label: 'Materials', detail: 'Reference source documents', icon: <FileText size={18} /> },
        { id: 'objective', label: 'Learning objectives', detail: 'Build on existing LOs', icon: <Target size={18} /> }
      ].filter(item => matching(item.label)).map(item => <button role="option" aria-selected={false} type="button" key={item.id} onClick={() => item.id === 'upload' ? onUpload() : chooseTool(item.id as ContextTool)}>{item.icon}<span><strong>{item.label}</strong><small>{item.detail}</small></span></button>)}</> : loading ? <p>Loading your context…</p> : error ? <p role="alert">{error}</p> : <>
        {!showCourses && <button type="button" onClick={() => { setBrowseCourse(''); setSearch(''); }}><ChevronLeft size={14} />{catalog.courses.find(c => c.id === browseCourse)?.name} · change course</button>}
        {items.filter(item => matching(item.name)).map(item => {
          const kind = showCourses ? 'course' : tool === 'material' ? 'material' : 'objective';
          const checked = selected.some(chip => chip.id === item.id && chip.kind === kind);
          return <button type="button" role="option" aria-selected={checked} disabled={!checked && !showCourses && ((kind === 'material' && ('status' in item && item.status === 'failed' || selected.filter(c => c.kind === kind).length >= 20)) || (kind === 'objective' && selected.filter(c => c.kind === kind).length >= 8))} key={item.id} onClick={() => { if (showCourses) selectCourse(item.id); else { onCourse(browseCourse, false); onSelect(kind as 'material' | 'objective', item.id); onClose(); } }}><ContextIcon kind={kind} /><span><strong>{item.name}</strong><small>{'status' in item ? item.status : 'quizName' in item ? item.quizName : item.description || 'Course context'}</small></span>{checked && <Check size={15} />}</button>;
        })}
        {!items.filter(item => matching(item.name)).length && <p>No matching context. You can continue with a text-only idea or upload a file.</p>}
      </>}
    </div>
  </div>;
}

// Locate the caret using a text mirror; no browser-selection heuristics or portal offsets.
export function caretAnchor(input: HTMLTextAreaElement) {
  const mirror = document.createElement('div'); const computed = getComputedStyle(input);
  for (const property of ['font', 'fontSize', 'lineHeight', 'letterSpacing', 'padding', 'border', 'boxSizing', 'width', 'wordSpacing'] as const) mirror.style[property] = computed[property];
  Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', top: '0', left: '0' });
  mirror.textContent = input.value.slice(0, input.selectionStart);
  const marker = document.createElement('span'); marker.textContent = '\u200b'; mirror.append(marker); input.parentElement!.append(mirror);
  const anchor = { left: Math.max(0, Math.min(marker.offsetLeft, input.clientWidth - 320)), top: Math.max(12, input.offsetTop + marker.offsetTop - input.scrollTop) };
  mirror.remove(); return anchor;
}
