const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const db = require('../config/database');

// Ensure backups directory exists
const backupsDir = path.join(__dirname, '..', 'backups');
if (!fs.existsSync(backupsDir)) {
  fs.mkdirSync(backupsDir);
}

// Generate timestamp for backup filename
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupFile = path.join(backupsDir, `airquality-backup-${timestamp}.db`);

// Create backup
db.backup(backupFile)
  .then(() => {
    console.log(`Backup created successfully: ${backupFile}`);
    
    // Optional: Delete backups older than 30 days
    const files = fs.readdirSync(backupsDir);
    const now = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    
    files.forEach(file => {
      const filePath = path.join(backupsDir, file);
      const stat = fs.statSync(filePath);
      
      if (now - stat.mtimeMs > thirtyDays) {
        fs.unlinkSync(filePath);
        console.log(`Deleted old backup: ${file}`);
      }
    });
    
    process.exit(0);
  })
  .catch(err => {
    console.error('Backup failed:', err);
    process.exit(1);
  });