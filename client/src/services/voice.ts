// Cross-browser speech recognition declaration
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

import { voiceOutputController } from './voiceOutputController.js';

export const LANGUAGE_BCP47: Record<string, string> = {
  en: 'en-IN',
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
  private isActuallyRunning: boolean = false;
  private currentLang: string = 'en-US';
  private vadTimer: any = null;
  private lastInterimTranscript: string = '';
  private lastFinalUtterance: { text: string; timestamp: number } = { text: '', timestamp: 0 };
  private activeOnResult?: (text: string, isFinal: boolean, utteranceId?: string) => void;
  private activeOnError?: (err: any) => void;

  public onInterruption?: () => void;
  public onSpeechStart?: () => void;
  public onLanguageDetected?: (lang: string) => void;

  // Real-time automatic language identification from customer speech
  // Strict: Requires native Unicode script or multi-word native phrases to avoid spurious switches
  public detectScriptLanguage(text: string): string | null {
    const trimmed = (text || '').trim();
    if (!trimmed) return null;

    // 1. Definite script-based recognition (Unicode ranges)
    if (/[\u0B80-\u0BFF]/.test(trimmed)) return 'ta'; // Tamil
    if (/[\u0C00-\u0C7F]/.test(trimmed)) return 'te'; // Telugu
    if (/[\u0D00-\u0D7F]/.test(trimmed)) return 'ml'; // Malayalam
    if (/[\u0C80-\u0CFF]/.test(trimmed)) return 'kn'; // Kannada
    if (/[\u0980-\u09FF]/.test(trimmed)) return 'bn'; // Bengali
    if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(trimmed)) return 'ar'; // Arabic
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(trimmed)) return 'ja'; // Japanese
    if (/[\u4E00-\u9FFF]/.test(trimmed)) return 'zh'; // Chinese
    if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(trimmed)) return 'ko'; // Korean
    if (/[\u0400-\u04FF]/.test(trimmed)) return 'ru'; // Russian
    if (/[\u0102\u0103\u0110\u0111\u01A0\u01A1\u01AF\u01B0\u1EA0-\u1EF9]/.test(trimmed)) return 'vi'; // Vietnamese
    if (/[\u0900-\u097F]/.test(trimmed)) {
      if (/(?:आहे|नाही|काय|कसे|माझे|तुमचे|धन्यवाद|नमस्कार)/.test(trimmed)) return 'mr';
      return 'hi';
    }

    const lower = trimmed.toLowerCase();
    const words = lower.split(/\s+/).filter(w => w.length >= 2);
    // Never switch language from a single Latin word to prevent greeting-triggered false switches
    if (words.length < 2) return null;

    // 2. High-confidence multi-word Latin patterns
    if (/\b(bonjour\s+comment|s'il\s+vous\s+pla[iî]t|je\s+voudrais|merci\s+beaucoup|aidez\s+moi)\b/.test(lower)) return 'fr';
    if (/\b(por\s+favor|buenos\s+d[ií]as|buenas\s+tardes|c[oó]mo\s+est[aá]|muchas\s+gracias)\b/.test(lower)) return 'es';
    if (/\b(guten\s+tag|guten\s+morgen|vielen\s+dank|bitte\s+sch[oö]n|wie\s+geht)\b/.test(lower)) return 'de';
    if (/\b(buon\s+giorno|buona\s+sera|per\s+favore|molte\s+grazie|come\s+sta)\b/.test(lower)) return 'it';
    if (/\b(por\s+favor|muito\s+obrigad[oa]|bom\s+dia|boa\s+tarde|como\s+vai)\b/.test(lower)) return 'pt';
    if (/\b(te[sş]ekk[uü]r\s+ederim|l[uü]tfen\s+yard[iı]m|nas[iı]ls[iı]n[iı]z)\b/.test(lower)) return 'tr';
    if (/\b(terima\s+kasih|tolong\s+saya|bagaimana\s+cara|selamat\s+pagi)\b/.test(lower)) return 'id';
    if (/\b(xin\s+ch[aà]o|c[aá]m\s+[oơ]n|l[aà]m\s+[oơ]n)\b/.test(lower)) return 'vi';

    // 3. Multi-word transliterated Indian patterns (require at least 2 distinct language tokens)
    if (/\b(vanakkam|solunga|eppadi|ungalukku|nandri)\b/.test(lower) && /\b(ennudaiya|thaniya|thirumba|irukku|panriga)\b/.test(lower)) return 'ta';
    if (/\b(namaste|kaise|kripya|madad|bataiye)\b/.test(lower) && /\b(apka|samajh|kahiye|chahiye|karein)\b/.test(lower)) return 'hi';
    if (/\b(namaskaramu|ela|unnaru|dhanyavadalu|meeru)\b/.test(lower) && /\b(sahayam|cheyandi|undi|kavali)\b/.test(lower)) return 'te';
    if (/\b(namaskara|hegidira|dhanyavada|enu|nimma)\b/.test(lower) && /\b(sahaya|madi|beku|ide)\b/.test(lower)) return 'kn';
    if (/\b(namaskaram|enthoke|vishesham|nandi|sahayikkan)\b/.test(lower) && /\b(ningalude|undu|venam|ariyamo)\b/.test(lower)) return 'ml';
    if (/\b(nomoshkar|dhonnobad|kemon|achen|amake)\b/.test(lower) && /\b(sahajjo|korun|bolun|lagbe)\b/.test(lower)) return 'bn';

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
      if (wasListening && this.activeOnResult) {
        this.startListening(this.activeOnResult, this.activeOnError);
      }
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

  // Ensure speech recognition is actively listening (called right after AI speaks)
  public ensureListening(
    onResult?: (text: string, isFinal: boolean, utteranceId?: string) => void,
    onError?: (err: any) => void
  ) {
    if (onResult) this.activeOnResult = onResult;
    if (onError) this.activeOnError = onError;
    this.isListening = true;

    if (!this.recognition) return;

    if (!this.isActuallyRunning) {
      try {
        this.recognition.start();
        console.log(`[VoiceService] Active speech listener confirmed (${this.currentLang}).`);
      } catch (err: any) {
        if (err?.name === 'InvalidStateError') {
          this.isActuallyRunning = true;
        } else {
          setTimeout(() => {
            if (this.isListening && !this.isActuallyRunning) {
              try { this.recognition.start(); } catch { }
            }
          }, 200);
        }
      }
    }
  }

  // Start speech recognition with deduplicated VAD and automatic interruption support
  public startListening(
    onResult: (text: string, isFinal: boolean, utteranceId?: string) => void,
    onError?: (err: any) => void
  ) {
    if (!this.recognition) {
      console.warn('Speech recognition not supported in this browser.');
      onError?.({ error: 'not-supported' });
      return;
    }

    if (this.vadTimer) {
      clearTimeout(this.vadTimer);
      this.vadTimer = null;
    }
    this.lastInterimTranscript = '';
    this.activeOnResult = onResult;
    this.activeOnError = onError;
    this.isListening = true;

    this.recognition.onstart = () => {
      this.isActuallyRunning = true;
      console.log(`[VoiceService] Speech recognition session active (${this.currentLang})`);
    };

    this.recognition.onresult = (event: any) => {
      let interim = '';
      let isFinalResult = false;
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const item = event.results[i];
        if (!item || !item[0]) continue;
        const transcript = item[0].transcript;
        if (item.isFinal) {
          isFinalResult = true;
          finalTranscript += (finalTranscript ? ' ' : '') + transcript.trim();
        } else {
          interim += (interim ? ' ' : '') + transcript.trim();
        }
      }

      const spokenText = (finalTranscript || interim).trim();
      if (!spokenText) return;

      // Filter out noise-only artifacts (clicks, breath, non-word characters)
      const hasWordCharacters = /[\p{L}\p{N}]/u.test(spokenText);
      if (!hasWordCharacters || spokenText.length < 2) return;

      // 1. ACOUSTIC ECHO SUPPRESSION (Multi-layer against current & recent AI utterances)
      // When AI voice plays through speakers, the microphone captures speech recognition output.
      // We must completely suppress acoustic echo so the agent does NOT self-trigger or create phantom customer speech.
      const isEcho = voiceOutputController.isAcousticEcho(spokenText);
      if (isEcho) {
        console.log(`[VoiceService] Acoustic echo suppressed (${this.isSpeaking() ? 'during' : 'after'} AI speech): "${spokenText.slice(0, 50)}...". Ignoring.`);
        this.lastInterimTranscript = '';
        if (this.vadTimer) {
          clearTimeout(this.vadTimer);
          this.vadTimer = null;
        }
        return;
      }

      // 2. INTELLIGENT BARGE-IN
      // If AI is currently speaking and detected speech is genuine customer input (NOT echo), allow customer interruption.
      if (this.isSpeaking()) {
        const cleanWords = spokenText.split(/\s+/).filter(w => w.length >= 2);
        if (spokenText.length >= 3 && cleanWords.length >= 1) {
          console.log(`[VoiceService] Genuine customer barge-in detected ("${spokenText}"). Halting voice output.`);
          this.cancelSpeech();
          if (this.onInterruption) {
            this.onInterruption();
          }
        }
      }

      if (this.onSpeechStart) {
        this.onSpeechStart();
      }

      // Automatic Language Identification from live speech
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

        // Check if recently finalized by VAD with identical text to prevent double invocation
        const cleanFinal = finalTranscript.toLowerCase().trim();
        const now = Date.now();
        if (
          this.lastFinalUtterance.text === cleanFinal &&
          (now - this.lastFinalUtterance.timestamp) < 3000
        ) {
          // Already finalized by VAD timer; suppress duplicate native final event
          return;
        }

        this.lastFinalUtterance = { text: cleanFinal, timestamp: now };
        const utteranceId = 'utt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        if (this.activeOnResult) {
          this.activeOnResult(finalTranscript, true, utteranceId);
        }
      } else if (interim.trim()) {
        this.lastInterimTranscript = interim.trim();
        if (this.activeOnResult) {
          this.activeOnResult(this.lastInterimTranscript, false);
        }

        // Intelligent Voice Activity Detection (VAD) Debounce:
        // 1. Never cut off sentences ending with incomplete connectors / question words / prepositions
        // 2. Allow 1500ms natural conversational pause for complete utterances before auto-finalizing
        if (this.vadTimer) {
          clearTimeout(this.vadTimer);
          this.vadTimer = null;
        }

        const trimmedInterim = this.lastInterimTranscript.trim();
        const isIncomplete = /\b(and|or|in|on|at|for|with|of|to|what|how|when|where|why|which|is|are|was|were|can|could|will|would|if|the|a|an|my|your|about|so|but|because)$/i.test(trimmedInterim);

        if (trimmedInterim.length >= 2 && !isIncomplete) {
          // 1500ms natural pause threshold allows customer to breathe without truncation
          const vadDelayMs = trimmedInterim.split(/\s+/).length <= 2 ? 1800 : 1500;
          this.vadTimer = setTimeout(() => {
            if (this.lastInterimTranscript && this.isListening) {
              const textToEmit = this.lastInterimTranscript.trim();
              this.lastInterimTranscript = '';

              if (voiceOutputController.isAcousticEcho(textToEmit)) {
                console.log('[VoiceService] Suppressing VAD emission of acoustic echo:', textToEmit);
                return;
              }

              const now = Date.now();
              const cleanText = textToEmit.toLowerCase();

              if (
                this.lastFinalUtterance.text === cleanText &&
                (now - this.lastFinalUtterance.timestamp) < 3000
              ) {
                return;
              }

              this.lastFinalUtterance = { text: cleanText, timestamp: now };
              const utteranceId = 'utt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
              console.log('[VoiceService] VAD detected natural end of speech (finalized):', textToEmit);
              if (this.activeOnResult) {
                this.activeOnResult(textToEmit, true, utteranceId);
              }
            }
          }, vadDelayMs);
        }
      }
    };

    this.recognition.onerror = (event: any) => {
      if (event.error === 'no-speech' || event.error === 'aborted') {
        // Natural pause / browser silence timeout: reset state and keep speech recognition alive
        this.isActuallyRunning = false;
        if (this.isListening) {
          setTimeout(() => {
            if (this.isListening && !this.isActuallyRunning) {
              try {
                this.recognition.start();
              } catch (err: any) {
                if (err?.name === 'InvalidStateError') {
                  this.isActuallyRunning = true;
                }
              }
            }
          }, 200);
        }
        return;
      }
      console.warn('[VoiceService] Recognition error:', event.error);
      const userMessage = event.error === 'not-allowed' || event.error === 'audio-capture'
        ? 'Microphone access is unavailable. Please check your microphone permissions.'
        : 'Speech recognition paused. Reconnecting...';

      if (this.activeOnError) this.activeOnError({ error: event.error, userMessage });
    };

    this.recognition.onend = () => {
      this.isActuallyRunning = false;
      // Automatically restart to maintain continuous conversational listening
      if (this.isListening) {
        setTimeout(() => {
          if (!this.isListening || this.isActuallyRunning) return;
          try {
            this.recognition.start();
          } catch (err: any) {
            if (err?.name === 'InvalidStateError') {
              this.isActuallyRunning = true;
            } else {
              setTimeout(() => {
                if (this.isListening && !this.isActuallyRunning) {
                  try { this.recognition.start(); } catch { }
                }
              }, 300);
            }
          }
        }, 150);
      }
    };

    if (!this.isActuallyRunning) {
      try {
        this.recognition.start();
        console.log(`[VoiceService] Speech recognition started (${this.currentLang})`);
      } catch (err: any) {
        if (err?.name === 'InvalidStateError') {
          this.isActuallyRunning = true;
        } else {
          console.error('[VoiceService] Could not start speech recognition:', err);
          if (this.activeOnError) this.activeOnError({ error: 'start-failed', cause: err });
        }
      }
    }
  }

  // Stop speech recognition
  public stopListening() {
    this.isListening = false;
    this.isActuallyRunning = false;
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

  // Explicitly pause listening during AI voice playback to ensure zero self-pickup
  public pauseListening() {
    this.isListening = false;
    this.isActuallyRunning = false;
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

  // Resume listening after AI playback completes and cooldown buffer has expired
  public resumeListening() {
    if (this.activeOnResult) {
      this.startListening(this.activeOnResult, this.activeOnError);
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
