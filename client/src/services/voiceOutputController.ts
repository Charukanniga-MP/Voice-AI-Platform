/**
 * Centralized Single Voice Output Controller
 *
 * Guarantees:
 * 1. ONLY ONE active voice output across the entire application at any given time.
 * 2. Zero double voice / duplicate audio:
 *    - Never plays browser-generated speech and server-generated speech simultaneously.
 *    - Automatically cancels previous audio before starting new audio.
 *    - Deduplicates identical responses within a 3.5s window.
 *    - Atomic fallback lock prevents race condition between HTML5 audio error and play rejection.
 * 3. Graceful handling of browser autoplay policies, speaker device routing, and interruption (barge-in).
 * 4. Full multilingual speech support across all 21 languages.
 */

import { audioDeviceManager } from './audioDevice.js';
import { getSocket } from './socket.js';
import { webrtcManager } from './webrtc.js';

export interface PlaybackOptions {
  responseId?: string;
  langCode?: string;
  volume?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (err: any) => void;
}

export class VoiceOutputController {
  private static instance: VoiceOutputController;

  private currentAudio: HTMLAudioElement | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private currentPlaybackId: number = 0;
  private isCurrentlySpeaking: boolean = false;
  private currentSpokenText: string = '';

  private lastSpokenText: string = '';
  private lastSpokenTime: number = 0;
  private lastResponseId: string = '';

  private currentVolume: number = 1.0;
  private audioUnlocked: boolean = false;
  private cachedVoices: SpeechSynthesisVoice[] = [];
  private recentUtterances: Array<{ text: string; timestamp: number }> = [];

  private constructor() {
    if (typeof window !== 'undefined') {
      const unlock = () => {
        this.unlockAudio();
        window.removeEventListener('click', unlock);
        window.removeEventListener('touchstart', unlock);
      };
      window.addEventListener('click', unlock, { once: true });
      window.addEventListener('touchstart', unlock, { once: true });

      if (window.speechSynthesis) {
        this.cachedVoices = window.speechSynthesis.getVoices();
        if (window.speechSynthesis.onvoiceschanged !== undefined) {
          window.speechSynthesis.onvoiceschanged = () => {
            this.cachedVoices = window.speechSynthesis.getVoices();
          };
        }
      }
    }
  }

  public static getInstance(): VoiceOutputController {
    if (!VoiceOutputController.instance) {
      VoiceOutputController.instance = new VoiceOutputController();
    }
    return VoiceOutputController.instance;
  }

  /**
   * Pre-unlock audio element for mobile devices (iOS / Android / Chrome autoplay restrictions)
   */
  public unlockAudio(): void {
    if (this.audioUnlocked) return;
    try {
      const silentAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
      silentAudio.volume = 0.01;
      silentAudio.play().then(() => {
        this.audioUnlocked = true;
        console.log('[VoiceOutputController] Audio context unlocked successfully.');
      }).catch(() => { });
    } catch {
      // Ignore initial silent unlock failure
    }
  }

  /**
   * Returns whether AI voice is currently playing
   */
  public isSpeaking(): boolean {
    if (this.isCurrentlySpeaking) return true;
    if (this.currentAudio && !this.currentAudio.paused && !this.currentAudio.ended) return true;
    if (this.currentUtterance !== null && typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.speaking) return true;
    return false;
  }

  public getCurrentText(): string {
    return this.currentSpokenText;
  }

  /**
   * Record an AI utterance in the history buffer for acoustic echo suppression
   */
  public recordUtterance(text: string): void {
    const clean = (text || '').trim();
    if (!clean) return;
    const now = Date.now();
    this.recentUtterances.push({ text: clean, timestamp: now });
    // Keep entries within last 20 seconds, max 20 items
    this.recentUtterances = this.recentUtterances.filter(u => (now - u.timestamp) < 20000).slice(-20);
  }

  public getRecentUtterances(): Array<{ text: string; timestamp: number }> {
    const now = Date.now();
    return this.recentUtterances.filter(u => (now - u.timestamp) < 20000);
  }

