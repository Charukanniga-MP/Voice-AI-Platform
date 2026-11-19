import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { prisma } from '../db.js';
import { authenticate, authorizeRoles } from '../middleware/auth.js';

const router = Router();
const requestTypes = ['export', 'deletion'] as const;
const statuses = ['pending', 'in_progress', 'completed', 'rejected'] as const;

async function getCustomerDeletionContext(customerId: string) {
  const customer = await prisma.user.findUnique({
    where: { id: customerId },
    select: { id: true, name: true, email: true, phone: true }
  });
  if (!customer) return null;

  const [calls, allTickets] = await Promise.all([
    prisma.callRecord.findMany({ where: { customerId }, select: { id: true, callId: true, status: true } }),
    prisma.supportTicket.findMany({ select: { id: true, customerId: true, customerEmail: true } })
  ]);
  const tickets = allTickets.filter(ticket => ticket.customerId === customerId ||
    ticket.customerEmail?.trim().toLowerCase() === customer.email.trim().toLowerCase());
  const callRecordIds = calls.map(call => call.id);
  const callIds = calls.map(call => call.callId);
  const ticketIds = tickets.map(ticket => ticket.id);
  const [transcripts, recordings, followUpTasks, sentimentAnalyses, ticketMessages, knowledgeFeedback, callIntelligence, transferRequests] = await Promise.all([
    callRecordIds.length ? prisma.callTranscript.count({ where: { callRecordId: { in: callRecordIds } } }) : 0,
    callRecordIds.length ? prisma.callRecording.count({ where: { callRecordId: { in: callRecordIds } } }) : 0,
    prisma.followUpTask.count({ where: { OR: [
      { customerId }, ...(callRecordIds.length ? [{ callRecordId: { in: callRecordIds } }] : [])
    ] } }),
    prisma.sentimentAnalysis.count({ where: { OR: [
      { customerId }, ...(callRecordIds.length ? [{ callRecordId: { in: callRecordIds } }] : [])
    ] } }),
    prisma.supportTicketMessage.count({ where: { OR: [
      { senderId: customerId }, ...(ticketIds.length ? [{ ticketId: { in: ticketIds } }] : [])
    ] } }),
    callIds.length ? prisma.knowledgeFeedback.count({ where: { callId: { in: callIds } } }) : 0,
    prisma.callIntelligence.count({ where: { OR: [
      { customerId }, ...(callRecordIds.length ? [{ callRecordId: { in: callRecordIds } }] : [])
    ] } }),
    prisma.callTransferRequest.count({ where: { OR: [
      { customerId }, ...(callRecordIds.length ? [{ callRecordId: { in: callRecordIds } }] : [])
    ] } })
  ]);

  return {
    customer, calls, tickets, callRecordIds, callIds,
    counts: {
      account: 1, calls: calls.length, transcripts, recordings, followUpTasks,
      supportTickets: tickets.length, ticketMessages, sentimentAnalyses, knowledgeFeedback,
      callIntelligence, transferRequests,
      activeCalls: calls.filter(call => ['queued', 'ringing', 'active'].includes(call.status)).length
    }
  };
}

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
        where: { eventType: { in: [
          'CUSTOMER_DATA_REQUEST_CREATED', 'CUSTOMER_DATA_REQUEST_UPDATED',
          'CUSTOMER_DATA_EXPORT_GENERATED', 'CUSTOMER_DATA_DELETION_PREVIEWED', 'CUSTOMER_DATA_DELETION_FULFILLED'
        ] } },
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

