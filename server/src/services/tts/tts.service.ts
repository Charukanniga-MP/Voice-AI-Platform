import { ITtsProvider, TtsProviderStatus } from './types.js';
import { ElevenLabsTtsProvider } from './elevenlabs.provider.js';
import { GoogleTranslateTtsProvider } from './google.provider.js';

/**
 * Unified Text-to-Speech (TTS) Service
 * Manages ElevenLabs as primary natural AI voice provider with automated fallback.
 * Implements in-memory LRU caching to minimize upstream API calls and latency.
 */
export class TtsService {
  private elevenLabsProvider: ElevenLabsTtsProvider;
  private fallbackProvider: GoogleTranslateTtsProvider;
  private ttsCache: Map<string, Buffer> = new Map();
  private readonly maxCacheEntries = 300;

  constructor() {
    this.elevenLabsProvider = new ElevenLabsTtsProvider();
    this.fallbackProvider = new GoogleTranslateTtsProvider();
  }

  public getActiveProvider(): ITtsProvider {
    if (this.elevenLabsProvider.isConfigured()) {
      return this.elevenLabsProvider;
    }
    return this.fallbackProvider;
  }

  public getStatus(): {
    activeProvider: string;
    isElevenLabsConfigured: boolean;
    elevenLabs: TtsProviderStatus;
    fallback: TtsProviderStatus;
    cachedAudioCount: number;
  } {
    const isConfigured = this.elevenLabsProvider.isConfigured();
    return {
      activeProvider: isConfigured ? 'elevenlabs' : 'fallback',
      isElevenLabsConfigured: isConfigured,
      elevenLabs: this.elevenLabsProvider.getStatus(),
      fallback: this.fallbackProvider.getStatus(),
      cachedAudioCount: this.ttsCache.size
    };
  }

  /**
   * Synthesize text to MP3 audio buffer
   * Tries ElevenLabs first; falls back gracefully to built-in speech synthesis on any error.
   */
  public async synthesize(text: string, lang = 'en'): Promise<{
    buffer: Buffer;
    provider: string;
    cached: boolean;
  }> {
    const cleanText = text.replace(/[\r\n]+/g, ' ').trim();
    if (!cleanText) {
      throw new Error('Text parameter is required for voice synthesis.');
    }

    const providerName = this.elevenLabsProvider.isConfigured() ? 'elevenlabs' : 'fallback';
    const cacheKey = `${providerName}:${lang}:${cleanText}`;

    // 1. Check in-memory cache (<1ms response time)
    if (this.ttsCache.has(cacheKey)) {
      return {
        buffer: this.ttsCache.get(cacheKey)!,
        provider: providerName,
        cached: true
      };
    }

    let audioBuffer: Buffer | null = null;
    let usedProvider = 'fallback';

    // 2. Try ElevenLabs if configured
    if (this.elevenLabsProvider.isConfigured()) {
      try {
        audioBuffer = await this.elevenLabsProvider.synthesize(cleanText, lang);
        usedProvider = 'elevenlabs';
      } catch (err: any) {
        console.warn(`[TtsService] ElevenLabs synthesis failed (${err.message}). Falling back to secondary TTS.`);
        audioBuffer = null;
      }
    }

    // 3. Fallback to Google Translate TTS if ElevenLabs unconfigured or failed
    if (!audioBuffer) {
      try {
        audioBuffer = await this.fallbackProvider.synthesize(cleanText, lang);
        usedProvider = 'google_tts';
      } catch (fallbackErr: any) {
        console.error('[TtsService] Secondary TTS fallback failed:', fallbackErr.message);
        throw fallbackErr;
      }
    }

    // 4. Update LRU Cache
    if (this.ttsCache.size >= this.maxCacheEntries) {
      const firstKey = this.ttsCache.keys().next().value;
      if (firstKey) this.ttsCache.delete(firstKey);
    }
    this.ttsCache.set(cacheKey, audioBuffer);

    return {
      buffer: audioBuffer,
      provider: usedProvider,
      cached: false
    };
  }

  /**
   * Clear in-memory TTS cache
   */
  public clearCache(): void {
    this.ttsCache.clear();
  }
}

export const ttsService = new TtsService();
