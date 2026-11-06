import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();

// 1. Get all Support Agents (Admin only)
router.get('/', authenticate, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const search = (req.query.search as string || '').trim().toLowerCase();

    const agents = await prisma.user.findMany({
      where: {
        role: 'agent',
        ...(search ? {
          OR: [
            { name: { contains: search } },
            { email: { contains: search } },
            { phone: { contains: search } }
          ]
        } : {})
      },
      include: {
        callsAsAgent: {
          select: {
            id: true,
            startTime: true,
            duration: true,
            status: true
          },
          orderBy: { startTime: 'desc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Deduplicate in memory by lowercase email
    const seenEmails = new Set<string>();
    const uniqueAgents = [];

    for (const a of agents) {
      const emailLower = a.email.trim().toLowerCase();
      if (!seenEmails.has(emailLower)) {
        seenEmails.add(emailLower);
        const calls = a.callsAsAgent || [];
        uniqueAgents.push({
          id: a.id,
          name: a.name,
          email: a.email,
          phone: a.phone || 'N/A',
          createdAt: a.createdAt,
          totalHandledCalls: calls.length,
          lastCallDate: calls.length > 0 ? calls[0].startTime : null
        });
      }
    }

    res.json({ agents: uniqueAgents });
  } catch (err: any) {
    console.error('[Agents] Fetch error:', err);
    res.status(500).json({ error: 'Failed to retrieve support agents.' });
  }
});

// 2. Add Support Agent Manually (Admin only)
router.post('/', authenticate, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const { name, email, phone, password } = req.body;

    if (!name || !email) {
      res.status(400).json({ error: 'Agent name and email are required.' });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();

    // Strict uniqueness check across all user accounts
    const existing = await prisma.user.findFirst({
      where: { email: cleanEmail }
    });

    if (existing) {
      res.status(400).json({ error: `An account with email "${cleanEmail}" already exists (${existing.role}).` });
      return;
    }

    if (!password || password.length < 6) {
      res.status(400).json({ error: 'A password with a minimum of 6 characters is required.' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const agent = await prisma.user.create({
      data: {
        name: name.trim(),
        email: cleanEmail,
        phone: phone ? phone.trim() : null,
        role: 'agent',
        passwordHash
      }
    });

    res.status(201).json({
      message: 'Support Agent created successfully',
      agent: {
        id: agent.id,
        name: agent.name,
        email: agent.email,
        phone: agent.phone,
        createdAt: agent.createdAt
      }
    });
  } catch (err: any) {
    console.error('[Agents] Create error:', err);
    res.status(500).json({ error: 'Failed to create support agent.' });
  }
});

// 3. Update Support Agent (Admin only)
router.put('/:id', authenticate, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const { name, email, phone, password } = req.body;

    const existing = await prisma.user.findUnique({
      where: { id: req.params.id }
    });

    if (!existing || existing.role !== 'agent') {
      res.status(404).json({ error: 'Support Agent account not found.' });
      return;
    }

    const cleanEmail = email ? email.trim().toLowerCase() : existing.email;

    // Check if new email conflicts with another user
    if (cleanEmail !== existing.email) {
      const emailConflict = await prisma.user.findFirst({
        where: {
          email: cleanEmail,
          id: { not: existing.id }
        }
      });
      if (emailConflict) {
        res.status(400).json({ error: `The email "${cleanEmail}" is already in use by another account.` });
        return;
      }
    }

    const dataToUpdate: any = {
      name: name ? name.trim() : existing.name,
      email: cleanEmail,
      phone: phone !== undefined ? (phone ? phone.trim() : null) : existing.phone
    };

    if (password && password.trim().length >= 6) {
      dataToUpdate.passwordHash = await bcrypt.hash(password.trim(), 10);
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: dataToUpdate
    });

    res.json({
      message: 'Support Agent updated successfully',
      agent: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        phone: updated.phone
      }
    });
  } catch (err: any) {
    console.error('[Agents] Update error:', err);
    res.status(500).json({ error: 'Failed to update support agent.' });
  }
});

// 4. Delete Support Agent (Admin only)
router.delete('/:id', authenticate, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const existing = await prisma.user.findUnique({
      where: { id: req.params.id }
    });

    if (!existing || existing.role !== 'agent') {
      res.status(404).json({ error: 'Support Agent account not found.' });
      return;
    }

    // Protect default seed agent from deletion
    if (existing.email === 'agent@kaira') {
      res.status(400).json({ error: 'The primary system Support Agent (agent@kaira) cannot be deleted.' });
      return;
    }

    await prisma.user.delete({
      where: { id: req.params.id }
    });

    res.json({ message: 'Support Agent deleted successfully.' });
  } catch (err: any) {
    console.error('[Agents] Delete error:', err);
    res.status(500).json({ error: 'Failed to delete support agent.' });
  }
});

export default router;

