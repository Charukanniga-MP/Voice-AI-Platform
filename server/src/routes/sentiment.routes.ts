import { Router, Request, Response } from 'express';
import { prisma } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { sentimentService } from '../services/sentiment.js';
import { z } from 'zod';

const router = Router();

// Zod schemas for query and body validation
const analyticsQuerySchema = z.object({
  period: z.enum(['today', '7days', '30days', 'all', 'custom']).optional().default('all'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  category: z.enum(['ALL', 'POSITIVE', 'NEGATIVE', 'NEUTRAL', 'FRUSTRATED']).optional().default('ALL')
});

const overrideBodySchema = z.object({
  status: z.enum(['accepted', 'dismissed', 'pending'])
});

const testAnalyzeSchema = z.object({
  text: z.string().min(1, 'Text to analyze is required'),
  language: z.string().optional().default('en')
});

/**
 * 1. GET /api/sentiment/analytics
 * Retrieves real database sentiment statistics, category distributions, assistance counts,
 * and trend data for the Admin Dashboard.
 * Access: Admin and Support Agent only. Customers receive HTTP 403.
 */
router.get(
  '/analytics',
  authenticate,
  requireRole(['admin', 'agent']),
  async (req: Request, res: Response) => {
    try {
      const parsed = analyticsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
      }

      const { period, startDate, endDate, category } = parsed.data;

      // Construct date filter
      let dateFilter: { gte?: Date; lte?: Date } | undefined = undefined;
      const now = new Date();

      if (period === 'today') {
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        dateFilter = { gte: startOfDay };
      } else if (period === '7days') {
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        dateFilter = { gte: sevenDaysAgo };
      } else if (period === '30days') {
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        dateFilter = { gte: thirtyDaysAgo };
      } else if (period === 'custom' && startDate && endDate) {
        dateFilter = {
          gte: new Date(startDate),
          lte: new Date(endDate)
        };
      }

      // Base query filter for CallRecord
      const whereClause: any = {};
      if (dateFilter) {
        whereClause.createdAt = dateFilter;
      }
      if (category !== 'ALL') {
        whereClause.overallSentiment = category;
      }

      // Query real DB records
      const [
        totalAnalyzedCalls,
        positiveCalls,
        negativeCalls,
        neutralCalls,
        frustratedCalls,
        assistanceCalls,
        recentAnalyzedList,
        allCallRecordsWithSentiment
      ] = await Promise.all([
        prisma.callRecord.count({
          where: {
            ...whereClause,
            overallSentiment: { not: null }
          }
        }),
        prisma.callRecord.count({
          where: {
            ...whereClause,
            overallSentiment: 'POSITIVE'
          }
        }),
        prisma.callRecord.count({
          where: {
            ...whereClause,
            overallSentiment: 'NEGATIVE'
          }
        }),
        prisma.callRecord.count({
          where: {
            ...whereClause,
            overallSentiment: 'NEUTRAL'
          }
        }),
        prisma.callRecord.count({
          where: {
            ...whereClause,
            overallSentiment: 'FRUSTRATED'
          }
        }),
        prisma.callRecord.count({
          where: {
            ...whereClause,
            requiresAssistance: true
          }
        }),
        prisma.callRecord.findMany({
          where: {
            ...whereClause,
            overallSentiment: { not: null }
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            callId: true,
            customerName: true,
            customerPhone: true,
            overallSentiment: true,
            sentimentScore: true,
            requiresAssistance: true,
            assistanceReason: true,
            assistanceStatus: true,
            language: true,
            duration: true,
            createdAt: true
          }
        }),
        prisma.callRecord.findMany({
          where: {
            ...whereClause,
            overallSentiment: { not: null }
          },
          select: {
            overallSentiment: true,
            createdAt: true
          },
          orderBy: { createdAt: 'asc' }
        })
      ]);

      // Calculate percentage distribution
      const total = totalAnalyzedCalls || 1; // Prevent division by zero
      const positivePct = Math.round((positiveCalls / total) * 100);
      const negativePct = Math.round((negativeCalls / total) * 100);
      const neutralPct = Math.round((neutralCalls / total) * 100);
      const frustratedPct = Math.round((frustratedCalls / total) * 100);

      // Build daily trend buckets for chart visualization
      const dailyTrendMap = new Map<string, { date: string; positive: number; negative: number; neutral: number; frustrated: number }>();
      allCallRecordsWithSentiment.forEach(rec => {
        const dateKey = rec.createdAt.toISOString().slice(0, 10);
        if (!dailyTrendMap.has(dateKey)) {
          dailyTrendMap.set(dateKey, { date: dateKey, positive: 0, negative: 0, neutral: 0, frustrated: 0 });
        }
        const item = dailyTrendMap.get(dateKey)!;
        const sent = rec.overallSentiment;
        if (sent === 'POSITIVE') item.positive += 1;
        else if (sent === 'NEGATIVE') item.negative += 1;
        else if (sent === 'FRUSTRATED') item.frustrated += 1;
        else item.neutral += 1;
      });

      const dailyTrend = Array.from(dailyTrendMap.values()).slice(-14);

      res.json({
        totalAnalyzed: totalAnalyzedCalls,
        counts: {
          positive: positiveCalls,
          negative: negativeCalls,
          neutral: neutralCalls,
          frustrated: frustratedCalls
        },
        percentages: {
          positive: positivePct,
          negative: negativePct,
          neutral: neutralPct,
          frustrated: frustratedPct
        },
        requiresHumanAssistance: assistanceCalls,
        recentCalls: recentAnalyzedList,
        dailyTrend,
        filterApplied: {
          period,
          category
        }
      });
    } catch (err) {
      console.error('[SentimentRoutes] Analytics error:', err);
      res.status(500).json({ error: 'Failed to retrieve sentiment analytics.' });
    }
  }
);

