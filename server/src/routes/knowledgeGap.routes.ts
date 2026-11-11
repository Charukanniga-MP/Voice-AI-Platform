import { Router, Request, Response } from 'express';
import { prisma } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();

/**
 * 1. GET /api/knowledge-gaps - List knowledge gaps with filters
 */
router.get('/', authenticate, requireRole(['admin', 'agent']), async (req: Request, res: Response) => {
  try {
    const status = (req.query.status as string || 'all').toLowerCase();
    const language = (req.query.language as string || 'all').toLowerCase();
    const topic = (req.query.topic as string || 'all').toLowerCase();
    const search = (req.query.search as string || '').trim().toLowerCase();

    const whereClause: any = {};

    if (status !== 'all') {
      whereClause.status = status;
    }
    if (language !== 'all') {
      whereClause.language = language;
    }
    if (topic !== 'all') {
      whereClause.topic = { contains: topic };
    }
    if (search) {
      whereClause.OR = [
        { question: { contains: search } },
        { topic: { contains: search } }
      ];
    }

    const gaps = await prisma.knowledgeGap.findMany({
      where: whereClause,
      orderBy: [
        { frequency: 'desc' },
        { lastAskedAt: 'desc' }
      ]
    });

    // Compute summary analytics by language and topic
    const allGaps = await prisma.knowledgeGap.findMany();
    const gapsByLanguage: Record<string, number> = { en: 0, ta: 0, te: 0, ml: 0, hi: 0 };
    const gapsByTopic: Record<string, number> = {};
    let totalUnansweredOccurrences = 0;

    for (const g of allGaps) {
      totalUnansweredOccurrences += g.frequency;
      const lang = g.language || 'en';
      gapsByLanguage[lang] = (gapsByLanguage[lang] || 0) + g.frequency;
      gapsByTopic[g.topic] = (gapsByTopic[g.topic] || 0) + 1;
    }

    res.json({
      gaps,
      analytics: {
        totalGaps: allGaps.length,
        openGaps: allGaps.filter(g => g.status === 'open').length,
        totalUnansweredOccurrences,
        gapsByLanguage,
        gapsByTopic
      }
    });
  } catch (err: any) {
    console.error('[KnowledgeGap] Fetch error:', err);
    res.status(500).json({ error: 'Failed to retrieve knowledge gaps.' });
  }
});

/**
 * 2. PUT /api/knowledge-gaps/:id - Update gap status or category
 */
router.put('/:id', authenticate, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const { status, topic } = req.body;
    const gap = await prisma.knowledgeGap.update({
      where: { id: req.params.id },
      data: {
        ...(status ? { status } : {}),
        ...(topic ? { topic } : {})
      }
    });

    res.json({ success: true, gap });
  } catch (err: any) {
    console.error('[KnowledgeGap] Update error:', err);
    res.status(500).json({ error: 'Failed to update knowledge gap.' });
  }
});

/**
 * 3. POST /api/knowledge-gaps/:id/approve-to-kb - Admin approves and creates an official KB entry
 * Strictly enforces that ONLY Admins can publish verified answers into the official Knowledge Base.
 */
router.post('/:id/approve-to-kb', authenticate, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const { title, category, question, answer, content, keywords } = req.body;
    const gapId = req.params.id;

    const gap = await prisma.knowledgeGap.findUnique({
      where: { id: gapId }
    });

    if (!gap) {
      res.status(404).json({ error: 'Knowledge gap not found.' });
      return;
    }

    if (!title || !answer) {
      res.status(400).json({ error: 'Title and answer are required to publish an official Knowledge Base entry.' });
      return;
    }

    const finalContent = (content && content.trim()) || `${title.trim()}\n\n${answer.trim()}`;

    // 1. Create official KnowledgeEntry
    const newKbEntry = await prisma.knowledgeEntry.create({
      data: {
        title: title.trim(),
        category: category || gap.topic || 'general',
        question: (question || gap.question).trim(),
        answer: answer.trim(),
        content: finalContent,
        keywords: keywords ? keywords.trim() : null
      }
    });

    // 2. Mark gap as 'added_to_kb'
    const updatedGap = await prisma.knowledgeGap.update({
      where: { id: gapId },
      data: { status: 'added_to_kb' }
    });

    console.log(`[KnowledgeGap] Admin approved knowledge gap "${gap.question}" into official KB entry ID: ${newKbEntry.id}`);

    res.status(201).json({
      success: true,
      message: 'Official Knowledge Base entry created and gap marked as resolved.',
      kbEntry: newKbEntry,
      gap: updatedGap
    });
  } catch (err: any) {
    console.error('[KnowledgeGap] Approve to KB error:', err);
    res.status(500).json({ error: 'Failed to approve knowledge gap into official Knowledge Base.' });
  }
});

export default router;
