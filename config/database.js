const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');

const dbPath = path.join(__dirname, '..', 'airquality.db');

// Initialize database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');

    // Enable foreign keys and WAL mode for better performance
    db.run('PRAGMA foreign_keys = ON');
    db.run('PRAGMA journal_mode = WAL');

    // Create tables if they don't exist
    db.serialize(() => {
      // Create devices table first (since other tables reference it)
      db.run(`CREATE TABLE IF NOT EXISTS devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT UNIQUE NOT NULL,
        name TEXT DEFAULT 'Air Purifier',
        location TEXT DEFAULT 'Living Room',
        user_id INTEGER NOT NULL,  
        device_username TEXT,  -- ADDED: Device-specific username
        device_password TEXT,  -- ADDED: Device-specific password
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`);

      // Device status table (stores historical readings)
      db.run(`CREATE TABLE IF NOT EXISTS readings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        system_mode TEXT DEFAULT 'offline',
        input_air_quality REAL NOT NULL,       
        output_air_quality REAL NOT NULL,      
        efficiency REAL NOT NULL,               
        fan_state BOOLEAN NOT NULL,
        auto_mode BOOLEAN NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
      )`);

      // Current device status table (for real-time updates)
      db.run(`CREATE TABLE IF NOT EXISTS current_status (
        device_id TEXT PRIMARY KEY,
        system_mode TEXT DEFAULT 'offline',
        input_air_quality REAL DEFAULT 0,
        output_air_quality REAL DEFAULT 0,
        efficiency REAL DEFAULT 0,
        fan_state INTEGER DEFAULT 0,
        auto_mode INTEGER DEFAULT 1,
        threshold INTEGER DEFAULT 300,
        online INTEGER DEFAULT 0,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS device_sharing (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        owner_user_id INTEGER NOT NULL,
        shared_user_id INTEGER NOT NULL,
        permissions TEXT DEFAULT 'view_only',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE,
        FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (shared_user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(device_id, shared_user_id)
      )`);

      // Users table
      db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        is_admin BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Settings table
      db.run(`CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        threshold INTEGER DEFAULT 300,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (device_id) REFERENCES devices (device_id) ON DELETE CASCADE
      )`);

      // Command queue table (for sending commands to devices)
      db.run(`CREATE TABLE IF NOT EXISTS command_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        command TEXT NOT NULL,
        value TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processed_at DATETIME,
        FOREIGN KEY (device_id) REFERENCES devices (device_id) ON DELETE CASCADE
      )`);

      // Create indexes for better performance
      db.run('CREATE INDEX IF NOT EXISTS idx_readings_device_id ON readings(device_id)');
      db.run('CREATE INDEX IF NOT EXISTS idx_readings_timestamp ON readings(timestamp)');
      db.run('CREATE INDEX IF NOT EXISTS idx_command_queue_status ON command_queue(status)');

      // Check if we need to create a default admin user and device
      createDefaultAdminUser();
    });

    // Add missing columns after tables are created
    addMissingColumns();
  }
});

// Function to add missing columns to existing tables
function addMissingColumns() {
  // Add user_id column to devices table if it doesn't exist
  db.get("SELECT name FROM pragma_table_info('devices') WHERE name='user_id'", (err, row) => {
    if (err) {
      console.error('Error checking for user_id column:', err.message);
    } else if (!row) {
      db.run('ALTER TABLE devices ADD COLUMN user_id INTEGER DEFAULT 1', (alterErr) => {
        if (alterErr) {
          console.error('Error adding user_id column:', alterErr.message);
        } else {
          console.log('✓ Added user_id column to devices table');
          db.run('UPDATE devices SET user_id = 1 WHERE user_id IS NULL');
        }
      });
    }
  });

  // Add device_username column to devices table if it doesn't exist
  db.get("SELECT name FROM pragma_table_info('devices') WHERE name='device_username'", (err, row) => {
    if (err) {
      console.error('Error checking for device_username column:', err.message);
    } else if (!row) {
      db.run('ALTER TABLE devices ADD COLUMN device_username TEXT', (alterErr) => {
        if (alterErr) {
          console.error('Error adding device_username column:', alterErr.message);
        } else {
          console.log('✓ Added device_username column to devices table');
          // Set default device usernames for existing devices
          db.run(`UPDATE devices SET device_username = 'device_' || device_id WHERE device_username IS NULL`);
        }
      });
    }
  });

  // Add device_password column to devices table if it doesn't exist
  db.get("SELECT name FROM pragma_table_info('devices') WHERE name='device_password'", (err, row) => {
    if (err) {
      console.error('Error checking for device_password column:', err.message);
    } else if (!row) {
      db.run('ALTER TABLE devices ADD COLUMN device_password TEXT', (alterErr) => {
        if (alterErr) {
          console.error('Error adding device_password column:', alterErr.message);
        } else {
          console.log('✓ Added device_password column to devices table');
          // Set default device passwords for existing devices
          db.run(`UPDATE devices SET device_password = 'device123' WHERE device_password IS NULL`);
        }
      });
    }
  });

  // Add ip_address column to current_status table if it doesn't exist
  db.get("SELECT name FROM pragma_table_info('current_status') WHERE name='ip_address'", (err, row) => {
    if (err) {
      console.error('Error checking for ip_address column:', err.message);
    } else if (!row) {
      db.run('ALTER TABLE current_status ADD COLUMN ip_address TEXT', (alterErr) => {
        if (alterErr) {
          console.error('Error adding ip_address column:', alterErr.message);
        } else {
          console.log('✓ Added ip_address column to current_status table');
        }
      });
    }
  });
}

