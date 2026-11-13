// Synthetic Telephone Ringtone Generator using Web Audio API
// Generates standard dual-frequency telephone ring tone without external media dependencies

export class RingtoneService {
  private audioCtx: AudioContext | null = null;
  private isRinging: boolean = false;
  private intervalId: any = null;
  private activeOscillators: OscillatorNode[] = [];
  private activeGain: GainNode | null = null;

  constructor() {
    // Request notification permission if not yet requested
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    }
  }

  public unlockAudio() {
    this.initContext();
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  private initContext() {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.audioCtx = new AudioCtx();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  // Play a single ring burst (440Hz + 480Hz for 1.8 seconds)
  private playRingBurst() {
    if (!this.isRinging) return;
    this.initContext();
    if (!this.audioCtx) return;

    try {
      const now = this.audioCtx.currentTime;
      const gain = this.audioCtx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.25, now + 0.05);
      gain.gain.setValueAtTime(0.25, now + 1.8);
      gain.gain.linearRampToValueAtTime(0, now + 1.85);
      gain.connect(this.audioCtx.destination);
      this.activeGain = gain;

      // Two simultaneous frequencies: 440 Hz (standard A4) & 480 Hz (bell resonance)
      const osc1 = this.audioCtx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(440, now);
      osc1.connect(gain);
      osc1.start(now);
      osc1.stop(now + 1.85);

      const osc2 = this.audioCtx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(480, now);
      osc2.connect(gain);
      osc2.start(now);
      osc2.stop(now + 1.85);

      this.activeOscillators = [osc1, osc2];
    } catch (err) {
      console.warn('[Ringtone] AudioContext burst error:', err);
    }
  }

  // Start continuous ringing cadence (1.8s ring, 2.2s silence)
  public start(callerName?: string) {
    if (this.isRinging) return;
    this.isRinging = true;

    // Show desktop notification if permitted
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('KAIRA Voice AI - Incoming Call', {
          body: callerName ? `Incoming customer call from ${callerName}` : 'Incoming customer call...',
          icon: '/kaira-logo.png',
          requireInteraction: true
        });
      } catch (e) {
        console.warn('[Notification] Failed to show browser notification:', e);
      }
    }

    // Play first burst immediately
    this.playRingBurst();

    // Repeat every 4 seconds (1.8s tone + 2.2s silence)
    this.intervalId = setInterval(() => {
      if (this.isRinging) {
        this.playRingBurst();
      }
    }, 4000);
  }

  // Stop ringing immediately
  public stop() {
    this.isRinging = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Stop currently playing oscillators
    try {
      this.activeOscillators.forEach(osc => {
        try {
          osc.stop();
          osc.disconnect();
        } catch {}
      });
      this.activeOscillators = [];
      if (this.activeGain) {
        try {
          this.activeGain.disconnect();
        } catch {}
        this.activeGain = null;
      }
    } catch (e) {
      // Ignore cleanup error
    }
  }
}

export const ringtoneService = new RingtoneService();

