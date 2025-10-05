// Add this at the very top, before any requires
console.log('=== SERVER.JS STARTING ===');

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { generalLimiter } = require('./middleware/rateLimit');
const apiRoutes = require('./routes/api');
const logger = require('./utils/logger');
require('./config/database');
const bcrypt = require('bcryptjs'); 
const app = express();
const PORT = process.env.PORT || 3001;

console.log('=== EXPRESS APP CREATED ===');
console.log('=== PORT:', PORT, '===');

const deviceController = require('./controllers/deviceController');

// Store server instance for graceful shutdown
let server;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      "script-src": ["'self'", "'unsafe-inline'", "https://code.jquery.com", "https://cdn.datatables.net"],
      "style-src": ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://cdn.datatables.net"],
      "font-src": ["'self'", "https://cdnjs.cloudflare.com", "data:"],
      "img-src": ["'self'", "data:"]
    }
  }
}));

// CORS configuration
app.use(cors({
  origin: [
    'http://airpurifier.electronicsideas.com',
    'https://airpurifier.electronicsideas.com',
    'https://airpurifier.electronicsideas.com/style.css',
    'https://airpurifier.electronicsideas.com/admin/admin.js',
    'https://airpurifier.electronicsideas.com/admin/admin.css'
  ],
  credentials: true
}));

// CRITICAL FIX: Body parsing middleware MUST come BEFORE rate limiting and API routes
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting AFTER body parsing
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

// Debug middleware for API routes (remove in production)
app.use('/api', (req, res, next) => {
  console.log(`[API DEBUG] ${req.method} ${req.originalUrl}`);
  console.log(`[API DEBUG] Body:`, req.body);
  console.log(`[API DEBUG] Headers:`, req.headers);
  next();
});

// API Routes - MUST come before static files and catch-all routes
app.use('/api', apiRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Server is running' });
});

// API info endpoint (kept for API clients)
app.get('/api-info', (req, res) => {
  res.status(200).json({ 
    message: 'Air Purifier API Server', 
    version: '1.0.0',
    endpoints: {
      health: '/health',
      api: '/api',
      admin: '/admin'
    }
  });
});

// Serve admin HTML file
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'admin.html'));
});

// Serve admin CSS file
app.get('/admin/admin.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'admin.css'));
});

// Serve admin JS file
app.get('/admin/admin.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'admin.js'));
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// IMPORTANT: This catch-all route MUST come AFTER API routes
// Serve frontend for all non-API routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/admin')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

console.log('=== STARTING DEVICE MONITORING ===');
deviceController.startDeviceMonitoring();
logger.info('Device monitoring service initialized');
console.log('=== DEVICE MONITORING STARTED ===');

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  logger.warn('API route not found', { 
    url: req.originalUrl, 
    method: req.method,
    body: req.body 
  });
  res.status(404).json({ 
    error: 'API route not found',
    method: req.method,
    url: req.originalUrl,
    availableRoutes: [
      'POST /api/test',
      'POST /api/readings',
      'POST /api/device-data',
      'POST /api/auth/register',
      'POST /api/auth/login',
      'GET /api/latest-data',
      'GET /api/device-status'
    ]
  });
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

app.set('trust proxy', 1); 

// Function to start server
const startServer = () => {
  console.log('=== STARTSERVER FUNCTION CALLED ===');
  return new Promise((resolve, reject) => {
    try {
      // Listen on all interfaces (0.0.0.0) for Passenger
      server = app.listen(PORT, '0.0.0.0', () => {
        console.log('=== SERVER LISTENING CALLBACK FIRED ===');
        logger.info(`HTTP Server running on port ${PORT}`);
        logger.info(`Environment: ${process.env.NODE_ENV || 'production'}`);
        logger.info(`Running under: ${process.env.PASSENGER_APP_ENV || 'standalone'}`);
        logger.info(`Allowed domains: ${process.env.APP_URL}, airpurifier.electronicsideas.com`);
        logger.info(`Serving frontend from: ${path.join(__dirname, 'public')}`);
        resolve(server);
      });
      
      if (server) {
        server.on('error', (err) => {
          console.log('=== SERVER ERROR EVENT ===', err);
          if (err.code === 'EADDRINUSE') {
            logger.error(`Port ${PORT} is already in use`);
            reject(err);
          } else {
            reject(err);
          }
        });
      }
    } catch (err) {
      console.log('=== ERROR IN STARTSERVER ===', err);
      logger.error('Failed to start server', { error: err.message });
      reject(err);
    }
  });
};

// Graceful shutdown function (Passenger-compatible)
const gracefulShutdown = (signal) => {
  return () => {
    logger.info(`Received ${signal}, shutting down gracefully`);
    
    // Check if server exists before trying to close it
    if (server && typeof server.close === 'function') {
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
    } else {
      // If no server instance (Passenger manages it), just exit gracefully
      logger.info('No server instance to close (managed by Passenger)');
      process.exit(0);
    }
  };
};

// Handle kill commands
process.on('SIGTERM', gracefulShutdown('SIGTERM'));
process.on('SIGINT', gracefulShutdown('SIGINT'));

// Handle uncaught exceptions (with server check)
process.on('uncaughtException', (error) => {
  console.log('=== UNCAUGHT EXCEPTION ===', error);
  logger.error('Uncaught Exception', { 
    error: error.message, 
    stack: error.stack 
  });
  
  // Don't try to close undefined server
  if (server && typeof server.close === 'function') {
    server.close(() => process.exit(1));
  } else {
    process.exit(1);
  }
});

// Handle unhandled rejections (with server check)
process.on('unhandledRejection', (reason, promise) => {
  console.log('=== UNHANDLED REJECTION ===', reason);
  logger.error('Unhandled Rejection', { 
    reason: reason.message || reason, 
    promise 
  });
  
  // Don't try to close undefined server
  if (server && typeof server.close === 'function') {
    server.close(() => process.exit(1));
  } else {
    process.exit(1);
  }
});

// Main function to start the application (Passenger-compatible)
const main = async () => {
  console.log('=== MAIN FUNCTION CALLED ===');
  try {
    logger.info('Initializing application for Passenger...');
    // REMOVE the call to startServer().
    // Passenger will automatically call app.listen() for you.
    console.log('=== APPLICATION INITIALIZED, READY FOR PASSENGER ===');
    logger.info('Application initialized successfully for Passenger');
  } catch (error) {
    console.log('=== ERROR IN MAIN ===', error);
    logger.error('Failed to initialize application', { 
      error: error.message, 
      stack: error.stack 
    });
    process.exit(1);
  }
};

console.log('=== CHECKING IF MAIN MODULE ===');
console.log('require.main === module:', require.main === module);

// Start the application if this file is run directly (e.g., node server.js)
if (require.main === module) {
  console.log('=== RUNNING STANDALONE, CALLING MAIN() ===');
  main();
} else {
  console.log('=== RUNNING UNDER PASSENGER, INITIALIZING APP ===');
  // When required by Passenger, just initialize the app but don't call .listen()
  // You can run any necessary setup here, but do not start the server.
  main(); // This will run your init code without starting the server.
}

// Export just the app instance. Passenger looks for `app` or `application` by default.
module.exports = app;