import { prisma } from '../db.js';
import OpenAI from 'openai';

export interface ExtractedIntelligence {
  callReason: string;
  customerQuestions: string[];
  solutionsProvided: string[];
  kbSourcesUsed: string[];
  resolutionStatus: 'resolved' | 'partially_resolved' | 'unresolved' | 'escalated_admin';
  resolutionExplanation: string;
  unresolvedQuestions: string[];
  actionItems: string[];
  overallSummary: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
}

class CallIntelligenceService {
  private openai: OpenAI | null = null;

  constructor() {
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
  }

  /**
   * Main entrypoint to process post-call intelligence asynchronously
   */
  public async processCall(callIdentifier: string, forceRetry = false): Promise<any> {
    try {
      console.log(`[CallIntelligence] Processing intelligence for call: ${callIdentifier} (forceRetry: ${forceRetry})`);

      // 1. Fetch Call Record with relations
      const call = await prisma.callRecord.findFirst({
        where: {
          OR: [
            { id: callIdentifier },
            { callId: callIdentifier },
            { providerCallSid: callIdentifier }
          ]
        },
        include: {
          transcripts: {
            orderBy: { timestamp: 'asc' }
          },
          customer: true,
          agent: true,
          admin: true,
          transferRequests: true,
          intelligence: true,
          followUpTasks: true
        }
      });

      if (!call) {
        console.warn(`[CallIntelligence] Call record not found for identifier: ${callIdentifier}`);
        return null;
      }

      // Idempotency check: don't re-run if already successfully processed unless forceRetry is true
      if (call.intelligence && call.intelligence.processingStatus === 'completed' && !forceRetry) {
        console.log(`[CallIntelligence] Call ${call.id} already processed. Returning cached intelligence.`);
        return call.intelligence;
      }

      // Filter transcripts to actual conversational messages
      const conversationTranscripts = call.transcripts.filter(t => {
        const text = (t.text || '').trim();
        if (!text) return false;
        // Ignore generic socket/WebRTC setup messages unless nothing else exists
        if (text.startsWith('WebRTC ') || text.startsWith('Call placed on hold') || text.startsWith('Call resumed')) return false;
        return true;
      });

      let intelligenceData: ExtractedIntelligence;

      // 2. Check for missing or incomplete transcripts
      const customerOrAgentSpeech = conversationTranscripts.filter(t => t.sender === 'customer' || t.sender === 'agent' || t.sender === 'ai' || t.sender === 'admin');

      if (customerOrAgentSpeech.length < 2) {
        console.log(`[CallIntelligence] Call ${call.id} has insufficient dialogue transcript (${customerOrAgentSpeech.length} utterances). Recording unavailable flag.`);
        intelligenceData = this.buildIncompleteTranscriptIntelligence(call, customerOrAgentSpeech);
      } else {
        // 3. Run AI Summarization and Classification
        try {
          if (this.openai) {
            intelligenceData = await this.extractWithLLM(call, conversationTranscripts);
          } else {
            intelligenceData = this.extractWithHeuristics(call, conversationTranscripts);
          }
        } catch (aiErr: any) {
          console.error(`[CallIntelligence] AI analysis failed, falling back to heuristic engine:`, aiErr?.message || aiErr);
          intelligenceData = this.extractWithHeuristics(call, conversationTranscripts);
        }
      }

      // 4. Save or Update CallIntelligence record in DB
      const savedIntelligence = await prisma.callIntelligence.upsert({
        where: { callRecordId: call.id },
        create: {
          callRecordId: call.id,
          customerId: call.customerId,
          customerName: call.customerName,
          agentId: call.agentId,
          agentName: call.agentName,
          duration: call.duration,
          language: call.language || 'en',
          callReason: intelligenceData.callReason,
          customerQuestions: JSON.stringify(intelligenceData.customerQuestions || []),
          solutionsProvided: JSON.stringify(intelligenceData.solutionsProvided || []),
          kbSourcesUsed: JSON.stringify(intelligenceData.kbSourcesUsed || []),
          resolutionStatus: intelligenceData.resolutionStatus,
          resolutionExplanation: intelligenceData.resolutionExplanation,
          unresolvedQuestions: JSON.stringify(intelligenceData.unresolvedQuestions || []),
          actionItems: JSON.stringify(intelligenceData.actionItems || []),
          overallSummary: intelligenceData.overallSummary,
          sentiment: intelligenceData.sentiment || 'neutral',
          processingStatus: 'completed',
          errorMessage: null,
          retryCount: call.intelligence ? call.intelligence.retryCount + 1 : 0
        },
        update: {
          customerName: call.customerName,
          agentName: call.agentName,
          duration: call.duration,
          language: call.language || 'en',
          callReason: intelligenceData.callReason,
          customerQuestions: JSON.stringify(intelligenceData.customerQuestions || []),
          solutionsProvided: JSON.stringify(intelligenceData.solutionsProvided || []),
          kbSourcesUsed: JSON.stringify(intelligenceData.kbSourcesUsed || []),
          resolutionStatus: intelligenceData.resolutionStatus,
          resolutionExplanation: intelligenceData.resolutionExplanation,
          unresolvedQuestions: JSON.stringify(intelligenceData.unresolvedQuestions || []),
          actionItems: JSON.stringify(intelligenceData.actionItems || []),
          overallSummary: intelligenceData.overallSummary,
          sentiment: intelligenceData.sentiment || 'neutral',
          processingStatus: 'completed',
          errorMessage: null,
          retryCount: call.intelligence ? call.intelligence.retryCount + 1 : 0
        }
      });

      // 5. Automatic Follow-Up Task Creation (if unresolved or escalated)
      if (
        (intelligenceData.resolutionStatus === 'unresolved' ||
          intelligenceData.resolutionStatus === 'partially_resolved' ||
          intelligenceData.resolutionStatus === 'escalated_admin')
      ) {
        await this.createFollowUpTasks(call, intelligenceData);
      }

      // 6. Track Knowledge Base Gaps for unanswered questions
      if (intelligenceData.unresolvedQuestions && intelligenceData.unresolvedQuestions.length > 0) {
        await this.trackKnowledgeGaps(intelligenceData.unresolvedQuestions, call.language || 'en', call.id);
      }

      console.log(`[CallIntelligence] Successfully processed intelligence for call ${call.id}. Status: ${intelligenceData.resolutionStatus}`);
      return savedIntelligence;
    } catch (err: any) {
      console.error(`[CallIntelligence] Critical error processing call ${callIdentifier}:`, err);
      // Ensure failure is tracked so safe retry is allowed
      try {
        const call = await prisma.callRecord.findFirst({
          where: { OR: [{ id: callIdentifier }, { callId: callIdentifier }, { providerCallSid: callIdentifier }] }
        });
        if (call) {
          await prisma.callIntelligence.upsert({
            where: { callRecordId: call.id },
            create: {
              callRecordId: call.id,
              customerId: call.customerId,
              customerName: call.customerName,
              agentId: call.agentId,
              agentName: call.agentName,
              duration: call.duration,
              language: call.language || 'en',
              callReason: 'Analysis error occurred',
              customerQuestions: '[]',
              solutionsProvided: '[]',
              resolutionStatus: 'unresolved',
              resolutionExplanation: `Automated intelligence analysis failed: ${err.message || 'Unknown error'}. Retry available.`,
              overallSummary: 'Analysis failed. Transcript is preserved and can be retried.',
              processingStatus: 'failed',
              errorMessage: err.message || 'Unknown error'
            },
            update: {
              processingStatus: 'failed',
              errorMessage: err.message || 'Unknown error'
            }
          });
        }
      } catch (upsertErr) {
        console.error('[CallIntelligence] Failed to record error state:', upsertErr);
      }
      return null;
    }
  }

