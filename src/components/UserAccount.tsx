import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bug, User, ArrowLeft, Mail, Settings, HelpCircle, LogOut, Brain, Cpu } from 'lucide-react';
import '../styles/components/UserAccount.css';

const UserAccount = () => {
  const navigate = useNavigate();
  const [showReportModal, setShowReportModal] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [preferences, setPreferences] = useState({
    llmProvider: 'ollama',
    llmModel: 'llama3.1:8b',
    llmSettings: {
      temperature: 0.7,
      maxTokens: 2000
    }
  });
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [reportData, setReportData] = useState({
    type: 'bug',
    description: '',
    email: ''
  });

  useEffect(() => {
    // Fetch user data and preferences
    fetchUserData();
    fetchUserPreferences();
  }, []);

  const fetchUserData = async () => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/create/auth/me`, {
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

  const fetchUserPreferences = async () => {
    try {
      console.log('🔍 Fetching user preferences...');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/create/auth/preferences`, {
        credentials: 'include'
      });
      
      console.log('📡 Fetch response status:', response.status);
      
      if (response.ok) {
        const data = await response.json();
        console.log('📡 Fetched preferences data:', data);
        
        if (data.data && data.data.preferences) {
          console.log('✅ Setting preferences:', data.data.preferences);
          setPreferences(data.data.preferences);
        } else {
          console.log('⚠️ No preferences found in response, using defaults');
        }
      } else {
        console.error('❌ Failed to fetch preferences, status:', response.status);
      }
    } catch (error) {
      console.error('❌ Failed to fetch user preferences:', error);
    }
  };

  const savePreferences = async () => {
    setIsSaving(true);
    try {
      console.log('🔄 Saving preferences:', preferences);
      console.log('🔄 API URL:', `${import.meta.env.VITE_API_URL}/api/create/auth/preferences`);
      
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/create/auth/preferences`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(preferences)
      });
      
      console.log('📡 Response status:', response.status);
      const responseData = await response.json();
      console.log('📡 Response data:', responseData);
      
      if (response.ok) {
        alert('Preferences saved successfully!');
        setShowSettingsModal(false);
        // Refresh preferences to confirm they were saved
        await fetchUserPreferences();
      } else {
        console.error('❌ Save failed:', responseData);
        alert(`Failed to save preferences: ${responseData.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('❌ Save error:', error);
      alert(`Failed to save preferences: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenSettingsModal = async () => {
    console.log('🔧 Opening settings modal...');
    setShowSettingsModal(true);
    // Fetch fresh preferences when opening the modal
    await fetchUserPreferences();
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
                <div 
                  className="setting-item clickable" 
                  onClick={handleOpenSettingsModal}
                  style={{ cursor: 'pointer' }}
                >
                  <Brain size={20} />
                  <span>AI Model Preferences</span>
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

        {showSettingsModal && (
            <div className="report-modal">
              <div 
                className="modal-overlay" 
                onClick={(e) => {
                  // Only close if clicking on the overlay itself, not its children
                  if (e.target === e.currentTarget) {
                    setShowSettingsModal(false);
                  }
                }}
              >
                <div 
                  className="modal-content" 
                  style={{ maxWidth: '600px' }}
                  onClick={(e) => e.stopPropagation()}
                >
                <div className="modal-header">
                  <h4>AI Model Preferences</h4>
                  <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setShowSettingsModal(false)}
                  >
                    ×
                  </button>
                </div>

                <div className="report-form">
                  <div className="form-field">
                    <label>
                      <Cpu size={16} style={{ marginRight: '8px' }} />
                      AI Provider:
                    </label>
                    <select
                        className="select-input"
                        value={preferences.llmProvider}
                        onChange={(e) => {
                          const provider = e.target.value as 'ollama' | 'openai';
                          setPreferences({
                            ...preferences, 
                            llmProvider: provider,
                            llmModel: provider === 'openai' ? 'gpt-5-nano' : 'llama3.1:8b'
                          });
                        }}
                    >
                      <option value="ollama">Ollama (Local LLM)</option>
                      <option value="openai">OpenAI (Cloud API)</option>
                    </select>
                    <small style={{ color: '#666', fontSize: '12px', display: 'block', marginTop: '4px' }}>
                      {preferences.llmProvider === 'ollama' ? 
                        'Free local AI model - requires Ollama installation' : 
                        'Paid cloud AI service - higher quality but requires API key'}
                    </small>
                  </div>

                  <div className="form-field">
                    <label>
                      <Brain size={16} style={{ marginRight: '8px' }} />
                      Model:
                    </label>
                    <select
                        className="select-input"
                        value={preferences.llmModel}
                        onChange={(e) => setPreferences({...preferences, llmModel: e.target.value})}
                    >
                      {preferences.llmProvider === 'openai' ? (
                        <>
                          <option value="gpt-5-nano">GPT-5 Nano (Recommended)</option>
                          <option value="gpt-4o-mini">GPT-4o Mini</option>
                        </>
                      ) : (
                        <>
                          <option value="llama3.1:8b">Llama 3.1 8B</option>
                        </>
                      )}
                    </select>
                  </div>

                  {preferences.llmProvider === 'ollama' && (
                    <div className="form-field">
                      <label>Temperature: {preferences.llmSettings.temperature}</label>
                      <input
                          type="range"
                          min="0"
                          max="2"
                          step="0.1"
                          value={preferences.llmSettings.temperature}
                          onChange={(e) => setPreferences({
                            ...preferences, 
                            llmSettings: {
                              ...preferences.llmSettings, 
                              temperature: parseFloat(e.target.value)
                            }
                          })}
                          style={{ width: '100%' }}
                      />
                      <small style={{ color: '#666', fontSize: '12px' }}>
                        Lower = more focused, Higher = more creative
                      </small>
                    </div>
                  )}

                  <div className="form-field">
                    <label>Max Tokens:</label>
                    <input
                        type="number"
                        className="input"
                        min="100"
                        max="4000"
                        value={preferences.llmSettings.maxTokens}
                        onChange={(e) => setPreferences({
                          ...preferences, 
                          llmSettings: {
                            ...preferences.llmSettings, 
                            maxTokens: parseInt(e.target.value)
                          }
                        })}
                    />
                    <small style={{ color: '#666', fontSize: '12px' }}>
                      Maximum length of AI responses (100-4000)
                    </small>
                  </div>

                  <div className="modal-actions">
                    <button
                        className="btn btn-primary"
                        onClick={savePreferences}
                        disabled={isSaving}
                    >
                      <Settings size={16} />
                      {isSaving ? 'Saving...' : 'Save Preferences'}
                    </button>
                    <button
                        className="btn btn-outline"
                        onClick={() => setShowSettingsModal(false)}
                        disabled={isSaving}
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