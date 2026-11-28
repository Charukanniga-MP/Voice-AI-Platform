import OpenAI from 'openai';
import { prisma } from '../db.js';
import { knowledgeService } from './knowledge.js';

export type ConversationIntent =
  | 'GREETING'
  | 'HELP_OFFER'
  | 'ACCOUNT_ISSUE'
  | 'PREVIOUS_HISTORY'
  | 'TECHNICAL_SUPPORT'
  | 'BILLING_INQUIRY'
  | 'PRODUCT_INQUIRY'
  | 'COMPANY_INFO'
  | 'COMPLAINT'
  | 'OUT_OF_DOMAIN'
  | 'HUMAN_TRANSFER'
  | 'FOLLOW_UP'
  | 'CLARIFICATION'
  | 'GENERAL_QUESTION';

export type ConversationStage =
  | 'greeting'
  | 'issue_intake'
  | 'troubleshooting'
  | 'providing_solution'
  | 'followup'
  | 'escalated';

export interface TurnRecord {
  role: 'customer' | 'ai';
  text: string;
  intent?: ConversationIntent;
  timestamp: Date;
}

export interface CallContextMemory {
  callId: string;
  customerId?: string;
  customerName?: string;
  currentIntent?: ConversationIntent;
  stage: ConversationStage;
  collectedData: {
    issueCategory?: string;
    issueDetails?: string;
    deviceOrBrowser?: string;
    priorContactNoted?: boolean;
    productInterest?: string;
    ticketId?: string;
    [key: string]: any;
  };
  questionsAsked: string[];
  questionsAnswered: string[];
  turns: TurnRecord[];
}

export interface ConversationalTurnRequest {
  callId: string;
  query: string;
  language?: string;
  customerContext?: any;
  callHistory?: Array<{ role?: string; sender?: string; content?: string; text?: string }>;
}

export interface ConversationalTurnResponse {
  answer: string;
  intent: ConversationIntent;
  requiresTransfer: boolean;
  transferReason?: string;
  isGrounded: boolean;
  confidence: number;
  sources?: any[];
  provider?: 'gemini' | 'openai' | 'conversational-engine';
}

export class ConversationalIntelligenceService {
  private openai: OpenAI | null = null;
  private geminiApiKey: string | null = null;
  public isQuotaExhausted: boolean = false;

  // In-memory per-call conversation context
  private sessionMemory = new Map<string, CallContextMemory>();

