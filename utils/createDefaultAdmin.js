const db = require('../config/database');
const bcrypt = require('bcryptjs');
const logger = require('./logger');

async function createDefaultAdmin() {
  return new Promise(async (resolve, reject) => {
    try {
      // Check if any users exist
      db.get('SELECT COUNT(*) as count FROM users', async (err, row) => {
        if (err) {
          logger.error('Error checking users table:', err.message);
          return reject(err);
        }
        
        if (row.count === 0) {
          // No users exist, create default admin
          const defaultUsername = 'admin';
          const defaultPassword = 'admin123'; // You should change this in production!
          const hashedPassword = await bcrypt.hash(defaultPassword, 12);
          
          db.run(
            'INSERT INTO users (username, password, is_admin) VALUES (?, ?, ?)',
            [defaultUsername, hashedPassword, true],
            function(err) {
              if (err) {
                logger.error('Error creating default admin user:', err.message);
                return reject(err);
              } else {
                logger.info('Default admin user created successfully');
                logger.info(`Username: ${defaultUsername}`);
                logger.info(`Password: ${defaultPassword}`);
                logger.info('Please change the default password after first login!');
                return resolve({
                  id: this.lastID,
                  username: defaultUsername,
                  password: defaultPassword,
                  is_admin: true
                });
              }
            }
          );
        } else {
          logger.info('Users already exist in database, skipping default admin creation');
          return resolve(null);
        }
      });
    } catch (error) {
      logger.error('Error in createDefaultAdmin:', error.message);
      return reject(error);
    }
  });
}

// Run if this script is executed directly
if (require.main === module) {
  createDefaultAdmin()
    .then(() => {
      console.log('Default admin creation process completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('Error creating default admin:', error);
      process.exit(1);
    });
}

module.exports = createDefaultAdmin;