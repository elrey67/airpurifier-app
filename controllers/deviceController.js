const db = require('../config/database');
const logger = require('../utils/logger');

exports.getDeviceStatus = async (req, res) => {
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
    logger.error('Error getting device status:', error);
    res.status(500).json({ error: 'Failed to get device status' });
  }
};

exports.getDevices = async (req, res) => {
  try {
    const sql = `
      SELECT d.*, cs.air_quality, cs.fan_state, cs.auto_mode, cs.online, cs.last_seen 
      FROM devices d 
      LEFT JOIN current_status cs ON d.device_id = cs.device_id
    `;
    
    db.db.all(sql, (err, rows) => {
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
      SELECT d.*, cs.air_quality, cs.fan_state, cs.auto_mode, cs.online, cs.last_seen 
      FROM devices d 
      LEFT JOIN current_status cs ON d.device_id = cs.device_id
      WHERE d.device_id = ?
    `;
    
    db.db.get(sql, [deviceId], (err, row) => {
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
    
    db.db.run(
      'INSERT INTO devices (device_id, name, location) VALUES (?, ?, ?)',
      [device_id, name, location],
      function(err) {
        if (err) {
          logger.error('Error creating device:', err);
          return res.status(500).json({ error: 'Failed to create device' });
        }
        
        // Create default settings for the device
        db.db.run(
          'INSERT INTO settings (device_id, threshold) VALUES (?, ?)',
          [device_id, 300],
          function(err) {
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
    
    db.db.run(
      'UPDATE devices SET name = ?, location = ? WHERE device_id = ?',
      [name, location, deviceId],
      function(err) {
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
    
    db.db.run(
      'DELETE FROM devices WHERE device_id = ?',
      [deviceId],
      function(err) {
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
    
    const commandId = await db.addCommandToQueue(deviceId, command, value);
    
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
    const commands = await db.getPendingCommands(deviceId);
    
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
    
    const changes = await db.updateCommandStatus(commandId, status);
    
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
      db.getLatestStatus(deviceId),
      db.isDeviceOnline(deviceId),
      db.getDeviceSettings(deviceId)
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