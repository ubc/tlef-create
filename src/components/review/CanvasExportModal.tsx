import { useState, useEffect } from 'react';
import { X, ExternalLink, Check, Loader2, Plus, LogOut } from 'lucide-react';
import { canvasApi } from '../../services/api';
import '../../styles/components/CanvasExportModal.css';

interface CanvasExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  quizId: string;
  quizName: string;
  showNotification: (type: string, title: string, message: string) => void;
}

interface CanvasCourse {
  id: string;
  name: string;
  courseCode: string;
  term?: string;
}

interface CanvasModule {
  id: string;
  name: string;
  position: number;
  itemCount: number;
}

type Step = 'checking' | 'not-configured' | 'connect' | 'select-course' | 'select-module' | 'confirm' | 'exporting' | 'success';

const CanvasExportModal = ({
  isOpen,
  onClose,
  quizId,
  quizName,
  showNotification
}: CanvasExportModalProps) => {
  const [step, setStep] = useState<Step>('checking');
  const [courses, setCourses] = useState<CanvasCourse[]>([]);
  const [modules, setModules] = useState<CanvasModule[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<CanvasCourse | null>(null);
  const [selectedModule, setSelectedModule] = useState<CanvasModule | null>(null);
  const [loading, setLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [newModuleName, setNewModuleName] = useState('');
  const [creatingModule, setCreatingModule] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Check Canvas connection on open
  useEffect(() => {
    if (!isOpen) return;
    checkConnection();
  }, [isOpen]);

  // Reset when closed
  useEffect(() => {
    if (!isOpen) {
      setStep('checking');
      setCourses([]);
      setModules([]);
      setSelectedCourse(null);
      setSelectedModule(null);
      setResultUrl(null);
    }
  }, [isOpen]);

  async function checkConnection() {
    setLoading(true);
    try {
      // First check if Canvas integration is configured at all
      const configRes = await canvasApi.getConfig();
      if (!configRes.data?.enabled) {
        setStep('not-configured');
        setLoading(false);
        return;
      }

      const res = await canvasApi.getAuthStatus();
      if (res.data?.connected) {
        setStep('select-course');
        await loadCourses();
      } else {
        setStep('connect');
      }
    } catch {
      setStep('connect');
    } finally {
      setLoading(false);
    }
  }

  async function handleConnect() {
    setLoading(true);
    try {
      const res = await canvasApi.getConnectUrl();
      if (res.data?.authUrl) {
        // Open Canvas OAuth in a popup
        const popup = window.open(res.data.authUrl, 'canvas-auth', 'width=600,height=700');

        // Poll for popup close
        const interval = setInterval(() => {
          if (popup?.closed) {
            clearInterval(interval);
            checkConnection();
          }
        }, 500);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to connect';
      showNotification('error', 'Canvas Connection Failed', message);
    } finally {
      setLoading(false);
    }
  }

  async function loadCourses() {
    setLoading(true);
    try {
      const res = await canvasApi.getCourses();
      setCourses(res.data?.courses || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load courses';
      showNotification('error', 'Error', message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCourseSelect(course: CanvasCourse) {
    setSelectedCourse(course);
    setLoading(true);
    try {
      const res = await canvasApi.getModules(course.id);
      setModules(res.data?.modules || []);
      setStep('select-module');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load modules';
      showNotification('error', 'Error', message);
    } finally {
      setLoading(false);
    }
  }

  async function handleModuleSelect(module: CanvasModule) {
    setSelectedModule(module);
    setStep('confirm');
  }

  async function handleCreateModule() {
    if (!selectedCourse || !newModuleName.trim()) return;
    setCreatingModule(true);
    try {
      const res = await canvasApi.createModule(selectedCourse.id, newModuleName.trim());
      const created = res.data?.module;
      if (created) {
        setModules(prev => [...prev, created]);
        setSelectedModule(created);
        setNewModuleName('');
        setStep('confirm');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create module';
      showNotification('error', 'Error', message);
    } finally {
      setCreatingModule(false);
    }
  }

  async function handleDisconnect() {
    setIsDisconnecting(true);
    try {
      await canvasApi.disconnect();
      setStep('connect');
      setCourses([]);
      setModules([]);
      setSelectedCourse(null);
      setSelectedModule(null);
    } catch {
      // ignore
    } finally {
      setIsDisconnecting(false);
    }
  }

  async function handleExport() {
    if (!selectedCourse || !selectedModule) return;

    setStep('exporting');
    try {
      const res = await canvasApi.exportToCanvas(quizId, selectedCourse.id, selectedModule.id);
      if (res.data?.canvasUrl) {
        setResultUrl(res.data.canvasUrl);
      }
      setStep('success');
      showNotification('success', 'Exported!', `Quiz exported to ${selectedCourse.name}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Export failed';
      showNotification('error', 'Export Failed', message);
      setStep('confirm');
    }
  }

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content canvas-export-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 className="modal-title">Export to Canvas</h3>
            <p className="modal-subtitle">
              {step === 'checking' && 'Checking configuration...'}
              {step === 'not-configured' && 'Canvas integration not available'}
              {step === 'connect' && 'Connect your Canvas account to get started'}
              {step === 'select-course' && 'Select a course'}
              {step === 'select-module' && 'Select a module'}
              {step === 'confirm' && 'Confirm export'}
              {step === 'exporting' && 'Exporting...'}
              {step === 'success' && 'Export complete!'}
            </p>
          </div>
          <button className="btn btn-ghost modal-close" onClick={onClose} disabled={step === 'exporting'}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          {/* Step: Checking */}
          {step === 'checking' && (
            <div className="canvas-loading">
              <Loader2 size={24} className="spinner" />
              <p>Checking Canvas configuration...</p>
            </div>
          )}

          {/* Step: Not Configured */}
          {step === 'not-configured' && (
            <div className="canvas-connect-step">
              <p>Canvas integration is not yet configured on this server.</p>
              <p style={{ fontSize: '0.875rem', color: 'var(--color-muted-foreground)' }}>
                An administrator needs to set up Canvas API keys (CANVAS_CLIENT_ID and CANVAS_CLIENT_SECRET) in the server configuration.
              </p>
              <button className="btn btn-outline" onClick={onClose}>Close</button>
            </div>
          )}

          {/* Step: Connect to Canvas */}
          {step === 'connect' && (
            <div className="canvas-connect-step">
              <p>You need to authorize TLEF-CREATE to access your Canvas courses.</p>
              <button className="btn btn-primary" onClick={handleConnect} disabled={loading}>
                {loading ? <Loader2 size={16} className="spinner" /> : <ExternalLink size={16} />}
                Connect to Canvas
              </button>
            </div>
          )}

          {/* Step: Select Course */}
          {step === 'select-course' && (
            <div className="canvas-list-step">
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={handleDisconnect} disabled={isDisconnecting || loading}>
                  {isDisconnecting ? <Loader2 size={14} className="spinner" /> : <LogOut size={14} />}
                  Disconnect
                </button>
              </div>
              {loading ? (
                <div className="canvas-loading"><Loader2 size={24} className="spinner" /> Loading courses...</div>
              ) : courses.length === 0 ? (
                <p>No courses found. Make sure you are an instructor in at least one Canvas course.</p>
              ) : (
                <div className="canvas-item-list">
                  {courses.map(course => (
                    <button
                      key={course.id}
                      className="canvas-item-card"
                      onClick={() => handleCourseSelect(course)}
                    >
                      <div className="canvas-item-name">{course.name}</div>
                      <div className="canvas-item-meta">{course.courseCode}{course.term ? ` - ${course.term}` : ''}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step: Select Module */}
          {step === 'select-module' && (
            <div className="canvas-list-step">
              <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => { setStep('select-course'); setSelectedCourse(null); }}>
                Back to courses
              </button>
              <p className="canvas-selected-info">Course: <strong>{selectedCourse?.name}</strong></p>
              {loading ? (
                <div className="canvas-loading"><Loader2 size={24} className="spinner" /> Loading modules...</div>
              ) : (
                <>
                  {modules.length > 0 && (
                    <div className="canvas-item-list">
                      {modules.map(mod => (
                        <button
                          key={mod.id}
                          className="canvas-item-card"
                          onClick={() => handleModuleSelect(mod)}
                        >
                          <div className="canvas-item-name">{mod.name}</div>
                          <div className="canvas-item-meta">{mod.itemCount} items</div>
                        </button>
                      ))}
                    </div>
                  )}
                  <div style={{ marginTop: 16, borderTop: modules.length > 0 ? '1px solid var(--color-border)' : 'none', paddingTop: modules.length > 0 ? 16 : 0 }}>
                    {modules.length === 0 && <p style={{ marginBottom: 12, opacity: 0.7 }}>No modules found. Create one below.</p>}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        className="input"
                        style={{ flex: 1, minWidth: 0, borderWidth: '1px' }}
                        placeholder="New module name..."
                        value={newModuleName}
                        onChange={e => setNewModuleName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleCreateModule(); }}
                        disabled={creatingModule}
                      />
                      <button
                        className="btn btn-outline"
                        onClick={handleCreateModule}
                        disabled={!newModuleName.trim() || creatingModule}
                      >
                        {creatingModule ? <Loader2 size={14} className="spinner" /> : <Plus size={14} />}
                        Create
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step: Confirm */}
          {step === 'confirm' && (
            <div className="canvas-confirm-step">
              <div className="canvas-confirm-details">
                <div className="canvas-confirm-row">
                  <span className="canvas-confirm-label">Quiz:</span>
                  <span>{quizName}</span>
                </div>
                <div className="canvas-confirm-row">
                  <span className="canvas-confirm-label">Course:</span>
                  <span>{selectedCourse?.name}</span>
                </div>
                <div className="canvas-confirm-row">
                  <span className="canvas-confirm-label">Module:</span>
                  <span>{selectedModule?.name}</span>
                </div>
              </div>
              <div className="canvas-confirm-actions">
                <button className="btn btn-outline" onClick={() => setStep('select-module')}>
                  Back
                </button>
                <button className="btn btn-primary" onClick={handleExport}>
                  Export to Canvas
                </button>
              </div>
            </div>
          )}

          {/* Step: Exporting */}
          {step === 'exporting' && (
            <div className="canvas-loading">
              <Loader2 size={32} className="spinner" />
              <p>Exporting quiz to Canvas...</p>
              <p className="canvas-loading-sub">Generating H5P, importing to server, creating Canvas page...</p>
            </div>
          )}

          {/* Step: Success */}
          {step === 'success' && (
            <div className="canvas-success-step">
              <div className="canvas-success-icon"><Check size={48} /></div>
              <h4>Quiz exported successfully!</h4>
              <p>Your quiz is now available in Canvas.</p>
              {resultUrl && (
                <a href={resultUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                  <ExternalLink size={16} /> Open in Canvas
                </a>
              )}
              <button className="btn btn-outline" onClick={onClose} style={{ marginTop: '8px' }}>
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CanvasExportModal;
