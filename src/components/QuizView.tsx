import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { ArrowLeft, Trash2, Pencil, Map, ArrowRight } from 'lucide-react';
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
import { normalizeLearningObjectiveData } from '../utils/learningObjectiveState';
import WorkflowStepper, { WorkflowStep } from './workflow/WorkflowStepper';
import '../styles/components/QuizView.css';

type WorkflowTab = 'materials' | 'objectives' | 'generation' | 'review' | 'preview';
type TabType = WorkflowTab | 'coverage';

const QuizView = () => {
  const { courseId, quizId } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { showNotification, publish } = usePubSub('QuizView');

  const { currentQuiz, loading, error } = useSelector((state: RootState) => state.quiz);
  const { materials } = useSelector((state: RootState) => state.material);
  const { objectives: reduxObjectives } = useSelector((state: RootState) => state.learningObjective);
  const questionCountFromStore = useSelector((state: RootState) =>
    quizId ? state.question?.questionsByQuiz?.[quizId]?.length : undefined
  );

  // Check URL params for initial tab
  const getInitialTab = (): TabType => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'objectives' || tabParam === 'coverage' || tabParam === 'generation' || tabParam === 'review' || tabParam === 'preview') {
      return tabParam as TabType;
    }
    return 'materials';
  };

  const [activeTab, setActiveTab] = useState<TabType>(getInitialTab());
  const [lastWorkflowTab, setLastWorkflowTab] = useState<WorkflowTab>(() => {
    const initialTab = getInitialTab();
    return initialTab === 'coverage' ? 'materials' : initialTab;
  });
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

  const requestedTab = getInitialTab();
  // Include Materials and the default URL so browser Back restores step 1 too.
  useEffect(() => {
    setActiveTab(requestedTab);
    if (requestedTab !== 'coverage') setLastWorkflowTab(requestedTab);
  }, [requestedTab]);

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
      setLearningObjectives(normalizeLearningObjectiveData(reduxObjectives));
      return;
    }

    if (currentQuiz) {
      // Raw ObjectIds can appear briefly after an unpopulated quiz update.
      // Never turn them into empty objectives because Review would show
      // those entries as "Unknown"; the objectives request will provide the
      // complete records.
      const quizObjectives = (currentQuiz.learningObjectives || []) as Array<string | LearningObjectiveData>;
      const populatedObjectives = quizObjectives
        .filter((objective): objective is LearningObjectiveData => typeof objective !== 'string');
      setLearningObjectives(normalizeLearningObjectiveData(populatedObjectives));
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

  const questionCount = questionCountFromStore ?? currentQuiz.questions?.length ?? 0;
  const questionCountLabel = `${questionCount} question${questionCount === 1 ? '' : 's'}`;
  const readyAssignedCount = assignedMaterials.filter(id => materials.some(material => material._id === id && material.processingStatus === 'completed')).length;
  const failedAssignedCount = assignedMaterials.filter(id => materials.some(material => material._id === id && material.processingStatus === 'failed')).length;
  const materialsReady = assignedMaterials.length > 0 && readyAssignedCount === assignedMaterials.length;

  const canProceed = (tab: TabType) => {
    switch (tab) {
      case 'objectives':
        return assignedMaterials.length > 0 || learningObjectives.length > 0;
      case 'generation':
        return assignedMaterials.length > 0 && learningObjectives.length > 0;
      case 'coverage':
        return assignedMaterials.length > 0 && learningObjectives.length > 0;
      case 'review':
        return questionCount > 0 || (assignedMaterials.length > 0 && learningObjectives.length > 0);
      case 'preview':
        return questionCount > 0;
      default:
        return true;
    }
  };

  const handleTabChange = (tab: TabType) => {
    if (!canProceed(tab)) return;
    if (tab === 'coverage') {
      coverageScrollPositionRef.current = window.scrollY;
    } else {
      setLastWorkflowTab(tab);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    setActiveTab(tab);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', tab);
    if (tab !== 'review') nextParams.delete('questionId');
    setSearchParams(nextParams);
  };

  const workflowSteps: WorkflowStep[] = [
    {
      id: 'materials',
      label: 'Sources',
      detail: materialsReady ? `Ready · ${readyAssignedCount} assigned` : failedAssignedCount > 0 ? `${failedAssignedCount} failed · check sources` : assignedMaterials.length > 0 ? 'Checking or processing sources' : 'Start here · assign sources',
      state: materialsReady ? 'complete' : failedAssignedCount > 0 ? 'attention' : 'available'
    },
    {
      id: 'objectives',
      label: 'Objectives',
      detail: learningObjectives.length > 0 ? `Ready · ${learningObjectives.length} LOs` : 'Create measurable outcomes',
      state: learningObjectives.length > 0 ? 'complete' : assignedMaterials.length > 0 ? 'available' : 'blocked',
      disabled: !canProceed('objectives')
    },
    {
      id: 'generation',
      label: 'Generate',
      detail: questionCount > 0
        ? `Complete · ${questionCountLabel}`
        : currentQuiz.progress?.planGenerated
          ? 'Question plan ready'
          : 'Choose format and question mix',
      state: questionCount > 0 ? 'complete' : canProceed('generation') ? 'available' : 'blocked',
      disabled: !canProceed('generation')
    },
    {
      id: 'review',
      label: 'Review',
      detail: questionCount > 0
        ? currentQuiz.progress?.reviewCompleted ? `Reviewed · ${questionCountLabel}` : `${questionCountLabel} to check`
        : 'Waiting for questions',
      state: questionCount > 0 && currentQuiz.progress?.reviewCompleted
        ? 'complete'
        : questionCount > 0
          ? 'attention'
          : canProceed('review') ? 'available' : 'blocked',
      disabled: !canProceed('review')
    },
    {
      id: 'preview',
      label: 'Preview',
      detail: questionCount > 0 ? 'Preview and choose delivery' : 'Waiting for questions',
      state: questionCount > 0 ? 'available' : 'blocked',
      disabled: !canProceed('preview')
    }
  ];

  const activeWorkflowStep = activeTab === 'coverage' ? lastWorkflowTab : activeTab;
  const activeStepNumber = workflowSteps.findIndex(step => step.id === activeWorkflowStep) + 1;
  const activeStepCopy = activeTab === 'coverage'
    ? {
        eyebrow: 'Quality tool',
        title: 'Coverage Map',
        description: 'Inspect how materials, evidence, objectives, and questions connect without losing your place in the main workflow.'
      }
    : {
        eyebrow: `${currentQuiz.name} · Stage ${activeStepNumber} of 5`,
        title: {
          materials: 'Choose source materials',
          objectives: 'Define learning objectives',
          generation: 'Plan and generate questions',
          review: 'Review and edit questions',
          preview: 'Preview and export'
        }[activeWorkflowStep],
        description: {
          materials: 'Choose the course sources that should ground this Quiz. You can return to completed stages at any time.',
          objectives: 'Generate, import, or write measurable outcomes. You can return to completed stages at any time.',
          generation: 'Choose the teaching purpose, activity format, and question mix, then start generation.',
          review: 'Check accuracy, feedback, evidence, and ordering before learners see the content.',
          preview: 'Experience the final activity, then choose an export or delivery option.'
        }[activeWorkflowStep]
      };

  const coverageRefreshKey = learningObjectives
    .map(objective => `${objective._id}:${objective.text}`)
    .join('|');
  const assignedMaterialReadiness = assignedMaterials.map(materialId => {
    const material = materials.find(candidate => candidate._id === materialId);
    return {
      id: materialId,
      name: material?.name || 'Assigned material',
      processingStatus: material?.processingStatus || 'processing' as const,
      processingError: material?.processingError?.message
    };
  });

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
            {(typeof currentQuiz.folder === 'object' ? currentQuiz.folder?.name : undefined) || 'Course'} • {questionCountLabel}
          </p>
        </div>

        <WorkflowStepper
          steps={workflowSteps}
          activeStepId={activeWorkflowStep}
          ariaLabel="Quiz creation steps"
          onStepSelect={(stepId) => handleTabChange(stepId as WorkflowTab)}
          compact
        />

        <div className={`quiz-workflow-context ${activeTab === 'coverage' ? 'is-coverage' : ''}`}>
          <div>
            <span>{activeStepCopy.eyebrow}</span>
            <strong>{activeStepCopy.title}</strong>
            <p>{activeStepCopy.description}</p>
          </div>
          {activeTab === 'coverage' ? (
            <button className="btn btn-outline" onClick={() => handleTabChange(lastWorkflowTab)}>
              Return to {workflowSteps.find(step => step.id === lastWorkflowTab)?.label}
              <ArrowRight size={16} />
            </button>
          ) : (
            <button
              className={`btn ${activeTab === 'coverage' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => handleTabChange('coverage')}
              disabled={!canProceed('coverage')}
              title={canProceed('coverage') ? 'Open Coverage Map' : 'Create learning objectives before opening Coverage Map'}
            >
              <Map size={16} />
              Coverage Map
            </button>
          )}
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
                  handleTabChange('objectives');
                  setTimeout(() => {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }, 100);
                }}
            />
          </div>

          <div style={{ display: activeTab === 'objectives' ? 'block' : 'none' }}>
            <LearningObjectives
                assignedMaterials={assignedMaterials}
                materialReadiness={assignedMaterialReadiness}
                objectives={learningObjectives}
                onObjectivesChange={setLearningObjectives}
                quizId={quizId!}
                courseId={courseId}
                onNavigateNext={() => {
                  handleTabChange('generation');
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
              isActive={activeTab === 'coverage'}
              canBuild={learningObjectives.length > 0}
              onNavigateToGeneration={() => handleTabChange('generation')}
            />
          </div>

          <div style={{ display: activeTab === 'generation' ? 'block' : 'none' }}>
            <QuestionGeneration
                isActive={activeTab === 'generation'}
                learningObjectives={learningObjectives}
                assignedMaterials={assignedMaterials}
                quizId={quizId!}
                courseId={courseId}
                onQuestionsGenerated={() => {
                  handleTabChange('review');
                  window.setTimeout(() => {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }, 100);
                }}
            />
          </div>

          <div style={{ display: activeTab === 'review' || activeTab === 'preview' ? 'block' : 'none' }}>
            <ReviewEdit
                quizId={quizId!}
                learningObjectives={learningObjectives}
                workflowMode={activeTab === 'preview' ? 'preview-export' : 'review'}
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