  /**
   * Handle missing or incomplete transcripts cleanly
   */
  private buildIncompleteTranscriptIntelligence(call: any, speechTranscripts: any[]): ExtractedIntelligence {
    const isTransferred = call.transferred || (call.transferRequests && call.transferRequests.length > 0);
    const hadSystemError = call.status === 'failed' || !!call.failureReason;

    let explanation = 'Information unavailable: The voice call ended or disconnected before meaningful conversation occurred.';
    let status: 'unresolved' | 'escalated_admin' = 'unresolved';

    if (isTransferred) {
      status = 'escalated_admin';
      explanation = 'Call was transferred to Admin but dialogue was minimal or disconnected during transfer.';
    } else if (hadSystemError) {
      explanation = `Call failed prematurely due to telephony error: ${call.failureReason || 'Connection dropped'}.`;
    }

    const snippet = speechTranscripts.map(t => `${t.senderName || t.sender}: ${t.text}`).join('; ');

    return {
      callReason: snippet.slice(0, 100) || 'Brief connection / dropped call',
      customerQuestions: [],
      solutionsProvided: [],
      kbSourcesUsed: [],
      resolutionStatus: status,
      resolutionExplanation: explanation,
      unresolvedQuestions: hadSystemError ? ['Customer call disconnected prematurely'] : [],
      actionItems: hadSystemError || call.customerPhone ? ['Verify customer connection and attempt follow-up callback'] : [],
      overallSummary: `Information unavailable: The call lasted ${call.duration}s with insufficient spoken dialogue recorded in the transcript. ${explanation}`,
      sentiment: hadSystemError ? 'negative' : 'neutral',
      priority: hadSystemError ? 'high' : 'low'
    };
  }

