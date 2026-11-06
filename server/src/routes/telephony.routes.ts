import { Router, Request, Response } from 'express';
import { telephonyService } from '../services/telephony.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { prisma } from '../db.js';

const router = Router();

// 1. Get Telephony Provider Configuration Status
router.get('/status', (req: Request, res: Response) => {
  const status = telephonyService.getStatus();
  res.json(status);
});

// 2. Generate Twilio Voice SDK Access Token for Browser Client
router.get('/token', authenticate, requireRole(['agent', 'admin']), (req: Request, res: Response) => {
  try {
    const identity = `agent_${req.user!.id}_${Date.now()}`;
    const token = telephonyService.generateVoiceToken(identity);

    res.json({
      success: true,
      token,
      identity,
      callerId: process.env.TWILIO_CALLER_ID
    });
  } catch (err: any) {
    console.error('[Telephony] Error generating voice token:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to generate voice access token.'
    });
  }
});

// 3. Twilio TwiML Webhook – Called when Agent Browser Dials Customer Phone
router.post('/voice', async (req: Request, res: Response) => {
  try {
    const { To, From, CallSid, agentId } = req.body;
    console.log(`[Telephony Webhook: Voice] Outbound call from Agent ${From} to ${To} (CallSid: ${CallSid})`);

    const cleanPhone = (To || '').trim();

    // Look up customer by phone number
    const customer = await prisma.user.findFirst({
      where: {
        role: 'customer',
        phone: cleanPhone
      }
    });

    const callId = 'call_pstn_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

    // Create database CallRecord
    const newCall = await prisma.callRecord.create({
      data: {
        callId,
        providerCallSid: CallSid || callId,
        providerName: 'twilio',
        customerId: customer ? customer.id : null,
        customerName: customer ? customer.name : `Mobile Customer (${cleanPhone})`,
        customerPhone: cleanPhone,
        agentId: agentId || null,
        type: 'agent_voice',
        direction: 'outgoing',
        status: 'ringing',
        startTime: new Date()
      }
    });

    // Notify connected clients via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to('role:agent').to('role:admin').emit('call:status_changed', {
        callId,
        status: 'ringing'
      });
    }

    // Generate TwiML to dial the customer's real mobile phone
    const twiml = telephonyService.generateTwiML(cleanPhone);
    res.type('text/xml');
    res.send(twiml);
  } catch (err: any) {
    console.error('[Telephony Voice] Error generating TwiML:', err);
    res.type('text/xml');
    res.send('<Response><Say>An error occurred connecting your call.</Say></Response>');
  }
});

// 4. Twilio Status Callback Webhook – Authoritative Call Lifecycle Tracker
router.post('/status-callback', async (req: Request, res: Response) => {
  try {
    const io = req.app.get('io');
    await telephonyService.handleCallStatusWebhook(req.body, io);
    res.type('text/xml');
    res.send('<Response/>');
  } catch (err: any) {
    console.error('[Telephony Webhook: Status] Error:', err);
    res.status(500).send('Error');
  }
});

// 5. Pre-register / Validate Outgoing Call from Frontend
router.post('/register-call', authenticate, requireRole(['agent', 'admin']), async (req: Request, res: Response) => {
  try {
    const { customerId, customerName, customerPhone } = req.body;

    if (!customerPhone) {
      res.status(400).json({ error: 'Customer phone number is required.' });
      return;
    }

    const callId = 'pstn_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

    const callRecord = await prisma.callRecord.create({
      data: {
        callId,
        customerId: customerId || null,
        customerName: customerName || 'Mobile Customer',
        customerPhone,
        agentId: req.user!.id,
        agentName: req.user!.name,
        type: 'agent_voice',
        direction: 'outgoing',
        status: 'active',
        startTime: new Date(),
        providerName: 'twilio'
      }
    });

    // Initial transcript entry
    await prisma.callTranscript.create({
      data: {
        callRecordId: callRecord.id,
        sender: 'system',
        senderName: 'System',
        text: `Support Agent ${req.user!.name} initiated telephone call to ${customerPhone}.`
      }
    });

    const io = req.app.get('io');
    if (io) {
      io.to('role:agent').to('role:admin').emit('call:status_changed', {
        callId: callRecord.callId,
        status: 'active'
      });
    }

    res.json({
      success: true,
      callId,
      callRecord
    });
  } catch (err: any) {
    console.error('[Telephony Register Call] Error:', err);
    res.status(500).json({ error: 'Failed to initiate outbound call record.' });
  }
});

// 6. Update Outbound Call (e.g. End Call, Log Duration)
router.post('/end-call', authenticate, requireRole(['agent', 'admin']), async (req: Request, res: Response) => {
  try {
    const { callId, duration, failureReason } = req.body;

    const call = await prisma.callRecord.findFirst({
      where: {
        OR: [
          { callId },
          { providerCallSid: callId }
        ]
      }
    });

    if (call) {
      const parsedDuration = typeof duration === 'number' ? duration : call.duration;
      await prisma.callRecord.update({
        where: { id: call.id },
        data: {
          status: 'completed',
          duration: parsedDuration,
          endTime: new Date(),
          failureReason: failureReason || null
        }
      });

      await prisma.callTranscript.create({
        data: {
          callRecordId: call.id,
          sender: 'system',
          senderName: 'System',
          text: `Call ended. Total duration: ${parsedDuration} seconds.`
        }
      });

      const io = req.app.get('io');
      if (io) {
        io.to('role:agent').to('role:admin').emit('call:status_changed', {
          callId: call.callId,
          status: 'completed'
        });
      }
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to end call record.' });
  }
});

export default router;
