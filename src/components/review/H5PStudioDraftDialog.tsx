import { AlertTriangle, CheckCircle2, CopyPlus, ExternalLink } from 'lucide-react';
import type { H5PStudioContent } from '../../services/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog';

interface H5PStudioDraftDialogProps {
  draft: H5PStudioContent | null;
  sourceOutdated: boolean;
  loading: boolean;
  onOpenExisting: () => void;
  onCreateFresh: () => void;
  onCancel: () => void;
}

function formatLastEdited(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString();
}

const H5PStudioDraftDialog = ({
  draft,
  sourceOutdated,
  loading,
  onOpenExisting,
  onCreateFresh,
  onCancel
}: H5PStudioDraftDialogProps) => (
  <Dialog
    open={Boolean(draft)}
    onOpenChange={open => {
      if (!open && !loading) onCancel();
    }}
  >
    {draft && (
      <DialogContent
        className={`h5p-draft-dialog${loading ? ' is-loading' : ''}`}
        onEscapeKeyDown={event => {
          if (loading) event.preventDefault();
        }}
        onPointerDownOutside={event => {
          if (loading) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Open in H5P Studio</DialogTitle>
          <DialogDescription>
            This Learning Object already has an independent H5P Studio draft.{' '}
            {sourceOutdated
              ? 'CREATE detected newer source content.'
              : 'No newer CREATE source changes were detected.'}
          </DialogDescription>
        </DialogHeader>

        <div
          className={`h5p-draft-status ${sourceOutdated ? 'is-outdated' : 'is-current'}`}
          role="status"
        >
          {sourceOutdated
            ? <AlertTriangle size={20} aria-hidden="true" />
            : <CheckCircle2 size={20} aria-hidden="true" />}
          <div>
            <strong>{sourceOutdated ? 'Draft may be out of date' : 'No newer CREATE changes detected'}</strong>
            <p>
              {sourceOutdated
                ? 'The Learning Object format, chapters, questions, or Learning Objectives may have changed.'
                : 'This Studio item remains an independent draft and may contain its own manual edits.'}
            </p>
          </div>
        </div>

        <dl className="h5p-draft-details">
          <div><dt>Draft</dt><dd>{draft.title}</dd></div>
          <div><dt>Last edited</dt><dd>{formatLastEdited(draft.lastEditedAt)}</dd></div>
        </dl>

        <p className="h5p-draft-explanation">
          Opening the existing draft preserves its manual H5P edits. Creating a fresh draft copies the current
          CREATE questions into a separate H5P item and keeps this draft unchanged.
        </p>
        {loading && (
          <p className="h5p-draft-loading-note" role="status">
            Creating the fresh draft… This step cannot be cancelled after it starts.
          </p>
        )}

        <DialogFooter className="h5p-draft-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button type="button" className="btn btn-outline" onClick={onCreateFresh} disabled={loading}>
            {loading ? <span className="spinner-mini" /> : <CopyPlus size={16} />}
            {loading ? 'Creating…' : 'Create fresh draft'}
          </button>
          <button type="button" className="btn btn-primary" onClick={onOpenExisting} disabled={loading}>
            <ExternalLink size={16} /> Open existing draft
          </button>
        </DialogFooter>
      </DialogContent>
    )}
  </Dialog>
);

export default H5PStudioDraftDialog;
