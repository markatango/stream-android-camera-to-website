// tests/testServer.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

// Set up test environment
process.env.NODE_ENV = 'test';
process.env.DEVICE_SECRET = 'test-secret-key-for-testing';

const app = express();

// Middleware (same as your main server)
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000"
}));
app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Store active sessions and authentication tokens (for testing)
const activeSessions = new Map();
const authTokens = new Map();

// Generate secure authentication token
function generateAuthToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Authentication endpoint (copied from your server)
app.post('/api/authenticate', (req, res) => {
  const { deviceId, deviceSecret } = req.body;
  
  if (!deviceId || !deviceSecret) {
    return res.status(400).json({ 
      error: 'Missing deviceId or deviceSecret',
      received: { deviceId: !!deviceId, deviceSecret: !!deviceSecret }
    });
  }
  
  if (!process.env.DEVICE_SECRET) {
    return res.status(500).json({ 
      error: 'Server configuration error: DEVICE_SECRET not set' 
    });
  }
  
  if (deviceSecret !== process.env.DEVICE_SECRET) {
    return res.status(401).json({ 
      error: 'Unauthorized device',
      hint: 'Check DEVICE_SECRET in your Android app'
    });
  }
  
  const token = generateAuthToken();
  const tokenData = { 
    deviceId, 
    timestamp: Date.now(),
    expiresAt: Date.now() + (60 * 60 * 1000)
  };
  
  authTokens.set(token, tokenData);
  
  res.json({ 
    token, 
    expiresIn: 3600000,
    deviceId: deviceId
  });
});

// Health check endpoint (copied from your server)
app.get('/api/health', (req, res) => {
  const healthData = { 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    activeSessions: activeSessions.size,
    activeTokens: authTokens.size,
    socketConnections: 0, // No socket.io in test
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      memory: process.memoryUsage()
    },
    configuration: {
      port: process.env.PORT || 3001,
      deviceSecretSet: !!process.env.DEVICE_SECRET,
      frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000"
    }
  };
  
  res.json(healthData);
});

// Get active devices endpoint (copied from your server)
app.get('/api/devices', (req, res) => {
  const devices = Array.from(activeSessions.entries()).map(([deviceId, session]) => ({
    deviceId,
    connectedAt: session.connectedAt,
    lastActivity: session.lastActivity,
    socketId: session.socketId,
    isActive: (Date.now() - session.lastActivity) < 30000
  }));
  
  res.json({ devices, count: devices.length });
});

module.exports = app;
