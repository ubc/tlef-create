import type { QuestionGenerationJob } from '../../services/api';

export default function GenerationJobStatus({ job, busy, message, onRefresh, onCloseUnregistered }: {
  job: QuestionGenerationJob | null;
  busy: boolean;
  message: string | null;
  onRefresh: () => Promise<void>;
  onCloseUnregistered?: () => Promise<void>;
}) {
  if (!job && !busy && !message) return null;
  const status = job?.status;
  return (
    <div className="generation-preserved-note" role="status" style={{ padding: '12px 16px', marginBottom: 16 }}>
      <strong>{status === 'succeeded' ? 'Generation saved.' : busy ? 'Generation task status' : 'Saved questions preserved.'}</strong>{' '}
      {message || (busy
        ? job ? `${job.completedQuestions} of ${job.totalQuestions} questions prepared. ${status === 'committing' ? 'Saving the complete batch.' : 'You can leave or refresh this page; this task will be recovered automatically.'}` : 'Checking the saved task status…'
        : status === 'succeeded' ? `All ${job?.totalQuestions} questions were saved together.` : job?.message || 'The batch was not published. Review your saved questions before starting a new task.')}
      {!busy && status !== 'succeeded' && job?.items.some(item => item.status === 'failed') && (
        <ul>{job.items.filter(item => item.status === 'failed').slice(0, 3).map(item => (
          <li key={item.questionId}>Question {item.index + 1}: {item.message || 'The draft could not be completed.'}</li>
        ))}</ul>
      )}
      {message && <button type="button" className="btn btn-secondary" onClick={() => void onRefresh()} style={{ marginLeft: 12 }}>Check task status</button>}
      {onCloseUnregistered && <button type="button" className="btn btn-secondary" onClick={() => void onCloseUnregistered()} style={{ marginLeft: 12 }}>Close unregistered request</button>}
    </div>
  );
}
