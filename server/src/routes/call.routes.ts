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
      pendingTransfers
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'customer' } }),
      prisma.user.count({ where: { role: 'agent' } }),
      prisma.callRecord.count(),
      prisma.callRecord.count({ where: { direction: 'incoming' } }),
      prisma.callRecord.count({ where: { direction: 'outgoing' } }),
      prisma.callRecord.count({ where: { status: 'active' } }),
      prisma.callRecord.count({ where: { status: 'completed' } }),
      prisma.callRecord.count({ where: { transferred: true } }),
      prisma.callTransferRequest.count({ where: { status: { in: ['pending', 'ringing'] } } })
    ]);

    res.json({
      totalCustomers,
      totalAgents,
      totalCalls,
      totalIncoming,
      totalOutgoing,
      activeCalls,
      completedCalls,
      transferredCalls,
      pendingTransfers
    });
  } catch (err: any) {
    console.error('[Calls] Stats error:', err);
    res.status(500).json({ error: 'Failed to retrieve call statistics.' });
  }
});

// 2. All calls with filter tabs (Admin & Agent)
router.get('/', authenticate, requireRole(['admin', 'agent']), async (req: Request, res: Response) => {
  try {
    const { filter, search } = req.query as { filter?: string; search?: string };

    const where: any = {};

    if (filter === 'incoming') where.direction = 'incoming';
    else if (filter === 'outgoing') where.direction = 'outgoing';
    else if (filter === 'transferred') where.transferred = true;
    else if (filter === 'active') where.status = 'active';
    else if (filter === 'completed') where.status = 'completed';
    else if (filter === 'missed') where.status = 'missed';

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
        customer: { select: { id: true, name: true, email: true, phone: true } },
        agent: { select: { id: true, name: true } },
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

// 5. Get single call details with complete transcript
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

    // Role check: Customer can only view their own call
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

