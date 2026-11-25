import twilio from 'twilio';
import {
  ITelephonyProvider,
  OutboundCallRequest,
  OutboundCallResult,
  CallStatusUpdate,
  TelephonyProviderStatus,
  CallLifecycleStatus
} from './types.js';

/**
 * Twilio Telephony Provider
 * Wraps Twilio Voice SDK & REST API for PSTN outdialing
 */
export class TwilioTelephonyProvider implements ITelephonyProvider {
  public readonly name = 'twilio';
  public readonly displayName = 'Twilio Programmable Voice';

  private twilioClient: twilio.Twilio | null = null;

  constructor() {
    this.initClient();
  }

  private initClient() {
    const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
    const token = process.env.TWILIO_AUTH_TOKEN?.trim();
    if (sid && token && sid.startsWith('AC')) {
      try {
        this.twilioClient = twilio(sid, token);
      } catch (err) {
        console.warn('[TwilioProvider] Failed to initialize twilio client:', err);
      }
    }
  }

  public isConfigured(): boolean {
    const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
    const token = process.env.TWILIO_AUTH_TOKEN?.trim();
    const callerId = process.env.TWILIO_CALLER_ID?.trim();
    return !!(sid && token && callerId && sid.startsWith('AC'));
  }

  public getStatus(): TelephonyProviderStatus {
    const configured = this.isConfigured();
    const callerId = process.env.TWILIO_CALLER_ID?.trim();

    let message = 'Twilio Voice is active and configured.';
    if (!configured) {
      message = 'Twilio credentials or TWILIO_CALLER_ID missing in server/.env.';
    }

    return {
      configured,
      provider: this.name,
      displayName: this.displayName,
      callerId: callerId || undefined,
      supportsIndianPSTN: true,
      callerNameBranding: {
        requestedName: 'KAIRA Agent',
        status: configured ? 'approved' : 'pending',
        cNapSupported: false,
        explanation: 'Twilio supports verified caller ID numbers. For Indian domestic calling, international dialing permissions or verified local CLI is required.'
      },
      hasCredentials: configured,
      message,
      details: {
        hasAppSid: !!process.env.TWILIO_TWIML_APP_SID,
        hasApiKey: !!process.env.TWILIO_API_KEY
      }
    };
  }

  public async initiateOutboundCall(req: OutboundCallRequest): Promise<OutboundCallResult> {
    if (!this.twilioClient || !this.isConfigured()) {
      return {
        success: false,
        providerCallId: '',
        providerName: this.name,
        status: 'failed',
        error: 'Twilio client credentials not configured in server/.env'
      };
    }

    const callerId = process.env.TWILIO_CALLER_ID;
    if (!callerId) {
      return {
        success: false,
        providerCallId: '',
        providerName: this.name,
        status: 'failed',
        error: 'TWILIO_CALLER_ID not configured in server/.env'
      };
    }

    const callbackUrl = `${req.callbackBaseUrl.replace(/\/$/, '')}/api/telephony/status-callback`;
    const voiceUrl = `${req.callbackBaseUrl.replace(/\/$/, '')}/api/telephony/voice`;

    try {
      const call = await this.twilioClient.calls.create({
        to: req.destinationNumber,
        from: callerId,
        url: voiceUrl,
        statusCallback: callbackUrl,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST'
      });

      return {
        success: true,
        providerCallId: call.sid,
        providerName: this.name,
        status: 'ringing',
        callerIdUsed: callerId
      };
    } catch (err: any) {
      return {
        success: false,
        providerCallId: '',
        providerName: this.name,
        status: 'failed',
        error: err.message
      };
    }
  }

  public async terminateCall(providerCallId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.twilioClient || !providerCallId) {
      return { success: false, error: 'Cannot terminate call: Twilio client or Call SID unavailable.' };
    }

    try {
      await this.twilioClient.calls(providerCallId).update({ status: 'completed' });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  public async handleStatusWebhook(payload: any): Promise<CallStatusUpdate | null> {
    const callSid = payload.CallSid || payload.ParentCallSid;
    if (!callSid) return null;

    const rawStatus = (payload.CallStatus || '').toLowerCase();
    let status: CallLifecycleStatus = 'initiated';
    let failureReason: string | undefined;

    switch (rawStatus) {
      case 'ringing':
        status = 'ringing';
        break;
      case 'in-progress':
      case 'answered':
        status = 'active';
        break;
      case 'completed':
        status = 'completed';
        break;
      case 'busy':
        status = 'busy';
        failureReason = 'Customer line busy';
        break;
      case 'no-answer':
        status = 'no-answer';
        failureReason = 'Customer did not answer';
        break;
      case 'failed':
        status = 'failed';
        failureReason = payload.ErrorMessage || 'Call routing failed';
        break;
      case 'canceled':
        status = 'cancelled';
        failureReason = 'Call was cancelled';
        break;
      default:
        status = 'active';
    }

    const duration = parseInt(payload.CallDuration || payload.Duration || '0', 10);
    const recordingUrl = payload.RecordingUrl || undefined;

    return {
      providerCallId: callSid,
      status,
      duration: isNaN(duration) ? 0 : duration,
      failureReason,
      recordingUrl,
      rawPayload: payload
    };
  }

  public validateWebhookSignature(req: any): boolean {
    const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
    if (!authToken) return false;
    const signature = req.headers['x-twilio-signature'] as string;
    if (!signature) return false;

    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:5000';
    const fullUrl = `${protocol}://${host}${req.originalUrl}`;
    const params = req.body || {};

    return twilio.validateRequest(authToken, signature, fullUrl, params);
  }
}
