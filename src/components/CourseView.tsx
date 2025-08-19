import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import MaterialUpload from './MaterialUpload';
import { ArrowLeft } from 'lucide-react';
import { foldersApi, materialsApi, Folder, Material, Quiz, ApiError } from '../services/api';
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
  
  const [course, setCourse] = useState<CourseData | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (courseId) {
      loadCourseData();
    }
  }, [courseId]);

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

  const handleAddMaterial = async (materialData: { name: string; type: 'pdf' | 'docx' | 'url' | 'text'; content?: string; file?: File }) => {
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
        response = await materialsApi.uploadFiles(course.id, fileList.files);
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

  return (
    <div className="course-view">
      <div className="course-header">
        <button className="btn btn-ghost" onClick={() => navigate('/')}>
          <ArrowLeft size={16} />
          Back to Dashboard
        </button>
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
              content: m.content || m.url
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
    </div>
  );
};

export default CourseView;