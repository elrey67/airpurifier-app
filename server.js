require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { generalLimiter } = require('./middleware/rateLimit');
const apiRoutes = require('./routes/api');
const logger = require('./utils/logger');
require('./config/database');
const crypto = require('crypto'); // Add this line
const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '172.20.10.3';

// SSL certificate configuration
const sslOptions = {
    key: fs.readFileSync(path.join(__dirname, 'server.key')),
    cert: fs.readFileSync(path.join(__dirname, 'server.crt'))
};

// Create HTTPS server
const httpsServer = https.createServer(sslOptions, app);

// Store server instance for graceful shutdown
let server;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      "script-src": ["'self'", "'unsafe-inline'"],
      "style-src": ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      "font-src": ["'self'", "https://cdnjs.cloudflare.com", "data:"],
      "img-src": ["'self'", "data:"]
    }
  }
}));

// CORS configuration
app.use(cors({
  origin: [
    `https://${HOST}:${PORT}`,
    'http://airpurifier.electronicsideas.com',
    'https://airpurifier.electronicsideas.com',
    'https://localhost:3000',
    'https://localhost',
    'https://172.20.10.2:3000',
    'https://172.20.10.2:3000/script.js',
    'https://172.20.10.2:3000/style.css',
    'https://172.20.10.2:3000/admin/admin.js',
    'https://172.20.10.2:3000/admin/admin.css'
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
    },
    server: `${HOST}:${PORT}`
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


// Generate a nonce for each request
app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString('base64');
  next();
});

// Set CSP header with nonce
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    `script-src 'self' 'nonce-${res.locals.nonce}'`
  );
  next();
});


// Function to start server
const startServer = () => {
  return new Promise((resolve, reject) => {
    // Use httpsServer instead of app.listen
    server = httpsServer.listen(PORT, HOST, () => {
      logger.info(`HTTPS Server running on https://${HOST}:${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`Allowed domains: ${process.env.APP_URL}, airpurifier.electronicsideas.com`);
      logger.info(`Serving frontend from: ${path.join(__dirname, 'public')}`);
      resolve(server);
    });
    
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.error(`Port ${PORT} is already in use on ${HOST}`);
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
    // For Windows systems
    if (process.platform === 'win32') {
      exec(`netstat -ano | findstr :${port}`, (err, stdout) => {
        if (err) {
          logger.warn(`No processes found on port ${port} or error checking: ${err.message}`);
          return resolve();
        }
        
        const lines = stdout.split('\n');
        const pids = lines.map(line => {
          const match = line.trim().split(/\s+/);
          return match[match.length - 1];
        }).filter(pid => pid && pid !== 'PID');
        
        if (pids.length === 0) {
          logger.info(`No processes found on port ${port}`);
          return resolve();
        }
        
        logger.warn(`Found ${pids.length} process(es) on port ${port}, killing them: ${pids.join(', ')}`);
        
        // Kill all processes
        const killPromises = pids.map(pid => {
          return new Promise((killResolve, killReject) => {
            exec(`taskkill /F /PID ${pid}`, (killErr) => {
              if (killErr) {
                logger.error(`Error killing process ${pid}: ${killErr.message}`);
                return killReject(killErr);
              }
              killResolve();
            });
          });
        });
        
        Promise.all(killPromises)
          .then(() => {
            logger.info(`Successfully killed processes on port ${port}`);
            resolve();
          })
          .catch(reject);
      });
    } else {
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
        
        exec(`kill -9 ${pids.join(' ')}`, (killErr) => {
          if (killErr) {
            logger.error(`Error killing processes on port ${port}: ${killErr.message}`);
            return reject(killErr);
          }
          
          logger.info(`Successfully killed processes on port ${port}`);
          resolve();
        });
      });
    }
  });
};

// Main function to start the application
const main = async () => {
  try {
    // Database initialization (including admin creation) happens when we require the database file
    logger.info('Initializing database...');
    
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