import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { ArrowLeft, FileText, Target, Wand2, Settings, Trash2 } from 'lucide-react';
import LearningObjectives from './LearningObjectives';
import MaterialAssignment from './MaterialAssignment';
import QuestionGeneration from './generation';
import ReviewEdit from './review';
import { RootState, AppDispatch } from '../store';
import { fetchQuizById, setCurrentQuiz, assignMaterials } from '../store/slices/quizSlice';
import { fetchMaterials } from '../store/slices/materialSlice';
import { clearObjectives } from '../store/slices/learningObjectiveSlice';
import { usePubSub } from '../hooks/usePubSub';
import { LearningObjectiveData } from './generation/generationTypes';
import '../styles/components/QuizView.css';

type TabType = 'materials' | 'objectives' | 'generation' | 'review';

const QuizView = () => {
  const { courseId, quizId } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const [searchParams] = useSearchParams();
  const { showNotification, publish } = usePubSub('QuizView');

  const { currentQuiz, loading, error } = useSelector((state: RootState) => state.quiz);
  const { materials } = useSelector((state: RootState) => state.material);

  // Check URL params for initial tab
  const getInitialTab = (): TabType => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'objectives' || tabParam === 'generation' || tabParam === 'review') {
      return tabParam as TabType;
    }
    return 'materials';
  };

  const [activeTab, setActiveTab] = useState<TabType>(getInitialTab());
  const [learningObjectives, setLearningObjectives] = useState<LearningObjectiveData[]>([]);
  const [assignedMaterials, setAssignedMaterials] = useState<string[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Update active tab when URL params change
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'objectives' || tabParam === 'generation' || tabParam === 'review') {
      setActiveTab(tabParam as TabType);
    }
  }, [searchParams]);

  useEffect(() => {
    if (quizId) {
      dispatch(fetchQuizById(quizId));
    }
    if (courseId) {
      dispatch(fetchMaterials(courseId));
    }
    return () => {
      dispatch(setCurrentQuiz(null));
      dispatch(clearObjectives());
    };
  }, [quizId, courseId, dispatch]);

  useEffect(() => {
    if (currentQuiz) {
      // Set assigned materials from backend
      const materialIds = currentQuiz.materials.map((m: string | { _id: string }) =>
        typeof m === 'string' ? m : m._id
      );
      setAssignedMaterials(materialIds);

      // Set learning objectives if they exist - NEW: Keep full objects
      if (currentQuiz.learningObjectives) {
        const objectiveData: LearningObjectiveData[] = currentQuiz.learningObjectives.map((obj: string | { _id: string; text: string; order: number }, idx: number) => {
          if (typeof obj === 'string') {
            // Fallback for string-only objectives (shouldn't happen but handle it)
            return { _id: obj, text: obj, order: idx };
          }
          return {
            _id: obj._id,
            text: obj.text,
            order: obj.order !== undefined ? obj.order : idx
          };
        });
        setLearningObjectives(objectiveData);
      }
    }
  }, [currentQuiz]);

  if (loading) {
    return (
      <div className="quiz-loading">
        <div>Loading quiz...</div>
      </div>
    );
  }

  if (error || !currentQuiz) {
    return (
        <div className="quiz-not-found">
          <h2>{error || 'Quiz not found'}</h2>
          <button className="btn btn-primary" onClick={() => navigate('/')}>
            Go to Dashboard
          </button>
        </div>
    );
  }

  const handleDeleteQuiz = async () => {
    if (!quizId || !courseId) return;

    setIsDeleting(true);
    try {
      // Import quizApi
      const { quizApi } = await import('../services/api');
      await quizApi.deleteQuiz(quizId);

      showNotification('Quiz deleted successfully', 'success');
      setShowDeleteConfirm(false);

      // Notify CourseView to refresh its data
      publish('quiz-deleted', { quizId, courseId });

      // Navigate back to course page
      navigate(`/course/${courseId}`);
    } catch (err: unknown) {
      console.error('Failed to delete quiz:', err);
      showNotification(err instanceof Error ? err.message : 'Failed to delete quiz', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const tabs = [
    { id: 'materials' as TabType, label: 'Materials', icon: FileText },
    { id: 'objectives' as TabType, label: 'Learning Objectives', icon: Target },
    { id: 'generation' as TabType, label: 'Generate Questions', icon: Wand2 },
    { id: 'review' as TabType, label: 'Review & Edit', icon: Settings },
  ];

  const canProceed = (tab: TabType) => {
    switch (tab) {
      case 'objectives':
        return assignedMaterials.length > 0;
      case 'generation':
        return assignedMaterials.length > 0 && learningObjectives.length > 0;
      case 'review':
        return assignedMaterials.length > 0 && learningObjectives.length > 0;
      default:
        return true;
    }
  };

  return (
      <div className="quiz-view">
        <div className="quiz-header">
          <div className="quiz-header-nav">
            <button className="btn btn-ghost" onClick={() => navigate(`/course/${courseId}`)}>
              <ArrowLeft size={16} />
              Back to Course
            </button>
            <button
              className="btn btn-danger btn-outline"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isDeleting}
            >
              <Trash2 size={16} />
              {isDeleting ? 'Deleting...' : 'Delete Quiz'}
            </button>
          </div>
          <h1>{currentQuiz.name}</h1>
          <p className="quiz-description">
            {currentQuiz.folder?.name || 'Course'} • {currentQuiz.questions?.length || 0} questions
          </p>
        </div>

        <div className="quiz-tabs">
          {tabs.map((tab) => (
              <button
                  key={tab.id}
                  className={`quiz-tab ${activeTab === tab.id ? 'active' : ''} ${!canProceed(tab.id) ? 'disabled' : ''}`}
                  onClick={() => canProceed(tab.id) && setActiveTab(tab.id)}
                  disabled={!canProceed(tab.id)}
              >
                <tab.icon size={20} />
                <span>{tab.label}</span>
                {!canProceed(tab.id) && <span className="tab-lock">🔒</span>}
              </button>
          ))}
        </div>

        <div className="quiz-content">
          {/* Keep all components mounted, use CSS to show/hide */}
          <div style={{ display: activeTab === 'materials' ? 'block' : 'none' }}>
            <MaterialAssignment
                courseId={courseId!}
                assignedMaterials={assignedMaterials}
                onAssignedMaterialsChange={(materialIds) => {
                  setAssignedMaterials(materialIds);
                  // Update backend whenever materials change (assign or unassign)
                  if (currentQuiz) {
                    dispatch(assignMaterials({ id: currentQuiz._id, materialIds }));
                  }
                }}
                courseMaterials={materials}
                onNavigateNext={() => {
                  setActiveTab('objectives');
                  setTimeout(() => {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }, 100);
                }}
            />
          </div>

          <div style={{ display: activeTab === 'objectives' ? 'block' : 'none' }}>
            <LearningObjectives
                assignedMaterials={assignedMaterials}
                objectives={learningObjectives}
                onObjectivesChange={setLearningObjectives}
                quizId={quizId!}
                onNavigateNext={() => {
                  setActiveTab('generation');
                  setTimeout(() => {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }, 100);
                }}
            />
          </div>

          <div style={{ display: activeTab === 'generation' ? 'block' : 'none' }}>
            <QuestionGeneration
                learningObjectives={learningObjectives}
                assignedMaterials={assignedMaterials}
                quizId={quizId!}
                onQuestionsGenerated={() => setActiveTab('review')}
            />
          </div>

          <div style={{ display: activeTab === 'review' ? 'block' : 'none' }}>
            <ReviewEdit
                quizId={quizId!}
                learningObjectives={learningObjectives}
            />
          </div>
        </div>

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h2>Delete Quiz?</h2>
              <p>
                Are you sure you want to delete <strong>{currentQuiz.name}</strong>?
                This will permanently delete all questions and learning objectives associated with this quiz.
              </p>
              <div className="modal-actions">
                <button
                  className="btn btn-ghost"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isDeleting}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-danger"
                  onClick={handleDeleteQuiz}
                  disabled={isDeleting}
                >
                  {isDeleting ? 'Deleting...' : 'Delete Quiz'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
  );
};

export default QuizView;