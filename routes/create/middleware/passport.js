import passport from 'passport';
import { Strategy as UBCStrategy } from 'passport-ubcshib';
import User from '../models/User.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ES6 __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

/**
 * Load certificate from file path or return placeholder for local development
 * passport-ubcshib requires a cert, so we provide one even if validation is disabled
 */
function loadCertificate() {
  const certPath = process.env.SAML_CERT_PATH;
  const environment = process.env.SAML_ENVIRONMENT || 'LOCAL';

  // For LOCAL development without a cert file, return the docker-simple-saml cert
  if (!certPath && environment === 'LOCAL') {
    console.log('ℹ️  LOCAL development mode: Using docker-simple-saml certificate (signature validation will be disabled via docker-simple-saml config)');
    // This is the actual cert from docker-simple-saml's metadata
    return `-----BEGIN CERTIFICATE-----
MIIDmzCCAoOgAwIBAgIUIaH9WD4OV9VlvwpRUBPslxAn3hAwDQYJKoZIhvcNAQEL
BQAwXTELMAkGA1UEBhMCQ0ExCzAJBgNVBAgMAkJDMRIwEAYDVQQHDAlWYW5jb3V2
ZXIxDDAKBgNVBAoMA1VCQzELMAkGA1UECwwCSVQxEjAQBgNVBAMMCWxvY2FsaG9z
dDAeFw0yNTEyMDIxNjQ5NTJaFw0zNTExMzAxNjQ5NTJaMF0xCzAJBgNVBAYTAkNB
MQswCQYDVQQIDAJCQzESMBAGA1UEBwwJVmFuY291dmVyMQwwCgYDVQQKDANVQkMx
CzAJBgNVBAsMAklUMRIwEAYDVQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEB
AQUAA4IBDwAwggEKAoIBAQCfQgX863ew1uW9XygRot4SFR+9/1xo3Lty6ey1pTL1
rOkCCqvRD0E110BfqmGZiKrz1Y/mPBCPqXBvM0HDBLbrKz3L+3jUMQnWOCmqY8BR
hWwnGu9mRRKm0zAR8fCsTS0Uwm+xJui9ORtKSvgbLIJWAUEKHwoOMurXgKDFmlW8
GCfqjrFR9TqesubA7s8T4XbMnGcWyBhEg7JpgWHNJZUXkDbcA7l4YrH8VyiALOKw
VHi4QFuF11cEAlN2yeawN0ba+CSX3PFSzEwbHoTFG+7/lakbYJrZ1K1Lh/HrH/PY
W7xxrrpLmU8gR8R8cfLZzoANDtzOIhg3acLScdgEcQS3AgMBAAGjUzBRMB0GA1Ud
DgQWBBSq9YPPnaQT6cxiawwInwZLNjacQjAfBgNVHSMEGDAWgBSq9YPPnaQT6cxi
awwInwZLNjacQjAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQAI
1BOGhY65nVGX4B5hK2oava7rWLpLdIpyKOaHvVfyJs3QPy8wd6gXhmv6qGz6odaR
qaUjaJtT5Xak6go86pwp94TM8s9aOVycWkqgwbP1+obXMdY/7c+Xj7qH3EqIpvZz
LhaLmuio8su5vnhH2OQ53srsKb54lrPgjui6EuDBkpg7dFA4v2J2zDjgaVX7mJlV
K+EtJIPlUwtpaa6uXGnl5l8+7yPLRVSuSDi3ght3d3IPW3D5xYFtQlfwQRKqQkAQ
SbyhJmvvG+kilxHD34Kw0gbZ3HBPheNQuUjjvNZymGXY5q8FnAySCERHoMQL/0WU
xrJQPNE4szWO9XJft+eZ
-----END CERTIFICATE-----`;
  }

  // For staging/production, certificate file path is required
  if (!certPath) {
    throw new Error('SAML_CERT_PATH is required for non-LOCAL environments');
  }

  try {
    const absolutePath = path.isAbsolute(certPath)
      ? certPath
      : path.join(process.cwd(), certPath);

    const cert = fs.readFileSync(absolutePath, 'utf-8');
    console.log('✅ Loaded SAML certificate from:', absolutePath);
    return cert;
  } catch (error) {
    console.error('❌ Failed to load certificate from:', certPath, error.message);
    throw new Error(`Failed to load SAML certificate from ${certPath}: ${error.message}`);
  }
}

// SAML Strategy configuration using passport-ubcshib
// Using minimal configuration matching the working example
const samlStrategy = new UBCStrategy({
  // Service Provider Identity
  issuer: process.env.SAML_ISSUER || 'https://tlef-create',

  // Callback URL
  callbackUrl: process.env.SAML_CALLBACK_URL || 'http://localhost:8051/api/create/auth/saml/callback',

  // IdP endpoints
  entryPoint: process.env.SAML_ENTRY_POINT,
  logoutUrl: process.env.SAML_LOGOUT_URL,
  metadataUrl: process.env.SAML_METADATA_URL,

  // IdP certificate for validating SAML responses
  cert: loadCertificate()
}, async (profile, done) => {
  try {
    console.log('✅ UBC Shibboleth Profile received:', JSON.stringify(profile, null, 2));

    // Extract user information from SAML profile
    // passport-ubcshib provides attributes in profile.attributes
    const cwlId = profile.attributes?.ubcEduCwlPuid || profile.nameID;

    if (!cwlId) {
      return done(new Error('No CWL ID (ubcEduCwlPuid) found in SAML profile'));
    }

    console.log('🔍 Looking up user with CWL ID:', cwlId);

    // Find or create user
    let user = await User.findOne({ cwlId });

    if (!user) {
      // Create new user
      console.log('👤 Creating new user for CWL ID:', cwlId);
      user = new User({
        cwlId,
        password: 'saml-authenticated', // Placeholder - not used for SAML auth
        stats: {
          coursesCreated: 0,
          quizzesGenerated: 0,
          questionsCreated: 0,
          totalUsageTime: 0,
          lastActivity: new Date()
        }
      });
      await user.save();
    } else {
      // Update last login
      console.log('♻️ Updating existing user:', cwlId);
      user.lastLogin = new Date();
      user.stats.lastActivity = new Date();
      await user.save();
    }

    console.log('✅ User authenticated successfully:', cwlId);

    return done(null, {
      _id: user._id,
      cwlId: user.cwlId,
      stats: user.stats,
      samlAttributes: profile.attributes // Store original SAML attributes for reference
    });
  } catch (error) {
    console.error('❌ SAML authentication error:', error);
    return done(error);
  }
});

// Register strategy with passport
// passport-ubcshib uses 'ubcshib' as the strategy name, but we can also register it as 'saml' for compatibility
passport.use('saml', samlStrategy);
passport.use('ubcshib', samlStrategy);

// Serialize user to session
passport.serializeUser((user, done) => {
  done(null, user._id);
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id).select('-password');
    done(null, user);
  } catch (error) {
    done(error);
  }
});

export { passport, samlStrategy };