import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { GraduationCap, Sparkles, Shield, ArrowRight, Loader2 } from 'lucide-react';
import '../styles/components/Login.css';

interface LoginProps {
  onAuthChange?: () => void;
}

const Login = ({ onAuthChange }: LoginProps) => {
  const navigate = useNavigate();
  const [isAutoLoggingIn, setIsAutoLoggingIn] = useState(false);
  const [samlAvailable, setSamlAvailable] = useState<boolean | null>(null);
  const [autoLoginAttempted, setAutoLoginAttempted] = useState(false);

  const handleSamlLogin = () => {
    // Redirect to backend SAML login endpoint
    window.location.href = `${import.meta.env.VITE_API_URL}/api/create/auth/saml/login`;
  };

  const handleAutoLogin = async () => {
    if (autoLoginAttempted || isAutoLoggingIn) {
      return; // Prevent multiple attempts
    }
    
    setAutoLoginAttempted(true);
    setIsAutoLoggingIn(true);
    
    try {
      // First, check if we're already authenticated
      const authCheck = await fetch(`${import.meta.env.VITE_API_URL}/api/create/auth/me`, {
        credentials: 'include'
      });
      
      if (authCheck.ok) {
        const authData = await authCheck.json();
        if (authData.data?.authenticated) {
          // Already authenticated, trigger auth change and navigate
          console.log('🔧 Already authenticated, triggering auth change and navigating to dashboard');
          if (onAuthChange) {
            onAuthChange();
          }
          navigate('/', { replace: true });
          return;
        }
      }

      // Not authenticated, proceed with auto-login
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/create/auth/auto-login`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        // Verify authentication after auto-login
        const verifyAuth = await fetch(`${import.meta.env.VITE_API_URL}/api/create/auth/me`, {
          credentials: 'include'
        });
        
        if (verifyAuth.ok) {
          const verifyData = await verifyAuth.json();
          if (verifyData.data?.authenticated) {
            // Add a small delay to ensure session is fully established
            console.log('🔧 Auto-login successful, triggering auth change and navigating to dashboard');
            // Trigger the App component to re-check authentication
            if (onAuthChange) {
              onAuthChange();
            }
            setTimeout(() => {
              navigate('/', { replace: true });
            }, 100);
            return;
          }
        }
        
        console.error('Auto-login succeeded but verification failed');
        setIsAutoLoggingIn(false);
      } else {
        console.error('Auto-login failed with status:', response.status);
        setIsAutoLoggingIn(false);
      }
    } catch (error) {
      console.error('Auto-login error:', error);
      setIsAutoLoggingIn(false);
    }
  };

  const checkSamlAvailability = async () => {
    if (autoLoginAttempted || samlAvailable !== null) {
      return; // Don't check again if we've already checked or attempted auto-login
    }
    
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/create/auth/config`);
      if (response.ok) {
        const config = await response.json();
        setSamlAvailable(config.data.samlAvailable);
        
        // If SAML is not available, automatically trigger auto-login
        if (!config.data.samlAvailable && !autoLoginAttempted) {
          // Add a delay to prevent immediate execution
          setTimeout(() => {
            handleAutoLogin();
          }, 500);
        }
      } else {
        console.error('Config endpoint returned error:', response.status);
        setSamlAvailable(false);
      }
    } catch (error) {
      console.error('Error checking SAML availability:', error);
      setSamlAvailable(false);
      // Fallback to auto-login if config check fails
      if (!autoLoginAttempted) {
        setTimeout(() => {
          handleAutoLogin();
        }, 1000);
      }
    }
  };

  useEffect(() => {
    console.log('🔧 Login useEffect triggered:', { samlAvailable, autoLoginAttempted, isAutoLoggingIn });
    
    // Check if we're returning from SAML callback with error
    const urlParams = new URLSearchParams(window.location.search);
    const error = urlParams.get('error');
    if (error) {
      console.error('Login error:', error);
    }

    // Only check SAML availability once and if we haven't already started auto-login
    if (samlAvailable === null && !autoLoginAttempted) {
      console.log('🔧 Calling checkSamlAvailability');
      checkSamlAvailability();
    } else {
      console.log('🔧 Skipping checkSamlAvailability:', { samlAvailable, autoLoginAttempted });
    }
  }, []);

  return (
    <div className="login-container">
      {/* Background Pattern */}
      <div className="login-background">
        <div className="bg-pattern"></div>
        <div className="bg-gradient"></div>
      </div>

      {/* Main Content */}
      <div className="login-content">
        {/* Logo and Branding Section */}
        <div className="login-header">
          <div className="logo-container">
            <div className="logo-icon">
              <GraduationCap size={32} />
            </div>
            <div className="logo-text">
              <h1 className="brand-title">TLEF CREATE</h1>
              <div className="brand-badge">
                <Sparkles size={14} />
                <span>AI-Powered</span>
              </div>
            </div>
          </div>
          <p className="brand-subtitle">
            Next-generation quiz generator for modern education
          </p>
        </div>

        {/* Login Card */}
        <Card className="login-card">
          <CardHeader className="login-card-header">
            <CardTitle className="login-title">
              Welcome Back
            </CardTitle>
            <CardDescription className="login-description">
              {samlAvailable === false 
                ? "Continue to the application to start creating intelligent quizzes"
                : "Sign in with your institutional credentials to continue creating intelligent quizzes"
              }
            </CardDescription>
          </CardHeader>
          
          <CardContent className="login-card-content">
            {/* Features Preview */}
            <div className="features-preview">
              <div className="feature-item">
                <div className="feature-icon">
                  <Sparkles size={16} />
                </div>
                <span>AI-Generated Questions</span>
              </div>
              <div className="feature-item">
                <div className="feature-icon">
                  <GraduationCap size={16} />
                </div>
                <span>Pedagogical Approaches</span>
              </div>
              <div className="feature-item">
                <div className="feature-icon">
                  <Shield size={16} />
                </div>
                <span>Secure & Private</span>
              </div>
            </div>

            {/* Login Button */}
            {samlAvailable === null ? (
              // Loading state while checking SAML availability
              <Button 
                className="login-button"
                size="lg"
                disabled
              >
                <Loader2 size={18} className="animate-spin" />
                <span>Checking authentication...</span>
              </Button>
            ) : isAutoLoggingIn ? (
              // Auto-login in progress
              <Button 
                className="login-button"
                size="lg"
                disabled
              >
                <Loader2 size={18} className="animate-spin" />
                <span>Signing you in...</span>
              </Button>
            ) : samlAvailable ? (
              // SAML login button
              <Button 
                onClick={handleSamlLogin}
                className="login-button"
                size="lg"
              >
                <span>Sign in with UBC CWL</span>
                <ArrowRight size={18} />
              </Button>
            ) : (
              // Auto-login button for staging
              <Button 
                onClick={handleAutoLogin}
                className="login-button"
                size="lg"
              >
                <span>Enter Application</span>
                <ArrowRight size={18} />
              </Button>
            )}

            {/* Terms */}
            <div className="login-terms">
              <p>
                By signing in, you agree to our{' '}
                <a href="#" className="terms-link">Terms of Service</a>{' '}
                and{' '}
                <a href="#" className="terms-link">Privacy Policy</a>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="login-footer">
          <p>University of British Columbia • Teaching and Learning Enhancement Fund</p>
        </div>
      </div>
    </div>
  );
};

export default Login;