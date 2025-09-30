const database = require('../config/database'); // Use the same import pattern
const logger = require('../utils/logger');

exports.getSettings = async (req, res) => {
  try {
    const sql = `
      SELECT s.*, d.name as device_name, d.location 
      FROM settings s 
      LEFT JOIN devices d ON s.device_id = d.device_id
    `;
    
    // Use database.db.all like in readingsController.js
    database.db.all(sql, (err, rows) => {
      if (err) {
        logger.error('Error fetching settings:', err);
        return res.status(500).json({ error: 'Failed to fetch settings' });
      }
      res.json(rows);
    });
  } catch (error) {
    logger.error('Error getting settings:', error);
    res.status(500).json({ error: 'Failed to get settings' });
  }
};

exports.getDeviceSettings = async (req, res) => {
  try {
    const { deviceId } = req.params;
    
    // Use direct database query like in readingsController.js
    const query = 'SELECT * FROM settings WHERE device_id = ?';
    database.db.get(query, [deviceId], (err, settings) => {
      if (err) {
        logger.error('Error getting device settings:', err);
        return res.status(500).json({ error: 'Failed to get device settings' });
      }
      
      if (!settings) {
        // Return default settings if device not found
        return res.json({
          device_id: deviceId,
          threshold: 300, // Default value
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      }
      
      res.json(settings);
    });
    
  } catch (error) {
    logger.error('Error getting device settings:', error);
    res.status(500).json({ error: 'Failed to get device settings' });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { threshold } = req.body;
    
    console.log('Updating settings for device:', { deviceId, threshold });
    
    // Use direct SQL query like in readingsController.js
    const query = `
      INSERT OR REPLACE INTO settings (device_id, threshold, updated_at) 
      VALUES (?, ?, datetime('now'))
    `;
    
    database.db.run(query, [deviceId, threshold], function(err) {
      if (err) {
        logger.error('Database error updating settings:', err);
        return res.status(500).json({ error: 'Failed to update settings' });
      }
      
      logger.info('Settings updated successfully', { 
        deviceId, 
        threshold, 
        changes: this.changes 
      });
      
      res.json({ 
        message: 'Settings updated successfully',
        changes: this.changes
      });
    });
    
  } catch (error) {
    logger.error('Error updating settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
};