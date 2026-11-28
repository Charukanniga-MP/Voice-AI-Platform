import { prisma } from '../db.js';
import { translationService } from './translation.js';
import { knowledgeService } from './knowledge.js';
import { SentimentAnalysisResult } from './sentiment.js';

export type HandoverReason =
  | 'Customer Frustration'
  | 'Unknown Question'
  | 'Knowledge Base Missing Information'
  | 'Repeated Unresolved Query'
  | 'Customer Explicitly Requested Human Support';

export interface HandoverEvaluation {
  shouldTransfer: boolean;
  reason?: HandoverReason;
  detailedReason?: string;
  verbalAnnouncement?: string;
  isUnknownQuestion: boolean;
  isFrustrated: boolean;
  isRepeatedComplaint: boolean;
  isExplicitRequest: boolean;
}

export interface HandoverThresholds {
  strongFrustrationConfidence: number; // e.g. 0.78
  repeatedComplaintsCount: number;     // e.g. 2
  groundedConfidenceThreshold: number; // e.g. 0.70
  supportPhoneNumber: string;
}

class HandoverService {
  // Configurable thresholds with environment overrides
  private thresholds: HandoverThresholds = {
    strongFrustrationConfidence: parseFloat(process.env.HANDOVER_FRUSTRATION_THRESHOLD || '0.78'),
    repeatedComplaintsCount: parseInt(process.env.HANDOVER_COMPLAINTS_THRESHOLD || '2', 10),
    groundedConfidenceThreshold: parseFloat(process.env.HANDOVER_KB_CONFIDENCE_THRESHOLD || '0.70'),
    supportPhoneNumber: process.env.HUMAN_SUPPORT_PHONE_NUMBER || process.env.SUPPORT_PHONE_NUMBER || '+1 (555) 019-2834'
  };

  // Guard to prevent duplicate transfer requests per active call
  private activeHandoverLocks = new Map<string, {
    transferId?: string;
    initiatedAt: number;
    reason: HandoverReason;
    status: 'ringing' | 'connected' | 'callback_offered' | 'callback_scheduled';
  }>();

  public getThresholds(): HandoverThresholds {
    return { ...this.thresholds };
  }

  public setThresholds(updates: Partial<HandoverThresholds>): void {
    this.thresholds = { ...this.thresholds, ...updates };
  }

  public isTransferInProgress(callId: string): boolean {
    const lock = this.activeHandoverLocks.get(callId);
    if (!lock) return false;
    // Expire lock after 3 minutes if no resolution
    if (Date.now() - lock.initiatedAt > 180000) {
      this.activeHandoverLocks.delete(callId);
      return false;
    }
    return lock.status === 'ringing' || lock.status === 'connected';
  }

  public getActiveTransferLock(callId: string) {
    return this.activeHandoverLocks.get(callId);
  }

  public registerTransferInitiated(callId: string, reason: HandoverReason, transferId?: string): void {
    this.activeHandoverLocks.set(callId, {
      transferId,
      initiatedAt: Date.now(),
      reason,
      status: 'ringing'
    });
  }

  public updateTransferStatus(callId: string, status: 'ringing' | 'connected' | 'callback_offered' | 'callback_scheduled'): void {
    const lock = this.activeHandoverLocks.get(callId);
    if (lock) {
      lock.status = status;
    }
  }

  public clearTransferLock(callId: string): void {
    this.activeHandoverLocks.delete(callId);
  }

