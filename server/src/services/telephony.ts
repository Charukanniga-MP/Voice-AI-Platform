import twilio from 'twilio';
import { prisma } from '../db.js';
import { translationService } from './translation.js';
import { callIntelligenceService } from './callIntelligence.js';
import {
  ITelephonyProvider,
  OutboundCallRequest,
  OutboundCallResult,
  CallStatusUpdate,
  TelephonyProviderStatus
} from './telephony/types.js';
import { ExotelTelephonyProvider } from './telephony/ExotelProvider.js';
import { TwilioTelephonyProvider } from './telephony/TwilioProvider.js';
import { MockTelephonyProvider } from './telephony/MockProvider.js';
import {
  validateAndNormalizeIndianPhone,
  isNumberInTestAllowlist,
  maskPhoneNumber,
  AUTHORIZED_TEST_NUMBERS
} from '../utils/phoneValidation.js';

export const TWILIO_VOICE_MAP: Record<string, { voice: any; bcp47: string }> = {
  en: { voice: 'Polly.Aditi', bcp47: 'en-IN' },
  ta: { voice: 'Google.ta-IN-Standard-A', bcp47: 'ta-IN' },
  te: { voice: 'Google.te-IN-Standard-A', bcp47: 'te-IN' },
  ml: { voice: 'Google.ml-IN-Standard-A', bcp47: 'ml-IN' },
  hi: { voice: 'Polly.Aditi', bcp47: 'hi-IN' }
};

class TelephonyService {
  private activeProvider: ITelephonyProvider;
  private exotelProvider: ExotelTelephonyProvider;
  private twilioProvider: TwilioTelephonyProvider;
  private mockProvider: MockTelephonyProvider;

  // Cooldown tracker: agentId -> timestamp of last call initiation (minimum 10s cooldown)
  private agentCooldowns = new Map<string, number>();
  private readonly COOLDOWN_MS = 10_000;

  constructor() {
    this.exotelProvider = new ExotelTelephonyProvider();
    this.twilioProvider = new TwilioTelephonyProvider();
    this.mockProvider = new MockTelephonyProvider();

    // Select provider based on TELEPHONY_PROVIDER env var
    this.activeProvider = this.selectProvider();
  }

  private selectProvider(): ITelephonyProvider {
    const requested = (process.env.TELEPHONY_PROVIDER || '').trim().toLowerCase();

    if (requested === 'exotel') {
      return this.exotelProvider;
    }
    if (requested === 'twilio') {
      return this.twilioProvider;
    }
    if (requested === 'mock') {
      return this.mockProvider;
    }

    // Auto-detect based on configured credentials
    if (this.exotelProvider.isConfigured()) {
      return this.exotelProvider;
    }
    if (this.twilioProvider.isConfigured()) {
      return this.twilioProvider;
    }

    // Default to Exotel in India environments, falling back to mock simulator
    return this.exotelProvider.isConfigured() ? this.exotelProvider : this.mockProvider;
  }

  public getProvider(): ITelephonyProvider {
    return this.activeProvider;
  }

  public setProvider(providerName: 'exotel' | 'twilio' | 'mock'): void {
    if (providerName === 'exotel') this.activeProvider = this.exotelProvider;
    else if (providerName === 'twilio') this.activeProvider = this.twilioProvider;
    else this.activeProvider = this.mockProvider;
  }

  public isConfigured(): boolean {
    return this.activeProvider.isConfigured();
  }

  public getStatus(): TelephonyProviderStatus {
    return this.activeProvider.getStatus();
  }

