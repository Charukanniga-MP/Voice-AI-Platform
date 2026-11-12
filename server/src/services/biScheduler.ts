/**
 * KAIRA Voice AI Platform - Automated Business Intelligence Scheduler
 * Handles automated daily and monthly report generation, startup catch-up,
 * duplicate prevention, and application restart resilience.
 */

import { biService } from './bi.service.js';

let schedulerInterval: NodeJS.Timeout | null = null;
let isRunningCheck = false;

/**
 * Checks and triggers scheduled daily/monthly report generation
 */
async function checkAndTriggerScheduledReports(): Promise<void> {
  if (isRunningCheck) return;
  isRunningCheck = true;

  try {
    const now = new Date();
    const currentHour = now.getHours();
    const currentDayOfMonth = now.getDate();

    // 1. Daily Report Check:
    // Generate for yesterday if it doesn't already exist.
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    try {
      const dailyRes = await biService.generateDailyReport(yesterday, 'system');
      if (!dailyRes.isDuplicate) {
        console.log(`[BI Scheduler] Automatically generated Daily Report for ${yesterday.toISOString().split('T')[0]}`);
      }
    } catch (dErr: any) {
      console.error(`[BI Scheduler] Error during scheduled daily report check:`, dErr.message);
    }

    // 2. Monthly Report Check:
    // If it's early in the month (days 1-3), ensure previous month's report is generated.
    if (currentDayOfMonth <= 3) {
      try {
        const monthlyRes = await biService.generateMonthlyReport(undefined, undefined, 'system');
        if (!monthlyRes.isDuplicate) {
          console.log(`[BI Scheduler] Automatically generated Monthly Report for previous calendar month.`);
        }
      } catch (mErr: any) {
        console.error(`[BI Scheduler] Error during scheduled monthly report check:`, mErr.message);
      }
    }
  } catch (err: any) {
    console.error(`[BI Scheduler] Unexpected scheduler error:`, err.message);
  } finally {
    isRunningCheck = false;
  }
}

/**
 * Initializes the automated BI Report Scheduler
 */
export function initBiScheduler(): void {
  console.log('⏰ [BI Scheduler] Initializing automated Business Intelligence scheduler...');

  // 1. Run catch-up on server boot (after a short delay to allow DB connections to settle)
  setTimeout(() => {
    checkAndTriggerScheduledReports();
  }, 5000);

  // 2. Schedule recurring hourly check to detect day and month transitions
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
  }

  // Check every hour (3600000 ms)
  schedulerInterval = setInterval(() => {
    checkAndTriggerScheduledReports();
  }, 60 * 60 * 1000);

  // Ensure timer does not prevent process exit in tests
  if (schedulerInterval.unref) {
    schedulerInterval.unref();
  }

  console.log('✓ [BI Scheduler] Scheduled Daily & Monthly report workers active (Hourly transition watch enabled).');
}

/**
 * Stops the scheduler (useful in tests or shutdown)
 */
export function stopBiScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
