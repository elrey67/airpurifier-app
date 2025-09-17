
const express = require('express');
const router = express.Router();
const { generalLimiter, authLimiter, dataLimiter } = require('../middleware/rateLimit');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth'); // We'll create this
const { validateReading, validateUser, validateUserUpdate } = require('../middleware/validation');
const readingsController = require('../controllers/readingsController');
const authController = require('../controllers/authController');
const userController = require('../controllers/userController'); // We'll create this

// Public routes
router.post('/auth/register', authLimiter, validateUser, authController.register);
router.post('/auth/login', authLimiter, validateUser, authController.login);
router.post('/auth/change-password', auth, userController.changePassword);

// Data submission from ESP32
router.post('/readings', dataLimiter, validateReading, readingsController.addReading);

// Protected routes (require authentication)
router.get('/readings', auth, generalLimiter, readingsController.getReadings);
router.get('/stats', auth, generalLimiter, readingsController.getStats);

// User management routes (admin only)
router.get('/users', auth, adminAuth, userController.getUsers);
router.post('/users', auth, adminAuth, validateUser, userController.createUser);
router.put('/users/:id', auth, adminAuth, validateUserUpdate, userController.updateUser);
router.delete('/users/:id', auth, adminAuth, userController.deleteUser);

// User profile routes
router.get('/profile', auth, userController.getProfile);
router.put('/profile', auth, validateUserUpdate, userController.updateProfile);

module.exports = router;