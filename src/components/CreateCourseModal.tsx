import { useState, useEffect } from 'react';
import { X, ArrowLeft, ArrowRight } from 'lucide-react';
import MaterialUpload from './MaterialUpload';
import { usePubSub } from '../hooks/usePubSub';
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

interface CreateCourseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (courseName: string, materials: Material[]) => Promise<void>;
}

const CreateCourseModal = ({ isOpen, onClose, onSubmit }: CreateCourseModalProps) => {
  const [courseName, setCourseName] = useState('');
  const [currentStep, setCurrentStep] = useState(1);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const { subscribe } = usePubSub('CreateCourseModal');

  // Listen for upload progress events from Sidebar
  useEffect(() => {
    const handleUploadProgress = (data: { progress: number }) => {
      console.log('📊 Upload progress received:', data.progress);
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
    setCurrentStep(1);
  };

  const handleAddMaterial = (
    material: { name: string; type: 'pdf' | 'docx' | 'url' | 'text'; content?: string; file?: File },
    onProgress?: (progress: number) => void
  ) => {
    console.log('➕ CreateCourseModal: Adding material:', material);
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
    console.log('✅ CreateCourseModal: Material created:', newMaterial);
    setMaterials([...materials, newMaterial]);

    // Note: Actual upload happens when course is created in Sidebar.tsx
    // This just stores the file for later upload
  };

  const handleRemoveMaterial = (id: string) => {
    setMaterials(materials.filter(material => material.id !== id));
  };

  const handleCreateCourse = async () => {
    if (courseName.trim() && !isCreating) {
      setIsCreating(true);
      setUploadProgress(0);
      try {
        await onSubmit(courseName.trim(), materials);
        resetModal();
        onClose();
      } catch (error) {
        console.error('Failed to create course:', error);
        // Error is handled in Sidebar
      } finally {
        setIsCreating(false);
        setUploadProgress(0);
      }
    }
  };

  const handleSkipMaterials = async () => {
    if (courseName.trim() && !isCreating) {
      setIsCreating(true);
      try {
        await onSubmit(courseName.trim(), []);
        resetModal();
        onClose();
      } catch (error) {
        console.error('Failed to create course:', error);
        // Error is handled in Sidebar
      } finally {
        setIsCreating(false);
      }
    }
  };

  const resetModal = () => {
    setCourseName('');
    setMaterials([]);
    setCurrentStep(1);
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
            {/* Step 1: Course Name Only */}
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
                  />
                </div>

                <div className="modal-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => { resetModal(); onClose(); }}>
                    Cancel
                  </button>
                  <button 
                      type="button" 
                      className="btn btn-primary"
                      onClick={handleNextStep}
                      disabled={!courseName.trim()}
                  >
                    Next
                    <ArrowRight size={16} />
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

                {/* Upload Progress Indicator */}
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
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handlePreviousStep}
                    disabled={isCreating}
                  >
                    <ArrowLeft size={16} />
                    Back
                  </button>
                  <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={handleSkipMaterials}
                      disabled={isCreating}
                  >
                    {isCreating ? 'Creating...' : 'Skip for Now'}
                  </button>
                  <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleCreateCourse}
                      disabled={isCreating}
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