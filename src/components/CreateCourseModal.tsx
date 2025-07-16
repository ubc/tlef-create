import { useState } from 'react';
import { X } from 'lucide-react';
import '../styles/components/CreateCourseModal.css';

interface CreateCourseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (courseName: string, quizCount: number) => void;
}

const CreateCourseModal = ({ isOpen, onClose, onSubmit }: CreateCourseModalProps) => {
  const [courseName, setCourseName] = useState('');
  const [quizCount, setQuizCount] = useState(1);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (courseName.trim()) {
      onSubmit(courseName.trim(), quizCount);
      setCourseName('');
      setQuizCount(1);
      onClose();
    }
  };

  return (
      <div className="modal-overlay">
        <div className="modal-content">
          <div className="modal-header">
            <h2>Create New Course Folder</h2>
            <button className="btn btn-ghost modal-close" onClick={onClose}>
              <X size={20} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="modal-form">
            <div className="form-group">
              <label htmlFor="courseName">Course Name</label>
              <input
                  id="courseName"
                  type="text"
                  className="input"
                  placeholder="e.g., EOSC 533"
                  value={courseName}
                  onChange={(e) => setCourseName(e.target.value)}
                  required
              />
            </div>

            <div className="form-group">
              <label htmlFor="quizCount">Number of Quizzes</label>
              <input
                  id="quizCount"
                  type="number"
                  className="input"
                  min="1"
                  max="20"
                  value={quizCount}
                  onChange={(e) => setQuizCount(parseInt(e.target.value) || 1)}
                  required
              />
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Create Course
              </button>
            </div>
          </form>
        </div>
      </div>
  );
};

export default CreateCourseModal;