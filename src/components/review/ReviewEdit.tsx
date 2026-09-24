import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSelector, useDispatch, useStore } from 'react-redux';
import { Plus, Download, Upload, BookMarked, Boxes, Check } from 'lucide-react';
import { coverageMapApi, CoverageMap, questionsApi, Question, exportApi, h5pEditorApi, quizApi } from '../../services/api';
import type { H5PStudioContent } from '../../services/api';
import { usePubSub } from '../../hooks/usePubSub';
import { PUBSUB_EVENTS } from '../../services/pubsubService';
import { RootState, AppDispatch } from '../../store';
import {
  addQuestionForQuiz,
  fetchQuestions,
  setQuestionsForQuiz,
  deleteQuestion,
  updateQuestion as updateQuestionThunk,
  updateSavedQuestionForQuiz,
  selectReviewDrafts
} from '../../store/slices/questionSlice';
import { selectQuestionsByQuiz } from '../../store/selectors';
import { updateQuizLocally } from '../../store/slices/quizSlice';
import RegeneratePromptModal from '../RegeneratePromptModal';
import ChapterEditorPanel from './ChapterEditorPanel';
import PdfExportModal from '../PdfExportModal';
import CanvasExportModal from './CanvasExportModal';
import ManualQuestionForm from './ManualQuestionForm';
import QuestionCard from './QuestionCard';
import H5PStudioDraftDialog from './H5PStudioDraftDialog';
import FeatureCoachmark from '../onboarding/FeatureCoachmark';
import { useQuestionEditHandlers } from './useQuestionEditHandlers';
import { useQuestionDrafts } from './useQuestionDrafts';
import { useSingleQuestionGeneration } from '../../hooks/useSingleQuestionGeneration';
import GenerationJobStatus from '../generation/GenerationJobStatus';
import { useFeatureOnboarding } from '../../hooks/useFeatureOnboarding';
import { filterQuestionsByLearningObjectiveId } from '../../utils/questionLearningObjective';
import { useSystemDialog } from '../system-dialog/SystemDialogProvider';
import { ReviewEditProps, ExtendedQuestion } from './reviewTypes';
import {
  DELIVERY_TARGETS,
  DeliveryTarget,
  H5PPackageFormat,
  TARGET_FORMATS,
  TargetFormat,
  getDeliveryTargetForFormat,
  getQuestionTypesForTarget,
  getUnsupportedQuestionTypesForTarget
} from '../../constants/questionTypeCapabilities';
import '../../styles/components/ReviewEdit.css';

const recoveryFieldLabels: Record<string, string> = {
  isCorrect: 'Correct option', chosenFeedback: 'Feedback when selected',
  notChosenFeedback: 'Feedback when not selected', tip: 'Hint',
  textWithBlanks: 'Text with blanks', correctAnswers: 'Correct answers',
  leftItems: 'Left items', rightItems: 'Right items', matchingPairs: 'Matching pairs',
  correctOrder: 'Correct order', selectionMode: 'Answer mode',
};
const readableRecoveryValue = (value: unknown, indent = ''): string => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return new DOMParser().parseFromString(value, 'text/html').body.textContent || value;
  if (Array.isArray(value)) return value.map((item, index) => `${indent}${index + 1}. ${readableRecoveryValue(item, `${indent}  `)}`).join('\n');
  if (typeof value === 'object') return Object.entries(value)
    .filter(([key]) => !['_id', 'id', 'subContentId', 'library'].includes(key))
    .map(([key, item]) => {
      const label = recoveryFieldLabels[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, letter => letter.toUpperCase());
      return `${indent}${label}: ${readableRecoveryValue(item, `${indent}  `)}`;
    }).join('\n');
  return String(value);
};
const readableRecoveredQuestion = (question: Question) => [
  `Question\n${readableRecoveryValue(question.questionText)}`,
  Object.keys(question.content || {}).length ? `Activity content\n${readableRecoveryValue(question.content)}` : '',
  `Answer\n${typeof question.correctAnswer === 'boolean' ? String(question.correctAnswer) : readableRecoveryValue(question.correctAnswer)}`,
  question.explanation ? `Explanation\n${readableRecoveryValue(question.explanation)}` : ''
].filter(Boolean).join('\n\n');

