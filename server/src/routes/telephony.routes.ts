import { Router, Request, Response } from 'express';
import { telephonyService } from '../services/telephony.js';
import { translationService } from '../services/translation.js';
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

    // 1. Idempotency Check: Check if this CallSid already exists or if pre-registered
    let existingCall = null;
    if (CallSid) {
      existingCall = await prisma.callRecord.findUnique({
        where: { providerCallSid: CallSid }
      });
    }

    if (!existingCall && cleanPhone) {
      // Check if this call was pre-registered in the last 60 seconds
      existingCall = await prisma.callRecord.findFirst({
        where: {
          customerPhone: cleanPhone,
          status: { in: ['active', 'ringing'] },
          direction: 'outgoing',
          startTime: { gte: new Date(Date.now() - 60000) }
        },
        orderBy: { startTime: 'desc' }
      });
    }

    let callRecordId = '';
    let callId = '';

    if (existingCall) {
      // Update existing record rather than creating a duplicate
      const updated = await prisma.callRecord.update({
        where: { id: existingCall.id },
        data: {
          providerCallSid: CallSid || existingCall.providerCallSid,
          status: 'ringing'
        }
      });
      callRecordId = updated.id;
      callId = updated.callId;
      console.log(`[Telephony Webhook: Voice] Linked CallSid ${CallSid} to existing CallRecord ${callId}`);
    } else {
      // Look up customer by phone number
      const customer = await prisma.user.findFirst({
        where: {
          role: 'customer',
          phone: cleanPhone
        }
      });

      callId = 'call_pstn_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

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
      callRecordId = newCall.id;
    }

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

