import OpenAI from 'openai';
import { prisma } from '../db.js';
import { knowledgeService, FALLBACK_MESSAGE } from './knowledge.js';

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
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });
    }
  }

  // Get language display name
  public getLanguageName(code: string): string {
    const norm = (code || 'en').toLowerCase().slice(0, 2);
    return SUPPORTED_LANGUAGES[norm]?.name || 'English';
  }

  // Automatic language detection from Unicode script analysis
  public detectLanguage(text: string): string {
    const trimmed = (text || '').trim();
    if (!trimmed) return 'en';

    // Tamil unicode range: U+0B80 to U+0BFF
    if (/[\u0B80-\u0BFF]/.test(trimmed)) return 'ta';
    // Telugu unicode range: U+0C00 to U+0C7F
    if (/[\u0C00-\u0C7F]/.test(trimmed)) return 'te';
    // Malayalam unicode range: U+0D00 to U+0D7F
    if (/[\u0D00-\u0D7F]/.test(trimmed)) return 'ml';
    // Devanagari / Hindi unicode range: U+0900 to U+097F
    if (/[\u0900-\u097F]/.test(trimmed)) return 'hi';

    return 'en';
  }

  // High-accuracy multi-tier translation engine with automated fallback
  private async translateWithGtx(text: string, target: string, source: string = 'auto'): Promise<string> {
    const clean = (text || '').trim();
    if (!clean) return '';

    // Tier 1: Chrome Extension translation endpoint (high-speed, generous quota, no CAPTCHA)
    try {
      const url = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${encodeURIComponent(source)}&tl=${encodeURIComponent(target)}&q=${encodeURIComponent(clean)}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          if (Array.isArray(data[0]) && typeof data[0][0] === 'string') {
            const out = data[0][0].trim();
            if (out) return out;
          } else if (typeof data[0] === 'string') {
            const out = data[0].trim();
            if (out) return out;
          }
        } else if (typeof data === 'string' && data.trim()) {
          return data.trim();
        }
      }
    } catch {
      // Proceed to Tier 2
    }

    // Tier 2: Standard Google GTX endpoint
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(source)}&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(clean)}`;
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && Array.isArray(data[0])) {
            const translated = data[0].map((item: any) => item[0]).filter(Boolean).join('');
            if (translated && translated.trim()) {
              return translated.trim();
            }
          }
        }
      } catch {
        if (attempt < 1) {
          await new Promise(r => setTimeout(r, 100));
        }
      }
    }

    // Tier 3: MyMemory API fallback
    try {
      const srcPair = source === 'auto' ? 'autodetect' : source;
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(clean)}&langpair=${encodeURIComponent(srcPair)}|${encodeURIComponent(target)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.responseData?.translatedText && !data.responseData.translatedText.includes('MYMEMORY WARNING')) {
          return data.responseData.translatedText.trim();
        }
      }
    } catch {
      // Fall through to clean
    }

    return clean;
  }

  // Translate text between languages preserving brand terms and accuracy
  public async translateText(
    text: string,
    targetLang: string,
    sourceLang?: string
  ): Promise<string> {
    const trimmed = (text || '').trim();
    if (!trimmed) return '';

    const normTarget = (targetLang || 'en').toLowerCase().slice(0, 2);
    const normSource = (sourceLang || '').toLowerCase().slice(0, 2);

    if (normTarget === normSource || (normTarget === 'en' && normSource === 'en')) {
      return trimmed;
    }

    // High-speed, high-accuracy GTX engine (reliable, zero quota limit)
    const gtxTranslated = await this.translateWithGtx(trimmed, normTarget, normSource || 'auto');
    if (gtxTranslated && gtxTranslated !== trimmed) {
      return gtxTranslated;
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
    const trimmed = (query || '').trim();
    if (!trimmed) {
      return { answer: null, sources: [], isGrounded: false, language: customerLang };
    }

    // Detect if customer spoke in a specific language (e.g. Tamil, Telugu, Hindi, Malayalam)
    const detectedLang = this.detectLanguage(trimmed);
    let normLang = (customerLang || 'en').toLowerCase().slice(0, 2);
    if (detectedLang !== 'en' && detectedLang !== normLang) {
      normLang = detectedLang;
    }

    // 1. Handle common conversational pleasantries naturally in customer's language
    const pleasantries = ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening', 'who are you', 'how are you'];
    const isEnglishPleasantry = pleasantries.some(p => trimmed.toLowerCase() === p || trimmed.toLowerCase() === p + '!');

    // Check if query is a pleasantry in non-English
    let englishQuery = trimmed;
    if (normLang !== 'en') {
      englishQuery = await this.translateText(trimmed, 'en', normLang);
    }

    const isTranslatedPleasantry = pleasantries.some(p => englishQuery.toLowerCase().includes(p));

    if (isEnglishPleasantry || isTranslatedPleasantry) {
      let welcome = "Hello! Welcome to KAIRA. I am your AI voice assistant. How can I assist you with our platform, pricing, or voice services today?";
      if (normLang !== 'en') {
        welcome = await this.translateText(welcome, normLang, 'en');
      }
      return {
        answer: welcome,
        sources: [],
        isGrounded: true,
        language: normLang
      };
    }

    // 2. Search approved corporate Knowledge Base using English query representation
    const searchResults = await knowledgeService.search(englishQuery, 3);

    // If query not found or confidence is too low -> Strict fallback (Zero Hallucination)
    if (searchResults.length === 0 || searchResults[0].score < 0.28) {
      let localizedFallback = FALLBACK_MESSAGE;
      if (normLang !== 'en') {
        localizedFallback = await this.translateText(FALLBACK_MESSAGE, normLang, 'en');
      }

      return {
        answer: localizedFallback,
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

    let englishAnswer = bestMatches[0].entry.answer || bestMatches[0].entry.content;

    // Direct KB match translation to customer's language (Strict Zero Hallucination)
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
