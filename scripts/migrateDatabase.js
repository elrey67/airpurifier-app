// scripts/migrateDatabase.js
const db = require('../config/database');

// Add is_admin column to users table if it doesn't exist
db.run(`PRAGMA table_info(users)`, (err, rows) => {
  if (err) {
    console.error('Error checking table schema:', err);
    return;
  }
  
  const hasAdminColumn = rows.some(row => row.name === 'is_admin');
  
  if (!hasAdminColumn) {
    console.log('Adding is_admin column to users table...');
    db.run(`ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE`, (err) => {
      if (err) {
        console.error('Error adding is_admin column:', err);
      } else {
        console.log('Successfully added is_admin column');
        
        // Set the first user as admin
        db.run(`UPDATE users SET is_admin = TRUE WHERE id = 1`, (err) => {
          if (err) {
            console.error('Error setting first user as admin:', err);
          } else {
            console.log('Set first user as admin');
          }
        });
      }
    });
  } else {
    console.log('is_admin column already exists');
  }
});

// Close database connection
setTimeout(() => {
  db.close();
}, 1000);