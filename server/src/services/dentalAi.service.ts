import { dentalAppointmentService, AvailableSlot } from './dentalAppointment.service.js';
import { prisma } from '../db.js';
import { translationService } from './translation.js';
import { dentalLlmService } from './dentalLlm.service.js';

export type DentalIntent =
  | 'BOOK_APPOINTMENT'
  | 'WISDOM_TOOTH_PAIN'
  | 'TOOTHACHE'
  | 'GUM_BLEEDING'
  | 'GUM_SWELLING'
  | 'TOOTH_SENSITIVITY'
  | 'BROKEN_TOOTH'
  | 'MISSING_TOOTH'
  | 'DENTAL_CLEANING'
  | 'CANCEL_APPOINTMENT'
  | 'RESCHEDULE_APPOINTMENT'
  | 'CHECK_AVAILABILITY'
  | 'DENTIST_INFORMATION'
  | 'CLINIC_INFORMATION'
  | 'URGENT_DENTAL_CONCERN'
  | 'GENERAL_CONVERSATION';

export type ConversationState =
  | 'GREETING'
  | 'IDENTIFY_INTENT'
  | 'COLLECT_PATIENT_DETAILS'
  | 'UNDERSTAND_DENTAL_COMPLAINT'
  | 'ASK_FOLLOWUP_QUESTIONS'
  | 'ASSESS_URGENCY'
  | 'OFFER_APPOINTMENT'
  | 'CHECK_AVAILABILITY'
  | 'CONFIRM_BOOKING'
  | 'BOOKING_COMPLETED'
  | 'HUMAN_ESCALATION';

export type ClinicalQuestionCategory =
  | 'CHIEF_COMPLAINT'
  | 'PAIN_LOCATION'
  | 'PAIN_TYPE'
  | 'PAIN_DURATION'
  | 'PAIN_PATTERN'
  | 'PAIN_SEVERITY'
  | 'ASSOCIATED_SYMPTOMS'
  | 'PREFERRED_DATE'
  | 'PREFERRED_TIME'
  | 'PATIENT_NAME'
  | 'PATIENT_PHONE';

export interface QuestionRecord {
  category: ClinicalQuestionCategory;
  questionText: string;
  askedAt: number;
  clarificationCount: number;
}

export interface ExtractedAnswerRecord {
  category: ClinicalQuestionCategory;
  rawText: string;
  extractedValue: any;
  extractedAt: number;
}

export interface ConversationTurn {
  sender: 'patient' | 'receptionist';
  text: string;
  timestamp: number;
}

export interface DentalConversationSession {
  callId: string;
  state: ConversationState;
  intent?: DentalIntent;
  complaintType?: DentalIntent;
  language: string;

  // Active discussed topic for pronoun and anaphora resolution
  activeDentalTopic?: string;

  // Multi-turn transcript memory
  turns: ConversationTurn[];

  // Question & Answer Tracker
  askedQuestions: QuestionRecord[];
  currentPendingQuestion?: QuestionRecord;
  answeredCategories: Set<ClinicalQuestionCategory>;
  extractedAnswers: Map<ClinicalQuestionCategory, ExtractedAnswerRecord>;

  // Clinical assessment information
  assessment: {
    chiefComplaint?: string;
    location?: string;
    painType?: string;
    duration?: string;
    pattern?: string;
    severity?: number;
    associatedSymptoms?: string[];
    triggers?: string;
    notes?: string;
  };

  // Patient details
  patientName?: string;
  patientPhone?: string;
  isFirstVisit?: boolean;

  // Booking details
  matchedSpecialization?: string;
  matchedServiceId?: string;
  matchedServiceName?: string;
  matchedDentistId?: string;
  matchedDentistName?: string;
  preferredDateStr?: string;
  availableSlots?: AvailableSlot[];
  selectedSlot?: AvailableSlot;
  confirmedBookingReference?: string;

  // Urgency
  isUrgentEscalation?: boolean;
  urgencyReason?: string;

  // Reschedule / Cancel details
  targetBookingReference?: string;

  updatedAt: number;
}

// In-memory conversation state store keyed by callId
const activeDentalSessions = new Map<string, DentalConversationSession>();

export class DentalAiService {
  /**
   * Configurable clinic receptionist greeting
   */
  public getInitialGreeting(customerName?: string): string {
    if (customerName && customerName.trim().length > 1) {
      return `Hello! Welcome ${customerName.trim()} to our dental clinic. I'm Kaira, your virtual receptionist. How may I help you today?`;
    }
    return `Hello! Welcome to our dental clinic. I'm Kaira, your virtual receptionist. How may I help you today?`;
  }

  /**
   * Retrieve or initialize active conversation session
   */
  public getOrCreateSession(
    callId: string,
    initialLanguage: string = 'en',
    customerName?: string,
    customerPhone?: string
  ): DentalConversationSession {
    let session = activeDentalSessions.get(callId);
    if (!session) {
      session = {
        callId,
        state: 'GREETING',
        language: initialLanguage,
        turns: [],
        askedQuestions: [],
        answeredCategories: new Set<ClinicalQuestionCategory>(),
        extractedAnswers: new Map<ClinicalQuestionCategory, ExtractedAnswerRecord>(),
        patientName: customerName,
        patientPhone: customerPhone,
        assessment: {},
        updatedAt: Date.now()
      };

      if (customerName) {
        session.answeredCategories.add('PATIENT_NAME');
      }
      if (customerPhone) {
        session.answeredCategories.add('PATIENT_PHONE');
      }

      activeDentalSessions.set(callId, session);
    }
    return session;
  }

  /**
   * Check if an active session is in a dental flow
   */
  public hasActiveSession(callId: string): boolean {
    return activeDentalSessions.has(callId);
  }

  /**
   * Reset or clear session
   */
  public clearSession(callId: string) {
    activeDentalSessions.delete(callId);
  }

