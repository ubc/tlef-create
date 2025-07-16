import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAppSelector, useAppDispatch } from '../hooks/redux';
import { addCourse } from '../store/slices/appSlice';
import MaterialUpload from './MaterialUpload';
import { ArrowLeft } from 'lucide-react';
import '../styles/components/CourseView.css';

interface Material {
  id: string;
  name: string;
  type: 'pdf' | 'docx' | 'url' | 'text';
  uploadDate: string;
  content?: string;
}

const CourseView = () => {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { courses } = useAppSelector((state) => state.app);

  const [materials, setMaterials] = useState<Material[]>([]);

  const course = courses.find(c => c.id === courseId);

  if (!course) {
    return (
        <div className="course-not-found">
          <h2>Course not found</h2>
          <button className="btn btn-primary" onClick={() => navigate('/')}>
            Go to Dashboard
          </button>
        </div>
    );
  }

  const handleAddMaterial = (materialData: Omit<Material, 'id' | 'uploadDate'>) => {
    const newMaterial: Material = {
      ...materialData,
      id: Date.now().toString(),
      uploadDate: new Date().toLocaleDateString()
    };
    setMaterials(prev => [...prev, newMaterial]);
  };

  const handleRemoveMaterial = (id: string) => {
    setMaterials(prev => prev.filter(m => m.id !== id));
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
                materials={materials}
                onAddMaterial={handleAddMaterial}
                onRemoveMaterial={handleRemoveMaterial}
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