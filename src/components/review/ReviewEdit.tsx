import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { Edit, Plus, Eye, Download, Upload, BookMarked, Boxes } from 'lucide-react';
import { coverageMapApi, CoverageMap, questionsApi, Question, exportApi, h5pEditorApi } from '../../services/api';
import type { H5PStudioContent } from '../../services/api';
import { usePubSub } from '../../hooks/usePubSub';
import { PUBSUB_EVENTS } from '../../services/pubsubService';
import { RootState, AppDispatch } from '../../store';
import {
  addQuestionForQuiz,
  fetchQuestions,
  deleteQuestion,
  updateQuestion as updateQuestionThunk
} from '../../store/slices/questionSlice';
import { selectQuestionsByQuiz } from '../../store/selectors';
import RegeneratePromptModal from '../RegeneratePromptModal';
import ChapterEditorPanel from './ChapterEditorPanel';
import PdfExportModal from '../PdfExportModal';
import CanvasExportModal from './CanvasExportModal';
import ManualQuestionForm from './ManualQuestionForm';
import QuestionCard from './QuestionCard';
import H5PStudioDraftDialog from './H5PStudioDraftDialog';
import FeatureCoachmark from '../onboarding/FeatureCoachmark';
import { useQuestionEditHandlers } from './useQuestionEditHandlers';
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

