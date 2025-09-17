const express = require('express');
const router = express.Router();
const { generalLimiter, authLimiter, dataLimiter } = require('../middleware/rateLimit');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const { validateReading, validateUser, validateUserUpdate, validateDevice, validateSettings } = require('../middleware/validation');
const readingsController = require('../controllers/readingsController');
const authController = require('../controllers/authController');
const userController = require('../controllers/userController');
const deviceController = require('../controllers/deviceController'); // We'll create this
const settingsController = require('../controllers/settingsController'); // We'll create this

// Public routes
router.post('/auth/register', authLimiter, validateUser, authController.register);
router.post('/auth/login', authLimiter, validateUser, authController.login);
router.post('/auth/change-password', auth, userController.changePassword);

// Data submission from ESP32
router.post('/readings', dataLimiter, validateReading, readingsController.addReading);
router.post('/device-data', dataLimiter, readingsController.storeDeviceData); // New endpoint for ESP32 data sync

// Device status and data routes
router.get('/device-status', generalLimiter, deviceController.getDeviceStatus); // Get current device status
router.get('/latest-data', generalLimiter, readingsController.getLatestData); // Get latest reading data
router.get('/historical-data', auth, generalLimiter, readingsController.getHistoricalData); // Get historical data for charts

// Protected routes (require authentication)
router.get('/readings', auth, generalLimiter, readingsController.getReadings);
router.get('/stats', auth, generalLimiter, readingsController.getStats);

// Device management routes
router.get('/devices', auth, generalLimiter, deviceController.getDevices);
router.get('/devices/:deviceId', auth, generalLimiter, deviceController.getDevice);
router.post('/devices', auth, adminAuth, validateDevice, deviceController.createDevice);
router.put('/devices/:deviceId', auth, adminAuth, validateDevice, deviceController.updateDevice);
router.delete('/devices/:deviceId', auth, adminAuth, deviceController.deleteDevice);

// Settings management routes
router.get('/settings', auth, generalLimiter, settingsController.getSettings);
router.get('/settings/:deviceId', auth, generalLimiter, settingsController.getDeviceSettings);
router.put('/settings/:deviceId', auth, adminAuth, validateSettings, settingsController.updateSettings);

// Command routes for device control
router.post('/command', auth, generalLimiter, deviceController.sendCommand); // Send command to device
router.get('/commands/pending', generalLimiter, deviceController.getPendingCommands); // ESP32 checks for pending commands
router.put('/commands/:commandId/status', generalLimiter, deviceController.updateCommandStatus); // Update command status

// User management routes (admin only)
router.get('/users', auth, adminAuth, userController.getUsers);
router.post('/users', auth, adminAuth, validateUser, userController.createUser);
router.put('/users/:id', auth, adminAuth, validateUserUpdate, userController.updateUser);
router.delete('/users/:id', auth, adminAuth, userController.deleteUser);

// User profile routes
router.get('/profile', auth, userController.getProfile);
router.put('/profile', auth, validateUserUpdate, userController.updateProfile);

// System status route
router.get('/system-status', auth, generalLimiter, deviceController.getSystemStatus);

module.exports = router;