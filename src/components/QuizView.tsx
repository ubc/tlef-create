import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAppSelector } from '../hooks/redux';
import { ArrowLeft, FileText, Target, Wand2, Settings } from 'lucide-react';
import LearningObjectives from './LearningObjectives';
import MaterialAssignment from './MaterialAssignment';
import QuestionGeneration from './QuestionGeneration';
import ReviewEdit from './ReviewEdit';
import '../styles/components/QuizView.css';

type TabType = 'materials' | 'objectives' | 'generation' | 'review';

const QuizView = () => {
  const { courseId, quizId } = useParams();
  const navigate = useNavigate();
  const { courses } = useAppSelector((state) => state.app);

  const [activeTab, setActiveTab] = useState<TabType>('materials');
  const [learningObjectives, setLearningObjectives] = useState<string[]>([]);
  const [assignedMaterials, setAssignedMaterials] = useState<string[]>([]);

  const course = courses.find(c => c.id === courseId);
  const quiz = course?.quizzes.find(q => q.id === quizId);

  if (!course || !quiz) {
    return (
        <div className="quiz-not-found">
          <h2>Quiz not found</h2>
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
            Back to {course.name}
          </button>
          <div>
            <h1>{quiz.name}</h1>
            <p className="quiz-description">
              {course.name} • {quiz.questionCount} questions
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
                  onAssignedMaterialsChange={setAssignedMaterials}
              />
          )}

          {activeTab === 'objectives' && (
              <LearningObjectives
                  assignedMaterials={assignedMaterials}
                  objectives={learningObjectives}
                  onObjectivesChange={setLearningObjectives}
              />
          )}

          {activeTab === 'generation' && (
              <QuestionGeneration
                  learningObjectives={learningObjectives}
                  assignedMaterials={assignedMaterials}
                  quizId={quizId!}
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