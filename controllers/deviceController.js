const database = require('../config/database');
const logger = require('../utils/logger');

// Use the database methods correctly
exports.getDeviceStatus = async (req, res) => {
  try {
    const deviceId = req.query.device_id || 'esp32_air_purifier_01';
    
    const status = await database.getLatestStatus(deviceId);

    if (status) {
      res.json({
        system_mode: status.system_mode || 'offline', // Use stored system_mode
        input_air_quality: status.input_air_quality || 0,
        output_air_quality: status.output_air_quality || 0,
        efficiency: status.efficiency || 0,
        fan: status.fan_state === 1 || status.fan_state === true,
        auto_mode: status.auto_mode === 1 ? "ON" : "OFF",
        threshold: status.threshold || 300,
        last_updated: status.last_seen || new Date().toISOString()
      });
    } else {
      res.json({
        system_mode: 'offline',
        input_air_quality: 0,
        output_air_quality: 0,
        efficiency: 0,
        fan: false,
        auto_mode: "OFF",
        threshold: 300,
        last_updated: null
      });
    }
  } catch (error) {
    logger.error('Error getting device status:', error);
    res.status(500).json({ error: 'Failed to get device status' });
  }
};

exports.getDeviceData = async (req, res) => {
  try {
    const deviceId = req.query.device_id || 'esp32_air_purifier_01';
    
    console.log('🔍 Fetching device data for:', deviceId);

    const status = await database.getLatestStatus(deviceId);
    
    if (status) {
      console.log('📊 Found device status:', status);
      
      // Use the system_mode from the database, not calculated online status
      const response = {
        system_mode: status.system_mode || 'offline',
        input_air_quality: parseFloat(status.input_air_quality) || 0,
        output_air_quality: parseFloat(status.output_air_quality) || 0,
        efficiency: parseFloat(status.efficiency) || 0,
        fan: status.fan_state === 1 ? 1 : 0, // Match ESP32 format (number)
        auto_mode: status.auto_mode === 1 ? "ON" : "OFF",
        threshold: status.threshold || 300,
        backend_url: process.env.APP_URL || "https://172.20.10.2:3000",
        timestamp: status.last_seen || new Date().toISOString()
      };
      
      console.log('✅ Sending response:', response);
      res.json(response);
    } else {
      console.log('❌ No device status found, returning offline mode');
      // Return offline mode (same as ESP32 when offline)
      res.json({
        system_mode: 'offline',
        input_air_quality: 0,
        output_air_quality: 0,
        efficiency: 0,
        fan: 0,
        auto_mode: "OFF",
        threshold: 300,
        backend_url: process.env.APP_URL || "https://172.20.10.2:3000",
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('💥 Error in getDeviceData:', error);
    res.status(500).json({
      system_mode: 'error',
      error: 'Failed to get device data'
    });
  }
};

// Add this function to deviceController.js
exports.storeReading = async (req, res) => {
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

    console.log('📥 Received reading from ESP32:', {
      device_id: deviceId,
      system_mode,
      input_air_quality,
      output_air_quality,
      efficiency,
      fan_state,
      auto_mode
    });

    // Store the reading in database
    await database.storeDeviceStatus(
      deviceId, 
      system_mode, 
      parseFloat(input_air_quality),
      parseFloat(output_air_quality),
      parseFloat(efficiency),
      fan_state === true || fan_state === 'true',
      auto_mode === true || auto_mode === 'true'
    );

    res.status(201).json({ 
      success: true, 
      message: 'Reading stored successfully' 
    });

  } catch (error) {
    console.error('💥 Error storing reading:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to store reading' 
    });
  }
};

// Add this to deviceController.js for testing
exports.testDatabase = async (req, res) => {
  try {
    // Test query to check readings table structure
    database.db.all('PRAGMA table_info(readings)', (err, rows) => {
      if (err) {
        console.error('Error reading table info:', err);
        return res.status(500).json({ error: err.message });
      }
      
      console.log('📊 Readings table columns:');
      rows.forEach(col => {
        console.log(`- ${col.name} (${col.type})`);
      });

      // Show recent readings
      database.db.all('SELECT * FROM readings ORDER BY timestamp DESC LIMIT 5', (err, readings) => {
        if (err) {
          console.error('Error fetching readings:', err);
          return res.status(500).json({ error: err.message });
        }

        res.json({
          table_structure: rows,
          recent_readings: readings
        });
      });
    });
  } catch (error) {
    console.error('Test error:', error);
    res.status(500).json({ error: error.message });
  }
};


exports.getDevices = async (req, res) => {
  try {
    const sql = `
      SELECT d.*, cs.input_air_quality, cs.output_air_quality, cs.fan_state, cs.auto_mode, cs.online, cs.last_seen 
      FROM devices d 
      LEFT JOIN current_status cs ON d.device_id = cs.device_id
    `;

    // Use database.db instead of db.db
    database.db.all(sql, (err, rows) => {
      if (err) {
        logger.error('Error fetching devices:', err);
        return res.status(500).json({ error: 'Failed to fetch devices' });
      }
      res.json(rows);
    });
  } catch (error) {
    logger.error('Error getting devices:', error);
    res.status(500).json({ error: 'Failed to get devices' });
  }
};

exports.getDevice = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const sql = `
      SELECT d.*, cs.input_air_quality, cs.output_air_quality, cs.fan_state, cs.auto_mode, cs.online, cs.last_seen 
      FROM devices d 
      LEFT JOIN current_status cs ON d.device_id = cs.device_id
      WHERE d.device_id = ?
    `;

    database.db.get(sql, [deviceId], (err, row) => {
      if (err) {
        logger.error('Error fetching device:', err);
        return res.status(500).json({ error: 'Failed to fetch device' });
      }

      if (!row) {
        return res.status(404).json({ error: 'Device not found' });
      }

      res.json(row);
    });
  } catch (error) {
    logger.error('Error getting device:', error);
    res.status(500).json({ error: 'Failed to get device' });
  }
};