// Function to create default admin user
async function createDefaultAdminUser() {
  try {
    db.get('SELECT COUNT(*) as count FROM users', async (err, row) => {
      if (err) {
        logger.error('Error checking users table:', err.message);
        return;
      }

      if (row.count === 0) {
        const defaultUsername = 'admin';
        const defaultPassword = 'admin123';
        const hashedPassword = await bcrypt.hash(defaultPassword, 12);

        db.run(
          'INSERT INTO users (username, password, is_admin) VALUES (?, ?, ?)',
          [defaultUsername, hashedPassword, true],
          function (err) {
            if (err) {
              logger.error('Error creating default admin user:', err.message);
            } else {
              logger.info('Default admin user created successfully');
              logger.info(`Username: ${defaultUsername}`);
              logger.info(`Password: ${defaultPassword}`);
              logger.info('Please change the default password after first login!');
            }
          }
        );
      } else {
        logger.info('Users already exist in database, skipping default admin creation');
      }
    });
  } catch (error) {
    logger.error('Error in createDefaultAdminUser:', error.message);
  }
}


// Function to store device status (both historical and current)
// Function to store device status (both historical and current)
function storeDeviceStatus(deviceId, system_mode, inputAirQuality, outputAirQuality, efficiency, fanState, autoMode, ipAddress = null) {
  return new Promise((resolve, reject) => {
    // First, ensure device exists in devices table
    db.get('SELECT device_id FROM devices WHERE device_id = ?', [deviceId], (err, row) => {
      if (err) {
        logger.error('Error checking device existence:', err.message);
        return reject(err);
      }

      // If device doesn't exist, create it with default user_id
      if (!row) {
        console.log(`⚠️  Device ${deviceId} not found, creating it...`);
        db.run(
          'INSERT INTO devices (device_id, name, location, user_id) VALUES (?, ?, ?, ?)',
          [deviceId, 'Air Purifier', 'Unknown', 1],
          (insertErr) => {
            if (insertErr) {
              logger.error('Error creating device:', insertErr.message);
              return reject(insertErr);
            }
            console.log(`✓ Device ${deviceId} created`);
            // After creating device, proceed with storing status
            storeStatusData();
          }
        );
      } else {
        // Device exists, proceed with storing status
        storeStatusData();
      }
    });

    function storeStatusData() {
      db.serialize(() => {
        // Store historical reading with ALL columns including system_mode
        db.run(
          'INSERT INTO readings (device_id, system_mode, input_air_quality, output_air_quality, efficiency, fan_state, auto_mode) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [deviceId, system_mode, inputAirQuality, outputAirQuality, efficiency, fanState ? 1 : 0, autoMode ? 1 : 0],
          function(err) {
            if (err) {
              logger.error('Error storing historical reading:', err.message);
              console.error('💥 Failed to insert into readings table:', err);
              return reject(err);
            }
            console.log('✓ Reading stored in readings table with system_mode:', system_mode, '(ID:', this.lastID, ')');
          }
        );
        
        // Update current status
        db.run(
          `INSERT OR REPLACE INTO current_status 
           (device_id, system_mode, input_air_quality, output_air_quality, efficiency, fan_state, auto_mode, online, last_seen, ip_address) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
          [deviceId, system_mode, inputAirQuality, outputAirQuality, efficiency, fanState ? 1 : 0, autoMode ? 1 : 0, system_mode === 'online' ? 1 : 0, ipAddress],
          function(err) {
            if (err) {
              logger.error('Error updating current status:', err.message);
              return reject(err);
            }
            console.log('✓ Current status updated with system_mode:', system_mode);
            resolve(this.lastID);
          }
        );
      });
    }
  });
}

// Function to get latest device status
function getLatestStatus(deviceId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT cs.*, d.name as device_name, d.location 
       FROM current_status cs 
       LEFT JOIN devices d ON cs.device_id = d.device_id 
       WHERE cs.device_id = ?`,
      [deviceId],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      }
    );
  });
}

// Function to check if device is online
function isDeviceOnline(deviceId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT online, last_seen FROM current_status WHERE device_id = ?',
      [deviceId],
      (err, row) => {
        if (err) {
          reject(err);
        } else if (row && row.last_seen) {
          // Consider device online if seen in last 2 minutes
          const lastSeen = new Date(row.last_seen);
          const now = new Date();
          const minutesDiff = (now - lastSeen) / (1000 * 60);
          resolve(minutesDiff < 2);
        } else {
          resolve(false);
        }
      }
    );
  });
}

