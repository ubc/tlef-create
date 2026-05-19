import { useState, useEffect } from 'react';
import { X, ArrowLeft, ArrowRight, ExternalLink, Loader2, Link2, Link2Off, LogOut } from 'lucide-react';
import MaterialUpload from './MaterialUpload';
import { usePubSub } from '../hooks/usePubSub';
import { canvasApi } from '../services/api';
import '../styles/components/CreateCourseModal.css';

interface Material {
  id: string;
  name: string;
  type: 'pdf' | 'docx' | 'url' | 'text';
  uploadDate: string;
  content?: string;
  file?: File;
  uploadProgress?: number;
  isUploading?: boolean;
}

interface CanvasCourse {
  id: string;
  name: string;
  courseCode: string;
  term?: string;
}

interface CreateCourseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (courseName: string, materials: Material[], canvasCourseId?: string, canvasModuleId?: string) => Promise<void>;
}

const CreateCourseModal = ({ isOpen, onClose, onSubmit }: CreateCourseModalProps) => {
  const [courseName, setCourseName] = useState('');
  const [currentStep, setCurrentStep] = useState(1);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const { subscribe } = usePubSub('CreateCourseModal');

  // Canvas state
  const [canvasEnabled, setCanvasEnabled] = useState(false);
  const [canvasConnected, setCanvasConnected] = useState(false);
  const [canvasLoading, setCanvasLoading] = useState(false);
  const [canvasCourses, setCanvasCourses] = useState<CanvasCourse[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<CanvasCourse | null>(null);
  const [canvasModuleId, setCanvasModuleId] = useState<string | null>(null);
  const [linkToCanvas, setLinkToCanvas] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Check Canvas availability on mount
  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      try {
        const configRes = await canvasApi.getConfig();
        if (configRes.data?.enabled) {
          setCanvasEnabled(true);
          const authRes = await canvasApi.getAuthStatus();
          setCanvasConnected(!!authRes.data?.connected);
        }
      } catch {
        // Canvas not available, that's fine
      }
    })();
  }, [isOpen]);

  useEffect(() => {
    const handleUploadProgress = (data: { progress: number }) => {
      setUploadProgress(data.progress);
    };
    subscribe('upload-progress', handleUploadProgress);
  }, [subscribe]);

  if (!isOpen) return null;

  const handleNextStep = () => {
    if (courseName.trim()) {
      setCurrentStep(2);
    }
  };

  const handlePreviousStep = () => {
    if (currentStep === 3) {
      setCurrentStep(2);
    } else {
      setCurrentStep(1);
    }
  };

  const handleAddMaterial = (
    material: { name: string; type: 'pdf' | 'docx' | 'url' | 'text'; content?: string; file?: File },
  ) => {
    const newMaterial: Material = {
      id: Date.now().toString(),
      name: material.name,
      type: material.type,
      uploadDate: new Date().toLocaleDateString(),
      content: material.content,
      file: material.file,
      isUploading: false,
      uploadProgress: 0
    };
    setMaterials([...materials, newMaterial]);
  };

  const handleRemoveMaterial = (id: string) => {
    setMaterials(materials.filter(material => material.id !== id));
  };

  const handleGoToCanvasStep = () => {
    setCurrentStep(3);
    if (canvasConnected && canvasCourses.length === 0) {
      loadCourses();
    }
  };

  const loadCourses = async () => {
    setCanvasLoading(true);
    try {
      const res = await canvasApi.getCourses();
      setCanvasCourses(res.data?.courses || []);
    } catch {
      // Failed to load
    } finally {
      setCanvasLoading(false);
    }
  };

  const handleCanvasConnect = async () => {
    setCanvasLoading(true);
    try {
      const res = await canvasApi.getConnectUrl();
      if (res.data?.authUrl) {
        const popup = window.open(res.data.authUrl, 'canvas-auth', 'width=600,height=700');
        const interval = setInterval(() => {
          if (popup?.closed) {
            clearInterval(interval);
            (async () => {
              const authRes = await canvasApi.getAuthStatus();
              if (authRes.data?.connected) {
                setCanvasConnected(true);
                await loadCourses();
              }
              setCanvasLoading(false);
            })();
          }
        }, 500);
      }
    } catch {
      setCanvasLoading(false);
    }
  };

  const handleSelectCourse = (course: CanvasCourse) => {
    setSelectedCourse(course);
    setLinkToCanvas(true);
  };

  const handleUnlinkCanvas = () => {
    setSelectedCourse(null);
    setCanvasModuleId(null);
    setLinkToCanvas(false);
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await canvasApi.disconnect();
      setCanvasConnected(false);
      setCanvasCourses([]);
      setSelectedCourse(null);
      setCanvasModuleId(null);
      setLinkToCanvas(false);
    } catch {
      // ignore
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleCreateCourse = async () => {
    if (courseName.trim() && !isCreating) {
      setIsCreating(true);
      setUploadProgress(0);
      try {
        // Create Canvas module now (only once, at submission time)
        let moduleId = canvasModuleId;
        if (linkToCanvas && selectedCourse && !moduleId) {
          try {
            const res = await canvasApi.createModule(selectedCourse.id, courseName.trim());
            moduleId = res.data?.module?.id || null;
            setCanvasModuleId(moduleId);
          } catch {
            moduleId = null;
          }
        }

        await onSubmit(
          courseName.trim(),
          materials,
          linkToCanvas && selectedCourse ? selectedCourse.id : undefined,
          linkToCanvas && moduleId ? moduleId : undefined
        );
        resetModal();
        onClose();
      } catch (error) {
        console.error('Failed to create course:', error);
      } finally {
        setIsCreating(false);
        setUploadProgress(0);
      }
    }
  };

  const handleSkipMaterials = async () => {
    if (canvasEnabled && canvasConnected) {
      // Go to Canvas step instead of creating immediately
      handleGoToCanvasStep();
    } else {
      // No Canvas — create directly
      await handleCreateCourse();
    }
  };

  const handleSkipCanvas = async () => {
    setLinkToCanvas(false);
    setSelectedCourse(null);
    setCanvasModuleId(null);
    await handleCreateCourse();
  };

  const resetModal = () => {
    setCourseName('');
    setMaterials([]);
    setCurrentStep(1);
    setSelectedCourse(null);
    setCanvasModuleId(null);
    setLinkToCanvas(false);
    setCanvasCourses([]);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>Create New Course</h2>
          <button className="btn btn-ghost modal-close" onClick={() => { resetModal(); onClose(); }}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          {/* Step indicator */}
          <div className="step-indicator">
            <span className={`step-dot ${currentStep >= 1 ? 'active' : ''}`}>1</span>
            <span className="step-line" />
            <span className={`step-dot ${currentStep >= 2 ? 'active' : ''}`}>2</span>
            {canvasEnabled && canvasConnected && (
              <>
                <span className="step-line" />
                <span className={`step-dot ${currentStep >= 3 ? 'active' : ''}`}>3</span>
              </>
            )}
          </div>

          {/* Step 1: Course Name */}
          {currentStep === 1 && (
            <div className="step-content">
              <div className="form-group">
                <label htmlFor="courseName">Course Name</label>
                <input
                  id="courseName"
                  type="text"
                  className="input"
                  placeholder="e.g., EOSC 533"
                  value={courseName}
                  onChange={(e) => setCourseName(e.target.value)}
                  required
                  onKeyDown={(e) => { if (e.key === 'Enter' && courseName.trim()) handleNextStep(); }}
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => { resetModal(); onClose(); }}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" onClick={handleNextStep} disabled={!courseName.trim()}>
                  Next <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Upload Materials (Optional) */}
          {currentStep === 2 && (
            <div className="step-content">
              <div className="step-header">
                <h3>Upload Course Materials</h3>
                <p>Add materials to your course (optional). You can also do this later.</p>
              </div>

              <MaterialUpload
                materials={materials}
                onAddMaterial={handleAddMaterial}
                onRemoveMaterial={handleRemoveMaterial}
              />

              {isCreating && materials.some(m => m.type === 'pdf' || m.type === 'docx') && (
                <div className="upload-progress-container">
                  <div className="upload-status">
                    <span>Creating course and uploading materials...</span>
                    {uploadProgress > 0 && <span>{uploadProgress}%</span>}
                  </div>
                  {uploadProgress > 0 && (
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${uploadProgress}%` }} />
                    </div>
                  )}
                </div>
              )}

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={handlePreviousStep} disabled={isCreating}>
                  <ArrowLeft size={16} /> Back
                </button>
                <button type="button" className="btn btn-ghost" onClick={handleSkipMaterials} disabled={isCreating}>
                  {isCreating ? 'Creating...' : 'Skip for Now'}
                </button>
                {canvasEnabled && canvasConnected ? (
                  <button type="button" className="btn btn-primary" onClick={handleGoToCanvasStep} disabled={isCreating}>
                    Next <ArrowRight size={16} />
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={handleCreateCourse} disabled={isCreating}>
                    {isCreating ? 'Creating...' : 'Create Course'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Link to Canvas (Optional) */}
          {currentStep === 3 && (
            <div className="step-content">
              <div className="step-header">
                <h3>Link to Canvas Course</h3>
                <p>Optionally link this course to a Canvas course. A module named "{courseName}" will be created automatically.</p>
              </div>

              {!canvasConnected ? (
                <div className="canvas-connect-step">
                  <p>Connect your Canvas account to link courses.</p>
                  <button className="btn btn-primary" onClick={handleCanvasConnect} disabled={canvasLoading}>
                    {canvasLoading ? <Loader2 size={16} className="spinner" /> : <ExternalLink size={16} />}
                    Connect to Canvas
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: '0.875rem', opacity: 0.7 }}>Connected to Canvas</span>
                  <button className="btn btn-ghost btn-sm" onClick={handleDisconnect} disabled={isDisconnecting}>
                    {isDisconnecting ? <Loader2 size={14} className="spinner" /> : <LogOut size={14} />}
                    Disconnect
                  </button>
                </div>
              )}
              {canvasConnected && (selectedCourse ? (
                <div className="canvas-linked-info">
                  <div className="canvas-linked-card">
                    <Link2 size={20} />
                    <div>
                      <div className="canvas-linked-name">{selectedCourse.name}</div>
                      <div className="canvas-linked-meta">
                        {selectedCourse.courseCode}{selectedCourse.term ? ` — ${selectedCourse.term}` : ''}
                      </div>
                      <div className="canvas-linked-module">Module "{courseName}" will be created on submit</div>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={handleUnlinkCanvas} title="Unlink">
                      <Link2Off size={16} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="canvas-list-step">
                  {canvasLoading ? (
                    <div className="canvas-loading"><Loader2 size={24} className="spinner" /> Loading courses...</div>
                  ) : canvasCourses.length === 0 ? (
                    <p>No courses found. Make sure you are an instructor in at least one Canvas course.</p>
                  ) : (
                    <div className="canvas-item-list">
                      {canvasCourses.map(course => (
                        <button
                          key={course.id}
                          className="canvas-item-card"
                          onClick={() => handleSelectCourse(course)}
                        >
                          <div className="canvas-item-name">{course.name}</div>
                          <div className="canvas-item-meta">
                            {course.courseCode}{course.term ? ` — ${course.term}` : ''}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={handlePreviousStep} disabled={isCreating}>
                  <ArrowLeft size={16} /> Back
                </button>
                <button type="button" className="btn btn-ghost" onClick={handleSkipCanvas} disabled={isCreating || canvasLoading}>
                  {isCreating ? 'Creating...' : 'Skip Canvas'}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleCreateCourse}
                  disabled={isCreating || canvasLoading}
                >
                  {isCreating ? 'Creating...' : 'Create Course'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CreateCourseModal;
