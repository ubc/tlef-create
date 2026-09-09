import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, BookOpen, CheckCircle, Clock, FileText, Plus, RefreshCw } from 'lucide-react';
import { useAppSelector } from '../hooks/redux';
import { ApiError, Folder, FolderMaterialSummary, FolderQuizSummary, foldersApi } from '../services/api';
import { usePubSub } from '../hooks/usePubSub';
import { PUBSUB_EVENTS } from '../services/pubsubService';
import '../styles/components/Dashboard.css';

interface DashboardAction {
  key: string;
  courseId: string;
  courseName: string;
  quizId?: string;
  quizName?: string;
  step: number;
  title: string;
  detail: string;
  buttonLabel: string;
  path: string;
}

const getMaterialSummaries = (folder: Folder): FolderMaterialSummary[] =>
  (folder.materials || []).filter(
    (material): material is FolderMaterialSummary => typeof material !== 'string'
  );

const getQuizSummaries = (folder: Folder): FolderQuizSummary[] =>
  (folder.quizzes || []).filter(
    (quiz): quiz is FolderQuizSummary => typeof quiz !== 'string'
  );

const getReadyMaterialCount = (folder: Folder) => {
  const summaries = getMaterialSummaries(folder);
  return summaries.filter(material => material.processingStatus === 'completed').length;
};

const getFailedMaterialCount = (folder: Folder) =>
  getMaterialSummaries(folder).filter(material => material.processingStatus === 'failed').length;

const getQuestionCount = (quiz: FolderQuizSummary) => quiz.questions?.length || 0;
const getCourseQuestionCount = (folder: Folder) => {
  const quizzes = getQuizSummaries(folder);
  return quizzes.length === (folder.quizzes?.length ?? 0)
    ? quizzes.reduce((total, quiz) => total + getQuestionCount(quiz), 0)
    : folder.stats?.totalQuestions || 0;
};
const getCourseTimestamp = (folder: Folder) => new Date(Math.max(
  ...[folder.updatedAt, folder.stats?.lastActivity, ...getQuizSummaries(folder).map(quiz => quiz.updatedAt || quiz.createdAt)]
    .map(value => new Date(value || 0).getTime()).filter(Number.isFinite), 0
)).toISOString();

const getQuizAction = (folder: Folder, quiz: FolderQuizSummary): DashboardAction => {
  const basePath = `/course/${folder._id}/quiz/${quiz._id}`;
  const readyMaterialCount = getReadyMaterialCount(folder);
  const failedMaterialCount = getFailedMaterialCount(folder);
  const questionCount = getQuestionCount(quiz);
  const quizName = quiz.name || 'Untitled Quiz';

  // Existing content is still reviewable even if a material later fails or an
  // older progress flag was not updated. Never send that instructor backwards.
  if (questionCount > 0) {
    const reviewed = Boolean(quiz.progress?.reviewCompleted);
    return {
      key: quiz._id, courseId: folder._id, courseName: folder.name, quizId: quiz._id, quizName,
      step: reviewed ? 5 : 4,
      title: reviewed ? 'Preview and export your Quiz' : 'Review generated questions',
      detail: reviewed ? `${questionCount} reviewed questions can now be previewed or exported.` : `${questionCount} question${questionCount === 1 ? ' is' : 's are'} ready for review and editing.`,
      buttonLabel: reviewed ? 'Preview & Export' : 'Continue Review', path: `${basePath}?tab=${reviewed ? 'preview' : 'review'}`
    };
  }

  const processingCount = getMaterialSummaries(folder).filter(material => ['pending', 'processing'].includes(material.processingStatus)).length;
  if (readyMaterialCount === 0 && processingCount > 0) {
    return {
      key: `${folder._id}:materials`, courseId: folder._id, courseName: folder.name, step: 1,
      title: 'Course materials are processing', detail: `${processingCount} source${processingCount === 1 ? ' is' : 's are'} being prepared. You do not need to upload them again.`,
      buttonLabel: 'View Progress', path: `/course/${folder._id}`
    };
  }

  if (readyMaterialCount === 0) {
    return {
      key: `${folder._id}:materials`, courseId: folder._id, courseName: folder.name,
      quizId: quiz._id, quizName, step: 1,
      title: failedMaterialCount > 0 ? 'Retry a failed course material' : 'Add course materials',
      detail: failedMaterialCount > 0
        ? `${failedMaterialCount} course source${failedMaterialCount === 1 ? '' : 's'} could not be processed.`
        : 'Add a PDF, DOCX, URL, or pasted text before using grounded AI generation.',
      buttonLabel: failedMaterialCount > 0 ? 'Review Materials' : 'Add Course Material',
      path: `/course/${folder._id}`
    };
  }

  if (!quiz.progress?.materialsAssigned) {
    return {
      key: quiz._id, courseId: folder._id, courseName: folder.name, quizId: quiz._id, quizName, step: 1,
      title: 'Assign materials to this Quiz',
      detail: 'Choose which ready course sources should ground this Quiz.',
      buttonLabel: 'Assign Materials', path: `${basePath}?tab=materials`
    };
  }

  if (!quiz.progress?.objectivesSet) {
    return {
      key: quiz._id, courseId: folder._id, courseName: folder.name, quizId: quiz._id, quizName, step: 2,
      title: 'Create learning objectives',
      detail: 'Define the outcomes the generated questions should address.',
      buttonLabel: 'Add Learning Objectives', path: `${basePath}?tab=objectives`
    };
  }

  if (!quiz.progress?.questionsGenerated || questionCount === 0) {
    return {
      key: quiz._id, courseId: folder._id, courseName: folder.name, quizId: quiz._id, quizName, step: 3,
      title: quiz.progress?.planGenerated ? 'Generate planned questions' : 'Build the AI Blueprint',
      detail: quiz.progress?.planGenerated
        ? 'Your Blueprint is ready to review before generation.'
        : 'Choose the question mix and delivery format for this Quiz.',
      buttonLabel: quiz.progress?.planGenerated ? 'Generate Questions' : 'Build Blueprint',
      path: `${basePath}?tab=generation`
    };
  }

  if (!quiz.progress?.reviewCompleted) {
    return {
      key: quiz._id, courseId: folder._id, courseName: folder.name, quizId: quiz._id, quizName, step: 4,
      title: 'Review generated questions',
      detail: `${questionCount} question${questionCount === 1 ? ' is' : 's are'} ready for review and editing.`,
      buttonLabel: 'Continue Review', path: `${basePath}?tab=review`
    };
  }

  return {
    key: quiz._id, courseId: folder._id, courseName: folder.name, quizId: quiz._id, quizName, step: 5,
    title: 'Preview and export your Quiz',
    detail: `${questionCount} reviewed question${questionCount === 1 ? '' : 's'} can now be previewed or exported.`,
    buttonLabel: 'Preview & Export', path: `${basePath}?tab=preview`
  };
};

