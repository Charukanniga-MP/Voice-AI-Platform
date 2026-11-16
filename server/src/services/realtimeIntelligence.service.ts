/**
 * KAIRA Voice AI Platform - Real-Time Conversation Intelligence Service
 * Analyzes active call speech asynchronously without blocking live voice/WebRTC audio.
 * Detects customer primary intent, repeated questions, unresolved concerns,
 * human takeover requests, and key entities for live agent monitoring.
 */

export interface LiveCustomerInsight {
  callId: string;
  timestamp: string;
  sender: 'customer' | 'agent' | 'ai';
  latestUtterance: string;
  primaryIntent: string;
  isRepeatedQuestion: boolean;
  repeatedQuestionText?: string;
  repeatCount: number;
  unresolvedConcerns: string[];
  requestsHumanAssistance: boolean;
  importantInfoForAgent: {
    orderIds?: string[];
    phoneNumbers?: string[];
    ticketIds?: string[];
    urgencyLevel: 'normal' | 'high' | 'urgent';
    keyEntities: string[];
  };
  recommendedLiveGuidance?: string;
}

interface CallDialogueMemory {
  customerQuestions: string[];
  intentsCount: Record<string, number>;
  unresolvedMarkers: string[];
  humanRequested: boolean;
  entities: Set<string>;
  lastUpdated: number;
}

export class RealtimeIntelligenceService {
  private callMemories = new Map<string, CallDialogueMemory>();

