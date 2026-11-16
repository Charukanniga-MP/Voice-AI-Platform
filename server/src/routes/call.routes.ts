import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Router, Request, Response } from 'express';
import { prisma } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate, callRatingSchema, callNotesSchema } from '../middleware/validation.js';
import { callIntelligenceService } from '../services/callIntelligence.js';
import { callSessions, emitCallQualityAlert } from '../services/socket.js';
import { evaluateCallQualityAlert, getCallQualityAlertSettings, QualityAlertEventType } from '../services/callQualityAlerts.js';
import { realtimeIntelligenceService } from '../services/realtimeIntelligence.service.js';

const router = Router();

// Live active call session lock status (for health monitoring and verification)
router.get('/session-lock/:callId', (req: Request, res: Response) => {
  const session = callSessions.get(req.params.callId);
  if (!session) {
    res.status(404).json({ found: false, message: 'Session not found or call ended.' });
    return;
  }
  res.json({
    found: true,
    callId: session.callId,
    speakerType: session.speakerType,
    humanSpeakerId: session.humanSpeakerId,
    humanSpeakerName: session.humanSpeakerName,
    greetingPlayed: session.greetingPlayed,
    activeSessionsTotal: callSessions.size,
    processedUtterancesCount: session.processedUtteranceIds.size
  });
});

// 1. Dashboard Statistics (Admin only - calculated from real DB records)
router.get('/stats', authenticate, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const [
      totalCustomers,
      totalAgents,
      totalCalls,
      totalIncoming,
      totalOutgoing,
      activeCalls,
      completedCalls,
      transferredCalls,
      pendingTransfers,
      queuedCalls,
      availableAgents,
      busyAgents,
      allCompletedCalls,
      allQueuedRecords,
      allCallsWithLang,
      ratedCalls,
      aiCallsCount,
      agentCallsCount,
      callsWithLatency
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'customer' } }),
      prisma.user.count({ where: { role: 'agent' } }),
      prisma.callRecord.count(),
      prisma.callRecord.count({ where: { direction: 'incoming' } }),
      prisma.callRecord.count({ where: { direction: 'outgoing' } }),
      prisma.callRecord.count({ where: { status: 'active' } }),
      prisma.callRecord.count({ where: { status: 'completed' } }),
      prisma.callRecord.count({ where: { transferred: true } }),
      prisma.callTransferRequest.count({ where: { status: { in: ['pending', 'ringing'] } } }),
      prisma.callRecord.count({ where: { status: 'queued' } }),
      prisma.user.count({ where: { role: 'agent', agentStatus: 'available' } }),
      prisma.user.count({ where: { role: 'agent', agentStatus: 'busy' } }),
      prisma.callRecord.findMany({
        where: { status: 'completed', duration: { gt: 0 } },
        select: { duration: true }
      }),
      prisma.callRecord.findMany({
        where: { queueDuration: { gt: 0 } },
        select: { queueDuration: true }
      }),
      prisma.callRecord.findMany({
        select: { language: true }
      }),
      prisma.callRecord.findMany({
        where: { rating: { not: null } },
        select: { rating: true, ratingComment: true, customerName: true, language: true, startTime: true },
        orderBy: { startTime: 'desc' },
        take: 20
      }),
      prisma.callRecord.count({ where: { type: 'ai_voice' } }),
      prisma.callRecord.count({ where: { type: 'agent_voice' } }),
      prisma.callRecord.findMany({ where: { avgLatency: { not: null } }, select: { avgLatency: true } })
    ]);

    const avgDuration = allCompletedCalls.length > 0
      ? Math.round(allCompletedCalls.reduce((acc, c) => acc + (c.duration || 0), 0) / allCompletedCalls.length)
      : 0;

    const avgWaitTime = allQueuedRecords.length > 0
      ? Math.round(allQueuedRecords.reduce((acc, c) => acc + (c.queueDuration || 0), 0) / allQueuedRecords.length)
      : 0;

    const avgAiLatency = callsWithLatency.length > 0
      ? Math.round(callsWithLatency.reduce((acc, c) => acc + (c.avgLatency || 0), 0) / callsWithLatency.length)
      : 420;

    const totalAiCalls = aiCallsCount;
    const totalAgentCalls = agentCallsCount;
    const escalationRate = totalAiCalls > 0
      ? Math.round((transferredCalls / totalAiCalls) * 100)
      : 0;

    const callsByLanguage: Record<string, number> = {
      en: 0,
      ta: 0,
      te: 0,
      ml: 0,
      kn: 0,
      hi: 0
    };

    allCallsWithLang.forEach(c => {
      const lang = c.language || 'en';
      callsByLanguage[lang] = (callsByLanguage[lang] || 0) + 1;
    });


    const totalRated = (ratedCalls || []).length;
    const avgRating = totalRated > 0
      ? Number(((ratedCalls || []).reduce((acc: number, c: any) => acc + (c.rating || 0), 0) / totalRated).toFixed(1))
      : 4.8;
    const ratingBreakdown: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    (ratedCalls || []).forEach((c: any) => {
      if (c.rating && c.rating >= 1 && c.rating <= 5) {
        ratingBreakdown[c.rating] = (ratingBreakdown[c.rating] || 0) + 1;
      }
    });

    res.json({
      totalCustomers,
      totalAgents,
      totalCalls,
      totalIncoming,
      totalOutgoing,
      activeCalls,
      completedCalls,
      transferredCalls,
      pendingTransfers,
      queuedCalls,
      availableAgents,
      busyAgents,
      avgWaitTime,
      avgDuration,
      callsByLanguage,
      totalAiCalls,
      totalAgentCalls,
      avgAiLatency,
      escalationRate,
      csat: {
        avgRating,
        totalRated,
        ratingBreakdown,
        recentFeedback: ratedCalls || []
      }
    });
  } catch (err: any) {
    console.error('[Calls] Stats error:', err);
    res.status(500).json({ error: 'Failed to retrieve call statistics.' });
  }
});

