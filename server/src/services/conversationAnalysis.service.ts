/**
 * KAIRA Voice AI Platform - AI Conversation Analysis Service
 * Synthesizes customer utterances, requirements, questions, products mentioned,
 * unresolved concerns, keywords, factual call summaries, and business growth indicators.
 */

import { PrismaClient } from '@prisma/client';
import { sentimentService } from './sentiment.js';

const prisma = new PrismaClient();

// Product & Service dictionary for automated domain entity recognition
const KNOWN_PRODUCTS_SERVICES = [
  'Voice AI Assistant',
  'Multilingual Support',
  'Call Routing',
  'Knowledge Base',
  'Sentiment Analysis',
  'Cloud Telephony',
  'WebRTC Audio',
  'API Integration',
  'Enterprise Subscription',
  'Annual Billing Plan',
  'Account Security',
  'Password Reset Service'
];

export class ConversationAnalysisService {
  /**
   * Analyzes a completed call conversation from its transcripts and sentiment records
   */
  public async analyzeCallConversation(callRecordId: string): Promise<any> {
    const call = await prisma.callRecord.findUnique({
      where: { id: callRecordId },
      include: {
        transcripts: { orderBy: { timestamp: 'asc' } },
        sentimentRecords: true,
        intelligence: true,
        customer: true,
        agent: true
      }
    });

    if (!call) {
      throw new Error(`Call record not found: ${callRecordId}`);
    }

    const customerTranscripts = call.transcripts.filter((t) => t.sender === 'customer');
    const allCustomerText = customerTranscripts.map((t) => t.text).join(' ');
    const fullConversationText = call.transcripts.map((t) => `${t.sender}: ${t.text}`).join('\n');

    // 1. Identify Main Reason & Requirements
    let customerReason = call.customerQuestion || call.intelligence?.callReason;
    if (!customerReason) {
      if (customerTranscripts.length > 0) {
        customerReason = customerTranscripts[0].text;
      } else {
        customerReason = 'Customer initiated support voice inquiry';
      }
    }

    const customerRequirements = customerTranscripts.length > 1
      ? customerTranscripts.slice(0, 3).map((t) => t.text).join('; ')
      : customerReason;

    // 2. Extract Questions Asked (ends with '?' or question words)
    const questionsAsked: string[] = [];
    for (const t of customerTranscripts) {
      const sentences = t.text.split(/[.?!]+/);
      for (const s of sentences) {
        const trimmed = s.trim();
        const isQ =
          t.text.includes('?') ||
          /^(what|how|where|when|why|who|can|could|is|are|do|does|will|would)/i.test(trimmed);
        if (isQ && trimmed.length > 5) {
          questionsAsked.push(trimmed);
        }
      }
    }
    if (questionsAsked.length === 0 && customerTranscripts.length > 0) {
      questionsAsked.push(customerTranscripts[0].text);
    }

    // 3. Extract Problems Reported
    const problemsReported: string[] = [];
    const problemKeywords = ['delay', 'error', 'broken', 'not working', 'issue', 'problem', 'failed', 'refund', 'complaint', 'cannot', "can't", 'slow'];
    for (const t of customerTranscripts) {
      const lower = t.text.toLowerCase();
      if (problemKeywords.some((k) => lower.includes(k))) {
        problemsReported.push(t.text);
      }
    }

    // 4. Products & Services Mentioned
    const productsMentioned: string[] = [];
    const lowerFull = allCustomerText.toLowerCase();
    for (const prod of KNOWN_PRODUCTS_SERVICES) {
      if (lowerFull.includes(prod.toLowerCase())) {
        productsMentioned.push(prod);
      }
    }
    if (lowerFull.includes('voice') && !productsMentioned.includes('Voice AI Assistant')) {
      productsMentioned.push('Voice AI Assistant');
    }
    if (lowerFull.includes('language') || lowerFull.includes('tamil') || lowerFull.includes('hindi')) {
      productsMentioned.push('Multilingual Support');
    }
    if (lowerFull.includes('password') || lowerFull.includes('login') || lowerFull.includes('account')) {
      productsMentioned.push('Account Security');
    }

    // 5. Discussion Points
    const discussionPoints: string[] = [];
    if (customerReason) discussionPoints.push(`Initial query: ${customerReason}`);
    if (problemsReported.length > 0) discussionPoints.push(`Reported issue: ${problemsReported[0]}`);
    if (call.transferred || call.status === 'transferred') {
      discussionPoints.push('Call escalated to live human support specialist');
    } else {
      discussionPoints.push('Inquiry handled autonomously by AI assistant');
    }

    // 6. Issues Resolved vs Unresolved
    const isUnresolved =
      call.intelligence?.resolutionStatus === 'unresolved' ||
      call.status === 'missed' ||
      call.status === 'rejected' ||
      call.requiresAssistance;

    const issuesResolved: string[] = isUnresolved ? [] : [customerReason];
    const issuesUnresolved: string[] = isUnresolved ? [customerReason] : [];
    const unresolvedConcerns: string[] = isUnresolved ? problemsReported : [];

    // 7. Overall Sentiment & Satisfaction Indicator
    const overallSentiment = call.overallSentiment || 'NEUTRAL';
    const satisfactionIndicator =
      overallSentiment === 'POSITIVE'
        ? 'high'
        : overallSentiment === 'FRUSTRATED' || overallSentiment === 'NEGATIVE'
        ? 'low'
        : 'moderate';

    // 8. Follow-up Needed Check
    const followUpRequired = isUnresolved || (call.rating !== null && call.rating <= 2);
    const followUpAction = followUpRequired
      ? 'Outbound follow-up call recommended to ensure issue resolution.'
      : 'No further action required; conversation completed satisfactorily.';

    // 9. Important Keywords
    const words = allCustomerText.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/);
    const stopWords = new Set(['the', 'and', 'to', 'of', 'a', 'in', 'is', 'it', 'you', 'that', 'he', 'was', 'for', 'on', 'are', 'as', 'with', 'his', 'they', 'i', 'at', 'be', 'this', 'have', 'from']);
    const wordFreq = new Map<string, number>();
    for (const w of words) {
      if (w.length > 3 && !stopWords.has(w)) {
        wordFreq.set(w, (wordFreq.get(w) || 0) + 1);
      }
    }
    const importantKeywords = Array.from(wordFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([w]) => w);

