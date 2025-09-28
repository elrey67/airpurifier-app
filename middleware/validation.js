const { body } = require('express-validator');

// Validation for reading data
exports.validateReading = [
  body('input_air_quality')
    .isFloat({ min: 0, max: 5000 })
    .withMessage('Input air quality must be a number between 0 and 5000'),
  body('output_air_quality')
    .isFloat({ min: 0, max: 5000 })
    .withMessage('Output air quality must be a number between 0 and 5000'),
  body('efficiency')
    .isFloat({ min: 0, max: 100 })
    .withMessage('Efficiency must be a number between 0 and 100'),
  body('device_id').notEmpty().withMessage('Device ID is required'),
  body('fan_state').isBoolean().withMessage('Fan state must be a boolean'),
  body('auto_mode').isBoolean().withMessage('Auto mode must be a boolean')
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

// Validation for user updates (password optional)
exports.validateUserUpdate = [
  body('username')
    .optional()
    .isLength({ min: 3, max: 20 })
    .withMessage('Username must be between 3 and 20 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores'),
  
  body('password')
    .optional()
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  
  body('is_admin')
    .optional()
    .isBoolean()
    .withMessage('is_admin must be a boolean value')
];

exports.validatePasswordChange = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),  
  
  body('newPassword')
    .isLength({ min: 6 })
    .withMessage('New password must be at least 6 characters long')
];

// Device validation
// Instead of separate validateDevice function, use express-validator chain
exports.validateDevice = [
  body('device_id')
    .notEmpty()
    .trim()
    .withMessage('Device ID is required')
    .isLength({ max: 100 })
    .withMessage('Device ID must be less than 100 characters'),
  
  body('name')
    .optional()
    .isLength({ max: 100 })
    .withMessage('Device name must be less than 100 characters'),
  
  body('location')
    .optional()
    .isLength({ max: 100 })
    .withMessage('Location must be less than 100 characters')
];


// Device registration validation
exports.validateDeviceRegistration = [
  body('name')
    .notEmpty()
    .withMessage('Device name is required')
    .isLength({ max: 100 })
    .withMessage('Device name must be less than 100 characters'),
  
  body('location')
    .notEmpty()
    .withMessage('Location is required')
    .isLength({ max: 100 })
    .withMessage('Location must be less than 100 characters'),
  
  body('username')
    .notEmpty()
    .withMessage('Username is required')
    .isLength({ min: 3, max: 20 })
    .withMessage('Username must be between 3 and 20 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores'),
  
  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long')
];

// Settings validation
exports.validateSettings = (req, res, next) => {
  const { threshold } = req.body;
  
  if (threshold !== undefined) {
    if (typeof threshold !== 'number' || threshold < 100 || threshold > 2000) {
      return res.status(400).json({ error: 'Threshold must be a number between 100 and 2000' });
    }
  }
  
  next();
};

// Command validation
exports.validateCommand = (req, res, next) => {
  const { command, value } = req.body;
  
  if (!command || !['fan', 'auto', 'threshold'].includes(command)) {
    return res.status(400).json({ error: 'Valid command is required (fan, auto, threshold)' });
  }
  
  if (command === 'fan' && !['on', 'off'].includes(value)) {
    return res.status(400).json({ error: 'Fan value must be "on" or "off"' });
  }
  
  if (command === 'auto' && !['ON', 'OFF'].includes(value)) {
    return res.status(400).json({ error: 'Auto value must be "ON" or "OFF"' });
  }
  
  if (command === 'threshold' && (typeof value !== 'number' || value < 100 || value > 2000)) {
    return res.status(400).json({ error: 'Threshold must be a number between 100 and 2000' });
  }
  
  next();
};

