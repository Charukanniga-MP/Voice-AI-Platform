import { Router, Request, Response } from 'express';
import { prisma } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { validate, ticketCreateSchema, ticketUpdateSchema, ticketMessageSchema } from '../middleware/validation.js';
import { sendEmail } from '../services/email.js';
import { emitTicketNotification } from '../services/socket.js';

const router = Router();
const statuses = ['open', 'in_progress', 'waiting', 'resolved', 'closed'];
const priorities = ['low', 'normal', 'medium', 'high', 'urgent'];
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

async function ticketStaffRooms(assignedTo?: string | null) {
  const rooms = ['role:admin'];
  if (!assignedTo?.trim()) return rooms;
  const agents = await prisma.user.findMany({ where: { role: 'agent' }, select: { id: true, name: true } });
  const matchingAgent = agents.find(agent => agent.name.trim().toLowerCase() === assignedTo.trim().toLowerCase());
  if (matchingAgent) rooms.push(`user:${matchingAgent.id}`);
  return rooms;
}

async function notifyTicket(ticket: { id: string; customerId: string | null; customerEmail?: string | null; assignedTo: string | null }, kind: string, title: string, message: string, options: { customer?: boolean; staff?: boolean } = {}) {
  try {
    const rooms: string[] = [];
    if (options.customer) {
      let customerId = ticket.customerId;
      if (ticket.customerEmail) rooms.push(`customer:${ticket.customerEmail.trim().toLowerCase()}`);
      if (!customerId && ticket.customerEmail) {
        const customer = await prisma.user.findFirst({
          where: { role: 'customer', email: ticket.customerEmail.toLowerCase().trim() },
          select: { id: true }
        });
        customerId = customer?.id || null;
      }
      if (customerId) rooms.push(`user:${customerId}`);
    }
    if (options.staff !== false) rooms.push(...await ticketStaffRooms(ticket.assignedTo));
    emitTicketNotification(rooms, { ticketId: ticket.id, kind, title, message });
  } catch (notificationError) {
    console.error('[Tickets] Live notification failed:', notificationError);
  }
}

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
      orderBy: [{ updatedAt: 'desc' }],
      include: { messages: { orderBy: { createdAt: 'asc' } } }
    });
    res.json({ tickets });
  } catch (err) {
    console.error('[Tickets] Fetch error:', err);
    res.status(500).json({ error: 'Failed to retrieve support tickets.' });
  }
});

// Ticket replies are visible to the ticket's customer and all support staff.
router.post('/:id/messages', validate(ticketMessageSchema), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
    if (!ticket) {
      res.status(404).json({ error: 'Support ticket not found.' });
      return;
    }
    if (user.role === 'customer' && ticket.customerId !== user.id && ticket.customerEmail?.toLowerCase() !== user.email.toLowerCase()) {
      res.status(403).json({ error: 'Access denied to this ticket.' });
      return;
    }

    const message = await prisma.supportTicketMessage.create({
      data: {
        ticketId: ticket.id,
        senderId: user.id,
        senderName: user.name,
        senderRole: user.role,
        message: req.body.message
      }
    });
    await prisma.supportTicket.update({ where: { id: ticket.id }, data: { updatedAt: new Date() } });
    await notifyTicket(
      ticket,
      'reply',
      'New ticket reply',
      `${message.senderName} replied to “${ticket.subject}”.`,
      { customer: user.role !== 'customer' }
    );

    // A reply from support should notify the customer by email when an address exists.
    // Email problems must not undo or hide the message already saved to the ticket.
    let emailSent = false;
    if (user.role !== 'customer' && ticket.customerEmail) {
      try {
        const result = await sendEmail({
          to: ticket.customerEmail,
          subject: `Update on your support ticket: ${ticket.subject}`,
          text: `Hello ${ticket.customerName},\n\n${user.name} from support replied to your ticket "${ticket.subject}":\n\n${message.message}\n\nSign in to your account to view the full conversation.`,
          html: `<p>Hello ${escapeHtml(ticket.customerName)},</p><p>${escapeHtml(user.name)} from support replied to your ticket <strong>${escapeHtml(ticket.subject)}</strong>:</p><p>${escapeHtml(message.message).replace(/\n/g, '<br>')}</p><p>Sign in to your account to view the full conversation.</p>`
        });
        emailSent = result.delivered;
      } catch (emailError) {
        console.error('[Tickets] Customer notification failed:', emailError);
      }
    }

    res.status(201).json({ message, emailSent });
  } catch (err) {
    console.error('[Tickets] Message error:', err);
    res.status(500).json({ error: 'Failed to send ticket message.' });
  }
});

// 2. Create Support Ticket (Customers, Agents, Admins)
router.post('/', validate(ticketCreateSchema), async (req: Request, res: Response) => {
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
    emitTicketNotification(['role:admin'], {
      ticketId: ticket.id,
      kind: 'created',
      title: 'New support ticket',
      message: `${ticket.customerName} submitted “${ticket.subject}”.`
    });
    if (ticket.assignedTo) {
      await notifyTicket(ticket, 'assigned', 'Ticket assigned', `“${ticket.subject}” was assigned to ${ticket.assignedTo}.`, { customer: true });
    }
    res.status(201).json({ ticket });
  } catch (err) {
    console.error('[Tickets] Create error:', err);
    res.status(500).json({ error: 'Failed to create support ticket.' });
  }
});

// 3. Update Support Ticket (Admins & Agents can update status/priority/assignedTo; Customers can update open tickets)
router.patch('/:id', validate(ticketUpdateSchema), async (req: Request, res: Response) => {
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
    if (status !== undefined && status !== existing.status) {
      await notifyTicket(ticket, 'status', 'Ticket status updated', `“${ticket.subject}” is now ${status.replace('_', ' ')}.`, { customer: true });
    }
    if (assignedTo !== undefined && assignedTo !== existing.assignedTo) {
      await notifyTicket(ticket, 'assigned', 'Ticket assignment updated', ticket.assignedTo ? `“${ticket.subject}” was assigned to ${ticket.assignedTo}.` : `“${ticket.subject}” is now unassigned.`, { customer: true });
    }
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
