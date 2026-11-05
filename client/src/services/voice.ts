// Cross-browser speech recognition declaration
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export class VoiceService {
  private recognition: any = null;
  private isListening: boolean = false;
  private synth: SpeechSynthesis | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;

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
    }
  }

  // Start speech recognition
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
      console.warn('[VoiceService] Recognition error:', event.error);
      if (onError) onError(event);
    };

    this.recognition.onend = () => {
      // If we are still supposed to be listening, automatically restart
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
      console.log('[VoiceService] Speech recognition started');
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
      } catch {}
    }
  }

  // Speak text using natural TTS
  public speak(text: string, onEnd?: () => void): Promise<void> {
    return new Promise((resolve) => {
      if (!this.synth) {
        if (onEnd) onEnd();
        resolve();
        return;
      }

      this.cancelSpeech();

      const utterance = new SpeechSynthesisUtterance(text);
      this.currentUtterance = utterance;

      // Select best available English voice
      const voices = this.synth.getVoices();
      const preferred = voices.find(v =>
        (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Samantha') || v.name.includes('Zira') || v.name.includes('Jenny')) &&
        v.lang.startsWith('en')
      ) || voices.find(v => v.lang.startsWith('en'));

      if (preferred) {
        utterance.voice = preferred;
      }

      utterance.rate = 1.0;
      utterance.pitch = 1.0;

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

  public cancelSpeech() {
    if (this.synth) {
      this.synth.cancel();
      this.currentUtterance = null;
    }
  }

  public isSpeechSupported(): boolean {
    return !!(this.recognition && this.synth);
  }
}

export const voiceService = new VoiceService();