router.post('/:id/export', authenticate, authorizeRoles('admin'), async (req: Request, res: Response) => {
  try {
    const request = await prisma.customerDataRequest.findUnique({
      where: { id: req.params.id }, include: { customer: { select: {
        id: true, name: true, email: true, phone: true, preferredLanguage: true, createdAt: true, updatedAt: true
      } } }
    });
    if (!request) return res.status(404).json({ error: 'Data request not found.' });
    if (request.requestType !== 'export') return res.status(400).json({ error: 'This is not a data export request.' });
    if (request.status === 'rejected') return res.status(409).json({ error: 'Rejected requests cannot be fulfilled.' });
    if (!request.customer) return res.status(410).json({ error: 'The customer account has already been deleted.' });

    const customerId = request.customerId!;
    const calls = await prisma.callRecord.findMany({
      where: { customerId }, orderBy: { startTime: 'asc' },
      include: {
        transcripts: { orderBy: { timestamp: 'asc' } },
        conversationAnalysis: true,
        recording: { select: {
          id: true, callId: true, fileName: true, fileSize: true, mimeType: true,
          duration: true, consentStatus: true, recordingStatus: true,
          retentionExpiry: true, createdAt: true, deletedAt: true
        } }
      }
    });
    const callRecordIds = calls.map(call => call.id);
    const [followUpTasks, supportTickets, sentimentAnalyses, callIntelligence, transferRequests] = await Promise.all([
      prisma.followUpTask.findMany({
        where: { OR: [{ customerId }, ...(callRecordIds.length ? [{ callRecordId: { in: callRecordIds } }] : [])] },
        orderBy: { createdAt: 'asc' }
      }),
      prisma.supportTicket.findMany({
        where: { OR: [{ customerId }, { customerEmail: request.customer.email }] },
        orderBy: { createdAt: 'asc' }, include: { messages: { orderBy: { createdAt: 'asc' } } }
      }),
      prisma.sentimentAnalysis.findMany({
        where: { OR: [{ customerId }, ...(callRecordIds.length ? [{ callRecordId: { in: callRecordIds } }] : [])] },
        orderBy: { detectedAt: 'asc' }
      }),
      prisma.callIntelligence.findMany({
        where: { OR: [{ customerId }, ...(callRecordIds.length ? [{ callRecordId: { in: callRecordIds } }] : [])] },
        orderBy: { createdAt: 'asc' }
      }),
      prisma.callTransferRequest.findMany({
        where: { OR: [{ customerId }, ...(callRecordIds.length ? [{ callRecordId: { in: callRecordIds } }] : [])] },
        orderBy: { createdAt: 'asc' }
      })
    ]);
    const callIds = calls.map(call => call.callId);
    const knowledgeFeedback = callIds.length
      ? await prisma.knowledgeFeedback.findMany({ where: { callId: { in: callIds } }, orderBy: { createdAt: 'asc' } })
      : [];
    const exportData = {
      exportVersion: 1,
      generatedAt: new Date().toISOString(),
      account: {
        id: request.customer.id, name: request.customer.name, email: request.customer.email,
        phone: request.customer.phone, preferredLanguage: request.customer.preferredLanguage,
        createdAt: request.customer.createdAt, updatedAt: request.customer.updatedAt
      },
      calls,
      callIntelligence,
      transferRequests,
      followUpTasks,
      supportTickets,
      sentimentAnalyses,
      knowledgeFeedback,
      includedDataNotes: [
        'Passwords, authentication secrets, and server file paths are excluded.',
        'Recording metadata is included; recording audio files are not embedded in this JSON export.'
      ]
    };
    const now = new Date();
    const filename = `customer-data-export-${now.toISOString().replace(/[:.]/g, '-')}.json`;
    const resolutionNote = `JSON data export generated (${calls.length} calls, ${followUpTasks.length} follow-up tasks, ${supportTickets.length} tickets).`;
    await prisma.$transaction([
      prisma.customerDataRequest.update({
        where: { id: request.id },
        data: { status: 'completed', resolutionNote, handledBy: req.user!.name || req.user!.email, resolvedAt: now }
      }),
      prisma.securityAuditLog.create({ data: {
        eventType: 'CUSTOMER_DATA_EXPORT_GENERATED', userId: req.user!.id, email: req.user!.email,
        ipAddress: req.ip,
        details: JSON.stringify({ requestId: request.id, filename, counts: {
          calls: calls.length, followUpTasks: followUpTasks.length,
          supportTickets: supportTickets.length, sentimentAnalyses: sentimentAnalyses.length,
          knowledgeFeedback: knowledgeFeedback.length, callIntelligence: callIntelligence.length,
          transferRequests: transferRequests.length
        } })
      } })
    ]);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(JSON.stringify(exportData, null, 2));
  } catch (error) {
    console.error('[DataRequests] Could not generate export:', error);
    return res.status(500).json({ error: 'Could not generate customer data export.' });
  }
});

router.post('/:id/deletion-preview', authenticate, authorizeRoles('admin'), async (req: Request, res: Response) => {
  try {
    const request = await prisma.customerDataRequest.findUnique({ where: { id: req.params.id } });
    if (!request) return res.status(404).json({ error: 'Data request not found.' });
    if (request.requestType !== 'deletion') return res.status(400).json({ error: 'This is not a data deletion request.' });
    if (request.status === 'completed' || request.status === 'rejected' || !request.customerId) {
      return res.status(409).json({ error: 'This request is no longer eligible for deletion.' });
    }
    const context = await getCustomerDeletionContext(request.customerId);
    if (!context) return res.status(410).json({ error: 'Customer account not found.' });
    if (context.counts.activeCalls > 0) return res.status(409).json({ error: 'End the customer’s active call before deleting account data.' });
    await prisma.securityAuditLog.create({ data: {
      eventType: 'CUSTOMER_DATA_DELETION_PREVIEWED', userId: req.user!.id, email: req.user!.email,
      ipAddress: req.ip,
      details: JSON.stringify({ requestId: request.id, counts: context.counts })
    } });
    return res.json({
      requestId: request.id,
      customer: { name: context.customer.name, email: context.customer.email },
      counts: context.counts,
      confirmationText: 'DELETE'
    });
  } catch (error) {
    console.error('[DataRequests] Could not preview deletion:', error);
    return res.status(500).json({ error: 'Could not prepare deletion preview.' });
  }
});

