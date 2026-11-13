import OpenAI from 'openai';
import { prisma } from '../db.js';
import { knowledgeService, FALLBACK_MESSAGE } from './knowledge.js';

export const SUPPORTED_LANGUAGES: Record<string, { name: string; nativeName: string; bcp47: string }> = {
  en: { name: 'English', nativeName: 'English', bcp47: 'en-US' },
  ta: { name: 'Tamil', nativeName: 'தமிழ்', bcp47: 'ta-IN' },
  te: { name: 'Telugu', nativeName: 'తెలుగు', bcp47: 'te-IN' },
  ml: { name: 'Malayalam', nativeName: 'മലയാളം', bcp47: 'ml-IN' },
  kn: { name: 'Kannada', nativeName: 'ಕನ್ನಡ', bcp47: 'kn-IN' },
  hi: { name: 'Hindi', nativeName: 'हिन्दी', bcp47: 'hi-IN' }
};

export class TranslationService {
  private openai: OpenAI | null = null;
  private translationCache = new Map<string, string>();

  constructor() {
    if (process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.includes('your-')) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });
    }

    // Pre-cache standard greetings for instant zero-latency start in all 6 languages
    const baseGreeting = "Hello! Welcome to KAIRA. I am your AI assistant. How may I help you today?";
    this.translationCache.set(`en->ta:${baseGreeting}`, "வணக்கம்! KAIRA க்கு வரவேற்கிறோம். நான் உங்கள் AI உதவியாளர். இன்று நான் உங்களுக்கு எப்படி உதவ முடியும்?");
    this.translationCache.set(`en->te:${baseGreeting}`, "నమస్కారం! KAIRA కి స్వాగతం. నేను మీ AI సహాయకుడిని. ఈరోజు నేను మీకు ఎలా సహాయపడగలను?");
    this.translationCache.set(`en->hi:${baseGreeting}`, "नमस्ते! KAIRA में आपका स्वागत है। मैं आपका AI सहायक हूँ। आज मैं आपकी क्या सहायता कर सकता हूँ?");
    this.translationCache.set(`en->ml:${baseGreeting}`, "നമസ്കാരം! KAIRA-ലേക്ക് സ്വാഗതം. ഞാൻ നിങ്ങളുടെ AI അസിസ്റ്റന്റാണ്. ഇന്ന് ഞാൻ നിങ്ങളെ എങ്ങനെ സഹായിക്കും?");
    this.translationCache.set(`en->kn:${baseGreeting}`, "ನಮಸ್ಕಾರ! KAIRA ಗೆ ಸುಸ್ವಾಗತ. ನಾನು ನಿಮ್ಮ AI ಸಹಾಯಕ. ಇಂದು ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?");

    // Pre-cache primary Knowledge Base responses for ultra-fast voice responses (<50ms) across all regional languages
    const productsAnswer = "KAIRA offers three primary products: KAIRA VoiceCore (autonomous bidirectional AI voice agent), KAIRA LiveEscalate (real-time voice call transfer to human administrators and agents), and KAIRA Omnichannel Hub (centralized call analytics, tickets, and monitoring).";
    this.translationCache.set(`en->ta:${productsAnswer}`, "KAIRA மூன்று முதன்மை தயாரிப்புகளை வழங்குகிறது: KAIRA VoiceCore (தன்னாட்சி இருவழி AI குரல் முகவர்), KAIRA LiveEscalate (மனித நிர்வாகிகள் மற்றும் முகவர்களுக்கு நிகழ்நேர குரல் அழைப்பு பரிமாற்றம்), மற்றும் KAIRA Omnichannel Hub.");
    this.translationCache.set(`en->te:${productsAnswer}`, "KAIRA మూడు ప్రాథమిక ఉత్పత్తులను అందిస్తుంది: KAIRA VoiceCore (ద్విదిశాత్మక AI వాయిస్ ఏజెంట్), KAIRA LiveEscalate, మరియు KAIRA Omnichannel Hub.");
    this.translationCache.set(`en->hi:${productsAnswer}`, "KAIRA तीन प्राथमिक उत्पाद प्रदान करता है: KAIRA VoiceCore (स्वायत्त द्विदिश AI वॉयस एजेंट), KAIRA LiveEscalate, और KAIRA Omnichannel Hub।");
    this.translationCache.set(`en->ml:${productsAnswer}`, "KAIRA മൂന്ന് പ്രാഥമിക ഉൽപ്പന്നങ്ങൾ വാഗ്ദാനം ചെയ്യുന്നു: KAIRA VoiceCore, KAIRA LiveEscalate, കൂടാതെ KAIRA Omnichannel Hub.");
    this.translationCache.set(`en->kn:${productsAnswer}`, "KAIRA ಮೂರು ಪ್ರಾಥಮಿಕ ಉತ್ಪನ್ನಗಳನ್ನು ಒದಗಿಸುತ್ತದೆ: KAIRA VoiceCore, KAIRA LiveEscalate, ಮತ್ತು KAIRA Omnichannel Hub.");

    const pricingAnswer = "KAIRA offers three subscription plans: Starter at $49/month (500 voice minutes), Professional at $199/month (2,500 voice minutes, includes live human transfer), and Enterprise at $799/month (unlimited knowledge bases, dedicated WebRTC SIP trunking, 24/7 SLA).";
    this.translationCache.set(`en->ta:${pricingAnswer}`, "KAIRA மூன்று சந்தா திட்டங்களை வழங்குகிறது: ஸ்டார்ட்டர் $49/மாதம், புரொபஷனல் $199/மாதம், மற்றும் எண்டர்பிரைஸ் $799/மாதம்.");
    this.translationCache.set(`en->te:${pricingAnswer}`, "KAIRA మూడు సబ్‌స్క్రిప్షన్ ప్లాన్‌లను అందిస్తుంది: స్టార్టర్ $49/నెలకు, ప్రొఫెషనల్ $199/నెలకు, మరియు ఎంటర్‌ప్రైజ్ $799/నెలకు.");
    this.translationCache.set(`en->hi:${pricingAnswer}`, "KAIRA तीन सदस्यता योजनाएं प्रदान करता है: स्टार्टर $49/माह, प्रोफेशनल $199/माह, और एंटरप्राइज $799/माह।");
    this.translationCache.set(`en->ml:${pricingAnswer}`, "KAIRA മൂന്ന് സബ്‌സ്‌ക്രിപ്ഷൻ പ്ലാനുകൾ വാഗ്ദാനം ചെയ്യുന്നു: സ്റ്റാർട്ടർ $49/മാസം, പ്രൊഫഷണൽ $199/മാസം, എന്റർപ്രൈസ് $799/മാസം.");
    this.translationCache.set(`en->kn:${pricingAnswer}`, "KAIRA ಮೂರು ಚಂದಾದಾರಿಕೆ ಯೋಜನೆಗಳನ್ನು ಒದಗಿಸುತ್ತದೆ: ಸ್ಟಾರ್ಟರ್ $49/ತಿಂಗಳಿಗೆ, ಪ್ರೊಫೆಷನಲ್ $199/ತಿಂಗಳಿಗೆ, ಮತ್ತು ಎಂಟರ್‌ಪ್ರೈಸ್ $799/ತಿಂಗಳಿಗೆ.");
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
    // Kannada unicode range: U+0C80 to U+0CFF
    if (/[\u0C80-\u0CFF]/.test(trimmed)) return 'kn';
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

    return clean;
  }

  // Translate text between languages
  public async translateText(text: string, targetLanguage: string, sourceLanguage: string = 'en'): Promise<string> {
    const rawTarget = (targetLanguage || 'en').toLowerCase().slice(0, 2);
    const rawSource = (sourceLanguage || 'en').toLowerCase().slice(0, 2);

    if (rawTarget === rawSource || !text?.trim()) {
      return text;
    }

    const cacheKey = `${rawSource}->${rawTarget}:${text.trim()}`;
    if (this.translationCache.has(cacheKey)) {
      return this.translationCache.get(cacheKey)!;
    }

    try {
      const translated = await this.translateWithGtx(text, rawTarget, rawSource);
      const result = translated || text;
      if (this.translationCache.size > 1000) {
        this.translationCache.clear();
      }
      this.translationCache.set(cacheKey, result);
      return result;
    } catch {
      return text;
    }
  }

  // AI-Powered Grounded Knowledge Base Suggestion in Customer's Language
  public async getAiAnswerSuggestion(
    query: string,
    customerLang: string = 'en',
    history: Array<{ role: 'user' | 'assistant'; content: string }> = []
  ): Promise<{
    answer: string;
    sources: Array<{ id: string; title: string; category: string }>;
    isGrounded: boolean;
    requiresTransfer: boolean;
    language: string;
    latencyMs: number;
  }> {
    const t0 = Date.now();
    const trimmed = (query || '').trim();
    if (!trimmed) {
      return {
        answer: "I am listening. How can I help you today?",
        sources: [],
        isGrounded: true,
        requiresTransfer: false,
        language: customerLang,
        latencyMs: 0
      };
    }

    // Detect if customer spoke in a specific language (e.g. Tamil, Telugu, Hindi, Malayalam, Kannada)
    const detectedLang = this.detectLanguage(trimmed);
    let normLang = (customerLang || 'en').toLowerCase().slice(0, 2);
    if (detectedLang !== 'en' && detectedLang !== normLang) {
      normLang = detectedLang;
    }

    // Translate query to English if needed for Knowledge Base searching
    let englishQuery = trimmed;
    if (detectedLang !== 'en') {
      englishQuery = await this.translateText(trimmed, 'en', detectedLang);
    }

    // Query Knowledge Base / Voice Agent with conversation history
    const grounded = await knowledgeService.answerQuery(englishQuery, history);

    // Localize answer back into customer's preferred language if not English
    let localizedAnswer = grounded.answer;
    if (normLang !== 'en' && localizedAnswer) {
      localizedAnswer = await this.translateText(localizedAnswer, normLang, 'en');
    }

    return {
      answer: localizedAnswer || FALLBACK_MESSAGE,
      sources: grounded.sources || [],
      isGrounded: grounded.isGrounded,
      requiresTransfer: grounded.requiresTransfer,
      language: normLang,
      latencyMs: Date.now() - t0
    };
  }
}

export const translationService = new TranslationService();
