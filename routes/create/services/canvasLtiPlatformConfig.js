export function canvasLtiPlatformConfig(canvasUrl, clientId) {
  const hostname = new URL(canvasUrl).hostname.toLowerCase();
  let issuer = canvasUrl;
  let endpoints = canvasUrl;

  if (hostname === 'canvas.test.instructure.com' || hostname.endsWith('.test.instructure.com')) {
    issuer = 'https://canvas.test.instructure.com';
    endpoints = 'https://sso.test.canvaslms.com';
  } else if (hostname === 'canvas.beta.instructure.com' || hostname.endsWith('.beta.instructure.com')) {
    issuer = 'https://canvas.beta.instructure.com';
    endpoints = 'https://sso.beta.canvaslms.com';
  } else if (hostname === 'instructure.com' || hostname.endsWith('.instructure.com')) {
    issuer = 'https://canvas.instructure.com';
    endpoints = 'https://sso.canvaslms.com';
  }

  return {
    url: issuer,
    name: 'Canvas LMS',
    clientId,
    authenticationEndpoint: `${endpoints}/api/lti/authorize_redirect`,
    accesstokenEndpoint: `${endpoints}/login/oauth2/token`,
    authConfig: {
      method: 'JWK_SET',
      key: `${endpoints}/api/lti/security/jwks`
    }
  };
}
