import { useState, useEffect } from 'react';
import { BookOpen, FileText, CheckCircle, Clock } from 'lucide-react';
import { useAppSelector } from '../hooks/redux';
import { foldersApi, Folder, ApiError } from '../services/api';
import '../styles/components/Dashboard.css';

const Dashboard = () => {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadFolders();
  }, []);

  const loadFolders = async () => {
    console.log('🔄 Loading folders from API...');
    try {
      setError(null);
      const response = await foldersApi.getFolders();
      console.log('✅ Folders API response:', response);
      console.log('📁 Number of folders received:', response.folders?.length || 0);
      console.log('📋 Folder details:', response.folders);
      
      // Debug folder stats
      console.log('📊 DASHBOARD DEBUG - Folder Stats Analysis:');
      response.folders?.forEach((folder, index) => {
        console.log(`  Folder ${index + 1}: ${folder.name}`);
        console.log(`    - stats object:`, folder.stats);
        console.log(`    - totalQuestions:`, folder.stats?.totalQuestions || 0);
        console.log(`    - totalQuizzes:`, folder.stats?.totalQuizzes || 0);
        console.log(`    - totalMaterials:`, folder.stats?.totalMaterials || 0);
      });
      
      setFolders(response.folders);
    } catch (err) {
      console.error('❌ Failed to load folders:', err);
      if (err instanceof ApiError) {
        console.error('🚨 API Error details:', {
          status: err.status,
          code: err.code,
          message: err.message,
          details: err.details
        });
        if (err.isAuthError()) {
          setError('Please log in again to continue');
        } else {
          setError(err.message);
        }
      } else {
        setError('Failed to load folders. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Calculate stats from actual folder data (with safe guards)
  const totalQuizzes = folders?.reduce((total, folder) => total + (folder.stats?.totalQuizzes || 0), 0) || 0;
  const totalQuestions = folders?.reduce((total, folder) => total + (folder.stats?.totalQuestions || 0), 0) || 0;
  const totalMaterials = folders?.reduce((total, folder) => total + (folder.stats?.totalMaterials || 0), 0) || 0;
  
  // Debug the calculations
  console.log('📊 DASHBOARD DEBUG - Stats Calculations:');
  console.log('  folders array:', folders);
  console.log('  folders length:', folders?.length || 0);
  console.log('  totalQuizzes calculated:', totalQuizzes);
  console.log('  totalQuestions calculated:', totalQuestions);
  console.log('  totalMaterials calculated:', totalMaterials);
  
  // Show breakdown of question calculation
  if (folders && folders.length > 0) {
    console.log('📊 DASHBOARD DEBUG - Question Count Breakdown:');
    let runningTotal = 0;
    folders.forEach((folder, index) => {
      const folderQuestions = folder.stats?.totalQuestions || 0;
      runningTotal += folderQuestions;
      console.log(`  ${folder.name}: ${folderQuestions} questions (running total: ${runningTotal})`);
    });
    console.log(`  FINAL TOTAL QUESTIONS: ${runningTotal}`);
  }
  
  // Calculate time saved (5 minutes per question)
  const totalMinutes = totalQuestions * 5;
  const formatTimeSaved = (minutes: number) => {
    if (minutes < 60) {
      return `${minutes} min`;
    } else {
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      if (remainingMinutes === 0) {
        return `${hours}h`;
      } else {
        return `${hours}h ${remainingMinutes}m`;
      }
    }
  };

  return (
      <div>
        <div className="dashboard-grid">
          <div className="card stat-card">
            <BookOpen size={24} style={{ margin: '0 auto var(--spacing-sm)', color: 'var(--color-primary)' }} />
            <div className="stat-number">{folders?.length || 0}</div>
            <div className="stat-label">Active Courses</div>
          </div>

          <div className="card stat-card">
            <FileText size={24} style={{ margin: '0 auto var(--spacing-sm)', color: 'var(--color-primary)' }} />
            <div className="stat-number">{totalQuizzes}</div>
            <div className="stat-label">Total Quizzes</div>
          </div>

          <div className="card stat-card">
            <CheckCircle size={24} style={{ margin: '0 auto var(--spacing-sm)', color: 'var(--color-primary)' }} />
            <div className="stat-number">{totalQuestions}</div>
            <div className="stat-label">Questions Generated</div>
          </div>

          <div className="card stat-card">
            <Clock size={24} style={{ margin: '0 auto var(--spacing-sm)', color: 'var(--color-primary)' }} />
            <div className="stat-number">~{formatTimeSaved(totalMinutes)}</div>
            <div className="stat-label">Time Saved</div>
          </div>
        </div>

        <div className="getting-started">
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Getting Started with CREATE</h2>
              <p className="card-description">
                Follow these steps to create your first AI-powered quiz
              </p>
            </div>

            <ol className="step-list">
              <li className="step-item">
                <div className="step-content">
                  <h3>Create a Course Folder</h3>
                  <p>Start by creating a folder for your course (e.g., "EOSC 533"). Specify how many quizzes you'll need.</p>
                </div>
              </li>

              <li className="step-item">
                <div className="step-content">
                  <h3>Upload Course Materials</h3>
                  <p>Upload PDFs, Word documents, or add web links containing your course content.</p>
                </div>
              </li>

              <li className="step-item">
                <div className="step-content">
                  <h3>Set Learning Objectives</h3>
                  <p>Define learning objectives for your quiz, or let AI generate them from your materials.</p>
                </div>
              </li>

              <li className="step-item">
                <div className="step-content">
                  <h3>Generate Questions</h3>
                  <p>Use Auto Mode for quick generation or Manual Mode for targeted question creation.</p>
                </div>
              </li>

              <li className="step-item">
                <div className="step-content">
                  <h3>Review & Export</h3>
                  <p>Review, edit, and reorder questions, then export as H5P for Canvas.</p>
                </div>
              </li>
            </ol>
          </div>
        </div>
      </div>
  );
};

export default Dashboard;