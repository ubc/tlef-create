import { useEffect, useRef, useState } from 'react';
import { canvasApi, CanvasImportResource, CanvasImportReport } from '../services/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import '../styles/components/CanvasMaterialImportModal.css';

interface Props {
  isOpen: boolean;
  folderId: string;
  onClose: () => void;
  onImported?: () => void | Promise<void>;
}
const key = (resource: Pick<CanvasImportResource, 'id' | 'resourceType'>) => `${resource.resourceType}:${resource.id}`;

export default function CanvasMaterialImportModal({ isOpen, folderId, onClose, onImported }: Props) {
  const [state, setState] = useState<'loading' | 'unavailable' | 'connect' | 'ready'>('loading');
  const [courses, setCourses] = useState<Array<{ id: string; name: string; courseCode: string }>>([]);
  const [courseId, setCourseId] = useState('');
  const [resources, setResources] = useState<CanvasImportResource[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [loadingMaterials, setLoadingMaterials] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [limit, setLimit] = useState(10);
  const [maxBytes, setMaxBytes] = useState(50 * 1024 * 1024);
  const [report, setReport] = useState<CanvasImportReport | null>(null);
  const requestId = useRef(0);
  const popupTimer = useRef<ReturnType<typeof setInterval>>();

  async function checkConnection() {
    const current = ++requestId.current;
    setState('loading'); setError('');
    try {
      const config = await canvasApi.getConfig();
      if (current !== requestId.current) return;
      if (!config.data?.enabled) { setState('unavailable'); return; }
      const auth = await canvasApi.getAuthStatus();
      if (current !== requestId.current) return;
      if (!auth.data?.connected) { setState('connect'); return; }
      const result = await canvasApi.getImportCourses(folderId);
      if (current !== requestId.current) return;
      setCourses(result.data?.courses || []); setState('ready');
      setCourseId(''); setResources([]); setSelected(new Set()); setReport(null);
    } catch (err) {
      if (current === requestId.current) { setError(err instanceof Error ? err.message : 'Could not load Canvas. Try again.'); setState('connect'); }
    }
  }
  useEffect(() => {
    const requests = requestId;
    const timer = popupTimer;
    if (isOpen) void checkConnection();
    else setConnecting(false);
    return () => { requests.current++; if (timer.current) clearInterval(timer.current); };
    // The connection is checked once for each opening/course destination.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, folderId]);

  async function connect() {
    // Open synchronously so browser popup blockers don't mistake this for an unsolicited window.
    const popup = window.open('about:blank', 'canvas-material-auth', 'width=600,height=700');
    if (!popup) { setError('Allow pop-ups for CREATE, then select Connect to Canvas again.'); return; }
    setConnecting(true); setError('');
    try {
      const result = await canvasApi.getConnectUrl();
      if (!result.data?.authUrl) throw new Error('Canvas sign-in is unavailable.');
      popup.location.href = result.data.authUrl;
      popupTimer.current = setInterval(() => {
        if (popup.closed) {
          clearInterval(popupTimer.current); setConnecting(false); void checkConnection();
        }
      }, 500);
    } catch (err) { popup.close(); setConnecting(false); setError(err instanceof Error ? err.message : 'Could not connect to Canvas.'); }
  }
  async function loadMaterials(nextCourse: string) {
    const current = ++requestId.current;
    setCourseId(nextCourse); setResources([]); setSelected(new Set()); setReport(null); setWarnings([]); setError(''); setQuery('');
    if (!nextCourse) { setLoadingMaterials(false); return; }
    setLoadingMaterials(true);
    try {
      const result = await canvasApi.getImportMaterials(folderId, nextCourse);
      if (current !== requestId.current) return;
      if (!result.data) throw new Error('Canvas did not return a material list.');
      setResources(result.data.resources); setWarnings(result.data.warnings.map(warning => warning.message));
      setLimit(result.data.batchLimit); setMaxBytes(result.data.maxFileBytes);
    } catch (err) { if (current === requestId.current) setError(err instanceof Error ? err.message : 'Could not load course materials.'); }
    finally { if (current === requestId.current) setLoadingMaterials(false); }
  }
  async function importSelected() {
    if (!selected.size || importing) return;
    setImporting(true); setError('');
    try {
      const result = await canvasApi.importMaterials(folderId, courseId, resources.filter(resource => selected.has(key(resource)))
        .map(({ id, resourceType }) => ({ id, resourceType })));
      if (!result.data) throw new Error('Import results were unavailable. Reload the material list before retrying.');
      setReport(result.data);
      setSelected(new Set(result.data.results.filter(item => item.status === 'failed').map(key)));
      try { await onImported?.(); }
      catch { setError('Import results were saved. Close this window and refresh the CREATE course to update its material list.'); }
    } catch (err) { setError(err instanceof Error ? err.message : 'Import could not finish. Successful materials are kept; retry skips existing content.'); }
    finally { setImporting(false); }
  }
  const visible = resources.filter(resource => resource.name.toLowerCase().includes(query.toLowerCase()));
  const busy = importing || connecting;

  return <Dialog open={isOpen} onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="canvas-material-import" aria-busy={busy} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => event.preventDefault()}>
      <DialogHeader>
        <DialogTitle>Import from Canvas</DialogTitle>
        <DialogDescription>Bring course files and pages into CREATE. Your originals stay in Canvas.</DialogDescription>
      </DialogHeader>
      <div className="canvas-import-body" aria-live="polite">
        {error && <p role="alert" className="canvas-import-notice">{error}</p>}
        {state === 'loading' && <div className="canvas-import-loading" role="status">Loading Canvas courses…</div>}
        {state === 'unavailable' && <p>Canvas is not configured on this server. Ask your CREATE administrator to enable it.</p>}
        {state === 'connect' && <div className="canvas-import-connect">
          <p>Connect your instructor account to choose a Canvas course.</p>
          <button className="btn btn-primary" onClick={() => void connect()} disabled={connecting}>{connecting ? 'Waiting for Canvas sign-in…' : 'Connect to Canvas'}</button>
          <button className="btn btn-outline" disabled={connecting} onClick={() => void checkConnection()}>Check connection</button>
        </div>}
        {state === 'ready' && <>
          <label className="canvas-import-field">Canvas course
            <select className="input" value={courseId} disabled={busy} onChange={event => void loadMaterials(event.target.value)}>
              <option value="">Choose a teaching course</option>
              {courses.map(course => <option key={course.id} value={course.id}>{course.name}</option>)}
            </select>
          </label>
          {!courses.length && <p>No teaching courses found. This import currently requires a Teacher enrollment in Canvas.</p>}
          {warnings.map((warning, index) => <p key={index} role="alert" className="canvas-import-notice">{warning}</p>)}
          {(warnings.length > 0 || error) && <div className="canvas-import-tools">
            <button className="btn btn-outline" disabled={busy} onClick={() => void connect()}>Reconnect Canvas</button>
            <button className="btn btn-outline" disabled={busy || !courseId} onClick={() => void loadMaterials(courseId)}>Reload materials</button>
          </div>}
          {loadingMaterials ? <div className="canvas-import-loading" role="status">Loading course materials…</div> : courseId && <>
            <div className="canvas-import-tools">
              <label className="canvas-import-field">Find a material<input className="input" type="search" value={query} onChange={event => setQuery(event.target.value)} disabled={importing} /></label>
              <button className="btn btn-outline" disabled={busy} onClick={() => setSelected(new Set(visible.filter(item => item.supported).slice(0, limit).map(key)))}>Select up to {limit}</button>
              <button className="btn btn-ghost" disabled={busy || !selected.size} onClick={() => setSelected(new Set())}>Clear</button>
            </div>
            <p className="canvas-import-hint">PDF, DOCX and page text · Up to {Math.round(maxBytes / 1024 / 1024)} MB per file · {selected.size}/{limit} selected</p>
            <div className="canvas-import-list">
              {!visible.length && <p className="canvas-import-empty">{resources.length ? 'No materials match your search.' : warnings.length ? 'No materials could be listed. Review the access messages above.' : 'This Canvas course has no files or pages to import.'}</p>}
              {visible.map(resource => <label key={key(resource)} className={`canvas-import-row ${!resource.supported ? 'is-unsupported' : ''}`}>
                <input type="checkbox" checked={selected.has(key(resource))}
                  disabled={busy || !resource.supported || (!selected.has(key(resource)) && selected.size >= limit)}
                  onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(key(resource)); else next.delete(key(resource)); return next; })} />
                <span><strong>{resource.name}</strong><small>{resource.resourceType === 'page' ? 'Canvas page' : resource.materialType?.toUpperCase() || 'File'}{resource.size !== undefined ? ` · ${(resource.size / 1024).toFixed(1)} KB` : ''}{resource.reason ? ` · ${resource.reason}` : ''}</small></span>
              </label>)}
            </div>
          </>}
        </>}
        {report && <section className="canvas-import-results" aria-label="Import results">
          <h4>{report.summary.imported} imported · {report.summary.skipped} already present · {report.summary.failed} failed</h4>
          {report.results.map(item => <div key={key(item)} className="canvas-import-result"><strong>{item.name}</strong><span>{item.status === 'failed' ? 'Import failed' : item.status === 'skipped' ? 'Already present' : 'Imported'} · {item.message}</span></div>)}
        </section>}
      </div>
      <footer className="canvas-import-footer">
        <p>{importing ? 'Importing selected materials… Keep this window open.' : 'New materials are processed for search. Embedding usage may apply; this does not generate questions.'}</p>
        <div><button className="btn btn-outline" disabled={busy} onClick={onClose}>Close</button>
          {state === 'ready' && <button className="btn btn-primary" disabled={busy || loadingMaterials || !selected.size || !courseId} onClick={() => void importSelected()}>{importing ? 'Importing…' : `Import ${selected.size || ''} selected`}</button>}
        </div>
      </footer>
    </DialogContent>
  </Dialog>;
}
