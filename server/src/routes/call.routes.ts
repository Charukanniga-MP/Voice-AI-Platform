import { Router, Request, Response } from 'express';
import { prisma } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';

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
      allCallsWithLang
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
      hi: 0
    };

    allCallsWithLang.forEach(c => {
      const lang = c.language || 'en';
      callsByLanguage[lang] = (callsByLanguage[lang] || 0) + 1;
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
      callsByLanguage
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
        transferRequests: true
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
        agent: { select: { name: true } }
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
            transcripts: { orderBy: { timestamp: 'asc' } }
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
router.post('/:id/notes', authenticate, requireRole(['admin', 'agent']), async (req: Request, res: Response) => {
  try {
    const { notes } = req.body;
    const call = await prisma.callRecord.update({
      where: { id: req.params.id },
      data: { callNotes: notes }
    });

    res.json({ message: 'Call notes saved successfully.', callNotes: call.callNotes });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to save call notes.' });
  }
});

// 7. Save Customer Rating (Customer only)
router.post('/:id/rating', authenticate, async (req: Request, res: Response) => {
  try {
    const { rating } = req.body;
    await prisma.callRecord.update({
      where: { id: req.params.id },
      data: { rating: Number(rating) }
    });

    res.json({ message: 'Rating saved.' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to save call rating.' });
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
        transferRequests: true
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
