import { kbCleanupService } from '../services/kbCleanup.service.js';
import { prisma } from '../db.js';

async function main() {
  console.log('================================================================');
  console.log('🧹 KAIRA KNOWLEDGE BASE PDF DUPLICATE CLEANUP & AUDIT');
  console.log('================================================================\n');

  // Step 1: Pre-cleanup Dry Run Scan
  console.log('--- STEP 1: PRE-CLEANUP DUPLICATE AUDIT SCAN ---');
  const preReport = await kbCleanupService.generateDuplicateReport();
  console.log(`Total Docs Scanned in DB: ${preReport.totalDocsScanned}`);
  console.log(`PDF Documents in DB: ${preReport.pdfDocsScanned}`);
  console.log(`Non-PDF Documents Preserved: ${preReport.nonPdfDocsPreserved}`);
  console.log(`Physical PDF files scanned on disk: ${preReport.physicalPdfFilesScanned}`);
  console.log(`Exact Duplicates (SHA-256): ${preReport.exactDuplicatesFound}`);
  console.log(`Content Duplicates (Normalized Text): ${preReport.contentDuplicatesFound}`);
  console.log(`Unique PDFs to Retain: ${preReport.uniquePdfsRetained}`);
  console.log('Details:');
  for (const d of preReport.details) {
    console.log(`  - ${d}`);
  }

  // Step 2: Execute Reversible Cleanup
  console.log('\n--- STEP 2: EXECUTING SAFE REVERSIBLE CLEANUP ---');
  const execReport = await kbCleanupService.executeSafeCleanup();
  console.log(`Duplicate DB Records Removed: ${execReport.duplicateRecordsRemoved}`);
  console.log(`Redundant Files Removed: ${execReport.redundantFilesRemoved}`);
  console.log(`Unique PDFs Retained: ${execReport.uniquePdfsRetained}`);
  console.log(`Backup Saved To: ${execReport.backupLocation || 'N/A'}`);
  console.log('Execution Log:');
  for (const d of execReport.details) {
    console.log(`  - ${d}`);
  }

  // Step 3: Post-cleanup Verification (Idempotence Check)
  console.log('\n--- STEP 3: POST-CLEANUP VERIFICATION (IDEMPOTENCE CHECK) ---');
  const postReport = await kbCleanupService.generateDuplicateReport();
  console.log(`Post-Cleanup Total Docs in DB: ${postReport.totalDocsScanned}`);
  console.log(`Post-Cleanup Physical PDFs on Disk: ${postReport.physicalPdfFilesScanned}`);
  console.log(`Exact Duplicates Remaining: ${postReport.exactDuplicatesFound}`);
  console.log(`Content Duplicates Remaining: ${postReport.contentDuplicatesFound}`);

  // Re-run execution to prove idempotence
  const idempotentReport = await kbCleanupService.executeSafeCleanup();
  console.log(`Re-run Execution (Should remove 0): records=${idempotentReport.duplicateRecordsRemoved}, files=${idempotentReport.redundantFilesRemoved}`);

  const isSuccess = postReport.exactDuplicatesFound === 0 && postReport.contentDuplicatesFound === 0;
  console.log(`\nCleanup Status: ${isSuccess ? '✅ CLEANUP COMPLETE & FULLY VERIFIED' : '⚠️ WARNING: Duplicates remain'}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('Cleanup execution error:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
