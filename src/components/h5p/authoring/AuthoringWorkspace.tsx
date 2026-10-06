import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, ArrowUpRight, BookOpen, Check, ChevronDown, Clock3, Download, FileText, History, Layers3, Loader2, MessageSquare, Plus, RefreshCw, RotateCcw, Search, SlidersHorizontal, Square, Upload, X } from 'lucide-react';
import { ApiError, materialsApi, studioAuthoringApi, studioAssistantApi, h5pEditorApi,
  type AuthoringMode, type AuthoringSession, type AuthoringContextCatalog, type SourceReference } from '../../../services/api';
import { useSSE } from '../../../hooks/useSSE';
import AuthoringContextPicker, { caretAnchor, ContextIcon, type ContextChip } from './AuthoringContextPicker';
import PreparedQuestionPreview from './PreparedQuestionPreview';
import StudioPreview from '../StudioPreview';
import TeachingRequirementsCard from './TeachingRequirementsCard';
import AuthoringTeachingBrief, { type ObjectiveEdit, type AssumptionEdit } from './AuthoringTeachingBrief';
import { mergeAuthoringOperations } from './authoringOperations';
import AuthoringProgress from './AuthoringProgress';
import AuthoringClarification from './AuthoringClarification';
import RejectedDraftDetails from './RejectedDraftDetails';
import QuestionCheckSummary from './QuestionCheckSummary';
import QuestionFailureSummary, { QuestionFailureDetails } from './QuestionFailureSummary';
import NativeActivityPlan from './NativeActivityPlan';
import AuthoringStudioActions from './AuthoringStudioActions';
import SourceReferencePreviewModal from '../../SourceReferencePreviewModal';
import { useSystemDialog } from '../../system-dialog/SystemDialogProvider';
import { usePubSub } from '../../../hooks/usePubSub';
import { QUESTION_TYPES } from '../../../constants/questionTypeCapabilities';
import { downloadBlob } from '../../../utils/downloadBlob';
import '../../../styles/pages/StudioAuthoring.css';

interface Props {
  ownerId: string; sessionId?: string; initialCourseId?: string; initialQuizId?: string;
  onSessionChange: (id: string | null) => void;
  onOpenActivity: (id: string, preview: boolean) => void;
  onAdvanced: () => void;
  onImport?: () => void;
  onNewBlank?: () => void;
  importing?: boolean;
  onReturnCoursePlan?: () => void;
}
const labels: Record<AuthoringSession['status'], string> = {
  exploring: 'Exploring your teaching idea',
  waiting_for_materials: 'Waiting for material processing', planning: 'Preparing your teaching plan', awaiting_approval: 'Ready for your review',
  awaiting_requirements: 'Waiting for your teaching choices',
  objectives_ready: 'Learning objectives ready',
  generating: 'Creating your activity', ready: 'Ready', working: 'Working on your request', needs_attention: 'Needs attention', cancelled: 'Stopped',
};
const modeLabels: Record<AuthoringMode, string> = { explore: 'Explore teaching idea', build: 'Build activity' };
const queuedLabels = { queued: 'Waiting for the current task', running: 'Working on this message', succeeded: 'Completed', failed: 'Needs attention', cancelled: 'Cancelled' };
const running = (session: AuthoringSession | null) => !!session?.run && ['queued', 'running', 'waiting'].includes(session.run.status);
const materialRestoreScope = (session: AuthoringSession | null) => JSON.stringify([
  session?.id, session?.run?.id, session?.assistant?.generation?.requestId, session?.materialIds
]);
const editableObjectives = (session: AuthoringSession) => {
  const candidateVersion = session.versions.find(version => version.id === session.candidateVersionId);
  if (candidateVersion?.representation === 'course-linked') return candidateVersion.teachingPlan?.objectives || [];
  if (candidateVersion?.representation === 'native-fork' && candidateVersion.teachingBrief) return candidateVersion.teachingBrief.objectives;
  const currentVersion = session.versions.find(version => version.id === session.currentVersionId);
  if (currentVersion?.representation === 'course-linked') return currentVersion.teachingPlan?.objectives || [];
  if (currentVersion?.representation === 'native-fork') return currentVersion.teachingBrief?.objectives || session.teachingBrief?.objectives || [];
  return session.assistant?.objectives.length ? session.assistant.objectives
    : session.teachingBrief?.objectives || session.assistant?.teachingBrief?.objectives || [];
};
const objectiveEditor = (session: AuthoringSession): ObjectiveEdit => {
  const items = editableObjectives(session).map(item => ({ id: item.id, text: item.text }));
  return { sessionId: session.id, currentVersionId: session.currentVersionId, ...(session.currentVersionId ? {} : {
    assistantId: session.assistant?.id, assistantRevision: session.assistant?.revision
  }), items, originalItems: items.map(item => ({ ...item })) };
};
const objectiveEditsStale = (session: AuthoringSession | null, edit: ObjectiveEdit | null) => !!edit && !!session
  && edit.sessionId === session.id && (edit.currentVersionId !== session.currentVersionId
    || JSON.stringify(editableObjectives(session).map(item => ({ id: item.id, text: item.text }))) !== JSON.stringify(edit.originalItems));
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed.';
const questionTypeLabel = (type: string) => QUESTION_TYPES.find(item => item.value === type.toLowerCase().replaceAll(' ', '-'))?.label || type.replaceAll('-', ' ');
const extract = (response: { data?: { session: AuthoringSession } }) => {
  if (!response.data?.session) throw new Error('The saved task was not returned. Check status before retrying.');
  return response.data.session;
};

