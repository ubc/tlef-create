import passport from 'passport';
import { Strategy as SamlStrategy } from 'passport-saml';
import User from '../models/User.js';
import { createSamlVerify } from '../services/samlUserService.js';
import { SAML_REQUESTED_ATTRIBUTES } from '../utils/samlIdentity.js';
import dotenv from 'dotenv';
import fs from 'fs';

// Load environment variables
dotenv.config();

// Try to import passport-ubcshib (may not be available in all environments)
let UBCShibStrategy;
try {
  const ubcshib = await import('passport-ubcshib');
  if (ubcshib.Strategy) {
    UBCShibStrategy = ubcshib.Strategy;
  } else if (ubcshib.default && ubcshib.default.Strategy) {
    UBCShibStrategy = ubcshib.default.Strategy;
  } else if (typeof ubcshib.default === 'function') {
    UBCShibStrategy = ubcshib.default;
  }
  console.log('✅ passport-ubcshib module loaded successfully');
} catch (error) {
  console.warn('⚠️ passport-ubcshib not available, UBC Shibboleth authentication will be disabled');
  console.warn(`   Error: ${error.message}`);
  UBCShibStrategy = null;
}

// Generic SAML Strategy - Only used in development (local docker-simple-saml)
let samlStrategy = null;

if (process.env.NODE_ENV === 'development') {
  console.log('🔧 Configuring generic SAML strategy for development...');

  // Load certificate from file or use environment variable
  let samlCert;
  const samlCertPath = process.env.SAML_CERT_PATH;
  if (samlCertPath) {
    try {
      samlCert = fs.readFileSync(samlCertPath, 'utf8');
      console.log(`✅ SAML certificate loaded from: ${samlCertPath}`);
    } catch (error) {
      console.error(`❌ Failed to read SAML certificate from ${samlCertPath}:`, error.message);
      samlCert = null;
    }
  }

  // If no certificate from file, use hardcoded docker-simple-saml certificate as fallback
  if (!samlCert) {
    console.warn('⚠️ Using hardcoded SAML certificate (may be outdated)');
  }

  samlStrategy = new SamlStrategy({
    callbackUrl: process.env.SAML_CALLBACK_URL || 'http://localhost:7736/api/create/auth/saml/callback',
    entryPoint: process.env.SAML_ENTRY_POINT || 'http://localhost:8080/simplesaml/saml2/idp/SSOService.php',
    logoutUrl: process.env.SAML_LOGOUT_URL || 'http://localhost:8080/simplesaml/saml2/idp/SingleLogoutService.php',
    logoutCallbackUrl: process.env.SAML_LOGOUT_CALLBACK_URL || 'http://localhost:7736/api/create/auth/logout/callback',
    issuer: process.env.SAML_ISSUER || 'tlef-create',
    cert: samlCert,
    identifierFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient',
    disableRequestedAuthnContext: true,
    acceptedClockSkewMs: 5000,
    validateInResponseTo: false,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: true,
    signatureAlgorithm: 'sha256'
  }, createSamlVerify({ preferPuid: false }));

  passport.use('saml', samlStrategy);
  console.log('✅ Generic SAML strategy registered for development');
} else {
  console.log('ℹ️ Skipping generic SAML strategy (only used in development)');
}

// UBC Shibboleth Strategy - UBC-specific SAML Authentication
// Uses passport-ubcshib for UBC's Shibboleth IdP integration
// Only used in production/staging (not development)
if (UBCShibStrategy && process.env.NODE_ENV !== 'development') {
  console.log('🔧 Configuring UBC Shibboleth strategy for production/staging...');

  const ubcShibIssuer = process.env.SAML_ISSUER;
  const ubcShibCallbackUrl = process.env.SAML_CALLBACK_URL;
  const ubcShibCertPath = process.env.SAML_CERT_PATH;
  const ubcShibPrivateKeyPath = process.env.SAML_PRIVATE_KEY_PATH;
  const ubcShibEnvironment = process.env.SAML_ENVIRONMENT || 'STAGING';

  // Read SAML certificate if path is provided
  let ubcShibCert = null;
  if (ubcShibCertPath) {
    try {
      ubcShibCert = fs.readFileSync(ubcShibCertPath, 'utf8');
      console.log('✅ UBC Shibboleth certificate loaded from file');
    } catch (error) {
      console.error(`❌ Failed to read SAML certificate from ${ubcShibCertPath}:`, error.message);
    }
  }

  console.log('🔍 Checking UBC Shibboleth configuration...');
  console.log(`   SAML_ISSUER: ${ubcShibIssuer ? '✓ Set' : '✗ Missing'}`);
  console.log(`   SAML_CALLBACK_URL: ${ubcShibCallbackUrl ? '✓ Set' : '✗ Missing'}`);
  console.log(`   SAML_CERT_PATH: ${ubcShibCertPath ? '✓ Set' : '✗ Missing'}`);
  console.log(`   SAML_CERT: ${ubcShibCert ? '✓ Loaded' : '✗ Not loaded'}`);
  console.log(`   SAML_PRIVATE_KEY_PATH: ${ubcShibPrivateKeyPath ? '✓ Set' : '✗ Missing'}`);
  console.log(`   SAML_ENVIRONMENT: ${ubcShibEnvironment}`);

  if (ubcShibIssuer && ubcShibCallbackUrl && ubcShibCert) {
    try {
      const ubcShibStrategy = new UBCShibStrategy(
        {
          issuer: ubcShibIssuer,
          callbackUrl: ubcShibCallbackUrl,
          cert: ubcShibCert,
          privateKeyPath: ubcShibPrivateKeyPath,
          attributeConfig: SAML_REQUESTED_ATTRIBUTES,
          enableSLO: process.env.ENABLE_SLO !== 'false',
          validateInResponseTo: process.env.SAML_VALIDATE_IN_RESPONSE_TO !== 'false',
          acceptedClockSkewMs: parseInt(process.env.SAML_CLOCK_SKEW_MS) || 5000
        },
        createSamlVerify()
      );

      passport.use('ubcshib', ubcShibStrategy);
      console.log(`✅ UBC Shibboleth strategy configured (${ubcShibEnvironment})`);
    } catch (error) {
      console.error('❌ Failed to configure UBC Shibboleth strategy:', error.message);
      console.error('   Error details:', error);
    }
  } else {
    console.error('❌ UBC Shibboleth strategy not configured (missing required environment variables)');
    console.error('   Required: SAML_ISSUER, SAML_CALLBACK_URL, and SAML_CERT_PATH');
  }
} else if (process.env.NODE_ENV !== 'development') {
  console.log('ℹ️ UBC Shibboleth strategy not available (passport-ubcshib module not loaded)');
}

// Serialize user to session
passport.serializeUser((user, done) => {
  done(null, user._id);
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id).select('-password');
    if (!user) {
      console.warn('⚠️ User not found in database, clearing session:', id);
      return done(null, false);
    }
    done(null, user);
  } catch (error) {
    // Database error - log it but don't crash the request
    console.error('❌ Error deserializing user:', error.message);
    // Return false instead of error to allow logout to proceed
    done(null, false);
  }
});

export { passport, samlStrategy };