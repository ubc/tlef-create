import { expect, test } from '@jest/globals';
import { canvasLtiPlatformConfig } from '../../services/canvasLtiPlatformConfig.js';

test('uses the hosted Canvas issuer and SSO endpoints for the UBC staging tenant', () => {
  expect(canvasLtiPlatformConfig('https://ubcstaging.instructure.com', 'client-id')).toEqual({
    url: 'https://canvas.instructure.com',
    name: 'Canvas LMS',
    clientId: 'client-id',
    authenticationEndpoint: 'https://sso.canvaslms.com/api/lti/authorize_redirect',
    accesstokenEndpoint: 'https://sso.canvaslms.com/login/oauth2/token',
    authConfig: { method: 'JWK_SET', key: 'https://sso.canvaslms.com/api/lti/security/jwks' }
  });
});

test('uses environment-specific hosted Canvas endpoints for test and beta', () => {
  expect(canvasLtiPlatformConfig('https://school.test.instructure.com', 'test').url).toBe('https://canvas.test.instructure.com');
  expect(canvasLtiPlatformConfig('https://school.beta.instructure.com', 'beta').authConfig.key).toBe('https://sso.beta.canvaslms.com/api/lti/security/jwks');
});

test('keeps self-hosted Canvas endpoints on the instance origin', () => {
  const config = canvasLtiPlatformConfig('http://localhost', 'local');
  expect(config.url).toBe('http://localhost');
  expect(config.authenticationEndpoint).toBe('http://localhost/api/lti/authorize_redirect');
  expect(config.authConfig.key).toBe('http://localhost/api/lti/security/jwks');
});
