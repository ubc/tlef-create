import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { H5PEditorUI } from '@lumieducation/h5p-react';
import { waitForH5PEditorAssets } from '../utils/h5pEditorReady';
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
  StudioSourceStatus,
  h5pEditorApi
} from '../services/api';
import { usePubSub } from '../hooks/usePubSub';
import { useAppSelector } from '../hooks/redux';
import { useSystemDialog } from '../components/system-dialog/SystemDialogProvider';
import StudioAIComposer from '../components/h5p/StudioAIComposer';
import StudioAssistant from '../components/h5p/StudioAssistant';
import StudioPreview from '../components/h5p/StudioPreview';
import '../styles/pages/H5PStudio.css';

function formatStudioTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown edit time';
  return `Edited ${date.toLocaleString()}`;
}

function normalizeFingerprintValue(value: unknown): unknown {
  if (value === undefined || value === null || value === '' || typeof value === 'function') return undefined;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const normalized = value.map(normalizeFingerprintValue).filter(item => item !== undefined);
    return normalized.length ? normalized : undefined;
  }

  const normalized = Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((normalized, key) => {
      const nextValue = normalizeFingerprintValue((value as Record<string, unknown>)[key]);
      if (nextValue !== undefined) normalized[key] = nextValue;
      return normalized;
    }, {});
  return Object.keys(normalized).length ? normalized : undefined;
}

function fingerprintEditorContent(request: H5PStudioSaveRequest) {
  const metadata = request.params.metadata || {};
  const editableMetadataKeys = [
    'a11yTitle', 'authorComments', 'authors', 'changes', 'contentType',
    'defaultLanguage', 'license', 'licenseExtras', 'licenseVersion',
    'metaDescription', 'metaKeywords', 'source', 'title', 'yearFrom', 'yearTo'
  ];
  const editableMetadata = editableMetadataKeys.reduce<Record<string, unknown>>((result, key) => {
    const value = metadata[key];
    if (value === undefined || value === null || value === '') return result;
    if (Array.isArray(value) && value.length === 0) return result;
    result[key] = value;
    return result;
  }, {});

  return JSON.stringify(normalizeFingerprintValue({
    library: request.library,
    params: {
      metadata: editableMetadata,
      params: request.params.params
    }
  }));
}

