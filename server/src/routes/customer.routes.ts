import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();

// 1. Get all customers (Admin & Agent)
router.get('/', authenticate, requireRole(['admin', 'agent']), async (req: Request, res: Response) => {
  try {
    const search = (req.query.search as string || '').trim().toLowerCase();

    const customers = await prisma.user.findMany({
      where: {
        role: 'customer',
        ...(search ? {
          OR: [
            { name: { contains: search } },
            { email: { contains: search } },
            { phone: { contains: search } }
          ]
        } : {})
      },
      include: {
        callsAsCustomer: {
          select: {
            id: true,
            startTime: true,
            duration: true,
            status: true,
            transferred: true
          },
          orderBy: { startTime: 'desc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const formatted = customers.map(c => {
      const calls = c.callsAsCustomer;
      const lastCall = calls.length > 0 ? calls[0].startTime : null;
      return {
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone || 'N/A',
        createdAt: c.createdAt,
        totalCalls: calls.length,
        lastCallDate: lastCall
      };
    });

    res.json({ customers: formatted });
  } catch (err: any) {
    console.error('[Customers] Fetch error:', err);
    res.status(500).json({ error: 'Failed to retrieve customers.' });
  }
});

// 2. Add customer manually (Admin only)
router.post('/', authenticate, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const { name, email, phone, password } = req.body;

    if (!name || !email) {
      res.status(400).json({ error: 'Name and email are required.' });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const existing = await prisma.user.findFirst({
      where: { email: cleanEmail }
    });

    if (existing) {
      res.status(400).json({ error: 'User with this email already exists.' });
      return;
    }

    if (!password || password.length < 6) {
      res.status(400).json({ error: 'A password with a minimum of 6 characters is required.' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const customer = await prisma.user.create({
      data: {
        name: name.trim(),
        email: cleanEmail,
        phone: phone ? phone.trim() : null,
        role: 'customer',
        passwordHash
      }
    });

    res.status(201).json({
      message: 'Customer created successfully',
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        createdAt: customer.createdAt
      }
    });
  } catch (err: any) {
    console.error('[Customers] Create error:', err);
    res.status(500).json({ error: 'Failed to create customer.' });
  }
});

// 3. Get customer details with full call history (Admin & Agent)
router.get('/:id', authenticate, requireRole(['admin', 'agent']), async (req: Request, res: Response) => {
  try {
    const customer = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        callsAsCustomer: {
          include: {
            transcripts: {
              orderBy: { timestamp: 'asc' }
            },
            transferRequests: true
          },
          orderBy: { startTime: 'desc' }
        }
      }
    });

    if (!customer) {
      res.status(404).json({ error: 'Customer not found.' });
      return;
    }

    res.json({ customer });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve customer details.' });
  }
});

// 4. Update customer information (Admin only)
router.put('/:id', authenticate, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const { name, email, phone } = req.body;

    const existing = await prisma.user.findUnique({
      where: { id: req.params.id }
    });

    if (!existing) {
      res.status(404).json({ error: 'Customer not found.' });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        name: name ? name.trim() : existing.name,
        email: email ? email.trim().toLowerCase() : existing.email,
        phone: phone !== undefined ? phone.trim() : existing.phone
      }
    });

    res.json({
      message: 'Customer updated successfully',
      customer: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        phone: updated.phone
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update customer.' });
  }
});

// 5. Delete customer (Admin only)
router.delete('/:id', authenticate, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const existing = await prisma.user.findUnique({
      where: { id: req.params.id }
    });

    if (!existing) {
      res.status(404).json({ error: 'Customer not found.' });
      return;
    }

    if (existing.role !== 'customer') {
      res.status(403).json({ error: 'Cannot delete non-customer accounts.' });
      return;
    }

    await prisma.user.delete({
      where: { id: req.params.id }
    });

    res.json({ message: 'Customer deleted successfully.' });
  } catch (err: any) {
    console.error('[Customers] Delete error:', err);
    res.status(500).json({ error: 'Failed to delete customer.' });
  }
});

export default router;

