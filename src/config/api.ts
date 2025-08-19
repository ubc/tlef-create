// API URL configuration that handles staging environment correctly
export const getApiUrl = (): string => {
  // Check if we're on the staging domain
  const isStaging = window.location.hostname === 'create.staging.apps.ltic.ubc.ca';
  
  if (isStaging) {
    // For staging, use HTTPS without port number
    return 'https://create.staging.apps.ltic.ubc.ca';
  }
  
  // For local development, use the environment variable
  return import.meta.env.VITE_API_URL || 'http://localhost:8051';
};

export const API_URL = getApiUrl();