  /**
   * High-accuracy dental intent classifier
   */
  public classifyDentalIntent(query: string): { intent: DentalIntent; confidence: number } {
    const text = (query || '').toLowerCase().trim();

    // 1. Life-Threatening Urgent Dental / Medical Concern
    if (
      /\b(cannot\s+breathe|difficulty\s+breathing|cant\s+breathe|shortness\s+of\s+breath|cannot\s+swallow|cant\s+swallow|difficulty\s+swallowing|swelling\s+in\s+(?:my\s+)?throat|throat\s+closing|uncontrolled\s+bleeding|profuse\s+bleeding|severe\s+facial\s+swelling|face\s+is\s+swelling|face\s+swelling)\b/i.test(text) ||
      /(சுவாசிக்க\s*முடியவில்லை|விழுங்க\s*முடியவில்லை|மூச்சுத்\s*திணறல்|सांस\s*लेने\s*में\s*तकलीफ)/i.test(text)
    ) {
      return { intent: 'URGENT_DENTAL_CONCERN', confidence: 0.99 };
    }

    // 2. Cancellation
    if (/\b(cancel\s+(?:my\s+)?(?:appointment|booking|visit)|drop\s+(?:my\s+)?appointment)\b/i.test(text)) {
      return { intent: 'CANCEL_APPOINTMENT', confidence: 0.95 };
    }

    // 3. Rescheduling
    if (/\b(reschedule|change\s+(?:the\s+|my\s+)?(?:date|time|appointment|booking)|move\s+(?:my\s+)?appointment|postpone)\b/i.test(text)) {
      return { intent: 'RESCHEDULE_APPOINTMENT', confidence: 0.95 };
    }

    // 4. Availability Check
    if (
      /\b(available\s+slots?|availability|what\s+times|openings?|do\s+you\s+have\s+time|is\s+dr\b|free\s+slots?)\b/i.test(text) &&
      !/\b(book|reserve|schedule)\b/i.test(text)
    ) {
      return { intent: 'CHECK_AVAILABILITY', confidence: 0.90 };
    }

    // 5. Booking Intent
    if (
      /\b(book\s+(?:an?\s+)?(?:appointment|visit|slot)|schedule\s+(?:an?\s+)?(?:appointment|visit)|make\s+(?:an?\s+)?appointment|need\s+(?:an?\s+)?appointment|see\s+a\s+dentist|want\s+an\s+appointment)\b/i.test(text) ||
      /(அப்பாயின்ட்மென்ட்|अपॉइंटमेंट|അപ്പോയിന്റ്മെന്റ്|అపాయింట్‌మెంట్)/i.test(text)
    ) {
      return { intent: 'BOOK_APPOINTMENT', confidence: 0.95 };
    }

    // 6. Wisdom Tooth Pain
    if (
      /\b(wisdom\s+tooth|wisdom\s+teeth|third\s+molar|back\s+tooth\s+pain|impacted\s+tooth)\b/i.test(text) ||
      /(ஞானப்\s*பல்|அறிவுப்\s*பல்|अकल\s*दाढ़)/i.test(text)
    ) {
      return { intent: 'WISDOM_TOOTH_PAIN', confidence: 0.95 };
    }

    // 7. Broken / Chipped Tooth
    if (/\b(broken\s+tooth|chipped\s+tooth|cracked\s+tooth|split\s+tooth|fractured\s+tooth|half\s+tooth)\b/i.test(text)) {
      return { intent: 'BROKEN_TOOTH', confidence: 0.95 };
    }

    // 8. Missing Tooth / Implants
    if (/\b(missing\s+tooth|lost\s+a\s+tooth|knocked\s+out|dental\s+implant|implants|bridge|denture)\b/i.test(text)) {
      return { intent: 'MISSING_TOOTH', confidence: 0.90 };
    }

    // 9. Gum Swelling
    if (/\b(gum\s+swell|swollen\s+gums?|bump\s+on\s+gum|abscess|pus\s+in\s+gum)\b/i.test(text)) {
      return { intent: 'GUM_SWELLING', confidence: 0.92 };
    }

    // 10. Gum Bleeding
    if (
      /\b(gum\s+bleed|bleeding\s+gums?|blood\s+when\s+brushing|blood\s+when\s+flossing)\b/i.test(text) ||
      /(ஈறு\s*இரத்தப்போக்கு|मसूड़ों\s*से\s*खून)/i.test(text)
    ) {
      return { intent: 'GUM_BLEEDING', confidence: 0.92 };
    }

    // 11. Tooth Sensitivity
    if (/\b(sensitiv(?:e|ity)|hurts\s+when\s+cold|hurts\s+with\s+hot|cold\s+water\s+pain|sweet\s+sensitivity)\b/i.test(text)) {
      return { intent: 'TOOTH_SENSITIVITY', confidence: 0.90 };
    }

    // 12. Routine Dental Cleaning
    if (/\b(clean(?:ing)?|dental\s+cleaning|routine\s+checkup|hygiene|scale|teeth\s+cleaning|whitening)\b/i.test(text)) {
      return { intent: 'DENTAL_CLEANING', confidence: 0.90 };
    }

    // 13. General Toothache
    if (
      /\b(tooth\s*ache|tooth\s+pain|teeth\s+hurt|hurting\s+tooth|molar\s+pain|throbbing\s+tooth)\b/i.test(text) ||
      /(பல்\s*வலி|பல்வலி|பல்|दांत\s*दर्द|दंत\s*दर्द|दांत|പല്ലുവേദന|പല്ല്|పంటి\s*నొప్పి|పన్ను)/i.test(text)
    ) {
      return { intent: 'TOOTHACHE', confidence: 0.92 };
    }

    // 14. Dentist Information
    if (/\b(who\s+is\s+the\s+dentist|dr\s+sarah|dr\s+rajesh|dr\s+anand|dentists\s+available|specialists?)\b/i.test(text)) {
      return { intent: 'DENTIST_INFORMATION', confidence: 0.88 };
    }

    // 15. Clinic Information (hours, location, insurance)
    if (/\b(opening\s+hours|closing\s+time|when\s+are\s+you\s+open|clinic\s+address|location|insurance|parking)\b/i.test(text)) {
      return { intent: 'CLINIC_INFORMATION', confidence: 0.90 };
    }

    return { intent: 'GENERAL_CONVERSATION', confidence: 0.5 };
  }

