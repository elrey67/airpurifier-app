const database = require('../config/database');
const logger = require('../utils/logger');

// Constants for offline detection (in milliseconds)
const OFFLINE_THRESHOLD = 30000; // 30 seconds
const MONITORING_INTERVAL = 10000; // Check every 10 seconds

// SIMPLE: Check if device is offline based on database timestamp
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

// SIMPLE: Update device status in database
const updateDeviceStatus = async (deviceId, isOnline) => {
    try {
        if (isOnline) {
            // Device is online - update online status and system_mode
            database.db.run(
                'UPDATE current_status SET online = 1, system_mode = ? WHERE device_id = ?',
                ['online', deviceId],
                function(err) {
                    if (err) {
                        console.error('❌ Error updating device to online:', err);
                    } else {
                        console.log(`✅ Updated ${deviceId} to ONLINE`);
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
                    } else {
                        console.log(`🔴 Updated ${deviceId} to OFFLINE`);
                    }
                }
            );
        }
    } catch (error) {
        console.error(`💥 Error updating device status for ${deviceId}:`, error);
    }
};

// SIMPLE: Store reading from ESP32
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

        // Update device as online
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

// SIMPLE: Background monitoring - check database and update status
exports.startDeviceMonitoring = () => {
    console.log('🚀 Starting SIMPLE device monitoring service');
    
    setInterval(async () => {
        try {
            const deviceId = 'esp32_air_purifier_01';
            const offline = await isDeviceOffline(deviceId);
            
            if (offline) {
                console.log(`🚨 Device ${deviceId} is OFFLINE - updating database`);
                await updateDeviceStatus(deviceId, false);
            } else {
                console.log(`✅ Device ${deviceId} is ONLINE`);
            }
        } catch (error) {
            console.error('Error in device monitoring:', error);
        }
    }, MONITORING_INTERVAL);
    
    logger.info('Simple device monitoring service started');
};

// Manual function to simulate device going offline (for testing)
exports.forceOffline = async (req, res) => {
    try {
        const deviceId = req.query.device_id || 'esp32_air_purifier_01';
        
        // Manually set device to offline in database
        await updateDeviceStatus(deviceId, false);
        
        res.json({ 
            message: 'Device forced offline successfully',
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
        
        // Manually set device to online in database
        await updateDeviceStatus(deviceId, true);
        
        res.json({ 
            message: 'Device forced online successfully',
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
        
        // Get current database status
        const status = await database.getLatestStatus(deviceId);
        const offline = await isDeviceOffline(deviceId);
        
        res.json({
            device_id: deviceId,
            database_system_mode: status ? status.system_mode : 'unknown',
            database_online_status: status ? status.online : 'unknown',
            database_last_seen: status ? status.last_seen : null,
            should_be_offline: offline,
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
  [defaultDeviceId, 'Main Air Purifier', 'Living Room', 1], 
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

// Simple device registration - user provides all details
exports.registerDevice = async (req, res) => {
  try {
    const { name, location, username, password } = req.body;
    const userId = req.userId; // This comes from auth middleware

    console.log('🔍 Device registration called by user:', userId);

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
            console.error('Database error checking username:', err);
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
                console.error('Error creating device user:', err);
                return res.status(500).json({ error: 'Failed to create device user' });
              }
              
              const deviceUserId = this.lastID;
              
              // 3. Create device record - ASSIGN TO CURRENT USER
              database.db.run(
                'INSERT INTO devices (device_id, name, location, user_id) VALUES (?, ?, ?, ?)',
                [deviceId, name, location, userId], // Use the current user's ID
                function(err) {
                  if (err) {
                    console.error('Error creating device:', err);
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
    console.error('Error in registerDevice:', error);
    res.status(500).json({ error: 'Failed to register device' });
  }
};

// Get user's devices
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

    // Get both owned devices AND shared devices
    const sql = `
      -- Owned devices
      SELECT 
        d.*, 
        cs.online, 
        cs.system_mode, 
        cs.last_seen, 
        u.username as device_username,
        'owner' as access_type,
        NULL as shared_by_username
      FROM devices d 
      LEFT JOIN current_status cs ON d.device_id = cs.device_id
      LEFT JOIN users u ON d.user_id = u.id
      WHERE d.user_id = ?
      
      UNION ALL
      
      -- Shared devices (view-only access)
      SELECT 
        d.*, 
        cs.online, 
        cs.system_mode, 
        cs.last_seen, 
        u.username as device_username,
        'shared_view' as access_type,
        owner_u.username as shared_by_username
      FROM device_sharing ds
      JOIN devices d ON ds.device_id = d.device_id
      LEFT JOIN current_status cs ON d.device_id = cs.device_id
      LEFT JOIN users u ON d.user_id = u.id
      LEFT JOIN users owner_u ON ds.owner_user_id = owner_u.id
      WHERE ds.shared_user_id = ? AND ds.permissions = 'view_only'
      
      ORDER BY created_at DESC
    `;

    console.log('🚀 Executing SQL query for owned + shared devices for user:', userId);
    
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
          device_username: device.device_username,
          access_type: device.access_type, // 'owner' or 'shared_view'
          shared_by_username: device.shared_by_username, // who shared it
          is_shared: device.access_type === 'shared_view', // easy check
          can_edit: device.access_type === 'owner' // only owners can edit
        };
      });

      console.log('🎯 Sending response with devices:', devices.length);
      console.log('📊 Access types:', devices.map(d => ({ name: d.name, access: d.access_type })));
      
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