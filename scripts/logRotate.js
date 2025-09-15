const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const logger = require('../utils/logger');

const logsDir = path.join(__dirname, '../logs');
const maxLogSize = 10 * 1024 * 1024; // 10MB

function rotateLogs() {
  const files = fs.readdirSync(logsDir);
  
  files.forEach(file => {
    if (file.endsWith('.log')) {
      const filePath = path.join(logsDir, file);
      const stats = fs.statSync(filePath);
      
      if (stats.size > maxLogSize) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const newFileName = `${file.replace('.log', '')}-${timestamp}.log`;
        
        fs.renameSync(filePath, path.join(logsDir, newFileName));
        logger.info(`Rotated log file: ${file} -> ${newFileName}`);
        
        // Compress old log files
        exec(`gzip ${path.join(logsDir, newFileName)}`, (err) => {
          if (err) {
            logger.error('Error compressing log file', { error: err.message });
          } else {
            logger.info(`Compressed log file: ${newFileName}.gz`);
          }
        });
      }
    }
  });
}

// Run rotation daily
setInterval(rotateLogs, 24 * 60 * 60 * 1000);

// Also run on startup
rotateLogs();

module.exports = rotateLogs;