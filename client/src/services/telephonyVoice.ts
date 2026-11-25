import { Device, Call } from '@twilio/voice-sdk';
import { callQualityMonitor } from './callQuality.js';
import { audioDeviceManager } from './audioDevice.js';
import { validateIndianMobile } from '../utils/phoneValidation.js';

export type TelephonyCallState =
  | 'idle'
  | 'requesting_permission'
  | 'initiating'
  | 'ringing'
  | 'connected'
  | 'disconnecting'
  | 'ended'
  | 'completed'
  | 'busy'
  | 'no-answer'
  | 'rejected'
  | 'failed'
  | 'cancelled';

export interface TelephonyCallCallbacks {
  onStateChange: (state: TelephonyCallState, message?: string) => void;
  onError: (error: string) => void;
  onDurationTick?: (seconds: number) => void;
}

export interface ProviderStatusResponse {
  configured: boolean;
  provider: string;
  displayName?: string;
  callerId?: string;
  supportsIndianPSTN?: boolean;
  callerNameBranding?: {
    requestedName: string;
    status: 'approved' | 'pending' | 'unsupported';
    cNapSupported: boolean;
    explanation: string;
  };
  hasCredentials?: boolean;
  message?: string;
  details?: Record<string, any>;
}

class TelephonyVoiceManager {
  private device: Device | null = null;
  private activeCall: Call | null = null;
  private activeCallId: string | null = null;
  private currentToken: string | null = null;
  private isMuted: boolean = false;
  private durationSeconds: number = 0;
  private durationTimer: any = null;
  private callbacks: TelephonyCallCallbacks | null = null;

  // Check backend telephony provider configuration status
  public async checkProviderStatus(authToken?: string): Promise<ProviderStatusResponse> {
    try {
      const res = await fetch('/api/telephony/status', {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined
      });
      return await res.json();
    } catch (err: any) {
      console.warn('[Telephony] Failed to fetch telephony status:', err);
      return {
        configured: false,
        provider: 'exotel',
        displayName: 'Indian PSTN Telephony',
        message: 'Could not contact backend telephony status API.'
      };
    }
  }

