import { Server as SocketIOServer, Socket } from 'socket.io';
import { prisma } from '../db.js';
import { knowledgeService, FALLBACK_MESSAGE } from './knowledge.js';

interface ConnectedUser {
  socketId: string;
  userId: string;
  role: string;
  name: string;
}

export function initSocketServer(io: SocketIOServer) {
  const connectedUsers = new Map<string, ConnectedUser>(); // socketId -> User

  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    // Register user with their role and user ID
    socket.on('user:register', async (data: { userId: string; role: string; name: string }) => {
      connectedUsers.set(socket.id, {
        socketId: socket.id,
        userId: data.userId,
        role: data.role,
        name: data.name
      });

      socket.join(`user:${data.userId}`);
      if (data.role === 'admin') socket.join('role:admin');
      if (data.role === 'agent') socket.join('role:agent');

      console.log(`[Socket] User registered: ${data.name} (${data.role})`);
    });

    // 1. Customer starts AI voice call
    socket.on('call:start', async (data: {
      callId: string;
      customerId: string;
      customerName: string;
      customerPhone?: string;
    }) => {
      try {
        console.log(`[Call] Starting AI call: ${data.callId} for ${data.customerName}`);
        socket.join(`call:${data.callId}`);

        // Create or find existing call record
        let call = await prisma.callRecord.findUnique({
          where: { callId: data.callId }
        });

        // Verify if customerId exists in DB to prevent foreign key constraint error
        let validCustomerId: string | null = null;
        if (data.customerId) {
          const userExists = await prisma.user.findUnique({
            where: { id: data.customerId }
          });
          if (userExists) validCustomerId = userExists.id;
        }

        const isNewCall = !call;

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
              startTime: new Date()
            }
          });
        }

        const greeting = "Hello! Welcome to KAIRA. I am your AI assistant. How may I help you today?";

        // Add initial greeting transcript ONLY if this is a newly created call
        if (isNewCall) {
          await prisma.callTranscript.create({
            data: {
              callRecordId: call.id,
              sender: 'ai',
              senderName: 'KAIRA AI',
              text: greeting
            }
          });
        }

        socket.emit('call:ready', {
          callId: data.callId,
          greeting,
          status: 'active'
        });

        // Notify admins and agents of active call count update
        io.to('role:admin').to('role:agent').emit('call:status_changed', { callId: data.callId, status: 'active' });
      } catch (err) {
        console.error('[Call] Error in call:start:', err);
        socket.emit('call:error', { message: 'Could not start call.' });
      }
    });

    // 2. Customer speaks a query to the AI agent
    socket.on('call:query', async (data: {
      callId: string;
      query: string;
      customerId: string;
      duration?: number;
    }) => {
      try {
        const queryText = data.query.trim();
        if (!queryText) return;

        const call = await prisma.callRecord.findUnique({
          where: { callId: data.callId }
        });

        if (!call) return;

        // Record customer's speech in transcript
        await prisma.callTranscript.create({
          data: {
            callRecordId: call.id,
            sender: 'customer',
            senderName: call.customerName,
            text: queryText
          }
        });

        // Grounded knowledge retrieval
        const response = await knowledgeService.answerQuery(queryText);

        // Record AI's response in transcript
        await prisma.callTranscript.create({
          data: {
            callRecordId: call.id,
            sender: 'ai',
            senderName: 'KAIRA AI',
            text: response.answer
          }
        });

        if (response.requiresTransfer) {
          console.log(`[Call] Query requires transfer to Admin: "${queryText}"`);

          // Update call record
          await prisma.callRecord.update({
            where: { id: call.id },
            data: {
              transferred: true,
              transferReason: `Unanswered: "${queryText}"`,
              customerQuestion: queryText,
              type: 'admin_transfer'
            }
          });

          // Idempotent Transfer Request: reuse or update active transfer instead of duplicating
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
          } else {
            // Update question if customer clarified their inquiry
            transferReq = await prisma.callTransferRequest.update({
              where: { id: transferReq.id },
              data: {
                question: queryText,
                status: 'ringing'
              }
            });
          }

          // Tell the customer: AI speaks fallback and transfer is starting
          socket.emit('call:ai_response', {
            answer: FALLBACK_MESSAGE,
            isTransferring: true,
            transferId: transferReq.id
          });

          // Broadcast incoming transfer alert to all Admins!
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
            createdAt: transferReq.createdAt
          });

          // Set 30-second timeout for unattended transfer
          setTimeout(async () => {
            const check = await prisma.callTransferRequest.findUnique({
              where: { id: transferReq.id }
            });
            if (check && check.status === 'ringing') {
              console.log(`[Transfer] Timeout on transfer ${transferReq.id}`);
              await prisma.callTransferRequest.update({
                where: { id: transferReq.id },
                data: { status: 'missed', respondedAt: new Date() }
              });

              socket.emit('transfer:timeout', {
                message: "Our Admin is currently unavailable. Your request and contact details have been saved, and an Admin will follow up with you shortly."
              });

              io.to('role:admin').emit('transfer:updated', {
                transferId: transferReq.id,
                status: 'missed'
              });
            }
          }, 30000);
        } else {
          // Normal grounded answer
          socket.emit('call:ai_response', {
            answer: response.answer,
            isTransferring: false,
            sources: response.sources
          });
        }
      } catch (err) {
        console.error('[Call] Error in call:query:', err);
      }
    });

    // 3. Admin accepts a live call transfer
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

        // Safe admin ID check
        let validAdminId: string | null = null;
        if (data.adminId) {
          const adminExists = await prisma.user.findUnique({ where: { id: data.adminId } });
          if (adminExists) validAdminId = adminExists.id;
        }

        // Lock transfer
        await prisma.callTransferRequest.update({
          where: { id: data.transferId },
          data: {
            status: 'connected',
            adminId: validAdminId,
            respondedAt: new Date()
          }
        });

        // Update call record
        await prisma.callRecord.update({
          where: { id: transfer.callRecordId },
          data: {
            adminId: validAdminId,
            transferred: true,
            status: 'active'
          }
        });

        // Record system transition transcript
        await prisma.callTranscript.create({
          data: {
            callRecordId: transfer.callRecordId,
            sender: 'system',
            senderName: 'System',
            text: `Call transferred to Admin: ${data.adminName}. Live two-way voice connection established.`
          }
        });

        // Admin joins call room
        socket.join(`call:${transfer.callRecord.callId}`);

        // Broadcast to all admins to clear the ringing alert
        io.to('role:admin').emit('transfer:status_updated', {
          transferId: data.transferId,
          status: 'connected',
          adminName: data.adminName
        });

        // Notify Admin they have connected
        socket.emit('transfer:accepted_success', {
          callId: transfer.callRecord.callId,
          transferId: data.transferId,
          customerName: transfer.customerName,
          customerPhone: transfer.customerPhone,
          question: transfer.question
        });

        // Notify Customer that Admin has joined and to start WebRTC audio
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

    // 4. Admin rejects a transfer request
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

        // Inform customer
        io.to(`call:${transfer.callRecord.callId}`).emit('transfer:rejected_notice', {
          message: "Our Admin is currently unavailable. Your question and contact details have been saved, and an Admin will follow up with you shortly."
        });

        // Update all admins
        io.to('role:admin').emit('transfer:status_updated', {
          transferId: data.transferId,
          status: 'rejected'
        });
      } catch (err) {
        console.error('[Transfer] Error rejecting transfer:', err);
      }
    });

    // 5. Agent initiates outgoing call to customer
    socket.on('agent:call:customer', async (data: {
      agentId: string;
      agentName: string;
      customerId: string;
      customerName: string;
      customerPhone?: string;
    }) => {
      try {
        const callId = 'call_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        console.log(`[AgentCall] Initiating outgoing call from Agent ${data.agentName} to ${data.customerName}`);

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

        // Notify customer of incoming call from Agent
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

    // Customer accepts agent's call
    socket.on('customer:accept_agent_call', async (data: { callId: string; customerId: string }) => {
      socket.join(`call:${data.callId}`);
      io.to(`call:${data.callId}`).emit('agent:call_connected', {
        callId: data.callId,
        customerSocketId: socket.id
      });
    });

    // 6. WebRTC Signaling Relays (Bidirectional Voice Mesh)
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

    // Live human voice transcript relay (for Admin <-> Customer speech recognition during live human call)
    socket.on('call:live_speech', async (data: {
      callId: string;
      sender: 'customer' | 'admin' | 'agent';
      senderName: string;
      text: string;
    }) => {
      try {
        const text = data.text.trim();
        if (!text) return;

        const call = await prisma.callRecord.findUnique({
          where: { callId: data.callId }
        });

        if (call) {
          await prisma.callTranscript.create({
            data: {
              callRecordId: call.id,
              sender: data.sender,
              senderName: data.senderName,
              text
            }
          });
        }

        // Broadcast to call participants
        io.to(`call:${data.callId}`).emit('call:live_transcript', {
          sender: data.sender,
          senderName: data.senderName,
          text,
          timestamp: new Date()
        });
      } catch (err) {
        console.error('[Call] Live speech error:', err);
      }
    });

    // 7. End Call
    socket.on('call:end', async (data: { callId: string; duration?: number }) => {
      try {
        console.log(`[Call] Ending call: ${data.callId}`);

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
              duration
            }
          });

          await prisma.callTranscript.create({
            data: {
              callRecordId: call.id,
              sender: 'system',
              senderName: 'System',
              text: `Call ended. Duration: ${duration}s.`
            }
          });
        }

        io.to(`call:${data.callId}`).emit('call:ended', {
          callId: data.callId,
          duration: data.duration
        });

        // Update admin/agent dashboards
        io.to('role:admin').to('role:agent').emit('call:status_changed', { callId: data.callId, status: 'completed' });
      } catch (err) {
        console.error('[Call] Error ending call:', err);
      }
    });

    // Disconnect cleanup
    socket.on('disconnect', () => {
      connectedUsers.delete(socket.id);
      console.log(`[Socket] Client disconnected: ${socket.id}`);
    });
  });
}
