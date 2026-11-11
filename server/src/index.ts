import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server as SocketIOServer } from 'socket.io';

import { env } from './config/env.js';
import authRoutes from './routes/auth.routes.js';
import customerRoutes from './routes/customer.routes.js';
import agentRoutes from './routes/agent.routes.js';
import callRoutes from './routes/call.routes.js';
import knowledgeRoutes from './routes/knowledge.routes.js';
import ticketRoutes from './routes/ticket.routes.js';
import telephonyRoutes from './routes/telephony.routes.js';
import voiceRoutes from './routes/voice.routes.js';
import sentimentRoutes from './routes/sentiment.routes.js';
import { generalApiLimiter } from './middleware/rateLimiter.js';
import { initSocketServer } from './services/socket.js';
import { seedDatabase } from './seed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// 1. Production Security Configuration
app.disable('x-powered-by');

// Trusted proxy setting (only when explicitly behind reverse proxy)
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// 2. Helmet HTTP Security Headers & Content Security Policy
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          'https://accounts.google.com',
          'https://apis.google.com'
        ],
        connectSrc: [
          "'self'",
          'http:',
          'https:',
          'ws:',
          'wss:',
          'https://accounts.google.com',
          'https://oauth2.googleapis.com'
        ],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://*.googleusercontent.com', 'https://accounts.google.com'],
        mediaSrc: ["'self'", 'data:', 'blob:'],
        frameSrc: ["'self'", 'https://accounts.google.com']
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    hsts:
      env.NODE_ENV === 'production'
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false
  })
);

// 3. Strict CORS Whitelist
const allowedOrigins = [
  env.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:5000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5000'
].filter(Boolean);

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests (e.g. mobile apps, server-to-server, curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(corsOptions));

// 4. Request Parsers with Payload Limits to prevent denial-of-service
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// 5. Rate Limiting for all API endpoints
app.use('/api/', generalApiLimiter);

// 6. Configure Socket.IO with origin security
const io = new SocketIOServer(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || env.NODE_ENV === 'development') {
        return callback(null, true);
      }
      return callback(new Error('WebSocket connection rejected by CORS policy.'));
    },
    methods: ['GET', 'POST'],
    credentials: true
  }
});

app.set('io', io);

// Serve uploaded documents safely
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// 7. API Routes
app.use('/api/auth', authRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/telephony', telephonyRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/sentiment', sentimentRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'KAIRA Voice Agent Platform',
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

// Serve frontend build if in production
const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
    return next();
  }
  res.sendFile(path.join(clientDist, 'index.html'), err => {
    if (err) next();
  });
});

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.name === 'MulterError') {
    res.status(400).json({ error: `File upload error: ${err.message}` });
    return;
  }
  if (err.message && err.message.includes('CORS blocked')) {
    res.status(403).json({ error: 'Origin forbidden by CORS policy.' });
    return;
  }
  console.error('[Unhandled Server Error]:', err.message);
  res.status(500).json({
    error: env.NODE_ENV === 'production' ? 'Internal server error.' : err.message
  });
});

// Initialize Socket.io events and signaling
initSocketServer(io);

const PORT = env.PORT;

server.listen(PORT, async () => {
  console.log(`===============================================`);
  console.log(`🚀 KAIRA Platform Backend Running on port ${PORT}`);
  console.log(`🔒 Security Hardened (Helmet, CORS, Rate Limits, RBAC)`);
  console.log(`📍 Health Check: http://localhost:${PORT}/api/health`);
  console.log(`===============================================`);

  // Ensure default Admin, Agent, and KB records are initialized
  try {
    await seedDatabase();
  } catch (err) {
    console.error('Failed to run initial database seed:', err);
  }
});
