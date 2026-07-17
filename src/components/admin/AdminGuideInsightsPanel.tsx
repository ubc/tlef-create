import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bot, MessageCircle, Search, ThumbsDown, ThumbsUp } from 'lucide-react';
import { adminApi, AdminGuideInteraction } from '../../services/api';

interface GuideSummary {
  total: number;
  helpful: number;
  notHelpful: number;
  fallback: number;
  failed: number;
  helpfulRate: number | null;
}

const AdminGuideInsightsPanel = () => {
  const [interactions, setInteractions] = useState<AdminGuideInteraction[]>([]);
  const [summary, setSummary] = useState<GuideSummary>({ total: 0, helpful: 0, notHelpful: 0, fallback: 0, failed: 0, helpfulRate: null });
  const [commonQuestions, setCommonQuestions] = useState<Array<{ question: string; count: number }>>([]);
  const [rating, setRating] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await adminApi.getGuideInsights({ rating, status, search: submittedSearch, limit: 150 });
      if (response.data) {
        setInteractions(response.data.interactions);
        setSummary(response.data.summary);
        setCommonQuestions(response.data.commonQuestions);
      }
    } catch (loadError) {
      setError((loadError as Error).message || 'Failed to load CREATE Guide insights.');
    } finally {
      setLoading(false);
    }
  }, [rating, status, submittedSearch]);

  useEffect(() => { void load(); }, [load]);

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    setSubmittedSearch(search.trim());
  };

  return (
    <div className="admin-panel-stack">
      <div className="admin-metric-grid">
        <div className="admin-metric"><MessageCircle size={19} /><strong>{summary.total}</strong><span>Guide questions</span></div>
        <div className="admin-metric positive"><ThumbsUp size={19} /><strong>{summary.helpfulRate === null ? '—' : `${summary.helpfulRate}%`}</strong><span>Helpful rating</span></div>
        <div className="admin-metric negative"><ThumbsDown size={19} /><strong>{summary.notHelpful}</strong><span>Needs improvement</span></div>
        <div className="admin-metric"><Bot size={19} /><strong>{summary.fallback}</strong><span>Fallback answers</span></div>
      </div>

      <section className="admin-surface">
        <div className="admin-surface-header">
          <div><h2>CREATE Guide conversations</h2><p>Questions, grounded answers, citations, and instructor feedback.</p></div>
          <form className="admin-filter-row" onSubmit={handleSearch}>
            <select value={rating} onChange={event => setRating(event.target.value)} aria-label="Filter rating">
              <option value="">All ratings</option><option value="helpful">Helpful</option><option value="not-helpful">Not helpful</option><option value="unrated">Unrated</option>
            </select>
            <select value={status} onChange={event => setStatus(event.target.value)} aria-label="Filter status">
              <option value="">All statuses</option><option value="completed">Completed</option><option value="failed">Failed</option><option value="processing">Processing</option>
            </select>
            <label className="admin-search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search questions" /></label>
          </form>
        </div>
        {error && <div className="admin-error"><AlertTriangle size={16} /> {error}</div>}
        {loading ? <div className="admin-empty">Loading conversations...</div> : (
          <div className="admin-conversation-list">
            {interactions.map(interaction => (
              <details key={interaction._id} className="admin-conversation">
                <summary>
                  <div><strong>{interaction.question}</strong><span>{interaction.user?.cwlId || 'Unknown user'} · {new Date(interaction.createdAt).toLocaleString()}</span></div>
                  <div className="admin-chip-row">
                    {interaction.rating?.value === 'helpful' && <span className="admin-chip success">Helpful</span>}
                    {interaction.rating?.value === 'not-helpful' && <span className="admin-chip danger">Not helpful</span>}
                    {interaction.fallback && <span className="admin-chip warning">Fallback</span>}
                    <span className={`admin-chip ${interaction.status === 'failed' ? 'danger' : ''}`}>{interaction.status}</span>
                  </div>
                </summary>
                <div className="admin-conversation-body">
                  <div className="admin-answer"><span>Answer</span><p>{interaction.answer || 'No answer was recorded.'}</p></div>
                  <dl className="admin-detail-grid">
                    <div><dt>Page</dt><dd>{interaction.context?.activeTab || interaction.context?.pageTitle || 'Unknown'}</dd></div>
                    <div><dt>Model</dt><dd>{interaction.model || 'Fallback only'}</dd></div>
                    <div><dt>Duration</dt><dd>{interaction.durationMs ? `${(interaction.durationMs / 1000).toFixed(1)}s` : '—'}</dd></div>
                    <div><dt>Route</dt><dd>{interaction.context?.route || '—'}</dd></div>
                  </dl>
                  {interaction.sources?.length ? <div className="admin-source-row">Sources: {interaction.sources.map(source => source.title).filter(Boolean).join(', ')}</div> : null}
                  {interaction.rating?.value === 'not-helpful' && (
                    <div className="admin-feedback-note"><strong>Feedback:</strong> {[...(interaction.rating.reasons || []), interaction.rating.comment || ''].filter(Boolean).join(' · ') || 'No details provided'}</div>
                  )}
                </div>
              </details>
            ))}
            {!interactions.length && <div className="admin-empty">No conversations match these filters.</div>}
          </div>
        )}
      </section>

      <section className="admin-surface compact">
        <div className="admin-surface-header"><div><h2>Frequently asked</h2><p>Repeated questions can reveal missing product guidance.</p></div></div>
        <div className="admin-common-list">
          {commonQuestions.map(item => <div key={item.question}><span>{item.question}</span><strong>{item.count}</strong></div>)}
          {!commonQuestions.length && <div className="admin-empty">No completed Guide questions yet.</div>}
        </div>
      </section>
    </div>
  );
};

export default AdminGuideInsightsPanel;
