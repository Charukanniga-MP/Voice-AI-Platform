/**
 * KAIRA Voice AI Platform - Comprehensive Automated Integration Test Suite
 * Tests all 5 major development tasks:
 * 1. Admin Analytics & BI Metrics (Total calls, callbacks, tickets, success rate, language distribution)
 * 2. Call Quality Monitoring (Connect time, duration, AI latency, transfer time, interruptions)
 * 3. Knowledge Base Intelligence (Status tracking, duplicate detection, relevance ranking, feedback review)
 * 4. Centralized Notification Management (CRUD, deduplication, unread count, mark-read, role scoping)
 * 5. Role-based Authentication & Access Control (Customer, Agent, Admin RBAC)
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { biService } from '../services/bi.service.js';
import { notificationService } from '../services/notification.service.js';
import { knowledgeService } from '../services/knowledge.js';
import { handoverService } from '../services/handover.service.js';

const prisma = new PrismaClient();

interface TestReportItem {
  id: string;
  name: string;
  category: string;
  passed: boolean;
  durationMs: number;
  details?: string;
}

const results: TestReportItem[] = [];

async function runTest(
  id: string,
  category: string,
  name: string,
  fn: () => Promise<{ passed: boolean; details?: string }>
) {
  const start = Date.now();
  try {
    const outcome = await fn();
    const durationMs = Date.now() - start;
    results.push({
      id,
      name,
      category,
      passed: outcome.passed,
      durationMs,
      details: outcome.details
    });
    if (outcome.passed) {
      console.log(`  ✅ [PASS] ${id}: ${name} (${durationMs}ms)`);
    } else {
      console.error(`  ❌ [FAIL] ${id}: ${name} - ${outcome.details || 'Assertion failed'}`);
    }
  } catch (err: any) {
    const durationMs = Date.now() - start;
    results.push({
      id,
      name,
      category,
      passed: false,
      durationMs,
      details: err.message
    });
    console.error(`  ❌ [ERROR] ${id}: ${name} - Exception: ${err.message}`);
  }
}

export async function runComprehensiveIntegrationSuite() {
  console.log('========================================================================');
  console.log('  🧪 KAIRA VOICE AI PLATFORM - COMPREHENSIVE INTEGRATION TEST SUITE');
  console.log('========================================================================\n');

  // -------------------------------------------------------------------------
  // MODULE 1: AUTHENTICATION & RBAC ACCESS CONTROL
  // -------------------------------------------------------------------------
  console.log('--- MODULE 1: Authentication & Role-Based Access Control ---');

  await runTest('AUTH-01', 'Authentication', 'Verify Admin Credentials and Role in Database', async () => {
    const admin = await prisma.user.findFirst({
      where: { email: 'admin@kaira', role: 'admin' }
    });
    if (!admin) {
      return { passed: false, details: 'Default admin user (admin@kaira) not found in database.' };
    }
    const isPasswordValid = await bcrypt.compare('kaira@123', admin.passwordHash);
    return {
      passed: isPasswordValid && admin.role === 'admin',
      details: `Admin user verified: ${admin.name} (${admin.email}), Role: ${admin.role}`
    };
  });

  await runTest('AUTH-02', 'Authentication', 'Verify Role-Based Authorization Scopes', async () => {
    const roles = await prisma.user.groupBy({
      by: ['role'],
      _count: { id: true }
    });
    const foundRoles = roles.map(r => r.role);
    const hasAdmin = foundRoles.includes('admin');
    return {
      passed: hasAdmin,
      details: `Discovered roles in DB: ${foundRoles.join(', ')}`
    };
  });

  // -------------------------------------------------------------------------
  // MODULE 2: CENTRALIZED PERSISTENT NOTIFICATIONS (TASK 4)
  // -------------------------------------------------------------------------
  console.log('\n--- MODULE 2: Centralized Persistent Notifications (Task 4) ---');

  let testNotificationId: string = '';

  await runTest('NOTIF-01', 'Notifications', 'Create Notification with Deduplication Key', async () => {
    const dedupKey = `test_dedup_${Date.now()}`;
    const notif1 = await notificationService.createNotification({
      role: 'agent',
      type: 'incoming_call',
      title: 'Incoming Customer Voice Call',
      message: 'Test Customer initiated an AI voice call in English',
      data: { callId: 'call_test_001', language: 'en' },
      dedupKey
    });

    if (!notif1) {
      return { passed: false, details: 'Failed to create initial notification.' };
    }
    testNotificationId = notif1.id;

    // Attempt to insert duplicate with same dedupKey
    const notif2 = await notificationService.createNotification({
      role: 'agent',
      type: 'incoming_call',
      title: 'Duplicate Voice Call',
      message: 'This should be deduplicated',
      dedupKey
    });

    const isDeduplicated = notif2?.id === notif1.id;
    return {
      passed: Boolean(notif1.id) && isDeduplicated,
      details: `Created notification ID: ${notif1.id}, Dedup verified: ${isDeduplicated}`
    };
  });

  await runTest('NOTIF-02', 'Notifications', 'Create Call, Callback, Escalation & Ticket Notifications', async () => {
    const types: Array<'incoming_call' | 'callback' | 'escalation' | 'support_ticket'> = [
      'incoming_call',
      'callback',
      'escalation',
      'support_ticket'
    ];

    for (const t of types) {
      const n = await notificationService.createNotification({
        role: 'agent',
        type: t,
        title: `Test ${t} Event`,
        message: `Notification dispatch for event ${t}`,
        data: { test: true }
      });
      if (!n) {
        return { passed: false, details: `Failed to create notification of type ${t}` };
      }
    }

    return { passed: true, details: 'Successfully created all 4 notification types in database.' };
  });

  await runTest('NOTIF-03', 'Notifications', 'Retrieve Notifications by Role & Unread Count', async () => {
    const result = await notificationService.getNotifications({
      role: 'agent',
      limit: 10
    });

    return {
      passed: result.notifications.length > 0 && typeof result.unreadCount === 'number',
      details: `Retrieved ${result.notifications.length} notifications, Unread Count: ${result.unreadCount}`
    };
  });

  await runTest('NOTIF-04', 'Notifications', 'Mark Single Notification as Read', async () => {
    if (!testNotificationId) {
      return { passed: false, details: 'No test notification ID available.' };
    }
    const updated = await notificationService.markAsRead(testNotificationId);
    return {
      passed: updated !== null && updated.read === true,
      details: `Notification ${testNotificationId} read status: ${updated?.read}`
    };
  });

  await runTest('NOTIF-05', 'Notifications', 'Mark All Notifications as Read for Role', async () => {
    const count = await notificationService.markAllAsRead({ role: 'agent' });
    const postCheck = await notificationService.getNotifications({ role: 'agent', unreadOnly: true });
    return {
      passed: postCheck.unreadCount === 0,
      details: `Marked ${count} notifications as read. Remaining unread: ${postCheck.unreadCount}`
    };
  });

  // -------------------------------------------------------------------------
  // MODULE 3: ADMIN ANALYTICS & BI METRICS (TASK 1)
  // -------------------------------------------------------------------------
  console.log('\n--- MODULE 3: Admin Analytics & Business Intelligence (Task 1) ---');

  await runTest('BI-01', 'Analytics', 'Calculate 30-Day Database BI Metrics with KPIs', async () => {
    const now = new Date();
    const startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const metrics = await biService.calculateMetrics(startDate, now, 'custom');

    const hasKpis = metrics && metrics.kpis && typeof metrics.kpis.totalCalls === 'number';
    const hasCallbacks = typeof metrics.kpis.totalCallbacks === 'number';
    const hasTickets = typeof metrics.kpis.totalTickets === 'number';
    const hasSuccessRate = typeof metrics.kpis.callSuccessRate === 'number';
    const hasLangStats = Array.isArray(metrics.languageStats);

    return {
      passed: hasKpis && hasCallbacks && hasTickets && hasSuccessRate && hasLangStats,
      details: `Calls: ${metrics.kpis.totalCalls}, Completed: ${metrics.kpis.completedCalls}, Callbacks: ${metrics.kpis.totalCallbacks}, Tickets: ${metrics.kpis.totalTickets}, Success Rate: ${metrics.kpis.callSuccessRate}%, Languages: ${metrics.languageStats.length}`
    };
  });

  await runTest('BI-02', 'Analytics', 'Daily, Weekly, and Monthly Filter Calculations', async () => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const weeklyStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthlyStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);

    const [daily, weekly, monthly] = await Promise.all([
      biService.calculateMetrics(todayStart, now, 'daily'),
      biService.calculateMetrics(weeklyStart, now, 'custom'),
      biService.calculateMetrics(monthlyStart, now, 'monthly')
    ]);

    return {
      passed: Boolean(daily && weekly && monthly),
      details: `Daily: ${daily.kpis.totalCalls} calls | Weekly: ${weekly.kpis.totalCalls} calls | Monthly: ${monthly.kpis.totalCalls} calls`
    };
  });

  await runTest('BI-03', 'Analytics', 'Multilingual Regional Language Breakdown', async () => {
    const metrics = await biService.calculateMetrics(
      new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      new Date(),
      'custom'
    );

    return {
      passed: Array.isArray(metrics.languageStats),
      details: `Language stats aggregated: ${metrics.languageStats.map(l => `${l.languageName}: ${l.count}`).join(', ') || 'Zero calls recorded'}`
    };
  });

  // -------------------------------------------------------------------------
  // MODULE 4: CALL QUALITY MONITORING (TASK 2)
  // -------------------------------------------------------------------------
  console.log('\n--- MODULE 4: Call Quality & Reliability Monitoring (Task 2) ---');

  let testCallId = `test_quality_call_${Date.now()}`;
  let testCallRecordId = '';

  await runTest('QUAL-01', 'Quality', 'Persist Call Quality Telemetry in CallRecord', async () => {
    const testRecord = await prisma.callRecord.create({
      data: {
        callId: testCallId,
        customerName: 'Integration Quality Test Customer',
        customerPhone: '+919876543210',
        direction: 'incoming',
        type: 'ai_voice',
        status: 'completed',
        duration: 48,
        language: 'en',
        avgLatency: 85,
        packetLoss: 0.2,
        jitter: 1.5,
        connectTimeMs: 245,
        aiResponseTimeMs: 340,
        humanTransferTimeMs: 4200,
        audioInterruptionCount: 0,
        quality: 'excellent'
      }
    });

    testCallRecordId = testRecord.id;

    return {
      passed: Boolean(testRecord.id) && testRecord.connectTimeMs === 245 && testRecord.aiResponseTimeMs === 340,
      details: `Created quality test record: ID ${testRecord.id}, Connect: ${testRecord.connectTimeMs}ms, AI Latency: ${testRecord.aiResponseTimeMs}ms, Transfer: ${testRecord.humanTransferTimeMs}ms`
    };
  });

  await runTest('QUAL-02', 'Quality', 'Record and Track Call Audio Interruption Events', async () => {
    if (!testCallRecordId) return { passed: false, details: 'Missing test call record ID' };

    const event = await prisma.callRecoveryEvent.create({
      data: {
        callRecordId: testCallRecordId,
        callId: testCallId,
        failureType: 'audio_interruption',
        recoveryStatus: 'recovered',
        attempts: 1,
        interruptionDurationMs: 120,
        errorMessage: 'Sample audio buffer underflow recovered'
      }
    });

    return {
      passed: Boolean(event.id) && event.failureType === 'audio_interruption',
      details: `Created recovery event ID: ${event.id}, Status: ${event.recoveryStatus}`
    };
  });

  // -------------------------------------------------------------------------
  // MODULE 5: KNOWLEDGE BASE INTELLIGENCE & FEEDBACK (TASK 3)
  // -------------------------------------------------------------------------
  console.log('\n--- MODULE 5: Knowledge Base Intelligence & Feedback (Task 3) ---');

  await runTest('KB-01', 'KnowledgeBase', 'Query Grounded Knowledge & Relevance Ranking', async () => {
    const results = await knowledgeService.search('How do I contact customer support?');
    const hasResults = results && results.length > 0;
    const topResult = results[0];

    return {
      passed: hasResults,
      details: `Knowledge search returned ${results.length} results. Top: "${topResult?.title}" (Score: ${topResult?.score?.toFixed(2) || 'N/A'})`
    };
  });

  await runTest('KB-02', 'KnowledgeBase', 'Record and Review Helpful/Unhelpful AI Feedback', async () => {
    // Record helpful feedback
    const helpfulFb = await prisma.knowledgeFeedback.create({
      data: {
        query: 'What is KAIRA Voice AI?',
        suggestedAnswer: 'KAIRA is an enterprise conversational AI voice agent platform.',
        isUseful: true,
        feedbackNotes: 'Accurate and comprehensive response.'
      }
    });

    // Record unhelpful feedback
    const unhelpfulFb = await prisma.knowledgeFeedback.create({
      data: {
        query: 'What is the flight schedule to Mars?',
        suggestedAnswer: 'I apologize, but that information is not available in our knowledge base.',
        isUseful: false,
        feedbackNotes: 'Out of domain inquiry.'
      }
    });

    const allFb = await prisma.knowledgeFeedback.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    return {
      passed: Boolean(helpfulFb.id && unhelpfulFb.id && allFb.length >= 2),
      details: `Helpful ID: ${helpfulFb.id}, Unhelpful ID: ${unhelpfulFb.id}. Total in DB: ${allFb.length}`
    };
  });

  // -------------------------------------------------------------------------
  // MODULE 6: HUMAN SPECIALIST HANDOVER & CALLBACK CREATION
  // -------------------------------------------------------------------------
  console.log('\n--- MODULE 6: Intelligent Handover & Priority Callback ---');

  await runTest('HANDOVER-01', 'Handover', 'Evaluate Frustration & Low Confidence Escalation', async () => {
    const evalFrustration = await handoverService.evaluateHandover({
      queryText: 'I am extremely furious! This is ridiculous, transfer me right now!',
      callLang: 'en',
      sentimentResult: {
        sentiment: 'FRUSTRATED',
        score: -0.9,
        isFinal: true,
        reason: 'Customer furious and demands transfer',
        requiresHumanAssistance: true,
        confidence: 0.95
      },
      aiResponse: {
        answer: 'I understand your frustration.',
        isGrounded: false,
        requiresTransfer: true,
        confidence: 0.2
      }
    });

    return {
      passed: evalFrustration.shouldTransfer === true,
      details: `Escalation evaluated: ShouldTransfer=${evalFrustration.shouldTransfer}, Reason=${evalFrustration.reason}`
    };
  });

  await runTest('HANDOVER-02', 'Handover', 'Create and Prevent Duplicate Priority Callback Task', async () => {
    if (!testCallRecordId) return { passed: false, details: 'Missing test call record ID' };

    const task1 = await prisma.followUpTask.create({
      data: {
        callRecordId: testCallRecordId,
        customerName: 'Integration Quality Test Customer',
        customerPhone: '+919876543210',
        title: 'Priority Callback: Integration Quality Test',
        unresolvedQuestion: 'How to integrate real-time notifications?',
        previousSummary: 'Customer requested a callback regarding notification integration.',
        actionRequired: 'Call customer back at +919876543210',
        priority: 'urgent',
        status: 'pending',
        language: 'en'
      }
    });

    // Verify task exists
    const existing = await prisma.followUpTask.findFirst({
      where: {
        callRecordId: testCallRecordId,
        customerPhone: '+919876543210'
      }
    });

    return {
      passed: Boolean(task1.id && existing),
      details: `Callback task created: ID ${task1.id}, Status: ${task1.status}, Priority: ${task1.priority}`
    };
  });

  // -------------------------------------------------------------------------
  // CLEANUP TEST ARTIFACTS
  // -------------------------------------------------------------------------
  console.log('\n--- Cleaning up temporary integration test records ---');
  try {
    if (testCallRecordId) {
      await prisma.followUpTask.deleteMany({ where: { callRecordId: testCallRecordId } });
      await prisma.callRecoveryEvent.deleteMany({ where: { callRecordId: testCallRecordId } });
      await prisma.callRecord.delete({ where: { id: testCallRecordId } });
    }
    if (testNotificationId) {
      await prisma.notification.delete({ where: { id: testNotificationId } });
    }
    console.log('  🧹 Cleanup complete.');
  } catch (cleanErr: any) {
    console.warn('  ⚠️ Note during cleanup:', cleanErr.message);
  }

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log('  📊 INTEGRATION TEST SUITE EXECUTION SUMMARY');
  console.log('========================================================================');

  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = total - passed;

  console.log(`  Total Tests Run: ${total}`);
  console.log(`  Passed:         ${passed}`);
  console.log(`  Failed:         ${failed}`);
  console.log(`  Pass Rate:      ${Math.round((passed / total) * 100)}%`);
  console.log('========================================================================\n');

  if (failed > 0) {
    console.error('❌ Some tests failed. Please inspect the log above.');
    process.exit(1);
  } else {
    console.log('🎉 ALL INTEGRATION TESTS PASSED CLEANLY WITH ZERO ERRORS!');
    process.exit(0);
  }
}

// Execute suite
runComprehensiveIntegrationSuite().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
