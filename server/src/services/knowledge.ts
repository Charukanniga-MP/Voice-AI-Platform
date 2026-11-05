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

class KnowledgeService {
  private openai: OpenAI | null = null;

  constructor() {
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
  }

  // Tokenize and clean text for lexical relevance
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);
  }

  // Calculate similarity between customer query and a KB entry
  private calculateScore(query: string, entry: any): number {
    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) return 0;

    const titleTokens = this.tokenize(entry.title || '');
    const questionTokens = this.tokenize(entry.question || '');
    const contentTokens = this.tokenize(entry.content || '');
    const keywordTokens = this.tokenize(entry.keywords || '');

    let score = 0;
    const queryLower = query.toLowerCase();

    // Check direct substring matches
    if (entry.question && queryLower.includes(entry.question.toLowerCase().trim())) {
      score += 0.8;
    }
    if (entry.title && queryLower.includes(entry.title.toLowerCase().trim())) {
      score += 0.6;
    }

    // Question match weights heavily
    let qMatches = 0;
    for (const token of queryTokens) {
      if (questionTokens.includes(token)) qMatches += 2.0;
      else if (titleTokens.includes(token)) qMatches += 1.5;
      else if (keywordTokens.includes(token)) qMatches += 1.5;
      else if (contentTokens.includes(token)) qMatches += 0.8;
    }

    const maxPossible = queryTokens.length * 2.0;
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
      .filter(item => item.score > 0.28)
      .sort((a, b) => b.score - a.score);

    return sorted.slice(0, limit);
  }

  // Answer customer query strictly grounded in Knowledge Base
  public async answerQuery(query: string): Promise<GroundedResponse> {
    const trimmedQuery = query.trim();

    // Handle common conversational pleasantries naturally without transferring
    const pleasantries = ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening', 'who are you', 'how are you'];
    const isPleasantry = pleasantries.some(p => trimmedQuery.toLowerCase() === p || trimmedQuery.toLowerCase() === p + '!');
    if (isPleasantry) {
      return {
        answer: "Hello! Welcome to KAIRA. I am your AI customer communication assistant. How can I assist you with our platform, pricing, or voice services today?",
        isGrounded: true,
        requiresTransfer: false,
        sources: [],
        confidence: 1.0
      };
    }

    // Search knowledge base
    const matches = await this.search(trimmedQuery);

    // If no matches or score is below strict threshold -> Trigger transfer!
    if (matches.length === 0 || matches[0].score < 0.35) {
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
