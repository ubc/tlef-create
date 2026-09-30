import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, ArrowUpRight, BookOpen, Check, ChevronDown, Clock3, Download, FileText, History, Layers3, Loader2, MessageSquare, Plus, RefreshCw, RotateCcw, Search, SlidersHorizontal, Sparkles, Square, Upload, X } from 'lucide-react';
import { ApiError, foldersApi, materialsApi, studioAuthoringApi, studioAssistantApi, h5pEditorApi,
  type AuthoringSession, type Folder, type Material, type SourceReference } from '../../../services/api';
import StudioPreview from '../StudioPreview';
import AuthoringProgress from './AuthoringProgress';
import AuthoringClarification from './AuthoringClarification';
import SourceReferencePreviewModal from '../../SourceReferencePreviewModal';
import { useSystemDialog } from '../../system-dialog/SystemDialogProvider';
import { usePubSub } from '../../../hooks/usePubSub';
import '../../../styles/pages/StudioAuthoring.css';

interface Props {
  ownerId: string; sessionId?: string; initialCourseId?: string; initialQuizId?: string;
  onSessionChange: (id: string | null) => void;
  onOpenActivity: (id: string, preview: boolean) => void;
  onAdvanced: () => void;
}
const labels: Record<AuthoringSession['status'], string> = {
  waiting_for_materials: 'Reading materials', planning: 'Preparing your teaching plan', awaiting_approval: 'Ready for your review',
  generating: 'Creating your activity', ready: 'Ready', working: 'Working on your request', needs_attention: 'Needs attention', cancelled: 'Stopped',
};
const running = (session: AuthoringSession | null) => !!session?.run && ['queued', 'running', 'waiting'].includes(session.run.status);
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed.';
const extract = (response: { data?: { session: AuthoringSession } }) => {
  if (!response.data?.session) throw new Error('The saved task was not returned. Check status before retrying.');
  return response.data.session;
};

