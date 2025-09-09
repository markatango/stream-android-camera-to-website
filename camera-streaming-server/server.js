// server.js
require('dotenv').config();

const { auth: firebaseAuth, db } = require('./services/firebaseAdmin');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const FRAME_INTERVAL = 100; // Limit to 10 FPS (100ms between frames)
const frameTimestamps = new Map(); // Track last frame time per device

const compression = require('compression');

const app = express();

// CRITICAL: Trust specific proxy (Nginx) instead of all proxies
app.set('trust proxy', 1); // Trust first proxy (Nginx)

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  },
  compression: true,        // Enable Socket.IO compression
  perMessageDeflate: true   // Enable WebSocket compression
});

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000"
}));
app.use(express.json());

app.use(compression({
  threshold: 1024, // Only compress if larger than 1KB
  level: 6         // Good balance of speed vs compression
}));

// Enhanced logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path} - IP: ${req.ip}`);
  
  if (req.method === 'POST' && req.body) {
    console.log(`[${timestamp}] Request body:`, JSON.stringify(req.body, null, 2));
  }
  
  // Log response
  const originalSend = res.send;
  res.send = function(data) {
    console.log(`[${timestamp}] Response ${res.statusCode} for ${req.method} ${req.path}`);
    if (res.statusCode >= 400) {
      console.log(`[${timestamp}] Error response:`, data);
    }
    originalSend.call(this, data);
  };
  
  next();
});

// Rate limiting - will now work correctly with trust proxy
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});
app.use(limiter);


// Store active sessions and authentication tokens
const activeSessions = new Map();
const authTokens = new Map();

// Configuration logging
console.log('=== SERVER CONFIGURATION ===');
console.log('PORT:', process.env.PORT || 3001);
console.log('DEVICE_SECRET:', process.env.DEVICE_SECRET ? 
  `${process.env.DEVICE_SECRET.substring(0, 8)}...` : 'NOT SET');
