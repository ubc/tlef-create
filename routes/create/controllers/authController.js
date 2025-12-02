import express from 'express';
import { successResponse, errorResponse } from '../utils/responseFormatter.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS } from '../config/constants.js';
import { passport, samlStrategy } from '../middleware/passport.js';
import { authenticateToken } from '../middleware/auth.js';
import User from '../models/User.js';

const router = express.Router();

/**
 * GET /api/auth/config
 * Get authentication configuration (SAML availability)
 */
router.get('/config', asyncHandler(async (req, res) => {
  const samlAvailable = process.env.SAML_AVAILABLE === 'true';
  
  return successResponse(res, {
    samlAvailable
  }, 'Authentication configuration retrieved');
}));

/**
 * POST /api/auth/auto-login
 * Auto-login for staging environment (when SAML_AVAILABLE=false)
 */
router.post('/auto-login', asyncHandler(async (req, res) => {
  const samlAvailable = process.env.SAML_AVAILABLE === 'true';
  
  if (samlAvailable) {
    return errorResponse(res, 'Auto-login not available when SAML is enabled', HTTP_STATUS.BAD_REQUEST);
  }

  // Import User model dynamically to avoid circular dependency
  const { default: User } = await import('../models/User.js');
  
  // Create or get a default staging user
  let user = await User.findOne({ cwlId: 'staging-user' });
  
  if (!user) {
    // Create a default staging user
    const bcrypt = await import('bcryptjs');
    const hashedPassword = await bcrypt.default.hash('staging-password', 12);
    
    user = new User({
      cwlId: 'staging-user',
      password: hashedPassword,
      stats: {
        coursesCreated: 0,
        quizzesGenerated: 0,
        questionsCreated: 0,
        totalUsageTime: 0,
        lastActivity: new Date()
      },
      lastLogin: new Date()
    });
    
    await user.save();
    console.log('✅ Created default staging user');
  } else {
    // Update last login
    user.lastLogin = new Date();
    user.stats.lastActivity = new Date();
    await user.save();
  }

  // Create session using Passport's login method
  req.login(user, (err) => {
    if (err) {
      console.error('❌ Auto-login session creation failed:', err);
      return errorResponse(res, 'Failed to create session', HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }
    
    console.log('✅ Auto-login successful for staging user');
    return successResponse(res, {
      authenticated: true,
      user: {
        id: user._id,
        cwlId: user.cwlId,
        stats: user.stats,
        lastLogin: user.lastLogin
      }
    }, 'Auto-login successful');
  });
}));

/**
 * GET /api/auth/me  
 * Get current user profile (SAML or auto-login authentication)
 */
router.get('/me', asyncHandler(async (req, res) => {
  console.log('🔍 /me endpoint - checking authentication');
  console.log('🔍 isAuthenticated:', req.isAuthenticated ? req.isAuthenticated() : false);
  console.log('🔍 user exists:', !!req.user);
  
  // Check for Passport session authentication (both SAML and auto-login)
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    const { default: User } = await import('../models/User.js');
    const user = await User.findById(req.user._id || req.user.id).select('-password');
    if (user) {
      console.log('✅ /me - User authenticated:', user.cwlId);
      return successResponse(res, {
        authenticated: true,
        user: {
          id: user._id,
          cwlId: user.cwlId,
          stats: user.stats,
          lastLogin: user.lastLogin
        }
      }, 'User profile retrieved');
    }
  }

  // No valid authentication
  console.log('❌ /me - User not authenticated');
  return successResponse(res, {
    authenticated: false
  }, 'User not authenticated');
}));

/**
 * GET /api/auth/saml/login
 * Initiate SAML login
 */
router.get('/saml/login', passport.authenticate('ubcshib'));

/**
 * POST /api/auth/saml/callback
 * Handle SAML callback
 */
router.post('/saml/callback',
  passport.authenticate('ubcshib', { failureRedirect: '/' }),
  (req, res) => {
    console.log('✅ SAML callback successful - user:', req.user?.cwlId);
    // Successful authentication, redirect to frontend
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:8092'}/`);
  }
);

/**
 * GET /api/auth/logout
 * Logout - handles both SAML and auto-login sessions
 */
router.get('/logout', (req, res, next) => {
  console.log('🚪 GET /logout - logout requested');
  console.log('🔍 User authenticated?', req.isAuthenticated ? req.isAuthenticated() : false);
  
  // Check if user is authenticated
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    console.log('❌ User not authenticated, redirecting to login');
    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:8081'}/login`);
  }

  const samlAvailable = process.env.SAML_AVAILABLE === 'true';
  
  if (samlAvailable) {
    // SAML logout - redirect to IdP for single logout
    console.log('🔄 Initiating SAML logout...');
    samlStrategy.logout(req, (err, requestUrl) => {
      if (err) {
        console.error('❌ SAML logout error:', err);
        return res.status(500).json({ 
          error: { 
            code: 'LOGOUT_ERROR', 
            message: 'Logout failed', 
            timestamp: new Date().toISOString() 
          } 
        });
      }

      console.log('🔑 SAML logout URL:', requestUrl);
      
      // Clear local session
      req.logout((logoutErr) => {
        if (logoutErr) {
          console.error('❌ Passport logout error:', logoutErr);
        } else {
          console.log('✅ Passport logout successful');
        }
        
        // Destroy session
        req.session.destroy((sessionErr) => {
          if (sessionErr) {
            console.error('❌ Session destruction error:', sessionErr);
          } else {
            console.log('✅ Session destroyed');
          }
          
          console.log('✅ Session cleared');
          
          // Redirect to SAML IdP logout URL to clear IdP session
          console.log('🔄 Redirecting to IdP logout:', requestUrl);
          res.redirect(requestUrl);
        });
      });
    });
  } else {
    // Simple logout for auto-login sessions
    console.log('🔄 Simple logout for auto-login session...');
    req.logout((logoutErr) => {
      if (logoutErr) {
        console.error('❌ Passport logout error:', logoutErr);
      } else {
        console.log('✅ Passport logout successful');
      }
      
      // Destroy session
      req.session.destroy((sessionErr) => {
        if (sessionErr) {
          console.error('❌ Session destruction error:', sessionErr);
        } else {
          console.log('✅ Session destroyed');
        }
        
        console.log('✅ Auto-login session cleared, redirecting to login');
        res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:8081'}/login`);
      });
    });
  }
});

/**
 * GET /api/auth/logout/callback
 * Handle SAML logout response from IdP
 */
router.get('/logout/callback', (req, res) => {
  console.log('✅ SAML logout callback received');
  // The SAML IdP has processed the logout
  
  if (req.session) {
    req.session.destroy(() => {
      console.log('🔄 Redirecting to login after logout');
      res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:8081'}/login`);
    });
  } else {
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:8081'}/login`);
  }
});


export default router;