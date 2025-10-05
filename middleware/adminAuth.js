// middleware/adminAuth.js - OPTIMIZED
const { db } = require('../config/database');
const logger = require('../utils/logger');

module.exports = (req, res, next) => {
  try {
    // First, check if the user is authenticated
    if (!req.userId) {
      logger.warn('Admin access attempted without authentication', { ip: req.ip, path: req.path });
      return res.status(401).json({ 
        error: 'Authentication required',
        redirect: '/login'
      });
    }
    
    // Check if the user is an admin
    db.get('SELECT is_admin FROM users WHERE id = ?', [req.userId], (err, user) => {
      if (err) {
        logger.error('Database error in adminAuth', { 
          error: err.message, 
          userId: req.userId,
          path: req.path 
        });
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (!user) {
        logger.warn('Admin access attempted with non-existent user', { 
          userId: req.userId,
          path: req.path 
        });
        return res.status(404).json({ error: 'User not found' });
      }
      
      if (!user.is_admin) {
        logger.warn('Non-admin user attempted admin access', { 
          userId: req.userId,
          path: req.path 
        });
        return res.status(403).json({ 
          error: 'Admin privileges required',
          message: 'You do not have permission to access this resource'
        });
      }
      
      // User is admin, proceed
      logger.debug('Admin access granted', { userId: req.userId, path: req.path });
      next();
    });
  } catch (error) {
    logger.error('Unexpected error in adminAuth middleware', { 
      error: error.message,
      stack: error.stack,
      userId: req.userId 
    });
    res.status(500).json({ error: 'Server error' });
  }
};