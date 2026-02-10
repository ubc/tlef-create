import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { Edit, Plus, Play, Download } from 'lucide-react';
import { questionsApi, Question, exportApi } from '../../services/api';
import { usePubSub } from '../../hooks/usePubSub';
import { PUBSUB_EVENTS } from '../../services/pubsubService';
import { RootState, AppDispatch } from '../../store';
import { fetchQuestions, deleteQuestion, updateQuestion as updateQuestionThunk } from '../../store/slices/questionSlice';
import { selectQuestionsByQuiz } from '../../store/selectors';
import RegeneratePromptModal from '../RegeneratePromptModal';
import PdfExportModal from '../PdfExportModal';
import InteractiveQuestionView from './InteractiveQuestionView';
import ManualQuestionForm from './ManualQuestionForm';
import QuestionCard from './QuestionCard';
import { useQuestionEditHandlers } from './useQuestionEditHandlers';
import { ReviewEditProps, ExtendedQuestion } from './reviewTypes';
import '../../styles/components/ReviewEdit.css';
import '../../styles/components/InteractiveQuestions.css';

const ReviewEdit = ({ quizId, learningObjectives }: ReviewEditProps) => {
  const [searchParams] = useSearchParams();
  const dispatch = useDispatch<AppDispatch>();
  const reduxQuestions = useSelector((state: RootState) => selectQuestionsByQuiz(state, quizId));
  const [questions, setQuestions] = useState<ExtendedQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportLoading, setExportLoading] = useState(false);
  const [pdfExportModalOpen, setPdfExportModalOpen] = useState(false);
  const [regenerateModalOpen, setRegenerateModalOpen] = useState(false);
  const [regenerateLoading, setRegenerateLoading] = useState(false);
  const [questionToRegenerate, setQuestionToRegenerate] = useState<ExtendedQuestion | null>(null);
  const { showNotification, subscribe, unsubscribe, publish } = usePubSub('ReviewEdit');

  const [viewMode, setViewMode] = useState<'edit' | 'interact'>('edit');
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [filterByLO, setFilterByLO] = useState<number | null>(null);

  const [expandedBulletPoints, setExpandedBulletPoints] = useState<{[questionId: string]: {[bulletIndex: number]: boolean}}>({});

  const toggleBulletPoint = (questionId: string, bulletIndex: number) => {
    setExpandedBulletPoints(prev => ({
      ...prev,
      [questionId]: {
        ...prev[questionId],
        [bulletIndex]: !prev[questionId]?.[bulletIndex]
      }
    }));
  };

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

  const filteredQuestions = filterByLO !== null
    ? questions.filter(q => {
        const loText = typeof q.learningObjective === 'string' ? q.learningObjective : q.learningObjective?.text;
        const targetLO = learningObjectives[filterByLO]?.text;
        return loText === targetLO;
      })
    : questions;

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
      showNotification('success', 'Question Deleted', 'Question has been removed');
      publish(PUBSUB_EVENTS.QUESTIONS_DELETED, {
        quizId, deletedQuestionId: questionId, remainingCount: updatedQuestions.length, timestamp: Date.now()
      });
    } catch (error) {
      console.error('Failed to delete question:', error);
      showNotification('error', 'Delete Failed', 'Failed to delete question');
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

  const handleH5PExport = async () => {
    if (questions.length === 0) {
      showNotification('warning', 'No Questions', 'Add some questions before exporting to H5P');
      return;
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
              <button
                className={`btn ${viewMode === 'interact' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setViewMode(viewMode === 'edit' ? 'interact' : 'edit')}
              >
                {viewMode === 'edit' ? <Play size={16} /> : <Edit size={16} />}
                {viewMode === 'edit' ? 'Interact' : 'Edit'}
              </button>
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
              value={filterByLO ?? ''}
              onChange={(e) => setFilterByLO(e.target.value ? parseInt(e.target.value) : null)}
            >
              <option value="">All Objectives</option>
              {learningObjectives.map((obj, index) => {
                const text = obj?.text || 'Unknown';
                return (
                  <option key={index} value={index}>
                    LO {index + 1}: {text.substring(0, 50)}{text.length > 50 ? '...' : ''}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="questions-count">
            {filteredQuestions.length} questions {filterByLO !== null ? 'in this objective' : 'total'}
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
          ) : viewMode === 'interact' ? (
            <div className="questions-interactive">
              {filteredQuestions.map((question, index) => (
                <div key={question._id}>
                  <InteractiveQuestionView
                    question={question}
                    index={index}
                    expandedBulletPoints={expandedBulletPoints}
                    toggleBulletPoint={toggleBulletPoint}
                    learningObjectives={learningObjectives}
                  />
                </div>
              ))}
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
              />
            ))
          )}
        </div>

        {filteredQuestions.length > 0 && (
          <div className="export-section">
            <div className="export-header">
              <h4>Export Quiz</h4>
              <p>Export your completed quiz for use in other platforms</p>
            </div>
            <div className="export-actions">
              <button className="btn btn-primary" onClick={handleH5PExport} disabled={exportLoading}>
                <Download size={16} /> {exportLoading ? 'Exporting...' : 'Export to H5P'}
              </button>
              <button className="btn btn-outline" onClick={() => setPdfExportModalOpen(true)} disabled={exportLoading}>
                <Download size={16} /> {exportLoading ? 'Exporting...' : 'Export to PDF'}
              </button>
            </div>
          </div>
        )}

        <ManualQuestionForm
          isOpen={showManualAdd}
          onClose={() => setShowManualAdd(false)}
          quizId={quizId}
          learningObjectives={learningObjectives}
          onQuestionAdded={(q) => setQuestions([...questions, q])}
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

      <PdfExportModal
        isOpen={pdfExportModalOpen}
        onClose={() => setPdfExportModalOpen(false)}
        onExport={handlePDFExport}
        isLoading={exportLoading}
      />
    </div>
  );
};

export default ReviewEdit;
