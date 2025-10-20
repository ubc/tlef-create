import { useState, useRef, useEffect } from 'react';
import { Upload, Link, FileText, X, Plus, Loader2 } from 'lucide-react';
import { usePubSub } from '../hooks/usePubSub';
import '../styles/components/MaterialUpload.css';

interface Material {
  id: string;
  name: string;
  type: 'pdf' | 'docx' | 'url' | 'text';
  uploadDate: string;
  content?: string;
  uploadProgress?: number;
  isUploading?: boolean;
  processingStatus?: 'pending' | 'processing' | 'completed' | 'failed';
}

interface MaterialUploadProps {
  materials: Material[];
  onAddMaterial: (material: { name: string; type: 'pdf' | 'docx' | 'url' | 'text'; content?: string; file?: File }) => void;
  onRemoveMaterial: (id: string) => void;
}

const MaterialUpload = ({ materials, onAddMaterial, onRemoveMaterial }: MaterialUploadProps) => {
  const [urlInput, setUrlInput] = useState('');
  const [textInput, setTextInput] = useState('');
  const [showUrlForm, setShowUrlForm] = useState(false);
  const [showTextForm, setShowTextForm] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { showNotification } = usePubSub('MaterialUpload');

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      processFiles(files);
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const processFiles = (files: FileList) => {
    Array.from(files).forEach(file => {
      // Validate file type
      const validTypes = ['.pdf', '.docx', '.doc'];
      const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
      
      if (!validTypes.includes(fileExtension)) {
        showNotification('error', 'Invalid File Type', `${file.name} is not a supported file type. Please upload PDF or DOCX files.`);
        return;
      }

      // Validate file size (100MB limit)
      if (file.size > 100 * 1024 * 1024) {
        showNotification('error', 'File Too Large', `${file.name} is too large. Please upload files smaller than 100MB.`);
        return;
      }

      onAddMaterial({
        name: file.name,
        type: file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx',
        file: file
      });
    });
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      processFiles(files);
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
      showNotification('success', 'URL Added', 'Website URL has been added to materials');
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
      showNotification('success', 'Text Added', 'Text content has been added to materials');
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

  // Use materials directly since we don't have uploading files anymore
  const allMaterials = materials;

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
                className={`upload-zone ${isDragOver ? 'drag-over' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
              <Upload size={24} />
              <p>{isDragOver ? 'Drop files here' : 'Click to upload files or drag and drop'}</p>
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
              <div className="url-form">
                <form onSubmit={handleUrlSubmit}>
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
              </div>
          )}

          {/* Text Form */}
          {showTextForm && (
              <div className="text-form">
                <form onSubmit={handleTextSubmit}>
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
              </div>
          )}

          {/* Materials List */}
          {allMaterials.length > 0 && (
              <div className="materials-list">
                <h4>Materials ({materials.length})</h4>
                <div className="materials-grid">
                  {allMaterials.map((material) => {
                    const isProcessing = material.processingStatus === 'pending' || material.processingStatus === 'processing';

                    return (
                      <div key={material.id} className="material-card">
                        <div className="material-info">
                          {getFileIcon(material.type)}
                          <div>
                            <div className="material-name">{material.name}</div>
                            <div className="material-meta">
                              {material.type.toUpperCase()} • {material.uploadDate}
                              {isProcessing && (
                                <span className="processing-badge">
                                  Processing...
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        {isProcessing ? (
                          <div className="material-processing">
                            <Loader2 size={16} className="spinner" />
                          </div>
                        ) : (
                          <button
                              className="btn btn-ghost material-remove"
                              onClick={() => onRemoveMaterial(material.id)}
                          >
                            <X size={16} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
          )}
        </div>
      </div>
  );
};

export default MaterialUpload;