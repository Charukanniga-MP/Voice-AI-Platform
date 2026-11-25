import { DeepgramSttProvider } from './deepgram.provider.js';
import { ISttProvider, ISttStream, SttConfig, SttTranscriptEvent } from './types.js';

export interface AudioQualityMetrics {
  rms: number;
  peak: number;
  isClipping: boolean;
  isTooQuiet: boolean;
  sampleRate: number;
  channels: number;
}

export type MockSttStreamHandler = (chunk: Buffer, config: SttConfig) => Promise<SttTranscriptEvent | null>;

export class SttService {
  private providers: Map<string, ISttProvider> = new Map();
  private primaryProviderName: string = 'deepgram';
  private activeStreams: Map<string, ISttStream> = new Map();
  private mockHandler: MockSttStreamHandler | null = null;

  constructor() {
    this.registerProvider(new DeepgramSttProvider());
  }

  public registerProvider(provider: ISttProvider): void {
    this.providers.set(provider.getProviderName(), provider);
  }

  public getActiveProviderName(): string {
    if (this.mockHandler) return 'mock_stt';
    const primary = this.providers.get(this.primaryProviderName);
    if (primary && primary.isConfigured()) {
      return primary.getProviderName();
    }
    for (const [name, provider] of this.providers.entries()) {
      if (provider.isConfigured()) return name;
    }
    return 'browser_web_speech'; // Default fallback
  }

  public isCloudSttConfigured(): boolean {
    return this.getActiveProviderName() !== 'browser_web_speech';
  }

  public setMockHandler(handler: MockSttStreamHandler | null): void {
    this.mockHandler = handler;
  }

  /**
   * Analyze 16-bit mono Linear PCM audio buffer for quality diagnostics
   */
  public analyzeAudioBuffer(pcmData: Buffer | ArrayBuffer | Int16Array, sampleRate: number = 16000): AudioQualityMetrics {
    if (!pcmData) {
      return { rms: 0, peak: 0, isClipping: false, isTooQuiet: true, sampleRate, channels: 1 };
    }

    const pcmBuffer = Buffer.isBuffer(pcmData)
      ? pcmData
      : Buffer.from(pcmData instanceof Int16Array ? pcmData.buffer : pcmData);

    if (pcmBuffer.length < 2) {
      return { rms: 0, peak: 0, isClipping: false, isTooQuiet: true, sampleRate, channels: 1 };
    }

    const sampleCount = Math.floor(pcmBuffer.length / 2);
    let sumSquares = 0;
    let peak = 0;

    for (let i = 0; i < sampleCount; i++) {
      const sample = pcmBuffer.readInt16LE(i * 2) / 32768.0;
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
      sumSquares += sample * sample;
    }

    const rms = Math.sqrt(sumSquares / Math.max(1, sampleCount));
    const isClipping = peak >= 0.98;
    const isTooQuiet = rms < 0.012 && peak < 0.05; // Extremely low energy

    return {
      rms: Math.round(rms * 1000) / 1000,
      peak: Math.round(peak * 1000) / 1000,
      isClipping,
      isTooQuiet,
      sampleRate,
      channels: 1
    };
  }

  /**
   * Start a streaming speech-to-text session for an active call
   */
  public async startStream(
    callId: string,
    config: SttConfig,
    onTranscript: (event: SttTranscriptEvent) => void,
    onError?: (err: any) => void
  ): Promise<ISttStream | null> {
    this.stopStream(callId);

    // Mock handler for testing
    if (this.mockHandler) {
      const transcriptCallbacks: Array<(e: SttTranscriptEvent) => void> = [onTranscript];
      const errorCallbacks: Array<(e: any) => void> = onError ? [onError] : [];
      const stream: ISttStream = {
        write: async (chunk: Buffer) => {
          if (this.mockHandler) {
            try {
              const res = await this.mockHandler(chunk, config);
              if (res) {
                for (const cb of transcriptCallbacks) cb(res);
              }
            } catch (err) {
              for (const cb of errorCallbacks) cb(err);
            }
          }
        },
        finish: () => {},
        onTranscript: (cb) => transcriptCallbacks.push(cb),
        onError: (cb) => errorCallbacks.push(cb),
        onClose: () => {}
      };
      this.activeStreams.set(callId, stream);
      return stream;
    }

    const providerName = this.getActiveProviderName();
    const provider = this.providers.get(providerName);

    if (!provider || !provider.isConfigured()) {
      return null;
    }

    try {
      const stream = await provider.createStream(config);
      stream.onTranscript(onTranscript);
      if (onError) stream.onError(onError);
      stream.onClose(() => {
        this.activeStreams.delete(callId);
      });

      this.activeStreams.set(callId, stream);
      return stream;
    } catch (err) {
      console.error(`[SttService] Failed to create stream with provider ${providerName}:`, err);
      onError?.(err);
      return null;
    }
  }

  public writeAudioChunk(callId: string, chunk: Buffer): AudioQualityMetrics {
    const stream = this.activeStreams.get(callId);
    if (stream) {
      stream.write(chunk);
    }
    return this.analyzeAudioBuffer(chunk);
  }

  public stopStream(callId: string): void {
    const stream = this.activeStreams.get(callId);
    if (stream) {
      try {
        stream.finish();
      } catch { }
      this.activeStreams.delete(callId);
    }
  }
}

export const sttService = new SttService();
