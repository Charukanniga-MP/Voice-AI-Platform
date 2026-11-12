import { Device, Call } from '@twilio/voice-sdk';
import { callQualityMonitor } from './callQuality.js';
import { audioDeviceManager } from './audioDevice.js';

export type TelephonyCallState =
  | 'idle'
  | 'requesting_permission'
  | 'initiating'
  | 'ringing'
  | 'connected'
  | 'disconnecting'
  | 'ended'
  | 'failed';

export interface TelephonyCallCallbacks {
  onStateChange: (state: TelephonyCallState, message?: string) => void;
  onError: (error: string) => void;
  onDurationTick?: (seconds: number) => void;
}

class TelephonyVoiceManager {
  private device: Device | null = null;
  private activeCall: Call | null = null;
  private currentToken: string | null = null;
  private isMuted: boolean = false;
  private durationSeconds: number = 0;
  private durationTimer: any = null;
  private callbacks: TelephonyCallCallbacks | null = null;

  // Check backend telephony provider configuration status
  public async checkProviderStatus(authToken?: string): Promise<{
    configured: boolean;
    provider: string;
    callerId?: string;
    message?: string;
  }> {
    try {
      const res = await fetch('/api/telephony/status', {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined
      });
      return await res.json();
    } catch (err: any) {
      return {
        configured: false,
        provider: 'twilio',
        message: 'Could not contact backend telephony status API.'
      };
    }
  }

  // Request browser microphone permission
  public async requestMicrophonePermission(): Promise<MediaStream> {
    const micId = audioDeviceManager.getPreferredMicrophoneId();
    return await audioDeviceManager.requestMicrophoneAccess(micId);
  }

  // Initialize or fetch Twilio Voice Device
  private async getInitializedDevice(authToken: string): Promise<Device> {
    if (this.device && this.currentToken) {
      return this.device;
    }

    // Fetch voice access token from backend
    const tokenRes = await fetch('/api/telephony/token', {
      headers: { Authorization: `Bearer ${authToken}` }
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.token) {
      throw new Error(tokenData.error || 'Failed to obtain voice token from backend.');
    }

    this.currentToken = tokenData.token;

    // Create Twilio Voice Device
    this.device = new Device(tokenData.token, {
      codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU]
    });

    // Register Device with Twilio
    await this.device.register();

    this.device.on('registered', () => {
      console.log('[TelephonyVoice] Twilio Voice Device registered and ready for outbound calling.');
    });

    this.device.on('error', (err) => {
      console.error('[TelephonyVoice] Device error:', err);
      if (this.callbacks) {
        this.callbacks.onError(err.message || 'Telephony device error.');
      }
    });

    return this.device;
  }

