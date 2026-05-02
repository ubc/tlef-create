import { Provider } from 'react-redux';
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { store } from './store';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import CourseView from './components/CourseView';
import QuizView from './components/QuizView';
import UserAccount from './components/UserAccount';
import Login from './components/Login';
import NotFound from "./pages/NotFound";
import H5PPreview from "./pages/H5PPreview";
import AdminDashboard from "./pages/AdminDashboard";
import FirstUseApiKeyModal from './components/FirstUseApiKeyModal';
import { useState, useEffect } from 'react';
import { API_URL } from './config/api';
import { apiKeyApi } from './services/api';

const App = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [user, setUser] = useState<any>(null);
  const [showFirstUseModal, setShowFirstUseModal] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const response = await fetch(`${API_URL}/api/create/auth/me`, {
        credentials: 'include'
      });
      if (response.ok) {
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          console.error('Auth check returned non-JSON response (likely HTML error page)');
          setIsAuthenticated(false);
          return;
        }
        const data = await response.json();
        if (data.data?.authenticated) {
          setIsAuthenticated(true);
          setUser(data.data.user);
          checkFirstUse(data.data.user);
        } else {
          setIsAuthenticated(false);
        }
      } else {
        setIsAuthenticated(false);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      setIsAuthenticated(false);
    }
  };

  // Show first-use modal if user has no API key and no env key permission
  const checkFirstUse = async (userData: any) => {
    if (userData?.canUseEnvKey || userData?.isAdmin) return;
    try {
      const res = await apiKeyApi.getKeys();
      const keys = res.data?.apiKeys || [];
      if (keys.length === 0) {
        setShowFirstUseModal(true);
      }
    } catch {
      // Silently fail — don't block the user if this check errors
    }
  };

  if (isAuthenticated === null) {
    return <div>Loading...</div>;
  }

  return (
    <Provider store={store}>
      <BrowserRouter>
        {isAuthenticated && showFirstUseModal && (
          <FirstUseApiKeyModal onDismiss={() => setShowFirstUseModal(false)} />
        )}
        <Routes>
          {/* Public route */}
          <Route path="/login" element={isAuthenticated ? <Navigate to="/" /> : <Login onAuthChange={checkAuth} />} />

          {/* Protected routes */}
          <Route path="/" element={isAuthenticated ? <Layout><Dashboard /></Layout> : <Navigate to="/login" />} />
          <Route path="/course/:courseId" element={isAuthenticated ? <Layout><CourseView /></Layout> : <Navigate to="/login" />} />
          <Route path="/course/:courseId/quiz/:quizId" element={isAuthenticated ? <Layout><QuizView /></Layout> : <Navigate to="/login" />} />
          <Route path="/account" element={isAuthenticated ? <Layout><UserAccount /></Layout> : <Navigate to="/login" />} />
          <Route path="/admin" element={isAuthenticated ? <Layout><AdminDashboard /></Layout> : <Navigate to="/login" />} />

          {/* H5P Preview — no auth required (dev tool) */}
          <Route path="/h5p-preview" element={<H5PPreview />} />

          {/* Canvas OAuth callback — closes popup window */}
          <Route path="/canvas-callback" element={<CanvasCallback />} />

          {/* SAML callback route */}
          <Route path="/auth/callback" element={<AuthCallback onAuthChange={checkAuth} />} />

          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </Provider>
  );
};

// Canvas OAuth callback — just closes the popup, parent window polls for it
const CanvasCallback = () => {
  useEffect(() => {
    const timer = setTimeout(() => window.close(), 500);
    return () => clearTimeout(timer);
  }, []);

  const params = new URLSearchParams(window.location.search);
  const success = params.get('success');
  const error = params.get('error');

  return (
    <div style={{ padding: '40px', textAlign: 'center' }}>
      {success ? <p>Canvas connected successfully! This window will close...</p>
               : <p>Canvas connection failed: {error || 'Unknown error'}. You can close this window.</p>}
    </div>
  );
};

// Auth callback component to handle SAML return
const AuthCallback = ({ onAuthChange }: { onAuthChange: () => void }) => {
  useEffect(() => {
    onAuthChange();
    window.location.href = '/';
  }, [onAuthChange]);

  return <div>Authenticating...</div>;
};

export default App;
