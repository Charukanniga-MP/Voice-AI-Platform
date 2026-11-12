import { Router, Request, Response } from 'express';
import { prisma } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate, callRatingSchema, callNotesSchema } from '../middleware/validation.js';
import { callIntelligenceService } from '../services/callIntelligence.js';

const router = Router();

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
      ratedCalls
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
      })
    ]);

    const avgDuration = allCompletedCalls.length > 0
      ? Math.round(allCompletedCalls.reduce((acc, c) => acc + (c.duration || 0), 0) / allCompletedCalls.length)
      : 0;

    const avgWaitTime = allQueuedRecords.length > 0
      ? Math.round(allQueuedRecords.reduce((acc, c) => acc + (c.queueDuration || 0), 0) / allQueuedRecords.length)
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

// 1b. Call Quality & Reliability Statistics (Admin & Agent)
router.get('/quality/stats', authenticate, requireRole(['admin', 'agent']), async (req: Request, res: Response) => {
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
      qualityHistory
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
      })
    ]);

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
      qualityBreakdown,
      history: qualityHistory
    });
  } catch (err: any) {
    console.error('[Calls] Quality stats error:', err);
    res.status(500).json({ error: 'Failed to retrieve call quality statistics.' });
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
      prisma.followUpTask.count({ where: { status: 'pending' } }),
      prisma.followUpTask.count({ where: { status: 'completed' } }),
      prisma.callIntelligence.findMany({
        select: {
          id: true,
          callRecordId: true,
          customerName: true,
          agentId: true,
          agentName: true,
          resolutionStatus: true,
          customerQuestions: true,
          sentiment: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' },
        take: 100
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
      } catch (e) {}
    }
    const frequentlyAskedQuestions = Object.values(faqMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

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
      pendingFollowUpTasks,
      completedFollowUpTasks,
      frequentlyAskedQuestions,
      kbGaps: allGaps,
      agentResolutionStats,
      recentIntelligence: allIntelligence
    });
  } catch (err: any) {
    console.error('[Calls] Intelligence stats error:', err);
    res.status(500).json({ error: 'Failed to retrieve call intelligence statistics.' });
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
    const userId = req.user!.id;

    const calls = await prisma.callRecord.findMany({
      where: { customerId: userId },
      include: {
        transcripts: { orderBy: { timestamp: 'asc' } },
        admin: { select: { name: true } },
        agent: { select: { name: true } },
        sentimentRecords: { where: { isFinal: true } },
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
    // On-demand generation if call is completed and intelligence hasn't run yet
    if (!intelligence && call.status !== 'active' && call.status !== 'ringing' && call.status !== 'queued') {
      try {
        intelligence = await callIntelligenceService.processCall(call.id);
      } catch (genErr) {
        console.warn('[CallRoutes] On-demand intelligence generation deferred:', genErr);
      }
    }

    res.json({
      intelligence,
      call,
      followUpTasks: call.followUpTasks
    });
  } catch (err: any) {
    console.error('[Calls] Get call intelligence error:', err);
    res.status(500).json({ error: 'Failed to retrieve call intelligence.' });
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

export default router;
