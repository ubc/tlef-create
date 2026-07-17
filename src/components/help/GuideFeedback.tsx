import { useState } from 'react';
import { Check, ThumbsDown, ThumbsUp } from 'lucide-react';
import { API_URL } from '../../config/api';
import { notifyAuthExpired } from '../../utils/authEvents';

export type GuideRating = 'helpful' | 'not-helpful';

interface GuideFeedbackProps {
  interactionId: string;
  currentRating?: GuideRating;
  onRated: (rating: GuideRating) => void;
}

const REASONS = [
  ['incorrect', 'Incorrect'],
  ['outdated', 'Outdated'],
  ['unclear', 'Unclear'],
  ['incomplete', 'Incomplete'],
  ['other', 'Other']
] as const;

const GuideFeedback = ({ interactionId, currentRating, onRated }: GuideFeedbackProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const saveRating = async (value: GuideRating) => {
    setIsSaving(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/api/create/help/interactions/${interactionId}/rating`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, reasons, comment })
      });
      if (response.status === 401) notifyAuthExpired();
      if (!response.ok) throw new Error('Feedback could not be saved.');
      onRated(value);
      setIsExpanded(false);
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  if (currentRating) {
    return <div className="create-guide-feedback-saved"><Check size={13} /> Feedback saved</div>;
  }

  return (
    <div className="create-guide-feedback">
      <div className="create-guide-feedback-question">
        <span>Was this helpful?</span>
        <button type="button" onClick={() => void saveRating('helpful')} disabled={isSaving} aria-label="Helpful answer"><ThumbsUp size={14} /></button>
        <button type="button" onClick={() => setIsExpanded(true)} disabled={isSaving} aria-label="Not helpful answer"><ThumbsDown size={14} /></button>
      </div>
      {isExpanded && (
        <div className="create-guide-feedback-form">
          <strong>What could be better?</strong>
          <div className="create-guide-feedback-reasons">
            {REASONS.map(([value, label]) => (
              <label key={value}>
                <input
                  type="checkbox"
                  checked={reasons.includes(value)}
                  onChange={() => setReasons(current => current.includes(value)
                    ? current.filter(reason => reason !== value)
                    : [...current, value])}
                />
                {label}
              </label>
            ))}
          </div>
          <textarea value={comment} onChange={event => setComment(event.target.value)} placeholder="Optional details" maxLength={1000} rows={2} />
          {error && <span className="create-guide-feedback-error">{error}</span>}
          <div className="create-guide-feedback-actions">
            <button type="button" onClick={() => setIsExpanded(false)} disabled={isSaving}>Cancel</button>
            <button type="button" className="primary" onClick={() => void saveRating('not-helpful')} disabled={isSaving}>Submit</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default GuideFeedback;
