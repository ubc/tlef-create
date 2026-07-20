import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { ArrowLeft, FileText, Target, Wand2, Settings, Trash2, Pencil, Map } from 'lucide-react';
import LearningObjectives from './LearningObjectives';
import MaterialAssignment from './MaterialAssignment';
import CoverageMapPanel from './CoverageMapPanel';
import QuestionGeneration from './generation';
import ReviewEdit from './review';
import { RootState, AppDispatch } from '../store';
import { fetchQuizById, setCurrentQuiz, assignMaterials, updateQuiz } from '../store/slices/quizSlice';
import { fetchMaterials } from '../store/slices/materialSlice';
import { clearObjectives } from '../store/slices/learningObjectiveSlice';
import { usePubSub } from '../hooks/usePubSub';
import { LearningObjectiveData } from './generation/generationTypes';
import '../styles/components/QuizView.css';

type TabType = 'materials' | 'objectives' | 'coverage' | 'generation' | 'review';

const QuizView = () => {
  const { courseId, quizId } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const [searchParams] = useSearchParams();
  const { showNotification, publish } = usePubSub('QuizView');

  const { currentQuiz, loading, error } = useSelector((state: RootState) => state.quiz);
  const { materials } = useSelector((state: RootState) => state.material);
  const { objectives: reduxObjectives } = useSelector((state: RootState) => state.learningObjective);

  // Check URL params for initial tab
  const getInitialTab = (): TabType => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'objectives' || tabParam === 'coverage' || tabParam === 'generation' || tabParam === 'review') {
      return tabParam as TabType;
    }
    return 'materials';
  };

  const [activeTab, setActiveTab] = useState<TabType>(getInitialTab());
  const [learningObjectives, setLearningObjectives] = useState<LearningObjectiveData[]>([]);
  const [assignedMaterials, setAssignedMaterials] = useState<string[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const coverageScrollPositionRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (activeTab !== 'coverage' || coverageScrollPositionRef.current === null) return;

    window.scrollTo({
      top: coverageScrollPositionRef.current,
      behavior: 'auto'
    });
    coverageScrollPositionRef.current = null;
  }, [activeTab]);

  // Update active tab when URL params change
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'objectives' || tabParam === 'coverage' || tabParam === 'generation' || tabParam === 'review') {
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
      const materialIds = currentQuiz.materials.map((material: string | { _id: string }) =>
        typeof material === 'string' ? material : material._id
      );
      setAssignedMaterials(materialIds);
    }

    if (reduxObjectives.length > 0) {
      const objectiveData: LearningObjectiveData[] = reduxObjectives.map((obj, idx) => ({
        _id: obj._id,
        text: obj.text,
        order: obj.order !== undefined ? obj.order : idx,
        generationMetadata: obj.generationMetadata
      }));
      setLearningObjectives(objectiveData);
      return;
    }

    if (currentQuiz) {
      // Set learning objectives if they exist - NEW: Keep full objects
      if (currentQuiz.learningObjectives) {
        const objectiveData: LearningObjectiveData[] = currentQuiz.learningObjectives.map((obj: string | { _id: string; text: string; order: number; generationMetadata?: LearningObjectiveData['generationMetadata'] }, idx: number) => {
          if (typeof obj === 'string') {
            // Keep the id but avoid showing raw ObjectIds as LO text while the full LO payload is loading.
            return { _id: obj, text: '', order: idx };
          }
          return {
            _id: obj._id,
            text: obj.text,
            order: obj.order !== undefined ? obj.order : idx,
            generationMetadata: obj.generationMetadata
          };
        });
        setLearningObjectives(objectiveData);
      }
    }
  }, [currentQuiz, reduxObjectives]);

  if (loading) {
    return (
      <div className="quiz-loading">
        <div>Loading learning object...</div>
      </div>
    );
  }

  if (error || !currentQuiz) {
    return (
        <div className="quiz-not-found">
          <h2>{error || 'Learning object not found'}</h2>
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

      showNotification('Learning object deleted successfully', 'success');
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

  const handleSaveName = async () => {
    const trimmed = editedName.trim();
    if (!trimmed || trimmed === currentQuiz?.name) {
      setIsEditingName(false);
      return;
    }
    try {
      await dispatch(updateQuiz({ id: quizId!, updates: { name: trimmed } })).unwrap();
      publish('quiz-renamed', { quizId, name: trimmed });
    } catch (err) {
      showNotification('Failed to rename learning object', 'error');
    }
    setIsEditingName(false);
  };

  const tabs = [
    { id: 'materials' as TabType, label: 'Materials', icon: FileText },
    { id: 'objectives' as TabType, label: 'Learning Objectives', icon: Target },
    { id: 'generation' as TabType, label: 'Generate Questions', icon: Wand2 },
    { id: 'review' as TabType, label: 'Review & Edit', icon: Settings },
    { id: 'coverage' as TabType, label: 'Coverage Map', icon: Map },
  ];

  const canProceed = (tab: TabType) => {
    switch (tab) {
      case 'objectives':
        return assignedMaterials.length > 0;
      case 'generation':
        return assignedMaterials.length > 0 && learningObjectives.length > 0;
      case 'coverage':
        return assignedMaterials.length > 0 && learningObjectives.length > 0;
      case 'review':
        return assignedMaterials.length > 0 && learningObjectives.length > 0;
      default:
        return true;
    }
  };

  const handleTabChange = (tab: TabType) => {
    if (!canProceed(tab)) return;
    if (tab === 'coverage') {
      coverageScrollPositionRef.current = window.scrollY;
    }
    setActiveTab(tab);
  };

  const coverageRefreshKey = learningObjectives
    .map(objective => `${objective._id}:${objective.text}`)
    .join('|');

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
              {isDeleting ? 'Deleting...' : `Delete ${currentQuiz.name}`}
            </button>
          </div>
          <div className="quiz-title-row">
            {isEditingName ? (
              <input
                className="quiz-title-input"
                value={editedName}
                onChange={e => setEditedName(e.target.value)}
                onBlur={handleSaveName}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSaveName();
                  if (e.key === 'Escape') { setIsEditingName(false); setEditedName(currentQuiz.name); }
                }}
                autoFocus
              />
            ) : (
              <>
                <h1>{currentQuiz.name}</h1>
                <button
                  className="btn btn-ghost quiz-edit-name-btn"
                  onClick={() => { setIsEditingName(true); setEditedName(currentQuiz.name); }}
                  title="Rename"
                >
                  <Pencil size={15} />
                </button>
              </>
            )}
          </div>
          <p className="quiz-description">
            {currentQuiz.folder?.name || 'Course'} • {currentQuiz.questions?.length || 0} questions
          </p>
        </div>

        <div className="quiz-tabs">
          {tabs.map((tab) => (
              <button
                  key={tab.id}
                  className={`quiz-tab ${activeTab === tab.id ? 'active' : ''} ${!canProceed(tab.id) ? 'disabled' : ''}`}
                  onClick={() => handleTabChange(tab.id)}
                  disabled={!canProceed(tab.id)}
                  aria-label={tab.label}
                  title={canProceed(tab.id) ? tab.label : `${tab.label} is not available yet`}
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
                courseId={courseId}
                onNavigateNext={() => {
                  setActiveTab('generation');
                  setTimeout(() => {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }, 100);
                }}
            />
          </div>

          <div style={{ display: activeTab === 'coverage' ? 'block' : 'none' }}>
            <CoverageMapPanel
              quizId={quizId!}
              refreshKey={coverageRefreshKey}
              onNavigateToGeneration={() => setActiveTab('generation')}
            />
          </div>

          <div style={{ display: activeTab === 'generation' ? 'block' : 'none' }}>
            <QuestionGeneration
                learningObjectives={learningObjectives}
                assignedMaterials={assignedMaterials}
                quizId={quizId!}
                courseId={courseId}
                onQuestionsGenerated={() => {
                  setActiveTab('review');
                  window.setTimeout(() => {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }, 100);
                }}
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
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ padding: '24px' }}>
              <h2 style={{ marginTop: 0 }}>Delete Learning Object?</h2>
              <p>
                Are you sure you want to delete <strong>{currentQuiz.name}</strong>?
                This will permanently delete all questions and learning objectives associated with this learning object.
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
                  {isDeleting ? 'Deleting...' : `Delete ${currentQuiz.name}`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
  );
};

export default QuizView;
