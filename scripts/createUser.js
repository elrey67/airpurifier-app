const bcrypt = require('bcryptjs');
const db = require('../config/database');
const crypto = require('crypto');

const createDefaultUser = async () => {
  // Generate a secure random password for the ESP32
  const password = crypto.randomBytes(12).toString('hex');
  const username = 'esp32';
  
  try {
    // Check if user already exists
    db.get('SELECT id FROM users WHERE username = ?', [username], async (err, row) => {
      if (err) {
        console.error('Error checking user:', err.message);
        return;
      }
      
      if (row) {
        console.log('User already exists');
        console.log('To reset the password, delete the user from the database and run this script again');
        return;
      }
      
      // Hash password and create user
      const hashedPassword = await bcrypt.hash(password, 12);
      
      db.run('INSERT INTO users (username, password) VALUES (?, ?)', 
        [username, hashedPassword], function(err) {
          if (err) {
            console.error('Error creating user:', err.message);
          } else {
            console.log('==========================================');
            console.log('ESP32 User created successfully');
            console.log('Username: esp32');
            console.log('Password: ' + password);
            console.log('==========================================');
            console.log('Add this password to your ESP32 code');
          }
        });
    });
  } catch (error) {
    console.error('Error:', error.message);
  }
};

// Run if this script is executed directly
if (require.main === module) {
  createDefaultUser();
}

module.exports = createDefaultUser;