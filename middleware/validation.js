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
exports.validateDevice = (req, res, next) => {
  const { device_id, name, location } = req.body;
  
  if (!device_id || device_id.trim() === '') {
    return res.status(400).json({ error: 'Device ID is required' });
  }
  
  if (name && name.length > 100) {
    return res.status(400).json({ error: 'Device name must be less than 100 characters' });
  }
  
  if (location && location.length > 100) {
    return res.status(400).json({ error: 'Location must be less than 100 characters' });
  }
  
  next();
};

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