import { ArrowLeft, User } from 'lucide-react';
import { useAppSelector } from '../hooks/redux';
import '../styles/components/Header.css';

const Header = () => {
  const { currentUser, activeCourse, activeQuiz, courses } = useAppSelector((state) => state.app);

  const getPageTitle = () => {
    if (activeQuiz && activeCourse) {
      const course = courses.find(c => c.id === activeCourse);
      const quiz = course?.quizzes.find(q => q.id === activeQuiz);
      return quiz?.name || 'Quiz';
    }
    if (activeCourse) {
      const course = courses.find(c => c.id === activeCourse);
      return course?.name || 'Course';
    }
    return 'Dashboard';
  };

  return (
      <header className="header">
        <div className="header-left">
          {(activeCourse || activeQuiz) && (
              <button className="btn btn-ghost">
                <ArrowLeft size={16} />
                Go Back
              </button>
          )}
          <h1>{getPageTitle()}</h1>
        </div>

        <div className="header-right">
          <div className="user-info">
            <User size={20} />
            <span>{currentUser || 'Guest User'}</span>
          </div>
        </div>
      </header>
  );
};

export default Header;