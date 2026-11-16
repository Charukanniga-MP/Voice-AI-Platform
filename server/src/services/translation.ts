import OpenAI from 'openai';
import { prisma } from '../db.js';
import { knowledgeService, FALLBACK_MESSAGE, COPILOT_NOT_FOUND_MESSAGE, CustomerContext, GroundedSource } from './knowledge.js';

export const SUPPORTED_LANGUAGES: Record<string, { name: string; nativeName: string; bcp47: string }> = {
  en: { name: 'English', nativeName: 'English', bcp47: 'en-US' },
  ta: { name: 'Tamil', nativeName: 'தமிழ்', bcp47: 'ta-IN' },
  te: { name: 'Telugu', nativeName: 'తెలుగు', bcp47: 'te-IN' },
  ml: { name: 'Malayalam', nativeName: 'മലയാളം', bcp47: 'ml-IN' },
  kn: { name: 'Kannada', nativeName: 'ಕನ್ನಡ', bcp47: 'kn-IN' },
  hi: { name: 'Hindi', nativeName: 'हिन्दी', bcp47: 'hi-IN' },
  bn: { name: 'Bengali', nativeName: 'বাংলা', bcp47: 'bn-IN' },
  mr: { name: 'Marathi', nativeName: 'मराठी', bcp47: 'mr-IN' },
  ar: { name: 'Arabic', nativeName: 'العربية', bcp47: 'ar-SA' },
  fr: { name: 'French', nativeName: 'Français', bcp47: 'fr-FR' },
  de: { name: 'German', nativeName: 'Deutsch', bcp47: 'de-DE' },
  es: { name: 'Spanish', nativeName: 'Español', bcp47: 'es-ES' },
  zh: { name: 'Chinese', nativeName: '中文', bcp47: 'zh-CN' },
  ja: { name: 'Japanese', nativeName: '日本語', bcp47: 'ja-JP' },
  ko: { name: 'Korean', nativeName: '한국어', bcp47: 'ko-KR' },
  it: { name: 'Italian', nativeName: 'Italiano', bcp47: 'it-IT' },
  pt: { name: 'Portuguese', nativeName: 'Português', bcp47: 'pt-BR' },
  ru: { name: 'Russian', nativeName: 'Русский', bcp47: 'ru-RU' },
  tr: { name: 'Turkish', nativeName: 'Türkçe', bcp47: 'tr-TR' },
  id: { name: 'Indonesian', nativeName: 'Bahasa Indonesia', bcp47: 'id-ID' },
  vi: { name: 'Vietnamese', nativeName: 'Tiếng Việt', bcp47: 'vi-VN' }
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
    this.translationCache.set(`en->bn:${baseGreeting}`, "হ্যালো! কায়রা-তে স্বাগতম। আমি আপনার এআই সহকারী। আজ আমি আপনাকে কীভাবে সাহায্য করতে পারি?");
    this.translationCache.set(`en->mr:${baseGreeting}`, "नमस्कार! KAIRA मध्ये आपले स्वागत आहे. मी आपला AI सहाय्यक आहे. आज मी आपली काय मदत करू शकतो?");
    this.translationCache.set(`en->ar:${baseGreeting}`, "مرحباً! أهلاً بكم في كايرا. أنا مساعدكم الذكي. كيف يمكنني مساعدتكم اليوم؟");
    this.translationCache.set(`en->fr:${baseGreeting}`, "Bonjour! Bienvenue chez KAIRA. Je suis votre assistante IA. Comment puis-je vous aider aujourd'hui?");
    this.translationCache.set(`en->de:${baseGreeting}`, "Hallo! Willkommen bei KAIRA. Ich bin Ihre KI-Assistentin. Wie kann ich Ihnen heute helfen?");
    this.translationCache.set(`en->es:${baseGreeting}`, "¡Hola! Bienvenido a KAIRA. Soy su asistente de IA. ¿Cómo puedo ayudarle hoy?");
    this.translationCache.set(`en->zh:${baseGreeting}`, "您好！欢迎致电 KAIRA 智能客服。我是您的 AI 助手，请问有什么可以帮您？");
    this.translationCache.set(`en->ja:${baseGreeting}`, "こんにちは！KAIRA へようこそ。私はAIアシスタントです。本日はどのようなご用件でしょうか？");
    this.translationCache.set(`en->ko:${baseGreeting}`, "안녕하세요! KAIRA에 오신 것을 환영합니다. 저는 AI 상담원입니다. 오늘 무엇을 도와드릴까요?");
    this.translationCache.set(`en->it:${baseGreeting}`, "Ciao! Benvenuto in KAIRA. Sono la tua assistente AI. Come posso aiutarti oggi?");
    this.translationCache.set(`en->pt:${baseGreeting}`, "Olá! Bem-vindo à KAIRA. Sou sua assistente de IA. Como posso ajudar hoje?");
    this.translationCache.set(`en->ru:${baseGreeting}`, "Здравствуйте! Добро пожаловать в KAIRA. Я ваш ИИ-ассистент. Чем я могу помочь вам сегодня?");
    this.translationCache.set(`en->tr:${baseGreeting}`, "Merhaba! KAIRA'ya hoş geldiniz. Ben yapay zeka asistanınızım. Bugün size nasıl yardımcı olabilirim?");
    this.translationCache.set(`en->id:${baseGreeting}`, "Halo! Selamat datang di KAIRA. Saya asisten AI Anda. Ada yang bisa saya bantu hari ini?");
    this.translationCache.set(`en->vi:${baseGreeting}`, "Xin chào! Chào mừng bạn đến với KAIRA. Tôi là trợ lý AI của bạn. Tôi có thể giúp gì cho bạn hôm nay?");

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

    // Pre-cache Order inquiries for instant response across all 6 languages
    const orderPrompt = "Hello! I would be delighted to help you with your order. Could you please tell me your Order ID?";
    this.translationCache.set(`en->ta:${orderPrompt}`, "வணக்கம்! நிச்சயமாக உதவுகிறேன். உங்கள் ஆர்டர் ஐடியைச் சொல்ல முடியுமா?");
    this.translationCache.set(`en->te:${orderPrompt}`, "నమస్కారం! ఖచ్చితంగా సహాయం చేస్తాను. దయచేసి మీ ఆర్డర్ ఐడీని చెప్పగలరా?");
    this.translationCache.set(`en->hi:${orderPrompt}`, "नमस्ते! बिल्कुल मैं आपकी सहायता करूँगा। क्या आप अपनी ऑर्डर आईडी बता सकते हैं?");
    this.translationCache.set(`en->ml:${orderPrompt}`, "നമസ്കാരം! തീർച്ചയായും സഹായിക്കാം. നിങ്ങളുടെ ഓർഡർ ഐഡി പറയാമോ?");
    this.translationCache.set(`en->kn:${orderPrompt}`, "ನಮಸ್ಕಾರ! ಖಂಡಿತವಾಗಿಯೂ ಸಹಾಯ ಮಾಡುತ್ತೇನೆ. ದಯವಿಟ್ಟು ನಿಮ್ಮ ಆರ್ಡರ್ ಐಡಿಯನ್ನು ತಿಳಿಸಬಹುದೇ?");

    // Pre-cache Language inquiries for instant regional language copilot queries
    const langInquiry = "Which languages does KAIRA support?";
    this.translationCache.set(`ta->en:KAIRA எந்தெந்த மொழிகளை ஆதரிக்கிறது?`, langInquiry);
    this.translationCache.set(`te->en:KAIRA ఏ భాషలకు మద్దతు ఇస్తుంది?`, langInquiry);
    this.translationCache.set(`hi->en:क्या KAIRA हिंदी समझ सकता है?`, "Can KAIRA understand Hindi and which languages are supported?");
    this.translationCache.set(`ml->en:KAIRA മലയാളത്തിൽ സംസാരിക്കുമോ?`, "Does KAIRA speak Malayalam and support other languages?");
    this.translationCache.set(`kn->en:KAIRA ಕನ್ನಡದಲ್ಲಿ ಕಾರ್ಯನಿರ್ವಹಿಸುತ್ತದೆಯೇ?`, "Does KAIRA work in Kannada and support other languages?");
  }

  // Get language display name
  public getLanguageName(code: string): string {
    const norm = (code || 'en').toLowerCase().slice(0, 2);
    return SUPPORTED_LANGUAGES[norm]?.name || 'English';
  }

  // Automatic language detection from Unicode script analysis and transliterated speech
  public detectLanguage(text: string): string {
    const trimmed = (text || '').trim();
    if (!trimmed) return 'en';

    // Script ranges:
    if (/[\u0B80-\u0BFF]/.test(trimmed)) return 'ta'; // Tamil
    if (/[\u0C00-\u0C7F]/.test(trimmed)) return 'te'; // Telugu
    if (/[\u0D00-\u0D7F]/.test(trimmed)) return 'ml'; // Malayalam
    if (/[\u0C80-\u0CFF]/.test(trimmed)) return 'kn'; // Kannada
    if (/[\u0980-\u09FF]/.test(trimmed)) return 'bn'; // Bengali
    if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(trimmed)) return 'ar'; // Arabic
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(trimmed)) return 'ja'; // Japanese (Hiragana/Katakana checked before Chinese Kanji)
    if (/[\u4E00-\u9FFF]/.test(trimmed)) return 'zh'; // Chinese (Hanzi)
    if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(trimmed)) return 'ko'; // Korean
    if (/[\u0400-\u04FF]/.test(trimmed)) return 'ru'; // Russian
    if (/[\u0102\u0103\u0110\u0111\u01A0\u01A1\u01AF\u01B0\u1EA0-\u1EF9]/.test(trimmed)) return 'vi'; // Vietnamese
    if (/[\u0900-\u097F]/.test(trimmed)) {
      if (/(?:आहे|नाही|काय|कसे|माझे|तुमचे|धन्यवाद|नमस्कार)/.test(trimmed)) return 'mr';
      return 'hi';
    }

    const lower = trimmed.toLowerCase();

    // Latin-script patterns
    if (/\b(bonjour|merci|comment|aide|commande|compte|salut|s'il vous plait)\b/.test(lower)) return 'fr';
    if (/\b(hola|gracias|por favor|como|buenos|dias|tardes|ayuda|pedido|cuenta)\b/.test(lower)) return 'es';
    if (/\b(hallo|guten|danke|bitte|wie|hilfe|bestellung|konto)\b/.test(lower)) return 'de';
    if (/\b(ciao|buongiorno|grazie|prego|aiuto|ordine|conto)\b/.test(lower)) return 'it';
    if (/\b(ol[aá]|obrigad[oa]|por favor|ajuda|pedido|conta|voc[eê]|pre[cç]os?|quais)\b/i.test(lower) || /[\u00E3\u00F5\u00E7]/.test(lower)) return 'pt';
    if (/\b(merhaba|tesekkur|lutfen|nasil|yardim|siparis|hesap)\b/.test(lower)) return 'tr';
    if (/\b(halo|terima kasih|tolong|bagaimana|bantuan|pesanan|akun)\b/.test(lower)) return 'id';
    if (/\b(xin ch[aà]o|c[aá]m [oơ]n|l[aà]m [oơ]n|th[eế] n[aà]o|gi[uú]p [dđ][oõỡ]|b[aạ]n)\b/i.test(lower)) return 'vi';

    // Transliterated Indian language patterns
    if (/\b(vanakkam|ennudaiya|thaniya|solunga|nandri|eppadi|ungalukku|thirumba)\b/.test(lower)) return 'ta';
    if (/\b(namaste|dhanyavad|kaise|kripya|apka|madad|bataiye|samajh)\b/.test(lower)) return 'hi';
    if (/\b(namaskaramu|ela|unnaru|dhanyavadalu|meeru|sahayam)\b/.test(lower)) return 'te';
    if (/\b(namaskara|hegidira|dhanyavada|enu|nimma|sahaya)\b/.test(lower)) return 'kn';
    if (/\b(namaskaram|enthoke|vishesham|nandi|sahayikkan|ningalude)\b/.test(lower)) return 'ml';
    if (/\b(nomoshkar|dhonnobad|kemon|achen|amake|sahajjo)\b/.test(lower)) return 'bn';
    if (/\b(namaskar|kasa|kay|ahe|nahi|dhanyavad)\b/.test(lower)) return 'mr';
    if (/\b(marhaba|shukran|afwan|kayf|halik|musaada)\b/.test(lower)) return 'ar';

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
    callHistory: any = [],
    customerContext?: CustomerContext
  ): Promise<{
    answer: string;
    sources: GroundedSource[];
    isGrounded: boolean;
    requiresTransfer: boolean;
    language: string;
    confidence: number;
    isConflict?: boolean;
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
        confidence: 1.0,
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

    // Format history for knowledge service
    const formattedHistory: Array<{ role: 'user' | 'assistant'; content: string }> = Array.isArray(callHistory)
      ? callHistory.map((item: any) => ({
        role: (item.role || item.sender === 'customer' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: item.content || item.text || ''
      })).filter(h => h.content)
      : [];

    // Query KnowledgeService with english representation, multi-turn history, and live customerContext
    const grounded = await knowledgeService.answerQuery(englishQuery, formattedHistory, customerContext);

    // Localize answer back to customer's language
    let localizedAnswer = grounded.answer;
    if (normLang !== 'en' && localizedAnswer) {
      localizedAnswer = await this.translateText(localizedAnswer, normLang, 'en');
    }

    return {
      answer: localizedAnswer,
      sources: grounded.sources || [],
      isGrounded: grounded.isGrounded,
      requiresTransfer: grounded.requiresTransfer,
      language: normLang,
      confidence: grounded.confidence || 0.8,
      isConflict: grounded.isConflict,
      latencyMs: Date.now() - t0
    };
  }

  // Grounded Copilot Suggestion for Live Human Agent Dashboard
  public async getCopilotSuggestion(
    query: string,
    customerLang: string = 'en',
    callHistory: any = [],
    customerContext?: CustomerContext
  ): Promise<{
    answer: string;
    sources: GroundedSource[];
    isGrounded: boolean;
    requiresTransfer: boolean;
    language: string;
    confidence: number;
    isConflict?: boolean;
    latencyMs: number;
  }> {
    const t0 = Date.now();
    const trimmed = (query || '').trim();
    if (!trimmed) {
      return {
        answer: COPILOT_NOT_FOUND_MESSAGE,
        sources: [],
        isGrounded: false,
        requiresTransfer: false,
        language: customerLang,
        confidence: 0,
        latencyMs: 0
      };
    }

    const detectedLang = this.detectLanguage(trimmed);
    let normLang = (customerLang || 'en').toLowerCase().slice(0, 2);
    if (detectedLang !== 'en' && detectedLang !== normLang) {
      normLang = detectedLang;
    }

    let englishQuery = trimmed;
    if (detectedLang !== 'en') {
      englishQuery = await this.translateText(trimmed, 'en', detectedLang);
    }

    const formattedHistory: Array<{ role: 'user' | 'assistant'; content: string }> = Array.isArray(callHistory)
      ? callHistory.map((item: any) => ({
        role: (item.role || item.sender === 'customer' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: item.content || item.text || ''
      })).filter(h => h.content)
      : [];

    const copilotResp = await knowledgeService.getCopilotSuggestion(englishQuery, formattedHistory, customerContext);

    let localizedAnswer = copilotResp.answer;
    if (normLang !== 'en' && localizedAnswer && localizedAnswer !== COPILOT_NOT_FOUND_MESSAGE) {
      localizedAnswer = await this.translateText(localizedAnswer, normLang, 'en');
    }

    return {
      answer: localizedAnswer,
      sources: copilotResp.sources || [],
      isGrounded: copilotResp.isGrounded,
      requiresTransfer: copilotResp.requiresTransfer,
      language: normLang,
      confidence: copilotResp.confidence,
      isConflict: copilotResp.isConflict,
      latencyMs: Date.now() - t0
    };
  }
}

export const translationService = new TranslationService();
