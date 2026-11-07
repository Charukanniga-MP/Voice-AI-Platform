import { Router, Request, Response } from 'express';
import { prisma } from '../db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
const statuses = ['open', 'in_progress', 'waiting', 'resolved', 'closed'];
const priorities = ['low', 'normal', 'medium', 'high', 'urgent'];

router.use(authenticate);

// 1. Get Support Tickets (Role-scoped: Customers see own tickets; Agents/Admins see all)
router.get('/', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    let whereClause: any = {};

    if (user.role === 'customer') {
      whereClause = {
        OR: [
          { customerId: user.id },
          { customerEmail: user.email.toLowerCase().trim() }
        ]
      };
    }

    const tickets = await prisma.supportTicket.findMany({
      where: whereClause,
      orderBy: [{ updatedAt: 'desc' }]
    });
    res.json({ tickets });
  } catch (err) {
    console.error('[Tickets] Fetch error:', err);
    res.status(500).json({ error: 'Failed to retrieve support tickets.' });
  }
});

// 2. Create Support Ticket (Customers, Agents, Admins)
router.post('/', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { customerId, customerName, customerEmail, subject, description, priority, assignedTo, followUpAt } = req.body;

    const finalName = user.role === 'customer' ? user.name : (customerName?.trim() || user.name);
    const finalEmail = user.role === 'customer' ? user.email : (customerEmail?.trim() || user.email);
    const finalCustomerId = user.role === 'customer' ? user.id : (customerId || null);

    if (!finalName?.trim() || !subject?.trim() || !description?.trim()) {
      res.status(400).json({ error: 'Customer name, subject, and description are required.' });
      return;
    }
    if (priority && !priorities.includes(priority)) {
      res.status(400).json({ error: 'Invalid ticket priority.' });
      return;
    }

    const ticket = await prisma.supportTicket.create({
      data: {
        customerId: finalCustomerId,
        customerName: finalName.trim(),
        customerEmail: finalEmail?.trim()?.toLowerCase() || null,
        subject: subject.trim(),
        description: description.trim(),
        priority: priority || 'normal',
        assignedTo: user.role !== 'customer' && assignedTo?.trim() ? assignedTo.trim() : null,
        followUpAt: user.role !== 'customer' && followUpAt ? new Date(followUpAt) : null
      }
    });
    res.status(201).json({ ticket });
  } catch (err) {
    console.error('[Tickets] Create error:', err);
    res.status(500).json({ error: 'Failed to create support ticket.' });
  }
});

// 3. Update Support Ticket (Admins & Agents can update status/priority/assignedTo; Customers can update open tickets)
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const existing = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: 'Support ticket not found.' });
      return;
    }

    // Role check
    if (user.role === 'customer' && existing.customerId !== user.id && existing.customerEmail?.toLowerCase() !== user.email.toLowerCase()) {
      res.status(403).json({ error: 'Access denied to this ticket.' });
      return;
    }

    const { status, priority, assignedTo, followUpAt, description } = req.body;
    if (status !== undefined && !statuses.includes(status)) {
      res.status(400).json({ error: 'Invalid ticket status.' });
      return;
    }
    if (priority !== undefined && !priorities.includes(priority)) {
      res.status(400).json({ error: 'Invalid ticket priority.' });
      return;
    }

    const updateData: any = {};
    if (user.role === 'customer') {
      if (description) updateData.description = description.trim();
    } else {
      if (status !== undefined) updateData.status = status;
      if (priority !== undefined) updateData.priority = priority;
      if (assignedTo !== undefined) updateData.assignedTo = assignedTo || null;
      if (followUpAt !== undefined) updateData.followUpAt = followUpAt ? new Date(followUpAt) : null;
      if (description) updateData.description = description.trim();
    }

    const ticket = await prisma.supportTicket.update({
      where: { id: req.params.id },
      data: updateData
    });
    res.json({ ticket });
  } catch (err) {
    console.error('[Tickets] Update error:', err);
    res.status(500).json({ error: 'Failed to update support ticket.' });
  }
});

// 4. Delete Support Ticket (Admins and Agents only)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'admin' && user.role !== 'agent') {
      res.status(403).json({ error: 'Only administrators and agents can delete tickets.' });
      return;
    }

    await prisma.supportTicket.delete({ where: { id: req.params.id } });
    res.json({ message: 'Support ticket deleted successfully.' });
  } catch (err) {
    console.error('[Tickets] Delete error:', err);
    res.status(500).json({ error: 'Failed to delete support ticket.' });
  }
});

export default router;
