import { useState, useRef, useEffect } from 'react';
import { Upload, Link, FileText, X, Plus } from 'lucide-react';
import { usePubSub } from '../hooks/usePubSub';
import { PUBSUB_EVENTS, FileUploadCompletedPayload, FileUploadProgressPayload, pubsubService } from '../services/pubsubService';
import '../styles/components/MaterialUpload.css';

interface Material {
  id: string;
  name: string;
  type: 'pdf' | 'docx' | 'url' | 'text';
  uploadDate: string;
  content?: string;
  uploadProgress?: number;
  isUploading?: boolean;
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
  const [uploadingFiles, setUploadingFiles] = useState<Map<string, Material>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { subscribe, showNotification, showLoading, hideLoading, reportError } = usePubSub('MaterialUpload');

  // Subscribe to upload events
  useEffect(() => {
    const progressToken = subscribe<FileUploadProgressPayload>(
        PUBSUB_EVENTS.FILE_UPLOAD_PROGRESS,
        (data) => {
          setUploadingFiles(prev => {
            const updated = new Map(prev);
            const file = updated.get(data.fileId);
            if (file) {
              updated.set(data.fileId, { ...file, uploadProgress: data.progress });
            }
            return updated;
          });
        }
    );

    const completedToken = subscribe<FileUploadCompletedPayload>(
        PUBSUB_EVENTS.FILE_UPLOAD_COMPLETED,
        (data) => {
          // Remove from uploading files
          setUploadingFiles(prev => {
            const updated = new Map(prev);
            updated.delete(data.fileId);
            return updated;
          });

          // Add to materials list
          const type = data.fileName.toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx';
          onAddMaterial({
            name: data.fileName,
            type,
            content: data.parsedContent || `Uploaded file: ${data.fileName}`
          });

          showNotification('success', 'Upload Complete', `${data.fileName} has been processed successfully`);
          hideLoading(data.fileId);
        }
    );

    const failedToken = subscribe(PUBSUB_EVENTS.FILE_UPLOAD_FAILED, (data: any) => {
      setUploadingFiles(prev => {
        const updated = new Map(prev);
        updated.delete(data.fileId);
        return updated;
      });

      showNotification('error', 'Upload Failed', data.error || 'Failed to upload file');
      hideLoading(data.fileId);
    });

    return () => {
      // Cleanup handled by usePubSub hook
    };
  }, [subscribe, onAddMaterial, showNotification, hideLoading]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      Array.from(files).forEach((file) => {
        const fileId = `file-${Date.now()}-${Math.random()}`;
        const type = file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx';

        // Add to uploading files map
        const uploadingFile: Material = {
          id: fileId,
          name: file.name,
          type,
          uploadDate: new Date().toLocaleDateString(),
          uploadProgress: 0,
          isUploading: true,
        };

        setUploadingFiles(prev => new Map(prev.set(fileId, uploadingFile)));

        // Show loading state
        showLoading(`Uploading ${file.name}...`, fileId);

        // Simulate file upload with progress
        simulateFileUpload(file, fileId);
      });
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const simulateFileUpload = async (file: File, fileId: string) => {
    try {
      // Simulate upload progress
      for (let progress = 0; progress <= 100; progress += 10) {
        await new Promise(resolve => setTimeout(resolve, 200));

        // Publish progress event using static import
        const progressData: FileUploadProgressPayload = { fileId, progress };
        pubsubService.publish(PUBSUB_EVENTS.FILE_UPLOAD_PROGRESS, progressData);
      }

      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Publish completion event
      const completedData: FileUploadCompletedPayload = {
        fileId,
        fileName: file.name,
        materialId: `material-${Date.now()}`,
        parsedContent: `Processed content from ${file.name}`,
      };

      pubsubService.publish(PUBSUB_EVENTS.FILE_UPLOAD_COMPLETED, completedData);

    } catch (error) {
      // Publish error event
      pubsubService.publish(PUBSUB_EVENTS.FILE_UPLOAD_FAILED, {
        fileId,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      });

      reportError(error instanceof Error ? error : new Error('Upload failed'), 'MaterialUpload.simulateFileUpload');
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

  // Combine regular materials with uploading files for display
  const allMaterials = [
    ...materials,
    ...Array.from(uploadingFiles.values())
  ];

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
                  {allMaterials.map((material) => (
                      <div key={material.id} className="material-card">
                        <div className="material-info">
                          {getFileIcon(material.type)}
                          <div>
                            <div className="material-name">{material.name}</div>
                            <div className="material-meta">
                              {material.type.toUpperCase()} • {material.uploadDate}
                              {material.isUploading && (
                                  <span> • Uploading {material.uploadProgress}%</span>
                              )}
                            </div>
                            {material.isUploading && (
                                <div className="upload-progress">
                                  <div
                                      className="upload-progress-bar"
                                      style={{ width: `${material.uploadProgress}%` }}
                                  />
                                </div>
                            )}
                          </div>
                        </div>
                        {!material.isUploading && (
                            <button
                                className="btn btn-ghost material-remove"
                                onClick={() => onRemoveMaterial(material.id)}
                            >
                              <X size={16} />
                            </button>
                        )}
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