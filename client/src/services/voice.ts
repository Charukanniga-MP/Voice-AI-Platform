// Cross-browser speech recognition declaration
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export const LANGUAGE_BCP47: Record<string, string> = {
  en: 'en-US',
  ta: 'ta-IN',
  te: 'te-IN',
  ml: 'ml-IN',
  hi: 'hi-IN'
};

export class VoiceService {
  private recognition: any = null;
  private isListening: boolean = false;
  private synth: SpeechSynthesis | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private currentAudio: HTMLAudioElement | null = null;
  private currentLang: string = 'en-US';
  private currentVolume: number = 1.0;
  private audioUnlocked: boolean = false;

  constructor() {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';
      }

      if ('speechSynthesis' in window) {
        this.synth = window.speechSynthesis;
      }

      // Unlock mobile audio on first user touch / click
      const unlock = () => {
        this.unlockAudio();
        window.removeEventListener('click', unlock);
        window.removeEventListener('touchstart', unlock);
      };
      window.addEventListener('click', unlock, { once: true });
      window.addEventListener('touchstart', unlock, { once: true });
    }
  }

  // Pre-unlock audio element for mobile devices (iOS / Android)
  public unlockAudio() {
    if (this.audioUnlocked) return;
    try {
      const silentAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
      silentAudio.volume = 0.01;
      silentAudio.play().then(() => {
        this.audioUnlocked = true;
        console.log('[VoiceService] Mobile audio pipeline unlocked successfully.');
      }).catch(() => { });
    } catch {
      // Ignore initial silent play
    }
  }

  // Set active language for Speech Recognition and Synthesis
  public setLanguage(langCode: string) {
    const raw = (langCode || 'en').toLowerCase().slice(0, 2);
    const bcp47 = LANGUAGE_BCP47[raw] || LANGUAGE_BCP47.en;
    this.currentLang = bcp47;

    if (this.recognition) {
      const wasListening = this.isListening;
      if (wasListening) {
        this.stopListening();
      }
      this.recognition.lang = bcp47;
      console.log(`[VoiceService] Recognition language set to: ${bcp47}`);
    }
  }

  public getLanguage(): string {
    return this.currentLang;
  }

  public setVolume(volume: number) {
    this.currentVolume = Math.max(0, Math.min(1, volume));
    if (this.currentAudio) {
      this.currentAudio.volume = this.currentVolume;
    }
  }

  // Start speech recognition with automatic customer interruption support
  public startListening(
    onResult: (text: string, isFinal: boolean) => void,
    onError?: (err: any) => void
  ) {
    if (!this.recognition) {
      console.warn('Speech recognition not supported in this browser.');
      return;
    }

    if (this.isListening) return;

    this.recognition.onresult = (event: any) => {
      // Customer interruption: If customer speaks while AI is speaking, cut off AI speech immediately!
      this.cancelSpeech();

      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          onResult(transcript.trim(), true);
        } else {
          interim += transcript;
        }
      }
      if (interim) {
        onResult(interim.trim(), false);
      }
    };

    this.recognition.onerror = (event: any) => {
      // Avoid breaking continuous dialogue on no-speech or aborted events
      if (event.error === 'no-speech' || event.error === 'aborted') {
        return;
      }
      console.warn('[VoiceService] Recognition error:', event.error);
      if (onError) onError(event);
    };

    this.recognition.onend = () => {
      // If still supposed to be listening, automatically restart to maintain continuous dialogue
      if (this.isListening) {
        try {
          this.recognition.start();
        } catch {
          // Ignore restart error
        }
      }
    };

    try {
      this.isListening = true;
      this.recognition.start();
      console.log(`[VoiceService] Speech recognition started (${this.currentLang})`);
    } catch (err) {
      console.error('[VoiceService] Could not start speech recognition:', err);
    }
  }

  // Stop speech recognition
  public stopListening() {
    this.isListening = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch { }
    }
  }

  // Speak text using High-Fidelity Audio Stream with seamless fallback to SpeechSynthesis
  public speak(text: string, onEnd?: () => void, langCode?: string): Promise<void> {
    return new Promise((resolve) => {
      const cleanText = (text || '').trim();
      if (!cleanText) {
        if (onEnd) onEnd();
        resolve();
        return;
      }

      // Customer interruption / cleanup previous speech
      this.cancelSpeech();

      const rawLang = (langCode || this.currentLang.slice(0, 2) || 'en').toLowerCase().slice(0, 2);
      const targetLang = LANGUAGE_BCP47[rawLang] ? rawLang : 'en';

      // 1. Primary: High-fidelity Server-generated Audio Stream (MP3)
      const audioUrl = `/api/voice/tts?text=${encodeURIComponent(cleanText)}&lang=${targetLang}`;
      const audio = new Audio(audioUrl);
      this.currentAudio = audio;
      audio.volume = this.currentVolume;

      let hasResolved = false;
      const finish = () => {
        if (!hasResolved) {
          hasResolved = true;
          this.currentAudio = null;
          if (onEnd) onEnd();
          resolve();
        }
      };

      audio.onended = () => {
        finish();
      };

      audio.onerror = (err) => {
        console.warn('[VoiceService] Server TTS error, falling back to Web SpeechSynthesis:', err);
        this.currentAudio = null;
        this.speakWithSpeechSynthesis(cleanText, onEnd, targetLang).then(resolve);
      };

      audio.play().catch((playErr) => {
        console.warn('[VoiceService] HTML5 Audio autoplay policy error, falling back to Web SpeechSynthesis:', playErr);
        this.currentAudio = null;
        this.speakWithSpeechSynthesis(cleanText, onEnd, targetLang).then(resolve);
      });
    });
  }

  // Fallback: Web Speech API SpeechSynthesis
  private speakWithSpeechSynthesis(text: string, onEnd?: () => void, langCode?: string): Promise<void> {
    return new Promise((resolve) => {
      if (!this.synth) {
        if (onEnd) onEnd();
        resolve();
        return;
      }

      this.cancelSpeech();

      const utterance = new SpeechSynthesisUtterance(text);
      this.currentUtterance = utterance;

      const rawLang = (langCode || this.currentLang.slice(0, 2) || 'en').toLowerCase().slice(0, 2);
      const targetBcp47 = LANGUAGE_BCP47[rawLang] || 'en-US';
      utterance.lang = targetBcp47;

      const voices = this.synth.getVoices();
      const langPrefix = targetBcp47.split('-')[0];

      // Find matching voice
      const matchingVoice = voices.find(v => v.lang.toLowerCase() === targetBcp47.toLowerCase()) ||
        voices.find(v => v.lang.toLowerCase().startsWith(langPrefix)) ||
        voices.find(v => v.name.includes('Google') && v.lang.startsWith('en')) ||
        voices.find(v => v.lang.startsWith('en'));

      if (matchingVoice) {
        utterance.voice = matchingVoice;
      }

      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = this.currentVolume;

      utterance.onend = () => {
        this.currentUtterance = null;
        if (onEnd) onEnd();
        resolve();
      };

      utterance.onerror = () => {
        this.currentUtterance = null;
        if (onEnd) onEnd();
        resolve();
      };

      this.synth.speak(utterance);
    });
  }

  // Cancel any currently playing speech immediately (Interruption support)
  public cancelSpeech() {
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
        this.currentAudio.src = '';
      } catch { }
      this.currentAudio = null;
    }

    if (this.synth) {
      try {
        this.synth.cancel();
      } catch { }
      this.currentUtterance = null;
    }
  }

  public isSpeechSupported(): boolean {
    return !!(this.recognition || typeof window !== 'undefined');
  }
}

export const voiceService = new VoiceService();
