import { body, param, query, validationResult } from 'express-validator';
import { HTTP_STATUS, ERROR_CODES, MATERIAL_TYPES, QUESTION_TYPES, DIFFICULTY_LEVELS, PEDAGOGICAL_APPROACHES } from '../config/constants.js';

/**
 * Middleware to handle validation results
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Validation failed',
        details: errors.array(),
        timestamp: new Date().toISOString()
      }
    });
  }
  next();
};

// Authentication Validators
export const validateLogin = [
  body('cwlId')
    .trim()
    .notEmpty()
    .withMessage('CWL ID is required')
    .isLength({ min: 2, max: 50 })
    .withMessage('CWL ID must be between 2 and 50 characters'),
  
  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  
  handleValidationErrors
];

export const validateRegister = [
  body('cwlId')
    .trim()
    .notEmpty()
    .withMessage('CWL ID is required')
    .isLength({ min: 2, max: 50 })
    .withMessage('CWL ID must be between 2 and 50 characters')
    .matches(/^[a-zA-Z0-9]+$/)
    .withMessage('CWL ID can only contain letters and numbers'),
  
  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one lowercase letter, one uppercase letter, and one number'),
  
  handleValidationErrors
];

// Folder Validators
export const validateCreateFolder = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Folder name is required')
    .isLength({ min: 1, max: 200 })
    .withMessage('Folder name must be between 1 and 200 characters'),
  
  body('quizCount')
    .optional()
    .isInt({ min: 1, max: 20 })
    .withMessage('Quiz count must be between 1 and 20'),
  
  handleValidationErrors
];

export const validateUpdateFolder = [
  param('id')
    .isMongoId()
    .withMessage('Invalid folder ID'),
  
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Folder name must be between 1 and 200 characters'),
  
  handleValidationErrors
];

// Material Validators
export const validateCreateMaterial = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Material name is required')
    .isLength({ min: 1, max: 255 })
    .withMessage('Material name must be between 1 and 255 characters'),
  
  body('type')
    .isIn(Object.values(MATERIAL_TYPES))
    .withMessage(`Material type must be one of: ${Object.values(MATERIAL_TYPES).join(', ')}`),
  
  body('folderId')
    .isMongoId()
    .withMessage('Valid folder ID is required'),
  
  // Conditional validation based on type
  body('url')
    .if(body('type').equals(MATERIAL_TYPES.URL))
    .isURL()
    .withMessage('Valid URL is required for URL materials'),
  
  body('content')
    .if(body('type').equals(MATERIAL_TYPES.TEXT))
    .notEmpty()
    .withMessage('Content is required for text materials')
    .isLength({ max: 50000 })
    .withMessage('Content must be less than 50000 characters'),
  
  handleValidationErrors
];

// Quiz Validators
export const validateCreateQuiz = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Quiz name is required')
    .isLength({ min: 1, max: 200 })
    .withMessage('Quiz name must be between 1 and 200 characters'),
  
  body('folderId')
    .isMongoId()
    .withMessage('Valid folder ID is required'),
  
  handleValidationErrors
];

export const validateUpdateQuiz = [
  param('id')
    .isMongoId()
    .withMessage('Invalid quiz ID'),
  
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Quiz name must be between 1 and 200 characters'),
  
  body('settings.pedagogicalApproach')
    .optional()
    .isIn(Object.values(PEDAGOGICAL_APPROACHES))
    .withMessage(`Pedagogical approach must be one of: ${Object.values(PEDAGOGICAL_APPROACHES).join(', ')}`),
  
  body('settings.questionsPerObjective')
    .optional()
    .isInt({ min: 1, max: 10 })
    .withMessage('Questions per objective must be between 1 and 10'),
  
  handleValidationErrors
];

export const validateAssignMaterials = [
  param('id')
    .isMongoId()
    .withMessage('Invalid quiz ID'),
  
  body('materialIds')
    .isArray()
    .withMessage('Material IDs must be an array'),
  
  body('materialIds.*')
    .isMongoId()
    .withMessage('All material IDs must be valid'),
  
  handleValidationErrors
];

// Learning Objective Validators
export const validateCreateObjective = [
  body('text')
    .trim()
    .notEmpty()
    .withMessage('Learning objective text is required')
    .isLength({ min: 1, max: 500 })
    .withMessage('Learning objective text must be between 1 and 500 characters'),
  
  body('quizId')
    .isMongoId()
    .withMessage('Valid quiz ID is required'),
  
  body('order')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Order must be a non-negative integer'),
  
  handleValidationErrors
];

export const validateGenerateObjectives = [
  body('quizId')
    .isMongoId()
    .withMessage('Valid quiz ID is required'),
  
  body('materialIds')
    .isArray({ min: 1 })
    .withMessage('At least one material ID is required'),
  
  body('materialIds.*')
    .isMongoId()
    .withMessage('All material IDs must be valid'),
  
  handleValidationErrors
];

export const validateClassifyObjectives = [
  body('quizId')
    .isMongoId()
    .withMessage('Valid quiz ID is required'),
  
  body('text')
    .trim()
    .notEmpty()
    .withMessage('Text to classify is required')
    .isLength({ min: 10, max: 10000 })
    .withMessage('Text must be between 10 and 10000 characters'),
  
  handleValidationErrors
];

// Question Validators
export const validateCreateQuestion = [
  body('quizId')
    .isMongoId()
    .withMessage('Valid quiz ID is required'),
  
  body('learningObjectiveId')
    .isMongoId()
    .withMessage('Valid learning objective ID is required'),
  
  body('type')
    .isIn(Object.values(QUESTION_TYPES))
    .withMessage(`Question type must be one of: ${Object.values(QUESTION_TYPES).join(', ')}`),
  
  body('difficulty')
    .isIn(Object.values(DIFFICULTY_LEVELS))
    .withMessage(`Difficulty must be one of: ${Object.values(DIFFICULTY_LEVELS).join(', ')}`),
  
  body('questionText')
    .trim()
    .notEmpty()
    .withMessage('Question text is required')
    .isLength({ min: 1, max: 2000 })
    .withMessage('Question text must be between 1 and 2000 characters'),
  
  handleValidationErrors
];

export const validateGenerateQuestions = [
  body('quizId')
    .isMongoId()
    .withMessage('Valid quiz ID is required'),
  
  body('planId')
    .isMongoId()
    .withMessage('Valid generation plan ID is required'),
  
  handleValidationErrors
];

export const validateReorderQuestions = [
  body('quizId')
    .isMongoId()
    .withMessage('Valid quiz ID is required'),
  
  body('questionIds')
    .isArray({ min: 1 })
    .withMessage('Question IDs array is required'),
  
  body('questionIds.*')
    .isMongoId()
    .withMessage('All question IDs must be valid'),
  
  handleValidationErrors
];

// Generation Plan Validators
export const validateGeneratePlan = [
  body('quizId')
    .isMongoId()
    .withMessage('Valid quiz ID is required'),
  
  body('approach')
    .isIn(Object.values(PEDAGOGICAL_APPROACHES))
    .withMessage(`Approach must be one of: ${Object.values(PEDAGOGICAL_APPROACHES).join(', ')}`),
  
  body('questionsPerLO')
    .optional()
    .isInt({ min: 1, max: 10 })
    .withMessage('Questions per learning objective must be between 1 and 10'),
  
  handleValidationErrors
];

// Common Validators
export const validateMongoId = [
  param('id')
    .isMongoId()
    .withMessage('Invalid ID format'),
  
  handleValidationErrors
];

export const validateFolderId = [
  param('folderId')
    .isMongoId()
    .withMessage('Invalid folder ID format'),
  
  handleValidationErrors
];

export const validateQuizId = [
  param('quizId')
    .isMongoId()
    .withMessage('Invalid quiz ID format'),
  
  handleValidationErrors
];

export const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  
  handleValidationErrors
];