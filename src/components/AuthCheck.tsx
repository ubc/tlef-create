import { useState, useEffect } from 'react';
import { apiClient } from '../services/api';

interface AuthStatus {
  authenticated: boolean;
  loading: boolean;
  error?: string;
}

interface AuthCheckProps {
  children: React.ReactNode;
}

const AuthCheck = ({ children }: AuthCheckProps) => {
  const [authStatus, setAuthStatus] = useState<AuthStatus>({
    authenticated: false,
    loading: true
  });

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const response = await apiClient.get<{ authenticated: boolean; user?: any }>('/auth/me');
      setAuthStatus({
        authenticated: response.authenticated,
        loading: false
      });
    } catch (error) {
      console.error('❌ Auth check failed:', error);
      setAuthStatus({
        authenticated: false,
        loading: false,
        error: 'Failed to check authentication status'
      });
    }
  };

  if (authStatus.loading) {
    return (
      <div className="auth-loading">
        <div>Checking authentication...</div>
      </div>
    );
  }

  if (!authStatus.authenticated) {
    return (
      <div className="auth-required">
        <div className="card">
          <div className="card-header">
            <h2>Authentication Required</h2>
          </div>
          <div className="card-content">
            <p>You need to log in to access this application.</p>
            <p>Please click the button below to authenticate via SAML.</p>
            <div style={{ marginTop: '20px' }}>
              <button 
                className="btn btn-primary"
                onClick={() => window.location.href = '/login'}
              >
                Go to Login
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default AuthCheck;