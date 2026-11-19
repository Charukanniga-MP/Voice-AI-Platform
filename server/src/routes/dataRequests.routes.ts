import { Router, Request, Response } from 'express';
import { prisma } from '../db.js';
import { authenticate, authorizeRoles } from '../middleware/auth.js';

const router = Router();
const requestTypes = ['export', 'deletion'] as const;
const statuses = ['pending', 'in_progress', 'completed', 'rejected'] as const;

// Customers can view only their own requests and submit export/deletion requests.
router.get('/mine', authenticate, authorizeRoles('customer'), async (req: Request, res: Response) => {
  try {
    const requests = await prisma.customerDataRequest.findMany({
      where: { customerId: req.user!.id }, orderBy: { createdAt: 'desc' }
    });
    return res.json({ requests });
  } catch (error) {
    console.error('[DataRequests] Could not load customer requests:', error);
    return res.status(500).json({ error: 'Could not load data requests.' });
  }
});

router.post('/', authenticate, authorizeRoles('customer'), async (req: Request, res: Response) => {
  const requestType = req.body?.requestType;
  if (!requestTypes.includes(requestType)) {
    return res.status(400).json({ error: 'Choose an export or deletion request.' });
  }
  try {
    const existing = await prisma.customerDataRequest.findFirst({
      where: { customerId: req.user!.id, requestType, status: { in: ['pending', 'in_progress'] } }
    });
    if (existing) return res.status(409).json({ error: 'You already have an open request of this type.' });
    const request = await prisma.customerDataRequest.create({
      data: { customerId: req.user!.id, requestType }
    });
    await prisma.securityAuditLog.create({ data: {
      eventType: 'CUSTOMER_DATA_REQUEST_CREATED', userId: req.user!.id, email: req.user!.email,
      ipAddress: req.ip, details: JSON.stringify({ requestId: request.id, requestType })
    } });
    return res.status(201).json({ request });
  } catch (error) {
    console.error('[DataRequests] Could not create customer request:', error);
    return res.status(500).json({ error: 'Could not submit data request.' });
  }
});

// Admins can review requests and record the outcome. Every transition is audited.
router.get('/', authenticate, authorizeRoles('admin'), async (_req: Request, res: Response) => {
  try {
    const [requests, logs] = await Promise.all([
      prisma.customerDataRequest.findMany({
        include: { customer: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.securityAuditLog.findMany({
        where: { eventType: { in: ['CUSTOMER_DATA_REQUEST_CREATED', 'CUSTOMER_DATA_REQUEST_UPDATED'] } },
        orderBy: { createdAt: 'desc' }, take: 200,
        select: { id: true, eventType: true, email: true, createdAt: true, details: true }
      })
    ]);
    const auditHistory = logs.flatMap(log => {
      try {
        const details = JSON.parse(log.details || '{}');
        return details.requestId ? [{ ...log, requestId: details.requestId, details }] : [];
      } catch { return []; }
    });
    return res.json({ requests, auditHistory });
  } catch (error) {
    console.error('[DataRequests] Could not load admin requests:', error);
    return res.status(500).json({ error: 'Could not load data requests.' });
  }
});

router.patch('/:id', authenticate, authorizeRoles('admin'), async (req: Request, res: Response) => {
  const { status, resolutionNote } = req.body || {};
  if (!statuses.includes(status) || (resolutionNote !== undefined && typeof resolutionNote !== 'string')) {
    return res.status(400).json({ error: 'Choose a valid status and resolution note.' });
  }
  if (typeof resolutionNote === 'string' && resolutionNote.length > 1000) {
    return res.status(400).json({ error: 'Resolution note must be 1000 characters or fewer.' });
  }
  try {
    const existing = await prisma.customerDataRequest.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Data request not found.' });
    const request = await prisma.customerDataRequest.update({
      where: { id: existing.id },
      data: {
        status,
        resolutionNote: resolutionNote?.trim() || null,
        handledBy: req.user!.name || req.user!.email,
        resolvedAt: status === 'completed' || status === 'rejected' ? new Date() : null
      },
      include: { customer: { select: { id: true, name: true, email: true } } }
    });
    await prisma.securityAuditLog.create({ data: {
      eventType: 'CUSTOMER_DATA_REQUEST_UPDATED', userId: req.user!.id, email: req.user!.email,
      ipAddress: req.ip,
      details: JSON.stringify({ requestId: request.id, requestType: request.requestType,
        previousStatus: existing.status, status, resolutionNote: request.resolutionNote })
    } });
    return res.json({ request });
  } catch (error) {
    console.error('[DataRequests] Could not update request:', error);
    return res.status(500).json({ error: 'Could not update data request.' });
  }
});

export default router;
