import { prisma } from '../db.js';

export type SentimentCategory = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'FRUSTRATED';

export interface SentimentAnalysisResult {
  sentiment: SentimentCategory;
  confidenceScore: number; // 0.00 to 1.00
  reason: string;
  triggerText: string;
  requiresHumanAssistance: boolean;
  language: string;
  frustrationCount: number;
}

export interface CallSentimentSummary {
  overallSentiment: SentimentCategory;
  customerExperience: string;
  frustrationDetected: boolean;
  humanAssistanceRecommended: boolean;
  confidenceScore: number;
  totalCustomerMessages: number;
  breakdown: {
    positive: number;
    negative: number;
    neutral: number;
    frustrated: number;
  };
}

// In-memory call session sentiment state tracker
interface CallSentimentState {
  callId: string;
  callRecordId?: string;
  customerId?: string | null;
  history: Array<{
    text: string;
    sentiment: SentimentCategory;
    score: number;
    timestamp: Date;
  }>;
  frustrationCount: number;
  assistanceTriggered: boolean;
  assistanceStatus: 'none' | 'pending' | 'accepted' | 'dismissed';
}

const activeCallStates = new Map<string, CallSentimentState>();

// Multilingual Sentiment Lexicon & Patterns
const LEXICONS = {
  // English
  en: {
    frustrated: [
      'very frustrating', 'extremely frustrating', 'frustrated', 'frustrating',
      'nobody is helping', 'no one is helping', 'no one helps', 'nobody helps',
      'called several times', 'called multiple times', 'calling again and again',
      'waste of time', 'wasting my time', 'worst service', 'terrible service',
      'horrible service', 'fed up', 'sick and tired', 'angry', 'ridiculous',
      'unacceptable', 'pathetic', 'scam', 'fraud', 'shouting', 'speak to a human',
      'connect me to a person', 'transfer to human', 'talk to real person',
      'useless bot', 'useless', 'so annoying', 'disaster'
    ],
    negative: [
      'not satisfied', 'dissatisfied', 'bad', 'poor', 'slow', 'delayed',
      'problem', 'issue', 'broken', 'error', 'wrong', 'mistake', 'not working',
      'complaint', 'complain', 'failed', 'failure', 'disappointed', 'unhappy',
      'cancel', 'refund', 'not good', 'late', 'difficulty', 'trouble'
    ],
    positive: [
      'thank you', 'thanks', 'very helpful', 'helpful', 'great', 'excellent',
      'wonderful', 'satisfied', 'satisfying', 'awesome', 'amazing', 'perfect',
      'good job', 'love this', 'appreciated', 'resolved', 'brilliant',
      'superb', 'best service', 'pleased', 'delighted', 'fantastic', 'glad'
    ],
    neutral: [
      'status of my order', 'order status', 'where is my', 'what is',
      'how much', 'pricing', 'price', 'tell me', 'information', 'details',
      'how to', 'can i', 'check', 'balance', 'account', 'hours', 'location',
      'address', 'contact', 'query', 'know more'
    ]
  },

  // Tamil (தமிழ்)
  ta: {
    frustrated: [
      'மிகவும் எரிச்சலூட்டுகிறது', 'எரிச்சலூட்டுகிறது', 'யாரும் உதவவில்லை',
      'மோசமான சேவை', 'நேர விரயம்', 'நேரத்தை வீணடிக்கிறீர்கள்',
      'பலமுறை அழைத்தேன்', 'திரும்ப திரும்ப அழைக்கிறேன்', 'பயனில்லை',
      'கோபமாக இருக்கிறது', 'மிகவும் மோசம்', 'ஏமாற்றம்', 'அசிங்கம்',
      'உண்மையான மனிதரிடம் பேசு', 'மேலாளரிடம் பேசு', 'கோபம்'
    ],
    negative: [
      'திருப்தி இல்லை', 'சரியாக இல்லை', 'பிரச்சினை', 'தாமதம்',
      'வேலை செய்யவில்லை', 'மோசம்', 'தவறு', 'பிழை', 'சிக்கல்',
      'புகார்', 'பணம் திரும்ப', 'ரத்து செய்'
    ],
    positive: [
      'நன்றி', 'மிக்க நன்றி', 'மிகவும் உதவியாக இருந்தது', 'உதவியாக',
      'அருமை', 'சிறந்த சேவை', 'மகிழ்ச்சி', 'நல்லது', 'மிகவும் நல்லது',
      'திருப்தி', 'பாராட்டுகிறேன்', 'சூப்பர்'
    ],
    neutral: [
      'நிலை என்ன', 'ஆர்டர் நிலை', 'விலை என்ன', 'தகவல் வேண்டும்',
      'விவரம்', 'எப்படி', 'எங்கு உள்ளது', 'நேரம்', 'தெரிந்துகொள்ள வேண்டும்'
    ]
  },

  // Hindi (हिन्दी)
  hi: {
    frustrated: [
      'बहुत परेशान', 'परेशान', 'कोई मदद नहीं कर रहा', 'कोई सहायता नहीं',
      'घटिया सेवा', 'समय की बर्बादी', 'समय बर्बाद', 'कई बार कॉल किया',
      'बार-बार कॉल', 'बकवास', 'बेकार सेवा', 'गुस्सा आ रहा है',
      'इंसान से बात कराओ', 'किसी व्यक्ति से बात कराओ', 'धोखा', 'बहुत बेकार'
    ],
    negative: [
      'संतुष्ट नहीं हूँ', 'संतुष्ट नहीं', 'खराब', 'समस्या', 'दिक्कत',
      'देरी', 'काम नहीं कर रहा', 'गलत', 'शिकायत', 'रद्द करें', 'पैसे वापस'
    ],
    positive: [
      'धन्यवाद', 'बहुत-बहुत धन्यवाद', 'बहुत मददगार', 'सहायक',
      'बहुत अच्छा', 'शानदार', 'संतुष्ट', 'बढ़िया', 'उत्कृष्ट', 'अच्छा लगा'
    ],
    neutral: [
      'स्थिति क्या है', 'ऑर्डर की स्थिति', 'जानकारी चाहिए', 'विवरण',
      'कीमत कितनी है', 'कहाँ है', 'समय क्या है', 'कैसे करना है'
    ]
  },

  // Telugu (తెలుగు)
  te: {
    frustrated: [
      'చాలా విసుగుగా ఉంది', 'విసుగు', 'ఎవరూ సహాయం చేయడం లేదు',
      'చెత్త సేవ', 'సమయం వృధా', 'చాలా సార్లు కాల్ చేశాను',
      'మళ్ళీ మళ్ళీ కాల్', 'వ్యర్థం', 'కోపంగా ఉంది', 'మనిషితో మాట్లాడాలి',
      'ఏజెంట్‌తో మాట్లాడాలి', 'ఏమీ ఉపయోగం లేదు'
    ],
    negative: [
      'సంతృప్తిగా లేదు', 'సమస్య', 'ఆలస్యం', 'బాగోలేదు',
      'పనిచేయడం లేదు', 'తప్పు', 'ఫిర్యాదు', 'రద్దు చేయండి'
    ],
    positive: [
      'ధన్యవాదాలు', 'చాలా సహాయపడింది', 'చాలా బాగుంది',
      'అద్భుతం', 'సంతృప్తి', 'చాలా మంచిది', 'సంతోషం'
    ],
    neutral: [
      'స్థితి ఏమిటి', 'ఆర్డర్ స్థితి', 'సమాచారం కావాలి',
      'వివరాలు', 'ధర ఎంత', 'ఎక్కడ ఉంది', 'సమయం'
    ]
  },

  // Malayalam (മലയാളം)
  ml: {
    frustrated: [
      'വളരെ നിരാശാജനകമാണ്', 'നിരാശ', 'ആരും സഹായിക്കുന്നില്ല',
      'മോശം സേവനം', 'സമയം പാഴാക്കൽ', 'പലതവണ വിളിച്ചു',
      'വീണ്ടും വീണ്ടും വിളിക്കുന്നു', 'ദേഷ്യം വരുന്നു', 'വെറുത്തുപോയി',
      'ഒരു മനുഷ്യനോട് സംസാരിക്കണം', 'ഉപകാരമില്ല'
    ],
    negative: [
      'തൃപ്തിയില്ല', 'പ്രശ്നം', 'താമസം', 'ശരിയല്ല',
      'വർക്ക് ചെയ്യുന്നില്ല', 'തെറ്റാണ്', 'പരാതി', 'റദ്ദാക്കുക'
    ],
    positive: [
      'നന്ദി', 'വളരെ നന്ദി', 'വളരെ സഹായകരമായി', 'വളരെ നല്ലത്',
      'മികച്ചത്', 'സന്തോഷം', 'തൃപ്തികരമാണ്', 'കൊള്ളാം'
    ],
    neutral: [
      'നില എന്താണ്', 'ഓർഡർ നില', 'വിവരം വേണം',
      'വിശദാംശങ്ങൾ', 'വില എത്ര', 'എവിടെയാണ്', 'സമയം'
    ]
  }
};

