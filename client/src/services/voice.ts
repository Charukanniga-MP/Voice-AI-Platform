// Cross-browser speech recognition declaration
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

import { voiceOutputController } from './voiceOutputController.js';

export const LANGUAGE_BCP47: Record<string, string> = {
  en: 'en-US',
  ta: 'ta-IN',
  te: 'te-IN',
  ml: 'ml-IN',
  kn: 'kn-IN',
  hi: 'hi-IN',
  bn: 'bn-IN',
  mr: 'mr-IN',
  ar: 'ar-SA',
  fr: 'fr-FR',
  de: 'de-DE',
  es: 'es-ES',
  zh: 'zh-CN',
  ja: 'ja-JP',
  ko: 'ko-KR',
  it: 'it-IT',
  pt: 'pt-BR',
  ru: 'ru-RU',
  tr: 'tr-TR',
  id: 'id-ID',
  vi: 'vi-VN'
};

export class VoiceService {
  private recognition: any = null;
  private isListening: boolean = false;
  private currentLang: string = 'en-US';
  private vadTimer: any = null;
  private lastInterimTranscript: string = '';
  private lastFinalUtterance: { text: string; timestamp: number } = { text: '', timestamp: 0 };

  public onInterruption?: () => void;
  public onSpeechStart?: () => void;
  public onLanguageDetected?: (lang: string) => void;

