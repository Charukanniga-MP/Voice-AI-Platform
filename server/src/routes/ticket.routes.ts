import { Router, Request, Response } from 'express';
import { prisma } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();
const statuses = ['open', 'in_progress', 'waiting', 'resolved', 'closed'];
const priorities = ['low', 'medium', 'high'];
const agents = ['Agent 1', 'Agent 2'];

router.use(authenticate, requireRole(['admin', 'agent']));

router.get('/', async (_req: Request, res: Response) => {
  try {
    const tickets = await prisma.supportTicket.findMany({ orderBy: [{ updatedAt: 'desc' }] });
    res.json({ tickets });
  } catch (err) {
    console.error('[Tickets] Fetch error:', err);
    res.status(500).json({ error: 'Failed to retrieve support tickets.' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { customerId, customerName, customerEmail, subject, description, priority, assignedTo, followUpAt } = req.body;
    if (!customerName?.trim() || !subject?.trim() || !description?.trim()) {
      res.status(400).json({ error: 'Customer name, subject, and description are required.' });
      return;
    }
    if (priority && !priorities.includes(priority)) {
      res.status(400).json({ error: 'Invalid ticket priority.' });
      return;
    }
    if (assignedTo && !agents.includes(assignedTo.trim())) {
      res.status(400).json({ error: 'Choose Agent 1 or Agent 2.' });
      return;
    }
    const ticket = await prisma.supportTicket.create({
      data: {
        customerId: customerId || null,
        customerName: customerName.trim(),
        customerEmail: customerEmail?.trim() || null,
        subject: subject.trim(),
        description: description.trim(),
        priority: priority || 'medium',
        assignedTo: assignedTo?.trim() || null,
        followUpAt: followUpAt ? new Date(followUpAt) : null
      }
    });
    res.status(201).json({ ticket });
  } catch (err) {
    console.error('[Tickets] Create error:', err);
    res.status(500).json({ error: 'Failed to create support ticket.' });
  }
});

router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { status, priority, assignedTo, followUpAt } = req.body;
    if (status !== undefined && !statuses.includes(status)) {
      res.status(400).json({ error: 'Invalid ticket status.' });
      return;
    }
    if (priority !== undefined && !priorities.includes(priority)) {
      res.status(400).json({ error: 'Invalid ticket priority.' });
      return;
    }
    if (assignedTo && !agents.includes(assignedTo.trim())) {
      res.status(400).json({ error: 'Choose Agent 1 or Agent 2.' });
      return;
    }
    const ticket = await prisma.supportTicket.update({
      where: { id: req.params.id },
      data: {
        ...(status !== undefined ? { status } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(assignedTo !== undefined ? { assignedTo: assignedTo || null } : {}),
        ...(followUpAt !== undefined ? { followUpAt: followUpAt ? new Date(followUpAt) : null } : {})
      }
    });
    res.json({ ticket });
  } catch (err) {
    console.error('[Tickets] Update error:', err);
    res.status(500).json({ error: 'Failed to update support ticket.' });
  }
});

export default router;
