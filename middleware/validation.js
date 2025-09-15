const { body } = require('express-validator');

// Validation for reading data
exports.validateReading = [
  body('device_id')
    .notEmpty()
    .withMessage('Device ID is required')
    .isLength({ min: 1, max: 50 })
    .withMessage('Device ID must be between 1 and 50 characters'),
  
  body('air_quality')
    .isFloat({ min: 0, max: 5000 })
    .withMessage('Air quality must be a number between 0 and 5000'),
  
  body('fan_state')
    .isBoolean()
    .withMessage('Fan state must be a boolean'),
  
  body('auto_mode')
    .isBoolean()
    .withMessage('Auto mode must be a boolean')
];

// Validation for user registration/login
exports.validateUser = [
  body('username')
    .isLength({ min: 3, max: 20 })
    .withMessage('Username must be between 3 and 20 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores'),
  
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long')
];