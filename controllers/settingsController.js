const db = require('../config/database');
const logger = require('../utils/logger');

exports.getSettings = async (req, res) => {
  try {
    const sql = `
      SELECT s.*, d.name as device_name, d.location 
      FROM settings s 
      LEFT JOIN devices d ON s.device_id = d.device_id
    `;
    
    db.db.all(sql, (err, rows) => {
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
    const settings = await db.getDeviceSettings(deviceId);
    
    res.json(settings);
  } catch (error) {
    logger.error('Error getting device settings:', error);
    res.status(500).json({ error: 'Failed to get device settings' });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { threshold } = req.body;
    
    const changes = await db.updateDeviceSettings(deviceId, { threshold });
    
    if (changes === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    res.json({ message: 'Settings updated successfully' });
  } catch (error) {
    logger.error('Error updating settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
};