console.log('FRONTEND_URL:', process.env.FRONTEND_URL || 'http://localhost:3000');
console.log('NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('=============================\n');

// Generate secure authentication token
function generateAuthToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Authentication endpoint
app.post('/api/authenticate', (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] === AUTHENTICATION REQUEST ===`);
  
  const { deviceId, deviceSecret } = req.body;
  
  console.log(`[${timestamp}] Device ID: ${deviceId}`);
  console.log(`[${timestamp}] Received Secret: ${deviceSecret ? `${deviceSecret.substring(0, 8)}...` : 'MISSING'}`);
  console.log(`[${timestamp}] Expected Secret: ${process.env.DEVICE_SECRET ? `${process.env.DEVICE_SECRET.substring(0, 8)}...` : 'NOT SET'}`);
  console.log(`[${timestamp}] Secrets match: ${deviceSecret === process.env.DEVICE_SECRET}`);
  
  // Validate required fields
  if (!deviceId || !deviceSecret) {
    console.log(`[${timestamp}] ❌ Missing required fields`);
    return res.status(400).json({ 
      error: 'Missing deviceId or deviceSecret',
      received: { deviceId: !!deviceId, deviceSecret: !!deviceSecret }
    });
  }
  
  // Check if DEVICE_SECRET is configured
  if (!process.env.DEVICE_SECRET) {
    console.log(`[${timestamp}] ❌ Server DEVICE_SECRET not configured`);
    return res.status(500).json({ 
      error: 'Server configuration error: DEVICE_SECRET not set' 
    });
  }
  
  // Verify deviceSecret against server configuration
  if (deviceSecret !== process.env.DEVICE_SECRET) {
    console.log(`[${timestamp}] ❌ Authentication failed - invalid secret`);
    console.log(`[${timestamp}] Expected: "${process.env.DEVICE_SECRET}"`);
    console.log(`[${timestamp}] Received: "${deviceSecret}"`);
    
    return res.status(401).json({ 
      error: 'Unauthorized device',
      hint: 'Check DEVICE_SECRET in your Android app'
    });
  }
  
  const token = generateAuthToken();
  const tokenData = { 
    deviceId, 
    timestamp: Date.now(),
    expiresAt: Date.now() + (60 * 60 * 1000) // 1 hour
  };
  
  authTokens.set(token, tokenData);
  
  // Token expires in 1 hour
  setTimeout(() => {
    console.log(`[${new Date().toISOString()}] 🕒 Token expired for device: ${deviceId}`);
    authTokens.delete(token);
  }, 60 * 60 * 1000);
  
  console.log(`[${timestamp}] ✅ Authentication successful for device: ${deviceId}`);
  console.log(`[${timestamp}] Generated token: ${token.substring(0, 16)}...`);
  console.log(`[${timestamp}] Active tokens: ${authTokens.size}`);
  
  res.json({ 
    token, 
    expiresIn: 3600000,
    deviceId: deviceId
  });
});

// Add to server.js
app.post('/api/register-device', async (req, res) => {
    const { firebaseToken, deviceId } = req.body;
    
    try {
        const decodedToken = await firebaseAuth.verifyIdToken(firebaseToken);
        const userRef = db.collection('users').doc(decodedToken.uid);
        
        await userRef.update({
            ownedDevices: admin.firestore.FieldValue.arrayUnion(deviceId)
        });
        
        res.json({ success: true, deviceId });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});


// Middleware to verify auth token
async function verifyToken(socket, next) {
    const timestamp = new Date().toISOString();
    const token = socket.handshake.auth.token;
    const firebaseToken = socket.handshake.auth.firebaseToken; // New field
    const userAgent = socket.handshake.headers['user-agent'] || '';
    const isWebBrowser = userAgent.includes('Mozilla');

    console.log(`[${timestamp}] 🔐 Authentication attempt`);
    console.log(`[${timestamp}] Is web browser: ${isWebBrowser}`);
    console.log(`[${timestamp}] Has device token: ${token ? 'YES' : 'NO'}`);
    console.log(`[${timestamp}] Has Firebase token: ${firebaseToken ? 'YES' : 'NO'}`);

    // Web browser authentication (requires Firebase token)
    if (isWebBrowser) {
        if (!firebaseToken) {
            console.log(`[${timestamp}] ❌ Web browser missing Firebase token`);
            next(new Error('Authentication failed: Firebase token required'));
            return;
        }

        try {
            const decodedToken = await firebaseAuth.verifyIdToken(firebaseToken);
            const userDoc = await db.collection('users').doc(decodedToken.uid).get();
            
            if (!userDoc.exists) {
                throw new Error('User not found in database');
            }

            const userData = userDoc.data();
            
            socket.userId = decodedToken.uid;
            socket.userEmail = decodedToken.email;
            socket.userRole = userData.role || 'user';
            socket.ownedDevices = userData.ownedDevices || [];
            socket.isWebClient = true;
            socket.deviceId = 'web-frontend';
            
            console.log(`[${timestamp}] ✅ Web client authenticated: ${decodedToken.email}`);
            next();
            return;
            
        } catch (error) {
            console.log(`[${timestamp}] ❌ Firebase token verification failed:`, error.message);
            next(new Error('Authentication failed: Invalid Firebase token'));
            return;
        }
    }

    // Mobile device authentication (your existing logic stays the same)
    if (!token) {
        console.log(`[${timestamp}] ❌ No token provided (mobile device)`);
        next(new Error('Authentication failed: No token provided'));
        return;
    }

    if (!authTokens.has(token)) {
        console.log(`[${timestamp}] ❌ Invalid or expired token`);
        next(new Error('Authentication failed: Invalid or expired token'));
        return;
    }

    const authData = authTokens.get(token);
    const now = Date.now();

    if (now > authData.expiresAt) {
        console.log(`[${timestamp}] ❌ Token expired`);
        authTokens.delete(token);
        next(new Error('Token expired'));
        return;
    }

    socket.deviceId = authData.deviceId;
    socket.isWebClient = false;
    console.log(`[${timestamp}] ✅ Mobile device authenticated: ${authData.deviceId}`);
    
    next();
}

io.use(verifyToken);

io.on('connection', (socket) => {
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] === SOCKET CONNECTION ===`);
  console.log(`[${timestamp}] ✅ Client connected: ${socket.deviceId}`);
  console.log(`[${timestamp}] Socket ID: ${socket.id}`);
  console.log(`[${timestamp}] Is Web Client: ${socket.isWebClient || false}`);
  console.log(`[${timestamp}] Total active connections: ${io.engine.clientsCount}`);
  
  // Store session info only for mobile devices
  if (!socket.isWebClient) {
    activeSessions.set(socket.deviceId, {
      socketId: socket.id,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      isStreaming: false,
      lastFrame: null
    });
  }
  
  // Send current streaming state to new web clients
  if (socket.isWebClient) {
    const streamingDevices = Array.from(activeSessions.entries())
      .filter(([_, session]) => session.isStreaming)
      .map(([deviceId, session]) => ({
        deviceId,
        isStreaming: session.isStreaming,
        lastFrame: session.lastFrame
      }));
    
    socket.emit('streaming-status', {
      devices: streamingDevices
    });
  }
  
  // Handle start streaming request from web frontend
  socket.on('start-streaming', (data) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] 📡 Start streaming request from web for device: ${data.deviceId}`);
    
    const targetSocket = findSocketByDeviceId(data.deviceId);
    if (targetSocket && !targetSocket.isWebClient) {
      // Update session state
      const session = activeSessions.get(data.deviceId);
      if (session) {
        session.isStreaming = true;
      }
      
      // Send command to mobile device
      targetSocket.emit('start-streaming-command');
      
      // Notify all web clients of state change
      io.sockets.sockets.forEach((clientSocket) => {
        if (clientSocket.isWebClient) {
          clientSocket.emit('streaming-state-changed', {
            deviceId: data.deviceId,
            isStreaming: true
          });
        }
      });
      
      console.log(`[${timestamp}] ✅ Start streaming command sent to device: ${data.deviceId}`);
    } else {
      socket.emit('command-error', { error: 'Device not found', deviceId: data.deviceId });
    }
  });
  
  // Handle stop streaming request from web frontend
  socket.on('stop-streaming', (data) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] 📡 Stop streaming request from web for device: ${data.deviceId}`);
    
    const targetSocket = findSocketByDeviceId(data.deviceId);
    if (targetSocket && !targetSocket.isWebClient) {
      // Update session state
      const session = activeSessions.get(data.deviceId);
      if (session) {
        session.isStreaming = false;
      }
      
      // Send command to mobile device
      targetSocket.emit('stop-streaming-command');
      
      // Notify all web clients of state change
      io.sockets.sockets.forEach((clientSocket) => {
        if (clientSocket.isWebClient) {
          clientSocket.emit('streaming-state-changed', {
            deviceId: data.deviceId,
            isStreaming: false
          });
        }
      });
      
      console.log(`[${timestamp}] ✅ Stop streaming command sent to device: ${data.deviceId}`);
    } else {
      socket.emit('command-error', { error: 'Device not found', deviceId: data.deviceId });
    }
  });
  
  // Handle streaming state changes from mobile devices
  socket.on('streaming-state-update', (data) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] 📱 Streaming state update from ${socket.deviceId}: ${data.isStreaming}`);
    
    // Update session state
    if (!socket.isWebClient) {
      const session = activeSessions.get(socket.deviceId);
      if (session) {
        session.isStreaming = data.isStreaming;
      }
    }
    
    // Notify all web clients of state change
    io.sockets.sockets.forEach((clientSocket) => {
      if (clientSocket.isWebClient) {
        clientSocket.emit('streaming-state-changed', {
          deviceId: socket.deviceId,
          isStreaming: data.isStreaming
        });
      }
    });
  });
  
  // Handle camera stream data from Android device
socket.on('camera-stream', (data) => {
  const now = Date.now();
  
  // Update session with minimal processing
  if (!socket.isWebClient) {
    const session = activeSessions.get(socket.deviceId);
    if (session) {
      session.lastActivity = now;
      
      // Memory management: clear old frame
      if (session.lastFrame) {
        delete session.lastFrame;
      }
      session.lastFrame = data.frame;
    }
  }
  
  // Minimal broadcast data
  const broadcastData = {
    deviceId: socket.deviceId,
    frame: data.frame,
    timestamp: now
  };
  
  // Direct emission to web clients (most efficient)
  for (const [socketId, clientSocket] of io.sockets.sockets) {
    if (clientSocket.isWebClient) {
      clientSocket.compress(true).emit('camera-feed', broadcastData);
    }
  }
});
  
  // Handle snapshot request from frontend
  socket.on('request-snapshot', (data) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] 📸 Snapshot requested for device ${data.deviceId || 'unknown'}`);
    console.log(`[${timestamp}] Request from: ${socket.isWebClient ? 'Web Frontend' : socket.deviceId}`);
    console.log(`[${timestamp}] Request data:`, data);
    
    const targetDeviceId = data.deviceId;
    const session = activeSessions.get(targetDeviceId);
    
    if (session) {
      if (session.isStreaming) {
        // If streaming, request fresh snapshot from device
        const targetSocket = findSocketByDeviceId(targetDeviceId);
        if (targetSocket && !targetSocket.isWebClient) {
          targetSocket.emit('take-snapshot', {
            ...data,
            requestId: crypto.randomBytes(8).toString('hex')
          });
          console.log(`[${timestamp}] 📤 Fresh snapshot request forwarded to device: ${targetDeviceId}`);
        } else {
          socket.emit('snapshot-error', { error: 'Device not found', deviceId: targetDeviceId });
        }
      } else if (session.lastFrame) {
        // If not streaming but have last frame, return that
        socket.emit('snapshot-ready', {
          deviceId: targetDeviceId,
          imageData: session.lastFrame,
          timestamp: Date.now(),
          isLastFrame: true
        });
        console.log(`[${timestamp}] 📷 Last frame sent as snapshot for device: ${targetDeviceId}`);
      } else {
        // No frame available
        socket.emit('snapshot-error', { 
          error: 'No frame available', 
          deviceId: targetDeviceId,
          message: 'Device has no current or last frame available'
        });
      }
    } else {
      console.log(`[${timestamp}] ❌ Target device not found: ${targetDeviceId}`);
      socket.emit('snapshot-error', { error: 'Device not found', deviceId: targetDeviceId });
    }
  });
  
  // Handle snapshot data from Android device
  socket.on('snapshot-data', (data) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] 📷 Snapshot data received from ${socket.deviceId}`);
    console.log(`[${timestamp}] Image data size: ${data.imageData ? `${data.imageData.length} chars` : 'missing'}`);
    
    // Forward snapshot to frontend clients only
    const snapshotData = {
      deviceId: socket.deviceId,
      imageData: data.imageData,
      timestamp: Date.now()
    };
    
    // Send to web clients only
    io.sockets.sockets.forEach((clientSocket) => {
      if (clientSocket.isWebClient) {
        clientSocket.emit('snapshot-ready', snapshotData);
      }
    });
    
    console.log(`[${timestamp}] 📨 Snapshot forwarded to web frontend clients`);
  });
  
  // Handle WebRTC signaling
  socket.on('offer', (data) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] 🤝 WebRTC offer received from ${socket.deviceId}`);
    socket.broadcast.emit('offer', data);
  });
  
  socket.on('answer', (data) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] 🤝 WebRTC answer received from ${socket.deviceId}`);
    socket.broadcast.emit('answer', data);
  });
  
  socket.on('ice-candidate', (data) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] 🧊 ICE candidate received from ${socket.deviceId}`);
    socket.broadcast.emit('ice-candidate', data);
  });
  
  // Handle socket errors
  socket.on('error', (error) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ❌ Socket error for client ${socket.deviceId}:`, error);
  });
  
  socket.on('disconnect', (reason) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] === SOCKET DISCONNECTION ===`);
    console.log(`[${timestamp}] ❌ Client disconnected: ${socket.deviceId}`);
    console.log(`[${timestamp}] Reason: ${reason}`);
    console.log(`[${timestamp}] Total active connections: ${io.engine.clientsCount - 1}`);
    
    // Remove session only for mobile devices
    if (!socket.isWebClient) {
      activeSessions.delete(socket.deviceId);
    }
  });
  
  // Send welcome message
  const welcomeMessage = {
    message: socket.isWebClient ? 
      'Web frontend connected to camera stream server' : 
      'Device successfully connected to camera stream server',
    deviceId: socket.deviceId,
    isWebClient: socket.isWebClient || false,
    serverTime: Date.now()
  };
  
  socket.emit('connected', welcomeMessage);
});