exports.createDevice = async (req, res) => {
  try {
    const { device_id, name, location } = req.body;

    database.db.run(
      'INSERT INTO devices (device_id, name, location) VALUES (?, ?, ?)',
      [device_id, name, location],
      function (err) {
        if (err) {
          logger.error('Error creating device:', err);
          return res.status(500).json({ error: 'Failed to create device' });
        }

        // Create default settings for the device
        database.db.run(
          'INSERT INTO settings (device_id, threshold) VALUES (?, ?)',
          [device_id, 300],
          function (err) {
            if (err) {
              logger.error('Error creating default settings:', err);
            }
          }
        );

        res.status(201).json({
          message: 'Device created successfully',
          deviceId: device_id
        });
      }
    );
  } catch (error) {
    logger.error('Error creating device:', error);
    res.status(500).json({ error: 'Failed to create device' });
  }
};

exports.updateDevice = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { name, location } = req.body;

    database.db.run(
      'UPDATE devices SET name = ?, location = ? WHERE device_id = ?',
      [name, location, deviceId],
      function (err) {
        if (err) {
          logger.error('Error updating device:', err);
          return res.status(500).json({ error: 'Failed to update device' });
        }

        if (this.changes === 0) {
          return res.status(404).json({ error: 'Device not found' });
        }

        res.json({ message: 'Device updated successfully' });
      }
    );
  } catch (error) {
    logger.error('Error updating device:', error);
    res.status(500).json({ error: 'Failed to update device' });
  }
};

exports.deleteDevice = async (req, res) => {
  try {
    const { deviceId } = req.params;

    database.db.run(
      'DELETE FROM devices WHERE device_id = ?',
      [deviceId],
      function (err) {
        if (err) {
          logger.error('Error deleting device:', err);
          return res.status(500).json({ error: 'Failed to delete device' });
        }

        if (this.changes === 0) {
          return res.status(404).json({ error: 'Device not found' });
        }

        res.json({ message: 'Device deleted successfully' });
      }
    );
  } catch (error) {
    logger.error('Error deleting device:', error);
    res.status(500).json({ error: 'Failed to delete device' });
  }
};

exports.sendCommand = async (req, res) => {
  try {
    const { device_id, command, value } = req.body;
    const deviceId = device_id || 'esp32_air_purifier_01';

    // Use database.addCommandToQueue instead of db.addCommandToQueue
    const commandId = await database.addCommandToQueue(deviceId, command, value);

    res.json({
      success: true,
      message: 'Command queued for device',
      commandId
    });
  } catch (error) {
    logger.error('Error sending command:', error);
    res.status(500).json({ error: 'Failed to send command' });
  }
};

exports.getPendingCommands = async (req, res) => {
  try {
    const deviceId = req.query.device_id || 'esp32_air_purifier_01';
    
    // Use database.getPendingCommands instead of db.getPendingCommands
    const commands = await database.getPendingCommands(deviceId);

    res.json(commands);
  } catch (error) {
    logger.error('Error getting pending commands:', error);
    res.status(500).json({ error: 'Failed to get pending commands' });
  }
};

exports.updateCommandStatus = async (req, res) => {
  try {
    const { commandId } = req.params;
    const { status } = req.body;

    if (!['pending', 'processing', 'completed', 'failed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Use database.updateCommandStatus instead of db.updateCommandStatus
    const changes = await database.updateCommandStatus(commandId, status);

    if (changes === 0) {
      return res.status(404).json({ error: 'Command not found' });
    }

    res.json({ message: 'Command status updated successfully' });
  } catch (error) {
    logger.error('Error updating command status:', error);
    res.status(500).json({ error: 'Failed to update command status' });
  }
};

exports.getSystemStatus = async (req, res) => {
  try {
    const deviceId = 'esp32_air_purifier_01';
    const [status, online, settings] = await Promise.all([
      database.getLatestStatus(deviceId),
      database.isDeviceOnline(deviceId),
      database.getDeviceSettings(deviceId)
    ]);

    res.json({
      device_online: online,
      current_status: status,
      settings: settings,
      server_time: new Date().toISOString(),
      uptime: process.uptime()
    });
  } catch (error) {
    logger.error('Error getting system status:', error);
    res.status(500).json({ error: 'Failed to get system status' });
  }
};