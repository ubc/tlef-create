import { useState, useRef, useEffect } from 'react';
import { Upload, Link, FileText, X, Plus, Loader2, Eye } from 'lucide-react';
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
  onAddMaterial: (
    material: { name: string; type: 'pdf' | 'docx' | 'url' | 'text'; content?: string; file?: File },
    onProgress?: (progress: number) => void
  ) => void;
  onRemoveMaterial: (id: string) => void;
}

const MaterialUpload = ({ materials, onAddMaterial, onRemoveMaterial }: MaterialUploadProps) => {
  const [urlInput, setUrlInput] = useState('');
  const [textInput, setTextInput] = useState('');
  const [showUrlForm, setShowUrlForm] = useState(false);
  const [showTextForm, setShowTextForm] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewMaterial, setPreviewMaterial] = useState<Material | null>(null);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Track upload progress for each file
  const [uploadingFiles, setUploadingFiles] = useState<Map<string, number>>(new Map());

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
    Array.from(files).forEach(async (file) => {
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

      // Add file to uploading state
      const fileId = `${file.name}-${Date.now()}`;
      setUploadingFiles(prev => {
        const newMap = new Map(prev);
        newMap.set(fileId, 0);
        return newMap;
      });

      // Call onAddMaterial with progress callback
      try {
        await onAddMaterial(
          {
            name: file.name,
            type: file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx',
            file: file
          },
          (progress) => {
            // Update progress state
            setUploadingFiles(prev => {
              const newMap = new Map(prev);
              newMap.set(fileId, progress);
              return newMap;
            });
          }
        );

        // Remove from uploading state when complete
        setUploadingFiles(prev => {
          const newMap = new Map(prev);
          newMap.delete(fileId);
          return newMap;
        });

        showNotification('success', 'Upload Complete', `${file.name} uploaded successfully!`);
      } catch (error) {
        // Remove from uploading state on error
        setUploadingFiles(prev => {
          const newMap = new Map(prev);
          newMap.delete(fileId);
          return newMap;
        });
        // Error notification already handled in CourseView
      }
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

  const handlePreview = async (material: Material) => {
    setPreviewMaterial(material);
    setShowPreview(true);
    setIsLoadingPreview(true);
    setPreviewContent('');

    try {
      const response = await fetch(`/api/create/materials/${material.id}/preview`);

      if (!response.ok) {
        throw new Error('Failed to fetch material preview');
      }

      const data = await response.json();

      if (data.success) {
        setPreviewContent(data.data.content);
      } else {
        showNotification('error', 'Preview Error', data.error || 'Failed to load preview');
        setShowPreview(false);
      }
    } catch (error) {
      console.error('Error fetching preview:', error);
      showNotification('error', 'Preview Error', 'Failed to load material preview');
      setShowPreview(false);
    } finally {
      setIsLoadingPreview(false);
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
                  <div className="url-allowlist-info">
                    <p className="allowlist-title">Accepted URL Types:</p>
                    <ul className="allowlist-items">
                      <li>✓ Direct PDF links</li>
                      <li>✓ Static websites with text content</li>
                      <li>✗ Google Drive, Dropbox, OneDrive links</li>
                      <li>✗ Direct image, video, or audio files</li>
                      <li>✗ Archive files (ZIP, RAR, etc.)</li>
                    </ul>
                    <p className="allowlist-note">For cloud storage files, please download and upload directly.</p>
                  </div>
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

          {/* Uploading Files Progress */}
          {uploadingFiles.size > 0 && (
              <div className="uploading-files-list">
                <h4>Uploading ({uploadingFiles.size})</h4>
                <div className="uploading-files">
                  {Array.from(uploadingFiles.entries()).map(([fileId, progress]) => {
                    const fileName = fileId.split('-').slice(0, -1).join('-'); // Remove timestamp
                    return (
                      <div key={fileId} className="uploading-file-card">
                        <div className="upload-info">
                          <Upload size={20} />
                          <div className="upload-details">
                            <div className="upload-name">{fileName}</div>
                            <div className="upload-progress-bar">
                              <div
                                className="upload-progress-fill"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                            <div className="upload-percentage">{progress}%</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
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
                          <div className="material-actions">
                            <button
                                className="btn btn-ghost material-preview"
                                onClick={() => handlePreview(material)}
                                title="Preview content"
                            >
                              <Eye size={16} />
                            </button>
                            <button
                                className="btn btn-ghost material-remove"
                                onClick={() => onRemoveMaterial(material.id)}
                                title="Remove material"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
          )}

          {/* Preview Modal */}
          {showPreview && previewMaterial && (
              <div className="modal-overlay" onClick={() => setShowPreview(false)}>
                <div className="modal-content preview-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="modal-header">
                    <div>
                      <h3 className="modal-title">{previewMaterial.name}</h3>
                      <p className="modal-subtitle">
                        {previewMaterial.type.toUpperCase()} • {previewMaterial.uploadDate}
                      </p>
                    </div>
                    <button
                        className="btn btn-ghost modal-close"
                        onClick={() => setShowPreview(false)}
                    >
                      <X size={20} />
                    </button>
                  </div>
                  <div className="modal-body">
                    {isLoadingPreview ? (
                        <div className="preview-loading">
                          <Loader2 size={32} className="spinner" />
                          <p>Loading content...</p>
                        </div>
                    ) : (
                        <div className="preview-content">
                          <pre>{previewContent}</pre>
                        </div>
                    )}
                  </div>
                </div>
              </div>
          )}
        </div>
      </div>
  );
};

export default MaterialUpload;