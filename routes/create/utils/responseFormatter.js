import { HTTP_STATUS, ERROR_CODES } from '../config/constants.js';

/**
 * Format successful response
 * @param {Object} res - Express response object
 * @param {*} data - Response data
 * @param {string} message - Success message
 * @param {number} statusCode - HTTP status code
 */
export const successResponse = (res, data = null, message = 'Success', statusCode = HTTP_STATUS.OK) => {
  const response = {
    success: true,
    message,
    timestamp: new Date().toISOString()
  };

  if (data !== null) {
    response.data = data;
  }

  return res.status(statusCode).json(response);
};

/**
 * Format error response
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 * @param {string} code - Error code
 * @param {number} statusCode - HTTP status code
 * @param {*} details - Additional error details
 */
export const errorResponse = (res, message = 'An error occurred', code = ERROR_CODES.INTERNAL_SERVER_ERROR, statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR, details = null) => {
  const response = {
    success: false,
    error: {
      code,
      message,
      timestamp: new Date().toISOString()
    }
  };

  if (details !== null) {
    response.error.details = details;
  }

  return res.status(statusCode).json(response);
};

/**
 * Format paginated response
 * @param {Object} res - Express response object
 * @param {Array} data - Response data array
 * @param {Object} pagination - Pagination info
 * @param {string} message - Success message
 */
export const paginatedResponse = (res, data, pagination, message = 'Success') => {
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message,
    data,
    pagination: {
      currentPage: pagination.page,
      totalPages: pagination.totalPages,
      totalItems: pagination.totalItems,
      itemsPerPage: pagination.limit,
      hasNextPage: pagination.page < pagination.totalPages,
      hasPrevPage: pagination.page > 1
    },
    timestamp: new Date().toISOString()
  });
};

/**
 * Format not found response
 * @param {Object} res - Express response object
 * @param {string} resource - Resource name that was not found
 */
export const notFoundResponse = (res, resource = 'Resource') => {
  return errorResponse(
    res,
    `${resource} not found`,
    ERROR_CODES.NOT_FOUND,
    HTTP_STATUS.NOT_FOUND
  );
};

/**
 * Format unauthorized response
 * @param {Object} res - Express response object
 * @param {string} message - Custom message
 */
export const unauthorizedResponse = (res, message = 'Unauthorized access') => {
  return errorResponse(
    res,
    message,
    ERROR_CODES.AUTH_ERROR,
    HTTP_STATUS.UNAUTHORIZED
  );
};

/**
 * Format forbidden response
 * @param {Object} res - Express response object
 * @param {string} message - Custom message
 */
export const forbiddenResponse = (res, message = 'Access forbidden') => {
  return errorResponse(
    res,
    message,
    ERROR_CODES.AUTH_ERROR,
    HTTP_STATUS.FORBIDDEN
  );
};

/**
 * Format validation error response
 * @param {Object} res - Express response object
 * @param {Array} errors - Validation errors array
 */
export const validationErrorResponse = (res, errors) => {
  return errorResponse(
    res,
    'Validation failed',
    ERROR_CODES.VALIDATION_ERROR,
    HTTP_STATUS.BAD_REQUEST,
    errors
  );
};

/**
 * Format conflict response (for duplicate resources)
 * @param {Object} res - Express response object
 * @param {string} message - Conflict message
 */
export const conflictResponse = (res, message = 'Resource already exists') => {
  return errorResponse(
    res,
    message,
    ERROR_CODES.DUPLICATE_RESOURCE,
    HTTP_STATUS.CONFLICT
  );
};

/**
 * Format service unavailable response
 * @param {Object} res - Express response object
 * @param {string} message - Service message
 */
export const serviceUnavailableResponse = (res, message = 'Service temporarily unavailable') => {
  return errorResponse(
    res,
    message,
    ERROR_CODES.AI_SERVICE_ERROR,
    HTTP_STATUS.SERVICE_UNAVAILABLE
  );
};