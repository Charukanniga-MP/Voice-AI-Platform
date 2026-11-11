import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { prisma } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { processUploadedDocument } from '../services/documentProcessor.js';

const router = Router();

// Ensure upload directory exists
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_'));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.pdf' || ext === '.docx' || ext === '.doc' || ext === '.txt') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, DOCX, and TXT documents are supported.'));
    }
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
router.post('/', authenticate, requireRole(['admin']), async (req: Request, res: Response) => {
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

    // Process asynchronously so response is fast, but user can track status
    processUploadedDocument(doc.id, file.path, file.mimetype, file.originalname);

    res.status(202).json({
      message: 'Document uploaded and processing queued.',
      document: doc
    });
  } catch (err: any) {
    console.error('[Knowledge] Upload error:', err);
    res.status(500).json({ error: 'Failed to process document upload.' });
  }
});

// 7. Delete Document (Admin only)
router.delete('/documents/:id', authenticate, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const doc = await prisma.knowledgeDocument.findUnique({
      where: { id: req.params.id }
    });

    if (!doc) {
      res.status(404).json({ error: 'Document not found.' });
      return;
    }

    // Delete associated entries first (cascade)
    await prisma.knowledgeEntry.deleteMany({
      where: { documentId: doc.id }
    });

    await prisma.knowledgeDocument.delete({
      where: { id: doc.id }
    });

    // Safely remove file from disk if present
    const safeBaseName = path.basename(doc.fileName);
    const resolvedPath = path.resolve(uploadDir, safeBaseName);
    if (resolvedPath.startsWith(uploadDir) && fs.existsSync(resolvedPath)) {
      try {
        await fs.promises.unlink(resolvedPath);
      } catch (e) {
        console.warn(`[Knowledge] Could not delete disk file ${resolvedPath}:`, e);
      }
    }

    res.json({ message: 'Document and its extracted knowledge entries removed.' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete document.' });
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

export default router;