  /**
   * Process a conversation turn within the dental receptionist flow
   */
  public async handleTurn(params: {
    callId: string;
    query: string;
    language: string;
    customerContext?: any;
    callHistory?: any[];
  }): Promise<{
    answer: string;
    isDentalHandled: boolean;
    requiresTransfer: boolean;
    transferReason?: string;
    bookingReference?: string;
  }> {
    const { callId, query, language = 'en', customerContext, callHistory } = params;
    const session = this.getOrCreateSession(
      callId,
      language,
      customerContext?.customerName,
      customerContext?.customerPhone
    );
    session.language = language;
    session.updatedAt = Date.now();

    // Synchronize multi-turn call history if provided
    if (callHistory && Array.isArray(callHistory) && callHistory.length > 0) {
      session.turns = callHistory.map(item => ({
        sender: item.sender === 'customer' || item.role === 'user' ? 'patient' : 'receptionist',
        text: item.text || item.content || '',
        timestamp: item.timestamp ? new Date(item.timestamp).getTime() : Date.now()
      }));
    } else {
      session.turns.push({ sender: 'patient', text: query, timestamp: Date.now() });
    }

    // English normalized text for universal slot/intent reasoning
    let englishText = query.trim();
    if (language !== 'en') {
      try {
        englishText = await translationService.translateText(query, 'en', language);
      } catch (err) {
        console.warn('[DentalAI] Translation to English failed, falling back to raw query:', err);
      }
    }
    const lower = englishText.toLowerCase().trim();

    // ==============================================================
    // 1. SAFETY & URGENCY CHECK (Overriding All Normal Flows)
    // ==============================================================
    if (
      /\b(cannot\s+breathe|difficulty\s+breathing|cant\s+breathe|shortness\s+of\s+breath|cannot\s+swallow|cant\s+swallow|difficulty\s+swallowing|throat\s+closing|uncontrolled\s+bleeding|profuse\s+bleeding|severe\s+facial\s+swelling|face\s+is\s+swelling|face\s+swelling)\b/i.test(lower) ||
      /(சுவாசிக்க\s*முடியவில்லை|விழுங்க\s*முடியவில்லை|மூச்சுத்\s*திணறல்)/i.test(query)
    ) {
      session.state = 'HUMAN_ESCALATION';
      session.isUrgentEscalation = true;
      session.urgencyReason = 'Life-threatening dental/airway symptom reported';

      const emergencyMsg =
        "This sounds like a potentially serious medical emergency. Because you are experiencing difficulty swallowing or breathing with facial swelling, please immediately seek emergency medical attention at the nearest hospital emergency room or dial 911 (or your local emergency number). I am also alerting our on-call clinical team right now.";

      session.turns.push({ sender: 'receptionist', text: emergencyMsg, timestamp: Date.now() });

      return {
        answer: await this.localize(emergencyMsg, language),
        isDentalHandled: true,
        requiresTransfer: true,
        transferReason: 'Urgent Life-Threatening Dental/Airway Symptom'
      };
    }

    // ==============================================================
    // 2. CHECK EXPLICIT HUMAN TRANSFER REQUEST
    // ==============================================================
    if (/\b(speak\s+to\s+a\s+human|human\s+agent|real\s+person|receptionist\s+please|transfer\s+me)\b/i.test(lower)) {
      session.state = 'HUMAN_ESCALATION';
      const transferMsg = "I will connect you directly with our front-desk clinic receptionist right now. Please hold on for just a moment.";
      session.turns.push({ sender: 'receptionist', text: transferMsg, timestamp: Date.now() });
      return {
        answer: await this.localize(transferMsg, language),
        isDentalHandled: true,
        requiresTransfer: true,
        transferReason: 'Patient requested human receptionist'
      };
    }

    // ==============================================================
    // 3. INTENT CLASSIFICATION & ANSWER EXTRACTION
    // ==============================================================
    const { intent, confidence } = this.classifyDentalIntent(englishText);

    if (session.state === 'GREETING' || session.state === 'IDENTIFY_INTENT') {
      session.intent = intent;
    }

    // Context-Aware Entity Extraction
    this.extractContextAwareEntities(session, query, lower);

    // ==============================================================
    // 4. FLOW DISPATCHER
    // ==============================================================

    // A. Cancellation Flow
    if (intent === 'CANCEL_APPOINTMENT' || (session.state === 'IDENTIFY_INTENT' && session.intent === 'CANCEL_APPOINTMENT')) {
      return await this.handleCancellationFlow(session, lower, language);
    }

    // B. Reschedule Flow (for existing confirmed appointments with booking references)
    if (
      (intent === 'RESCHEDULE_APPOINTMENT' && (session.state === 'BOOKING_COMPLETED' || /\b(den-\d{4}-[a-z0-9]{4})\b/i.test(lower))) ||
      (session.state === 'IDENTIFY_INTENT' && session.intent === 'RESCHEDULE_APPOINTMENT')
    ) {
      return await this.handleRescheduleFlow(session, lower, language);
    }

    // C. Explicit Appointment Booking Request (Section 3 Example 4)
    // "I want to book an appointment." -> "Certainly! What date would you prefer?"
    const isExplicitBookingRequest =
      /\b(i\s+want\s+to\s+book\s+(?:an?\s+)?appointment|book\s+(?:an?\s+)?appointment|schedule\s+(?:an?\s+)?appointment|make\s+(?:an?\s+)?appointment|book\s+(?:a\s+)?slot)\b/i.test(lower) &&
      !lower.includes('cancel') && !lower.includes('reschedule');

    if (isExplicitBookingRequest && !this.extractDatePreference(lower)) {
      session.state = 'CHECK_AVAILABILITY';
      session.intent = 'BOOK_APPOINTMENT';
      const promptDateMsg = "Certainly! What date would you prefer?";
      session.currentPendingQuestion = {
        category: 'PREFERRED_DATE',
        questionText: promptDateMsg,
        askedAt: Date.now(),
        clarificationCount: 0
      };
      session.turns.push({ sender: 'receptionist', text: promptDateMsg, timestamp: Date.now() });
      return {
        answer: await this.localize(promptDateMsg, language),
        isDentalHandled: true,
        requiresTransfer: false
      };
    }

    // D. Intelligent Question Answering & Pronoun Resolution
    // Resolves questions like "What is a root canal?", "Does teeth cleaning hurt?", "Does it hurt?", "How much does that cost?"
    const isPronounQuery = /\b(does\s+(?:it|that|this)\s+(?:hurt|pain|ache|take)|is\s+(?:it|that|this)\s+(?:painful|safe|expensive|permanent)|how\s+much\s+(?:is\s+(?:it|that|this)|does\s+(?:it|that|this)\s+cost)|how\s+long\s+does\s+(?:it|that|this)\s+take|can\s+i\s+(?:eat|book)\s+after\s+(?:it|that))\b/i.test(lower);

    const isKnowledgeQuestion =
      isPronounQuery ||
      /\b(what\s+is|what\s+are|what\s+causes|why\s+(?:do|does|is|are)|how\s+(?:much|often|long|do|does|can)|does\s+(?:it|that|this|teeth\s+cleaning|cleaning|a\s+root\s+canal|root\s+canal|a\s+filling|extraction|whitening)\s+hurt|is\s+(?:it|that|this|cleaning|whitening|a\s+root\s+canal|root\s+canal)\s+(?:painful|safe|normal|permanent|expensive)|tell\s+me\s+about|explain|difference\s+between|can\s+i\s+eat|who\s+(?:is|are)\s+(?:the\s+)?(?:dentist|doctor|sarah|rajesh|anand)|what\s+are\s+your\s+hours|where\s+are\s+you|price|cost|fee|charge)\b/i.test(lower) ||
      (/^(root\s+canal|teeth\s+cleaning|dental\s+cleaning|wisdom\s+teeth|wisdom\s+tooth|dental\s+implants?|veneers?|crowns?|braces|invisalign)$/i.test(lower));

    // Check if user is merely answering an active pending intake question (e.g., "One month", "Three days ago", "Sharp pain")
    const isAnsweringPendingQuestion = Boolean(session.currentPendingQuestion) &&
      (lower.includes('month') || lower.includes('day') || lower.includes('week') || lower.includes('year') ||
       lower.includes('lower') || lower.includes('upper') || lower.includes('right') || lower.includes('left') ||
       lower.includes('sharp') || lower.includes('dull') || lower.includes('throbbing') ||
       lower.includes('comes and goes') || lower.includes('constant') || lower.includes('chew') ||
       lower.includes('scale') || /\b([1-9]|10)\b/.test(lower) ||
       lower.includes("don't know") || lower.includes('not sure'));

    if (isKnowledgeQuestion && !isAnsweringPendingQuestion) {
      const llmResp = await dentalLlmService.generateAnswer({
        query: englishText,
        callId: session.callId,
        language,
        activeTopic: session.activeDentalTopic,
        patientName: session.patientName,
        callHistory: session.turns
      });

      if (llmResp.resolvedTopic) {
        session.activeDentalTopic = llmResp.resolvedTopic;
      }

      session.turns.push({ sender: 'receptionist', text: llmResp.answer, timestamp: Date.now() });
      return {
        answer: await this.localize(llmResp.answer, language),
        isDentalHandled: true,
        requiresTransfer: false
      };
    }

    // E. General Clinic Info (Clinic hours, Dentists, Location)
    if (intent === 'CLINIC_INFORMATION' || intent === 'DENTIST_INFORMATION') {
      const llmResp = await dentalLlmService.generateAnswer({
        query: englishText,
        callId: session.callId,
        language,
        activeTopic: session.activeDentalTopic,
        patientName: session.patientName,
        callHistory: session.turns
      });
      session.turns.push({ sender: 'receptionist', text: llmResp.answer, timestamp: Date.now() });
      return { answer: await this.localize(llmResp.answer, language), isDentalHandled: true, requiresTransfer: false };
    }

    // F. Dental Complaint Assessment & Booking Flow
    const dentalComplaintIntents: DentalIntent[] = [
      'WISDOM_TOOTH_PAIN',
      'TOOTHACHE',
      'GUM_BLEEDING',
      'GUM_SWELLING',
      'TOOTH_SENSITIVITY',
      'BROKEN_TOOTH',
      'MISSING_TOOTH',
      'DENTAL_CLEANING',
      'BOOK_APPOINTMENT'
    ];

    if (
      dentalComplaintIntents.includes(intent) ||
      session.complaintType ||
      session.state === 'UNDERSTAND_DENTAL_COMPLAINT' ||
      session.state === 'ASK_FOLLOWUP_QUESTIONS' ||
      session.state === 'OFFER_APPOINTMENT' ||
      session.state === 'CHECK_AVAILABILITY' ||
      session.state === 'CONFIRM_BOOKING' ||
      session.currentPendingQuestion !== undefined
    ) {
      return await this.handleDentalComplaintAndBookingFlow(session, query, lower, intent, language);
    }

    // G. Intelligent Conversational General Fallback (Direct, helpful, never generic corporate rejection)
    const generalResp = await dentalLlmService.generateAnswer({
      query: englishText,
      callId: session.callId,
      language,
      activeTopic: session.activeDentalTopic,
      patientName: session.patientName,
      callHistory: session.turns
    });

    if (generalResp.resolvedTopic) {
      session.activeDentalTopic = generalResp.resolvedTopic;
    }
    session.turns.push({ sender: 'receptionist', text: generalResp.answer, timestamp: Date.now() });
    return {
      answer: await this.localize(generalResp.answer, language),
      isDentalHandled: true,
      requiresTransfer: false
    };
  }

