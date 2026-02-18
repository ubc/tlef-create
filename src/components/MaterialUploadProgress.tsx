import { useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { X, RefreshCw, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { RootState } from '../store';
import {
  selectActiveUploadsByCourse,
  removeMaterialFromQueue,
  UploadMaterial
} from '../store/slices/uploadSlice';
import '../styles/components/MaterialUploadProgress.css';

interface MaterialUploadProgressProps {
  courseId: string;
  onRetry: (materialId: string, material: UploadMaterial) => void;
}

const MaterialUploadProgress = ({ courseId, onRetry }: MaterialUploadProgressProps) => {
  const dispatch = useDispatch();
  const activeUploads = useSelector((state: RootState) =>
    selectActiveUploadsByCourse(state, courseId)
  );

  const [dismissedMaterialIds, setDismissedMaterialIds] = useState<Set<string>>(new Set());

  // Filter out dismissed materials
  const visibleUploads = activeUploads.filter(m => !dismissedMaterialIds.has(m.id));

  // Don't render if no uploads to show
  if (visibleUploads.length === 0) {
    return null;
  }

  const handleDismiss = (materialId: string) => {
    setDismissedMaterialIds(prev => new Set(prev).add(materialId));
    // Optionally remove from queue after a delay
    setTimeout(() => {
      dispatch(removeMaterialFromQueue({ courseId, materialId }));
    }, 300);
  };

  const handleRetry = (material: UploadMaterial) => {
    onRetry(material.id, material);
  };

  const getStatusIcon = (status: UploadMaterial['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle size={18} className="status-icon success" />;
      case 'failed':
        return <AlertCircle size={18} className="status-icon error" />;
      case 'processing':
        return <Loader2 size={18} className="status-icon processing spinner" />;
      case 'uploading':
        return <Loader2 size={18} className="status-icon uploading spinner" />;
      default:
        return <Loader2 size={18} className="status-icon pending spinner" />;
    }
  };

  const getStatusText = (material: UploadMaterial) => {
    switch (material.status) {
      case 'pending':
        return 'Waiting...';
      case 'uploading':
        return `Uploading... ${material.progress}%`;
      case 'processing':
        return 'Processing chunks...';
      case 'completed':
        return 'Ready';
      case 'failed':
        return material.error || 'Upload failed';
      default:
        return 'Unknown status';
    }
  };

  const hasInProgress = visibleUploads.some(m =>
    m.status === 'uploading' || m.status === 'processing' || m.status === 'pending'
  );

  return (
    <div className="material-upload-progress">
      <div className="upload-progress-header">
        <h4>
          Uploading Materials ({visibleUploads.length})
        </h4>
        {hasInProgress && (
          <p className="upload-info-text">
            This may take a few minutes for large files
          </p>
        )}
      </div>

      <div className="upload-progress-list">
        {visibleUploads.map((material) => (
          <div
            key={material.id}
            className={`upload-item upload-item--${material.status}`}
          >
            <div className="upload-item-icon">
              {getStatusIcon(material.status)}
            </div>

            <div className="upload-item-content">
              <div className="upload-item-name">
                {material.name}
              </div>

              <div className="upload-item-status">
                {getStatusText(material)}
              </div>

              {/* Progress bar for uploading state */}
              {material.status === 'uploading' && (
                <div className="upload-progress-bar">
                  <div
                    className="upload-progress-fill"
                    style={{ width: `${material.progress}%` }}
                  />
                </div>
              )}
            </div>

            <div className="upload-item-actions">
              {/* Retry button for failed uploads */}
              {material.status === 'failed' && (
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => handleRetry(material)}
                  title="Retry upload"
                >
                  <RefreshCw size={16} />
                  Retry
                </button>
              )}

              {/* Dismiss button for completed or failed */}
              {(material.status === 'completed' || material.status === 'failed') && (
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => handleDismiss(material.id)}
                  title="Dismiss"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MaterialUploadProgress;