const ReviewEdit = ({ quizId, learningObjectives, workflowMode = 'review' }: ReviewEditProps) => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const store = useStore<RootState>();
  const reduxQuestions = useSelector((state: RootState) => selectQuestionsByQuiz(state, quizId));
  const currentQuiz = useSelector((state: RootState) => state.quiz.currentQuiz);
  const drafts = useQuestionDrafts(quizId);
  const { questions, setQuestions, recoveredDrafts } = drafts;
  const recoveryRequests = useRef(new Set<string>());
  const [recoveringIds, setRecoveringIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [reordering, setReordering] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [exportLoading, setExportLoading] = useState(false);
  const [h5pStudioLoading, setH5PStudioLoading] = useState(false);
  const [pdfExportModalOpen, setPdfExportModalOpen] = useState(false);
  const [markdownExportModalOpen, setMarkdownExportModalOpen] = useState(false);
  const [canvasExportModalOpen, setCanvasExportModalOpen] = useState(false);
  const [regenerateModalOpen, setRegenerateModalOpen] = useState(false);
  const [regenerateLoading, setRegenerateLoading] = useState(false);
  const [questionToRegenerate, setQuestionToRegenerate] = useState<ExtendedQuestion | null>(null);
  const { showNotification, subscribe, unsubscribe, publish } = usePubSub('ReviewEdit');
  const { showConfirm } = useSystemDialog();

  const viewMode = workflowMode === 'preview-export' ? 'preview' : 'edit';
  const markReviewPending = () => {
    const quiz = store.getState().quiz.currentQuiz;
    if (quiz?._id === quizId && quiz.progress?.reviewCompleted) {
      dispatch(updateQuizLocally({ ...quiz, progress: { ...quiz.progress, reviewCompleted: false } }));
    }
  };
  const completeReview = async () => {
    if (reviewSaving || !questions.length || hasOpenDrafts || recoveredDrafts.length || filterByLOId) return;
    setReviewSaving(true);
    setReviewError('');
    try {
      const result = await quizApi.completeReview(quizId);
      if (activeQuizIdRef.current !== quizId) return;
      dispatch(updateQuizLocally(result.quiz));
      showNotification('success', 'Review completed', 'The current questions are ready to preview. Editing or generating questions will require another review.');
    } catch (error) {
      if (activeQuizIdRef.current !== quizId) return;
      setReviewError(error instanceof Error ? error.message : 'Could not complete review.');
    } finally {
      if (activeQuizIdRef.current === quizId) setReviewSaving(false);
    }
  };
  const ownerId = useSelector((state: RootState) => state.app.user?.id);
  const generationTask = useSingleQuestionGeneration(quizId, ownerId, job => {
    if (job.status === 'succeeded') {
      void dispatch(fetchQuestions(quizId));
      markReviewPending();
      setCoverageMap(null);
    }
  });
  const { generate: generateSingleQuestion } = generationTask;
  const [h5pDraftChoice, setH5PDraftChoice] = useState<{
    draft: H5PStudioContent;
    sourceOutdated: boolean;
    sourceQuizId: string;
  } | null>(null);
  const activeQuizIdRef = useRef(quizId);
  const h5pStudioRequestRef = useRef(0);
  activeQuizIdRef.current = quizId;
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [filterByLOId, setFilterByLOId] = useState<string | null>(null);
  const [containerMode, setContainerMode] = useState<H5PPackageFormat>('column');
  const [deliveryTarget, setDeliveryTarget] = useState<DeliveryTarget>('h5p-package');
  const [targetFormat, setTargetFormat] = useState<TargetFormat>('column');
  const [showChapterEditor, setShowChapterEditor] = useState(false);
  const [coverageMap, setCoverageMap] = useState<CoverageMap | null>(null);
  const [evidenceQuestionId, setEvidenceQuestionId] = useState<string | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const previewIframeRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const resize = (event: MessageEvent) => {
      const frame = previewIframeRef.current;
      if (!frame || event.source !== frame.contentWindow || event.data?.type !== 'tlef:h5p-preview-height') return;
      const height = event.data.height;
      if (typeof height === 'number' && Number.isFinite(height) && height > 0) frame.style.height = `${Math.min(100000, Math.max(320, height))}px`;
    };
    window.addEventListener('message', resize);
    return () => window.removeEventListener('message', resize);
  }, []);
  const evidenceTutorial = useFeatureOnboarding(
    'question-evidence',
    questions.length > 0 && viewMode === 'edit'
  );
  const exportTutorial = useFeatureOnboarding(
    'export',
    questions.length > 0 && workflowMode === 'preview-export' && evidenceTutorial.isCompleted
  );

  // Sync containerMode from Redux once currentQuiz loads
  useEffect(() => {
    const nextTargetFormat = (currentQuiz?.settings?.targetFormat as TargetFormat | undefined)
      || (currentQuiz?.containerMode as TargetFormat | undefined)
      || 'column';
    const nextDeliveryTarget = (currentQuiz?.settings?.deliveryTarget as DeliveryTarget | undefined)
      || getDeliveryTargetForFormat(nextTargetFormat);

    setDeliveryTarget(nextDeliveryTarget);
    setTargetFormat(nextTargetFormat);

    setContainerMode(nextTargetFormat === 'mixed-activity' ? 'column' : nextTargetFormat);
  }, [currentQuiz?.containerMode, currentQuiz?.settings?.deliveryTarget, currentQuiz?.settings?.targetFormat]);

  const handlers = useQuestionEditHandlers(questions, setQuestions);

  // Load questions from Redux on mount
  useEffect(() => {
    setRegenerateModalOpen(false);
    setQuestionToRegenerate(null);
    setRegenerateLoading(false);
    if (quizId) {
      dispatch(fetchQuestions(quizId));
    }
  }, [quizId, dispatch]);

  useEffect(() => { setLoading(false); }, [reduxQuestions]);

  const hasOpenDrafts = Object.keys(useSelector((state: RootState) => selectReviewDrafts(state, quizId))).length > 0;
  useEffect(() => {
    if (!hasOpenDrafts) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [hasOpenDrafts]);

  const isPublished = (questionId: string) => selectQuestionsByQuiz(store.getState(), quizId)
    .some(question => question._id === questionId);

  // Subscribe to PubSub events
  useEffect(() => {
    const completionToken = subscribe<{ quizId: string }>(
      PUBSUB_EVENTS.QUESTION_GENERATION_COMPLETED,
      (data: { quizId: string }) => {
        if (data.quizId === quizId) {
          setCoverageMap(null);
          dispatch(fetchQuestions(quizId));
          markReviewPending();
        }
      }
    );
    const objectivesDeletedToken = subscribe<{ quizId: string }>(
      PUBSUB_EVENTS.OBJECTIVES_DELETED,
      (data: { quizId: string }) => {
        if (data.quizId === quizId) {
          dispatch(fetchQuestions(quizId));
        }
      }
    );
    return () => {
      unsubscribe(completionToken);
      unsubscribe(objectivesDeletedToken);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizId, dispatch]);

  // Scroll to specific question from URL
  useEffect(() => {
    const questionId = searchParams.get('questionId');
    if (questionId && questions.length > 0 && !loading) {
      setTimeout(() => {
        const questionElement = document.getElementById(`question-${questionId}`);
        if (questionElement) {
          questionElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          questionElement.classList.add('highlight-question');
          setTimeout(() => { questionElement.classList.remove('highlight-question'); }, 2000);
        }
      }, 300);
    }
  }, [searchParams, questions, loading]);

  useEffect(() => {
    if (
      filterByLOId
      && !learningObjectives.some(objective => objective._id === filterByLOId)
    ) {
      setFilterByLOId(null);
    }
  }, [filterByLOId, learningObjectives]);

  useEffect(() => {
    h5pStudioRequestRef.current += 1;
    setH5PDraftChoice(null);
    setH5PStudioLoading(false);
  }, [quizId]);

  const filteredQuestions = filterQuestionsByLearningObjectiveId(
    questions,
    filterByLOId
  );

  const reorderDisabledReason = reordering ? 'Saving question order…'
    : filterByLOId ? 'Select All Objectives to reorder the full question list.'
    : questions.some(question => question.isEditing) ? 'Save or cancel your edits before reordering.'
    : undefined;

  const moveQuestion = async (questionId: string, direction: -1 | 1) => {
    if (reorderDisabledReason) return;
    const from = questions.findIndex(question => question._id === questionId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= questions.length) return;
    const reordered = [...questions];
    [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
    setReordering(true);
    try {
      const result = await questionsApi.reorderQuestions(quizId, reordered.map(question => question._id));
      if (activeQuizIdRef.current !== quizId) return;
      dispatch(setQuestionsForQuiz({ quizId, questions: result.questions }));
      markReviewPending();
      setCoverageMap(null);
      showNotification('success', 'Question Order Saved', 'The question list order has been saved.');
      publish(PUBSUB_EVENTS.QUESTIONS_CHANGED, { quizId, reason: 'reordered', timestamp: Date.now() });
    } catch (error) {
      showNotification('error', 'Reorder Failed', error instanceof Error ? error.message : 'Could not save the question order.');
    } finally {
      setReordering(false);
    }
  };

  const handleDeleteQuestion = async (questionId: string) => {
    const confirmed = await showConfirm({
      title: 'Delete question?',
      description: 'This permanently removes the saved question. This cannot be undone.',
      confirmLabel: 'Delete question',
      tone: 'danger'
    });
    if (!confirmed || activeQuizIdRef.current !== quizId || !isPublished(questionId)) return;
    try {
      await dispatch(deleteQuestion({ quizId, questionId })).unwrap();
      if (activeQuizIdRef.current !== quizId) return;
      markReviewPending();
      drafts.discardSnapshot(questionId);
      setCoverageMap(null);
      setEvidenceQuestionId(current => current === questionId ? null : current);
      showNotification('success', 'Question Deleted', 'Question has been removed');
      publish(PUBSUB_EVENTS.QUESTIONS_CHANGED, {
        quizId, reason: 'deleted', timestamp: Date.now()
      });
    } catch (error) {
      if (activeQuizIdRef.current !== quizId) return;
      console.error('Failed to delete question:', error);
      showNotification('error', 'Delete Failed', 'Failed to delete question');
    }
  };

  const toggleQuestionEvidenceMap = async (questionId: string) => {
    if (evidenceQuestionId === questionId) {
      setEvidenceQuestionId(null);
      return;
    }

    setEvidenceQuestionId(questionId);
    if (coverageMap || coverageLoading) return;

    setCoverageLoading(true);
    setCoverageError(null);
    try {
      setCoverageMap(await coverageMapApi.getQuizCoverageMap(quizId));
    } catch (error) {
      console.error('Failed to load question evidence map:', error);
      setCoverageError('The evidence map could not be loaded. Please try again.');
    } finally {
      setCoverageLoading(false);
    }
  };

  const saveQuestion = async (questionId: string) => {
    try {
      const question = questions.find(q => q._id === questionId);
      if (!question || !isPublished(questionId)) return;
      const submittedDraft = { ...question };
      delete submittedDraft.isEditing;
      const updates: Partial<Question> = {
        questionText: question.questionText,
        type: question.type,
        difficulty: question.difficulty,
        content: question.content,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation
      };
      await dispatch(updateQuestionThunk({ quizId, questionId, updates })).unwrap();
      if (activeQuizIdRef.current !== quizId) return;
      markReviewPending();
      if (!isPublished(questionId)) return;
      drafts.discardSnapshot(questionId, submittedDraft);
      setCoverageMap(null);
      showNotification('success', 'Question Saved', selectReviewDrafts(store.getState(), quizId)[questionId]
        ? 'The submitted changes were saved. Your newer edits are still unsaved.'
        : 'Question has been updated');
    } catch (error) {
      if (activeQuizIdRef.current !== quizId) return;
      console.error('Failed to save question:', error);
      showNotification('error', 'Save Failed', 'Failed to save question changes');
    }
  };

  const openRegenerateModal = (questionId: string) => {
    const question = questions.find(q => q._id === questionId);
    if (question) {
      setQuestionToRegenerate(question);
      setRegenerateModalOpen(true);
    }
  };

  const handleRegenerate = async (customPrompt?: string) => {
    if (!questionToRegenerate || !isPublished(questionToRegenerate._id)) return;
    setRegenerateLoading(true);
    try {
      const result = await questionsApi.regenerateQuestion(questionToRegenerate._id, customPrompt);
      if (activeQuizIdRef.current !== quizId) return;
      if (!isPublished(questionToRegenerate._id)) return;
      drafts.discardSnapshot(questionToRegenerate._id);
      dispatch(updateSavedQuestionForQuiz({ quizId, question: result.question }));
      markReviewPending();
      setCoverageMap(null);
      showNotification('success', 'Question Regenerated', 'Question has been regenerated using AI');
      setRegenerateModalOpen(false);
      setQuestionToRegenerate(null);
    } catch (error) {
      if (activeQuizIdRef.current !== quizId) return;
      console.error('Failed to regenerate question:', error);
      showNotification('error', 'Regeneration Failed', 'Failed to regenerate question');
    } finally {
      if (activeQuizIdRef.current === quizId) setRegenerateLoading(false);
    }
  };

  const handleGenerateAIQuestion = async (loIndex: number, prompt: string, questionType: string) => {
    const selectedLO = loIndex >= 0 ? learningObjectives[loIndex] : null;
    const questionConfig = {
      questionType,
      difficulty: 'moderate',
      learningObjective: selectedLO?.text || '',
      learningObjectiveId: selectedLO?._id,
      ...(loIndex < 0 && { useCustomPromptOnly: true }),
      ...(prompt.trim() && { customPrompt: prompt.trim() })
    };

    showNotification('info', 'AI Generation Started', 'Generating a new question...');

    const generatedId = await generateSingleQuestion(questionConfig);
    if (activeQuizIdRef.current !== quizId) return;

    // Completion identifies this session's committed question. A different
    // concurrent addition cannot satisfy it, and list loading does not retry AI.
    try {
      const result = await dispatch(fetchQuestions(quizId)).unwrap();
      if (!result.questions.some(question => question._id === generatedId)) {
        throw new Error('The saved question is not in the refreshed list yet.');
      }
      publish(PUBSUB_EVENTS.QUESTIONS_CHANGED, {
        quizId, reason: 'added', questionCount: result.questions.length, timestamp: Date.now()
      });
      showNotification('success', 'Question Added', 'AI generated a new question successfully');
      window.setTimeout(() => {
        document.getElementById(`question-${generatedId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 250);
    } catch {
      showNotification('warning', 'Question Saved', 'The new question was saved, but the list could not refresh. Refresh Review to see it; do not generate it again.');
    }
  };

  const recoveredContent = (question: Question) => JSON.stringify({
    originalQuestionId: question._id,
    quizId,
    learningObjective: question.learningObjective,
    type: question.type,
    difficulty: question.difficulty,
    questionText: question.questionText,
    content: question.content,
    correctAnswer: question.correctAnswer,
    explanation: question.explanation,
    sourceReferences: question.generationMetadata?.sourceReferences
  }, null, 2);

  const copyRecoveredDraft = async (question: Question) => {
    try {
      await navigator.clipboard.writeText(readableRecoveredQuestion(question));
      showNotification('success', 'Draft Copied', 'The recovered question, answers and feedback are on your clipboard.');
    } catch {
      showNotification('warning', 'Copy Unavailable', 'Use Download draft or select the text under View recovered content.');
    }
  };

  const downloadRecoveredDraft = (question: Question) => {
    const url = URL.createObjectURL(new Blob([recoveredContent(question)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `recovered-question-${question._id}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const saveRecoveredDraft = async (question: Question) => {
    if (recoveryRequests.current.has(question._id) || isPublished(question._id)) return;
    recoveryRequests.current.add(question._id);
    setRecoveringIds(current => [...current, question._id]);
    try {
      const learningObjectiveId = typeof question.learningObjective === 'string'
        ? question.learningObjective : question.learningObjective?._id || '';
      const result = await questionsApi.createQuestion({
        quizId, learningObjectiveId, type: question.type, difficulty: question.difficulty,
        questionText: question.questionText, content: question.content,
        correctAnswer: question.correctAnswer, explanation: question.explanation
      });
      // Never send an update to the retired ID. Only a confirmed creation can
      // remove this recovery copy; the returned question has its own new ID.
      if (!result.question?._id || result.question._id === question._id) throw new Error('The new question was not confirmed.');
      dispatch(addQuestionForQuiz({ quizId, question: result.question }));
      markReviewPending();
      drafts.discardSnapshot(question._id, question);
      if (activeQuizIdRef.current !== quizId) return;
      setCoverageMap(null);
      showNotification('success', 'Recovered Question Saved', 'Your edits were saved as a new question. Review its objective and evidence before export.');
      publish(PUBSUB_EVENTS.QUESTIONS_CHANGED, { quizId, reason: 'added', timestamp: Date.now() });
    } catch (error) {
      if (activeQuizIdRef.current !== quizId) return;
      showNotification('warning', 'Recovery Not Confirmed', `${error instanceof Error ? error.message : 'Could not confirm the new question.'} Your draft is still available. Check the saved list before trying again.`);
    } finally {
      recoveryRequests.current.delete(question._id);
      setRecoveringIds(current => current.filter(id => id !== question._id));
    }
  };

  const discardRecoveredDraft = async (questionId: string) => {
    const confirmed = await showConfirm({
      title: 'Discard recovered edits?',
      description: 'These edits are not in the saved question list. Copy or download them first if you want to keep them.',
      confirmLabel: 'Discard edits', tone: 'danger'
    });
    if (confirmed) drafts.discardSnapshot(questionId);
  };

  const handleH5PExport = async () => {
    if (questions.length === 0) {
      showNotification('warning', 'No Questions', 'Add some questions before exporting to H5P');
      return;
    }

    const h5pCheckFormat: TargetFormat = deliveryTarget === 'canvas-lti'
      ? 'column'
      : targetFormat;
    const unsupported = getUnsupportedQuestionTypesForTarget(
      questions.map(question => question.type),
      h5pCheckFormat
    );

    if (deliveryTarget === 'canvas-lti' || unsupported.length > 0) {
      const unsupportedText = unsupported.length > 0
        ? `\n\nUnsupported in ${h5pCheckFormat}: ${unsupported.map(type => type.label).join(', ')}`
        : '';
      const shouldContinue = await showConfirm({
        title: 'Export using H5P container rules?',
        description:
          `This learning object is configured for ${deliveryTarget === 'canvas-lti' ? 'Canvas LTI / Mixed Activity' : targetFormatLabel}. ` +
          `A downloaded H5P package must follow official H5P container rules.${unsupportedText}`,
        confirmLabel: 'Continue export',
        tone: 'warning'
      });

      if (!shouldContinue) {
        return;
      }
    }

    setExportLoading(true);
    try {
      showNotification('info', 'Generating Export', 'Creating H5P package...');
      const result = await exportApi.exportToH5P(quizId);
      if (result.success && result.data) {
        const blob = await exportApi.downloadExport(result.data.exportId);
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = result.data.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        showNotification('success', 'Export Complete', `Downloaded ${result.data.filename} successfully`);
      } else {
        const errorMessage = result.error?.message || 'Failed to generate H5P export';
        throw new Error(errorMessage);
      }
    } catch (error: unknown) {
      console.error('H5P export failed:', error);
      showNotification('error', 'Export Failed', error instanceof Error ? error.message : 'Failed to export quiz to H5P format');
    } finally {
      setExportLoading(false);
    }
  };

  const handlePDFExport = async (type: 'questions' | 'answers' | 'combined') => {
    if (questions.length === 0) {
      showNotification('warning', 'No Questions', 'Add some questions before exporting to PDF');
      return;
    }
    setExportLoading(true);
    setPdfExportModalOpen(false);
    try {
      const typeLabels = { questions: 'Questions', answers: 'Answers', combined: 'Questions and Answers' };
      showNotification('info', 'Generating PDF', `Creating ${typeLabels[type]} PDF...`);
      const result = await exportApi.exportToPDF(quizId, type);
      if (result.success && result.data) {
        const blob = await exportApi.downloadExport(result.data.exportId);
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = result.data.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        showNotification('success', 'PDF Export Complete', `Downloaded ${result.data.filename} successfully`);
      } else {
        const errorMessage = result.error?.message || 'Failed to generate PDF export';
        throw new Error(errorMessage);
      }
    } catch (error: unknown) {
      console.error('PDF export failed:', error);
      showNotification('error', 'PDF Export Failed', error instanceof Error ? error.message : 'Failed to export quiz to PDF format');
    } finally {
      setExportLoading(false);
    }
  };

  const handleMarkdownExport = async (type: 'questions' | 'answers' | 'combined') => {
    if (questions.length === 0) {
      showNotification('warning', 'No Questions', 'Add some questions before exporting to Markdown');
      return;
    }
    setExportLoading(true);
    setMarkdownExportModalOpen(false);
    try {
      const typeLabels = { questions: 'Questions', answers: 'Answers', combined: 'Questions and Answers' };
      showNotification('info', 'Generating Markdown', `Creating ${typeLabels[type]} Markdown export...`);
      const result = await exportApi.exportToMarkdown(quizId, type);
      if (result.success && result.data) {
        const blob = await exportApi.downloadExport(result.data.exportId);
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = result.data.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        showNotification('success', 'Markdown Export Complete', `Downloaded ${result.data.filename} successfully`);
      } else {
        const errorMessage = result.error?.message || 'Failed to generate Markdown export';
        throw new Error(errorMessage);
      }
    } catch (error: unknown) {
      console.error('Markdown export failed:', error);
      showNotification('error', 'Markdown Export Failed', error instanceof Error ? error.message : 'Failed to export quiz to Markdown format');
    } finally {
      setExportLoading(false);
    }
  };

  const handleOpenH5PStudio = async () => {
    if (questions.length === 0 || h5pStudioLoading) return;
    const sourceQuizId = quizId;
    const requestId = ++h5pStudioRequestRef.current;
    setH5PStudioLoading(true);
    try {
      showNotification('info', 'Checking H5P Studio', 'CREATE is checking for an existing editable draft…');
      const response = await h5pEditorApi.createFromQuiz(sourceQuizId);
      if (
        h5pStudioRequestRef.current !== requestId
        || activeQuizIdRef.current !== sourceQuizId
      ) {
        return;
      }
      const content = response.data?.content;
      const contentId = content?.contentId;
      if (!contentId) throw new Error('CREATE did not return editable H5P content.');
      if (response.data?.reused && content) {
        setH5PDraftChoice({
          draft: content,
          sourceOutdated: Boolean(response.data.sourceOutdated),
          sourceQuizId
        });
        return;
      }
      navigate(`/h5p-studio?contentId=${encodeURIComponent(contentId)}`);
    } catch (error) {
      showNotification('error', 'H5P editor could not open', error instanceof Error ? error.message : 'Could not prepare this Learning Object for advanced editing.');
    } finally {
      if (h5pStudioRequestRef.current === requestId) {
        setH5PStudioLoading(false);
      }
    }
  };

  const handleOpenExistingH5PDraft = () => {
    const contentId = h5pDraftChoice?.draft.contentId;
    if (!contentId) return;
    setH5PDraftChoice(null);
    navigate(`/h5p-studio?contentId=${encodeURIComponent(contentId)}`);
  };

  const handleCreateFreshH5PDraft = async () => {
    const sourceQuizId = h5pDraftChoice?.sourceQuizId;
    if (h5pStudioLoading || !sourceQuizId) return;
    const requestId = ++h5pStudioRequestRef.current;
    setH5PStudioLoading(true);
    try {
      showNotification(
        'info',
        'Creating fresh H5P draft',
        'CREATE is converting the current questions into a separate H5P Studio draft…'
      );
      const response = await h5pEditorApi.createFromQuiz(sourceQuizId, true);
      if (
        h5pStudioRequestRef.current !== requestId
        || activeQuizIdRef.current !== sourceQuizId
      ) {
        return;
      }
      const contentId = response.data?.content.contentId;
      if (!contentId) throw new Error('CREATE did not return the new H5P draft.');
      setH5PDraftChoice(null);
      navigate(`/h5p-studio?contentId=${encodeURIComponent(contentId)}`);
    } catch (error) {
      showNotification(
        'error',
        'Fresh H5P draft could not be created',
        error instanceof Error ? error.message : 'Could not create a new draft from this Learning Object.'
      );
    } finally {
      if (h5pStudioRequestRef.current === requestId) {
        setH5PStudioLoading(false);
      }
    }
  };

  if (loading) {
    return (
      <div className={`review-edit ${viewMode === 'preview' ? 'review-edit-preview' : ''}`}>
      <GenerationJobStatus job={generationTask.job} busy={generationTask.isBusy} message={generationTask.recoveryMessage} onRefresh={generationTask.refresh} onCloseUnregistered={generationTask.unregistered ? generationTask.closeUnregistered : undefined} />
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Loading Questions...</h3>
            <p className="card-description">Please wait while we load your questions</p>
          </div>
          <div className="p-6 text-center">
            <div className="loading-spinner">Loading...</div>
          </div>
        </div>
      </div>
    );
  }

  const deliveryTargetLabel = DELIVERY_TARGETS.find(target => target.value === deliveryTarget)?.label || deliveryTarget;
  const targetFormatLabel = TARGET_FORMATS.find(format => format.value === targetFormat)?.label || targetFormat;
  const h5pUnsupportedTypes = getUnsupportedQuestionTypesForTarget(
    questions.map(question => question.type),
    deliveryTarget === 'canvas-lti' ? 'column' : targetFormat
  );
  const availableQuestionTypes = getQuestionTypesForTarget(targetFormat);

  return (
    <div className={`review-edit ${viewMode === 'preview' ? 'review-edit-preview' : ''}`}>
      <GenerationJobStatus job={generationTask.job} busy={generationTask.isBusy} message={generationTask.recoveryMessage} onRefresh={generationTask.refresh} onCloseUnregistered={generationTask.unregistered ? generationTask.closeUnregistered : undefined} />
      {recoveredDrafts.length > 0 && (
        <section className="card" aria-label="Recovered unsaved edits">
          <div className="card-header">
            <h3 className="card-title">Recovered unsaved edits</h3>
            <p>The saved question list changed while you were editing. Your edits below are kept separately and are not included in previews or exports. Copy, download, or save them as new questions before refreshing or closing this page.</p>
          </div>
          <div className="p-6">
            {recoveredDrafts.map(({ question }) => {
              const objectiveId = typeof question.learningObjective === 'string' ? question.learningObjective : question.learningObjective?._id;
              const recoveryBlocked = !availableQuestionTypes.some(type => type.value === question.type)
                ? 'This type is not supported by the current layout. Copy or download the draft to keep it.'
                : objectiveId && !learningObjectives.some(objective => objective._id === objectiveId)
                  ? 'The original learning objective is no longer available. Copy or download the draft, then add a question with a current objective.' : undefined;
              const saving = recoveringIds.includes(question._id);
              return (
                <article key={question._id} aria-label={`Recovered draft: ${question.questionText}`} className="mb-6">
                  <h4>{question.questionText}</h4>
                  <details>
                    <summary>View recovered content</summary>
                    <div role="document" aria-label="Recovered question content" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: '12px' }}>{readableRecoveredQuestion(question)}</div>
                  </details>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button className="btn btn-outline" onClick={() => void copyRecoveredDraft(question)}>Copy draft</button>
                    <button className="btn btn-outline" onClick={() => downloadRecoveredDraft(question)}>Download draft</button>
                    <button className="btn btn-primary" disabled={saving || !!recoveryBlocked} onClick={() => void saveRecoveredDraft(question)}>{saving ? 'Saving recovered question…' : 'Save as new question'}</button>
                    <button className="btn btn-ghost" disabled={saving} onClick={() => void discardRecoveredDraft(question._id)}>Discard edits</button>
                  </div>
                  <p className="text-sm">Download draft keeps a complete recovery file, including your original source references.</p>
                  {recoveryBlocked && <p>{recoveryBlocked}</p>}
                </article>
              );
            })}
          </div>
        </section>
      )}
      <div className="card">
        <div className="card-header">
          <div className="review-header">
            <div>
              <h3 className="card-title">
                {workflowMode === 'preview-export' ? 'Preview & Export' : 'Review Questions'}
              </h3>
              <p className="card-description">
                {workflowMode === 'preview-export'
                  ? `Preview the current Quiz and choose a delivery option (${questions.length} question${questions.length === 1 ? '' : 's'})`
                  : `Check, edit, regenerate, and reorder questions before delivery (${questions.length} question${questions.length === 1 ? '' : 's'} loaded)`}
              </p>
            </div>
            <div className="review-actions">
              <div className="format-selector" title="Target format is selected in Generate Questions">
                <span className="format-readonly-label">Delivery</span>
                <span className="format-readonly-value">{deliveryTargetLabel}</span>
                <span className="format-readonly-separator">/</span>
                <span className="format-readonly-value">{targetFormatLabel}</span>
                {containerMode === 'interactive-book' && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setShowChapterEditor(true)}
                    title="Edit chapters"
                  >
                    <BookMarked size={14} />
                  </button>
                )}
              </div>

              {workflowMode === 'preview-export' && deliveryTarget === 'h5p-package' && questions.length > 0 && (
                <button className="btn btn-outline" onClick={handleOpenH5PStudio} disabled={h5pStudioLoading}>
                  {h5pStudioLoading ? <span className="spinner-mini" /> : <Boxes size={16} />}
                  {h5pStudioLoading ? 'Preparing…' : 'Advanced H5P Editor'}
                </button>
              )}
              {workflowMode === 'review' && (
                <button className="btn btn-outline" onClick={() => setShowManualAdd(true)}>
                  <Plus size={16} /> Add Question
                </button>
              )}
            </div>
          </div>
        </div>

        {workflowMode === 'review' && questions.length > 0 && (
          <div className="review-completion" role="status">
            {currentQuiz?.progress?.reviewCompleted ? (
              <p><Check size={17} /> Review complete. These saved questions are ready to preview.</p>
            ) : (
              <>
                <p>Check every question’s accuracy, answer, feedback, sources and order. When finished, confirm the full saved set.</p>
                <button type="button" className="btn btn-primary" disabled={reviewSaving || hasOpenDrafts || recoveredDrafts.length > 0 || !!filterByLOId || generationTask.isBusy || reordering} onClick={() => void completeReview()}>
                  <Check size={16} /> {reviewSaving ? 'Saving review…' : 'Mark review complete'}
                </button>
                {(hasOpenDrafts || recoveredDrafts.length > 0 || !!filterByLOId) && <small>{filterByLOId ? 'Select All Objectives to review the full question set.' : 'Save, cancel or recover unsaved edits before completing review.'}</small>}
              </>
            )}
            {reviewError && <p role="alert">{reviewError}</p>}
          </div>
        )}

        <div className="review-filters">
          <div className="filter-group">
            <label>Filter by Learning Objective:</label>
            <select
              className="select-input"
              value={filterByLOId ?? ''}
              onChange={(e) => setFilterByLOId(e.target.value || null)}
            >
              <option value="">All Objectives</option>
              {learningObjectives.map((obj, index) => {
                const text = obj.text;
                return (
                  <option key={obj._id} value={obj._id}>
                    LO {index + 1}: {text.substring(0, 50)}{text.length > 50 ? '...' : ''}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="questions-count">
            {filteredQuestions.length} question{filteredQuestions.length === 1 ? '' : 's'} {filterByLOId !== null ? 'in this objective' : 'total'}
          </div>
        </div>

        <div className="questions-list">
          {filteredQuestions.length === 0 ? (
            <div className="no-questions">
              <p>No questions found. Generate questions from the Question Generation tab first, or add questions manually.</p>
              {viewMode === 'edit' && (
                <button className="btn btn-primary" onClick={() => setShowManualAdd(true)}>
                  <Plus size={16} /> Add First Question
                </button>
              )}
            </div>
          ) : viewMode === 'preview' ? (
            <div className="questions-interactive">
              <iframe
                ref={previewIframeRef}
                key={`h5p-preview-${quizId}-${filterByLOId ?? 'all'}-${targetFormat}`}
                src={`/api/create/h5p-preview/quiz/${quizId}/render?containerMode=${targetFormat}${filterByLOId !== null ? `&lo=${filterByLOId}` : ''}`}
                title="H5P Quiz Preview"
                style={{ width: '100%', height: '800px', border: 'none', borderRadius: '8px', background: '#f9fafb' }}
                allow="fullscreen"
                sandbox="allow-scripts"
              />
            </div>
          ) : (
            filteredQuestions.map((question, index) => (
              <QuestionCard
                key={question._id}
                question={question}
                index={index}
                handlers={handlers}
                onToggleEdit={drafts.toggleEdit}
                onSave={saveQuestion}
                onDelete={handleDeleteQuestion}
                onRegenerate={openRegenerateModal}
                onMove={moveQuestion}
                canMoveUp={!reorderDisabledReason && index > 0}
                canMoveDown={!reorderDisabledReason && index < filteredQuestions.length - 1}
                reorderDisabledReason={reorderDisabledReason}
                actionsDisabled={reordering}
                evidenceMapOpen={evidenceQuestionId === question._id}
                coverageMap={coverageMap}
                coverageLoading={coverageLoading}
                coverageError={coverageError}
                onToggleEvidenceMap={toggleQuestionEvidenceMap}
                showEvidenceTutorial={index === 0 && evidenceTutorial.isActive}
                onEvidenceTutorialComplete={evidenceTutorial.complete}
                onSkipTutorials={evidenceTutorial.skipAll}
              />
            ))
          )}
        </div>

        {workflowMode === 'preview-export' && filteredQuestions.length > 0 && (
          <FeatureCoachmark
            isOpen={exportTutorial.isActive}
            title="Publish in the format you need"
            description="Export the reviewed learning object to H5P, PDF, Markdown, or Canvas. PDF and Markdown exports can include solutions, explanations, tips, and answer feedback."
            eyebrow="Export"
            placement="top-start"
            block
            onPrimary={exportTutorial.complete}
            onDismiss={exportTutorial.complete}
            onSkip={exportTutorial.skipAll}
          >
            <div className="export-section">
              <div className="export-header">
                <h4>Export Quiz</h4>
                <p>Export your completed quiz for use in other platforms</p>
              </div>

              {/* Standalone-type warning */}
              {deliveryTarget === 'canvas-lti' && (
                <div className="standalone-warning">
                  <strong>Canvas LTI:</strong> This uses CREATE's LTI player and can render mixed activity types that may not be valid inside a downloadable H5P package.
                </div>
              )}

              {deliveryTarget === 'h5p-package' && h5pUnsupportedTypes.length > 0 && (
                <div className="standalone-warning">
                  <strong>H5P compatibility:</strong> {h5pUnsupportedTypes.map(type => type.label).join(', ')} cannot be embedded in {targetFormatLabel} format and may be skipped or fail in official H5P players.
                </div>
              )}

              <div className="export-actions">
                <button className="btn btn-primary" onClick={handleH5PExport} disabled={exportLoading}>
                  <Download size={16} /> {exportLoading ? 'Exporting...' : 'Export to H5P'}
                </button>
                <button className="btn btn-outline" onClick={() => setPdfExportModalOpen(true)} disabled={exportLoading}>
                  <Download size={16} /> {exportLoading ? 'Exporting...' : 'Export to PDF'}
                </button>
                <button className="btn btn-outline" onClick={() => setMarkdownExportModalOpen(true)} disabled={exportLoading}>
                  <Download size={16} /> {exportLoading ? 'Exporting...' : 'Export to Markdown'}
                </button>
                <button className="btn btn-outline" onClick={() => setCanvasExportModalOpen(true)} disabled={exportLoading}>
                  <Upload size={16} /> Export to Canvas
                </button>
              </div>
            </div>
          </FeatureCoachmark>
        )}

        <ManualQuestionForm
          isOpen={showManualAdd}
          onClose={() => setShowManualAdd(false)}
          quizId={quizId}
          learningObjectives={learningObjectives}
          availableQuestionTypes={availableQuestionTypes}
          onQuestionAdded={(question) => {
            dispatch(addQuestionForQuiz({ quizId, question }));
            markReviewPending();
            publish(PUBSUB_EVENTS.QUESTIONS_CHANGED, {
              quizId,
              reason: 'added',
              questionCount: questions.length + 1,
              timestamp: Date.now()
            });
          }}
          onGenerateAI={handleGenerateAIQuestion}
          showNotification={showNotification}
        />
      </div>

      {questionToRegenerate && (
        <RegeneratePromptModal
          isOpen={regenerateModalOpen}
          onClose={() => { setRegenerateModalOpen(false); setQuestionToRegenerate(null); }}
          onRegenerate={handleRegenerate}
          question={questionToRegenerate}
          isLoading={regenerateLoading}
          historyKey="question"
        />
      )}

      <H5PStudioDraftDialog
        draft={h5pDraftChoice?.draft || null}
        sourceOutdated={Boolean(h5pDraftChoice?.sourceOutdated)}
        loading={h5pStudioLoading}
        onOpenExisting={handleOpenExistingH5PDraft}
        onCreateFresh={() => { void handleCreateFreshH5PDraft(); }}
        onCancel={() => setH5PDraftChoice(null)}
      />

      <PdfExportModal
        isOpen={pdfExportModalOpen}
        onClose={() => setPdfExportModalOpen(false)}
        onExport={handlePDFExport}
        isLoading={exportLoading}
      />

      <PdfExportModal
        isOpen={markdownExportModalOpen}
        onClose={() => setMarkdownExportModalOpen(false)}
        onExport={handleMarkdownExport}
        isLoading={exportLoading}
        title="Export to Markdown"
        subtitle="Choose what to include in your Markdown export"
      />

      <CanvasExportModal
        isOpen={canvasExportModalOpen}
        onClose={() => setCanvasExportModalOpen(false)}
        quizId={quizId}
        quizName={currentQuiz?.name || 'Learning Object'}
        showNotification={showNotification}
      />

      {showChapterEditor && (
        <ChapterEditorPanel
          quizId={quizId}
          questions={questions}
          learningObjectives={learningObjectives}
          initialChapters={currentQuiz?.chapters || []}
          onClose={() => setShowChapterEditor(false)}
          onSaved={(chapters) => {
            setShowChapterEditor(false);
            showNotification('success', 'Chapters Saved', 'Chapter structure updated successfully');
          }}
          showNotification={showNotification}
        />
      )}
    </div>
  );
};

export default ReviewEdit;