const getCourseAction = (folder: Folder): DashboardAction => {
  const quizzes = getQuizSummaries(folder);
  if (quizzes.length === 0) {
    return {
      key: `${folder._id}:quiz`, courseId: folder._id, courseName: folder.name, step: 1,
      title: 'Create your first Quiz',
      detail: 'Turn prepared course materials into an editable, exportable Quiz.',
      buttonLabel: 'Open Course', path: `/course/${folder._id}`
    };
  }

  const sortedQuizzes = [...quizzes].sort((a, b) =>
    new Date(b.updatedAt || b.createdAt || 0).getTime()
      - new Date(a.updatedAt || a.createdAt || 0).getTime()
  );
  return getQuizAction(folder, sortedQuizzes[0]);
};

const formatTimeSaved = (minutes: number) => {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`;
};

const formatLastActivity = (value?: string) => {
  if (!value) return 'No recent activity';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No recent activity';
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const valueStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDifference = Math.round((todayStart - valueStart) / 86_400_000);
  if (dayDifference === 0) return 'Updated today';
  if (dayDifference === 1) return 'Updated yesterday';
  return `Updated ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
};

const Dashboard = () => {
  const navigate = useNavigate();
  const user = useAppSelector(state => state.app.user);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { subscribe, publish } = usePubSub('Dashboard');

  const loadFolders = useCallback(async () => {
    try {
      setError(null);
      const response = await foldersApi.getFolders();
      setFolders(response.folders || []);
    } catch (err) {
      console.error('Failed to load folders:', err);
      if (err instanceof ApiError) {
        setError(err.isAuthError() ? 'Please log in again to continue' : err.message);
      } else {
        setError('Failed to load courses. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadFolders(); }, [loadFolders]);

  useEffect(() => {
    subscribe<{ courseId: string }>('course-deleted', data => {
      if (data?.courseId) setFolders(previous => previous.filter(folder => folder._id !== data.courseId));
    });
    subscribe('course-created', loadFolders);
    subscribe('materials-updated', loadFolders);
    subscribe('quiz-deleted', loadFolders);
    subscribe('quiz-renamed', loadFolders);
    subscribe(PUBSUB_EVENTS.QUESTION_GENERATION_COMPLETED, loadFolders);
    subscribe(PUBSUB_EVENTS.QUESTIONS_CHANGED, loadFolders);
  }, [loadFolders, subscribe]);

  useEffect(() => {
    const pending = folders.some(folder => getMaterialSummaries(folder).some(material => ['pending', 'processing'].includes(material.processingStatus)));
    if (!pending) return;
    const timer = window.setInterval(() => { void loadFolders(); }, 10000);
    return () => window.clearInterval(timer);
  }, [folders, loadFolders]);

  const dashboardData = useMemo(() => {
    const totalQuizzes = folders.reduce(
      (total, folder) => total + (folder.quizzes?.length ?? folder.stats?.totalQuizzes ?? 0), 0
    );
    const totalQuestions = folders.reduce((total, folder) => total + getCourseQuestionCount(folder), 0);
    const sortedFolders = [...folders].sort((a, b) =>
      new Date(getCourseTimestamp(b)).getTime() - new Date(getCourseTimestamp(a)).getTime()
    );
    const courseActions = sortedFolders.map(getCourseAction);
    const primaryAction = courseActions[0] || null;
    const attentionActions: DashboardAction[] = [];

    sortedFolders.forEach(folder => {
      const failedMaterialCount = getFailedMaterialCount(folder);
      const readyMaterialCount = getReadyMaterialCount(folder);
      const primaryAlreadyCoversMaterials = primaryAction?.courseId === folder._id
        && primaryAction.step === 1
        && readyMaterialCount === 0;
      if (failedMaterialCount > 0 && !primaryAlreadyCoversMaterials) {
        attentionActions.push({
          key: `${folder._id}:failed-material`, courseId: folder._id, courseName: folder.name, step: 1,
          title: `${folder.name} has a failed material`,
          detail: `${failedMaterialCount} source${failedMaterialCount === 1 ? '' : 's'} need to be retried or replaced.`,
          buttonLabel: 'Review Materials', path: `/course/${folder._id}`
        });
      } else if (readyMaterialCount === 0 && !primaryAlreadyCoversMaterials) {
        attentionActions.push({
          key: `${folder._id}:no-material`, courseId: folder._id, courseName: folder.name, step: 1,
          title: `${folder.name} needs course materials`,
          detail: 'Add a source before using grounded AI generation.',
          buttonLabel: 'Add Course Material', path: `/course/${folder._id}`
        });
      }

      getQuizSummaries(folder).forEach(quiz => {
        const action = getQuizAction(folder, quiz);
        if (action.step < 5 && action.key !== primaryAction?.key) attentionActions.push(action);
      });
    });

    const uniqueAttentionActions = attentionActions.filter(
      (action, index, all) => all.findIndex(candidate => candidate.key === action.key) === index
    ).slice(0, 3);

    return { totalQuizzes, totalQuestions, totalMinutes: totalQuestions * 5, sortedFolders, primaryAction, attentionActions: uniqueAttentionActions };
  }, [folders]);

  const firstName = user?.displayName?.trim().split(/\s+/)[0];

  if (loading) {
    return <div className="dashboard-loading" role="status"><span className="loading-spinner" aria-hidden="true" />Preparing your workspace…</div>;
  }

  if (error) {
    return (
      <div className="dashboard-error card" role="alert">
        <h2>Dashboard unavailable</h2><p>{error}</p>
        <button type="button" className="dashboard-primary-button" onClick={loadFolders}><RefreshCw size={16} /> Retry</button>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-welcome">
        <div>
          <span className="dashboard-eyebrow">Instructor workspace</span>
          <h1>{firstName ? `Welcome back, ${firstName}` : 'Your CREATE workspace'}</h1>
          <p>Continue a Quiz, resolve unfinished work, or open any course.</p>
        </div>
      </header>

      <section className="dashboard-grid" aria-label="CREATE statistics">
        <div className="stat-card"><BookOpen size={24} aria-hidden="true" /><div className="stat-number">{folders.length}</div><div className="stat-label">Active Courses</div></div>
        <div className="stat-card"><FileText size={24} aria-hidden="true" /><div className="stat-number">{dashboardData.totalQuizzes}</div><div className="stat-label">Total Quizzes</div></div>
        <div className="stat-card"><CheckCircle size={24} aria-hidden="true" /><div className="stat-number">{dashboardData.totalQuestions}</div><div className="stat-label">Questions Generated</div></div>
        <div className="stat-card"><Clock size={24} aria-hidden="true" /><div className="stat-number">~{formatTimeSaved(dashboardData.totalMinutes)}</div><div className="stat-label">Estimated Time Saved</div></div>
      </section>

      {folders.length === 0 ? (
        <section className="dashboard-empty-state">
          <span className="dashboard-eyebrow">Getting started</span><h2>Create your first course</h2>
          <p>Add course materials once, then use them to create grounded learning objectives, questions, and exportable Quizzes.</p>
          <button type="button" className="dashboard-primary-button" onClick={() => publish('open-create-course', {})}><Plus size={17} /> Create Your First Course</button>
          <ol className="dashboard-empty-steps">
            <li><span>1</span><strong>Add course materials</strong><small>Upload files, URLs, or pasted text.</small></li>
            <li><span>2</span><strong>Create a Quiz</strong><small>Define objectives and generate questions.</small></li>
            <li><span>3</span><strong>Review and export</strong><small>Check the result and choose a delivery format.</small></li>
          </ol>
        </section>
      ) : (
        <div className="dashboard-work-grid">
          <main className="dashboard-main-column">
            <section className="dashboard-panel dashboard-continue-panel">
              <div className="dashboard-panel-heading"><h2>Continue where you left off</h2><p>CREATE recommends one clear next action from your most recently active course.</p></div>
              {dashboardData.primaryAction && (
                <div className="dashboard-resume-card">
                  <div className="dashboard-resume-header">
                    <div>
                      <span className="dashboard-course-context">{dashboardData.primaryAction.courseName}{dashboardData.primaryAction.quizName ? ` · ${dashboardData.primaryAction.quizName}` : ''}</span>
                      <h3>{dashboardData.primaryAction.title}</h3><p>{dashboardData.primaryAction.detail}</p>
                    </div>
                    <span className="dashboard-step-badge">Step {dashboardData.primaryAction.step} of 5</span>
                  </div>
                  <div className="dashboard-progress" aria-label={`Step ${dashboardData.primaryAction.step} of 5`}>
                    {[1, 2, 3, 4, 5].map(step => <span key={step} className={step < dashboardData.primaryAction!.step ? 'is-complete' : step === dashboardData.primaryAction!.step ? 'is-current' : ''} />)}
                  </div>
                  <div className="dashboard-resume-action">
                    <div><strong>Your next step</strong><small>You can revisit any earlier step from the Quiz workspace.</small></div>
                    <button type="button" className="dashboard-primary-button" onClick={() => navigate(dashboardData.primaryAction!.path)}>{dashboardData.primaryAction.buttonLabel} <ArrowRight size={16} /></button>
                  </div>
                </div>
              )}
            </section>

            <section className="dashboard-panel dashboard-courses-panel">
              <div className="dashboard-panel-heading"><h2>Your courses</h2><p>Open a course or follow its current recommended action.</p></div>
              <div className="dashboard-course-list">
                {dashboardData.sortedFolders.map(folder => {
                  const action = getCourseAction(folder);
                  const quizCount = folder.quizzes?.length ?? folder.stats?.totalQuizzes ?? 0;
                  const questionCount = getCourseQuestionCount(folder);
                  const readyMaterials = getReadyMaterialCount(folder);
                  return (
                    <article className="dashboard-course-row" key={folder._id}>
                      <button type="button" className="dashboard-course-name" onClick={() => navigate(`/course/${folder._id}`)}><strong>{folder.name}</strong><small>{formatLastActivity(getCourseTimestamp(folder))} · {readyMaterials} material{readyMaterials === 1 ? '' : 's'} ready</small></button>
                      <div className="dashboard-course-counts">{quizCount} {quizCount === 1 ? 'Quiz' : 'Quizzes'} · {questionCount} question{questionCount === 1 ? '' : 's'}</div>
                      <button type="button" className="dashboard-text-button" onClick={() => navigate(action.path)}>{action.step === 5 ? 'Open' : 'Continue'} <ArrowRight size={15} /></button>
                    </article>
                  );
                })}
              </div>
            </section>
          </main>

          <aside className="dashboard-panel dashboard-attention-panel">
            <div className="dashboard-panel-heading"><h2>Needs attention</h2><p>Unfinished or blocked work that may need you next.</p></div>
            {dashboardData.attentionActions.length > 0 ? (
              <div className="dashboard-attention-list">
                {dashboardData.attentionActions.map(action => (
                  <article className="dashboard-attention-item" key={action.key}>
                    <span>{action.courseName}{action.quizName ? ` · ${action.quizName}` : ''}</span><strong>{action.title}</strong><p>{action.detail}</p>
                    <button type="button" className="dashboard-text-button" onClick={() => navigate(action.path)}>{action.buttonLabel} <ArrowRight size={14} /></button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="dashboard-all-clear"><CheckCircle size={24} aria-hidden="true" /><strong>No other tasks to show</strong><p>Use the suggested next step to continue your current work.</p></div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
