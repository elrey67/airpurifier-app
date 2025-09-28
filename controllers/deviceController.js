const database = require('../config/database');
const logger = require('../utils/logger');

// Constants for offline detection (in milliseconds)
const OFFLINE_THRESHOLD = 30000; // 30 seconds
const MONITORING_INTERVAL = 10000; // Check every 10 seconds

// Store the last actual data reception time
let lastDataReceptionTime = null;

// Helper function to check if device is offline based on LAST DATA RECEPTION
const isDeviceOffline = () => {
    if (!lastDataReceptionTime) return true;
    
    const currentTime = new Date().getTime();
    const timeDiff = currentTime - lastDataReceptionTime;
    
    console.log(`📊 Data Reception Check: Last data at ${new Date(lastDataReceptionTime).toISOString()} vs Now: ${new Date(currentTime).toISOString()}`);
    console.log(`⏱️  Difference: ${timeDiff}ms (${Math.round(timeDiff/1000)}s) vs Threshold: ${OFFLINE_THRESHOLD}ms`);
    
    return timeDiff > OFFLINE_THRESHOLD;
};

// Function to update ONLY connection status in database (DON'T touch system_mode)
const updateDeviceStatus = async (deviceId, isOnline) => {
    try {
        // ONLY update the online status, NEVER update system_mode here
        return new Promise((resolve, reject) => {
            database.db.run(
                'UPDATE current_status SET online = ? WHERE device_id = ?',
                [isOnline ? 1 : 0, deviceId],
                function(err) {
                    if (err) {
                        console.error('❌ Error updating device online status:', err);
                        reject(err);
                    } else {
                        console.log(`✅ Updated ${deviceId} online status to: ${isOnline ? 'ONLINE' : 'OFFLINE'}`);
                        resolve(this.changes);
                    }
                }
            );
        });
    } catch (error) {
        console.error(`💥 Error updating device status for ${deviceId}:`, error);
    }
};

// Function to record actual data reception (when ESP32 POSTS data)
const recordDataReception = () => {
    lastDataReceptionTime = new Date().getTime();
    console.log(`📥 Data reception recorded at: ${new Date(lastDataReceptionTime).toISOString()}`);
};

// Main function to check connection status and UPDATE DATABASE
exports.checkAndUpdateDeviceStatus = async (deviceId = 'esp32_air_purifier_01') => {
    try {
        // Check based on actual data reception time
        const offline = isDeviceOffline();
        
        // Update database with correct status (ONLY online field)
        await updateDeviceStatus(deviceId, !offline);
        
        return !offline; // Return connection status (true = online, false = offline)
        
    } catch (error) {
        logger.error(`Error checking device connection status for ${deviceId}:`, error);
        return false;
    }
};

// Enhanced storeReading - records ACTUAL data reception and updates database
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

        console.log('📥 Received ACTUAL data from ESP32:', {
            device_id: deviceId,
            system_mode,
            input_air_quality,
            output_air_quality,
            efficiency,
            fan_state,
            auto_mode
        });

        // RECORD ACTUAL DATA RECEPTION
        recordDataReception();

        // Store the reading in database with the ESP32's actual system_mode
        await database.storeDeviceStatus(
            deviceId, 
            system_mode, // Keep whatever ESP32 sends
            parseFloat(input_air_quality),
            parseFloat(output_air_quality),
            parseFloat(efficiency),
            fan_state === true || fan_state === 'true',
            auto_mode === true || auto_mode === 'true'
        );

        // Update device as online (ONLY online status, not system_mode)
        await updateDeviceStatus(deviceId, true);

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

