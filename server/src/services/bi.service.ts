/**
 * KAIRA Voice AI Platform - Business Intelligence Service
 * Aggregates actual SQLite database records into daily/monthly/custom BI reports,
 * calculates KPIs, analyzes sentiment and customer issues, tracks agent performance,
 * prevents duplicates, generates CSV and PDF reports, and provides executive insights.
 */

import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { generateBiPdfDocument, saveReportPdf, ReportPdfData } from './pdfGenerator.js';

const prisma = new PrismaClient();

export interface IssueCategoryStat {
  category: string;
  count: number;
  percentage: number;
}

export interface AgentPerformanceStat {
  agentId: string;
  name: string;
  email: string;
  role: string;
  status: string;
  callsHandled: number;
  completed: number;
  transferred: number;
  missed: number;
  avgDurationSeconds: number;
  avgDurationFormatted: string;
  sentimentDistribution: {
    positive: number;
    neutral: number;
    negative: number;
    frustrated: number;
  };
}

export interface HourlyVolumeStat {
  hour: number;
  label: string;
  total: number;
  completed: number;
  missed: number;
  transferred: number;
}

export interface DailyTrendStat {
  date: string;
  label: string;
  totalCalls: number;
  completed: number;
  missed: number;
  transferred: number;
  avgDurationSeconds: number;
}

export interface MetricComparison {
  current: number;
  previous: number;
  changePct: number;
  isPositiveChange: boolean;
  comparisonAvailable: boolean;
}

export interface BIMetrics {
  period: {
    startDate: string;
    endDate: string;
    reportType: 'daily' | 'monthly' | 'custom';
    daysCovered: number;
  };
  kpis: {
    totalCalls: number;
    completedCalls: number;
    missedCalls: number;
    transferredCalls: number;
    rejectedCalls: number;
    averageDurationSeconds: number;
    averageDurationFormatted: string;
    totalDurationSeconds: number;
    uniqueCustomers: number;
    positiveSentimentPct: number;
    negativeSentimentPct: number;
    neutralSentimentPct: number;
    frustratedSentimentPct: number;
    totalCallsRequiringAssistance: number;
    totalActiveAgents: number;
  };
  sentiment: {
    positiveCount: number;
    neutralCount: number;
    negativeCount: number;
    frustratedCount: number;
    totalAnalyzed: number;
    callsRequiringAssistance: number;
    topDissatisfactionReasons: Array<{ reason: string; count: number }>;
  };
  issues: IssueCategoryStat[];
  agentPerformance: AgentPerformanceStat[];
  hourlyVolume: HourlyVolumeStat[];
  dailyTrends: DailyTrendStat[];
  peakCallHours: string;
  comparisons?: {
    totalCalls: MetricComparison;
    completedCalls: MetricComparison;
    averageDuration: MetricComparison;
    uniqueCustomers: MetricComparison;
    frustratedPct: MetricComparison;
  };
}

/**
 * Format duration in seconds to human readable "Xm Ys" or "Xs"
 */
export function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds <= 0) return '0s';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

/**
 * Calculates percentage safely avoiding NaN / divide-by-zero
 */
