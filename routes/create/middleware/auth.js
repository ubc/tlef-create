import { HTTP_STATUS, ERROR_CODES } from '../config/constants.js';

/**
 * Middleware to authenticate users via SAML/Passport sessions only
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
export const authenticateToken = async (req, res, next) => {
  try {
    console.log('🔍 Auth check - isAuthenticated:', req.isAuthenticated ? req.isAuthenticated() : false);
    console.log('🔍 Auth check - user exists:', !!req.user);
    
    // Check for Passport/SAML session authentication
    if (req.isAuthenticated && req.isAuthenticated() && req.user) {
      // SAML authentication via Passport - user is already set by Passport
      const userId = req.user._id || req.user.id;
      const cwlId = req.user.cwlId;
      const originalUser = req.user; // Save original before overwriting
      
      console.log('✅ SAML auth successful - User ID:', userId, 'CWL:', cwlId);
      
      // Standardize user object format
      req.user = {
        id: userId.toString(),
        cwlId: cwlId,
        fullUser: originalUser // Keep the full Passport user object
      };
      
      return next();
    }

    // No valid authentication found
    console.log('❌ No valid authentication found');
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      error: {
        code: ERROR_CODES.AUTH_ERROR,
        message: 'Authentication required - please log in',
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('❌ Authentication middleware error:', error);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      error: {
        code: ERROR_CODES.AUTH_ERROR,
        message: 'Authentication failed',
        timestamp: new Date().toISOString()
      }
    });
  }
};

/**
 * Middleware to get full user object and attach to request (SAML only)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
export const attachUser = async (req, res, next) => {
  try {
    if (req.user && req.user.fullUser) {
      // Update last activity for SAML users
      if (req.user.fullUser.updateLastActivity) {
        console.log('📊 Updating last activity for user:', req.user.cwlId);
        await req.user.fullUser.updateLastActivity();
      }
    }
    next();
  } catch (error) {
    console.error('❌ Attach user middleware error:', error);
    // Don't fail the request if we can't attach user, just log and continue
    next();
  }
};

/**
 * Middleware to check if user owns a resource
 * @param {string} resourceField - Field name that contains the user ID (default: 'createdBy')
 * @returns {Function} - Express middleware function
 */
export const checkResourceOwnership = (resourceField = 'createdBy') => {
  return async (req, res, next) => {
    try {
      const resourceId = req.params.id;
      const userId = req.user.id;

      // The specific model check should be done in the controller
      // This middleware just ensures the user is authenticated
      // and the resource exists in the request
      
      if (!resourceId) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'Resource ID required',
            timestamp: new Date().toISOString()
          }
        });
      }

      req.resourceId = resourceId;
      req.resourceField = resourceField;
      next();
    } catch (error) {
      console.error('Resource ownership middleware error:', error);
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: {
          code: ERROR_CODES.AUTH_ERROR,
          message: 'Authorization check failed',
          timestamp: new Date().toISOString()
        }
      });
    }
  };
};

/**
 * Middleware for optional authentication (currently unused)
 * Reserved for future use if needed
 */