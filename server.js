import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import createRoutes from './routes/create/createRoutes.js';
import biocbotRoutes from './routes/biocbot/biocbotRoutes.js';
import { passport } from './routes/create/middleware/passport.js';
import connectDB from './routes/create/config/database.js';

// ES6 __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
dotenv.config();

// Connect to database
connectDB();

const app = express();
const PORT = process.env.PORT || 7736;

// CORS configuration for frontend integration
const corsOrigin = process.env.NODE_ENV === 'production'
  ? process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/:[\d]+$/, '') : true  // Remove port from FRONTEND_URL if present
  : ['http://localhost:3000', 'http://localhost:8080', 'http://localhost:8081', 'http://localhost:8090', 'http://localhost:8092', 'http://localhost:8093'];

app.use(cors({
  origin: corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Session middleware for passport
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Initialize passport
app.use(passport.initialize());
app.use(passport.session());

// Mount the API routers
app.use('/api/create', createRoutes);
app.use('/api/biocbot', biocbotRoutes);

// Serve static files from dist in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist')));
  
  // Handle SPA routing - serve index.html for all non-API routes
  app.get('*', (req, res) => {
    // Don't serve SPA for API routes
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
} else {
  // Development mode - show server status
  app.get('/', (req, res) => {
    res.json({
      message: 'TLEF Web Server is running in development mode',
      apis: {
        create: `/api/create`,
        biocbot: `/api/biocbot`
      },
      frontend: 'Run `npm run dev` for frontend development server'
    });
  });
}

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`CREATE app API available at http://localhost:${PORT}/api/create`);
  console.log(`BIOCBOT app API available at http://localhost:${PORT}/api/biocbot`);
});