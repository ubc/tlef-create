import { ArrowLeft, User } from 'lucide-react';
import { useAppSelector } from '../hooks/redux';

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
        {(activeCourse || activeQuiz) && (
          <button className="btn btn-ghost">
            <ArrowLeft size={16} />
            Go Back
          </button>
        )}
        <h1 style={{ fontSize: 'var(--font-size-xl)', fontWeight: '600', margin: 0 }}>
          {getPageTitle()}
        </h1>
      </div>
      
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
          <User size={20} />
          <span style={{ fontSize: 'var(--font-size-sm)' }}>
            {currentUser || 'Guest User'}
          </span>
        </div>
      </div>
    </header>
  );
};

export default Header;