export class SentimentAnalysisService {
  /**
   * Core sentiment analysis function for customer utterances.
   * Analyzes customer text, detects category, confidence, and generates rationale.
   */
  public analyzeText(text: string, language: string = 'en'): {
    sentiment: SentimentCategory;
    confidenceScore: number;
    reason: string;
    isStrongFrustration: boolean;
  } {
    if (!text || !text.trim()) {
      return {
        sentiment: 'NEUTRAL',
        confidenceScore: 0.5,
        reason: 'Empty speech received',
        isStrongFrustration: false
      };
    }

    const cleanText = text.trim().toLowerCase();
    const langKey = (language in LEXICONS ? language : 'en') as keyof typeof LEXICONS;
    const lexicon = LEXICONS[langKey];
    const enLexicon = LEXICONS.en;

    // 1. Scoring buckets
    let frustratedScore = 0;
    let negativeScore = 0;
    let positiveScore = 0;
    let neutralScore = 0;
    const matchedPhrases: string[] = [];

    // Check language-specific + English fallback patterns
    const checkPhrases = (phrases: string[], weight: number, callback: (match: string) => void) => {
      for (const phrase of phrases) {
        if (cleanText.includes(phrase.toLowerCase())) {
          matchedPhrases.push(phrase);
          callback(phrase);
        }
      }
    };

    // --- Frustration Detection ---
    checkPhrases(lexicon.frustrated, 3.5, () => {
      frustratedScore += 3.5;
    });
    if (langKey !== 'en') {
      checkPhrases(enLexicon.frustrated, 3.0, () => {
        frustratedScore += 3.0;
      });
    }

    // Repeated exclamation marks or extreme punctuation increases frustration
    if (/[!?]{2,}/.test(text)) {
      frustratedScore += 1.5;
    }

    // ALL CAPS words in English indicate shouting/frustration
    const words = text.split(/\s+/);
    const upperWords = words.filter(w => w.length > 2 && w === w.toUpperCase() && /[A-Z]/.test(w));
    if (upperWords.length >= 2) {
      frustratedScore += 1.2;
    }

    // --- Negative Detection ---
    checkPhrases(lexicon.negative, 2.0, () => {
      negativeScore += 2.0;
    });
    if (langKey !== 'en') {
      checkPhrases(enLexicon.negative, 1.8, () => {
        negativeScore += 1.8;
      });
    }

    // --- Positive Detection ---
    checkPhrases(lexicon.positive, 2.0, () => {
      positiveScore += 2.0;
    });
    if (langKey !== 'en') {
      checkPhrases(enLexicon.positive, 1.8, () => {
        positiveScore += 1.8;
      });
    }

    // Negation flipping: "not satisfied" should boost negative, "not bad" boosts positive
    if (/\b(not|never|no)\s+(satisfied|happy|good|helpful)/i.test(cleanText)) {
      negativeScore += 2.5;
      positiveScore = Math.max(0, positiveScore - 2.0);
    }
    if (/\b(not|no)\s+(bad|problem|issue)/i.test(cleanText)) {
      positiveScore += 1.5;
      negativeScore = Math.max(0, negativeScore - 1.5);
    }

    // --- Neutral Detection ---
    checkPhrases(lexicon.neutral, 1.5, () => {
      neutralScore += 1.5;
    });

    // 2. Classify Category based on scores
    let sentiment: SentimentCategory = 'NEUTRAL';
    let confidence = 0.70;
    let reason = 'Inquiry or informational conversation without strong sentiment markers.';
    let isStrongFrustration = false;

    if (frustratedScore >= 3.0) {
      sentiment = 'FRUSTRATED';
      confidence = Math.min(0.98, 0.78 + (frustratedScore * 0.05));
      isStrongFrustration = frustratedScore >= 4.0;
      reason = `Customer expressed strong frustration, anger, or repeated complaints (matched: "${matchedPhrases.slice(0, 2).join('", "')}").`;
    } else if (frustratedScore > 1.5 && negativeScore > 1.5) {
      sentiment = 'FRUSTRATED';
      confidence = 0.85;
      reason = 'Combined negative and exasperation markers detected.';
    } else if (negativeScore > positiveScore && negativeScore >= 1.8) {
      sentiment = 'NEGATIVE';
      confidence = Math.min(0.95, 0.75 + (negativeScore * 0.06));
      reason = `Customer expressed dissatisfaction or issues (matched: "${matchedPhrases.slice(0, 2).join('", "')}").`;
    } else if (positiveScore > negativeScore && positiveScore >= 1.8) {
      sentiment = 'POSITIVE';
      confidence = Math.min(0.96, 0.76 + (positiveScore * 0.06));
      reason = `Customer expressed appreciation or satisfaction (matched: "${matchedPhrases.slice(0, 2).join('", "')}").`;
    } else {
      sentiment = 'NEUTRAL';
      confidence = 0.82;
      reason = 'Informational inquiry or standard customer dialogue.';
    }

    return {
      sentiment,
      confidenceScore: Math.round(confidence * 100) / 100,
      reason,
      isStrongFrustration
    };
  }