    // 10. Generate Factual Call Summary
    const custName = call.customerName || 'Customer';
    const partner = call.agentName ? `Support Specialist ${call.agentName}` : 'the KAIRA AI Voice Assistant';
    let summary = `${custName} contacted support regarding "${customerReason}". `;
    if (call.transferred) {
      summary += `The inquiry was escalated to a human specialist for resolution. `;
    } else {
      summary += `The conversation was handled by ${partner} in ${call.language || 'English'}. `;
    }
    if (isUnresolved) {
      summary += `The issue remained unresolved at call termination, requiring follow-up.`;
    } else {
      summary += `The matter was addressed, with an overall ${overallSentiment.toLowerCase()} customer sentiment.`;
    }

    // 11. Inquiry Category & Business Growth Opportunity
    let inquiryCategory = 'General';
    let growthOpportunity = 'Maintain consistent support quality.';

    if (lowerFull.includes('price') || lowerFull.includes('cost') || lowerFull.includes('plan') || lowerFull.includes('subscription')) {
      inquiryCategory = 'Pricing & Plans';
      growthOpportunity = 'High pricing inquiry frequency indicates strong conversion potential. Consider offering introductory bundles.';
    } else if (lowerFull.includes('order') || lowerFull.includes('delivery') || lowerFull.includes('track')) {
      inquiryCategory = 'Order & Delivery';
      growthOpportunity = 'Enhance self-service tracking integration in voice greeting to reduce repetitive inquiries.';
    } else if (lowerFull.includes('feature') || lowerFull.includes('how to') || lowerFull.includes('integration')) {
      inquiryCategory = 'Product Features';
      growthOpportunity = 'Customers actively exploring technical features. Recommend expanding product onboarding guides.';
    } else if (lowerFull.includes('tamil') || lowerFull.includes('hindi') || lowerFull.includes('telugu') || lowerFull.includes('malayalam')) {
      inquiryCategory = 'Regional Languages';
      growthOpportunity = 'Expanding regional language knowledge base will drive higher regional customer satisfaction.';
    }

    // 12. Upsert ConversationAnalysis record in DB
    const recording = await prisma.callRecording.findFirst({
      where: { callRecordId: call.id }
    });

    const analysis = await prisma.conversationAnalysis.upsert({
      where: { callRecordId: call.id },
      update: {
        recordingId: recording?.id || null,
        customerReason,
        customerRequirements,
        questionsAsked: JSON.stringify(questionsAsked),
        problemsReported: JSON.stringify(problemsReported),
        productsMentioned: JSON.stringify(productsMentioned),
        unresolvedConcerns: JSON.stringify(unresolvedConcerns),
        satisfactionIndicator,
        overallSentiment,
        discussionPoints: JSON.stringify(discussionPoints),
        issuesResolved: JSON.stringify(issuesResolved),
        issuesUnresolved: JSON.stringify(issuesUnresolved),
        requiresHumanAssistance: call.requiresAssistance,
        followUpRequired,
        followUpAction,
        customerFeedback: call.ratingComment || null,
        importantKeywords: JSON.stringify(importantKeywords),
        callSummary: summary,
        inquiryCategory,
        growthOpportunity,
        updatedAt: new Date()
      },
      create: {
        callRecordId: call.id,
        recordingId: recording?.id || null,
        customerReason,
        customerRequirements,
        questionsAsked: JSON.stringify(questionsAsked),
        problemsReported: JSON.stringify(problemsReported),
        productsMentioned: JSON.stringify(productsMentioned),
        unresolvedConcerns: JSON.stringify(unresolvedConcerns),
        satisfactionIndicator,
        overallSentiment,
        discussionPoints: JSON.stringify(discussionPoints),
        issuesResolved: JSON.stringify(issuesResolved),
        issuesUnresolved: JSON.stringify(issuesUnresolved),
        requiresHumanAssistance: call.requiresAssistance,
        followUpRequired,
        followUpAction,
        customerFeedback: call.ratingComment || null,
        importantKeywords: JSON.stringify(importantKeywords),
        callSummary: summary,
        inquiryCategory,
        growthOpportunity
      }
    });

    return analysis;
  }
}

export const conversationAnalysisService = new ConversationAnalysisService();