  // Real-time automatic language identification from customer speech
  public detectScriptLanguage(text: string): string | null {
    const trimmed = (text || '').trim();
    if (!trimmed) return null;

    // Script-based recognition
    if (/[\u0B80-\u0BFF]/.test(trimmed)) return 'ta'; // Tamil
    if (/[\u0C00-\u0C7F]/.test(trimmed)) return 'te'; // Telugu
    if (/[\u0D00-\u0D7F]/.test(trimmed)) return 'ml'; // Malayalam
    if (/[\u0C80-\u0CFF]/.test(trimmed)) return 'kn'; // Kannada
    if (/[\u0980-\u09FF]/.test(trimmed)) return 'bn'; // Bengali
    if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(trimmed)) return 'ar'; // Arabic
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(trimmed)) return 'ja'; // Japanese (Hiragana/Katakana checked before Chinese Kanji)
    if (/[\u4E00-\u9FFF]/.test(trimmed)) return 'zh'; // Chinese (Hanzi)
    if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(trimmed)) return 'ko'; // Korean
    if (/[\u0400-\u04FF]/.test(trimmed)) return 'ru'; // Russian
    if (/[\u0102\u0103\u0110\u0111\u01A0\u01A1\u01AF\u01B0\u1EA0-\u1EF9]/.test(trimmed)) return 'vi'; // Vietnamese
    if (/[\u0900-\u097F]/.test(trimmed)) {
      // Devanagari: differentiate Marathi vs Hindi
      if (/(?:आहे|नाही|काय|कसे|माझे|तुमचे|धन्यवाद|नमस्कार)/.test(trimmed)) return 'mr';
      return 'hi';
    }

    const lower = trimmed.toLowerCase();

    // Latin-script patterns
    if (/\b(bonjour|merci|comment|aide|commande|compte|salut|s'il vous plait)\b/.test(lower)) return 'fr';
    if (/\b(hola|gracias|por favor|como|buenos|dias|ayuda|pedido)\b/.test(lower)) return 'es';
    if (/\b(hallo|guten|danke|bitte|wie|hilfe|bestellung)\b/.test(lower)) return 'de';
    if (/\b(ciao|buongiorno|grazie|prego|aiuto|ordine)\b/.test(lower)) return 'it';
    if (/\b(ol[aá]|obrigad[oa]|por favor|ajuda|pedido|conta|voc[eê]|pre[cç]os?|quais)\b/i.test(lower) || /[\u00E3\u00F5\u00E7]/.test(lower)) return 'pt';
    if (/\b(merhaba|tesekkur|lutfen|nasil|yardim)\b/.test(lower)) return 'tr';
    if (/\b(halo|terima kasih|tolong|bagaimana|bantuan)\b/.test(lower)) return 'id';
    if (/\b(xin ch[aà]o|c[aá]m [oơ]n|l[aà]m [oơ]n|th[eế] n[aà]o|gi[uú]p [dđ][oõỡ]|b[aạ]n)\b/i.test(lower)) return 'vi';

    // Transliterated Indian language patterns
    if (/\b(vanakkam|ennudaiya|thaniya|solunga|nandri|eppadi|ungalukku|thirumba)\b/.test(lower)) return 'ta';
    if (/\b(namaste|dhanyavad|kaise|kripya|apka|madad|bataiye|samajh)\b/.test(lower)) return 'hi';
    if (/\b(namaskaramu|ela|unnaru|dhanyavadalu|meeru|sahayam)\b/.test(lower)) return 'te';
    if (/\b(namaskara|hegidira|dhanyavada|enu|nimma|sahaya)\b/.test(lower)) return 'kn';
    if (/\b(namaskaram|enthoke|vishesham|nandi|sahayikkan|ningalude)\b/.test(lower)) return 'ml';
    if (/\b(nomoshkar|dhonnobad|kemon|achen|amake|sahajjo)\b/.test(lower)) return 'bn';

    return null;
  }

  constructor() {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';
      }
    }
  }

  public unlockAudio() {
    voiceOutputController.unlockAudio();
  }

  public setLanguage(langCode: string) {
    const raw = (langCode || 'en').toLowerCase().slice(0, 2);
    const bcp47 = LANGUAGE_BCP47[raw] || `${raw}-${raw.toUpperCase()}`;
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
    voiceOutputController.setVolume(volume);
  }

  // Check if AI voice is currently playing
  public isSpeaking(): boolean {
    return voiceOutputController.isSpeaking();
  }

  // Start speech recognition with deduplicated VAD and automatic interruption support
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
      // 1. BARGE-IN: If customer speaks while AI is speaking, cut off AI speech immediately!
      if (this.isSpeaking()) {
        console.log('[VoiceService] Barge-in triggered: customer spoke while AI speaking. Halting voice.');
        this.cancelSpeech();
        if (this.onInterruption) {
          this.onInterruption();
        }
      }

      if (this.onSpeechStart) {
        this.onSpeechStart();
      }

      let interim = '';
      let isFinalResult = false;
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          isFinalResult = true;
          finalTranscript = transcript.trim();
        } else {
          interim += transcript;
        }
      }

      // Automatic Language Identification from live speech
      const spokenText = (finalTranscript || interim).trim();
      if (spokenText) {
        const detected = this.detectScriptLanguage(spokenText);
        if (detected && detected !== this.currentLang.slice(0, 2) && this.onLanguageDetected) {
          this.onLanguageDetected(detected);
        }
      }

      if (isFinalResult && finalTranscript) {
        // Clear any active VAD timer to avoid double-emitting the final result
        if (this.vadTimer) {
          clearTimeout(this.vadTimer);
          this.vadTimer = null;
        }
        this.lastInterimTranscript = '';

        // Check if recently finalized by VAD to prevent double invocation
        const cleanFinal = finalTranscript.toLowerCase().trim();
        const now = Date.now();
        if (
          this.lastFinalUtterance.text === cleanFinal &&
          (now - this.lastFinalUtterance.timestamp) < 2500
        ) {
          // Already finalized by VAD timer; suppress duplicate native final event
          return;
        }

        this.lastFinalUtterance = { text: cleanFinal, timestamp: now };
        onResult(finalTranscript, true);
      } else if (interim.trim()) {
        this.lastInterimTranscript = interim.trim();
        onResult(this.lastInterimTranscript, false);

        // Fast Voice Activity Detection (VAD) Debounce:
        // Finalize after 320ms pause on a meaningful utterance
        if (this.vadTimer) clearTimeout(this.vadTimer);
        if (this.lastInterimTranscript.length >= 2) {
          this.vadTimer = setTimeout(() => {
            if (this.lastInterimTranscript && this.isListening) {
              const textToEmit = this.lastInterimTranscript.trim();
              this.lastInterimTranscript = '';
              const now = Date.now();
              const cleanText = textToEmit.toLowerCase();

              if (
                this.lastFinalUtterance.text === cleanText &&
                (now - this.lastFinalUtterance.timestamp) < 2500
              ) {
                return;
              }

              this.lastFinalUtterance = { text: cleanText, timestamp: now };
              console.log('[VoiceService] Fast VAD detected end of speech (finalized):', textToEmit);
              onResult(textToEmit, true);
            }
          }, 320);
        }
      }
    };

    this.recognition.onerror = (event: any) => {
      if (event.error === 'no-speech' || event.error === 'aborted') {
        return;
      }
      console.warn('[VoiceService] Recognition error:', event.error);
      if (onError) onError(event);
    };

    this.recognition.onend = () => {
      // Automatically restart to maintain continuous dialogue
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
    if (this.vadTimer) {
      clearTimeout(this.vadTimer);
      this.vadTimer = null;
    }
    this.lastInterimTranscript = '';
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch { }
    }
  }

  /**
   * Speak text via Centralized Single Voice Output Controller
   * Guaranteed: ONLY ONE voice output, no duplicate audio, no double speech.
   */
  public speak(
    text: string,
    onEnd?: () => void,
    langCode?: string,
    onStartAudio?: () => void,
    responseId?: string
  ): Promise<void> {
    const rawLang = (langCode || this.currentLang.slice(0, 2) || 'en').toLowerCase().slice(0, 2);
    return voiceOutputController.play(text, {
      responseId,
      langCode: rawLang,
      onStart: onStartAudio,
      onEnd
    });
  }

  /**
   * Cancel any currently playing speech immediately (Barge-in / Interruption)
   */
  public cancelSpeech() {
    voiceOutputController.stop();
  }

  public isSpeechSupported(): boolean {
    return !!(this.recognition || typeof window !== 'undefined');
  }
}

export const voiceService = new VoiceService();