const H5PStudio = () => {
  const ownerId = useAppSelector(state => state.app.user?.id || '');
  const [searchParams, setSearchParams] = useSearchParams();
  const editorRef = useRef<H5PEditorUI | null>(null);
  const editorLoadVersion = useRef(0);
  const savedEditorFingerprint = useRef<string | null>(null);
  const savedEditorMetadata = useRef<IContentMetadata | null>(null);
  const lastSaveWasUnchanged = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [contents, setContents] = useState<H5PStudioContent[]>([]);
  const [selectedContentId, setSelectedContentId] = useState(searchParams.get('contentId') || 'new');
  const [loadingList, setLoadingList] = useState(true);
  const [editorModelLoaded, setEditorModelLoaded] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorAttempt, setEditorAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showPreview, setShowPreview] = useState(searchParams.get('view') === 'preview');
  const [showAI, setShowAI] = useState(searchParams.get('create') === 'ai' || (searchParams.get('create') === 'assistant' && !searchParams.get('assistantSession')));
  const [showAssistant, setShowAssistant] = useState(searchParams.get('create') === 'assistant' && !!searchParams.get('assistantSession'));
  const [assistantVisited, setAssistantVisited] = useState(searchParams.get('create') === 'assistant' && !!searchParams.get('assistantSession'));
  const [quickVisited, setQuickVisited] = useState(searchParams.get('create') === 'ai' || searchParams.get('create') === 'assistant');
  const [assistantDirty, setAssistantDirty] = useState(false);
  const [assistantSessionId, setAssistantSessionId] = useState(searchParams.get('assistantSession') || '');
  const [assistantSeed, setAssistantSeed] = useState<{ id: string; courseId: string; quizId: string; materialIds: string[]; instructions: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [sourceStatus, setSourceStatus] = useState<StudioSourceStatus | null>(null);
  const sourceQuizId = searchParams.get('quizId') || undefined;
  const sourceCourseId = searchParams.get('courseId') || undefined;
  const { showNotification } = usePubSub('H5PStudio');
  const { showConfirm } = useSystemDialog();

  const openAIMode = () => {
    setShowAssistant(false); setShowAI(true); setQuickVisited(true);
    setSearchParams({ create: 'ai', ...(assistantSessionId ? { assistantSession: assistantSessionId } : {}), ...(sourceQuizId ? { quizId: sourceQuizId } : {}), ...(sourceCourseId ? { courseId: sourceCourseId } : {}) });
  };

  const selectedContent = contents.find(content => content.contentId === selectedContentId);

  useEffect(() => {
    editorLoadVersion.current++;
    setEditorReady(false);
    savedEditorFingerprint.current = null;
    savedEditorMetadata.current = null;
    lastSaveWasUnchanged.current = false;
    setEditorDirty(selectedContentId === 'new');
    return () => { editorLoadVersion.current++; };
  }, [selectedContentId, editorAttempt, showAI, showAssistant]);

  const handleEditorLoaded = async () => {
    const version = editorLoadVersion.current;
    const active = () => version === editorLoadVersion.current;
    const ready = await waitForH5PEditorAssets(document.querySelector<HTMLElement>('h5p-editor'), active);
    if (!active()) return;
    if (ready) setEditorReady(true);
    else setEditorError('Some editor fields could not finish loading. Check your connection and try again.');
  };

  useEffect(() => {
    let active = true;
    setSourceStatus(null);
    if (selectedContentId !== 'new' && !showAI && !showAssistant) {
      h5pEditorApi.getSourceStatus(selectedContentId).then(response => {
        if (active) setSourceStatus(response.data?.source || null);
      }).catch(() => { /* The editor remains available when source metadata cannot load. */ });
    }
    return () => { active = false; };
  }, [selectedContentId, showAI, showAssistant]);

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
    setShowAssistant(false);
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
      setSearchParams({ contentId, ...(assistantSessionId ? { assistantSession: assistantSessionId } : {}), ...(sourceQuizId ? { quizId: sourceQuizId } : {}), ...(sourceCourseId ? { courseId: sourceCourseId } : {}) });
    }
  };

  const loadEditorModel = useCallback(async (contentId: string) => {
    try {
      const response = await h5pEditorApi.getEditorModel(contentId || 'new');
      if (!response.data?.model) {
        throw new Error('CREATE did not receive a valid H5P editor model.');
      }
      const model = response.data.model as unknown as IEditorModel & {
        library?: string;
        metadata?: IContentMetadata;
        params?: unknown;
      };
      if (contentId !== 'new' && model.library && model.metadata && model.params !== undefined) {
        savedEditorFingerprint.current = fingerprintEditorContent({
          library: model.library,
          params: { metadata: model.metadata as unknown as Record<string, unknown>, params: model.params }
        });
        savedEditorMetadata.current = model.metadata;
        setEditorDirty(false);
      }
      setEditorError(null);
      setEditorModelLoaded(true);
      return model;
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
    const fingerprint = fingerprintEditorContent(request);
    if (contentId && fingerprint === savedEditorFingerprint.current) {
      lastSaveWasUnchanged.current = true;
      setEditorDirty(false);
      return {
        contentId,
        metadata: savedEditorMetadata.current || request.params.metadata as IContentMetadata
      };
    }

    lastSaveWasUnchanged.current = false;
    const response = contentId
      ? await h5pEditorApi.updateContent(contentId, request)
      : await h5pEditorApi.createContent(request);

    if (!response.data) {
      throw new Error('CREATE did not receive the saved H5P content.');
    }

    savedEditorFingerprint.current = fingerprint;
    savedEditorMetadata.current = response.data.metadata as IContentMetadata;
    setEditorDirty(false);
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
    const unchanged = lastSaveWasUnchanged.current;
    lastSaveWasUnchanged.current = false;
    setSelectedContentId(contentId);
    setSearchParams({ contentId, ...(assistantSessionId ? { assistantSession: assistantSessionId } : {}), ...(sourceQuizId ? { quizId: sourceQuizId } : {}), ...(sourceCourseId ? { courseId: sourceCourseId } : {}) });
    if (unchanged) return;
    await loadContents();
    showNotification('success', 'Changes saved', 'Your updated H5P content is ready to preview or download.');
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
            {importing ? 'Importing…' : 'Import .h5p'}
          </button>
          <button className="btn btn-outline" onClick={() => selectContent('new', true)} disabled={aiBusy}>
            <FilePlus2 size={17} /> New blank activity
          </button>
          <button className="btn btn-primary" onClick={openAIMode} disabled={aiBusy}><Wand2 size={17} /> Create with AI</button>
        </div>
      </header>

      {showAI && sourceQuizId && sourceCourseId && <Link className="studio-back-link" to={`/course/${encodeURIComponent(sourceCourseId)}/quiz/${encodeURIComponent(sourceQuizId)}?tab=generation`}>Back to source Quiz</Link>}
      {!showAI && !showAssistant && selectedContent && <div className="studio-ai-guidance" role="status">
        <strong>Independent Studio draft</strong>
        <p>Edits here affect only this H5P activity. They do not update Quiz questions, learning objectives or other drafts.</p>
        {sourceStatus?.state === 'changed' && <p>The source Quiz has changed since this draft was created. Your Studio edits are preserved; create a new draft if you want the latest Quiz content.</p>}
        {sourceStatus?.state === 'unknown' && <p>This older draft has no recorded source revision. Check its content against the source Quiz before sharing.</p>}
        {sourceStatus?.state === 'unavailable' && <p>The source Quiz is no longer available. This independent activity can still be edited and downloaded.</p>}
        {sourceStatus?.quizId && sourceStatus.folderId && <Link to={`/course/${encodeURIComponent(sourceStatus.folderId)}/quiz/${encodeURIComponent(sourceStatus.quizId)}?tab=review`}>View source Quiz: {sourceStatus.title}</Link>}
      </div>}

      {assistantDirty && !showAssistant && <div className="studio-ai-guidance" role="status"><p>Your unsaved course plan is kept while you work here.</p><button className="btn btn-outline" onClick={() => { setShowAssistant(true); setShowAI(false); }}>Return to course plan</button></div>}
      {(assistantVisited || quickVisited) && <section className="studio-ai-hub" hidden={!showAI && !showAssistant} aria-labelledby="studio-ai-hub-heading">
        <h2 id="studio-ai-hub-heading" className="sr-only">Create with AI</h2>
        {assistantSessionId && <div className="studio-legacy-task-switch"><button className="btn btn-ghost" onClick={() => { setShowAssistant(false); setShowAI(true); }} disabled={aiBusy}>New AI activity</button><button className="btn btn-ghost" onClick={() => { setShowAssistant(true); setShowAI(false); }} disabled={aiBusy}>Resume saved course task</button></div>}
        <div hidden={!showAssistant}>
          {assistantVisited && <StudioAssistant key={`${ownerId}:${assistantSeed?.id || ''}`} embedded ownerId={ownerId} initialCourseId={assistantSeed?.courseId || sourceCourseId} initialQuizId={assistantSeed?.quizId || sourceQuizId} initialInstructions={assistantSeed?.instructions} initialMaterialIds={assistantSeed?.materialIds} sessionId={assistantSessionId || undefined} onDirtyChange={setAssistantDirty} onSessionChange={id => {
            setAssistantSessionId(id || '');
            if (showAssistant) setSearchParams({ create: 'assistant', ...(id ? { assistantSession: id } : {}), ...(sourceCourseId ? { courseId: sourceCourseId } : {}), ...(sourceQuizId ? { quizId: sourceQuizId } : {}) });
          }} onOpenActivity={(contentId, preview) => {
            selectContent(contentId);
            setShowPreview(preview);
            setSearchParams({ contentId, ...(preview ? { view: 'preview' } : {}), ...(assistantSessionId ? { assistantSession: assistantSessionId } : {}) });
            void loadContents();
          }} />}
        </div>
        <div hidden={!showAI}>
          {quickVisited && (loadingList ? <p role="status">Loading your saved activities…</p> : <StudioAIComposer key={`${ownerId}:${sourceQuizId || ''}:${selectedContentId}`} embedded active={showAI} ownerId={ownerId} currentContent={selectedContent} contents={contents} quizId={sourceQuizId} courseId={sourceCourseId} onBusyChange={setAiBusy} onBuildCourseQuestions={brief => {
            setAssistantSeed({ ...brief, id: crypto.randomUUID() });
            setAssistantSessionId('');
            setAssistantVisited(true);
            setShowAI(false);
            setShowAssistant(true);
            setSearchParams({ create: 'assistant', courseId: brief.courseId, quizId: brief.quizId });
          }} onGenerated={content => {
            setContents(previous => [content, ...previous.filter(item => item.contentId !== content.contentId)]);
            selectContent(content.contentId);
            showNotification('success', content.source === 'ai-studio' ? 'AI draft ready for review' : 'Template ready to complete', content.source === 'ai-studio' ? 'Check the content, answers and layout before sharing. Your original Quiz and templates are unchanged.' : 'Add real media, complete required fields, and save before returning to Quick activity.');
          }} />)}
        </div>
      </section>}
      {!showAssistant && !showAI && (

      <div className={`h5p-studio-workspace${showPreview ? ' is-preview' : ''}`}>
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
                    <Eye size={16} /> {showPreview ? 'Back to editor' : editorDirty ? 'Save changes & preview' : 'Preview'}
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

          <div
            className="h5p-studio-canvas"
            onInputCapture={() => { if (!showPreview && editorReady) setEditorDirty(true); }}
            onChangeCapture={() => { if (!showPreview && editorReady) setEditorDirty(true); }}
          >
            {showPreview && selectedContentId !== 'new' ? (
              <StudioPreview key={selectedContentId} contentId={selectedContentId} title={selectedContent?.title || 'H5P content'} />
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
                  onLoaded={handleEditorLoaded}
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
