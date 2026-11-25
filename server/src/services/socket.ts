import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../db.js';
import { getJwtSecret } from '../middleware/auth.js';
import { knowledgeService, FALLBACK_MESSAGE } from './knowledge.js';
import { translationService, SUPPORTED_LANGUAGES } from './translation.js';
import { sentimentService } from './sentiment.js';
import { callIntelligenceService } from './callIntelligence.js';
import { conversationAnalysisService } from './conversationAnalysis.service.js';
import { realtimeIntelligenceService } from './realtimeIntelligence.service.js';
import { CallQualityAlert } from './callQualityAlerts.js';
import { callReliabilityService } from './callReliability.js';
import { handoverService, HandoverReason } from './handover.service.js';
import { notificationService } from './notification.service.js';
import { sttService } from './stt/stt.service.js';

// Multi-turn conversational context memory for active calls
const activeCallContexts = new Map<string, Array<{ sender: 'customer' | 'ai'; text: string; timestamp: Date }>>();

// Session-level query locks and deduplication shield for AI voice calls
interface CallQueryLock {
  lastQueryText: string;
  lastQueryTime: number;
  lastClientMessageId?: string;
  inFlight: boolean;
  lastAnswer?: string;
  lastAnswerTime?: number;
}
const activeCallQueryLocks = new Map<string, CallQueryLock>();

export interface CallSessionState {
  callId: string;
  customerId: string | null;
  customerName: string;
  customerSocketId: string;
  language: string;
  speakerType: 'ai' | 'human_agent';
  humanSpeakerId: string | null;
  humanSpeakerName: string | null;
  greetingPlayed: boolean;
  greeting?: string;
  processedUtteranceIds: Set<string>;
  createdAt: number;
  awaitingCallbackConfirmation?: boolean;
  pendingHandoverReason?: HandoverReason;
  lastHandoverQuery?: string;
  suggestedCallbackPhone?: string;
}

/**
 * Server-Side Acoustic Echo Detection Shield
 * Prevents client microphone feedback (e.g. speakers playing greeting or AI response)
 * from ever triggering an AI query or polluting database transcripts.
 */
function isServerSideAcousticEcho(queryText: string, recentAiUtterances: string[]): boolean {
  if (!queryText || queryText.length < 2) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const candNorm = norm(queryText);
  if (!candNorm) return false;

  const candWords = candNorm.split(/\s+/).filter(w => w.length >= 2);
  // Short conversational customer answers (<= 8 words and < 45 chars) are genuine replies (e.g., "Yes speaking, tell me more about Kaira"), never acoustic feedback
  if (candWords.length <= 8 && candNorm.length < 45) return false;

  for (const target of recentAiUtterances) {
    if (!target) continue;
    const targetNorm = norm(target);
    if (!targetNorm) continue;

    // 1. Direct match: candidate is a substantial substring of AI utterance (>= 30 chars)
    if (targetNorm.includes(candNorm) && candNorm.length >= 30) {
      return true;
    }

    // 2. High 3-gram match count (at least 2 matching 3-word shingles for longer text)
    if (candWords.length >= 6) {
      let trigramMatches = 0;
      for (let i = 0; i <= candWords.length - 3; i++) {
        const trigram = `${candWords[i]} ${candWords[i + 1]} ${candWords[i + 2]}`;
        if (targetNorm.includes(trigram)) {
          trigramMatches++;
        }
      }
      if (trigramMatches >= 2) {
        return true;
      }
    }

    // 3. High word overlap (at least 6 matching words AND >= 60% overlap)
    const targetWords = new Set(targetNorm.split(/\s+/).filter(w => w.length >= 2));
    const matchingWords = candWords.filter(w => targetWords.has(w));
    const matchRatio = matchingWords.length / candWords.length;
    if (matchingWords.length >= 6 && matchRatio >= 0.60) {
      return true;
    }
  }

  return false;
}

export const callSessions = new Map<string, CallSessionState>();

interface ConnectedUser {
  socketId: string;
  userId: string;
  role: string;
  name: string;
  preferredLanguage: string;
  supportedLanguages: string[];
  agentStatus: 'available' | 'busy' | 'offline';
  activeCalls: Set<string>;
  maxConcurrentCalls: number;
}

interface QueuedCall {
  callId: string;
  callRecordId?: string;
  customerId: string | null;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  preferredLanguage: string;
  socketId: string;
  queuedAt: number;
  rejectedByAgents: Set<string>;
}

let activeSocketServer: SocketIOServer | null = null;

export function emitTicketNotification(rooms: string[], notification: { ticketId: string; kind: string; title: string; message: string }) {
  if (!activeSocketServer) return;
  for (const room of new Set(rooms)) activeSocketServer.to(room).emit('ticket:notification', notification);
}

export function emitCallQualityAlert(alert: CallQualityAlert) {
  activeSocketServer?.to('role:admin').emit('call-quality:alert', alert);
}

export interface AdminSession {
  adminSessionId: string;
  socketId: string;
  adminId: string;
  adminName: string;
  operatorName: string;
  status: 'available' | 'ringing' | 'busy' | 'offline';
  activeCallId: string | null;
  lastAssignedAt: number;
  connectedAt: number;
  supportedLanguages: string[];
}