  /**
   * Validates and initiates a real outbound mobile call from Agent Dashboard to customer PSTN phone
   */
  public async initiateOutboundPstnCall(params: {
    destinationNumber: string;
    customerName?: string;
    agentId: string;
    agentName?: string;
    agentPhoneOrClient?: string;
    callbackBaseUrl: string;
    io?: any;
  }): Promise<{
    success: boolean;
    callId?: string;
    providerCallId?: string;
    providerName?: string;
    maskedNumber?: string;
    status?: string;
    error?: string;
  }> {
    const { destinationNumber, customerName, agentId, agentName, callbackBaseUrl, io } = params;

    // 1. Validate and normalize Indian mobile phone number
    const validation = validateAndNormalizeIndianPhone(destinationNumber);
    if (!validation.isValid || !validation.normalizedNumber) {
      return {
        success: false,
        error: validation.error || 'Invalid Indian mobile phone number.'
      };
    }

    const normalizedNumber = validation.normalizedNumber;
    const maskedNumber = validation.maskedNumber || maskPhoneNumber(normalizedNumber);

    // 2. Controlled Test-Call Safety: If allowlist enforcement is active, verify number
    const enforceAllowlist = process.env.TELEPHONY_ENFORCE_ALLOWLIST === 'true';
    if (enforceAllowlist && !isNumberInTestAllowlist(normalizedNumber)) {
      return {
        success: false,
        error: `Safety Guard: Phone ${maskedNumber} is not in the authorized demonstration allowlist. Authorized numbers: ${AUTHORIZED_TEST_NUMBERS.map(n => maskPhoneNumber(n)).join(', ')}`
      };
    }

    // 3. Agent Cooldown & Debounce Enforcement (prevents accidental double dialing)
    const now = Date.now();
    const lastCallTime = this.agentCooldowns.get(agentId) || 0;
    if (now - lastCallTime < this.COOLDOWN_MS) {
      const waitSec = Math.ceil((this.COOLDOWN_MS - (now - lastCallTime)) / 1000);
      return {
        success: false,
        error: `Call cooldown active. Please wait ${waitSec} second(s) before placing another outbound call.`
      };
    }

    // 4. Check for active duplicate call to the same destination in the last 15 seconds
    const activeDuplicate = await prisma.callRecord.findFirst({
      where: {
        agentId,
        customerPhone: normalizedNumber,
        direction: 'outgoing',
        status: { in: ['initiated', 'ringing', 'active'] },
        startTime: { gte: new Date(now - 15000) }
      }
    });

    if (activeDuplicate) {
      return {
        success: false,
        error: `An active call to ${maskedNumber} is already in progress. Please wait for it to conclude.`
      };
    }

    this.agentCooldowns.set(agentId, now);

    // 5. Create initial CallRecord in database
    const callId = `pstn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const effectiveCustomerName = customerName || 'Customer';

    // Verify foreign key integrity for agentId
    let validAgentId: string | null = null;
    if (agentId) {
      const userRecord = await prisma.user.findUnique({ where: { id: agentId } });
      if (userRecord) {
        validAgentId = userRecord.id;
      }
    }

    const callRecord = await prisma.callRecord.create({
      data: {
        callId,
        providerCallSid: callId, // Updated with actual providerCallId upon call placement
        providerName: this.activeProvider.name,
        customerName: effectiveCustomerName,
        customerPhone: normalizedNumber,
        agentId: validAgentId,
        agentName: agentName || 'Agent',
        type: 'agent_voice',
        direction: 'outgoing',
        status: 'initiated',
        startTime: new Date()
      }
    });

    console.log(`[Telephony] Placing outbound PSTN call: Agent ${agentId} -> ${maskedNumber} via provider: ${this.activeProvider.name}`);

    // Initial transcript entry
    await prisma.callTranscript.create({
      data: {
        callRecordId: callRecord.id,
        sender: 'system',
        senderName: 'System',
        text: `Support Agent ${agentName || 'Agent'} initiated outbound PSTN call to ${maskedNumber} via ${this.activeProvider.displayName}.`
      }
    });

    // 6. Invoke Active Telephony Provider
    const callRequest: OutboundCallRequest = {
      destinationNumber: normalizedNumber,
      customerName: effectiveCustomerName,
      agentId,
      agentName,
      agentPhoneOrClient: params.agentPhoneOrClient,
      callbackBaseUrl,
      customData: {
        callId: callRecord.callId,
        callRecordId: callRecord.id,
        agentId
      }
    };

    const callResult = await this.activeProvider.initiateOutboundCall(callRequest);

    if (!callResult.success) {
      console.error(`[Telephony] Provider call initiation failed for ${maskedNumber}:`, callResult.error);
      await prisma.callRecord.update({
        where: { id: callRecord.id },
        data: {
          status: 'failed',
          endTime: new Date(),
          failureReason: callResult.error || 'Provider initiation failed'
        }
      });

      if (io) {
        io.to(`agent:${agentId}`).to('role:admin').emit('telephony:status_update', {
          callId: callRecord.callId,
          status: 'failed',
          failureReason: callResult.error
        });
      }

      return {
        success: false,
        callId: callRecord.callId,
        error: callResult.error
      };
    }

    // 7. Update CallRecord with confirmed provider CallSid & Ringing status
    const updatedRecord = await prisma.callRecord.update({
      where: { id: callRecord.id },
      data: {
        providerCallSid: callResult.providerCallId,
        status: callResult.status
      }
    });

    if (io) {
      io.to(`agent:${agentId}`).to('role:admin').emit('telephony:status_update', {
        callId: updatedRecord.callId,
        providerCallSid: callResult.providerCallId,
        status: callResult.status,
        providerName: this.activeProvider.name,
        maskedNumber
      });
      io.to('role:agent').to('role:admin').emit('call:status_changed', {
        callId: updatedRecord.callId,
        status: callResult.status
      });
    }

    return {
      success: true,
      callId: updatedRecord.callId,
      providerCallId: callResult.providerCallId,
      providerName: this.activeProvider.name,
      maskedNumber,
      status: callResult.status
    };
  }

  /**
   * Terminate an active call immediately
   */
  public async terminateCall(callIdOrSid: string, io?: any): Promise<{ success: boolean; error?: string }> {
    const callRecord = await prisma.callRecord.findFirst({
      where: {
        OR: [
          { callId: callIdOrSid },
          { providerCallSid: callIdOrSid }
        ]
      }
    });

    if (!callRecord) {
      return { success: false, error: 'Call record not found.' };
    }

    const providerSid = callRecord.providerCallSid || callRecord.callId;

    // Terminate via active provider
    try {
      await this.activeProvider.terminateCall(providerSid);
    } catch (err: any) {
      console.warn(`[Telephony] Non-fatal error signaling provider hangup:`, err.message);
    }

    const endTime = new Date();
    const duration = Math.max(0, Math.floor((endTime.getTime() - callRecord.startTime.getTime()) / 1000));

    await prisma.callRecord.update({
      where: { id: callRecord.id },
      data: {
        status: 'completed',
        endTime,
        duration: duration > 0 ? duration : callRecord.duration,
        endedBy: 'agent'
      }
    });

    await prisma.callTranscript.create({
      data: {
        callRecordId: callRecord.id,
        sender: 'system',
        senderName: 'System',
        text: `Call ended by agent. Total duration: ${duration} seconds.`
      }
    });

    if (io) {
      io.to('role:agent').to('role:admin').emit('telephony:status_update', {
        callId: callRecord.callId,
        providerCallSid: providerSid,
        status: 'completed',
        duration
      });
      io.to('role:agent').to('role:admin').emit('call:status_changed', {
        callId: callRecord.callId,
        status: 'completed'
      });
    }

    return { success: true };
  }

  /**
   * Handle Webhook Call Status updates from telephony carriers
   */
  public async handleCallStatusWebhook(payload: any, io?: any, providerOverride?: string): Promise<any> {
    const provider = providerOverride === 'exotel'
      ? this.exotelProvider
      : providerOverride === 'twilio'
        ? this.twilioProvider
        : this.activeProvider;

    const update = await provider.handleStatusWebhook(payload);
    if (!update) return null;

    const sidToMatch = update.providerCallId;

    const callRecord = await prisma.callRecord.findFirst({
      where: {
        OR: [
          { providerCallSid: sidToMatch },
          { callId: sidToMatch }
        ]
      }
    });

    if (!callRecord) {
      console.log(`[Telephony Webhook] No matching CallRecord found for provider SID: ${sidToMatch}`);
      return null;
    }

    let mappedStatus = callRecord.status;
    if (update.status === 'ringing') mappedStatus = 'ringing';
    else if (update.status === 'active') mappedStatus = 'active';
    else if (update.status === 'completed') mappedStatus = 'completed';
    else if (['busy', 'no-answer', 'rejected', 'failed', 'cancelled'].includes(update.status)) {
      mappedStatus = update.status === 'no-answer' ? 'missed' : 'rejected';
    }

    const isTerminal = ['completed', 'rejected', 'missed'].includes(mappedStatus);
    const duration = update.duration || callRecord.duration;

    const updated = await prisma.callRecord.update({
      where: { id: callRecord.id },
      data: {
        status: mappedStatus,
        duration: duration > 0 ? duration : callRecord.duration,
        endTime: isTerminal ? new Date() : callRecord.endTime,
        failureReason: update.failureReason || callRecord.failureReason,
        recordingUrl: update.recordingUrl || callRecord.recordingUrl
      }
    });

    if (io) {
      io.to('role:agent').to('role:admin').emit('telephony:status_update', {
        callId: updated.callId,
        providerCallSid: sidToMatch,
        status: mappedStatus,
        duration: updated.duration,
        failureReason: updated.failureReason
      });
      io.to('role:agent').to('role:admin').emit('call:status_changed', {
        callId: updated.callId,
        status: mappedStatus
      });
    }

    if (mappedStatus === 'completed') {
      setTimeout(() => {
        callIntelligenceService.processCall(updated.id).catch(err => {
          console.error('[Telephony Webhook] Call intelligence post-processing error:', err);
        });
      }, 300);
    }

    return updated;
  }

  // --- Twilio Voice SDK Compatibility Helpers (Preserved for existing WebRTC workflows) ---
  public generateVoiceToken(identity: string): string {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const twimlAppSid = process.env.TWILIO_TWIML_APP_SID;

    if (!accountSid || !authToken || !twimlAppSid) {
      throw new Error('Twilio credentials or TWILIO_TWIML_APP_SID not configured in server/.env');
    }

    const apiKey = process.env.TWILIO_API_KEY || accountSid;
    const apiSecret = process.env.TWILIO_API_SECRET || authToken;

    const token = new twilio.jwt.AccessToken(accountSid, apiKey, apiSecret, {
      identity,
      ttl: 3600
    });

    const VoiceGrant = twilio.jwt.AccessToken.VoiceGrant;
    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: twimlAppSid,
      incomingAllow: true
    });
    token.addGrant(voiceGrant);
    return token.toJwt();
  }

  public generateTwiML(destinationNumber: string, actionCallbackUrl?: string): string {
    const callerId = process.env.TWILIO_CALLER_ID;
    const voiceResponse = new twilio.twiml.VoiceResponse();

    if (!destinationNumber) {
      voiceResponse.say('The phone number provided is invalid.');
      return voiceResponse.toString();
    }

    const dial = voiceResponse.dial({
      callerId,
      answerOnBridge: true,
      timeout: 30,
      action: actionCallbackUrl || '/api/telephony/status-callback'
    });

    dial.number({
      statusCallback: actionCallbackUrl || '/api/telephony/status-callback',
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST'
    }, destinationNumber);

    return voiceResponse.toString();
  }

  public async generateAiGreetingTwiML(language: string = 'en', actionUrl: string = '/api/telephony/process-speech'): Promise<string> {
    const normLang = (language || 'en').toLowerCase().slice(0, 2);
    const langConfig = TWILIO_VOICE_MAP[normLang] || TWILIO_VOICE_MAP.en;
    const voiceResponse = new twilio.twiml.VoiceResponse();

    let greeting = "Hello! Welcome to KAIRA. I am your AI voice assistant. How may I help you today?";
    if (normLang !== 'en') {
      greeting = await translationService.translateText(greeting, normLang, 'en');
    }

    voiceResponse.say({
      voice: langConfig.voice,
      language: langConfig.bcp47 as any
    }, greeting);

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

    voiceResponse.redirect({ method: 'POST' }, actionUrl);
    return voiceResponse.toString();
  }

  public generateAiResponseTwiML(
    speechText: string,
    language: string = 'en',
    isTransfer = false,
    actionUrl: string = '/api/telephony/process-speech'
  ): string {
    const normLang = (language || 'en').toLowerCase().slice(0, 2);
    const langConfig = TWILIO_VOICE_MAP[normLang] || TWILIO_VOICE_MAP.en;
    const voiceResponse = new twilio.twiml.VoiceResponse();

    voiceResponse.say({
      voice: langConfig.voice,
      language: langConfig.bcp47 as any
    }, speechText);

    if (isTransfer) {
      const callerId = process.env.TWILIO_CALLER_ID;
      const dial = voiceResponse.dial({
        callerId,
        timeout: 30,
        action: '/api/telephony/status-callback'
      });
      dial.client('admin');
    } else {
      const gather = voiceResponse.gather({
        input: ['speech'],
        action: actionUrl,
        method: 'POST',
        language: langConfig.bcp47 as any,
        speechTimeout: 'auto',
        speechModel: 'experimental_conversations'
      });
      gather.pause({ length: 1 });
      voiceResponse.say({
        voice: langConfig.voice,
        language: langConfig.bcp47 as any
      }, 'Thank you for contacting KAIRA Technologies. Have a wonderful day!');
      voiceResponse.hangup();
    }

    return voiceResponse.toString();
  }

  public async initiateOutboundAiCall(
    destinationNumber: string,
    customerName: string,
    language: string = 'en',
    baseUrl: string = 'http://localhost:5000'
  ): Promise<{ success: boolean; callSid?: string; error?: string }> {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const callerId = process.env.TWILIO_CALLER_ID;

    if (!accountSid || !authToken || !callerId) {
      return { success: false, error: 'Twilio credentials not configured in server/.env' };
    }

    const client = twilio(accountSid, authToken);
    const cleanNumber = destinationNumber.replace(/[^\d+]/g, '');
    const normLang = (language || 'en').toLowerCase().slice(0, 2);

    try {
      const call = await client.calls.create({
        to: cleanNumber,
        from: callerId,
        url: `${baseUrl}/api/telephony/ai-dialogue?lang=${normLang}`,
        statusCallback: `${baseUrl}/api/telephony/status-callback`,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST'
      });

      return { success: true, callSid: call.sid };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}

export const telephonyService = new TelephonyService();