// Function to add command to queue
function addCommandToQueue(deviceId, command, value) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO command_queue (device_id, command, value) VALUES (?, ?, ?)',
      [deviceId, command, value],
      function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID);
        }
      }
    );
  });
}

// Function to get pending commands for a device
function getPendingCommands(deviceId) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM command_queue WHERE device_id = ? AND status = ? ORDER BY created_at',
      [deviceId, 'pending'],
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      }
    );
  });
}

// Function to update command status
function updateCommandStatus(commandId, status) {
  return new Promise((resolve, reject) => {
    const processedAt = status === 'completed' || status === 'failed'
      ? "datetime('now')"
      : 'NULL';

    db.run(
      `UPDATE command_queue SET status = ?, processed_at = ${processedAt} WHERE id = ?`,
      [status, commandId],
      function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      }
    );
  });
}

// Function to get device settings
function getDeviceSettings(deviceId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM settings WHERE device_id = ?',
      [deviceId],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row || { threshold: 300 });
        }
      }
    );
  });
}

// Function to update device settings
function updateDeviceSettings(deviceId, settings) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO settings (device_id, threshold, updated_at) 
       VALUES (?, ?, datetime('now'))`,
      [deviceId, settings.threshold],
      function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      }
    );
  });
}

// Function to get historical data for charts
function getHistoricalData(deviceId, hours = 24) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT input_air_quality, output_air_quality, efficiency, fan_state, auto_mode, timestamp 
       FROM readings 
       WHERE device_id = ? AND timestamp >= datetime('now', ?) 
       ORDER BY timestamp`,
      [deviceId, `-${hours} hours`],
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      }
    );
  });
}

// Function to mark device as offline
function markDeviceOffline(deviceId) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE current_status SET online = FALSE WHERE device_id = ?',
      [deviceId],
      function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      }
    );
  });
}

// Function to get device credentials for ESP32 authentication
function getDeviceCredentials(deviceId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT device_username, device_password FROM devices WHERE device_id = ?',
      [deviceId],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      }
    );
  });
}

// Function to update device credentials
function updateDeviceCredentials(deviceId, username, password) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE devices SET device_username = ?, device_password = ? WHERE device_id = ?',
      [username, password, deviceId],
      function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      }
    );
  });
}

// Cleanup function to mark devices as offline if they haven't been seen in a while
function cleanupOfflineDevices() {
  db.run(
    `UPDATE current_status 
     SET online = FALSE 
     WHERE last_seen < datetime('now', '-5 minutes') AND online = TRUE`,
    (err) => {
      if (err) {
        logger.error('Error in cleanupOfflineDevices:', err.message);
      } else {
        logger.debug('Cleaned up offline devices');
      }
    }
  );
}

// Run cleanup every 5 minutes
setInterval(cleanupOfflineDevices, 5 * 60 * 1000);

// Export the database instance and utility functions
module.exports = {
  db,
  storeDeviceStatus,
  getLatestStatus,
  isDeviceOnline,
  addCommandToQueue,
  getPendingCommands,
  updateCommandStatus,
  getDeviceSettings,
  updateDeviceSettings,
  getHistoricalData,
  markDeviceOffline,
  getDeviceCredentials,
  updateDeviceCredentials
};