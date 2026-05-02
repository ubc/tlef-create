import { useState, useRef } from 'react';
import { Key, Eye, EyeOff, Settings, Loader } from 'lucide-react';
import { apiKeyApi } from '../services/api';
import { useNavigate } from 'react-router-dom';

interface Props {
  onDismiss: () => void;
}

const FirstUseApiKeyModal = ({ onDismiss }: Props) => {
  const navigate = useNavigate();
  const [key, setKey] = useState('');
  const [modelName, setModelName] = useState('');
  const [label, setLabel] = useState('');
  const [provider, setProvider] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [showKey, setShowKey] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [keyError, setKeyError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleKeyChange = (value: string) => {
    setKey(value);
    setModels([]);
    setModelName('');
    setProvider('');
    setKeyError('');

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.length < 20) return;

    debounceRef.current = setTimeout(async () => {
      setFetchingModels(true);
      try {
        const res = await apiKeyApi.fetchModels(value);
        if (res.data) {
          setProvider(res.data.provider);
          setModels(res.data.models);
          setModelName(res.data.models[0] || '');
        }
      } catch {
        setKeyError('Could not verify this API key. Please check it and try again.');
      } finally {
        setFetchingModels(false);
      }
    }, 600);
  };

  const handleSave = async () => {
    if (!key.trim() || !modelName.trim()) {
      setError('Please enter a valid API key and select a model.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await apiKeyApi.createKey(provider, key, modelName, label || undefined);
      onDismiss();
    } catch {
      setError('Failed to save API key. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-content" style={{ maxWidth: 620, width: 'calc(100vw - 48px)', maxHeight: '90vh', overflowY: 'auto', zIndex: 10000, padding: '32px' }}>
        <div className="modal-header">
          <Key size={20} />
          <h4 style={{ marginLeft: 8 }}>Add Your LLM API Key</h4>
        </div>

        <p style={{ color: 'var(--color-muted-foreground)', marginBottom: 16 }}>
          To use AI features, you need to provide an API key. Your key is encrypted and stored securely — it will never be shared.
        </p>
        <p style={{ color: 'var(--color-muted-foreground)', fontSize: 'var(--font-size-sm)', marginBottom: 20 }}>
          You can update or change your key anytime in <strong>Account → General Settings</strong>.
        </p>

        {error && <p style={{ color: 'var(--color-destructive)', marginBottom: 12 }}>{error}</p>}

        <div className="form-field" style={{ marginBottom: 10 }}>
          <label>API Key</label>
          <div style={{ position: 'relative' }}>
            <input
              className="input"
              type={showKey ? 'text' : 'password'}
              placeholder="sk-... or AIza..."
              value={key}
              onChange={e => handleKeyChange(e.target.value)}
              style={{ paddingRight: 72 }}
            />
            <div style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: 4 }}>
              {fetchingModels && <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />}
              <button className="btn btn-ghost btn-sm" onClick={() => setShowKey(!showKey)} type="button">
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          {keyError && <p style={{ color: 'var(--color-destructive)', fontSize: 'var(--font-size-sm)', marginTop: 4 }}>{keyError}</p>}
          {provider && !fetchingModels && (
            <p style={{ color: 'var(--color-primary)', fontSize: 'var(--font-size-sm)', marginTop: 4 }}>
              ✓ Detected: <strong>{provider}</strong>
            </p>
          )}
        </div>

        {models.length > 0 && (
          <div className="form-field" style={{ marginBottom: 10 }}>
            <label>Model</label>
            <select className="select-input" value={modelName} onChange={e => setModelName(e.target.value)}>
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        )}

        <div className="form-field" style={{ marginBottom: 20 }}>
          <label>Label <span style={{ color: 'var(--color-muted-foreground)' }}>(optional)</span></label>
          <input className="input" placeholder="My OpenAI key" value={label} onChange={e => setLabel(e.target.value)} />
        </div>

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !models.length}>
            {saving ? 'Saving...' : 'Save & Continue'}
          </button>
          <button className="btn btn-outline" onClick={() => { onDismiss(); navigate('/account'); }}>
            <Settings size={14} /> Set Up Later in Settings
          </button>
        </div>
      </div>
    </div>
  );
};

export default FirstUseApiKeyModal;
