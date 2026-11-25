/**
 * Real-Time Streaming Speech-to-Text (STT) Provider Abstraction
 * Supports Deepgram Nova-2/Nova-3, Google Cloud STT, and Azure Speech
 */

export interface SttConfig {
  language: string; // e.g. 'en-IN', 'ta-IN', 'hi-IN', 'te-IN', 'ml-IN'
  sampleRate?: number; // default 16000
  channels?: number; // default 1 (mono)
  encoding?: 'linear16' | 'opus' | 'webm';
  interimResults?: boolean;
  punctuate?: boolean;
  model?: string;
  smartFormat?: boolean;
  endpointingMs?: number;
}

export interface SttTranscriptWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
}

export interface SttTranscriptEvent {
  text: string;
  isFinal: boolean;
  isSpeechFinal?: boolean;
  confidence: number;
  language?: string;
  words?: SttTranscriptWord[];
  latencyMs?: number;
  speechDurationMs?: number;
}

export interface ISttStream {
  write(audioChunk: Buffer): void;
  finish(): void;
  onTranscript(cb: (event: SttTranscriptEvent) => void): void;
  onError(cb: (err: any) => void): void;
  onClose(cb: () => void): void;
}

export interface ISttProvider {
  getProviderName(): string;
  isConfigured(): boolean;
  getSupportedLanguages(): string[];
  createStream(config: SttConfig): Promise<ISttStream>;
}
