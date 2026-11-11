import { Server as SocketIOServer, Socket } from 'socket.io';
import { prisma } from '../db.js';
import { knowledgeService, FALLBACK_MESSAGE } from './knowledge.js';
import { translationService, SUPPORTED_LANGUAGES } from './translation.js';
import { sentimentService } from './sentiment.js';
import { callIntelligenceService } from './callIntelligence.js';

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
  customerPhone?: string;
  preferredLanguage: string;
  socketId: string;
  queuedAt: number;
  rejectedByAgents: Set<string>;
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
      preferredLanguage?: string;
      supportedLanguages?: string[];
      agentStatus?: 'available' | 'busy';
    }) => {
      try {
        // Query database to fetch up-to-date user preferences
        let dbUser = await prisma.user.findUnique({
          where: { id: data.userId }
        });

        const preferredLanguage = data.preferredLanguage || dbUser?.preferredLanguage || 'en';
        const supportedLanguages = data.supportedLanguages || (dbUser?.supportedLanguages ? dbUser.supportedLanguages.split(',') : ['en', 'ta', 'te', 'ml', 'hi']);
        const agentStatus = (data.agentStatus || (dbUser?.agentStatus as any) || 'available') as 'available' | 'busy' | 'offline';
        const maxConcurrentCalls = dbUser?.maxConcurrentCalls || 1;

        const user: ConnectedUser = {
          socketId: socket.id,
          userId: data.userId,
          role: data.role,
          name: data.name,
          preferredLanguage,
          supportedLanguages,
          agentStatus,
          activeCalls: new Set<string>(),
          maxConcurrentCalls
        };

        connectedUsers.set(socket.id, user);

        socket.join(`user:${data.userId}`);
        if (data.role === 'admin') socket.join('role:admin');
        if (data.role === 'agent') socket.join('role:agent');

        console.log(`[Socket] Registered: ${data.name} (${data.role}) - Lang: ${preferredLanguage}, Status: ${agentStatus}`);

        // If agent just registered as available, check if someone is waiting in queue!
        if (data.role === 'agent' || data.role === 'admin') {
          await checkWaitingQueueForAgent(user);
        }

        // Send current queue stats to registered agent/admin
        if (data.role === 'admin' || data.role === 'agent') {
          broadcastQueueStats();
        }
      } catch (err) {
        console.error('[Socket] Error registering user:', err);
      }
    });

    // 1. Customer calls Customer Support Agent (Multilingual routing & queueing)
    socket.on('customer:call_agent', async (data: {
      callId: string;
      customerId: string;
      customerName: string;
      customerPhone?: string;
      preferredLanguage: string;
    }) => {
      try {
        console.log(`[SupportCall] Customer ${data.customerName} calling support in language: ${data.preferredLanguage}`);
        socket.join(`call:${data.callId}`);

        let validCustomerId: string | null = null;
        if (data.customerId) {
          const user = await prisma.user.findUnique({ where: { id: data.customerId } });
          if (user) {
            validCustomerId = user.id;
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
            customerName: data.customerName,
            customerPhone: data.customerPhone,
            preferredLanguage: data.preferredLanguage,
            customerSocketId: socket.id
          });
        } else if (adminSession) {
          console.log(`[SupportCall] Routing call directly to available Admin Operator ${adminSession.operatorName}`);
          await dispatchCallToAdminSession(data.callId, adminSession, {
            customerId: validCustomerId,
            customerName: data.customerName,
            customerPhone: data.customerPhone,
            preferredLanguage: data.preferredLanguage,
            customerSocketId: socket.id
          });
        } else if (agent) {
          await dispatchCallToAgent(data.callId, agent, {
            customerId: validCustomerId,
            customerName: data.customerName,
            customerPhone: data.customerPhone,
            preferredLanguage: data.preferredLanguage,
            customerSocketId: socket.id
          });
        } else {
          // No agent or administrator currently available -> place in FIFO waiting queue
          console.log(`[SupportCall] No staff available for ${data.preferredLanguage}, placing customer in queue`);
          await enqueueCall({
            callId: data.callId,
            customerId: validCustomerId,
            customerName: data.customerName,
            customerPhone: data.customerPhone,
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

        let call = await prisma.callRecord.findUnique({
          where: { callId: data.callId }
        });

        let validCustomerId: string | null = null;
        if (data.customerId) {
          const userExists = await prisma.user.findUnique({
            where: { id: data.customerId }
          });
          if (userExists) validCustomerId = userExists.id;
        }

        const isNewCall = !call;
        const callLang = data.language || 'en';

        if (!call) {
          call = await prisma.callRecord.create({
            data: {
              callId: data.callId,
              customerId: validCustomerId,
              customerName: data.customerName,
              customerPhone: data.customerPhone || null,
              type: 'ai_voice',
              direction: 'incoming',
              status: 'active',
              language: callLang,
              startTime: new Date()
            }
          });
        }

        // Welcome greeting in customer's language
        let greeting = "Hello! Welcome to KAIRA. I am your AI assistant. How may I help you today?";
        if (callLang !== 'en') {
          greeting = await translationService.translateText(greeting, callLang, 'en');
        }

        if (isNewCall) {
          await prisma.callTranscript.create({
            data: {
              callRecordId: call.id,
              sender: 'ai',
              senderName: 'KAIRA AI',
              text: greeting,
              language: callLang
            }
          });
        }

        socket.emit('call:ready', {
          callId: data.callId,
          greeting,
          status: 'active',
          language: callLang,
          audioUrl: `/api/voice/tts?text=${encodeURIComponent(greeting)}&lang=${callLang}`
        });

        io.to('role:admin').to('role:agent').emit('call:status_changed', { callId: data.callId, status: 'active' });
      } catch (err) {
        console.error('[Call] Error in call:start:', err);
        socket.emit('call:error', { message: 'Could not start call.' });
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

    // 8. Customer speaks a query to the AI assistant
    socket.on('call:query', async (data: {
      callId: string;
      query: string;
      customerId: string;
      duration?: number;
      language?: string;
    }) => {
      try {
        const queryText = data.query.trim();
        if (!queryText) return;

        const call = await prisma.callRecord.findUnique({
          where: { callId: data.callId }
        });
        if (!call) return;

        const callLang = data.language || call.language || 'en';

        // Record customer's speech in transcript
        await prisma.callTranscript.create({
          data: {
            callRecordId: call.id,
            sender: 'customer',
            senderName: call.customerName,
            text: queryText,
            language: callLang
          }
        });

        // AI Sentiment Analysis on customer query
        const sentimentResult = await sentimentService.processCustomerUtterance({
          callId: data.callId,
          text: queryText,
          language: callLang,
          customerId: call.customerId
        });

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

        // Multilingual grounded knowledge retrieval
        const response = await translationService.getAiAnswerSuggestion(queryText, callLang);

        if (!response.isGrounded) {
          console.log(`[AICall] Query requires transfer to Admin/Agent: "${queryText}"`);

          await prisma.callRecord.update({
            where: { id: call.id },
            data: {
              transferred: true,
              transferReason: `Unanswered: "${queryText}"`,
              customerQuestion: queryText,
              type: 'admin_transfer'
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
                customerPhone: call.customerPhone,
                question: queryText,
                reason: 'Information unavailable in approved Knowledge Base',
                status: 'ringing'
              }
            });
          }

          let fallbackNotice = response.answer || FALLBACK_MESSAGE;
          const respLang = response.language || callLang;
          if (respLang !== 'en' && !response.answer) {
            fallbackNotice = await translationService.translateText(fallbackNotice, respLang, 'en');
          }

          // Record fallback in DB transcript
          await prisma.callTranscript.create({
            data: {
              callRecordId: call.id,
              sender: 'ai',
              senderName: 'KAIRA AI',
              text: fallbackNotice,
              language: respLang
            }
          });

          socket.emit('call:ai_response', {
            answer: fallbackNotice,
            isTransferring: true,
            transferId: transferReq.id,
            language: respLang,
            audioUrl: `/api/voice/tts?text=${encodeURIComponent(fallbackNotice)}&lang=${respLang}`
          });

          // Broadcast to call participants
          io.to(`call:${data.callId}`).emit('call:live_transcript', {
            sender: 'ai',
            senderName: 'KAIRA AI',
            text: fallbackNotice,
            language: respLang,
            timestamp: new Date()
          });

          // Intelligent ACD: Route ungrounded question directly to an available Admin Operator session
          const availableAdmin = findNextAvailableAdminSession(respLang);
          if (availableAdmin) {
            console.log(`[Transfer] Routing ungrounded query directly to available Admin Operator ${availableAdmin.operatorName}`);
            await dispatchCallToAdminSession(data.callId, availableAdmin, {
              customerId: call.customerId,
              customerName: call.customerName,
              customerPhone: call.customerPhone || 'Not provided',
              preferredLanguage: respLang,
              customerSocketId: socket.id,
              transferId: transferReq.id,
              question: queryText,
              callRecordId: call.id,
              duration: data.duration || 0
            });
          } else {
            // Fallback: broadcast transfer alert to admins if all operators are currently busy
            io.to('role:admin').emit('transfer:incoming', {
              transferId: transferReq.id,
              callId: data.callId,
              callRecordId: call.id,
              customerId: call.customerId,
              customerName: call.customerName,
              customerPhone: call.customerPhone || 'Not provided',
              question: queryText,
              reason: 'Information unavailable in approved Knowledge Base',
              duration: data.duration || 0,
              language: respLang,
              createdAt: transferReq.createdAt
            });
          }
        } else {
          const respLang = response.language || callLang;
          const aiText = response.answer || FALLBACK_MESSAGE;
          // Record AI's response in transcript
          await prisma.callTranscript.create({
            data: {
              callRecordId: call.id,
              sender: 'ai',
              senderName: 'KAIRA AI',
              text: aiText,
              language: respLang
            }
          });

          socket.emit('call:ai_response', {
            answer: aiText,
            isTransferring: false,
            sources: response.sources,
            language: respLang,
            audioUrl: `/api/voice/tts?text=${encodeURIComponent(aiText)}&lang=${respLang}`
          });

          // Broadcast to call participants
          io.to(`call:${data.callId}`).emit('call:live_transcript', {
            sender: 'ai',
            senderName: 'KAIRA AI',
            text: aiText,
            language: respLang,
            timestamp: new Date()
          });
        }
      } catch (err) {
        console.error('[AICall] Error in call:query:', err);
      }
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
        const suggestion = await translationService.getAiAnswerSuggestion(data.query, targetLang);

        socket.emit('call:kb_suggestion', {
          callId: data.callId,
          query: data.query,
          answer: suggestion.answer,
          sources: suggestion.sources,
          isGrounded: suggestion.isGrounded,
          language: targetLang
        });
      } catch (err) {
        console.error('[KBSuggest] Error fetching suggestion:', err);
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

    // 13. Admin accepts a live call transfer
    socket.on('transfer:accept', async (data: { transferId: string; adminId: string; adminName: string }) => {
      try {
        console.log(`[Transfer] Admin ${data.adminName} accepted transfer ${data.transferId}`);

        const transfer = await prisma.callTransferRequest.findUnique({
          where: { id: data.transferId },
          include: { callRecord: true }
        });

        if (!transfer) {
          socket.emit('transfer:error', { message: 'Transfer request not found.' });
          return;
        }

        if (transfer.status === 'accepted' || transfer.status === 'connected') {
          socket.emit('transfer:already_handled', { message: 'This transfer was already accepted by another Admin.' });
          return;
        }

        let validAdminId: string | null = null;
        if (data.adminId) {
          const adminExists = await prisma.user.findUnique({ where: { id: data.adminId } });
          if (adminExists) validAdminId = adminExists.id;
        }

        await prisma.callTransferRequest.update({
          where: { id: data.transferId },
          data: {
            status: 'connected',
            adminId: validAdminId,
            respondedAt: new Date()
          }
        });

        await prisma.callRecord.update({
          where: { id: transfer.callRecordId },
          data: {
            adminId: validAdminId,
            transferred: true,
            status: 'active'
          }
        });

        await prisma.callTranscript.create({
          data: {
            callRecordId: transfer.callRecordId,
            sender: 'system',
            senderName: 'System',
            text: `Call transferred to Admin: ${data.adminName}. Live two-way voice connection established.`
          }
        });

        socket.join(`call:${transfer.callRecord.callId}`);

        io.to('role:admin').emit('transfer:status_updated', {
          transferId: data.transferId,
          status: 'connected',
          adminName: data.adminName
        });

        socket.emit('transfer:accepted_success', {
          callId: transfer.callRecord.callId,
          transferId: data.transferId,
          customerName: transfer.customerName,
          customerPhone: transfer.customerPhone,
          question: transfer.question
        });

        io.to(`call:${transfer.callRecord.callId}`).emit('transfer:connected', {
          callId: transfer.callRecord.callId,
          adminId: data.adminId,
          adminName: data.adminName,
          adminSocketId: socket.id
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
      customerPhone?: string;
      preferredLanguage: string;
    }) => {
      try {
        console.log(`[CustomerCallAdmin] Customer ${data.customerName} calling Admin in ${data.preferredLanguage}`);
        socket.join(`call:${data.callId}`);

        const adminSession = findNextAvailableAdminSession(data.preferredLanguage);
        if (adminSession) {
          await dispatchCallToAdminSession(data.callId, adminSession, {
            customerId: data.customerId,
            customerName: data.customerName,
            customerPhone: data.customerPhone,
            preferredLanguage: data.preferredLanguage,
            customerSocketId: socket.id
          });
        } else {
          // No admin available -> queue call
          await enqueueCall({
            callId: data.callId,
            customerId: data.customerId,
            customerName: data.customerName,
            customerPhone: data.customerPhone,
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
    socket.on('webrtc:offer', (data: { target: string; offer: any; callId: string }) => {
      if (data.target) {
        io.to(data.target).emit('webrtc:offer', {
          sender: socket.id,
          offer: data.offer,
          callId: data.callId
        });
      } else {
        socket.to(`call:${data.callId}`).emit('webrtc:offer', {
          sender: socket.id,
          offer: data.offer,
          callId: data.callId
        });
      }
    });

    socket.on('webrtc:answer', (data: { target: string; answer: any; callId: string }) => {
      if (data.target) {
        io.to(data.target).emit('webrtc:answer', {
          sender: socket.id,
          answer: data.answer,
          callId: data.callId
        });
      } else {
        socket.to(`call:${data.callId}`).emit('webrtc:answer', {
          sender: socket.id,
          answer: data.answer,
          callId: data.callId
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

    // 16b. Live Call Reconnection & Reliability Events
    socket.on('call:reconnecting', (data: { callId: string; attempt?: number; reason?: string }) => {
      console.log(`[CallReconnect] Call ${data.callId} reconnecting: attempt ${data.attempt || 1} (${data.reason || 'network'})`);
      socket.to(`call:${data.callId}`).emit('call:reconnecting', data);
      io.to('role:admin').emit('call:reconnecting', data);
    });

    socket.on('call:reconnected', async (data: { callId: string }) => {
      console.log(`[CallReconnect] Call ${data.callId} reconnected successfully!`);
      socket.to(`call:${data.callId}`).emit('call:reconnected', data);
      io.to('role:admin').emit('call:reconnected', data);

      try {
        await prisma.callRecord.updateMany({
          where: { callId: data.callId },
          data: {
            wasReconnected: true,
            reconnectCount: { increment: 1 }
          }
        });
      } catch (e) {
        console.error('[CallReconnect] Failed to update reconnectCount:', e);
      }
    });

    socket.on('call:reconnect_failed', async (data: { callId: string; reason?: string }) => {
      console.log(`[CallReconnect] Call ${data.callId} reconnection failed: ${data.reason}`);
      socket.to(`call:${data.callId}`).emit('call:reconnect_failed', data);

      try {
        await prisma.callRecord.updateMany({
          where: { callId: data.callId },
          data: {
            status: 'disconnected',
            endedBy: 'network',
            failureReason: data.reason || 'Network connection lost. Reconnection timed out.'
          }
        });
      } catch (e) {
        console.error('[CallReconnect] Failed to update disconnected status:', e);
      }
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
              status: 'completed',
              endTime: new Date(),
              duration,
              endedBy: data.endedBy || 'user',
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

          // Asynchronously trigger post-call AI intelligence analysis without delaying termination
          setTimeout(() => {
            callIntelligenceService.processCall(call.id).catch(err => {
              console.error('[Socket] Asynchronous call intelligence error:', err);
            });
          }, 300);
        }

        io.to(`call:${data.callId}`).emit('call:ended', {
          callId: data.callId,
          duration: data.duration,
          endedBy: data.endedBy || 'user'
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