// Helper function to find socket by device ID
function findSocketByDeviceId(deviceId) {
  for (const [id, socket] of io.sockets.sockets) {
    if (socket.deviceId === deviceId && !socket.isWebClient) {
      return socket;
    }
  }
  return null;
}

// Health check endpoint with detailed info
app.get('/api/health', (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 🏥 Health check requested`);
  
  const healthData = { 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    activeSessions: activeSessions.size,
    activeTokens: authTokens.size,
    socketConnections: io.engine.clientsCount,
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
  
  console.log(`[${timestamp}] Health status:`, {
    activeSessions: healthData.activeSessions,
    activeTokens: healthData.activeTokens,
    socketConnections: healthData.socketConnections
  });
  
  res.json(healthData);
});

// Get active devices with detailed info
app.get('/api/devices', (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 📱 Device list requested`);
  
  const devices = Array.from(activeSessions.entries()).map(([deviceId, session]) => ({
    deviceId,
    connectedAt: session.connectedAt,
    lastActivity: session.lastActivity,
    socketId: session.socketId,
    isActive: (Date.now() - session.lastActivity) < 30000 // Active within 30 seconds
  }));
  
  console.log(`[${timestamp}] Returning ${devices.length} devices:`, 
    devices.map(d => `${d.deviceId} (${d.isActive ? 'active' : 'inactive'})`));
  
  res.json({ devices, count: devices.length });
});

