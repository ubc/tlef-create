interface ModeToggleProps {
  mode: 'manual' | 'ai-auto';
  onChange: (mode: 'manual' | 'ai-auto') => void;
  disabled?: boolean;
}

export default function ModeToggle({ mode, onChange, disabled = false }: ModeToggleProps) {
  return (
    <div className="mode-toggle">
      <button
        className={`mode-toggle-btn ${mode === 'manual' ? 'active' : ''}`}
        onClick={() => onChange('manual')}
        disabled={disabled}
      >
        Manual Mode
      </button>
      <button
        className={`mode-toggle-btn ${mode === 'ai-auto' ? 'active' : ''}`}
        onClick={() => onChange('ai-auto')}
        disabled={disabled}
      >
        AI Auto Mode
      </button>
    </div>
  );
}
