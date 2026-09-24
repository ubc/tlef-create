import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Check, Copy, FileQuestion, Layers3, Loader2, MessageCircle, Plus, RefreshCw, Search, Send, Upload, Wand2 } from 'lucide-react';
import { ApiError, H5PStudioActivityType, H5PStudioContent, foldersApi, h5pEditorApi, materialsApi, objectivesApi, quizApi,
  type Folder, type LearningObjective, type Material, type Quiz } from '../../services/api';
import { emptyStudioBrief, readStudioBrief, studioBriefKey, writeStudioBrief } from '../../utils/studioBrief';
import { studioRequestFeasibility } from '../../utils/studioRequestFeasibility';
import { getQuestionTypesForTarget, type H5PPackageFormat } from '../../constants/questionTypeCapabilities';
import { LayoutPreview } from '../generation/GenerationSetup';
import { Link } from 'react-router-dom';
import '../../styles/components/GenerationSetup.css';

const RECEIPT_KEY = 'create-studio-generation-receipt';

interface Props {
  contents: H5PStudioContent[];
  embedded?: boolean;
  active?: boolean;
  quizId?: string;
  courseId?: string;
  ownerId?: string;
  currentContent?: H5PStudioContent;
  onGenerated: (content: H5PStudioContent) => void;
  onBusyChange: (busy: boolean) => void;
  onBuildCourseQuestions?: (brief: { courseId: string; quizId: string; materialIds: string[]; instructions: string }) => void;
}

type CreationKind = 'single' | 'collection';
type CollectionLayout = 'column' | 'question-set' | 'interactive-book';
type PlanRow = { questionType: string; count: number; title?: string };
type PromptMessage = { role: 'user' | 'assistant'; content: string };
const COURSE_EVIDENCE_INSTRUCTIONS = 'Create an accurate learning activity using only the selected course materials and learning objectives. Include clear questions or tasks, correct answers, and useful feedback. Do not invent unsupported facts.';
const collectionLayouts: Array<{ value: CollectionLayout; title: string; description: string }> = [
  { value: 'column', title: 'Column', description: 'One scrolling page with activities stacked vertically.' },
  { value: 'question-set', title: 'Question Set', description: 'A scored sequence with a result screen.' },
  { value: 'interactive-book', title: 'Interactive Book', description: 'Chapters and pages for a longer learning experience.' }
];
const collectionLibraries: Record<CollectionLayout, string> = {
  column: 'H5P.Column', 'question-set': 'H5P.QuestionSet', 'interactive-book': 'H5P.InteractiveBook'
};
const requestError = (operation: string, error: unknown) => {
  const message = error instanceof Error ? error.message : 'Request failed.';
  const details = error instanceof ApiError && Array.isArray(error.details) ? error.details
    .map((detail: { path?: string; field?: string; msg?: string; message?: string }) => [detail.path || detail.field, detail.msg || detail.message].filter(Boolean).join(': '))
    .filter(Boolean).slice(0, 2).join('; ') : '';
  return `${operation}: ${details || message}`;
};

function ActivityPreview({ type }: { type: H5PStudioActivityType }) {
  const name = type.machineName.replace('H5P.', '');
  const rows = [0, 1, 2];
  const sketch = name.includes('Crossword')
    ? rows.map(row => [0, 1, 2, 3].map(col => <rect key={`${row}-${col}`} x={52 + col * 16} y={30 + row * 16} width="13" height="13" rx="1" fill={(row + col) % 3 ? '#fff' : '#263445'} stroke="#8b98a8" />))
    : name.includes('Chart') ? <><path d="M28 75h113M28 75V31" fill="none" stroke="#8996a6" strokeWidth="2" /><rect x="43" y="51" width="17" height="24" rx="2" fill="#bdc9d7" /><rect x="73" y="40" width="17" height="35" rx="2" fill="#263445" /><rect x="103" y="29" width="17" height="46" rx="2" fill="#bdc9d7" /></>
      : name.includes('Timeline') ? <><path d="M24 56h120" stroke="#a1acb9" strokeWidth="3" />{[42, 82, 122].map((x, index) => <g key={x}><circle cx={x} cy="56" r="6" fill={index === 1 ? '#263445' : '#fff'} stroke="#8492a2" strokeWidth="2" /><path d={`M${x - 10} ${index === 1 ? 38 : 73}h20`} stroke="#9aa4b2" strokeWidth="3" strokeLinecap="round" /></g>)}</>
        : name.includes('Documentation') ? <><rect x="36" y="25" width="96" height="55" rx="3" fill="#f8fafc" stroke="#a9b5c3" /><path d="M48 39h54M48 49h70M48 59h38" stroke="#9aa4b2" strokeWidth="3" strokeLinecap="round" /><rect x="48" y="68" width="70" height="6" rx="2" fill="#e2e8f0" /></>
          : name.includes('Branching') ? <><circle cx="48" cy="36" r="9" fill="#263445" /><circle cx="105" cy="35" r="8" fill="#fff" stroke="#8996a6" strokeWidth="2" /><circle cx="105" cy="71" r="8" fill="#fff" stroke="#8996a6" strokeWidth="2" /><path d="M57 36h25l14 0M58 40l25 30h13" fill="none" stroke="#9aa4b2" strokeWidth="2" /></>
            : name.includes('Dialog') || name.includes('Flash') ? <><rect x="36" y="30" width="90" height="50" rx="5" fill="#f2f5f9" stroke="#a9b5c3" /><path d="M51 47h58M51 58h40" stroke="#9aa4b2" strokeWidth="3" strokeLinecap="round" /></>
              : name.includes('Blanks') || name.includes('DragText') || name.includes('MarkTheWords') ? <><path d="M20 37h124M20 56h44m50 0h30M20 75h80" stroke="#a4afbb" strokeWidth="4" strokeLinecap="round" /><rect x="70" y="48" width="38" height="15" rx="4" fill="#dae2ec" stroke="#8090a0" /></>
                : name.includes('TrueFalse') ? <><rect x="25" y="39" width="53" height="31" rx="5" fill="#e2e8f0" stroke="#9aa4b2" /><rect x="90" y="39" width="53" height="31" rx="5" fill="#263445" /><path d="M41 55h20M107 55h20" stroke="#fff" strokeWidth="3" strokeLinecap="round" /></>
                  : rows.map((row, index) => <g key={row}><circle cx="24" cy={37 + row * 19} r="5" fill={index === 1 ? '#263445' : '#fff'} stroke="#8b98a8" /><path d={`M38 ${37 + row * 19}h${index === 2 ? 60 : 99}`} stroke="#9aa4b2" strokeWidth="4" strokeLinecap="round" /></g>);
  return <svg viewBox="0 0 168 96" className="studio-type-preview" aria-hidden="true" focusable="false">
    <rect x="1" y="1" width="166" height="94" rx="8" fill="#fff" stroke="#cbd5e1" />
    <path d="M16 18h82" stroke="#9aa4b2" strokeWidth="4" strokeLinecap="round" />
    {sketch}
  </svg>;
}

