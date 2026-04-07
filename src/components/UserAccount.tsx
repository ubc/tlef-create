import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { API_URL } from '../config/api';
import { adminApi } from '../services/api';
import { setUser } from '../store/slices/appSlice';
import { Bug, User, ArrowLeft, Mail, Settings, HelpCircle, LogOut, Shield } from 'lucide-react';
import '../styles/components/UserAccount.css';

const UserAccount = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const reduxUser = useSelector((state: any) => state.app.user);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showHelpSupport, setShowHelpSupport] = useState(false);
  const [user, setLocalUser] = useState<any>(reduxUser);
  const [reportData, setReportData] = useState({ type: 'bug', description: '', email: '' });
  const [reportSubmitting, setReportSubmitting] = useState(false);

  useEffect(() => {
    if (!reduxUser) {
      fetchUserData();
    }
  }, [reduxUser]);

  const fetchUserData = async () => {
    try {
      const response = await fetch(`${API_URL}/api/create/auth/me`, { credentials: 'include' });
      if (response.ok) {
        const result = await response.json();
        const userData = result.data;
        console.log('[Auth Debug] /me full response:', JSON.stringify(userData, null, 2));
        if (userData?.authenticated && userData.user) {
          setLocalUser(userData.user);
          dispatch(setUser(userData.user));
        }
      }
    } catch (error) {
      console.error('Failed to fetch user data:', error);
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
      setShowReportModal(false);
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
              <button className="setting-item" onClick={() => alert('General Settings coming soon!')}>
                <Settings size={20} /> <span>General Settings</span>
              </button>
              <button className="setting-item" onClick={() => setShowHelpSupport(true)}>
                <HelpCircle size={20} /> <span>Help & Support</span>
              </button>
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
          <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowReportModal(false); }}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h4>Report Question Bug</h4>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowReportModal(false)}>×</button>
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
                  <button className="btn btn-outline" onClick={() => setShowReportModal(false)}>Cancel</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Help & Support Modal */}
      {showHelpSupport && (
        <div className="modal-overlay" onClick={() => setShowHelpSupport(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h4>Help & Support</h4>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowHelpSupport(false)}>×</button>
            </div>
            <div className="help-support-content">
              <div className="help-section">
                <h5>Contact Support</h5>
                <p>Need help? Our support team is here to assist you.</p>
                <p className="support-email"><Mail size={16} /> <a href="mailto:support@tlef-create.ubc.ca">support@tlef-create.ubc.ca</a></p>
              </div>
              <div className="help-section">
                <h5>Report an Issue</h5>
                <p>Found a bug? Use the "Report Question Bug" button in the Report Issues section.</p>
              </div>
              <div className="modal-actions">
                <button className="btn btn-primary" onClick={() => setShowHelpSupport(false)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserAccount;
