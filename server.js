require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { generalLimiter } = require('./middleware/rateLimit');
const apiRoutes = require('./routes/api');
const logger = require('./utils/logger'); // Import our logger

const app = express();
const PORT = process.env.PORT || 3000;

// Store server instance for graceful shutdown
let server;

// Security middleware
app.use(helmet());
app.use(cors());
app.use(generalLimiter);

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP Request', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
  });
  
  next();
});

// Body parsing middleware
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api', apiRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Server is running' });
});

// 404 handler
app.use('*', (req, res) => {
  logger.warn('Route not found', { url: req.originalUrl, method: req.method });
  res.status(404).json({ error: 'Route not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { 
    error: err.message, 
    stack: err.stack,
    url: req.url,
    method: req.method 
  });
  res.status(500).json({ error: 'Something went wrong!' });
});

// Function to start server
const startServer = () => {
  return new Promise((resolve, reject) => {
    server = app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`Allowed domains: ${process.env.APP_URL}, airpurifier.electronicsideas.com`);
      resolve(server);
    });
    
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.error(`Port ${PORT} is already in use`);
        reject(err);
      } else {
        reject(err);
      }
    });
  });
};

// Graceful shutdown function
const gracefulShutdown = (signal) => {
  return () => {
    logger.info(`Received ${signal}, shutting down gracefully`);
    
    server.close((err) => {
      if (err) {
        logger.error('Error during shutdown', { error: err.message });
        process.exit(1);
      }
      
      logger.info('Server closed successfully');
      process.exit(0);
    });
    
    // Force close after 10 seconds
    setTimeout(() => {
      logger.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 10000);
  };
};

// Handle kill commands
process.on('SIGTERM', gracefulShutdown('SIGTERM'));
process.on('SIGINT', gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { 
    error: error.message, 
    stack: error.stack 
  });
  process.exit(1);
});

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { 
    reason: reason.message || reason, 
    promise 
  });
  process.exit(1);
});

// Function to kill processes on the port
const killProcessesOnPort = (port) => {
  const { exec } = require('child_process');
  
  return new Promise((resolve, reject) => {
    // For Linux/Mac systems
    exec(`lsof -ti:${port}`, (err, stdout) => {
      if (err) {
        // No processes found on port is not an error for us
        if (err.message.includes('command not found')) {
          logger.warn('lsof command not available, cannot check for processes on port');
        } else {
          logger.warn(`No processes found on port ${port} or error checking: ${err.message}`);
        }
        return resolve();
      }
      
      const pids = stdout.trim().split('\n').filter(pid => pid !== '');
      
      if (pids.length === 0) {
        logger.info(`No processes found on port ${port}`);
        return resolve();
      }
      
      logger.warn(`Found ${pids.length} process(es) on port ${port}, killing them: ${pids.join(', ')}`);
      
      // Kill all processes
      exec(`kill -9 ${pids.join(' ')}`, (killErr) => {
        if (killErr) {
          logger.error(`Error killing processes on port ${port}: ${killErr.message}`);
          return reject(killErr);
        }
        
        logger.info(`Successfully killed processes on port ${port}`);
        resolve();
      });
    });
  });
};

// Main function to start the application
const main = async () => {
  try {
    // Try to kill any processes on our port first
    await killProcessesOnPort(PORT);
    
    // Small delay to ensure port is freed
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Start the server
    await startServer();
    
    logger.info('Application started successfully');
  } catch (error) {
    logger.error('Failed to start application', { 
      error: error.message, 
      stack: error.stack 
    });
    process.exit(1);
  }
};

// Start the application if this file is run directly
if (require.main === module) {
  main();
}

module.exports = { app, server, startServer, gracefulShutdown };