  // Fetch authorized test numbers allowlist
  public async fetchAllowlist(authToken?: string): Promise<{
    enforceAllowlist: boolean;
    allowedNumbers: Array<{ rawE164: string; masked: string }>;
  }> {
    try {
      const res = await fetch('/api/telephony/allowlist', {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      console.warn('[Telephony] Could not fetch allowlist:', err);
    }
    return { enforceAllowlist: false, allowedNumbers: [] };
  }

  // Request browser microphone permission
  public async requestMicrophonePermission(): Promise<MediaStream> {
    const micId = audioDeviceManager.getPreferredMicrophoneId();
    return await audioDeviceManager.requestMicrophoneAccess(micId);
  }

  // Initialize or fetch Twilio Voice Device (if Twilio is used)
  private async getInitializedDevice(authToken: string): Promise<Device> {
    if (this.device && this.currentToken) {
      return this.device;
    }

    const tokenRes = await fetch('/api/telephony/token', {
      headers: { Authorization: `Bearer ${authToken}` }
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.token) {
      throw new Error(tokenData.error || 'Failed to obtain voice token from backend.');
    }

    this.currentToken = tokenData.token;

    this.device = new Device(tokenData.token, {
      codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU]
    });

    await this.device.register();

    this.device.on('registered', () => {
      console.log('[TelephonyVoice] Twilio Voice Device registered.');
    });

    this.device.on('error', (err) => {
      console.error('[TelephonyVoice] Device error:', err);
      if (this.callbacks) {
        this.callbacks.onError(err.message || 'Telephony device error.');
      }
    });

    return this.device;
  }

  /**
   * Initiate a real outbound mobile phone call to customer PSTN phone
   */
  public async makeCall(
    phoneNumber: string,
    customerName: string,
    agentAuthToken: string,
    agentId: string,
    callbacks: TelephonyCallCallbacks
  ): Promise<{ success: boolean; callId?: string; error?: string }> {
    this.callbacks = callbacks;
    this.isMuted = false;
    this.durationSeconds = 0;
    this.stopDurationTimer();

    // 1. Validate destination number using Indian mobile format
    const validation = validateIndianMobile(phoneNumber);
    if (!validation.isValid || !validation.normalizedNumber) {
      const err = validation.error || `Invalid Indian mobile number: "${phoneNumber}".`;
      callbacks.onStateChange('failed', err);
      callbacks.onError(err);
      return { success: false, error: err };
    }

    const normalizedPhone = validation.normalizedNumber;
    const maskedPhone = validation.maskedNumber || normalizedPhone;

    // 2. Request microphone permission
    callbacks.onStateChange('requesting_permission', 'Checking agent microphone access...');
    try {
      const micStream = await this.requestMicrophonePermission();
      micStream.getTracks().forEach(t => t.stop());
    } catch (err: any) {
      callbacks.onStateChange('failed', `Microphone permission required: ${err.message}`);
      callbacks.onError(`Microphone access error: ${err.message}`);
      return { success: false, error: err.message };
    }

    callbacks.onStateChange('initiating', `Initiating outbound call to ${customerName} (${maskedPhone})...`);

    // 3. Check active provider
    const providerStatus = await this.checkProviderStatus(agentAuthToken);
    const providerName = providerStatus.provider || 'exotel';

    try {
      // 4. Call backend outbound PSTN endpoint
      const res = await fetch('/api/telephony/outbound-call', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${agentAuthToken}`
        },
        body: JSON.stringify({
          customerPhone: normalizedPhone,
          customerName: customerName || 'Customer'
        })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        const errorMsg = data.error || 'Failed to initiate outbound call.';
        callbacks.onStateChange('failed', errorMsg);
        callbacks.onError(errorMsg);
        return { success: false, error: errorMsg };
      }

      this.activeCallId = data.callId;

      // 5. If provider is Twilio and client SDK is configured, connect browser audio
      if (providerName === 'twilio' && providerStatus.hasCredentials) {
        try {
          const device = await this.getInitializedDevice(agentAuthToken);
          const call = await device.connect({
            params: {
              To: normalizedPhone,
              customerName,
              agentId
            }
          });

          this.activeCall = call;

          call.on('ringing', () => {
            callbacks.onStateChange('ringing', `Ringing customer's mobile phone (${maskedPhone})...`);
          });

          call.on('accept', () => {
            callbacks.onStateChange('connected', `Connected with ${customerName}. Live audio active.`);
            this.startDurationTimer();
            const callSid = (call.parameters as any)?.CallSid || data.providerCallId || data.callId;
            callQualityMonitor.start(null, callSid, agentAuthToken);
          });

          call.on('disconnect', () => {
            this.stopDurationTimer();
            callQualityMonitor.stop();
            this.activeCall = null;
            this.activeCallId = null;
            callbacks.onStateChange('ended', 'Call ended.');
          });

          call.on('reject', () => {
            this.stopDurationTimer();
            this.activeCall = null;
            this.activeCallId = null;
            callbacks.onStateChange('rejected', 'Customer line busy or call rejected.');
          });

          call.on('error', (err) => {
            this.stopDurationTimer();
            this.activeCall = null;
            this.activeCallId = null;
            callbacks.onStateChange('failed', err.message || 'Call failed.');
            callbacks.onError(err.message || 'Call failed.');
          });
        } catch (twilioErr: any) {
          console.warn('[TelephonyVoice] Browser WebRTC bridge failed, relying on backend PSTN bridge:', twilioErr.message);
          callbacks.onStateChange('ringing', `Ringing customer's mobile phone (${maskedPhone})...`);
        }
      } else {
        // Exotel / Simulator PSTN Call
        callbacks.onStateChange('ringing', `Ringing customer's mobile phone (${maskedPhone})...`);
      }

      return {
        success: true,
        callId: data.callId
      };
    } catch (err: any) {
      console.error('[TelephonyVoice] Error connecting call:', err);
      callbacks.onStateChange('failed', err.message || 'Network error initiating call.');
      callbacks.onError(err.message || 'Connection error.');
      return { success: false, error: err.message };
    }
  }

  // Handle incoming socket status updates for active call
  public handleSocketStatusUpdate(update: {
    callId: string;
    status: TelephonyCallState;
    duration?: number;
    failureReason?: string;
  }): void {
    if (!this.callbacks) return;

    const { status, duration, failureReason } = update;

    if (status === 'ringing') {
      this.callbacks.onStateChange('ringing', 'Customer mobile phone is ringing...');
    } else if (status === 'connected' || (status as string) === 'active') {
      this.callbacks.onStateChange('connected', 'Customer answered. Two-way audio active.');
      if (!this.durationTimer) {
        this.startDurationTimer();
      }
    } else if (status === 'completed' || status === 'ended') {
      this.stopDurationTimer();
      this.activeCallId = null;
      this.callbacks.onStateChange('ended', 'Call completed.');
    } else if (status === 'busy') {
      this.stopDurationTimer();
      this.activeCallId = null;
      this.callbacks.onStateChange('busy', failureReason || 'Customer line is busy.');
    } else if (status === 'no-answer') {
      this.stopDurationTimer();
      this.activeCallId = null;
      this.callbacks.onStateChange('no-answer', failureReason || 'Customer did not answer.');
    } else if (status === 'rejected') {
      this.stopDurationTimer();
      this.activeCallId = null;
      this.callbacks.onStateChange('rejected', failureReason || 'Customer rejected the call.');
    } else if (status === 'failed') {
      this.stopDurationTimer();
      this.activeCallId = null;
      this.callbacks.onStateChange('failed', failureReason || 'Carrier routing failed.');
    }

    if (typeof duration === 'number' && this.callbacks.onDurationTick) {
      this.callbacks.onDurationTick(duration);
    }
  }

  // Toggle Mute / Unmute
  public toggleMute(): boolean {
    if (this.activeCall) {
      this.isMuted = !this.isMuted;
      this.activeCall.mute(this.isMuted);
    } else {
      this.isMuted = !this.isMuted;
    }
    return this.isMuted;
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  // Adjust output volume
  public setVolume(volume: number): void {
    try {
      if (this.activeCall && (this.activeCall as any).outputVolume !== undefined) {
        (this.activeCall as any).outputVolume = volume;
      }
    } catch {
      // ignore
    }
  }

  // Send DTMF digits
  public sendDigits(digits: string): void {
    try {
      if (this.activeCall && typeof (this.activeCall as any).sendDigits === 'function') {
        (this.activeCall as any).sendDigits(digits);
      }
    } catch {
      // ignore
    }
  }

  // Hang up the active call
  public async endCall(callId?: string, authToken?: string): Promise<void> {
    const targetCallId = callId || this.activeCallId;

    if (this.activeCall) {
      try {
        this.activeCall.disconnect();
      } catch (err) {
        console.warn('[TelephonyVoice] Error disconnecting active call:', err);
      }
      this.activeCall = null;
    }

    // Call backend termination endpoint
    if (targetCallId && authToken) {
      try {
        await fetch('/api/telephony/terminate-call', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`
          },
          body: JSON.stringify({ callId: targetCallId })
        });
      } catch (err) {
        console.warn('[TelephonyVoice] Error calling terminate-call API:', err);
      }
    }

    this.activeCallId = null;
    this.stopDurationTimer();
    if (this.callbacks) {
      this.callbacks.onStateChange('ended', 'Call ended.');
    }
  }

  private startDurationTimer() {
    this.stopDurationTimer();
    this.durationSeconds = 0;
    this.durationTimer = setInterval(() => {
      this.durationSeconds += 1;
      if (this.callbacks && this.callbacks.onDurationTick) {
        this.callbacks.onDurationTick(this.durationSeconds);
      }
    }, 1000);
  }

  private stopDurationTimer() {
    if (this.durationTimer) {
      clearInterval(this.durationTimer);
      this.durationTimer = null;
    }
  }

  public getDurationSeconds(): number {
    return this.durationSeconds;
  }
}

export const telephonyVoiceManager = new TelephonyVoiceManager();
