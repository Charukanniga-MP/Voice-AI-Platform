/**
 * KAIRA Voice AI Platform - AI Agent Performance Evaluation Service
 * Evaluates human support specialists across 5 explainable pillars:
 * 1. Communication Quality (30%)
 * 2. Problem Resolution (30%)
 * 3. Knowledge & Answer Relevance (20%)
 * 4. Professionalism (10%)
 * 5. Customer Feedback (10%)
 * Generates transparent evidence excerpts, strengths, improvements, and manager override support.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface AgentPillars {
  communication: number; // 0 - 100
  resolution: number;    // 0 - 100
  knowledge: number;     // 0 - 100
  professionalism: number; // 0 - 100
  feedback: number;      // 0 - 100
}

export class AgentEvaluationService {
  /**
   * Evaluates an agent's call handling from call transcripts, customer sentiment, and rating
   */
  public async evaluateCall(callRecordId: string): Promise<any> {
    const call = await prisma.callRecord.findUnique({
      where: { id: callRecordId },
      include: {
        agent: true,
        transcripts: { orderBy: { timestamp: 'asc' } },
        sentimentRecords: true,
        intelligence: true
      }
    });

    if (!call || !call.agentId) {
      return null; // Only evaluate calls that involved a human agent
    }

    const agentTranscripts = call.transcripts.filter((t) => t.sender === 'agent' || t.sender === 'admin');
    const customerTranscripts = call.transcripts.filter((t) => t.sender === 'customer');

    // Pillar 1: Communication Quality (Weight: 30%)
    // Factors: politeness keywords, clear greeting, respectful sign-off, absence of harsh words
    let commScore = 80;
    const allAgentText = agentTranscripts.map((t) => t.text.toLowerCase()).join(' ');
    if (allAgentText.includes('thank you') || allAgentText.includes('happy to help') || allAgentText.includes('welcome') || allAgentText.includes('please')) {
      commScore += 10;
    }
    if (allAgentText.includes('apologize') || allAgentText.includes('understand your concern')) {
      commScore += 5;
    }
    if (agentTranscripts.length >= 3) {
      commScore += 5;
    }
    commScore = Math.min(100, Math.max(30, commScore));

    // Pillar 2: Problem Resolution (Weight: 30%)
    // Factors: call completed vs transferred again, resolutionStatus in intelligence
    let resScore = 75;
    if (call.status === 'completed') {
      resScore += 15;
    }
    if (call.intelligence?.resolutionStatus === 'resolved') {
      resScore += 10;
    } else if (call.intelligence?.resolutionStatus === 'unresolved' || call.requiresAssistance) {
      resScore -= 20;
    }
    resScore = Math.min(100, Math.max(25, resScore));

    // Pillar 3: Knowledge & Answer Relevance (Weight: 20%)
    // Factors: relevance of agent responses, mentions of company services or answers
    let knowScore = 80;
    if (call.intelligence?.kbSourcesUsed && call.intelligence.kbSourcesUsed !== '[]') {
      knowScore += 10;
    }
    if (allAgentText.length > 50) {
      knowScore += 5;
    }
    knowScore = Math.min(100, Math.max(40, knowScore));

    // Pillar 4: Professionalism (Weight: 10%)
    // Factors: active responsiveness, patience during customer frustration
    let profScore = 85;
    const hasFrustration = call.overallSentiment === 'FRUSTRATED' || call.sentimentRecords.some((s) => s.sentiment === 'FRUSTRATED');
    if (hasFrustration) {
      // De-escalated successfully if call completed
      if (call.status === 'completed') profScore += 10;
      else profScore -= 10;
    }
    profScore = Math.min(100, Math.max(50, profScore));

    // Pillar 5: Customer Feedback (Weight: 10%)
    // Factors: Customer 5-star rating and post-call sentiment
    let fbScore = 80;
    if (call.rating !== null && call.rating !== undefined) {
      fbScore = (call.rating / 5) * 100;
    } else {
      if (call.overallSentiment === 'POSITIVE') fbScore = 95;
      else if (call.overallSentiment === 'NEGATIVE') fbScore = 55;
      else if (call.overallSentiment === 'FRUSTRATED') fbScore = 40;
      else fbScore = 75;
    }

    // Weighted Overall Score: 30% Comm + 30% Res + 20% Know + 10% Prof + 10% Feed
    const overallScore = Math.round(
      (0.30 * commScore + 0.30 * resScore + 0.20 * knowScore + 0.10 * profScore + 0.10 * fbScore) * 10
    ) / 10;

    // Strengths
    const strengths: string[] = [];
    if (commScore >= 85) strengths.push('Clear, polite communication and active customer acknowledgment.');
    if (resScore >= 80) strengths.push('Efficient issue troubleshooting and resolution within expected duration.');
    if (profScore >= 85) strengths.push('Maintained calm, professional composure throughout interaction.');

    // Improvement Recommendations & Evidence Excerpts
    const improvements: string[] = [];
    const evidenceExcerpts: Array<{ speaker: string; text: string; note: string }> = [];

    if (resScore < 80) {
      improvements.push('Ensure complete problem closure before concluding conversation.');
    }
    if (allAgentText.length < 30) {
      improvements.push('Provide more descriptive explanations to customer inquiries.');
    }

    // Capture first customer quote and first agent quote as evidence
    if (customerTranscripts.length > 0) {
      evidenceExcerpts.push({
        speaker: 'Customer',
        text: customerTranscripts[0].text,
        note: 'Customer initial query statement'
      });
    }
    if (agentTranscripts.length > 0) {
      evidenceExcerpts.push({
        speaker: 'Agent',
        text: agentTranscripts[0].text,
        note: 'Agent initial response acknowledgment'
      });
    }

    const evaluationSummary = `Agent handled call for customer ${call.customerName}. Overall performance was evaluated at ${overallScore}/100 based on communication, resolution, and customer experience.`;

    const evaluation = await prisma.agentPerformanceEvaluation.upsert({
      where: { callRecordId: call.id },
      update: {
        agentId: call.agentId,
        communicationScore: commScore,
        resolutionScore: resScore,
        knowledgeScore: knowScore,
        professionalismScore: profScore,
        feedbackScore: fbScore,
        overallScore,
        evaluationSummary,
        strengths: JSON.stringify(strengths),
        improvements: JSON.stringify(improvements),
        trainingRecommendations: improvements.length > 0 ? improvements.join('. ') : 'Maintain current high performance.',
        evidenceExcerpts: JSON.stringify(evidenceExcerpts),
        updatedAt: new Date()
      },
      create: {
        callRecordId: call.id,
        agentId: call.agentId,
        communicationScore: commScore,
        resolutionScore: resScore,
        knowledgeScore: knowScore,
        professionalismScore: profScore,
        feedbackScore: fbScore,
        overallScore,
        evaluationSummary,
        strengths: JSON.stringify(strengths),
        improvements: JSON.stringify(improvements),
        trainingRecommendations: improvements.length > 0 ? improvements.join('. ') : 'Maintain current high performance.',
        evidenceExcerpts: JSON.stringify(evidenceExcerpts)
      }
    });

    return evaluation;
  }

  /**
   * Allows manager or administrator to manually review and override an evaluation
   */
  public async overrideEvaluation(evaluationId: string, options: {
    communicationScore?: number;
    resolutionScore?: number;
    knowledgeScore?: number;
    professionalismScore?: number;
    feedbackScore?: number;
    managerNotes?: string;
    reviewedBy: string;
  }): Promise<any> {
    const existing = await prisma.agentPerformanceEvaluation.findUnique({
      where: { id: evaluationId }
    });

    if (!existing) {
      throw new Error(`Evaluation record not found: ${evaluationId}`);
    }

    const c = options.communicationScore !== undefined ? options.communicationScore : existing.communicationScore;
    const r = options.resolutionScore !== undefined ? options.resolutionScore : existing.resolutionScore;
    const k = options.knowledgeScore !== undefined ? options.knowledgeScore : existing.knowledgeScore;
    const p = options.professionalismScore !== undefined ? options.professionalismScore : existing.professionalismScore;
    const f = options.feedbackScore !== undefined ? options.feedbackScore : existing.feedbackScore;

    const newOverall = Math.round((0.30 * c + 0.30 * r + 0.20 * k + 0.10 * p + 0.10 * f) * 10) / 10;

    return prisma.agentPerformanceEvaluation.update({
      where: { id: evaluationId },
      data: {
        communicationScore: c,
        resolutionScore: r,
        knowledgeScore: k,
        professionalismScore: p,
        feedbackScore: f,
        overallScore: newOverall,
        isManagerReviewed: true,
        managerNotes: options.managerNotes || existing.managerNotes,
        reviewedBy: options.reviewedBy,
        reviewedAt: new Date()
      }
    });
  }

  /**
   * Computes aggregate score and breakdown for an individual agent across their calls
   */
  public async getAgentScorecard(agentId: string): Promise<any> {
    const evaluations = await prisma.agentPerformanceEvaluation.findMany({
      where: { agentId },
      include: { callRecord: true },
      orderBy: { createdAt: 'desc' }
    });

    if (evaluations.length === 0) {
      return {
        evaluationsCount: 0,
        averageScore: 0,
        communicationAvg: 0,
        resolutionAvg: 0,
        knowledgeAvg: 0,
        professionalismAvg: 0,
        feedbackAvg: 0,
        strengths: ['No evaluated calls yet.'],
        improvements: ['Complete support calls to begin receiving performance evaluation.']
      };
    }

    const count = evaluations.length;
    const avgOverall = Math.round((evaluations.reduce((acc, e) => acc + e.overallScore, 0) / count) * 10) / 10;
    const avgComm = Math.round((evaluations.reduce((acc, e) => acc + e.communicationScore, 0) / count) * 10) / 10;
    const avgRes = Math.round((evaluations.reduce((acc, e) => acc + e.resolutionScore, 0) / count) * 10) / 10;
    const avgKnow = Math.round((evaluations.reduce((acc, e) => acc + e.knowledgeScore, 0) / count) * 10) / 10;
    const avgProf = Math.round((evaluations.reduce((acc, e) => acc + e.professionalismScore, 0) / count) * 10) / 10;
    const avgFeed = Math.round((evaluations.reduce((acc, e) => acc + e.feedbackScore, 0) / count) * 10) / 10;

    return {
      evaluationsCount: count,
      averageScore: avgOverall,
      communicationAvg: avgComm,
      resolutionAvg: avgRes,
      knowledgeAvg: avgKnow,
      professionalismAvg: avgProf,
      feedbackAvg: avgFeed,
      recentEvaluations: evaluations.slice(0, 10)
    };
  }
}

export const agentEvaluationService = new AgentEvaluationService();