  constructor() {
    // 1. Initialize OpenAI SDK if valid key present
    const openAiKey = process.env.OPENAI_API_KEY?.trim();
    if (openAiKey && !openAiKey.includes('your-') && !openAiKey.includes('replace-')) {
      try {
        this.openai = new OpenAI({ apiKey: openAiKey });
      } catch (err) {
        console.warn('[ConversationalAI] OpenAI init skipped:', err);
      }
    }

    // 2. Initialize Google Gemini API key
    const geminiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)?.trim();
    if (geminiKey && !geminiKey.includes('your-') && !geminiKey.includes('replace-')) {
      this.geminiApiKey = geminiKey;
    }
  }

  /**
   * Get or initialize per-call session memory
   */
  public getOrCreateMemory(callId: string, customerName?: string, customerId?: string): CallContextMemory {
    let memory = this.sessionMemory.get(callId);
    if (!memory) {
      memory = {
        callId,
        customerName: customerName || 'Customer',
        customerId,
        stage: 'greeting',
        collectedData: {},
        questionsAsked: [],
        questionsAnswered: [],
        turns: []
      };
      this.sessionMemory.set(callId, memory);
    } else {
      if (customerName && memory.customerName === 'Customer') memory.customerName = customerName;
      if (customerId && !memory.customerId) memory.customerId = customerId;
    }
    return memory;
  }

  /**
   * Initial General Customer Support Greeting
   */
  public getInitialGreeting(customerName?: string): string {
    const hasName = Boolean(
      customerName &&
      customerName.toLowerCase() !== 'customer' &&
      customerName.toLowerCase() !== 'user' &&
      customerName.toLowerCase() !== 'null' &&
      customerName.toLowerCase() !== 'undefined'
    );

    return hasName
      ? `Hello! Welcome ${customerName} to KAIRA customer support. I am Kaira, your virtual support specialist. How may I assist you today?`
      : `Hello! Welcome to KAIRA customer support. I am Kaira, your virtual support specialist. How may I assist you today?`;
  }

  /**
   * Classify intent with context awareness
   */
  public classifyIntent(query: string, memory: CallContextMemory): ConversationIntent {
    const clean = query.toLowerCase().replace(/['’]/g, '').replace(/[.,!?;:"]/g, ' ').trim();

    // 1. Explicit Human Transfer
    if (
      /\b(speak\s+to|talk\s+to|connect\s+(?:me\s+)?to|transfer\s+(?:me\s+)?to|put\s+me\s+through|human|person|agent|representative|operator|support\s+staff)\b/i.test(clean) &&
      !/\b(how\s+does|can\s+the|does\s+the|what\s+is)\b/i.test(clean)
    ) {
      return 'HUMAN_TRANSFER';
    }

    // 2. Pure Greetings
    if (/^(hi|hello|hey|good\s+(?:morning|afternoon|evening)|howdy)\b/i.test(clean) && clean.split(/\s+/).length <= 4) {
      return 'GREETING';
    }

    // 3. Help Offer / Inquiries ("Can you help me?")
    if (
      /^(can\s+you\s+help\s+me|i\s+need\s+help|help\s+me|what\s+can\s+you\s+do|can\s+you\s+assist\s+me|are\s+you\s+able\s+to\s+help)\b/i.test(clean)
    ) {
      return 'HELP_OFFER';
    }

    // 4. Previous Contact History ("I already contacted support yesterday")
    if (
      /\b(already\s+(?:contacted|called|spoke|reached\s+out|messaged)|contacted\s+support\s+yesterday|called\s+yesterday|previous\s+(?:ticket|call|complaint)|check\s+my\s+previous|last\s+(?:ticket|call))\b/i.test(clean)
    ) {
      return 'PREVIOUS_HISTORY';
    }

    // 5. Account-Related Issues ("I am facing a problem with my account", "can't log in")
    if (
      /\b(problem\s+with\s+my\s+account|issue\s+with\s+my\s+account|account\s+issue|account\s+problem|cant\s+log\s*in|cannot\s+log\s*in|login\s+issue|login\s+problem|login\s+credentials|login|credentials|reset\s+my\s+password|forgot\s+password|invalid\s+password|password\s+error|password|account\s+locked|locked\s+out|change\s+my\s+email)\b/i.test(clean)
    ) {
      return 'ACCOUNT_ISSUE';
    }

    // 6. Technical Support
    if (
      /\b(audio\s+(?:cut|cutting|disconnect|glitch|broken)|microphone\s+(?:issue|error|not\s+working)|echo\s+loop|api\s+(?:error|timeout|failure)|webrtc\s+(?:disconnected|error)|connection\s+failed|latency\s+(?:lag|delay))\b/i.test(clean)
    ) {
      return 'TECHNICAL_SUPPORT';
    }

    // 7. Billing & Pricing
    if (
      /\b(billing|invoice|subscription|refund|how\s+much\s+(?:does\s+it\s+)?cost|pricing\s+plans?|starter\s+plan|growth\s+plan|enterprise\s+plan|payment\s+failed|charge|charged)\b/i.test(clean)
    ) {
      return 'BILLING_INQUIRY';
    }

    // 8. Product & Platform Inquiries
    if (
      /\b(what\s+products|voicecore|liveescalate|omnichannel|features|barge\s*in|call\s+recording|retention\s+policy|languages\s+supported|regional\s+languages)\b/i.test(clean)
    ) {
      return 'PRODUCT_INQUIRY';
    }

    // 9. Complaints & Dissatisfaction
    if (
      /\b(unhappy|angry|frustrated|terrible\s+service|horrible|worst|pathetic|ridiculous|unacceptable|no\s+one\s+is\s+helping|waste\s+of\s+time|complaint)\b/i.test(clean)
    ) {
      return 'COMPLAINT';
    }

    // 10. Out-of-Domain Detection (Dental, Healthcare, Food Delivery, Weather, Sports, Airlines)
    if (
      /\b(wisdom\s+teeth|tooth\s*ache|teeth|dentist|dental|root\s+canal|gum\s+bleeding|tooth\s+pain|cavity|orthodontist|doctor|hospital|headache|fever|cough|prescription|medicine|pizza|burger|food\s+delivery|order\s+food|flight\s+ticket|hotel\s+booking|weather\s+today|cricket\s+score|football\s+match)\b/i.test(clean)
    ) {
      return 'OUT_OF_DOMAIN';
    }

    // 11. Company & Office Information
    if (
      /\b(office\s+location|headquarters|business\s+hours|working\s+hours|support\s+email|phone\s+number|who\s+(?:founded|is\s+the\s+ceo))\b/i.test(clean)
    ) {
      return 'COMPANY_INFO';
    }

    // 12. Short Follow-Up or Clarification Response in Active Stage
    if (memory.stage === 'issue_intake' || memory.stage === 'troubleshooting') {
      if (clean.split(/\s+/).length <= 5) {
        return 'CLARIFICATION';
      }
    }

    // 13. Pronoun Follow-Up ("Does it?", "How does that work?", "Where is it?")
    if (/\b(it|this|that|does\s+it|can\s+it|is\s+it|what\s+about\s+that)\b/i.test(clean)) {
      return 'FOLLOW_UP';
    }

    return 'GENERAL_QUESTION';
  }

  /**
   * Main Conversational Turn Handler
   */
  public async handleTurn(req: ConversationalTurnRequest): Promise<ConversationalTurnResponse> {
    const memory = this.getOrCreateMemory(
      req.callId,
      req.customerContext?.customerName,
      req.customerContext?.customerId
    );

    const query = (req.query || '').trim();
    const intent = this.classifyIntent(query, memory);
    memory.currentIntent = intent;

    // Record turn in history
    memory.turns.push({ role: 'customer', text: query, intent, timestamp: new Date() });

    // 1. HUMAN_TRANSFER
    if (intent === 'HUMAN_TRANSFER') {
      memory.stage = 'escalated';
      const answer = "Certainly. I'll help connect you with a support representative right away. Please hold the line for just a moment.";
      memory.turns.push({ role: 'ai', text: answer, intent, timestamp: new Date() });
      return {
        answer,
        intent,
        requiresTransfer: true,
        transferReason: 'Customer Explicitly Requested Human Support',
        isGrounded: true,
        confidence: 1.0,
        provider: 'conversational-engine'
      };
    }

    // 2. HELP_OFFER ("Can you help me?")
    if (intent === 'HELP_OFFER') {
      memory.stage = 'issue_intake';
      const answer = "Of course! What would you like help with?";
      memory.turns.push({ role: 'ai', text: answer, intent, timestamp: new Date() });
      return {
        answer,
        intent,
        requiresTransfer: false,
        isGrounded: true,
        confidence: 1.0,
        provider: 'conversational-engine'
      };
    }

    // 3. ACCOUNT_ISSUE ("I am facing a problem with my account")
    if (intent === 'ACCOUNT_ISSUE') {
      const cleanLower = query.toLowerCase().replace(/['’]/g, '').replace(/[.,!?;:"]/g, ' ').trim();

      // If customer is already in troubleshooting stage or specifies password issue
      if (
        (/\b(password|credential|credentials|invalid)\b/i.test(cleanLower)) &&
        (memory.stage === 'troubleshooting' || memory.questionsAsked.includes('login_error_detail') || memory.collectedData.issueType === 'login_trouble')
      ) {
        memory.collectedData.issueType = 'password_reset';
        memory.stage = 'providing_solution';
        const answer = "Since the system is indicating an invalid password, you can easily recover access using the 'Forgot Password' link on the login page to receive a secure password reset email.";
        memory.turns.push({ role: 'ai', text: answer, intent, timestamp: new Date() });
        return {
          answer,
          intent,
          requiresTransfer: false,
          isGrounded: true,
          confidence: 1.0,
          provider: 'conversational-engine'
        };
      }

      // Check if specific issue is login / sign-in trouble
      if (
        /\b(cant|cannot|can\s+not)\s+log\s*in\b/i.test(cleanLower) ||
        /\b(login|log\s*in|sign\s*in|credentials)\b/i.test(cleanLower)
      ) {
        memory.collectedData.issueType = 'login_trouble';
        memory.questionsAnswered.push('account_issue_category');
        memory.stage = 'troubleshooting';

        const answer = "I understand you're having trouble logging in. Are you seeing an 'invalid credentials' error, or is the page not loading?";
        memory.questionsAsked.push('login_error_detail');
        memory.turns.push({ role: 'ai', text: answer, intent, timestamp: new Date() });
        return {
          answer,
          intent,
          requiresTransfer: false,
          isGrounded: true,
          confidence: 1.0,
          provider: 'conversational-engine'
        };
      }

      if (/\b(password|forgot\s+password|reset\s+password)\b/i.test(cleanLower)) {
        memory.collectedData.issueType = 'password_reset';
        memory.stage = 'providing_solution';
        const answer = "You can easily reset your password using the 'Forgot Password' link on the login page. An automated reset email will be sent to your registered address.";
        memory.turns.push({ role: 'ai', text: answer, intent, timestamp: new Date() });
        return {
          answer,
          intent,
          requiresTransfer: false,
          isGrounded: true,
          confidence: 1.0,
          provider: 'conversational-engine'
        };
      }

      // General account problem statement -> Ask single focused question
      memory.stage = 'issue_intake';
      const answer = "I'm sorry about that. Could you tell me what issue you're experiencing with your account?";
      memory.questionsAsked.push('account_issue_category');
      memory.turns.push({ role: 'ai', text: answer, intent, timestamp: new Date() });
      return {
        answer,
        intent,
        requiresTransfer: false,
        isGrounded: true,
        confidence: 1.0,
        provider: 'conversational-engine'
      };
    }

    // 4. PREVIOUS_HISTORY ("I already contacted support yesterday")
    if (intent === 'PREVIOUS_HISTORY') {
      memory.collectedData.priorContactNoted = true;
      memory.stage = 'troubleshooting';

      // Live lookup of previous tickets / call history if customer is identified
      let foundTicketInfo = '';
      if (req.customerContext?.tickets && req.customerContext.tickets.length > 0) {
        const topTicket = req.customerContext.tickets[0];
        foundTicketInfo = `I see your ticket #${topTicket.id.slice(-6).toUpperCase()} regarding "${topTicket.subject}" is currently marked as ${topTicket.status}.`;
      } else if (memory.customerId) {
        try {
          const tickets = await prisma.supportTicket.findMany({
            where: { customerId: memory.customerId },
            orderBy: { createdAt: 'desc' },
            take: 1
          });
          if (tickets.length > 0) {
            foundTicketInfo = `I found your recent ticket #${tickets[0].id.slice(-6).toUpperCase()} regarding "${tickets[0].subject}" with status '${tickets[0].status}'.`;
          }
        } catch (_) { }
      }

      const answer = foundTicketInfo
        ? `I understand. Let me check your previous support history. ${foundTicketInfo} Would you like me to update this ticket or connect you with a representative?`
        : "I understand. Let me check whether there is any previous support history available on your account. I can locate your records or connect you with a support representative right away.";

      memory.turns.push({ role: 'ai', text: answer, intent, timestamp: new Date() });
      return {
        answer,
        intent,
        requiresTransfer: false,
        isGrounded: true,
        confidence: 1.0,
        provider: 'conversational-engine'
      };
    }

    // 5. OUT_OF_DOMAIN ("I have wisdom teeth pain", "Order a pizza", etc.)
    if (intent === 'OUT_OF_DOMAIN') {
      const lower = query.toLowerCase();
      let answer = "I specialize in KAIRA's customer communication and AI voice platform. While I cannot assist with dental or medical care, I'm here to help with your account, technical support, or platform features.";

      if (/\b(pizza|burger|food|restaurant)\b/i.test(lower)) {
        answer = "I specialize in KAIRA's AI customer communication platform and cannot assist with food delivery, but I'd be glad to help with our voice solutions or support services!";
      } else if (/\b(weather|temperature|forecast)\b/i.test(lower)) {
        answer = "I focus on KAIRA's voice communication solutions and don't provide weather forecasts, but I'm happy to help you with our products or support inquiries!";
      }

      memory.turns.push({ role: 'ai', text: answer, intent, timestamp: new Date() });
      return {
        answer,
        intent,
        requiresTransfer: false,
        isGrounded: false,
        confidence: 0.95,
        provider: 'conversational-engine'
      };
    }

    // 6. GREETING in active conversation
    if (intent === 'GREETING') {
      const isCallActive = memory.turns.filter(t => t.role === 'customer').length > 1;
      const answer = isCallActive
        ? "Hello! How can I help you today?"
        : this.getInitialGreeting(req.customerContext?.customerName || memory.customerName);

      memory.turns.push({ role: 'ai', text: answer, intent, timestamp: new Date() });
      return {
        answer,
        intent,
        requiresTransfer: false,
        isGrounded: true,
        confidence: 1.0,
        provider: 'conversational-engine'
      };
    }

    // 7. CLARIFICATION / IN-FLIGHT ANSWER EXTRACTION
    if (intent === 'CLARIFICATION' && memory.stage === 'troubleshooting') {
      const lower = query.toLowerCase();

      // Customer providing login error details
      if (memory.collectedData.issueType === 'login_trouble') {
        memory.questionsAnswered.push('login_error_detail');
        memory.stage = 'providing_solution';

        let answer = "Thank you for clarifying. If you are seeing an invalid password notice, please try resetting your credentials via the 'Forgot Password' link, or I can connect you with an agent.";
        if (lower.includes('page') || lower.includes('load') || lower.includes('blank') || lower.includes('white')) {
          answer = "I understand the page is not loading properly. Please try clearing your browser cache or opening the platform in an incognito window.";
        }

        memory.turns.push({ role: 'ai', text: answer, intent, timestamp: new Date() });
        return {
          answer,
          intent,
          requiresTransfer: false,
          isGrounded: true,
          confidence: 0.95,
          provider: 'conversational-engine'
        };
      }
    }

    // 8. KNOWLEDGE BASE CONSULTATION WITH RELEVANCE THRESHOLD
    const kbResult = await knowledgeService.answerQuery(
      query,
      req.callHistory as any || [],
      req.customerContext
    );

    // If KB match has good confidence (>= 0.40) and is grounded
    if (kbResult.isGrounded && kbResult.confidence >= 0.40 && kbResult.answer) {
      // Guard against unsolicited architecture answers when user asked unrelated query
      const isTechArchitectureAnswer = kbResult.answer.toLowerCase().includes('webrtc') && kbResult.answer.toLowerCase().includes('web speech');
      const userAskedTech = /\b(how\s+(?:does\s+)?(?:it|kaira|voice\s+agent)\s+work|behind\s+the\s+scenes|architecture|technology|webrtc|speech\s+recognition)\b/i.test(query);

      if (isTechArchitectureAnswer && !userAskedTech) {
        // Suppress unwanted architecture reciting!
        const fallback = "I'm here to help with your KAIRA account, support tickets, and voice features. Could you clarify what specific information you're looking for?";
        memory.turns.push({ role: 'ai', text: fallback, intent, timestamp: new Date() });
        return {
          answer: fallback,
          intent,
          requiresTransfer: false,
          isGrounded: false,
          confidence: 0.8,
          provider: 'conversational-engine'
        };
      }

      memory.turns.push({ role: 'ai', text: kbResult.answer, intent, timestamp: new Date() });
      return {
        answer: kbResult.answer,
        intent,
        requiresTransfer: kbResult.requiresTransfer || false,
        isGrounded: true,
        confidence: kbResult.confidence,
        sources: kbResult.sources,
        provider: 'conversational-engine'
      };
    }

    // 9. LLM REASONING LAYER (Gemini REST API or OpenAI) for Natural Support Conversation
    const llmAnswer = await this.generateLlmResponse(query, memory, req.callHistory);
    if (llmAnswer) {
      memory.turns.push({ role: 'ai', text: llmAnswer, intent, timestamp: new Date() });
      return {
        answer: llmAnswer,
        intent,
        requiresTransfer: false,
        isGrounded: false,
        confidence: 0.9,
        provider: this.geminiApiKey ? 'gemini' : (this.openai ? 'openai' : 'conversational-engine')
      };
    }

    // 10. Default Polite Fallback
    const fallbackAnswer = "I understand. I don't have that specific information in our verified records, but I can check your account details or connect you with a team member who can help.";
    memory.turns.push({ role: 'ai', text: fallbackAnswer, intent, timestamp: new Date() });
    return {
      answer: fallbackAnswer,
      intent,
      requiresTransfer: false,
      isGrounded: false,
      confidence: 0.7,
      provider: 'conversational-engine'
    };
  }

  /**
   * LLM Response Generation (Google Gemini REST API / OpenAI SDK)
   */
  private async generateLlmResponse(
    query: string,
    memory: CallContextMemory,
    callHistory?: any[]
  ): Promise<string | null> {
    const systemPrompt = `You are Kaira, a professional and courteous AI customer support specialist for KAIRA, a general-purpose real-time AI voice communication and customer support platform.

STRICT CONVERSATIONAL GUIDELINES:
1. Speak in a warm, helpful, natural, and concise tone (1 to 2 sentences max).
2. Ask ONE relevant question at a time. Never overwhelm the caller.
3. Understand short and incomplete sentences and maintain context from earlier turns.
4. If the caller asks something outside of customer communication or business platform support (like medical, dental, food ordering), politely explain that KAIRA focuses on customer support and voice solutions, and redirect them.
5. NEVER explain internal WebRTC, speech recognition, or technical architecture unless the customer explicitly asks how KAIRA works behind the scenes.
6. Never invent pricing, contact numbers, or unverified company policies.`;

    const recentHistory = (callHistory || []).slice(-4).map((h: any) => ({
      role: (h.role || (h.sender === 'customer' ? 'user' : 'assistant')) === 'user' ? 'user' : 'model',
      text: h.content || h.text || ''
    })).filter(h => h.text);

    // 1. Try Google Gemini REST API
    if (this.geminiApiKey) {
      try {
        const contents = [
          { role: 'user', parts: [{ text: `System Instruction: ${systemPrompt}` }] },
          ...recentHistory.map(h => ({
            role: h.role === 'model' ? 'model' : 'user',
            parts: [{ text: h.text }]
          })),
          { role: 'user', parts: [{ text: query }] }
        ];

        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.geminiApiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents,
            generationConfig: {
              temperature: 0.25,
              maxOutputTokens: 90
            }
          })
        });

        if (resp.ok) {
          const data: any = await resp.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (text && text.length > 3) {
            return text.replace(/\n+/g, ' ');
          }
        }
      } catch (geminiErr) {
        console.warn('[ConversationalAI] Gemini REST API error:', geminiErr);
      }
    }

    // 2. Try OpenAI if configured
    if (this.openai && !this.isQuotaExhausted) {
      try {
        const messages: any[] = [
          { role: 'system', content: systemPrompt },
          ...(callHistory || []).slice(-4).map((h: any) => ({
            role: (h.role || (h.sender === 'customer' ? 'user' : 'assistant')) === 'user' ? 'user' : 'assistant',
            content: h.content || h.text || ''
          })),
          { role: 'user', content: query }
        ];

        const completion = await this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages,
          temperature: 0.25,
          max_tokens: 80
        });

        const reply = completion.choices[0]?.message?.content?.trim();
        if (reply && reply.length > 3) {
          return reply.replace(/\n+/g, ' ');
        }
      } catch (err: any) {
        if (err?.code === 'insufficient_quota' || err?.status === 429) {
          this.isQuotaExhausted = true;
        }
      }
    }

    return null;
  }
}

export const conversationalIntelligenceService = new ConversationalIntelligenceService();
