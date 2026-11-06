import OpenAI from 'openai';
import { prisma } from '../db.js';
import { knowledgeService } from './knowledge.js';

export const SUPPORTED_LANGUAGES: Record<string, { name: string; nativeName: string; bcp47: string }> = {
  en: { name: 'English', nativeName: 'English', bcp47: 'en-US' },
  ta: { name: 'Tamil', nativeName: 'தமிழ்', bcp47: 'ta-IN' },
  te: { name: 'Telugu', nativeName: 'తెలుగు', bcp47: 'te-IN' },
  ml: { name: 'Malayalam', nativeName: 'മലയാളം', bcp47: 'ml-IN' },
  hi: { name: 'Hindi', nativeName: 'हिन्दी', bcp47: 'hi-IN' }
};

export class TranslationService {
  private openai: OpenAI | null = null;

  constructor() {
    if (process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.includes('your_openai_api_key')) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
  }

  // Get language display name
  public getLanguageName(code: string): string {
    return SUPPORTED_LANGUAGES[code]?.name || 'English';
  }

  // Translate text between languages preserving brand terms and accuracy
  public async translateText(
    text: string,
    targetLang: string,
    sourceLang?: string
  ): Promise<string> {
    const trimmed = text.trim();
    if (!trimmed) return '';

    const normTarget = (targetLang || 'en').toLowerCase().slice(0, 2);
    const normSource = (sourceLang || '').toLowerCase().slice(0, 2);

    if (normTarget === normSource || (normTarget === 'en' && normSource === 'en')) {
      return trimmed;
    }

    const targetInfo = SUPPORTED_LANGUAGES[normTarget] || SUPPORTED_LANGUAGES.en;
    const sourceInfo = normSource ? (SUPPORTED_LANGUAGES[normSource] || SUPPORTED_LANGUAGES.en) : null;

    if (this.openai) {
      try {
        const response = await this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are a certified professional multilingual customer support interpreter for KAIRA Technologies.
Translate the text accurately into ${targetInfo.name} (${targetInfo.nativeName}).
Rules:
1. Preserve technical terminology, software names, and company names exactly: "KAIRA", "VoiceCore", "LiveEscalate", "Omnichannel Hub".
2. Preserve numbers, pricing figures (e.g. $49, $199, $799), email addresses, and phone numbers without alteration.
3. Keep the translation natural, polite, and professional.
4. Output ONLY the raw translation text with no explanations or quotes.`
            },
            {
              role: 'user',
              content: trimmed
            }
          ],
          temperature: 0.1,
          max_tokens: 350
        });

        const translation = response.choices[0]?.message?.content?.trim();
        if (translation) return translation;
      } catch (err: any) {
        console.warn('[TranslationService] OpenAI translation API error, using original text:', err.message);
      }
    }

    return trimmed;
  }

  // AI-Powered Grounded Knowledge Base Suggestion in Customer's Language
  public async getAiAnswerSuggestion(
    query: string,
    customerLang: string = 'en'
  ): Promise<{
    answer: string | null;
    sources: Array<{ id: string; title: string; category: string }>;
    isGrounded: boolean;
    language: string;
  }> {
    const trimmed = query.trim();
    if (!trimmed) {
      return { answer: null, sources: [], isGrounded: false, language: customerLang };
    }

    const normLang = (customerLang || 'en').toLowerCase().slice(0, 2);

    // 1. If customer query is in non-English, translate to English for high-precision KB retrieval
    let englishQuery = trimmed;
    if (normLang !== 'en') {
      englishQuery = await this.translateText(trimmed, 'en', normLang);
    }

    // 2. Search approved corporate Knowledge Base
    const searchResults = await knowledgeService.search(englishQuery, 3);

    if (searchResults.length === 0 || searchResults[0].score < 0.35) {
      return {
        answer: null,
        sources: [],
        isGrounded: false,
        language: normLang
      };
    }

    const bestMatches = searchResults.slice(0, 2);
    const sources = bestMatches.map(m => ({
      id: m.entry.id,
      title: m.entry.title,
      category: m.entry.category
    }));

    const groundContext = bestMatches
      .map(m => `Title: ${m.entry.title}\nContent: ${m.entry.content}\n${m.entry.answer ? `Direct Answer: ${m.entry.answer}` : ''}`)
      .join('\n\n---\n\n');

    let englishAnswer = bestMatches[0].entry.answer || bestMatches[0].entry.content;

    // 3. Synthesize concise agent talking point grounded strictly in the KB
    if (this.openai) {
      try {
        const completion = await this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are an AI customer support copilot for KAIRA Technologies.
Formulate a direct, concise answer for the support agent to convey to the customer.
Strict Rules:
- Answer ONLY using the facts from the Knowledge Context below.
- Do NOT invent policies, features, or prices.
- If the context does not answer the question, say "No verified answer found."
- Answer in ${SUPPORTED_LANGUAGES[normLang]?.name || 'English'}.

Knowledge Context:
${groundContext}`
            },
            {
              role: 'user',
              content: `Customer asked: "${trimmed}"`
            }
          ],
          temperature: 0.1,
          max_tokens: 300
        });

        const synthAnswer = completion.choices[0]?.message?.content?.trim();
        if (synthAnswer && !synthAnswer.toLowerCase().includes('no verified answer')) {
          return {
            answer: synthAnswer,
            sources,
            isGrounded: true,
            language: normLang
          };
        }
      } catch (err) {
        console.warn('[TranslationService] AI synthesis error, using direct KB answer:', err);
      }
    }

    // Fallback: translate the direct KB answer to customer's language
    let localizedAnswer = englishAnswer;
    if (normLang !== 'en') {
      localizedAnswer = await this.translateText(englishAnswer, normLang, 'en');
    }

    return {
      answer: localizedAnswer,
      sources,
      isGrounded: true,
      language: normLang
    };
  }
}

export const translationService = new TranslationService();