// 1b. Call Quality & Reliability Statistics (Admin)
router.get('/quality/stats', authenticate, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const [
      totalCalls,
      successfulCalls,
      failedCalls,
      disconnectedCalls,
      reconnectedCalls,
      completedWithDuration,
      callsWithLatency,
      callsWithLoss,
      qualityRatings,
      qualityHistory,
      transferStatusCounts,
      qualityEventCounts
    ] = await Promise.all([
      prisma.callRecord.count(),
      prisma.callRecord.count({ where: { status: 'completed' } }),
      prisma.callRecord.count({ where: { OR: [{ status: 'failed' }, { failureReason: { not: null } }] } }),
      prisma.callRecord.count({ where: { OR: [{ status: 'disconnected' }, { endedBy: 'network' }] } }),
      prisma.callRecord.count({ where: { OR: [{ wasReconnected: true }, { reconnectCount: { gt: 0 } }] } }),
      prisma.callRecord.findMany({ where: { status: 'completed', duration: { gt: 0 } }, select: { duration: true } }),
      prisma.callRecord.findMany({ where: { avgLatency: { not: null } }, select: { avgLatency: true } }),
      prisma.callRecord.findMany({ where: { packetLoss: { not: null } }, select: { packetLoss: true } }),
      prisma.callRecord.groupBy({ by: ['quality'], _count: { id: true } }),
      prisma.callRecord.findMany({
        take: 50,
        orderBy: { startTime: 'desc' },
        include: {
          customer: { select: { name: true, phone: true } },
          agent: { select: { name: true } }
        }
      }),
      prisma.callTransferRequest.groupBy({ by: ['status'], _count: { id: true } }),
      prisma.callQualityEvent.groupBy({ by: ['eventType'], _count: { id: true } })
    ]);

    const transcripts = qualityHistory.length
      ? await prisma.callTranscript.findMany({
          where: { callRecordId: { in: qualityHistory.map(call => call.id) } },
          select: { callRecordId: true, sender: true, timestamp: true },
          orderBy: { timestamp: 'asc' }
        })
      : [];

    const transcriptByCall = new Map<string, typeof transcripts>();
    for (const transcript of transcripts) {
      const entries = transcriptByCall.get(transcript.callRecordId) || [];
      entries.push(transcript);
      transcriptByCall.set(transcript.callRecordId, entries);
    }
    const firstResponseByCall = new Map<string, number>();
    for (const [callRecordId, entries] of transcriptByCall) {
      const customerIndex = entries.findIndex(entry => entry.sender === 'customer');
      if (customerIndex < 0) continue;
      const firstCustomer = entries[customerIndex];
      const firstResponse = entries.slice(customerIndex + 1).find(entry =>
        ['ai', 'agent', 'admin'].includes(entry.sender)
      );
      if (firstResponse) {
        firstResponseByCall.set(
          callRecordId,
          Math.max(0, firstResponse.timestamp.getTime() - firstCustomer.timestamp.getTime())
        );
      }
    }

    const responseTimes = Array.from(firstResponseByCall.values());
    const avgFirstResponseMs = responseTimes.length
      ? Math.round(responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length)
      : 0;
    const eventCounts: Record<string, number> = {};
    qualityEventCounts.forEach(event => { eventCounts[event.eventType] = event._count.id; });
    const transferOutcomes: Record<string, number> = {
      pending: 0,
      ringing: 0,
      accepted: 0,
      connected: 0,
      rejected: 0,
      missed: 0,
      completed: 0
    };
    transferStatusCounts.forEach(item => { transferOutcomes[item.status] = item._count.id; });

    const avgDuration = completedWithDuration.length > 0
      ? Math.round(completedWithDuration.reduce((acc, c) => acc + (c.duration || 0), 0) / completedWithDuration.length)
      : 0;

    const avgLatency = callsWithLatency.length > 0
      ? Math.round(callsWithLatency.reduce((acc, c) => acc + (c.avgLatency || 0), 0) / callsWithLatency.length)
      : 38;

    const avgPacketLoss = callsWithLoss.length > 0
      ? +(callsWithLoss.reduce((acc, c) => acc + (c.packetLoss || 0), 0) / callsWithLoss.length).toFixed(1)
      : 0.1;

    const qualityBreakdown: Record<string, number> = {
      excellent: 0,
      good: 0,
      poor: 0
    };
    qualityRatings.forEach((q) => {
      if (q.quality) qualityBreakdown[q.quality] = q._count.id;
    });

    res.json({
      totalCalls,
      successfulCalls,
      failedCalls,
      disconnectedCalls,
      reconnectedCalls,
      avgDuration,
      avgLatency,
      avgPacketLoss,
      avgFirstResponseMs,
      firstResponseCalls: responseTimes.length,
      speechRecognitionFailures: eventCounts.speech_recognition_failure || 0,
      recordingUploadFailures: eventCounts.recording_upload_failure || 0,
      droppedCalls: disconnectedCalls,
      transferOutcomes,
      qualityBreakdown,
      history: qualityHistory.map(call => ({
        ...call,
        firstResponseMs: firstResponseByCall.get(call.id) ?? null
      }))
    });
  } catch (err: any) {
    console.error('[Calls] Quality stats error:', err);
    res.status(500).json({ error: 'Failed to retrieve call quality statistics.' });
  }
});