// Updated getDeviceStatus for WEB interface - checks and updates status
exports.getDeviceStatus = async (req, res) => {
    try {
        const deviceId = req.query.device_id || 'esp32_air_purifier_01';
        
        console.log(`\n🌐 Web interface requesting status for: ${deviceId}`);
        
        // Check and update connection status
        const isOnline = await exports.checkAndUpdateDeviceStatus(deviceId);
        
        // Get the UPDATED device status from database
        const status = await database.getLatestStatus(deviceId);

        if (status) {
            // Determine the actual status based on both system_mode and online status
            let actualSystemMode = status.system_mode || 'offline';
            
            // If backend says device is offline, override system_mode
            if (!isOnline) {
                actualSystemMode = 'offline';
                console.log(`🔴 Overriding system_mode to 'offline' because backend detects device is offline`);
            }
            
            const response = {
                status: isOnline ? 'online' : 'offline', // Main status field
                system_mode: actualSystemMode,
                input_air_quality: status.input_air_quality || 0,
                output_air_quality: status.output_air_quality || 0,
                efficiency: status.efficiency || 0,
                fan_state: status.fan_state === 1 || status.fan_state === true,
                auto_mode: status.auto_mode === 1 ? "ON" : "OFF",
                threshold: status.threshold || 300,
                last_updated: status.last_seen || new Date().toISOString(),
                is_online: isOnline,
                connection_status: isOnline ? 'online' : 'offline',
                last_data_reception: lastDataReceptionTime ? new Date(lastDataReceptionTime).toISOString() : null
            };
            
            console.log('✅ Sending response to web interface:', {
                status: response.status,
                system_mode: response.system_mode,
                is_online: response.is_online,
                last_updated: response.last_updated
            });
            
            res.json(response);
        } else {
            res.json({
                status: 'offline',
                system_mode: 'offline',
                input_air_quality: 0,
                output_air_quality: 0,
                efficiency: 0,
                fan_state: false,
                auto_mode: "OFF",
                threshold: 300,
                last_updated: null,
                is_online: false,
                connection_status: 'offline',
                last_data_reception: null
            });
        }
    } catch (error) {
        logger.error('Error getting device status:', error);
        res.status(500).json({ error: 'Failed to get device status' });
    }
};

