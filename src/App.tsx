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
import { useState, useEffect } from 'react';
import { API_URL } from './config/api';

const App = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [user, setUser] = useState(null);

  useEffect(() => {
    console.log('🔧 App useEffect triggered - checking auth');
    // Check authentication status on mount
    checkAuth();
  }, []);

  const checkAuth = async () => {
    console.log('🔧 checkAuth called');
    try {
      const response = await fetch(`${API_URL}/api/create/auth/me`, {
        credentials: 'include'
      });
      console.log('🔧 Auth response status:', response.status);
      if (response.ok) {
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          console.error('Auth check returned non-JSON response (likely HTML error page)');
          setIsAuthenticated(false);
          return;
        }
        const data = await response.json();
        console.log('🔧 Auth response data:', data);
        if (data.data?.authenticated) {
          console.log('🔧 User authenticated, setting state');
          setIsAuthenticated(true);
          setUser(data.data.user);
        } else {
          console.log('🔧 User not authenticated, setting false');
          setIsAuthenticated(false);
        }
      } else {
        // Don't log rate limiting errors as they're expected during loops
        if (response.status !== 429) {
          console.error('Auth check failed with status:', response.status);
        }
        console.log('🔧 Auth failed, setting false');
        setIsAuthenticated(false);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      console.log('🔧 Auth error, setting false');
      setIsAuthenticated(false);
    }
  };

  // Loading state while checking authentication
  if (isAuthenticated === null) {
    console.log('🔧 App rendering: Loading state');
    return <div>Loading...</div>;
  }

  console.log('🔧 App rendering with isAuthenticated:', isAuthenticated);

  return (
    <Provider store={store}>
      <BrowserRouter>
        <Routes>
          {/* Public route */}
          <Route path="/login" element={isAuthenticated ? <Navigate to="/" /> : <Login onAuthChange={checkAuth} />} />
          
          {/* Protected routes */}
          <Route path="/" element={isAuthenticated ? <Layout><Dashboard /></Layout> : <Navigate to="/login" />} />
          <Route path="/course/:courseId" element={isAuthenticated ? <Layout><CourseView /></Layout> : <Navigate to="/login" />} />
          <Route path="/course/:courseId/quiz/:quizId" element={isAuthenticated ? <Layout><QuizView /></Layout> : <Navigate to="/login" />} />
          <Route path="/account" element={isAuthenticated ? <Layout><UserAccount /></Layout> : <Navigate to="/login" />} />
          
          {/* SAML callback route */}
          <Route path="/auth/callback" element={<AuthCallback onAuthChange={checkAuth} />} />
          
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </Provider>
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