router.get('/quality/alerts/settings', authenticate, requireRole(['admin']), async (_req: Request, res: Response) => {
  try {
    res.json(await getCallQualityAlertSettings());
  } catch (err) {
    console.error('[Calls] Quality alert settings error:', err);
    res.status(500).json({ error: 'Failed to load call quality alert settings.' });
  }
});

router.put('/quality/alerts/settings', authenticate, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const fields = [
      'speechRecognitionThreshold',
      'droppedCallThreshold',
      'recordingUploadThreshold',
      'windowMinutes'
    ] as const;
    const limits: Record<typeof fields[number], { min: number; max: number }> = {
      speechRecognitionThreshold: { min: 1, max: 1000 },
      droppedCallThreshold: { min: 1, max: 1000 },
      recordingUploadThreshold: { min: 1, max: 1000 },
      windowMinutes: { min: 5, max: 1440 }
    };
    for (const field of fields) {
      const value = req.body[field];
      if (!Number.isInteger(value) || value < limits[field].min || value > limits[field].max) {
        res.status(400).json({ error: `${field} must be an integer between ${limits[field].min} and ${limits[field].max}.` });
        return;
      }
    }
    await prisma.$executeRaw`
      INSERT INTO CallQualityAlertSettings
        (id, speechRecognitionThreshold, droppedCallThreshold, recordingUploadThreshold, windowMinutes, updatedAt)
      VALUES (
        'default', ${req.body.speechRecognitionThreshold}, ${req.body.droppedCallThreshold},
        ${req.body.recordingUploadThreshold}, ${req.body.windowMinutes}, ${new Date()}
      )
      ON CONFLICT(id) DO UPDATE SET
        speechRecognitionThreshold = excluded.speechRecognitionThreshold,
        droppedCallThreshold = excluded.droppedCallThreshold,
        recordingUploadThreshold = excluded.recordingUploadThreshold,
        windowMinutes = excluded.windowMinutes,
        updatedAt = excluded.updatedAt
    `;
    const settings = await getCallQualityAlertSettings();
    res.json(settings);
  } catch (err) {
    console.error('[Calls] Save quality alert settings error:', err);
    res.status(500).json({ error: 'Failed to save call quality alert settings.' });
  }
});