// Updated getDeviceData for ESP32 - checks status and returns UPDATED data
exports.getDeviceData = async (req, res) => {
    try {
        const deviceId = req.query.device_id || 'esp32_air_purifier_01';
        
        console.log(`\n📱 ESP32 querying data: ${deviceId}`);

        // Check and update device status FIRST
        const isOnline = await exports.checkAndUpdateDeviceStatus(deviceId);
        
        // Get the UPDATED device status from database
        const status = await database.getLatestStatus(deviceId);
        
        if (status) {
            // Determine system_mode for ESP32 - if backend says offline, send 'offline'
            let systemModeForESP32 = status.system_mode || 'offline';
            if (!isOnline) {
                systemModeForESP32 = 'offline';
            }
            
            const response = {
                system_mode: systemModeForESP32,
                input_air_quality: parseFloat(status.input_air_quality) || 0,
                output_air_quality: parseFloat(status.output_air_quality) || 0,
                efficiency: parseFloat(status.efficiency) || 0,
                fan: status.fan_state === 1 ? 1 : 0,
                auto_mode: status.auto_mode === 1 ? "ON" : "OFF",
                threshold: status.threshold || 300,
                backend_url: process.env.APP_URL || "https://172.20.10.2:3000",
                timestamp: status.last_seen || new Date().toISOString(),
                is_online: isOnline // Also send connection status to ESP32
            };
            
            console.log('✅ Sending UPDATED data to ESP32:', {
                system_mode: response.system_mode,
                is_online: response.is_online,
                timestamp: response.timestamp
            });
            
            res.json(response);
        } else {
            console.log('❌ No device status found for ESP32');
            res.json({
                system_mode: 'offline',
                input_air_quality: 0,
                output_air_quality: 0,
                efficiency: 0,
                fan: 0,
                auto_mode: "OFF",
                threshold: 300,
                backend_url: process.env.APP_URL || "https://172.20.10.2:3000",
                timestamp: new Date().toISOString(),
                is_online: false
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

// Background monitoring service - updates database when device goes offline
exports.startDeviceMonitoring = () => {
    console.log('🚀 Starting device monitoring service with DATABASE UPDATES');
    
    // Initialize with current time if server restarts
    if (!lastDataReceptionTime) {
        // Try to get the last timestamp from database
        database.db.get(
            'SELECT last_seen FROM current_status WHERE device_id = ? ORDER BY last_seen DESC LIMIT 1',
            ['esp32_air_purifier_01'],
            (err, row) => {
                if (err || !row || !row.last_seen) {
                    lastDataReceptionTime = new Date().getTime();
                    console.log('⏰ Initialized with current time');
                } else {
                    lastDataReceptionTime = new Date(row.last_seen).getTime();
                    console.log(`⏰ Initialized with database time: ${new Date(lastDataReceptionTime).toISOString()}`);
                }
            }
        );
    }
    
    setInterval(async () => {
        try {
            const deviceId = 'esp32_air_purifier_01';
            const isOnline = await exports.checkAndUpdateDeviceStatus(deviceId);
            
            if (!isOnline) {
                console.log(`🚨 Device ${deviceId} is OFFLINE - database updated accordingly`);
            } else {
                console.log(`✅ Device ${deviceId} is ONLINE`);
            }
        } catch (error) {
            console.error('Error in device monitoring:', error);
        }
    }, MONITORING_INTERVAL);
    
    logger.info('Device monitoring service started (with database updates)');
};

// Manual function to simulate device going offline (for testing)
exports.forceOffline = async (req, res) => {
    try {
        const deviceId = req.query.device_id || 'esp32_air_purifier_01';
        
        // Set last data reception to be older than threshold
        lastDataReceptionTime = new Date().getTime() - OFFLINE_THRESHOLD - 10000;
        
        await updateDeviceStatus(deviceId, false);
        
        res.json({ 
            message: 'Device forced offline successfully',
            last_data_reception: new Date(lastDataReceptionTime).toISOString(),
            note: 'Database has been updated to reflect offline status'
        });
    } catch (error) {
        console.error('Error forcing offline:', error);
        res.status(500).json({ error: 'Failed to force offline' });
    }
};

// Manual function to simulate device coming online (for testing)
exports.forceOnline = async (req, res) => {
    try {
        const deviceId = req.query.device_id || 'esp32_air_purifier_01';
        
        // Set last data reception to current time
        recordDataReception();
        
        await updateDeviceStatus(deviceId, true);
        
        res.json({ 
            message: 'Device forced online successfully',
            last_data_reception: new Date(lastDataReceptionTime).toISOString(),
            note: 'Database has been updated to reflect online status'
        });
    } catch (error) {
        console.error('Error forcing online:', error);
        res.status(500).json({ error: 'Failed to force online' });
    }
};

// Test function to see current status
exports.checkCurrentStatus = async (req, res) => {
    try {
        const deviceId = req.query.device_id || 'esp32_air_purifier_01';
        
        const currentTime = new Date().getTime();
        const timeDiff = lastDataReceptionTime ? currentTime - lastDataReceptionTime : null;
        
        // Get current database status
        const status = await database.getLatestStatus(deviceId);
        
        res.json({
            device_id: deviceId,
            last_data_reception: lastDataReceptionTime ? new Date(lastDataReceptionTime).toISOString() : null,
            current_time: new Date(currentTime).toISOString(),
            time_since_last_data_ms: timeDiff,
            time_since_last_data_seconds: timeDiff ? Math.round(timeDiff / 1000) : null,
            offline_threshold_ms: OFFLINE_THRESHOLD,
            should_be_offline: timeDiff ? timeDiff > OFFLINE_THRESHOLD : true,
            database_system_mode: status ? status.system_mode : 'unknown',
            database_online_status: status ? status.online : 'unknown',
            note: 'Database is updated when device goes offline/online'
        });
    } catch (error) {
        console.error('Error checking current status:', error);
        res.status(500).json({ error: error.message });
    }
};

// KEEP ALL YOUR EXISTING FUNCTIONS BELOW
exports.testDatabase = async (req, res) => {
    try {
        database.db.all('PRAGMA table_info(readings)', (err, rows) => {
            if (err) {
                console.error('Error reading table info:', err);
                return res.status(500).json({ error: err.message });
            }
            
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
            exports.checkAndUpdateDeviceStatus(deviceId),
            database.getDeviceSettings(deviceId)
        ]);

        res.json({
            device_online: online,
            current_status: status,
            settings: settings,
            server_time: new Date().toISOString(),
            uptime: process.uptime(),
            last_data_reception: lastDataReceptionTime ? new Date(lastDataReceptionTime).toISOString() : null
        });
    } catch (error) {
        logger.error('Error getting system status:', error);
        res.status(500).json({ error: 'Failed to get system status' });
    }
};

// Simple device registration - user provides all details
exports.registerDevice = async (req, res) => {
  try {
    const { name, location, username, password } = req.body;
    const userId = req.userId;

    // Basic validation
    if (!name || !location || !username || !password) {
      return res.status(400).json({ 
        error: 'Device name, location, username, and password are required' 
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ 
        error: 'Password must be at least 6 characters long' 
      });
    }

    // Generate unique device ID
    const deviceId = 'esp32_' + Math.random().toString(36).substring(2, 8) + '_' + Date.now().toString(36);

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Start database transaction
    database.db.serialize(() => {
      // 1. Check if username already exists
      database.db.get(
        'SELECT id FROM users WHERE username = ?',
        [username],
        (err, existingUser) => {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }
          
          if (existingUser) {
            return res.status(400).json({ error: 'Username already exists' });
          }

          // 2. Create user account for the device
          database.db.run(
            'INSERT INTO users (username, password, is_admin) VALUES (?, ?, ?)',
            [username, hashedPassword, false],
            function(err) {
              if (err) {
                return res.status(500).json({ error: 'Failed to create device user' });
              }
              
              const deviceUserId = this.lastID;
              
              // 3. Create device record
              database.db.run(
                'INSERT INTO devices (device_id, name, location, user_id) VALUES (?, ?, ?, ?)',
                [deviceId, name, location, userId],
                function(err) {
                  if (err) {
                    return res.status(500).json({ error: 'Failed to create device' });
                  }
                  
                  // 4. Create default settings
                  database.db.run(
                    'INSERT INTO settings (device_id, threshold) VALUES (?, ?)',
                    [deviceId, 300]
                  );
                  
                  // 5. Create initial status
                  database.db.run(
                    `INSERT INTO current_status 
                     (device_id, input_air_quality, output_air_quality, efficiency, fan_state, auto_mode, online, last_seen) 
                     VALUES (?, 0, 0, 0, FALSE, TRUE, FALSE, datetime('now'))`,
                    [deviceId]
                  );
                  
                  // Return success
                  res.status(201).json({
                    success: true,
                    message: 'Device registered successfully',
                    device: {
                      device_id: deviceId,
                      name: name,
                      location: location,
                      username: username,
                      created_at: new Date().toISOString()
                    }
                  });
                }
              );
            }
          );
        }
      );
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to register device' });
  }
};

// Get user's devices
exports.getUserDevices = (req, res) => {
  try {
    const userId = req.userId;

    const sql = `
      SELECT d.*, cs.online, cs.system_mode, cs.last_seen, u.username as device_username
      FROM devices d 
      LEFT JOIN current_status cs ON d.device_id = cs.device_id
      LEFT JOIN users u ON d.user_id = u.id
      WHERE d.user_id = ? 
      ORDER BY d.created_at DESC
    `;

    database.db.all(sql, [userId], (err, devices) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch devices' });
      }

      res.json({
        success: true,
        devices: devices.map(device => ({
          device_id: device.device_id,
          name: device.name,
          location: device.location,
          online: device.online === 1,
          system_mode: device.system_mode,
          last_seen: device.last_seen,
          created_at: device.created_at,
          device_username: device.device_username
        }))
      });
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to get devices' });
  }
};

// Delete device
exports.deleteUserDevice = (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.userId;

    // Verify user owns this device
    database.db.get(
      'SELECT user_id FROM devices WHERE device_id = ?',
      [deviceId],
      (err, device) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        
        if (!device || device.user_id !== userId) {
          return res.status(404).json({ error: 'Device not found' });
        }

        // Delete device and associated data
        database.db.serialize(() => {
          // Delete device's user account
          database.db.run('DELETE FROM users WHERE id = ?', [device.user_id]);
          
          // Delete device record
          database.db.run('DELETE FROM devices WHERE device_id = ?', [deviceId], function(err) {
            if (err) {
              return res.status(500).json({ error: 'Failed to delete device' });
            }

            res.json({
              success: true,
              message: 'Device deleted successfully'
            });
          });
        });
      }
    );

  } catch (error) {
    res.status(500).json({ error: 'Failed to delete device' });
  }
};

module.exports = exports;