export default function AuthoringWorkspace({ ownerId, sessionId, initialCourseId = '', initialQuizId = '', onSessionChange, onOpenActivity, onAdvanced }: Props) {
  const [session, setSession] = useState<AuthoringSession | null>(null);
  const [recent, setRecent] = useState<Array<Pick<AuthoringSession, 'id' | 'title' | 'status' | 'updatedAt'>>>([]);
  const [courses, setCourses] = useState<Folder[]>([]);
  const [courseId, setCourseId] = useState(initialCourseId);
  const [quizId, setQuizId] = useState(initialQuizId);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [autoApprove, setAutoApprove] = useState(false);
  const [audience, setAudience] = useState('');
  const [teachingGoal, setTeachingGoal] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [newCourse, setNewCourse] = useState(false);
  const [courseName, setCourseName] = useState('');
  const [showSources, setShowSources] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [showTools, setShowTools] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadFailed, setUploadFailed] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [panel, setPanel] = useState<'preview' | 'plan' | 'questions'>('plan');
  const [viewVersion, setViewVersion] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [loading, setLoading] = useState(true);
  const [poll, setPoll] = useState(0);
  const [progress, setProgress] = useState<number | null>(null);
  const [reference, setReference] = useState<SourceReference | null>(null);
  const [planDraft, setPlanDraft] = useState<AuthoringSession['assistant']>(null);
  const [planDirty, setPlanDirty] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const toolsMenu = useRef<HTMLDivElement>(null);
  const dragDepth = useRef(0);
  const end = useRef<HTMLDivElement>(null);
  const operation = useRef(false);
  const composedClarification = useRef('');
  const alive = useRef(true);
  const callbacks = useRef({ onSessionChange, onOpenActivity });
  callbacks.current = { onSessionChange, onOpenActivity };
  const current = useRef({ session, courseId, sessionId, planDirty });
  current.current = { session, courseId, sessionId, planDirty };
  const pending = useRef<{ command: Parameters<typeof studioAuthoringApi.command>[1]; body: Parameters<typeof studioAuthoringApi.command>[2]; id: string } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const { showConfirm } = useSystemDialog();
  const { publish } = usePubSub('StudioAuthoring');
  const pendingKey = `create-authoring-request:${ownerId}`;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!showTools) return;
    const close = (event: PointerEvent) => { if (!toolsMenu.current?.contains(event.target as Node)) setShowTools(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setShowTools(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [showTools]);

  const receive = useCallback((next: AuthoringSession) => {
    if (!alive.current || (current.current.session?.id === next.id && next.revision < current.current.session.revision)) return;
    const previous = current.current.session;
    setSession(next);
    setRecent(items => [next, ...items.filter(item => item.id !== next.id)]);
    if (!current.current.planDirty) setPlanDraft(next.assistant ? structuredClone(next.assistant) : null);
    // A rejected save still advances the server reservation revision. Keep the
    // local edits while refreshing only that revision for an explicit retry.
    else if (next.assistant && previous?.assistant?.id === next.assistant.id
      && previous.assistant.revision !== next.assistant.revision
      && JSON.stringify(previous.assistant.plan) === JSON.stringify(next.assistant.plan)
      && JSON.stringify(previous.assistant.objectives) === JSON.stringify(next.assistant.objectives)) {
      setPlanDraft(draft => draft ? { ...draft, revision: next.assistant!.revision } : draft);
    }
    if (next.currentVersionId !== previous?.currentVersionId || next.candidateVersionId !== previous?.candidateVersionId) {
      setViewVersion(next.candidateVersionId || next.currentVersionId || '');
      if (next.currentVersionId || next.candidateVersionId) setPanel('preview');
      publish('course-updated', { courseId: next.courseId, quizId: next.quizId });
    }
    setCourseId(next.courseId);
  }, [publish]);

  useEffect(() => {
    let active = true;
    Promise.all([foldersApi.getFolders(), studioAuthoringApi.list()]).then(([folders, tasks]) => {
      if (!active) return;
      setCourses(folders.folders); setRecent(tasks.data?.sessions || []);
    }).catch(err => { if (active) setError(errorText(err)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [ownerId]);

  useEffect(() => {
    if (!sessionId) { setSession(null); setPlanDraft(null); setPlanDirty(false); setViewVersion(''); return; }
    let active = true;
    let timeout: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = extract(await studioAuthoringApi.get(sessionId));
        if (!active) return;
        receive(next); setRefreshError('');
        // Recheck completed tasks too: manual editor saves and another tab may
        // have accepted a new version. Reading never starts paid work.
        timeout = setTimeout(refresh, running(next) ? 1800 : 8000);
      } catch (err) {
        if (active) {
          setRefreshError(`Could not refresh this task. ${errorText(err)}`);
          timeout = setTimeout(refresh, 8000);
        }
      }
    };
    void refresh();
    return () => { active = false; clearTimeout(timeout); };
  }, [sessionId, ownerId, poll, receive]);

  useEffect(() => {
    if (!courseId || sessionId || session?.id) return;
    let active = true;
    let timeout: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const response = await materialsApi.getMaterials(courseId);
        if (!active) return;
        setMaterials(response.materials); setRefreshError('');
        if (response.materials.some(m => ['pending', 'processing'].includes(m.processingStatus))) timeout = setTimeout(refresh, 2500);
      } catch (err) {
        if (active) { setRefreshError(errorText(err)); timeout = setTimeout(refresh, 8000); }
      }
    };
    void refresh();
    return () => { active = false; clearTimeout(timeout); };
  }, [courseId, sessionId, session?.id, poll]);

  useEffect(() => { const transcript = end.current?.parentElement; transcript?.scrollTo?.({ top: transcript.scrollHeight, behavior: 'smooth' }); }, [session?.messages.length, session?.status]);
  useEffect(() => {
    if (!planDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [planDirty]);

  const act = async (name: string, work: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true; setBusy(name); setError('');
    try { await work(); }
    catch (err) { if (alive.current) setError(errorText(err)); }
    finally { operation.current = false; if (alive.current) setBusy(''); }
  };
  const command = (kind: Parameters<typeof studioAuthoringApi.command>[1], extra: { text?: string; versionId?: string; planRevision?: number } = {}) => {
    if (!session) return;
    void act(kind, async () => {
      const request = pending.current || { id: session.id, command: kind, body: { requestId: crypto.randomUUID(), revision: session.revision, ...extra } };
      pending.current = request;
      try {
        const next = extract(await studioAuthoringApi.command(request.id, request.command, request.body));
        pending.current = null; setUncertain(false); receive(next); setPoll(value => value + 1);
        if (kind === 'message') setText('');
      } catch (err) {
        // A received client error is a definite rejection, not an ambiguous
        // transport failure. Refresh the revision so the user can try anew.
        const rejected = err instanceof ApiError && err.status >= 400 && err.status < 500;
        if (rejected) { pending.current = null; setPoll(value => value + 1); }
        setUncertain(!rejected); throw err;
      }
    });
  };
  const useClarificationAnswers = (reply: string) => {
    const previous = composedClarification.current;
    composedClarification.current = reply;
    setText(existing => previous && existing.endsWith(previous)
      ? `${existing.slice(0, -previous.length)}${reply}`
      : existing.trim() ? `${existing}\n\n${reply}` : reply);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (operation.current || running(session) || uncertain) return;
    if (session) { if (text.trim()) command('message', { text: text.trim() }); return; }
    if (!courseId || !selected.length) { setShowSources(true); setError('Choose a course and attach at least one material to begin.'); return; }
    void act('create', async () => {
      const requestId = sessionStorage.getItem(pendingKey) || crypto.randomUUID();
      sessionStorage.setItem(pendingKey, requestId);
      const next = extract(await studioAuthoringApi.create({ requestId, courseId, ...(quizId ? { quizId } : {}),
        materialIds: selected, instructions: text.trim(), autoApprove }));
      sessionStorage.removeItem(pendingKey);
      receive(next); setText(''); callbacks.current.onSessionChange(next.id); setShowSources(false);
    });
  };
  const queueFiles = (files: File[]) => {
    if (!files.length) return;
    const valid = files.filter(item => /\.(pdf|docx)$/i.test(item.name) && item.size > 0);
    if (valid.length !== files.length) setError('Only non-empty PDF and DOCX files can be added.');
    if (!valid.length) return;
    setPendingFiles(items => {
      const unique = valid.filter(item => !items.some(existing => existing.name === item.name && existing.size === item.size && existing.lastModified === item.lastModified));
      if (items.length + unique.length + (session ? 0 : selected.length) > 20) {
        setError('An activity can use up to 20 materials. Remove a queued file or deselect a material first.');
        return items;
      }
      return [...items, ...unique];
    });
    setUploadFailed(false);
    if (!session) setShowSources(true);
    setShowTools(false);
  };
  const upload = (event: ChangeEvent<HTMLInputElement>) => {
    queueFiles(Array.from(event.target.files || []));
    event.target.value = '';
  };
  useEffect(() => {
    if (!courseId || session || !pendingFiles.length || uploadFailed || operation.current || busy) return;
    const targetCourse = courseId;
    const nextFile = pendingFiles[0];
    void act('upload', async () => {
      setProgress(0);
      try {
        const result = await materialsApi.uploadFiles(targetCourse, [nextFile], setProgress);
        if (!result.materials.length) throw new Error(`${nextFile.name} was not added. It may already be in this course.`);
        if (current.current.courseId !== targetCourse) return;
        setMaterials(items => [...result.materials, ...items.filter(item => !result.materials.some(newItem => newItem._id === item._id))]);
        setSelected(ids => [...new Set([...ids, ...result.materials.map(item => item._id)])]);
        setPendingFiles(items => items.filter(item => item !== nextFile));
        setPoll(value => value + 1); publish('materials-updated', { courseId: targetCourse });
      } catch (err) { setUploadFailed(true); throw err; }
      finally { setProgress(null); }
    });
  }, [courseId, session, pendingFiles, uploadFailed, busy, publish]);
  const fileDrag = (event: DragEvent<HTMLElement>) => event.dataTransfer.types.includes('Files');
  const onDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!fileDrag(event)) return;
    event.preventDefault(); dragDepth.current += 1; setDraggingFiles(true);
  };
  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (!fileDrag(event)) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!draggingFiles) return;
    event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDraggingFiles(false);
  };
  const onDrop = (event: DragEvent<HTMLElement>) => {
    if (!fileDrag(event)) return;
    event.preventDefault(); dragDepth.current = 0; setDraggingFiles(false);
    queueFiles(Array.from(event.dataTransfer.files));
  };
  const savePlan = async () => {
    if (!session?.assistant || !planDraft) return;
    const result = await studioAssistantApi.savePlan(session.assistant.id, { revision: planDraft.revision,
      objectives: planDraft.objectives, plan: planDraft.plan });
    setPlanDirty(false); current.current.planDirty = false;
    if (result.data?.session) setPlanDraft(result.data.session);
    receive(extract(await studioAuthoringApi.get(session.id)));
  };
  const selectTask = async (id: string | null) => {
    if (operation.current) return;
    if (planDirty && !await showConfirm({ title: 'Discard unsaved plan edits?', description: 'Your saved teaching plan is kept. The unsaved changes will be discarded.', confirmLabel: 'Discard edits', cancelLabel: 'Keep editing', tone: 'warning' })) return;
    pending.current = null; setUncertain(false); setError(''); setRefreshError(''); setPlanDirty(false); setSession(null); setText(''); setShowHistory(false); setShowTools(false);
    setQuizId(''); setSelected([]);
    if (!id) sessionStorage.removeItem(pendingKey);
    callbacks.current.onSessionChange(id);
  };

  const active = running(session);
  const currentVersion = session?.versions.find(v => v.id === session.currentVersionId);
  const candidate = session?.versions.find(v => v.id === session.candidateVersionId);
  const viewed = session?.versions.find(v => v.id === viewVersion) || candidate || currentVersion;
  const failedBatch = !session?.currentVersionId && session?.assistant?.status === 'failed'
    && session.assistant.phase === 'generating' && session.assistant.errorCode === 'ASSISTANT_QUESTION_BATCH_FAILED';
  const editablePlan = (session?.status === 'awaiting_approval' || failedBatch) && !active && !busy;
  const questionRows = session?.assistant?.plan.flatMap(row => Array.from({ length: row.count }, () => row)) || [];
  const total = planDraft?.plan.reduce((sum, row) => sum + row.count, 0) || 0;
  const validPlan = !!planDraft?.plan.length && total > 0 && total <= 20 && planDraft.plan.every(row => Number.isInteger(row.count) && row.count > 0) && planDraft.objectives.every(lo => lo.text.trim()) && planDraft.plan.every(row => row.instructions.trim());
  const visibleTasks = recent.filter(task => `${task.title} ${labels[task.status]}`.toLowerCase().includes(historyQuery.trim().toLowerCase()));

  return <section className={`authoring-workspace ${draggingFiles ? 'is-dragging-files' : ''}`} aria-label="Studio AI workspace" onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
    <header className="authoring-topbar">
      <div className="authoring-heading"><span className="authoring-mark"><Sparkles size={17} /></span><div><strong>{session?.title || 'New learning activity'}</strong><span>{session ? labels[session.status] : 'From your materials to something worth learning'}</span></div></div>
      <div className="authoring-top-actions">
        <button className={`authoring-history-trigger ${showHistory ? 'selected' : ''}`} title="Task history" aria-label="Task history" aria-expanded={showHistory} onClick={() => setShowHistory(v => !v)}><History size={17} /><span>History</span></button>
        <button className="authoring-icon" title="New task" aria-label="New task" disabled={!!busy} onClick={() => void selectTask(null)}><Plus size={19} /></button>
        <button className="authoring-quiet" disabled={!!busy} onClick={async () => { if (!planDirty || await showConfirm({ title: 'Discard unsaved plan edits?', description: 'Your saved plan is kept. Unsaved edits will be discarded.', confirmLabel: 'Discard edits', cancelLabel: 'Keep editing', tone: 'warning' })) onAdvanced(); }}>Advanced types <ArrowUpRight size={14} /></button>
      </div>
    </header>
    {showHistory && <div className="authoring-task-history"><div className="authoring-history-heading"><strong>Recent conversations</strong><span>Saved to your account</span></div><label className="authoring-history-search"><Search size={15} /><input aria-label="Search task history" placeholder="Search conversations" value={historyQuery} onChange={event => setHistoryQuery(event.target.value)} /></label>{!recent.length && <p>Your saved conversations will appear here.</p>}{recent.length > 0 && !visibleTasks.length && <p>No conversations match your search.</p>}<div className="authoring-history-list">{visibleTasks.map(task => <button key={task.id} disabled={!!busy} onClick={() => { setShowHistory(false); void selectTask(task.id); }} className={session?.id === task.id ? 'selected' : ''}><MessageSquare size={15} /><span><strong>{task.title}</strong><small>{labels[task.status]}</small></span><time dateTime={task.updatedAt}>{new Date(task.updatedAt).toLocaleDateString()}</time></button>)}</div></div>}
    <input ref={file} type="file" multiple accept=".pdf,.docx" className="authoring-file-input" aria-label="Upload course materials" onChange={upload} />
    {draggingFiles && <div className="authoring-drop-overlay" aria-hidden="true"><Upload size={30} /><strong>Drop PDF or DOCX files here</strong><span>{session ? 'Add them to a new activity' : courseId ? 'They will upload to your course' : 'Choose a course after dropping'}</span></div>}
    <div className={`authoring-body ${session ? 'has-artifact' : ''}`}>
      <div className="authoring-conversation">
        <div className="authoring-transcript" role="log" aria-label="Conversation" aria-live="polite">
          {!session && <div className="authoring-welcome"><span className="authoring-welcome-icon"><Layers3 size={30} strokeWidth={1.4} /></span><p className="authoring-kicker">YOUR TEACHING, A LITTLE LESS WORK</p><h2>What will your students<br />discover today?</h2><p>Bring your materials. We’ll shape the learning objectives,<br className="desktop-break" /> build a thoughtful plan, and turn it into an H5P activity.</p><div className="authoring-starters">{[
            ['Check understanding', 'Create a short self-check activity that helps students identify misconceptions in these materials.'],
            ['Prepare for class', 'Create a first-year pre-class activity introducing the key concepts in these materials.'],
            ['Apply the ideas', 'Create an activity with practical application questions grounded in these materials.']
          ].map(([title, prompt]) => <button key={title} onClick={() => setText(prompt)}><BookOpen size={16} /><span>{title}</span><ArrowUpRight size={14} /></button>)}</div></div>}
          {session?.messages.map(message => <article className={`authoring-message is-${message.role}`} key={message.id}><span className="authoring-speaker">{message.role === 'assistant' ? <><Sparkles size={14} /> CREATE</> : 'You'}</span><p>{message.text}</p>{message.role === 'assistant' && !!message.clarification?.length && <AuthoringClarification messageId={message.id} questions={message.clarification} disabled={active || !!busy || uncertain || !!candidate || planDirty || session?.messages.at(-1)?.id !== message.id} onUseAnswers={useClarificationAnswers} />}</article>)}
          {session && <AuthoringProgress session={session} />}
          {session && active && <div className="authoring-live" role="status"><Loader2 size={15} className="spin" /><div><strong>{labels[session.status]}</strong><span>{session.assistant?.events.at(-1)?.message || 'Your progress is saved. You can return to this task later.'}</span>{session.assistant?.generation && <progress aria-label="Questions prepared" value={session.assistant.generation.readyCount} max={session.assistant.generation.totalQuestions} />}</div></div>}
          {session?.status === 'awaiting_approval' && !active && <div className="authoring-decision"><div><span className="authoring-decision-icon"><Check size={18} /></span><strong>Your teaching plan is ready</strong></div><p>{planDraft?.objectives.length || 0} learning objectives · {total} questions · H5P Column</p><p>Review the plan alongside this conversation. Your existing course questions are preserved.</p><button className="btn btn-primary" disabled={!!busy || planDirty || !validPlan} onClick={() => command('approve', { planRevision: session.assistant?.revision })}>Accept plan & generate <ArrowUpRight size={15} /></button><button className="authoring-quiet" onClick={() => setPanel('plan')}>Review plan</button>{planDirty && <small>Save your plan edits before generating.</small>}</div>}
          {session?.status === 'awaiting_approval' && !active && <details className="authoring-preferences"><summary>Refine teaching requirements</summary><p>Who are the learners, and what should this activity do? Leave a field unchanged to keep the proposed plan.</p><label>Learner level<select aria-label="Learner level" value={audience} onChange={e => setAudience(e.target.value)}><option value="">Keep proposed audience</option><option value="introductory university students">Introductory</option><option value="intermediate university students">Intermediate</option><option value="advanced university students">Advanced</option></select></label><label>Teaching purpose<select aria-label="Teaching purpose" value={teachingGoal} onChange={e => setTeachingGoal(e.target.value)}><option value="">Keep proposed purpose</option><option value="low-stakes practice with explanatory feedback">Practice and feedback</option><option value="a pre-class readiness check">Prepare for class</option><option value="application and problem-solving practice">Apply concepts</option></select></label><label>Question difficulty<select aria-label="Question difficulty" value={difficulty} onChange={e => setDifficulty(e.target.value)}><option value="">Keep proposed difficulty</option><option value="easy">Easy</option><option value="moderate">Moderate</option><option value="hard">Hard</option></select></label><button className="btn btn-outline" disabled={!!busy || planDirty || !(audience || teachingGoal || difficulty)} onClick={() => command('message', { text: ['Revise the proposed teaching plan. Keep its topics and question counts.', audience && `Audience: ${audience}.`, teachingGoal && `Purpose: ${teachingGoal}.`, difficulty && `Difficulty: ${difficulty}.`].filter(Boolean).join(' ') })}>Update proposal</button><p>Review and approve the updated plan before generation.</p></details>}
          {candidate && <div className="authoring-decision"><strong>A revision to review</strong><ul>{candidate.changes.map((change, i) => <li key={i}>{change}</li>)}</ul><div className="authoring-decision-actions"><button className="btn btn-primary" disabled={!!busy || active || uncertain} onClick={() => command('accept', { versionId: candidate.id })}>Accept changes</button><button className="btn btn-outline" disabled={!!busy || active || uncertain} onClick={() => command('reject', { versionId: candidate.id })}>Keep current</button></div></div>}
          {(error || session?.error || refreshError) && <div className="authoring-error" role="alert"><p>{error || session?.error || refreshError}</p><button className="authoring-quiet" onClick={() => { setError(''); setRefreshError(''); setPoll(n => n + 1); }}><RefreshCw size={14} /> Check status</button>{uncertain && pending.current && <button className="authoring-quiet" disabled={!!busy} onClick={() => command(pending.current!.command)}>Retry same request</button>}{session && !active && ['needs_attention', 'cancelled'].includes(session.status) && <button className="authoring-quiet" disabled={!!busy || uncertain} onClick={() => command('retry')}>Resume task</button>}</div>}
          {!!session?.assistant?.generation?.reusedQuestions && <p className="authoring-muted">{session.assistant.generation.reusedQuestions} prepared {session.assistant.generation.reusedQuestions === 1 ? 'question' : 'questions'} reused from the previous attempt.</p>}
          {session?.assistant?.generation?.items.some(item => item.status === 'failed') && <section className="authoring-error" aria-label="Questions needing attention"><strong>Questions needing attention</strong><p>{session.assistant.generation.readyCount} of {session.assistant.generation.totalQuestions} questions prepared. No questions from this batch are published until the whole batch succeeds.</p>{session.assistant.generation.items.filter(item => item.status === 'failed').map(item => <details className="authoring-failed-question" key={item.index}><summary><strong>Question {item.index + 1}</strong>{questionRows[item.index]?.title && <span> · {questionRows[item.index].title}</span>}<p>{item.message || 'This question could not be completed. Check its instructions before retrying.'}</p></summary>{item.review ? <div><strong>Rejected draft — not published</strong><p>{item.review.questionText}</p><ul>{item.review.options.map((option, index) => <li key={index}>{option.text}{option.isCorrect ? ' (draft answer key)' : ''}</li>)}</ul><strong>Review observations</strong>{item.review.issues.length ? <ul>{item.review.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul> : <p>The review did not return a detailed explanation.</p>}<p>These are AI review observations, not a proof of correctness.</p></div> : <p>This attempt has no saved rejected draft or detailed review. New attempts can retain these details when the review rejects a question.</p>}{questionRows[item.index]?.instructions && <p><strong>Approved instructions:</strong> {questionRows[item.index].instructions}</p>}</details>)}<div className="authoring-decision-actions"><button className="authoring-quiet" disabled={active || !!busy} onClick={() => setText('Explain the failed question checks and help me revise the teaching plan. Ask me about any unclear requirements before changing it.')}>Discuss the failure</button>{failedBatch && <button className="authoring-quiet" disabled={active || !!busy} onClick={() => setPanel('plan')}>Edit teaching plan</button>}</div><p>Resume task retries the unchanged plan and may use additional AI credits. Save a revised plan, then approve it before generating.</p></section>}
          <div ref={end} />
        </div>
        {!session && <div className="authoring-context"><button className="authoring-context-toggle" onClick={() => setShowSources(v => !v)} aria-expanded={showSources}><FileText size={15} /><span>{selected.length ? `${selected.length} material${selected.length === 1 ? '' : 's'} attached` : 'Add course materials'}</span><ChevronDown size={14} /></button>{loading && <span className="authoring-muted">Loading courses…</span>}
          {showSources && <div className="authoring-source-picker"><label>Course<select value={courseId} disabled={!!busy} onChange={e => { setCourseId(e.target.value); setQuizId(''); setSelected([]); setMaterials([]); }}><option value="">Choose a course</option>{courses.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}</select></label><button className="authoring-quiet" onClick={() => setNewCourse(v => !v)}><Plus size={14} /> New course</button>{newCourse && <div className="authoring-course-create"><input aria-label="New course name" value={courseName} onChange={e => setCourseName(e.target.value)} placeholder="Course name" maxLength={150} /><button className="btn btn-outline" disabled={!courseName.trim() || !!busy} onClick={() => void act('course', async () => { const result = await foldersApi.createFolder(courseName.trim(), 1); setCourses(items => [result.folder, ...items]); setCourseId(result.folder._id); setQuizId(''); setSelected([]); setNewCourse(false); publish('course-created', { courseId: result.folder._id }); })}>Create</button></div>}
            {courseId && <label>Learning Object<select value={quizId} disabled={!!busy} onChange={e => setQuizId(e.target.value)}><option value="">Create a new Learning Object</option>{(courses.find(c => c._id === courseId)?.quizzes || []).map((q, i) => <option key={typeof q === 'string' ? q : q._id} value={typeof q === 'string' ? q : q._id}>{typeof q === 'string' ? `Learning Object ${i + 1}` : q.name}</option>)}</select></label>}
            <button className="authoring-upload" disabled={!!busy} onClick={() => file.current?.click()}><Upload size={18} /><span>{progress !== null ? `Uploading ${progress}%` : 'Upload PDF or DOCX'}<small>{courseId ? 'Drop files here or use the + menu below' : 'Choose a course and your files will upload automatically'}</small></span><Plus size={16} /></button>
            <div className="authoring-material-list">{materials.map(m => <label key={m._id}><input type="checkbox" checked={selected.includes(m._id)} disabled={!!busy || m.processingStatus === 'failed' || (!selected.includes(m._id) && selected.length >= 20)} onChange={e => setSelected(ids => e.target.checked ? [...ids, m._id] : ids.filter(id => id !== m._id))} /><FileText size={15} /><span>{m.name}</span><small>{m.processingStatus === 'completed' ? 'Ready' : m.processingStatus === 'failed' ? 'Failed · retry in Materials' : 'Processing'}</small></label>)}</div>
          </div>}
        </div>}
        {!!pendingFiles.length && <div className="authoring-queued-files" aria-live="polite"><div className="authoring-queued-heading"><strong>{busy === 'upload' ? 'Uploading materials' : session ? 'Files for a new activity' : courseId ? uploadFailed ? 'Upload needs attention' : 'Files ready to upload' : 'Files waiting for a course'}</strong><span>{pendingFiles.length} file{pendingFiles.length === 1 ? '' : 's'}</span></div>{pendingFiles.map((item, index) => <div className="authoring-queued-file" key={`${item.name}-${item.size}-${item.lastModified}`}><FileText size={15} /><span title={item.name}>{item.name}</span>{index === 0 && progress !== null && <small>{progress}%</small>}<button className="authoring-icon" aria-label={`Remove ${item.name}`} disabled={busy === 'upload' && index === 0} onClick={() => setPendingFiles(files => files.filter(file => file !== item))}><X size={14} /></button></div>)}{session ? <button className="authoring-quiet" onClick={() => void selectTask(null)}>Start new activity with these files <ArrowUpRight size={14} /></button> : !courseId ? <button className="authoring-quiet" onClick={() => setShowSources(true)}>Choose or create a course <ArrowUpRight size={14} /></button> : uploadFailed ? <button className="authoring-quiet" onClick={() => { setError(''); setUploadFailed(false); }}>Retry upload <RefreshCw size={14} /></button> : null}</div>}
        <form className="authoring-composer" onSubmit={submit}><textarea aria-label="Message Studio AI" value={text} onChange={e => setText(e.target.value)} placeholder={session ? 'Ask a question or describe what you’d like to change…' : 'Describe your learning activity, or start with your materials…'} maxLength={4000} rows={3} disabled={!!busy || uncertain} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} /><div className="authoring-composer-footer"><div className="authoring-composer-tools"><div className="authoring-tools-anchor" ref={toolsMenu}><button className={`authoring-tool-trigger ${showTools ? 'selected' : ''}`} type="button" aria-label="Add tools and materials" aria-expanded={showTools} aria-haspopup="menu" onClick={() => setShowTools(value => !value)}><Plus size={19} /></button>{showTools && <div className="authoring-tool-menu" role="menu"><span>ADD TO YOUR WORKSPACE</span><button type="button" role="menuitem" onClick={() => file.current?.click()}><Upload size={17} /><span><strong>Upload files</strong><small>PDF or DOCX course materials</small></span></button><button type="button" role="menuitem" onClick={() => { setShowTools(false); if (session) void selectTask(null); setShowSources(true); }}><FileText size={17} /><span><strong>Choose course materials</strong><small>{session ? 'Start a new activity with sources' : 'Use files already in a course'}</small></span></button><button type="button" role="menuitem" onClick={() => { setShowTools(false); if (session) void selectTask(null); setShowSources(true); setNewCourse(true); }}><Plus size={17} /><span><strong>Create a course</strong><small>Give new materials a home</small></span></button><div className="authoring-tool-divider" /><button type="button" role="menuitem" onClick={() => { setShowTools(false); setShowHistory(true); }}><History size={17} /><span><strong>Conversation history</strong><small>Continue a saved activity</small></span></button></div>}</div>{!session ? <label className="authoring-auto"><input type="checkbox" checked={autoApprove} onChange={e => setAutoApprove(e.target.checked)} />Generate draft automatically</label> : <span><span className={`authoring-status-dot ${active ? 'working' : ''}`} />{active ? 'Task running' : 'Progress saved'}</span>}</div>{active ? <button type="button" className="authoring-send stop" aria-label="Stop task" disabled={!!busy} onClick={() => void act('cancel', async () => { receive(extract(await studioAuthoringApi.cancel(session!.id, session!.revision))); setPoll(v => v + 1); })}><Square size={15} fill="currentColor" /></button> : <button className="authoring-send" type="submit" aria-label={session ? 'Send message' : 'Start learning activity'} disabled={!!busy || loading || uncertain || (session ? !text.trim() || !!candidate : !selected.length || !courseId || !!pendingFiles.length)}>{busy ? <Loader2 size={18} className="spin" /> : <ArrowUp size={20} />}</button>}</div></form>
        <p className="authoring-composer-note">{!session ? autoApprove ? 'We’ll generate within the recommended plan. You can stop and review at any time.' : 'You’ll review the teaching plan before questions are generated.' : 'AI drafts need your review. Enter to send · Shift + Enter for a new line.'}</p>
      </div>
      {session && <aside className="authoring-artifact" aria-label="Activity workspace"><div className="authoring-artifact-header"><div><Layers3 size={17} /><strong>Your activity</strong>{viewed && <span className="authoring-version-badge">v{viewed.number}{viewed.state === 'candidate' ? ' · proposed' : ''}</span>}</div><button className="authoring-icon" aria-label="Refresh activity" onClick={() => setPoll(v => v + 1)}><RefreshCw size={15} /></button></div>
        <div className="authoring-tabs" role="tablist" aria-label="Activity views">{(['preview', 'plan', 'questions'] as const).map(tab => <button key={tab} role="tab" aria-selected={panel === tab} aria-controls={`authoring-${tab}`} onClick={() => setPanel(tab)}>{tab === 'preview' ? 'Preview' : tab === 'plan' ? 'Teaching plan' : 'Questions & sources'}</button>)}</div>
        <div className="authoring-artifact-content" role="tabpanel" id={`authoring-${panel}`}>
          {panel === 'preview' && (viewed ? <><div className="authoring-preview-version"><label>Viewing<select value={viewed.id} onChange={e => setViewVersion(e.target.value)}>{session.versions.filter(v => v.state !== 'rejected').map(v => <option key={v.id} value={v.id}>Version {v.number}{v.id === session.currentVersionId ? ' · current' : v.state === 'candidate' ? ' · proposed' : ''}</option>)}</select></label>{viewed.representation === 'native-fork' && <small>Independent Studio version</small>}</div><StudioPreview key={viewed.id} contentId={viewed.contentId} title={viewed.title} /></> : <div className="authoring-artifact-empty"><Layers3 size={38} strokeWidth={1.2} /><h3>A place for your ideas to take shape</h3><p>Your H5P preview will appear here after the teaching plan is approved and the activity is ready.</p><button className="authoring-quiet" onClick={() => setPanel('plan')}>View teaching plan <ArrowUpRight size={14} /></button></div>)}
          {panel === 'plan' && <div className="authoring-plan">{!planDraft?.objectives.length ? <div className="authoring-artifact-empty"><BookOpen size={32} strokeWidth={1.2} /><h3>Starting with the learning</h3><p>We’ll read your materials, identify learning objectives and recommend a question mix.</p></div> : <><div className="authoring-section-heading"><span className="authoring-kicker">LEARNING OBJECTIVES</span><span>{planDraft.objectives.length} objectives</span></div>{planDraft.objectives.map((lo, index) => <div className="authoring-objective" key={lo.id}><span>{String(index + 1).padStart(2, '0')}</span><div><textarea aria-label={`Learning objective ${index + 1}`} value={lo.text} rows={3} disabled={!editablePlan} onChange={e => { setPlanDraft(d => d ? { ...d, objectives: d.objectives.map(item => item.id === lo.id ? { ...item, text: e.target.value } : item) } : d); setPlanDirty(true); }} />{!!lo.sourceReferences?.length && <button className="authoring-source-link" onClick={() => setReference(lo.sourceReferences![0])}><FileText size={12} />{lo.sourceReferences[0].materialName || 'Source evidence'}{lo.sourceReferences[0].pageNumber ? ` · p. ${lo.sourceReferences[0].pageNumber}` : ''}</button>}</div></div>)}<div className="authoring-section-heading"><span className="authoring-kicker">QUESTION MIX</span><span>{total} questions</span></div>{planDraft.plan.map((row, index) => <div className="authoring-plan-row" key={row.id}><div><strong>{row.title}</strong><small>{row.questionType.replaceAll('-', ' ')}</small><textarea aria-label={`Question instructions for plan row ${index + 1}`} value={row.instructions} maxLength={4000} rows={4} disabled={!editablePlan} onChange={e => { setPlanDraft(d => d ? { ...d, plan: d.plan.map(item => item.id === row.id ? { ...item, instructions: e.target.value } : item) } : d); setPlanDirty(true); }} /></div><input aria-label={`Question count for plan row ${index + 1}`} type="number" min={1} max={20} value={row.count} disabled={!editablePlan} onChange={e => { setPlanDraft(d => d ? { ...d, plan: d.plan.map(item => item.id === row.id ? { ...item, count: Number(e.target.value) } : item) } : d); setPlanDirty(true); }} /></div>)}{planDirty && <div className="authoring-plan-save"><span>{validPlan ? 'Unsaved plan changes' : 'Keep 1–20 questions and complete each objective.'}</span><button className="btn btn-primary" disabled={!!busy || !validPlan} onClick={() => void act('plan', savePlan)}>Save plan</button></div>}</> }</div>}
          {panel === 'questions' && <div className="authoring-questions">{!viewed?.questions.length ? <div className="authoring-artifact-empty"><FileText size={32} /><h3>{viewed?.representation === 'native-fork' ? 'Review this version in Preview' : 'Questions will appear here'}</h3><p>{viewed?.representation === 'native-fork' ? 'Native Studio changes do not update the linked course questions or their evidence map.' : 'Each course question keeps its learning objective and supporting evidence.'}</p></div> : viewed.questions.map(q => <article key={q.id}><small>QUESTION {q.index} · {q.type.replaceAll('-', ' ')}</small><h3>{q.text}</h3>{q.explanation && <p>{q.explanation}</p>}<div>{q.sourceReferences.map((source, i) => <button key={i} className="authoring-source-link" onClick={() => setReference(source)}><FileText size={12} />{source.materialName || source.sourceFile || 'Source'}{source.pageNumber ? ` · p. ${source.pageNumber}` : ''}</button>)}</div><button className="authoring-quiet" disabled={active || !!candidate} onClick={() => { setText(`Revise question ${q.index}: `); }}>Ask for a revision <ArrowUpRight size={13} /></button></article>)}</div>}
        </div>
        <footer className="authoring-artifact-footer">{viewed ? <><details className="authoring-versions"><summary><History size={14} /> Version history <ChevronDown size={13} /></summary><div>{session.versions.filter(v => v.state === 'accepted').map(v => <article key={v.id}><button onClick={() => { setViewVersion(v.id); setPanel('preview'); }}><strong>v{v.number}{v.id === session.currentVersionId ? ' · Current' : ''}</strong><span>{v.summary}</span></button>{v.id !== session.currentVersionId && <button className="authoring-icon" aria-label={`Restore version ${v.number}`} disabled={active || !!busy || !!candidate} onClick={() => void showConfirm({ title: `Restore version ${v.number}?`, description: 'This creates a new version from the saved content. Your history is kept. Linked course versions also restore their questions and plan; external downloads and deployments are unchanged.', confirmLabel: 'Restore version', cancelLabel: 'Keep current' }).then(ok => { if (ok) command('restore', { versionId: v.id }); })}><RotateCcw size={15} /></button>}</article>)}</div></details><div className="authoring-export-actions"><button className="authoring-quiet" disabled={!!busy || active || viewed.state !== 'accepted'} onClick={() => callbacks.current.onOpenActivity(viewed.contentId, false)}><SlidersHorizontal size={14} /> Advanced editor</button><button className="btn btn-primary" disabled={!!busy} onClick={() => void act('download', async () => { const blob = await h5pEditorApi.downloadContent(viewed.contentId); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${viewed.title.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 100) || 'activity'}-v${viewed.number}.h5p`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); })}><Download size={14} /> Download H5P</button></div></> : <span className="authoring-muted"><Clock3 size={14} /> Your activity and versions are saved here</span>}{session.quizId && <Link className="authoring-course-link" to={`/course/${session.courseId}/quiz/${session.quizId}?tab=review`}>Open course workspace <ArrowUpRight size={12} /></Link>}</footer>
      </aside>}
    </div>
    {reference && <SourceReferencePreviewModal reference={reference} onClose={() => setReference(null)} />}
  </section>;
}
