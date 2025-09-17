// middleware/auth.js - Updated version
const jwt = require('jsonwebtoken');
const { db } = require('../config/database'); // Make sure to destructure db

module.exports = (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      // For verify endpoint, return 401 instead of throwing error
      if (req.path === '/api/auth/verify') {
        return res.status(401).json({ 
          valid: false, 
          error: 'No token provided' 
        });
      }
      return res.status(401).json({ error: 'Access denied. No token provided.' });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
    
    // Verify user still exists
    db.get('SELECT id FROM users WHERE id = ?', [decoded.userId], (err, user) => {
      if (err) {
        console.error('Database error in auth middleware:', err);
        if (req.path === '/api/auth/verify') {
          return res.status(401).json({ valid: false, error: 'Database error' });
        }
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!user) {
        if (req.path === '/api/auth/verify') {
          return res.status(401).json({ valid: false, error: 'User not found' });
        }
        return res.status(401).json({ error: 'Token is not valid' });
      }
      
      req.userId = decoded.userId;
      next();
    });
  } catch (error) {
    console.error('Token verification error:', error);
    if (req.path === '/api/auth/verify') {
      return res.status(401).json({ 
        valid: false, 
        error: 'Invalid token',
        details: error.message 
      });
    }
    res.status(400).json({ error: 'Invalid token' });
  }
};