  /**
   * Evaluates whether a call should be handed over to a human representative
   */
  public async evaluateHandover(params: {
    queryText: string;
    callLang: string;
    sentimentResult: SentimentAnalysisResult;
    aiResponse: {
      answer: string;
      isGrounded: boolean;
      requiresTransfer: boolean;
      confidence?: number;
      sources?: any[];
    };
    callHistory?: any[];
  }): Promise<HandoverEvaluation> {
    const { queryText, callLang, sentimentResult, aiResponse, callHistory = [] } = params;
    const lowerQuery = queryText.toLowerCase().trim();

    // 1. Explicit request to speak with a human
    const explicitHumanRegex = /\b(speak\s+to|talk\s+to|connect(\s+me)?(\s+to)?|transfer(\s+me)?(\s+to)?|put\s+me\s+through\s+to|let\s+me\s+speak\s+to|want|need)\s+(an?\s+)?(admin|agent|human|person|representative|support|specialist|operator)\b/i;
    const isExplicitRequest = aiResponse.requiresTransfer ||
      explicitHumanRegex.test(queryText) ||
      /\b(human agent|live agent|human representative|transfer me|live person|talk to someone|speak with a human|i want to speak to a human|give me a person)\b/i.test(queryText);

    // 2. Customer Frustration & Anger Evaluation
    const sentimentCategory = (sentimentResult.sentiment || '').toUpperCase();
    const isAngryOrHighFrustration = (
      sentimentCategory === 'FRUSTRATED'
    ) || (
      sentimentCategory === 'NEGATIVE' && Boolean(sentimentResult.requiresHumanAssistance)
    ) || /\b(angry|furious|outraged|frustrated|frustrating|extremely frustrated|terrible service|horrible service|worst service|ridiculous|unacceptable|pathetic|disgusted|fed up|sick of this|damn|pissed|annoyed|irritated|hate this|not helpful|unhelpful|useless|waste of time)\b/i.test(queryText);

    // 3. Repeated Complaints / Persistent Dissatisfaction
    const frustrationCount = sentimentResult.frustrationCount || 0;
    const isRepeatedComplaint = frustrationCount >= this.thresholds.repeatedComplaintsCount ||
      (callHistory.filter((h: any) => /frustrated|negative/i.test(h.sentiment || '')).length >= 2) ||
      /\b(again and again|repeatedly|called multiple times|called several times|told you already|already told you|no one is helping|nobody helps|repeating the same|how many times|keep telling you|not listening)\b/i.test(queryText);

    // General negative sentiment
    const isNegativeOrDissatisfied = isAngryOrHighFrustration || isRepeatedComplaint || sentimentCategory === 'NEGATIVE';

    // 4. Unknown Question / Knowledge Base Limitations Evaluation
    const FALLBACK_INDICATORS = [
      "i apologize, but that specific company information is not currently available",
      "not currently available in our approved knowledge base",
      "i don't currently have that information",
      "i do not have access to that information",
      "information is not available"
    ];

    const lowerAnswer = (aiResponse.answer || '').toLowerCase();
    const isFallbackAnswer = FALLBACK_INDICATORS.some(ind => lowerAnswer.includes(ind));

    const isUnknownQuestion = (
      !aiResponse.isGrounded ||
      (typeof aiResponse.confidence === 'number' && aiResponse.confidence < this.thresholds.groundedConfidenceThreshold && (!aiResponse.sources || aiResponse.sources.length === 0)) ||
      isFallbackAnswer
    );

    // Distinguish between Missing KB Info (Company query) vs General Unsupported Question
    const isCompanySpecificQuery = /\b(kairas?|company|platform|subscription|pricing|refund|policy|policies|billing|tier|account|feature|features|service|services|headquarters|contact|api|integration)\b/i.test(queryText);

    // --- Decision Logic ---
    let shouldTransfer = false;
    let reason: HandoverReason | undefined;
    let detailedReason: string | undefined;
    let rawAnnouncement: string | undefined;

    if (isExplicitRequest) {
      shouldTransfer = true;
      reason = 'Customer Explicitly Requested Human Support';
      detailedReason = `Customer explicitly requested human support: "${queryText}"`;
      rawAnnouncement = aiResponse.answer && !isFallbackAnswer
        ? aiResponse.answer
        : "Certainly! I will connect you with a member of our human support team right away. Please hold for just a moment.";
    } else if (isRepeatedComplaint) {
      shouldTransfer = true;
      reason = 'Repeated Unresolved Query';
      detailedReason = `Customer has repeated unresolved complaints (${frustrationCount} complaints in session): "${queryText}"`;
      rawAnnouncement = "I understand this issue has not been resolved to your satisfaction. Let me connect you directly with a human specialist right now who can resolve this for you immediately. Please hold the line.";
    } else if (isAngryOrHighFrustration) {
      shouldTransfer = true;
      reason = 'Customer Frustration';
      detailedReason = `Customer expressed high frustration/anger (${sentimentCategory}, confidence: ${sentimentResult.confidenceScore}): "${queryText}"`;
      rawAnnouncement = "I understand your frustration, and I want to make sure your question is addressed properly. Let me connect you directly with a member of our human support team right away. Please hold for just a moment.";
    } else if (isUnknownQuestion && isCompanySpecificQuery && frustrationCount > 0) {
      // Only escalate missing company info if the customer is actively frustrated
      shouldTransfer = true;
      reason = 'Knowledge Base Missing Information';
      detailedReason = `Specific company/product information is missing from the Knowledge Base: "${queryText}"`;
      rawAnnouncement = "I'm sorry, I don't have that specific information right now. Let me connect you with one of our representatives who can assist you.";
    }

    let verbalAnnouncement = rawAnnouncement;
    if (shouldTransfer && rawAnnouncement && callLang !== 'en') {
      try {
        verbalAnnouncement = await translationService.translateText(rawAnnouncement, callLang, 'en');
      } catch (err) {
        console.warn('[HandoverService] Translation error for announcement:', err);
      }
    }

    return {
      shouldTransfer,
      reason,
      detailedReason,
      verbalAnnouncement,
      isUnknownQuestion,
      isFrustrated: isAngryOrHighFrustration,
      isRepeatedComplaint,
      isExplicitRequest
    };
  }

  /**
   * Generates a callback offer message when human staff is unavailable
   */
  public async generateCallbackOfferMessage(
    lang: string = 'en',
    customerPhone?: string | null,
    prefixAnnouncement?: string
  ): Promise<string> {
    const callbackPart = customerPhone
      ? `All of our human representatives are currently assisting other callers. Would you like me to arrange a priority callback for you at ${customerPhone}? If you prefer another number, please let me know.`
      : "All of our human representatives are currently assisting other callers. Would you like me to arrange a priority callback for you? You can confirm your phone number, and a representative will call you back as soon as possible.";

    let msg = prefixAnnouncement
      ? `${prefixAnnouncement} ${callbackPart}`
      : callbackPart;

    if (lang !== 'en') {
      try {
        msg = await translationService.translateText(msg, lang, 'en');
      } catch (err) {
        console.warn('[HandoverService] Callback offer translation error:', err);
      }
    }
    return msg;
  }

  /**
   * Generates confirmation message once callback is booked
   */
  public async generateCallbackConfirmationMessage(phone: string, lang: string = 'en'): Promise<string> {
    let msg = `Thank you! I have scheduled a priority callback to ${phone}. A human representative will reach out to you as soon as possible. Is there anything else I can help you with in the meantime?`;
    if (lang !== 'en') {
      try {
        msg = await translationService.translateText(msg, lang, 'en');
      } catch (err) {
        console.warn('[HandoverService] Callback confirmation translation error:', err);
      }
    }
    return msg;
  }
}

export const handoverService = new HandoverService();