// 4A. Voice AI Outbound Telephone Call
router.post('/ai-call', authenticate, requireRole(['agent', 'admin']), async (req: Request, res: Response) => {
  try {
    const { customerId, customerName, customerPhone, language } = req.body;
    if (!customerPhone) {
      res.status(400).json({ error: 'Customer phone number is required.' });
      return;
    }

    const cleanPhone = customerPhone.trim();
    const callLang = language || 'en';
    const callId = 'pstn_ai_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

    const callRecord = await prisma.callRecord.create({
      data: {
        callId,
        providerCallSid: callId,
        customerId: customerId || null,
        customerName: customerName || 'Mobile Customer',
        customerPhone: cleanPhone,
        agentId: req.user!.id,
        agentName: req.user!.name,
        type: 'ai_voice',
        direction: 'outgoing',
        status: 'ringing',
        language: callLang,
        startTime: new Date(),
        providerName: 'twilio'
      }
    });

    const io = req.app.get('io');
    if (io) {
      io.to('role:agent').to('role:admin').emit('call:status_changed', {
        callId,
        status: 'ringing'
      });
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const result = await telephonyService.initiateOutboundAiCall(cleanPhone, customerName || 'Customer', callLang, baseUrl);

    if (result.success && result.callSid) {
      await prisma.callRecord.update({
        where: { id: callRecord.id },
        data: { providerCallSid: result.callSid }
      });
    }

    res.json({
      success: true,
      callId,
      callRecord,
      telephonyResult: result
    });
  } catch (err: any) {
    console.error('[AI Telephony Call Error]', err);
    res.status(500).json({ error: err.message || 'Failed to initiate outbound AI phone call.' });
  }
});

// 4B. Voice AI Dialogue Entry Point (TwiML)
router.all('/ai-dialogue', async (req: Request, res: Response) => {
  try {
    const lang = (req.query.lang as string) || (req.body?.lang as string) || 'en';
    const twiml = await telephonyService.generateAiGreetingTwiML(lang);
    res.type('text/xml');
    res.send(twiml);
  } catch (err: any) {
    console.error('[AI Dialogue Error]', err);
    res.type('text/xml');
    res.send('<Response><Say>Welcome to KAIRA Technologies. Please ask your question.</Say><Gather input="speech" action="/api/telephony/process-speech"/></Response>');
  }
});

// 4C. Real-Time Speech Processing & Grounded Answer Webhook
router.post('/process-speech', async (req: Request, res: Response) => {
  try {
    const { SpeechResult, CallSid, From, To } = req.body;
    const queryLang = (req.query.lang as string) || 'en';
    const speech = (SpeechResult || '').trim();

    console.log(`[Telephony Speech] Received speech from ${From} (CallSid: ${CallSid}): "${speech}"`);

    // Find active call record
    let callRecord = await prisma.callRecord.findFirst({
      where: {
        OR: [
          { providerCallSid: CallSid },
          { customerPhone: From },
          { customerPhone: To }
        ]
      },
      orderBy: { startTime: 'desc' }
    });

    const callLang = callRecord?.language || queryLang || 'en';
    const io = req.app.get('io');

    if (!speech) {
      const promptText = callLang === 'ta' ? 'தயவுசெய்து உங்கள் கேள்வியைக் கேளுங்கள்.' :
        callLang === 'te' ? 'దయచేసి మీ ప్రశ్నను అడగండి.' :
          callLang === 'ml' ? 'ദയവായി നിങ്ങളുടെ ചോദ്യം ചോദിക്കുക.' :
            callLang === 'hi' ? 'कृपया अपना प्रश्न पूछें।' :
              'Please state your question.';

      const twiml = telephonyService.generateAiResponseTwiML(promptText, callLang, false);
      res.type('text/xml');
      res.send(twiml);
      return;
    }

    // 1. Broadcast customer speech transcript immediately via Socket.io
    if (callRecord) {
      await prisma.callTranscript.create({
        data: {
          callRecordId: callRecord.id,
          sender: 'customer',
          senderName: callRecord.customerName,
          text: speech,
          language: callLang
        }
      });
    }

    if (io && callRecord) {
      io.to(`call:${callRecord.callId}`).to('role:agent').to('role:admin').emit('call:live_transcript', {
        callId: callRecord.callId,
        sender: 'customer',
        senderName: callRecord.customerName,
        text: speech,
        language: callLang,
        timestamp: new Date()
      });
    }

    // 2. Query approved Knowledge Base strictly
    const aiResult = await translationService.getAiAnswerSuggestion(speech, callLang);

    if (aiResult.isGrounded && aiResult.answer) {
      // Grounded answer found in KB
      if (callRecord) {
        await prisma.callTranscript.create({
          data: {
            callRecordId: callRecord.id,
            sender: 'ai',
            senderName: 'KAIRA AI',
            text: aiResult.answer,
            language: aiResult.language
          }
        });
      }

      if (io && callRecord) {
        io.to(`call:${callRecord.callId}`).to('role:agent').to('role:admin').emit('call:live_transcript', {
          callId: callRecord.callId,
          sender: 'ai',
          senderName: 'KAIRA AI',
          text: aiResult.answer,
          language: aiResult.language,
          timestamp: new Date()
        });
      }

      // Customer hears the AI answer spoken directly through their phone
      const twiml = telephonyService.generateAiResponseTwiML(aiResult.answer, aiResult.language, false);
      res.type('text/xml');
      res.send(twiml);
    } else {
      // Zero Hallucination: Not in KB -> trigger Admin transfer
      console.log(`[Telephony Speech] Query not in approved KB: "${speech}". Escalating to Admin.`);

      if (callRecord) {
        await prisma.callRecord.update({
          where: { id: callRecord.id },
          data: {
            transferred: true,
            transferReason: `Unanswered: "${speech}"`,
            customerQuestion: speech,
            type: 'admin_transfer'
          }
        });

        const transferReq = await prisma.callTransferRequest.create({
          data: {
            callRecordId: callRecord.id,
            customerId: callRecord.customerId,
            customerName: callRecord.customerName,
            customerPhone: callRecord.customerPhone,
            question: speech,
            reason: 'Information unavailable in approved Knowledge Base',
            status: 'ringing'
          }
        });

        if (io) {
          io.to('role:admin').emit('transfer:incoming', {
            transferId: transferReq.id,
            callId: callRecord.callId,
            callRecordId: callRecord.id,
            customerName: callRecord.customerName,
            customerPhone: callRecord.customerPhone,
            question: speech,
            reason: 'Information unavailable in approved Knowledge Base',
            language: callLang,
            createdAt: transferReq.createdAt
          });
        }
      }

      const fallbackText = aiResult.answer || (
        callLang === 'ta' ? 'இதைப் பற்றிய சரிபார்க்கப்பட்ட தகவல் என்னிடம் இல்லை. நிர்வாகியுடன் உங்களை இணைக்கிறேன்.' :
          callLang === 'te' ? 'నా దగ్గర దీని గురించి ధృవీకరించబడిన సమాచారం లేదు. నేను మిమ్మల్ని అడ్మిన్‌తో కనెక్ట్ చేస్తాను.' :
            callLang === 'ml' ? 'ഇതിനെക്കുറിച്ച് സ്ഥിരീകരിച്ച വിവരങ്ങൾ എന്റെ പക്കലില്ല. ഞാൻ നിങ്ങളെ ഒരു അഡ്മിനുമായി ബന്ധിപ്പിക്കാം.' :
              callLang === 'hi' ? 'मेरे पास इसके बारे में सत्यापित जानकारी नहीं है। मैं आपको एडमिन से जोड़ता हूँ।' :
                "I don't have verified information about this. Let me connect you to an Admin."
      );

      const twiml = telephonyService.generateAiResponseTwiML(fallbackText, callLang, true);
      res.type('text/xml');
      res.send(twiml);
    }
  } catch (err: any) {
    console.error('[Telephony Speech Error]', err);
    res.type('text/xml');
    res.send('<Response><Say>An error occurred. Please hold while we transfer you to an administrator.</Say><Dial><Client>admin</Client></Dial></Response>');
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

    const cleanPhone = customerPhone.trim();

    // Idempotency: check if an identical outbound call was initiated in the last 15 seconds
    const recentDuplicate = await prisma.callRecord.findFirst({
      where: {
        agentId: req.user!.id,
        customerPhone: cleanPhone,
        direction: 'outgoing',
        status: { in: ['active', 'ringing'] },
        startTime: { gte: new Date(Date.now() - 15000) }
      },
      orderBy: { startTime: 'desc' }
    });

    if (recentDuplicate) {
      res.json({
        success: true,
        callId: recentDuplicate.callId,
        callRecord: recentDuplicate
      });
      return;
    }

    const callId = 'pstn_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

    const callRecord = await prisma.callRecord.create({
      data: {
        callId,
        customerId: customerId || null,
        customerName: customerName || 'Mobile Customer',
        customerPhone: cleanPhone,
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

