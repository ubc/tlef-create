import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { ArrowLeft, FileText, Target, Wand2, Settings } from 'lucide-react';
import LearningObjectives from './LearningObjectives';
import MaterialAssignment from './MaterialAssignment';
import QuestionGeneration from './QuestionGeneration';
import ReviewEdit from './ReviewEdit';
import { RootState, AppDispatch } from '../store';
import { fetchQuizById, setCurrentQuiz, assignMaterials } from '../store/slices/quizSlice';
import { fetchMaterials } from '../store/slices/materialSlice';
import { clearObjectives } from '../store/slices/learningObjectiveSlice';
import '../styles/components/QuizView.css';

type TabType = 'materials' | 'objectives' | 'generation' | 'review';

const QuizView = () => {
  const { courseId, quizId } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  
  const { currentQuiz, loading, error } = useSelector((state: RootState) => state.quiz);
  const { materials } = useSelector((state: RootState) => state.material);
  const [activeTab, setActiveTab] = useState<TabType>('materials');
  const [learningObjectives, setLearningObjectives] = useState<string[]>([]);
  const [assignedMaterials, setAssignedMaterials] = useState<string[]>([]);

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
      // Set assigned materials from backend
      const materialIds = currentQuiz.materials.map((m: any) => 
        typeof m === 'string' ? m : m._id
      );
      setAssignedMaterials(materialIds);
      
      // Set learning objectives if they exist
      if (currentQuiz.learningObjectives) {
        // Ensure learning objectives are strings, not objects
        const objectiveTexts = currentQuiz.learningObjectives.map((obj: any) => 
          typeof obj === 'string' ? obj : obj.text || obj
        );
        setLearningObjectives(objectiveTexts);
      }
    }
  }, [currentQuiz]);

  if (loading) {
    return (
      <div className="quiz-loading">
        <div>Loading quiz...</div>
      </div>
    );
  }

  if (error || !currentQuiz) {
    return (
        <div className="quiz-not-found">
          <h2>{error || 'Quiz not found'}</h2>
          <button className="btn btn-primary" onClick={() => navigate('/')}>
            Go to Dashboard
          </button>
        </div>
    );
  }

  const tabs = [
    { id: 'materials' as TabType, label: 'Materials', icon: FileText },
    { id: 'objectives' as TabType, label: 'Learning Objectives', icon: Target },
    { id: 'generation' as TabType, label: 'Generate Questions', icon: Wand2 },
    { id: 'review' as TabType, label: 'Review & Edit', icon: Settings },
  ];

  const canProceed = (tab: TabType) => {
    switch (tab) {
      case 'objectives':
        return assignedMaterials.length > 0;
      case 'generation':
        return assignedMaterials.length > 0 && learningObjectives.length > 0;
      case 'review':
        return assignedMaterials.length > 0 && learningObjectives.length > 0;
      default:
        return true;
    }
  };

  return (
      <div className="quiz-view">
        <div className="quiz-header">
          <button className="btn btn-ghost" onClick={() => navigate(`/course/${courseId}`)}>
            <ArrowLeft size={16} />
            Back to Course
          </button>
          <div>
            <h1>{currentQuiz.name}</h1>
            <p className="quiz-description">
              {currentQuiz.folder?.name || 'Course'} • {currentQuiz.questions?.length || 0} questions
            </p>
          </div>
        </div>

        <div className="quiz-tabs">
          {tabs.map((tab) => (
              <button
                  key={tab.id}
                  className={`quiz-tab ${activeTab === tab.id ? 'active' : ''} ${!canProceed(tab.id) ? 'disabled' : ''}`}
                  onClick={() => canProceed(tab.id) && setActiveTab(tab.id)}
                  disabled={!canProceed(tab.id)}
              >
                <tab.icon size={20} />
                <span>{tab.label}</span>
                {!canProceed(tab.id) && <span className="tab-lock">🔒</span>}
              </button>
          ))}
        </div>

        <div className="quiz-content">
          {activeTab === 'materials' && (
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
                    setActiveTab('objectives');
                    setTimeout(() => {
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }, 100);
                  }}
              />
          )}

          {activeTab === 'objectives' && (
              <LearningObjectives
                  assignedMaterials={assignedMaterials}
                  objectives={learningObjectives}
                  onObjectivesChange={setLearningObjectives}
                  quizId={quizId!}
                  onNavigateNext={() => {
                    setActiveTab('generation');
                    setTimeout(() => {
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }, 100);
                  }}
              />
          )}

          {activeTab === 'generation' && (
              <QuestionGeneration
                  learningObjectives={learningObjectives}
                  assignedMaterials={assignedMaterials}
                  quizId={quizId!}
                  onQuestionsGenerated={() => setActiveTab('review')}
              />
          )}

          {activeTab === 'review' && (
              <ReviewEdit
                  quizId={quizId!}
                  learningObjectives={learningObjectives}
              />
          )}
        </div>
      </div>
  );
};

export default QuizView;