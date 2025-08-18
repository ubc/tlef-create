import { useState } from 'react';
import { X, ArrowLeft, ArrowRight } from 'lucide-react';
import MaterialUpload from './MaterialUpload';
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
  onSubmit: (courseName: string, materials: Material[]) => void;
}

const CreateCourseModal = ({ isOpen, onClose, onSubmit }: CreateCourseModalProps) => {
  const [courseName, setCourseName] = useState('');
  const [currentStep, setCurrentStep] = useState(1);
  const [materials, setMaterials] = useState<Material[]>([]);

  if (!isOpen) return null;

  const handleNextStep = () => {
    if (courseName.trim()) {
      setCurrentStep(2);
    }
  };

  const handlePreviousStep = () => {
    setCurrentStep(1);
  };

  const handleAddMaterial = (material: { name: string; type: 'pdf' | 'docx' | 'url' | 'text'; content?: string; file?: File }) => {
    console.log('➕ CreateCourseModal: Adding material:', material);
    const newMaterial: Material = {
      id: Date.now().toString(),
      name: material.name,
      type: material.type,
      uploadDate: new Date().toLocaleDateString(),
      content: material.content,
      file: material.file,
      isUploading: false
    };
    console.log('✅ CreateCourseModal: Material created:', newMaterial);
    setMaterials([...materials, newMaterial]);
  };

  const handleRemoveMaterial = (id: string) => {
    setMaterials(materials.filter(material => material.id !== id));
  };

  const handleCreateCourse = () => {
    if (courseName.trim()) {
      onSubmit(courseName.trim(), materials);
      resetModal();
      onClose();
    }
  };

  const handleSkipMaterials = () => {
    if (courseName.trim()) {
      onSubmit(courseName.trim(), []);
      resetModal();
      onClose();
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

                <div className="modal-actions">
                  <button type="button" className="btn btn-secondary" onClick={handlePreviousStep}>
                    <ArrowLeft size={16} />
                    Back
                  </button>
                  <button 
                      type="button" 
                      className="btn btn-ghost"
                      onClick={handleSkipMaterials}
                  >
                    Skip for Now
                  </button>
                  <button 
                      type="button" 
                      className="btn btn-primary"
                      onClick={handleCreateCourse}
                  >
                    Create Course
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