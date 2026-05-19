import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { adminApi } from '../services/api';
import { ArrowLeft, Users, BookOpen, FileQuestion, MessageSquare, CheckCircle, Clock, AlertCircle, Key } from 'lucide-react';
import '../styles/components/AdminDashboard.css';

interface PlatformStats {
  totalUsers: number;
  totalFolders: number;
  totalQuizzes: number;
  totalQuestions: number;
  openReports: number;
}

interface UserStat {
  cwlId: string;
  coursesCreated: number;
  quizzesGenerated: number;
  questionsCreated: number;
  lastLogin: string;
  joinedAt: string;
}

interface BugReport {
  _id: string;
  reporter: { cwlId: string };
  type: string;
  description: string;
  email: string;
  status: string;
  adminNotes: string;
  createdAt: string;
}

interface ManagedUser {
  _id: string;
  cwlId: string;
  displayName: string;
  email: string;
  canUseEnvKey: boolean;
  lastLogin: string;
  createdAt: string;
}

const AdminDashboard = () => {
  const navigate = useNavigate();
  const user = useSelector((state: any) => state.app.user);
  const [platform, setPlatform] = useState<PlatformStats | null>(null);
  const [users, setUsers] = useState<UserStat[]>([]);
  const [reports, setReports] = useState<BugReport[]>([]);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [filterEnvOnly, setFilterEnvOnly] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'reports' | 'api-keys'>('overview');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.isAdmin) {
      navigate('/account');
      return;
    }
    loadData();
  }, [user]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [statsRes, reportsRes, usersRes] = await Promise.all([
        adminApi.getStats(),
        adminApi.getReports(),
        adminApi.getUsers()
      ]);
      if (statsRes.data) {
        setPlatform(statsRes.data.platform);
        setUsers(statsRes.data.users);
      }
      if (reportsRes.data) {
        setReports(reportsRes.data.reports);
      }
      if (usersRes.data) {
        setManagedUsers(usersRes.data.users);
      }
    } catch (err) {
      console.error('Failed to load admin data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleUserEnvKey = async (userId: string, current: boolean) => {
    try {
      await adminApi.updateEnvKeyPermission(userId, !current);
      setManagedUsers(prev => prev.map(u => u._id === userId ? { ...u, canUseEnvKey: !current } : u));
    } catch {
      alert('Failed to update permission');
    }
  };

  const handleToggleAll = async (canUseEnvKey: boolean) => {
    if (!confirm(`${canUseEnvKey ? 'Allow' : 'Revoke'} env key access for ALL users?`)) return;
    try {
      await adminApi.updateAllEnvKeyPermission(canUseEnvKey);
      setManagedUsers(prev => prev.map(u => ({ ...u, canUseEnvKey })));
    } catch {
      alert('Failed to update permissions');
    }
  };

  const handleUpdateReport = async (id: string, status: string) => {
    try {
      await adminApi.updateReport(id, status);
      setReports(prev => prev.map(r => r._id === id ? { ...r, status } : r));
    } catch {
      alert('Failed to update report');
    }
  };

  const statusIcon = (status: string) => {
    if (status === 'open') return <AlertCircle size={14} className="status-open" />;
    if (status === 'in-progress') return <Clock size={14} className="status-progress" />;
    return <CheckCircle size={14} className="status-resolved" />;
  };

  if (loading) {
    return (
      <div className="admin-dashboard">
        <div className="page-header">
          <button className="btn btn-ghost" onClick={() => navigate('/account')}><ArrowLeft size={16} /> Back</button>
          <h1>Admin Dashboard</h1>
        </div>
        <p style={{ textAlign: 'center', padding: '2rem' }}>Loading...</p>
      </div>
    );
  }

  return (
    <div className="admin-dashboard">
      <div className="page-header">
        <button className="btn btn-ghost" onClick={() => navigate('/account')}>
          <ArrowLeft size={16} /> Back
        </button>
        <h1>Admin Dashboard</h1>
      </div>

      {/* Tab Bar */}
      <div className="admin-tabs">
        <button className={`admin-tab ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
          Overview
        </button>
        <button className={`admin-tab ${activeTab === 'reports' ? 'active' : ''}`} onClick={() => setActiveTab('reports')}>
          Bug Reports {platform?.openReports ? <span className="badge">{platform.openReports}</span> : null}
        </button>
        <button className={`admin-tab ${activeTab === 'api-keys' ? 'active' : ''}`} onClick={() => setActiveTab('api-keys')}>
          API Keys
        </button>
      </div>

      {activeTab === 'overview' && (
        <>
          {/* Platform Stats */}
          <div className="stats-grid">
            <div className="stat-card">
              <Users size={24} />
              <div className="stat-value">{platform?.totalUsers || 0}</div>
              <div className="stat-label">Users</div>
            </div>
            <div className="stat-card">
              <BookOpen size={24} />
              <div className="stat-value">{platform?.totalFolders || 0}</div>
              <div className="stat-label">Courses</div>
            </div>
            <div className="stat-card">
              <FileQuestion size={24} />
              <div className="stat-value">{platform?.totalQuizzes || 0}</div>
              <div className="stat-label">Quizzes</div>
            </div>
            <div className="stat-card">
              <MessageSquare size={24} />
              <div className="stat-value">{platform?.totalQuestions || 0}</div>
              <div className="stat-label">Questions</div>
            </div>
          </div>

          {/* User Stats Table */}
          <div className="card" style={{ marginTop: '1.5rem' }}>
            <div className="card-header">
              <h3 className="card-title">User Activity</h3>
              <p className="card-description">Question generation stats per user</p>
            </div>
            <div className="admin-table-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Courses</th>
                    <th>Quizzes</th>
                    <th>Questions</th>
                    <th>Last Login</th>
                    <th>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u, i) => (
                    <tr key={u.cwlId || i}>
                      <td className="user-cell">{u.cwlId}</td>
                      <td>{u.coursesCreated}</td>
                      <td>{u.quizzesGenerated}</td>
                      <td><strong>{u.questionsCreated}</strong></td>
                      <td>{u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : '—'}</td>
                      <td>{u.joinedAt ? new Date(u.joinedAt).toLocaleDateString() : '—'}</td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--color-muted-foreground)' }}>No users yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {activeTab === 'api-keys' && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <div className="card-header">
            <div>
              <h3 className="card-title"><Key size={16} style={{ display: 'inline', marginRight: 6 }} />Env Key Access</h3>
              <p className="card-description">Control which users can use the system .env API key</p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-sm btn-outline" onClick={() => setFilterEnvOnly(f => !f)}>
                {filterEnvOnly ? 'Show All' : 'Show Env Key Users'}
              </button>
              <button className="btn btn-sm btn-outline" onClick={() => handleToggleAll(true)}>Allow All</button>
              <button className="btn btn-sm btn-ghost" onClick={() => handleToggleAll(false)}>Revoke All</button>
            </div>
          </div>
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Email</th>
                  <th>Joined</th>
                  <th>Env Key Access</th>
                </tr>
              </thead>
              <tbody>
                {managedUsers
                  .filter(u => !filterEnvOnly || u.canUseEnvKey)
                  .map(u => (
                    <tr key={u._id}>
                      <td className="user-cell">{u.cwlId}</td>
                      <td style={{ opacity: 0.7 }}>{u.email || '—'}</td>
                      <td>{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}</td>
                      <td>
                        <button
                          className={`btn btn-sm ${u.canUseEnvKey ? 'btn-outline' : 'btn-ghost'}`}
                          onClick={() => handleToggleUserEnvKey(u._id, u.canUseEnvKey)}
                        >
                          {u.canUseEnvKey ? 'Enabled' : 'Disabled'}
                        </button>
                      </td>
                    </tr>
                  ))}
                {managedUsers.filter(u => !filterEnvOnly || u.canUseEnvKey).length === 0 && (
                  <tr><td colSpan={4} style={{ textAlign: 'center', opacity: 0.6 }}>No users found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'reports' && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <div className="card-header">
            <h3 className="card-title">Bug Reports</h3>
            <p className="card-description">{reports.length} total reports</p>
          </div>
          {reports.length === 0 ? (
            <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-muted-foreground)' }}>No bug reports yet</p>
          ) : (
            <div className="reports-list">
              {reports.map(report => (
                <div key={report._id} className={`report-card report-${report.status}`}>
                  <div className="report-header">
                    <div className="report-meta">
                      {statusIcon(report.status)}
                      <span className="report-type">{report.type}</span>
                      <span className="report-user">by {report.reporter?.cwlId || 'unknown'}</span>
                      <span className="report-date">{new Date(report.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div className="report-actions">
                      {report.status === 'open' && (
                        <button className="btn btn-ghost btn-sm" onClick={() => handleUpdateReport(report._id, 'in-progress')}>
                          Mark In Progress
                        </button>
                      )}
                      {(report.status === 'open' || report.status === 'in-progress') && (
                        <button className="btn btn-ghost btn-sm" onClick={() => handleUpdateReport(report._id, 'resolved')}>
                          Resolve
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="report-description">{report.description}</p>
                  {report.email && <p className="report-email">Contact: {report.email}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