  /**
   * Extract intelligence using OpenAI with strict JSON schema
   */
  private async extractWithLLM(call: any, transcripts: any[]): Promise<ExtractedIntelligence> {
    const transcriptText = transcripts
      .map(t => {
        const time = new Date(t.timestamp).toLocaleTimeString();
        const role = t.senderName || t.sender.toUpperCase();
        const text = t.text;
        const trans = t.translation ? ` [English translation: ${t.translation}]` : '';
        return `[${time}] ${role}: ${text}${trans}`;
      })
      .join('\n');

    const isTransferred = call.transferred || (call.transferRequests && call.transferRequests.length > 0);

    const systemPrompt = `You are KAIRA's Enterprise AI Call Intelligence & Quality Auditor.
Analyze the following customer support call transcript between a customer and support agent/AI.
Produce a strict, truthful, and accurate JSON post-call intelligence report.

RULES FOR ANALYSIS:
1. Do not invent information. If something was not discussed, do not assume or fabricate it.
2. Resolution Status must be strictly one of:
   - "resolved": All customer questions were answered, solutions provided, and customer explicitly confirmed satisfaction or resolution.
   - "partially_resolved": Some questions were addressed, but remaining issues or follow-ups are needed.
   - "unresolved": The primary question or issue was not answered/resolved, customer was unhappy, or no solution was provided.
   - "escalated_admin": The call was transferred to an Admin or escalated for human administrative review.
   Note: ${isTransferred ? 'This call was flagged in the system as transferred to an Admin.' : ''}
   Never mark a call "resolved" simply because it ended. Look for explicit confirmation (e.g., "thank you, that helped", "all set", "problem solved").
3. Language Support:
   The customer may speak in Tamil, English, Telugu, Malayalam, or Hindi.
   Preserve technical names, company names ("KAIRA VoiceCore", "KAIRA LiveEscalate", "KAIRA Omnichannel Hub"), numbers, and prices exactly.
   Provide the overallSummary in clear, professional English.
4. Output JSON strictly with these keys:
   {
     "callReason": "Brief phrase describing why the customer called",
     "customerQuestions": ["Array of distinct questions or inquiries asked by the customer"],
     "solutionsProvided": ["Array of solutions, answers, or guidance provided by the agent or AI"],
     "kbSourcesUsed": ["Array of Knowledge Base topics or verified facts cited in the answer"],
     "resolutionStatus": "resolved" | "partially_resolved" | "unresolved" | "escalated_admin",
     "resolutionExplanation": "Detailed 1-2 sentence rationale explaining why this status was classified based on conversation evidence",
     "unresolvedQuestions": ["Array of any questions that remained unanswered or need verification"],
     "actionItems": ["Array of concrete follow-up tasks required by the team"],
     "overallSummary": "Comprehensive 3-5 sentence structured English summary of the entire call",
     "sentiment": "positive" | "neutral" | "negative",
     "priority": "low" | "medium" | "high" | "urgent"
   }`;

    const completion = await this.openai!.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `CUSTOMER INFO: Name: ${call.customerName}, Phone: ${call.customerPhone || 'N/A'}, Language: ${call.language || 'en'}, Duration: ${call.duration}s.
TRANSCRIPT:
${transcriptText}`
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 800
    });

    const content = completion.choices[0]?.message?.content?.trim() || '{}';
    const parsed = JSON.parse(content);

    // Validate fields
    return {
      callReason: parsed.callReason || 'Customer inquiry',
      customerQuestions: Array.isArray(parsed.customerQuestions) ? parsed.customerQuestions : [],
      solutionsProvided: Array.isArray(parsed.solutionsProvided) ? parsed.solutionsProvided : [],
      kbSourcesUsed: Array.isArray(parsed.kbSourcesUsed) ? parsed.kbSourcesUsed : [],
      resolutionStatus: ['resolved', 'partially_resolved', 'unresolved', 'escalated_admin'].includes(parsed.resolutionStatus)
        ? parsed.resolutionStatus
        : (isTransferred ? 'escalated_admin' : 'unresolved'),
      resolutionExplanation: parsed.resolutionExplanation || 'Evaluation based on dialog analysis.',
      unresolvedQuestions: Array.isArray(parsed.unresolvedQuestions) ? parsed.unresolvedQuestions : [],
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
      overallSummary: parsed.overallSummary || 'Call session completed.',
      sentiment: ['positive', 'neutral', 'negative'].includes(parsed.sentiment) ? parsed.sentiment : 'neutral',
      priority: ['low', 'medium', 'high', 'urgent'].includes(parsed.priority) ? parsed.priority : 'medium'
    };
  }

  /**
   * Deterministic local heuristic NLP engine (offline/fallback without API key)
   */
  private extractWithHeuristics(call: any, transcripts: any[]): ExtractedIntelligence {
    const isTransferred = call.transferred || (call.transferRequests && call.transferRequests.length > 0);

    const customerTexts: string[] = [];
    const agentTexts: string[] = [];
    const kbSources: string[] = [];

    for (const t of transcripts) {
      const txt = (t.text || '').trim();
      if (!txt) continue;
      if (t.sender === 'customer') {
        customerTexts.push(txt);
      } else if (t.sender === 'agent' || t.sender === 'ai' || t.sender === 'admin') {
        agentTexts.push(txt);
        if (txt.includes('KAIRA VoiceCore')) kbSources.push('KAIRA VoiceCore Documentation');
        if (txt.includes('LiveEscalate') || txt.includes('transfer')) kbSources.push('Call Transfer Protocol');
        if (txt.includes('pricing') || txt.includes('plan') || txt.includes('cost')) kbSources.push('Pricing & Subscription Plans');
        if (txt.includes('hours') || txt.includes('support')) kbSources.push('Operating Hours & Support Policy');
      }
    }

    // Extract questions
    const questions: string[] = [];
    for (const text of customerTexts) {
      const sentences = text.split(/[?!.]/).map(s => s.trim()).filter(s => s.length > 5);
      for (const s of sentences) {
        const lower = s.toLowerCase();
        const isQuestion =
          text.includes('?') ||
          lower.startsWith('how') ||
          lower.startsWith('what') ||
          lower.startsWith('why') ||
          lower.startsWith('when') ||
          lower.startsWith('where') ||
          lower.startsWith('can') ||
          lower.startsWith('could') ||
          lower.startsWith('do you') ||
          lower.startsWith('is there') ||
          lower.includes('price') ||
          lower.includes('cost') ||
          lower.includes('எப்படி') ||
          lower.includes('விலை') ||
          lower.includes('ఎలా') ||
          lower.includes('ఎంత') ||
          lower.includes('എങ്ങനെ') ||
          lower.includes('क्या') ||
          lower.includes('कैसे');

        if (isQuestion && !questions.includes(s)) {
          questions.push(s);
        }
      }
    }

    if (questions.length === 0 && customerTexts.length > 0) {
      questions.push(customerTexts[0]);
    }

    // Solutions provided
    const solutions = agentTexts.filter(t => t.length > 15 && !t.includes('connect you to an Admin'));

    // Resolution check
    const fullConv = transcripts.map(t => (t.text || '').toLowerCase()).join(' ');

    const hasExplicitThanks =
      fullConv.includes('thank you') ||
      fullConv.includes('thanks') ||
      fullConv.includes('that helps') ||
      fullConv.includes('that solved') ||
      fullConv.includes('understood') ||
      fullConv.includes('all clear') ||
      fullConv.includes('நன்றி') ||
      fullConv.includes('சரி') ||
      fullConv.includes('ధన్యవాదాలు') ||
      fullConv.includes('നന്ദി') ||
      fullConv.includes('धन्यवाद');

    const hasUnresolvedIndicators =
      fullConv.includes("don't have verified information") ||
      fullConv.includes('still not working') ||
      fullConv.includes('not resolved') ||
      fullConv.includes('issue persists') ||
      fullConv.includes('check again') ||
      fullConv.includes('call back') ||
      fullConv.includes('didn\'t answer');

    let resolutionStatus: 'resolved' | 'partially_resolved' | 'unresolved' | 'escalated_admin' = 'unresolved';
    let resolutionExplanation = '';
    const unresolvedQuestions: string[] = [];
    const actionItems: string[] = [];

    if (isTransferred) {
      resolutionStatus = 'escalated_admin';
      resolutionExplanation = 'Call was transferred to an Administrator during conversation for specialized handling.';
      if (call.customerQuestion) unresolvedQuestions.push(call.customerQuestion);
      actionItems.push('Review administrator transfer notes and verify if customer issue was fully concluded.');
    } else if (hasExplicitThanks && solutions.length > 0 && !hasUnresolvedIndicators) {
      resolutionStatus = 'resolved';
      resolutionExplanation = 'Customer acknowledged satisfaction and explicit resolution after solutions were provided.';
    } else if (solutions.length > 0 && (hasUnresolvedIndicators || questions.length > solutions.length)) {
      resolutionStatus = 'partially_resolved';
      resolutionExplanation = 'Initial answers were provided but customer had additional unresolved inquiries or requested follow-up.';
      if (questions.length > 1) {
        unresolvedQuestions.push(questions[questions.length - 1]);
      }
      actionItems.push('Agent to follow up on remaining questions with customer.');
    } else {
      resolutionStatus = 'unresolved';
      resolutionExplanation = 'No verified resolution or customer confirmation was established during the conversation.';
      if (questions.length > 0) {
        unresolvedQuestions.push(...questions);
      }
      actionItems.push('Assign support agent to contact customer and provide resolution.');
    }

    // Sentiment check
    let sentiment: 'positive' | 'neutral' | 'negative' = 'neutral';
    if (fullConv.includes('thank') || fullConv.includes('great') || fullConv.includes('awesome') || fullConv.includes('excellent')) {
      sentiment = 'positive';
    } else if (fullConv.includes('error') || fullConv.includes('bad') || fullConv.includes('broken') || fullConv.includes('frustrated')) {
      sentiment = 'negative';
    }

    // Priority
    let priority: 'low' | 'medium' | 'high' | 'urgent' = 'medium';
    if (fullConv.includes('urgent') || fullConv.includes('emergency') || fullConv.includes('payment') || fullConv.includes('charge')) {
      priority = 'urgent';
    } else if (resolutionStatus === 'resolved') {
      priority = 'low';
    }

    const mainReason = questions[0] || (customerTexts[0] ? customerTexts[0].slice(0, 80) : 'General customer support inquiry');

    const overallSummary = `Customer ${call.customerName} contacted support regarding "${mainReason}". Duration: ${call.duration}s. Language: ${(call.language || 'en').toUpperCase()}. ${
      solutions.length > 0 ? `Support provided ${solutions.length} answers/recommendations.` : 'No complete solution was recorded.'
    } Classification: ${resolutionStatus.replace('_', ' ').toUpperCase()} (${resolutionExplanation}).`;

    return {
      callReason: mainReason,
      customerQuestions: questions,
      solutionsProvided: solutions,
      kbSourcesUsed: Array.from(new Set(kbSources)),
      resolutionStatus,
      resolutionExplanation,
      unresolvedQuestions,
      actionItems,
      overallSummary,
      sentiment,
      priority
    };
  }

  /**
   * Automatically create a FollowUpTask if an issue remains unresolved or partially resolved
   */
  private async createFollowUpTasks(call: any, intelligence: ExtractedIntelligence): Promise<void> {
    try {
      const questionsToFollowUp = intelligence.unresolvedQuestions && intelligence.unresolvedQuestions.length > 0
        ? intelligence.unresolvedQuestions
        : (intelligence.actionItems && intelligence.actionItems.length > 0
          ? [intelligence.actionItems[0]]
          : [`Customer issue from call (${intelligence.callReason})`]);

      for (const question of questionsToFollowUp) {
        const cleanQuestion = question.trim();
        if (!cleanQuestion) continue;

        // Prevent duplicate tasks for the same call and unresolved question
        const existingTask = await prisma.followUpTask.findFirst({
          where: {
            callRecordId: call.id,
            unresolvedQuestion: cleanQuestion
          }
        });

        if (existingTask) {
          console.log(`[CallIntelligence] Follow-up task already exists for call ${call.id}. Skipping duplicate.`);
          continue;
        }

        const taskTitle = `Follow-Up: ${call.customerName} - ${cleanQuestion.slice(0, 50)}${cleanQuestion.length > 50 ? '...' : ''}`;
        const actionReq = intelligence.actionItems && intelligence.actionItems.length > 0
          ? intelligence.actionItems.join('; ')
          : 'Reach out to customer to provide verified solution.';

        // Assign to agent who handled the call, or null
        const assignedAgentId = call.agentId || null;
        const assignedAgentName = call.agentName || null;

        await prisma.followUpTask.create({
          data: {
            callRecordId: call.id,
            customerId: call.customerId,
            customerName: call.customerName,
            customerPhone: call.customerPhone || null,
            customerEmail: call.customer?.email || null,
            assignedAgentId,
            assignedAgentName,
            title: taskTitle,
            unresolvedQuestion: cleanQuestion,
            previousSummary: intelligence.overallSummary,
            actionRequired: actionReq,
            priority: intelligence.priority || 'medium',
            status: 'pending',
            language: call.language || 'en'
          }
        });

        console.log(`[CallIntelligence] Created Follow-Up Task for call ${call.id}: "${taskTitle}" (Priority: ${intelligence.priority || 'medium'})`);
      }
    } catch (err) {
      console.error('[CallIntelligence] Error creating follow-up task:', err);
    }
  }

  /**
   * Track Knowledge Base gaps for unanswered questions
   */
  private async trackKnowledgeGaps(unresolvedQuestions: string[], language: string, sampleCallId: string): Promise<void> {
    for (const q of unresolvedQuestions) {
      const clean = q.trim();
      if (!clean || clean.length < 5) continue;

      const normalized = clean.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
      if (!normalized) continue;

      // Infer category topic
      let topic = 'General';
      if (normalized.includes('price') || normalized.includes('cost') || normalized.includes('rate') || normalized.includes('plan')) {
        topic = 'Pricing & Plans';
      } else if (normalized.includes('api') || normalized.includes('webhook') || normalized.includes('webrtc') || normalized.includes('integration')) {
        topic = 'Developer & Integration';
      } else if (normalized.includes('account') || normalized.includes('login') || normalized.includes('password') || normalized.includes('register')) {
        topic = 'Account & Authentication';
      } else if (normalized.includes('transfer') || normalized.includes('agent') || normalized.includes('admin') || normalized.includes('support')) {
        topic = 'Customer Support & Transfers';
      }

      try {
        const existing = await prisma.knowledgeGap.findUnique({
          where: { normalizedQuestion: normalized }
        });

        if (existing) {
          await prisma.knowledgeGap.update({
            where: { id: existing.id },
            data: {
              frequency: existing.frequency + 1,
              lastAskedAt: new Date()
            }
          });
        } else {
          await prisma.knowledgeGap.create({
            data: {
              question: clean,
              normalizedQuestion: normalized,
              language,
              frequency: 1,
              topic,
              sampleCallId,
              status: 'open'
            }
          });
        }
      } catch (e) {
        console.warn('[CallIntelligence] Failed to record knowledge gap:', e);
      }
    }
  }
}

export const callIntelligenceService = new CallIntelligenceService();