export function initSocketServer(io: SocketIOServer) {
  activeSocketServer = io;

  // Authenticate socket connection via handshake token if provided
  io.use(async (socket: Socket, next) => {
    try {
      const token =
        (socket.handshake.auth && socket.handshake.auth.token) ||
        (socket.handshake.headers['authorization']?.replace(/^Bearer\s+/i, '')) ||
        (socket.handshake.query && (socket.handshake.query.token as string));

      if (token && typeof token === 'string' && token.trim()) {
        try {
          const decoded = jwt.verify(token.trim(), getJwtSecret(), { algorithms: ['HS256'] }) as any;
          if (decoded && decoded.id && decoded.role) {
            (socket as any).authenticatedUser = decoded;
          }
        } catch {
          // Token invalid or expired - allow connection for anonymous customer calls, but without authenticated status
        }
      }
      next();
    } catch {
      next();
    }
  });

  const connectedUsers = new Map<string, ConnectedUser>(); // socketId -> User
  const adminSessions = new Map<string, AdminSession>(); // adminSessionId -> AdminSession
  const socketToAdminSession = new Map<string, string>(); // socketId -> adminSessionId
  const queuedCalls: QueuedCall[] = []; // In-memory FIFO queue for waiting customers
  const ringingTimers = new Map<string, NodeJS.Timeout>(); // callId -> timeout

  // Helper to compile multi-admin presence & calling metrics
  const getAdminStats = () => {
    const all = Array.from(adminSessions.values()).filter(s => s.status !== 'offline');
    const available = all.filter(s => s.status === 'available' && !s.activeCallId);
    const busy = all.filter(s => s.status === 'busy' || s.status === 'ringing' || Boolean(s.activeCallId));
    const activeCallsCount = all.filter(s => Boolean(s.activeCallId)).length;

    return {
      activeAdminSessions: all.length,
      availableAdminSessions: available.length,
      busyAdminSessions: busy.length,
      activeCalls: activeCallsCount,
      operators: all.map(s => ({
        adminSessionId: s.adminSessionId,
        operatorName: s.operatorName,
        status: s.status,
        activeCallId: s.activeCallId
      }))
    };
  };

  const broadcastAdminStats = () => {
    const stats = getAdminStats();
    io.to('role:admin').emit('admin:sessions_updated', stats);
  };

  // Helper to find available Admin session using language prioritization and least-recently-assigned (ACD)
  const findNextAvailableAdminSession = (
    preferredLang?: string,
    excludeSessionIds: Set<string> = new Set()
  ): AdminSession | null => {
    const available = Array.from(adminSessions.values()).filter(
      s => s.status === 'available' && !s.activeCallId && !excludeSessionIds.has(s.adminSessionId)
    );

    if (available.length === 0) return null;

    // 1. Language match priority
    if (preferredLang) {
      const langMatches = available.filter(s => s.supportedLanguages.includes(preferredLang));
      if (langMatches.length > 0) {
        return langMatches.sort((a, b) => a.lastAssignedAt - b.lastAssignedAt)[0];
      }
    }

    // 2. Least recently assigned overall (FIFO round-robin)
    return available.sort((a, b) => a.lastAssignedAt - b.lastAssignedAt)[0];
  };

  // Helper to find available agent matching language preference or fallback
  const findAvailableAgent = (
    preferredLang: string,
    excludeAgentIds: Set<string> = new Set()
  ): ConnectedUser | null => {
    const agents = Array.from(connectedUsers.values()).filter(
      u =>
        (u.role === 'agent' || u.role === 'admin') &&
        u.agentStatus === 'available' &&
        u.activeCalls.size < u.maxConcurrentCalls &&
        !excludeAgentIds.has(u.userId)
    );

    if (agents.length === 0) return null;

    // 1. First priority: dedicated support agents directly matching customer language
    const directAgentMatch = agents.find(a =>
      a.role === 'agent' && a.supportedLanguages.includes(preferredLang)
    );
    if (directAgentMatch) return directAgentMatch;

    // 2. Second priority: any staff directly matching customer language
    const directAnyMatch = agents.find(a =>
      a.supportedLanguages.includes(preferredLang)
    );
    if (directAnyMatch) return directAnyMatch;

    // 3. Third priority: dedicated support agents with lowest call load
    const dedicatedAgents = agents.filter(a => a.role === 'agent');
    if (dedicatedAgents.length > 0) {
      return dedicatedAgents.sort((a, b) => a.activeCalls.size - b.activeCalls.size)[0];
    }

    // 4. Fallback: administrators if no support agents are online
    return agents.sort((a, b) => a.activeCalls.size - b.activeCalls.size)[0] || null;
  };

  // Helper to dispatch a call to an agent
  const dispatchCallToAgent = async (
    callId: string,
    agent: ConnectedUser,
    callData: {
      customerId: string | null;
      customerName: string;
      customerEmail?: string;
      customerPhone?: string;
      preferredLanguage: string;
      customerSocketId: string;
      callRecordId?: string;
    }
  ) => {
    try {
      console.log(`[CallDispatch] Dispatching call ${callId} to Agent ${agent.name} (${agent.userId})`);

      // Track active call on agent
      agent.activeCalls.add(callId);

      // Update or create DB record
      let record = await prisma.callRecord.findUnique({ where: { callId } });
      if (!record) {
        record = await prisma.callRecord.create({
          data: {
            callId,
            customerId: callData.customerId,
            customerName: callData.customerName,
            customerPhone: callData.customerPhone || null,
            agentId: agent.userId,
            agentName: agent.name,
            type: 'agent_voice',
            direction: 'incoming',
            status: 'ringing',
            language: callData.preferredLanguage,
            startTime: new Date()
          }
        });
      } else {
        record = await prisma.callRecord.update({
          where: { id: record.id },
          data: {
            status: 'ringing',
            agentId: agent.userId,
            agentName: agent.name,
            language: callData.preferredLanguage
          }
        });
      }

      // Send incoming call event to Agent
      io.to(agent.socketId).emit('agent:incoming_call', {
        callId,
        callRecordId: record.id,
        customerId: callData.customerId,
        customerName: callData.customerName,
        customerEmail: callData.customerEmail,
        customerPhone: callData.customerPhone || 'Not provided',
        preferredLanguage: callData.preferredLanguage,
        languageName: translationService.getLanguageName(callData.preferredLanguage),
        customerSocketId: callData.customerSocketId,
        startTime: Date.now()
      });

      // Send ringing notification to Customer
      io.to(callData.customerSocketId).emit('customer:call_ringing', {
        callId,
        agentName: agent.name,
        preferredLanguage: callData.preferredLanguage,
        languageName: translationService.getLanguageName(callData.preferredLanguage)
      });

      // Set ringing timeout (35 seconds)
      if (ringingTimers.has(callId)) {
        clearTimeout(ringingTimers.get(callId)!);
      }

      const timer = setTimeout(async () => {
        ringingTimers.delete(callId);
        console.log(`[RingingTimeout] Agent ${agent.name} did not answer call ${callId}`);

        // Remove from agent's active calls
        agent.activeCalls.delete(callId);
        io.to(agent.socketId).emit('agent:call_missed', { callId });

        // Try next agent
        const nextAgent = findAvailableAgent(callData.preferredLanguage, new Set([agent.userId]));
        if (nextAgent) {
          await dispatchCallToAgent(callId, nextAgent, callData);
        } else {
          // Place in queue
          enqueueCall({
            callId,
            callRecordId: record.id,
            customerId: callData.customerId,
            customerName: callData.customerName,
            customerPhone: callData.customerPhone,
            preferredLanguage: callData.preferredLanguage,
            socketId: callData.customerSocketId,
            queuedAt: Date.now(),
            rejectedByAgents: new Set([agent.userId])
          });
        }
      }, 35000);

      ringingTimers.set(callId, timer);
    } catch (err) {
      console.error('[CallDispatch] Error dispatching call:', err);
    }
  };

  // Helper to dispatch a call to a specific Admin Operator Session (Atomic Session-Level Lock)
  const dispatchCallToAdminSession = async (
    callId: string,
    session: AdminSession,
    callData: {
      customerId: string | null;
      customerName: string;
      customerEmail?: string;
      customerPhone?: string;
      preferredLanguage: string;
      customerSocketId: string;
      transferId?: string;
      question?: string;
      callRecordId?: string;
      duration?: number;
    }
  ) => {
    try {
      console.log(`[AdminDispatch] Dispatching call ${callId} to Admin Operator ${session.operatorName} (${session.adminSessionId})`);

      // Atomic lock on this operator session
      session.status = 'ringing';
      session.activeCallId = callId;
      session.lastAssignedAt = Date.now();
      broadcastAdminStats();

      // Find or create CallRecord in DB
      let record = await prisma.callRecord.findUnique({ where: { callId } });
      if (!record) {
        record = await prisma.callRecord.create({
          data: {
            callId,
            customerId: callData.customerId,
            customerName: callData.customerName,
            customerPhone: callData.customerPhone || null,
            adminId: session.adminId,
            adminName: session.adminName,
            adminSessionId: session.adminSessionId,
            adminOperatorName: session.operatorName,
            type: callData.transferId ? 'admin_transfer' : 'agent_voice',
            direction: 'incoming',
            status: 'ringing',
            language: callData.preferredLanguage,
            startTime: new Date()
          }
        });
      } else {
        record = await prisma.callRecord.update({
          where: { id: record.id },
          data: {
            status: 'ringing',
            adminId: session.adminId,
            adminName: session.adminName,
            adminSessionId: session.adminSessionId,
            adminOperatorName: session.operatorName,
            language: callData.preferredLanguage
          }
        });
      }

      // Send incoming call event ONLY to this assigned Admin session's socket
      io.to(session.socketId).emit('admin:incoming_call', {
        callId,
        callRecordId: record.id,
        transferId: callData.transferId,
        customerId: callData.customerId,
        customerName: callData.customerName,
        customerEmail: callData.customerEmail,
        customerPhone: callData.customerPhone || 'Not provided',
        preferredLanguage: callData.preferredLanguage,
        languageName: translationService.getLanguageName(callData.preferredLanguage),
        question: callData.question || 'Customer Support Call',
        customerSocketId: callData.customerSocketId,
        adminSessionId: session.adminSessionId,
        operatorName: session.operatorName,
        duration: callData.duration || 0,
        startTime: Date.now()
      });

      // Send ringing notification to Customer
      io.to(callData.customerSocketId).emit('customer:call_ringing', {
        callId,
        agentName: session.operatorName,
        preferredLanguage: callData.preferredLanguage,
        languageName: translationService.getLanguageName(callData.preferredLanguage)
      });

      // Set ringing timeout (25 seconds) - automatically fails over to next available admin
      if (ringingTimers.has(callId)) {
        clearTimeout(ringingTimers.get(callId)!);
      }

      const timer = setTimeout(async () => {
        ringingTimers.delete(callId);
        console.log(`[AdminTimeout] Admin ${session.operatorName} did not answer call ${callId}`);

        io.to(session.socketId).emit('admin:call_missed', { callId });
        session.status = 'available';
        session.activeCallId = null;
        broadcastAdminStats();

        // Reroute to next available Admin session
        const nextAdmin = findNextAvailableAdminSession(callData.preferredLanguage, new Set([session.adminSessionId]));
        if (nextAdmin) {
          console.log(`[AdminTimeout] Rerouting call ${callId} to next Admin ${nextAdmin.operatorName}`);
          await dispatchCallToAdminSession(callId, nextAdmin, callData);
        } else {
          console.log(`[AdminTimeout] All admins busy for call ${callId}, placing in queue`);
          enqueueCall({
            callId,
            callRecordId: record.id,
            customerId: callData.customerId,
            customerName: callData.customerName,
            customerPhone: callData.customerPhone,
            preferredLanguage: callData.preferredLanguage,
            socketId: callData.customerSocketId,
            queuedAt: Date.now(),
            rejectedByAgents: new Set([session.adminSessionId])
          });
        }
      }, 25000);

      ringingTimers.set(callId, timer);
    } catch (err) {
      console.error('[AdminDispatch] Error dispatching call to admin session:', err);
    }
  };

  // Helper to enqueue a customer call
  const enqueueCall = async (queued: QueuedCall) => {
    // Check if already in queue
    const existingIdx = queuedCalls.findIndex(q => q.callId === queued.callId);
    if (existingIdx >= 0) {
      queuedCalls[existingIdx] = queued;
    } else {
      queuedCalls.push(queued);
    }

    // Update DB status to queued
    try {
      await prisma.callRecord.upsert({
        where: { callId: queued.callId },
        update: { status: 'queued', language: queued.preferredLanguage },
        create: {
          callId: queued.callId,
          customerId: queued.customerId,
          customerName: queued.customerName,
          customerPhone: queued.customerPhone || null,
          type: 'agent_voice',
          direction: 'incoming',
          status: 'queued',
          language: queued.preferredLanguage,
          startTime: new Date()
        }
      });
    } catch (e) {
      console.error('[Queue] Error updating DB call status to queued:', e);
    }

    const pos = queuedCalls.findIndex(q => q.callId === queued.callId) + 1;
    io.to(queued.socketId).emit('customer:call_queued', {
      callId: queued.callId,
      queuePosition: pos,
      estimatedWaitTime: pos * 45
    });

    // Broadcast queue stats to admins and agents
    broadcastQueueStats();
  };

  // Broadcast queue count
  const broadcastQueueStats = () => {
    io.to('role:admin').to('role:agent').emit('queue:status_updated', {
      queueLength: queuedCalls.length,
      queuedCalls: queuedCalls.map((q, idx) => ({
        callId: q.callId,
        customerName: q.customerName,
        customerPhone: q.customerPhone,
        preferredLanguage: q.preferredLanguage,
        position: idx + 1,
        waitTime: Math.floor((Date.now() - q.queuedAt) / 1000)
      }))
    });
  };

  // Check waiting queue when an agent becomes available
  const checkWaitingQueueForAgent = async (agent: ConnectedUser) => {
    if (queuedCalls.length === 0) return;
    if (agent.agentStatus !== 'available' || agent.activeCalls.size >= agent.maxConcurrentCalls) return;

    // Find best matching queued call
    // Priority: language match first, then FIFO
    let matchIdx = queuedCalls.findIndex(
      q => agent.supportedLanguages.includes(q.preferredLanguage) && !q.rejectedByAgents.has(agent.userId)
    );

    if (matchIdx < 0) {
      matchIdx = queuedCalls.findIndex(q => !q.rejectedByAgents.has(agent.userId));
    }

    if (matchIdx >= 0) {
      const [nextCall] = queuedCalls.splice(matchIdx, 1);
      console.log(`[Queue] Dequeued call ${nextCall.callId} for Agent ${agent.name}`);

      // Dispatch
      await dispatchCallToAgent(nextCall.callId, agent, {
        customerId: nextCall.customerId,
        customerName: nextCall.customerName,
        customerEmail: nextCall.customerEmail,
        customerPhone: nextCall.customerPhone,
        preferredLanguage: nextCall.preferredLanguage,
        customerSocketId: nextCall.socketId,
        callRecordId: nextCall.callRecordId
      });

      // Update remaining customers in queue with their new positions
      queuedCalls.forEach((q, idx) => {
        io.to(q.socketId).emit('customer:queue_position_update', {
          queuePosition: idx + 1,
          estimatedWaitTime: (idx + 1) * 45
        });
      });

      broadcastQueueStats();
    }
  };

  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    // Register user with their role and user ID
    socket.on('user:register', async (data: {
      userId: string;
      role: string;
      name: string;
      token?: string;
      preferredLanguage?: string;
      supportedLanguages?: string[];
      agentStatus?: 'available' | 'busy';
    }) => {
      try {
        if (!data || !data.userId) return;

        // Query database to fetch up-to-date user preferences and verified role
        let dbUser = await prisma.user.findUnique({
          where: { id: data.userId }
        });

        // Cryptographic check: verify token if provided or attached
        const candidateToken = data.token || (socket as any).authenticatedUser?.token;
        if (candidateToken) {
          try {
            const decoded = jwt.verify(candidateToken, getJwtSecret(), { algorithms: ['HS256'] }) as any;
            if (decoded && decoded.id === data.userId) {
              (socket as any).authenticatedUser = decoded;
            }
          } catch { }
        }

        // Strict authorization: Privileged roles (admin, agent) MUST exist in DB with matching role
        if (data.role === 'admin' || data.role === 'agent') {
          if (!dbUser || dbUser.role !== data.role) {
            console.warn(`[Socket Security] Unauthorized attempt to register as ${data.role} from socket ${socket.id} (userId: ${data.userId})`);
            socket.emit('auth:error', { error: `Authentication failed: account is not an authorized ${data.role}.` });
            return;
          }
        }

        const verifiedRole = dbUser ? dbUser.role : (data.role === 'customer' ? 'customer' : 'customer');
        const preferredLanguage = data.preferredLanguage || dbUser?.preferredLanguage || 'en';
        const supportedLanguages = data.supportedLanguages || (dbUser?.supportedLanguages ? dbUser.supportedLanguages.split(',') : ['en', 'ta', 'te', 'ml', 'hi']);
        const agentStatus = (data.agentStatus || (dbUser?.agentStatus as any) || 'available') as 'available' | 'busy' | 'offline';
        const maxConcurrentCalls = dbUser?.maxConcurrentCalls || 1;

        const user: ConnectedUser = {
          socketId: socket.id,
          userId: data.userId,
          role: verifiedRole,
          name: dbUser?.name || data.name || 'User',
          preferredLanguage,
          supportedLanguages,
          agentStatus,
          activeCalls: new Set<string>(),
          maxConcurrentCalls
        };

        connectedUsers.set(socket.id, user);

        socket.join(`user:${data.userId}`);
        if (dbUser?.role === 'customer' && dbUser.email) socket.join(`customer:${dbUser.email.trim().toLowerCase()}`);
        if (verifiedRole === 'admin') {
          socket.join('role:admin');
          socket.join('role:agent');
        } else if (verifiedRole === 'agent') {
          socket.join('role:agent');
        }

        console.log(`[Socket] Registered: ${user.name} (${verifiedRole}) - Lang: ${preferredLanguage}, Status: ${agentStatus}`);

        // If agent just registered as available, check if someone is waiting in queue!
        if (verifiedRole === 'agent' || verifiedRole === 'admin') {
          await checkWaitingQueueForAgent(user);
          broadcastQueueStats();
        }
      } catch (err) {
        console.error('[Socket] Error registering user:', err);
      }
    });

    // Unregister user when logging out
    socket.on('user:unregister', () => {
      const existingUser = connectedUsers.get(socket.id);
      if (existingUser) {
        socket.leave(`user:${existingUser.userId}`);
        socket.leave('role:admin');
        socket.leave('role:agent');
        connectedUsers.delete(socket.id);
        console.log(`[Socket] Unregistered user session: ${existingUser.name}`);
      }
    });

    // 1. Customer calls Customer Support Agent (Multilingual routing & queueing)
    socket.on('customer:call_agent', async (data: {
      callId: string;
      customerId: string;
      customerName: string;
      customerEmail?: string;
      customerPhone?: string;
      preferredLanguage: string;
    }) => {
      try {
        console.log(`[SupportCall] Customer ${data.customerName} calling support in language: ${data.preferredLanguage}`);
        socket.join(`call:${data.callId}`);

        let validCustomerId: string | null = null;
        let realName = data.customerName;
        let realEmail = data.customerEmail || '';
        let realPhone = data.customerPhone || '';

        if (data.customerId) {
          const user = await prisma.user.findUnique({ where: { id: data.customerId } });
          if (user) {
            validCustomerId = user.id;
            if (user.name) realName = user.name;
            if (user.email) realEmail = user.email;
            if (user.phone) realPhone = user.phone;
            // Update preferred language in user profile
            await prisma.user.update({
              where: { id: user.id },
              data: { preferredLanguage: data.preferredLanguage }
            });
          }
        }

        // Intelligent ACD: Search for an available support agent or active admin operator
        const agent = findAvailableAgent(data.preferredLanguage);
        const adminSession = findNextAvailableAdminSession(data.preferredLanguage);

        if (agent && agent.role === 'agent') {
          await dispatchCallToAgent(data.callId, agent, {
            customerId: validCustomerId,
            customerName: realName,
            customerEmail: realEmail,
            customerPhone: realPhone,
            preferredLanguage: data.preferredLanguage,
            customerSocketId: socket.id
          });
        } else if (adminSession) {
          console.log(`[SupportCall] Routing call directly to available Admin Operator ${adminSession.operatorName}`);
          await dispatchCallToAdminSession(data.callId, adminSession, {
            customerId: validCustomerId,
            customerName: realName,
            customerEmail: realEmail,
            customerPhone: realPhone,
            preferredLanguage: data.preferredLanguage,
            customerSocketId: socket.id
          });
        } else if (agent) {
          await dispatchCallToAgent(data.callId, agent, {
            customerId: validCustomerId,
            customerName: realName,
            customerEmail: realEmail,
            customerPhone: realPhone,
            preferredLanguage: data.preferredLanguage,
            customerSocketId: socket.id
          });
        } else {
          // No agent or administrator currently available -> place in FIFO waiting queue
          console.log(`[SupportCall] No staff available for ${data.preferredLanguage}, placing customer in queue`);
          await enqueueCall({
            callId: data.callId,
            customerId: validCustomerId,
            customerName: realName,
            customerEmail: realEmail,
            customerPhone: realPhone,
            preferredLanguage: data.preferredLanguage,
            socketId: socket.id,
            queuedAt: Date.now(),
            rejectedByAgents: new Set()
          });
        }
      } catch (err) {
        console.error('[SupportCall] Error in customer:call_agent:', err);
        socket.emit('call:error', { message: 'Failed to initiate support call.' });
      }
    });

    // 2. Agent accepts incoming call
    socket.on('agent:accept_call', async (data: {
      callId: string;
      agentId: string;
      agentName: string;
    }) => {
      try {
        console.log(`[SupportCall] Agent ${data.agentName} accepted call ${data.callId}`);

        // Clear ringing timer
        if (ringingTimers.has(data.callId)) {
          clearTimeout(ringingTimers.get(data.callId)!);
          ringingTimers.delete(data.callId);
        }

        const call = await prisma.callRecord.findUnique({ where: { callId: data.callId } });
        if (!call) return;

        // Calculate queue duration if call waited in queue or rang
        const queueDuration = Math.max(0, Math.floor((Date.now() - new Date(call.startTime).getTime()) / 1000));

        let validAgentId: string | null = null;
        if (data.agentId) {
          const user = await prisma.user.findUnique({ where: { id: data.agentId } });
          if (user) validAgentId = user.id;
        }

        // Update call in DB
        const updated = await prisma.callRecord.update({
          where: { id: call.id },
          data: {
            status: 'active',
            agentId: validAgentId,
            agentName: data.agentName,
            queueDuration
          }
        });

        // Agent joins call room
        socket.join(`call:${data.callId}`);

        // Log system transcript
        await prisma.callTranscript.create({
          data: {
            callRecordId: call.id,
            sender: 'system',
            senderName: 'System',
            text: `Support Agent ${data.agentName} connected with Customer ${call.customerName}. Language: ${translationService.getLanguageName(call.language || 'en')}.`
          }
        });

        // Notify caller customer that call was accepted
        io.to(`call:${data.callId}`).emit('customer:call_accepted', {
          callId: data.callId,
          agentId: data.agentId,
          agentName: data.agentName,
          agentSocketId: socket.id,
          preferredLanguage: call.language || 'en',
          languageName: translationService.getLanguageName(call.language || 'en')
        });

        // Notify agent that call is connected
        socket.emit('agent:call_connected', {
          callId: data.callId,
          callRecordId: updated.id,
          customerName: call.customerName,
          customerPhone: call.customerPhone || 'Not provided',
          preferredLanguage: call.language || 'en',
          languageName: translationService.getLanguageName(call.language || 'en')
        });

        // Broadcast to call room
        io.to(`call:${data.callId}`).emit('call:connected', {
          callId: data.callId,
          agentSocketId: socket.id
        });

        // Broadcast status update
        io.to('role:admin').to('role:agent').emit('call:status_changed', {
          callId: data.callId,
          status: 'active'
        });
      } catch (err) {
        console.error('[SupportCall] Error in agent:accept_call:', err);
      }
    });

    // 3. Agent rejects incoming call
    socket.on('agent:reject_call', async (data: {
      callId: string;
      agentId: string;
      reason?: string;
    }) => {
      try {
        console.log(`[SupportCall] Agent ${data.agentId} rejected call ${data.callId}`);

        // Clear timer
        if (ringingTimers.has(data.callId)) {
          clearTimeout(ringingTimers.get(data.callId)!);
          ringingTimers.delete(data.callId);
        }

        const agent = connectedUsers.get(socket.id);
        if (agent) {
          agent.activeCalls.delete(data.callId);
        }

        const call = await prisma.callRecord.findUnique({ where: { callId: data.callId } });
        if (!call) return;

        // Try to re-route to another available agent
        const nextAgent = findAvailableAgent(call.language || 'en', new Set([data.agentId]));
        if (nextAgent) {
          console.log(`[SupportCall] Rerouting rejected call ${data.callId} to Agent ${nextAgent.name}`);
          const customerSocketId = Array.from(await io.in(`call:${data.callId}`).allSockets()).find(s => s !== socket.id);
          if (customerSocketId) {
            await dispatchCallToAgent(data.callId, nextAgent, {
              customerId: call.customerId,
              customerName: call.customerName,
              customerPhone: call.customerPhone || undefined,
              preferredLanguage: call.language || 'en',
              customerSocketId,
              callRecordId: call.id
            });
            return;
          }
        }

        // If no other agent available, notify customer of decline
        const customerSockets = Array.from(await io.in(`call:${data.callId}`).allSockets()).filter(s => s !== socket.id);
        const custSocket = customerSockets[0] || socket.id;

        io.to(`call:${data.callId}`).emit('customer:call_declined', {
          callId: data.callId,
          reason: data.reason || 'Support Specialist is currently unavailable or declined the call.'
        });

        await prisma.callRecord.update({
          where: { id: call.id },
          data: { status: 'rejected', endedBy: 'agent' }
        });
      } catch (err) {
        console.error('[SupportCall] Error in agent:reject_call:', err);
      }
    });

    // 4. Customer cancels waiting in queue
    socket.on('customer:cancel_queue', async (data: { callId: string }) => {
      try {
        console.log(`[Queue] Customer cancelled waiting for call: ${data.callId}`);
        const idx = queuedCalls.findIndex(q => q.callId === data.callId);
        if (idx >= 0) {
          queuedCalls.splice(idx, 1);
        }

        await prisma.callRecord.updateMany({
          where: { callId: data.callId },
          data: {
            status: 'cancelled',
            endTime: new Date(),
            endedBy: 'customer'
          }
        });

        socket.emit('customer:queue_cancelled', { callId: data.callId });
        broadcastQueueStats();
      } catch (err) {
        console.error('[Queue] Error cancelling queue:', err);
      }
    });

    // 5. Agent updates availability status (available / busy)
    socket.on('agent:status_toggle', async (data: { agentStatus: 'available' | 'busy' }) => {
      try {
        const user = connectedUsers.get(socket.id);
        if (user) {
          user.agentStatus = data.agentStatus;
          await prisma.user.update({
            where: { id: user.userId },
            data: { agentStatus: data.agentStatus }
          });
          console.log(`[AgentStatus] Agent ${user.name} status updated to: ${data.agentStatus}`);

          socket.emit('agent:status_updated', { agentStatus: data.agentStatus });

          // If available, check waiting queue!
          if (data.agentStatus === 'available') {
            await checkWaitingQueueForAgent(user);
          }
        }
      } catch (err) {
        console.error('[AgentStatus] Error updating status:', err);
      }
    });

    // 6. Agent updates supported languages
    socket.on('agent:languages_update', async (data: { supportedLanguages: string[] }) => {
      try {
        const user = connectedUsers.get(socket.id);
        if (user) {
          user.supportedLanguages = data.supportedLanguages;
          await prisma.user.update({
            where: { id: user.userId },
            data: { supportedLanguages: data.supportedLanguages.join(',') }
          });
          console.log(`[AgentLanguages] Agent ${user.name} supported languages: ${data.supportedLanguages.join(',')}`);
          socket.emit('agent:languages_updated', { supportedLanguages: data.supportedLanguages });

          // Check queue with new languages
          await checkWaitingQueueForAgent(user);
        }
      } catch (err) {
        console.error('[AgentLanguages] Error updating languages:', err);
      }
    });

    // 7. Customer starts AI voice call (Self-service AI Assistant)
    socket.on('call:start', async (data: {
      callId: string;
      customerId: string;
      customerName: string;
      customerPhone?: string;
      language?: string;
    }) => {
      try {
        console.log(`[AICall] Starting AI call: ${data.callId} for ${data.customerName}`);
        socket.join(`call:${data.callId}`);

        // Check if active session already exists for this callId (Idempotent session creation)
        const existingSession = callSessions.get(data.callId);
        if (existingSession) {
          existingSession.customerSocketId = socket.id;
          console.log(`[AICall] Reconnected to existing session: ${data.callId}. Suppressing duplicate greeting.`);
          socket.emit('call:ready', {
            callId: data.callId,
            responseId: `ready_recon_${data.callId}_${Date.now()}`,
            greeting: '',
            greetingPlayed: true,
            agentName: 'KAIRA AI Support Specialist',
            status: 'active',
            language: existingSession.language
          });
          return;
        }

        let call = await prisma.callRecord.findUnique({
          where: { callId: data.callId }
        });

        let validCustomerId: string | null = null;
        let dbCustomer: any = null;
        if (data.customerId) {
          dbCustomer = await prisma.user.findUnique({
            where: { id: data.customerId }
          });
          if (dbCustomer) validCustomerId = dbCustomer.id;
        }

        // Dynamically resolve the authenticated / logged-in customer's name
        const socketUser = connectedUsers.get(socket.id);
        const resolvedCustomerName = (dbCustomer?.name || socketUser?.name || data.customerName || '').trim();
        const cleanDisplayName = resolvedCustomerName.replace(/\s*\((?:customer|client|user)\)/i, '').trim();

        const isNewCall = !call;
        const callLang = data.language || 'en';

        if (!call) {
          call = await prisma.callRecord.create({
            data: {
              callId: data.callId,
              customerId: validCustomerId,
              customerName: cleanDisplayName || 'Customer',
              customerPhone: data.customerPhone || null,
              agentName: 'KAIRA AI Support Specialist',
              type: 'ai_voice',
              direction: 'incoming',
              status: 'active',
              language: callLang,
              startTime: new Date()
            }
          });
        }

        // Register session ownership and lock
        callSessions.set(data.callId, {
          callId: data.callId,
          customerId: validCustomerId,
          customerName: cleanDisplayName || 'Customer',
          customerSocketId: socket.id,
          language: callLang,
          speakerType: 'ai',
          humanSpeakerId: null,
          humanSpeakerName: null,
          greetingPlayed: true,
          processedUtteranceIds: new Set(),
          createdAt: Date.now()
        });

        // KAIRA AI Customer Support Greeting (concise, natural, human-like)
        const hasSpecificName = Boolean(
          cleanDisplayName &&
          cleanDisplayName.toLowerCase() !== 'customer' &&
          cleanDisplayName.toLowerCase() !== 'user' &&
          cleanDisplayName.toLowerCase() !== 'null' &&
          cleanDisplayName.toLowerCase() !== 'undefined'
        );

        let greeting: string;
        if (hasSpecificName) {
          greeting = `Hello ${cleanDisplayName}! Welcome to our support service. How can I help you today?`;
        } else {
          greeting = `Hello! Welcome to our support service. How can I help you today?`;
        }

        if (callLang !== 'en') {
          greeting = await translationService.translateText(greeting, callLang, 'en');
        }

        const activeSession = callSessions.get(data.callId);
        if (activeSession) {
          activeSession.greeting = greeting;
        }

        if (isNewCall) {
          await prisma.callTranscript.create({
            data: {
              callRecordId: call.id,
              sender: 'ai',
              senderName: 'KAIRA AI Support Specialist',
              text: greeting,
              language: callLang
            }
          });
        }

        // Initialize active call conversation context & reset locks
        activeCallContexts.set(data.callId, [
          { sender: 'ai', text: greeting, timestamp: new Date() }
        ]);
        activeCallQueryLocks.delete(data.callId);

        const responseId = `ready_${data.callId}_${Date.now()}`;
        socket.emit('call:ready', {
          callId: data.callId,
          responseId,
          greeting,
          greetingPlayed: false,
          agentName: 'KAIRA AI Support Specialist',
          status: 'active',
          language: callLang,
          audioUrl: `/api/voice/tts?text=${encodeURIComponent(greeting)}&lang=${callLang}`
        });

        io.to('role:admin').to('role:agent').emit('call:status_changed', { callId: data.callId, status: 'active' });
        io.to('role:admin').to('role:agent').emit('ai_call:started', {
          callId: data.callId,
          customerId: validCustomerId || data.customerId,
          customerName: data.customerName,
          customerPhone: data.customerPhone || 'Direct App Call',
          language: callLang,
          startTime: new Date().toISOString()
        });

        notificationService.createNotification({
          role: 'agent',
          type: 'incoming_call',
          title: 'Incoming Voice Call',
          message: `${data.customerName || 'Customer'} initiated call in ${callLang.toUpperCase()}`,
          data: {
            callId: data.callId,
            customerId: validCustomerId || data.customerId,
            customerName: data.customerName,
            language: callLang
          },
          dedupKey: `call_${data.callId}`
        }).catch(e => console.error('[Notification] Error creating call notification:', e));
      } catch (err) {
        console.error('[Call] Error in call:start:', err);
        socket.emit('call:error', { message: 'Could not start call.' });
      }
    });

    // 7A. Customer manually requests escalation to human specialist
    socket.on('call:escalate', async (data: { callId: string; reason?: string }) => {
      try {
        const call = await prisma.callRecord.findUnique({
          where: { callId: data.callId }
        });
        if (!call) return;

        const reason = 'Customer Explicitly Requested Human Support';
        const detailedReason = data.reason || 'Customer manually clicked escalate to human specialist';
        const transferReq = await prisma.callTransferRequest.create({
          data: {
            callRecordId: call.id,
            customerId: call.customerId,
            customerName: call.customerName,
            customerPhone: call.customerPhone || 'Direct App Call',
            question: detailedReason,
            reason,
            status: 'pending',
            priority: 'urgent'
          }
        });

        await prisma.callRecord.update({
          where: { id: call.id },
          data: {
            transferred: true,
            transferReason: reason,
            requiresAssistance: true,
            assistanceReason: detailedReason
          }
        });

        handoverService.registerTransferInitiated(data.callId, reason, transferReq.id);

        const respLang = call.language || 'en';
        const escalateNotice = respLang === 'ta'
          ? 'மனித நிபுணருடன் உங்களை இணைக்கிறேன், தயவுசெய்து காத்திருக்கவும்.'
          : respLang === 'te'
            ? 'మిమ్మల్ని మానవ నిపుణుడితో కனெక్ట్ చేస్తున్నాను, దయచేసి వేచి ఉండండి.'
            : respLang === 'hi'
              ? 'मैं आपको मानव विशेषज्ञ से जोड़ रहा हूँ, कृपया प्रतीक्षा करें।'
              : respLang === 'ml'
                ? 'നിങ്ങളെ ഒരു ഹ്യൂമൻ സ്പെഷ്യലിസ്റ്റുമായി ബന്ധിപ്പിക്കുന്നു, ദയവായി കാത്തിരിക്കുക.'
                : respLang === 'kn'
                  ? 'ನಾನು ನಿಮ್ಮನ್ನು ಮಾನವ ತಜ್ಞರೊಂದಿಗೆ ಸಂಪರ್ಕಿಸುತ್ತಿದ್ದೇನೆ, ದಯವಿಟ್ಟು ಕಾಯಿರಿ.'
                  : 'Connecting you to a human specialist, please hold the line.';

        const escalateResponseId = `resp_esc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        socket.emit('call:ai_response', {
          responseId: escalateResponseId,
          answer: escalateNotice,
          isTransferring: true,
          transferId: transferReq.id,
          transferReason: reason,
          supportPhoneNumber: handoverService.getThresholds().supportPhoneNumber,
          language: respLang,
          audioUrl: `/api/voice/tts?text=${encodeURIComponent(escalateNotice)}&lang=${respLang}`
        });

        io.to('role:admin').to('role:agent').emit('transfer:incoming', {
          transferId: transferReq.id,
          callId: data.callId,
          callRecordId: call.id,
          customerId: call.customerId,
          customerName: call.customerName,
          customerPhone: call.customerPhone || 'Not provided',
          question: detailedReason,
          reason,
          duration: call.duration || 0,
          language: respLang,
          createdAt: transferReq.createdAt
        });

        notificationService.createNotification({
          role: 'agent',
          type: 'escalation',
          title: 'Specialist Escalation Requested',
          message: `${call.customerName || 'Customer'} requested human agent transfer: ${reason}`,
          data: {
            transferId: transferReq.id,
            callId: data.callId,
            customerId: call.customerId,
            customerName: call.customerName,
            reason
          },
          dedupKey: `transfer_${transferReq.id}`
        }).catch(e => console.error('[Notification] Error creating escalation notification:', e));
      } catch (err) {
        console.error('[Call] Error in call:escalate:', err);
      }
    });

    // 7A2. Agent/Admin query active AI calls
    socket.on('active_ai_calls:get', async () => {
      try {
        const activeCalls = await prisma.callRecord.findMany({
          where: { status: 'active', type: 'ai_voice' },
          orderBy: { startTime: 'desc' },
          take: 20,
          include: {
            transcripts: {
              orderBy: { timestamp: 'desc' },
              take: 3
            }
          }
        });
        socket.emit('active_ai_calls:list', activeCalls);
      } catch (err) {
        console.error('[ActiveAICalls] Error fetching active calls:', err);
      }
    });

    // 7B. Change language during active call
    socket.on('call:change_language', async (data: { callId: string; language: string }) => {
      try {
        const normLang = (data.language || 'en').toLowerCase().slice(0, 2);
        console.log(`[CallLanguage] Changing language for call ${data.callId} to: ${normLang}`);

        await prisma.callRecord.updateMany({
          where: { callId: data.callId },
          data: { language: normLang }
        });

        io.to(`call:${data.callId}`).emit('call:language_changed', {
          callId: data.callId,
          language: normLang,
          languageName: translationService.getLanguageName(normLang)
        });
      } catch (err) {
        console.error('[CallLanguage] Error updating language:', err);
      }
    });

    // 7C. Real-Time Streaming Speech-to-Text Pipeline (Deepgram / Google / Azure / Audio Telemetry)
    socket.on('stt:start_stream', async (data: { callId: string; language?: string; sampleRate?: number }) => {
      try {
        const lang = data.language || 'en-IN';
        const sampleRate = data.sampleRate || 16000;
        const activeProvider = sttService.getActiveProviderName();

        await sttService.startStream(
          data.callId,
          { language: lang, sampleRate, interimResults: true },
          (event) => {
            if (event.isFinal) {
              socket.emit('stt:final', {
                callId: data.callId,
                text: event.text,
                transcript: event.text,
                confidence: event.confidence,
                language: event.language || lang,
                latencyMs: event.latencyMs
              });
            } else {
              socket.emit('stt:interim', {
                callId: data.callId,
                text: event.text,
                transcript: event.text,
                confidence: event.confidence
              });
            }
          },
          (err) => {
            socket.emit('stt:error', { callId: data.callId, error: err?.message || 'STT stream error' });
          }
        );

        socket.emit('stt:stream_ready', {
          callId: data.callId,
          provider: activeProvider,
          isCloudConfigured: sttService.isCloudSttConfigured(),
          sampleRate,
          language: lang
        });
      } catch (err: any) {
        console.error('[STT] Error starting stream:', err);
        socket.emit('stt:error', { callId: data.callId, error: err?.message });
      }
    });

    socket.on('stt:audio_chunk', (data: { callId: string; audioData?: string | Buffer | ArrayBuffer; chunk?: string | Buffer | ArrayBuffer }) => {
      try {
        const raw = data.audioData || data.chunk;
        if (!data.callId || !raw) return;
        const buf = Buffer.isBuffer(raw)
          ? raw
          : raw instanceof ArrayBuffer
            ? Buffer.from(raw)
            : Buffer.from(raw as string, 'base64');

        const metrics = sttService.writeAudioChunk(data.callId, buf);
        socket.emit('stt:audio_telemetry', {
          callId: data.callId,
          rms: metrics.rms,
          isTooQuiet: metrics.isTooQuiet,
          isClipping: metrics.isClipping
        });

        if (metrics.isTooQuiet) {
          socket.emit('stt:audio_warning', {
            callId: data.callId,
            warning: 'low_volume',
            message: 'Microphone volume is very quiet. Please speak closer to your microphone.'
          });
        } else if (metrics.isClipping) {
          socket.emit('stt:audio_warning', {
            callId: data.callId,
            warning: 'audio_clipping',
            message: 'Audio level is too high and distorting. Please lower your microphone input level.'
          });
        }
      } catch (err) {
        console.error('[STT] Error processing audio chunk:', err);
      }
    });

    socket.on('stt:stop_stream', (data: { callId: string }) => {
      try {
        if (data.callId) {
          sttService.stopStream(data.callId);
        }
      } catch (err) {
        console.error('[STT] Error stopping stream:', err);
      }
    });

    // 8. Customer speaks a query to the AI assistant (with Deduplication & Concurrency Lock)
    socket.on('call:query', async (data: {
      callId: string;
      query: string;
      customerId: string;
      duration?: number;
      language?: string;
      clientMessageId?: string;
      utteranceId?: string;
      clientSentAt?: number;
    }) => {
      try {
        const rawQuery = (data.query || '').trim();
        if (!rawQuery || rawQuery.length < 2) return;
        const queryText = rawQuery.length > 2500 ? rawQuery.slice(0, 2500) : rawQuery;

        // Reject noise-only queries (non-word characters, clicks, empty pauses)
        if (!/[\p{L}\p{N}]/u.test(queryText)) {
          console.log(`[AICall] Dropped noise-only query on ${data.callId}: "${queryText}"`);
          return;
        }

        // Verify single active AI voice speaker per call
        const session = callSessions.get(data.callId);
        if (session && session.speakerType !== 'ai') {
          console.log(`[AICall] Dropped call:query on ${data.callId}: active speaker is human agent ${session.humanSpeakerName}`);
          return;
        }

        // Server-Side Acoustic Echo Shield
        // Check if query is an acoustic echo of the AI's greeting or recent AI responses
        const recentAiUtterances: string[] = [];
        if (session && session.greeting) {
          recentAiUtterances.push(session.greeting);
        }
        const callCtx = activeCallContexts.get(data.callId);
        if (callCtx) {
          for (const item of callCtx) {
            if (item.sender === 'ai' && item.text) {
              recentAiUtterances.push(item.text);
            }
          }
        }

        if (isServerSideAcousticEcho(queryText, recentAiUtterances)) {
          console.warn(`[AICall Echo Shield] Blocked call:query on ${data.callId}: detected acoustic echo of AI utterance. Query: "${queryText}"`);
          return;
        }

        // Deduplicate customer utterance to prevent repeated responses
        if (data.utteranceId && session) {
          if (session.processedUtteranceIds.has(data.utteranceId)) {
            console.log(`[AICall] Duplicate utterance ${data.utteranceId} dropped for call ${data.callId}`);
            return;
          }
          session.processedUtteranceIds.add(data.utteranceId);
          if (session.processedUtteranceIds.size > 200) {
            const firstItem = session.processedUtteranceIds.values().next().value;
            if (firstItem) session.processedUtteranceIds.delete(firstItem);
          }
        }

        const now = Date.now();
        const existingLock = activeCallQueryLocks.get(data.callId);

        // Deduplication and duplicate utterance shield
        if (existingLock) {
          if (data.clientMessageId && existingLock.lastClientMessageId === data.clientMessageId) {
            console.log(`[AICall Deduplication] Suppressed duplicate clientMessageId: ${data.clientMessageId} for call: ${data.callId}`);
            return;
          }
          if (
            existingLock.lastQueryText.toLowerCase() === queryText.toLowerCase() &&
            (now - existingLock.lastQueryTime) < 2500
          ) {
            console.log(`[AICall Deduplication] Suppressed duplicate query within ${now - existingLock.lastQueryTime}ms for call ${data.callId}: "${queryText}"`);
            return;
          }
          if (existingLock.inFlight && existingLock.lastQueryText.toLowerCase() === queryText.toLowerCase()) {
            console.log(`[AICall Deduplication] Suppressed in-flight duplicate query for call ${data.callId}: "${queryText}"`);
            return;
          }
        }

        // Acquire lock
        activeCallQueryLocks.set(data.callId, {
          lastQueryText: queryText,
          lastQueryTime: now,
          lastClientMessageId: data.clientMessageId,
          inFlight: true
        });
        const call = await prisma.callRecord.findUnique({
          where: { callId: data.callId }
        });
        if (!call) {
          activeCallQueryLocks.delete(data.callId);
          return;
        }

        const callLang = data.language || call.language || 'en';

        // 0A. Check if session is awaiting callback confirmation from caller
        if (session?.awaitingCallbackConfirmation) {
          const lowerQuery = queryText.toLowerCase().trim();
          const phoneMatch = queryText.match(/(\+?[0-9\s\-\(\)]{7,15})/);
          const detectedPhone = phoneMatch ? phoneMatch[0].trim() : (session.suggestedCallbackPhone || call.customerPhone || 'the registered number');

          const isDeclined = /\b(no|nope|cancel|never\s*mind|don'?t|leave\s*it|not\s*needed)\b/i.test(lowerQuery);
          const isConfirmed = !isDeclined && (
            Boolean(phoneMatch) ||
            /\b(yes|yeah|yep|sure|please|okay|ok|arrange|call\s*me|definitely|fine|great|schedule|confirm)\b/i.test(lowerQuery)
          );

          if (isConfirmed) {
            session.awaitingCallbackConfirmation = false;
            handoverService.updateTransferStatus(data.callId, 'callback_scheduled');

            // Record customer utterance
            await prisma.callTranscript.create({
              data: {
                callRecordId: call.id,
                sender: 'customer',
                senderName: call.customerName,
                text: queryText,
                language: callLang
              }
            }).catch(e => console.error('[AICall] Error saving customer transcript:', e));

            // Create priority support ticket for callback
            const ticket = await prisma.supportTicket.create({
              data: {
                customerId: call.customerId,
                customerName: call.customerName,
                customerEmail: call.customerPhone || null,
                subject: `Priority Callback: ${session.pendingHandoverReason || 'Customer Support Escalation'}`,
                description: `Customer confirmed callback during voice call (${data.callId}). Reason: ${session.pendingHandoverReason || 'Escalation'}. Contact number: ${detectedPhone}. Original issue: "${session.lastHandoverQuery || queryText}".`,
                priority: 'urgent',
                status: 'open'
              }
            });

            // Prevent duplicate callback follow-up tasks and register in FollowUpTasksManager
            const existingCallbackTask = await prisma.followUpTask.findFirst({
              where: {
                callRecordId: call.id,
                title: { startsWith: 'Priority Callback' }
              }
            });

            if (!existingCallbackTask) {
              await prisma.followUpTask.create({
                data: {
                  callRecordId: call.id,
                  customerId: call.customerId,
                  customerName: call.customerName,
                  customerPhone: detectedPhone,
                  customerEmail: call.customerPhone || null,
                  title: `Priority Callback: ${session.pendingHandoverReason || 'Customer Support Escalation'}`,
                  unresolvedQuestion: session.lastHandoverQuery || queryText,
                  previousSummary: `Customer confirmed priority callback to ${detectedPhone}. Reason: ${session.pendingHandoverReason || 'Escalation'}. Ticket #${ticket.id.slice(-6).toUpperCase()}`,
                  actionRequired: `Call customer back at ${detectedPhone}`,
                  priority: 'urgent',
                  status: 'pending',
                  language: callLang,
                  notes: `Scheduled during call ${data.callId}. Ticket ID: ${ticket.id}`
                }
              }).catch(e => console.error('[AICall] Error creating followUpTask for callback:', e));

              notificationService.createNotification({
                role: 'agent',
                type: 'callback',
                title: 'Customer Callback Scheduled',
                message: `Priority callback requested for ${call.customerName || 'Customer'} at ${detectedPhone}`,
                data: {
                  callId: data.callId,
                  customerId: call.customerId,
                  customerName: call.customerName,
                  phone: detectedPhone,
                  ticketId: ticket.id
                },
                dedupKey: `callback_${call.id}_${detectedPhone}`
              }).catch(e => console.error('[Notification] Error creating callback notification:', e));
            }

            await prisma.callRecord.update({
              where: { id: call.id },
              data: {
                callNotes: `Priority callback scheduled to ${detectedPhone}. Ticket #${ticket.id.slice(-6).toUpperCase()}`
              }
            });

            const confirmMsg = await handoverService.generateCallbackConfirmationMessage(detectedPhone, callLang);

            await prisma.callTranscript.create({
              data: {
                callRecordId: call.id,
                sender: 'ai',
                senderName: 'KAIRA AI Support Specialist',
                text: confirmMsg,
                language: callLang
              }
            });

            const confirmRespId = `resp_cb_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            socket.emit('call:ai_response', {
              callId: data.callId,
              responseId: confirmRespId,
              clientMessageId: data.clientMessageId,
              answer: confirmMsg,
              isTransferring: false,
              callbackScheduled: true,
              ticketId: ticket.id,
              language: callLang,
              audioUrl: `/api/voice/tts?text=${encodeURIComponent(confirmMsg)}&lang=${callLang}`
            });

            socket.emit('call:callback_scheduled', {
              callId: data.callId,
              ticketId: ticket.id,
              phone: detectedPhone,
              message: confirmMsg
            });

            // Notify staff
            io.to('role:admin').to('role:agent').emit('callback:requested', {
              callId: data.callId,
              ticketId: ticket.id,
              customerName: call.customerName,
              phone: detectedPhone,
              reason: session.pendingHandoverReason,
              query: session.lastHandoverQuery
            });

            return;
          } else if (isDeclined) {
            session.awaitingCallbackConfirmation = false;
            handoverService.clearTransferLock(data.callId);

            let declineMsg = "No problem at all. How else can I assist you today?";
            if (callLang !== 'en') {
              try {
                declineMsg = await translationService.translateText(declineMsg, callLang, 'en');
              } catch (e) { }
            }

            await prisma.callTranscript.create({
              data: {
                callRecordId: call.id,
                sender: 'customer',
                senderName: call.customerName,
                text: queryText,
                language: callLang
              }
            }).catch(e => console.error('[AICall] Error saving customer transcript:', e));

            await prisma.callTranscript.create({
              data: {
                callRecordId: call.id,
                sender: 'ai',
                senderName: 'KAIRA AI Support Specialist',
                text: declineMsg,
                language: callLang
              }
            });

            const declineRespId = `resp_decl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            socket.emit('call:ai_response', {
              callId: data.callId,
              responseId: declineRespId,
              clientMessageId: data.clientMessageId,
              answer: declineMsg,
              isTransferring: false,
              language: callLang,
              audioUrl: `/api/voice/tts?text=${encodeURIComponent(declineMsg)}&lang=${callLang}`
            });

            return;
          }
        }

        // 0B. Guard against duplicate transfer triggers while transfer is actively in progress
        if (handoverService.isTransferInProgress(data.callId)) {
          const activeLock = handoverService.getActiveTransferLock(data.callId);
          let inProgressMsg = "Your transfer to a human representative is currently in progress. Please hold the line, someone will be with you shortly.";
          if (callLang !== 'en') {
            try {
              inProgressMsg = await translationService.translateText(inProgressMsg, callLang, 'en');
            } catch (e) { }
          }

          const inProgRespId = `resp_inprog_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          socket.emit('call:ai_response', {
            callId: data.callId,
            responseId: inProgRespId,
            clientMessageId: data.clientMessageId,
            answer: inProgressMsg,
            isTransferring: true,
            transferId: activeLock?.transferId,
            transferReason: activeLock?.reason,
            language: callLang,
            audioUrl: `/api/voice/tts?text=${encodeURIComponent(inProgressMsg)}&lang=${callLang}`
          });

          return;
        }

        // Retrieve real customer profile and support tickets from database
        let customerContext: any = {
          customerId: call.customerId,
          customerName: call.customerName,
          customerPhone: call.customerPhone
        };
        try {
          const [userInfo, userTickets] = await Promise.all([
            call.customerId ? prisma.user.findUnique({ where: { id: call.customerId } }) : null,
            prisma.supportTicket.findMany({
              where: {
                OR: [
                  ...(call.customerId ? [{ customerId: call.customerId }] : []),
                  { customerName: call.customerName }
                ]
              },
              orderBy: { createdAt: 'desc' },
              take: 5
            })
          ]);
          if (userInfo) {
            customerContext.customerEmail = userInfo.email;
            if (userInfo.phone) customerContext.customerPhone = userInfo.phone;
            if (userInfo.name) customerContext.customerName = userInfo.name;
          }
          customerContext.tickets = userTickets;
        } catch (fetchErr) {
          console.warn('[AICall] Could not fetch customer tickets/profile:', fetchErr);
        }

        // 1. Asynchronously record customer's speech in DB transcript without blocking response pipeline
        prisma.callTranscript.create({
          data: {
            callRecordId: call.id,
            sender: 'customer',
            senderName: call.customerName,
            text: queryText,
            language: callLang
          }
        }).catch(e => console.error('[AICall] Error saving customer transcript:', e));

        // Signal thinking state to customer UI immediately
        io.to(`call:${data.callId}`).emit('call:ai_thinking', { callId: data.callId, isThinking: true });

        // Retrieve active in-memory multi-turn context
        const callContext = activeCallContexts.get(data.callId) || [];
        callContext.push({ sender: 'customer', text: queryText, timestamp: new Date() });

        // 2. Run sentiment analysis and grounded Knowledge Base retrieval concurrently
        const [sentimentResult, response] = await Promise.all([
          sentimentService.processCustomerUtterance({
            callId: data.callId,
            text: queryText,
            language: callLang,
            customerId: call.customerId
          }),
          translationService.getAiAnswerSuggestion(queryText, callLang, callContext, customerContext)
        ]);

        // Real-time sentiment update broadcast
        io.to(`call:${data.callId}`).emit('call:sentiment_update', {
          callId: data.callId,
          sentiment: sentimentResult.sentiment,
          confidenceScore: sentimentResult.confidenceScore,
          reason: sentimentResult.reason,
          triggerText: queryText,
          requiresHumanAssistance: sentimentResult.requiresHumanAssistance,
          timestamp: new Date()
        });

        io.to('role:admin').emit('sentiment:live_update', {
          callId: data.callId,
          customerName: call.customerName,
          sentiment: sentimentResult.sentiment,
          confidenceScore: sentimentResult.confidenceScore,
          reason: sentimentResult.reason,
          triggerText: queryText,
          requiresHumanAssistance: sentimentResult.requiresHumanAssistance
        });

        if (sentimentResult.requiresHumanAssistance) {
          const alertPayload = {
            callId: data.callId,
            customerName: call.customerName,
            customerPhone: call.customerPhone || 'Not provided',
            reason: sentimentResult.reason,
            triggerText: queryText,
            sentiment: sentimentResult.sentiment,
            confidenceScore: sentimentResult.confidenceScore,
            priority: 'urgent',
            timestamp: new Date()
          };
          io.to('role:admin').emit('sentiment:assistance_alert', alertPayload);
          io.to('role:agent').emit('sentiment:assistance_alert', alertPayload);
        }

        // Real-Time Conversation Intelligence: non-blocking analysis of customer turn
        realtimeIntelligenceService.analyzeTurn({
          callId: data.callId,
          text: queryText,
          language: callLang,
          customerId: call.customerId,
          sender: 'customer'
        }).then(liveInsights => {
          if (liveInsights) {
            io.to(`call:${data.callId}`).emit('call:live_intelligence', liveInsights);
            io.to('role:agent').emit('call:live_insights', { customerName: call.customerName, ...liveInsights });
            io.to('role:admin').emit('call:live_insights', { customerName: call.customerName, ...liveInsights });

            if (liveInsights.requestsHumanAssistance || (liveInsights.unresolvedConcerns && liveInsights.unresolvedConcerns.length > 0)) {
              const urgencyAlert = {
                callId: data.callId,
                customerName: call.customerName,
                customerPhone: call.customerPhone || 'Not provided',
                reason: liveInsights.recommendedLiveGuidance || 'Customer expressed unresolved concern/frustration',
                intent: liveInsights.primaryIntent,
                priority: liveInsights.importantInfoForAgent?.urgencyLevel || 'high',
                timestamp: new Date()
              };
              io.to('role:admin').emit('intelligence:assistance_alert', urgencyAlert);
              io.to('role:agent').emit('intelligence:assistance_alert', urgencyAlert);
            }
          }
        }).catch(err => console.warn('[Socket] Realtime customer turn intelligence error:', err));

        const aiResponseTime = Date.now();
        const clientSpeechEnd = (data as any).clientSentAt || (data as any).speechEndTime || aiResponseTime;
        const totalRoundTripMs = Math.max(15, aiResponseTime - clientSpeechEnd);
        const aiProcessingMs = Math.max(10, response.latencyMs || (aiResponseTime - clientSpeechEnd));

        // Update CallRecord asynchronously
        prisma.callRecord.update({
          where: { id: call.id },
          data: {
            avgLatency: totalRoundTripMs,
            language: response.language || callLang
          }
        }).catch(e => console.error('[AICall] Error updating call record latency:', e));

        const respLang = response.language || callLang;
        const aiText = response.answer || FALLBACK_MESSAGE;

        const history = callContext.map(c => ({
          role: (c.sender === 'customer' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: c.text
        }));

        // Intelligent AI-to-Human Handover Evaluation
        const handoverEval = await handoverService.evaluateHandover({
          queryText,
          callLang: respLang,
          sentimentResult,
          aiResponse: response,
          callHistory: history
        });

        if (handoverEval.shouldTransfer) {
          const transferReason: HandoverReason = handoverEval.reason || 'Customer Frustration';
          const detailedReason = handoverEval.detailedReason || transferReason;

          console.log(`[AICall] Initiating Human Handover on call ${data.callId}. Reason: ${transferReason}`);

          if (handoverEval.isUnknownQuestion) {
            // Track knowledge gap since the answer was unknown to AI
            await knowledgeService.trackKnowledgeGap(queryText, respLang, call.id);
            io.to('role:admin').emit('knowledge:gap_detected', {
              question: queryText,
              language: respLang,
              callId: call.id
            });
          }

          await prisma.callRecord.update({
            where: { id: call.id },
            data: {
              transferred: true,
              transferReason,
              customerQuestion: queryText,
              type: 'admin_transfer',
              requiresAssistance: true,
              assistanceReason: detailedReason
            }
          });

          let transferReq = await prisma.callTransferRequest.findFirst({
            where: {
              callRecordId: call.id,
              status: { in: ['pending', 'ringing', 'accepted', 'connected'] }
            }
          });

          if (!transferReq) {
            transferReq = await prisma.callTransferRequest.create({
              data: {
                callRecordId: call.id,
                customerId: call.customerId,
                customerName: call.customerName,
                customerPhone: call.customerPhone || 'Direct App Call',
                question: queryText,
                reason: transferReason,
                status: 'ringing',
                priority: handoverEval.isFrustrated || handoverEval.isRepeatedComplaint ? 'urgent' : 'normal',
                sentiment: sentimentResult.sentiment || 'NEUTRAL'
              }
            });
          }

          // Register lock to prevent duplicate transfers during active transfer
          handoverService.registerTransferInitiated(data.callId, transferReason, transferReq.id);

          const availableAgent = findAvailableAgent(respLang);
          const availableAdmin = findNextAvailableAdminSession(respLang);
          const isStaffAvailable = Boolean(availableAgent || availableAdmin);

          let custEmail = '';
          if (call.customerId) {
            const u = await prisma.user.findUnique({ where: { id: call.customerId } });
            if (u && u.email) custEmail = u.email;
          }

          const transferResponseId = `resp_tr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

          if (isStaffAvailable) {
            // Staff is available: Speak announcement and dispatch immediately
            const transferNotice = handoverEval.verbalAnnouncement || "I will connect you directly with a member of our human support team right away. Please hold for just a moment.";

            await prisma.callTranscript.create({
              data: {
                callRecordId: call.id,
                sender: 'ai',
                senderName: 'KAIRA AI Support Specialist',
                text: transferNotice,
                language: respLang
              }
            });

            socket.emit('call:ai_response', {
              callId: data.callId,
              responseId: transferResponseId,
              clientMessageId: data.clientMessageId,
              answer: transferNotice,
              isTransferring: true,
              transferId: transferReq.id,
              transferReason,
              supportPhoneNumber: handoverService.getThresholds().supportPhoneNumber,
              language: respLang,
              audioUrl: `/api/voice/tts?text=${encodeURIComponent(transferNotice)}&lang=${respLang}`,
              latency: {
                aiMs: aiProcessingMs,
                totalRoundTripMs
              }
            });

            io.to(`call:${data.callId}`).emit('call:live_transcript', {
              sender: 'ai',
              senderName: 'KAIRA AI Support Specialist',
              text: transferNotice,
              language: respLang,
              timestamp: new Date()
            });

            const forwardAlert = {
              callId: data.callId,
              customerName: call.customerName,
              customerPhone: call.customerPhone || 'Not provided',
              reason: transferReason,
              question: queryText,
              triggerText: queryText,
              sentiment: sentimentResult.sentiment,
              confidenceScore: sentimentResult.confidenceScore,
              priority: 'urgent',
              timestamp: new Date()
            };
            io.to('role:admin').emit('sentiment:assistance_alert', forwardAlert);
            io.to('role:agent').emit('sentiment:assistance_alert', forwardAlert);
            io.to('role:admin').emit('call:transfer_needed', forwardAlert);
            io.to('role:agent').emit('call:transfer_needed', forwardAlert);

            if (availableAgent && availableAgent.role === 'agent') {
              console.log(`[Transfer] Routing ungrounded query directly to available Support Agent ${availableAgent.name}`);
              await dispatchCallToAgent(data.callId, availableAgent, {
                customerId: call.customerId,
                customerName: call.customerName,
                customerEmail: custEmail,
                customerPhone: call.customerPhone || 'Not provided',
                preferredLanguage: respLang,
                customerSocketId: socket.id,
                callRecordId: call.id
              });
            } else if (availableAdmin) {
              console.log(`[Transfer] Routing ungrounded query directly to available Admin Operator ${availableAdmin.operatorName}`);
              await dispatchCallToAdminSession(data.callId, availableAdmin, {
                customerId: call.customerId,
                customerName: call.customerName,
                customerEmail: custEmail,
                customerPhone: call.customerPhone || 'Not provided',
                preferredLanguage: respLang,
                customerSocketId: socket.id,
                transferId: transferReq.id,
                question: queryText,
                callRecordId: call.id,
                duration: data.duration || 0
              });
            } else if (availableAgent) {
              console.log(`[Transfer] Routing ungrounded query directly to Agent ${availableAgent.name}`);
              await dispatchCallToAgent(data.callId, availableAgent, {
                customerId: call.customerId,
                customerName: call.customerName,
                customerEmail: custEmail,
                customerPhone: call.customerPhone || 'Not provided',
                preferredLanguage: respLang,
                customerSocketId: socket.id,
                callRecordId: call.id
              });
            }
          } else {
            // No human staff online: Offer callback while maintaining call connection (do not disconnect)
            console.log(`[Transfer] No human staff online for ${data.callId}. Offering priority callback.`);
            const callbackOffer = await handoverService.generateCallbackOfferMessage(respLang, call.customerPhone, handoverEval.verbalAnnouncement);

            if (session) {
              session.awaitingCallbackConfirmation = true;
              session.pendingHandoverReason = transferReason;
              session.lastHandoverQuery = queryText;
              session.suggestedCallbackPhone = call.customerPhone || undefined;
            }
            handoverService.updateTransferStatus(data.callId, 'callback_offered');

            await prisma.callTranscript.create({
              data: {
                callRecordId: call.id,
                sender: 'ai',
                senderName: 'KAIRA AI Support Specialist',
                text: callbackOffer,
                language: respLang
              }
            });

            socket.emit('call:ai_response', {
              callId: data.callId,
              responseId: transferResponseId,
              clientMessageId: data.clientMessageId,
              answer: callbackOffer,
              isTransferring: true,
              isOfferingCallback: true,
              transferId: transferReq.id,
              transferReason,
              supportPhoneNumber: handoverService.getThresholds().supportPhoneNumber,
              language: respLang,
              audioUrl: `/api/voice/tts?text=${encodeURIComponent(callbackOffer)}&lang=${respLang}`,
              latency: {
                aiMs: aiProcessingMs,
                totalRoundTripMs
              }
            });

            io.to(`call:${data.callId}`).emit('call:live_transcript', {
              sender: 'ai',
              senderName: 'KAIRA AI Support Specialist',
              text: callbackOffer,
              language: respLang,
              timestamp: new Date()
            });

            // Notify admin/agent dashboards of transfer incoming
            io.to('role:admin').to('role:agent').emit('transfer:incoming', {
              transferId: transferReq.id,
              callId: data.callId,
              callRecordId: call.id,
              customerId: call.customerId,
              customerName: call.customerName,
              customerEmail: custEmail,
              customerPhone: call.customerPhone || 'Not provided',
              question: queryText,
              reason: transferReason,
              duration: data.duration || 0,
              language: respLang,
              createdAt: transferReq.createdAt
            });

            // Create preliminary open ticket so staff has record immediately
            try {
              const ticket = await prisma.supportTicket.create({
                data: {
                  customerId: call.customerId,
                  customerName: call.customerName,
                  customerEmail: call.customerPhone || null,
                  subject: `Live Escalation (${transferReason})`,
                  description: `Customer transferred during AI voice call (${transferReason}). Query: "${queryText}". Sentiment: ${sentimentResult.sentiment} (${sentimentResult.confidenceScore}). Callback offered.`,
                  priority: 'urgent',
                  status: 'open'
                }
              });

              socket.emit('transfer:no_staff_available', {
                callId: data.callId,
                ticketId: ticket.id,
                message: `Our human specialists are currently unavailable. We have created priority ticket #${ticket.id.slice(-6).toUpperCase()} and can arrange a callback.`
              });
            } catch (err) {
              console.warn('[Transfer] Failed to create preliminary ticket:', err);
            }
          }
        } else {
          // AI Agent autonomously answers the customer call (Continuous, intelligent conversation)
          // If question was not grounded in KB (missing info), track as Knowledge Gap for Admin review
          if (!response.isGrounded) {
            await knowledgeService.trackKnowledgeGap(queryText, respLang, call.id);
            io.to('role:admin').emit('knowledge:gap_detected', {
              question: queryText,
              language: respLang,
              callId: call.id
            });
          }

          // Record AI's response in transcript
          await prisma.callTranscript.create({
            data: {
              callRecordId: call.id,
              sender: 'ai',
              senderName: 'KAIRA AI Support Specialist',
              text: aiText,
              language: respLang
            }
          });

          // Update active multi-turn context
          callContext.push({ sender: 'ai', text: aiText, timestamp: new Date() });
          activeCallContexts.set(data.callId, callContext);

          const aiResponseId = `resp_ai_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          socket.emit('call:ai_response', {
            callId: data.callId,
            responseId: aiResponseId,
            clientMessageId: data.clientMessageId,
            utteranceId: data.utteranceId,
            answer: aiText,
            isTransferring: false,
            agentName: 'KAIRA AI Support Specialist',
            sources: response.sources || [],
            language: respLang,
            audioUrl: `/api/voice/tts?text=${encodeURIComponent(aiText)}&lang=${respLang}`,
            latency: {
              aiMs: aiProcessingMs,
              totalRoundTripMs
            }
          });

          // Broadcast to call participants
          io.to(`call:${data.callId}`).emit('call:live_transcript', {
            sender: 'ai',
            senderName: 'KAIRA AI Support Specialist',
            text: aiText,
            language: respLang,
            timestamp: new Date()
          });

          // Record AI turn in Real-Time Conversation Intelligence
          realtimeIntelligenceService.analyzeTurn({
            callId: data.callId,
            text: aiText,
            language: respLang,
            customerId: call.customerId,
            sender: 'ai'
          }).catch(err => console.warn('[Socket] Realtime AI turn error:', err));

          // Broadcast real-time AI conversation metrics to Agent and Admin dashboards for monitoring
          io.to('role:admin').to('role:agent').emit('ai_call:live_metrics', {
            callId: data.callId,
            customerName: call.customerName,
            query: queryText,
            answer: aiText,
            language: respLang,
            latencyMs: totalRoundTripMs,
            sentiment: sentimentResult.sentiment
          });
        }
      } catch (err) {
        console.error('[AICall] Error in call:query:', err);
      } finally {
        const lock = activeCallQueryLocks.get(data.callId);
        if (lock) {
          lock.inFlight = false;
        }
      }
    });

    // 8B. Customer interrupts AI speaking (Barge-in / Voice Activity Detection cancellation)
    socket.on('call:interrupt', (data: { callId: string }) => {
      console.log(`[AICall] Barge-in: Customer interrupted AI on call: ${data.callId}`);
      const lock = activeCallQueryLocks.get(data.callId);
      if (lock) {
        lock.inFlight = false;
      }
      io.to(`call:${data.callId}`).emit('call:interrupted', { callId: data.callId });
    });

    // 9. Live Speech Transcription Relay & Real-Time Multilingual Translation
    socket.on('call:live_speech', async (data: {
      callId: string;
      sender: 'customer' | 'admin' | 'agent';
      senderName: string;
      text: string;
      language?: string;
    }) => {
      try {
        const text = data.text.trim();
        if (!text) return;

        // Prevent unauthorized agent audio from interrupting AI without explicit takeover
        if (data.sender === 'agent' || data.sender === 'admin') {
          const session = callSessions.get(data.callId);
          if (session && session.speakerType === 'ai') {
            console.warn(`[Call] Rejected agent speech: Call ${data.callId} is locked to AI speaker. Human takeover required.`);
            return;
          }
        }

        const call = await prisma.callRecord.findUnique({
          where: { callId: data.callId }
        });

        const callLang = call?.language || 'en';
        let translationText: string | null = null;

        // Auto-translate if customer is speaking in non-English or agent is speaking to customer
        if (data.sender === 'customer' && callLang !== 'en') {
          translationText = await translationService.translateText(text, 'en', callLang);
        } else if ((data.sender === 'agent' || data.sender === 'admin') && callLang !== 'en') {
          translationText = await translationService.translateText(text, callLang, 'en');
        }

        if (call) {
          await prisma.callTranscript.create({
            data: {
              callRecordId: call.id,
              sender: data.sender,
              senderName: data.senderName,
              text,
              translation: translationText,
              language: data.language || callLang
            }
          });
        }

        // Broadcast to call participants
        io.to(`call:${data.callId}`).emit('call:live_transcript', {
          sender: data.sender,
          senderName: data.senderName,
          text,
          translation: translationText,
          language: data.language || callLang,
          timestamp: new Date()
        });

        // If the speaker is the customer, analyze real-time sentiment
        if (data.sender === 'customer') {
          const sentimentResult = await sentimentService.processCustomerUtterance({
            callId: data.callId,
            text,
            language: data.language || callLang,
            customerId: call?.customerId
          });

          io.to(`call:${data.callId}`).emit('call:sentiment_update', {
            callId: data.callId,
            sentiment: sentimentResult.sentiment,
            confidenceScore: sentimentResult.confidenceScore,
            reason: sentimentResult.reason,
            triggerText: text,
            requiresHumanAssistance: sentimentResult.requiresHumanAssistance,
            timestamp: new Date()
          });

          io.to('role:admin').emit('sentiment:live_update', {
            callId: data.callId,
            customerName: call?.customerName,
            sentiment: sentimentResult.sentiment,
            confidenceScore: sentimentResult.confidenceScore,
            reason: sentimentResult.reason,
            triggerText: text,
            requiresHumanAssistance: sentimentResult.requiresHumanAssistance
          });

          if (sentimentResult.requiresHumanAssistance) {
            const alertPayload = {
              callId: data.callId,
              customerName: call?.customerName,
              customerPhone: call?.customerPhone || 'Not provided',
              reason: sentimentResult.reason,
              triggerText: text,
              sentiment: sentimentResult.sentiment,
              confidenceScore: sentimentResult.confidenceScore,
              priority: 'urgent',
              timestamp: new Date()
            };
            io.to('role:admin').emit('sentiment:assistance_alert', alertPayload);
            io.to('role:agent').emit('sentiment:assistance_alert', alertPayload);
          }

          // AI Copilot Live Assistance: Query verified Knowledge Base for smart recommendation
          translationService.getCopilotSuggestion(text, data.language || callLang).then((copilotResp) => {
            if (copilotResp && copilotResp.answer) {
              const copilotPayload = {
                callId: data.callId,
                query: text,
                answer: copilotResp.answer,
                sources: copilotResp.sources || [],
                isGrounded: copilotResp.isGrounded,
                confidence: copilotResp.confidence,
                isConflict: copilotResp.isConflict || false,
                language: copilotResp.language || callLang,
                timestamp: new Date()
              };
              io.to(`call:${data.callId}`).emit('call:kb_suggestion', copilotPayload);
              io.to(`call:${data.callId}`).emit('call:copilot_recommendation', copilotPayload);
              io.to('role:agent').emit('call:copilot_recommendation', copilotPayload);
            }
          }).catch(err => console.error('[Copilot] Live speech recommendation error:', err));

          // Real-Time Conversation Intelligence for live speech stream
          realtimeIntelligenceService.analyzeTurn({
            callId: data.callId,
            text,
            language: data.language || callLang,
            customerId: call?.customerId || null,
            sender: data.sender || 'customer'
          }).then(liveInsights => {
            if (liveInsights) {
              io.to(`call:${data.callId}`).emit('call:live_intelligence', liveInsights);
              io.to('role:agent').emit('call:live_insights', { customerName: call?.customerName, ...liveInsights });
              io.to('role:admin').emit('call:live_insights', { customerName: call?.customerName, ...liveInsights });
            }
          }).catch(err => console.warn('[Socket] Live speech intelligence error:', err));

        }
      } catch (err) {
        console.error('[Call] Live speech error:', err);
      }
    });

    // 10. Agent requests AI Knowledge Base Suggestion grounded strictly in approved KB
    socket.on('call:request_kb_suggest', async (data: {
      callId: string;
      query: string;
      targetLanguage?: string;
    }) => {
      try {
        console.log(`[KBSuggest] Agent requested suggestion for: "${data.query}"`);
        const targetLang = data.targetLanguage || 'en';
        const suggestion = await translationService.getCopilotSuggestion(data.query, targetLang);

        socket.emit('call:kb_suggestion', {
          callId: data.callId,
          query: data.query,
          answer: suggestion.answer,
          sources: suggestion.sources,
          isGrounded: suggestion.isGrounded,
          confidence: suggestion.confidence,
          isConflict: suggestion.isConflict || false,
          language: targetLang,
          timestamp: new Date()
        });
      } catch (err) {
        console.error('[KBSuggest] Error fetching suggestion:', err);
      }
    });

    // 10b. Agent marks Copilot answer as useful or incorrect
    socket.on('copilot:feedback', async (data: {
      entryId?: string;
      callId?: string;
      query: string;
      suggestedAnswer?: string;
      answer?: string;
      isUseful: boolean;
      feedbackNotes?: string;
      notes?: string;
    }) => {
      try {
        await prisma.knowledgeFeedback.create({
          data: {
            entryId: data.entryId || null,
            callId: data.callId || null,
            agentId: socket.data?.user?.id || null,
            query: data.query || 'Customer inquiry',
            suggestedAnswer: data.suggestedAnswer || data.answer || 'Grounded answer',
            isUseful: Boolean(data.isUseful),
            feedbackNotes: data.feedbackNotes || data.notes || null
          }
        });
        socket.emit('copilot:feedback_recorded', { success: true });
      } catch (err) {
        console.warn('[CopilotFeedback] Error recording feedback:', err);
      }
    });

    // 11. Hold and Resume call
    socket.on('call:hold', (data: { callId: string }) => {
      io.to(`call:${data.callId}`).emit('call:held', { callId: data.callId });
    });

    socket.on('call:resume', (data: { callId: string }) => {
      io.to(`call:${data.callId}`).emit('call:resumed', { callId: data.callId });
    });

    // 12. Save agent call notes
    socket.on('call:save_notes', async (data: { callId: string; notes: string }) => {
      try {
        await prisma.callRecord.updateMany({
          where: { callId: data.callId },
          data: { callNotes: data.notes }
        });
        socket.emit('call:notes_saved', { callId: data.callId });
      } catch (err) {
        console.error('[Notes] Error saving call notes:', err);
      }
    });

    // 12B. Live Conversation Intelligence query
    socket.on('call:get_live_intelligence', (data: { callId: string }) => {
      try {
        if (!data || !data.callId) return;
        const insights = realtimeIntelligenceService.getLiveInsights(data.callId);
        socket.emit('call:live_intelligence', insights);
      } catch (err) {
        console.warn('[Socket] call:get_live_intelligence error:', err);
      }
    });

    // 13. Admin accepts a live call transfer or human specialist takeover
    socket.on('transfer:accept', async (data: { transferId: string; adminId: string; adminName: string }) => {
      try {
        console.log(`[Transfer] Support Specialist/Admin ${data.adminName} accepted transfer ${data.transferId}`);

        let targetCallId = '';
        let targetCallRecordId = '';
        let targetCustomerName = '';
        let targetCustomerPhone = '';
        let targetQuestion = '';
        let targetCustomerId: string | null = null;
        let targetCallLang = 'en';

        let validAdminId: string | null = null;
        if (data.adminId) {
          const adminExists = await prisma.user.findUnique({ where: { id: data.adminId } });
          if (adminExists) validAdminId = adminExists.id;
        }

        if (data.transferId && data.transferId.startsWith('direct_takeover_')) {
          targetCallId = data.transferId.replace('direct_takeover_', '');
          const call = await prisma.callRecord.findFirst({
            where: {
              OR: [
                { callId: targetCallId },
                { id: targetCallId }
              ]
            }
          });
          if (!call) {
            socket.emit('transfer:error', { message: 'Call not found for direct takeover.' });
            return;
          }
          targetCallRecordId = call.id;
          targetCallId = call.callId; // Canonical callId string
          targetCustomerName = call.customerName;
          targetCustomerPhone = call.customerPhone || '';
          targetCustomerId = call.customerId;
          targetCallLang = call.language || 'en';
          targetQuestion = 'Direct specialist takeover';

          await prisma.callRecord.update({
            where: { id: targetCallRecordId },
            data: {
              adminId: validAdminId,
              agentId: validAdminId,
              agentName: data.adminName,
              transferred: true,
              status: 'active'
            }
          });
        } else {
          const transfer = await prisma.callTransferRequest.findUnique({
            where: { id: data.transferId },
            include: { callRecord: true }
          });

          if (!transfer) {
            socket.emit('transfer:error', { message: 'Transfer request not found.' });
            return;
          }

          if (transfer.status === 'accepted' || transfer.status === 'connected') {
            socket.emit('transfer:already_handled', { message: 'This transfer was already accepted by another Specialist.' });
            return;
          }

          targetCallId = transfer.callRecord.callId;
          targetCallRecordId = transfer.callRecordId;
          targetCustomerName = transfer.customerName;
          targetCustomerPhone = transfer.customerPhone || '';
          targetQuestion = transfer.question || '';
          targetCustomerId = transfer.callRecord.customerId;
          targetCallLang = transfer.callRecord.language || 'en';

          await prisma.callTransferRequest.update({
            where: { id: data.transferId },
            data: {
              status: 'connected',
              adminId: validAdminId,
              respondedAt: new Date()
            }
          });

          await prisma.callRecord.update({
            where: { id: targetCallRecordId },
            data: {
              adminId: validAdminId,
              agentId: validAdminId,
              agentName: data.adminName,
              transferred: true,
              status: 'active'
            }
          });
        }

        // Lock session to human agent and silence AI immediately
        let session = callSessions.get(targetCallId);
        if (session) {
          session.speakerType = 'human_agent';
          session.humanSpeakerId = validAdminId || data.adminId;
          session.humanSpeakerName = data.adminName;
        } else {
          const newSession: CallSessionState = {
            callId: targetCallId,
            customerId: targetCustomerId,
            customerName: targetCustomerName,
            customerSocketId: '',
            language: targetCallLang,
            speakerType: 'human_agent',
            humanSpeakerId: validAdminId || data.adminId,
            humanSpeakerName: data.adminName,
            greetingPlayed: true,
            processedUtteranceIds: new Set(),
            createdAt: Date.now()
          };
          callSessions.set(targetCallId, newSession);
          session = newSession;
        }

        await prisma.callTranscript.create({
          data: {
            callRecordId: targetCallRecordId,
            sender: 'system',
            senderName: 'System',
            text: `Call transferred to Support Specialist ${data.adminName}. Live two-way WebRTC voice connection established.`
          }
        });

        // 1. Join Agent to Call Room
        socket.join(`call:${targetCallId}`);

        // 2. Identify All Destination Rooms/Sockets for the Customer
        const targetRooms = new Set<string>();
        targetRooms.add(`call:${targetCallId}`);

        const customerSocketId = session.customerSocketId || null;
        if (customerSocketId) {
          targetRooms.add(customerSocketId);
          const custSocket = io.sockets.sockets.get(customerSocketId);
          if (custSocket) {
            custSocket.join(`call:${targetCallId}`);
          }
        }

        if (targetCustomerId) {
          targetRooms.add(`user:${targetCustomerId}`);
          for (const [sId, u] of connectedUsers.entries()) {
            if (u.userId === targetCustomerId) {
              targetRooms.add(sId);
              const s = io.sockets.sockets.get(sId);
              if (s) s.join(`call:${targetCallId}`);
            }
          }
        }

        // 3. Emit transfer:connected & call:ai_silenced to customer
        const transferPayload = {
          callId: targetCallId,
          adminId: data.adminId,
          adminName: data.adminName,
          adminSocketId: socket.id
        };

        const silencePayload = {
          callId: targetCallId,
          speakerType: 'human_agent',
          adminId: data.adminId,
          adminName: data.adminName
        };

        for (const room of targetRooms) {
          io.to(room).emit('call:ai_silenced', silencePayload);
          io.to(room).emit('transfer:connected', transferPayload);
        }

        // 4. Notify both Admin and Agent roles of state transition
        io.to('role:admin').to('role:agent').emit('ai_call:ended', {
          callId: targetCallId,
          reason: 'human_takeover',
          specialistName: data.adminName
        });

        io.to('role:admin').to('role:agent').emit('call:status_changed', {
          callId: targetCallId,
          status: 'active',
          specialistTakeover: true
        });

        io.to('role:admin').emit('transfer:status_updated', {
          transferId: data.transferId,
          status: 'connected',
          adminName: data.adminName
        });

        // 5. Notify accepting agent of success
        socket.emit('transfer:accepted_success', {
          callId: targetCallId,
          transferId: data.transferId,
          customerName: targetCustomerName,
          customerPhone: targetCustomerPhone,
          question: targetQuestion,
          customerSocketId
        });
      } catch (err) {
        console.error('[Transfer] Error accepting transfer:', err);
      }
    });

    // 14. Admin rejects a transfer request
    socket.on('transfer:reject', async (data: { transferId: string; adminId: string; reason?: string }) => {
      try {
        console.log(`[Transfer] Admin rejected transfer ${data.transferId}`);
        const transfer = await prisma.callTransferRequest.findUnique({
          where: { id: data.transferId },
          include: { callRecord: true }
        });

        if (!transfer) return;

        await prisma.callTransferRequest.update({
          where: { id: data.transferId },
          data: {
            status: 'rejected',
            adminId: data.adminId,
            respondedAt: new Date()
          }
        });

        io.to(`call:${transfer.callRecord.callId}`).emit('transfer:rejected_notice', {
          message: "Our Admin is currently unavailable. Your question and contact details have been saved, and an Admin will follow up with you shortly."
        });

        io.to('role:admin').emit('transfer:status_updated', {
          transferId: data.transferId,
          status: 'rejected'
        });
      } catch (err) {
        console.error('[Transfer] Error rejecting transfer:', err);
      }
    });

    // 14b. Multi-Admin Independent Operator Session Registration
    socket.on('admin:register_session', async (data: {
      adminSessionId: string;
      adminId: string;
      adminName: string;
      operatorName?: string;
      supportedLanguages?: string[];
      status?: 'available' | 'busy' | 'offline';
    }) => {
      try {
        const adminSessionId = data.adminSessionId || `admin_sess_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const operatorName = data.operatorName || data.adminName || 'Admin Operator';
        const supportedLanguages = data.supportedLanguages || ['en', 'ta', 'te', 'ml', 'kn', 'hi'];
        const status = data.status || 'available';

        const session: AdminSession = {
          adminSessionId,
          socketId: socket.id,
          adminId: data.adminId,
          adminName: data.adminName || 'Admin',
          operatorName,
          status,
          activeCallId: null,
          lastAssignedAt: 0,
          connectedAt: Date.now(),
          supportedLanguages
        };

        adminSessions.set(adminSessionId, session);
        socketToAdminSession.set(socket.id, adminSessionId);

        socket.join(`session:${adminSessionId}`);
        socket.join('role:admin');

        console.log(`[AdminSession] Registered Operator: "${operatorName}" (Session: ${adminSessionId}, Status: ${status})`);

        socket.emit('admin:session_registered', {
          adminSessionId,
          operatorName,
          status,
          stats: getAdminStats()
        });

        broadcastAdminStats();
      } catch (err) {
        console.error('[AdminSession] Error in admin:register_session:', err);
      }
    });

    // 14c. Update Admin Operator Availability Status
    socket.on('admin:update_status', (data: {
      adminSessionId: string;
      status: 'available' | 'busy' | 'offline';
      operatorName?: string;
    }) => {
      const session = adminSessions.get(data.adminSessionId);
      if (session) {
        session.status = data.status;
        if (data.operatorName) session.operatorName = data.operatorName;
        console.log(`[AdminSession] ${session.operatorName} status updated to: ${data.status}`);
        broadcastAdminStats();
      }
    });

    // 14d. Admin Operator Accepts Assigned Incoming Call
    socket.on('admin:accept_call', async (data: {
      callId: string;
      adminSessionId: string;
      transferId?: string;
    }) => {
      try {
        const session = adminSessions.get(data.adminSessionId) || Array.from(adminSessions.values()).find(s => s.socketId === socket.id);
        if (!session) {
          console.warn('[AdminSession] Cannot accept call: Session not found for socket', socket.id);
          return;
        }

        console.log(`[AdminSession] Operator ${session.operatorName} (${session.adminSessionId}) accepted call ${data.callId}`);

        if (ringingTimers.has(data.callId)) {
          clearTimeout(ringingTimers.get(data.callId)!);
          ringingTimers.delete(data.callId);
        }

        session.status = 'busy';
        session.activeCallId = data.callId;
        broadcastAdminStats();

        socket.join(`call:${data.callId}`);

        const call = await prisma.callRecord.findUnique({ where: { callId: data.callId } });
        if (call) {
          await prisma.callRecord.update({
            where: { id: call.id },
            data: {
              status: 'active',
              adminId: session.adminId,
              adminName: session.adminName,
              adminSessionId: session.adminSessionId,
              adminOperatorName: session.operatorName,
              transferred: Boolean(data.transferId)
            }
          });

          if (data.transferId) {
            await prisma.callTransferRequest.update({
              where: { id: data.transferId },
              data: {
                status: 'connected',
                adminId: session.adminId,
                adminSessionId: session.adminSessionId,
                adminOperatorName: session.operatorName,
                respondedAt: new Date()
              }
            });
          }

          await prisma.callTranscript.create({
            data: {
              callRecordId: call.id,
              sender: 'system',
              senderName: 'System',
              text: `Connected with Admin Operator ${session.operatorName}. Language: ${translationService.getLanguageName(call.language || 'en')}. Two-way voice established.`
            }
          });
        }

        // Send confirmation to this Admin session
        socket.emit('admin:call_connected', {
          callId: data.callId,
          customerName: call?.customerName || 'Customer',
          customerPhone: call?.customerPhone || 'Not provided',
          preferredLanguage: call?.language || 'en',
          languageName: translationService.getLanguageName(call?.language || 'en'),
          operatorName: session.operatorName
        });

        // Notify customer
        io.to(`call:${data.callId}`).emit('customer:call_accepted', {
          callId: data.callId,
          agentId: session.adminId,
          agentName: session.operatorName,
          agentSocketId: socket.id,
          preferredLanguage: call?.language || 'en',
          languageName: translationService.getLanguageName(call?.language || 'en')
        });

        io.to(`call:${data.callId}`).emit('transfer:connected', {
          callId: data.callId,
          adminId: session.adminId,
          adminName: session.operatorName,
          adminSocketId: socket.id
        });
      } catch (err) {
        console.error('[AdminSession] Error in admin:accept_call:', err);
      }
    });

    // 14e. Admin Operator Rejects Assigned Incoming Call -> Automatic Failover
    socket.on('admin:reject_call', async (data: {
      callId: string;
      adminSessionId: string;
      reason?: string;
    }) => {
      try {
        const session = adminSessions.get(data.adminSessionId) || Array.from(adminSessions.values()).find(s => s.socketId === socket.id);
        if (session) {
          session.status = 'available';
          session.activeCallId = null;
          broadcastAdminStats();
        }

        if (ringingTimers.has(data.callId)) {
          clearTimeout(ringingTimers.get(data.callId)!);
          ringingTimers.delete(data.callId);
        }

        const call = await prisma.callRecord.findUnique({ where: { callId: data.callId } });
        if (!call) return;

        // Intelligent ACD: Attempt to reroute to the next available Admin session
        const nextAdmin = findNextAvailableAdminSession(call.language || 'en', session ? new Set([session.adminSessionId]) : new Set());
        if (nextAdmin) {
          console.log(`[AdminACD] Rerouting rejected call ${data.callId} to next Admin ${nextAdmin.operatorName}`);
          const customerSockets = Array.from(await io.in(`call:${data.callId}`).allSockets()).filter(s => s !== socket.id);
          await dispatchCallToAdminSession(data.callId, nextAdmin, {
            customerId: call.customerId,
            customerName: call.customerName,
            customerPhone: call.customerPhone || undefined,
            preferredLanguage: call.language || 'en',
            customerSocketId: customerSockets[0] || socket.id,
            callRecordId: call.id
          });
        } else {
          // If no other admin available, notify customer
          io.to(`call:${data.callId}`).emit('customer:call_declined', {
            callId: data.callId,
            reason: data.reason || 'All administrators are currently engaged. Please try again shortly.'
          });
          await prisma.callRecord.update({
            where: { id: call.id },
            data: { status: 'rejected', endedBy: 'admin' }
          });
        }
      } catch (err) {
        console.error('[AdminSession] Error in admin:reject_call:', err);
      }
    });

    // 14f. Customer Calls Admin Directly
    socket.on('customer:call_admin', async (data: {
      callId: string;
      customerId: string;
      customerName: string;
      customerEmail?: string;
      customerPhone?: string;
      preferredLanguage: string;
    }) => {
      try {
        console.log(`[CustomerCallAdmin] Customer ${data.customerName} calling Admin in ${data.preferredLanguage}`);
        socket.join(`call:${data.callId}`);

        let validCustomerId: string | null = null;
        let realName = data.customerName;
        let realEmail = data.customerEmail || '';
        let realPhone = data.customerPhone || '';

        if (data.customerId) {
          const user = await prisma.user.findUnique({ where: { id: data.customerId } });
          if (user) {
            validCustomerId = user.id;
            if (user.name) realName = user.name;
            if (user.email) realEmail = user.email;
            if (user.phone) realPhone = user.phone;
          }
        }

        const adminSession = findNextAvailableAdminSession(data.preferredLanguage);
        if (adminSession) {
          await dispatchCallToAdminSession(data.callId, adminSession, {
            customerId: validCustomerId,
            customerName: realName,
            customerEmail: realEmail,
            customerPhone: realPhone,
            preferredLanguage: data.preferredLanguage,
            customerSocketId: socket.id
          });
        } else {
          // No admin available -> queue call
          await enqueueCall({
            callId: data.callId,
            customerId: validCustomerId,
            customerName: realName,
            customerEmail: realEmail,
            customerPhone: realPhone,
            preferredLanguage: data.preferredLanguage,
            socketId: socket.id,
            queuedAt: Date.now(),
            rejectedByAgents: new Set()
          });
        }
      } catch (err) {
        console.error('[CustomerCallAdmin] Error:', err);
      }
    });

    // 15. Agent initiates outgoing call to customer
    socket.on('agent:call:customer', async (data: {
      agentId: string;
      agentName: string;
      customerId: string;
      customerName: string;
      customerPhone?: string;
    }) => {
      try {
        const callId = 'call_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        console.log(`[AgentCall] Outgoing call from Agent ${data.agentName} to ${data.customerName}`);

        let validCustId: string | null = null;
        if (data.customerId) {
          const userExists = await prisma.user.findUnique({ where: { id: data.customerId } });
          if (userExists) validCustId = userExists.id;
        }

        let validAgentId: string | null = null;
        if (data.agentId) {
          const agentExists = await prisma.user.findUnique({ where: { id: data.agentId } });
          if (agentExists) validAgentId = agentExists.id;
        }

        const callRecord = await prisma.callRecord.create({
          data: {
            callId,
            customerId: validCustId,
            customerName: data.customerName,
            customerPhone: data.customerPhone || null,
            agentId: validAgentId,
            agentName: data.agentName,
            type: 'agent_voice',
            direction: 'outgoing',
            status: 'active',
            startTime: new Date()
          }
        });

        socket.join(`call:${callId}`);

        io.to(`user:${data.customerId}`).emit('agent:incoming_call', {
          callId,
          agentId: data.agentId,
          agentName: data.agentName,
          agentSocketId: socket.id
        });

        socket.emit('agent:call:initiated', {
          callId,
          callRecordId: callRecord.id,
          customerName: data.customerName
        });
      } catch (err) {
        console.error('[AgentCall] Error initiating call:', err);
      }
    });

    socket.on('customer:accept_agent_call', async (data: { callId: string; customerId: string }) => {
      socket.join(`call:${data.callId}`);
      io.to(`call:${data.callId}`).emit('agent:call_connected', {
        callId: data.callId,
        customerSocketId: socket.id
      });
    });

    // 16. WebRTC Signaling Relays (Bidirectional Voice Mesh)
    socket.on('webrtc:offer', (data: { target: string; offer: any; callId: string; isReconnect?: boolean }) => {
      if (data.target) {
        io.to(data.target).emit('webrtc:offer', {
          sender: socket.id,
          offer: data.offer,
          callId: data.callId,
          isReconnect: data.isReconnect
        });
      } else {
        socket.to(`call:${data.callId}`).emit('webrtc:offer', {
          sender: socket.id,
          offer: data.offer,
          callId: data.callId,
          isReconnect: data.isReconnect
        });
      }
    });

    socket.on('webrtc:answer', (data: { target: string; answer: any; callId: string; isReconnect?: boolean }) => {
      if (data.target) {
        io.to(data.target).emit('webrtc:answer', {
          sender: socket.id,
          answer: data.answer,
          callId: data.callId,
          isReconnect: data.isReconnect
        });
      } else {
        socket.to(`call:${data.callId}`).emit('webrtc:answer', {
          sender: socket.id,
          answer: data.answer,
          callId: data.callId,
          isReconnect: data.isReconnect
        });
      }
    });

    socket.on('webrtc:ice-candidate', (data: { target: string; candidate: any; callId: string }) => {
      if (data.target) {
        io.to(data.target).emit('webrtc:ice-candidate', {
          sender: socket.id,
          candidate: data.candidate,
          callId: data.callId
        });
      } else {
        socket.to(`call:${data.callId}`).emit('webrtc:ice-candidate', {
          sender: socket.id,
          candidate: data.candidate,
          callId: data.callId
        });
      }
    });

    // 16a. Participant joins a call room (Authorized access only)
    socket.on('call:join', async (data: { callId: string }) => {
      if (!data?.callId || typeof data.callId !== 'string') return;
      const callId = data.callId.trim();
      const currentUser = connectedUsers.get(socket.id);
      const activeSession = callSessions.get(callId);

      // Check if user is staff (admin / agent)
      const isStaff = currentUser?.role === 'admin' || currentUser?.role === 'agent';
      // Check if socket is the customer who initiated this session
      const isSessionCustomer =
        activeSession?.customerSocketId === socket.id ||
        (currentUser && activeSession?.customerId && activeSession.customerId === currentUser.userId);

      if (isStaff || isSessionCustomer) {
        socket.join(`call:${callId}`);
        console.log(`[Socket] Authorized participant ${currentUser?.name || socket.id} joined call room: call:${callId}`);
        return;
      }

      // If session is not in memory, verify against DB
      const callRecord = await prisma.callRecord.findFirst({
        where: { OR: [{ callId }, { id: callId }] },
        select: { id: true, customerId: true, agentId: true, adminId: true }
      });

      if (!callRecord) {
        console.warn(`[Socket Security] Denied join to non-existent call ${callId} from socket ${socket.id}`);
        socket.emit('call:error', { callId, error: 'Access denied: Call session not found or unauthorized.' });
        return;
      }

      const isParticipant =
        currentUser &&
        (callRecord.customerId === currentUser.userId ||
          callRecord.agentId === currentUser.userId ||
          callRecord.adminId === currentUser.userId);

      if (isParticipant) {
        socket.join(`call:${callId}`);
        console.log(`[Socket] Authorized participant ${currentUser.name} joined call room: call:${callId}`);
      } else {
        console.warn(`[Socket Security] Denied unauthorized join to call ${callId} from socket ${socket.id} (user: ${currentUser?.userId || 'anonymous'})`);
        socket.emit('call:error', { callId, error: 'Access denied: You are not an authorized participant of this call session.' });
      }
    });

    // 16b. Live Call Reconnection & Reliability Events
    socket.on('call:reconnecting', async (data: { callId: string; attempt?: number; maxAttempts?: number; reason?: string }) => {
      const attemptNum = data.attempt || 1;
      const maxAttempts = data.maxAttempts || callReliabilityService.MAX_RECOVERY_ATTEMPTS;
      console.log(`[CallReconnect] Call ${data.callId} reconnecting: attempt ${attemptNum}/${maxAttempts} (${data.reason || 'network'})`);

      // Acquire recovery lock to prevent duplicate concurrent recovery cycles
      const lockAcquired = callReliabilityService.acquireRecoveryLock(data.callId);

      const userMessage = attemptNum === 1
        ? 'Network connection is unstable. Reconnecting your call...'
        : `Reconnecting your call... (${attemptNum}/${maxAttempts})`;

      const payload = {
        ...data,
        attempt: attemptNum,
        maxAttempts,
        userMessage
      };

      socket.to(`call:${data.callId}`).emit('call:reconnecting', payload);
      io.to('role:admin').emit('call:reconnecting', payload);

      if (lockAcquired || attemptNum === 1) {
        await callReliabilityService.recordRecoveryEvent({
          callId: data.callId,
          failureType: (data.reason?.includes('ICE') ? 'ice_failed' : 'network_disconnected'),
          recoveryStatus: 'attempting',
          attempts: attemptNum,
          errorMessage: userMessage
        });
      }
    });

    socket.on('call:reconnected', async (data: { callId: string; attempt?: number; durationMs?: number }) => {
      console.log(`[CallReconnect] Call ${data.callId} reconnected successfully!`);
      const userMessage = 'Connection restored! Live voice resumed.';

      const payload = {
        ...data,
        userMessage
      };

      socket.to(`call:${data.callId}`).emit('call:reconnected', payload);
      io.to('role:admin').emit('call:reconnected', payload);

      await callReliabilityService.markRecoverySuccess(data.callId, data.attempt || 1, data.durationMs);
    });

    socket.on('call:reconnect_failed', async (data: { callId: string; reason?: string }) => {
      console.log(`[CallReconnect] Call ${data.callId} reconnection failed: ${data.reason}`);
      callReliabilityService.releaseRecoveryLock(data.callId);

      const userMessage = 'Call connection interrupted. Connecting you to a human representative...';
      const payload = {
        ...data,
        userMessage
      };

      socket.to(`call:${data.callId}`).emit('call:reconnect_failed', payload);
      io.to('role:admin').emit('call:reconnect_failed', payload);

      try {
        const call = await prisma.callRecord.findUnique({ where: { callId: data.callId } });
        if (call) {
          const isFirstDropReport = call.status !== 'disconnected' && call.endedBy !== 'network';
          await prisma.callRecord.update({
            where: { id: call.id },
            data: {
              status: 'disconnected',
              endedBy: 'network',
              failureReason: data.reason || 'Network connection lost. Reconnection timed out.'
            }
          });

          await callReliabilityService.recordRecoveryEvent({
            callId: data.callId,
            failureType: 'network_disconnected',
            recoveryStatus: 'failed',
            attempts: callReliabilityService.MAX_RECOVERY_ATTEMPTS,
            errorMessage: data.reason || 'Network connection lost. Reconnection timed out.'
          });

          if (isFirstDropReport) {
            await prisma.callQualityEvent.create({
              data: {
                callRecordId: call.id,
                eventType: 'dropped_call',
                details: data.reason || 'Network reconnection failed.'
              }
            });
            const { evaluateCallQualityAlert } = await import('./callQualityAlerts.js');
            const alert = await evaluateCallQualityAlert('dropped_call');
            if (alert) emitCallQualityAlert(alert);
          }
        }
      } catch (e) {
        console.error('[CallReconnect] Failed to update disconnected status:', e);
      }
    });

    // 16c. Live Call Health Telemetry Report from Client WebRTC
    socket.on('call:health_report', (data: {
      callId: string;
      webrtcState?: string;
      iceState?: string;
      latencyMs?: number;
      packetLoss?: number;
      jitterMs?: number;
      audioDeviceStatus?: 'healthy' | 'mic_disconnected' | 'speaker_disconnected' | 'recovering';
      reconnectAttempts?: number;
    }) => {
      if (!data?.callId) return;
      const updated = callReliabilityService.updateCallHealth({
        callId: data.callId,
        webrtcState: data.webrtcState || 'connected',
        iceState: data.iceState || 'connected',
        latencyMs: data.latencyMs ?? 50,
        packetLoss: data.packetLoss ?? 0,
        jitterMs: data.jitterMs ?? 5,
        audioDeviceStatus: data.audioDeviceStatus || 'healthy',
        reconnectAttempts: data.reconnectAttempts ?? 0
      });

      io.to('role:admin').emit('call:health_update', updated);
    });

    // 16d. Audio Input / Output Device Failure & Restoration Events
    socket.on('call:device_error', async (data: {
      callId: string;
      deviceType: 'microphone' | 'speaker';
      status: 'error' | 'restored';
      details?: string;
    }) => {
      console.log(`[CallDevice] Device ${data.deviceType} on call ${data.callId}: ${data.status}`);
      const userMessage = data.status === 'error'
        ? (data.deviceType === 'microphone'
          ? 'Microphone access is unavailable. Please check your microphone permissions.'
          : 'Audio output device disconnected. Restoring audio connection...')
        : 'Audio device successfully restored.';

      const payload = {
        ...data,
        userMessage
      };

      socket.to(`call:${data.callId}`).emit('call:device_error', payload);
      io.to('role:admin').emit('call:device_error', payload);

      if (data.status === 'error') {
        await callReliabilityService.recordRecoveryEvent({
          callId: data.callId,
          failureType: 'device_lost',
          recoveryStatus: 'attempting',
          errorMessage: userMessage,
          diagnosticData: { deviceType: data.deviceType, details: data.details }
        });
      } else {
        await callReliabilityService.recordRecoveryEvent({
          callId: data.callId,
          failureType: 'device_lost',
          recoveryStatus: 'recovered',
          errorMessage: userMessage
        });
      }
    });

    // 16e. Intelligent AI Fallback Event Notification
    socket.on('call:ai_fallback_triggered', async (data: {
      callId: string;
      serviceType: 'stt' | 'llm' | 'tts';
      fallbackProvider: string;
      reason: string;
    }) => {
      console.log(`[AIFallback] Call ${data.callId} AI fallback: ${data.serviceType} -> ${data.fallbackProvider} (${data.reason})`);

      const userMessage = 'AI service temporarily unavailable. Continuing in optimized fallback mode.';

      const payload = {
        ...data,
        userMessage
      };

      socket.to(`call:${data.callId}`).emit('call:ai_fallback_triggered', payload);
      io.to('role:admin').emit('call:ai_fallback_triggered', payload);

      await callReliabilityService.recordRecoveryEvent({
        callId: data.callId,
        failureType: data.serviceType === 'tts' ? 'tts_failed' : (data.serviceType === 'stt' ? 'stt_timeout' : 'llm_timeout'),
        recoveryStatus: 'recovered',
        errorMessage: userMessage,
        diagnosticData: { serviceType: data.serviceType, fallbackProvider: data.fallbackProvider, reason: data.reason }
      });
    });

    // 17. End Call (No hardcoded duration timeouts)
    socket.on('call:end', async (data: {
      callId: string;
      duration?: number;
      endedBy?: string;
      notes?: string;
    }) => {
      try {
        console.log(`[Call] Ending call: ${data.callId} by ${data.endedBy || 'user'}`);
        sttService.stopStream(data.callId);

        if (ringingTimers.has(data.callId)) {
          clearTimeout(ringingTimers.get(data.callId)!);
          ringingTimers.delete(data.callId);
        }

        const call = await prisma.callRecord.findUnique({
          where: { callId: data.callId }
        });

        if (call) {
          const duration = data.duration || Math.max(1, Math.floor((Date.now() - new Date(call.startTime).getTime()) / 1000));
          await prisma.callRecord.update({
            where: { id: call.id },
            data: {
              status: call.status === 'disconnected' || call.endedBy === 'network' ? 'disconnected' : 'completed',
              endTime: new Date(),
              duration,
              endedBy: call.endedBy === 'network' ? 'network' : (data.endedBy || 'user'),
              ...(data.notes ? { callNotes: data.notes } : {})
            }
          });

          await prisma.callTranscript.create({
            data: {
              callRecordId: call.id,
              sender: 'system',
              senderName: 'System',
              text: `Call ended. Duration: ${duration}s. Ended by: ${data.endedBy || 'user'}.`
            }
          });

          // Clean up in-memory conversation context, query deduplication locks, session state, and health telemetry
          activeCallContexts.delete(data.callId);
          activeCallQueryLocks.delete(data.callId);
          callSessions.delete(data.callId);
          callReliabilityService.removeCallHealth(data.callId);
          handoverService.clearTransferLock(data.callId);

          // Asynchronously trigger post-call AI intelligence analysis and conversation summary
          setTimeout(async () => {
            try {
              const intel = await callIntelligenceService.processCall(call.id);
              if (intel) {
                io.to(`call:${data.callId}`).emit('call:intelligence_ready', { callId: data.callId, intelligence: intel });
                io.to('role:agent').emit('call:intelligence_ready', { callId: data.callId, intelligence: intel });
                io.to('role:admin').emit('call:intelligence_ready', { callId: data.callId, intelligence: intel });
              }
            } catch (err) {
              console.error('[Socket] Asynchronous call intelligence error:', err);
            }
            conversationAnalysisService.analyzeCallConversation(call.id).catch(err => {
              console.error('[Socket] Asynchronous conversation analysis error:', err);
            });
            setTimeout(() => realtimeIntelligenceService.clearCall(data.callId), 15000);
          }, 300);
        }

        io.to(`call:${data.callId}`).emit('call:ended', {
          callId: data.callId,
          duration: data.duration,
          endedBy: data.endedBy || 'user'
        });
        io.to('role:admin').to('role:agent').emit('call:status_changed', { callId: data.callId, status: 'completed' });

        io.to('role:admin').to('role:agent').emit('ai_call:ended', {
          callId: data.callId,
          duration: data.duration
        });

        // Generate and persist post-call sentiment summary
        const summary = await sentimentService.finalizeCall(data.callId);
        if (summary) {
          io.to(`call:${data.callId}`).emit('call:sentiment_summary', {
            callId: data.callId,
            summary
          });
          io.to('role:admin').emit('sentiment:call_finalized', {
            callId: data.callId,
            summary
          });
          io.to('role:agent').emit('sentiment:call_finalized', {
            callId: data.callId,
            summary
          });
        }

        // Free agent's active calls
        const user = connectedUsers.get(socket.id);
        if (user) {
          user.activeCalls.delete(data.callId);
          // Check if someone is waiting in the queue for this freed agent!
          await checkWaitingQueueForAgent(user);
        }

        // Also check if any other connected agent can take waiting calls
        for (const u of connectedUsers.values()) {
          if (u.role === 'agent' && u.activeCalls.has(data.callId)) {
            u.activeCalls.delete(data.callId);
            await checkWaitingQueueForAgent(u);
          }
        }

        // Free admin session operator active call
        for (const session of adminSessions.values()) {
          if (session.activeCallId === data.callId) {
            session.status = 'available';
            session.activeCallId = null;
            console.log(`[AdminACD] Freed Admin Operator ${session.operatorName} (${session.adminSessionId})`);
          }
        }
        broadcastAdminStats();

        io.to('role:admin').to('role:agent').emit('call:status_changed', { callId: data.callId, status: 'completed' });
      } catch (err) {
        console.error('[Call] Error ending call:', err);
      }
    });

    // 18. Manual Sentiment Assistance Recommendation Override
    socket.on('sentiment:override', async (data: { callId: string; status: 'accepted' | 'dismissed' }) => {
      try {
        await sentimentService.overrideAssistance(data.callId, data.status);
        io.to('role:admin').emit('sentiment:override_updated', data);
        io.to('role:agent').emit('sentiment:override_updated', data);
      } catch (err) {
        console.error('[Sentiment] Override error:', err);
      }
    });

    // Disconnect cleanup
    socket.on('disconnect', async () => {
      // Clean up disconnected Admin Session
      const adminSessId = socketToAdminSession.get(socket.id);
      if (adminSessId) {
        const session = adminSessions.get(adminSessId);
        if (session) {
          console.log(`[AdminSession] Operator session disconnected: ${session.operatorName} (${adminSessId})`);
          if (session.activeCallId) {
            io.to(`call:${session.activeCallId}`).emit('call:ended', {
              callId: session.activeCallId,
              reason: `Admin operator ${session.operatorName} disconnected.`
            });
          }
          adminSessions.delete(adminSessId);
        }
        socketToAdminSession.delete(socket.id);
        broadcastAdminStats();
      }

      const user = connectedUsers.get(socket.id);
      if (user) {
        console.log(`[Socket] User disconnected: ${user.name} (${user.role})`);

        // If user had active calls, inform peers that reconnection is pending
        if (user.activeCalls.size > 0) {
          for (const activeCallId of user.activeCalls) {
            io.to(`call:${activeCallId}`).emit('call:reconnecting', {
              callId: activeCallId,
              attempt: 1,
              reason: `${user.name} lost connection. Attempting automatic reconnection...`
            });
          }
        }

        connectedUsers.delete(socket.id);
      }
      // If customer in queue disconnected, remove them
      const qIdx = queuedCalls.findIndex(q => q.socketId === socket.id);
      if (qIdx >= 0) {
        const [removed] = queuedCalls.splice(qIdx, 1);
        await prisma.callRecord.updateMany({
          where: { callId: removed.callId },
          data: { status: 'missed', endTime: new Date() }
        });
        broadcastQueueStats();
      }
    });
  });
}