  /**
   * Conversational Clinical Assessment & Appointment Booking Workflow
   */
  private async handleDentalComplaintAndBookingFlow(
    session: DentalConversationSession,
    rawText: string,
    lower: string,
    detectedIntent: DentalIntent,
    language: string
  ): Promise<{
    answer: string;
    isDentalHandled: boolean;
    requiresTransfer: boolean;
    transferReason?: string;
    bookingReference?: string;
  }> {
    // 1. Identify or maintain complaint type
    if (!session.complaintType) {
      if (detectedIntent === 'BOOK_APPOINTMENT') {
        session.complaintType = 'TOOTHACHE';
      } else {
        session.complaintType = detectedIntent;
      }
      session.answeredCategories.add('CHIEF_COMPLAINT');
    }

    // Map complaint to clinic service and dentist specialization
    const mapped = await dentalAppointmentService.matchServiceForComplaint(session.complaintType || 'TOOTHACHE');
    session.matchedSpecialization = mapped.specialization;
    const services = await dentalAppointmentService.getServices();
    const matchedService = services.find(s => s.code === mapped.serviceCode);
    if (matchedService) {
      session.matchedServiceId = matchedService.id;
      session.matchedServiceName = matchedService.name;
    }

    // ==============================================================
    // 2. CHECK PREFERRED DATE (Instant availability check if date provided)
    // ==============================================================
    const dateMatch = this.extractDatePreference(lower);
    if (dateMatch) {
      session.preferredDateStr = dateMatch;
      session.answeredCategories.add('PREFERRED_DATE');
      session.state = 'CHECK_AVAILABILITY';

      const slots = await dentalAppointmentService.getAvailableSlots(
        dateMatch,
        session.matchedDentistId,
        session.matchedServiceId
      );

      session.availableSlots = slots;

      if (!slots || slots.length === 0) {
        const noSlotsMsg = `I checked our schedule for ${dateMatch}, but our dentists are fully booked on that date. Would another date work for you, or would you like me to add you to our priority waitlist?`;
        session.turns.push({ sender: 'receptionist', text: noSlotsMsg, timestamp: Date.now() });
        return {
          answer: await this.localize(noSlotsMsg, language),
          isDentalHandled: true,
          requiresTransfer: false
        };
      }

      const slotSamples = slots.slice(0, 3).map(s => s.displayTime).join(', ');
      const offerSlotMsg = `For ${dateMatch}, we have slots available with ${slots[0].dentistName} (${slots[0].specialization}) at ${slotSamples}. Which time works best for you?`;
      session.state = 'CONFIRM_BOOKING';
      session.currentPendingQuestion = {
        category: 'PREFERRED_TIME',
        questionText: offerSlotMsg,
        askedAt: Date.now(),
        clarificationCount: 0
      };
      session.turns.push({ sender: 'receptionist', text: offerSlotMsg, timestamp: Date.now() });

      return {
        answer: await this.localize(offerSlotMsg, language),
        isDentalHandled: true,
        requiresTransfer: false
      };
    }

    // ==============================================================
    // 3. CHECK YES TO BOOKING OFFER
    // ==============================================================
    if (
      (session.state === 'OFFER_APPOINTMENT' || session.state === 'ASK_FOLLOWUP_QUESTIONS' || session.state === 'GREETING' || session.state === 'IDENTIFY_INTENT') &&
      /\b(yes|yeah|sure|please|book|i\s+want\s+an\s+appointment|i\s+need\s+an\s+appointment|okay|schedule|confirm)\b/i.test(lower) &&
      !session.preferredDateStr
    ) {
      session.state = 'CHECK_AVAILABILITY';
      const promptDateMsg =
        "Certainly. Which date would you prefer? For example, tomorrow, this Thursday, or Friday?";
      session.currentPendingQuestion = {
        category: 'PREFERRED_DATE',
        questionText: promptDateMsg,
        askedAt: Date.now(),
        clarificationCount: 0
      };
      session.turns.push({ sender: 'receptionist', text: promptDateMsg, timestamp: Date.now() });
      return {
        answer: await this.localize(promptDateMsg, language),
        isDentalHandled: true,
        requiresTransfer: false
      };
    }

    // ==============================================================
    // 4. CHECK SLOT SELECTION IN CONFIRM_BOOKING STATE
    // ==============================================================
    if (session.state === 'CONFIRM_BOOKING' && session.availableSlots && session.availableSlots.length > 0) {
      const selectedSlot = this.matchSelectedSlot(lower, session.availableSlots);
      if (selectedSlot) {
        session.selectedSlot = selectedSlot;
        session.answeredCategories.add('PREFERRED_TIME');

        if (!session.patientName || session.patientName.length < 2) {
          session.state = 'COLLECT_PATIENT_DETAILS';
          const askNameMsg = `I have selected ${selectedSlot.displayTime} on ${selectedSlot.dateStr}. May I have your full name to complete the booking?`;
          session.currentPendingQuestion = {
            category: 'PATIENT_NAME',
            questionText: askNameMsg,
            askedAt: Date.now(),
            clarificationCount: 0
          };
          session.turns.push({ sender: 'receptionist', text: askNameMsg, timestamp: Date.now() });
          return {
            answer: await this.localize(askNameMsg, language),
            isDentalHandled: true,
            requiresTransfer: false
          };
        }

        if (!session.patientPhone || session.patientPhone.replace(/[^\d+]/g, '').length < 7) {
          session.state = 'COLLECT_PATIENT_DETAILS';
          const askPhoneMsg = `Thank you ${session.patientName}. What is your best contact phone number?`;
          session.currentPendingQuestion = {
            category: 'PATIENT_PHONE',
            questionText: askPhoneMsg,
            askedAt: Date.now(),
            clarificationCount: 0
          };
          session.turns.push({ sender: 'receptionist', text: askPhoneMsg, timestamp: Date.now() });
          return {
            answer: await this.localize(askPhoneMsg, language),
            isDentalHandled: true,
            requiresTransfer: false
          };
        }

        return await this.commitBooking(session, language);
      }
    }

    // Patient Details Collection
    if (session.state === 'COLLECT_PATIENT_DETAILS' && session.selectedSlot) {
      if (session.patientName && (!session.patientPhone || session.patientPhone.replace(/[^\d+]/g, '').length < 7)) {
        const askPhone = `Thank you ${session.patientName}. What is your contact phone number?`;
        session.currentPendingQuestion = {
          category: 'PATIENT_PHONE',
          questionText: askPhone,
          askedAt: Date.now(),
          clarificationCount: 0
        };
        session.turns.push({ sender: 'receptionist', text: askPhone, timestamp: Date.now() });
        return {
          answer: await this.localize(askPhone, language),
          isDentalHandled: true,
          requiresTransfer: false
        };
      }

      if (session.patientName && session.patientPhone) {
        return await this.commitBooking(session, language);
      }
    }

    // ==============================================================
    // 5. UNCLEAR ANSWER CLARIFICATION LAYER
    // ==============================================================
    if (session.currentPendingQuestion) {
      const isUnclear = /\b(i\s+don'?t\s+know|not\s+sure|hard\s+to\s+say|can'?t\s+remember|no\s+idea|maybe)\b/i.test(lower);
      if (isUnclear && session.currentPendingQuestion.clarificationCount === 0) {
        session.currentPendingQuestion.clarificationCount++;
        const clarificationQuestion = this.getClarificationQuestion(session.currentPendingQuestion.category);
        if (clarificationQuestion) {
          session.turns.push({ sender: 'receptionist', text: clarificationQuestion, timestamp: Date.now() });
          return {
            answer: await this.localize(clarificationQuestion, language),
            isDentalHandled: true,
            requiresTransfer: false
          };
        }
      }
    }

    // ==============================================================
    // 6. QUESTION AND ANSWER TRACKER - NEXT QUESTION GENERATOR
    // ==============================================================
    const nextQuestionObj = this.getNextUnansweredQuestion(session);

    if (nextQuestionObj) {
      session.state = 'ASK_FOLLOWUP_QUESTIONS';
      session.currentPendingQuestion = {
        category: nextQuestionObj.category,
        questionText: nextQuestionObj.text,
        askedAt: Date.now(),
        clarificationCount: 0
      };
      session.askedQuestions.push({
        category: nextQuestionObj.category,
        questionText: nextQuestionObj.text,
        askedAt: Date.now(),
        clarificationCount: 0
      });

      session.turns.push({ sender: 'receptionist', text: nextQuestionObj.text, timestamp: Date.now() });

      return {
        answer: await this.localize(nextQuestionObj.text, language),
        isDentalHandled: true,
        requiresTransfer: false
      };
    }

    // All assessment questions answered -> Transition to OFFER_APPOINTMENT
    session.state = 'OFFER_APPOINTMENT';
    session.currentPendingQuestion = undefined;
    const allCollectedOffer =
      `Thank you for sharing those details. Based on your symptoms, I strongly recommend a clinical examination with our specialist, Dr. Rajesh Kumar. Would you like me to book an appointment for you?`;

    session.turns.push({ sender: 'receptionist', text: allCollectedOffer, timestamp: Date.now() });

    return {
      answer: await this.localize(allCollectedOffer, language),
      isDentalHandled: true,
      requiresTransfer: false
    };
  }