  /**
   * Record and process a customer speech utterance during an active call.
   * Updates state, database, and evaluates human assistance thresholds.
   */
  public async processCustomerUtterance(params: {
    callId: string;
    text: string;
    language?: string;
    customerId?: string | null;
  }): Promise<SentimentAnalysisResult> {
    const { callId, text, language = 'en', customerId } = params;

    // Retrieve or initialize call state
    let state = activeCallStates.get(callId);
    if (!state) {
      state = {
        callId,
        customerId,
        history: [],
        frustrationCount: 0,
        assistanceTriggered: false,
        assistanceStatus: 'none'
      };
      activeCallStates.set(callId, state);
    }

    // Analyze utterance
    const analysis = this.analyzeText(text, language);

    // Track utterance in session history
    state.history.push({
      text,
      sentiment: analysis.sentiment,
      score: analysis.confidenceScore,
      timestamp: new Date()
    });

    if (analysis.sentiment === 'FRUSTRATED') {
      state.frustrationCount += 1;
    }

    // Determine Human Assistance Priority:
    // 1. Strong frustration signal (confidence >= 0.85 and score >= 4.0), OR
    // 2. Repeated frustration (frustrationCount >= 2), OR
    // 3. Persistent negativity (>= 3 negative/frustrated messages)
    const negativeCount = state.history.filter(h => h.sentiment === 'NEGATIVE' || h.sentiment === 'FRUSTRATED').length;
    let requiresHumanAssistance = false;
    let assistanceReason = '';

    if (state.frustrationCount >= 2) {
      requiresHumanAssistance = true;
      assistanceReason = `Repeated frustration signals detected (${state.frustrationCount} complaints in call).`;
    } else if (analysis.isStrongFrustration && analysis.confidenceScore >= 0.82) {
      requiresHumanAssistance = true;
      assistanceReason = `Severe customer dissatisfaction or complaint detected: "${text.slice(0, 75)}..."`;
    } else if (negativeCount >= 3) {
      requiresHumanAssistance = true;
      assistanceReason = `Persistent negative sentiment (${negativeCount} consecutive dissatisfied remarks).`;
    }

    if (requiresHumanAssistance) {
      state.assistanceTriggered = true;
    }

    // Persist to database if callRecord exists
    try {
      const call = await prisma.callRecord.findUnique({ where: { callId } });
      if (call) {
        state.callRecordId = call.id;

        await prisma.sentimentAnalysis.create({
          data: {
            callRecordId: call.id,
            customerId: customerId || call.customerId,
            sentiment: analysis.sentiment,
            confidenceScore: analysis.confidenceScore,
            reason: analysis.reason,
            triggerText: text,
            language,
            requiresHumanAssistance,
            isFinal: false
          }
        });

        // Update call record if human assistance is recommended
        if (requiresHumanAssistance && !call.requiresAssistance) {
          await prisma.callRecord.update({
            where: { id: call.id },
            data: {
              requiresAssistance: true,
              assistanceReason,
              assistanceStatus: 'pending'
            }
          });
        }
      }
    } catch (err) {
      console.error('[Sentiment] Error persisting sentiment record:', err);
    }

    return {
      sentiment: analysis.sentiment,
      confidenceScore: analysis.confidenceScore,
      reason: analysis.reason,
      triggerText: text,
      requiresHumanAssistance,
      language,
      frustrationCount: state.frustrationCount
    };
  }