// Debug endpoint to show current tokens (be careful in production!)
if (process.env.NODE_ENV !== 'production') {
  app.get('/api/debug/tokens', (req, res) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] 🔍 Debug tokens requested`);
    
    const tokens = Array.from(authTokens.entries()).map(([token, data]) => ({
      tokenPreview: `${token.substring(0, 16)}...`,
      deviceId: data.deviceId,
      createdAt: new Date(data.timestamp).toISOString(),
      expiresAt: new Date(data.expiresAt).toISOString(),
      isExpired: Date.now() > data.expiresAt
    }));
    
    res.json({ tokens, count: tokens.length });
  });
}

// Error handling middleware
app.use((error, req, res, next) => {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ❌ Unhandled error:`, error);
  res.status(500).json({ error: 'Internal server error', timestamp });
});

// 404 handler
app.use((req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ❌ 404 - Route not found: ${req.method} ${req.path}`);
  res.status(404).json({ 
    error: 'Route not found', 
    path: req.path, 
    method: req.method,
    timestamp 
  });
});

const PORT = process.env.PORT || 3001;

// Only start server if not in test environment
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`
🚀 Camera Stream Server Started!
📍 Port: ${PORT}
🔑 Device Secret: ${process.env.DEVICE_SECRET ? 'Configured' : '❌ NOT SET'}
🌐 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}
📊 Environment: ${process.env.NODE_ENV || 'development'}

Available endpoints:
- GET  /api/health     - Server health check
- POST /api/authenticate - Device authentication
- GET  /api/devices    - List active devices
${process.env.NODE_ENV !== 'production' ? '• GET  /api/debug/tokens - Debug tokens (dev only)' : ''}

🎯 Ready to accept connections!
`);
    
    if (!process.env.DEVICE_SECRET) {
      console.log('⚠️  WARNING: DEVICE_SECRET environment variable is not set!');
      console.log('   Set it with: export DEVICE_SECRET="your-secret-here"');
    }
  });

  // Run cleanup every 5 minutes
setInterval(cleanupInactiveSessions, 5 * 60 * 1000);

function logMemoryUsage() {
  const usage = process.memoryUsage();
  console.log(`📊 Memory: ${Math.round(usage.heapUsed / 1024 / 1024)}MB used, ${activeSessions.size} sessions, ${frameTimestamps.size} frame buffers`);
}

// Log memory every 2 minutes
setInterval(logMemoryUsage, 2 * 60 * 1000);
}

function cleanupInactiveSessions() {
  const now = Date.now();
  const INACTIVE_TIMEOUT = 10 * 60 * 1000; // 10 minutes
  
  for (const [deviceId, session] of activeSessions.entries()) {
    if (now - session.lastActivity > INACTIVE_TIMEOUT) {
      console.log(`🧹 Cleaning up inactive session: ${deviceId}`);
      
      // Clear the large frame data
      if (session.lastFrame) {
        delete session.lastFrame;
      }
      
      activeSessions.delete(deviceId);
    }
  }
  
  // Also cleanup frame timestamps
  for (const deviceId of frameTimestamps.keys()) {
    if (!activeSessions.has(deviceId)) {
      frameTimestamps.delete(deviceId);
    } 
  }
}



// module.exports = { app, server };
// Export for testing
module.exports = { app, server, io };