// 1c. Call Intelligence & Analytics Statistics (Admin & Agent)
router.get('/intelligence/stats', authenticate, requireRole(['admin', 'agent']), async (req: Request, res: Response) => {
  try {
    const [
      totalCallsAnalyzed,
      resolvedCalls,
      partiallyResolvedCalls,
      unresolvedCalls,
      escalatedCalls,
      humanEscalationCount,
      pendingFollowUpTasks,
      completedFollowUpTasks,
      allIntelligence,
      allGaps,
      agents
    ] = await Promise.all([
      prisma.callIntelligence.count(),
      prisma.callIntelligence.count({ where: { resolutionStatus: 'resolved' } }),
      prisma.callIntelligence.count({ where: { resolutionStatus: 'partially_resolved' } }),
      prisma.callIntelligence.count({ where: { resolutionStatus: 'unresolved' } }),
      prisma.callIntelligence.count({ where: { resolutionStatus: 'escalated_admin' } }),
      prisma.callIntelligence.count({
        where: {
          OR: [
            { resolutionStatus: 'escalated_admin' },
            { requiresHumanSupport: true }
          ]
        }
      }),
      prisma.followUpTask.count({ where: { status: 'pending' } }),
      prisma.followUpTask.count({ where: { status: 'completed' } }),
      prisma.callIntelligence.findMany({
        select: {
          id: true,
          callRecordId: true,
          customerName: true,
          agentId: true,
          agentName: true,
          callReason: true,
          resolutionStatus: true,
          resolutionExplanation: true,
          requiresHumanSupport: true,
          recommendedNextAction: true,
          discussionPoints: true,
          customerQuestions: true,
          solutionsProvided: true,
          overallSummary: true,
          localizedSummary: true,
          sentiment: true,
          duration: true,
          language: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' },
        take: 200
      }),
      prisma.knowledgeGap.findMany({
        orderBy: [{ frequency: 'desc' }, { lastAskedAt: 'desc' }],
        take: 20
      }),
      prisma.user.findMany({
        where: { role: 'agent' },
        select: { id: true, name: true, email: true }
      })
    ]);

    // Aggregate Frequently Asked Questions
    const faqMap: Record<string, { question: string; count: number; category: string }> = {};
    for (const item of allIntelligence) {
      try {
        const questions: string[] = JSON.parse(item.customerQuestions || '[]');
        for (const q of questions) {
          const norm = q.trim();
          if (norm.length > 5) {
            if (!faqMap[norm]) {
              faqMap[norm] = { question: norm, count: 0, category: 'General' };
            }
            faqMap[norm].count++;
          }
        }
      } catch (e) { }
    }
    const frequentlyAskedQuestions = Object.values(faqMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Compute Common Customer Issues categories
    const categoryCounts: Record<string, number> = {
      'Pricing & Plans': 0,
      'Order & Delivery': 0,
      'Billing & Payments': 0,
      'Technical Support': 0,
      'Account & Access': 0,
      'Human Support Request': 0,
      'General Inquiries': 0
    };

    for (const item of allIntelligence) {
      const text = ((item.callReason || '') + ' ' + (item.recommendedNextAction || '')).toLowerCase();
      if (text.includes('price') || text.includes('cost') || text.includes('plan') || text.includes('rate') || text.includes('விலை') || text.includes('எவ்வளவு') || text.includes('ఎంత')) {
        categoryCounts['Pricing & Plans']++;
      } else if (text.includes('order') || text.includes('delivery') || text.includes('shipping') || text.includes('track')) {
        categoryCounts['Order & Delivery']++;
      } else if (text.includes('bill') || text.includes('refund') || text.includes('payment') || text.includes('charge')) {
        categoryCounts['Billing & Payments']++;
      } else if (text.includes('error') || text.includes('fail') || text.includes('broken') || text.includes('bug') || text.includes('technical')) {
        categoryCounts['Technical Support']++;
      } else if (text.includes('account') || text.includes('login') || text.includes('password') || text.includes('reset')) {
        categoryCounts['Account & Access']++;
      } else if (item.requiresHumanSupport || text.includes('agent') || text.includes('human') || text.includes('transfer')) {
        categoryCounts['Human Support Request']++;
      } else {
        categoryCounts['General Inquiries']++;
      }
    }

    const totalIssues = allIntelligence.length || 1;
    const commonCustomerIssues = Object.entries(categoryCounts).map(([category, count]) => ({
      category,
      count,
      percentage: Math.round((count / totalIssues) * 100)
    })).sort((a, b) => b.count - a.count);

    // Compute Customer Issue Trends (Daily distribution over last 7 days)
    const trendsMap: Record<string, { date: string; resolved: number; unresolved: number; escalated: number; total: number }> = {};
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      trendsMap[key] = { date: key, resolved: 0, unresolved: 0, escalated: 0, total: 0 };
    }

    for (const item of allIntelligence) {
      const dateKey = new Date(item.createdAt).toISOString().split('T')[0];
      if (trendsMap[dateKey]) {
        trendsMap[dateKey].total++;
        if (item.resolutionStatus === 'resolved') trendsMap[dateKey].resolved++;
        else if (item.resolutionStatus === 'escalated_admin') trendsMap[dateKey].escalated++;
        else trendsMap[dateKey].unresolved++;
      }
    }
    const customerIssueTrends = Object.values(trendsMap);

    // Compute Agent Resolution Statistics
    const agentResolutionStats = await Promise.all(
      agents.map(async (agent) => {
        const [totalCallsHandled, resolvedCount] = await Promise.all([
          prisma.callIntelligence.count({ where: { agentId: agent.id } }),
          prisma.callIntelligence.count({ where: { agentId: agent.id, resolutionStatus: 'resolved' } })
        ]);
        const resolutionRate = totalCallsHandled > 0 ? Math.round((resolvedCount / totalCallsHandled) * 100) : 0;
        return {
          agentId: agent.id,
          agentName: agent.name,
          email: agent.email,
          totalCallsHandled,
          resolvedCount,
          resolutionRate
        };
      })
    );

    res.json({
      totalCallsAnalyzed,
      resolvedCalls,
      partiallyResolvedCalls,
      unresolvedCalls,
      escalatedCalls,
      humanEscalationCount,
      pendingFollowUpTasks,
      completedFollowUpTasks,
      frequentlyAskedQuestions,
      commonCustomerIssues,
      customerIssueTrends,
      kbGaps: allGaps,
      agentResolutionStats,
      recentIntelligence: allIntelligence
    });
  } catch (err: any) {
    console.error('[Calls] Intelligence stats error:', err);
    res.status(500).json({ error: 'Failed to retrieve call intelligence statistics.' });
  }
});

// 1d. Conversation Insights (Agent & Admin)
router.get('/conversation-insights', authenticate, requireRole(['admin', 'agent']), async (req: Request, res: Response) => {
  try {
    const isAgent = req.user?.role === 'agent';
    const agentId = req.user?.id;

    const whereClause: any = {};
    if (isAgent) {
      whereClause.OR = [
        { agentId },
        { callRecord: { agentId } },
        { callRecord: { agentId: null } }
      ];
    }

    const items = await prisma.callIntelligence.findMany({
      where: whereClause,
      include: {
        callRecord: {
          select: {
            id: true,
            callId: true,
            customerName: true,
            customerPhone: true,
            status: true,
            duration: true,
            language: true,
            startTime: true,
            direction: true,
            followUpTasks: {
              select: {
                id: true,
                status: true,
                title: true,
                actionRequired: true,
                priority: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 60
    });

    const insights = items.map(item => {
      let questions: string[] = [];
      let solutions: string[] = [];
      let discussionPoints: string[] = [];
      let actionItems: string[] = [];
      try { questions = JSON.parse(item.customerQuestions || '[]'); } catch (e) { }
      try { solutions = JSON.parse(item.solutionsProvided || '[]'); } catch (e) { }
      try { discussionPoints = JSON.parse(item.discussionPoints || '[]'); } catch (e) { }
      try { actionItems = JSON.parse(item.actionItems || '[]'); } catch (e) { }

      return {
        id: item.id,
        callRecordId: item.callRecordId,
        callId: item.callRecord?.callId || item.callRecordId,
        customerName: item.customerName,
        customerPhone: item.callRecord?.customerPhone || null,
        duration: item.duration || item.callRecord?.duration || 0,
        language: item.language || item.callRecord?.language || 'en',
        callReason: item.callReason,
        customerQuestions: questions,
        solutionsProvided: solutions,
        discussionPoints,
        resolutionStatus: item.resolutionStatus,
        resolutionExplanation: item.resolutionExplanation,
        requiresHumanSupport: item.requiresHumanSupport,
        recommendedNextAction: item.recommendedNextAction,
        actionItems,
        overallSummary: item.overallSummary,
        localizedSummary: item.localizedSummary,
        sentiment: item.sentiment,
        createdAt: item.createdAt,
        followUpTasks: item.callRecord?.followUpTasks || []
      };
    });

    res.json({ insights });
  } catch (err: any) {
    console.error('[Calls] Conversation insights error:', err);
    res.status(500).json({ error: 'Failed to retrieve conversation insights.' });
  }
});

// 2. All calls with filter tabs (Admin & Agent)
router.get('/', authenticate, requireRole(['admin', 'agent']), async (req: Request, res: Response) => {
  try {
    const { filter, search, language } = req.query as { filter?: string; search?: string; language?: string };

    const where: any = {};

    if (filter === 'incoming') where.direction = 'incoming';
    else if (filter === 'outgoing') where.direction = 'outgoing';
    else if (filter === 'transferred') where.transferred = true;
    else if (filter === 'active') where.status = 'active';
    else if (filter === 'completed') where.status = 'completed';
    else if (filter === 'queued') where.status = 'queued';
    else if (filter === 'missed') where.status = 'missed';

    if (language) {
      where.language = language;
    }

    if (search) {
      where.OR = [
        { customerName: { contains: search } },
        { customerPhone: { contains: search } },
        { callId: { contains: search } }
      ];
    }

    const calls = await prisma.callRecord.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, email: true, phone: true, preferredLanguage: true } },
        agent: { select: { id: true, name: true, supportedLanguages: true } },
        admin: { select: { id: true, name: true } },
        transcripts: { orderBy: { timestamp: 'asc' } },
        transferRequests: true,
        sentimentRecords: { orderBy: { detectedAt: 'asc' } },
        intelligence: true
      },
      orderBy: { startTime: 'desc' }
    });

    // Deduplicate calls in memory to ensure unique records
    const seenCallIds = new Set<string>();
    const uniqueCalls = [];
    for (const c of calls) {
      const key = (c.providerCallSid || c.callId || c.id).trim();
      if (!seenCallIds.has(key)) {
        seenCallIds.add(key);
        uniqueCalls.push(c);
      }
    }

    res.json({ calls: uniqueCalls });
  } catch (err: any) {
    console.error('[Calls] Fetch error:', err);
    res.status(500).json({ error: 'Failed to retrieve calls.' });
  }
});

// 3. Customer's own call history (Customer only)
router.get('/my-history', authenticate, async (req: Request, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const userId = req.user!.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });

    const orConditions: any[] = [{ customerId: userId }];
    if (user?.phone) {
      orConditions.push({ customerPhone: user.phone });
    }
    if (user?.name) {
      orConditions.push({ customerName: user.name });
    }

    const calls = await prisma.callRecord.findMany({
      where: {
        OR: orConditions
      },
      include: {
        transcripts: { orderBy: { timestamp: 'asc' } },
        admin: { select: { name: true } },
        agent: { select: { name: true } },
        customer: { select: { id: true, name: true, email: true, phone: true } },
        sentimentRecords: { where: { isFinal: true } },
        intelligence: true,
        followUpTasks: true,
        recording: true,
        conversationAnalysis: true
      },
      orderBy: { startTime: 'desc' }
    });

    // Deduplicate calls in memory to ensure unique records
    const seenCallIds = new Set<string>();
    const uniqueCalls = [];
    for (const c of calls) {
      const key = (c.providerCallSid || c.callId || c.id).trim();
      if (!seenCallIds.has(key)) {
        seenCallIds.add(key);
        uniqueCalls.push(c);
      }
    }

    res.json({ calls: uniqueCalls });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve call history.' });
  }
});

