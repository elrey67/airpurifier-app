// scripts/migrateDatabase.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const logger = require('../utils/logger');

const dbPath = path.join(__dirname, '..', 'airquality.db');
const db = new sqlite3.Database(dbPath);

console.log('Starting database migration for dual-sensor support...');

// Function to check if a column exists in a table
function columnExists(tableName, columnName) {
  return new Promise((resolve, reject) => {
    db.all(`PRAGMA table_info(${tableName})`, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      const exists = rows.some(row => row.name === columnName);
      resolve(exists);
    });
  });
}

// Function to add a column if it doesn't exist
function addColumnIfNotExists(tableName, columnDefinition) {
  return new Promise((resolve, reject) => {
    const columnName = columnDefinition.split(' ')[0];
    
    columnExists(tableName, columnName).then(exists => {
      if (!exists) {
        console.log(`Adding ${columnName} column to ${tableName} table...`);
        db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`, (err) => {
          if (err) {
            console.error(`Error adding ${columnName} column:`, err);
            reject(err);
          } else {
            console.log(`Successfully added ${columnName} column to ${tableName}`);
            resolve(true);
          }
        });
      } else {
        console.log(`${columnName} column already exists in ${tableName}`);
        resolve(false);
      }
    }).catch(reject);
  });
}

// Function to check if a table has a specific column
function tableHasColumn(tableName, columnName) {
  return new Promise((resolve, reject) => {
    db.all(`PRAGMA table_info(${tableName})`, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      const hasColumn = rows.some(row => row.name === columnName);
      resolve(hasColumn);
    });
  });
}

// Main migration function
async function migrateDatabase() {
  try {
    console.log('Checking and updating database schema...');
    
    // Add dual-sensor columns to readings table
    await addColumnIfNotExists('readings', 'input_air_quality REAL');
    await addColumnIfNotExists('readings', 'output_air_quality REAL');
    await addColumnIfNotExists('readings', 'efficiency REAL');
    
    // Add dual-sensor columns to current_status table
    await addColumnIfNotExists('current_status', 'input_air_quality REAL');
    await addColumnIfNotExists('current_status', 'output_air_quality REAL');
    await addColumnIfNotExists('current_status', 'efficiency REAL');
    
    // Check if we need to migrate existing data from old air_quality column
    const hasOldAirQualityColumn = await tableHasColumn('readings', 'air_quality');
    
    if (hasOldAirQualityColumn) {
      console.log('Migrating existing data from single sensor to dual sensors...');
      
      // Migrate readings table data
      await new Promise((resolve, reject) => {
        db.run(`UPDATE readings SET 
          input_air_quality = air_quality, 
          output_air_quality = air_quality, 
          efficiency = 0 
          WHERE input_air_quality IS NULL`, (err) => {
          if (err) {
            console.error('Error migrating readings data:', err);
            reject(err);
          } else {
            console.log('Successfully migrated readings data');
            resolve();
          }
        });
      });
      
      // Migrate current_status table data
      await new Promise((resolve, reject) => {
        db.run(`UPDATE current_status SET 
          input_air_quality = air_quality, 
          output_air_quality = air_quality, 
          efficiency = 0 
          WHERE input_air_quality IS NULL`, (err) => {
          if (err) {
            console.error('Error migrating current_status data:', err);
            reject(err);
          } else {
            console.log('Successfully migrated current_status data');
            resolve();
          }
        });
      });
    } else {
      console.log('No old air_quality column found, skipping data migration');
    }
    
    // Add is_admin column to users table if it doesn't exist
    const hasAdminColumn = await tableHasColumn('users', 'is_admin');
    if (!hasAdminColumn) {
      console.log('Adding is_admin column to users table...');
      await new Promise((resolve, reject) => {
        db.run(`ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE`, (err) => {
          if (err) {
            console.error('Error adding is_admin column:', err);
            reject(err);
          } else {
            console.log('Successfully added is_admin column');
            resolve();
          }
        });
      });
      
      // Set the first user as admin
      await new Promise((resolve, reject) => {
        db.run(`UPDATE users SET is_admin = TRUE WHERE id = 1`, (err) => {
          if (err) {
            console.error('Error setting first user as admin:', err);
            reject(err);
          } else {
            console.log('Set first user as admin');
            resolve();
          }
        });
      });
    } else {
      console.log('is_admin column already exists');
    }
    
    // Create indexes for better performance with new columns
    console.log('Creating indexes for better performance...');
    
    const indexQueries = [
      'CREATE INDEX IF NOT EXISTS idx_readings_input_quality ON readings(input_air_quality)',
      'CREATE INDEX IF NOT EXISTS idx_readings_output_quality ON readings(output_air_quality)',
      'CREATE INDEX IF NOT EXISTS idx_readings_efficiency ON readings(efficiency)',
      'CREATE INDEX IF NOT EXISTS idx_readings_device_timestamp ON readings(device_id, timestamp)'
    ];
    
    for (const query of indexQueries) {
      await new Promise((resolve, reject) => {
        db.run(query, (err) => {
          if (err) {
            console.error('Error creating index:', err);
            reject(err);
          } else {
            console.log('Created index successfully');
            resolve();
          }
        });
      });
    }
    
    console.log('Database migration completed successfully!');
    
    // Verify the migration
    console.log('\nVerifying migration...');
    const tablesToCheck = ['readings', 'current_status', 'users'];
    
    for (const table of tablesToCheck) {
      const columns = await new Promise((resolve, reject) => {
        db.all(`PRAGMA table_info(${table})`, (err, rows) => {
          if (err) reject(err);
          else resolve(rows.map(row => row.name));
        });
      });
      console.log(`${table} table columns:`, columns.join(', '));
    }
    
  } catch (error) {
    console.error('Migration error:', error);
  }
}

// Run migration
db.serialize(() => {
  migrateDatabase().then(() => {
    // Close database connection
    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err);
        process.exit(1);
      } else {
        console.log('Database connection closed successfully');
        process.exit(0);
      }
    });
  }).catch(error => {
    console.error('Migration failed:', error);
    db.close((err) => {
      if (err) console.error('Error closing database:', err);
      process.exit(1);
    });
  });
});