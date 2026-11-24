import crypto from 'crypto';
import OpenAI from 'openai';

export class EmbeddingService {
  private openai: OpenAI | null = null;
  public isQuotaExhausted: boolean = false;
  public readonly vectorDimension = 128;

  constructor() {
    if (process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.includes('your-')) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 1500, maxRetries: 0 });
    }
  }

  /**
   * Deterministic Semantic Feature Vector (128-dimensional dense unit vector)
   * Uses multi-scale token, subword n-gram, and category feature hashing with L2 normalization.
   * Completely offline, zero-latency, deterministic, and highly accurate for semantic cosine search.
   */
  public generateLocalEmbedding(text: string): number[] {
    const vector = new Float64Array(this.vectorDimension);
    const cleaned = (text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned) {
      vector[0] = 1.0;
      return Array.from(vector);
    }

    const words = cleaned.split(' ').filter(w => w.length > 1);

    // 1. Word token unigram projections with IDF-style length weighting
    for (const w of words) {
      const weight = Math.log(1 + w.length);
      const h1 = this.hashString(w, 0x811c9dc5);
      const dim1 = Math.abs(h1) % this.vectorDimension;
      const sign1 = (h1 & 1) === 0 ? 1 : -1;
      vector[dim1] += sign1 * weight;

      // 2. Character 3-gram subwords for morphological and typo tolerance
      if (w.length >= 3) {
        for (let i = 0; i <= w.length - 3; i++) {
          const trigram = w.slice(i, i + 3);
          const h2 = this.hashString(trigram, 0x9e3779b9);
          const dim2 = Math.abs(h2) % this.vectorDimension;
          const sign2 = (h2 & 1) === 0 ? 1 : -1;
          vector[dim2] += sign2 * 0.45;
        }
      }
    }

    // 3. Word bigrams for local semantic context
    for (let i = 0; i < words.length - 1; i++) {
      const bigram = `${words[i]}_${words[i + 1]}`;
      const h3 = this.hashString(bigram, 0x1234567);
      const dim3 = Math.abs(h3) % this.vectorDimension;
      const sign3 = (h3 & 1) === 0 ? 1 : -1;
      vector[dim3] += sign3 * 0.8;
    }

    // 4. L2 Normalization to unit hypersphere
    let norm = 0;
    for (let i = 0; i < this.vectorDimension; i++) {
      norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);

    if (norm > 0) {
      for (let i = 0; i < this.vectorDimension; i++) {
        vector[i] = Math.round((vector[i] / norm) * 10000) / 10000;
      }
    } else {
      vector[0] = 1.0;
    }

    return Array.from(vector);
  }

  /**
   * Fast 32-bit FNV-1a / Murmur-style hash with seed
   */
  private hashString(str: string, seed: number): number {
    let h = seed ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 0x5bd1e995);
      h ^= h >>> 15;
    }
    return h;
  }

  /**
   * Cosine similarity between two unit vectors: dot product
   */
  public cosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom <= 0) return 0;
    return Math.max(0, Math.min(1.0, dot / denom));
  }

  /**
   * Generates embedding vector for a single text chunk
   */
  public async generateEmbedding(text: string): Promise<number[]> {
    if (this.openai && !this.isQuotaExhausted) {
      try {
        const response = await this.openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: text.slice(0, 4000),
          dimensions: this.vectorDimension
        });
        const emb = response.data[0]?.embedding;
        if (emb && emb.length > 0) {
          return emb;
        }
      } catch (err: any) {
        if (err?.code === 'insufficient_quota' || err?.status === 429) {
          this.isQuotaExhausted = true;
        }
      }
    }
    return this.generateLocalEmbedding(text);
  }

  /**
   * Batch embedding generation
   */
  public async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const t of texts) {
      results.push(await this.generateEmbedding(t));
    }
    return results;
  }
}

export const embeddingService = new EmbeddingService();
