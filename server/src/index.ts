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
import https from 'https';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'fs';
import { Server as SocketIOServer } from 'socket.io';

import { env } from './config/env.js';
import { authenticate, authorizeRoles } from './middleware/auth.js';
import { generalApiLimiter } from './middleware/rateLimiter.js';
import authRoutes from './routes/auth.routes.js';
import customerRoutes from './routes/customer.routes.js';
import agentRoutes from './routes/agent.routes.js';
import callRoutes from './routes/call.routes.js';
import knowledgeRoutes from './routes/knowledge.routes.js';
import ticketRoutes from './routes/ticket.routes.js';
import telephonyRoutes from './routes/telephony.routes.js';
import voiceRoutes from './routes/voice.routes.js';
import sentimentRoutes from './routes/sentiment.routes.js';
import followUpRoutes from './routes/followUp.routes.js';
import knowledgeGapRoutes from './routes/knowledgeGap.routes.js';
import biRoutes from './routes/bi.routes.js';
import recordingsRoutes from './routes/recordings.routes.js';
import { initSocketServer } from './services/socket.js';
import { initBiScheduler } from './services/biScheduler.js';
import { knowledgeService } from './services/knowledge.js';
import { seedDatabase } from './seed.js';

const app = express();

// Configure trust proxy
const trustProxyConfig = process.env.TRUST_PROXY || 'loopback';
app.set('trust proxy', trustProxyConfig === 'true' ? true : trustProxyConfig === 'false' ? false : trustProxyConfig);

// Enforce HTTPS in production when configured
if (process.env.NODE_ENV === 'production' && (process.env.FORCE_HTTPS === 'true' || process.env.HTTPS === 'true')) {
  app.use((req, res, next) => {
    if (!req.secure && req.headers['x-forwarded-proto'] !== 'https') {
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      return res.redirect(301, `https://${host}${req.originalUrl}`);
    }
    next();
  });
}

// Configure HTTP or HTTPS server
let server: http.Server | https.Server;
const isHttpsRequested = process.env.HTTPS === 'true';
const sslKeyPath = process.env.SSL_KEY_PATH;
const sslCertPath = process.env.SSL_CERT_PATH;
const sslPfxPath = process.env.SSL_PFX_PATH || 'ssl/server.pfx';
const sslPassphrase = process.env.SSL_PASSPHRASE || 'kaira123';

const resolvedPfx = path.resolve(process.cwd(), sslPfxPath);
const resolvedKey = sslKeyPath ? path.resolve(process.cwd(), sslKeyPath) : '';
const resolvedCert = sslCertPath ? path.resolve(process.cwd(), sslCertPath) : '';

let activeProtocol = 'http';

if (isHttpsRequested) {
  if (resolvedKey && resolvedCert && fs.existsSync(resolvedKey) && fs.existsSync(resolvedCert)) {
    server = https.createServer({
      key: fs.readFileSync(resolvedKey),
      cert: fs.readFileSync(resolvedCert)
    }, app);
    activeProtocol = 'https';
    console.log('🔒 HTTPS server active (Loaded PEM SSL key & certificate)');
  } else if (fs.existsSync(resolvedPfx)) {
    server = https.createServer({
      pfx: fs.readFileSync(resolvedPfx),
      passphrase: sslPassphrase
    }, app);
    activeProtocol = 'https';
    console.log('🔒 HTTPS server active (Loaded PFX SSL certificate)');
  } else {
    console.warn('⚠️ HTTPS=true requested, but SSL files not found. Defaulting to HTTP server.');
    server = http.createServer(app);
  }
} else {
  server = http.createServer(app);
}

// Recognize Cloudflare Quick Tunnel dynamic hostnames (https://*.trycloudflare.com)
const isAllowedTunnelOrigin = (originUrl: string): boolean => {
  return /^https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com$/.test(originUrl);
};

const rawAllowedOrigins = [
  env.FRONTEND_URL,
  process.env.CLIENT_URL,
  process.env.PUBLIC_URL,
  process.env.TUNNEL_URL,
  'http://localhost:5173',
  'https://localhost:5173',
  'http://127.0.0.1:5173',
  'https://127.0.0.1:5173',
  'http://localhost:5000',
  'https://localhost:5000',
  'http://127.0.0.1:5000',
  'https://127.0.0.1:5000',
  'http://localhost:3000',
  'https://localhost:3000'
].filter(Boolean) as string[];

// 1. Disable server fingerprinting
app.disable('x-powered-by');

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
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const isProd = env.NODE_ENV === 'production';
    if (rawAllowedOrigins.includes(origin) || isAllowedTunnelOrigin(origin)) {
      return callback(null, true);
    }
    if (!isProd && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
      return callback(null, true);
    }
    callback(new Error(`Blocked by CORS policy: Origin ${origin} not allowed.`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Twilio-Signature']
};

app.use(cors(corsOptions));

// 4. Request Parsers with Payload Limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 5. Rate Limiting for all API endpoints
app.use('/api/', generalApiLimiter);

// 6. Configure Socket.IO with origin security
const io = new SocketIOServer(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const isProd = env.NODE_ENV === 'production';
      if (rawAllowedOrigins.includes(origin) || isAllowedTunnelOrigin(origin)) {
        return callback(null, true);
      }
      if (!isProd && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
        return callback(null, true);
      }
      callback(new Error('Blocked by Socket.IO CORS'));
    },
    credentials: true
  }
});

app.set('io', io);

// Authenticated Knowledge Base Document Access
const uploadDir = path.resolve(process.cwd(), 'uploads');
app.get('/uploads/:filename', authenticate, authorizeRoles('admin', 'agent'), (req, res) => {
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
app.use('/api/follow-up-tasks', followUpRoutes);
app.use('/api/knowledge-gaps', knowledgeGapRoutes);
app.use('/api/admin/bi', biRoutes);
app.use('/api/recordings', recordingsRoutes);
app.use('/api/admin/recordings', recordingsRoutes);

// Dev-only Team Sync API (Strictly never mounted in production)
if (process.env.NODE_ENV !== 'production') {
  try {
    const devSyncRoutes = (await import('./routes/dev-sync.routes.js')).default;
    app.use('/api/dev/git', devSyncRoutes);
  } catch (err) {
    // optional module
  }
}

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
  if (err.message && err.message.includes('CORS')) {
    res.status(403).json({ error: 'Origin forbidden by CORS policy.' });
    return;
  }
  console.error('[Unhandled Server Error]:', err.message || err);
  res.status(500).json({
    error: env.NODE_ENV === 'production' ? 'Internal server error.' : (err.message || 'An unexpected error occurred.')
  });
});

// Initialize Socket.io events and signaling
initSocketServer(io);

const PORT = env.PORT || 5000;

server.listen(PORT, async () => {
  console.log(`===============================================`);
  console.log(`🚀 KAIRA Platform Backend Running on ${activeProtocol}://localhost:${PORT}`);
  console.log(`🔒 Security Hardened (Helmet, CORS, Rate Limits, RBAC)`);
  console.log(`📍 Health Check: http://localhost:${PORT}/api/health`);
  console.log(`===============================================`);

  // Ensure default Admin, Agent, and KB records are initialized
  try {
    await seedDatabase();
    initBiScheduler();
    // Warm up AI knowledge engine on server startup for instant sub-second response
    await knowledgeService.warmup();
  } catch (err) {
    console.error('Failed to run initial database seed:', err);
  }
});
