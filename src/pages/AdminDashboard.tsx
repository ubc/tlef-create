import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { adminApi } from '../services/api';
import { ArrowLeft, Users, BookOpen, FileQuestion, MessageSquare, CheckCircle, Clock, AlertCircle } from 'lucide-react';
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

const AdminDashboard = () => {
  const navigate = useNavigate();
  const user = useSelector((state: any) => state.app.user);
  const [platform, setPlatform] = useState<PlatformStats | null>(null);
  const [users, setUsers] = useState<UserStat[]>([]);
  const [reports, setReports] = useState<BugReport[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'reports'>('overview');
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
      const [statsRes, reportsRes] = await Promise.all([
        adminApi.getStats(),
        adminApi.getReports()
      ]);
      if (statsRes.data) {
        setPlatform(statsRes.data.platform);
        setUsers(statsRes.data.users);
      }
      if (reportsRes.data) {
        setReports(reportsRes.data.reports);
      }
    } catch (err) {
      console.error('Failed to load admin data:', err);
    } finally {
      setLoading(false);
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
                  {users.map(u => (
                    <tr key={u.cwlId}>
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
