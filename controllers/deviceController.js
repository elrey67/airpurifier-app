const database = require('../config/database');
const logger = require('../utils/logger');

// Constants for offline detection (in milliseconds)
const OFFLINE_THRESHOLD = 30000; // 30 seconds
const MONITORING_INTERVAL = 10000; // Check every 10 seconds

// FIXED: Check if device is offline based on database timestamp
const isDeviceOffline = async (deviceId) => {
    try {
        const status = await database.getLatestStatus(deviceId);
        if (!status || !status.last_seen) return true;
        
        const lastSeen = new Date(status.last_seen).getTime();
        const currentTime = new Date().getTime();
        const timeDiff = currentTime - lastSeen;
        
        console.log(`📊 Database Check: Last seen at ${new Date(lastSeen).toISOString()} vs Now: ${new Date(currentTime).toISOString()}`);
        console.log(`⏱️  Difference: ${timeDiff}ms (${Math.round(timeDiff/1000)}s) vs Threshold: ${OFFLINE_THRESHOLD}ms`);
        
        return timeDiff > OFFLINE_THRESHOLD;
    } catch (error) {
        console.error('Error checking device offline status:', error);
        return true;
    }
};

// FIXED: Update device status in database with proper async/await
const updateDeviceStatus = async (deviceId, isOnline) => {
    return new Promise((resolve, reject) => {
        try {
            if (isOnline) {
                // Device is online - update online status and system_mode
                database.db.run(
                    'UPDATE current_status SET online = 1, system_mode = ?, last_seen = datetime("now") WHERE device_id = ?',
                    ['online', deviceId],
                    function(err) {
                        if (err) {
                            console.error('❌ Error updating device to online:', err);
                            reject(err);
                        } else {
                            console.log(`✅ Updated ${deviceId} to ONLINE (changes: ${this.changes})`);
                            resolve(this.changes);
                        }
                    }
                );
            } else {
                // Device is offline - update both online status and system_mode
                database.db.run(
                    'UPDATE current_status SET online = 0, system_mode = ? WHERE device_id = ?',
                    ['offline', deviceId],
                    function(err) {
                        if (err) {
                            console.error('❌ Error updating device to offline:', err);
                            reject(err);
                        } else {
                            console.log(`🔴 Updated ${deviceId} to OFFLINE (changes: ${this.changes})`);
                            resolve(this.changes);
                        }
                    }
                );
            }
        } catch (error) {
            console.error(`💥 Error updating device status for ${deviceId}:`, error);
            reject(error);
        }
    });
};

// FIXED: Store reading from ESP32 - ensure last_seen is always updated
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

        console.log('📥 Received data from ESP32:', {
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

        // FIXED: Wait for the status update to complete
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

// SIMPLE: Get device status - just return database values
exports.getDeviceStatus = async (req, res) => {
    try {
        const deviceId = req.query.device_id || 'esp32_air_purifier_01';
        
        console.log(`🌐 Web interface requesting status for: ${deviceId}`);
        
        // Get the current device status from database
        const status = await database.getLatestStatus(deviceId);

        if (status) {
            const response = {
                status: status.system_mode || 'offline', // Use system_mode directly from database
                system_mode: status.system_mode || 'offline',
                input_air_quality: status.input_air_quality || 0,
                output_air_quality: status.output_air_quality || 0,
                efficiency: status.efficiency || 0,
                fan_state: status.fan_state === 1 || status.fan_state === true,
                auto_mode: status.auto_mode === 1 ? "ON" : "OFF",
                threshold: status.threshold || 300,
                last_updated: status.last_seen || new Date().toISOString(),
                is_online: status.online === 1
            };
            
            console.log('✅ Sending database status to web:', {
                status: response.status,
                system_mode: response.system_mode,
                last_updated: response.last_updated
            });
            
            res.json(response);
        } else {
            // Handle no status found
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
                is_online: false
            });
        }
    } catch (error) {
        logger.error('Error getting device status:', error);
        res.status(500).json({ 
            status: 'error',
            error: 'Failed to get device status' 
        });
    }
};

