import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { H5PEditorUI } from '@lumieducation/h5p-react';
import type { IContentMetadata, IEditorModel } from '@lumieducation/h5p-server';
import {
  Download,
  Eye,
  FilePlus2,
  Loader2,
  Save,
  Trash2,
  Upload,
  Wand2
} from 'lucide-react';
import {
  ApiError,
  H5PStudioContent,
  H5PStudioSaveRequest,
  h5pEditorApi
} from '../services/api';
import { usePubSub } from '../hooks/usePubSub';
import { useSystemDialog } from '../components/system-dialog/SystemDialogProvider';
import StudioAIComposer from '../components/h5p/StudioAIComposer';
import WorkflowStepper from '../components/workflow/WorkflowStepper';
import '../styles/pages/H5PStudio.css';

function formatStudioTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown edit time';
  return `Edited ${date.toLocaleString()}`;
}

const H5PStudio = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const editorRef = useRef<H5PEditorUI | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [contents, setContents] = useState<H5PStudioContent[]>([]);
  const [selectedContentId, setSelectedContentId] = useState(searchParams.get('contentId') || 'new');
  const [loadingList, setLoadingList] = useState(true);
  const [editorModelLoaded, setEditorModelLoaded] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorAttempt, setEditorAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showAI, setShowAI] = useState(searchParams.get('create') === 'ai');
  const [aiBusy, setAiBusy] = useState(false);
  const sourceQuizId = searchParams.get('quizId') || undefined;
  const sourceCourseId = searchParams.get('courseId') || undefined;
  const { showNotification } = usePubSub('H5PStudio');
  const { showConfirm } = useSystemDialog();

  const selectedContent = contents.find(content => content.contentId === selectedContentId);

  const loadContents = useCallback(async () => {
    try {
      const response = await h5pEditorApi.listContents();
      setContents(response.data?.contents || []);
    } catch (error) {
      showNotification('error', 'H5P Studio unavailable', error instanceof Error ? error.message : 'Could not load H5P content.');
    } finally {
      setLoadingList(false);
    }
  }, [showNotification]);

  useEffect(() => {
    loadContents();
  }, [loadContents]);

  const selectContent = (contentId: string, forceReload = false) => {
    setShowAI(false);
    // Clicking the already-selected item must not reset the loading flags. The
    // H5P editor only reloads when its React key changes; resetting the flags
    // without remounting leaves the loading overlay visible indefinitely.
    if (contentId === selectedContentId && !forceReload) {
      setShowPreview(false);
      return;
    }

    setSelectedContentId(contentId);
    setEditorModelLoaded(false);
    setEditorReady(false);
    setEditorError(null);
    setShowPreview(false);
    if (forceReload) {
      setEditorAttempt(attempt => attempt + 1);
    }
    if (contentId === 'new') {
      setSearchParams(sourceQuizId ? { quizId: sourceQuizId, ...(sourceCourseId ? { courseId: sourceCourseId } : {}) } : {});
    } else {
      setSearchParams({ contentId, ...(sourceQuizId ? { quizId: sourceQuizId } : {}), ...(sourceCourseId ? { courseId: sourceCourseId } : {}) });
    }
  };

  const loadEditorModel = useCallback(async (contentId: string) => {
    try {
      const response = await h5pEditorApi.getEditorModel(contentId || 'new');
      if (!response.data?.model) {
        throw new Error('CREATE did not receive a valid H5P editor model.');
      }
      setEditorError(null);
      setEditorModelLoaded(true);
      return response.data.model as unknown as IEditorModel & {
        library?: string;
        metadata?: IContentMetadata;
        params?: unknown;
      };
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'The H5P editor model could not be loaded.';
      setEditorError(message);
      setEditorModelLoaded(true);
      throw error;
    }
  }, []);

  const retryEditor = () => {
    setEditorModelLoaded(false);
    setEditorReady(false);
    setEditorError(null);
    setEditorAttempt(attempt => attempt + 1);
  };

  const saveEditorContent = useCallback(async (
    contentId: string | undefined,
    requestBody: { library: string; params: unknown }
  ) => {
    const request = requestBody as H5PStudioSaveRequest;
    const response = contentId
      ? await h5pEditorApi.updateContent(contentId, request)
      : await h5pEditorApi.createContent(request);

    if (!response.data) {
      throw new Error('CREATE did not receive the saved H5P content.');
    }

    return {
      contentId: response.data.contentId,
      metadata: response.data.metadata as IContentMetadata
    };
  }, []);

  const handleSave = async () => {
    if (!editorReady || saving) return;
    setSaving(true);
    try {
      await editorRef.current?.save();
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    if (showPreview) { setShowPreview(false); return; }
    if (!editorReady || saving) return;
    setSaving(true);
    try {
      const result = await editorRef.current?.save();
      if (result?.contentId) setShowPreview(true);
    } finally { setSaving(false); }
  };

  const handleSaved = async (contentId: string) => {
    setSelectedContentId(contentId);
    setSearchParams({ contentId, ...(sourceQuizId ? { quizId: sourceQuizId } : {}), ...(sourceCourseId ? { courseId: sourceCourseId } : {}) });
    await loadContents();
    showNotification('success', 'H5P saved', 'Your H5P content is ready to preview or download.');
  };

  const handleSaveError = (message: string) => {
    setSaving(false);
    showNotification('error', 'H5P could not be saved', message || 'Check the highlighted required fields.');
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.h5p')) {
      showNotification('warning', 'Choose an H5P package', 'The selected file must end in .h5p.');
      return;
    }

    setImporting(true);
    try {
      const response = await h5pEditorApi.importContent(file);
      if (!response.data?.content) throw new Error('The imported H5P content was not returned.');
      await loadContents();
      selectContent(response.data.content.contentId);
      showNotification('success', 'H5P imported', `${response.data.content.title} is ready to edit.`);
    } catch (error) {
      const message = error instanceof ApiError
        ? error.message
        : 'This package could not be imported. It may require libraries that are not installed in CREATE.';
      showNotification('error', 'H5P import failed', message);
    } finally {
      setImporting(false);
    }
  };

  const handleDownload = async () => {
    if (!selectedContent || selectedContentId === 'new') return;
    try {
      if (!showPreview) {
        if (!editorReady || saving) return;
        setSaving(true);
        const result = await editorRef.current?.save();
        setSaving(false);
        if (!result?.contentId) return;
      }
      const blob = await h5pEditorApi.downloadContent(selectedContentId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${selectedContent.title.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'h5p-content'}.h5p`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setSaving(false);
      showNotification('error', 'Download failed', error instanceof Error ? error.message : 'Could not download this H5P package.');
    }
  };

  const handleDelete = async () => {
    if (!selectedContent || selectedContentId === 'new') return;
    const confirmed = await showConfirm({
      title: 'Delete H5P content?',
      description: `“${selectedContent.title}” and its uploaded media will be permanently deleted.`,
      confirmLabel: 'Delete H5P content',
      tone: 'danger'
    });
    if (!confirmed) return;

    try {
      await h5pEditorApi.deleteContent(selectedContentId);
      await loadContents();
      selectContent('new');
      showNotification('success', 'H5P deleted', 'The H5P content was removed.');
    } catch (error) {
      showNotification('error', 'Delete failed', error instanceof Error ? error.message : 'Could not delete this H5P content.');
    }
  };

  return (
    <div className="h5p-studio-page">
      <header className="h5p-studio-hero">
        <div>
          <span className="h5p-studio-eyebrow">Advanced authoring</span>
          <h1>H5P Studio</h1>
          <p>Turn a teaching idea into an H5P activity. Use AI for a first draft, then make it yours in the official editor.</p>
        </div>
        <div className="h5p-studio-hero-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".h5p,application/zip"
            hidden
            onChange={handleImport}
          />
          <button className="btn btn-outline" onClick={() => fileInputRef.current?.click()} disabled={importing || aiBusy}>
            {importing ? <Loader2 className="spin" size={17} /> : <Upload size={17} />}
            {importing ? 'Importing…' : 'Upload .h5p'}
          </button>
          <button className="btn btn-outline" onClick={() => selectContent('new', true)} disabled={aiBusy}>
            <FilePlus2 size={17} /> New content
          </button>
          <button className="btn btn-primary" onClick={() => setShowAI(true)} disabled={aiBusy}><Wand2 size={17} /> Create with AI</button>
        </div>
      </header>

      {sourceQuizId && sourceCourseId && <Link className="studio-back-link" to={`/course/${encodeURIComponent(sourceCourseId)}/quiz/${encodeURIComponent(sourceQuizId)}?tab=generation`}>Back to source Quiz</Link>}

      <WorkflowStepper ariaLabel="H5P activity workflow" activeStepId={showAI ? 'create' : showPreview ? 'preview' : 'edit'} steps={[
        { id: 'create', label: 'Create a draft', detail: 'Choose a type and describe your goal', state: selectedContent ? 'complete' : 'available', disabled: aiBusy },
        { id: 'edit', label: 'Review & edit', detail: selectedContent?.source === 'ai-studio' ? 'Check AI content in the official editor' : 'Adjust content, media and feedback', state: showPreview ? 'complete' : 'available', disabled: aiBusy },
        { id: 'preview', label: 'Preview & download', detail: 'Save and try the student experience', state: selectedContent ? 'available' : 'blocked', disabled: aiBusy || saving || !selectedContent || showAI }
      ]} onStepSelect={step => {
        if (step === 'create') setShowAI(true);
        else if (step === 'edit') { setShowAI(false); setShowPreview(false); }
        else if (!showPreview) void handlePreview();
      }} />

      {showAI ? <StudioAIComposer contents={contents} quizId={sourceQuizId} onBusyChange={setAiBusy} onGenerated={content => {
        setContents(previous => [content, ...previous.filter(item => item.contentId !== content.contentId)]);
        selectContent(content.contentId);
        showNotification('success', content.source === 'ai-studio' ? 'AI draft ready for review' : 'Template ready to complete', content.source === 'ai-studio' ? 'Check the content, answers and layout before sharing. Your original Quiz and templates are unchanged.' : 'Add real media, complete required fields, and save before returning to Create with AI.');
      }} /> : (

      <div className="h5p-studio-workspace">
        <aside className="h5p-studio-library" aria-label="Your H5P content">
          <div className="h5p-studio-library-heading">
            <h2>Your content</h2>
            <span>{contents.length}</span>
          </div>
          {loadingList ? (
            <div className="h5p-studio-empty"><Loader2 className="spin" size={20} /> Loading…</div>
          ) : contents.length === 0 ? (
            <div className="h5p-studio-empty">Create your first H5P activity or upload an existing package.</div>
          ) : (
            <div className="h5p-studio-content-list">
              {contents.map(content => (
                <button
                  key={content.id}
                  className={`h5p-studio-content-item ${selectedContentId === content.contentId ? 'active' : ''}`}
                  onClick={() => selectContent(content.contentId)}
                >
                  <span className="h5p-studio-content-title">{content.title}</span>
                  <span className="h5p-studio-content-meta">
                    {content.mainLibrary || 'H5P content'} · {content.source === 'generated' ? 'Studio draft' : content.source === 'ai-studio' ? 'AI draft' : content.source}
                  </span>
                  <span className="h5p-studio-content-time">{formatStudioTimestamp(content.lastEditedAt)}</span>
                </button>
              ))}
            </div>
          )}
        </aside>

        <main className="h5p-studio-editor-panel">
          <div className="h5p-studio-toolbar">
            <div>
              <span className="h5p-studio-toolbar-label">{showPreview ? 'Saved preview' : selectedContent?.source === 'ai-studio' ? 'AI draft · Needs your review' : 'Editing'}</span>
              <strong>{selectedContent?.title || 'New H5P content'}</strong>
            </div>
            <div className="h5p-studio-toolbar-actions">
              {selectedContentId !== 'new' && (
                <>
                  <button className="btn btn-ghost" onClick={handlePreview} disabled={saving || (!showPreview && !editorReady)}>
                    <Eye size={16} /> {showPreview ? 'Back to editor' : 'Save & preview'}
                  </button>
                  <button className="btn btn-ghost" onClick={handleDownload}>
                    <Download size={16} /> Download
                  </button>
                  <button className="btn btn-ghost h5p-studio-delete" onClick={handleDelete} aria-label="Delete H5P content">
                    <Trash2 size={16} />
                  </button>
                </>
              )}
              {!showPreview && (
                <button className="btn btn-primary" onClick={handleSave} disabled={!editorReady || saving}>
                  {saving ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
                  {saving ? 'Saving…' : 'Save'}
                </button>
              )}
            </div>
          </div>

          <div className="h5p-studio-canvas">
            {showPreview && selectedContentId !== 'new' ? (
              <iframe
                className="h5p-studio-preview"
                src={`/api/create/h5p-editor/contents/${encodeURIComponent(selectedContentId)}/preview`}
                title={`Preview ${selectedContent?.title || 'H5P content'}`}
              />
            ) : (
              <>
                {!editorModelLoaded && (
                  <div className="h5p-studio-loading">
                    <Loader2 className="spin" size={26} />
                    <span>Loading the official H5P editor…</span>
                  </div>
                )}
                {editorError && (
                  <div className="h5p-studio-loading h5p-studio-load-error" role="alert">
                    <strong>H5P editor could not load</strong>
                    <span>{editorError}</span>
                    <button className="btn btn-outline" onClick={retryEditor}>Try again</button>
                  </div>
                )}
                <H5PEditorUI
                  key={`${selectedContentId}-${editorAttempt}`}
                  ref={editorRef}
                  contentId={selectedContentId}
                  loadContentCallback={loadEditorModel}
                  saveContentCallback={saveEditorContent}
                  onLoaded={() => setEditorReady(true)}
                  onSaved={handleSaved}
                  onSaveError={handleSaveError}
                />
              </>
            )}
          </div>
        </main>
      </div>
      )}

      <p className="h5p-studio-note">
        CREATE authors can use installed H5P libraries. Uploads that require unreviewed libraries are rejected until an administrator adds and validates those libraries.
      </p>
    </div>
  );
};

export default H5PStudio;