const ReviewEdit = ({ quizId, learningObjectives }: ReviewEditProps) => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const reduxQuestions = useSelector((state: RootState) => selectQuestionsByQuiz(state, quizId));
  const currentQuiz = useSelector((state: RootState) => state.quiz.currentQuiz);
  const [questions, setQuestions] = useState<ExtendedQuestion[]>([]);
  const [loading, setLoading] = useState(true);
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

  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit');
  const [h5pDraftChoice, setH5PDraftChoice] = useState<{
    draft: H5PStudioContent;
    sourceOutdated: boolean;
    sourceQuizId: string;
  } | null>(null);
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
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
  const evidenceTutorial = useFeatureOnboarding(
    'question-evidence',
    questions.length > 0 && viewMode === 'edit'
  );
  const exportTutorial = useFeatureOnboarding(
    'export',
    questions.length > 0 && evidenceTutorial.isCompleted
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
    if (quizId) {
      dispatch(fetchQuestions(quizId));
    }
  }, [quizId, dispatch]);

  // Sync Redux questions to local state
  useEffect(() => {
    if (reduxQuestions.length > 0) {
      setQuestions(prev => {
        // Skip update if the question IDs haven't changed
        const prevIds = prev.map(q => q._id).join(',');
        const newIds = reduxQuestions.map(q => q._id).join(',');
        if (prevIds === newIds) {
          // Update content but preserve isEditing state
          return prev.map(existing => {
            const updated = reduxQuestions.find(q => q._id === existing._id);
            return updated ? { ...updated, isEditing: existing.isEditing } : existing;
          });
        }
        return reduxQuestions.map(q => ({ ...q, isEditing: false }));
      });
    } else {
      setQuestions(prev => prev.length === 0 ? prev : []);
    }
    setLoading(false);
  }, [reduxQuestions]);

  // Subscribe to PubSub events
  useEffect(() => {
    const completionToken = subscribe<{ quizId: string }>(
      PUBSUB_EVENTS.QUESTION_GENERATION_COMPLETED,
      (data: { quizId: string }) => {
        if (data.quizId === quizId) {
          setCoverageMap(null);
          dispatch(fetchQuestions(quizId));
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

  useEffect(() => {
    if (viewMode !== 'preview') return undefined;

    const handlePreviewMessage = (event: MessageEvent) => {
      const iframe = previewIframeRef.current;
      if (
        event.source !== iframe?.contentWindow
        || event.data?.type !== 'tlef:h5p-preview-height'
        || typeof event.data.height !== 'number'
        || !Number.isFinite(event.data.height)
      ) {
        return;
      }

      const nextHeight = Math.min(20000, Math.max(320, Math.ceil(event.data.height)));
      iframe.style.height = `${nextHeight}px`;
    };

    window.addEventListener('message', handlePreviewMessage);
    return () => window.removeEventListener('message', handlePreviewMessage);
  }, [viewMode]);

  const filteredQuestions = filterQuestionsByLearningObjectiveId(
    questions,
    filterByLOId
  );

  const toggleEdit = (questionId: string) => {
    setQuestions(questions.map(q =>
      q._id === questionId ? { ...q, isEditing: !q.isEditing } : q
    ));
  };

  const handleDeleteQuestion = async (questionId: string) => {
    try {
      await dispatch(deleteQuestion({ quizId, questionId })).unwrap();
      const updatedQuestions = questions.filter(q => q._id !== questionId);
      setQuestions(updatedQuestions);
      setCoverageMap(null);
      if (evidenceQuestionId === questionId) setEvidenceQuestionId(null);
      showNotification('success', 'Question Deleted', 'Question has been removed');
      publish(PUBSUB_EVENTS.QUESTIONS_CHANGED, {
        quizId, reason: 'deleted', questionCount: updatedQuestions.length, timestamp: Date.now()
      });
    } catch (error) {
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
      if (!question) return;
      const updates: Partial<Question> = {
        questionText: question.questionText,
        type: question.type,
        difficulty: question.difficulty,
        content: question.content,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation
      };
      const result = await dispatch(updateQuestionThunk({ quizId, questionId, updates })).unwrap();
      setQuestions(questions.map(q =>
        q._id === questionId ? { ...result.question, isEditing: false } : q
      ));
      setCoverageMap(null);
      showNotification('success', 'Question Saved', 'Question has been updated');
    } catch (error) {
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
    if (!questionToRegenerate) return;
    setRegenerateLoading(true);
    try {
      const result = await questionsApi.regenerateQuestion(questionToRegenerate._id, customPrompt);
      setQuestions(questions.map(q =>
        q._id === questionToRegenerate._id ? { ...result.question, isEditing: false } : q
      ));
      setCoverageMap(null);
      showNotification('success', 'Question Regenerated', 'Question has been regenerated using AI');
      setRegenerateModalOpen(false);
      setQuestionToRegenerate(null);
    } catch (error) {
      console.error('Failed to regenerate question:', error);
      showNotification('error', 'Regeneration Failed', 'Failed to regenerate question');
    } finally {
      setRegenerateLoading(false);
    }
  };

  const handleGenerateAIQuestion = async (loIndex: number, prompt: string, questionType: string) => {
    const initialQuestionCount = questions.length;
    const existingQuestionIds = new Set(questions.map(question => question._id));
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

    const response = await fetch('/api/create/streaming/generate-questions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({
        quizId,
        sessionId: `review-add-${Date.now()}`,
        questionConfigs: [questionConfig]
      })
    });

    if (!response.ok) {
      throw new Error('Failed to start AI question generation');
    }

    const maxAttempts = 20;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      const result = await dispatch(fetchQuestions(quizId)).unwrap();
      if (result.questions.length > initialQuestionCount) {
        const generatedQuestion = result.questions.find(question => !existingQuestionIds.has(question._id));
        publish(PUBSUB_EVENTS.QUESTIONS_CHANGED, {
          quizId,
          reason: 'added',
          questionCount: result.questions.length,
          timestamp: Date.now()
        });
        showNotification('success', 'Question Added', 'AI generated a new question successfully');
        if (generatedQuestion) {
          window.setTimeout(() => {
            document.getElementById(`question-${generatedQuestion._id}`)?.scrollIntoView({
              behavior: 'smooth',
              block: 'center'
            });
          }, 250);
        }
        return;
      }
    }

    throw new Error('AI generation started, but the new question did not appear in time');
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
      <div className="review-edit">
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
    <div className="review-edit">
      <div className="card">
        <div className="card-header">
          <div className="review-header">
            <div>
              <h3 className="card-title">Review & Edit Questions</h3>
              <p className="card-description">
                Review generated questions and make final adjustments ({questions.length} questions loaded)
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

              <button
                className={`btn ${viewMode === 'preview' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setViewMode(viewMode === 'edit' ? 'preview' : 'edit')}
                aria-pressed={viewMode === 'preview'}
              >
                {viewMode === 'edit' ? <Eye size={16} /> : <Edit size={16} />}
                {viewMode === 'edit' ? 'Preview' : 'Back to edit'}
              </button>
              {deliveryTarget === 'h5p-package' && questions.length > 0 && (
                <button className="btn btn-outline" onClick={handleOpenH5PStudio} disabled={h5pStudioLoading}>
                  {h5pStudioLoading ? <span className="spinner-mini" /> : <Boxes size={16} />}
                  {h5pStudioLoading ? 'Preparing…' : 'Advanced H5P Editor'}
                </button>
              )}
              {viewMode === 'edit' && (
                <button className="btn btn-outline" onClick={() => setShowManualAdd(true)}>
                  <Plus size={16} /> Add Question
                </button>
              )}
            </div>
          </div>
        </div>

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
            {filteredQuestions.length} questions {filterByLOId !== null ? 'in this objective' : 'total'}
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
                key={`h5p-preview-${quizId}-${filterByLOId ?? 'all'}-${containerMode}`}
                src={`/api/create/h5p-preview/quiz/${quizId}/render?containerMode=${containerMode}${filterByLOId !== null ? `&lo=${filterByLOId}` : ''}`}
                style={{
                  width: '100%',
                  height: `${Math.max(800, filteredQuestions.length * 350)}px`,
                  border: 'none',
                  borderRadius: '8px',
                  background: '#f9fafb'
                }}
                title="H5P Learning Object Preview"
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
                onToggleEdit={toggleEdit}
                onSave={saveQuestion}
                onDelete={handleDeleteQuestion}
                onRegenerate={openRegenerateModal}
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

        {filteredQuestions.length > 0 && (
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
                <h4>Export Learning Object</h4>
                <p>Export your completed learning object for use in other platforms</p>
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