  /**
   * Main non-blocking entry point to analyze a single turn
   */
  public async analyzeTurn(params: {
    callId: string;
    text: string;
    language?: string;
    customerId?: string | null;
    sender?: 'customer' | 'agent' | 'ai';
  }): Promise<LiveCustomerInsight | null> {
    const { callId, text } = params;
    const cleanText = (text || '').trim();
    if (!cleanText) return null;

    let memory = this.callMemories.get(callId);
    if (!memory) {
      memory = {
        customerQuestions: [],
        intentsCount: {},
        unresolvedMarkers: [],
        humanRequested: false,
        entities: new Set(),
        lastUpdated: Date.now()
      };
      this.callMemories.set(callId, memory);
    }
    memory.lastUpdated = Date.now();

    const lower = cleanText.toLowerCase();

    // 1. Primary Intent Detection
    const primaryIntent = this.detectPrimaryIntent(lower);
    memory.intentsCount[primaryIntent] = (memory.intentsCount[primaryIntent] || 0) + 1;

    // 2. Question & Repetition Detection
    const isQuestion =
      cleanText.includes('?') ||
      /^(what|how|why|when|where|who|can|could|is|are|do|does|will|would|tell me)/i.test(lower) ||
      /[\u0B80-\u0BFF\u0900-\u097F\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F]/.test(cleanText);

    let isRepeated = false;
    let repeatedQuestionText: string | undefined;
    let repeatCount = 1;

    if (isQuestion && cleanText.length > 5) {
      const normalizedCurrent = this.normalizeQuestion(lower);
      for (const prevQ of memory.customerQuestions) {
        const normalizedPrev = this.normalizeQuestion(prevQ.toLowerCase());
        const similarity = this.calculateSimilarity(normalizedCurrent, normalizedPrev);
        if (similarity >= 0.65 || (normalizedCurrent.length > 8 && normalizedPrev.includes(normalizedCurrent))) {
          isRepeated = true;
          repeatedQuestionText = prevQ;
          repeatCount++;
        }
      }
      memory.customerQuestions.push(cleanText);
    }

    // 3. Human Assistance Request Detection (Multilingual)
    const requestsHuman = this.detectHumanAssistanceRequest(lower, cleanText);
    if (requestsHuman) {
      memory.humanRequested = true;
    }

    // 4. Unresolved Concerns Detection
    const unresolvedIndicators = [
      'still not working', 'not working', 'not resolved', 'didn\'t answer',
      'does not help', 'did not help', 'error again', 'failed again',
      'why is it', 'wrong bill', 'not happy', 'useless', 'waste of time',
      'முடியவில்லை', 'வேலை செய்யவில்லை', 'काम नहीं कर रहा', 'పనిచేయడం లేదు'
    ];
    for (const indicator of unresolvedIndicators) {
      if (lower.includes(indicator) && !memory.unresolvedMarkers.includes(indicator)) {
        memory.unresolvedMarkers.push(indicator);
      }
    }

    // 5. Important Entities Extraction
    const orderMatch = cleanText.match(/(?:order\s*(?:id|#|no)?|id|#)\s*[:#-]?\s*([a-z0-9_-]{4,15})/i);
    const phoneMatch = cleanText.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
    const ticketMatch = cleanText.match(/(?:ticket|tkt|issue)\s*[:#-]?\s*(\d{4,8})/i);

    const orderIds: string[] = [];
    if (orderMatch) {
      const oid = orderMatch[1].toUpperCase();
      orderIds.push(oid);
      memory.entities.add(`Order #${oid}`);
    }

    const phoneNumbers: string[] = [];
    if (phoneMatch) {
      phoneNumbers.push(phoneMatch[0]);
      memory.entities.add(`Phone: ${phoneMatch[0]}`);
    }

    const ticketIds: string[] = [];
    if (ticketMatch) {
      ticketIds.push(ticketMatch[1]);
      memory.entities.add(`Ticket #${ticketMatch[1]}`);
    }

    // Urgency Level
    let urgencyLevel: 'normal' | 'high' | 'urgent' = 'normal';
    if (memory.humanRequested || lower.includes('urgent') || lower.includes('emergency') || repeatCount >= 3) {
      urgencyLevel = 'urgent';
    } else if (isRepeated || memory.unresolvedMarkers.length > 0 || lower.includes('asap') || lower.includes('complaint')) {
      urgencyLevel = 'high';
    }

    // Contextual Live Guidance for Human Agent
    let guidance = 'Customer inquiring normally. Standard AI handling.';
    if (memory.humanRequested) {
      guidance = 'Customer explicitly requested human intervention. Immediate takeover recommended.';
    } else if (repeatCount >= 2) {
      guidance = `Customer has asked about "${primaryIntent}" ${repeatCount} times. Provide direct specific answer or offer live assistance.`;
    } else if (memory.unresolvedMarkers.length > 0) {
      guidance = 'Customer expressing frustration with unresolved concern. Prioritize empathy and swift resolution.';
    } else if (orderIds.length > 0) {
      guidance = `Order ID ${orderIds[0]} referenced. Check logistics fulfillment state.`;
    } else if (primaryIntent === 'Pricing & Plans') {
      guidance = 'High intent buyer exploring plans. Highlight Starter ($49), Professional ($199), or Enterprise tiers.';
    }

    // Clean up stale memory entries periodically
    if (this.callMemories.size > 200) {
      const now = Date.now();
      for (const [cId, mem] of this.callMemories.entries()) {
        if (now - mem.lastUpdated > 3600000) {
          this.callMemories.delete(cId);
        }
      }
    }

    return {
      callId,
      timestamp: new Date().toISOString(),
      sender: params.sender || 'customer',
      latestUtterance: cleanText,
      primaryIntent,
      isRepeatedQuestion: isRepeated,
      repeatedQuestionText,
      repeatCount,
      unresolvedConcerns: [...memory.unresolvedMarkers],
      requestsHumanAssistance: memory.humanRequested,
      importantInfoForAgent: {
        orderIds: orderIds.length > 0 ? orderIds : undefined,
        phoneNumbers: phoneNumbers.length > 0 ? phoneNumbers : undefined,
        ticketIds: ticketIds.length > 0 ? ticketIds : undefined,
        urgencyLevel,
        keyEntities: Array.from(memory.entities)
      },
      recommendedLiveGuidance: guidance
    };
  }

  public getLiveInsights(callId: string): LiveCustomerInsight | null {
    const memory = this.callMemories.get(callId);
    if (!memory) return null;

    let dominantIntent = 'General Inquiry';
    let maxCount = 0;
    for (const [intent, count] of Object.entries(memory.intentsCount)) {
      if (count > maxCount) {
        maxCount = count;
        dominantIntent = intent;
      }
    }

    return {
      callId,
      timestamp: new Date(memory.lastUpdated).toISOString(),
      sender: 'customer',
      latestUtterance: memory.customerQuestions[memory.customerQuestions.length - 1] || 'Call in progress',
      primaryIntent: dominantIntent,
      isRepeatedQuestion: memory.customerQuestions.length > 1,
      repeatCount: memory.customerQuestions.length,
      unresolvedConcerns: memory.unresolvedMarkers,
      requestsHumanAssistance: memory.humanRequested,
      importantInfoForAgent: {
        urgencyLevel: memory.humanRequested ? 'urgent' : memory.unresolvedMarkers.length > 0 ? 'high' : 'normal',
        keyEntities: Array.from(memory.entities)
      },
      recommendedLiveGuidance: memory.humanRequested
        ? 'Customer requested human support. Takeover recommended.'
        : 'Active call monitored.'
    };
  }

  public clearCall(callId: string): void {
    this.callMemories.delete(callId);
  }

  private detectPrimaryIntent(lower: string): string {
    if (lower.includes('price') || lower.includes('cost') || lower.includes('plan') || lower.includes('subscription') || lower.includes('rate') || lower.includes('விலை') || lower.includes('கட்டணம்') || lower.includes('कीमत') || lower.includes('ధర')) {
      return 'Pricing & Plans';
    }
    if (lower.includes('order') || lower.includes('track') || lower.includes('delivery') || lower.includes('shipping') || lower.includes('package') || lower.includes('courier') || lower.includes('ஆர்டர்') || lower.includes('पार्सल')) {
      return 'Order & Delivery';
    }
    if (lower.includes('bill') || lower.includes('invoice') || lower.includes('refund') || lower.includes('deduct') || lower.includes('charge') || lower.includes('payment') || lower.includes('பணம்') || lower.includes('भुगतान')) {
      return 'Billing & Payment';
    }
    if (lower.includes('microphone') || lower.includes('audio') || lower.includes('webrtc') || lower.includes('hear') || lower.includes('disconnect') || lower.includes('broken') || lower.includes('error') || lower.includes('bug')) {
      return 'Technical Support';
    }
    if (lower.includes('password') || lower.includes('login') || lower.includes('reset') || lower.includes('account') || lower.includes('security') || lower.includes('lock')) {
      return 'Account & Security';
    }
    if (lower.includes('human') || lower.includes('agent') || lower.includes('operator') || lower.includes('supervisor') || lower.includes('person') || lower.includes('transfer')) {
      return 'Human Agent Assistance';
    }
    if (lower.includes('voicecore') || lower.includes('liveescalate') || lower.includes('omnichannel') || lower.includes('feature') || lower.includes('product')) {
      return 'Product Features';
    }
    return 'General Inquiry';
  }

  private detectHumanAssistanceRequest(lower: string, original: string): boolean {
    const englishPatterns = [
      'human', 'agent', 'operator', 'representative', 'supervisor', 'real person',
      'talk to a person', 'speak to a human', 'transfer me', 'escalate', 'connect me to someone'
    ];
    for (const p of englishPatterns) {
      if (lower.includes(p)) return true;
    }

    // Multilingual patterns
    const regionalPatterns = [
      'மனித', 'முகவர்', 'மேலாளர்', 'நேரடி', // Tamil
      'ఏజెంట్', 'మనిషి', 'మాట్లాడాలి', // Telugu
      'एजेंट', 'इंसान', 'बात करनी है', 'अधिकारी', // Hindi
      'ഏജന്റ്', 'മനുഷ്യൻ', 'സംസാരിക്കണം', // Malayalam
      'ಏಜೆಂಟ್', 'ಮಾನವ', 'ಮಾತನಾಡಬೇಕು' // Kannada
    ];
    for (const p of regionalPatterns) {
      if (original.includes(p)) return true;
    }

    return false;
  }

  private normalizeQuestion(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\b(what|how|why|when|where|who|is|are|the|a|an|please|can|you|tell|me|about)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private calculateSimilarity(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1.0;
    const words1 = new Set(str1.split(' ').filter(w => w.length > 2));
    const words2 = new Set(str2.split(' ').filter(w => w.length > 2));
    if (words1.size === 0 || words2.size === 0) return 0;

    let matchCount = 0;
    for (const w of words1) {
      if (words2.has(w)) matchCount++;
    }
    return (2 * matchCount) / (words1.size + words2.size);
  }
}

export const realtimeIntelligenceService = new RealtimeIntelligenceService();