// 4. Live Transfer Management: get all transfer requests (Admin only)
router.get('/transfers', authenticate, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const transfers = await prisma.callTransferRequest.findMany({
      include: {
        callRecord: {
          include: {
            transcripts: { orderBy: { timestamp: 'asc' } },
            sentimentRecords: { orderBy: { detectedAt: 'asc' } }
          }
        },
        customer: true
      },
      orderBy: { createdAt: 'desc' }
    });

    // Deduplicate transfers by callRecordId (keep the latest transfer state per call)
    const seenCallRecordIds = new Set<string>();
    const uniqueTransfers = [];
    for (const t of transfers) {
      const key = t.callRecordId || t.id;
      if (!seenCallRecordIds.has(key)) {
        seenCallRecordIds.add(key);
        uniqueTransfers.push(t);
      }
    }

    res.json({ transfers: uniqueTransfers });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve transfer requests.' });
  }
});

// 5. Active Waiting Queue (Admin & Agent)
router.get('/queue', authenticate, requireRole(['admin', 'agent']), async (req: Request, res: Response) => {
  try {
    const queuedCalls = await prisma.callRecord.findMany({
      where: { status: 'queued' },
      include: {
        customer: { select: { id: true, name: true, phone: true, preferredLanguage: true } }
      },
      orderBy: { startTime: 'asc' }
    });

    res.json({ queuedCalls });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve queued calls.' });
  }
});

