const jwt = require('jsonwebtoken');
const db = require('../config/database');

module.exports = (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Access denied. No token provided.' });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
    
    // Verify user still exists
    db.get('SELECT id FROM users WHERE id = ?', [decoded.userId], (err, user) => {
      if (err || !user) {
        return res.status(401).json({ error: 'Token is not valid' });
      }
      
      req.userId = decoded.userId;
      next();
    });
  } catch (error) {
    res.status(400).json({ error: 'Invalid token' });
  }
};