  /**
   * Finalize sentiment analysis when a call ends.
   * Produces a post-call summary and saves the final aggregate record.
   */
  public async finalizeCall(callId: string): Promise<CallSentimentSummary | null> {
    const state = activeCallStates.get(callId);
    
    // Look up call in DB
    const call = await prisma.callRecord.findUnique({
      where: { callId },
      include: {
        sentimentRecords: true,
        transcripts: {
          where: { sender: 'customer' }
        }
      }
    });

    if (!call) return null;

    // Use in-memory history or DB records
    const records = call.sentimentRecords.length > 0
      ? call.sentimentRecords.map(r => ({
          sentiment: r.sentiment as SentimentCategory,
          score: r.confidenceScore,
          text: r.triggerText || ''
        }))
      : state?.history || [];

    const breakdown = {
      positive: 0,
      negative: 0,
      neutral: 0,
      frustrated: 0
    };

    records.forEach(r => {
      const key = r.sentiment.toLowerCase() as keyof typeof breakdown;
      if (key in breakdown) {
        breakdown[key] += 1;
      }
    });

    const total = records.length;
    let overallSentiment: SentimentCategory = 'NEUTRAL';
    let customerExperience = 'Customer inquiry handled normally without emotional distress.';
    let frustrationDetected = breakdown.frustrated > 0;
    let humanAssistanceRecommended = call.requiresAssistance || (state?.assistanceTriggered ?? false);

    if (
      breakdown.frustrated >= 2 ||
      (breakdown.frustrated >= 1 && (call.requiresAssistance || (state?.assistanceTriggered ?? false) || breakdown.frustrated >= breakdown.negative)) ||
      (total > 0 && breakdown.frustrated / total >= 0.33)
    ) {
      overallSentiment = 'FRUSTRATED';
      customerExperience = 'Customer experienced notable frustration or repeated unresolved issues.';
      frustrationDetected = true;
      humanAssistanceRecommended = true;
    } else if (breakdown.negative > breakdown.positive && breakdown.negative >= 1) {
      overallSentiment = 'NEGATIVE';
      customerExperience = 'Customer expressed dissatisfaction or issues during the interaction.';
    } else if (breakdown.positive > breakdown.negative && breakdown.positive >= 1) {
      overallSentiment = 'POSITIVE';
      customerExperience = 'Customer was satisfied and appreciated the assistance provided.';
    } else if (total > 0) {
      overallSentiment = 'NEUTRAL';
      customerExperience = 'Customer inquiry completed with standard informational exchange.';
    }

    const avgScore = total > 0
      ? Math.round((records.reduce((acc, r) => acc + r.score, 0) / total) * 100) / 100
      : 0.85;

    // Persist final aggregate record in database
    try {
      await prisma.sentimentAnalysis.create({
        data: {
          callRecordId: call.id,
          customerId: call.customerId,
          sentiment: overallSentiment,
          confidenceScore: avgScore,
          reason: `Post-call aggregate evaluation of ${total} customer utterances.`,
          triggerText: records[records.length - 1]?.text || 'End of Call',
          language: call.language || 'en',
          requiresHumanAssistance: humanAssistanceRecommended,
          isFinal: true,
          customerExperienceNote: customerExperience
        }
      });

      await prisma.callRecord.update({
        where: { id: call.id },
        data: {
          overallSentiment,
          sentimentScore: avgScore,
          requiresAssistance: humanAssistanceRecommended,
          assistanceReason: humanAssistanceRecommended
            ? call.assistanceReason || 'Post-call frustration analysis recommended human follow-up.'
            : null
        }
      });
    } catch (err) {
      console.error('[Sentiment] Error storing post-call summary:', err);
    }

    // Clean up memory
    activeCallStates.delete(callId);

    return {
      overallSentiment,
      customerExperience,
      frustrationDetected,
      humanAssistanceRecommended,
      confidenceScore: avgScore,
      totalCustomerMessages: total,
      breakdown
    };
  }

