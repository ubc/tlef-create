import { useState, useEffect, useRef } from 'react';
import { Key, Plus, Trash2, Eye, EyeOff, Loader } from 'lucide-react';
import { apiKeyApi, ApiKey } from '../../services/api';

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  google: 'Google (Gemini)'
};

const ApiKeySettings = () => {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [envKey, setEnvKey] = useState<{ provider: string; modelName: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [key, setKey] = useState('');
  const [modelName, setModelName] = useState('');
  const [label, setLabel] = useState('');
  const [provider, setProvider] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [keyError, setKeyError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { loadKeys(); }, []);

  const loadKeys = async () => {
    try {
      const res = await apiKeyApi.getKeys();
      setKeys(res.data?.apiKeys || []);
      setEnvKey(res.data?.envKey || null);
    } catch {
      setError('Failed to load API keys.');
    } finally {
      setLoading(false);
    }
  };

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

  const handleAdd = async () => {
    if (!key.trim() || !modelName.trim()) {
      setError('Please enter a valid API key and select a model.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await apiKeyApi.createKey(provider, key, modelName, label || undefined);
      setKey(''); setModelName(''); setLabel(''); setProvider(''); setModels([]);
      setShowAddForm(false);
      await loadKeys();
    } catch {
      setError('Failed to save API key.');
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setKey(''); setModelName(''); setLabel(''); setProvider('');
    setModels([]); setKeyError(''); setError('');
    setShowAddForm(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this API key?')) return;
    try {
      await apiKeyApi.deleteKey(id);
      setKeys(prev => prev.filter(k => k._id !== id));
    } catch {
      setError('Failed to delete API key.');
    }
  };

  const handleToggleActive = async (id: string, current: boolean) => {
    try {
      await apiKeyApi.updateKey(id, { isActive: !current });
      setKeys(prev => prev.map(k => k._id === id ? { ...k, isActive: !current } : k));
    } catch {
      setError('Failed to update API key.');
    }
  };

  return (
    <div className="api-key-settings">
      <div className="card-header">
        <h3 className="card-title"><Key size={18} style={{ display: 'inline', marginRight: 8 }} />LLM API Keys</h3>
        <p className="card-description">Add your own API key to use AI features. Your key is encrypted and stored securely.</p>
      </div>

      {error && <div style={{ color: 'var(--color-destructive)', marginBottom: 12 }}>{error}</div>}

      {loading ? (
        <p style={{ color: 'var(--color-muted-foreground)' }}>Loading...</p>
      ) : (
        <>
          {envKey && (
            <div className="setting-item" style={{ justifyContent: 'space-between', opacity: 0.75, cursor: 'default' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Key size={16} />
                <div>
                  <div style={{ fontWeight: 500 }}>{PROVIDER_LABELS[envKey.provider] || envKey.provider}</div>
                  <div style={{ fontSize: 'var(--font-size-sm)', opacity: 0.6 }}>
                    Model: {envKey.modelName} · System key (read-only)
                  </div>
                </div>
              </div>
              <span style={{ fontSize: 'var(--font-size-sm)', opacity: 0.6 }}>Managed by admin</span>
            </div>
          )}

          {keys.length === 0 && !envKey && !showAddForm && (
            <p style={{ color: 'var(--color-muted-foreground)', marginBottom: 12 }}>No API keys configured yet.</p>
          )}

          {keys.map(k => (
            <div key={k._id} className="setting-item" style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Key size={16} />
                <div>
                  <div style={{ fontWeight: 500 }}>{PROVIDER_LABELS[k.provider] || k.provider}</div>
                  <div style={{ fontSize: 'var(--font-size-sm)', opacity: 0.6 }}>
                    {k.label && <span>{k.label} · </span>}
                    Model: {k.modelName} · ···{k.keyHint}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className={`btn btn-sm ${k.isActive ? 'btn-outline' : 'btn-ghost'}`} onClick={() => handleToggleActive(k._id, k.isActive)}>
                  {k.isActive ? 'Active' : 'Disabled'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(k._id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}

          {showAddForm && (
            <div className="card" style={{ marginTop: 12, padding: 16 }}>
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
                    ✓ Detected: <strong>{PROVIDER_LABELS[provider] || provider}</strong>
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

              <div className="form-field" style={{ marginBottom: 12 }}>
                <label>Label <span style={{ color: 'var(--color-muted-foreground)' }}>(optional)</span></label>
                <input className="input" placeholder="My OpenAI key" value={label} onChange={e => setLabel(e.target.value)} />
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={handleAdd} disabled={saving || !models.length}>
                  {saving ? 'Saving...' : 'Save Key'}
                </button>
                <button className="btn btn-outline" onClick={resetForm}>Cancel</button>
              </div>
            </div>
          )}

          {!showAddForm && (
            <button className="btn btn-outline" style={{ marginTop: 12 }} onClick={() => setShowAddForm(true)}>
              <Plus size={16} /> Add API Key
            </button>
          )}
        </>
      )}
    </div>
  );
};

export default ApiKeySettings;
