/**
 * Text-to-Speech (TTS) Provider Interface & Types
 */

export interface TtsProviderStatus {
  provider: string;
  displayName: string;
  configured: boolean;
  model?: string;
  voiceId?: string;
  supportedLanguages: string[];
  message: string;
}

export interface ITtsProvider {
  getProviderName(): string;
  getDisplayName(): string;
  isConfigured(): boolean;
  synthesize(text: string, lang?: string): Promise<Buffer>;
  getStatus(): TtsProviderStatus;
}

export interface TtsSynthesisOptions {
  voiceId?: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
}
