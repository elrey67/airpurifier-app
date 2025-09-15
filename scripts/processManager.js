const { exec } = require('child_process');
const logger = require('../utils/logger');

class ProcessManager {
  static async getProcessesOnPort(port) {
    return new Promise((resolve, reject) => {
      exec(`lsof -ti:${port}`, (err, stdout) => {
        if (err) {
          if (err.message.includes('command not found')) {
            return resolve([]);
          }
          return resolve([]);
        }
        
        const pids = stdout.trim().split('\n').filter(pid => pid !== '');
        resolve(pids);
      });
    });
  }
  
  static async killProcessesOnPort(port) {
    const pids = await this.getProcessesOnPort(port);
    
    if (pids.length === 0) {
      logger.info(`No processes found on port ${port}`);
      return true;
    }
    
    logger.warn(`Found ${pids.length} process(es) on port ${port}: ${pids.join(', ')}`);
    
    return new Promise((resolve, reject) => {
      exec(`kill -9 ${pids.join(' ')}`, (err) => {
        if (err) {
          logger.error(`Error killing processes: ${err.message}`);
          return reject(err);
        }
        
        logger.info(`Successfully killed processes on port ${port}`);
        resolve(true);
      });
    });
  }
  
  static async isPortAvailable(port) {
    const pids = await this.getProcessesOnPort(port);
    return pids.length === 0;
  }
}

module.exports = ProcessManager;