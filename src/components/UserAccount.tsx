import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../config/api';
import { Bug, User, ArrowLeft, Mail, Settings, HelpCircle, LogOut } from 'lucide-react';
import '../styles/components/UserAccount.css';

const UserAccount = () => {
  const navigate = useNavigate();
  const [showReportModal, setShowReportModal] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [reportData, setReportData] = useState({
    type: 'bug',
    description: '',
    email: ''
  });

  useEffect(() => {
    // Fetch user data
    fetchUserData();
  }, []);

  const fetchUserData = async () => {
    try {
      const response = await fetch(`${API_URL}/api/create/auth/me`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        if (data.authenticated) {
          setUser(data.user);
        }
      }
    } catch (error) {
      console.error('Failed to fetch user data:', error);
    }
  };


  const handleLogout = () => {
    // Redirect to logout endpoint
    window.location.href = `${import.meta.env.VITE_API_URL}/api/create/auth/logout`;
  };

  const handleSubmitReport = () => {
    // Mock report submission
    console.log('Report submitted:', reportData);
    alert('Report submitted successfully! We will review it and get back to you.');
    setShowReportModal(false);
    setReportData({ type: 'bug', description: '', email: '' });
  };

  return (
      <div className="user-account">
        <div className="page-header">
          <button
              className="btn btn-ghost"
              onClick={() => navigate(-1)}
          >
            <ArrowLeft size={16} />
            Go Back
          </button>
          <h1>User Account</h1>
        </div>

        <div className="account-content">
          <div className="card">
            <div className="card-header">
              <div className="user-profile">
                <div className="user-avatar">
                  <User size={48} />
                </div>
                <div className="user-info">
                  <h2>{user?.cwlId || 'Loading...'}</h2>
                  <p className="user-email">{user?.cwlId ? `${user.cwlId}@ubc.ca` : ''}</p>
                </div>
              </div>
              <button
                className="btn btn-outline btn-danger"
                onClick={handleLogout}
                style={{ marginLeft: 'auto' }}
              >
                <LogOut size={16} />
                Sign Out
              </button>
            </div>
          </div>

          <div className="account-sections">
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Account Settings</h3>
                <p className="card-description">
                  Manage your account preferences and settings
                </p>
              </div>
              <div className="settings-list">
                <div className="setting-item">
                  <Settings size={20} />
                  <span>General Settings</span>
                </div>
                <div className="setting-item">
                  <Mail size={20} />
                  <span>Email Preferences</span>
                </div>
                <div className="setting-item">
                  <HelpCircle size={20} />
                  <span>Help & Support</span>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Report Issues</h3>
                <p className="card-description">
                  Help us improve by reporting bugs or issues you encounter
                </p>
              </div>
              <div className="report-section">
                <button
                    className="btn btn-outline report-btn"
                    onClick={() => setShowReportModal(true)}
                >
                  <Bug size={20} />
                  Report Question Bug
                </button>
                <p className="report-description">
                  Found an issue with a question? Let us know so we can fix it quickly.
                </p>
              </div>
            </div>
          </div>
        </div>

        {showReportModal && (
            <div className="report-modal">
              <div 
                className="modal-overlay" 
                onClick={(e) => {
                  // Only close if clicking on the overlay itself, not its children
                  if (e.target === e.currentTarget) {
                    setShowReportModal(false);
                  }
                }}
              >
                <div 
                  className="modal-content"
                  onClick={(e) => e.stopPropagation()}
                >
                <div className="modal-header">
                  <h4>Report Question Bug</h4>
                  <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setShowReportModal(false)}
                  >
                    ×
                  </button>
                </div>

                <div className="report-form">
                  <div className="form-field">
                    <label>Report Type:</label>
                    <select
                        className="select-input"
                        value={reportData.type}
                        onChange={(e) => setReportData({...reportData, type: e.target.value})}
                    >
                      <option value="bug">Question Bug</option>
                      <option value="incorrect">Incorrect Answer</option>
                      <option value="unclear">Unclear Question</option>
                      <option value="other">Other Issue</option>
                    </select>
                  </div>

                  <div className="form-field">
                    <label>Your Email (optional):</label>
                    <input
                        type="email"
                        className="input"
                        placeholder="your.email@example.com"
                        value={reportData.email}
                        onChange={(e) => setReportData({...reportData, email: e.target.value})}
                    />
                  </div>

                  <div className="form-field">
                    <label>Description:</label>
                    <textarea
                        className="textarea"
                        placeholder="Please describe the issue you encountered..."
                        rows={4}
                        value={reportData.description}
                        onChange={(e) => setReportData({...reportData, description: e.target.value})}
                    />
                  </div>

                  <div className="modal-actions">
                    <button
                        className="btn btn-primary"
                        onClick={handleSubmitReport}
                        disabled={!reportData.description.trim()}
                    >
                      <Bug size={16} />
                      Submit Report
                    </button>
                    <button
                        className="btn btn-outline"
                        onClick={() => setShowReportModal(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
                </div>
              </div>
            </div>
        )}

      </div>
  );
};

export default UserAccount;