  // Initiate real outbound call to customer's mobile phone
  public async makeCall(
    phoneNumber: string,
    customerName: string,
    agentAuthToken: string,
    agentId: string,
    callbacks: TelephonyCallCallbacks
  ): Promise<void> {
    this.callbacks = callbacks;
    this.isMuted = false;
    this.durationSeconds = 0;
    this.stopDurationTimer();

    // 1. Request microphone permission
    callbacks.onStateChange('requesting_permission', 'Requesting microphone access...');
    try {
      const micStream = await this.requestMicrophonePermission();
      // Keep mic stream warm
      micStream.getTracks().forEach(t => t.stop());
    } catch (err: any) {
      callbacks.onStateChange('failed', err.message);
      callbacks.onError(err.message);
      return;
    }

    // 2. Format and validate destination phone number (must be E.164 format or standard digit string)
    const cleanNumber = phoneNumber.replace(/[^\d+]/g, '');
    if (!cleanNumber || cleanNumber.length < 8) {
      const err = `Invalid phone number format: "${phoneNumber}". Please use E.164 format (e.g. +1234567890 or +919876543210).`;
      callbacks.onStateChange('failed', err);
      callbacks.onError(err);
      return;
    }

    callbacks.onStateChange('initiating', `Initiating outbound call to ${customerName} (${cleanNumber})...`);

    try {
      // 3. Obtain initialized Device
      const device = await this.getInitializedDevice(agentAuthToken);

      // 4. Place outbound call through Twilio
      const call = await device.connect({
        params: {
          To: cleanNumber,
          customerName: customerName,
          agentId: agentId
        }
      });

      this.activeCall = call;

      // Call is ringing on customer's phone
      call.on('ringing', (hasEarlyMedia) => {
        console.log('[TelephonyVoice] Customer phone is ringing (hasEarlyMedia:', hasEarlyMedia, ')');
        callbacks.onStateChange('ringing', `Ringing customer's mobile phone (${cleanNumber})...`);
      });

      // Customer answered the phone! Real-time two-way audio bridge active
      call.on('accept', () => {
        console.log('[TelephonyVoice] Customer answered! Audio stream connected.');
        callbacks.onStateChange('connected', `Connected with ${customerName}. Live two-way audio active.`);
        this.startDurationTimer();

        // Start call quality monitoring
        const callSid = (call.parameters as any)?.CallSid || `call_${Date.now()}`;
        callQualityMonitor.start(null, callSid, agentAuthToken);
      });

      // Live audio quality sample stream
      call.on('sample', (sample: any) => {
        callQualityMonitor.reportSample({
          rtt: sample.rtt,
          jitter: sample.jitter,
          packetsLost: sample.packetsLost,
          packetsReceived: sample.packetsReceived
        });
      });

      // Network quality warnings
      call.on('warning', (name: string) => {
        console.warn('[TelephonyVoice] Network degradation warning:', name);
        if (name.includes('rtt') || name.includes('loss') || name.includes('jitter')) {
          callQualityMonitor.setConnectionState('reconnecting', 1);
        }
      });

      call.on('warning-cleared', () => {
        callQualityMonitor.setConnectionState('connected', 0);
      });

      // Customer or Agent hung up
      call.on('disconnect', () => {
        console.log('[TelephonyVoice] Call disconnected.');
        this.stopDurationTimer();
        callQualityMonitor.syncWithBackend(0);
        callQualityMonitor.stop();
        this.activeCall = null;
        callbacks.onStateChange('ended', 'Call ended.');
      });

      call.on('cancel', () => {
        console.log('[TelephonyVoice] Call canceled before answer.');
        this.stopDurationTimer();
        this.activeCall = null;
        callbacks.onStateChange('ended', 'Call was canceled.');
      });

      call.on('reject', () => {
        console.log('[TelephonyVoice] Call rejected or busy.');
        this.stopDurationTimer();
        this.activeCall = null;
        callbacks.onStateChange('failed', 'Customer was busy or rejected the call.');
      });

      call.on('error', (err) => {
        console.error('[TelephonyVoice] Call error:', err);
        this.stopDurationTimer();
        this.activeCall = null;
        callbacks.onStateChange('failed', err.message || 'Call failed.');
        callbacks.onError(err.message || 'Call connection error.');
      });

      call.on('mute', (muted) => {
        this.isMuted = muted;
      });
    } catch (err: any) {
      console.error('[TelephonyVoice] Failed to connect call:', err);
      callbacks.onStateChange('failed', err.message || 'Failed to place outbound call.');
      callbacks.onError(err.message || 'Telephony provider connection failed.');
    }
  }

  // Toggle Mute / Unmute
  public toggleMute(): boolean {
    if (this.activeCall) {
      this.isMuted = !this.isMuted;
      this.activeCall.mute(this.isMuted);
    }
    return this.isMuted;
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  public sendDigits(digits: string): void {
    if (this.activeCall && /^[0-9*#]+$/.test(digits)) {
      this.activeCall.sendDigits(digits);
    }
  }

  // Hang up the active call
  public endCall(): void {
    if (this.activeCall) {
      try {
        this.activeCall.disconnect();
      } catch (err) {
        console.warn('[TelephonyVoice] Error disconnecting call:', err);
      }
      this.activeCall = null;
    }
    this.stopDurationTimer();
    if (this.callbacks) {
      this.callbacks.onStateChange('ended', 'Call ended.');
    }
  }

  // Set output speaker volume (0 to 1)
  public setVolume(volume: number): void {
    try {
      const clamped = Math.max(0, Math.min(1, volume));
      const audioElements = document.querySelectorAll('audio');
      audioElements.forEach((el) => {
        el.volume = clamped;
      });
    } catch (err) {
      console.warn('[TelephonyVoice] Could not adjust audio elements volume:', err);
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
