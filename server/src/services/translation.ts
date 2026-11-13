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

  // AI-Powered Grounded Knowledge Base Suggestion in Customer's Language with Universal Question Intelligence
  public async getAiAnswerSuggestion(
    query: string,
    customerLang: string = 'en',
    callHistory: any = []
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
        answer: "Hello! I am your KAIRA AI support assistant. How may I help you today?",
        sources: [],
        isGrounded: true,
        requiresTransfer: false,
        language: customerLang,
        latencyMs: 0
      };
    }

    // Detect if customer spoke in a specific regional language
    const detectedLang = this.detectLanguage(trimmed);
    let normLang = (customerLang || 'en').toLowerCase().slice(0, 2);
    if (detectedLang !== 'en' && detectedLang !== normLang) {
      normLang = detectedLang;
    }

    // Convert query to English for universal understanding & KB matching
    let englishQuery = trimmed;
    if (detectedLang !== 'en') {
      englishQuery = await this.translateText(trimmed, 'en', detectedLang);
    }
    const lowerEn = englishQuery.toLowerCase().trim();
    const lowerQuery = trimmed.toLowerCase();

    // 1. Check for explicit human agent / admin escalation request
    const humanTransferPhrases = [
      'connect me to an admin',
      'connect to an admin',
      'connect to admin',
      'talk to admin',
      'speak with admin',
      'speak to admin',
      'transfer to admin',
      'talk to human',
      'speak to human',
      'connect to human',
      'talk to an agent',
      'talk to agent',
      'speak to an agent',
      'speak to agent',
      'connect to agent',
      'talk to a person',
      'speak to a person',
      'real person',
      'human support',
      'human agent',
      'manager',
      'operator',
      'representative'
    ];
    const isHumanRequest = humanTransferPhrases.some(p => lowerEn.includes(p) || lowerQuery.includes(p));
    if (isHumanRequest) {
      let transferMsg = "Certainly! I will connect you with a member of our human support team right away. Please hold for just a moment.";
      if (normLang !== 'en') {
        transferMsg = await this.translateText(transferMsg, normLang, 'en');
      }
      return {
        answer: transferMsg,
        sources: [],
        isGrounded: true,
        requiresTransfer: true,
        language: normLang
      };
    }

    // 2. Handle common conversational pleasantries & greetings warmly
    const pleasantries = [
      'hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening',
      'who are you', 'how are you', 'what is your name', 'tell me about yourself',
      'what can you do', 'help me', 'are you ai', 'are you a robot'
    ];
    const isGreeting = pleasantries.some(p =>
      lowerQuery === p ||
      lowerQuery === p + '!' ||
      lowerEn === p ||
      lowerEn === p + '!' ||
      lowerEn.startsWith(p + ' ')
    );

    if (isGreeting) {
      let welcome = "Hello! Welcome to KAIRA TECHNOLOGY Customer Support. Thank you for calling us. I'm your AI support assistant. How may I help you today?";
      if (normLang !== 'en') {
        welcome = await this.translateText(welcome, normLang, 'en');
      }
      return {
        answer: welcome,
        sources: [],
        isGrounded: true,
        requiresTransfer: false,
        language: normLang
      };
    }

    // 3. Handle common conversational courtesies & small talk
    if (lowerEn.includes('thank you') || lowerEn.includes('thanks') || lowerEn === 'ty' || lowerQuery.includes('நன்றி') || lowerQuery.includes('ధన్యవాదాలు') || lowerQuery.includes('धन्यवाद')) {
      let reply = "You're very welcome! I'm glad I could assist you. Is there anything else regarding KAIRA TECHNOLOGY products, pricing, or voice services I can help you with today?";
      if (normLang !== 'en') reply = await this.translateText(reply, normLang, 'en');
      return { answer: reply, sources: [], isGrounded: true, requiresTransfer: false, language: normLang };
    }

    if (lowerEn === 'ok' || lowerEn === 'okay' || lowerEn === 'sure' || lowerEn === 'alright' || lowerEn === 'got it') {
      let reply = "Wonderful! Please feel free to ask any other questions about KAIRA TECHNOLOGY, our features, or your account.";
      if (normLang !== 'en') reply = await this.translateText(reply, normLang, 'en');
      return { answer: reply, sources: [], isGrounded: true, requiresTransfer: false, language: normLang };
    }

    if (lowerEn.includes('bye') || lowerEn.includes('goodbye') || lowerEn.includes('see you')) {
      let reply = "Thank you for contacting KAIRA TECHNOLOGY Customer Support! Have a wonderful day ahead, and don't hesitate to reach back out whenever you need assistance.";
      if (normLang !== 'en') reply = await this.translateText(reply, normLang, 'en');
      return { answer: reply, sources: [], isGrounded: true, requiresTransfer: false, language: normLang };
    }

    if (lowerEn.includes('joke') || lowerEn.includes('funny')) {
      let reply = "Why did the AI go to school? To improve its neural networks! On a serious note, how may I assist you with KAIRA TECHNOLOGY voice platform or services today?";
      if (normLang !== 'en') reply = await this.translateText(reply, normLang, 'en');
      return { answer: reply, sources: [], isGrounded: true, requiresTransfer: false, language: normLang };
    }

    // 4. Handling Math and simple Calculation inquiries directly
    const mathMatch = lowerEn.match(/(?:what is|calculate|compute)?\s*(\d+)\s*(\+|\-|\*|\/|plus|minus|times|divided by)\s*(\d+)/i);
    if (mathMatch) {
      const a = parseInt(mathMatch[1], 10);
      const op = mathMatch[2].toLowerCase();
      const b = parseInt(mathMatch[3], 10);
      let resVal = 0;
      if (op === '+' || op === 'plus') resVal = a + b;
      else if (op === '-' || op === 'minus') resVal = a - b;
      else if (op === '*' || op === 'times') resVal = a * b;
      else if (op === '/' || op === 'divided by') resVal = b !== 0 ? Math.round((a / b) * 100) / 100 : 0;

      let mathAns = `The answer is ${resVal}. How may I help you with KAIRA TECHNOLOGY products or customer support today?`;
      if (normLang !== 'en') mathAns = await this.translateText(mathAns, normLang, 'en');
      return { answer: mathAns, sources: [], isGrounded: true, requiresTransfer: false, language: normLang };
    }

    // 5. Search approved corporate Knowledge Base using English query representation
    const searchResults = await knowledgeService.search(englishQuery, 3);

    // If query matches approved corporate Knowledge Base with good confidence
    if (searchResults.length > 0 && searchResults[0].score >= 0.22) {
      const bestMatches = searchResults.slice(0, 2);
      const sources = bestMatches.map(m => ({
        id: m.entry.id,
        title: m.entry.title,
        category: m.entry.category
      }));

      let englishAnswer = bestMatches[0].entry.answer || bestMatches[0].entry.content;

      // Direct KB match translation to customer's language
      let localizedAnswer = englishAnswer;
      if (normLang !== 'en') {
        localizedAnswer = await this.translateText(englishAnswer, normLang, 'en');
      }

      return {
        answer: localizedAnswer,
        sources,
        isGrounded: true,
        requiresTransfer: false,
        language: normLang
      };
    }

    // 6. Handling Unrelated General Questions (general knowledge, weather, definitions)
    const isGeneralKnowledgeQuery =
      lowerEn.startsWith('what is the capital of') ||
      lowerEn.startsWith('who is the president of') ||
      lowerEn.startsWith('how is the weather') ||
      lowerEn.startsWith('what is the time') ||
      lowerEn.startsWith('what is the date') ||
      lowerEn.startsWith('what is gravity') ||
      lowerEn.startsWith('tell me about earth') ||
      lowerEn.startsWith('how does the sun');

    if (isGeneralKnowledgeQuery) {
      let generalAns = "That's an interesting question! While my primary expertise is assisting you with KAIRA TECHNOLOGY platform, voice agents, and customer support, I'm happy to help. How can I assist you with our services, plans, or technical support today?";
      if (lowerEn.includes('time')) {
        generalAns = `The current system time is ${new Date().toLocaleTimeString()}. How can I assist you with KAIRA TECHNOLOGY customer support today?`;
      } else if (lowerEn.includes('date')) {
        generalAns = `Today's date is ${new Date().toLocaleDateString()}. How can I assist you with KAIRA TECHNOLOGY customer support today?`;
      }
      if (normLang !== 'en') generalAns = await this.translateText(generalAns, normLang, 'en');
      return { answer: generalAns, sources: [], isGrounded: true, requiresTransfer: false, language: normLang };
    }

    // 6. Company-specific question where information is not found in the Knowledge Base
    // Strictly required polite fallback message (Zero Hallucination + Automatic Gap Logging)
    let localizedFallback = FALLBACK_MESSAGE;
    if (normLang !== 'en') {
      localizedFallback = await this.translateText(FALLBACK_MESSAGE, normLang, 'en');
    }

    return {
      answer: localizedFallback,
      sources: [],
      isGrounded: false,
      requiresTransfer: false,
      language: normLang,
      latencyMs: Date.now() - t0
    };
  }
}

export const translationService = new TranslationService();
