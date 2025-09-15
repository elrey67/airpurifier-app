const express = require('express');
const router = express.Router();
const { generalLimiter, authLimiter, dataLimiter } = require('../middleware/rateLimit');
const auth = require('../middleware/auth');
const { validateReading, validateUser } = require('../middleware/validation');
const readingsController = require('../controllers/readingsController');
const authController = require('../controllers/authController');

// Public routes
router.post('/auth/register', authLimiter, validateUser, authController.register);
router.post('/auth/login', authLimiter, validateUser, authController.login);

// Data submission from ESP32 (with different rate limiting)
router.post('/readings', dataLimiter, validateReading, readingsController.addReading);

// Protected routes (require authentication)
router.get('/readings', auth, generalLimiter, readingsController.getReadings);
router.get('/stats', auth, generalLimiter, readingsController.getStats);

module.exports = router;