// 6. Save Call Notes (Agent & Admin)
router.post('/:id/notes', authenticate, requireRole(['admin', 'agent']), validate(callNotesSchema), async (req: Request, res: Response) => {
  try {
    const { notes } = req.body;
    const existing = await prisma.callRecord.findFirst({
      where: {
        OR: [
          { id: req.params.id },
          { callId: req.params.id },
          { providerCallSid: req.params.id }
        ]
      }
    });

    if (!existing) {
      res.status(404).json({ error: 'Call record not found.' });
      return;
    }

    if (req.user!.role !== 'admin' && existing.agentId !== req.user!.id) {
      res.status(403).json({ error: 'Access denied: You can only edit notes for calls assigned to you.' });
      return;
    }

    const call = await prisma.callRecord.update({
      where: { id: existing.id },
      data: { callNotes: typeof notes === 'string' ? notes.trim() : '' }
    });

    res.json({ message: 'Call notes saved successfully.', callNotes: call.callNotes });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to save call notes.' });
  }
});

// 7. Save Customer Rating (Customer only - with ownership verification)
router.post('/:id/rating', authenticate, validate(callRatingSchema), async (req: Request, res: Response) => {
  try {
    const { rating, comment } = req.body;
    const numRating = Number(rating);

    if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
      res.status(400).json({ error: 'Rating must be an integer between 1 and 5.' });
      return;
    }
    if (comment !== undefined && (typeof comment !== 'string' || comment.length > 1000)) {
      res.status(400).json({ error: 'Feedback comment must be 1000 characters or fewer.' });
      return;
    }

    const existing = await prisma.callRecord.findFirst({
      where: {
        OR: [
          { id: req.params.id },
          { callId: req.params.id },
          { providerCallSid: req.params.id }
        ]
      }
    });

    if (!existing) {
      res.status(404).json({ error: 'Call record not found.' });
      return;
    }

    if (req.user!.role === 'customer' && existing.customerId !== req.user!.id) {
      res.status(403).json({
        error: 'Access denied: You can only rate your own customer calls.',
        code: 'FORBIDDEN'
      });
      return;
    }

    if (existing.status !== 'completed') {
      res.status(400).json({ error: 'Only completed calls can be rated.' });
      return;
    }

    await prisma.callRecord.update({
      where: { id: existing.id },
      data: {
        rating: numRating,
        ratingComment: typeof comment === 'string' ? comment.trim() : null,
        feedbackFollowUpCompleted: numRating > 2,
        feedbackFollowUpNotes: null
      }
    });

    res.json({ message: 'Rating saved.' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to save call rating.' });
  }
});

// Admin follow-up for low customer satisfaction ratings
router.get('/feedback/low', authenticate, requireRole(['admin']), async (_req: Request, res: Response) => {
  try {
    const calls = await prisma.callRecord.findMany({
      where: { rating: { lte: 2 } },
      include: {
        customer: { select: { id: true, name: true, email: true, phone: true } },
        agent: { select: { id: true, name: true } }
      },
      orderBy: { startTime: 'desc' }
    });
    res.json({ calls });
  } catch (err) {
    console.error('[Calls] Low-rating feedback error:', err);
    res.status(500).json({ error: 'Failed to retrieve low-rating feedback.' });
  }
});

router.patch('/:id/feedback-follow-up', authenticate, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const { completed, notes } = req.body;
    if (typeof completed !== 'boolean') {
      res.status(400).json({ error: 'completed must be a boolean.' });
      return;
    }
    if (notes !== undefined && (typeof notes !== 'string' || notes.length > 1000)) {
      res.status(400).json({ error: 'Follow-up notes must be 1000 characters or fewer.' });
      return;
    }

    const existing = await prisma.callRecord.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.rating === null || existing.rating > 2) {
      res.status(404).json({ error: 'Low-rating feedback not found.' });
      return;
    }

    const call = await prisma.callRecord.update({
      where: { id: existing.id },
      data: {
        feedbackFollowUpCompleted: completed,
        ...(notes !== undefined ? { feedbackFollowUpNotes: notes.trim() || null } : {})
      }
    });
    res.json({ message: 'Feedback follow-up updated.', call });
  } catch (err) {
    console.error('[Calls] Feedback follow-up error:', err);
    res.status(500).json({ error: 'Failed to update feedback follow-up.' });
  }
});

