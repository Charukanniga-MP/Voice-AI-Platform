import { prisma } from '../db.js';
import OpenAI from 'openai';

interface SearchResult {
  entry: any;
  score: number;
}

export interface GroundedResponse {
  answer: string;
  isGrounded: boolean;
  requiresTransfer: boolean;
  sources: Array<{ id: string; title: string; category: string }>;
  confidence: number;
  language?: string;
  latencyMs?: number;
}

// Fallback message strictly required by specification
export const FALLBACK_MESSAGE = "I'm sorry, I couldn't find the information you're looking for. Please hold while I connect you with our Admin.";

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'can', 'could', 'will', 'would',
  'shall', 'should', 'may', 'might', 'must', 'and', 'but', 'if', 'or',
  'because', 'as', 'until', 'while', 'of', 'at', 'by', 'for', 'with',
  'about', 'between', 'into', 'through', 'during', 'before', 'after',
  'to', 'from', 'in', 'out', 'on', 'off', 'over', 'under', 'again',
  'further', 'then', 'once', 'here', 'there', 'all', 'any', 'both', 'each',
  'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
  'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'just',
  'don', 'now', 'you', 'your', 'me', 'my', 'i', 'we', 'our', 'tell', 'give',
  'know', 'please', 'like', 'want'
]);

const STEM = (w: string) => w.toLowerCase().replace(/(ies|es|s|ing|ed)$/, '');

function normalizeToken(token: string): string {
  let t = token.toLowerCase().trim();
  if (t.endsWith('ing') && t.length > 5) t = t.slice(0, -3);
  else if (t.endsWith('ies') && t.length > 4) t = t.slice(0, -3) + 'y';
  else if (t.endsWith('es') && t.length > 4) t = t.slice(0, -2);
  else if (t.endsWith('s') && t.length > 3) t = t.slice(0, -1);
  return t;
}

const SYNONYMS: Record<string, string[]> = {
  service: ['product', 'capabilit', 'offer', 'solution'],
  services: ['product', 'capabilit', 'offer', 'solution'],
  product: ['service', 'capabilit', 'offer', 'solution'],
  products: ['service', 'capabilit', 'offer', 'solution'],
  cost: ['price', 'pricing', 'plan', 'rate', 'fee'],
  price: ['cost', 'pricing', 'plan', 'rate', 'fee'],
  pricing: ['cost', 'price', 'plan', 'rate', 'fee'],
  hour: ['schedule', 'time', 'availability', 'support'],
  hours: ['schedule', 'time', 'availability', 'support'],
  support: ['help', 'assist', 'contact', 'availability'],
  help: ['support', 'assist', 'contact'],
  security: ['safety', 'privacy', 'complianc'],
  cancel: ['refund', 'cancellation'],
  refund: ['cancel', 'cancellation']
};

class KnowledgeService {
  private openai: OpenAI | null = null;
  public isQuotaExhausted: boolean = false;

