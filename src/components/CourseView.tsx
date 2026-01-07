import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import MaterialUpload from './MaterialUpload';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { foldersApi, materialsApi, Folder, Material, Quiz, ApiError } from '../services/api';
import { usePubSub } from '../hooks/usePubSub';
import '../styles/components/CourseView.css';

interface QuizData {
  id: string;
  name: string;
  questionCount: number;
}

interface CourseData {
  id: string;
  name: string;
  quizzes: QuizData[];
}

const CourseView = () => {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const { showNotification, publish, subscribe } = usePubSub('CourseView');

  const [course, setCourse] = useState<CourseData | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const hasNotifiedRef = useRef(false);

  useEffect(() => {
    if (courseId) {
      loadCourseData();
    }
  }, [courseId]);

  // Listen for quiz deletion events
  useEffect(() => {
    const handleQuizDeleted = (data: { quizId: string; courseId: string }) => {
      console.log('📢 CourseView: Received quiz-deleted event', data);
      // Refresh course data to get updated quiz list
      if (data.courseId === courseId) {
        loadCourseData();
      }
    };

    subscribe('quiz-deleted', handleQuizDeleted);
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
          console.error('❌ Failed to poll material status:', err);
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
    
    console.log('🔄 CourseView: Loading course data for:', courseId);
    try {
      setError(null);
      
      // Load folder details
      const folderResponse = await foldersApi.getFolder(courseId);
      console.log('✅ CourseView: Folder loaded:', folderResponse.folder);
      
      // Load materials for this folder
      const materialsResponse = await materialsApi.getMaterials(courseId);
      console.log('✅ CourseView: Materials loaded:', materialsResponse.materials);
      setMaterials(materialsResponse.materials);
      
      // Transform backend data to match your UI structure
      const course: CourseData = {
        id: folderResponse.folder._id,
        name: folderResponse.folder.name,
        quizzes: folderResponse.folder.quizzes?.map((quiz: any) => ({
          id: quiz._id || quiz,
          name: quiz.name || `Quiz ${quiz.name?.split(' ')[1] || '1'}`,
          questionCount: quiz.questions?.length || 0
        })) || []
      };
      
      setCourse(course);
      console.log('✅ CourseView: Course data structured:', course);
      
    } catch (err) {
      console.error('❌ CourseView: Failed to load course data:', err);
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

    console.log('➕ CourseView: Adding material:', materialData);
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
            console.log(`📤 Upload progress for ${materialData.name}: ${progress}%`);
            if (onProgress) {
              onProgress(progress);
            }
          }
        );

        setMaterials(prev => [...prev, ...response.materials]);
      }

      console.log('✅ CourseView: Material added successfully');

    } catch (err) {
      console.error('❌ CourseView: Failed to add material:', err);
      console.error('❌ Error details:', {
        name: err.name,
        message: err.message,
        status: err.status,
        code: err.code,
        isApiError: err instanceof ApiError,
        isAuthError: err instanceof ApiError ? err.isAuthError() : false
      });

      if (err instanceof ApiError) {
        if (err.isAuthError()) {
          alert('Your session has expired. Please log in again.');
          // Redirect to login page
          window.location.href = '/login';
        } else {
          alert(`Failed to add material: ${err.message}\n\nStatus: ${err.status}\nCode: ${err.code || 'Unknown'}`);
        }
      } else {
        alert('Failed to add material. Please try again.');
      }
    }
  };

  const handleDeleteMaterial = async (materialId: string) => {
    console.log('🗑️ CourseView: Deleting material:', materialId);
    try {
      // Find the material by the frontend ID (which is _id from backend)
      const materialToDelete = materials.find(m => m._id === materialId);
      if (materialToDelete) {
        await materialsApi.deleteMaterial(materialToDelete._id);
        setMaterials(prev => prev.filter(m => m._id !== materialId));
        console.log('✅ CourseView: Material deleted successfully');
      }
    } catch (err) {
      console.error('❌ CourseView: Failed to delete material:', err);
      if (err instanceof ApiError) {
        alert(`Failed to delete material: ${err.message}`);
      } else {
        alert('Failed to delete material. Please try again.');
      }
    }
  };

  const handleQuizClick = (quizId: string) => {
    navigate(`/course/${courseId}/quiz/${quizId}`);
  };

  const handleDeleteCourse = async () => {
    if (!course || !courseId) return;

    setIsDeleting(true);
    console.log('🗑️ CourseView: Deleting course:', courseId);

    try {
      // Call the API to delete the course (this will cascade delete everything)
      await foldersApi.deleteFolder(courseId);
      console.log('✅ CourseView: Course deleted successfully');

      // Notify Dashboard to remove course from sidebar
      publish('course-deleted', { courseId });

      // Navigate back to dashboard
      navigate('/');

    } catch (err) {
      console.error('❌ CourseView: Failed to delete course:', err);
      setIsDeleting(false);
      setShowDeleteConfirm(false);
      
      if (err instanceof ApiError) {
        if (err.isAuthError()) {
          alert('Your session has expired. Please log in again.');
          window.location.href = '/login';
        } else {
          alert(`Failed to delete course: ${err.message}`);
        }
      } else {
        alert('Failed to delete course. Please try again.');
      }
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
          Manage materials and quizzes for {course.name}
        </p>
      </div>

      <div className="course-content">
        <div className="course-section">
          <MaterialUpload
            materials={materials.map(m => ({
              id: m._id,
              name: m.name,
              type: m.type,
              uploadDate: new Date(m.createdAt).toLocaleDateString(),
              content: m.content || m.url,
              processingStatus: m.processingStatus
            }))}
            onAddMaterial={handleAddMaterial}
            onRemoveMaterial={handleDeleteMaterial}
          />
        </div>

        <div className="course-section">
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Quizzes ({course.quizzes.length})</h3>
              <p className="card-description">
                Click on a quiz to start generating questions
              </p>
            </div>

            <div className="quiz-grid">
              {course.quizzes.map((quiz) => (
                <div
                  key={quiz.id}
                  className="quiz-card"
                  onClick={() => handleQuizClick(quiz.id)}
                >
                  <div className="quiz-info">
                    <h4>{quiz.name}</h4>
                    <p>{quiz.questionCount} questions</p>
                  </div>
                  <div className="quiz-status">
                    {quiz.questionCount > 0 ? (
                      <span className="status-badge status-complete">Ready</span>
                    ) : (
                      <span className="status-badge status-empty">Empty</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
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