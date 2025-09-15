const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { validationResult } = require('express-validator');

// Register a new user
exports.register = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { username, password } = req.body;
    
    // Check if user already exists
    db.get('SELECT id FROM users WHERE username = ?', [username], async (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      if (row) {
        return res.status(400).json({ error: 'User already exists' });
      }
      
      // Hash password and create user
      const hashedPassword = await bcrypt.hash(password, 12);
      
      db.run('INSERT INTO users (username, password) VALUES (?, ?)', 
        [username, hashedPassword], function(err) {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          
          // Generate JWT token
          const token = jwt.sign(
            { userId: this.lastID }, 
            process.env.JWT_SECRET || 'fallback_secret',
            { expiresIn: '24h' }
          );
          
          res.status(201).json({
            message: 'User created successfully',
            token,
            userId: this.lastID
          });
        });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Login user
exports.login = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { username, password } = req.body;
    
    // Find user
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      // Check password
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      // Generate JWT token
      const token = jwt.sign(
        { userId: user.id }, 
        process.env.JWT_SECRET || 'fallback_secret',
        { expiresIn: '24h' }
      );
      
      res.json({
        message: 'Login successful',
        token,
        userId: user.id
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};