  constructor() {
    if (process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.includes('your-')) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 800, maxRetries: 0 });
    }
  }

  // Pre-warm AI provider and detect quota exhaustion at boot
  public async warmup(): Promise<void> {
    if (this.openai && !this.isQuotaExhausted) {
      try {
        await this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 5
        });
      } catch (err: any) {
        if (err?.code === 'insufficient_quota' || err?.status === 429 || err?.message?.includes('quota') || err?.message?.includes('credit')) {
          this.isQuotaExhausted = true;
          console.warn('[KnowledgeService] OpenAI quota exhausted. Switched to zero-latency built-in NLP engine.');
        }
      }
    }
  }

  // Tokenize and clean text for lexical relevance (Full Unicode support for all languages)
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .map(w => normalizeToken(w))
      .filter(w => w.length > 1);
  }

  // Significant tokens excluding common grammatical stopwords
  private getSignificantTokens(tokens: string[]): string[] {
    const filtered = tokens.filter(t => !STOP_WORDS.has(t) && t.length > 1);
    return filtered.length > 0 ? filtered : tokens;
  }

  // Helper to match token or its stem or domain synonyms
  private matchToken(t: string, targets: string[]): boolean {
    if (targets.includes(t)) return true;
    const stemmedT = STEM(t);
    if (targets.some(target => STEM(target) === stemmedT)) return true;
    const syns = SYNONYMS[t] || SYNONYMS[stemmedT] || [];
    return targets.some(target => {
      const s = STEM(target);
      return syns.some(syn => s === syn || target.includes(syn));
    });
  }

  // Calculate similarity between customer query and a KB entry
  private calculateScore(query: string, entry: any): number {
    const rawQueryTokens = this.tokenize(query);
    const queryTokens = this.getSignificantTokens(rawQueryTokens);
    if (queryTokens.length === 0) return 0;

    const titleTokens = this.tokenize(entry.title || '');
    const questionTokens = this.tokenize(entry.question || '');
    const contentTokens = this.tokenize(entry.content || '');
    const keywordsTokens = this.tokenize(entry.keywords || '');
    const categoryTokens = this.tokenize(entry.category || '');

    let score = 0;

    // Weightings
    for (const token of queryTokens) {
      if (this.matchToken(token, titleTokens)) score += 0.35;
      if (this.matchToken(token, questionTokens)) score += 0.35;
      if (this.matchToken(token, keywordsTokens)) score += 0.25;
      if (this.matchToken(token, contentTokens)) score += 0.15;
      if (this.matchToken(token, categoryTokens)) score += 0.10;
    }

    // Normalization based on query token count
    const normalizedScore = score / queryTokens.length;

    // Exact phrase match bonus
    const lowerQuery = query.toLowerCase().trim();
    if (entry.question && entry.question.toLowerCase().includes(lowerQuery)) {
      return Math.min(1.0, normalizedScore + 0.3);
    }
    if (entry.title && entry.title.toLowerCase().includes(lowerQuery)) {
      return Math.min(1.0, normalizedScore + 0.25);
    }

    return Math.min(1.0, normalizedScore);
  }

  // Search Knowledge Base entries
  public async search(query: string, limit = 3): Promise<SearchResult[]> {
    const entries = await prisma.knowledgeEntry.findMany({
      include: { document: true }
    });

    const scored: SearchResult[] = entries.map(entry => ({
      entry,
      score: this.calculateScore(query, entry)
    }));

    // Filter by threshold
    const sorted = scored
      .filter(item => item.score > 0.18)
      .sort((a, b) => b.score - a.score);

    return sorted.slice(0, limit);
  }

  // Answer customer query with fast voice-optimized response
  public async answerQuery(
    query: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = []
  ): Promise<GroundedResponse> {
    const t0 = Date.now();
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return {
        answer: "I am listening. How can I help you today?",
        isGrounded: true,
        requiresTransfer: false,
        sources: [],
        confidence: 1.0,
        latencyMs: Date.now() - t0
      };
    }

    const cleanInput = trimmedQuery.toLowerCase().replace(/['".,!?;:]/g, '').trim();

    // 1. Explicit request to speak with a human / Admin
    if (
      /\b(speak\s+to|talk\s+to|connect(\s+me)?(\s+to)?|transfer(\s+me)?(\s+to)?|put\s+me\s+through\s+to|let\s+me\s+speak\s+to|want|need)\s+(an?\s+)?(admin|agent|human|person|representative|support|specialist)\b/i.test(cleanInput) ||
      /\b(human agent|live agent|human representative|transfer me|live person|talk to someone)\b/i.test(cleanInput)
    ) {
      return {
        answer: "Certainly. I am connecting you with our human support representative right now. Please hold for just a moment.",
        isGrounded: false,
        requiresTransfer: true,
        sources: [],
        confidence: 1.0,
        latencyMs: Date.now() - t0
      };
    }

    // 2. Greetings
    if (
      /^(hi|hello|hey|good\s+(morning|afternoon|evening)|howdy)(\s+(there|kaira|assistant))?$/i.test(cleanInput) ||
      cleanInput === 'hi' || cleanInput === 'hello' || cleanInput === 'hey'
    ) {
      return {
        answer: "Hello! Welcome to KAIRA. I am your AI voice assistant. How can I help you today with our platform, pricing, or voice services?",
        isGrounded: true,
        requiresTransfer: false,
        sources: [],
        confidence: 1.0,
        latencyMs: Date.now() - t0
      };
    }

    // 3. How are you
    if (/\b(how\s+are\s+you|how\s+are\s+things|hows\s+it\s+going|how\s+is\s+it\s+going)\b/i.test(cleanInput)) {
      return {
        answer: "I am doing great, thank you! How may I assist you with KAIRA's voice platform or customer communication today?",
        isGrounded: true,
        requiresTransfer: false,
        sources: [],
        confidence: 1.0,
        latencyMs: Date.now() - t0
      };
    }

    // 4. Who are you / What can you do
    if (/\b(who\s+are\s+you|what\s+can\s+you\s+do|what\s+is\s+your\s+name|what\s+are\s+you)\b/i.test(cleanInput)) {
      return {
        answer: "I am KAIRA's real-time AI Voice Agent. I can help you explore our features, explain pricing tiers, answer support inquiries, or connect you with human staff if needed.",
        isGrounded: true,
        requiresTransfer: false,
        sources: [],
        confidence: 1.0,
        latencyMs: Date.now() - t0
      };
    }

    // 5. Thanks / Gratitude
    if (/\b(thank\s+you|thanks|thank\s+you\s+so\s+much|appreciate\s+it|thx)\b/i.test(cleanInput)) {
      return {
        answer: "You are very welcome! Please let me know if you have any other questions.",
        isGrounded: true,
        requiresTransfer: false,
        sources: [],
        confidence: 1.0,
        latencyMs: Date.now() - t0
      };
    }

    // 6. Affirmations / Acknowledgments (OK, got it)
    if (/^(ok|okay|got\s+it|alright|cool|great|sounds\s+good|perfect|sure|yes|yeah|yep)$/i.test(cleanInput)) {
      return {
        answer: "Great! Feel free to ask any other questions, or let me know what else I can assist you with.",
        isGrounded: true,
        requiresTransfer: false,
        sources: [],
        confidence: 1.0,
        latencyMs: Date.now() - t0
      };
    }

    // 7. Goodbyes
    if (/\b(goodbye|bye|bye\s+bye|see\s+you|talk\s+to\s+you\s+later|have\s+a\s+good\s+day)\b/i.test(cleanInput)) {
      return {
        answer: "Thank you for calling KAIRA. Have a wonderful day ahead! Goodbye.",
        isGrounded: true,
        requiresTransfer: false,
        sources: [],
        confidence: 1.0,
        latencyMs: Date.now() - t0
      };
    }

    // 8. Repeat request
    if (/\b(repeat|say\s+that\s+again|pardon|what\s+did\s+you\s+say|once\s+more)\b/i.test(cleanInput)) {
      const lastAiMessage = [...history].reverse().find(m => m.role === 'assistant');
      return {
        answer: lastAiMessage?.content || "Sure! I am here to assist you with KAIRA's voice platform, subscriptions, policies, and customer support inquiries.",
        isGrounded: true,
        requiresTransfer: false,
        sources: [],
        confidence: 1.0,
        latencyMs: Date.now() - t0
      };
    }

    // Search corporate knowledge base
    const matches = await this.search(trimmedQuery);

    // If matching KB entry found
    if (matches.length > 0 && matches[0].score >= 0.20) {
      const topMatch = matches[0];
      const contextText = matches
        .map(m => `Title: ${m.entry.title}\nCategory: ${m.entry.category}\nQuestion: ${m.entry.question || 'N/A'}\nAnswer: ${m.entry.answer || 'N/A'}\nDetails: ${m.entry.content}`)
        .join('\n\n---\n\n');

      // Try OpenAI if available and not quota-exhausted
      if (this.openai && !this.isQuotaExhausted) {
        try {
          const systemPrompt = `You are KAIRA's official AI voice agent speaking live with a customer over a phone call.
Keep answers SHORT, DIRECT, CONVERSATIONAL and CRISP (1 to 2 sentences max).
Do not use bullet points, markdown or long paragraphs. Speak naturally like a human phone agent.

APPROVED KNOWLEDGE BASE CONTEXT:
${contextText}`;

          const messages: any[] = [{ role: 'system', content: systemPrompt }];
          if (history.length > 0) {
            messages.push(...history.slice(-4));
          }
          messages.push({ role: 'user', content: trimmedQuery });

          const completion = await this.openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages,
            temperature: 0.2,
            max_tokens: 80
          });

          const reply = completion.choices[0]?.message?.content?.trim();
          if (reply && reply.length > 5) {
            return {
              answer: reply,
              isGrounded: true,
              requiresTransfer: false,
              sources: matches.map(m => ({ id: m.entry.id, title: m.entry.title, category: m.entry.category })),
              confidence: topMatch.score,
              latencyMs: Date.now() - t0
            };
          }
        } catch (err: any) {
          if (err?.code === 'insufficient_quota' || err?.status === 429) {
            this.isQuotaExhausted = true;
            console.warn('[KnowledgeService] OpenAI quota exhausted. Switching to zero-latency built-in NLP engine.');
          }
        }
      }

      // Built-in zero-latency Grounded answer
      if (topMatch.entry.answer) {
        return {
          answer: topMatch.entry.answer,
          isGrounded: true,
          requiresTransfer: false,
          sources: matches.map(m => ({ id: m.entry.id, title: m.entry.title, category: m.entry.category })),
          confidence: topMatch.score,
          latencyMs: Date.now() - t0
        };
      } else if (topMatch.entry.content) {
        const sentences = topMatch.entry.content.split(/[.\n]/).filter((s: string) => s.trim().length > 10);
        const answer = sentences.slice(0, 2).join('. ').trim() + '.';
        return {
          answer: answer.length > 10 ? answer : topMatch.entry.content.slice(0, 200),
          isGrounded: true,
          requiresTransfer: false,
          sources: matches.map(m => ({ id: m.entry.id, title: m.entry.title, category: m.entry.category })),
          confidence: topMatch.score,
          latencyMs: Date.now() - t0
        };
      }
    }

    // General questions / ungrounded queries
    // Try OpenAI for general question answering if active
    if (this.openai && !this.isQuotaExhausted) {
      try {
        const systemPrompt = `You are KAIRA's official AI voice agent speaking on a phone call.
Answer the customer's general question helpfully, politely and concisely (1 to 2 sentences max).
If they ask for company-specific private data or account changes, explain you can transfer them to an administrator.`;

        const messages: any[] = [{ role: 'system', content: systemPrompt }];
        if (history.length > 0) {
          messages.push(...history.slice(-4));
        }
        messages.push({ role: 'user', content: trimmedQuery });

        const completion = await this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages,
          temperature: 0.3,
          max_tokens: 80
        });

        const reply = completion.choices[0]?.message?.content?.trim();
        if (reply && reply.length > 5) {
          return {
            answer: reply,
            isGrounded: false,
            requiresTransfer: false,
            sources: [],
            confidence: 0.85,
            latencyMs: Date.now() - t0
          };
        }
      } catch (err: any) {
        if (err?.code === 'insufficient_quota' || err?.status === 429) {
          this.isQuotaExhausted = true;
        }
      }
    }

    // Intelligent conversational fallback when general question is outside KB and offline
    // Check for specific common topics
    if (/\b(pizza|food|burger|order|delivery|restaurant)\b/i.test(cleanInput)) {
      return {
        answer: "I specialize in KAIRA's AI customer communication platform, voice calling, and subscriptions. I cannot process food delivery orders, but I'm happy to help with our voice solutions!",
        isGrounded: false,
        requiresTransfer: false,
        sources: [],
        confidence: 0.8,
        latencyMs: Date.now() - t0
      };
    }

    if (/\b(weather|temperature|rain|forecast)\b/i.test(cleanInput)) {
      return {
        answer: "I do not have live meteorological weather sensors, but I can help you with anything related to KAIRA's AI voice and communication platform!",
        isGrounded: false,
        requiresTransfer: false,
        sources: [],
        confidence: 0.8,
        latencyMs: Date.now() - t0
      };
    }

    if (/\b(help|assist|guidance|what\s+can\s+you\s+help|features)\b/i.test(cleanInput)) {
      return {
        answer: "I can assist you with KAIRA's voice agent features, subscription pricing, multi-language support across six languages, or transfer you to our live team.",
        isGrounded: true,
        requiresTransfer: false,
        sources: [],
        confidence: 0.9,
        latencyMs: Date.now() - t0
      };
    }

    // Default polite conversational response
    return {
      answer: "I understand. I can help you with KAIRA's voice capabilities, pricing plans, and platform setup. Could you please share more details, or would you like to speak with a human administrator?",
      isGrounded: false,
      requiresTransfer: false,
      sources: [],
      confidence: 0.6,
      latencyMs: Date.now() - t0
    };
  }
}

export const knowledgeService = new KnowledgeService();
