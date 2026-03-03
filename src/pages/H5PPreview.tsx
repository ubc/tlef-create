import { useState, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Upload, FileUp, Loader2, AlertCircle, ExternalLink } from 'lucide-react';
import { API_URL } from '../config/api';

interface UploadResult {
  id: string;
  title: string;
  mainLibrary: string;
}

const H5PPreview = () => {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setError(null);
      setResult(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('h5pFile', file);

      const response = await fetch(`${API_URL}/api/create/h5p-preview/upload`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error?.message || 'Upload failed');
      }

      setResult(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Use relative path so the iframe goes through vite proxy (same origin — avoids CSP frame-ancestors block)
  const renderUrl = result
    ? `/api/create/h5p-preview/${result.id}/render`
    : null;

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '24px' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px', color: '#1e293b' }}>
          H5P Preview
        </h1>
        <p style={{ color: '#64748b', marginBottom: '24px' }}>
          Upload an .h5p file to preview it with real H5P library rendering.
        </p>

        {/* Upload Card */}
        <Card style={{ marginBottom: '24px' }}>
          <CardHeader>
            <CardTitle style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Upload size={20} />
              Upload H5P File
            </CardTitle>
            <CardDescription>
              Select a .h5p file exported from this app or any H5P editor.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".h5p"
                onChange={handleFileChange}
                style={{
                  padding: '8px',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  fontSize: '14px',
                  flex: '1',
                  minWidth: '200px',
                }}
              />
              <Button
                onClick={handleUpload}
                disabled={!file || uploading}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                {uploading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <FileUp size={16} />
                    Upload & Preview
                  </>
                )}
              </Button>
              {result && (
                <Button variant="outline" onClick={handleReset}>
                  Reset
                </Button>
              )}
            </div>

            {error && (
              <div style={{
                marginTop: '12px',
                padding: '12px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '6px',
                color: '#dc2626',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '14px',
              }}>
                <AlertCircle size={16} />
                {error}
              </div>
            )}

            {result && (
              <div style={{
                marginTop: '12px',
                padding: '12px',
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: '6px',
                fontSize: '14px',
                color: '#166534',
              }}>
                <strong>{result.title}</strong> — {result.mainLibrary}
                {renderUrl && (
                  <a
                    href={renderUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      marginLeft: '12px',
                      color: '#2563eb',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    Open in new tab <ExternalLink size={14} />
                  </a>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Preview iframe */}
        {renderUrl && (
          <Card>
            <CardHeader>
              <CardTitle>Preview: {result?.title}</CardTitle>
            </CardHeader>
            <CardContent style={{ padding: 0 }}>
              <iframe
                src={renderUrl}
                style={{
                  width: '100%',
                  minHeight: '600px',
                  border: 'none',
                  borderRadius: '0 0 8px 8px',
                }}
                title="H5P Preview"
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default H5PPreview;
