import twilio from 'twilio';
import { prisma } from '../db.js';
import { translationService } from './translation.js';

export interface TelephonyStatus {
  configured: boolean;
  provider: string;
  callerId?: string;
  hasAppSid: boolean;
  hasCredentials: boolean;
  message?: string;
}

export const TWILIO_VOICE_MAP: Record<string, { voice: any; bcp47: string }> = {
  en: { voice: 'Polly.Aditi', bcp47: 'en-IN' },
  ta: { voice: 'Google.ta-IN-Standard-A', bcp47: 'ta-IN' },
  te: { voice: 'Google.te-IN-Standard-A', bcp47: 'te-IN' },
  ml: { voice: 'Google.ml-IN-Standard-A', bcp47: 'ml-IN' },
  hi: { voice: 'Polly.Aditi', bcp47: 'hi-IN' }
};

class TelephonyService {
  private twilioClient: twilio.Twilio | null = null;

  constructor() {
    this.initClient();
  }

  private initClient() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (accountSid && authToken && accountSid.startsWith('AC')) {
      try {
        this.twilioClient = twilio(accountSid, authToken);
        console.log('[Telephony] Twilio client initialized successfully.');
      } catch (err) {
        console.error('[Telephony] Failed to initialize Twilio client:', err);
      }
    }
  }

  public isConfigured(): boolean {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const appSid = process.env.TWILIO_TWIML_APP_SID;
    const callerId = process.env.TWILIO_CALLER_ID;
    return !!(sid && token && appSid && callerId && sid.startsWith('AC'));
  }

  public getStatus(): TelephonyStatus {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const appSid = process.env.TWILIO_TWIML_APP_SID;
    const callerId = process.env.TWILIO_CALLER_ID;

    const hasCreds = !!(sid && token && sid.trim() !== '');
    const hasApp = !!(appSid && appSid.trim() !== '');
    const configured = !!(hasCreds && hasApp && callerId && callerId.trim() !== '');

    let message = 'Twilio Real-Time Voice Telephony is active and ready for outbound PSTN calling.';
    if (!hasCreds) {
      message = 'Twilio Account SID or Auth Token missing in server/.env.';
    } else if (!hasApp) {
      message = 'Twilio TwiML App SID missing. Create a TwiML App in Twilio Console to route browser audio to PSTN.';
    } else if (!callerId) {
      message = 'Twilio Caller ID (verified phone number) missing in server/.env.';
    }

    return {
      configured,
      provider: 'twilio',
      callerId: callerId || undefined,
      hasAppSid: hasApp,
      hasCredentials: hasCreds,
      message
    };
  }

  // Generate an Access Token for Twilio Voice Client SDK (Browser)
  public generateVoiceToken(identity: string): string {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const twimlAppSid = process.env.TWILIO_TWIML_APP_SID;

    if (!accountSid || !authToken || !twimlAppSid) {
      throw new Error('Twilio credentials or TWILIO_TWIML_APP_SID not configured in server/.env');
    }

    const apiKey = process.env.TWILIO_API_KEY || accountSid;
    const apiSecret = process.env.TWILIO_API_SECRET || authToken;

    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: twimlAppSid,
      incomingAllow: true
    });

    const token = new AccessToken(accountSid, apiKey, apiSecret, {
      identity,
      ttl: 3600 // 1 hour token
    });

    token.addGrant(voiceGrant);
    return token.toJwt();
  }

  // Generate TwiML Voice Response to bridge the browser audio to the customer's phone
  public generateTwiML(destinationNumber: string, actionCallbackUrl?: string): string {
    const callerId = process.env.TWILIO_CALLER_ID;
    const voiceResponse = new twilio.twiml.VoiceResponse();

    if (!destinationNumber) {
      voiceResponse.say('The phone number provided is invalid. Please check the customer details.');
      return voiceResponse.toString();
    }

    const dial = voiceResponse.dial({
      callerId,
      answerOnBridge: true, // Audio connects immediately when customer answers mobile phone
      timeout: 30, // 30 seconds ring time
      action: actionCallbackUrl || '/api/telephony/status-callback'
    });

    dial.number({
      statusCallback: actionCallbackUrl || '/api/telephony/status-callback',
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST'
    }, destinationNumber);

    return voiceResponse.toString();
  }

  // Generate Initial Voice AI Greeting & Speech Recognition Gather Loop
  public async generateAiGreetingTwiML(language: string = 'en', actionUrl: string = '/api/telephony/process-speech'): Promise<string> {
    const normLang = (language || 'en').toLowerCase().slice(0, 2);
    const langConfig = TWILIO_VOICE_MAP[normLang] || TWILIO_VOICE_MAP.en;
    const voiceResponse = new twilio.twiml.VoiceResponse();

    let greeting = "Hello! Welcome to KAIRA. I am your AI voice assistant. How may I help you today?";
    if (normLang !== 'en') {
      greeting = await translationService.translateText(greeting, normLang, 'en');
    }

    // Voice AI Greeting spoken to customer on their mobile phone
    voiceResponse.say({
      voice: langConfig.voice,
      language: langConfig.bcp47 as any
    }, greeting);

    // Continuous speech gather loop
    const gather = voiceResponse.gather({
      input: ['speech'],
      action: actionUrl,
      method: 'POST',
      language: langConfig.bcp47 as any,
      speechTimeout: 'auto',
      speechModel: 'experimental_conversations'
    });

    gather.say({
      voice: langConfig.voice,
      language: langConfig.bcp47 as any
    }, 'Please ask your question.');

    // Fallback if no speech detected
    voiceResponse.redirect({ method: 'POST' }, actionUrl);

    return voiceResponse.toString();
  }

  // Generate Voice AI Response TwiML with Speech Synthesis & Next Turn Gather
  public generateAiResponseTwiML(
    speechText: string,
    language: string = 'en',
    isTransfer = false,
    actionUrl: string = '/api/telephony/process-speech'
  ): string {
    const normLang = (language || 'en').toLowerCase().slice(0, 2);
    const langConfig = TWILIO_VOICE_MAP[normLang] || TWILIO_VOICE_MAP.en;
    const voiceResponse = new twilio.twiml.VoiceResponse();

    // The AI Answer spoken through the phone earpiece
    voiceResponse.say({
      voice: langConfig.voice,
      language: langConfig.bcp47 as any
    }, speechText);

    if (isTransfer) {
      // Automatic live escalation to Admin / Agent
      const callerId = process.env.TWILIO_CALLER_ID;
      const dial = voiceResponse.dial({
        callerId,
        timeout: 30,
        action: '/api/telephony/status-callback'
      });
      dial.client('admin');
    } else {
      // Continuous dialogue: Gather next customer question
      const gather = voiceResponse.gather({
        input: ['speech'],
        action: actionUrl,
        method: 'POST',
        language: langConfig.bcp47 as any,
        speechTimeout: 'auto',
        speechModel: 'experimental_conversations'
      });

      gather.pause({ length: 1 });

      // If customer remains silent, thank them and close
      voiceResponse.say({
        voice: langConfig.voice,
        language: langConfig.bcp47 as any
      }, 'Thank you for contacting KAIRA Technologies. Have a wonderful day!');
      voiceResponse.hangup();
    }

    return voiceResponse.toString();
  }

  // Initiate an automated Outbound Voice AI Call to customer's mobile phone
  public async initiateOutboundAiCall(
    destinationNumber: string,
    customerName: string,
    language: string = 'en',
    baseUrl: string = 'http://localhost:5000'
  ): Promise<{ success: boolean; callSid?: string; error?: string }> {
    if (!this.twilioClient) {
      return { success: false, error: 'Twilio client credentials not configured in server/.env' };
    }

    const callerId = process.env.TWILIO_CALLER_ID;
    if (!callerId) {
      return { success: false, error: 'TWILIO_CALLER_ID not configured in server/.env' };
    }

    const cleanNumber = destinationNumber.replace(/[^\d+]/g, '');
    const normLang = (language || 'en').toLowerCase().slice(0, 2);

    try {
      const call = await this.twilioClient.calls.create({
        to: cleanNumber,
        from: callerId,
        url: `${baseUrl}/api/telephony/ai-dialogue?lang=${normLang}`,
        statusCallback: `${baseUrl}/api/telephony/status-callback`,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST'
      });

      console.log(`[Telephony] Outbound Voice AI call initiated to ${cleanNumber}. SID: ${call.sid}`);
      return { success: true, callSid: call.sid };
    } catch (err: any) {
      console.error('[Telephony] Error initiating outbound Voice AI call:', err);
      return { success: false, error: err.message };
    }
  }

  // Handle call status webhooks from Twilio
  public async handleCallStatusWebhook(payload: any, io?: any) {
    const {
      CallSid,
      ParentCallSid,
      CallStatus,
      CallDuration,
      Duration,
      To,
      From,
      Direction,
      ErrorCode,
      ErrorMessage
    } = payload;

    console.log(`[Telephony Webhook] CallSid: ${CallSid}, Status: ${CallStatus}, Duration: ${CallDuration || Duration || 0}s`);

    const sidToMatch = CallSid || ParentCallSid;
    if (!sidToMatch) return;

    // Find call record by providerCallSid or callId (strict matching to prevent cross-call corruption)
    let callRecord = await prisma.callRecord.findFirst({
      where: {
        OR: [
          { providerCallSid: sidToMatch },
          { callId: sidToMatch }
        ]
      }
    });

    if (!callRecord && To) {
      callRecord = await prisma.callRecord.findFirst({
        where: {
          customerPhone: To,
          status: { in: ['ringing', 'active'] },
          direction: 'outgoing',
          startTime: { gte: new Date(Date.now() - 15 * 60 * 1000) }
        },
        orderBy: { startTime: 'desc' }
      });
    }

    if (!callRecord) {
      console.log(`[Telephony Webhook] No matching CallRecord found for SID: ${sidToMatch}`);
      return;
    }

    const parsedDuration = parseInt(CallDuration || Duration || '0', 10);
    let mappedStatus = callRecord.status;

    if (CallStatus === 'ringing') {
      mappedStatus = 'ringing';
    } else if (CallStatus === 'in-progress' || CallStatus === 'answered') {
      mappedStatus = 'active';
    } else if (CallStatus === 'completed') {
      mappedStatus = 'completed';
    } else if (CallStatus === 'busy' || CallStatus === 'no-answer' || CallStatus === 'canceled' || CallStatus === 'failed') {
      mappedStatus = CallStatus === 'no-answer' ? 'missed' : 'rejected';
    }

    const updated = await prisma.callRecord.update({
      where: { id: callRecord.id },
      data: {
        status: mappedStatus,
        providerCallSid: CallSid || callRecord.providerCallSid,
        duration: parsedDuration > 0 ? parsedDuration : callRecord.duration,
        endTime: CallStatus === 'completed' || mappedStatus === 'rejected' || mappedStatus === 'missed' ? new Date() : callRecord.endTime,
        failureReason: ErrorMessage || (CallStatus === 'busy' ? 'Customer line busy' : CallStatus === 'no-answer' ? 'Customer did not answer' : null)
      }
    });

    // Notify connected agents & admins over Socket.io
    if (io) {
      io.to('role:agent').to('role:admin').emit('telephony:status_update', {
        callId: updated.callId,
        providerCallSid: CallSid,
        status: mappedStatus,
        duration: updated.duration,
        failureReason: updated.failureReason
      });
      io.to('role:agent').to('role:admin').emit('call:status_changed', {
        callId: updated.callId,
        status: mappedStatus
      });
    }

    return updated;
  }
}

export const telephonyService = new TelephonyService();
