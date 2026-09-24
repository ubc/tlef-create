import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Plus, RefreshCw, Upload } from 'lucide-react';
import {
  ApiError, foldersApi, materialsApi, studioAssistantApi,
  type Folder, type Material, type StudioAssistantCapabilities, type SourceReference,
  type StudioAssistantSession, type StudioAssistantObjective, type StudioAssistantPlanItem,
} from '../../services/api';
import { usePubSub } from '../../hooks/usePubSub';
import { useSSE } from '../../hooks/useSSE';
import { API_URL } from '../../config/api';
import { PUBSUB_EVENTS } from '../../services/pubsubService';
import SourceReferencePreviewModal from '../SourceReferencePreviewModal';
import { useSystemDialog } from '../system-dialog/SystemDialogProvider';

type PlanDraft = Omit<StudioAssistantPlanItem, 'count'> & { count: string };
type LiveQuestionDraft = { text: string; status: string; message: string };
interface Props {
  ownerId: string;
  embedded?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  initialCourseId?: string;
  initialQuizId?: string;
  initialInstructions?: string;
  initialMaterialIds?: string[];
  sessionId?: string;
  onSessionChange: (id: string | null) => void;
  onOpenActivity: (contentId: string, preview: boolean) => void;
}
const statusLabels: Record<StudioAssistantSession['status'], string> = {
  planning: 'Planning', awaiting_approval: 'Needs your approval', generating: 'Generating questions',
  completed: 'Completed', failed: 'Failed', interrupted: 'Interrupted',
};
const isRunning = (session: StudioAssistantSession | null) => session?.status === 'planning' || session?.status === 'generating';
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed.';
const sessionFrom = (response: { data?: { session: StudioAssistantSession } }) => {
  if (!response.data?.session?.id) throw new Error('The saved task was not returned. Check status before trying again.');
  return response.data.session;
};
const liveStatusMessage = (status?: string) => ({
  started: 'Preparing the question…',
  'llm-started': 'Writing the first draft…',
  'slice-planned': 'Applying the approved question focus…',
  'slice-retry': 'Revising the draft to match the approved focus…',
  'novelty-retry': 'Revising a draft that was too similar…',
  'llm-complete': 'Checking the generated structure…',
  'db-save-started': 'Preparing the validated preview…',
  'db-saving': 'Preparing the validated preview…',
  'db-saved': 'Validated draft prepared.',
  'sending-complete': 'Finishing this question…',
  'complete-sent': 'Question prepared.',
  completed: 'Question prepared.',
}[status || ''] || 'Generating…');
const previewLiveText = (text: string) => text.length > 1800 ? `…${text.slice(-1800)}` : text;

