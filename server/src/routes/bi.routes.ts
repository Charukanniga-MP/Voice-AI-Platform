/**
 * KAIRA Voice AI Platform - Business Intelligence Routes
 * Admin-only endpoints for BI metrics, charts data, report generation, and exports.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, authorizeRoles } from '../middleware/auth.js';
import { biService, BIMetrics } from '../services/bi.service.js';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();
const router = Router();

// Enforce authentication & ADMIN role authorization for all BI routes
router.use(authenticate, authorizeRoles('admin'));

/**
 * Helper to compute start and end dates from a period string
 */
function parsePeriodDates(period?: string, startQuery?: string, endQuery?: string): { startDate: Date; endDate: Date; reportType: 'daily' | 'monthly' | 'custom' } {
  const now = new Date();

  if (period === 'today') {
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const e = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { startDate: s, endDate: e, reportType: 'daily' };
  }

  if (period === 'yesterday') {
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0);
    const e = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
    return { startDate: s, endDate: e, reportType: 'daily' };
  }

  if (period === '7days') {
    const s = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    s.setHours(0, 0, 0, 0);
    return { startDate: s, endDate: now, reportType: 'custom' };
  }

  if (period === '30days') {
    const s = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    s.setHours(0, 0, 0, 0);
    return { startDate: s, endDate: now, reportType: 'custom' };
  }

  if (period === 'this_month') {
    const s = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return { startDate: s, endDate: now, reportType: 'monthly' };
  }

  if (period === 'last_month') {
    const s = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    const e = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return { startDate: s, endDate: e, reportType: 'monthly' };
  }

  if (startQuery && endQuery) {
    const s = new Date(startQuery);
    const e = new Date(endQuery);
    if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
      s.setHours(0, 0, 0, 0);
      e.setHours(23, 59, 59, 999);
      return { startDate: s, endDate: e, reportType: 'custom' };
    }
  }

  // Default: Last 30 days
  const s = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  s.setHours(0, 0, 0, 0);
  return { startDate: s, endDate: now, reportType: 'custom' };
}

/**
 * GET /api/admin/bi/overview
 * Comprehensive BI Overview with all 12 KPIs, issue categories, sentiment, and agent stats
 */
router.get('/overview', async (req: Request, res: Response): Promise<void> => {
  try {
    const { period, startDate, endDate } = req.query as { period?: string; startDate?: string; endDate?: string };
    const { startDate: sDate, endDate: eDate, reportType } = parsePeriodDates(period, startDate, endDate);

    const metrics = await biService.calculateMetrics(sDate, eDate, reportType);
    const executiveSummary = biService.generateExecutiveSummary(metrics, reportType);

    res.json({
      success: true,
      period: metrics.period,
      kpis: metrics.kpis,
      sentiment: metrics.sentiment,
      issues: metrics.issues,
      agentPerformance: metrics.agentPerformance,
      hourlyVolume: metrics.hourlyVolume,
      dailyTrends: metrics.dailyTrends,
      peakCallHours: metrics.peakCallHours,
      comparisons: metrics.comparisons,
      executiveSummary
    });
  } catch (error: any) {
    console.error('Error fetching BI overview:', error);
    res.status(500).json({ error: 'Failed to calculate Business Intelligence overview.' });
  }
});

/**
 * GET /api/admin/bi/call-statistics
 * Call volume, completion rates, hourly distribution, peak hours
 */