export function calculatePct(part: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

/**
 * Calculate comparison metric safely
 */
export function calculateComparison(current: number, previous: number): MetricComparison {
  if (previous === 0) {
    return {
      current,
      previous,
      changePct: current > 0 ? 100 : 0,
      isPositiveChange: current >= 0,
      comparisonAvailable: current !== 0 // Only meaningful if current has data
    };
  }
  const diff = current - previous;
  const pct = Math.round((diff / previous) * 1000) / 10;
  return {
    current,
    previous,
    changePct: pct,
    isPositiveChange: pct >= 0,
    comparisonAvailable: true
  };
}

/**
 * Classifies customer queries into validated standard issue categories
 */
export function classifyCustomerIssue(text: string, callReason?: string, isUnresolved?: boolean): string {
  const combined = `${text || ''} ${callReason || ''}`.toLowerCase();

  if (isUnresolved) {
    return 'Unresolved customer queries';
  }

  // 1. Order-related
  if (
    combined.includes('order') ||
    combined.includes('delivery') ||
    combined.includes('ship') ||
    combined.includes('track') ||
    combined.includes('courier') ||
    combined.includes('dispatch') ||
    combined.includes('arrive') ||
    combined.includes('package')
  ) {
    return 'Order-related questions';
  }

  // 2. Product information
  if (
    combined.includes('product') ||
    combined.includes('feature') ||
    combined.includes('spec') ||
    combined.includes('price') ||
    combined.includes('pricing') ||
    combined.includes('cost') ||
    combined.includes('catalog') ||
    combined.includes('warranty') ||
    combined.includes('model') ||
    combined.includes('discount')
  ) {
    return 'Product information';
  }

  // 3. Payment issues
  if (
    combined.includes('payment') ||
    combined.includes('pay') ||
    combined.includes('refund') ||
    combined.includes('charge') ||
    combined.includes('bill') ||
    combined.includes('invoice') ||
    combined.includes('transaction') ||
    combined.includes('card') ||
    combined.includes('credit') ||
    combined.includes('debit') ||
    combined.includes('failed payment')
  ) {
    return 'Payment issues';
  }

  // 4. Account-related problems
  if (
    combined.includes('account') ||
    combined.includes('login') ||
    combined.includes('password') ||
    combined.includes('reset') ||
    combined.includes('email') ||
    combined.includes('profile') ||
    combined.includes('register') ||
    combined.includes('sign in') ||
    combined.includes('sign up') ||
    combined.includes('locked')
  ) {
    return 'Account-related problems';
  }

  // 5. Technical support
  if (
    combined.includes('error') ||
    combined.includes('bug') ||
    combined.includes('not working') ||
    combined.includes('broken') ||
    combined.includes('crash') ||
    combined.includes('network') ||
    combined.includes('audio') ||
    combined.includes('mic') ||
    combined.includes('connect') ||
    combined.includes('help') ||
    combined.includes('troubleshoot')
  ) {
    return 'Technical support';
  }

  // 6. Unknown / Unclassified
  return 'Unknown or Unclassified';
}

export class BusinessIntelligenceService {
  /**
   * Aggregates raw database records into high-level BI metrics for a date range
   */
  public async calculateMetrics(
    startDate: Date,
    endDate: Date,
    reportType: 'daily' | 'monthly' | 'custom' = 'custom'
  ): Promise<BIMetrics> {
    // 1. Fetch Call Records in range
    const calls = await prisma.callRecord.findMany({
      where: {
        startTime: {
          gte: startDate,
          lte: endDate
        }
      },
      include: {
        transcripts: true,
        intelligence: true,
        sentimentRecords: true,
        agent: true,
        customer: true
      },
      orderBy: { startTime: 'asc' }
    });

    // 2. Fetch Active Agents
    const activeAgentsCount = await prisma.user.count({
      where: {
        role: 'agent',
        agentStatus: { not: 'offline' }
      }
    });

    const allAgents = await prisma.user.findMany({
      where: { role: 'agent' }
    });

    // 3. Compute Basic Call KPIs
    const totalCalls = calls.length;
    let completedCalls = 0;
    let missedCalls = 0;
    let transferredCalls = 0;
    let rejectedCalls = 0;
    let totalDurationSeconds = 0;
    const customerIdsSet = new Set<string>();

    // Hourly volume tracking (0..23)
    const hourlyMap = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: `${h.toString().padStart(2, '0')}:00`,
      total: 0,
      completed: 0,
      missed: 0,
      transferred: 0
    }));

    // Daily trends map
    const dailyMap = new Map<string, { total: number; completed: number; missed: number; transferred: number; duration: number }>();

    // Issue classification counters
    const issueCounts: Record<string, number> = {
      'Order-related questions': 0,
      'Product information': 0,
      'Payment issues': 0,
      'Account-related problems': 0,
      'Technical support': 0,
      'Unresolved customer queries': 0,
      'Unknown or Unclassified': 0
    };

    // Sentiment counters
    let positiveSentimentCount = 0;
    let neutralSentimentCount = 0;
    let negativeSentimentCount = 0;
    let frustratedSentimentCount = 0;
    let callsRequiringAssistance = 0;
    const dissatisfactionReasonsMap = new Map<string, number>();

    // Agent map for performance tracking
    const agentMap = new Map<string, AgentPerformanceStat>();
    for (const a of allAgents) {
      agentMap.set(a.id, {
        agentId: a.id,
        name: a.name,
        email: a.email,
        role: a.role,
        status: a.agentStatus || 'available',
        callsHandled: 0,
        completed: 0,
        transferred: 0,
        missed: 0,
        avgDurationSeconds: 0,
        avgDurationFormatted: '0s',
        sentimentDistribution: { positive: 0, neutral: 0, negative: 0, frustrated: 0 }
      });
    }

    // Process every call
    for (const call of calls) {
      // Status counting
      if (call.status === 'completed') completedCalls++;
      else if (call.status === 'missed') missedCalls++;
      else if (call.status === 'transferred' || call.transferred) transferredCalls++;
      else if (call.status === 'rejected') rejectedCalls++;

      totalDurationSeconds += call.duration || 0;

      // Unique customer calculation
      if (call.customerId) {
        customerIdsSet.add(call.customerId);
      } else if (call.customerPhone) {
        customerIdsSet.add(call.customerPhone);
      } else if (call.customerName) {
        customerIdsSet.add(call.customerName.toLowerCase().trim());
      }

      // Hourly aggregation
      const callDate = new Date(call.startTime);
      const hour = callDate.getHours();
      if (hourlyMap[hour]) {
        hourlyMap[hour].total++;
        if (call.status === 'completed') hourlyMap[hour].completed++;
        else if (call.status === 'missed') hourlyMap[hour].missed++;
        else if (call.transferred || call.status === 'transferred') hourlyMap[hour].transferred++;
      }

      // Daily aggregation
      const dateKey = callDate.toISOString().split('T')[0];
      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, { total: 0, completed: 0, missed: 0, transferred: 0, duration: 0 });
      }
      const dayEntry = dailyMap.get(dateKey)!;
      dayEntry.total++;
      if (call.status === 'completed') dayEntry.completed++;
      else if (call.status === 'missed') dayEntry.missed++;
      else if (call.transferred || call.status === 'transferred') dayEntry.transferred++;
      dayEntry.duration += call.duration || 0;

      // Assistance required check
      if (call.requiresAssistance || call.sentimentRecords.some((s) => s.requiresHumanAssistance)) {
        callsRequiringAssistance++;
      }

      // Sentiment aggregation: Check overallSentiment or latest sentimentRecord
      let callSentiment = call.overallSentiment;
      if (!callSentiment && call.sentimentRecords.length > 0) {
        const finalRec = call.sentimentRecords.find((s) => s.isFinal) || call.sentimentRecords[call.sentimentRecords.length - 1];
        callSentiment = finalRec?.sentiment;
      }

      if (callSentiment === 'POSITIVE') positiveSentimentCount++;
      else if (callSentiment === 'NEGATIVE') negativeSentimentCount++;
      else if (callSentiment === 'FRUSTRATED') frustratedSentimentCount++;
      else neutralSentimentCount++;

      // Dissatisfaction reasons
      if (callSentiment === 'NEGATIVE' || callSentiment === 'FRUSTRATED' || call.requiresAssistance) {
        const reason =
          call.assistanceReason ||
          call.sentimentRecords.find((s) => s.reason)?.reason ||
          call.intelligence?.resolutionExplanation ||
          'Customer expressed repeated frustration';
        dissatisfactionReasonsMap.set(reason, (dissatisfactionReasonsMap.get(reason) || 0) + 1);
      }

      // Issue classification: Concatenate customer transcripts
      const customerUtterances = call.transcripts
        .filter((t) => t.sender === 'customer')
        .map((t) => t.text)
        .join(' ');
      const issueCategory = classifyCustomerIssue(
        customerUtterances || call.customerQuestion || '',
        call.intelligence?.callReason,
        call.intelligence?.resolutionStatus === 'unresolved'
      );
      issueCounts[issueCategory] = (issueCounts[issueCategory] || 0) + 1;

      // Agent performance tracking
      if (call.agentId && agentMap.has(call.agentId)) {
        const agentStat = agentMap.get(call.agentId)!;
        agentStat.callsHandled++;
        if (call.status === 'completed') agentStat.completed++;
        else if (call.status === 'transferred' || call.transferred) agentStat.transferred++;
        else if (call.status === 'missed') agentStat.missed++;

        if (callSentiment === 'POSITIVE') agentStat.sentimentDistribution.positive++;
        else if (callSentiment === 'NEGATIVE') agentStat.sentimentDistribution.negative++;
        else if (callSentiment === 'FRUSTRATED') agentStat.sentimentDistribution.frustrated++;
        else agentStat.sentimentDistribution.neutral++;
      }
    }

    // Finalize Agent stats
    const agentPerformanceList: AgentPerformanceStat[] = Array.from(agentMap.values()).map((agentStat) => {
      // Find duration of calls handled by this agent
      const agentCalls = calls.filter((c) => c.agentId === agentStat.agentId);
      const totalAgentDur = agentCalls.reduce((acc, c) => acc + (c.duration || 0), 0);
      const avgSec = agentCalls.length > 0 ? Math.round(totalAgentDur / agentCalls.length) : 0;
      return {
        ...agentStat,
        avgDurationSeconds: avgSec,
        avgDurationFormatted: formatDuration(avgSec)
      };
    });

    // Peak Call Hours calculation
    let maxHourCalls = -1;
    let peakHourIndex = 14; // default 2 PM
    for (const h of hourlyMap) {
      if (h.total > maxHourCalls) {
        maxHourCalls = h.total;
        peakHourIndex = h.hour;
      }
    }
    const peakCallHours = `${peakHourIndex.toString().padStart(2, '0')}:00 - ${(peakHourIndex + 1).toString().padStart(2, '0')}:00`;

    // Format daily trends list
    const dailyTrends: DailyTrendStat[] = Array.from(dailyMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([d, stat]) => ({
        date: d,
        label: new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        totalCalls: stat.total,
        completed: stat.completed,
        missed: stat.missed,
        transferred: stat.transferred,
        avgDurationSeconds: stat.total > 0 ? Math.round(stat.duration / stat.total) : 0
      }));

    // Format issue breakdown array
    const issueBreakdown: IssueCategoryStat[] = Object.entries(issueCounts)
      .filter(([_, count]) => count > 0 || totalCalls === 0)
      .map(([cat, count]) => ({
        category: cat,
        count,
        percentage: calculatePct(count, totalCalls)
      }))
      .sort((a, b) => b.count - a.count);

    // Format top dissatisfaction reasons
    const topDissatisfactionReasons = Array.from(dissatisfactionReasonsMap.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Average duration
    const avgDurationSec = totalCalls > 0 ? Math.round(totalDurationSeconds / totalCalls) : 0;

    // Days covered
    const daysCovered = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));

    // Assemble current metrics
    const currentMetrics: BIMetrics = {
      period: {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        reportType,
        daysCovered
      },
      kpis: {
        totalCalls,
        completedCalls,
        missedCalls,
        transferredCalls,
        rejectedCalls,
        averageDurationSeconds: avgDurationSec,
        averageDurationFormatted: formatDuration(avgDurationSec),
        totalDurationSeconds,
        uniqueCustomers: customerIdsSet.size,
        positiveSentimentPct: calculatePct(positiveSentimentCount, totalCalls),
        negativeSentimentPct: calculatePct(negativeSentimentCount, totalCalls),
        neutralSentimentPct: calculatePct(neutralSentimentCount, totalCalls),
        frustratedSentimentPct: calculatePct(frustratedSentimentCount, totalCalls),
        totalCallsRequiringAssistance: callsRequiringAssistance,
        totalActiveAgents: activeAgentsCount
      },
      sentiment: {
        positiveCount: positiveSentimentCount,
        neutralCount: neutralSentimentCount,
        negativeCount: negativeSentimentCount,
        frustratedCount: frustratedSentimentCount,
        totalAnalyzed: totalCalls,
        callsRequiringAssistance,
        topDissatisfactionReasons
      },
      issues: issueBreakdown,
      agentPerformance: agentPerformanceList,
      hourlyVolume: hourlyMap,
      dailyTrends,
      peakCallHours
    };

    // 4. Calculate Previous Period for Comparison (Monthly / Daily)
    try {
      const periodDurationMs = endDate.getTime() - startDate.getTime();
      const prevEndDate = new Date(startDate.getTime() - 1);
      const prevStartDate = new Date(prevEndDate.getTime() - periodDurationMs);

      const prevCalls = await prisma.callRecord.findMany({
        where: {
          startTime: {
            gte: prevStartDate,
            lte: prevEndDate
          }
        },
        select: {
          id: true,
          status: true,
          duration: true,
          overallSentiment: true,
          customerId: true
        }
      });

      const prevTotal = prevCalls.length;
      const prevCompleted = prevCalls.filter((c) => c.status === 'completed').length;
      const prevDur = prevTotal > 0 ? prevCalls.reduce((acc, c) => acc + (c.duration || 0), 0) / prevTotal : 0;
      const prevFrustrated = prevCalls.filter((c) => c.overallSentiment === 'FRUSTRATED').length;
      const prevFrustratedPct = prevTotal > 0 ? (prevFrustrated / prevTotal) * 100 : 0;
      const prevUniqueCust = new Set(prevCalls.map((c) => c.customerId).filter(Boolean)).size;

      currentMetrics.comparisons = {
        totalCalls: calculateComparison(totalCalls, prevTotal),
        completedCalls: calculateComparison(completedCalls, prevCompleted),
        averageDuration: calculateComparison(avgDurationSec, Math.round(prevDur)),
        uniqueCustomers: calculateComparison(customerIdsSet.size, prevUniqueCust),
        frustratedPct: calculateComparison(currentMetrics.kpis.frustratedSentimentPct, Math.round(prevFrustratedPct * 10) / 10)
      };
    } catch (cmpErr) {
      // Comparison optional, fallback cleanly if date calculation fails
    }

    return currentMetrics;
  }

  /**
   * Generates factual, data-driven Executive Summary bullet points based strictly on actual metrics
   */
  public generateExecutiveSummary(metrics: BIMetrics, reportType: string): string[] {
    const obs: string[] = [];
    const k = metrics.kpis;

    // Observation 1: Call Volume & Completion Rate
    const completionRate = calculatePct(k.completedCalls, k.totalCalls);
    let volText = `Total customer voice call volume reached ${k.totalCalls} during this ${reportType} reporting period (${metrics.period.startDate} to ${metrics.period.endDate}). ${k.completedCalls} calls were successfully completed (${completionRate}% completion rate).`;
    if (metrics.comparisons?.totalCalls.comparisonAvailable) {
      const chg = metrics.comparisons.totalCalls.changePct;
      volText += ` This represents a ${Math.abs(chg)}% ${chg >= 0 ? 'increase' : 'decrease'} compared to the previous period.`;
    }
    obs.push(volText);

    // Observation 2: Sentiment Health & Frustration
    const sentimentHealth =
      k.positiveSentimentPct >= 60 ? 'strong overall satisfaction' : k.frustratedSentimentPct >= 20 ? 'elevated customer friction' : 'moderate satisfaction levels';
    obs.push(
      `Customer emotion analysis indicates ${sentimentHealth}: ${k.positiveSentimentPct}% of conversations were classified as Positive, while Frustrated interactions accounted for ${k.frustratedSentimentPct}% (${metrics.sentiment.frustratedCount} calls).`
    );

    // Observation 3: Human Assistance & Escalations
    if (k.totalCallsRequiringAssistance > 0) {
      obs.push(
        `${k.totalCallsRequiringAssistance} calls (${calculatePct(k.totalCallsRequiringAssistance, k.totalCalls)}% of total) were flagged as requiring live human assistance due to complex inquiries or repeated frustration signals.`
      );
    } else {
      obs.push(`Zero calls required emergency human assistance during this period; all inquiries were successfully addressed by the autonomous AI assistant.`);
    }

    // Observation 4: Top Customer Issues
    const topIssue = metrics.issues[0];
    if (topIssue && topIssue.count > 0 && topIssue.category !== 'Unknown or Unclassified') {
      obs.push(
        `'${topIssue.category}' emerged as the most frequently reported customer inquiry, accounting for ${topIssue.count} calls (${topIssue.percentage}% of all classified queries).`
      );
    } else if (metrics.issues.length > 1 && metrics.issues[1].count > 0) {
      const secondary = metrics.issues[1];
      obs.push(`'${secondary.category}' was the primary identified inquiry topic with ${secondary.count} calls (${secondary.percentage}% share).`);
    }

    // Observation 5: Peak Call Times & Staffing
    obs.push(
      `Peak call activity occurred during the window of ${metrics.peakCallHours}. The platform was supported by ${k.totalActiveAgents} active support specialists with an average conversation duration of ${k.averageDurationFormatted}.`
    );

    return obs;
  }

  /**
   * Generates a Daily Business Report for a specific date (defaults to yesterday if not specified)
   */
  public async generateDailyReport(targetDate?: Date, generatedBy: string = 'system'): Promise<any> {
    const ref = targetDate || new Date(Date.now() - 24 * 60 * 60 * 1000);
    const startOfDay = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 0, 0, 0, 0);
    const endOfDay = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 23, 59, 59, 999);

    const dateStr = startOfDay.toISOString().split('T')[0];
    const reportTitle = `KAIRA Daily Business Intelligence Report - ${dateStr}`;

    // Duplicate check
    const existing = await prisma.businessReport.findFirst({
      where: {
        reportType: 'daily',
        startDate: { gte: startOfDay, lte: endOfDay }
      }
    });

    if (existing) {
      return {
        isDuplicate: true,
        report: existing,
        message: `Daily report for ${dateStr} already exists.`
      };
    }

    // Calculate metrics
    const metrics = await this.calculateMetrics(startOfDay, endOfDay, 'daily');
    const executiveSummaryList = this.generateExecutiveSummary(metrics, 'daily');
    const executiveSummary = executiveSummaryList.join('\n\n');

    // Generate CSV and PDF
    const reportId = 'rpt_daily_' + Date.now().toString(36);
    const csvFileName = `KAIRA-Daily-Report-${dateStr}.csv`;
    const pdfFileName = `KAIRA-Daily-Report-${dateStr}.pdf`;

    const csvContent = this.exportMetricsToCsvString(reportTitle, metrics, executiveSummaryList, dateStr, dateStr);
    const csvPath = this.saveCsvFile(csvFileName, csvContent);

    const pdfBuffer = generateBiPdfDocument({
      id: reportId,
      title: reportTitle,
      reportType: 'Daily Business Report',
      startDate: dateStr,
      endDate: dateStr,
      generatedAt: new Date().toLocaleString(),
      generatedBy,
      executiveSummary: executiveSummaryList,
      kpis: {
        totalCalls: metrics.kpis.totalCalls,
        completedCalls: metrics.kpis.completedCalls,
        missedCalls: metrics.kpis.missedCalls,
        transferredCalls: metrics.kpis.transferredCalls,
        averageDuration: metrics.kpis.averageDurationFormatted,
        uniqueCustomers: metrics.kpis.uniqueCustomers,
        positivePct: metrics.kpis.positiveSentimentPct,
        negativePct: metrics.kpis.negativeSentimentPct,
        neutralPct: metrics.kpis.neutralSentimentPct,
        frustratedPct: metrics.kpis.frustratedSentimentPct,
        callsRequiringAssistance: metrics.kpis.totalCallsRequiringAssistance,
        activeAgents: metrics.kpis.totalActiveAgents
      },
      issueBreakdown: metrics.issues,
      sentimentBreakdown: {
        positive: metrics.sentiment.positiveCount,
        neutral: metrics.sentiment.neutralCount,
        negative: metrics.sentiment.negativeCount,
        frustrated: metrics.sentiment.frustratedCount
      },
      agentPerformance: metrics.agentPerformance.map((a) => ({
        name: a.name,
        callsHandled: a.callsHandled,
        completed: a.completed,
        transferred: a.transferred,
        avgDuration: a.avgDurationFormatted,
        sentimentSummary: `${a.sentimentDistribution.positive}P / ${a.sentimentDistribution.frustrated}F`
      })),
      keyFindings: [
        `Peak call activity centered around ${metrics.peakCallHours}.`,
        `Average call duration stood at ${metrics.kpis.averageDurationFormatted}.`,
        `Recommended focus: Reinforce Knowledge Base documents for top category '${metrics.issues[0]?.category || 'General'}'.`
      ]
    });

    const pdfPath = saveReportPdf(pdfFileName, pdfBuffer);

    // Save report in database
    const report = await prisma.businessReport.create({
      data: {
        id: reportId,
        reportType: 'daily',
        title: reportTitle,
        startDate: startOfDay,
        endDate: endOfDay,
        generatedBy,
        status: 'completed',
        reportData: JSON.stringify(metrics),
        executiveSummary,
        pdfPath,
        csvPath
      }
    });

    return {
      isDuplicate: false,
      report,
      message: `Daily report for ${dateStr} successfully generated.`
    };
  }

  /**
   * Generates a Monthly Business Report for a completed calendar month
   */
  public async generateMonthlyReport(year?: number, month?: number, generatedBy: string = 'system'): Promise<any> {
    const now = new Date();
    // Default to previous month
    const targetYear = year !== undefined ? year : now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const targetMonth = month !== undefined ? month : now.getMonth() === 0 ? 11 : now.getMonth() - 1; // 0-indexed

    const startOfMonth = new Date(targetYear, targetMonth, 1, 0, 0, 0, 0);
    const endOfMonth = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59, 999);

    const monthName = startOfMonth.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    const reportTitle = `KAIRA Monthly Business Intelligence Report - ${monthName}`;

    // Duplicate check
    const existing = await prisma.businessReport.findFirst({
      where: {
        reportType: 'monthly',
        startDate: { gte: startOfMonth, lte: endOfMonth }
      }
    });

    if (existing) {
      return {
        isDuplicate: true,
        report: existing,
        message: `Monthly report for ${monthName} already exists.`
      };
    }

    // Calculate metrics
    const metrics = await this.calculateMetrics(startOfMonth, endOfMonth, 'monthly');
    const executiveSummaryList = this.generateExecutiveSummary(metrics, 'monthly');
    const executiveSummary = executiveSummaryList.join('\n\n');

    const reportId = 'rpt_monthly_' + Date.now().toString(36);
    const safeMonthStr = `${targetYear}-${(targetMonth + 1).toString().padStart(2, '0')}`;
    const csvFileName = `KAIRA-Monthly-Report-${safeMonthStr}.csv`;
    const pdfFileName = `KAIRA-Monthly-Report-${safeMonthStr}.pdf`;

    const csvContent = this.exportMetricsToCsvString(
      reportTitle,
      metrics,
      executiveSummaryList,
      startOfMonth.toISOString().split('T')[0],
      endOfMonth.toISOString().split('T')[0]
    );
    const csvPath = this.saveCsvFile(csvFileName, csvContent);

    const pdfBuffer = generateBiPdfDocument({
      id: reportId,
      title: reportTitle,
      reportType: 'Monthly Business Report',
      startDate: startOfMonth.toISOString().split('T')[0],
      endDate: endOfMonth.toISOString().split('T')[0],
      generatedAt: new Date().toLocaleString(),
      generatedBy,
      executiveSummary: executiveSummaryList,
      kpis: {
        totalCalls: metrics.kpis.totalCalls,
        completedCalls: metrics.kpis.completedCalls,
        missedCalls: metrics.kpis.missedCalls,
        transferredCalls: metrics.kpis.transferredCalls,
        averageDuration: metrics.kpis.averageDurationFormatted,
        uniqueCustomers: metrics.kpis.uniqueCustomers,
        positivePct: metrics.kpis.positiveSentimentPct,
        negativePct: metrics.kpis.negativeSentimentPct,
        neutralPct: metrics.kpis.neutralSentimentPct,
        frustratedPct: metrics.kpis.frustratedSentimentPct,
        callsRequiringAssistance: metrics.kpis.totalCallsRequiringAssistance,
        activeAgents: metrics.kpis.totalActiveAgents
      },
      issueBreakdown: metrics.issues,
      sentimentBreakdown: {
        positive: metrics.sentiment.positiveCount,
        neutral: metrics.sentiment.neutralCount,
        negative: metrics.sentiment.negativeCount,
        frustrated: metrics.sentiment.frustratedCount
      },
      agentPerformance: metrics.agentPerformance.map((a) => ({
        name: a.name,
        callsHandled: a.callsHandled,
        completed: a.completed,
        transferred: a.transferred,
        avgDuration: a.avgDurationFormatted,
        sentimentSummary: `${a.sentimentDistribution.positive}P / ${a.sentimentDistribution.frustrated}F`
      })),
      keyFindings: [
        `Monthly call volume totaled ${metrics.kpis.totalCalls} calls across ${metrics.kpis.uniqueCustomers} distinct customers.`,
        `Customer satisfaction rate was ${metrics.kpis.positiveSentimentPct}%, with ${metrics.kpis.totalCallsRequiringAssistance} calls requiring specialist intervention.`,
        `Top inquiry focus: '${metrics.issues[0]?.category || 'General inquiries'}'.`
      ]
    });

    const pdfPath = saveReportPdf(pdfFileName, pdfBuffer);

    // Save report in database
    const report = await prisma.businessReport.create({
      data: {
        id: reportId,
        reportType: 'monthly',
        title: reportTitle,
        startDate: startOfMonth,
        endDate: endOfMonth,
        generatedBy,
        status: 'completed',
        reportData: JSON.stringify(metrics),
        executiveSummary,
        pdfPath,
        csvPath
      }
    });

    return {
      isDuplicate: false,
      report,
      message: `Monthly report for ${monthName} successfully generated.`
    };
  }

  /**
   * Generates a custom date-range report on demand
   */
  public async generateCustomReport(startDate: Date, endDate: Date, title?: string, generatedBy: string = 'admin'): Promise<any> {
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];
    const reportTitle = title || `KAIRA Custom Business Intelligence Report (${startStr} to ${endStr})`;

    const metrics = await this.calculateMetrics(startDate, endDate, 'custom');
    const executiveSummaryList = this.generateExecutiveSummary(metrics, 'custom');
    const executiveSummary = executiveSummaryList.join('\n\n');

    const reportId = 'rpt_custom_' + Date.now().toString(36);
    const csvFileName = `KAIRA-Custom-Report-${startStr}_to_${endStr}.csv`;
    const pdfFileName = `KAIRA-Custom-Report-${startStr}_to_${endStr}.pdf`;

    const csvContent = this.exportMetricsToCsvString(reportTitle, metrics, executiveSummaryList, startStr, endStr);
    const csvPath = this.saveCsvFile(csvFileName, csvContent);

    const pdfBuffer = generateBiPdfDocument({
      id: reportId,
      title: reportTitle,
      reportType: 'Custom Business Report',
      startDate: startStr,
      endDate: endStr,
      generatedAt: new Date().toLocaleString(),
      generatedBy,
      executiveSummary: executiveSummaryList,
      kpis: {
        totalCalls: metrics.kpis.totalCalls,
        completedCalls: metrics.kpis.completedCalls,
        missedCalls: metrics.kpis.missedCalls,
        transferredCalls: metrics.kpis.transferredCalls,
        averageDuration: metrics.kpis.averageDurationFormatted,
        uniqueCustomers: metrics.kpis.uniqueCustomers,
        positivePct: metrics.kpis.positiveSentimentPct,
        negativePct: metrics.kpis.negativeSentimentPct,
        neutralPct: metrics.kpis.neutralSentimentPct,
        frustratedPct: metrics.kpis.frustratedSentimentPct,
        callsRequiringAssistance: metrics.kpis.totalCallsRequiringAssistance,
        activeAgents: metrics.kpis.totalActiveAgents
      },
      issueBreakdown: metrics.issues,
      sentimentBreakdown: {
        positive: metrics.sentiment.positiveCount,
        neutral: metrics.sentiment.neutralCount,
        negative: metrics.sentiment.negativeCount,
        frustrated: metrics.sentiment.frustratedCount
      },
      agentPerformance: metrics.agentPerformance.map((a) => ({
        name: a.name,
        callsHandled: a.callsHandled,
        completed: a.completed,
        transferred: a.transferred,
        avgDuration: a.avgDurationFormatted,
        sentimentSummary: `${a.sentimentDistribution.positive}P / ${a.sentimentDistribution.frustrated}F`
      })),
      keyFindings: [
        `Custom analysis covering ${metrics.period.daysCovered} days from ${startStr} to ${endStr}.`,
        `Total calls: ${metrics.kpis.totalCalls} | Completed: ${metrics.kpis.completedCalls} (${calculatePct(metrics.kpis.completedCalls, metrics.kpis.totalCalls)}%).`
      ]
    });

    const pdfPath = saveReportPdf(pdfFileName, pdfBuffer);

    const report = await prisma.businessReport.create({
      data: {
        id: reportId,
        reportType: 'custom',
        title: reportTitle,
        startDate,
        endDate,
        generatedBy,
        status: 'completed',
        reportData: JSON.stringify(metrics),
        executiveSummary,
        pdfPath,
        csvPath
      }
    });

    return {
      isDuplicate: false,
      report,
      message: `Custom report for period ${startStr} to ${endStr} successfully generated.`
    };
  }

  /**
   * Helper: Exports metrics data to a comprehensive, Excel-compliant CSV string with UTF-8 BOM
   */
  public exportMetricsToCsvString(
    title: string,
    metrics: BIMetrics,
    executiveSummary: string[],
    startStr: string,
    endStr: string
  ): string {
    const lines: string[] = [];

    // UTF-8 BOM for Microsoft Excel compatibility
    const BOM = '\uFEFF';

    // 1. Report Metadata Header
    lines.push(`"${title.replace(/"/g, '""')}"`);
    lines.push(`"Reporting Period","${startStr} to ${endStr}"`);
    lines.push(`"Generated At","${new Date().toLocaleString()}"`);
    lines.push(`"Platform","KAIRA Voice AI Platform"`);
    lines.push('');

    // 2. Executive Summary
    lines.push('"--- EXECUTIVE SUMMARY & KEY OBSERVATIONS ---"');
    for (const obs of executiveSummary) {
      lines.push(`"${obs.replace(/"/g, '""')}"`);
    }
    lines.push('');

    // 3. Key Performance Indicators
    lines.push('"--- KEY PERFORMANCE INDICATORS ---"');
    lines.push('"Metric","Value"');
    lines.push(`"Total Calls Received",${metrics.kpis.totalCalls}`);
    lines.push(`"Completed Calls",${metrics.kpis.completedCalls}`);
    lines.push(`"Missed Calls",${metrics.kpis.missedCalls}`);
    lines.push(`"Transferred Calls",${metrics.kpis.transferredCalls}`);
    lines.push(`"Average Call Duration (Seconds)",${metrics.kpis.averageDurationSeconds}`);
    lines.push(`"Average Call Duration (Formatted)","${metrics.kpis.averageDurationFormatted}"`);
    lines.push(`"Total Unique Customers",${metrics.kpis.uniqueCustomers}`);
    lines.push(`"Active Support Agents",${metrics.kpis.totalActiveAgents}`);
    lines.push(`"Calls Flagged for Human Assistance",${metrics.kpis.totalCallsRequiringAssistance}`);
    lines.push(`"Peak Call Hours","${metrics.peakCallHours}"`);
    lines.push('');

    // 4. Customer Sentiment Analysis
    lines.push('"--- CUSTOMER SENTIMENT ANALYSIS ---"');
    lines.push('"Sentiment Category","Call Count","Percentage Share"');
    lines.push(`"Positive",${metrics.sentiment.positiveCount},"${metrics.kpis.positiveSentimentPct}%"`);
    lines.push(`"Neutral",${metrics.sentiment.neutralCount},"${metrics.kpis.neutralSentimentPct}%"`);
    lines.push(`"Negative",${metrics.sentiment.negativeCount},"${metrics.kpis.negativeSentimentPct}%"`);
    lines.push(`"Frustrated",${metrics.sentiment.frustratedCount},"${metrics.kpis.frustratedSentimentPct}%"`);
    lines.push('');

    // 5. Frequently Reported Customer Issues
    lines.push('"--- FREQUENTLY REPORTED CUSTOMER ISSUES ---"');
    lines.push('"Issue Category","Call Volume","Percentage Share"');
    for (const issue of metrics.issues) {
      lines.push(`"${issue.category.replace(/"/g, '""')}",${issue.count},"${issue.percentage}%"`);
    }
    lines.push('');

    // 6. Support Agent Performance
    lines.push('"--- SUPPORT AGENT PERFORMANCE SUMMARY ---"');
    lines.push('"Agent Name","Email","Status","Calls Handled","Completed","Transferred","Missed","Avg Duration","Positive Sent.","Frustrated Sent."');
    for (const a of metrics.agentPerformance) {
      lines.push(
        `"${a.name.replace(/"/g, '""')}","${a.email}","${a.status}",${a.callsHandled},${a.completed},${a.transferred},${a.missed},"${a.avgDurationFormatted}",${a.sentimentDistribution.positive},${a.sentimentDistribution.frustrated}`
      );
    }
    lines.push('');

    // 7. Hourly Call Volume
    lines.push('"--- HOURLY CALL VOLUME DISTRIBUTION ---"');
    lines.push('"Hour","Total Calls","Completed Calls","Missed Calls","Transferred Calls"');
    for (const h of metrics.hourlyVolume) {
      lines.push(`"${h.label}",${h.total},${h.completed},${h.missed},${h.transferred}`);
    }

    return BOM + lines.join('\r\n');
  }

  /**
   * Helper: Saves CSV string to disk in reports directory
   */
  public saveCsvFile(filename: string, content: string): string {
    const reportsDir = path.resolve(process.cwd(), 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    const filePath = path.resolve(reportsDir, filename);
    fs.writeFileSync(filePath, content, { encoding: 'utf-8' });
    return filePath;
  }
}

export const biService = new BusinessIntelligenceService();