export default function StudioAIComposer({ contents, embedded = false, active = true, quizId, courseId: initialCourseId, ownerId = '', currentContent, onGenerated, onBusyChange, onBuildCourseQuestions }: Props) {
  const briefKey = studioBriefKey(ownerId, quizId, currentContent?.contentId);
  const [restored] = useState(() => readStudioBrief(briefKey, {
    ...emptyStudioBrief,
    templateContentId: currentContent?.contentId || ''
  }));
  const [types, setTypes] = useState<H5PStudioActivityType[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState('');
  const [query, setQuery] = useState(restored.query);
  const [library, setLibrary] = useState(restored.library);
  const [templateContentId, setTemplateContentId] = useState(restored.templateContentId);
  const [instructions, setInstructions] = useState(restored.instructions);
  const [kind, setKind] = useState<CreationKind>(restored.kind || 'single');
  const [layout, setLayout] = useState<CollectionLayout>(restored.layout || 'column');
  const [selectedQuestionTypes, setSelectedQuestionTypes] = useState<string[]>(restored.selectedQuestionTypes || []);
  const [questionPlan, setQuestionPlan] = useState<PlanRow[]>(restored.questionPlan || []);
  const [promptConversation, setPromptConversation] = useState<PromptMessage[]>(restored.promptConversation || []);
  const [promptSuggestion, setPromptSuggestion] = useState(restored.promptSuggestion || '');
  const [promptOffer, setPromptOffer] = useState(restored.promptOffer || false);
  const [promptHelperOpen, setPromptHelperOpen] = useState(false);
  const [promptMessage, setPromptMessage] = useState('');
  const [promptBusy, setPromptBusy] = useState(false);
  const [promptError, setPromptError] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);
  useEffect(() => { if (!active) setPromptHelperOpen(false); }, [active]);
  const [sourceMode, setSourceMode] = useState<'none' | 'course'>(restored.sourceMode || (initialCourseId ? 'course' : 'none'));
  const [courses, setCourses] = useState<Folder[]>([]);
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  const [courseId, setCourseId] = useState(restored.courseId || initialCourseId || '');
  const [sourceQuizId, setSourceQuizId] = useState(restored.sourceQuizId || quizId || '');
  const [courseQuizzes, setCourseQuizzes] = useState<Quiz[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [selectedMaterials, setSelectedMaterials] = useState<string[]>(restored.materialIds || []);
  const [objectives, setObjectives] = useState<LearningObjective[]>([]);
  const [selectedObjectives, setSelectedObjectives] = useState<string[]>(restored.objectiveIds || []);
  const [newCourseName, setNewCourseName] = useState('');
  const [sourceBusy, setSourceBusy] = useState('');
  const [sourceRefresh, setSourceRefresh] = useState(0);
  const [planBusy, setPlanBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [requestId, setRequestId] = useState(() => sessionStorage.getItem(RECEIPT_KEY) || '');
  const [statusAttempt, setStatusAttempt] = useState(0);
  const callbacks = useRef({ onGenerated, onBusyChange });
  callbacks.current = { onGenerated, onBusyChange };
  const brief = useRef({ library, templateContentId, instructions, query, kind, layout, selectedQuestionTypes, questionPlan, promptConversation, promptSuggestion, promptOffer, promptHelperVersion: 2 as const,
    sourceMode, courseId, sourceQuizId, materialIds: selectedMaterials, objectiveIds: selectedObjectives });
  brief.current = { library, templateContentId, instructions, query, kind, layout, selectedQuestionTypes, questionPlan, promptConversation, promptSuggestion, promptOffer, promptHelperVersion: 2,
    sourceMode, courseId, sourceQuizId, materialIds: selectedMaterials, objectiveIds: selectedObjectives };
  useEffect(() => { writeStudioBrief(briefKey, brief.current); }, [briefKey, library, templateContentId, instructions, query, kind, layout, selectedQuestionTypes, questionPlan, promptConversation, promptSuggestion, promptOffer, sourceMode, courseId, sourceQuizId, selectedMaterials, selectedObjectives]);
  const openDraft = (content: H5PStudioContent) => {
    const compatibleTemplateId = content.mainLibrary === types.find(type => type.library === brief.current.library)?.machineName
      ? content.contentId : '';
    writeStudioBrief(studioBriefKey(ownerId, quizId, content.contentId), { ...brief.current, templateContentId: compatibleTemplateId });
    callbacks.current.onGenerated(content);
  };
  const openDraftRef = useRef(openDraft);
  openDraftRef.current = openDraft;
  const selected = types.find(type => type.library === library);
  const currentLibrary = currentContent?.mainLibrary;
  const collectionLibrary = types.find(type => type.machineName === collectionLibraries[layout] && type.mode === 'generate')?.library || '';
  const availableQuestionTypes = useMemo(() => getQuestionTypesForTarget(layout as H5PPackageFormat).filter(option =>
    types.some(type => type.mode === 'generate' && type.questionTypes?.some(info => info.type === option.value && info.containers.includes(layout)))), [layout, types]);
  useEffect(() => {
    if (loading || !types.length) return;
    setSelectedQuestionTypes(previous => {
      const valid = previous.filter(type => availableQuestionTypes.some(option => option.value === type));
      return valid.length === previous.length ? previous : valid;
    });
  }, [availableQuestionTypes, loading, types]);
  const templates = contents.filter(content => content.mainLibrary === selected?.machineName);
  const validTemplateContentId = templates.some(content => content.contentId === templateContentId) ? templateContentId : '';
  const filtered = useMemo(() => types.filter(type => type.category !== 'Lessons & collections' && `${type.title} ${type.category}`.toLowerCase().includes(query.toLowerCase())), [types, query]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    h5pEditorApi.getActivityCatalog().then(response => {
      if (active) {
        const available = response.data?.types || [];
        setTypes(available);
        setLibrary(previous => previous || available.find(type => type.machineName === currentLibrary)?.library || '');
      }
    }).catch(err => {
      if (active) setError(requestError('Could not load activity types', err));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadAttempt, currentLibrary]);

  useEffect(() => {
    let active = true;
    foldersApi.getFolders().then(response => {
      if (!active) return;
      const ownedCourses = response.folders || [];
      setCourses(ownedCourses);
      setCourseId(previous => previous && !ownedCourses.some(course => course._id === previous) ? '' : previous);
      setCoursesLoaded(true);
    })
      .catch(err => { if (active) setError(requestError('Could not load courses', err)); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (sourceMode !== 'course' || !coursesLoaded || !courseId) { setCourseQuizzes([]); setMaterials([]); return; }
    let active = true;
    Promise.all([quizApi.getQuizzes(courseId), materialsApi.getMaterials(courseId)]).then(([quizzes, materialResult]) => {
      if (!active) return;
      setCourseQuizzes(quizzes.quizzes || []);
      setMaterials(materialResult.materials || []);
      setSourceQuizId(previous => previous && quizzes.quizzes.some(item => item._id === previous) ? previous : quizzes.quizzes[0]?._id || '');
      setError('');
    }).catch(err => { if (active) setError(requestError('Could not load course sources', err)); });
    return () => { active = false; };
  }, [courseId, sourceMode, coursesLoaded, sourceRefresh]);

  useEffect(() => {
    if (sourceMode !== 'course' || !sourceQuizId || (!courseQuizzes.some(item => item._id === sourceQuizId) && !(quizId === sourceQuizId && !courseId))) { setObjectives([]); return; }
    let active = true;
    objectivesApi.getObjectives(sourceQuizId).then(response => { if (active) setObjectives(response.objectives || []); })
      .catch(err => { if (active) setError(requestError('Could not load learning objectives', err)); });
    return () => { active = false; };
  }, [sourceQuizId, sourceMode, courseQuizzes, quizId, courseId, sourceRefresh]);

  useEffect(() => {
    if (!materials.some(material => selectedMaterials.includes(material._id) && ['pending', 'processing'].includes(material.processingStatus))) return;
    const timer = window.setTimeout(() => setSourceRefresh(value => value + 1), 3000);
    return () => clearTimeout(timer);
  }, [materials, selectedMaterials]);

  useEffect(() => {
    if (!requestId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let missingChecks = 0;
    setGenerating(true);
    callbacks.current.onBusyChange(true);
    const check = async () => {
      try {
        const response = await h5pEditorApi.getGeneration(requestId);
        if (!active) return;
        const job = response.data?.job;
        if (!job) throw new Error('Generation status is unavailable.');
        if (job.status === 'running') { timer = setTimeout(check, 2000); return; }
        sessionStorage.removeItem(RECEIPT_KEY);
        setRequestId('');
        setGenerating(false);
        callbacks.current.onBusyChange(false);
        if (job.status === 'succeeded' && response.data?.content) openDraftRef.current(response.data.content);
        else setError(job.message || 'This draft is no longer available. Check Your content before generating again.');
      } catch (err) {
        if (!active) return;
        // Never submit a second paid generation because polling failed.
        if (err instanceof ApiError && err.status === 404) {
          if (++missingChecks < 3) { timer = setTimeout(check, 2000); return; }
          sessionStorage.removeItem(RECEIPT_KEY);
          setRequestId(''); setGenerating(false); callbacks.current.onBusyChange(false);
        }
        setError('Could not recover generation status. Check your connection, then check status again. No additional AI request has been sent.');
      }
    };
    // Let the initial POST persist its receipt before the first lookup.
    timer = setTimeout(check, 1000);
    return () => { active = false; clearTimeout(timer); };
  }, [requestId, statusAttempt]);

  const createCourse = async () => {
    if (!newCourseName.trim() || sourceBusy) return;
    setSourceBusy('course'); setError('');
    try {
      const result = await foldersApi.createFolder(newCourseName.trim(), 1);
      setCourses(previous => [result.folder, ...previous]);
      setCourseId(result.folder._id); setSourceQuizId(''); setSelectedMaterials([]); setSelectedObjectives([]); setQuestionPlan([]);
      setNewCourseName('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create the course.'); }
    finally { setSourceBusy(''); }
  };

  const createLearningObject = async () => {
    if (!courseId || sourceBusy) return;
    setSourceBusy('learning-object'); setError('');
    try {
      const result = await quizApi.createQuiz('Studio activity', courseId);
      setCourseQuizzes(previous => [result.quiz, ...previous]); setSourceQuizId(result.quiz._id);
      setSelectedObjectives([]); setQuestionPlan([]);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create the Learning Object.'); }
    finally { setSourceBusy(''); }
  };

  const uploadMaterials = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files?.length || !courseId || sourceBusy) return;
    setSourceBusy('upload'); setError('');
    try {
      const result = await materialsApi.uploadFiles(courseId, files);
      setMaterials(previous => [...result.materials, ...previous]);
      setSelectedMaterials(previous => [...new Set([...previous, ...result.materials.map(material => material._id)])]);
      setQuestionPlan([]);
      event.target.value = '';
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not upload materials.'); }
    finally { setSourceBusy(''); }
  };

  const generateObjectives = async () => {
    if (!sourceQuizId || !selectedMaterials.length || selectedMaterials.some(id => !materials.some(material => material._id === id && material.processingStatus === 'completed')) || sourceBusy) return;
    setSourceBusy('objectives'); setError('');
    try {
      const current = await quizApi.getQuiz(sourceQuizId);
      const existing = (current.quiz.materials || []).map(material => typeof material === 'string' ? material : material._id);
      await quizApi.assignMaterials(sourceQuizId, [...new Set([...existing, ...selectedMaterials])]);
      const result = await objectivesApi.generateObjectives(sourceQuizId, selectedMaterials, undefined, instructions.trim() || undefined, false);
      setObjectives(result.objectives || []);
      setSelectedObjectives((result.objectives || []).map(objective => objective._id).slice(0, 8));
      setQuestionPlan([]);
      setSourceRefresh(value => value + 1);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not generate learning objectives.'); }
    finally { setSourceBusy(''); }
  };

  const hasSelectedEvidence = selectedMaterials.length > 0 || selectedObjectives.length > 0;
  const sourceReady = sourceMode === 'none' || (!!courseId && !!sourceQuizId && hasSelectedEvidence && selectedMaterials.every(id =>
    materials.some(material => material._id === id && material.processingStatus === 'completed')));
  const instructionsReady = instructions.trim().length >= 10 || (sourceMode === 'course' && !instructions.trim() && sourceReady);
  const effectiveInstructions = instructions.trim() || (sourceMode === 'course' && sourceReady ? COURSE_EVIDENCE_INSTRUCTIONS : '');

  const askPromptHelper = async (generateNow = false) => {
    const message = promptMessage.trim();
    if ((!message && !generateNow) || promptBusy || (generateNow && !promptConversation.length)) return;
    const previousOffer = promptOffer;
    const next: PromptMessage[] = generateNow ? promptConversation.slice(-12) : [...promptConversation.slice(-10), { role: 'user', content: message }];
    setPromptConversation(next);
    if (!generateNow) setPromptMessage('');
    setPromptBusy(true); setPromptError(''); setPromptOffer(false);
    try {
      const response = await h5pEditorApi.suggestPrompt({ messages: next, kind, layout,
        activityType: kind === 'single' ? selected?.title || '' : '', selectedQuestionTypes,
        evidenceSelected: sourceMode === 'course' && hasSelectedEvidence,
        currentInstructions: instructions.slice(0, 2000), generateNow,
        ...(sourceMode === 'course' && sourceQuizId ? { quizId: sourceQuizId,
          objectiveIds: selectedObjectives, materialIds: selectedMaterials } : {}) });
      if (!response.data?.reply || !['continue', 'offer', 'draft'].includes(response.data.nextStep)
        || (response.data.nextStep === 'draft' && !response.data.draft)) throw new Error('No usable reply was returned.');
      setPromptConversation([...next, { role: 'assistant', content: response.data.reply }].slice(-12));
      setPromptOffer(response.data.nextStep === 'offer');
      setPromptSuggestion(response.data.nextStep === 'draft' ? response.data.draft : '');
      setPromptCopied(false);
    } catch (err) {
      if (generateNow) setPromptOffer(previousOffer);
      setPromptError(requestError('Could not refine the prompt', err));
    }
    finally { setPromptBusy(false); }
  };

  const preparePlan = async () => {
    if (kind === 'single' || !collectionLibrary || !sourceReady || !instructionsReady || studioRequestFeasibility(collectionLibrary, effectiveInstructions) || planBusy) return;
    setPlanBusy(true); setError('');
    try {
      const result = await h5pEditorApi.planActivity({ library: collectionLibrary, kind: 'collection',
        instructions: effectiveInstructions, selectedQuestionTypes,
        ...(sourceMode === 'course' && sourceQuizId ? { quizId: sourceQuizId,
          ...(selectedObjectives.length ? { objectiveIds: selectedObjectives } : {}),
          ...(selectedMaterials.length ? { materialIds: selectedMaterials } : {}) } : {}) });
      setQuestionPlan(result.data?.plan || []);
    } catch (err) { setError(requestError('Could not prepare a question plan', err)); }
    finally { setPlanBusy(false); }
  };

  const generate = async () => {
    const targetLibrary = kind === 'single' ? library : collectionLibrary;
    if (!targetLibrary || generating || (kind !== 'single' && !questionPlan.length)) return;
    setGenerating(true);
    onBusyChange(true);
    setError('');
    const nextRequestId = crypto.randomUUID();
    sessionStorage.setItem(RECEIPT_KEY, nextRequestId);
    try {
      await h5pEditorApi.startGeneration({ requestId: nextRequestId, library: targetLibrary, instructions: effectiveInstructions,
        templateContentId: kind === 'single' ? validTemplateContentId || undefined : undefined,
        quizId: sourceMode === 'course' ? sourceQuizId || quizId : undefined,
        ...(kind !== 'single' ? { questionPlan: questionPlan.map(row => ({ questionType: row.questionType, count: Number(row.count) })) } : {}),
        ...(sourceMode === 'course' && selectedObjectives.length ? { objectiveIds: selectedObjectives } : {}),
        ...(sourceMode === 'course' && selectedMaterials.length ? { materialIds: selectedMaterials } : {}) });
      setRequestId(nextRequestId);
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        sessionStorage.removeItem(RECEIPT_KEY);
        setGenerating(false); onBusyChange(false);
        setError(requestError('Could not start AI generation', err));
      } else {
        setRequestId(nextRequestId);
        setError('The connection was interrupted. Checking the original request before allowing another generation.');
      }
    }
  };

  const prepare = async () => {
    if (!selected || generating || preparing) return;
    setPreparing(true); onBusyChange(true); setError('');
    try {
      const response = await h5pEditorApi.prepareTemplate(library);
      if (!response.data?.content) throw new Error('The template was not returned. Check Your content before retrying.');
      openDraft(response.data.content);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not prepare the template.'); }
    finally { setPreparing(false); onBusyChange(false); }
  };

  const typeCards = kind === 'single' ? filtered : availableQuestionTypes.map(option =>
    types.find(type => type.questionTypes?.some(info => info.type === option.value))!).filter(Boolean);
  const planTotal = questionPlan.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const allowedPlanTypes = selectedQuestionTypes.length
    ? availableQuestionTypes.filter(option => selectedQuestionTypes.includes(option.value)) : availableQuestionTypes;
  const planValid = kind === 'single' || (questionPlan.length > 0 && planTotal <= 8 && planTotal > 0
    && new Set(questionPlan.map(row => row.questionType)).size === questionPlan.length
    && selectedQuestionTypes.every(type => questionPlan.some(row => row.questionType === type))
    && questionPlan.every(row => Number.isInteger(Number(row.count)) && Number(row.count) >= 1
      && allowedPlanTypes.some(option => option.value === row.questionType)));
  const feasibilityError = studioRequestFeasibility(kind === 'single' ? library : collectionLibrary, effectiveInstructions);
  const canGenerate = instructionsReady && !feasibilityError && sourceReady && planValid &&
    (kind === 'single' ? !!selected && selected.mode !== 'unavailable' && (selected.mode !== 'template' || !!validTemplateContentId) : !!collectionLibrary);
  const nextSteps = [
    ...(kind === 'single' && !selected ? ['Choose an available activity type.'] : []),
    ...(kind === 'single' && selected?.mode === 'template' && !validTemplateContentId ? ['Choose or prepare a saved media template.'] : []),
    ...(kind === 'collection' && !collectionLibrary ? ['Choose an available collection layout.'] : []),
    ...(sourceMode === 'course' && !courseId ? ['Choose or create a course.'] : []),
    ...(sourceMode === 'course' && courseId && !sourceQuizId ? ['Choose or create a Learning Object.'] : []),
    ...(sourceMode === 'course' && sourceQuizId && !hasSelectedEvidence ? ['Select at least one ready material or learning objective.'] : []),
    ...(sourceMode === 'course' && selectedMaterials.some(id => !materials.some(material => material._id === id && material.processingStatus === 'completed')) ? ['Wait for selected materials to show Ready, or deselect them.'] : []),
    ...(!instructionsReady && (sourceMode === 'none' || instructions.trim()) ? ['Write at least 10 characters in Teaching instructions, or use Prompt helper.'] : []),
    ...(kind === 'collection' && !questionPlan.length ? ['Propose and review the question plan before generating.'] : []),
    ...(feasibilityError ? [feasibilityError] : [])
  ];

  return (
    <section className={`studio-ai-composer${embedded ? ' is-embedded' : ''}`} aria-label="Create with AI workspace">
      {!embedded && <><span className="h5p-studio-eyebrow">AI activity builder</span><h2>Create with AI</h2></>}
      <p>Choose a format, describe your goal, optionally add course evidence, then review the plan before generating.</p>
      {loading ? <p role="status"><Loader2 className="spin" size={16} /> Checking installed H5P types…</p> : <fieldset disabled={generating || preparing}>
        <legend className="sr-only">AI activity settings</legend>
        <section className="studio-create-step">
          <h3><span>1</span> What are you creating?</h3>
          <div className="studio-create-kind-grid">
            {([
              { value: 'single', title: 'One activity', detail: 'Create one focused question or activity.', icon: FileQuestion },
              { value: 'collection', title: 'Question collection', detail: 'Choose one or more types; AI proposes how many of each.', icon: Layers3 }
            ] as const).map(choice => <button key={choice.value} type="button" className="studio-create-choice" aria-pressed={kind === choice.value} onClick={() => { setKind(choice.value); setQuestionPlan([]); }}>
              <choice.icon size={25} aria-hidden="true" /><strong>{choice.title}</strong><small>{choice.detail}</small><Check size={16} className="studio-create-check" aria-hidden="true" />
            </button>)}
          </div>
        </section>

        {kind !== 'single' && <section className="studio-create-step">
          <h3><span>2</span> Choose the student-facing layout</h3>
          <p>These illustrations show the layout, not your generated content.</p>
          <div className="studio-create-layout-grid">{collectionLayouts.map(choice => <button key={choice.value} type="button" className="studio-create-choice" aria-pressed={layout === choice.value} onClick={() => { setLayout(choice.value); setSelectedQuestionTypes(previous => previous.filter(type => getQuestionTypesForTarget(choice.value as H5PPackageFormat).some(option => option.value === type) && types.some(activity => activity.mode === 'generate' && activity.questionTypes?.some(info => info.type === type && info.containers.includes(choice.value))))); setQuestionPlan([]); }}>
            <LayoutPreview format={choice.value} /><strong>{choice.title}</strong><small>{choice.description}</small><Check size={16} className="studio-create-check" aria-hidden="true" />
          </button>)}</div>
        </section>}

        <section className="studio-create-step">
          <h3><span>{kind === 'single' ? '2' : '3'}</span> {kind === 'single' ? 'Choose an activity type' : 'Choose question types'}</h3>
          {kind === 'collection' && <p>Select up to eight compatible types. Leave all unselected and AI will choose. Each selected type must appear in the proposed plan.</p>}
          {kind === 'single' && <><label htmlFor="studio-type-search"><Search size={16} /> Find a type</label><input id="studio-type-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search installed activities…" />
            <label htmlFor="studio-type">Activity type</label><select id="studio-type" value={library} onChange={event => { setLibrary(event.target.value); setTemplateContentId(''); setError(''); }}><option value="">Choose an installed type</option>{types.filter(type => type.category !== 'Lessons & collections').map(type => <option key={type.library} value={type.library}>{type.title}</option>)}</select></>}
          <div className="studio-type-grid" role="group" aria-label="Activity type cards">{typeCards.map((type, index) => {
            const option = kind === 'single' ? null : availableQuestionTypes[index];
            const active = kind === 'single' ? library === type.library : selectedQuestionTypes.includes(option!.value);
            return <button key={`${type.library}:${option?.value || ''}`} type="button" className="studio-type-card" aria-pressed={active} disabled={kind === 'collection' && !active && selectedQuestionTypes.length >= 8} onClick={() => { if (kind === 'single') { setLibrary(type.library); setTemplateContentId(''); } else { setSelectedQuestionTypes(previous => active ? previous.filter(value => value !== option!.value) : previous.length < 8 ? [...previous, option!.value] : previous); setQuestionPlan([]); } }}>
              <ActivityPreview type={type} /><strong>{option?.label || type.title}</strong><small>{type.mode === 'unavailable' ? 'Unavailable' : type.mode === 'template' ? 'Saved media template required' : type.category}</small>
            </button>;
          })}</div>
          {typeCards.length === 0 && <p>No compatible types found for this layout or search.</p>}
          {kind === 'collection' && <p role="status">{selectedQuestionTypes.length ? `${selectedQuestionTypes.length} type${selectedQuestionTypes.length === 1 ? '' : 's'} selected. AI will propose the quantity for each.` : 'No types selected. AI will choose compatible types and quantities.'}</p>}
          {kind === 'single' && selected && <div className="studio-ai-guidance" role="status"><strong>{selected.title} · {selected.version}</strong><p>{selected.guidance}</p></div>}
          {kind === 'single' && selected && selected.mode !== 'unavailable' && (selected.mode === 'template' || templates.length > 0) && <div className="studio-template-picker">
            <label htmlFor="studio-template">{selected.mode === 'template' ? 'Saved template (required)' : 'Start from a saved activity (optional)'}</label>
            <select id="studio-template" value={validTemplateContentId} onChange={event => setTemplateContentId(event.target.value)}><option value="">{selected.mode === 'template' ? 'Choose a saved template' : 'Create a new activity'}</option>{templates.map(content => <option key={content.contentId} value={content.contentId}>{content.title}</option>)}</select>
            <p>AI keeps the template’s real media and creates a separate draft.</p>
            {selected.mode === 'template' && !templates.length && <button type="button" className="btn btn-outline" onClick={prepare}>Prepare a template in the editor <ArrowRight size={16} /></button>}
          </div>}
        </section>

        <section className="studio-create-step">
          <h3><span>{kind === 'single' ? '3' : '4'}</span> Describe the learning task</h3>
          <div className="studio-instructions-header"><label htmlFor="studio-instructions">Teaching instructions {sourceMode === 'course' ? '(optional with selected evidence)' : '(required)'}</label>{active && <button type="button" className="btn btn-outline studio-prompt-trigger" aria-expanded={promptHelperOpen} aria-controls="studio-prompt-popup" onClick={() => setPromptHelperOpen(true)}><MessageCircle size={16} /> Prompt helper</button>}</div>
          <textarea id="studio-instructions" aria-label="Teaching instructions" rows={6} maxLength={12000} value={instructions} onChange={event => { setInstructions(event.target.value); setQuestionPlan([]); }} placeholder="Example: Create 4 multiple-choice questions for first-year students on Newton's laws. Use the selected learning objectives, address misconceptions, and explain incorrect answers." />
          {feasibilityError && <p className="studio-feasibility-warning" role="alert">{feasibilityError}</p>}
          {sourceMode === 'course' && !instructions.trim() && <p className="studio-default-brief">With selected course evidence, instructions are optional. CREATE will use: “{COURSE_EVIDENCE_INSTRUCTIONS}”</p>}
          <p>Include your audience, quantity and learning goal if you have them. Open Prompt helper to develop a brief through conversation.</p>
        </section>

        <section className="studio-create-step">
          <h3><span>{kind === 'single' ? '4' : '5'}</span> Add course evidence <small>Optional</small></h3>
          <div className="studio-source-choices"><button type="button" className="studio-create-choice" aria-pressed={sourceMode === 'none'} onClick={() => { setSourceMode('none'); setQuestionPlan([]); }}><strong>Use my instructions</strong><small>Start without saved course materials.</small></button><button type="button" className="studio-create-choice" aria-pressed={sourceMode === 'course'} onClick={() => { setSourceMode('course'); setQuestionPlan([]); }}><strong>Use a course</strong><small>Choose materials and one or more learning objectives.</small></button></div>
          {sourceMode === 'course' && <div className="studio-source-panel">
            <p>This creates a separate Studio draft linked to the course. It does not add or replace CREATE Question records in Review.</p>
            <label htmlFor="studio-course">Course</label><select id="studio-course" value={courseId} onChange={event => { setCourseId(event.target.value); setSourceQuizId(''); setSelectedMaterials([]); setSelectedObjectives([]); setQuestionPlan([]); }}><option value="">Choose a course</option>{courses.map(course => <option key={course._id} value={course._id}>{course.name}</option>)}</select>
            <div className="studio-source-inline"><input aria-label="New course name" value={newCourseName} onChange={event => setNewCourseName(event.target.value)} placeholder="Or create a new course" maxLength={150} /><button type="button" className="btn btn-outline" disabled={!newCourseName.trim() || !!sourceBusy} onClick={() => void createCourse()}><Plus size={16} /> Create course</button></div>
            {courseId && <><label htmlFor="studio-learning-object">Learning Object</label><select id="studio-learning-object" value={sourceQuizId} onChange={event => { setSourceQuizId(event.target.value); setSelectedObjectives([]); setQuestionPlan([]); }}><option value="">Choose a Learning Object</option>{courseQuizzes.map(item => <option key={item._id} value={item._id}>{item.name}</option>)}</select><button type="button" className="btn btn-ghost" disabled={!!sourceBusy} onClick={() => void createLearningObject()}><Plus size={16} /> New Learning Object</button>
              <div className="studio-source-heading"><h4>Materials</h4><button type="button" className="btn btn-ghost" onClick={() => setSourceRefresh(value => value + 1)}><RefreshCw size={15} /> Refresh</button></div>
              <label className="studio-upload-label"><Upload size={16} /> Upload PDF or DOCX<input type="file" accept=".pdf,.docx" multiple onChange={event => void uploadMaterials(event)} disabled={!!sourceBusy} /></label>
              <div className="studio-source-list">{materials.map(material => <label key={material._id}><input type="checkbox" checked={selectedMaterials.includes(material._id)} onChange={event => { setSelectedMaterials(previous => event.target.checked ? [...previous, material._id] : previous.filter(id => id !== material._id)); setQuestionPlan([]); }} /><span>{material.name}</span><small>{material.processingStatus === 'completed' ? 'Ready' : material.processingStatus}</small></label>)}</div>
              {sourceQuizId && selectedMaterials.length > 0 && <button type="button" className="btn btn-outline" disabled={!!sourceBusy || selectedMaterials.some(id => !materials.some(material => material._id === id && material.processingStatus === 'completed'))} onClick={() => void generateObjectives()}>{sourceBusy === 'objectives' ? <Loader2 className="spin" size={16} /> : <Wand2 size={16} />} Generate learning objectives from selected materials</button>}
              {objectives.length > 0 && <><h4>Learning objectives</h4><p>Review and choose up to 8. Selecting several for one activity asks AI to combine their concepts. {sourceQuizId && <Link to={`/course/${encodeURIComponent(courseId)}/quiz/${encodeURIComponent(sourceQuizId)}?tab=objectives`}>Edit objectives in the course</Link>}</p><div className="studio-source-list">{objectives.map(objective => <label key={objective._id}><input type="checkbox" checked={selectedObjectives.includes(objective._id)} onChange={event => { setSelectedObjectives(previous => event.target.checked ? [...previous, objective._id].slice(0, 8) : previous.filter(id => id !== objective._id)); setQuestionPlan([]); }} /><span>{objective.text}</span></label>)}</div></>}
            </>}
            {sourceBusy && <p role="status"><Loader2 className="spin" size={16} /> {sourceBusy === 'upload' ? 'Uploading materials…' : sourceBusy === 'objectives' ? 'Generating learning objectives…' : 'Saving course setup…'}</p>}
            {onBuildCourseQuestions && sourceQuizId && <div className="studio-course-output"><strong>Need questions in the course Review tab?</strong><p>Use the linked course workflow to review learning objectives and a question plan, then generate CREATE Question records and a Column Studio draft. Your teaching instructions and selected materials carry over. Select at least one ready material for this path.</p><button type="button" className="btn btn-outline" disabled={!courseId || !selectedMaterials.length || !sourceReady || !instructionsReady || !!sourceBusy || generating} onClick={() => {
              writeStudioBrief(studioBriefKey(ownerId, sourceQuizId, currentContent?.contentId), brief.current);
              onBuildCourseQuestions({ courseId, quizId: sourceQuizId, materialIds: selectedMaterials, instructions: effectiveInstructions });
            }}>Build linked course questions <ArrowRight size={16} /></button>{(!selectedMaterials.length || !sourceReady || !instructionsReady) && <p className="studio-action-hint">{!selectedMaterials.length ? 'Select at least one material above.' : !sourceReady ? 'Wait for the selected material to show Ready and choose a Learning Object.' : 'Write at least 10 characters of instructions, or clear the field to use selected course evidence.'}</p>}</div>}
          </div>}
        </section>

        {kind !== 'single' && <section className="studio-create-step">
          <h3><span>6</span> Review the question plan</h3>
          {!questionPlan.length ? <><button type="button" className="btn btn-outline" disabled={!collectionLibrary || !sourceReady || !instructionsReady || !!feasibilityError || planBusy} onClick={() => void preparePlan()}>{planBusy ? <Loader2 className="spin" size={16} /> : <Wand2 size={16} />} Propose types and quantities</button>{(!collectionLibrary || !sourceReady || !instructionsReady || feasibilityError) && <p className="studio-action-hint">{!collectionLibrary ? 'Choose an available layout above.' : !sourceReady ? 'Choose a course, Learning Object, and at least one ready material or objective.' : !instructionsReady ? 'Add teaching instructions, use Prompt helper, or select course evidence and leave instructions empty.' : feasibilityError}</p>}</> : <>
            <p>AI proposed {planTotal} items. Adjust each row before generating. The draft must match this plan.</p>
            <div className="studio-plan-list">{questionPlan.map((row, index) => <div key={index} className="studio-plan-row"><label>Type<select value={row.questionType} onChange={event => setQuestionPlan(previous => previous.map((item, i) => i === index ? { ...item, questionType: event.target.value } : item))}>{allowedPlanTypes.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label>Quantity<input type="number" min={1} max={8} value={row.count} onChange={event => setQuestionPlan(previous => previous.map((item, i) => i === index ? { ...item, count: Number(event.target.value) } : item))} /></label><button type="button" className="btn btn-ghost" onClick={() => setQuestionPlan(previous => previous.filter((_, i) => i !== index))}>Remove</button></div>)}</div>
            {questionPlan.length < 8 && allowedPlanTypes.some(option => !questionPlan.some(row => row.questionType === option.value)) && <button type="button" className="btn btn-ghost" onClick={() => setQuestionPlan(previous => [...previous, { questionType: allowedPlanTypes.find(option => !previous.some(row => row.questionType === option.value))?.value || '', count: 1 }])}><Plus size={16} /> Add type</button>}
            <button type="button" className="btn btn-ghost" disabled={planBusy} onClick={() => void preparePlan()}><RefreshCw size={16} /> Propose a different plan</button>
            {!planValid && <p role="alert">Include every selected type once, use compatible types, and keep the total at 1–8 questions.</p>}
          </>}
        </section>}
        <footer className="studio-ai-footer"><p><strong>Next: review in the official editor.</strong> Check factual accuracy, answers, layout and accessibility before sharing.</p><button type="button" className="btn btn-primary" onClick={() => void generate()} disabled={!canGenerate || !!sourceBusy || planBusy}><Wand2 size={17} /> Generate AI draft</button></footer>
        {!!nextSteps.length && <div className="studio-next-steps" role="status"><strong>To continue:</strong><ul>{nextSteps.map(step => <li key={step}>{step}</li>)}</ul></div>}
      </fieldset>}
      {generating && <p className="studio-ai-progress" role="status"><Loader2 className="spin" size={20} /> Generating and validating your draft. You can refresh and return to Create with AI to recover this request. A server restart may interrupt it; CREATE never retries paid generation automatically.</p>}
      {requestId && error && <button className="btn btn-outline" onClick={() => { setError(''); setStatusAttempt(value => value + 1); }}>Check generation status</button>}
      {preparing && <p className="studio-ai-progress" role="status"><Loader2 className="spin" size={20} /> Preparing the selected version in the official editor…</p>}
      {error && <div className="studio-ai-error" role="alert"><p>{error}</p>{!types.length && <button className="btn btn-outline" onClick={() => setLoadAttempt(value => value + 1)}>Retry loading types</button>}</div>}
      {active && promptHelperOpen && createPortal(<div id="studio-prompt-popup" className="studio-prompt-popup" role="dialog" aria-label="Prompt helper" onKeyDown={event => { if (event.key === 'Escape') setPromptHelperOpen(false); }}>
          <header><div><strong>Prompt helper</strong><small>Develop your teaching request together</small></div><button type="button" aria-label="Close prompt helper" onClick={() => setPromptHelperOpen(false)}>×</button></header>
          <p className="studio-prompt-context">Current context: {kind === 'single' ? `One activity${selected ? ` · ${selected.title}` : ''}` : `Question collection · ${collectionLayouts.find(choice => choice.value === layout)?.title} · ${selectedQuestionTypes.length ? selectedQuestionTypes.map(type => availableQuestionTypes.find(option => option.value === type)?.label || type).join(', ') : 'AI chooses types'}`}{sourceMode === 'course' ? ` · ${courses.find(course => course._id === courseId)?.name || 'Choose a course'} · ${selectedMaterials.length} materials · ${selectedObjectives.length} objectives` : ' · Your instructions only'}</p>
          <div className="studio-prompt-messages" role="log" aria-live="polite"><p className="studio-prompt-assistant">Tell me what students should learn or practice. I can help shape the topic, audience, quantity and feedback into a prompt. You can answer in your own words.</p>{promptConversation.map((message, index) => <p key={index} className={message.role === 'user' ? 'studio-prompt-user' : 'studio-prompt-assistant'}>{message.content}</p>)}{promptBusy && <p className="studio-prompt-assistant">Thinking…</p>}</div>
          {promptOffer && <div className="studio-prompt-offer"><strong>Generate a teaching prompt now?</strong><div><button type="button" className="btn btn-primary" disabled={promptBusy} onClick={() => void askPromptHelper(true)}>Yes, generate prompt</button><button type="button" className="btn btn-outline" onClick={() => setPromptOffer(false)}>Not now</button></div></div>}
          {promptSuggestion && <div className="studio-prompt-suggestion"><label htmlFor="studio-prompt-draft">Suggested prompt</label><textarea id="studio-prompt-draft" value={promptSuggestion} onChange={event => { setPromptSuggestion(event.target.value); setPromptCopied(false); }} rows={5} maxLength={12000} /><div className="studio-prompt-actions"><button type="button" className="btn btn-primary" disabled={promptSuggestion.trim().length < 10 || generating} onClick={() => { setInstructions(promptSuggestion.trim()); setQuestionPlan([]); setPromptHelperOpen(false); }}>Use this prompt</button><button type="button" className="btn btn-outline" disabled={!promptSuggestion.trim()} onClick={async () => { try { await navigator.clipboard.writeText(promptSuggestion); setPromptCopied(true); setPromptError(''); } catch { setPromptError('Could not copy automatically. Select the suggested prompt and copy it manually.'); } }}><Copy size={16} /> {promptCopied ? 'Copied' : 'Copy prompt'}</button></div></div>}
          <form onSubmit={event => { event.preventDefault(); void askPromptHelper(); }}><label htmlFor="studio-prompt-message">Your message</label><div><input id="studio-prompt-message" value={promptMessage} maxLength={1000} autoFocus onChange={event => setPromptMessage(event.target.value)} placeholder="e.g. First-year physics, three questions about force…" /><button type="submit" aria-label="Send to prompt helper" disabled={!promptMessage.trim() || promptBusy || generating}>{promptBusy ? <Loader2 className="spin" size={17} /> : <Send size={17} />}</button></div></form>
          {promptError && <p className="studio-prompt-error" role="alert">{promptError}</p>}
        </div>, document.body)}
    </section>
  );
}
