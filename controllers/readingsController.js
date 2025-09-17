const db = require('../config/database');
const { validationResult } = require('express-validator');
const logger = require('../utils/logger'); // Make sure to import logger

// Get all readings with optional filtering
exports.getReadings = (req, res) => {
  try {
    const { device_id, limit = 100, page = 1 } = req.query;
    const offset = (page - 1) * limit;
    
    let query = 'SELECT * FROM readings';
    let params = [];
    
    if (device_id) {
      query += ' WHERE device_id = ?';
      params.push(device_id);
    }
    
    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);
    
    db.all(query, params, (err, rows) => {
      if (err) {
        logger.error('Database error in getReadings', { error: err.message });
        return res.status(500).json({ error: err.message });
      }
      
      logger.info('Readings retrieved successfully', { count: rows.length });
      res.json({
        data: rows,
        page: parseInt(page),
        limit: parseInt(limit)
      });
    });
  } catch (error) {
    logger.error('Unexpected error in getReadings', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
};

// Add a new reading
exports.addReading = (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('Validation errors in addReading', { errors: errors.array() });
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { device_id, air_quality, fan_state, auto_mode } = req.body;
    
    logger.info('New reading received', { device_id, air_quality, fan_state, auto_mode });
    
    const query = `INSERT INTO readings (device_id, air_quality, fan_state, auto_mode) 
                   VALUES (?, ?, ?, ?)`;
    
    db.run(query, [device_id, air_quality, fan_state, auto_mode], function(err) {
      if (err) {
        logger.error('Database error in addReading', { error: err.message });
        return res.status(500).json({ error: err.message });
      }
      
      logger.info('Reading added successfully', { id: this.lastID });
      res.status(201).json({
        id: this.lastID,
        message: 'Reading added successfully'
      });
    });
  } catch (error) {
    logger.error('Unexpected error in addReading', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
};

// Get statistics for a device
exports.getStats = (req, res) => {
  try {
    const { device_id, hours = 24 } = req.query;
    
    if (!device_id) {
      logger.warn('Missing device_id in getStats request');
      return res.status(400).json({ error: 'Device ID is required' });
    }
    
    const query = `
      SELECT 
        AVG(air_quality) as avg_quality,
        MIN(air_quality) as min_quality,
        MAX(air_quality) as max_quality,
        COUNT(*) as reading_count,
        SUM(fan_state) as fan_on_count
      FROM readings 
      WHERE device_id = ? AND timestamp >= datetime('now', ?)
    `;
    
    db.get(query, [device_id, `-${hours} hours`], (err, row) => {
      if (err) {
        logger.error('Database error in getStats', { error: err.message, device_id });
        return res.status(500).json({ error: err.message });
      }
      
      logger.info('Statistics retrieved successfully', { device_id, hours });
      res.json(row);
    });
  } catch (error) {
    logger.error('Unexpected error in getStats', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
};

// Add to your existing readingsController
exports.storeDeviceData = async (req, res) => {
  try {
    const { device_id, air_quality, fan_state, auto_mode } = req.body;
    const deviceId = device_id || 'esp32_air_purifier_01';
    
    await db.storeDeviceStatus(deviceId, air_quality, fan_state, auto_mode, req.ip);
    
    // Check for pending commands
    const pendingCommands = await db.getPendingCommands(deviceId);
    
    res.json({ 
      success: true, 
      message: 'Data stored successfully',
      pending_commands: pendingCommands.length
    });
  } catch (error) {
    logger.error('Error storing device data:', error);
    res.status(500).json({ error: 'Failed to store device data' });
  }
};

exports.getLatestData = async (req, res) => {
  try {
    const deviceId = req.query.device_id || 'esp32_air_purifier_01';
    const status = await db.getLatestStatus(deviceId);
    const online = await db.isDeviceOnline(deviceId);
    
    if (status) {
      res.json({
        status: online ? 'online' : 'offline',
        data: {
          air_quality: status.air_quality,
          fan_state: status.fan_state,
          auto_mode: status.auto_mode,
          timestamp: status.last_seen
        },
        last_updated: status.last_seen
      });
    } else {
      res.json({
        status: 'offline',
        message: 'No data available',
        last_updated: null
      });
    }
  } catch (error) {
    logger.error('Error getting latest data:', error);
    res.status(500).json({ error: 'Failed to get latest data' });
  }
};

exports.getHistoricalData = async (req, res) => {
  try {
    const deviceId = req.query.device_id || 'esp32_air_purifier_01';
    const hours = parseInt(req.query.hours) || 24;
    const limit = parseInt(req.query.limit) || 1000;
    
    const data = await db.getHistoricalData(deviceId, hours, limit);
    
    res.json(data);
  } catch (error) {
    logger.error('Error getting historical data:', error);
    res.status(500).json({ error: 'Failed to get historical data' });
  }
};