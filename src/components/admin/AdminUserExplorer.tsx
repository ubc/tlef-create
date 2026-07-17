import { useState } from 'react';
import { BookOpen, ChevronRight, Eye, File, FileQuestion, Lock, Search, UserRound } from 'lucide-react';
import { adminApi, AdminCourseDetail, AdminCourseSummary, AdminQuizDetail } from '../../services/api';

interface ManagedUser {
  _id: string;
  cwlId: string;
  displayName?: string;
  email?: string;
  lastLogin?: string;
  createdAt?: string;
}

interface AdminUserExplorerProps {
  users: ManagedUser[];
}

function formatBytes(value?: number) {
  if (!value) return '—';
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

const AdminUserExplorer = ({ users }: AdminUserExplorerProps) => {
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<ManagedUser | null>(null);
  const [courses, setCourses] = useState<AdminCourseSummary[]>([]);
  const [course, setCourse] = useState<AdminCourseDetail | null>(null);
  const [quiz, setQuiz] = useState<AdminQuizDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const selectUser = async (user: ManagedUser) => {
    setSelectedUser(user); setCourse(null); setQuiz(null); setLoading(true); setError('');
    try {
      const response = await adminApi.getUserCourses(user._id);
      setCourses(response.data?.courses || []);
    } catch (loadError) {
      setError((loadError as Error).message || 'Failed to load courses.');
    } finally { setLoading(false); }
  };

  const selectCourse = async (courseId: string) => {
    setQuiz(null); setLoading(true); setError('');
    try {
      const response = await adminApi.getAdminCourse(courseId);
      setCourse(response.data?.course || null);
    } catch (loadError) {
      setError((loadError as Error).message || 'Failed to load course.');
    } finally { setLoading(false); }
  };

  const selectQuiz = async (quizId: string) => {
    setLoading(true); setError('');
    try {
      const response = await adminApi.getAdminQuiz(quizId);
      setQuiz(response.data?.quiz || null);
    } catch (loadError) {
      setError((loadError as Error).message || 'Failed to load quiz.');
    } finally { setLoading(false); }
  };

  const filteredUsers = users.filter(user => `${user.cwlId} ${user.displayName || ''} ${user.email || ''}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="admin-explorer">
      <aside className="admin-explorer-sidebar">
        <div className="admin-readonly-badge"><Lock size={14} /> Read-only access</div>
        <label className="admin-search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a user" /></label>
        <div className="admin-user-list">
          {filteredUsers.map(user => (
            <button key={user._id} type="button" className={selectedUser?._id === user._id ? 'active' : ''} onClick={() => void selectUser(user)}>
              <span className="admin-user-avatar"><UserRound size={17} /></span>
              <span><strong>{user.displayName || user.cwlId}</strong><small>{user.email || user.cwlId}</small></span>
              <ChevronRight size={15} />
            </button>
          ))}
        </div>
      </aside>

      <main className="admin-explorer-content">
        <div className="admin-privacy-banner"><Eye size={17} /><span><strong>Observation mode</strong> You can inspect course structure and generated learning content. Raw files and full material text are hidden.</span></div>
        {error && <div className="admin-error">{error}</div>}
        {loading && <div className="admin-empty">Loading read-only details...</div>}
        {!selectedUser && !loading && <div className="admin-explorer-welcome"><UserRound size={32} /><h2>Select a user</h2><p>Choose an instructor to inspect their courses and quizzes.</p></div>}

        {selectedUser && !course && !loading && (
          <section className="admin-inspector-section">
            <div className="admin-inspector-title"><div><span>Instructor</span><h2>{selectedUser.displayName || selectedUser.cwlId}</h2><p>{selectedUser.email || selectedUser.cwlId}</p></div><strong>{courses.length} courses</strong></div>
            <div className="admin-course-grid">
              {courses.map(item => (
                <button key={item._id} type="button" onClick={() => void selectCourse(item._id)}>
                  <BookOpen size={21} /><div><strong>{item.name}</strong><span>{item.stats?.totalMaterials || item.materials?.length || 0} materials · {item.stats?.totalQuizzes || item.quizzes?.length || 0} quizzes · {item.stats?.totalQuestions || 0} questions</span></div><ChevronRight size={17} />
                </button>
              ))}
              {!courses.length && <div className="admin-empty">This user has no courses.</div>}
            </div>
          </section>
        )}

        {course && !quiz && !loading && (
          <section className="admin-inspector-section">
            <button className="admin-back-link" type="button" onClick={() => setCourse(null)}>← Back to {selectedUser?.displayName || selectedUser?.cwlId}</button>
            <div className="admin-inspector-title"><div><span>Course</span><h2>{course.name}</h2><p>Last updated {new Date(course.updatedAt).toLocaleString()}</p></div><strong>{course.stats?.totalQuestions || 0} questions</strong></div>
            <h3>Materials metadata</h3>
            <div className="admin-material-list">
              {course.materials.map(material => (
                <div key={material._id}><File size={18} /><span><strong>{material.name}</strong><small>{String(material.type || '').toUpperCase()} · {formatBytes(material.fileSize)} · {material.processingStatus || 'unknown'}{material.processingMetadata?.pageCount ? ` · ${material.processingMetadata.pageCount} pages` : ''}</small></span></div>
              ))}
              {!course.materials.length && <div className="admin-empty">No materials.</div>}
            </div>
            <h3>Quizzes</h3>
            <div className="admin-quiz-list">
              {course.quizzes.map(item => (
                <button key={item._id} type="button" onClick={() => void selectQuiz(item._id)}><FileQuestion size={18} /><span><strong>{item.name}</strong><small>{item.status} · {item.questions?.length || 0} questions · {item.learningObjectives?.length || 0} LOs</small></span><ChevronRight size={16} /></button>
              ))}
              {!course.quizzes.length && <div className="admin-empty">No quizzes.</div>}
            </div>
          </section>
        )}

        {quiz && !loading && (
          <section className="admin-inspector-section">
            <button className="admin-back-link" type="button" onClick={() => setQuiz(null)}>← Back to {course?.name}</button>
            <div className="admin-inspector-title"><div><span>Quiz</span><h2>{quiz.name}</h2><p>{quiz.status} · {quiz.settings?.pedagogicalApproach || 'No approach selected'}</p></div><strong>{quiz.questions.length} questions</strong></div>
            <h3>Learning objectives</h3>
            <div className="admin-lo-list">
              {quiz.learningObjectives.map((objective, index) => (
                <article key={objective._id}><span>LO {index + 1}</span><strong>{objective.text}</strong>{objective.generationMetadata?.subpoints?.length ? <p>{objective.generationMetadata.subpoints.join(' · ')}</p> : null}</article>
              ))}
              {!quiz.learningObjectives.length && <div className="admin-empty">No learning objectives.</div>}
            </div>
            <h3>Question plan</h3>
            <div className="admin-plan-list">
              {quiz.generationPlans.map(plan => <div key={plan._id}><strong>{plan.approach}</strong><span>{plan.totalQuestions} questions · {plan.status}</span></div>)}
              {!quiz.generationPlans.length && <div className="admin-empty">No generation plan.</div>}
            </div>
            <h3>Questions</h3>
            <div className="admin-question-list">
              {quiz.questions.map((question, index) => (
                <details key={question._id}><summary><span>{index + 1}</span><strong>{question.questionText || question.content?.front || question.content?.question || question.type}</strong><em>{question.type} · {question.difficulty}</em></summary><div>{question.explanation && <p><strong>Explanation:</strong> {question.explanation}</p>}<p><strong>Review status:</strong> {question.reviewStatus}</p></div></details>
              ))}
              {!quiz.questions.length && <div className="admin-empty">No questions.</div>}
            </div>
          </section>
        )}
      </main>
    </div>
  );
};

export default AdminUserExplorer;