export default function AuthoringWorkspace({ ownerId, sessionId, initialCourseId = '', initialQuizId = '', onSessionChange, onOpenActivity, onAdvanced, onImport, onNewBlank, importing, onReturnCoursePlan }: Props) {
  const [session, setSession] = useState<AuthoringSession | null>(null);
  const [recent, setRecent] = useState<Array<Pick<AuthoringSession, 'id' | 'title' | 'status' | 'updatedAt'>>>([]);
  const [catalog, setCatalog] = useState<AuthoringContextCatalog>({ courses: [], materials: [], objectives: [] });
  const [courseId, setCourseId] = useState(initialCourseId);
  const [quizId, setQuizId] = useState(initialQuizId);
  const [objectiveIds, setObjectiveIds] = useState<string[]>([]);
  const [contextCourse, setContextCourse] = useState(!!initialCourseId);
  const contextDirty = useRef(false);
  const [contextPreview, setContextPreview] = useState<ContextChip | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [mention, setMention] = useState<{ left: number; top: number; start: number; end: number; query: string } | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const closePreview = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const selectedContext = useRef({ courseId, materialIds: selected, objectiveIds, contextCourse });
  selectedContext.current = { courseId, materialIds: selected, objectiveIds, contextCourse };
  const [text, setText] = useState('');
  const [mode, setMode] = useState<AuthoringMode>(initialQuizId ? 'build' : 'explore');
  const modeDirty = useRef(false);
  const [audience, setAudience] = useState('');
  const [teachingGoal, setTeachingGoal] = useState('');
  const [difficulty, setDifficulty] = useState('');
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
  const [materialRestoreNotice, setMaterialRestoreNotice] = useState('');
  const [objectiveEdit, setObjectiveEdit] = useState<ObjectiveEdit | null>(null);
  const [pendingObjectiveEdit, setPendingObjectiveEdit] = useState<string | null>(null);
  const [assumptionEdit, setAssumptionEdit] = useState<AssumptionEdit | null>(null);
  const [refreshError, setRefreshError] = useState('');
  const [loading, setLoading] = useState(true);
  const [poll, setPoll] = useState(0);
  const [progress, setProgress] = useState<number | null>(null);
  const [reference, setReference] = useState<SourceReference | null>(null);
  const [planDraft, setPlanDraft] = useState<AuthoringSession['assistant']>(null);
  const [planDirty, setPlanDirty] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const end = useRef<HTMLDivElement>(null);
  const operation = useRef(false);
  const alive = useRef(true);
  const callbacks = useRef({ onSessionChange, onOpenActivity });
  callbacks.current = { onSessionChange, onOpenActivity };
  const current = useRef({ session, courseId, sessionId, planDirty });
  current.current = { session, courseId, sessionId, planDirty };
  const pending = useRef<{ command: Parameters<typeof studioAuthoringApi.command>[1]; body: Parameters<typeof studioAuthoringApi.command>[2]; id: string; preserveComposer: boolean; onAccepted?: () => void } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const { showConfirm } = useSystemDialog();
  const { publish } = usePubSub('StudioAuthoring');
  const pendingKey = `create-authoring-request:${ownerId}`;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { pending.current = null; setUncertain(false); setObjectiveEdit(null); setPendingObjectiveEdit(null); setAssumptionEdit(null); }, [sessionId, ownerId]);
  const materialRestoreKey = materialRestoreScope(session);
  useEffect(() => { setMaterialRestoreNotice(''); }, [sessionId, materialRestoreKey]);

  const receive = useCallback((next: AuthoringSession) => {
    if (!alive.current || (current.current.session?.id === next.id && next.revision < current.current.session.revision)) return;
    const previous = current.current.session;
    if (previous?.id === next.id) next = { ...next, operations: mergeAuthoringOperations(previous.operations, next.operations) };
    current.current = { ...current.current, session: next };
    setSession(next);
    if (!modeDirty.current || previous?.id !== next.id) setMode(next.mode || 'build');
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
    if (!previous?.assistant?.generation?.readyCount && next.assistant?.generation?.readyCount) setPanel('preview');
    const local = selectedContext.current;
    if (contextDirty.current && local.courseId === next.courseId && local.contextCourse === !!next.contextCourse && JSON.stringify([...local.materialIds].sort()) === JSON.stringify([...next.materialIds].sort()) && JSON.stringify([...local.objectiveIds].sort()) === JSON.stringify([...(next.objectiveIds || [])].sort())) contextDirty.current = false;
    if (!contextDirty.current || previous?.id !== next.id) {
      setCourseId(next.courseId); setSelected(next.materialIds); setObjectiveIds(next.objectiveIds || []); setContextCourse(next.contextCourse ?? false);
    }
  }, [publish]);

  useEffect(() => {
    if (!pendingObjectiveEdit || session?.id !== pendingObjectiveEdit || running(session) || busy) return;
    setPendingObjectiveEdit(null);
    if (session.candidateVersionId) { setError('Review or discard the candidate before editing its objectives.'); return; }
    setObjectiveEdit(objectiveEditor(session));
  }, [pendingObjectiveEdit, session, busy]);

  useEffect(() => {
    if (!objectiveEdit || objectiveEdit.sessionId !== session?.id || !objectiveEdit.assistantId
      || objectiveEdit.assistantId !== session.assistant?.id || objectiveEdit.assistantRevision === session.assistant.revision) return;
    const latest = session.assistant.objectives.map(item => ({ id: item.id, text: item.text }));
    // A failed reservation can advance the revision without changing its LOs.
    // Keep the text edits, but never authorize replacing another task's edits.
    if (JSON.stringify(latest) === JSON.stringify(objectiveEdit.originalItems)) {
      setObjectiveEdit(draft => draft ? { ...draft, assistantRevision: session.assistant!.revision } : draft);
    }
  }, [session, objectiveEdit]);

  const { connectionStatus } = useSSE(sessionId ? studioAuthoringApi.eventsUrl(sessionId) : null, {
    onAuthoringSnapshot: next => { receive(next); setRefreshError(''); },
    onAuthoringOperation: event => {
      const previous = current.current.session;
      if (!previous || previous.id !== event.sessionId) return;
      const next = { ...previous, operations: mergeAuthoringOperations(previous.operations, [event.operation]) };
      current.current = { ...current.current, session: next }; setSession(next);
    },
  });
  const streamStatus = useRef(connectionStatus);
  streamStatus.current = connectionStatus;

  useEffect(() => {
    let active = true;
    studioAuthoringApi.list().then(tasks => {
      if (!active) return;
      setRecent(tasks.data?.sessions || []);
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
        timeout = setTimeout(refresh, streamStatus.current === 'connected' ? 30000 : running(next) ? 3000 : 8000);
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
    if (!courseId) return;
    let active = true;
    let timeout: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const response = await studioAuthoringApi.context(courseId);
        if (!active) return;
        if (response.data) setCatalog(response.data);
        if (response.data?.materials.some(m => ['pending', 'processing'].includes(m.status))) timeout = setTimeout(refresh, 2500);
      } catch (err) {
        if (active) { setRefreshError(errorText(err)); timeout = setTimeout(refresh, 8000); }
      }
    };
    void refresh();
    return () => { active = false; clearTimeout(timeout); };
  }, [courseId, poll]);

  useEffect(() => { const transcript = end.current?.parentElement; transcript?.scrollTo?.({ top: transcript.scrollHeight, behavior: 'smooth' }); }, [session?.messages.length, session?.queuedMessages?.length, session?.status]);
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
  const restoreMaterialSearch = () => {
    if (!session || running(session) || uncertain || !session.materialIds.length
      || !session.assistant?.generation?.items.some(item => item.status === 'failed' && item.failure?.code === 'MATERIAL_INDEX_MISSING')) return;
    const target = session;
    const route = current.current.sessionId;
    const scope = materialRestoreScope(target);
    const valid = () => alive.current && current.current.sessionId === route
      && materialRestoreScope(current.current.session) === scope && !running(current.current.session);
    void act('restore-material-search', async () => {
      setMaterialRestoreNotice('');
      try {
        for (const materialId of target.materialIds) {
          if (!valid()) return;
          const restored = await materialsApi.reindexMaterial(materialId);
          if (!valid()) return;
          if (!restored.processing?.restored || restored.processing.materialId !== materialId) {
            throw new Error('Material search restoration was not confirmed. Check status before resuming.');
          }
        }
        if (valid()) setMaterialRestoreNotice('Materials are searchable again. Choose Resume task to continue.');
      } catch (err) {
        if (valid()) throw err;
      }
    });
  };
  const command = (kind: Parameters<typeof studioAuthoringApi.command>[1], extra: Omit<Parameters<typeof studioAuthoringApi.command>[2], 'requestId' | 'revision'> = {}, preserveComposer = false, onAccepted?: () => void) => {
    if (!session) return;
    void act(kind, async () => {
      const route = current.current.sessionId;
      const request = pending.current || { id: session.id, command: kind, body: { requestId: crypto.randomUUID(), revision: session.revision, ...extra }, preserveComposer, onAccepted };
      const valid = () => alive.current && current.current.sessionId === route && current.current.session?.id === request.id;
      pending.current = request;
      try {
        const next = extract(await studioAuthoringApi.command(request.id, request.command, request.body));
        if (!valid()) return;
        pending.current = null; setUncertain(false);
        if (request.command === 'message' && !request.preserveComposer) { setText(''); modeDirty.current = false; }
        receive(next); setPoll(value => value + 1);
        request.onAccepted?.();
      } catch (err) {
        if (!valid()) return;
        // A received client error is a definite rejection, not an ambiguous
        // transport failure. Refresh the revision so the user can try anew.
        const rejected = err instanceof ApiError && err.status >= 400 && err.status < 500;
        if (rejected) { pending.current = null; setPoll(value => value + 1); }
        setUncertain(!rejected); throw err;
      }
    });
  };
  const openObjectiveEditor = () => {
    if (!session || operation.current || uncertain || session.candidateVersionId || assumptionEdit || pendingObjectiveEdit) return;
    if (!running(session)) { setObjectiveEdit(objectiveEditor(session)); return; }
    const targetId = session.id; const route = current.current.sessionId;
    setPendingObjectiveEdit(targetId);
    void act('pause-objectives', async () => {
      try {
        const next = extract(await studioAuthoringApi.cancel(targetId, session.revision));
        if (!alive.current || current.current.sessionId !== route || current.current.session?.id !== targetId) return;
        receive(next); setPoll(value => value + 1);
      } catch (err) {
        if (!alive.current || current.current.sessionId !== route || current.current.session?.id !== targetId) return;
        setPendingObjectiveEdit(null); throw err;
      }
    });
  };
  const saveObjectives = () => {
    if (!objectiveEdit || objectiveEdit.sessionId !== session?.id || running(session) || objectiveEditsStale(session, objectiveEdit)) return;
    command('save_objectives', { objectives: objectiveEdit.items.map(item => ({ id: item.id, text: item.text.trim() })),
      ...(objectiveEdit.assistantRevision != null ? { assistantRevision: objectiveEdit.assistantRevision } : {}) }, true, () => setObjectiveEdit(null));
  };
  const saveAssumptions = () => {
    if (!assumptionEdit || assumptionEdit.sessionId !== session?.id || running(session)) return;
    const fieldLabels: Record<string, string> = { questionCount: 'Question count', audience: 'Audience', difficulty: 'Difficulty', purpose: 'Purpose', topic: 'Topic' };
    command('message', { text: ['Update the teaching requirements for this task using these explicit values:',
      ...assumptionEdit.items.map(item => `${fieldLabels[item.key] || item.key}: ${item.value.trim()}`)].join('\n') }, true, () => setAssumptionEdit(null));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (operation.current || uncertain) return;
    if (objectiveEdit || assumptionEdit || pendingObjectiveEdit) { setError('Save or cancel your teaching brief edits before sending another message.'); return; }
    if (planDirty) { setError('Save your teaching plan edits before sending another request.'); setPanel('plan'); setPreviewOpen(true); return; }
    const context = { courseId: courseId || undefined, materialIds: selected, objectiveIds, contextCourse };
    if (session) {
      if (text.trim() || contextDirty.current || modeDirty.current) command('message', {
        text: text.trim() || (modeDirty.current ? mode === 'build' ? 'Build a learning activity from our teaching discussion.' : 'Explore the teaching approach with me before building an activity.' : 'Update the teaching proposal using this context.'),
        ...(contextDirty.current ? { context } : {}), ...(running(session) ? { delivery: 'queue' as const } : {}), ...(modeDirty.current ? { mode } : {})
      });
      return;
    }
    if (!text.trim() && !selected.length && !objectiveIds.length && !contextCourse) return;
    void act('create', async () => {
      const requestId = sessionStorage.getItem(pendingKey) || crypto.randomUUID();
      sessionStorage.setItem(pendingKey, requestId);
      const next = extract(await studioAuthoringApi.create({ requestId, courseId, ...(quizId ? { quizId } : {}),
        ...context, instructions: text.trim(), autoApprove: false, mode }));
      sessionStorage.removeItem(pendingKey);
      contextDirty.current = false; receive(next); setText(''); callbacks.current.onSessionChange(next.id);
    });
  };
  const queueFiles = (files: File[]) => {
    if (!files.length) return;
    const valid = files.filter(item => /\.(pdf|docx)$/i.test(item.name) && item.size > 0);
    if (valid.length !== files.length) setError('Only non-empty PDF and DOCX files can be added.');
    if (!valid.length) return;
    setPendingFiles(items => {
      const unique = valid.filter(item => !items.some(existing => existing.name === item.name && existing.size === item.size && existing.lastModified === item.lastModified));
      if (items.length + unique.length + selected.length > 20) {
        setError('An activity can use up to 20 materials. Remove a queued file or deselect a material first.');
        return items;
      }
      return [...items, ...unique];
    });
    setUploadFailed(false);
    setShowTools(false);
  };
  const upload = (event: ChangeEvent<HTMLInputElement>) => {
    queueFiles(Array.from(event.target.files || []));
    event.target.value = '';
  };
  useEffect(() => {
    if (!pendingFiles.length || uploadFailed || operation.current || busy || running(session)) return;
    const nextFile = pendingFiles[0];
    void act('upload', async () => {
      setProgress(0);
      try {
        let targetCourse = courseId;
        if (!targetCourse) {
          const draft = await studioAuthoringApi.draftCourse();
          if (!draft.data?.courseId) throw new Error('Could not prepare a place for your files. Retry upload.');
          targetCourse = draft.data.courseId; setCourseId(targetCourse); current.current.courseId = targetCourse;
        }
        const result = await materialsApi.uploadFiles(targetCourse, [nextFile], setProgress);
        if (!result.materials.length) throw new Error(`${nextFile.name} was not added. It may already be in this course.`);
        if (current.current.courseId !== targetCourse) return;
        contextDirty.current = true;
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
  const blockUnsavedBriefNavigation = () => {
    const dirty = objectiveEdit?.items.some(item => objectiveEdit.originalItems.find(original => original.id === item.id)?.text.trim() !== item.text.trim())
      || assumptionEdit?.items.some(item => assumptionEdit.originalItems.find(original => original.key === item.key)?.value.trim() !== item.value.trim());
    if (!dirty) return false;
    setError('Save or cancel your teaching brief edits before leaving this task.');
    return true;
  };
  const selectTask = async (id: string | null) => {
    if (operation.current) return;
    if (blockUnsavedBriefNavigation()) return;
    if (planDirty && !await showConfirm({ title: 'Discard unsaved plan edits?', description: 'Your saved teaching plan is kept. The unsaved changes will be discarded.', confirmLabel: 'Discard edits', cancelLabel: 'Keep editing', tone: 'warning' })) return;
    pending.current = null; setUncertain(false); setError(''); setRefreshError(''); setPlanDirty(false); setSession(null); setText(''); setShowHistory(false); setShowTools(false);
    setObjectiveEdit(null); setPendingObjectiveEdit(null); setAssumptionEdit(null);
    setQuizId(''); setSelected([]); setObjectiveIds([]); setCourseId(''); setContextCourse(false); contextDirty.current = false; setMode('explore'); modeDirty.current = false; setPreviewOpen(false); setMention(null); current.current.session = null;
    if (!id) sessionStorage.removeItem(pendingKey);
    callbacks.current.onSessionChange(id);
  };

  const closePicker = () => { setShowTools(false); setMention(null); };
  const finishMention = () => {
    if (mention) setText(value => value.slice(0, mention.start) + value.slice(mention.end));
    closePicker(); composer.current?.focus();
  };
  const detectMention = (input: HTMLTextAreaElement) => {
    const prefix = input.value.slice(0, input.selectionStart);
    const match = /(?:^|\s)@([^\s@]*)$/.exec(prefix);
    if (!match || running(session)) { setMention(null); return; }
    setShowTools(false); setMention({ ...caretAnchor(input), start: prefix.lastIndexOf('@'), end: input.selectionStart, query: match[1] });
  };
  const chooseCourse = (id: string, pin: boolean) => {
    if (id !== courseId) { setSelected([]); setObjectiveIds([]); setQuizId(''); setContextCourse(pin); }
    else if (pin) setContextCourse(true);
    contextDirty.current = true; setCourseId(id); if (pin) finishMention();
  };
  const chips: ContextChip[] = [
    ...(contextCourse && courseId ? [{ id: courseId, kind: 'course' as const, name: catalog.courses.find(c => c.id === courseId)?.name || 'Course', preview: [catalog.courses.find(c => c.id === courseId)?.description, 'CREATE can read your materials and learning objectives in this course, and select ready materials for an initial proposal.'].filter(Boolean).join('\n\n') }] : []),
    ...selected.map(id => { const item = catalog.materials.find(m => m.id === id); return { id, kind: 'material' as const, name: item?.name || 'Material', preview: item?.preview || '', status: item?.status }; }),
    ...objectiveIds.map(id => { const item = catalog.objectives.find(lo => lo.id === id); return { id, kind: 'objective' as const, name: item?.name || 'Learning objective', preview: item ? `${item.name}\n\nFrom: ${item.quizName}` : '' }; })
  ];
  const active = running(session);
  const currentVersion = session?.versions.find(v => v.id === session.currentVersionId);
  const candidate = session?.versions.find(v => v.id === session.candidateVersionId);
  const viewed = session?.versions.find(v => v.id === viewVersion) || candidate || currentVersion;
  const visiblePlan = viewed ? viewed.teachingPlan : planDraft;
  const visiblePlanTotal = visiblePlan?.plan.reduce((sum, row) => sum + row.count, 0) || 0;
  const visibleQuestions = viewed?.questions || session?.assistant?.generation?.questions || [];
  const nativePlan = session?.nativePlan;
  const teachingBrief = candidate?.teachingBrief || currentVersion?.teachingBrief || session?.teachingBrief || session?.assistant?.teachingBrief;
  const briefObjectives = session ? editableObjectives(session) : [];
  const previewLabel = viewed?.representation === 'native-fork' || nativePlan ? 'Activity preview' : 'Question set preview';
  const failedBatch = !session?.currentVersionId && session?.assistant?.status === 'failed'
    && session.assistant.phase === 'generating' && session.assistant.errorCode === 'ASSISTANT_QUESTION_BATCH_FAILED';
  const canRestoreMaterialSearch = !!session?.materialIds.length
    && !!session.assistant?.generation?.items.some(item => item.status === 'failed' && item.failure?.code === 'MATERIAL_INDEX_MISSING');
  const briefEditing = !!objectiveEdit || !!assumptionEdit || !!pendingObjectiveEdit;
  const editablePlan = !viewed && (session?.status === 'awaiting_approval' || failedBatch) && !active && !busy && !briefEditing;
  const questionRows = session?.assistant?.plan.flatMap(row => Array.from({ length: row.count }, () => row)) || [];
  const total = planDraft?.plan.reduce((sum, row) => sum + row.count, 0) || 0;
  const validPlan = !!planDraft?.plan.length && total > 0 && total <= 20 && planDraft.plan.every(row => Number.isInteger(row.count) && row.count > 0) && planDraft.objectives.every(lo => lo.text.trim()) && planDraft.plan.every(row => row.instructions.trim());
  const visibleTasks = recent.filter(task => `${task.title} ${labels[task.status]}`.toLowerCase().includes(historyQuery.trim().toLowerCase()));
  const leaveWorkspace = async (action: () => void) => {
    if (blockUnsavedBriefNavigation()) return;
    if (!planDirty || await showConfirm({ title: 'Discard unsaved plan edits?', description: 'Your saved plan is kept. Unsaved edits will be discarded.', confirmLabel: 'Discard edits', cancelLabel: 'Keep editing', tone: 'warning' })) action();
  };

  useEffect(() => {
    if (previewOpen && window.matchMedia('(max-width: 1000px)').matches) closePreview.current?.focus({ preventScroll: true });
  }, [previewOpen]);

  return <section className={`authoring-workspace ${draggingFiles ? 'is-dragging-files' : ''}`} aria-label="Studio AI workspace" onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
    <header className="authoring-topbar">
      <div className="authoring-heading"><span className="authoring-mark"><MessageSquare size={17} /></span><div>
        <h1>H5P Studio <span>AI workspace</span></h1>
        <div className="authoring-task-meta"><strong title={session?.title || 'New teaching conversation'}>{session?.title || 'New teaching conversation'}</strong>
          {session && <span className="authoring-task-status"><i className={`authoring-status-dot ${active ? 'working' : ''}`} />{labels[session.status]}</span>}</div>
      </div></div>
      <div className="authoring-top-actions">
        <button className={`authoring-history-trigger ${showHistory ? 'selected' : ''}`} title="Task history" aria-label="Task history" aria-expanded={showHistory} onClick={() => setShowHistory(v => !v)}><History size={17} /><span>History</span></button>
        <button className="authoring-new-task" title="New task" aria-label="New task" disabled={!!busy} onClick={() => void selectTask(null)}><Plus size={17} /><span>New task</span></button>
        <AuthoringStudioActions disabled={!!busy} importing={importing} onImport={onImport ? () => { void leaveWorkspace(onImport); } : undefined}
          onNewBlank={onNewBlank ? () => { void leaveWorkspace(onNewBlank); } : undefined}
          onAdvanced={() => { void leaveWorkspace(onAdvanced); }}
          onReturnCoursePlan={onReturnCoursePlan ? () => { void leaveWorkspace(onReturnCoursePlan); } : undefined} />
      </div>
    </header>
    {showHistory && <div className="authoring-task-history"><div className="authoring-history-heading"><strong>Recent conversations</strong><span>Saved to your account</span></div><label className="authoring-history-search"><Search size={15} /><input aria-label="Search task history" placeholder="Search conversations" value={historyQuery} onChange={event => setHistoryQuery(event.target.value)} /></label>{!recent.length && <p>Your saved conversations will appear here.</p>}{recent.length > 0 && !visibleTasks.length && <p>No conversations match your search.</p>}<div className="authoring-history-list">{visibleTasks.map(task => <button key={task.id} disabled={!!busy} onClick={() => { void selectTask(task.id); }} className={session?.id === task.id ? 'selected' : ''}><MessageSquare size={15} /><span><strong>{task.title}</strong><small>{labels[task.status]}</small></span><time dateTime={task.updatedAt}>{new Date(task.updatedAt).toLocaleDateString()}</time></button>)}</div></div>}
    <input ref={file} type="file" multiple accept=".pdf,.docx" className="authoring-file-input" aria-label="Upload course materials" onChange={upload} />
    {draggingFiles && <div className="authoring-drop-overlay" aria-hidden="true"><Upload size={30} /><strong>Drop PDF or DOCX files here</strong><span>{courseId ? 'Add them to this conversation' : 'Files will be saved in Studio drafts'}</span></div>}
    <div className={`authoring-body ${session && previewOpen ? 'has-artifact' : ''}`}>
      <div className="authoring-conversation">
        <div className="authoring-transcript" role="log" aria-label="Conversation" aria-live="polite">
          {!session && <div className="authoring-welcome"><span className="authoring-welcome-icon"><Layers3 size={30} strokeWidth={1.4} /></span><p className="authoring-kicker">YOUR TEACHING, A LITTLE LESS WORK</p><h2>What will your students<br />discover today?</h2><p>Start with an idea or bring your materials. Discuss your teaching<br className="desktop-break" /> approach, then build a learning activity when you’re ready.</p><div className="authoring-starters">{[
            { title: 'Brainstorm objectives', prompt: 'Help me explore learning objectives. Ask me about the topic and learners, then discuss possible teaching approaches.', mode: 'explore' as const },
            { title: 'Check understanding', prompt: 'Create a short self-check activity that helps students identify misconceptions in these materials.', mode: 'build' as const },
            { title: 'Prepare for class', prompt: 'Create a first-year pre-class activity introducing the key concepts in these materials.', mode: 'build' as const },
            { title: 'Apply the ideas', prompt: 'Create an activity with practical application questions grounded in these materials.', mode: 'build' as const }
          ].map(starter => <button key={starter.title} onClick={() => { setText(starter.prompt); setMode(starter.mode); }}><BookOpen size={16} /><span>{starter.title}</span><ArrowUpRight size={14} /></button>)}</div></div>}
          {session?.messages.map(message => <article className={`authoring-message is-${message.role}`} key={message.id}><span className="authoring-speaker">{message.role === 'assistant' ? <><MessageSquare size={14} /> CREATE</> : 'You'}</span><p>{message.text}</p>{message.role === 'assistant' && !!message.clarification?.length && <AuthoringClarification messageId={message.id} questions={message.clarification} disabled={active || !!busy || uncertain || !!candidate || planDirty || briefEditing || session?.messages.at(-1)?.id !== message.id} onConfirmAnswers={(clarificationAnswers, text) => command('message', { clarificationAnswers, text }, true)} />}</article>)}
          {!!session?.queuedMessages?.length && <section className="authoring-queued-files" aria-label="Queued messages" aria-live="polite"><strong>Queued messages</strong>{session.queuedMessages.map(message => <details key={message.id}><summary>{queuedLabels[message.status]} · {message.text.slice(0, 90)}{message.text.length > 90 ? '…' : ''}</summary><p>{message.text}</p><small>{new Date(message.createdAt).toLocaleTimeString()}</small></details>)}</section>}
          {!!nativePlan && <button className="authoring-result-card" onClick={() => { setPanel('plan'); setPreviewOpen(true); }}><BookOpen size={24} /><span><strong>Native activity plan</strong><small>{nativePlan.title} · Independent Studio activity</small></span><ArrowUpRight size={17} /></button>}
          {!!visiblePlan?.objectives.length && <button className="authoring-result-card" onClick={() => { setPanel('plan'); setPreviewOpen(true); }}><BookOpen size={24} /><span><strong>{visiblePlan.plan.length ? 'Learning objectives & teaching plan' : 'Learning objectives'}</strong><small>{visiblePlan.objectives.length} objectives{visiblePlan.plan.length ? ` · ${visiblePlanTotal} planned questions${!viewed ? planDraft?.promptBased ? ' · Brainstormed draft' : ' · Material-based draft' : ''}` : ''}</small></span><ArrowUpRight size={17} /></button>}
          {session?.teachingRequirements && <TeachingRequirementsCard requirements={session.teachingRequirements} />}
          {session && teachingBrief && <AuthoringTeachingBrief brief={teachingBrief} objectives={briefObjectives} active={active}
            disabled={!!busy || uncertain || !!candidate || planDirty || !!pendingObjectiveEdit}
            objectiveEdit={objectiveEdit?.sessionId === session.id ? objectiveEdit : null}
            objectiveEditStale={objectiveEditsStale(session, objectiveEdit)}
            assumptionEdit={assumptionEdit?.sessionId === session.id ? assumptionEdit : null}
            onEditObjectives={openObjectiveEditor}
            onChangeObjective={(id, text) => setObjectiveEdit(draft => draft ? { ...draft, items: draft.items.map(item => item.id === id ? { ...item, text } : item) } : draft)}
            onSaveObjectives={saveObjectives}
            onEditAssumptions={() => {
              if (objectiveEdit || pendingObjectiveEdit) return;
              const items = teachingBrief.assumptions.map(item => ({ key: item.key, value: item.value }));
              setAssumptionEdit({ sessionId: session.id, items, originalItems: items.map(item => ({ ...item })) });
            }}
            onChangeAssumption={(key, value) => setAssumptionEdit(draft => draft ? { ...draft, items: draft.items.map(item => item.key === key ? { ...item, value } : item) } : draft)}
            onSaveAssumptions={saveAssumptions}
            onCancelEdit={() => { setObjectiveEdit(null); setAssumptionEdit(null); }} />}
          {pendingObjectiveEdit && <p role="status">Stopping the task before opening learning objective edits…</p>}
          {session && <AuthoringProgress session={session} connected={connectionStatus === 'connected'} />}
          {session && active && <div className="authoring-live" role="status"><Loader2 size={15} className="spin" /><div><strong>{labels[session.status]}</strong><span>{!session.currentVersionId && session.assistant?.events.at(-1)?.message || 'Your progress is saved. You can return to this task later.'}</span>{!session.currentVersionId && session.assistant?.generation && <progress aria-label="Questions prepared" value={session.assistant.generation.readyCount} max={session.assistant.generation.totalQuestions} />}</div></div>}
          {session?.status === 'awaiting_approval' && !active && <div className="authoring-decision"><div><span className="authoring-decision-icon"><Check size={18} /></span><strong>Your teaching plan is ready</strong></div><p>{nativePlan ? `${nativePlan.title} · Independent Studio activity` : `${planDraft?.objectives.length || 0} learning objectives · ${total} questions · H5P Column`}</p><p>Open the teaching plan to review the proposal, or ask for changes here.</p><button className="btn btn-primary" disabled={!!busy || uncertain || planDirty || briefEditing || contextDirty.current || (!nativePlan && !validPlan)} onClick={() => command('approve', { planRevision: nativePlan?.revision ?? session.assistant?.revision })}>Accept plan & generate <ArrowUpRight size={15} /></button><button className="authoring-quiet" onClick={() => { setPanel('plan'); setPreviewOpen(true); }}>Review plan</button>{planDirty && <small>Save your plan edits before generating.</small>}</div>}
          {session?.status === 'awaiting_approval' && !active && !nativePlan && <details className="authoring-preferences"><summary>Refine teaching requirements</summary><p>Who are the learners, and what should this activity do? Leave a field unchanged to keep the proposed plan.</p><label>Learner level<select aria-label="Learner level" value={audience} onChange={e => setAudience(e.target.value)}><option value="">Keep proposed audience</option><option value="introductory university students">Introductory</option><option value="intermediate university students">Intermediate</option><option value="advanced university students">Advanced</option></select></label><label>Teaching purpose<select aria-label="Teaching purpose" value={teachingGoal} onChange={e => setTeachingGoal(e.target.value)}><option value="">Keep proposed purpose</option><option value="low-stakes practice with explanatory feedback">Practice and feedback</option><option value="a pre-class readiness check">Prepare for class</option><option value="application and problem-solving practice">Apply concepts</option></select></label><label>Question difficulty<select aria-label="Question difficulty" value={difficulty} onChange={e => setDifficulty(e.target.value)}><option value="">Keep proposed difficulty</option><option value="easy">Easy</option><option value="moderate">Moderate</option><option value="hard">Hard</option></select></label><button className="btn btn-outline" disabled={!!busy || uncertain || planDirty || briefEditing || !(audience || teachingGoal || difficulty)} onClick={() => command('message', { text: ['Revise the proposed teaching plan. Keep its topics and question counts.', audience && `Audience: ${audience}.`, teachingGoal && `Purpose: ${teachingGoal}.`, difficulty && `Difficulty: ${difficulty}.`].filter(Boolean).join(' ') })}>Update proposal</button><p>Review and approve the updated plan before generation.</p></details>}
          {candidate && <div className="authoring-decision"><strong>{currentVersion ? 'A revision to review' : 'An activity to review'}</strong><ul>{candidate.changes.map((change, i) => <li key={i}>{change}</li>)}</ul><div className="authoring-decision-actions"><button className="btn btn-primary" disabled={!!busy || active || uncertain || briefEditing} onClick={() => command('accept', { versionId: candidate.id })}>Accept changes</button><button className="btn btn-outline" disabled={!!busy || active || uncertain || briefEditing} onClick={() => command('reject', { versionId: candidate.id })}>{currentVersion ? 'Keep current' : 'Discard proposal'}</button></div></div>}
          {(error || session?.error || refreshError) && <div className="authoring-error" role="alert"><p>{error || session?.error || refreshError}</p><button className="authoring-quiet" onClick={() => { setError(''); setRefreshError(''); setPoll(n => n + 1); }}><RefreshCw size={14} /> Check status</button>{uncertain && pending.current && <button className="authoring-quiet" disabled={!!busy} onClick={() => command(pending.current!.command)}>Retry same request</button>}{session && !active && ['needs_attention', 'cancelled'].includes(session.status) && <button className="authoring-quiet" disabled={!!busy || uncertain || briefEditing} onClick={() => command('retry')}>Resume task</button>}</div>}
          {session?.nativeGeneration?.failure?.issues?.length ? <section className="authoring-error" aria-label="Native activity check observations"><strong>AI check observations</strong><ul>{session.nativeGeneration.failure.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul><p>These are AI observations. Discuss the checks in the conversation before starting a revised plan.</p></section> : null}
          {!!session?.assistant?.generation?.reusedQuestions && <p className="authoring-muted">{session.assistant.generation.reusedQuestions} prepared {session.assistant.generation.reusedQuestions === 1 ? 'question' : 'questions'} reused from the previous attempt.</p>}
          {session?.assistant?.generation?.items.some(item => item.status === 'failed') && <section className="authoring-error" aria-label="Questions needing attention"><strong>Questions needing attention</strong><p>{session.assistant.generation.readyCount} of {session.assistant.generation.totalQuestions} questions checked. {active ? session.assistant.generation.readyCount ? 'Task is still running. Checked questions remain available in the preview.' : 'Task is still running. Questions appear in the preview after passing their checks.' : session.assistant.generation.published ? 'Checked questions are saved in the course and available in the preview. Resume task retries only the unfinished questions.' : session.assistant.generation.readyCount ? 'Prepared questions are available in the preview; check task status before retrying.' : 'No questions were prepared. The teaching plan is saved; check the failure reason before retrying.'}</p><QuestionFailureSummary items={session.assistant.generation.items} working={active} />{session.assistant.generation.items.filter(item => item.status === 'failed').map(item => <details className="authoring-failed-question" key={item.index}><summary><strong>Question {item.index + 1}</strong>{questionRows[item.index]?.title && <span> · {questionRows[item.index].title}</span>}</summary><QuestionFailureDetails item={item} working={active} />{item.review && <RejectedDraftDetails review={item.review} />}{questionRows[item.index]?.instructions && <p><strong>Approved instructions:</strong> {questionRows[item.index].instructions}</p>}</details>)}<div className="authoring-decision-actions">{canRestoreMaterialSearch && <button type="button" className="authoring-quiet" disabled={active || !!busy || uncertain || !!materialRestoreNotice} onClick={restoreMaterialSearch}>{busy === 'restore-material-search' ? 'Restoring material search…' : 'Restore material search'}</button>}<button className="authoring-quiet" disabled={active || !!busy} onClick={() => setText('Explain the failed question checks and help me revise the teaching plan. Ask me about any unclear requirements before changing it.')}>Discuss the failure</button>{failedBatch && <button className="authoring-quiet" disabled={active || !!busy} onClick={() => { setPanel('plan'); setPreviewOpen(true); }}>Edit teaching plan</button>}</div>{materialRestoreNotice && <p role="status">{materialRestoreNotice}</p>}<p>{active ? 'See Task steps for the current generation and repair actions.' : 'Resume task retries the unchanged plan and may use additional AI credits. If the updated plan awaits review, choose Accept plan & generate.'}</p></section>}
          {(!!session?.assistant?.generation?.readyCount || !!viewed) && <button className="authoring-result-card" onClick={() => { setPanel('preview'); setPreviewOpen(true); }}><Layers3 size={24} /><span><strong>{previewLabel}</strong><small>{viewed?.representation === 'native-fork' ? 'Independent Studio activity · Saved' : `${viewed ? viewed.questions.length : session?.assistant?.generation?.readyCount || 0} checked questions · ${viewed || session?.assistant?.generation?.published ? 'Saved' : 'Live draft'}`}</small></span><ArrowUpRight size={17} /></button>}
          <div ref={end} />
        </div>
        {!!pendingFiles.length && <div className="authoring-queued-files" aria-live="polite"><strong>{busy === 'upload' ? `Uploading ${progress ?? 0}%` : uploadFailed ? 'Upload needs attention' : 'Files ready to upload'}</strong>{pendingFiles.map((item, index) => <div className="authoring-queued-file" key={`${item.name}-${item.lastModified}`}><FileText size={15} /><span>{item.name}</span><button className="authoring-icon" aria-label={`Remove ${item.name}`} disabled={busy === 'upload' && index === 0} onClick={() => setPendingFiles(files => files.filter(f => f !== item))}><X size={14} /></button></div>)}{uploadFailed && <button className="authoring-quiet" onClick={() => { setError(''); setUploadFailed(false); }}>Retry upload</button>}</div>}
        <form className="authoring-composer" onSubmit={submit}>
          <label className="authoring-composer-stage"><span>Conversation stage</span><select aria-label="Conversation stage" value={mode} disabled={!!busy || uncertain || !!candidate} onChange={event => { setMode(event.target.value as AuthoringMode); modeDirty.current = !!session && event.target.value !== (session.mode || 'build'); }}><option value="explore">Explore teaching idea</option><option value="build">Build activity</option></select></label>
          {modeDirty.current && <small className="authoring-muted">The stage changes when your next message is processed.</small>}
          {(showTools || mention) && <AuthoringContextPicker courseId={courseId} selected={chips} mention={mention || undefined} query={mention?.query} onClose={closePicker} onCourse={chooseCourse} onSelect={(kind, id) => { contextDirty.current = true; if (kind === 'material') setSelected(ids => [...new Set([...ids, id])]); else setObjectiveIds(ids => [...new Set([...ids, id])]); finishMention(); }} onUpload={() => { closePicker(); finishMention(); file.current?.click(); }} />}
          {!!chips.length && <div className="authoring-context-chips" aria-label="Attached context">{chips.map(chip => <div className="authoring-context-chip" key={`${chip.kind}:${chip.id}`}><button type="button" onClick={() => setContextPreview(chip)} title={`Preview ${chip.name}`}><ContextIcon kind={chip.kind} /><span>{chip.name}</span>{chip.status && chip.status !== 'completed' && <small>{chip.status}</small>}</button><button type="button" aria-label={`Remove context ${chip.name}`} disabled={active || !!busy} onClick={() => { contextDirty.current = true; if (chip.kind === 'course') setContextCourse(false); else if (chip.kind === 'material') setSelected(ids => ids.filter(id => id !== chip.id)); else setObjectiveIds(ids => ids.filter(id => id !== chip.id)); }}><X size={13} /></button></div>)}</div>}
          {contextDirty.current && session && <small className="authoring-muted">New context is ready. Send a message to update the proposal before approving.</small>}
          <textarea ref={composer} aria-label="Message Studio AI" value={text} onChange={e => { setText(e.target.value); detectMention(e.currentTarget); }} onClick={e => detectMention(e.currentTarget)} placeholder="Describe an idea, ask a question, or type @ to add context…" maxLength={4000} rows={2} disabled={!!busy || uncertain} onKeyDown={e => { if (e.key === 'Escape') { closePicker(); return; } if ((showTools || mention) && e.key === 'ArrowDown') { e.preventDefault(); (e.currentTarget.form?.querySelector('[role="option"]:not(:disabled)') as HTMLButtonElement | null)?.focus(); return; } if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (mention) (e.currentTarget.form?.querySelector('[role="option"]:not(:disabled)') as HTMLButtonElement | null)?.click(); else e.currentTarget.form?.requestSubmit(); } }} />
          <div className="authoring-composer-footer"><div className="authoring-composer-tools"><button className={`authoring-tool-trigger ${showTools ? 'selected' : ''}`} type="button" aria-label="Add tools and materials" aria-expanded={showTools || !!mention} aria-haspopup="dialog" disabled={active || !!busy} onClick={() => { setMention(null); setShowTools(value => !value); }}><Plus size={19} /></button><span>{active ? 'Task running' : session ? 'Progress saved' : 'Ideas welcome · context optional'}</span></div><div className="authoring-decision-actions">{active && <button type="button" className="authoring-send stop" aria-label="Stop task" title="Stop the current task and cancel queued messages" disabled={!!busy} onClick={() => void act('cancel', async () => { receive(extract(await studioAuthoringApi.cancel(session!.id, session!.revision))); setPoll(v => v + 1); })}><Square size={15} fill="currentColor" /></button>}<button className={active ? 'btn btn-primary' : 'authoring-send'} type="submit" aria-label={session ? active ? 'Queue message' : 'Send message' : mode === 'explore' ? 'Start teaching discussion' : 'Start learning activity'} disabled={!!busy || loading || uncertain || briefEditing || !!pendingFiles.length || (!active && !!candidate) || (session ? !text.trim() && !contextDirty.current && !modeDirty.current : !text.trim() && !chips.length)}>{busy ? <Loader2 size={18} className="spin" /> : <ArrowUp size={20} />}{active && 'Queue message'}</button></div></div>
        </form>
        <p className="authoring-composer-note">{active ? 'Messages wait until the current task finishes or reaches a review step. The current generation keeps its approved requirements. Stop task also cancels queued messages.' : !session ? mode === 'explore' ? 'Explore teaching choices first. Switch to Build activity when you’re ready for a teaching plan.' : 'Ask for learning objectives, a plan to review, or a complete activity.' : 'Enter to send · Shift + Enter for a new line · @ to reference context'}</p>
      </div>
      {session && previewOpen && <aside className="authoring-artifact" aria-label="Activity workspace"><div className="authoring-artifact-header"><div><Layers3 size={17} /><strong>{previewLabel}</strong>{viewed && <span className="authoring-version-badge">v{viewed.number}{viewed.state === 'candidate' ? ' · proposed' : ''}</span>}</div><button className="authoring-icon" ref={closePreview} aria-label="Close preview" onClick={() => { setPreviewOpen(false); composer.current?.focus({ preventScroll: true }); }}><X size={16} /></button><button className="authoring-icon" aria-label="Refresh activity" onClick={() => setPoll(v => v + 1)}><RefreshCw size={15} /></button></div>
        <div className="authoring-tabs" role="tablist" aria-label="Activity views">{(['preview', 'plan', 'questions'] as const).map(tab => <button key={tab} role="tab" aria-selected={panel === tab} aria-controls={`authoring-${tab}`} onClick={() => setPanel(tab)}>{tab === 'preview' ? 'Preview' : tab === 'plan' ? 'Teaching plan' : 'Questions & sources'}</button>)}</div>
        <div className="authoring-artifact-content" role="tabpanel" id={`authoring-${panel}`}>
          {panel === 'preview' && (viewed ? <><div className="authoring-preview-version"><label>Viewing<select value={viewed.id} onChange={e => setViewVersion(e.target.value)}>{session.versions.filter(v => v.state !== 'rejected').map(v => <option key={v.id} value={v.id}>Version {v.number}{v.id === session.currentVersionId ? ' · current' : v.state === 'candidate' ? ' · proposed' : ''}</option>)}</select></label>{viewed.representation === 'native-fork' && <small>Independent Studio version</small>}</div><StudioPreview key={viewed.id} contentId={viewed.contentId} title={viewed.title} /></> : session.assistant?.generation?.readyCount ? <><div className="authoring-partial-banner" role="status"><strong>{session.assistant.generation.readyCount} of {session.assistant.generation.totalQuestions} questions checked</strong><p>{session.assistant.generation.published ? 'These questions are saved in your course. Unfinished questions are excluded; you can use the checked questions now.' : 'Live draft preview. Each question appears after its checks finish.'}</p></div><PreparedQuestionPreview key={`${session.assistant.id}:${session.assistant.generation.requestId}:${session.assistant.generation.readyCount}`} id={session.assistant.id} version={session.assistant.generation.readyCount} /></> : <div className="authoring-artifact-empty"><Layers3 size={38} strokeWidth={1.2} /><h3>A place for your ideas to take shape</h3><p>Questions appear here as they pass their checks. You can try the completed questions while the remaining items are generated or reworked.</p><button className="authoring-quiet" onClick={() => { setPanel('plan'); setPreviewOpen(true); }}>View teaching plan <ArrowUpRight size={14} /></button></div>)}
          {panel === 'plan' && nativePlan && <NativeActivityPlan plan={nativePlan} />}
          {panel === 'plan' && !nativePlan && <div className="authoring-plan">{!visiblePlan?.objectives.length ? <div className="authoring-artifact-empty"><BookOpen size={32} strokeWidth={1.2} /><h3>{viewed?.representation === 'native-fork' ? 'Independent Studio version' : 'Starting with the learning'}</h3><p>{viewed?.representation === 'native-fork' ? 'This version is an independent H5P activity. Its editor changes do not update course questions or the teaching plan. Inspect the saved activity in Preview.' : 'We’ll read your materials, identify learning objectives and recommend a question mix.'}</p></div> : <><div className="authoring-section-heading"><span className="authoring-kicker">LEARNING OBJECTIVES</span><span>{visiblePlan.objectives.length} objectives</span></div>{visiblePlan.objectives.map((lo, index) => <div className="authoring-objective" key={lo.id}><span>{String(index + 1).padStart(2, '0')}</span><div><textarea aria-label={`Learning objective ${index + 1}`} value={lo.text} rows={3} disabled={!editablePlan} onChange={e => { setPlanDraft(d => d ? { ...d, objectives: d.objectives.map(item => item.id === lo.id ? { ...item, text: e.target.value } : item) } : d); setPlanDirty(true); }} />{!!lo.sourceReferences?.length && <button className="authoring-source-link" onClick={() => setReference(lo.sourceReferences![0])}><FileText size={12} />{lo.sourceReferences[0].materialName || 'Source evidence'}{lo.sourceReferences[0].pageNumber ? ` · p. ${lo.sourceReferences[0].pageNumber}` : ''}</button>}</div></div>)}{visiblePlan.plan.length > 0 && <div className="authoring-section-heading"><span className="authoring-kicker">QUESTION MIX</span><span>{visiblePlanTotal} questions</span></div>}{visiblePlan.plan.map((row, index) => <div className="authoring-plan-row" key={row.id}><div><strong>{row.title}</strong><small>{questionTypeLabel(row.questionType)}</small><textarea aria-label={`Question instructions for plan row ${index + 1}`} value={row.instructions} maxLength={4000} rows={4} disabled={!editablePlan} onChange={e => { setPlanDraft(d => d ? { ...d, plan: d.plan.map(item => item.id === row.id ? { ...item, instructions: e.target.value } : item) } : d); setPlanDirty(true); }} />{!!row.questionTasks?.length && <details className="authoring-question-focus" aria-label={`Question focus for ${row.title}`}><summary>Question focus · {row.questionTasks.length} {row.questionTasks.length === 1 ? 'question' : 'questions'}</summary><ol>{row.questionTasks.map(task => <li key={task.id}><small>{task.focus}</small></li>)}</ol></details>}</div><input aria-label={`Question count for plan row ${index + 1}`} type="number" min={1} max={20} value={row.count} disabled={!editablePlan} onChange={e => { setPlanDraft(d => d ? { ...d, plan: d.plan.map(item => item.id === row.id ? { ...item, count: Number(e.target.value) } : item) } : d); setPlanDirty(true); }} /></div>)}{planDirty && <div className="authoring-plan-save"><span>{validPlan ? 'Unsaved plan changes' : 'Keep 1–20 questions and complete each objective.'}</span><button className="btn btn-primary" disabled={!!busy || !validPlan} onClick={() => void act('plan', savePlan)}>Save plan</button></div>}</> }</div>}
          {panel === 'questions' && <div className="authoring-questions">{!visibleQuestions.length ? <div className="authoring-artifact-empty"><FileText size={32} /><h3>{viewed?.representation === 'native-fork' ? 'Review this version in Preview' : 'Questions will appear here'}</h3><p>{viewed?.representation === 'native-fork' ? 'Inspect the full native activity in Preview. Its sources support the activity without creating course question records.' : 'Each course question keeps its learning objective and supporting evidence.'}</p><QuestionCheckSummary summary={viewed?.reviewSummary} />{viewed?.sourceReferences?.map((source, i) => <button key={i} className="authoring-source-link" onClick={() => setReference(source)}><FileText size={12} />{source.materialName || source.sourceFile || 'Source'}</button>)}</div> : visibleQuestions.map(q => <article key={q.id}><small>QUESTION {q.index} · {questionTypeLabel(q.type)}</small><h3>{q.text}</h3>{q.explanation && <p>{q.explanation}</p>}<QuestionCheckSummary summary={q.reviewSummary} /><div>{q.sourceReferences.map((source, i) => <button key={i} className="authoring-source-link" onClick={() => setReference(source)}><FileText size={12} />{source.materialName || source.sourceFile || 'Source'}{source.pageNumber ? ` · p. ${source.pageNumber}` : ''}</button>)}</div><button className="authoring-quiet" disabled={active || !!candidate || !viewed} title={!viewed ? 'Use Open course workspace to edit checked questions' : undefined} onClick={() => { setText(`Revise question ${q.index}: `); }}>Ask for a revision <ArrowUpRight size={13} /></button></article>)}</div>}
        </div>
        <footer className="authoring-artifact-footer">{viewed ? <><details className="authoring-versions"><summary><History size={14} /> Version history <ChevronDown size={13} /></summary><div>{session.versions.filter(v => v.state === 'accepted').map(v => <article key={v.id}><button onClick={() => { setViewVersion(v.id); setPanel('preview'); }}><strong>v{v.number}{v.id === session.currentVersionId ? ' · Current' : ''}</strong><span>{v.summary}</span></button>{v.id !== session.currentVersionId && <button className="authoring-icon" aria-label={`Restore version ${v.number}`} disabled={active || !!busy || uncertain || briefEditing || !!candidate} onClick={() => void showConfirm({ title: `Restore version ${v.number}?`, description: 'This creates a new version from the saved content. Your history is kept. Linked course versions also restore their questions and plan; external downloads and deployments are unchanged.', confirmLabel: 'Restore version', cancelLabel: 'Keep current' }).then(ok => { if (ok) command('restore', { versionId: v.id }); })}><RotateCcw size={15} /></button>}</article>)}</div></details><div className="authoring-export-actions"><button className="authoring-quiet" disabled={!!busy || active || viewed.state !== 'accepted'} onClick={() => { void leaveWorkspace(() => callbacks.current.onOpenActivity(viewed.contentId, false)); }}><SlidersHorizontal size={14} /> Advanced editor</button><button className="btn btn-primary" disabled={!!busy} onClick={() => void act('download', async () => { const blob = await h5pEditorApi.downloadContent(viewed.contentId); downloadBlob(blob, `${viewed.title.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 100) || 'activity'}-v${viewed.number}.h5p`); })}><Download size={14} /> Download H5P</button></div></> : <span className="authoring-muted"><Clock3 size={14} /> Your activity and versions are saved here</span>}{session.quizId && <Link className="authoring-course-link" to={`/course/${session.courseId}/quiz/${session.quizId}?tab=review`}>Open course workspace <ArrowUpRight size={12} /></Link>}</footer>
      </aside>}
    </div>
    {contextPreview && <div className="authoring-context-backdrop" onClick={() => setContextPreview(null)}><section className="authoring-context-preview" role="dialog" aria-modal="true" aria-label="Context preview" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') setContextPreview(null); }}><header><ContextIcon kind={contextPreview.kind} /><strong>{contextPreview.name}</strong><button autoFocus className="authoring-icon" aria-label="Close context preview" onClick={() => setContextPreview(null)}><X size={18} /></button></header><p>{contextPreview.preview || 'This context is attached. Its content will be read when you send your message.'}</p>{contextPreview.kind === 'material' && <button className="authoring-quiet" onClick={() => { setReference({ materialId: contextPreview.id, materialName: contextPreview.name }); setContextPreview(null); }}>Open source document <ArrowUpRight size={14} /></button>}</section></div>}
    {reference && <SourceReferencePreviewModal reference={reference} onClose={() => setReference(null)} />}
  </section>;
}
