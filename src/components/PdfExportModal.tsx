import { X, FileText, Check } from 'lucide-react';
import '../styles/components/PdfExportModal.css';

interface PdfExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (type: 'questions' | 'answers' | 'combined') => void;
  isLoading: boolean;
}

const PdfExportModal = ({ isOpen, onClose, onExport, isLoading }: PdfExportModalProps) => {
  if (!isOpen) return null;

  const exportOptions = [
    {
      type: 'questions' as const,
      title: 'Questions Only',
      description: 'Export only the quiz questions without answers',
      icon: <FileText size={24} />
    },
    {
      type: 'answers' as const,
      title: 'Answers Only',
      description: 'Export only the answer key for the quiz',
      icon: <Check size={24} />
    },
    {
      type: 'combined' as const,
      title: 'Combined',
      description: 'Export questions and answers together in one PDF',
      icon: <FileText size={24} />
    }
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content pdf-export-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 className="modal-title">Export to PDF</h3>
            <p className="modal-subtitle">Choose what to include in your PDF export</p>
          </div>
          <button
            className="btn btn-ghost modal-close"
            onClick={onClose}
            disabled={isLoading}
          >
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          <div className="export-options">
            {exportOptions.map((option) => (
              <button
                key={option.type}
                className="export-option-card"
                onClick={() => onExport(option.type)}
                disabled={isLoading}
              >
                <div className="export-option-icon">{option.icon}</div>
                <div className="export-option-content">
                  <h4 className="export-option-title">{option.title}</h4>
                  <p className="export-option-description">{option.description}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PdfExportModal;
