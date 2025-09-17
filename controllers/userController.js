const {db} = require('../config/database');
const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const logger = require('../utils/logger');

// Get all users (admin only)
exports.getUsers = (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;
    
    // Get users with pagination
    db.all('SELECT id, username, is_admin, created_at FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?', 
      [parseInt(limit), offset], 
      (err, rows) => {
        if (err) {
          logger.error('Database error in getUsers', { error: err.message });
          return res.status(500).json({ error: err.message });
        }
        
        // Get total count for pagination
        db.get('SELECT COUNT(*) as total FROM users', (err, countResult) => {
          if (err) {
            logger.error('Database error in getUsers count', { error: err.message });
            return res.status(500).json({ error: err.message });
          }
          
          res.json({
            users: rows,
            pagination: {
              page: parseInt(page),
              limit: parseInt(limit),
              total: countResult.total
            }
          });
        });
      });
  } catch (error) {
    logger.error('Unexpected error in getUsers', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
};

// Create a new user (admin only)
exports.createUser = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('Validation errors in createUser', { errors: errors.array() });
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { username, password, is_admin = false } = req.body;
    
    // Check if user already exists
    db.get('SELECT id FROM users WHERE username = ?', [username], async (err, row) => {
      if (err) {
        logger.error('Database error in createUser', { error: err.message });
        return res.status(500).json({ error: err.message });
      }
      
      if (row) {
        return res.status(400).json({ error: 'User already exists' });
      }
      
      // Hash password and create user
      const hashedPassword = await bcrypt.hash(password, 12);
      
      db.run('INSERT INTO users (username, password, is_admin) VALUES (?, ?, ?)', 
        [username, hashedPassword, is_admin], function(err) {
          if (err) {
            logger.error('Database error in createUser insert', { error: err.message });
            return res.status(500).json({ error: err.message });
          }
          
          logger.info('User created successfully', { id: this.lastID, username, is_admin });
          res.status(201).json({
            id: this.lastID,
            username,
            is_admin,
            message: 'User created successfully'
          });
        });
    });
  } catch (error) {
    logger.error('Unexpected error in createUser', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
};

// Update a user (admin only)
exports.updateUser = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('Validation errors in updateUser', { errors: errors.array() });
      return res.status(400).json({ errors: errors.array() });
    }
    
    const userId = req.params.id;
    const { username, password, is_admin } = req.body;
    
    // Check if user exists
    db.get('SELECT id FROM users WHERE id = ?', [userId], async (err, row) => {
      if (err) {
        logger.error('Database error in updateUser', { error: err.message });
        return res.status(500).json({ error: err.message });
      }
      
      if (!row) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      // Check if username is already taken by another user
      if (username) {
        db.get('SELECT id FROM users WHERE username = ? AND id != ?', [username, userId], async (err, existingUser) => {
          if (err) {
            logger.error('Database error in updateUser username check', { error: err.message });
            return res.status(500).json({ error: err.message });
          }
          
          if (existingUser) {
            return res.status(400).json({ error: 'Username already taken' });
          }
          
          // Update user
          await updateUserData(userId, username, password, is_admin, res);
        });
      } else {
        // Update user without changing username
        await updateUserData(userId, null, password, is_admin, res);
      }
    });
  } catch (error) {
    logger.error('Unexpected error in updateUser', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
};

// Helper function to update user data
async function updateUserData(userId, username, password, is_admin, res) {
  let query = 'UPDATE users SET ';
  let params = [];
  let updates = [];
  
  if (username) {
    updates.push('username = ?');
    params.push(username);
  }
  
  if (password) {
    const hashedPassword = await bcrypt.hash(password, 12);
    updates.push('password = ?');
    params.push(hashedPassword);
  }
  
  if (is_admin !== undefined) {
    updates.push('is_admin = ?');
    params.push(is_admin);
  }
  
  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }
  
  query += updates.join(', ') + ' WHERE id = ?';
  params.push(userId);
  
  db.run(query, params, function(err) {
    if (err) {
      logger.error('Database error in updateUserData', { error: err.message });
      return res.status(500).json({ error: err.message });
    }
    
    if (this.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    logger.info('User updated successfully', { userId });
    res.json({ message: 'User updated successfully' });
  });
}

// Delete a user (admin only)
exports.deleteUser = (req, res) => {
  try {
    const userId = req.params.id;
    
    // Prevent admin from deleting themselves
    if (parseInt(userId) === parseInt(req.userId)) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    
    db.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
      if (err) {
        logger.error('Database error in deleteUser', { error: err.message });
        return res.status(500).json({ error: err.message });
      }
      
      if (this.changes === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      logger.info('User deleted successfully', { userId });
      res.json({ message: 'User deleted successfully' });
    });
  } catch (error) {
    logger.error('Unexpected error in deleteUser', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
};

// Get user profile
exports.getProfile = (req, res) => {
  try {
    db.get('SELECT id, username, is_admin, created_at FROM users WHERE id = ?', [req.userId], (err, user) => {
      if (err) {
        logger.error('Database error in getProfile', { error: err.message });
        return res.status(500).json({ error: err.message });
      }
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      res.json(user);
    });
  } catch (error) {
    logger.error('Unexpected error in getProfile', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
};

// Update user profile
exports.updateProfile = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('Validation errors in updateProfile', { errors: errors.array() });
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { username, password } = req.body;
    
    // Check if username is already taken by another user
    if (username) {
      db.get('SELECT id FROM users WHERE username = ? AND id != ?', [username, req.userId], async (err, existingUser) => {
        if (err) {
          logger.error('Database error in updateProfile username check', { error: err.message });
          return res.status(500).json({ error: err.message });
        }
        
        if (existingUser) {
          return res.status(400).json({ error: 'Username already taken' });
        }
        
        // Update profile
        await updateProfileData(req.userId, username, password, res);
      });
    } else {
      // Update profile without changing username
      await updateProfileData(req.userId, null, password, res);
    }
  } catch (error) {
    logger.error('Unexpected error in updateProfile', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
};

// Helper function to update profile data
async function updateProfileData(userId, username, password, res) {
  let query = 'UPDATE users SET ';
  let params = [];
  let updates = [];
  
  if (username) {
    updates.push('username = ?');
    params.push(username);
  }
  
  if (password) {
    const hashedPassword = await bcrypt.hash(password, 12);
    updates.push('password = ?');
    params.push(hashedPassword);
  }
  
  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }
  
  query += updates.join(', ') + ' WHERE id = ?';
  params.push(userId);
  
  db.run(query, params, function(err) {
    if (err) {
      logger.error('Database error in updateProfileData', { error: err.message });
      return res.status(500).json({ error: err.message });
    }
    
    logger.info('Profile updated successfully', { userId });
    res.json({ message: 'Profile updated successfully' });
  });
}

// Add this function to your userController.js

// Change user password
exports.changePassword = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('Validation errors in changePassword', { errors: errors.array() });
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { currentPassword, newPassword } = req.body;
    const userId = req.userId;
    
    // Get current user data
    db.get('SELECT password FROM users WHERE id = ?', [userId], async (err, user) => {
      if (err) {
        logger.error('Database error in changePassword', { error: err.message });
        return res.status(500).json({ error: err.message });
      }
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      // Verify current password
      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }
      
      // Hash new password and update
      const hashedPassword = await bcrypt.hash(newPassword, 12);
      
      db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId], function(err) {
        if (err) {
          logger.error('Database error in changePassword update', { error: err.message });
          return res.status(500).json({ error: err.message });
        }
        
        logger.info('Password changed successfully', { userId });
        res.json({ message: 'Password changed successfully' });
      });
    });
  } catch (error) {
    logger.error('Unexpected error in changePassword', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
};