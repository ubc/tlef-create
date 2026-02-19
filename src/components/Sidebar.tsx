import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '../hooks/redux';
import { setActiveCourse, setActiveQuiz } from '../store/slices/appSlice';
import { Plus, Search, ChevronDown, ChevronRight, User, X } from 'lucide-react';
import CreateCourseModal from './CreateCourseModal';
import SearchModal from './SearchModal';
import { foldersApi, quizApi, materialsApi, Folder, ApiError } from '../services/api';
import { usePubSub } from '../hooks/usePubSub';
import '../styles/components/Sidebar.css';

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

const Sidebar = ({ isOpen = false, onClose }: SidebarProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const { activeCourse, activeQuiz } = useAppSelector((state) => state.app);
  const { subscribe, publish } = usePubSub('Sidebar');
  const [expandedCourses, setExpandedCourses] = useState<string[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingQuizForFolder, setCreatingQuizForFolder] = useState<string | null>(null);

  useEffect(() => {
    loadFolders();
  }, []);

  // Automatically select course and quiz based on URL, and clear selection on dashboard
  useEffect(() => {
    const pathParts = location.pathname.split('/').filter(Boolean);

    // Check if we're on the dashboard (root path or just '/')
    if (pathParts.length === 0 || location.pathname === '/') {
      // Clear selections when on dashboard
      dispatch(setActiveCourse(''));
      dispatch(setActiveQuiz(''));
      return;
    }

    // Match pattern: /course/:courseId or /course/:courseId/quiz/:quizId
    if (pathParts[0] === 'course' && pathParts[1]) {
      const courseId = pathParts[1];

      // Set active course
      dispatch(setActiveCourse(courseId));

      // Expand the course to show its quizzes
      if (!expandedCourses.includes(courseId)) {
        setExpandedCourses(prev => [...prev, courseId]);
      }

      // If there's a quiz in the URL, set it as active
      if (pathParts[2] === 'quiz' && pathParts[3]) {
        const quizId = pathParts[3];
        dispatch(setActiveQuiz(quizId));
      } else {
        // Clear quiz selection if we're just on the course page
        dispatch(setActiveQuiz(''));
      }
    }
  }, [location.pathname, dispatch]);

  // Listen for course deletion events
  useEffect(() => {
    subscribe<{ courseId: string }>('course-deleted', (data) => {
      if (data?.courseId) {
        // Remove the deleted course from the sidebar
        setFolders(prev => prev.filter(folder => folder._id !== data.courseId));
      }
    });
    // Cleanup is automatically handled by usePubSub hook
  }, [subscribe]);

  // Listen for quiz deletion events
  useEffect(() => {
    subscribe<{ quizId: string; courseId: string }>('quiz-deleted', () => {
      // Reload folders to get updated quiz list
      loadFolders();
    });
  }, [subscribe]);

  // Global keyboard shortcut for search (⌘K or Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowSearchModal(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const loadFolders = async () => {
    try {
      const response = await foldersApi.getFolders();
      setFolders(response.folders);
    } catch (err) {
      console.error('❌ Sidebar: Failed to load folders:', err);
      setFolders([]);
    } finally {
      setLoading(false);
    }
  };

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

  const handleCreateCourse = async (courseName: string, materials: Array<{ type: string; name: string; content?: string; file?: File }> = []) => {
    try {
      // Step 1: Create the folder/course (await this - it's fast)
      console.log(`📁 Creating course: ${courseName}`);
      const response = await foldersApi.createFolder(courseName, 1);
      const courseId = response.folder._id;

      // Step 2: Immediately add the new folder to the sidebar state
      setFolders(prev => [response.folder, ...prev]);

      // Step 3: Navigate to dashboard immediately (don't wait for uploads)
      const newCourseId = response.folder._id;
      dispatch(setActiveCourse(newCourseId));
      setExpandedCourses(prev => [...prev, newCourseId]);
      navigate(`/course/${newCourseId}`);

      // Publish course-created event for other components
      publish('course-created', { courseId: newCourseId, courseName: response.folder.name });

      // Step 4: If materials exist, start background upload (non-blocking)
      if (materials.length > 0) {
        console.log(`Starting background upload for ${materials.length} materials`);

        // Upload materials in background (fire and forget)
        // Materials will appear in CourseView as they're created with "processing" status
        (async () => {
          for (const material of materials) {
            try {
              if (material.type === 'url') {
                await materialsApi.addUrl(courseId, material.content || material.name, material.name);
              } else if (material.type === 'text') {
                await materialsApi.addText(courseId, material.content || '', material.name);
              } else if (material.file) {
                const fileList = new DataTransfer();
                fileList.items.add(material.file);
                await materialsApi.uploadFiles(courseId, fileList.files);
              }

              // Notify CourseView to refresh materials after each upload
              publish('materials-updated', { courseId });
            } catch (error) {
              console.error(`Failed to upload material: ${material.name}`, error);
            }
          }
          // Reload folders to update material count
          await loadFolders();
        })();
      }

    } catch (err) {
      console.error('❌ Sidebar: Failed to create folder:', err);
      if (err instanceof ApiError) {
        alert(`Failed to create folder: ${err.message}`);
      } else {
        alert('Failed to create folder. Please try again.');
      }
    }
  };

  const handleUserAccountClick = () => {
    navigate('/account');
  };

  const handleAddQuiz = async (folderId: string) => {
    if (creatingQuizForFolder || loading) return;

    setCreatingQuizForFolder(folderId);
    try {
      // Find the current folder to get existing quiz count
      const folder = folders.find(f => f._id === folderId);
      if (!folder) {
        setCreatingQuizForFolder(null);
        return;
      }
      
      // Generate a name for the new quiz
      // Find the lowest available quiz number
      const existingNumbers = folder.quizzes
        ?.map((q: string | { _id: string; name?: string; questions?: string[] }) => {
          const quizName = typeof q === 'string' ? null : q.name;
          const match = quizName?.match(/^Quiz (\d+)$/);
          return match ? parseInt(match[1]) : 0;
        })
        .filter((n: number) => n > 0) || [];

      let quizNumber = 1;
      while (existingNumbers.includes(quizNumber)) {
        quizNumber++;
      }

      const quizName = `Quiz ${quizNumber}`;
      
      const response = await quizApi.createQuiz(quizName, folderId);
      
      // Reload folders to get the updated quiz list
      await loadFolders();

      // Publish quiz-created event for CourseView to refresh
      publish('quiz-created', { 
        quizId: response.quiz._id, 
        courseId: folderId,
        quizName: response.quiz.name 
      });
      
    } catch (err) {
      console.error('❌ Sidebar: Failed to create quiz:', err);
      if (err instanceof ApiError) {
        alert(`Failed to create quiz: ${err.message}`);
      } else {
        alert('Failed to create quiz. Please try again.');
      }
    } finally {
      setCreatingQuizForFolder(null);
    }
  };


  return (
      <>
        {isOpen && <div className="sidebar-overlay" onClick={onClose} />}
        <div className={`sidebar ${isOpen ? 'open' : ''}`}>
          <div className="sidebar-header">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h1 className="sidebar-title">CREATE</h1>
              <button
                className="sidebar-close-button"
                onClick={onClose}
                aria-label="Close menu"
              >
                <X size={20} />
              </button>
            </div>
            <button
                className="btn btn-primary"
                style={{ width: '100%' }}
                onClick={() => setShowCreateModal(true)}
            >
              <Plus size={16} />
              Create Course
            </button>
          </div>

          <div className="sidebar-section">
            <button
                className="search-trigger-button"
                onClick={() => setShowSearchModal(true)}
            >
              <Search size={16} />
              <span>Search...</span>
              <kbd className="search-kbd">⌘K</kbd>
            </button>
          </div>

          <div className="sidebar-section">
            <h2 className="sidebar-section-title">Courses</h2>
            {loading ? (
                <p style={{ color: 'var(--color-muted-foreground)', fontSize: 'var(--font-size-sm)' }}>
                  Loading courses...
                </p>
            ) : folders.length === 0 ? (
                <p style={{ color: 'var(--color-muted-foreground)', fontSize: 'var(--font-size-sm)' }}>
                  No courses yet. Create your first course folder to get started.
                </p>
            ) : (
                folders.map((folder) => (
                    <div key={folder._id}>
                      <div
                          className={`course-item ${activeCourse === folder._id ? 'active' : ''}`}
                          onClick={() => handleCourseClick(folder._id)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span className="course-name">{folder.name}</span>
                          {expandedCourses.includes(folder._id) ?
                              <ChevronDown size={16} /> :
                              <ChevronRight size={16} />
                          }
                        </div>
                      </div>

                      {expandedCourses.includes(folder._id) && folder.quizzes && (
                          <div className="quiz-list">
                            {folder.quizzes.map((quiz: string | { _id: string; name?: string; questions?: string[] }) => {
                              const quizId = typeof quiz === 'string' ? quiz : quiz._id;
                              const quizName = typeof quiz === 'string' ? `Quiz ${quiz}` : (quiz.name || `Quiz ${quizId}`);
                              const questionCount = typeof quiz === 'string' ? 0 : (quiz.questions?.length || 0);
                              
                              return (
                                <div
                                    key={quizId}
                                    className={`quiz-item ${activeQuiz === quizId ? 'active' : ''}`}
                                    onClick={() => handleQuizClick(folder._id, quizId)}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>{quizName}</span>
                                    <span style={{ fontSize: 'var(--font-size-sm)', opacity: 0.7 }}>
                                      {questionCount} questions
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                            
                            <button 
                              className={`quiz-add-button ${creatingQuizForFolder === folder._id ? 'loading' : ''}`}
                              onClick={() => handleAddQuiz(folder._id)}
                              disabled={creatingQuizForFolder === folder._id}
                            >
                              {creatingQuizForFolder === folder._id ? (
                                <div className="spinner-mini"></div>
                              ) : (
                                <Plus size={16} />
                              )}
                            </button>
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
              <span>Guest User</span>
            </div>
          </div>
        </div>

        <CreateCourseModal
            isOpen={showCreateModal}
            onClose={() => setShowCreateModal(false)}
            onSubmit={handleCreateCourse}
        />

        <SearchModal
            isOpen={showSearchModal}
            onClose={() => setShowSearchModal(false)}
        />
      </>
  );
};

export default Sidebar;