  /**
   * Commits booking into database transactionally and generates booking confirmation
   */
  private async commitBooking(session: DentalConversationSession, language: string) {
    const slot = session.selectedSlot!;
    try {
      // Build rich clinical chief complaint from all collected fields
      const complaintParts: string[] = [];
      if (session.assessment.location) complaintParts.push(`Area: ${session.assessment.location}`);
      if (session.assessment.painType) complaintParts.push(`Type: ${session.assessment.painType}`);
      if (session.assessment.duration) complaintParts.push(`Duration: ${session.assessment.duration}`);
      if (session.assessment.pattern) complaintParts.push(`Pattern: ${session.assessment.pattern}`);
      if (session.assessment.severity) complaintParts.push(`Severity: ${session.assessment.severity}/10`);
      if (session.assessment.associatedSymptoms && session.assessment.associatedSymptoms.length > 0) {
        complaintParts.push(`Symptoms: ${session.assessment.associatedSymptoms.join(', ')}`);
      }

      const fullComplaint = complaintParts.length > 0
        ? complaintParts.join(' | ')
        : session.assessment.notes || session.complaintType || 'Dental consultation';

      const booked = await dentalAppointmentService.bookAppointment({
        patientName: session.patientName || 'Dental Patient',
        patientPhone: session.patientPhone || '+1-555-0100',
        dentistId: slot.dentistId,
        serviceId: slot.serviceId || session.matchedServiceId!,
        appointmentDateTime: slot.startDateTime,
        chiefComplaint: fullComplaint,
        callRecordId: undefined
      });

      session.state = 'BOOKING_COMPLETED';
      session.confirmedBookingReference = booked.bookingReference;
      session.currentPendingQuestion = undefined;

      const confirmMsg = `Your appointment has been successfully confirmed for ${slot.dateStr} at ${slot.displayTime} with ${slot.dentistName}. Your booking reference is ${booked.bookingReference}. We look forward to seeing you at KAIRA Dental Clinic.`;
      session.turns.push({ sender: 'receptionist', text: confirmMsg, timestamp: Date.now() });

      return {
        answer: await this.localize(confirmMsg, language),
        isDentalHandled: true,
        requiresTransfer: false,
        bookingReference: booked.bookingReference
      };
    } catch (err: any) {
      console.error('[DentalAI] Booking failed:', err);
      const errMsg = `I could not complete the reservation: ${err.message || 'Please try another time slot.'}`;
      return {
        answer: await this.localize(errMsg, language),
        isDentalHandled: true,
        requiresTransfer: false
      };
    }
  }

  /**
   * Question and Answer Tracker:
   * Selects the next unanswered clinical question, strictly enforcing semantic duplicate prevention.
   */
  private getNextUnansweredQuestion(
    session: DentalConversationSession
  ): { category: ClinicalQuestionCategory; text: string } | null {
    const { complaintType, answeredCategories, askedQuestions } = session;

    // Define standard clinical question checklist for complaints
    const categoryFlow: ClinicalQuestionCategory[] = [
      'PAIN_LOCATION',
      'PAIN_DURATION',
      'PAIN_TYPE',
      'PAIN_PATTERN',
      'PAIN_SEVERITY',
      'ASSOCIATED_SYMPTOMS'
    ];

    for (const cat of categoryFlow) {
      // 1. Skip if already answered
      if (answeredCategories.has(cat)) {
        continue;
      }

      // 2. Skip if already asked and either answered or clarified
      const alreadyAsked = askedQuestions.some(q => q.category === cat);
      if (alreadyAsked) {
        continue;
      }

      // 3. Generate natural question text
      const questionText = this.getQuestionForCategory(cat, complaintType);
      if (!questionText) continue;

      // 4. Duplicate Question Prevention: verify semantic dissimilarity with prior asked questions
      if (this.isSemanticallyDuplicate(questionText, cat, session)) {
        continue;
      }

      return { category: cat, text: questionText };
    }

    return null;
  }

  /**
   * Canonical question texts per category and complaint type
   */
  private getQuestionForCategory(cat: ClinicalQuestionCategory, complaintType?: DentalIntent): string | null {
    if (cat === 'PAIN_LOCATION') {
      if (complaintType === 'WISDOM_TOOTH_PAIN') {
        return "Wisdom tooth pain can have several causes, including impaction, gum inflammation or infection. Is the pain on your upper or lower jaw?";
      }
      return "Which area of your mouth or tooth is hurting? Is it on the upper or lower side?";
    }

    if (cat === 'PAIN_DURATION') {
      return "When did this pain start, and how long has it been bothering you?";
    }

    if (cat === 'PAIN_TYPE') {
      return "What type of pain are you experiencing? Is it sharp, dull, or throbbing?";
    }

    if (cat === 'PAIN_PATTERN') {
      return "Is the pain constant or does it come and go, and does it hurt more when you chew or bite down?";
    }

    if (cat === 'PAIN_SEVERITY') {
      return "On a scale from 1 to 10, how would you rate the severity of the pain right now?";
    }

    if (cat === 'ASSOCIATED_SYMPTOMS') {
      return "Are you noticing any swelling around the jaw, a fever, or difficulty opening your mouth?";
    }

    return null;
  }

