import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { API_URL } from '../config/api';
import { adminApi } from '../services/api';
import ApiKeySettings from './settings/ApiKeySettings';
import { setUser } from '../store/slices/appSlice';
import type { RootState } from '../store';
import { Bug, User, ArrowLeft, Settings, HelpCircle, LogOut, Shield, RotateCcw } from 'lucide-react';
import { restartOnboarding } from '../utils/onboarding';
import '../styles/components/UserAccount.css';

type AccountUser = NonNullable<RootState['app']['user']>;

const UserAccount = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const dispatch = useDispatch();
  const reduxUser = useSelector((state: RootState) => state.app.user);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showApiKeySettings, setShowApiKeySettings] = useState(false);
  const [user, setLocalUser] = useState<AccountUser | null>(reduxUser);
  const [reportData, setReportData] = useState({ type: 'bug', description: '', email: '' });
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [tutorialsRestarted, setTutorialsRestarted] = useState(false);

  useEffect(() => {
    if (reduxUser) {
      setLocalUser(reduxUser);
      return;
    }

    const fetchUserData = async () => {
      try {
        const response = await fetch(`${API_URL}/api/create/auth/me`, { credentials: 'include' });
        if (response.ok) {
          const result = await response.json() as {
            data?: { authenticated?: boolean; user?: AccountUser };
          };
          const userData = result.data;
          if (userData?.authenticated && userData.user) {
            setLocalUser(userData.user);
            dispatch(setUser(userData.user));
          }
        }
      } catch (error) {
        console.error('Failed to fetch user data:', error);
      }
    };

    void fetchUserData();
  }, [dispatch, reduxUser]);

  useEffect(() => {
    if (searchParams.get('report') === '1') {
      setShowReportModal(true);
    }
  }, [searchParams]);

  const closeReportModal = () => {
    setShowReportModal(false);
    if (searchParams.has('report')) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('report');
      setSearchParams(nextParams, { replace: true });
    }
  };

  const handleLogout = () => {
    dispatch(setUser(null));
    window.location.href = `${API_URL}/api/create/auth/logout`;
  };

  const handleSubmitReport = async () => {
    setReportSubmitting(true);
    try {
      await adminApi.submitReport(reportData.type, reportData.description, reportData.email || undefined);
      closeReportModal();
      setReportData({ type: 'bug', description: '', email: '' });
      alert('Report submitted successfully! We will review it and get back to you.');
    } catch {
      alert('Failed to submit report. Please try again.');
    } finally {
      setReportSubmitting(false);
    }
  };

  return (
    <div className="user-account">
      <div className="page-header">
        <button className="btn btn-ghost" onClick={() => navigate('/')}>
          <ArrowLeft size={16} /> Back to Dashboard
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
                <h2>{user?.displayName || user?.cwlId || 'Loading...'}</h2>
                <p className="user-email">{user?.email || (user?.cwlId ? `${user.cwlId}@ubc.ca` : '')}</p>
                {user?.isAdmin && (
                  <span className="admin-badge"><Shield size={12} /> Admin</span>
                )}
              </div>
            </div>
            <button className="btn btn-outline btn-danger" onClick={handleLogout} style={{ marginLeft: 'auto' }}>
              <LogOut size={16} /> Sign Out
            </button>
          </div>
        </div>

        <div className="account-sections">
          {/* Admin Dashboard Button */}
          {user?.isAdmin && (
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Administration</h3>
                <p className="card-description">View platform usage and manage bug reports</p>
              </div>
              <div className="settings-list">
                <button className="setting-item admin-item" onClick={() => navigate('/admin')}>
                  <Shield size={20} />
                  <span>Admin Dashboard</span>
                </button>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Account Settings</h3>
              <p className="card-description">Manage your account preferences and settings</p>
            </div>
            <div className="settings-list">
              <button className="setting-item" onClick={() => setShowApiKeySettings(s => !s)}>
                <Settings size={20} /> <span>General Settings</span>
              </button>
              {showApiKeySettings && (
                <div style={{ padding: '12px 0' }}>
                  <ApiKeySettings />
                </div>
              )}
              <Link className="setting-item" to="/help">
                <HelpCircle size={20} /> <span>Help & Support</span>
              </Link>
              <button
                className="setting-item"
                onClick={() => {
                  restartOnboarding();
                  setTutorialsRestarted(true);
                }}
              >
                <RotateCcw size={20} /> <span>Restart Feature Tutorials</span>
              </button>
              {tutorialsRestarted && (
                <p className="tutorial-restart-status" role="status">
                  Tutorials restarted. Return to your course or learning object to see them again.
                </p>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Report Issues</h3>
              <p className="card-description">Help us improve by reporting bugs or issues you encounter</p>
            </div>
            <div className="report-section">
              <button className="btn btn-outline report-btn" onClick={() => setShowReportModal(true)}>
                <Bug size={20} /> Report Question Bug
              </button>
              <p className="report-description">Found an issue with a question? Let us know so we can fix it quickly.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Report Modal */}
      {showReportModal && (
        <div className="report-modal">
          <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeReportModal(); }}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h4>Report Question Bug</h4>
                <button className="btn btn-ghost btn-sm" onClick={closeReportModal}>×</button>
              </div>
              <div className="report-form">
                <div className="form-field">
                  <label>Report Type:</label>
                  <select className="select-input" value={reportData.type} onChange={(e) => setReportData({...reportData, type: e.target.value})}>
                    <option value="bug">Question Bug</option>
                    <option value="incorrect">Incorrect Answer</option>
                    <option value="unclear">Unclear Question</option>
                    <option value="other">Other Issue</option>
                  </select>
                </div>
                <div className="form-field">
                  <label>Your Email (optional):</label>
                  <input type="email" className="input" placeholder="your.email@example.com" value={reportData.email} onChange={(e) => setReportData({...reportData, email: e.target.value})} />
                </div>
                <div className="form-field">
                  <label>Description:</label>
                  <textarea className="textarea" placeholder="Please describe the issue you encountered..." rows={4} value={reportData.description} onChange={(e) => setReportData({...reportData, description: e.target.value})} />
                </div>
                <div className="modal-actions">
                  <button className="btn btn-primary" onClick={handleSubmitReport} disabled={!reportData.description.trim() || reportSubmitting}>
                    <Bug size={16} /> {reportSubmitting ? 'Submitting...' : 'Submit Report'}
                  </button>
                  <button className="btn btn-outline" onClick={closeReportModal}>Cancel</button>
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
