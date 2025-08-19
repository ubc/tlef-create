// API URL configuration that handles staging environment correctly
export const getApiUrl = (): string => {
  const hostname = window.location.hostname;
  const protocol = window.location.protocol;
  
  // Check if we're on any production/staging domain (not localhost)
  const isProduction = hostname !== 'localhost' && hostname !== '127.0.0.1';
  
  if (isProduction) {
    // For production/staging, use the same domain without any port
    // This works because nginx routes /api/* to the backend
    return `${protocol}//${hostname}`;
  }
  
  // For local development, use the environment variable
  // Strip any port from VITE_API_URL if it exists (for consistency)
  const devUrl = import.meta.env.VITE_API_URL || 'http://localhost:8051';
  
  // If the env var has a port that shouldn't be there in production, strip it
  if (import.meta.env.NODE_ENV === 'production' && devUrl.includes(':') && !devUrl.includes('localhost')) {
    return devUrl.replace(/:\d+$/, '');
  }
  
  return devUrl;
};

export const API_URL = getApiUrl();