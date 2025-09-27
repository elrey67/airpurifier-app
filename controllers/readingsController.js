const database = require('../config/database'); // FIXED IMPORT
const { validationResult } = require('express-validator');
const logger = require('../utils/logger');

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
    
    database.db.all(query, params, (err, rows) => { // FIXED: database.db
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

// Add a new reading (FIXED SQL syntax)
exports.addReading = (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('Validation errors in addReading', { errors: errors.array() });
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { device_id, system_mode, input_air_quality, output_air_quality, efficiency, fan_state, auto_mode } = req.body;
    
    logger.info('New dual-sensor reading received', { 
      device_id, 
      system_mode,
      input_air_quality, 
      output_air_quality, 
      efficiency, 
      fan_state, 
      auto_mode 
    });
    
    // FIXED SQL SYNTAX - removed extra comma and added system_mode
    const query = `INSERT INTO readings 
                  (device_id, system_mode, input_air_quality, output_air_quality, efficiency, fan_state, auto_mode) 
                   VALUES (?, ?, ?, ?, ?, ?, ?)`; // 7 parameters
    
    database.db.run(query, [device_id, system_mode, input_air_quality, output_air_quality, efficiency, fan_state, auto_mode], function(err) { // FIXED: database.db and parameters
      if (err) {
        logger.error('Database error in addReading', { error: err.message });
        return res.status(500).json({ error: err.message });
      }
      
      logger.info('Dual sensor reading added successfully', { id: this.lastID });
      res.status(201).json({
        id: this.lastID,
        message: 'Dual sensor reading added successfully'
      });
    });
  } catch (error) {
    logger.error('Unexpected error in addReading', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
};

// Get statistics for a device (UPDATED for dual sensors)
exports.getStats = (req, res) => {
  try {
    const { device_id, hours = 24 } = req.query;
    
    if (!device_id) {
      logger.warn('Missing device_id in getStats request');
      return res.status(400).json({ error: 'Device ID is required' });
    }
    
    const query = `
      SELECT 
        AVG(input_air_quality) as avg_input_quality,
        AVG(output_air_quality) as avg_output_quality,
        AVG(efficiency) as avg_efficiency,
        MIN(input_air_quality) as min_input_quality,
        MAX(input_air_quality) as max_input_quality,
        COUNT(*) as reading_count,
        SUM(fan_state) as fan_on_count,
        SUM(CASE WHEN system_mode = 'online' THEN 1 ELSE 0 END) as online_count
      FROM readings 
      WHERE device_id = ? AND timestamp >= datetime('now', ?)
    `;
    
    database.db.get(query, [device_id, `-${hours} hours`], (err, row) => { // FIXED: database.db
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

// Store device data from ESP32 (FIXED function call)
exports.storeDeviceData = async (req, res) => {
  try {
    const { device_id, system_mode, input_air_quality, output_air_quality, efficiency, fan_state, auto_mode } = req.body;
    const deviceId = device_id || 'esp32_air_purifier_01';
    
    console.log('📥 Storing device data:', {
      device_id: deviceId,
      system_mode,
      input_air_quality,
      output_air_quality,
      efficiency,
      fan_state,
      auto_mode
    });
    
    // FIXED: Use database.storeDeviceStatus (not db.storeDeviceStatus)
    await database.storeDeviceStatus(
      deviceId, 
      system_mode,
      parseFloat(input_air_quality) || 0,
      parseFloat(output_air_quality) || 0,
      parseFloat(efficiency) || 0,
      fan_state === true || fan_state === 'true',
      auto_mode === true || auto_mode === 'true',
      req.ip
    );
    
    // Check for pending commands
    const pendingCommands = await database.getPendingCommands(deviceId); // FIXED: database.getPendingCommands
    
    res.json({ 
      success: true, 
      message: 'Data stored successfully',
      pending_commands: pendingCommands.length,
      commands: pendingCommands
    });
  } catch (error) {
    logger.error('Error storing device data:', error);
    res.status(500).json({ error: 'Failed to store device data' });
  }
};

// ESP32-specific endpoint (FIXED function call)
exports.storeESP32Reading = async (req, res) => {
  try {
    const { 
      device_id, 
      system_mode, 
      input_air_quality, 
      output_air_quality, 
      efficiency, 
      fan_state, 
      auto_mode 
    } = req.body;

    const deviceId = device_id || 'esp32_air_purifier_01';

    console.log('📥 Received ESP32 reading:', {
      device_id: deviceId,
      system_mode,
      input_air_quality,
      output_air_quality,
      efficiency,
      fan_state,
      auto_mode
    });

    // FIXED: Use database.storeDeviceStatus
    await database.storeDeviceStatus(
      deviceId, 
      system_mode,
      parseFloat(input_air_quality),
      parseFloat(output_air_quality),
      parseFloat(efficiency),
      fan_state === true || fan_state === 'true',
      auto_mode === true || auto_mode === 'true'
    );

    // Check for pending commands
    const pendingCommands = await database.getPendingCommands(deviceId); // FIXED: database.getPendingCommands

    res.status(201).json({ 
      success: true, 
      message: 'Reading stored successfully',
      pending_commands: pendingCommands.length,
      commands: pendingCommands
    });

  } catch (error) {
    console.error('💥 Error storing ESP32 reading:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to store reading' 
    });
  }
};

// Get latest data (UPDATED for dual sensors)
exports.getLatestData = async (req, res) => {
  try {
    const deviceId = req.query.device_id || 'esp32_air_purifier_01';
    const status = await database.getLatestStatus(deviceId); // FIXED: database.getLatestStatus
    const online = await database.isDeviceOnline(deviceId); // FIXED: database.isDeviceOnline
    
    if (status) {
      res.json({
        status: status.system_mode || (online ? 'online' : 'offline'),
        data: {
          system_mode: status.system_mode,
          input_air_quality: status.input_air_quality,
          output_air_quality: status.output_air_quality,
          efficiency: status.efficiency,
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

// Get historical data
exports.getHistoricalData = async (req, res) => {
  try {
    const deviceId = req.query.device_id || 'esp32_air_purifier_01';
    const hours = parseInt(req.query.hours) || 24;
    const limit = parseInt(req.query.limit) || 1000;
    
    const data = await database.getHistoricalData(deviceId, hours, limit); // FIXED: database.getHistoricalData
    
    res.json(data);
  } catch (error) {
    logger.error('Error getting historical data:', error);
    res.status(500).json({ error: 'Failed to get historical data' });
  }
};