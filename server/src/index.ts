import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables before any other module executes
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

import express from 'express';
import http from 'http';
import cors from 'cors';
import fs from 'fs';
import { Server as SocketIOServer } from 'socket.io';

import { validateJwtConfig, authenticate, requireRole } from './middleware/auth.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import authRoutes from './routes/auth.routes.js';
import customerRoutes from './routes/customer.routes.js';
import agentRoutes from './routes/agent.routes.js';
import callRoutes from './routes/call.routes.js';
import knowledgeRoutes from './routes/knowledge.routes.js';
import ticketRoutes from './routes/ticket.routes.js';
import telephonyRoutes from './routes/telephony.routes.js';
import voiceRoutes from './routes/voice.routes.js';
import followUpRoutes from './routes/followUp.routes.js';
import knowledgeGapRoutes from './routes/knowledgeGap.routes.js';
import { initSocketServer } from './services/socket.js';
import { seedDatabase } from './seed.js';

// Pre-flight Security Verification: Stop server from starting if JWT secret is missing or insecure
try {
  validateJwtConfig();
} catch (err: any) {
  console.error('\n======================================================');
  console.error('❌ FATAL SECURITY CONFIGURATION ERROR:');
  console.error(err.message);
  console.error('======================================================\n');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);

// Strict CORS Whitelist Configuration
const rawAllowedOrigins = [
  process.env.CLIENT_URL,
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5000',
  'http://127.0.0.1:5000',
  'http://localhost:3000'
].filter(Boolean) as string[];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || rawAllowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(new Error('Blocked by CORS policy: Origin not allowed.'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Twilio-Signature']
};

// Configure Socket.IO with CORS
const io = new SocketIOServer(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || rawAllowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
        callback(null, true);
      } else {
        callback(new Error('Blocked by Socket.IO CORS'));
      }
    },
    credentials: true
  }
});

// Provide io instance to express app
app.set('io', io);

// Security and parsing middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Apply general API rate limiting to all /api endpoints
app.use('/api', apiLimiter);

// Authenticated Knowledge Base Document Access (REPLACES public /uploads static directory)
const uploadDir = path.resolve(process.cwd(), 'uploads');
app.get('/uploads/:filename', authenticate, requireRole(['admin', 'agent']), (req, res) => {
  const safeFilename = path.basename(req.params.filename);
  const targetPath = path.resolve(uploadDir, safeFilename);

  // Prevent path traversal attacks
  if (!targetPath.startsWith(uploadDir)) {
    res.status(403).json({ error: 'Access denied: Directory traversal blocked.' });
    return;
  }

  if (!fs.existsSync(targetPath)) {
    res.status(404).json({ error: 'Requested document not found.' });
    return;
  }

  res.sendFile(targetPath);
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/telephony', telephonyRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/follow-up-tasks', followUpRoutes);
app.use('/api/knowledge-gaps', knowledgeGapRoutes);

// Dev-only Team Sync API (Strictly never mounted in production)
if (process.env.NODE_ENV !== 'production') {
  try {
    const devSyncRoutes = (await import('./routes/dev-sync.routes.js')).default;
    app.use('/api/dev/git', devSyncRoutes);
  } catch (err) {
    console.warn('[DevSync] Failed to mount dev-sync routes:', err);
  }
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'KAIRA Voice Agent Platform',
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

// Centralized Safe Error Handling Middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Unhandled Server Error]', err.message || err);
  const isProd = process.env.NODE_ENV === 'production';
  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    error: isProd ? 'Internal server error. Please try again later.' : (err.message || 'An unexpected error occurred.')
  });
});

// Initialize Socket.io events and signaling
initSocketServer(io);

const PORT = process.env.PORT || 5000;

server.listen(PORT, async () => {
  console.log(`===============================================`);
  console.log(`🚀 KAIRA Platform Backend Running on port ${PORT}`);
  console.log(`📍 Health Check: http://localhost:${PORT}/api/health`);
  console.log(`🔒 Security Baseline: JWT verification active, uploads protected`);
  console.log(`===============================================`);

  // Ensure default Admin, Agent, and KB records are initialized
  try {
    await seedDatabase();
  } catch (err) {
    console.error('Failed to run initial database seed:', err);
  }
});