export default function StudioAssistant({ ownerId, embedded = false, onDirtyChange, initialCourseId = '', initialQuizId = '', initialInstructions = '', initialMaterialIds = [], sessionId, onSessionChange, onOpenActivity }: Props) {
  const { publish } = usePubSub('StudioAssistant');
  const { showConfirm } = useSystemDialog();
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Folder[]>([]);
  const [courseId, setCourseId] = useState(initialCourseId);
  const [quizId, setQuizId] = useState(initialQuizId);
  const [newCourseName, setNewCourseName] = useState('');
  const [showNewCourse, setShowNewCourse] = useState(false);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [selectedMaterials, setSelectedMaterials] = useState<string[]>(initialMaterialIds);
  const [instructions, setInstructions] = useState(initialInstructions);
  const [capabilities, setCapabilities] = useState<StudioAssistantCapabilities>({ questionTypes: [], maxObjectives: 8, maxPlanRows: 8, maxQuestions: 20 });
  const types = capabilities.questionTypes;
  const [recent, setRecent] = useState<StudioAssistantSession[]>([]);
  const [session, setSession] = useState<StudioAssistantSession | null>(null);
  const [objectives, setObjectives] = useState<StudioAssistantObjective[]>([]);
  const [plan, setPlan] = useState<PlanDraft[]>([]);
  const [dirty, setDirty] = useState(false);
  const [draftRevision, setDraftRevision] = useState(0);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const [pollAttempt, setPollAttempt] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [materialError, setMaterialError] = useState('');
  const [materialRefreshAttempt, setMaterialRefreshAttempt] = useState(0);
  const [busy, setBusy] = useState('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [previewReference, setPreviewReference] = useState<SourceReference | null>(null);
  const [liveQuestions, setLiveQuestions] = useState<Record<string, LiveQuestionDraft>>({});
  const liveChunkBuffer = useRef<Record<string, string>>({});
  const liveFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const livePreview = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    const resizePreview = (event: MessageEvent) => {
      if (event.source !== livePreview.current?.contentWindow || event.data?.type !== 'tlef:h5p-preview-height'
        || typeof event.data.height !== 'number' || !Number.isFinite(event.data.height)) return;
      livePreview.current.style.height = `${Math.max(320, Math.min(20000, Math.ceil(event.data.height)))}px`;
    };
    window.addEventListener('message', resizePreview);
    return () => window.removeEventListener('message', resizePreview);
  }, []);
  const current = useRef({ ownerId, courseId, session, dirty });
  current.current = { ownerId, courseId, session, dirty };
  const operation = useRef(false);
  const callbacks = useRef({ onSessionChange, onOpenActivity });
  callbacks.current = { onSessionChange, onOpenActivity };
  const pendingKey = `create-studio-assistant-request:${ownerId}`;
  const pendingBody = useRef<Parameters<typeof studioAssistantApi.createSession>[0] | null>(null);

  const flushLiveChunks = useCallback(() => {
    if (liveFlushTimer.current) clearTimeout(liveFlushTimer.current);
    liveFlushTimer.current = null;
    const buffered = liveChunkBuffer.current;
    liveChunkBuffer.current = {};
    if (!Object.keys(buffered).length || !mounted.current) return;
    setLiveQuestions(previous => {
      const next = { ...previous };
      Object.entries(buffered).forEach(([questionId, chunk]) => {
        const currentQuestion = next[questionId] || { text: '', status: 'streaming', message: 'Writing the first draft…' };
        next[questionId] = { ...currentQuestion, text: `${currentQuestion.text}${chunk}`, status: 'streaming', message: 'Writing the first draft…' };
      });
      return next;
    });
  }, []);

  const queueLiveChunk = useCallback((questionId: string, chunk: string) => {
    liveChunkBuffer.current[questionId] = `${liveChunkBuffer.current[questionId] || ''}${chunk}`;
    if (!liveFlushTimer.current) liveFlushTimer.current = setTimeout(flushLiveChunks, 80);
  }, [flushLiveChunks]);

  useEffect(() => () => {
    if (liveFlushTimer.current) clearTimeout(liveFlushTimer.current);
  }, []);

  const generationStreamId = session?.status === 'generating' && session.generation?.status === 'running'
    ? session.generation.sessionId || null : null;
  const generationStreamUrl = generationStreamId
    ? `${API_URL}/api/create/streaming/questions/${encodeURIComponent(generationStreamId)}` : null;
  useEffect(() => {
    liveChunkBuffer.current = {};
    setLiveQuestions({});
  }, [generationStreamId]);
  const { connectionStatus: liveConnectionStatus } = useSSE(generationStreamUrl, {
    onQuestionProgress: (questionId, data) => {
      setLiveQuestions(previous => ({ ...previous, [questionId]: {
        text: previous[questionId]?.text || '', status: data.status || 'generating', message: liveStatusMessage(data.status),
      } }));
    },
    onTextChunk: (questionId, chunk) => queueLiveChunk(questionId, chunk),
    onTextReset: (questionId, metadata) => {
      delete liveChunkBuffer.current[questionId];
      setLiveQuestions(previous => ({ ...previous, [questionId]: {
        text: '', status: 'retrying', message: metadata?.attempt ? `Revising draft · attempt ${metadata.attempt}` : 'Revising draft…',
      } }));
    },
    onQuestionComplete: questionId => {
      flushLiveChunks();
      setLiveQuestions(previous => ({ ...previous, [questionId]: {
        text: '', status: 'ready', message: 'Question prepared.',
      } }));
      setPollAttempt(value => value + 1);
    },
    onBatchComplete: () => { flushLiveChunks(); setPollAttempt(value => value + 1); },
    onError: questionId => {
      if (questionId) setLiveQuestions(previous => ({ ...previous, [questionId]: {
        ...(previous[questionId] || { text: '' }), status: 'failed', message: 'This question needs attention.',
      } }));
      setPollAttempt(value => value + 1);
    },
  });

  const receiveSession = useCallback((next: StudioAssistantSession, force = false) => {
    if (!mounted.current) return;
    const previous = current.current.session;
    if (!force && previous?.id === next.id && next.revision < previous.revision) return;
    pendingBody.current = null;
    if (previous?.id !== next.id || previous.revision !== next.revision || previous.status !== next.status) {
      publish('course-updated', { courseId: next.courseId, quizId: next.quizId });
    }
    if (next.quizId && ((next.generation?.status === 'succeeded' && previous?.generation?.status !== 'succeeded') || (next.status === 'completed' && previous?.status !== 'completed'))) {
      publish(PUBSUB_EVENTS.QUESTIONS_CHANGED, { quizId: next.quizId, reason: 'assistant-published', timestamp: Date.now() });
    }
    setSession(next);
    setRecent(items => [next, ...items.filter(item => item.id !== next.id)]);
    if (force || previous?.id !== next.id || !current.current.dirty) {
      setObjectives(next.objectives || []);
      setPlan((next.plan || []).map(item => ({ ...item, count: String(item.count) })));
      setDirty(false);
      setDraftRevision(next.revision);
    }
    setCourseId(next.courseId);
    setQuizId(next.quizId || '');
    setSelectedMaterials(next.materialIds || []);
    setInstructions(next.instructions || '');
  }, [publish]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([foldersApi.getFolders(), studioAssistantApi.getCapabilities(), studioAssistantApi.listSessions()])
      .then(([folders, catalog, sessions]) => {
        if (!active) return;
        setCourses(folders.folders);
        if (catalog.data) setCapabilities(catalog.data);
        setRecent(sessions.data?.sessions || []);
        const pending = sessionStorage.getItem(pendingKey);
        const recovered = pending ? sessions.data?.sessions?.find(item => item.requestId === pending) : undefined;
        if (recovered && !sessionId) {
          sessionStorage.removeItem(pendingKey);
          receiveSession(recovered, true);
          callbacks.current.onSessionChange(recovered.id);
        } else if (pending && !sessionId) {
          setUncertain(true);
          setError('The planning request is not confirmed yet. Check status, or fill in the original teaching task and choose Retry same request. The original request ID will be reused.');
        }
      }).catch(err => { if (active) setError(messageOf(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [ownerId, pendingKey, receiveSession, sessionId, loadAttempt]); // The parent remounts this form when the signed-in owner changes.

  const refreshMaterials = useCallback(async () => {
    if (!courseId) { setMaterials([]); return; }
    const requestedOwner = ownerId;
    setMaterialsLoading(true);
    try {
      const result = await materialsApi.getMaterials(courseId);
      if (mounted.current && current.current.courseId === courseId && current.current.ownerId === requestedOwner) { setMaterials(result.materials); setMaterialError(''); }
    } catch (err) {
      if (mounted.current && current.current.courseId === courseId && current.current.ownerId === requestedOwner) setMaterialError(messageOf(err));
    } finally {
      if (mounted.current && current.current.courseId === courseId && current.current.ownerId === requestedOwner) { setMaterialsLoading(false); setMaterialRefreshAttempt(value => value + 1); }
    }
  }, [courseId, ownerId]);

  useEffect(() => { setMaterials([]); setMaterialError(''); void refreshMaterials(); }, [refreshMaterials]);
  useEffect(() => {
    if (!materials.some(material => ['pending', 'processing'].includes(material.processingStatus))) return;
    const timer = window.setTimeout(() => void refreshMaterials(), 2500);
    return () => clearTimeout(timer);
  }, [materials, materialRefreshAttempt, refreshMaterials]);

  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const result = sessionFrom(await studioAssistantApi.getSession(sessionId));
        if (!active) return;
        receiveSession(result);
        setUncertain(false);
        if (isRunning(result)) timer = setTimeout(refresh, 2000);
      } catch (err) {
        if (active) setError(`Could not refresh this task. ${messageOf(err)} Use Check status; no AI request was repeated.`);
      }
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [sessionId, ownerId, receiveSession, session?.status, pollAttempt]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const guardNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.pathname === window.location.pathname) return;
      event.preventDefault(); event.stopPropagation();
      void showConfirm({ title: 'Leave with unsaved plan edits?', description: 'Your plan edits have not been saved. Stay here to save the plan, or leave and discard these local edits.', confirmLabel: 'Leave without saving', cancelLabel: 'Keep editing', tone: 'warning' }).then(confirmed => {
        if (confirmed && mounted.current) navigate(`${destination.pathname}${destination.search}${destination.hash}`);
      });
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', guardNavigation, true);
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', guardNavigation, true); };
  }, [dirty, navigate, showConfirm]);

  const checkStatus = async () => {
    if (operation.current) return;
    operation.current = true; setBusy('checking');
    try {
      if (session?.id || sessionId) {
        const next = sessionFrom(await studioAssistantApi.getSession(session?.id || sessionId!));
        receiveSession(next); setUncertain(false); setError(''); setPollAttempt(value => value + 1);
      } else {
        const response = await studioAssistantApi.listSessions();
        const sessions = response.data?.sessions || [];
        setRecent(sessions);
        const requestId = sessionStorage.getItem(pendingKey);
        const found = sessions.find(item => item.requestId === requestId);
        if (found) {
          receiveSession(found, true); callbacks.current.onSessionChange(found.id);
          sessionStorage.removeItem(pendingKey); setUncertain(false); setError('');
        } else if (requestId) setError('No saved task has been confirmed for the original request yet. Check again after reconnecting.');
        else { setError(''); setUncertain(false); }
      }
    } catch (err) { setError(messageOf(err)); }
    finally { operation.current = false; setBusy(''); }
  };

  const createCourse = async () => {
    if (operation.current || !newCourseName.trim()) return;
    operation.current = true; setBusy('course'); setError('');
    try {
      const result = await foldersApi.createFolder(newCourseName.trim(), 1);
      setCourses(items => [result.folder, ...items]); setCourseId(result.folder._id);
      publish('course-created', { courseId: result.folder._id, courseName: result.folder.name });
      const firstQuiz = result.folder.quizzes?.[0];
      setQuizId(typeof firstQuiz === 'string' ? firstQuiz : firstQuiz?._id || '');
      setSelectedMaterials([]); setShowNewCourse(false); setNewCourseName('');
    } catch (err) { setError(messageOf(err)); }
    finally { operation.current = false; setBusy(''); }
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files: FileList | null = event.target.files;
    if (!files?.length || !courseId || operation.current) return;
    if (Array.from(files).some(file => !/\.(pdf|docx)$/i.test(file.name))) {
      setError('Choose PDF or DOCX files.'); return;
    }
    operation.current = true; setBusy('upload'); setUploadProgress(0); setError('');
    const uploadCourse = courseId;
    try {
      const result = await materialsApi.uploadFiles(courseId, files, setUploadProgress);
      if (current.current.courseId !== uploadCourse) return;
      setMaterials(items => [...result.materials, ...items.filter(item => !result.materials.some(uploaded => uploaded._id === item._id))]);
      publish('materials-updated', { courseId: uploadCourse });
      setSelectedMaterials(ids => [...new Set([...ids, ...result.materials.map(material => material._id)])]);
      if (fileInput.current) fileInput.current.value = '';
    } catch (err) { setError(`Upload could not be confirmed. ${messageOf(err)} Refresh materials before uploading again.`); }
    finally { operation.current = false; setBusy(''); setUploadProgress(null); }
  };

  const retryMaterial = async (id: string) => {
    if (operation.current) return;
    operation.current = true; setBusy(`material:${id}`); setError('');
    try { await materialsApi.reprocessMaterial(id); await refreshMaterials(); }
    catch (err) { setError(messageOf(err)); }
    finally { operation.current = false; setBusy(''); }
  };

  const startPlanning = async (retrySame = false) => {
    if (operation.current || (!canPlan && !(retrySame && (pendingBody.current || validBrief)))) return;
    operation.current = true; setBusy('planning'); setError('');
    const requestId = sessionStorage.getItem(pendingKey) || crypto.randomUUID();
    const requestBody = pendingBody.current || { courseId, ...(quizId ? { quizId } : {}), materialIds: selectedMaterials, instructions: instructions.trim(), requestId };
    pendingBody.current = requestBody;
    sessionStorage.setItem(pendingKey, requestId);
    try {
      const next = sessionFrom(await studioAssistantApi.createSession(requestBody));
      if (!mounted.current) return;
      receiveSession(next, true); callbacks.current.onSessionChange(next.id);
      sessionStorage.removeItem(pendingKey); pendingBody.current = null; setUncertain(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setUncertain(true); setError('The original request may already be saved. Check status to recover it.');
        try {
          const found = (await studioAssistantApi.listSessions()).data?.sessions?.find(item => item.requestId === requestId);
          if (found && mounted.current) { receiveSession(found, true); callbacks.current.onSessionChange(found.id); sessionStorage.removeItem(pendingKey); pendingBody.current = null; setUncertain(false); setError(''); }
        } catch { /* Keep the original request ID when recovery cannot be confirmed. */ }
      } else if (err instanceof ApiError && err.status >= 400 && err.status < 500 && !uncertain) {
        sessionStorage.removeItem(pendingKey); pendingBody.current = null; setError(messageOf(err));
      } else { setUncertain(true); setError('Planning could not be confirmed. Check status or Retry same request; both recover the original request without starting a duplicate task.'); }
    } finally { operation.current = false; setBusy(''); }
  };

  const savePlan = async (approve: boolean) => {
    if (!session || operation.current || planError) return;
    operation.current = true; setBusy(approve ? 'approving' : 'saving'); setError('');
    try {
      const saved = sessionFrom(await studioAssistantApi.savePlan(session.id, {
        revision: draftRevision, objectives, plan: plan.map(item => ({ ...item, count: Number(item.count) }))
      }));
      if (!mounted.current) return;
      receiveSession(saved, true);
      if (approve) {
        const approved = sessionFrom(await studioAssistantApi.approve(saved.id, { revision: saved.revision, requestId: crypto.randomUUID() }));
        receiveSession(approved, true);
      }
    } catch (err) {
      setError(messageOf(err));
      if (!(err instanceof ApiError && err.status >= 400 && err.status < 500)) setUncertain(true);
    } finally { operation.current = false; setBusy(''); }
  };

  const resume = async () => {
    if (!session || operation.current) return;
    operation.current = true; setBusy('resuming'); setError('');
    try { receiveSession(sessionFrom(await studioAssistantApi.resume(session.id, { revision: session.revision, requestId: crypto.randomUUID() })), true); }
    catch (err) { setError(messageOf(err)); if (!(err instanceof ApiError && err.status >= 400 && err.status < 500)) setUncertain(true); }
    finally { operation.current = false; setBusy(''); }
  };

  const changeObjective = (id: string, text: string) => { setObjectives(items => items.map(item => item.id === id ? { ...item, text } : item)); setDirty(true); };
  const changePlan = (id: string, updates: Partial<PlanDraft>) => { setPlan(items => items.map(item => item.id === id ? { ...item, ...updates } : item)); setDirty(true); };
  const allSelectedReady = selectedMaterials.length > 0 && selectedMaterials.length <= (capabilities.maxMaterials || 20) && selectedMaterials.every(id => materials.some(material => material._id === id && material.processingStatus === 'completed'));
  const validBrief = !!courseId && allSelectedReady && instructions.trim().length >= 10 && !session;
  const canPlan = validBrief && !loading && types.length > 0 && !busy && !uncertain;
  const briefLocked = !!session || !!busy || (uncertain && !!pendingBody.current);
  const planError = !objectives.length || objectives.length > capabilities.maxObjectives || objectives.some(objective => !objective.text.trim()) ? `Add 1 to ${capabilities.maxObjectives} complete learning objectives.`
    : !plan.length || plan.length > capabilities.maxPlanRows ? `Add 1 to ${capabilities.maxPlanRows} question plan rows.`
      : plan.some(item => !item.title.trim() || !item.instructions.trim() || !types.some(type => type.type === item.questionType)) ? 'Complete each row title, type and instructions.'
        : plan.some(item => !/^\d+$/.test(item.count) || Number(item.count) < 1 || Number(item.count) > capabilities.maxQuestions) ? `Question counts must be whole numbers from 1 to ${capabilities.maxQuestions}.`
          : plan.reduce((sum, item) => sum + Number(item.count), 0) > capabilities.maxQuestions ? `Plan up to ${capabilities.maxQuestions} questions per task.`
            : plan.some(item => item.objectiveIds.length !== 1 || item.objectiveIds.some(id => !objectives.some(objective => objective.id === id))) ? 'Link every question plan row to one current learning objective.' : '';
  const editable = session?.status === 'awaiting_approval' && !busy && !uncertain;
  const questionsPublished = session?.generation?.status === 'succeeded';
  const errorText = typeof session?.error === 'string' ? session.error : session?.error?.message;

  return <section className="studio-assistant" aria-label={embedded ? "Course materials workspace" : undefined} aria-labelledby={embedded ? undefined : "studio-assistant-heading"}>
    <header className="studio-assistant-heading"><div>{!embedded && <><span className="h5p-studio-eyebrow">Plan a learning experience</span><h2 id="studio-assistant-heading">AI assistant</h2></>}<p>Use your course materials to prepare learning objectives and a question plan. Review and approve the plan before questions are generated.</p></div>
      {(session || instructions.trim() || selectedMaterials.length > 0 || newCourseName.trim()) && <button className="btn btn-outline" onClick={() => { pendingBody.current = null; setSession(null); setObjectives([]); setPlan([]); setDirty(false); setInstructions(''); setSelectedMaterials([]); setError(''); callbacks.current.onSessionChange(null); }} disabled={!!busy || dirty || uncertain}>New task</button>}</header>
    {loading && <p role="status"><Loader2 size={18} className="spin" /> Loading your courses and tasks…</p>}
    {recent.length > 0 && <label className="studio-assistant-recent">Recent tasks<select aria-label="Recent tasks" value={session?.id || ''} disabled={!!busy || dirty || uncertain} onChange={event => { if (event.target.value) { setError(''); callbacks.current.onSessionChange(event.target.value); } }}><option value="">Choose a saved task</option>{recent.map(item => <option key={item.id} value={item.id}>{item.instructions?.slice(0, 75) || 'Teaching task'} — {statusLabels[item.status]}</option>)}</select></label>}
    {error && <div className="studio-ai-error" role="alert"><p>{error}</p>{!types.length && <button className="btn btn-outline" disabled={loading} onClick={() => setLoadAttempt(value => value + 1)}>Retry loading setup</button>}<button className="btn btn-outline" disabled={!!busy} onClick={() => void checkStatus()}><RefreshCw size={16} /> Check status</button>{uncertain && !session && <button className="btn btn-primary" disabled={!!busy || (!pendingBody.current && !validBrief)} onClick={() => void startPlanning(true)}>Retry same request</button>}</div>}
    <section className="studio-assistant-step"><h3><span>1</span> Course & materials</h3>
      <fieldset disabled={briefLocked || loading}>
        <label>Course<select value={courseId} onChange={event => { setCourseId(event.target.value); setQuizId(''); setSelectedMaterials([]); }}><option value="">Choose a course</option>{courses.map(course => <option key={course._id} value={course._id}>{course.name}</option>)}</select></label>
        <button className="btn btn-ghost" onClick={() => setShowNewCourse(value => !value)}><Plus size={16} /> New course</button>
        {showNewCourse && <div className="studio-assistant-new-course"><label>Course name<input value={newCourseName} onChange={event => setNewCourseName(event.target.value)} maxLength={150} /></label><p>The new course includes an empty Learning Object that this assistant can use.</p><button className="btn btn-outline" disabled={!newCourseName.trim()} onClick={() => void createCourse()}>Create course</button></div>}
        <div className="studio-assistant-upload"><input ref={fileInput} type="file" accept=".pdf,.docx" multiple hidden aria-label="Upload PDF or DOCX" disabled={!courseId} onChange={event => void upload(event)} /><button type="button" className="btn btn-outline" disabled={!courseId} onClick={() => fileInput.current?.click()}><Upload size={17} /> Upload PDF or DOCX</button></div>
      </fieldset>
      {!session && courseId && <label>Learning Object<select value={quizId} disabled={briefLocked} onChange={event => setQuizId(event.target.value)}><option value="">Create a new Learning Object</option>{(courses.find(course => course._id === courseId)?.quizzes || []).map((quiz, index) => { const id = typeof quiz === 'string' ? quiz : quiz._id; return <option key={id} value={id}>{typeof quiz === 'string' ? `Learning Object ${index + 1}` : quiz.name || `Learning Object ${index + 1}`}</option>; })}</select></label>}
      {session?.quizId && <p className="studio-assistant-links"><Link to={`/course/${encodeURIComponent(session.courseId)}`}>Open course</Link><Link to={`/course/${encodeURIComponent(session.courseId)}/quiz/${encodeURIComponent(session.quizId)}?tab=objectives`}>Learning objectives: {session.quizName || 'Learning Object'}</Link><Link to={`/course/${encodeURIComponent(session.courseId)}/quiz/${encodeURIComponent(session.quizId)}?tab=review`}>Review saved questions</Link></p>}
      <p>The assistant creates a Column layout. Existing objectives are reused and existing questions are preserved.</p>
      {uploadProgress !== null && <p role="status">Uploading files: {uploadProgress}%</p>}
      {courseId && <button className="btn btn-ghost" disabled={materialsLoading || !!busy} onClick={() => void refreshMaterials()}><RefreshCw size={15} /> Refresh materials</button>}
      {materialsLoading && <p role="status">Checking material processing…</p>}
      {materialError && <p className="studio-ai-error" role="alert">Could not refresh materials. {materialError} Use Refresh materials to check again.</p>}
      <ul className="studio-assistant-materials">{materials.map(material => <li key={material._id}><label><input type="checkbox" checked={selectedMaterials.includes(material._id)} disabled={briefLocked || (material.processingStatus !== 'completed' && !selectedMaterials.includes(material._id))} onChange={event => setSelectedMaterials(ids => event.target.checked ? [...ids, material._id] : ids.filter(id => id !== material._id))} /><span>{material.name}</span></label><span>{material.processingStatus === 'completed' ? 'Ready' : material.processingStatus === 'failed' ? 'Processing failed' : material.processingStatus === 'processing' ? 'Processing' : 'Waiting to process'}</span>{material.processingError?.message && <p>{material.processingError.message}</p>}{material.processingStatus === 'failed' && !session && <button className="btn btn-ghost" disabled={!!busy} onClick={() => void retryMaterial(material._id)}>Retry processing</button>}</li>)}</ul>
      {courseId && !materialsLoading && !materials.length && <p>No materials yet. Upload a PDF or DOCX to begin.</p>}
      {!session && selectedMaterials.length > 0 && !allSelectedReady && <p role="status">Select at most {capabilities.maxMaterials || 20} materials and wait until each is Ready before planning.</p>}
    </section>
    <section className="studio-assistant-step"><h3><span>2</span> Teaching task</h3><label>Teaching task<textarea value={instructions} rows={5} maxLength={12000} disabled={briefLocked} onChange={event => setInstructions(event.target.value)} placeholder="For first-year students, build a lesson that introduces the key ideas, checks misconceptions, and ends with an applied reflection. Use the selected materials as evidence." /></label>
      {!session && <button className="btn btn-primary" disabled={!canPlan} onClick={() => void startPlanning()}>{busy === 'planning' ? 'Starting planning…' : 'Plan learning objectives & questions'}</button>}
    </section>
    {session && <>
      <section className="studio-assistant-step"><h3><span>3</span> Review the plan</h3><p role="status">{statusLabels[session.status]}{isRunning(session) && <Loader2 size={16} className="spin" />}</p>
        {session.sourceChanged && <p role="status">The linked Learning Object changed. Check its current objectives and questions before continuing.</p>}
        {session.status === 'planning' && <p>Reading the selected evidence and preparing the question plan. Existing objectives are reused. You can return to this saved task after a refresh.</p>}
        {(!!objectives.length || session.status === 'awaiting_approval') && <fieldset><legend>Learning objectives</legend>{objectives.map((objective, index) => <div className="studio-assistant-objective" key={objective.id}><label>LO{index + 1}<textarea rows={2} disabled={!editable} value={objective.text} onChange={event => changeObjective(objective.id, event.target.value)} /></label>{objective.sourceReferences?.length ? <details><summary>Source evidence</summary>{objective.sourceReferences.map((source, i) => <button key={i} className="btn btn-ghost" type="button" onClick={() => setPreviewReference(source)}>{source.materialName || source.sourceFile || 'Course material'}{source.pageNumber ? ` · Page ${source.pageNumber}` : ''}</button>)}</details> : <p>Check this objective against the selected materials.</p>}<button className="btn btn-ghost" disabled={!editable} onClick={() => { setObjectives(items => items.filter(item => item.id !== objective.id)); setDirty(true); }}>Remove LO{index + 1}</button></div>)}<button className="btn btn-outline" disabled={!editable || objectives.length >= capabilities.maxObjectives} onClick={() => { setObjectives(items => [...items, { id: crypto.randomUUID(), text: '', sourceReferences: [] }]); setDirty(true); }}>Add objective</button></fieldset>}
        {(!!plan.length || session.status === 'awaiting_approval') && <fieldset disabled={!editable}><legend>Question plan</legend>{plan.map((item, index) => <article key={item.id} className="studio-assistant-plan-item"><h4>Plan row {index + 1}</h4><label>Row title<input value={item.title} maxLength={200} onChange={event => changePlan(item.id, { title: event.target.value })} /></label><div className="studio-assistant-plan-columns"><label>Question type<select value={item.questionType} onChange={event => changePlan(item.id, { questionType: event.target.value })}>{!types.some(type => type.type === item.questionType) && <option value={item.questionType}>Unavailable question type</option>}{types.map(type => <option key={type.type} value={type.type}>{type.title}</option>)}</select></label><label>Number of questions<input type="text" inputMode="numeric" value={item.count} onChange={event => changePlan(item.id, { count: event.target.value })} /></label></div><label>Question instructions<textarea rows={3} value={item.instructions} onChange={event => changePlan(item.id, { instructions: event.target.value })} /></label><fieldset><legend>Linked learning objectives</legend>{objectives.map((objective, objectiveIndex) => <label key={objective.id} className="studio-assistant-check"><input type="radio" name={`objective-${item.id}`} checked={item.objectiveIds.includes(objective.id)} onChange={event => changePlan(item.id, { objectiveIds: event.target.checked ? [objective.id] : item.objectiveIds.filter(id => id !== objective.id) })} />LO{objectiveIndex + 1}: {objective.text || 'Untitled objective'}</label>)}</fieldset><button className="btn btn-ghost" onClick={() => { setPlan(items => items.filter(row => row.id !== item.id)); setDirty(true); }}>Remove plan row {index + 1}</button></article>)}<button className="btn btn-outline" disabled={plan.length >= capabilities.maxPlanRows} onClick={() => { setPlan(items => [...items, { id: crypto.randomUUID(), title: '', questionType: types[0]?.type || '', count: '1', instructions: '', objectiveIds: [] }]); setDirty(true); }}>Add plan row</button></fieldset>}
        {session.status === 'awaiting_approval' && <><p>Review the objectives, evidence, question types and instructions. The learning objectives and plan are shared with the course workflow. Save plan keeps your edits; approval saves the current plan and starts question generation. Existing questions are kept; the complete new batch is appended only after every question succeeds.</p>{planError && <p role="status">{planError}</p>}{dirty && <p>You have unsaved plan edits. <button className="btn btn-ghost" disabled={!!busy} onClick={() => receiveSession(session, true)}>Discard plan edits</button></p>}<div className="studio-assistant-actions"><button className="btn btn-outline" disabled={!editable || !!planError || !dirty} onClick={() => void savePlan(false)}>Save plan</button><button className="btn btn-primary" disabled={!editable || !!planError} onClick={() => void savePlan(true)}>{busy === 'approving' ? 'Saving and approving…' : 'Approve & generate questions'}</button></div></>}
      </section>
      <section className="studio-assistant-step"><h3><span>4</span> Question progress</h3><div className="studio-assistant-progress-toolbar"><button className="btn btn-outline" disabled={!!busy} onClick={() => void checkStatus()}><RefreshCw size={16} /> Check status</button>{session.status === 'generating' && <p className={`studio-assistant-live-status is-${generationStreamId ? liveConnectionStatus : 'connecting'}`} role="status"><span aria-hidden="true" />{!generationStreamId ? 'Preparing live updates…' : liveConnectionStatus === 'connected' ? 'Live updates connected' : liveConnectionStatus === 'error' ? 'Live updates interrupted · saved status checks continue' : liveConnectionStatus === 'connecting' ? 'Connecting live updates…' : 'Waiting for live updates…'}</p>}</div>{errorText && <p role="alert">{errorText}</p>}{session.generation && <div><p role="status">{session.generation.readyCount} of {session.generation.totalQuestions} questions prepared.</p><div className="studio-assistant-question-progress">{session.generation.items.map(item => { const questionId = item.questionId || `question-${item.index + 1}`; const live = liveQuestions[questionId]; return <article className={`is-${live?.status || item.status}`} key={item.index}><div className="studio-assistant-question-heading"><strong>Question {item.index + 1}</strong><span>{item.status === 'ready' || live?.status === 'ready' ? 'Prepared' : item.status === 'failed' || live?.status === 'failed' ? 'Failed' : live?.message || (item.status === 'generating' ? 'Generating…' : 'Waiting')}</span></div>{item.message && item.status === 'failed' && <p role="alert">{item.message}</p>}{live?.text && <div className="studio-assistant-stream-draft"><span>Live AI draft · validating before save</span><pre>{previewLiveText(live.text)}</pre><i aria-hidden="true" /></div>}</article>; })}{Object.entries(liveQuestions).filter(([questionId]) => !session.generation?.items.some(item => (item.questionId || `question-${item.index + 1}`) === questionId)).map(([questionId, live], index) => <article className={`is-${live.status}`} key={questionId}><div className="studio-assistant-question-heading"><strong>Question {index + session.generation!.items.length + 1}</strong><span>{live.message}</span></div>{live.text && <div className="studio-assistant-stream-draft"><span>Live AI draft · validating before save</span><pre>{previewLiveText(live.text)}</pre><i aria-hidden="true" /></div>}</article>)}</div></div>}<ol className="studio-assistant-events" aria-label="Task progress">{(session.events || []).map((event, index) => <li key={`${event.createdAt}:${index}`}><strong>{event.stage.replaceAll('_', ' ')}</strong><p>{event.message}</p></li>)}</ol>
        {(session.status === 'failed' || session.status === 'interrupted') && <><p>{questionsPublished ? 'Questions are already saved in the Learning Object. Retry prepares the Studio draft without generating duplicate questions.' : session.phase === 'planning' ? 'Planning stopped before approval. Retry prepares the plan again using the existing course objectives when available.' : 'The new batch was not published. Existing questions are preserved. Retry generates the question batch again and may use additional AI credits.'}</p><button className="btn btn-primary" disabled={!!busy || uncertain} onClick={() => void resume()}>{questionsPublished ? 'Retry Studio draft' : session.phase === 'planning' ? 'Retry planning' : 'Retry question batch'}</button></>}
        {!!session.generation?.readyCount && !questionsPublished && session.status !== 'completed' && <div className="studio-assistant-live-preview"><h4>Question preview</h4><p>{session.generation.readyCount} of {session.generation.totalQuestions} questions prepared. This preview is read-only; the batch is not saved to the Learning Object until every question succeeds.</p><iframe ref={livePreview} key={`${session.id}:${session.previewVersion ?? session.generation.readyCount}`} title="Prepared question preview" src={`/api/create/h5p-editor/assistant/sessions/${encodeURIComponent(session.id)}/preview?v=${session.previewVersion ?? session.generation.readyCount}`} sandbox="allow-scripts" /></div>}
        <div className="studio-assistant-outputs">{(session.outputs || []).map(output => <article key={output.contentId}><h4>{output.title}</h4><p>Saved draft · Review before sharing</p><div className="studio-assistant-actions"><button className="btn btn-outline" onClick={() => callbacks.current.onOpenActivity(output.contentId, false)}>Edit activity</button><button className="btn btn-outline" onClick={() => callbacks.current.onOpenActivity(output.contentId, true)}>Preview activity</button></div></article>)}</div>{!session.outputs?.length && <p>The combined H5P activity will appear here after the whole question batch is saved.</p>}
      </section>
    </>}
    {previewReference && <SourceReferencePreviewModal reference={previewReference} onClose={() => setPreviewReference(null)} />}
  </section>;
}