router.get('/call-statistics', async (req: Request, res: Response): Promise<void> => {
  try {
    const { period, startDate, endDate } = req.query as { period?: string; startDate?: string; endDate?: string };
    const { startDate: sDate, endDate: eDate, reportType } = parsePeriodDates(period, startDate, endDate);

    const metrics = await biService.calculateMetrics(sDate, eDate, reportType);
    res.json({
      success: true,
      period: metrics.period,
      kpis: {
        totalCalls: metrics.kpis.totalCalls,
        completedCalls: metrics.kpis.completedCalls,
        missedCalls: metrics.kpis.missedCalls,
        transferredCalls: metrics.kpis.transferredCalls,
        averageDurationSeconds: metrics.kpis.averageDurationSeconds,
        averageDurationFormatted: metrics.kpis.averageDurationFormatted,
        uniqueCustomers: metrics.kpis.uniqueCustomers,
        peakCallHours: metrics.peakCallHours
      },
      hourlyVolume: metrics.hourlyVolume,
      dailyTrends: metrics.dailyTrends
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch call statistics.' });
  }
});

/**
 * GET /api/admin/bi/sentiment-statistics
 * Sentiment counts, percentages, and dissatisfaction reasons
 */
router.get('/sentiment-statistics', async (req: Request, res: Response): Promise<void> => {
  try {
    const { period, startDate, endDate } = req.query as { period?: string; startDate?: string; endDate?: string };
    const { startDate: sDate, endDate: eDate, reportType } = parsePeriodDates(period, startDate, endDate);

    const metrics = await biService.calculateMetrics(sDate, eDate, reportType);
    res.json({
      success: true,
      period: metrics.period,
      sentiment: metrics.sentiment,
      kpis: {
        positivePct: metrics.kpis.positiveSentimentPct,
        negativePct: metrics.kpis.negativeSentimentPct,
        neutralPct: metrics.kpis.neutralSentimentPct,
        frustratedPct: metrics.kpis.frustratedSentimentPct,
        callsRequiringAssistance: metrics.kpis.totalCallsRequiringAssistance
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch sentiment statistics.' });
  }
});

/**
 * GET /api/admin/bi/customer-issues
 * Identified customer issues breakdown
 */
router.get('/customer-issues', async (req: Request, res: Response): Promise<void> => {
  try {
    const { period, startDate, endDate } = req.query as { period?: string; startDate?: string; endDate?: string };
    const { startDate: sDate, endDate: eDate, reportType } = parsePeriodDates(period, startDate, endDate);

    const metrics = await biService.calculateMetrics(sDate, eDate, reportType);
    res.json({
      success: true,
      period: metrics.period,
      issues: metrics.issues
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch customer issues analysis.' });
  }
});

/**
 * GET /api/admin/bi/agent-performance
 * Support agent performance metrics and call handling summaries
 */
router.get('/agent-performance', async (req: Request, res: Response): Promise<void> => {
  try {
    const { period, startDate, endDate } = req.query as { period?: string; startDate?: string; endDate?: string };
    const { startDate: sDate, endDate: eDate, reportType } = parsePeriodDates(period, startDate, endDate);

    const metrics = await biService.calculateMetrics(sDate, eDate, reportType);
    res.json({
      success: true,
      period: metrics.period,
      totalActiveAgents: metrics.kpis.totalActiveAgents,
      agentPerformance: metrics.agentPerformance
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch agent performance metrics.' });
  }
});

/**
 * GET /api/admin/bi/trends
 * Daily volume and previous-month/period comparisons
 */
router.get('/trends', async (req: Request, res: Response): Promise<void> => {
  try {
    const { period, startDate, endDate } = req.query as { period?: string; startDate?: string; endDate?: string };
    const { startDate: sDate, endDate: eDate, reportType } = parsePeriodDates(period, startDate, endDate);

    const metrics = await biService.calculateMetrics(sDate, eDate, reportType);
    res.json({
      success: true,
      period: metrics.period,
      dailyTrends: metrics.dailyTrends,
      comparisons: metrics.comparisons
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch trends data.' });
  }
});

const generateReportSchema = z.object({
  reportType: z.enum(['daily', 'monthly', 'custom']),
  targetDate: z.string().optional(),
  year: z.number().int().optional(),
  month: z.number().int().min(1).max(12).optional(), // 1-12
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  title: z.string().optional()
});

/**
 * POST /api/admin/bi/reports/generate
 * Manually generate a Daily, Monthly, or Custom Report
 */
router.post('/reports/generate', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = generateReportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid report parameters', details: parsed.error.format() });
      return;
    }

    const { reportType, targetDate, year, month, startDate, endDate, title } = parsed.data;
    const adminUser = req.user?.name || req.user?.email || 'admin';

    let result;
    if (reportType === 'daily') {
      const d = targetDate ? new Date(targetDate) : undefined;
      result = await biService.generateDailyReport(d, adminUser);
    } else if (reportType === 'monthly') {
      const m = month !== undefined ? month - 1 : undefined; // Convert 1-12 to 0-11
      result = await biService.generateMonthlyReport(year, m, adminUser);
    } else {
      if (!startDate || !endDate) {
        res.status(400).json({ error: 'startDate and endDate are required for custom reports.' });
        return;
      }
      const s = new Date(startDate);
      const e = new Date(endDate);
      s.setHours(0, 0, 0, 0);
      e.setHours(23, 59, 59, 999);
      result = await biService.generateCustomReport(s, e, title, adminUser);
    }

    res.json({
      success: true,
      isDuplicate: result.isDuplicate,
      message: result.message,
      report: result.report
    });
  } catch (error: any) {
    console.error('Error generating report:', error);
    res.status(500).json({ error: 'Failed to generate Business Intelligence report.' });
  }
});

/**
 * GET /api/admin/bi/reports
 * Returns list of historical reports with filtering and search
 */
router.get('/reports', async (req: Request, res: Response): Promise<void> => {
  try {
    const { reportType, search } = req.query as { reportType?: string; search?: string };

    const where: any = {};
    if (reportType && reportType !== 'all') {
      where.reportType = reportType;
    }
    if (search && search.trim()) {
      where.OR = [
        { title: { contains: search.trim() } },
        { generatedBy: { contains: search.trim() } }
      ];
    }

    const reports = await prisma.businessReport.findMany({
      where,
      orderBy: { generatedAt: 'desc' },
      take: 50
    });

    res.json({
      success: true,
      count: reports.length,
      reports: reports.map((r) => ({
        id: r.id,
        title: r.title,
        reportType: r.reportType,
        startDate: r.startDate.toISOString().split('T')[0],
        endDate: r.endDate.toISOString().split('T')[0],
        generatedAt: r.generatedAt,
        generatedBy: r.generatedBy,
        status: r.status,
        hasPdf: !!r.pdfPath,
        hasCsv: !!r.csvPath
      }))
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch report history.' });
  }
});

/**
 * GET /api/admin/bi/reports/:id
 * Fetches single report with parsed JSON metrics
 */
router.get('/reports/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const report = await prisma.businessReport.findUnique({
      where: { id }
    });

    if (!report) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }

    let parsedData = null;
    try {
      parsedData = JSON.parse(report.reportData);
    } catch {
      parsedData = null;
    }

    res.json({
      success: true,
      report: {
        id: report.id,
        title: report.title,
        reportType: report.reportType,
        startDate: report.startDate.toISOString().split('T')[0],
        endDate: report.endDate.toISOString().split('T')[0],
        generatedAt: report.generatedAt,
        generatedBy: report.generatedBy,
        status: report.status,
        executiveSummary: report.executiveSummary,
        data: parsedData,
        hasPdf: !!report.pdfPath,
        hasCsv: !!report.csvPath
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch report details.' });
  }
});

/**
 * GET /api/admin/bi/reports/:id/pdf
 * Downloads report PDF
 */
router.get('/reports/:id/pdf', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const report = await prisma.businessReport.findUnique({
      where: { id }
    });

    if (!report || !report.pdfPath || !fs.existsSync(report.pdfPath)) {
      res.status(404).json({ error: 'PDF report not found.' });
      return;
    }

    const safeFilename = path.basename(report.pdfPath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.sendFile(report.pdfPath);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to download PDF report.' });
  }
});

/**
 * GET /api/admin/bi/reports/:id/csv
 * Downloads report CSV
 */
router.get('/reports/:id/csv', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const report = await prisma.businessReport.findUnique({
      where: { id }
    });

    if (!report || !report.csvPath || !fs.existsSync(report.csvPath)) {
      res.status(404).json({ error: 'CSV report not found.' });
      return;
    }

    const safeFilename = path.basename(report.csvPath);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.sendFile(report.csvPath);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to download CSV report.' });
  }
});

export default router;
