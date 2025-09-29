const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../config/database');
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
    
    // Generate SHORT-LIVED access token (1 hour)
    const accessToken = jwt.sign(
      { 
        userId: result.lastID,
        username: username,
        is_admin: false,
        type: 'access'
      }, 
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '1h' }
    );
    
    // Generate LONG-LIVED refresh token (7 days)
    const refreshToken = jwt.sign(
      { 
        userId: result.lastID,
        username: username,
        type: 'refresh'
      },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '7d' }
    );
    
    // Store refresh token in database
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO user_sessions (user_id, refresh_token, expires_at) VALUES (?, ?, datetime("now", "+7 days"))',
        [result.lastID, refreshToken],
        function(err) {
          if (err) {
            console.error('Error storing refresh token:', err);
            reject(err);
          } else {
            resolve(this);
          }
        }
      );
    });
    
    res.status(201).json({
      message: 'User created successfully',
      accessToken: accessToken,
      refreshToken: refreshToken,
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
    
    // Find user
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
    
    // Generate SHORT-LIVED access token (1 hour)
    const accessToken = jwt.sign(
      { 
        userId: user.id,
        username: user.username,
        is_admin: user.is_admin === 1,
        type: 'access'
      }, 
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '1h' }
    );
    
    // Generate LONG-LIVED refresh token (7 days)
    const refreshToken = jwt.sign(
      { 
        userId: user.id,
        username: user.username,
        type: 'refresh'
      },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '7d' }
    );
    
    // Store refresh token in database
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT OR REPLACE INTO user_sessions (user_id, refresh_token, expires_at) VALUES (?, ?, datetime("now", "+7 days"))',
        [user.id, refreshToken],
        function(err) {
          if (err) {
            console.error('Error storing refresh token:', err);
            reject(err);
          } else {
            resolve(this);
          }
        }
      );
    });
    
    console.log('Login successful for user:', username);
    
    res.json({
      message: 'Login successful',
      accessToken: accessToken,
      refreshToken: refreshToken,
      userId: user.id,
      username: user.username,
      is_admin: user.is_admin === 1
    });
    
  } catch (error) {
    console.error('Login error details:', error);
    res.status(500).json({ error: 'Internal server error during login' });
  }
};

// Refresh token endpoint
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(401).json({ 
        success: false,
        error: 'Refresh token required' 
      });
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET || 'fallback_secret');
    
    if (decoded.type !== 'refresh') {
      return res.status(401).json({ 
        success: false,
        error: 'Invalid token type' 
      });
    }

    // Check if refresh token exists in database and is valid
    db.get(
      'SELECT us.*, u.username, u.is_admin FROM user_sessions us JOIN users u ON us.user_id = u.id WHERE us.refresh_token = ? AND us.expires_at > datetime("now") AND u.id = ?',
      [refreshToken, decoded.userId],
      (err, session) => {
        if (err) {
          console.error('Database error in refresh token:', err);
          return res.status(500).json({ 
            success: false,
            error: 'Database error' 
          });
        }
        
        if (!session) {
          return res.status(401).json({ 
            success: false,
            error: 'Invalid or expired refresh token' 
          });
        }
        
        // Generate new access token
        const newAccessToken = jwt.sign(
          { 
            userId: session.user_id,
            username: session.username,
            is_admin: session.is_admin === 1,
            type: 'access'
          },
          process.env.JWT_SECRET || 'fallback_secret',
          { expiresIn: '1h' }
        );
        
        res.json({
          success: true,
          accessToken: newAccessToken,
          user: {
            id: session.user_id,
            username: session.username,
            is_admin: session.is_admin === 1
          }
        });
      }
    );
    
  } catch (error) {
    console.error('Token refresh error:', error);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false,
        error: 'Refresh token expired' 
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false,
        error: 'Invalid refresh token' 
      });
    }
    
    res.status(500).json({ 
      success: false,
      error: 'Internal server error during token refresh' 
    });
  }
};

// Logout endpoint (revoke refresh token)
exports.logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    const userId = req.userId;
    
    if (!refreshToken) {
      return res.status(400).json({ 
        success: false,
        error: 'Refresh token required' 
      });
    }

    // Remove the refresh token from database
    db.run(
      'DELETE FROM user_sessions WHERE refresh_token = ? AND user_id = ?',
      [refreshToken, userId],
      function(err) {
        if (err) {
          console.error('Error during logout:', err);
          return res.status(500).json({ 
            success: false,
            error: 'Logout failed' 
          });
        }
        
        res.json({
          success: true,
          message: 'Logout successful'
        });
      }
    );
    
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error during logout' 
    });
  }
};

// Logout all sessions (revoke all refresh tokens for user)
exports.logoutAll = async (req, res) => {
  try {
    const userId = req.userId;

    // Remove all refresh tokens for this user
    db.run(
      'DELETE FROM user_sessions WHERE user_id = ?',
      [userId],
      function(err) {
        if (err) {
          console.error('Error during logout all:', err);
          return res.status(500).json({ 
            success: false,
            error: 'Logout failed' 
          });
        }
        
        res.json({
          success: true,
          message: 'Logged out from all devices'
        });
      }
    );
    
  } catch (error) {
    console.error('Logout all error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error during logout' 
    });
  }
};