router.post('/:id/fulfill-deletion', authenticate, authorizeRoles('admin'), async (req: Request, res: Response) => {
  if (req.body?.confirmation !== 'DELETE') {
    return res.status(400).json({ error: 'Type DELETE to confirm permanent customer data deletion.' });
  }
  try {
    const request = await prisma.customerDataRequest.findUnique({ where: { id: req.params.id } });
    if (!request) return res.status(404).json({ error: 'Data request not found.' });
    if (request.requestType !== 'deletion') return res.status(400).json({ error: 'This is not a data deletion request.' });
    if (request.status === 'completed' || request.status === 'rejected' || !request.customerId) {
      return res.status(409).json({ error: 'This request is no longer eligible for deletion.' });
    }
    const context = await getCustomerDeletionContext(request.customerId);
    if (!context) return res.status(410).json({ error: 'Customer account not found.' });
    if (context.counts.activeCalls > 0) return res.status(409).json({ error: 'End the customer’s active call before deleting account data.' });

    const previewLogs = await prisma.securityAuditLog.findMany({
      where: { eventType: 'CUSTOMER_DATA_DELETION_PREVIEWED', userId: req.user!.id },
      orderBy: { createdAt: 'desc' }, take: 100,
      select: { createdAt: true, details: true }
    });
    const validPreview = previewLogs.find(log => {
      if (log.createdAt < request.updatedAt || Date.now() - log.createdAt.getTime() > 15 * 60 * 1000) return false;
      try {
        const details = JSON.parse(log.details || '{}');
        return details.requestId === request.id && JSON.stringify(details.counts) === JSON.stringify(context.counts);
      } catch { return false; }
    });
    if (!validPreview) return res.status(409).json({ error: 'The deletion preview is missing, expired, or no longer matches the customer data. Preview again before confirming.' });

    const recordings = context.callRecordIds.length ? await prisma.callRecording.findMany({
      where: { callRecordId: { in: context.callRecordIds } }, select: { storagePath: true }
    }) : [];
    const recordingRoot = path.resolve(process.cwd(), 'uploads', 'recordings');
    const pathsToRemove = recordings.flatMap(recording => {
      if (!recording.storagePath) return [];
      const resolved = path.resolve(recording.storagePath);
      const relative = path.relative(recordingRoot, resolved);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('A recording path is outside the permitted recording directory; deletion was stopped.');
      }
      return [resolved];
    });
    let audioFilesRemoved = 0;
    for (const filePath of pathsToRemove) {
      if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); audioFilesRemoved += 1; }
    }

    const now = new Date();
    const actor = req.user!.name || req.user!.email;
    await prisma.$transaction(async tx => {
      if (context.callIds.length) {
        await tx.knowledgeFeedback.deleteMany({ where: { callId: { in: context.callIds } } });
      }
      await tx.followUpTask.deleteMany({ where: { customerId: context.customer.id } });
      await tx.callTransferRequest.deleteMany({ where: { customerId: context.customer.id } });
      await tx.callIntelligence.deleteMany({ where: { customerId: context.customer.id } });
      await tx.sentimentAnalysis.deleteMany({ where: { customerId: context.customer.id } });
      await tx.supportTicket.deleteMany({ where: { id: { in: context.tickets.map(ticket => ticket.id) } } });
      await tx.supportTicketMessage.deleteMany({ where: { senderId: context.customer.id } });
      await tx.callRecord.deleteMany({ where: { customerId: context.customer.id } });
      await tx.securityAuditLog.updateMany({
        where: { userId: context.customer.id, eventType: { not: 'CUSTOMER_DATA_REQUEST_CREATED' } },
        data: { userId: null, email: null, details: null }
      });
      await tx.securityAuditLog.updateMany({
        where: { userId: context.customer.id, eventType: 'CUSTOMER_DATA_REQUEST_CREATED' },
        data: { userId: null, email: null }
      });
      await tx.customerDataRequest.update({
        where: { id: request.id },
        data: {
          customerId: null, customerDeleted: true, status: 'completed',
          resolutionNote: 'Customer account and associated data deleted.',
          handledBy: actor, resolvedAt: now
        }
      });
      await tx.user.delete({ where: { id: context.customer.id } });
      await tx.securityAuditLog.create({ data: {
        eventType: 'CUSTOMER_DATA_DELETION_FULFILLED', userId: req.user!.id, email: req.user!.email,
        ipAddress: req.ip,
        details: JSON.stringify({ requestId: request.id, counts: context.counts, audioFilesRemoved })
      } });
    });
    return res.json({ success: true, requestId: request.id, counts: context.counts });
  } catch (error: any) {
    console.error('[DataRequests] Could not fulfill deletion:', error);
    return res.status(500).json({ error: error.message || 'Could not delete customer data.' });
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
    if (existing.status === 'completed') return res.status(409).json({ error: 'Completed requests cannot be changed.' });
    if (status === 'completed') {
      return res.status(409).json({ error: 'Complete this request using its export or deletion fulfillment action.' });
    }
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
