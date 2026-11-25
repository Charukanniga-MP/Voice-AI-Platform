import { ITtsProvider, TtsProviderStatus } from './types.js';

/**
 * Google Translate / Standard Web Speech TTS Provider (Fallback)
 * Fast, reliable fallback for situations where commercial cloud TTS is unavailable.
 */
export class GoogleTranslateTtsProvider implements ITtsProvider {
  public readonly name = 'google_tts';
  public readonly displayName = 'KAIRA Built-in Speech Synthesis (Fallback)';

  private splitIntoChunks(text: string, maxChunkLength = 160): string[] {
    const clean = text.replace(/[\r\n]+/g, ' ').trim();
    if (clean.length <= maxChunkLength) return [clean];

    const sentenceRegex = /[^.!?।;]+[.!?।;]+|[^.!?।;]+$/g;
    const rawSentences = clean.match(sentenceRegex) || [clean];

    const chunks: string[] = [];
    let current = '';

    for (const sentence of rawSentences) {
      const s = sentence.trim();
      if (!s) continue;

      if ((current + ' ' + s).trim().length <= maxChunkLength) {
        current = (current + ' ' + s).trim();
      } else {
        if (current) chunks.push(current);
        if (s.length <= maxChunkLength) {
          current = s;
        } else {
          const words = s.split(' ');
          let sub = '';
          for (const w of words) {
            if ((sub + ' ' + w).trim().length <= maxChunkLength) {
              sub = (sub + ' ' + w).trim();
            } else {
              if (sub) chunks.push(sub);
              sub = w;
            }
          }
          if (sub) current = sub;
          else current = '';
        }
      }
    }

    if (current) chunks.push(current);
    return chunks.length > 0 ? chunks : [clean.slice(0, maxChunkLength)];
  }

  public getProviderName(): string {
    return this.name;
  }

  public getDisplayName(): string {
    return this.displayName;
  }

  public isConfigured(): boolean {
    return true; // Always available as built-in fallback
  }

  public getStatus(): TtsProviderStatus {
    return {
      provider: this.name,
      displayName: this.displayName,
      configured: true,
      model: 'standard_fallback',
      supportedLanguages: ['en', 'ta', 'te', 'ml', 'hi', 'kn', 'bn', 'mr', 'es', 'fr', 'de', 'ja', 'zh'],
      message: 'Standard fallback TTS is active.'
    };
  }

  public async synthesize(text: string, lang = 'en'): Promise<Buffer> {
    const chunks = this.splitIntoChunks(text);
    const buffers: Buffer[] = [];

    for (const chunk of chunks) {
      let audioRes: any = null;
      try {
        const url = `https://clients5.google.com/translate_tts?ie=UTF-8&tl=${lang}&client=gtx&q=${encodeURIComponent(chunk)}`;
        audioRes = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
      } catch { }

      if (!audioRes || !audioRes.ok) {
        try {
          const fallbackUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${lang}&client=tw-ob&q=${encodeURIComponent(chunk)}`;
          audioRes = await fetch(fallbackUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          });
        } catch { }
      }

      if (!audioRes || !audioRes.ok) {
        throw new Error(`Fallback TTS upstream error: HTTP ${audioRes?.status || 'network error'}`);
      }

      const arrBuf = await audioRes.arrayBuffer();
      buffers.push(Buffer.from(arrBuf));
    }

    return Buffer.concat(buffers);
  }
}
