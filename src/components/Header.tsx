import { ArrowLeft, User } from 'lucide-react';
import { useAppSelector } from '../hooks/redux';
import '../styles/components/Header.css';

const Header = () => {
  const { activeCourse, activeQuiz } = useAppSelector((state) => state.app);

  const getPageTitle = () => {
    if (activeQuiz && activeCourse) {
      return 'Quiz';
    }
    if (activeCourse) {
      return 'Course';
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
            <span>Guest User</span>
          </div>
        </div>
      </header>
  );
};

export default Header;
