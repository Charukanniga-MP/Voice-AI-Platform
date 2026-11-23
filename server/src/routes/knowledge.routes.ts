import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { prisma } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate, knowledgeEntrySchema } from '../middleware/validation.js';
import { processUploadedDocument, reindexDocument, deleteDocument } from '../services/documentProcessor.js';
import { translationService } from '../services/translation.js';
import { kbCleanupService } from '../services/kbCleanup.service.js';

const router = Router();

// Ensure upload directory exists
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage configuration with sanitized filenames to prevent directory traversal
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${uniqueSuffix}-${safeName}`);
  }
});

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.docx']);
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword'
]);

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return cb(new Error('Invalid file type. Only approved PDF and DOCX documents are accepted for Knowledge Base indexing.'));
    }
    if (file.mimetype && !ALLOWED_MIME_TYPES.has(file.mimetype) && file.mimetype !== 'application/octet-stream') {
      return cb(new Error('Invalid file MIME type. Only approved PDF and DOCX documents are accepted.'));
    }
    cb(null, true);
  }
});

// 1. List & Search Knowledge Entries (Admin & Agent can read)
router.get('/', authenticate, requireRole(['admin', 'agent']), async (req: Request, res: Response) => {
  try {
    const { search, category } = req.query as { search?: string; category?: string };

    const where: any = {};
    if (category && category !== 'all') {
      where.category = category;
    }

    if (search) {
      where.OR = [
        { title: { contains: search } },
        { question: { contains: search } },
        { answer: { contains: search } },
        { content: { contains: search } },
        { keywords: { contains: search } }
      ];
    }

    const entries = await prisma.knowledgeEntry.findMany({
      where,
      include: {
        document: {
          select: { id: true, fileName: true, title: true }
        }
      },
      orderBy: { updatedAt: 'desc' }
    });

    // Deduplicate in memory by title + question
    const seenEntries = new Set<string>();
    const uniqueEntries = [];
    for (const e of entries) {
      const key = `${e.title.trim().toLowerCase()}:::${(e.question || '').trim().toLowerCase()}`;
      if (!seenEntries.has(key)) {
        seenEntries.add(key);
        uniqueEntries.push(e);
      }
    }

    res.json({ entries: uniqueEntries });
  } catch (err: any) {
    console.error('[Knowledge] Fetch error:', err);
    res.status(500).json({ error: 'Failed to retrieve knowledge entries.' });
  }
});

// 2. List Uploaded Documents (Admin only)
router.get('/documents', authenticate, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const documents = await prisma.knowledgeDocument.findMany({
      include: {
        _count: {
          select: { entries: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ documents });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve documents.' });
  }
});

// 3. Add Knowledge Entry (Admin only)
router.post('/', authenticate, requireRole(['admin']), validate(knowledgeEntrySchema), async (req: Request, res: Response) => {
  try {
    const { title, category, question, answer, content, keywords } = req.body;

    if (!title || !content) {
      res.status(400).json({ error: 'Title and content are required.' });
      return;
    }

    const cleanTitle = title.trim();
    const cleanQuestion = question ? question.trim() : null;

    // Duplicate check: avoid adding entries with identical title or question
    const existing = await prisma.knowledgeEntry.findFirst({
      where: {
        OR: [
          { title: cleanTitle },
          ...(cleanQuestion ? [{ question: cleanQuestion }] : [])
        ]
      }
    });

    if (existing) {
      res.status(400).json({ error: `A Knowledge Base entry with title "${cleanTitle}" already exists.` });
      return;
    }

    const entry = await prisma.knowledgeEntry.create({
      data: {
        title: cleanTitle,
        category: category || 'general',
        question: cleanQuestion,
        answer: answer ? answer.trim() : null,
        content: content.trim(),
        keywords: keywords ? keywords.trim() : null
      }
    });

    res.status(201).json({
      message: 'Knowledge entry created successfully',
      entry
    });
  } catch (err: any) {
    console.error('[Knowledge] Create error:', err);
    res.status(500).json({ error: 'Failed to create knowledge entry.' });
  }
});

// 4. Update Knowledge Entry (Admin only)
router.put('/:id', authenticate, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const { title, category, question, answer, content, keywords } = req.body;

    const existing = await prisma.knowledgeEntry.findUnique({
      where: { id: req.params.id }
    });

    if (!existing) {
      res.status(404).json({ error: 'Knowledge entry not found.' });
      return;
    }

    const updated = await prisma.knowledgeEntry.update({
      where: { id: req.params.id },
      data: {
        title: title ? title.trim() : existing.title,
        category: category || existing.category,
        question: question !== undefined ? question?.trim() : existing.question,
        answer: answer !== undefined ? answer?.trim() : existing.answer,
        content: content ? content.trim() : existing.content,
        keywords: keywords !== undefined ? keywords?.trim() : existing.keywords
      }
    });

    res.json({
      message: 'Knowledge entry updated successfully',
      entry: updated
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update knowledge entry.' });
  }
});

// 5. Delete Knowledge Entry (Admin only)
router.delete('/:id', authenticate, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const existing = await prisma.knowledgeEntry.findUnique({
      where: { id: req.params.id }
    });

    if (!existing) {
      res.status(404).json({ error: 'Knowledge entry not found.' });
      return;
    }

    await prisma.knowledgeEntry.delete({
      where: { id: req.params.id }
    });

    res.json({ message: 'Knowledge entry deleted successfully.' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete knowledge entry.' });
  }
});

// 6. Upload PDF / DOCX Document (Admin only)
router.post('/upload', authenticate, requireRole(['admin']), upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No document file uploaded.' });
      return;
    }

    const file = req.file;
    const title = req.body.title || file.originalname;

    // Create document record with "processing" status
    const doc = await prisma.knowledgeDocument.create({
      data: {
        title: title.trim(),
        fileName: file.filename || file.originalname,
        fileType: file.mimetype,
        fileSize: file.size,
        status: 'processing',
        extractedText: ''
      }
    });

    // Process document synchronously for immediate feedback
    const processResult = await processUploadedDocument(doc.id, file.path, file.mimetype, file.originalname);

    const updatedDoc = await prisma.knowledgeDocument.findUnique({
      where: { id: doc.id },
      include: { _count: { select: { entries: true } } }
    });

    if (!processResult.success) {
      if (processResult.isDuplicate) {
        res.status(409).json({
          error: processResult.error || 'Duplicate document detected.',
          isDuplicate: true,
          document: updatedDoc
        });
        return;
      }
      res.status(422).json({
        error: processResult.error || 'Document processing failed.',
        document: updatedDoc
      });
      return;
    }

    res.status(201).json({
      message: 'Document successfully uploaded and indexed into Knowledge Base.',
      entryCount: processResult.entryCount,
      document: updatedDoc
    });
  } catch (err: any) {
    console.error('[Knowledge] Upload error:', err);
    res.status(500).json({ error: 'Failed to process document upload.' });
  }
});

// 7. Delete Document (Admin only)
router.delete('/documents/:id', authenticate, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    await deleteDocument(req.params.id);
    res.json({ message: 'Document and its extracted knowledge entries removed.' });
  } catch (err: any) {
    console.error('[Knowledge] Delete error:', err);
    res.status(500).json({ error: err.message || 'Failed to delete document.' });
  }
});

// 7b. Re-index an existing document (Admin only)
router.post('/documents/:id/reindex', authenticate, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const result = await reindexDocument(req.params.id);
    if (!result.success) {
      res.status(400).json({ error: result.error || 'Reindexing failed' });
      return;
    }
    const updated = await prisma.knowledgeDocument.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { entries: true } } }
    });
    res.json({ message: 'Document successfully re-indexed.', document: updated });
  } catch (err: any) {
    console.error('[Knowledge] Reindex error:', err);
    res.status(500).json({ error: err.message || 'Failed to reindex document.' });
  }
});

// 7c. Document Preview & Sample Chunks (Admin & Agent)
router.get('/documents/:id/preview', authenticate, requireRole(['admin', 'agent']), async (req: Request, res: Response) => {
  try {
    const doc = await prisma.knowledgeDocument.findUnique({
      where: { id: req.params.id },
      include: {
        entries: {
          take: 15,
          select: { id: true, title: true, section: true, pageNumber: true, question: true, answer: true, category: true }
        }
      }
    });
    if (!doc) {
      res.status(404).json({ error: 'Document not found.' });
      return;
    }
    res.json({ document: doc });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to load document preview.' });
  }
});

// 7d. Query Agent Copilot directly (Admin & Agent)
router.post('/copilot/query', authenticate, requireRole(['admin', 'agent']), async (req: Request, res: Response) => {
  try {
    const { query, language, callHistory, customerId } = req.body;
    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'Query is required.' });
      return;
    }
    let customerContext;
    if (customerId) {
      const cust = await prisma.user.findUnique({
        where: { id: customerId }
      });
      if (cust) {
        const tickets = await prisma.supportTicket.findMany({
          where: { customerId: cust.id },
          take: 3,
          orderBy: { createdAt: 'desc' }
        });
        customerContext = {
          customerId: cust.id,
          customerName: cust.name,
          customerEmail: cust.email,
          customerPhone: cust.phone,
          tickets
        };
      }
    }
    const result = await translationService.getCopilotSuggestion(query, language || 'en', callHistory || [], customerContext);
    res.json(result);
  } catch (err: any) {
    console.error('[Knowledge] Copilot query error:', err);
    res.status(500).json({ error: 'Failed to process Copilot query.' });
  }
});

// 7e. Record Agent Copilot Feedback (Admin & Agent)
router.post('/feedback', authenticate, requireRole(['admin', 'agent']), async (req: Request, res: Response) => {
  try {
    const { entryId, callId, query, suggestedAnswer, isUseful, feedbackNotes } = req.body;
    if (!query || !suggestedAnswer || isUseful === undefined) {
      res.status(400).json({ error: 'Query, suggestedAnswer, and isUseful are required.' });
      return;
    }
    const feedback = await prisma.knowledgeFeedback.create({
      data: {
        entryId: entryId || null,
        callId: callId || null,
        agentId: req.user!.id,
        query: String(query),
        suggestedAnswer: String(suggestedAnswer),
        isUseful: Boolean(isUseful),
        feedbackNotes: feedbackNotes ? String(feedbackNotes).slice(0, 500) : null
      }
    });
    res.status(201).json({ message: 'Feedback recorded successfully.', feedback });
  } catch (err: any) {
    console.error('[Knowledge] Feedback error:', err);
    res.status(500).json({ error: 'Failed to record feedback.' });
  }
});

// 7f. Get Knowledge Feedback for Admin & Agent Review
router.get('/feedback', authenticate, requireRole(['admin', 'agent']), async (req: Request, res: Response) => {
  try {
    const feedbackList = await prisma.knowledgeFeedback.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    const totalFeedback = feedbackList.length;
    const totalHelpful = feedbackList.filter(f => f.isUseful).length;
    const totalUnhelpful = feedbackList.filter(f => !f.isUseful).length;
    const helpfulPercentage = totalFeedback > 0 ? Math.round((totalHelpful / totalFeedback) * 100) : 100;

    res.json({
      success: true,
      feedbackList,
      totalFeedback,
      totalHelpful,
      totalUnhelpful,
      helpfulPercentage
    });
  } catch (err: any) {
    console.error('[Knowledge] Feedback fetch error:', err);
    res.status(500).json({ error: 'Failed to retrieve knowledge feedback records.' });
  }
});

// 8. Secure Authenticated Document Download (Admin & Agent)
router.get('/documents/:id/download', authenticate, requireRole(['admin', 'agent']), async (req: Request, res: Response) => {
  try {
    const doc = await prisma.knowledgeDocument.findUnique({
      where: { id: req.params.id }
    });

    if (!doc) {
      res.status(404).json({ error: 'Document record not found.' });
      return;
    }

    // Sanitize filename to prevent directory traversal
    const safeBaseName = path.basename(doc.fileName);
    const resolvedPath = path.resolve(uploadDir, safeBaseName);

    // Verify path remains strictly inside uploadDir
    if (!resolvedPath.startsWith(uploadDir)) {
      res.status(403).json({ error: 'Access denied: Path traversal detected.' });
      return;
    }

    if (!fs.existsSync(resolvedPath)) {
      res.status(404).json({ error: 'Document file not found on disk.' });
      return;
    }

    res.setHeader('Content-Type', doc.fileType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.title || doc.fileName)}"`);
    res.sendFile(resolvedPath);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to access document file.' });
  }
});

