import { ITtsProvider, TtsProviderStatus } from './types.js';

/**
 * ElevenLabs High-Fidelity Multilingual Text-to-Speech Provider
 * Uses ElevenLabs Multilingual v2 model for natural, human-like voice responses.
 */
export class ElevenLabsTtsProvider implements ITtsProvider {
  public readonly name = 'elevenlabs';
  public readonly displayName = 'ElevenLabs AI Voice (Multilingual v2)';

  // Default to Sarah (prematured, reassuring, confident customer support persona - valid on free premade tier)
  private readonly defaultVoiceId = 'EXAVITQu4vr4xnSDxMaL';
  private readonly defaultModelId = 'eleven_multilingual_v2';

  // Supported languages in ElevenLabs Multilingual v2
  private readonly supportedLangs = [
    'en', 'hi', 'ta', 'te', 'ml', 'kn', 'bn', 'mr',
    'es', 'fr', 'de', 'it', 'pt', 'pl', 'tr', 'nl',
    'sv', 'id', 'vi', 'ja', 'ko', 'zh', 'ar', 'ru'
  ];

  private get apiKey(): string {
    return process.env.ELEVENLABS_API_KEY?.trim() || '';
  }

  private get voiceId(): string {
    return process.env.ELEVENLABS_VOICE_ID?.trim() || this.defaultVoiceId;
  }

  private get modelId(): string {
    return process.env.ELEVENLABS_MODEL_ID?.trim() || this.defaultModelId;
  }

  public getProviderName(): string {
    return this.name;
  }

  public getDisplayName(): string {
    return this.displayName;
  }

  public isConfigured(): boolean {
    return !!(this.apiKey && this.apiKey.startsWith('sk_'));
  }

  public getStatus(): TtsProviderStatus {
    const configured = this.isConfigured();
    return {
      provider: this.name,
      displayName: this.displayName,
      configured,
      model: this.modelId,
      voiceId: this.voiceId,
      supportedLanguages: this.supportedLangs,
      message: configured
        ? 'ElevenLabs Multilingual v2 voice synthesis is active and configured.'
        : 'ElevenLabs API key is missing or invalid in server/.env.'
    };
  }

  /**
   * Synthesize text into high-fidelity MP3 audio buffer using ElevenLabs API
   */
  public async synthesize(text: string, lang = 'en'): Promise<Buffer> {
    if (!this.isConfigured()) {
      throw new Error('ElevenLabs API key not configured.');
    }

    const cleanText = text.replace(/[\r\n]+/g, ' ').trim();
    if (!cleanText) {
      throw new Error('Empty text cannot be synthesized.');
    }

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(this.voiceId)}?output_format=mp3_44100_128`;

    const requestBody = {
      text: cleanText,
      model_id: this.modelId,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.8,
        style: 0.0,
        use_speaker_boost: true
      }
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000); // 12-second timeout

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': this.apiKey
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      if (!response.ok) {
        let errorDetails = `HTTP ${response.status}`;
        try {
          const errJson = await response.json();
          errorDetails = errJson.detail?.message || errJson.message || JSON.stringify(errJson);
        } catch {
          errorDetails = await response.text();
        }

        if (response.status === 401) {
          throw new Error(`ElevenLabs Authentication Failed: Invalid API key (${errorDetails})`);
        } else if (response.status === 429) {
          throw new Error(`ElevenLabs Rate Limit Exceeded: ${errorDetails}`);
        } else if (response.status === 402 || errorDetails.toLowerCase().includes('quota')) {
          throw new Error(`ElevenLabs Quota / Credit Limit Exceeded: ${errorDetails}`);
        }

        throw new Error(`ElevenLabs TTS synthesis failed: ${errorDetails}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } finally {
      clearTimeout(timeout);
    }
  }
}
