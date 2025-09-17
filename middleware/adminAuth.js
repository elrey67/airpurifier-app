const db = require('../config/database');
const logger = require('../utils/logger');

module.exports = (req, res, next) => {
  try {
    // First, check if the user is authenticated
    if (!req.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Check if the user is an admin
    db.get('SELECT is_admin FROM users WHERE id = ?', [req.userId], (err, user) => {
      if (err) {
        logger.error('Database error in adminAuth', { error: err.message });
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      if (!user.is_admin) {
        return res.status(403).json({ error: 'Admin access required' });
      }
      
      next();
    });
  } catch (error) {
    logger.error('Error in adminAuth middleware', { error: error.message });
    res.status(500).json({ error: 'Server error' });
  }
};