  /**
   * Clarification question for unclear or uncertain customer responses
   */
  private getClarificationQuestion(cat: ClinicalQuestionCategory): string | null {
    switch (cat) {
      case 'PAIN_DURATION':
        return "That's okay. Did you notice it today, a few days ago, or several weeks ago?";
      case 'PAIN_LOCATION':
        return "No problem at all. Is it roughly in your upper teeth, lower teeth, or on one side of your jaw?";
      case 'PAIN_TYPE':
        return "That's completely fine. Does it feel more like a sharp, shooting pain, or a dull, throbbing ache?";
      case 'PAIN_PATTERN':
        return "Understood. Does it hurt mostly when eating and chewing, or is it there all the time?";
      case 'PAIN_SEVERITY':
        return "No problem. Would you describe it as mild discomfort, moderate pain, or severe pain?";
      default:
        return null;
    }
  }

  /**
   * Semantic Duplicate Question Prevention:
   * Checks token overlap, Jaccard similarity, and category identity to reject repeated questions.
   */
  private isSemanticallyDuplicate(
    candidateText: string,
    candidateCategory: ClinicalQuestionCategory,
    session: DentalConversationSession
  ): boolean {
    if (session.answeredCategories.has(candidateCategory)) return true;

    const normalize = (s: string) =>
      s.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2);

    const candTokens = new Set(normalize(candidateText));

    for (const q of session.askedQuestions) {
      if (q.category === candidateCategory) return true;

      const qTokens = new Set(normalize(q.questionText));
      let intersection = 0;
      for (const t of candTokens) {
        if (qTokens.has(t)) intersection++;
      }
      const union = new Set([...candTokens, ...qTokens]).size;
      const jaccard = union > 0 ? intersection / union : 0;

      if (jaccard >= 0.60) return true;
    }

