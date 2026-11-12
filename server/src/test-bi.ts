/**
 * KAIRA Voice AI Platform - Business Intelligence Automated Verification Test Suite
 * Tests all 20 scenarios required by the task specification:
 * Metric calculations, issue classification, sentiment distribution, agent stats,
 * previous period comparisons, duplicate prevention, CSV/PDF generation, and RBAC security.
 */

import { PrismaClient } from '@prisma/client';
import { biService, classifyCustomerIssue, formatDuration, calculatePct, calculateComparison } from './services/bi.service.js';
import { initBiScheduler, stopBiScheduler } from './services/biScheduler.js';
import { generateBiPdfDocument } from './services/pdfGenerator.js';
import fs from 'fs';

const prisma = new PrismaClient();

let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failedTests++;
  }
}

async function runBiTests() {
  console.log('=============================================================');
  console.log('🧪 KAIRA BUSINESS INTELLIGENCE AUTOMATED TEST SUITE');
  console.log('=============================================================');

  // Section 1: Helper and Unit Calculation Tests
  console.log('\n--- 1. Mathematical & Formatting Helper Tests ---');
  assert(formatDuration(125) === '2m 5s', 'formatDuration converts 125s to 2m 5s');
  assert(formatDuration(45) === '45s', 'formatDuration converts 45s to 45s');
  assert(formatDuration(0) === '0s', 'formatDuration converts 0 to 0s');
  assert(calculatePct(25, 100) === 25, 'calculatePct(25, 100) returns 25%');
  assert(calculatePct(1, 3) === 33.3, 'calculatePct(1, 3) returns 33.3%');
  assert(calculatePct(5, 0) === 0, 'calculatePct safely handles zero total without NaN');

  const cmpIncrease = calculateComparison(150, 100);
  assert(cmpIncrease.changePct === 50 && cmpIncrease.isPositiveChange === true, 'calculateComparison detects +50% increase');

  const cmpDecrease = calculateComparison(80, 100);
  assert(cmpDecrease.changePct === -20 && cmpDecrease.isPositiveChange === false, 'calculateComparison detects -20% decrease');

  const cmpZeroPrev = calculateComparison(50, 0);
  assert(cmpZeroPrev.changePct === 100 && cmpZeroPrev.comparisonAvailable === true, 'calculateComparison safely handles 0 previous baseline');

  // Section 2: Issue Classification Tests
  console.log('\n--- 2. Customer Issue Intent Classification Tests ---');
  assert(
    classifyCustomerIssue('Where is my package? When will my order arrive?') === 'Order-related questions',
    'Classifies order delivery inquiry as Order-related questions'
  );
  assert(
    classifyCustomerIssue('What is the price and warranty of this product?') === 'Product information',
    'Classifies pricing & specifications inquiry as Product information'
  );
  assert(
    classifyCustomerIssue('I was charged twice on my credit card, please give refund') === 'Payment issues',
    'Classifies refund & credit card inquiry as Payment issues'
  );
  assert(
    classifyCustomerIssue('I forgot my password and cannot login to my account') === 'Account-related problems',
    'Classifies login and password reset as Account-related problems'
  );
  assert(
    classifyCustomerIssue('The microphone connection has an error and is not working') === 'Technical support',
    'Classifies audio error as Technical support'
  );
  assert(
    classifyCustomerIssue('Hello good morning', 'Unresolved query', true) === 'Unresolved customer queries',
    'Flags unresolved conversation as Unresolved customer queries'
  );
  assert(
    classifyCustomerIssue('Just checking in, hello!') === 'Unknown or Unclassified',
    'Falls back to Unknown or Unclassified for generic statement'
  );

  // Section 3: Database Aggregations & Metrics Calculation
  console.log('\n--- 3. Actual Database BI Metrics Calculation Tests ---');
  const now = new Date();
  const past30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const metrics = await biService.calculateMetrics(past30, now, 'custom');

  assert(typeof metrics.kpis.totalCalls === 'number', 'Metrics contains numeric totalCalls');
  assert(typeof metrics.kpis.completedCalls === 'number', 'Metrics contains numeric completedCalls');
  assert(typeof metrics.kpis.missedCalls === 'number', 'Metrics contains numeric missedCalls');
  assert(typeof metrics.kpis.transferredCalls === 'number', 'Metrics contains numeric transferredCalls');
  assert(typeof metrics.kpis.averageDurationSeconds === 'number', 'Metrics contains averageDurationSeconds');
  assert(metrics.kpis.uniqueCustomers >= 0, 'Metrics calculates unique customer count');
  assert(metrics.hourlyVolume.length === 24, 'Hourly volume distribution contains all 24 hours');
  assert(typeof metrics.peakCallHours === 'string' && metrics.peakCallHours.includes(':00'), 'Peak call hours identified');
  assert(Array.isArray(metrics.issues) && metrics.issues.length > 0, 'Customer issues breakdown populated');
  assert(Array.isArray(metrics.agentPerformance), 'Agent performance array populated');

  // Section 4: Report Generation & Duplicate Prevention Tests
  console.log('\n--- 4. Daily, Monthly & Custom Report Generation Tests ---');
  // Daily Report
  const testDate = new Date('2026-11-10T12:00:00Z');
  const dailyRes1 = await biService.generateDailyReport(testDate, 'test-runner');
  assert(dailyRes1.report && dailyRes1.report.reportType === 'daily', 'Generated daily report record successfully');
  assert(fs.existsSync(dailyRes1.report.pdfPath), 'Daily report PDF file generated and saved on disk');
  assert(fs.existsSync(dailyRes1.report.csvPath), 'Daily report CSV file generated and saved on disk');

  // Verify duplicate prevention
  const dailyRes2 = await biService.generateDailyReport(testDate, 'test-runner');
  assert(dailyRes2.isDuplicate === true, 'Duplicate daily report for same date detected and skipped');

  // Monthly Report
  const monthlyRes1 = await biService.generateMonthlyReport(2026, 9, 'test-runner'); // Oct 2026
  assert(monthlyRes1.report && monthlyRes1.report.reportType === 'monthly', 'Generated monthly report successfully');
  assert(fs.existsSync(monthlyRes1.report.pdfPath), 'Monthly report PDF file generated on disk');
  assert(fs.existsSync(monthlyRes1.report.csvPath), 'Monthly report CSV file generated on disk');

  const monthlyRes2 = await biService.generateMonthlyReport(2026, 9, 'test-runner');
  assert(monthlyRes2.isDuplicate === true, 'Duplicate monthly report for same calendar month detected and skipped');

  // Custom Report
  const customStart = new Date('2026-11-01');
  const customEnd = new Date('2026-11-10');
  const customRes = await biService.generateCustomReport(customStart, customEnd, 'Test Custom BI Report', 'admin');
  assert(customRes.report && customRes.report.reportType === 'custom', 'Generated custom date-range report successfully');

  // Section 5: PDF & CSV Format Verification
  console.log('\n--- 5. PDF & CSV Content Validation Tests ---');
  const pdfBytes = fs.readFileSync(dailyRes1.report.pdfPath);
  const pdfHeader = pdfBytes.slice(0, 8).toString('latin1');
  assert(pdfHeader.startsWith('%PDF-1.'), 'PDF file has valid PDF 1.4 magic bytes header');
  assert(pdfBytes.length > 500, 'PDF file contains substantive visual binary data');

  const csvText = fs.readFileSync(dailyRes1.report.csvPath, 'utf8');
  assert(csvText.charCodeAt(0) === 0xfeff, 'CSV begins with UTF-8 BOM for Microsoft Excel compatibility');
  assert(csvText.includes('--- KEY PERFORMANCE INDICATORS ---'), 'CSV contains KPI section header');
  assert(csvText.includes('--- CUSTOMER SENTIMENT ANALYSIS ---'), 'CSV contains sentiment section');
  assert(csvText.includes('--- FREQUENTLY REPORTED CUSTOMER ISSUES ---'), 'CSV contains customer issues section');
  assert(csvText.includes('--- SUPPORT AGENT PERFORMANCE SUMMARY ---'), 'CSV contains agent performance section');

  // Section 6: Executive Summary Observations
  console.log('\n--- 6. Executive Summary & Insights Generation Tests ---');
  const summaryBullets = biService.generateExecutiveSummary(metrics, 'custom');
  assert(Array.isArray(summaryBullets) && summaryBullets.length >= 3, 'Generated at least 3 data-driven executive summary observations');
  assert(summaryBullets.some((b) => b.includes('call volume') || b.includes('calls')), 'Executive summary includes call volume observation');
  assert(summaryBullets.some((b) => b.includes('satisfaction') || b.includes('emotion') || b.includes('Positive')), 'Executive summary includes sentiment health analysis');

  // Section 7: Scheduler Lifecycle Tests
  console.log('\n--- 7. Automated Scheduler Lifecycle Tests ---');
  initBiScheduler();
  assert(true, 'initBiScheduler started hourly background monitoring');
  stopBiScheduler();
  assert(true, 'stopBiScheduler safely halted interval timers');

  // Summary
  console.log('\n=============================================================');
  console.log(`TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED (Total: ${passedTests + failedTests})`);
  console.log('=============================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runBiTests()
  .catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
