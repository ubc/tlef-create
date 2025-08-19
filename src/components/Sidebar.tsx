import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '../hooks/redux';
import { setActiveCourse, setActiveQuiz } from '../store/slices/appSlice';
import { Plus, Search, ChevronDown, ChevronRight, User } from 'lucide-react';
import CreateCourseModal from './CreateCourseModal';
import { foldersApi, quizApi, materialsApi, Folder, ApiError } from '../services/api';
import '../styles/components/Sidebar.css';

const Sidebar = () => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { activeCourse, activeQuiz, currentUser } = useAppSelector((state) => state.app);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCourses, setExpandedCourses] = useState<string[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingQuizForFolder, setCreatingQuizForFolder] = useState<string | null>(null);

  useEffect(() => {
    loadFolders();
  }, []);

  const loadFolders = async () => {
    console.log('🔄 Sidebar: Loading folders from API...');
    try {
      const response = await foldersApi.getFolders();
      console.log('✅ Sidebar: Folders loaded:', response.folders);
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

  const handleCreateCourse = async (courseName: string, materials: any[] = []) => {
    console.log('➕ Sidebar: Creating folder:', courseName, 'with default Quiz 1 and', materials.length, 'materials');
    try {
      const response = await foldersApi.createFolder(courseName, 1);
      console.log('✅ Sidebar: Folder created with Quiz 1:', response.folder);
      
      // Upload materials to the created folder
      if (materials.length > 0) {
        console.log('📁 Uploading materials to folder:', materials);
        console.log('📁 Folder ID for upload:', response.folder._id);
        
        for (const material of materials) {
          try {
            console.log('🔄 Processing material:', material);
            switch (material.type) {
              case 'pdf':
              case 'docx':
                if (material.file) {
                  console.log('📄 Uploading file:', material.file.name);
                  const files = [material.file];
                  await materialsApi.uploadFiles(response.folder._id, files as any);
                }
                break;
              case 'url':
                console.log('🔗 Adding URL:', material.content || material.name);
                await materialsApi.addUrl(response.folder._id, material.content || material.name, material.name);
                break;
              case 'text':
                console.log('📝 Adding text material:', material.name);
                await materialsApi.addText(response.folder._id, material.content || '', material.name);
                break;
            }
          } catch (materialError) {
            console.error('❌ Failed to upload material:', material.name, materialError);
          }
        }
        console.log('✅ All materials processed');
      }
      
      // Reload folders to get the updated list
      await loadFolders();
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
    if (creatingQuizForFolder) return;
    
    setCreatingQuizForFolder(folderId);
    try {
      // Find the current folder to get existing quiz count
      const folder = folders.find(f => f._id === folderId);
      if (!folder) return;
      
      // Generate a name for the new quiz
      const quizNumber = (folder.quizzes?.length || 0) + 1;
      const quizName = `Quiz ${quizNumber}`;
      
      const response = await quizApi.createQuiz(quizName, folderId);
      
      // Reload folders to get the updated quiz list
      await loadFolders();
      
      console.log('✅ Sidebar: Quiz created successfully:', response.quiz);
      
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
        <div className="sidebar">
          <div className="sidebar-header">
            <h1 className="sidebar-title">CREATE</h1>
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
                            {folder.quizzes.map((quiz: any) => {
                              const quizId = quiz._id || quiz;
                              const quizName = quiz.name || `Quiz ${quizId}`;
                              const questionCount = quiz.questions?.length || 0;
                              
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