  /**
   * Manually override or acknowledge human assistance recommendation.
   */
  public async overrideAssistance(callId: string, status: 'accepted' | 'dismissed' | 'pending', agentId?: string): Promise<boolean> {
    const state = activeCallStates.get(callId);
    if (state) {
      state.assistanceStatus = status;
    }

    try {
      const call = await prisma.callRecord.findUnique({ where: { callId } });
      if (call) {
        await prisma.callRecord.update({
          where: { id: call.id },
          data: {
            assistanceStatus: status
          }
        });
        return true;
      }
    } catch (err) {
      console.error('[Sentiment] Error updating assistance override:', err);
    }
    return false;
  }

  /**
   * Get active live sentiment state for a call.
   */
  public getLiveCallSentiment(callId: string): SentimentAnalysisResult | null {
    const state = activeCallStates.get(callId);
    if (!state || state.history.length === 0) return null;

    const latest = state.history[state.history.length - 1];
    return {
      sentiment: latest.sentiment,
      confidenceScore: latest.score,
      reason: `Live call latest customer utterance sentiment.`,
      triggerText: latest.text,
      requiresHumanAssistance: state.assistanceTriggered,
      language: 'en',
      frustrationCount: state.frustrationCount
    };
  }
}

export const sentimentService = new SentimentAnalysisService();
