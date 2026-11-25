import WebSocket from 'ws';
import { ISttProvider, ISttStream, SttConfig, SttTranscriptEvent } from './types.js';

export class DeepgramSttProvider implements ISttProvider {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.DEEPGRAM_API_KEY?.trim() || '';
  }

  public getApiKey(): string {
    return (this.apiKey || process.env.DEEPGRAM_API_KEY || '').trim();
  }

  public getProviderName(): string {
    return 'deepgram';
  }

  public isConfigured(): boolean {
    const key = this.getApiKey();
    return Boolean(key && key.length > 10 && !key.includes('your-'));
  }

  public getSupportedLanguages(): string[] {
    return ['en-IN', 'en-US', 'hi', 'ta', 'te', 'ml', 'kn', 'bn', 'mr', 'gu', 'ar', 'fr', 'de', 'es', 'zh', 'ja', 'ko', 'ru'];
  }

  private normalizeLanguage(lang: string): string {
    const clean = (lang || 'en').toLowerCase().trim();
    if (clean === 'en' || clean.startsWith('en')) return 'en-IN'; // Default to Indian English
    if (clean === 'hi' || clean.startsWith('hi')) return 'hi';
    if (clean === 'ta' || clean.startsWith('ta')) return 'ta';
    if (clean === 'te' || clean.startsWith('te')) return 'te';
    if (clean === 'ml' || clean.startsWith('ml')) return 'ml';
    if (clean === 'kn' || clean.startsWith('kn')) return 'kn';
    if (clean === 'bn' || clean.startsWith('bn')) return 'bn';
    if (clean === 'mr' || clean.startsWith('mr')) return 'mr';
    if (clean === 'ar' || clean.startsWith('ar')) return 'ar';
    return clean.slice(0, 2);
  }

  public async createStream(config: SttConfig): Promise<ISttStream> {
    if (!this.isConfigured()) {
      throw new Error('Deepgram API key is not configured in server environment.');
    }

    const language = this.normalizeLanguage(config.language);
    const sampleRate = config.sampleRate || 16000;
    const encoding = config.encoding || 'linear16';
    const isNova2Language = ['en', 'en-in', 'en-us', 'hi', 'fr', 'de', 'es', 'pt', 'ru', 'ja', 'ko', 'zh', 'it', 'nl'].includes(language.toLowerCase());
    const defaultModel = isNova2Language ? 'nova-2' : 'general';
    const model = config.model || defaultModel;

    const params = new URLSearchParams({
      model,
      language,
      encoding,
      sample_rate: sampleRate.toString(),
      channels: '1',
      smart_format: 'true',
      punctuate: 'true',
      interim_results: config.interimResults !== false ? 'true' : 'false',
      endpointing: (config.endpointingMs || 300).toString()
    });

    const apiKey = this.getApiKey();
    const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Token ${apiKey}`
      }
    });

    const transcriptCallbacks: Array<(event: SttTranscriptEvent) => void> = [];
    const errorCallbacks: Array<(err: any) => void> = [];
    const closeCallbacks: Array<() => void> = [];

    const startTime = Date.now();

    ws.on('open', () => {
      console.log(`[DeepgramSTT] Connected to streaming WebSocket (Language: ${language}, Model: ${model})`);
    });

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.type === 'Results' && parsed.channel?.alternatives?.[0]) {
          const alt = parsed.channel.alternatives[0];
          const transcript = (alt.transcript || '').trim();
          if (!transcript) return;

          const isFinal = Boolean(parsed.is_final);
          const isSpeechFinal = Boolean(parsed.speech_final);
          const confidence = typeof alt.confidence === 'number' ? alt.confidence : (isFinal ? 0.95 : 0.8);
          const words = alt.words?.map((w: any) => ({
            word: w.word,
            start: w.start,
            end: w.end,
            confidence: w.confidence
          }));

          const event: SttTranscriptEvent = {
            text: transcript,
            isFinal,
            isSpeechFinal,
            confidence,
            language,
            words,
            latencyMs: Date.now() - startTime
          };

          for (const cb of transcriptCallbacks) {
            cb(event);
          }
        }
      } catch (err) {
        console.warn('[DeepgramSTT] Parse message error:', err);
      }
    });

    ws.on('error', (err) => {
      console.error('[DeepgramSTT] WebSocket error:', err.message);
      for (const cb of errorCallbacks) {
        cb(err);
      }
    });

    ws.on('close', () => {
      console.log('[DeepgramSTT] WebSocket closed.');
      for (const cb of closeCallbacks) {
        cb();
      }
    });

    return {
      write(audioChunk: Buffer) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(audioChunk);
        }
      },
      finish() {
        if (ws.readyState === WebSocket.OPEN) {
          // Send Deepgram close stream message
          ws.send(JSON.stringify({ type: 'CloseStream' }));
          setTimeout(() => {
            try { ws.close(); } catch { }
          }, 500);
        }
      },
      onTranscript(cb) {
        transcriptCallbacks.push(cb);
      },
      onError(cb) {
        errorCallbacks.push(cb);
      },
      onClose(cb) {
        closeCallbacks.push(cb);
      }
    };
  }
}