// 9. Authenticated direct file access by filename (strictly prevents directory traversal)
router.get('/file/:filename', authenticate, requireRole(['admin', 'agent']), async (req: Request, res: Response) => {
  try {
    const requestedFile = req.params.filename;
    // Strip directory separators to prevent traversal
    const safeBaseName = path.basename(requestedFile);
    const resolvedPath = path.resolve(uploadDir, safeBaseName);

    if (!resolvedPath.startsWith(uploadDir)) {
      res.status(403).json({ error: 'Access denied: Invalid file path.' });
      return;
    }

    if (!fs.existsSync(resolvedPath)) {
      res.status(404).json({ error: 'Requested file not found.' });
      return;
    }

    res.sendFile(resolvedPath);
  } catch (err: any) {
    res.status(500).json({ error: 'Error retrieving requested file.' });
  }
});

// 10. Scan Knowledge Base for duplicate PDFs (Dry-run report, Admin only)
router.get('/cleanup/scan', authenticate, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const report = await kbCleanupService.generateDuplicateReport();
    res.json({ success: true, report });
  } catch (err: any) {
    console.error('[Knowledge] Duplicate scan error:', err);
    res.status(500).json({ error: 'Failed to scan Knowledge Base for duplicates.' });
  }
});

// 11. Execute safe, reversible duplicate cleanup (Admin only)
router.post('/cleanup/execute', authenticate, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const report = await kbCleanupService.executeSafeCleanup();
    res.json({ success: true, report });
  } catch (err: any) {
    console.error('[Knowledge] Safe cleanup error:', err);
    res.status(500).json({ error: 'Failed to execute safe duplicate cleanup.' });
  }
});

export default router;

