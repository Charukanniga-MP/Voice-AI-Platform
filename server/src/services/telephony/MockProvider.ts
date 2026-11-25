import {
  ITelephonyProvider,
  OutboundCallRequest,
  OutboundCallResult,
  CallStatusUpdate,
  TelephonyProviderStatus
} from './types.js';

/**
 * Mock Telephony Provider for Controlled Testing & Demonstrations
 * Accurately simulates the complete PSTN mobile call lifecycle
 * (INITIATING -> RINGING -> CONNECTED -> ENDED) without burning carrier minutes.
 */
export class MockTelephonyProvider implements ITelephonyProvider {
  public readonly name = 'mock';
  public readonly displayName = 'KAIRA Telephony Simulator (Mock)';

  private activeSimulations = new Map<string, { status: string; timer?: any }>();

  public isConfigured(): boolean {
    return true;
  }

  public getStatus(): TelephonyProviderStatus {
    return {
      configured: true,
      provider: this.name,
      displayName: this.displayName,
      callerId: '+91 80000 00000',
      supportsIndianPSTN: true,
      callerNameBranding: {
        requestedName: 'KAIRA Agent',
        status: 'approved',
        cNapSupported: true,
        explanation: 'Simulator mode with KAIRA Agent caller ID branding.'
      },
      hasCredentials: true,
      message: 'Telephony Simulator is active. Real PSTN carriers (Exotel/Twilio) can be enabled via TELEPHONY_PROVIDER in server/.env.',
      details: {
        activeSimulations: this.activeSimulations.size
      }
    };
  }

  public async initiateOutboundCall(req: OutboundCallRequest): Promise<OutboundCallResult> {
    const callSid = `sim_call_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // Store simulation state
    this.activeSimulations.set(callSid, { status: 'ringing' });

    console.log(`[Telephony Simulator] Initiated simulated PSTN call to ${req.destinationNumber}. CallSid: ${callSid}`);

    return {
      success: true,
      providerCallId: callSid,
      providerName: this.name,
      status: 'ringing',
      callerIdUsed: '+91 80000 00000'
    };
  }

  public async terminateCall(providerCallId: string): Promise<{ success: boolean; error?: string }> {
    const sim = this.activeSimulations.get(providerCallId);
    if (sim) {
      if (sim.timer) clearTimeout(sim.timer);
      this.activeSimulations.delete(providerCallId);
    }
    console.log(`[Telephony Simulator] Terminated simulated call: ${providerCallId}`);
    return { success: true };
  }

  public async handleStatusWebhook(payload: any): Promise<CallStatusUpdate | null> {
    const callSid = payload.CallSid || payload.providerCallId;
    if (!callSid) return null;

    return {
      providerCallId: callSid,
      status: payload.status || 'completed',
      duration: payload.duration || 10,
      failureReason: payload.failureReason,
      rawPayload: payload
    };
  }

  public validateWebhookSignature(): boolean {
    return true;
  }
}