    return false;
  }

  /**
   * Intelligent Context-Aware Entity Extraction:
   * 1. Inspects the last pending question and extracts targeted answers (e.g. duration, location, type, pattern).
   * 2. Scans full utterance for proactively provided multi-field information.
   * 3. Marks answered categories so questions are NEVER repeated.
   */
  private extractContextAwareEntities(session: DentalConversationSession, rawText: string, lower: string) {
    const a = session.assessment;
    const pendingCat = session.currentPendingQuestion?.category;

    // -------------------------------------------------------------
    // 1. TARGETED EXTRACTION (Addressing Current Pending Question)
    // -------------------------------------------------------------
    if (pendingCat === 'PAIN_DURATION') {
      const dur = this.parseDurationEntity(lower);
      if (dur) {
        a.duration = dur;
        session.answeredCategories.add('PAIN_DURATION');
        session.extractedAnswers.set('PAIN_DURATION', {
          category: 'PAIN_DURATION',
          rawText,
          extractedValue: dur,
          extractedAt: Date.now()
        });
        session.currentPendingQuestion = undefined;
      }
    }

    if (pendingCat === 'PAIN_LOCATION') {
      const loc = this.parseLocationEntity(lower, true);
      if (loc) {
        a.location = loc;
        session.answeredCategories.add('PAIN_LOCATION');
        session.extractedAnswers.set('PAIN_LOCATION', {
          category: 'PAIN_LOCATION',
          rawText,
          extractedValue: loc,
          extractedAt: Date.now()
        });
        session.currentPendingQuestion = undefined;
      }
    }

    if (pendingCat === 'PAIN_TYPE') {
      const pType = this.parsePainTypeEntity(lower);
      if (pType) {
        a.painType = pType;
        session.answeredCategories.add('PAIN_TYPE');
        session.extractedAnswers.set('PAIN_TYPE', {
          category: 'PAIN_TYPE',
          rawText,
          extractedValue: pType,
          extractedAt: Date.now()
        });
        session.currentPendingQuestion = undefined;
      }
    }

    if (pendingCat === 'PAIN_PATTERN') {
      const pattern = this.parsePatternEntity(lower);
      if (pattern) {
        a.pattern = pattern;
        session.answeredCategories.add('PAIN_PATTERN');
        session.extractedAnswers.set('PAIN_PATTERN', {
          category: 'PAIN_PATTERN',
          rawText,
          extractedValue: pattern,
          extractedAt: Date.now()
        });
        session.currentPendingQuestion = undefined;
      }
    }

    if (pendingCat === 'PAIN_SEVERITY') {
      const sev = this.parseSeverityEntity(lower);
      if (sev !== undefined) {
        a.severity = sev;
        session.answeredCategories.add('PAIN_SEVERITY');
        session.extractedAnswers.set('PAIN_SEVERITY', {
          category: 'PAIN_SEVERITY',
          rawText,
          extractedValue: sev,
          extractedAt: Date.now()
        });
        session.currentPendingQuestion = undefined;
      }
    }

    if (pendingCat === 'ASSOCIATED_SYMPTOMS') {
      const sym = this.parseAssociatedSymptoms(lower);
      if (sym && sym.length > 0) {
        a.associatedSymptoms = sym;
        session.answeredCategories.add('ASSOCIATED_SYMPTOMS');
        session.extractedAnswers.set('ASSOCIATED_SYMPTOMS', {
          category: 'ASSOCIATED_SYMPTOMS',
          rawText,
          extractedValue: sym,
          extractedAt: Date.now()
        });
        session.currentPendingQuestion = undefined;
      }
    }

    // -------------------------------------------------------------
    // 2. GLOBAL PROACTIVE MULTI-FIELD EXTRACTION
    // -------------------------------------------------------------
    if (!a.duration) {
      const dur = this.parseDurationEntity(lower);
      if (dur) {
        a.duration = dur;
        session.answeredCategories.add('PAIN_DURATION');
      }
    }

    if (!a.location) {
      const loc = this.parseLocationEntity(lower);
      if (loc) {
        a.location = loc;
        session.answeredCategories.add('PAIN_LOCATION');
      }
    }

    if (!a.painType) {
      const pType = this.parsePainTypeEntity(lower);
      if (pType) {
        a.painType = pType;
        session.answeredCategories.add('PAIN_TYPE');
      }
    }

    if (!a.pattern) {
      const pattern = this.parsePatternEntity(lower);
      if (pattern) {
        a.pattern = pattern;
        session.answeredCategories.add('PAIN_PATTERN');
      }
    }

    if (a.severity === undefined) {
      const sev = this.parseSeverityEntity(lower);
      if (sev !== undefined) {
        a.severity = sev;
        session.answeredCategories.add('PAIN_SEVERITY');
      }
    }

    if (!a.associatedSymptoms) {
      const sym = this.parseAssociatedSymptoms(lower);
      if (sym && sym.length > 0) {
        a.associatedSymptoms = sym;
        session.answeredCategories.add('ASSOCIATED_SYMPTOMS');
      }
    }

    // Patient Name
    if (!session.patientName) {
      const nameMatch = rawText.match(/(?:my\s+name\s+is|i\s+am|this\s+is)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i);
      if (nameMatch) {
        session.patientName = nameMatch[1].trim();
        session.answeredCategories.add('PATIENT_NAME');
      }
    }

    // Patient Phone
    if (!session.patientPhone) {
      const phoneMatch = rawText.match(/(?:\+?[0-9\s\-\(\)]{7,15})/);
      if (phoneMatch) {
        session.patientPhone = phoneMatch[0].trim();
        session.answeredCategories.add('PATIENT_PHONE');
      }
    }
  }

  // --- Entity Parsers ---

  private parseDurationEntity(lower: string): string | null {
    // Matches word numbers ("one month", "two weeks") and digit numbers ("1 month", "3 days")
    const match = lower.match(
      /(?:\b(?:for|started|about|since|around)\s+)?\b(one|two|three|four|five|six|seven|eight|nine|ten|a|few|several|couple\s+of|\d+)\s+(months?|weeks?|days?|hours?|years?)\b(?:\s+ago)?/i
    );
    if (match) {
      return match[0].trim();
    }
    if (/\b(yesterday|today|last\s+night|since\s+yesterday|last\s+week|last\s+month)\b/i.test(lower)) {
      const m = lower.match(/\b(yesterday|today|last\s+night|since\s+yesterday|last\s+week|last\s+month)\b/i);
      return m ? m[0] : null;
    }
    return null;
  }

  private parseLocationEntity(lower: string, isLocationPending: boolean = false): string | null {
    const locParts: string[] = [];

    const hasSpecificLocation =
      lower.includes('lower-right') || lower.includes('lower right') || lower.includes('bottom right') ||
      lower.includes('lower-left') || lower.includes('lower left') || lower.includes('bottom left') ||
      lower.includes('upper-right') || lower.includes('upper right') || lower.includes('top right') ||
      lower.includes('upper-left') || lower.includes('upper left') || lower.includes('top left') ||
      lower.includes('lower') || lower.includes('bottom') ||
      lower.includes('upper') || lower.includes('top') ||
      lower.includes('right') || lower.includes('left') ||
      lower.includes('molar') || lower.includes('front tooth') || lower.includes('front teeth');

    if (lower.includes('wisdom tooth') || lower.includes('wisdom teeth')) {
      if (isLocationPending || hasSpecificLocation) {
        locParts.push('wisdom tooth');
      }
    }
    if (lower.includes('lower-right') || lower.includes('lower right') || lower.includes('bottom right')) {
      locParts.push('lower-right');
    } else if (lower.includes('lower-left') || lower.includes('lower left') || lower.includes('bottom left')) {
      locParts.push('lower-left');
    } else if (lower.includes('upper-right') || lower.includes('upper right') || lower.includes('top right')) {
      locParts.push('upper-right');
    } else if (lower.includes('upper-left') || lower.includes('upper left') || lower.includes('top left')) {
      locParts.push('upper-left');
    } else {
      if (lower.includes('lower') || lower.includes('bottom')) locParts.push('lower jaw');
      if (lower.includes('upper') || lower.includes('top')) locParts.push('upper jaw');
      if (lower.includes('right')) locParts.push('right side');
      if (lower.includes('left')) locParts.push('left side');
    }

    if (lower.includes('molar')) locParts.push('molar');
    if (lower.includes('front tooth') || lower.includes('front teeth')) locParts.push('front tooth');

    if (locParts.length > 0) {
      return locParts.join(' ');
    }
    return null;
  }

  private parsePainTypeEntity(lower: string): string | null {
    if (lower.includes('sharp')) return 'sharp pain';
    if (lower.includes('throbbing') || lower.includes('pulsing')) return 'throbbing pain';
    if (lower.includes('dull') || lower.includes('aching')) return 'dull ache';
    if (lower.includes('stabbing') || lower.includes('shooting')) return 'shooting pain';
    if (lower.includes('burning')) return 'burning sensation';
    return null;
  }

  private parsePatternEntity(lower: string): string | null {
    if (lower.includes('comes and goes') || lower.includes('come and go') || lower.includes('intermittent') || lower.includes('on and off')) {
      return 'comes and goes';
    }
    if (lower.includes('constant') || lower.includes('all the time') || lower.includes('continuous')) {
      return 'constant pain';
    }
    if (lower.includes('chew') || lower.includes('biting') || lower.includes('eating') || lower.includes('bite down')) {
      return 'hurts when chewing';
    }
    return null;
  }

  private parseSeverityEntity(lower: string): number | undefined {
    const wordNums: Record<string, number> = {
      one: 1, two: 2, three: 3, four: 4, five: 5,
      six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
      mild: 3, moderate: 6, severe: 9, unbearable: 10
    };

    for (const [w, n] of Object.entries(wordNums)) {
      if (new RegExp(`\\b${w}\\b`, 'i').test(lower)) {
        return n;
      }
    }

    const numMatch = lower.match(/\b([1-9]|10)\b(?:\s*(?:out\s+of\s+10|\/10))?/);
    if (numMatch) {
      return parseInt(numMatch[1], 10);
    }
    return undefined;
  }

  private parseAssociatedSymptoms(lower: string): string[] | null {
    const symptoms: string[] = [];
    if (lower.includes('swell') || lower.includes('puffy')) symptoms.push('swelling');
    if (lower.includes('fever')) symptoms.push('fever');
    if (lower.includes('mouth') && (lower.includes('open') || lower.includes('stiff'))) symptoms.push('difficulty opening mouth');
    if (symptoms.length > 0) return symptoms;
    if (/\b(no|none|neither|nothing\s+else|no\s+swelling|no\s+fever)\b/i.test(lower)) return ['none reported'];
    return null;
  }

  /**
   * Helper to parse date strings like "tomorrow", "friday", "2026-11-27", etc.
   */
  private extractDatePreference(lower: string): string | null {
    const today = new Date();

    if (lower.includes('tomorrow')) {
      const d = new Date(today.getTime() + 24 * 60 * 60 * 1000);
      return d.toISOString().split('T')[0];
    }

    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (let i = 0; i < dayNames.length; i++) {
      if (lower.includes(dayNames[i])) {
        const todayDay = today.getDay();
        let diff = i - todayDay;
        if (diff <= 0) diff += 7;
        const target = new Date(today.getTime() + diff * 24 * 60 * 60 * 1000);
        return target.toISOString().split('T')[0];
      }
    }

    const isoMatch = lower.match(/\b(20\d\d-[01]\d-[0-3]\d)\b/);
    if (isoMatch) return isoMatch[1];

    return null;
  }

  /**
   * Match selected time from user speech with offered available slots
   */
  private matchSelectedSlot(lower: string, slots: AvailableSlot[]): AvailableSlot | null {
    for (const slot of slots) {
      const [hStr, mStr] = slot.timeStr.split(':');
      const h = parseInt(hStr, 10);
      const displayHour = h > 12 ? h - 12 : h;

      if (lower.includes(slot.timeStr) || lower.includes(slot.displayTime.toLowerCase())) {
        return slot;
      }

      const period = h >= 12 ? 'pm' : 'am';
      if (
        (lower.includes(`${displayHour} ${period}`) ||
          lower.includes(`${displayHour}:${mStr}`) ||
          lower.includes(`${displayHour}am`) ||
          lower.includes(`${displayHour}pm`))
      ) {
        return slot;
      }
    }

    if (/\b(first\s+one|first\s+slot|that\s+works|sounds\s+good|any\s+of\s+those|morning|afternoon|slot)\b/i.test(lower)) {
      return slots[0];
    }
    return null;
  }

  /**
   * Reschedule Workflow Handler
   */
  private async handleRescheduleFlow(
    session: DentalConversationSession,
    lower: string,
    language: string
  ): Promise<{ answer: string; isDentalHandled: boolean; requiresTransfer: boolean }> {
    const refMatch = lower.match(/\b(den-\d{4}-[a-z0-9]{4})\b/i);
    if (refMatch) {
      session.targetBookingReference = refMatch[1].toUpperCase();
    }

    if (!session.targetBookingReference) {
      const promptRef = "I can certainly help you reschedule your dental appointment. Could you please share your booking reference (for example, DEN-2026-ABCD)?";
      return { answer: await this.localize(promptRef, language), isDentalHandled: true, requiresTransfer: false };
    }

    const newDate = this.extractDatePreference(lower);
    if (!newDate) {
      const promptNewDate = `Thank you. What new date would you prefer for booking reference ${session.targetBookingReference}?`;
      return { answer: await this.localize(promptNewDate, language), isDentalHandled: true, requiresTransfer: false };
    }

    const slots = await dentalAppointmentService.getAvailableSlots(newDate);
    if (!slots || slots.length === 0) {
      const noSlot = `There are no open slots available on ${newDate}. Would you like to select another date?`;
      return { answer: await this.localize(noSlot, language), isDentalHandled: true, requiresTransfer: false };
    }

    const targetSlot = slots[0];
    try {
      const updated = await dentalAppointmentService.rescheduleAppointment(
        session.targetBookingReference,
        targetSlot.startDateTime
      );
      const confirm = `Your appointment (${session.targetBookingReference}) has been successfully rescheduled to ${targetSlot.dateStr} at ${targetSlot.displayTime} with ${updated.dentist.name}.`;
      return { answer: await this.localize(confirm, language), isDentalHandled: true, requiresTransfer: false };
    } catch (err: any) {
      return { answer: await this.localize(err.message || 'Rescheduling failed', language), isDentalHandled: true, requiresTransfer: false };
    }
  }

  /**
   * Cancellation Workflow Handler
   */
  private async handleCancellationFlow(
    session: DentalConversationSession,
    lower: string,
    language: string
  ): Promise<{ answer: string; isDentalHandled: boolean; requiresTransfer: boolean }> {
    const refMatch = lower.match(/\b(den-\d{4}-[a-z0-9]{4})\b/i);
    if (refMatch) {
      session.targetBookingReference = refMatch[1].toUpperCase();
    }

    if (!session.targetBookingReference) {
      const promptRef = "I can help you cancel your appointment. What is your booking reference number (e.g. DEN-2026-ABCD)?";
      return { answer: await this.localize(promptRef, language), isDentalHandled: true, requiresTransfer: false };
    }

    try {
      await dentalAppointmentService.cancelAppointment(session.targetBookingReference, 'Patient requested cancellation');
      const confirm = `Your appointment with booking reference ${session.targetBookingReference} has been cancelled successfully. Please reach out if you would like to rebook in the future.`;
      return { answer: await this.localize(confirm, language), isDentalHandled: true, requiresTransfer: false };
    } catch (err: any) {
      return { answer: await this.localize(err.message || 'Cancellation failed', language), isDentalHandled: true, requiresTransfer: false };
    }
  }

  /**
   * Translate response to user's conversation language if non-English
   */
  private async localize(text: string, language: string): Promise<string> {
    if (!language || language === 'en') return text;

    if (language === 'ta') {
      const taMap: Record<string, string> = {
        "Wisdom tooth pain can have several causes, including impaction, gum inflammation or infection. Is the pain on your upper or lower jaw?":
          "ஞானப்பல் வலி பல்வேறு காரணங்களால் ஏற்படலாம். வலி உங்கள் மேல் தாடையிலா அல்லது கீழ் தாடையிலா?",
        "I understand wisdom tooth pain can be very uncomfortable. Is the pain in your upper or lower jaw, and on the left or right side?":
          "ஞானப்பல் வலி மிகவும் கடினமாக இருக்கும் என்பதை நான் புரிந்துகொள்கிறேன். வலி உங்கள் மேல் தாடையிலா அல்லது கீழ் தாடையிலா, மற்றும் இடது பக்கமா அல்லது வலது பக்கமா?",
        "Which area of your mouth or tooth is hurting? Is it on the upper or lower side?":
          "உங்கள் வாயில் எந்தப் பகுதி அல்லது எந்தப் பல் வலிக்கிறது? அது மேல் பகுதியிலா அல்லது கீழ் பகுதியிலா?",
        "When did this pain start, and how long has it been bothering you?":
          "இந்த வலி எப்போது தொடங்கியது, மற்றும் எத்தனை நாட்களாக உங்களுக்கு இந்த வலி உள்ளது?",
        "What type of pain are you experiencing? Is it sharp, dull, or throbbing?":
          "நீங்கள் எத்தகைய வலியை உணர்கிறீர்கள்? அது கூர்மையானதா, மந்தமானதா அல்லது துடிக்கும் வலியா?",
        "Is the pain constant or does it come and go, and does it hurt more when you chew or bite down?":
          "வலி தொடர்ந்து இருக்கிறதா அல்லது விட்டு விட்டு வருகிறதா, மேலும் மெல்லும்போது வலி அதிகமாகிறதா?",
        "On a scale from 1 to 10, how would you rate the severity of the pain right now?":
          "1 முதல் 10 வரையிலான அளவில், இப்போது வலியின் தீவிரத்தை நீங்கள் எவ்வாறு மதிப்பிடுவீர்கள்?",
        "Are you noticing any swelling around the jaw, a fever, or difficulty opening your mouth?":
          "தாடையைச் சுற்றி ஏதேனும் வீக்கம், காய்ச்சல் அல்லது வாயைத் திறப்பதில் சிரமம் உள்ளதா?",
        "Certainly. Which date would you prefer? For example, tomorrow, this Thursday, or Friday?":
          "நிச்சயமாக. நீங்கள் எந்த தேதியை விரும்புகிறீர்கள்? உதாரணமாக, நாளை அல்லது இந்த வெள்ளிக்கிழமை?",
        "This sounds like a potentially serious medical emergency. Because you are experiencing difficulty swallowing or breathing with facial swelling, please immediately seek emergency medical attention at the nearest hospital emergency room or dial 911 (or your local emergency number). I am also alerting our on-call clinical team right now.":
          "இது ஒரு தீவிர மருத்துவ அவசர நிலையாகத் தோன்றுகிறது. முக வீக்கத்துடன் விழுங்குவதிலோ அல்லது சுவாசிப்பதிலோ சிரமம் இருப்பதால், உடனடியாக அருகில் உள்ள மருத்துவமனை அவசர சிகிச்சைப் பிரிவிற்கு செல்லவும் அல்லது அவசர உதவிக்கு அழைக்கவும். எங்கள் மருத்துவக் குழுவிற்கும் உடனடியாக தகவல் தெரிவிக்கிறேன்.",
        "Our dental clinic is open Monday through Saturday from 9:00 AM to 5:00 PM. We are closed on Sundays. Would you like to schedule an appointment?":
          "எங்கள் பல் மருத்துவமனை திங்கள் முதல் சனிக்கிழமை வரை காலை 9:00 மணி முதல் மாலை 5:00 மணி வரை திறந்திருக்கும். ஞாயிற்றுக்கிழமை விடுமுறை. நீங்கள் முன்பதிவு செய்ய விரும்புகிறீர்களா?"
      };
      if (taMap[text]) return taMap[text];
    }

    try {
      const translated = await translationService.translateText(text, language, 'en');
      if (translated && translated !== text) return translated;
    } catch (err) {
      console.warn('[DentalAI] Translation failed, returning English:', err);
    }

    if (language === 'ta') {
      if (text.toLowerCase().includes('toothache') || text.toLowerCase().includes('hurting')) {
        return "உங்களுக்கு பல் வலி இருப்பது குறித்து வருந்துகிறேன். உங்கள் வாயில் எந்தப் பகுதியில் அல்லது எந்தப் பல்லில் வலி உள்ளது?";
      }
      if (text.toLowerCase().includes('date') || text.toLowerCase().includes('prefer')) {
        return "நிச்சயமாக. நீங்கள் எந்த தேதியை விரும்புகிறீர்கள்? உதாரணமாக, நாளை அல்லது இந்த வெள்ளிக்கிழமை?";
      }
    }

    return text;
  }
}

export const dentalAiService = new DentalAiService();