  /**
   * Highly robust acoustic echo detector:
   * Compares candidate transcribed speech against currently playing and recently spoken AI utterances.
   * Tolerates phonetic speech recognition mistranscriptions, dropped words, punctuation differences,
   * and trailing/preceding noise tokens.
   */
  public isAcousticEcho(candidateText: string, windowMs: number = 15000): boolean {
    const candidate = (candidateText || '').trim();
    if (!candidate || candidate.length < 2) return false;

    const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    const candNorm = norm(candidate);
    if (!candNorm) return false;

    const candWords = candNorm.split(/\s+/).filter(w => w.length >= 2);
    if (candWords.length === 0) return false;

    // If AI is not actively speaking, short conversational customer answers (<= 8 words and < 45 chars)
    // are genuine responses (e.g. "Yes speaking, tell me more about Kaira"), never acoustic feedback
    if (!this.isSpeaking() && candWords.length <= 8 && candNorm.length < 45) {
      return false;
    }

    // Collect all AI utterances to compare against:
    // 1. Currently active spoken text
    // 2. Recent utterances in the window
    // 3. Last spoken text
    const targets: string[] = [];
    if (this.currentSpokenText) targets.push(this.currentSpokenText);
    if (this.lastSpokenText && !targets.includes(this.lastSpokenText)) targets.push(this.lastSpokenText);

    const now = Date.now();
    for (const u of this.recentUtterances) {
      if ((now - u.timestamp) <= windowMs && !targets.includes(u.text)) {
        targets.push(u.text);
      }
    }

    if (targets.length === 0) return false;

    for (const target of targets) {
      const targetNorm = norm(target);
      if (!targetNorm) continue;

      // 1. Direct substring matching
      if (targetNorm.includes(candNorm) || (candNorm.length >= 10 && candNorm.includes(targetNorm))) {
        return true;
      }

      // 2. Continuous shingle substring match (16+ characters)
      if (candNorm.length >= 16) {
        for (let i = 0; i <= candNorm.length - 16; i += 5) {
          const slice = candNorm.substring(i, i + 16);
          if (targetNorm.includes(slice)) {
            return true;
          }
        }
      }

      const targetWords = new Set(targetNorm.split(/\s+/).filter(w => w.length >= 2));
      if (targetWords.size === 0) continue;

      // 3. 3-word n-gram (trigram) matching
      // If ANY 3-word phrase in candidate appears consecutively in target text
      if (candWords.length >= 3) {
        let trigramMatches = 0;
        for (let i = 0; i <= candWords.length - 3; i++) {
          const trigram = `${candWords[i]} ${candWords[i + 1]} ${candWords[i + 2]}`;
          if (targetNorm.includes(trigram)) {
            trigramMatches++;
          }
        }
        // If 2 or more trigrams match, or 1 trigram matches for short candidate (<= 6 words)
        if (trigramMatches >= 2 || (candWords.length <= 6 && trigramMatches >= 1)) {
          return true;
        }
      }

      // 4. Token overlap ratio (Jaccard-like)
      const matchingWords = candWords.filter(w => targetWords.has(w));
      const matchRatio = matchingWords.length / candWords.length;

      // When AI is actively playing: threshold is more sensitive (30% overlap or 2 words)
      if (this.isSpeaking()) {
        if (matchRatio >= 0.30 && matchingWords.length >= 2) {
          return true;
        }
      } else {
        // Cooldown period after AI speech: require at least 3 matching words and >= 40% ratio
        if (matchRatio >= 0.40 && matchingWords.length >= 3) {
          return true;
        }
      }
    }

    return false;
  }

  public getVolume(): number {
    return this.currentVolume;
  }

  public setVolume(volume: number): void {
    this.currentVolume = Math.max(0, Math.min(1, volume));
    if (this.currentAudio) {
      this.currentAudio.volume = this.currentVolume;
    }
  }

  /**
   * Dynamically switch speaker output device on currently playing audio element
   */
  public async switchSpeaker(deviceId?: string): Promise<void> {
    if (this.currentAudio) {
      await audioDeviceManager.applySpeakerToAudioElement(this.currentAudio, deviceId);
    }
  }

