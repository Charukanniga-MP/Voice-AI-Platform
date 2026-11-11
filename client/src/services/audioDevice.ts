/**
 * KAIRA Voice AI - Audio Device Manager & Hardware Monitoring
 *
 * Checks microphone/speaker permissions, enumerates audio inputs/outputs,
 * provides live volume meter testing via Web Audio API, and speaker audio testing.
 */

export interface AudioDeviceInfo {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
  groupId?: string;
  isDefault?: boolean;
}

export interface PermissionStatusResult {
  granted: boolean;
  state: 'granted' | 'prompt' | 'denied' | 'unsupported';
  error?: string;
}

class AudioDeviceManager {
  private preferredMicIdKey = 'kaira_preferred_mic_id';
  private preferredSpeakerIdKey = 'kaira_preferred_speaker_id';

  private activeTestAudioContext: AudioContext | null = null;
  private activeTestStream: MediaStream | null = null;
  private activeTestMeterId: number | null = null;

  /**
   * Check microphone permission state without immediately prompting if already checked
   */
  public async checkMicrophonePermission(): Promise<PermissionStatusResult> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return {
        granted: false,
        state: 'unsupported',
        error: 'Media devices API is not supported in this browser.'
      };
    }

    try {
      if (navigator.permissions && navigator.permissions.query) {
        const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        if (result.state === 'granted') {
          return { granted: true, state: 'granted' };
        } else if (result.state === 'denied') {
          return {
            granted: false,
            state: 'denied',
            error: 'Microphone permission was denied. Please allow microphone access in your browser settings.'
          };
        }
      }

      // If prompt or query not supported, attempt test request
      return { granted: false, state: 'prompt' };
    } catch {
      return { granted: false, state: 'prompt' };
    }
  }

  /**
   * Request microphone permission and return the stream
   */
  public async requestMicrophoneAccess(preferredDeviceId?: string): Promise<MediaStream> {
    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(preferredDeviceId && preferredDeviceId !== 'default'
          ? { deviceId: { exact: preferredDeviceId } }
          : {})
      },
      video: false
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      return stream;
    } catch (err: any) {
      console.error('[AudioDevice] Microphone access denied or device unavailable:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw new Error('Microphone permission was denied. Please grant microphone access to place voice calls.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        throw new Error('No microphone was detected on your device. Please plug in a microphone or headset.');
      } else if (err.name === 'NotReadableError') {
        throw new Error('Your microphone is currently in use by another application. Please close other audio apps.');
      }
      throw new Error(err.message || 'Failed to acquire microphone access.');
    }
  }

  /**
   * Pre-check and prompt for microphone access before initiating or accepting a call.
   * Returns true if access is granted, false otherwise.
   */
  public async ensureMicrophoneAccess(): Promise<boolean> {
    try {
      const stream = await this.requestMicrophoneAccess();
      // Release test stream tracks
      stream.getTracks().forEach(t => t.stop());
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Enumerate all connected audio input and output devices
   */
  public async getConnectedDevices(): Promise<{
    microphones: AudioDeviceInfo[];
    speakers: AudioDeviceInfo[];
  }> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return { microphones: [], speakers: [] };
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const microphones: AudioDeviceInfo[] = [];
      const speakers: AudioDeviceInfo[] = [];

      devices.forEach((d) => {
        if (d.kind === 'audioinput') {
          microphones.push({
            deviceId: d.deviceId,
            label: d.label || `Microphone ${microphones.length + 1}`,
            kind: 'audioinput',
            groupId: d.groupId,
            isDefault: d.deviceId === 'default'
          });
        } else if (d.kind === 'audiooutput') {
          speakers.push({
            deviceId: d.deviceId,
            label: d.label || `Speaker / Headset ${speakers.length + 1}`,
            kind: 'audiooutput',
            groupId: d.groupId,
            isDefault: d.deviceId === 'default'
          });
        }
      });

      // If browser doesn't expose audiooutput (Safari/Firefox default without permissions), provide a Default item
      if (speakers.length === 0) {
        speakers.push({
          deviceId: 'default',
          label: 'System Default Speaker / Headset',
          kind: 'audiooutput',
          isDefault: true
        });
      }

      return { microphones, speakers };
    } catch (err) {
      console.warn('[AudioDevice] Error enumerating devices:', err);
      return { microphones: [], speakers: [] };
    }
  }

  /**
   * Get preferred device IDs saved in localStorage
   */
  public getPreferredMicrophoneId(): string {
    return localStorage.getItem(this.preferredMicIdKey) || 'default';
  }

  public setPreferredMicrophoneId(deviceId: string) {
    localStorage.setItem(this.preferredMicIdKey, deviceId);
  }

  public getPreferredSpeakerId(): string {
    return localStorage.getItem(this.preferredSpeakerIdKey) || 'default';
  }

  public setPreferredSpeakerId(deviceId: string) {
    localStorage.setItem(this.preferredSpeakerIdKey, deviceId);
  }

  /**
   * Start live microphone audio level meter for testing (volume 0 - 100)
   */
  public async startMicrophoneLevelTest(
    deviceId: string,
    onVolume: (volume: number) => void
  ): Promise<void> {
    this.stopMicrophoneLevelTest();

    try {
      const stream = await this.requestMicrophoneAccess(deviceId);
      this.activeTestStream = stream;

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass();
      this.activeTestAudioContext = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateMeter = () => {
        if (!this.activeTestAudioContext) return;
        analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        // Scale to 0 - 100 percentage
        const volume = Math.min(100, Math.round((avg / 128) * 100));
        onVolume(volume);

        this.activeTestMeterId = requestAnimationFrame(updateMeter);
      };

      updateMeter();
    } catch (err) {
      console.error('[AudioDevice] Level test failed:', err);
      throw err;
    }
  }

  /**
   * Stop active microphone level testing
   */
  public stopMicrophoneLevelTest() {
    if (this.activeTestMeterId !== null) {
      cancelAnimationFrame(this.activeTestMeterId);
      this.activeTestMeterId = null;
    }
    if (this.activeTestAudioContext) {
      try {
        this.activeTestAudioContext.close();
      } catch {}
      this.activeTestAudioContext = null;
    }
    if (this.activeTestStream) {
      this.activeTestStream.getTracks().forEach((t) => t.stop());
      this.activeTestStream = null;
    }
  }

  /**
   * Play an audible test chime through the selected speaker device
   */
  public async playSpeakerTestSound(speakerDeviceId?: string): Promise<void> {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass();

      // Synthesize a pleasant two-tone confirmation chime (A4 -> C#5 -> E5)
      const now = ctx.currentTime;
      const frequencies = [440, 554.37, 659.25]; // A major chord arpeggio

      frequencies.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.12);

        gain.gain.setValueAtTime(0, now + idx * 0.12);
        gain.gain.linearRampToValueAtTime(0.3, now + idx * 0.12 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.35);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + idx * 0.12);
        osc.stop(now + idx * 0.12 + 0.4);
      });

      setTimeout(() => {
        try {
          ctx.close();
        } catch {}
      }, 1000);
    } catch (err) {
      console.error('[AudioDevice] Speaker test failed:', err);
    }
  }

  /**
   * Apply selected audio output device to an HTMLAudioElement
   */
  public async applySpeakerToAudioElement(
    element: HTMLAudioElement,
    speakerDeviceId?: string
  ): Promise<boolean> {
    const deviceId = speakerDeviceId || this.getPreferredSpeakerId();
    if (deviceId && deviceId !== 'default' && (element as any).setSinkId) {
      try {
        await (element as any).setSinkId(deviceId);
        console.log(`[AudioDevice] Audio element output set to device: ${deviceId}`);
        return true;
      } catch (err) {
        console.warn('[AudioDevice] Could not set sink ID:', err);
      }
    }
    return false;
  }
}

export const audioDeviceManager = new AudioDeviceManager();

