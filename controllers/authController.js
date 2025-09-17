const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../config/database'); // ← FIXED: Destructure db from the exported object
const { validationResult } = require('express-validator');

// Register a new user
exports.register = async (req, res) => {
  try {
    console.log('Register attempt:', { username: req.body.username });
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    // Check if user already exists
    const existingUser = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM users WHERE username = ?', [username], (err, row) => {
        if (err) {
          console.error('Database error in register:', err);
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
    
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    // Hash password and create user
    const hashedPassword = await bcrypt.hash(password, 12);
    
    const result = await new Promise((resolve, reject) => {
      db.run('INSERT INTO users (username, password) VALUES (?, ?)', 
        [username, hashedPassword], function(err) {
          if (err) {
            console.error('Database error creating user:', err);
            reject(err);
          } else {
            resolve(this);
          }
        });
    });
    
    console.log('User created successfully:', username);
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: result.lastID }, 
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '24h'}
    );
    
    res.status(201).json({
      message: 'User created successfully',
      token,
      userId: result.lastID,
      username: username
    });
    
  } catch (error) {
    console.error('Register error details:', error);
    res.status(500).json({ error: 'Internal server error during registration' });
  }
};

// Login user
exports.login = async (req, res) => {
  try {
    console.log('Login attempt:', { username: req.body.username });
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    // Find user - using a promise wrapper for better error handling
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
        if (err) {
          console.error('Database error in login:', err);
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
    
    console.log('User found:', user ? 'yes' : 'no');
    
    if (!user) {
      console.log('No user found with username:', username);
      return res.status(401).json({ error: 'Login failed. Please check your credentials.' });
    }
    
    console.log('User data:', { 
      id: user.id, 
      username: user.username,
      hasPassword: !!user.password 
    });
    
    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    console.log('Password match result:', isMatch);
    
    if (!isMatch) {
      console.log('Password mismatch for user:', username);
      return res.status(401).json({ error: 'Login failed. Please check your credentials.' });
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id }, 
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '24h'}
    );
    
    console.log('Login successful for user:', username);
    
    res.json({
      message: 'Login successful',
      token,
      userId: user.id,
      username: user.username
    });
    
  } catch (error) {
    console.error('Login error details:', error);
    res.status(500).json({ error: 'Internal server error during login' });
  }
};