  /**
   * Immediately halts ALL voice outputs (Server audio & Web Speech API).
   * Increments playbackId so pending promises from aborted audio cannot fire.
   */
  public stop(): void {
    // Invalidate active playback so pending callbacks or catches are discarded
    this.currentPlaybackId++;
    this.isCurrentlySpeaking = false;
    this.currentSpokenText = '';

    // 1. Terminate server audio element
    if (this.currentAudio) {
      try {
        this.currentAudio.onplay = null;
        this.currentAudio.onended = null;
        this.currentAudio.onerror = null;
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
        this.currentAudio.src = '';
        this.currentAudio.removeAttribute('src');
      } catch (err) {
        console.debug('[VoiceOutput] Audio pause fallback:', err);
      }
      this.currentAudio = null;
    }

    // 2. Terminate Web Speech API Synthesis
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch (err) {
        console.debug('[VoiceOutput] Synth cancel fallback:', err);
      }
      this.currentUtterance = null;
    }
  }

  /**
   * Centralized Single Voice Playback Method
   *
   * Ensures:
   * - Only ONE audio output is active.
   * - Exactly ONE engine (Server TTS stream with graceful, guarded Web Speech fallback).
   * - Deduplication of identical responses within 3.5s window.
   * - Zero overlap or duplicate voice.
   */
  public play(text: string, options: PlaybackOptions = {}): Promise<void> {
    return new Promise((resolve) => {
      const cleanText = (text || '').trim();
      if (!cleanText) {
        options.onEnd?.();
        resolve();
        return;
      }

      const now = Date.now();

      // --- DEDUPLICATION SHIELD ---
      // 1. Check duplicate response ID
      if (options.responseId && options.responseId === this.lastResponseId) {
        console.warn(`[VoiceOutputController] Dropping duplicate responseId: ${options.responseId}`);
        options.onEnd?.();
        resolve();
        return;
      }

      // 2. Check duplicate response text within 3.5 seconds
      if (
        cleanText.toLowerCase() === this.lastSpokenText.toLowerCase() &&
        (now - this.lastSpokenTime) < 3500
      ) {
        console.warn(`[VoiceOutputController] Dropping duplicate speech text within ${now - this.lastSpokenTime}ms: "${cleanText.slice(0, 40)}..."`);
        options.onEnd?.();
        resolve();
        return;
      }

      // Record deduplication markers and echo suppression buffer
      this.lastSpokenText = cleanText;
      this.lastSpokenTime = now;
      this.recordUtterance(cleanText);
      if (options.responseId) {
        this.lastResponseId = options.responseId;
      }

      // Completely stop previous audio before beginning this new turn
      this.stop();

      const playbackId = ++this.currentPlaybackId;
      this.isCurrentlySpeaking = true;
      this.currentSpokenText = cleanText;

      const rawLang = (options.langCode || 'en').toLowerCase().slice(0, 2);
      const targetLang = rawLang;

      // Primary Engine: High-fidelity Server-generated Audio Stream (MP3)
      const audioUrl = `/api/voice/tts?text=${encodeURIComponent(cleanText)}&lang=${targetLang}`;
      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audio.src = audioUrl;
      this.currentAudio = audio;
      audio.volume = options.volume !== undefined ? options.volume : this.currentVolume;
      audioDeviceManager.applySpeakerToAudioElement(audio);

      // Connect AI TTS audio element into active call recording mixer
      webrtcManager.mixAudioElement(audio);

      let hasStarted = false;
      let hasResolved = false;
      let hasFallenBack = false;

      const finish = () => {
        if (this.currentPlaybackId !== playbackId) return;
        if (!hasResolved) {
          hasResolved = true;
          this.isCurrentlySpeaking = false;
          this.currentSpokenText = '';
          this.currentAudio = null;
          options.onEnd?.();
          resolve();
        }
      };

      const triggerFallback = (reason: string, err: any) => {
        if (this.currentPlaybackId !== playbackId) return;
        if (hasFallenBack || hasResolved) return;
        hasFallenBack = true;

        console.warn(`[VoiceOutputController] ${reason}, transitioning to single SpeechSynthesis fallback:`, err);
        try {
          const socket = getSocket();
          const callId = webrtcManager.getCallId();
          if (callId) {
            socket.emit('call:ai_fallback_triggered', {
              callId,
              serviceType: 'tts',
              fallbackProvider: 'Web Speech API (SpeechSynthesis)',
              reason: `Server audio stream unavailable (${reason})`
            });
          }
        } catch {}

        if (this.currentAudio) {
          try {
            this.currentAudio.pause();
            this.currentAudio.removeAttribute('src');
          } catch {}
          this.currentAudio = null;
        }
        this.speakWithSpeechSynthesis(cleanText, targetLang, playbackId, options).then(resolve);
      };

      audio.onplay = () => {
        if (this.currentPlaybackId !== playbackId) return;
        if (!hasStarted) {
          hasStarted = true;
          options.onStart?.();
        }
      };

      audio.onended = () => {
        finish();
      };

      audio.onerror = (err) => {
        triggerFallback('Server TTS error', err);
      };

      audio.play().catch((playErr) => {
        // If superseded or cancelled by stop(), DO NOT fall back!
        if (this.currentPlaybackId !== playbackId) return;

        // An AbortError occurs when audio was intentionally paused or replaced
        if (playErr && playErr.name === 'AbortError') {
          return;
        }

        triggerFallback('HTML5 Audio autoplay policy error', playErr);
      });
    });
  }

  /**
   * Fallback: Web Speech API SpeechSynthesis
   * Guaranteed to only run if server audio is NOT active.
   */
  private speakWithSpeechSynthesis(
    text: string,
    langCode: string,
    playbackId: number,
    options: PlaybackOptions
  ): Promise<void> {
    return new Promise((resolve) => {
      if (this.currentPlaybackId !== playbackId) {
        resolve();
        return;
      }

      if (typeof window === 'undefined' || !window.speechSynthesis) {
        this.isCurrentlySpeaking = false;
        this.currentSpokenText = '';
        options.onEnd?.();
        resolve();
        return;
      }

      // Ensure synth is cancelled before creating new utterance
      try {
        window.speechSynthesis.cancel();
      } catch { }

      const utterance = new SpeechSynthesisUtterance(text);
      this.currentUtterance = utterance;

      const bcp47Map: Record<string, string> = {
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

      const targetBcp47 = bcp47Map[langCode] || `${langCode}-${langCode.toUpperCase()}`;
      utterance.lang = targetBcp47;

      const availableVoices = this.cachedVoices.length > 0 ? this.cachedVoices : window.speechSynthesis.getVoices();
      const langPrefix = targetBcp47.split('-')[0];

      // Find natural, soft, and friendly voice for this language
      const matchingVoice =
        availableVoices.find(v => v.lang.toLowerCase() === targetBcp47.toLowerCase() && (v.name.includes('Natural') || v.name.includes('Neural') || v.name.includes('Google') || v.name.includes('Female') || v.name.includes('Jenny') || v.name.includes('Samantha') || v.name.includes('Aria'))) ||
        availableVoices.find(v => v.lang.toLowerCase() === targetBcp47.toLowerCase()) ||
        availableVoices.find(v => v.lang.toLowerCase().startsWith(langPrefix)) ||
        availableVoices.find(v => (v.name.includes('Google') || v.name.includes('Natural')) && v.lang.startsWith('en')) ||
        availableVoices.find(v => v.lang.startsWith('en'));

      if (matchingVoice) {
        utterance.voice = matchingVoice;
      }

      utterance.rate = 0.98;
      utterance.pitch = 1.04;
      utterance.volume = options.volume !== undefined ? options.volume : this.currentVolume;

      utterance.onstart = () => {
        if (this.currentPlaybackId !== playbackId) return;
        options.onStart?.();
      };

      utterance.onend = () => {
        if (this.currentPlaybackId !== playbackId) return;
        this.isCurrentlySpeaking = false;
        this.currentSpokenText = '';
        this.currentUtterance = null;
        options.onEnd?.();
        resolve();
      };

      utterance.onerror = (err) => {
        if (this.currentPlaybackId !== playbackId) return;
        this.isCurrentlySpeaking = false;
        this.currentSpokenText = '';
        this.currentUtterance = null;
        options.onError?.(err);
        options.onEnd?.();
        resolve();
      };

      window.speechSynthesis.speak(utterance);
    });
  }
}

export const voiceOutputController = VoiceOutputController.getInstance();
