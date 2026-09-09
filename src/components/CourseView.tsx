import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import MaterialUpload from './MaterialUpload';
import CoursePromptSettings from './CoursePromptSettings';
import { ArrowLeft, ArrowRight, Plus, Settings, Trash2 } from 'lucide-react';
import { foldersApi, materialsApi, Material, Quiz, ApiError } from '../services/api';
import { usePubSub } from '../hooks/usePubSub';
import { useAppDispatch } from '../hooks/redux';
import { createQuiz } from '../store/slices/quizSlice';
import { useSystemDialog } from './system-dialog/SystemDialogProvider';
import WorkflowStepper, { WorkflowStep } from './workflow/WorkflowStepper';
import '../styles/components/CourseView.css';

interface QuizData {
  id: string;
  name: string;
  questionCount: number;
  status?: Quiz['status'];
  progress?: Quiz['progress'];
  updatedAt?: string;
}

interface CourseData {
  id: string;
  name: string;
  quizzes: QuizData[];
}

const CourseView = () => {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { showNotification, publish, subscribe } = usePubSub('CourseView');
  const { showAlert } = useSystemDialog();

  const [course, setCourse] = useState<CourseData | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCreatingQuiz, setIsCreatingQuiz] = useState(false);
  const [selectedCourseStep, setSelectedCourseStep] = useState<string | null>(null);

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const hasNotifiedRef = useRef(false);
  const materialsSectionRef = useRef<HTMLDivElement | null>(null);
  const quizzesSectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (courseId) {
      // Reset loading state when switching courses
      setLoading(true);
      setError(null);
      loadCourseData();
    }
  }, [courseId]);

  // Listen for quiz deletion events
  useEffect(() => {
    const handleQuizDeleted = (data: { quizId: string; courseId: string }) => {
      // Refresh course data to get updated quiz list
      if (data.courseId === courseId) {
        loadCourseData();
      }
    };

    subscribe('quiz-deleted', handleQuizDeleted);
  }, [courseId, subscribe]);

  // Listen for quiz creation events
  useEffect(() => {
    const handleQuizCreated = (data: { quizId: string; courseId: string; quizName: string; quiz?: Quiz }) => {
      if (data.courseId === courseId) {
        setCourse(prev => {
          if (!prev || prev.quizzes.some(quiz => quiz.id === data.quizId)) {
            return prev;
          }

          return {
            ...prev,
            quizzes: [
              ...prev.quizzes,
              {
                id: data.quizId,
                name: data.quizName,
                questionCount: data.quiz?.questions?.length || 0,
                status: data.quiz?.status,
                progress: data.quiz?.progress,
                updatedAt: data.quiz?.updatedAt
              }
            ]
          };
        });
      }
    };

    subscribe('quiz-created', handleQuizCreated);
  }, [courseId, subscribe]);

  // Listen for materials-updated events (e.g., from background uploads in Sidebar)
  useEffect(() => {
    const handleMaterialsUpdated = (data: { courseId: string }) => {
      if (data.courseId === courseId && courseId) {
        materialsApi.getMaterials(courseId).then(response => {
          setMaterials(response.materials);
        }).catch(err => {
          console.error('Failed to refresh materials:', err);
        });
      }
    };

    subscribe('materials-updated', handleMaterialsUpdated);
  }, [courseId, subscribe]);

  // Poll for material processing status
  useEffect(() => {
    const hasProcessingMaterials = materials.some(m =>
      m.processingStatus === 'pending' || m.processingStatus === 'processing'
    );

    if (hasProcessingMaterials && courseId) {
      // Start polling every 2 seconds
      pollingIntervalRef.current = setInterval(async () => {
        try {
          const materialsResponse = await materialsApi.getMaterials(courseId);
          setMaterials(materialsResponse.materials);

          // Check if all materials are now completed
          const allCompleted = materialsResponse.materials.every(m =>
            m.processingStatus === 'completed' || m.processingStatus === 'failed'
          );

          if (allCompleted && !hasNotifiedRef.current) {
            hasNotifiedRef.current = true;
            const failedCount = materialsResponse.materials.filter(m => m.processingStatus === 'failed').length;
            const completedCount = materialsResponse.materials.filter(m => m.processingStatus === 'completed').length;

            if (failedCount > 0) {
              showNotification(`Processing complete! ${completedCount} material(s) ready, ${failedCount} failed.`, 'warning');
            } else {
              showNotification(`All materials processed successfully! ${completedCount} material(s) ready.`, 'success');
            }

            // Stop polling
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }
          }
        } catch (err) {
          console.error('Failed to poll material status:', err);
        }
      }, 2000);
    } else {
      // No processing materials, stop polling
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    }

    // Cleanup on unmount
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [materials, courseId, showNotification]);

  const loadCourseData = async () => {
    if (!courseId) return;

    try {
      setError(null);

      // Load folder details
      const folderResponse = await foldersApi.getFolder(courseId);

      // Load materials for this folder
      const materialsResponse = await materialsApi.getMaterials(courseId);
      setMaterials(materialsResponse.materials);

      // Transform backend data to match your UI structure
      const course: CourseData = {
        id: folderResponse.folder._id,
        name: folderResponse.folder.name,
        quizzes: folderResponse.folder.quizzes?.map((quiz: string | {
          _id: string;
          name?: string;
          questions?: string[];
          status?: Quiz['status'];
          progress?: Quiz['progress'];
          updatedAt?: string;
        }) => ({
          id: typeof quiz === 'string' ? quiz : quiz._id,
          name: typeof quiz === 'string' ? `Quiz 1` : (quiz.name || `Quiz ${quiz.name?.split(' ')[1] || '1'}`),
          questionCount: typeof quiz === 'string' ? 0 : (quiz.questions?.length || 0),
          status: typeof quiz === 'string' ? undefined : quiz.status,
          progress: typeof quiz === 'string' ? undefined : quiz.progress,
          updatedAt: typeof quiz === 'string' ? undefined : quiz.updatedAt
        })) || []
      };

      setCourse(course);

    } catch (err) {
      console.error('Failed to load course data:', err);
      if (err instanceof ApiError) {
        if (err.isNotFoundError()) {
          setError('Course not found');
        } else if (err.isAuthError()) {
          setError('Please log in again to continue');
        } else {
          setError(err.message);
        }
      } else {
        setError('Failed to load course data. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="course-loading">
        <div className="loading-spinner"></div>
        <div>Loading course...</div>
      </div>
    );
  }

  if (error || !course) {
    return (
      <div className="course-not-found">
        <h2>{error || 'Course not found'}</h2>
        <button className="btn btn-primary" onClick={() => navigate('/')}>
          Go to Dashboard
        </button>
      </div>
    );
  }

  const handleAddMaterial = async (
    materialData: { name: string; type: 'pdf' | 'docx' | 'url' | 'text'; content?: string; file?: File },
    onProgress?: (progress: number) => void
  ) => {
    if (!course) return;

    try {
      let response;

      if (materialData.type === 'url' && materialData.content) {
        response = await materialsApi.addUrl(course.id, materialData.content, materialData.name);
        setMaterials(prev => [...prev, response.material]);
      } else if (materialData.type === 'text' && materialData.content) {
        response = await materialsApi.addText(course.id, materialData.content, materialData.name);
        setMaterials(prev => [...prev, response.material]);
      } else if (materialData.file) {
        const fileList = new DataTransfer();
        fileList.items.add(materialData.file);

        // Upload with progress tracking
        response = await materialsApi.uploadFiles(
          course.id,
          fileList.files,
          (progress) => {
            if (onProgress) {
              onProgress(progress);
            }
          }
        );

        setMaterials(prev => [...prev, ...response.materials]);
      }


    } catch (err) {
      console.error('Failed to add material:', err);

      if (err instanceof ApiError) {
        if (err.isAuthError()) {
          await showAlert({
            title: 'Session expired',
            description: 'Your session has expired. Sign in again to continue.',
            confirmLabel: 'Go to sign in',
            tone: 'warning'
          });
          // Redirect to login page
          window.location.href = '/login';
        } else {
          await showAlert({
            title: 'Material upload failed',
            description: `${err.message}\n\nStatus: ${err.status}\nCode: ${err.code || 'Unknown'}`,
            tone: 'danger'
          });
        }
      } else {
        await showAlert({
          title: 'Material upload failed',
          description: 'CREATE could not add this material. Please try again.',
          tone: 'danger'
        });
      }
    }
  };

  const handleDeleteMaterial = async (materialId: string) => {
    try {
      // Find the material by the frontend ID (which is _id from backend)
      const materialToDelete = materials.find(m => m._id === materialId);
      if (materialToDelete) {
        await materialsApi.deleteMaterial(materialToDelete._id);
        setMaterials(prev => prev.filter(m => m._id !== materialId));
      }
    } catch (err) {
      console.error('Failed to delete material:', err);
      await showAlert({
        title: 'Material deletion failed',
        description: err instanceof ApiError
          ? `CREATE could not delete this material: ${err.message}`
          : 'CREATE could not delete this material. Please try again.',
        tone: 'danger'
      });
    }
  };

  const refreshMaterials = async () => {
    if (!courseId) return;
    const response = await materialsApi.getMaterials(courseId);
    setMaterials(response.materials);
  };

  const handleQuizClick = (quizId: string, tab?: string) => {
    navigate(`/course/${courseId}/quiz/${quizId}${tab ? `?tab=${tab}` : ''}`);
  };

  const handleCreateQuiz = async () => {
    if (!course || !courseId || isCreatingQuiz) return;

    setIsCreatingQuiz(true);

    try {
      const existingNumbers = course.quizzes
        .map((quiz) => {
          const match = quiz.name.match(/^Quiz (\d+)$/);
          return match ? parseInt(match[1], 10) : 0;
        })
        .filter((number) => number > 0);

      let quizNumber = 1;
      while (existingNumbers.includes(quizNumber)) {
        quizNumber++;
      }

      const quizName = `Quiz ${quizNumber}`;
      const createdQuiz = await dispatch(createQuiz({ name: quizName, folderId: courseId })).unwrap();

      setCourse(prev => prev
        ? {
            ...prev,
            quizzes: [
              ...prev.quizzes,
              {
                id: createdQuiz._id,
                name: createdQuiz.name,
                questionCount: createdQuiz.questions?.length || 0,
                status: createdQuiz.status,
                progress: createdQuiz.progress,
                updatedAt: createdQuiz.updatedAt
              }
            ]
          }
        : prev
      );

      publish('quiz-created', {
        quizId: createdQuiz._id,
        courseId,
        quizName: createdQuiz.name,
        quiz: createdQuiz
      });

      navigate(`/course/${courseId}/quiz/${createdQuiz._id}`);
    } catch (err) {
      console.error('Failed to create quiz:', err);
      await showAlert({
        title: 'Quiz creation failed',
        description: err instanceof ApiError
          ? `CREATE could not create the quiz: ${err.message}`
          : 'CREATE could not create the quiz. Please try again.',
        tone: 'danger'
      });
    } finally {
      setIsCreatingQuiz(false);
    }
  };

  const handleDeleteCourse = async () => {
    if (!course || !courseId) return;

    setIsDeleting(true);

    try {
      // Call the API to delete the course (this will cascade delete everything)
      await foldersApi.deleteFolder(courseId);

      // Notify Dashboard to remove course from sidebar
      publish('course-deleted', { courseId });

      // Navigate back to dashboard
      navigate('/');

    } catch (err) {
      console.error('Failed to delete course:', err);
      setIsDeleting(false);
      setShowDeleteConfirm(false);

      if (err instanceof ApiError) {
        if (err.isAuthError()) {
          await showAlert({
            title: 'Session expired',
            description: 'Your session has expired. Sign in again to continue.',
            confirmLabel: 'Go to sign in',
            tone: 'warning'
          });
          window.location.href = '/login';
        } else {
          await showAlert({
            title: 'Course deletion failed',
            description: `CREATE could not delete this course: ${err.message}`,
            tone: 'danger'
          });
        }
      } else {
        await showAlert({
          title: 'Course deletion failed',
          description: 'CREATE could not delete this course. Please try again.',
          tone: 'danger'
        });
      }
    }
  };

  const completedMaterialCount = materials.filter(material => material.processingStatus === 'completed').length;
  const processingMaterialCount = materials.filter(material =>
    material.processingStatus === 'pending' || material.processingStatus === 'processing'
  ).length;
  const failedMaterialCount = materials.filter(material => material.processingStatus === 'failed').length;

  const getQuizStage = (quiz: QuizData) => {
    if (completedMaterialCount === 0) {
      return {
        step: 1,
        tab: 'materials',
        label: failedMaterialCount > 0 ? 'Retry course material' : 'Assign ready materials',
        detail: failedMaterialCount > 0
          ? 'Retry the failed course source before continuing this quiz.'
          : 'Add and process course content before continuing this quiz.'
      };
    }
    if (!quiz.progress?.materialsAssigned) {
      return { step: 1, tab: 'materials', label: 'Assign materials', detail: 'Choose the sources for this quiz.' };
    }
    if (!quiz.progress?.objectivesSet) {
      return { step: 2, tab: 'objectives', label: 'Create learning objectives', detail: 'Define the outcomes this quiz should address.' };
    }
    if (!quiz.progress?.questionsGenerated && quiz.questionCount === 0) {
      return {
        step: 3,
        tab: 'generation',
        label: quiz.progress?.planGenerated ? 'Generate planned questions' : 'Build the AI Blueprint',
        detail: quiz.progress?.planGenerated
          ? 'The Blueprint is ready. Review it and start generation.'
          : 'Choose the activity mix before generating questions.'
      };
    }
    if (!quiz.progress?.reviewCompleted) {
      return { step: 4, tab: 'review', label: 'Review generated questions', detail: `Check ${quiz.questionCount} question${quiz.questionCount === 1 ? '' : 's'} before delivery.` };
    }
    return { step: 5, tab: 'preview', label: 'Preview and export', detail: 'Experience the final activity and choose a delivery format.' };
  };

  const recommendedQuiz = course.quizzes
    .map(quiz => ({ quiz, stage: getQuizStage(quiz) }))
    .sort((a, b) => a.stage.step - b.stage.step)[0];

  const courseWorkflowSteps: WorkflowStep[] = [
    {
      id: 'details',
      label: 'Course details',
      detail: 'Complete',
      state: 'complete'
    },
    {
      id: 'materials',
      label: 'Course materials',
      detail: completedMaterialCount > 0
        ? `Ready · ${completedMaterialCount} source${completedMaterialCount === 1 ? '' : 's'}`
        : processingMaterialCount > 0
          ? `Processing · ${processingMaterialCount}`
          : failedMaterialCount > 0 ? 'Needs attention' : 'Add source content',
      state: completedMaterialCount > 0 ? 'complete' : failedMaterialCount > 0 ? 'attention' : 'available'
    },
    {
      id: 'quizzes',
      label: 'Quizzes',
      detail: course.quizzes.length > 0
        ? `In progress · ${course.quizzes.length} quiz${course.quizzes.length === 1 ? '' : 'zes'}`
        : 'Create the first quiz',
      state: course.quizzes.length > 0 ? 'available' : completedMaterialCount > 0 ? 'available' : 'blocked'
    }
  ];

  const recommendedCourseStep = completedMaterialCount > 0 ? 'quizzes' : 'materials';
  const activeCourseStep = selectedCourseStep || recommendedCourseStep;

  const scrollToMaterials = () => {
    setSelectedCourseStep('materials');
    materialsSectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  const scrollToQuizzes = () => {
    setSelectedCourseStep('quizzes');
    quizzesSectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  const courseNextAction = activeCourseStep === 'details'
    ? {
        eyebrow: 'Step 1 · Complete',
        title: `${course.name} is ready`,
        detail: 'Your course workspace has been created. Next, add source content for grounded AI generation.',
        label: 'Continue to Materials',
        action: scrollToMaterials
      }
    : activeCourseStep === 'materials'
      ? failedMaterialCount > 0
        ? {
            eyebrow: 'Step 2 · Action required',
            title: 'Retry a failed course material',
            detail: `${failedMaterialCount} source${failedMaterialCount === 1 ? '' : 's'} could not be processed. Retry below or upload a replacement.`,
            label: 'Review Failed Material',
            action: scrollToMaterials
          }
        : processingMaterialCount > 0
          ? {
              eyebrow: 'Step 2 · Processing',
              title: 'Course materials are processing',
              detail: `${processingMaterialCount} source${processingMaterialCount === 1 ? ' is' : 's are'} being prepared for AI generation.`,
              label: 'View Processing',
              action: scrollToMaterials
            }
          : completedMaterialCount > 0
            ? {
                eyebrow: 'Step 2 · Complete',
                title: `${completedMaterialCount} course source${completedMaterialCount === 1 ? ' is' : 's are'} ready`,
                detail: 'Your materials can now ground learning objectives and generated questions.',
                label: 'Continue to Quizzes',
                action: scrollToQuizzes
              }
            : {
                eyebrow: 'Step 2 · Start here',
                title: 'Add your first course material',
                detail: 'Add a PDF, DOCX, URL, or pasted text to ground AI generation.',
                label: 'Add Course Material',
                action: scrollToMaterials
              }
      : completedMaterialCount === 0
        ? {
            eyebrow: 'Step 3 · Blocked',
            title: 'Prepare course materials first',
            detail: 'At least one successfully processed source is needed before a quiz can use grounded AI generation.',
            label: 'Go to Materials',
            action: scrollToMaterials
          }
        : !recommendedQuiz
          ? {
              eyebrow: 'Step 3 · Ready',
              title: 'Create your first Quiz',
              detail: 'Turn your prepared materials into learning objectives, questions, and an exportable activity.',
              label: 'Create Quiz',
              action: handleCreateQuiz
            }
          : {
              eyebrow: `Step 3 · Quiz step ${recommendedQuiz.stage.step} of 5`,
              title: `${recommendedQuiz.stage.label} in ${recommendedQuiz.quiz.name}`,
              detail: recommendedQuiz.stage.detail,
              label: 'Continue Quiz',
              action: () => handleQuizClick(recommendedQuiz.quiz.id, recommendedQuiz.stage.tab)
            };

  const handleCourseStepSelect = (stepId: string) => {
    setSelectedCourseStep(stepId);
    if (stepId === 'details') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (stepId === 'materials') {
      materialsSectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    } else {
      quizzesSectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="course-view">
      <div className="course-header">
        <div className="course-header-nav">
          <button className="btn btn-ghost" onClick={() => navigate('/')}>
            <ArrowLeft size={16} />
            Back to Dashboard
          </button>
          <button 
            className="btn btn-danger btn-outline" 
            onClick={() => setShowDeleteConfirm(true)}
            disabled={isDeleting}
          >
            <Trash2 size={16} />
            {isDeleting ? 'Deleting...' : 'Delete Course'}
          </button>
        </div>
        <h1>{course.name}</h1>
        <p className="course-description">
          Prepare shared course materials, then build evidence-grounded quizzes.
        </p>
      </div>

      <div className="course-content">
        <section className="course-setup-workspace" aria-labelledby="course-setup-heading">
          <header className="course-setup-heading">
            <span>Guided course setup</span>
            <div>
              <h2 id="course-setup-heading">Prepare this course, one step at a time</h2>
              <p>Select a step to see its current status and the most useful next action.</p>
            </div>
          </header>

          <WorkflowStepper
            steps={courseWorkflowSteps}
            activeStepId={activeCourseStep}
            ariaLabel="Course setup steps"
            onStepSelect={handleCourseStepSelect}
          />

          <section className="course-next-action" aria-labelledby="course-next-action-title">
            <div>
              <span>{courseNextAction.eyebrow}</span>
              <h2 id="course-next-action-title">{courseNextAction.title}</h2>
              <p>{courseNextAction.detail}</p>
            </div>
            <button type="button" className="btn btn-primary" onClick={courseNextAction.action}>
              {courseNextAction.label}
              <ArrowRight size={16} />
            </button>
          </section>

          <div
            className={`course-workspace-section ${activeCourseStep === 'materials' ? 'is-active' : ''}`}
            ref={materialsSectionRef}
          >
            <div className="course-workspace-section-heading">
              <div>
                <span>Step 2</span>
                <h3>Course Materials</h3>
                <p>Add source content once, then reuse it across every quiz in this course.</p>
              </div>
              <span className={`course-section-status ${failedMaterialCount > 0 ? 'needs-attention' : completedMaterialCount > 0 ? 'is-complete' : ''}`}>
                {failedMaterialCount > 0
                  ? 'Needs attention'
                  : processingMaterialCount > 0
                    ? `${processingMaterialCount} processing`
                    : completedMaterialCount > 0
                      ? `${completedMaterialCount} ready`
                      : 'Not started'}
              </span>
            </div>
            <MaterialUpload
              materials={materials.map(m => ({
                id: m._id,
                name: m.name,
                type: m.type,
                uploadDate: new Date(m.createdAt).toLocaleDateString(),
                content: m.content || m.url,
                processingStatus: m.processingStatus,
                processingError: m.processingError?.message,
                parserVersion: m.processingMetadata?.parserVersion
              }))}
              onAddMaterial={handleAddMaterial}
              onRemoveMaterial={handleDeleteMaterial}
              onMaterialReprocessed={refreshMaterials}
              embedded
            />
          </div>

          <div
            className={`course-workspace-section ${activeCourseStep === 'quizzes' ? 'is-active' : ''}`}
            ref={quizzesSectionRef}
          >
            <div className="course-workspace-section-heading quiz-section-header">
              <div>
                <span>Step 3</span>
                <h3>Quizzes ({course.quizzes.length})</h3>
                <p>Continue from the suggested step or open any quiz directly.</p>
              </div>
              {course.quizzes.length > 0 && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleCreateQuiz}
                  disabled={isCreatingQuiz}
                >
                  <Plus size={16} />
                  {isCreatingQuiz ? 'Creating Quiz...' : 'Add Quiz'}
                </button>
              )}
            </div>

            {course.quizzes.length === 0 ? (
              <div className="empty-learning-objects">
                <button
                  type="button"
                  className="empty-learning-object-button"
                  onClick={handleCreateQuiz}
                  disabled={isCreatingQuiz}
                >
                  <span className="empty-learning-object-icon">
                    <Plus size={28} />
                  </span>
                  <span className="empty-learning-object-title">
                    {isCreatingQuiz ? 'Creating Quiz...' : 'Create Your First Quiz'}
                  </span>
                  <span className="empty-learning-object-description">
                    Assign prepared materials, define learning objectives, and generate questions in one guided workflow.
                  </span>
                </button>
              </div>
            ) : (
              <div className="quiz-grid">
                {course.quizzes.map((quiz) => {
                  const stage = getQuizStage(quiz);
                  return (
                    <button
                      type="button"
                      key={quiz.id}
                      className="quiz-card"
                      onClick={() => handleQuizClick(quiz.id, stage.tab)}
                    >
                      <div className="quiz-card-heading">
                        <div className="quiz-info">
                          <h4>{quiz.name}</h4>
                          <p>{quiz.questionCount} question{quiz.questionCount === 1 ? '' : 's'}</p>
                        </div>
                        <span className={`status-badge ${stage.step >= 5 ? 'status-complete' : 'status-empty'}`}>
                          Step {stage.step} of 5
                        </span>
                      </div>
                      <div className="learning-object-progress" aria-label={`${stage.step - 1} of 5 steps complete`}>
                        {[1, 2, 3, 4, 5].map(step => (
                          <span key={step} className={step < stage.step ? 'is-complete' : step === stage.step ? 'is-current' : ''} />
                        ))}
                      </div>
                      <div className="quiz-next-step">
                        <span>Next</span>
                        <strong>{stage.label}</strong>
                        <ArrowRight size={15} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <details className="course-advanced-settings course-workspace-advanced">
            <summary>
              <span><Settings size={18} /> Course prompts and advanced settings</span>
              <small>Optional</small>
            </summary>
            <div className="course-advanced-settings-content">
              <CoursePromptSettings courseId={course.id} />
            </div>
          </details>
        </section>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Delete Course</h3>
            </div>
            <div className="modal-body">
              <p><strong>Are you sure you want to delete "{course.name}"?</strong></p>
              <p>This will permanently delete:</p>
              <ul>
                <li>All {materials.length} materials and their processed chunks</li>
                <li>All {course.quizzes.length} quizzes and their questions</li>
                <li>All vector database embeddings for this course</li>
              </ul>
              <p className="warning-text">⚠️ This action cannot be undone!</p>
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-danger"
                onClick={handleDeleteCourse}
                disabled={isDeleting}
              >
                <Trash2 size={16} />
                {isDeleting ? 'Deleting...' : 'Yes, Delete Course'}
              </button>
              <button
                className="btn btn-outline"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CourseView;
