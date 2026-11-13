/**
 * KAIRA Voice AI Platform - Business Growth & Opportunity Analytics Service
 * Synthesizes customer demand patterns, recurring problems, satisfaction trends,
 * and data-backed business growth insights from conversation analysis records.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class BusinessGrowthService {
  /**
   * Computes Business Growth Analytics for a date range
   */
  public async getGrowthAnalytics(startDate: Date, endDate: Date): Promise<any> {
    const analyses = await prisma.conversationAnalysis.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate }
      },
      include: {
        callRecord: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const totalAnalyses = analyses.length;

    // 1. Customer Demand Analysis (Product & Feature Mention Counting)
    const demandFrequency = new Map<string, number>();
    const questionsList: string[] = [];
    const problemsList: string[] = [];

    for (const a of analyses) {
      try {
        const prods: string[] = JSON.parse(a.productsMentioned || '[]');
        for (const p of prods) {
          demandFrequency.set(p, (demandFrequency.get(p) || 0) + 1);
        }
      } catch {}

      try {
        const qs: string[] = JSON.parse(a.questionsAsked || '[]');
        questionsList.push(...qs);
      } catch {}

      try {
        const probs: string[] = JSON.parse(a.problemsReported || '[]');
        problemsList.push(...probs);
      } catch {}
    }

    const topRequestedProducts = Array.from(demandFrequency.entries())
      .map(([name, count]) => ({
        name,
        count,
        percentage: totalAnalyses > 0 ? Math.round((count / totalAnalyses) * 100) : 0
      }))
      .sort((a, b) => b.count - a.count);

    // 2. Customer Problem Analysis
    const problemCategories = {
      technical: 0,
      payment: 0,
      order: 0,
      account: 0,
      general: 0
    };

    for (const p of problemsList) {
      const lower = p.toLowerCase();
      if (lower.includes('error') || lower.includes('bug') || lower.includes('crash') || lower.includes('network') || lower.includes('mic')) {
        problemCategories.technical++;
      } else if (lower.includes('pay') || lower.includes('charge') || lower.includes('refund') || lower.includes('bill')) {
        problemCategories.payment++;
      } else if (lower.includes('order') || lower.includes('delivery') || lower.includes('ship') || lower.includes('track')) {
        problemCategories.order++;
      } else if (lower.includes('password') || lower.includes('login') || lower.includes('account')) {
        problemCategories.account++;
      } else {
        problemCategories.general++;
      }
    }

    const totalProblems = Object.values(problemCategories).reduce((a, b) => a + b, 0);

    const problemBreakdown = [
      { category: 'Technical Issues', count: problemCategories.technical, pct: totalProblems > 0 ? Math.round((problemCategories.technical / totalProblems) * 100) : 0 },
      { category: 'Order & Delivery Queries', count: problemCategories.order, pct: totalProblems > 0 ? Math.round((problemCategories.order / totalProblems) * 100) : 0 },
      { category: 'Payment & Billing', count: problemCategories.payment, pct: totalProblems > 0 ? Math.round((problemCategories.payment / totalProblems) * 100) : 0 },
      { category: 'Account & Login', count: problemCategories.account, pct: totalProblems > 0 ? Math.round((problemCategories.account / totalProblems) * 100) : 0 },
      { category: 'General Inquiries', count: problemCategories.general, pct: totalProblems > 0 ? Math.round((problemCategories.general / totalProblems) * 100) : 0 }
    ].sort((a, b) => b.count - a.count);

    // 3. Customer Satisfaction Analysis
    let positiveCount = 0;
    let neutralCount = 0;
    let negativeCount = 0;
    let frustratedCount = 0;
    let unresolvedCount = 0;

    for (const a of analyses) {
      if (a.overallSentiment === 'POSITIVE') positiveCount++;
      else if (a.overallSentiment === 'NEGATIVE') negativeCount++;
      else if (a.overallSentiment === 'FRUSTRATED') frustratedCount++;
      else neutralCount++;

      if (a.issuesUnresolved && a.issuesUnresolved !== '[]') {
        unresolvedCount++;
      }
    }

    const resolutionRate = totalAnalyses > 0 ? Math.round(((totalAnalyses - unresolvedCount) / totalAnalyses) * 100) : 100;

    // 4. Data-Backed Business Growth Opportunities
    const opportunities: Array<{ title: string; indicator: string; recommendation: string; priority: 'high' | 'medium' | 'growth' }> = [];

    if (topRequestedProducts.length > 0 && topRequestedProducts[0].percentage >= 30) {
      opportunities.push({
        title: `High Customer Demand for ${topRequestedProducts[0].name}`,
        indicator: `${topRequestedProducts[0].count} customer inquiries (${topRequestedProducts[0].percentage}% of calls) referenced ${topRequestedProducts[0].name}.`,
        recommendation: `Expand feature capabilities and create targeted self-service knowledge articles to capture demand.`,
        priority: 'growth'
      });
    }

    if (problemCategories.order >= 2) {
      opportunities.push({
        title: 'Automate Order & Tracking Inquiries',
        indicator: `${problemCategories.order} customer inquiries related to order dispatch, delivery times, and shipping tracking.`,
        recommendation: 'Integrate real-time order status lookup directly into the voice assistant greeting to deflect routine calls.',
        priority: 'high'
      });
    }

    if (frustratedCount > 0) {
      opportunities.push({
        title: 'Customer Friction Point Resolution',
        indicator: `${frustratedCount} calls exhibited customer frustration, primarily around recurring questions or transfer wait times.`,
        recommendation: 'Implement proactive agent warm handoffs when sentiment score drops below 0.40.',
        priority: 'medium'
      });
    }

    // Default opportunity if few records
    if (opportunities.length === 0) {
      opportunities.push({
        title: 'Multilingual Regional Expansion',
        indicator: 'Platform supports English, Tamil, Telugu, Malayalam, and Hindi voice interactions.',
        recommendation: 'Target regional marketing in Tamil Nadu and AP/Telangana to drive voice AI adoption.',
        priority: 'growth'
      });
    }

    return {
      period: {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        totalConversationsAnalyzed: totalAnalyses
      },
      demandAnalysis: {
        topProducts: topRequestedProducts.slice(0, 6),
        totalDemandSignals: demandFrequency.size
      },
      problemAnalysis: {
        breakdown: problemBreakdown,
        unresolvedCount,
        resolutionRate
      },
      satisfactionAnalysis: {
        positiveCount,
        neutralCount,
        negativeCount,
        frustratedCount,
        positivePct: totalAnalyses > 0 ? Math.round((positiveCount / totalAnalyses) * 100) : 0,
        frustratedPct: totalAnalyses > 0 ? Math.round((frustratedCount / totalAnalyses) * 100) : 0
      },
      opportunities
    };
  }
}

export const businessGrowthService = new BusinessGrowthService();

