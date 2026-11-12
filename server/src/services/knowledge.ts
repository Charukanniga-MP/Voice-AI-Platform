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

  constructor() {
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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
    const rawTokens = this.tokenize(query);
    if (rawTokens.length === 0) return 0;

    const significantTokens = this.getSignificantTokens(rawTokens);
    const titleTokens = this.tokenize(entry.title || '');
    const questionTokens = this.tokenize(entry.question || '');
    const contentTokens = this.tokenize(entry.content || '');
    const keywordTokens = this.tokenize(entry.keywords || '');

    // Strict zero-hallucination requirement: At least one significant keyword MUST match title, question, or keywords
    const hasCoreMatch = significantTokens.some(
      t => this.matchToken(t, titleTokens) || this.matchToken(t, questionTokens) || this.matchToken(t, keywordTokens)
    );
    if (!hasCoreMatch) {
      return 0;
    }

    let score = 0;
    const cleanQuery = query.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();

    // Check direct substring matches
    if (entry.question) {
      const cleanQ = entry.question.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
      if (cleanQuery.includes(cleanQ) || cleanQ.includes(cleanQuery)) {
        score += 0.8;
      }
    }
    if (entry.title) {
      const cleanT = entry.title.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
      if (cleanQuery.includes(cleanT) || cleanT.includes(cleanQuery)) {
        score += 0.6;
      }
    }

    // Significant tokens match weights heavily
    let qMatches = 0;
    for (const token of significantTokens) {
      if (this.matchToken(token, questionTokens)) qMatches += 2.5;
      else if (this.matchToken(token, titleTokens)) qMatches += 2.0;
      else if (this.matchToken(token, keywordTokens)) qMatches += 2.0;
      else if (this.matchToken(token, contentTokens)) qMatches += 1.0;
    }

    const maxPossible = significantTokens.length * 2.5;
    const matchRatio = Math.min(1.0, qMatches / Math.max(1, maxPossible));
    score += matchRatio;

    return Math.min(1.0, score);
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
      .filter(item => item.score > 0.22)
      .sort((a, b) => b.score - a.score);

    return sorted.slice(0, limit);
  }

  // Answer customer query strictly grounded in Knowledge Base
  public async answerQuery(query: string): Promise<GroundedResponse> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return {
        answer: "I am listening. How can I help you today?",
        isGrounded: true,
        requiresTransfer: false,
        sources: [],
        confidence: 1.0
      };
    }

    const cleanInput = trimmedQuery.toLowerCase().replace(/['".,!?;:]/g, '').trim();

    // 1. Explicit request to speak with a human / Admin
    if (/\b(speak\s+to|talk\s+to|connect(\s+me)?(\s+to)?|transfer(\s+me)?(\s+to)?|put\s+me\s+through\s+to|let\s+me\s+speak\s+to|want|need)\s+(an?\s+)?(admin|agent|human|person|representative|support|specialist)\b/i.test(cleanInput) ||
        /\b(human agent|live agent|human representative|transfer me|live person)\b/i.test(cleanInput)) {
      return {
        answer: "Certainly. I am connecting you with our human Administrator right now. Please hold for a moment.",
        isGrounded: false,
        requiresTransfer: true,
        sources: [],
        confidence: 1.0
      };
    }

    // 2. Greetings
    if (/^(hi|hello|hey|good\s+(morning|afternoon|evening)|howdy)(\s+(there|kaira|assistant))?$/i.test(cleanInput) ||
        cleanInput === 'hi' || cleanInput === 'hello' || cleanInput === 'hey') {
      return {
        answer: "Hello! Welcome to KAIRA. I am your AI customer communication assistant. How can I help you today with our platform, pricing, or voice services?",
        isGrounded: true,
        requiresTransfer: false,
        sources: [],
        confidence: 1.0
      };
    }

    // 3. How are you
    if (/\b(how\s+are\s+you|how\s+are\s+things|hows\s+it\s+going|how\s+is\s+it\s+going)\b/i.test(cleanInput)) {
      return {
        answer: "I'm doing great, thank you! How may I assist you with KAIRA's platform or services today?",
        isGrounded: true,
        requiresTransfer: false,
        sources: [],
        confidence: 1.0
      };
    }

    // 4. Who are you / What can you do
    if (/\b(who\s+are\s+you|what\s+can\s+you\s+do|what\s+is\s+your\s+name|what\s+are\s+you)\b/i.test(cleanInput)) {
      return {
        answer: "I am KAIRA's official AI voice assistant. I can answer questions about our voice platform, pricing plans, operating hours, and policies, or transfer you to our live administrative team.",
        isGrounded: true,
        requiresTransfer: false,
        sources: [],
        confidence: 1.0
      };
    }

    // 5. Thanks / Gratitude
    if (/\b(thank\s+you|thanks|thank\s+you\s+so\s+much|appreciate\s+it|thx)\b/i.test(cleanInput)) {
      return {
        answer: "You are very welcome! Please let me know if there is anything else I can help you with today.",
        isGrounded: true,
        requiresTransfer: false,
        sources: [],
        confidence: 1.0
      };
    }

    // 6. Affirmations / Acknowledgments (OK, got it)
    if (/^(ok|okay|got\s+it|alright|cool|great|sounds\s+good|perfect|sure|yes|yeah|yep)$/i.test(cleanInput)) {
      return {
        answer: "Great! Feel free to ask any other questions or let me know if you would like me to connect you with an admin.",
        isGrounded: true,
        requiresTransfer: false,
        sources: [],
        confidence: 1.0
      };
    }

    // 7. Goodbyes
    if (/\b(goodbye|bye|bye\s+bye|see\s+you|talk\s+to\s+you\s+later|have\s+a\s+good\s+day)\b/i.test(cleanInput)) {
      return {
        answer: "Thank you for reaching out to KAIRA. Have a wonderful day ahead! Goodbye.",
        isGrounded: true,
        requiresTransfer: false,
        sources: [],
        confidence: 1.0
      };
    }

    // 8. Repeat request
    if (/\b(repeat|say\s+that\s+again|pardon|what\s+did\s+you\s+say|once\s+more)\b/i.test(cleanInput)) {
      return {
        answer: "Sure, let me repeat: I am here to assist you with KAIRA's voice platform, subscriptions, policies, and customer support inquiries.",
        isGrounded: true,
        requiresTransfer: false,
        sources: [],
        confidence: 1.0
      };
    }

    // Search knowledge base
    const matches = await this.search(trimmedQuery);

    // If no matches or score is below calibrated threshold -> Trigger transfer!
    if (matches.length === 0 || matches[0].score < 0.28) {
      console.log(`[AI Grounding] Low confidence (${matches[0]?.score || 0}) for query: "${trimmedQuery}". Escalating to Admin.`);
      return {
        answer: FALLBACK_MESSAGE,
        isGrounded: false,
        requiresTransfer: true,
        sources: [],
        confidence: matches[0]?.score || 0
      };
    }

    const topMatch = matches[0];
    const contextText = matches
      .map(m => `Title: ${m.entry.title}\nCategory: ${m.entry.category}\nQuestion: ${m.entry.question || 'N/A'}\nAnswer: ${m.entry.answer || 'N/A'}\nDetails: ${m.entry.content}`)
      .join('\n\n---\n\n');

    // If an OpenAI API key is available, use LLM strictly instructed with RAG grounding
    if (this.openai) {
      try {
        const systemPrompt = `You are KAIRA's official AI voice agent.
Your voice responses are read aloud to the customer over a live telephone call.
Keep answers concise (1 to 3 conversational sentences), friendly, professional, and clear for voice listening.

STRICT GROUNDING RULES:
1. You must answer ONLY using the provided Knowledge Base context below.
2. Never invent company details, pricing, policies, services, discounts, or promises.
3. If the context does NOT clearly answer the customer's question, you MUST reply with exactly: [TRANSFER_REQUIRED]
4. Do not provide plausible guesses. If in doubt, output [TRANSFER_REQUIRED].

APPROVED KNOWLEDGE BASE CONTEXT:
${contextText}`;

        const completion = await this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: trimmedQuery }
          ],
          temperature: 0.1,
          max_tokens: 150
        });

        const reply = completion.choices[0]?.message?.content?.trim() || '';

        if (reply.includes('[TRANSFER_REQUIRED]') || reply.length < 5) {
          console.log(`[AI Grounding] LLM signaled [TRANSFER_REQUIRED] for query: "${trimmedQuery}".`);
          return {
            answer: FALLBACK_MESSAGE,
            isGrounded: false,
            requiresTransfer: true,
            sources: [],
            confidence: topMatch.score
          };
        }

        return {
          answer: reply,
          isGrounded: true,
          requiresTransfer: false,
          sources: matches.map(m => ({ id: m.entry.id, title: m.entry.title, category: m.entry.category })),
          confidence: topMatch.score
        };
      } catch (err) {
        console.error('[AI Grounding] OpenAI completion error, falling back to direct KB match:', err);
      }
    }

    // Local grounded answer builder fallback (when API key is absent or offline)
    if (topMatch.entry.answer) {
      return {
        answer: topMatch.entry.answer,
        isGrounded: true,
        requiresTransfer: false,
        sources: matches.map(m => ({ id: m.entry.id, title: m.entry.title, category: m.entry.category })),
        confidence: topMatch.score
      };
    } else if (topMatch.entry.content) {
      // Pick first 2 sentences
      const sentences = topMatch.entry.content.split(/[.\n]/).filter((s: string) => s.trim().length > 10);
      const answer = sentences.slice(0, 2).join('. ').trim() + '.';
      return {
        answer: answer.length > 10 ? answer : topMatch.entry.content.slice(0, 200),
        isGrounded: true,
        requiresTransfer: false,
        sources: matches.map(m => ({ id: m.entry.id, title: m.entry.title, category: m.entry.category })),
        confidence: topMatch.score
      };
    }

    // Default to fallback
    return {
      answer: FALLBACK_MESSAGE,
      isGrounded: false,
      requiresTransfer: true,
      sources: [],
      confidence: 0
    };
  }
}

export const knowledgeService = new KnowledgeService();