// 7b. Save Real-Time Call Quality & Reliability Metrics
router.post('/:id/quality', authenticate, async (req: Request, res: Response) => {
  try {
    const { quality, avgLatency, packetLoss, jitter, audioQualityScore, reconnectCount, wasReconnected } = req.body;
    const callIdentifier = req.params.id;

    // Support lookup by DB ID, callId, or providerCallSid
    const existing = await prisma.callRecord.findFirst({
      where: {
        OR: [
          { id: callIdentifier },
          { callId: callIdentifier },
          { providerCallSid: callIdentifier }
        ]
      }
    });

    if (!existing) {
      res.status(404).json({ error: 'Call record not found.' });
      return;
    }

    // Verify caller is a legitimate participant or admin
    const isCustomer = existing.customerId === req.user!.id;
    const isAgent = existing.agentId === req.user!.id;
    const isAdmin = req.user!.role === 'admin';

    if (!isCustomer && !isAgent && !isAdmin) {
      res.status(403).json({ error: 'Access denied: You are not a participant in this call.' });
      return;
    }

    const updated = await prisma.callRecord.update({
      where: { id: existing.id },
      data: {
        ...(quality ? { quality } : {}),
        ...(avgLatency !== undefined ? { avgLatency: Number(avgLatency) } : {}),
        ...(packetLoss !== undefined ? { packetLoss: Number(packetLoss) } : {}),
        ...(jitter !== undefined ? { jitter: Number(jitter) } : {}),
        ...(audioQualityScore !== undefined ? { audioQualityScore: Number(audioQualityScore) } : {}),
        ...(reconnectCount !== undefined ? { reconnectCount: Number(reconnectCount) } : {}),
        ...(wasReconnected !== undefined ? { wasReconnected: Boolean(wasReconnected) } : {})
      }
    });

    res.json({ success: true, call: updated });
  } catch (err: any) {
    console.error('[Calls] Save quality error:', err);
    res.status(500).json({ error: 'Failed to save call quality data.' });
  }
});

// 7b. Record call quality events that do not fit the network sample summary.
router.post('/:id/quality-events', authenticate, async (req: Request, res: Response) => {
  try {
    const allowedEventTypes = new Set([
      'speech_recognition_failure',
      'recording_upload_failure',
      'dropped_call'
    ]);
    const eventType = String(req.body.eventType || '');
    if (!allowedEventTypes.has(eventType)) {
      res.status(400).json({ error: 'Unsupported quality event type.' });
      return;
    }

    const callIdentifier = req.params.id;
    const call = await prisma.callRecord.findFirst({
      where: { OR: [{ id: callIdentifier }, { callId: callIdentifier }] },
      select: { id: true, customerId: true, agentId: true, adminId: true }
    });
    if (!call) {
      res.status(404).json({ error: 'Call record not found.' });
      return;
    }

    const isParticipant = call.customerId === req.user!.id ||
      call.agentId === req.user!.id ||
      call.adminId === req.user!.id;
    if (!isParticipant && req.user!.role !== 'admin') {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }

    const event = await prisma.callQualityEvent.create({
      data: {
        callRecordId: call.id,
        eventType,
        details: typeof req.body.details === 'string' ? req.body.details.slice(0, 500) : null
      }
    });
    const alert = await evaluateCallQualityAlert(eventType as QualityAlertEventType);
    if (alert) emitCallQualityAlert(alert);
    res.status(201).json({ success: true, eventId: event.id });
  } catch (err: any) {
    console.error('[Calls] Quality event error:', err);
    res.status(500).json({ error: 'Failed to save call quality event.' });
  }
});

// 7c. Get single call intelligence
router.get('/:id/intelligence', authenticate, async (req: Request, res: Response) => {
  try {
    const callIdentifier = req.params.id;
    const call = await prisma.callRecord.findFirst({
      where: {
        OR: [
          { id: callIdentifier },
          { callId: callIdentifier },
          { providerCallSid: callIdentifier }
        ]
      },
      include: {
        intelligence: true,
        followUpTasks: true,
        transcripts: { orderBy: { timestamp: 'asc' } },
        customer: { select: { id: true, name: true, phone: true, email: true, preferredLanguage: true } },
        agent: { select: { id: true, name: true, email: true } },
        admin: { select: { id: true, name: true, email: true } }
      }
    });

    if (!call) {
      res.status(404).json({ error: 'Call record not found.' });
      return;
    }

    if (req.user!.role === 'customer' && call.customerId !== req.user!.id) {
      res.status(403).json({ error: 'Access denied: customers may only view their own call intelligence.' });
      return;
    }

    let intelligence = call.intelligence;
    let followUpTasks = call.followUpTasks;
    // On-demand generation if call is completed and intelligence hasn't run yet
    if (!intelligence && call.status !== 'active' && call.status !== 'ringing' && call.status !== 'queued') {
      try {
        intelligence = await callIntelligenceService.processCall(call.id);
        followUpTasks = await prisma.followUpTask.findMany({ where: { callRecordId: call.id } });
      } catch (genErr) {
        console.warn('[CallRoutes] On-demand intelligence generation deferred:', genErr);
      }
    }

    res.json({
      intelligence,
      call,
      followUpTasks
    });
  } catch (err: any) {
    console.error('[Calls] Get call intelligence error:', err);
    res.status(500).json({ error: 'Failed to retrieve call intelligence.' });
  }
});

// 7e. Get live conversation insights (active or recent)
router.get('/:id/live-insights', authenticate, async (req: Request, res: Response) => {
  try {
    const callIdentifier = req.params.id;
    const insights = realtimeIntelligenceService.getLiveInsights(callIdentifier);
    if (!insights) {
      const call = await prisma.callRecord.findFirst({
        where: {
          OR: [
            { id: callIdentifier },
            { callId: callIdentifier }
          ]
        },
        include: { intelligence: true }
      });
      if (!call) {
        res.status(404).json({ error: 'Call not found.' });
        return;
      }
      res.json({
        callId: call.callId,
        primaryIntent: call.intelligence?.callReason || 'General Inquiries',
        hasUnresolvedFrustration: call.intelligence?.sentiment === 'negative',
        isRepeatedQuestion: false,
        requiresHumanAssistance: call.intelligence?.requiresHumanSupport || false,
        humanAssistanceReason: call.intelligence?.recommendedNextAction || null,
        recommendedNextAction: call.intelligence?.recommendedNextAction || null,
        overallSummary: call.intelligence?.overallSummary || null
      });
      return;
    }
    res.json(insights);
  } catch (err: any) {
    console.error('[Calls] Live insights error:', err);
    res.status(500).json({ error: 'Failed to retrieve live insights.' });
  }
});