/**
 * 2. GET /api/sentiment/calls/:callId
 * Get historical sentiment updates and final summary for a specific call.
 */
router.get(
  '/calls/:callId',
  authenticate,
  requireRole(['admin', 'agent']),
  async (req: Request, res: Response) => {
    try {
      const { callId } = req.params;
      const call = await prisma.callRecord.findUnique({
        where: { callId },
        include: {
          sentimentRecords: {
            orderBy: { detectedAt: 'asc' }
          }
        }
      });

      if (!call) {
        return res.status(404).json({ error: 'Call record not found.' });
      }

      res.json({
        callId: call.callId,
        customerName: call.customerName,
        overallSentiment: call.overallSentiment,
        sentimentScore: call.sentimentScore,
        requiresAssistance: call.requiresAssistance,
        assistanceReason: call.assistanceReason,
        assistanceStatus: call.assistanceStatus,
        sentimentRecords: call.sentimentRecords
      });
    } catch (err) {
      console.error('[SentimentRoutes] Call sentiment error:', err);
      res.status(500).json({ error: 'Failed to retrieve call sentiment details.' });
    }
  }
);

/**
 * 3. POST /api/sentiment/calls/:callId/override
 * Manual agent/admin override or acknowledgment of human assistance recommendation.
 */
router.post(
  '/calls/:callId/override',
  authenticate,
  requireRole(['admin', 'agent']),
  async (req: Request, res: Response) => {
    try {
      const { callId } = req.params;
      const parsed = overrideBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid override status', details: parsed.error.issues });
      }

      const { status } = parsed.data;
      const success = await sentimentService.overrideAssistance(callId, status, req.user?.id);

      if (!success) {
        return res.status(404).json({ error: 'Call record not found or could not be updated.' });
      }

      res.json({
        message: `Human assistance recommendation marked as ${status}.`,
        callId,
        status
      });
    } catch (err) {
      console.error('[SentimentRoutes] Override error:', err);
      res.status(500).json({ error: 'Failed to update assistance status.' });
    }
  }
);

/**
 * 4. POST /api/sentiment/analyze
 * Direct test/utility endpoint to analyze an utterance and return its classification.
 */
router.post(
  '/analyze',
  authenticate,
  requireRole(['admin', 'agent']),
  async (req: Request, res: Response) => {
    try {
      const parsed = testAnalyzeSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
      }

      const { text, language } = parsed.data;
      const result = sentimentService.analyzeText(text, language);

      res.json(result);
    } catch (err) {
      console.error('[SentimentRoutes] Analyze error:', err);
      res.status(500).json({ error: 'Failed to analyze text.' });
    }
  }
);

export default router;

