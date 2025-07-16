import { useState, useRef } from 'react';
import { Upload, Link, FileText, X, Plus } from 'lucide-react';
import '../styles/components/MaterialUpload.css';

interface Material {
  id: string;
  name: string;
  type: 'pdf' | 'docx' | 'url' | 'text';
  uploadDate: string;
  content?: string;
}

interface MaterialUploadProps {
  materials: Material[];
  onAddMaterial: (material: Omit<Material, 'id' | 'uploadDate'>) => void;
  onRemoveMaterial: (id: string) => void;
}

const MaterialUpload = ({ materials, onAddMaterial, onRemoveMaterial }: MaterialUploadProps) => {
  const [urlInput, setUrlInput] = useState('');
  const [textInput, setTextInput] = useState('');
  const [showUrlForm, setShowUrlForm] = useState(false);
  const [showTextForm, setShowTextForm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      Array.from(files).forEach((file) => {
        const type = file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx';
        onAddMaterial({
          name: file.name,
          type,
          content: `Uploaded file: ${file.name}`
        });
      });
    }
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (urlInput.trim()) {
      onAddMaterial({
        name: `URL: ${urlInput}`,
        type: 'url',
        content: urlInput
      });
      setUrlInput('');
      setShowUrlForm(false);
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (textInput.trim()) {
      onAddMaterial({
        name: `Text: ${textInput.substring(0, 30)}...`,
        type: 'text',
        content: textInput
      });
      setTextInput('');
      setShowTextForm(false);
    }
  };

  const getFileIcon = (type: string) => {
    switch (type) {
      case 'pdf':
      case 'docx':
        return <FileText size={20} />;
      case 'url':
        return <Link size={20} />;
      case 'text':
        return <FileText size={20} />;
      default:
        return <FileText size={20} />;
    }
  };

  return (
      <div className="material-upload">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Course Materials</h3>
            <p className="card-description">
              Upload files or add links to your course content
            </p>
          </div>

          {/* Upload Actions */}
          <div className="upload-actions">
            <div
                className="upload-zone"
                onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={24} />
              <p>Click to upload files or drag and drop</p>
              <span className="upload-hint">PDF, DOCX files accepted</span>
            </div>

            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.docx,.doc"
                onChange={handleFileUpload}
                style={{ display: 'none' }}
            />

            <div className="upload-buttons">
              <button
                  className="btn btn-outline"
                  onClick={() => setShowUrlForm(!showUrlForm)}
              >
                <Link size={16} />
                Add URL
              </button>

              <button
                  className="btn btn-outline"
                  onClick={() => setShowTextForm(!showTextForm)}
              >
                <Plus size={16} />
                Add Text
              </button>
            </div>
          </div>

          {/* URL Form */}
          {showUrlForm && (
              <form onSubmit={handleUrlSubmit} className="url-form">
                <input
                    type="url"
                    className="input"
                    placeholder="Enter website URL..."
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    required
                />
                <div className="form-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowUrlForm(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Add URL
                  </button>
                </div>
              </form>
          )}

          {/* Text Form */}
          {showTextForm && (
              <form onSubmit={handleTextSubmit} className="text-form">
            <textarea
                className="textarea"
                placeholder="Paste your text content here..."
                rows={4}
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                required
            />
                <div className="form-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowTextForm(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Add Text
                  </button>
                </div>
              </form>
          )}

          {/* Materials List */}
          {materials.length > 0 && (
              <div className="materials-list">
                <h4>Uploaded Materials ({materials.length})</h4>
                <div className="materials-grid">
                  {materials.map((material) => (
                      <div key={material.id} className="material-card">
                        <div className="material-info">
                          {getFileIcon(material.type)}
                          <div>
                            <div className="material-name">{material.name}</div>
                            <div className="material-meta">
                              {material.type.toUpperCase()} • {material.uploadDate}
                            </div>
                          </div>
                        </div>
                        <button
                            className="btn btn-ghost material-remove"
                            onClick={() => onRemoveMaterial(material.id)}
                        >
                          <X size={16} />
                        </button>
                      </div>
                  ))}
                </div>
              </div>
          )}
        </div>
      </div>
  );
};

export default MaterialUpload;