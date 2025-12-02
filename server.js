import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import createRoutes from './routes/create/createRoutes.js';
import authController from './routes/create/controllers/authController.js';
import { passport } from './routes/create/middleware/passport.js';
import connectDB from './routes/create/config/database.js';
import mongoose from 'mongoose';
import StorageMonitor from './routes/create/services/storageMonitor.js';

// ES6 __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
dotenv.config();

console.log('🚀 Starting TLEF-CREATE server...');
console.log('📦 Environment:', process.env.NODE_ENV || 'development');
console.log('🔌 Port:', process.env.PORT || 7736);
console.log('🌐 Frontend URL:', process.env.FRONTEND_URL || 'not set');

// Connect to database
console.log('🔗 Connecting to MongoDB...');
connectDB().catch(err => {
  console.error('❌ Failed to connect to MongoDB:', err.message);
  // Don't exit immediately in production to allow health checks
  if (process.env.NODE_ENV !== 'production') {
    process.exit(1);
  }
});

const app = express();
const PORT = process.env.PORT || 7736;

// CORS configuration for frontend integration
// In production, strip port numbers from FRONTEND_URL as they shouldn't be in browser requests
let corsOrigin;
if (process.env.NODE_ENV === 'production') {
  if (process.env.FRONTEND_URL) {
    // Remove port from URL (e.g., https://domain.com:8092 -> https://domain.com)
    corsOrigin = process.env.FRONTEND_URL.replace(/:\d+$/, '');
    console.log('🔒 CORS origin set to:', corsOrigin);
  } else {
    corsOrigin = true; // Allow same-origin
  }
} else {
  corsOrigin = ['http://localhost:3000', 'http://localhost:8080', 'http://localhost:8081', 'http://localhost:8090', 'http://localhost:8092', 'http://localhost:8093'];
}

app.use(cors({
  origin: corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware - limits for file uploads (reduced from 100mb to 50mb for safety)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Session middleware for passport
// For staging/production behind proxy, we need to trust the proxy
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1); // Trust first proxy (nginx)
}

// HARDCODED FIX FOR STAGING: Disable secure cookies for staging environment
const isStaging = process.env.NODE_ENV === 'production' && 
                  (process.env.FRONTEND_URL?.includes('staging') || 
                   process.env.PORT === '8090');

app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // HARDCODED: Disable secure cookies for staging to fix auth
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax' // Protect against CSRF
  },
  name: 'tlef.sid' // Custom session name
}));

// Initialize passport
app.use(passport.initialize());
app.use(passport.session());

// Health check endpoint (before other routes for priority)
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    port: PORT,
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Test endpoint to verify nginx routing
app.get('/api/test', (_req, res) => {
  res.json({
    message: 'Backend is working!',
    timestamp: new Date().toISOString(),
    server: 'TLEF-CREATE Staging'
  });
});

// HARDCODED: Debug middleware for staging - always on for debugging auth issues
if (process.env.NODE_ENV === 'production') {
  app.use((req, _res, next) => {
    // Only log API auth endpoints to reduce noise
    if (req.path.includes('/auth/')) {
      console.log('🔍 Auth Request:', req.method, req.path);
      console.log('🍪 Cookies:', req.cookies);
      console.log('📦 Session ID:', req.sessionID);
      console.log('👤 User:', req.user ? req.user.cwlId : 'none');
      console.log('✅ Authenticated:', req.isAuthenticated ? req.isAuthenticated() : false);
    }
    next();
  });
}

// Mount auth routes at root level for SAML compatibility (docker-simple-saml expects /auth/saml/callback)
app.use('/auth', authController);

// Mount the API router for non-auth routes
app.use('/api/create', createRoutes);

// Serve static files from dist in production
if (process.env.NODE_ENV === 'production') {
  // Log static file serving for debugging
  console.log('📁 Serving static files from:', path.join(__dirname, 'dist'));
  
  // Serve static files
  app.use(express.static(path.join(__dirname, 'dist')));
  
  // Handle SPA routing - serve index.html for all non-API routes
  app.get('*', (req, res) => {
    // Don't serve SPA for API routes
    if (req.path.startsWith('/api/')) {
      console.log('❌ API endpoint not found:', req.path);
      return res.status(404).json({ error: 'API endpoint not found' });
    }
    const indexPath = path.join(__dirname, 'dist', 'index.html');
    console.log('📄 Serving index.html for:', req.path);
    res.sendFile(indexPath);
  });
} else {
  // Development mode - show server status
  app.get('/', (_req, res) => {
    res.json({
      message: 'TLEF Web Server is running in development mode',
      api: `/api/create`,
      frontend: 'Run `npm run dev` for frontend development server'
    });
  });
}

// Error handling middleware
app.use((err, _req, res, _next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message
  });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server is running on http://localhost:${PORT}`);
  console.log(`📡 Health check available at http://localhost:${PORT}/health`);
  console.log(`🎯 CREATE app API available at http://localhost:${PORT}/api/create`);
  
  // Start storage monitoring (only in production to avoid development clutter)
  if (process.env.NODE_ENV === 'production') {
    StorageMonitor.startMonitoring();
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM signal received: closing HTTP server');
  server.close(async () => {
    console.log('🔴 HTTP server closed');
    // Mongoose 8+ doesn't accept callbacks for close()
    await mongoose.connection.close();
    console.log('🔴 MongoDB connection closed');
    process.exit(0);
  });
});