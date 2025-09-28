const express = require('express');
const router = express.Router();
const { generalLimiter, authLimiter, dataLimiter } = require('../middleware/rateLimit');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const { 
  validateReading, 
  validateUser, 
  validateUserUpdate, 
  validateDevice, 
  validateSettings,
  validateDeviceRegistration 
} = require('../middleware/validation');
const readingsController = require('../controllers/readingsController');
const authController = require('../controllers/authController');
const userController = require('../controllers/userController');
const deviceController = require('../controllers/deviceController');
const settingsController = require('../controllers/settingsController');

// ===== PUBLIC ROUTES =====
router.post('/auth/register', authLimiter, validateUser, authController.register);
router.post('/auth/login', authLimiter, validateUser, authController.login);

// Token verification route
router.get('/auth/verify', auth, async (req, res) => {
  try {
    const { db } = require('../config/database');
    
    db.get('SELECT id, username, is_admin FROM users WHERE id = ?', [req.userId], (err, user) => {
      if (err || !user) {
        return res.status(401).json({ 
          valid: false, 
          error: 'User not found' 
        });
      }
      
      res.json({
        valid: true,
        message: 'Token is valid',
        user: {
          id: user.id,
          username: user.username,
          is_admin: user.is_admin,
          created_at: user.created_at
        }
      });
    });
  } catch (error) {
    res.status(500).json({ 
      valid: false, 
      error: 'Internal server error' 
    });
  }
});

// ===== ESP32 DEVICE ROUTES (No auth required for device communication) =====
router.post('/readings', dataLimiter, readingsController.storeESP32Reading);
router.get('/data', dataLimiter, deviceController.getDeviceData);
router.get('/commands/pending', dataLimiter, deviceController.getPendingCommands);
router.put('/commands/:commandId/status', dataLimiter, deviceController.updateCommandStatus);

// ===== AUTHENTICATED ROUTES (Web interface) =====
router.use(auth); // Apply auth to all routes below

// User profile routes
router.get('/profile', generalLimiter, userController.getProfile);
router.put('/profile', generalLimiter, validateUserUpdate, userController.updateProfile);
router.post('/auth/change-password', generalLimiter, userController.changePassword);

// Device management (user's devices)
router.post('/devices/register', generalLimiter, validateDeviceRegistration, deviceController.registerDevice);
router.get('/devices/my-devices', generalLimiter, deviceController.getUserDevices);
router.delete('/devices/:deviceId', generalLimiter, deviceController.deleteDevice);

// Device status and monitoring
router.get('/device-status', generalLimiter, deviceController.getDeviceStatus);
router.get('/system-status', generalLimiter, deviceController.getSystemStatus);

// Readings data routes
router.get('/readings', generalLimiter, readingsController.getReadings);
router.get('/stats', generalLimiter, readingsController.getStats);
router.get('/historical-data', generalLimiter, readingsController.getHistoricalData);
router.get('/latest-data', generalLimiter, readingsController.getLatestData);

// Command sending
router.post('/command', generalLimiter, deviceController.sendCommand);

// Settings management
router.get('/settings', generalLimiter, settingsController.getSettings);
router.get('/settings/:deviceId', generalLimiter, settingsController.getDeviceSettings);

// ===== ADMIN-ONLY ROUTES =====
router.use(adminAuth); // Apply admin auth to all routes below

// Device management (admin only - all devices)
router.get('/devices', generalLimiter, deviceController.getDevices);
router.get('/devices/:deviceId', generalLimiter, deviceController.getDevice);
router.post('/devices', generalLimiter, validateDevice, deviceController.createDevice);
router.put('/devices/:deviceId', generalLimiter, validateDevice, deviceController.updateDevice);
router.delete('/devices/:deviceId', generalLimiter, deviceController.deleteDevice);

// Settings management (admin only)
router.put('/settings/:deviceId', generalLimiter, validateSettings, settingsController.updateSettings);

// User management (admin only)
router.get('/users', generalLimiter, userController.getUsers);
router.post('/users', generalLimiter, validateUser, userController.createUser);
router.put('/users/:id', generalLimiter, validateUserUpdate, userController.updateUser);
router.delete('/users/:id', generalLimiter, userController.deleteUser);

module.exports = router;