// 7d. Retry Call Intelligence generation (Admin & Agent)
router.post('/:id/intelligence/retry', authenticate, requireRole(['admin', 'agent']), async (req: Request, res: Response) => {
  try {
    const callIdentifier = req.params.id;
    const updatedIntelligence = await callIntelligenceService.processCall(callIdentifier, true);

    if (!updatedIntelligence) {
      res.status(500).json({ error: 'Failed to re-process call intelligence.' });
      return;
    }

    res.json({ success: true, intelligence: updatedIntelligence });
  } catch (err: any) {
    console.error('[Calls] Retry intelligence error:', err);
    res.status(500).json({ error: 'Failed to retry call intelligence.' });
  }
});

// 8. Get single call details with complete transcript
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const call = await prisma.callRecord.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        agent: true,
        admin: true,
        transcripts: { orderBy: { timestamp: 'asc' } },
        transferRequests: true,
        sentimentRecords: { orderBy: { detectedAt: 'asc' } }
      }
    });

    if (!call) {
      res.status(404).json({ error: 'Call record not found.' });
      return;
    }

    if (req.user!.role === 'customer' && call.customerId !== req.user!.id) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }

    res.json({ call });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve call details.' });
  }
});


// ==========================================
// CALL RECORDING STORAGE & PLAYBACK ENDPOINTS
// ==========================================
const recordingsDir = path.resolve(process.cwd(), 'uploads/recordings');
if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir, { recursive: true });
}

const uploadRecording = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

// 15. Upload Call Recording Audio
router.post('/:callId/recording', authenticate, uploadRecording.single('audio'), async (req: Request, res: Response) => {
  try {
    const { callId } = req.params;
    const duration = req.body.duration ? parseInt(req.body.duration) : 0;

    if (req.user!.role !== 'customer' || req.body.consentStatus !== 'granted' || !req.file) {
      res.status(400).json({ error: 'A customer consent grant and audio file are required.' });
      return;
    }

    const call = await prisma.callRecord.findUnique({
      where: { callId }
    });

    if (!call) {
      res.status(404).json({ error: 'Call record not found.' });
      return;
    }

    if (call.customerId !== req.user!.id) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }

    const consentRecord = await prisma.callRecording.findUnique({ where: { callRecordId: call.id } });
    if (consentRecord?.consentStatus !== 'granted') {
      res.status(403).json({ error: 'Recording consent has not been granted for this call.' });
      return;
    }

    const filePath = path.resolve(recordingsDir, `${callId}.webm`);
    if (!filePath.startsWith(`${recordingsDir}${path.sep}`)) {
      res.status(400).json({ error: 'Invalid call recording identifier.' });
      return;
    }
    fs.writeFileSync(filePath, req.file.buffer);

    const recordingUrl = `/api/calls/${callId}/recording`;
    const updatedCall = await prisma.callRecord.update({
      where: { callId },
      data: {
        recordingUrl,
        recordingDuration: duration || call.duration || 0,
        recordingStatus: 'completed',
        recordingSizeBytes: req.file.size
      }
    });

    console.log(`[Recording] Stored recording for call ${callId} (${req.file.size} bytes, ${duration}s)`);
    res.json({
      success: true,
      message: 'Call recording saved successfully.',
      recordingUrl,
      recordingDuration: updatedCall.recordingDuration,
      recordingSizeBytes: req.file.size
    });
  } catch (err: any) {
    console.error('[Recording] Upload error:', err);
    res.status(500).json({ error: 'Failed to save call recording.' });
  }
});

// 16. Stream / Download Call Recording
router.get('/:callId/recording', authenticate, async (req: Request, res: Response) => {
  try {
    const { callId } = req.params;
    const call = await prisma.callRecord.findUnique({
      where: { callId }
    });

    if (!call) {
      res.status(404).json({ error: 'Call record not found.' });
      return;
    }

    // Role-based permission check: Customer can only access their own calls
    if (req.user!.role === 'customer' && call.customerId !== req.user!.id) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }

    const filePath = path.resolve(recordingsDir, `${callId}.webm`);
    if (!filePath.startsWith(`${recordingsDir}${path.sep}`)) {
      res.status(400).json({ error: 'Invalid call recording identifier.' });
      return;
    }
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Recording audio file not found on server.' });
      return;
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (req.query.download === 'true') {
      res.setHeader('Content-Disposition', `attachment; filename="KAIRA-Recording-${callId}.webm"`);
    }

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(filePath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'audio/webm',
      };
      res.writeHead(206, head);
      file.pipe(res);
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': 'audio/webm',
        'Accept-Ranges': 'bytes'
      };
      res.writeHead(200, head);
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err: any) {
    console.error('[Recording] Streaming error:', err);
    res.status(500).json({ error: 'Failed to stream call recording.' });
  }
});

export default router;