// SIMPLE: Get device data for ESP32
exports.getDeviceData = async (req, res) => {
    try {
        const deviceId = req.query.device_id || 'esp32_air_purifier_01';
        
        console.log(`📱 ESP32 querying data: ${deviceId}`);

        // Get the current device status from database
        const status = await database.getLatestStatus(deviceId);
        
        if (status) {
            const response = {
                system_mode: status.system_mode || 'offline',
                input_air_quality: parseFloat(status.input_air_quality) || 0,
                output_air_quality: parseFloat(status.output_air_quality) || 0,
                efficiency: parseFloat(status.efficiency) || 0,
                fan: status.fan_state === 1 ? 1 : 0,
                auto_mode: status.auto_mode === 1 ? "ON" : "OFF",
                threshold: status.threshold || 300,
                backend_url: process.env.APP_URL || "https://172.20.10.2:3000",
                timestamp: status.last_seen || new Date().toISOString()
            };
            
            console.log('✅ Sending data to ESP32:', {
                system_mode: response.system_mode,
                timestamp: response.timestamp
            });
            
            res.json(response);
        } else {
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

// FIXED: Background monitoring - ensure updates complete
exports.startDeviceMonitoring = () => {
    console.log('🚀 Starting FIXED device monitoring service');
    
    setInterval(async () => {
        try {
            const deviceId = 'esp32_air_purifier_01';
            const offline = await isDeviceOffline(deviceId);
            
            if (offline) {
                console.log(`🚨 Device ${deviceId} is OFFLINE - updating database`);
                const changes = await updateDeviceStatus(deviceId, false);
                console.log(`📝 Database update completed with ${changes} changes`);
            } else {
                console.log(`✅ Device ${deviceId} is ONLINE`);
            }
        } catch (error) {
            console.error('Error in device monitoring:', error);
        }
    }, MONITORING_INTERVAL);
    
    logger.info('Fixed device monitoring service started');
};

// FIXED: Manual function to simulate device going offline
exports.forceOffline = async (req, res) => {
    try {
        const deviceId = req.query.device_id || 'esp32_air_purifier_01';
        
        // Manually set device to offline in database and wait for completion
        const changes = await updateDeviceStatus(deviceId, false);
        
        res.json({ 
            message: 'Device forced offline successfully',
            changes: changes,
            note: 'Database has been updated to reflect offline status'
        });
    } catch (error) {
        console.error('Error forcing offline:', error);
        res.status(500).json({ error: 'Failed to force offline' });
    }
};

// FIXED: Manual function to simulate device coming online
exports.forceOnline = async (req, res) => {
    try {
        const deviceId = req.query.device_id || 'esp32_air_purifier_01';
        
        // Manually set device to online in database and wait for completion
        const changes = await updateDeviceStatus(deviceId, true);
        
        res.json({ 
            message: 'Device forced online successfully',
            changes: changes,
            note: 'Database has been updated to reflect online status'
        });
    } catch (error) {
        console.error('Error forcing online:', error);
        res.status(500).json({ error: 'Failed to force online' });
    }
};

// FIXED: Enhanced debug function to check current status
exports.checkCurrentStatus = async (req, res) => {
    try {
        const deviceId = req.query.device_id || 'esp32_air_purifier_01';
        
        // Get current database status
        const status = await database.getLatestStatus(deviceId);
        const offline = await isDeviceOffline(deviceId);
        
        // Additional debug: Check database directly
        const dbStatus = await new Promise((resolve, reject) => {
            database.db.get(
                'SELECT online, system_mode, last_seen FROM current_status WHERE device_id = ?',
                [deviceId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
        
        res.json({
            device_id: deviceId,
            database_system_mode: status ? status.system_mode : 'unknown',
            database_online_status: status ? status.online : 'unknown',
            database_last_seen: status ? status.last_seen : null,
            direct_db_online: dbStatus ? dbStatus.online : 'unknown',
            direct_db_system_mode: dbStatus ? dbStatus.system_mode : 'unknown',
            direct_db_last_seen: dbStatus ? dbStatus.last_seen : null,
            should_be_offline: offline,
            current_time: new Date().toISOString(),
            threshold_seconds: OFFLINE_THRESHOLD / 1000,
            note: 'Database is the single source of truth for device status'
        });
    } catch (error) {
        console.error('Error checking current status:', error);
        res.status(500).json({ error: error.message });
    }
};

// Existing functions below (keep them as they are)
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
            'INSERT INTO devices (device_id, name, location, user_id) VALUES (?, ?, ?, ?)',
            [device_id, name, location, 1], 
            function (err){
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
        const [status, settings] = await Promise.all([
            database.getLatestStatus(deviceId),
            database.getDeviceSettings(deviceId)
        ]);

        const offline = await isDeviceOffline(deviceId);

        res.json({
            device_online: !offline,
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

// Updated device registration - accepts frontend field names
exports.registerDevice = async (req, res) => {
  try {
    const { 
      device_id, 
      device_name, 
      location, 
      username, 
      password 
    } = req.body;
    
    const userId = req.userId;

    console.log('🔍 Device registration called by user:', userId);
    console.log('📦 Received data:', {
      device_id,
      device_name, 
      location, 
      username, 
      password: password ? '***REDACTED***' : 'empty'
    });

    // Basic validation - using the frontend field names
    if (!device_name || !location || !username || !password) {
      return res.status(400).json({ 
        error: 'Device name, location, username, and password are required' 
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ 
        error: 'Password must be at least 6 characters long' 
      });
    }

    // Use the device_id from frontend or generate one if not provided
    const finalDeviceId = device_id || 'esp32_' + Math.random().toString(36).substring(2, 8) + '_' + Date.now().toString(36);

    console.log('🎯 Using device ID:', finalDeviceId);

    // Start database transaction
    database.db.serialize(() => {
      // Create device record with device-specific credentials
      database.db.run(
        'INSERT INTO devices (device_id, name, location, user_id, device_username, device_password) VALUES (?, ?, ?, ?, ?, ?)',
        [finalDeviceId, device_name, location, userId, username, password],
        function(err) {
          if (err) {
            console.error('❌ Database error creating device:', err);
            
            // Handle duplicate device_id
            if (err.code === 'SQLITE_CONSTRAINT' || err.message.includes('UNIQUE constraint failed')) {
              return res.status(400).json({ 
                error: 'Device ID already exists. Please choose a different one.' 
              });
            }
            
            return res.status(500).json({ error: 'Failed to create device: ' + err.message });
          }
          
          console.log('✅ Device record created with ID:', finalDeviceId);
          
          // Create default settings
          database.db.run(
            'INSERT INTO settings (device_id, threshold) VALUES (?, ?)',
            [finalDeviceId, 300],
            function(err) {
              if (err) {
                console.error('❌ Error creating default settings:', err);
              } else {
                console.log('✅ Default settings created');
              }
            }
          );
          
          // Create initial status
          database.db.run(
            `INSERT INTO current_status 
             (device_id, system_mode, input_air_quality, output_air_quality, efficiency, fan_state, auto_mode, online, last_seen) 
             VALUES (?, 'offline', 0, 0, 0, FALSE, TRUE, FALSE, datetime('now'))`,
            [finalDeviceId],
            function(err) {
              if (err) {
                console.error('❌ Error creating initial status:', err);
              } else {
                console.log('✅ Initial status created');
              }
            }
          );
          
          // Return success with the same field names frontend expects
          res.status(201).json({
            success: true,
            message: 'Device registered successfully',
            device: {
              device_id: finalDeviceId,
              device_name: device_name,
              name: device_name, // Also include for compatibility
              location: location,
              username: username, // Return device credentials
              password: password, // Return for immediate use
              created_at: new Date().toISOString()
            }
          });
        }
      );
    });

  } catch (error) {
    console.error('💥 Unexpected error in registerDevice:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to register device: ' + error.message 
    });
  }
};

// Get user's devices - UPDATED VERSION
exports.getUserDevices = (req, res) => {
  try {
    console.log('🔍 getUserDevices called');
    console.log('🆔 Request userId:', req.userId);
    
    const userId = req.userId;

    if (!userId) {
      console.error('❌ No userId found in request');
      return res.status(401).json({ 
        success: false,
        error: 'Authentication required' 
      });
    }

    // UPDATED SQL - Get credentials from devices table
    const sql = `
      -- Owned devices
      SELECT 
        d.*, 
        cs.online, 
        cs.system_mode, 
        cs.last_seen,
        'owner' as access_type,
        NULL as shared_by_username
      FROM devices d 
      LEFT JOIN current_status cs ON d.device_id = cs.device_id
      WHERE d.user_id = ?
      
      UNION ALL
      
      -- Shared devices (view-only access)
      SELECT 
        d.*, 
        cs.online, 
        cs.system_mode, 
        cs.last_seen,
        'shared_view' as access_type,
        owner_u.username as shared_by_username
      FROM device_sharing ds
      JOIN devices d ON ds.device_id = d.device_id
      LEFT JOIN current_status cs ON d.device_id = cs.device_id
      LEFT JOIN users owner_u ON ds.owner_user_id = owner_u.id
      WHERE ds.shared_user_id = ? AND ds.permissions = 'view_only'
      
      ORDER BY created_at DESC
    `;

    console.log('🚀 Executing UPDATED SQL query');
    
    database.db.all(sql, [userId, userId], (err, rows) => {
      if (err) {
        console.error('💥 DATABASE ERROR in getUserDevices:', err.message);
        return res.status(500).json({ 
          success: false,
          error: 'Database query failed: ' + err.message 
        });
      }

      console.log('✅ Database query successful, found devices:', rows ? rows.length : 0);

      if (!rows || rows.length === 0) {
        console.log('ℹ️ No devices found for user:', userId);
        return res.json({
          success: true,
          devices: []
        });
      }

      // Process the devices
      const devices = rows.map(device => {
        return {
          device_id: device.device_id,
          name: device.name,
          location: device.location,
          online: device.online === 1,
          system_mode: device.system_mode,
          last_seen: device.last_seen,
          created_at: device.created_at,
          // Only return credentials to device owners, not shared users
          device_username: device.access_type === 'owner' ? device.device_username : undefined,
          password: device.access_type === 'owner' ? device.device_password : undefined,
          access_type: device.access_type,
          shared_by_username: device.shared_by_username,
          is_shared: device.access_type === 'shared_view',
          can_edit: device.access_type === 'owner'
        };
      });

      console.log('🎯 Sending response with device-specific credentials');
      
      res.json({
        success: true,
        devices: devices
      });
    });

  } catch (error) {
    console.error('💥 UNEXPECTED ERROR in getUserDevices:', error);
    res.status(500).json({ 
      success: false,
      error: 'Unexpected server error: ' + error.message 
    });
  }
};

// Temporary function to update existing devices with credentials
exports.updateExistingDevices = (req, res) => {
  try {
    // For each existing device, set default credentials
    database.db.all('SELECT device_id, name FROM devices WHERE device_username IS NULL', (err, devices) => {
      if (err) {
        console.error('Error fetching devices:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      devices.forEach(device => {
        const defaultUsername = device.device_id.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        const defaultPassword = 'device123'; // Default password
        
        database.db.run(
          'UPDATE devices SET device_username = ?, device_password = ? WHERE device_id = ?',
          [defaultUsername, defaultPassword, device.device_id],
          function(err) {
            if (err) {
              console.error(`Error updating device ${device.device_id}:`, err);
            } else {
              console.log(`✅ Updated device ${device.device_id} with credentials`);
            }
          }
        );
      });

      res.json({
        success: true,
        message: `Updating ${devices.length} devices with default credentials`
      });
    });
  } catch (error) {
    console.error('Error in updateExistingDevices:', error);
    res.status(500).json({ error: 'Failed to update devices' });
  }
};

// Delete device
exports.deleteUserDevice = (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.userId;

    console.log('🔍 Delete device request:', { deviceId, userId });

    // Verify user owns this device
    database.db.get(
      'SELECT user_id FROM devices WHERE device_id = ?',
      [deviceId],
      (err, device) => {
        if (err) {
          console.error('Database error checking device ownership:', err);
          return res.status(500).json({ error: 'Database error' });
        }
        
        if (!device || device.user_id !== userId) {
          console.warn('User attempted to delete device they dont own:', { userId, deviceOwner: device?.user_id });
          return res.status(404).json({ error: 'Device not found or access denied' });
        }

        // Delete device and associated data
        database.db.serialize(() => {
          // Delete device record (cascade will handle related records)
          database.db.run('DELETE FROM devices WHERE device_id = ?', [deviceId], function(err) {
            if (err) {
              console.error('Error deleting device:', err);
              return res.status(500).json({ error: 'Failed to delete device' });
            }

            console.log('✅ Device deleted successfully:', deviceId);
            res.json({
              success: true,
              message: 'Device deleted successfully'
            });
          });
        });
      }
    );

  } catch (error) {
    console.error('Error in deleteUserDevice:', error);
    res.status(500).json({ error: 'Failed to delete device' });
  }
};

// Share device with another user (view-only access)
exports.shareDevice = (req, res) => {
  try {
    const { device_id, shared_username } = req.body;
    const ownerUserId = req.userId;

    console.log('🔍 shareDevice called', { device_id, shared_username, ownerUserId });

    if (!device_id || !shared_username) {
      return res.status(400).json({
        success: false,
        error: 'Device ID and username are required'
      });
    }

    // Verify the device exists and belongs to the current user
    database.db.get(
      'SELECT user_id FROM devices WHERE device_id = ?',
      [device_id],
      (err, device) => {
        if (err) {
          console.error('Database error checking device:', err);
          return res.status(500).json({ error: 'Database error' });
        }
        
        if (!device || device.user_id !== ownerUserId) {
          return res.status(404).json({ 
            success: false,
            error: 'Device not found or you do not own this device' 
          });
        }

        // Find the user to share with
        database.db.get(
          'SELECT id FROM users WHERE username = ?',
          [shared_username],
          (err, sharedUser) => {
            if (err) {
              console.error('Database error finding user:', err);
              return res.status(500).json({ error: 'Database error' });
            }
            
            if (!sharedUser) {
              return res.status(404).json({
                success: false,
                error: 'User not found'
              });
            }

            if (sharedUser.id === ownerUserId) {
              return res.status(400).json({
                success: false,
                error: 'Cannot share device with yourself'
              });
            }

            // Check if already shared
            database.db.get(
              'SELECT id FROM device_sharing WHERE device_id = ? AND shared_user_id = ?',
              [device_id, sharedUser.id],
              (err, existingShare) => {
                if (err) {
                  console.error('Database error checking existing share:', err);
                  return res.status(500).json({ error: 'Database error' });
                }
                
                if (existingShare) {
                  return res.status(400).json({
                    success: false,
                    error: 'Device is already shared with this user'
                  });
                }

                // Create the share (view-only permission)
                database.db.run(
                  'INSERT INTO device_sharing (device_id, owner_user_id, shared_user_id, permissions) VALUES (?, ?, ?, ?)',
                  [device_id, ownerUserId, sharedUser.id, 'view_only'],
                  function(err) {
                    if (err) {
                      console.error('Error sharing device:', err);
                      return res.status(500).json({ error: 'Failed to share device' });
                    }

                    console.log('✅ Device shared successfully');
                    res.json({
                      success: true,
                      message: `Device shared with ${shared_username} (view-only access)`
                    });
                  }
                );
              }
            );
          }
        );
      }
    );

  } catch (error) {
    console.error('Error in shareDevice:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to share device' 
    });
  }
};

// Get shared devices list (for management)
exports.getSharedDevices = (req, res) => {
  try {
    const userId = req.userId;

    const sql = `
      SELECT 
        ds.*,
        d.name as device_name,
        d.location as device_location,
        shared_u.username as shared_with_username,
        ds.created_at as shared_at
      FROM device_sharing ds
      JOIN devices d ON ds.device_id = d.device_id
      JOIN users shared_u ON ds.shared_user_id = shared_u.id
      WHERE ds.owner_user_id = ?
      ORDER BY ds.created_at DESC
    `;

    database.db.all(sql, [userId], (err, shares) => {
      if (err) {
        console.error('Error fetching shared devices:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      res.json({
        success: true,
        shares: shares
      });
    });

  } catch (error) {
    console.error('Error in getSharedDevices:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get shared devices' 
    });
  }
};

// Remove device sharing
exports.unshareDevice = (req, res) => {
  try {
    const { share_id } = req.params;
    const userId = req.userId;

    // Verify the user owns this share
    database.db.get(
      'SELECT id FROM device_sharing WHERE id = ? AND owner_user_id = ?',
      [share_id, userId],
      (err, share) => {
        if (err) {
          console.error('Database error checking share:', err);
          return res.status(500).json({ error: 'Database error' });
        }
        
        if (!share) {
          return res.status(404).json({
            success: false,
            error: 'Share not found or access denied'
          });
        }

        database.db.run(
          'DELETE FROM device_sharing WHERE id = ?',
          [share_id],
          function(err) {
            if (err) {
              console.error('Error removing share:', err);
              return res.status(500).json({ error: 'Failed to remove share' });
            }

            res.json({
              success: true,
              message: 'Device sharing removed successfully'
            });
          }
        );
      }
    );

  } catch (error) {
    console.error('Error in unshareDevice:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to remove device sharing' 
    });
  }
};

module.exports = exports;