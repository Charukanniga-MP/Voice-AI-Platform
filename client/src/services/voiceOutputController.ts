/**
 * Centralized Single Voice Output Controller
 *
 * Guarantees:
 * 1. ONLY ONE active voice output across the entire application at any given time.
 * 2. Zero double voice / duplicate audio:
 *    - Never plays browser-generated speech and server-generated speech simultaneously.
 *    - Automatically cancels previous audio before starting new audio.
 *    - Deduplicates identical responses within a 3.5s window.
 * 3. Graceful handling of browser autoplay policies and interruption (barge-in).
 * 4. Full multilingual speech support.
 */

import { audioDeviceManager } from './audioDevice.js';

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

  private constructor() {
    if (typeof window !== 'undefined') {
      const unlock = () => {
        this.unlockAudio();
        window.removeEventListener('click', unlock);
        window.removeEventListener('touchstart', unlock);
      };
      window.addEventListener('click', unlock, { once: true });
      window.addEventListener('touchstart', unlock, { once: true });
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
      }).catch(() => {});
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
    if (typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.speaking) return true;
    return false;
  }

  public getCurrentText(): string {
    return this.currentSpokenText;
  }

  public setVolume(volume: number): void {
    this.currentVolume = Math.max(0, Math.min(1, volume));
    if (this.currentAudio) {
      this.currentAudio.volume = this.currentVolume;
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
      } catch (e) {
        // Safe catch on audio pause
      }
      this.currentAudio = null;
    }

    // 2. Terminate Web Speech API Synthesis
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {
        // Safe catch on synth cancel
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

      // Record deduplication markers
      this.lastSpokenText = cleanText;
      this.lastSpokenTime = now;
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
      const audio = new Audio(audioUrl);
      this.currentAudio = audio;
      audio.volume = options.volume !== undefined ? options.volume : this.currentVolume;
      audioDeviceManager.applySpeakerToAudioElement(audio);

      let hasStarted = false;
      let hasResolved = false;

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
        // If this playback was superseded or stopped, ignore completely
        if (this.currentPlaybackId !== playbackId) return;
        console.warn('[VoiceOutputController] Server TTS error, transitioning to single SpeechSynthesis fallback:', err);
        this.currentAudio = null;
        this.speakWithSpeechSynthesis(cleanText, targetLang, playbackId, options).then(resolve);
      };

      audio.play().catch((playErr) => {
        // If superseded or cancelled by stop(), DO NOT fall back!
        if (this.currentPlaybackId !== playbackId) return;

        // An AbortError occurs when audio was intentionally paused or replaced
        if (playErr && playErr.name === 'AbortError') {
          return;
        }

        console.warn('[VoiceOutputController] HTML5 Audio autoplay policy error, transitioning to single SpeechSynthesis fallback:', playErr);
        this.currentAudio = null;
        this.speakWithSpeechSynthesis(cleanText, targetLang, playbackId, options).then(resolve);
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
      } catch {}

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

      const voices = window.speechSynthesis.getVoices();
      const langPrefix = targetBcp47.split('-')[0];

      // Find natural, soft, and friendly voice for this language
      const matchingVoice =
        voices.find(v => v.lang.toLowerCase() === targetBcp47.toLowerCase() && (v.name.includes('Natural') || v.name.includes('Neural') || v.name.includes('Google') || v.name.includes('Female') || v.name.includes('Jenny') || v.name.includes('Samantha') || v.name.includes('Aria'))) ||
        voices.find(v => v.lang.toLowerCase() === targetBcp47.toLowerCase()) ||
        voices.find(v => v.lang.toLowerCase().startsWith(langPrefix)) ||
        voices.find(v => (v.name.includes('Google') || v.name.includes('Natural')) && v.lang.startsWith('en')) ||
        voices.find(v => v.lang.startsWith('en'));

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
