import express from 'express';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server as SocketIOServer } from 'socket.io';

import authRoutes from './routes/auth.routes.js';
import customerRoutes from './routes/customer.routes.js';
import callRoutes from './routes/call.routes.js';
import knowledgeRoutes from './routes/knowledge.routes.js';
import { initSocketServer } from './services/socket.js';
import { seedDatabase } from './seed.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// Configure Socket.IO with CORS
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded documents
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/knowledge', knowledgeRoutes);

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

// Initialize Socket.io events and signaling
initSocketServer(io);

const PORT = process.env.PORT || 5000;

server.listen(PORT, async () => {
  console.log(`===============================================`);
  console.log(`🚀 KAIRA Platform Backend Running on port ${PORT}`);
  console.log(`📍 Health Check: http://localhost:${PORT}/api/health`);
  console.log(`===============================================`);

  // Ensure default Admin, Agent, and KB records are initialized
  try {
    await seedDatabase();
  } catch (err) {
    console.error('Failed to run initial database seed:', err);
  }
});
