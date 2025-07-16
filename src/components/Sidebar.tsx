import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '../hooks/redux';
import { setActiveCourse, setActiveQuiz, addCourse } from '../store/slices/appSlice';
import { Plus, Search, ChevronDown, ChevronRight, User } from 'lucide-react';
import CreateCourseModal from './CreateCourseModal';
import '../styles/components/Sidebar.css';

const Sidebar = () => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { courses, activeCourse, activeQuiz, currentUser } = useAppSelector((state) => state.app);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCourses, setExpandedCourses] = useState<string[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const toggleCourse = (courseId: string) => {
    setExpandedCourses(prev =>
        prev.includes(courseId)
            ? prev.filter(id => id !== courseId)
            : [...prev, courseId]
    );
  };

  const handleCourseClick = (courseId: string) => {
    dispatch(setActiveCourse(courseId));
    navigate(`/course/${courseId}`);
    toggleCourse(courseId);
  };

  const handleQuizClick = (courseId: string, quizId: string) => {
    dispatch(setActiveCourse(courseId));
    dispatch(setActiveQuiz(quizId));
    navigate(`/course/${courseId}/quiz/${quizId}`);
  };

  const handleCreateCourse = (courseName: string, quizCount: number) => {
    dispatch(addCourse({ name: courseName, quizCount }));
  };

  const handleUserAccountClick = () => {
    navigate('/account');
  };

  return (
      <>
        <div className="sidebar">
          <div className="sidebar-header">
            <h1 className="sidebar-title">CREATE</h1>
            <button
                className="btn btn-primary"
                style={{ width: '100%' }}
                onClick={() => setShowCreateModal(true)}
            >
              <Plus size={16} />
              Create Folder
            </button>
          </div>

          <div className="sidebar-section">
            <h2 className="sidebar-section-title">Search chats</h2>
            <div style={{ position: 'relative' }}>
              <Search size={16} style={{
                position: 'absolute',
                left: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--color-muted-foreground)'
              }} />
              <input
                  type="text"
                  placeholder="Search conversations..."
                  className="input"
                  style={{ paddingLeft: '40px' }}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="sidebar-section">
            <h2 className="sidebar-section-title">Courses</h2>
            {courses.length === 0 ? (
                <p style={{ color: 'var(--color-muted-foreground)', fontSize: 'var(--font-size-sm)' }}>
                  No courses yet. Create your first course folder to get started.
                </p>
            ) : (
                courses.map((course) => (
                    <div key={course.id}>
                      <div
                          className={`course-item ${activeCourse === course.id ? 'active' : ''}`}
                          onClick={() => handleCourseClick(course.id)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span className="course-name">{course.name}</span>
                          {expandedCourses.includes(course.id) ?
                              <ChevronDown size={16} /> :
                              <ChevronRight size={16} />
                          }
                        </div>
                      </div>

                      {expandedCourses.includes(course.id) && (
                          <div className="quiz-list">
                            {course.quizzes.map((quiz) => (
                                <div
                                    key={quiz.id}
                                    className={`quiz-item ${activeQuiz === quiz.id ? 'active' : ''}`}
                                    onClick={() => handleQuizClick(course.id, quiz.id)}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>{quiz.name}</span>
                                    <span style={{ fontSize: 'var(--font-size-sm)', opacity: 0.7 }}>
                            {quiz.questionCount} questions
                          </span>
                                  </div>
                                </div>
                            ))}
                          </div>
                      )}
                    </div>
                ))
            )}
          </div>

          <div className="sidebar-footer">
            <div
                className="user-account-item"
                onClick={handleUserAccountClick}
            >
              <User size={20} />
              <span>{currentUser || 'Guest User'}</span>
            </div>
          </div>
        </div>

        <CreateCourseModal
            isOpen={showCreateModal}
            onClose={() => setShowCreateModal(false)}
            onSubmit={handleCreateCourse}
        />
      </>
  );
};

export default Sidebar;