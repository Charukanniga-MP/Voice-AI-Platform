import { Router, Request, Response } from 'express';
import { prisma } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();

/**
 * 1. GET /api/follow-up-tasks - List follow-up tasks
 * Admins view all, agents view assigned + unassigned, customers view only their tasks.
 */
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const status = (req.query.status as string || 'all').toLowerCase();
    const priority = (req.query.priority as string || 'all').toLowerCase();
    const search = (req.query.search as string || '').trim().toLowerCase();

    const whereClause: any = {};

    // Role-based scoping
    if (user.role === 'customer') {
      whereClause.customerId = user.id;
    } else if (user.role === 'agent') {
      // Agents see tasks assigned to them OR unassigned tasks
      const agentScope = req.query.scope as string; // 'me' | 'all'
      if (agentScope === 'me') {
        whereClause.assignedAgentId = user.id;
      } else {
        whereClause.OR = [
          { assignedAgentId: user.id },
          { assignedAgentId: null }
        ];
      }
    }
    // Admin sees everything

    // Filter by status
    if (status !== 'all') {
      whereClause.status = status;
    }

    // Filter by priority
    if (priority !== 'all') {
      whereClause.priority = priority;
    }

    // Search query
    if (search) {
      const searchConditions = [
        { title: { contains: search } },
        { customerName: { contains: search } },
        { customerPhone: { contains: search } },
        { unresolvedQuestion: { contains: search } },
        { assignedAgentName: { contains: search } }
      ];
      if (whereClause.OR) {
        whereClause.AND = [{ OR: searchConditions }];
      } else {
        whereClause.OR = searchConditions;
      }
    }

    const tasks = await prisma.followUpTask.findMany({
      where: whereClause,
      include: {
        callRecord: {
          select: {
            id: true,
            callId: true,
            startTime: true,
            duration: true,
            language: true,
            direction: true
          }
        },
        assignedAgent: {
          select: { id: true, name: true, email: true }
        }
      },
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'desc' }
      ]
    });

    res.json({ tasks });
  } catch (err: any) {
    console.error('[FollowUpTasks] Fetch error:', err);
    res.status(500).json({ error: 'Failed to retrieve follow-up tasks.' });
  }
});

/**
 * 2. GET /api/follow-up-tasks/:id - Retrieve single follow-up task with full context
 */
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const task = await prisma.followUpTask.findUnique({
      where: { id: req.params.id },
      include: {
        callRecord: {
          include: {
            intelligence: true,
            transcripts: { orderBy: { timestamp: 'asc' } },
            customer: true,
            agent: true
          }
        },
        customer: true,
        assignedAgent: true
      }
    });

    if (!task) {
      res.status(404).json({ error: 'Follow-up task not found.' });
      return;
    }

    // Role check: customer can only view their own
    if (user.role === 'customer' && task.customerId !== user.id) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }

    res.json({ task });
  } catch (err: any) {
    console.error('[FollowUpTasks] Get detail error:', err);
    res.status(500).json({ error: 'Failed to retrieve follow-up task.' });
  }
});

/**
 * 3. PUT /api/follow-up-tasks/:id - Update task status, notes, assignment, and priority
 */
router.put('/:id', authenticate, requireRole(['agent', 'admin']), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const taskId = req.params.id;
    const { status, priority, notes, resolutionNotes, assignedAgentId, assignedAgentName } = req.body;

    const existing = await prisma.followUpTask.findUnique({
      where: { id: taskId }
    });

    if (!existing) {
      res.status(404).json({ error: 'Follow-up task not found.' });
      return;
    }

    const updateData: any = {};

    if (status) {
      updateData.status = status;
      if (status === 'completed') {
        updateData.resolvedAt = new Date();
        updateData.resolvedBy = user.name;
      } else if (status === 'pending' || status === 'in_progress') {
        updateData.resolvedAt = null;
        updateData.resolvedBy = null;
      }
    }

    if (priority) {
      updateData.priority = priority;
    }

    if (notes !== undefined) {
      updateData.notes = notes;
    }

    if (resolutionNotes !== undefined) {
      updateData.resolutionNotes = resolutionNotes;
    }

    // Reassignment (Admin can reassign to anyone; agents can assign unassigned task to themselves)
    if (assignedAgentId !== undefined) {
      if (user.role === 'admin') {
        updateData.assignedAgentId = assignedAgentId || null;
        updateData.assignedAgentName = assignedAgentName || null;
      } else if (user.role === 'agent') {
        // Agent claiming task
        if (assignedAgentId === user.id) {
          updateData.assignedAgentId = user.id;
          updateData.assignedAgentName = user.name;
        }
      }
    }

    const updated = await prisma.followUpTask.update({
      where: { id: taskId },
      data: updateData,
      include: {
        assignedAgent: { select: { id: true, name: true, email: true } },
        callRecord: { select: { id: true, callId: true, duration: true } }
      }
    });

    res.json({ success: true, task: updated });
  } catch (err: any) {
    console.error('[FollowUpTasks] Update error:', err);
    res.status(500).json({ error: 'Failed to update follow-up task.' });
  }
});

/**
 * 4. POST /api/follow-up-tasks - Create manual follow-up task
 */
router.post('/', authenticate, requireRole(['agent', 'admin']), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const {
      callRecordId,
      customerId,
      customerName,
      customerPhone,
      customerEmail,
      title,
      unresolvedQuestion,
      previousSummary,
      actionRequired,
      priority,
      language
    } = req.body;

    if (!callRecordId || !unresolvedQuestion) {
      res.status(400).json({ error: 'Call record ID and unresolved question are required.' });
      return;
    }

    // Prevent duplicate task for this call & question
    const existing = await prisma.followUpTask.findFirst({
      where: {
        callRecordId,
        unresolvedQuestion: unresolvedQuestion.trim()
      }
    });

    if (existing) {
      res.status(409).json({ error: 'A follow-up task already exists for this call and question.', task: existing });
      return;
    }

    const task = await prisma.followUpTask.create({
      data: {
        callRecordId,
        customerId: customerId || null,
        customerName: customerName || 'Valued Customer',
        customerPhone: customerPhone || null,
        customerEmail: customerEmail || null,
        assignedAgentId: user.role === 'agent' ? user.id : null,
        assignedAgentName: user.role === 'agent' ? user.name : null,
        title: title || `Follow-Up: ${customerName || 'Customer'} - ${unresolvedQuestion.slice(0, 40)}`,
        unresolvedQuestion: unresolvedQuestion.trim(),
        previousSummary: previousSummary || 'Manual follow-up flagged by support.',
        actionRequired: actionRequired || 'Contact customer to address unresolved inquiry.',
        priority: priority || 'medium',
        status: 'pending',
        language: language || 'en'
      }
    });

    res.status(201).json({ success: true, task });
  } catch (err: any) {
    console.error('[FollowUpTasks] Create error:', err);
    res.status(500).json({ error: 'Failed to create follow-up task.' });
  }
});

export default router;
