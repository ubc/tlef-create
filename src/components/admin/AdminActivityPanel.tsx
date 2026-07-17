import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { adminApi, AdminAuditEvent } from '../../services/api';

const AdminActivityPanel = () => {
  const [events, setEvents] = useState<AdminAuditEvent[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [action, setAction] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    adminApi.getActivity({ action, status, limit: 200 })
      .then(response => {
        if (response.data) { setEvents(response.data.events); setActions(response.data.actions); }
      })
      .catch(loadError => setError(loadError.message || 'Failed to load activity.'))
      .finally(() => setLoading(false));
  }, [action, status]);

  return (
    <section className="admin-surface">
      <div className="admin-surface-header">
        <div><h2><Activity size={19} /> Activity timeline</h2><p>Privacy-safe operation metadata. Request bodies and course content are not logged.</p></div>
        <div className="admin-filter-row">
          <select value={action} onChange={event => setAction(event.target.value)}><option value="">All actions</option>{actions.map(value => <option key={value} value={value}>{value}</option>)}</select>
          <select value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option><option value="success">Success</option><option value="failed">Failed</option></select>
        </div>
      </div>
      {error && <div className="admin-error"><AlertTriangle size={16} /> {error}</div>}
      {loading ? <div className="admin-empty">Loading activity...</div> : (
        <div className="admin-timeline">
          {events.map(event => (
            <article key={event._id} className={`admin-event ${event.status}`}>
              <span className="admin-event-icon">{event.status === 'success' ? <CheckCircle2 size={17} /> : <XCircle size={17} />}</span>
              <div className="admin-event-main"><strong>{event.action}</strong><span>{event.actor?.cwlId || 'Unknown user'} · {event.resourceType || 'resource'}{event.folder?.name ? ` · ${event.folder.name}` : ''}{event.quiz?.name ? ` / ${event.quiz.name}` : ''}</span></div>
              <div className="admin-event-meta"><span>{event.method} {event.statusCode || ''}</span><time>{new Date(event.createdAt).toLocaleString()}</time></div>
            </article>
          ))}
          {!events.length && <div className="admin-empty">No activity has been recorded yet.</div>}
        </div>
      )}
    </section>
  );
};

export default AdminActivityPanel;
