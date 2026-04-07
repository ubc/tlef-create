import passport from 'passport';
import { Strategy as SamlStrategy } from 'passport-saml';
import User from '../models/User.js';
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
  }, async (profile, done) => {
    try {
      console.log('SAML Profile received:', JSON.stringify(profile, null, 2));

      // Extract user information from SAML profile
      const cwlId = profile.uid || profile.nameID;

      if (!cwlId) {
        return done(new Error('No CWL ID found in SAML profile'));
      }

      // Find or create user
      let user = await User.findOne({ cwlId });

      if (!user) {
        // Create new user
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
        user.lastLogin = new Date();
        user.stats.lastActivity = new Date();
        await user.save();
      }

      return done(null, {
        _id: user._id,
        cwlId: user.cwlId,
        stats: user.stats
      });
    } catch (error) {
      console.error('SAML authentication error:', error);
      return done(error);
    }
  });

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
          attributeConfig: ['ubcEduCwlPuid', 'mail', 'eduPersonAffiliation'],
          enableSLO: process.env.ENABLE_SLO !== 'false',
          validateInResponseTo: process.env.SAML_VALIDATE_IN_RESPONSE_TO !== 'false',
          acceptedClockSkewMs: parseInt(process.env.SAML_CLOCK_SKEW_MS) || 5000
        },
        async (profile, done) => {
          try {
            console.log('🔍 UBC Shibboleth profile received:', JSON.stringify(profile, null, 2));

            // Extract cwlId from SAML profile
            // Log all available attributes for debugging
            console.log('🔍 Profile keys:', Object.keys(profile));
            console.log('🔍 Profile attributes:', JSON.stringify(profile.attributes || {}, null, 2));
            console.log('🔍 profile.uid:', profile.uid);
            console.log('🔍 profile.nameID:', profile.nameID?.substring?.(0, 20) || profile.nameID);

            // Use PUID as stable unique identifier (UBC Shibboleth doesn't return CWL username)
            const cwlId = profile.attributes?.ubcEduCwlPuid ||
                         profile['urn:mace:dir:attribute-def:ubcEduCwlPuid'] ||
                         profile.uid ||
                         profile.attributes?.uid ||
                         profile.nameID;

            // Extract display name from email (e.g., "haocheng.fan@ubc.ca" → "haocheng.fan")
            const email = profile.attributes?.mail || profile.mail || profile.email || null;
            const displayName = email ? email.split('@')[0] : null;

            if (!cwlId) {
              console.error('❌ No CWL ID found in UBC Shibboleth profile');
              console.error('Available profile keys:', Object.keys(profile));
              console.error('Available attributes:', Object.keys(profile.attributes || {}));
              return done(new Error('No CWL ID found in UBC Shibboleth profile'));
            }

            console.log(`✅ Extracted CWL ID: ${cwlId}`);

            // Find or create user
            let user = await User.findOne({ cwlId });

            if (!user) {
              user = new User({
                cwlId,
                displayName,
                email,
                password: 'saml-authenticated',
                stats: { coursesCreated: 0, quizzesGenerated: 0, questionsCreated: 0, totalUsageTime: 0, lastActivity: new Date() }
              });
              await user.save();
              console.log(`✅ Created new user: ${cwlId} (${displayName || 'no display name'})`);
            } else {
              user.lastLogin = new Date();
              user.stats.lastActivity = new Date();
              if (displayName && !user.displayName) user.displayName = displayName;
              if (email && !user.email) user.email = email;
              await user.save();
              console.log(`✅ Updated existing user: ${cwlId} (${user.displayName || 'no display name'})`);
            }

            // Store SAML debug info in session for troubleshooting
            const samlDebug = {
              profileKeys: Object.keys(profile),
              attributeKeys: Object.keys(profile.attributes || {}),
              uid: profile.uid || null,
              nameID: typeof profile.nameID === 'string' ? profile.nameID.substring(0, 30) : null,
              email: profile.attributes?.mail || profile.mail || profile.email || null,
              allAttributes: profile.attributes || {}
            };
            console.log('🔍 SAML Debug:', JSON.stringify(samlDebug, null, 2));

            return done(null, {
              samlDebug,
              _id: user._id,
              cwlId: user.cwlId,
              stats: user.stats
            });
          } catch (error) {
            console.error('❌ UBC Shibboleth authentication error:', error);
            return done(error);
          }
        }
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
  // Store both _id and samlDebug in session
  done(null, { _id: user._id, samlDebug: user.samlDebug || null });
});

// Deserialize user from session
passport.deserializeUser(async (sessionData, done) => {
  try {
    // Handle both old format (just ID) and new format ({ _id, samlDebug })
    const id = sessionData?._id || sessionData;
    const samlDebug = sessionData?.samlDebug || null;
    const user = await User.findById(id).select('-password');
    if (!user) {
      console.warn('⚠️ User not found in database, clearing session:', id);
      return done(null, false);
    }
    // Attach samlDebug to the user object (not saved to DB)
    user.samlDebug = samlDebug;
    done(null, user);
  } catch (error) {
    // Database error - log it but don't crash the request
    console.error('❌ Error deserializing user:', error.message);
    // Return false instead of error to allow logout to proceed
    done(null, false);
  }
});

export { passport, samlStrategy };