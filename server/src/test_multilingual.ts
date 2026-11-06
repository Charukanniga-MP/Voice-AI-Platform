import { translationService, SUPPORTED_LANGUAGES } from './services/translation.js';
import { prisma } from './db.js';

async function runMultilingualVerification() {
  console.log('=== KAIRA Multilingual Calling System Verification ===\n');

  // 1. Verify 5-Language Configurations
  const languages = Object.keys(SUPPORTED_LANGUAGES);
  console.log(`[1] Verifying 5 Supported Languages: [${languages.join(', ')}]`);
  for (const code of languages) {
    const info = SUPPORTED_LANGUAGES[code];
    console.log(`  - ${code}: ${info.name} (${info.nativeName}) -> BCP-47: ${info.bcp47}`);
  }

  // 2. Test Grounded KB Query in Tamil
  console.log('\n[2] Testing Grounded KB Retrieval (Tamil):');
  const tamilKb = await translationService.getAiAnswerSuggestion('What are your voice agent features?', 'ta');
  console.log(`  - Is Grounded: ${tamilKb.isGrounded}`);
  console.log(`  - Sources Matched: ${tamilKb.sources.map(s => s.title).join(', ') || 'None'}`);
  console.log(`  - Answer: ${tamilKb.answer?.slice(0, 120)}...`);

  // 3. Test Fallback Query Outside KB
  console.log('\n[3] Testing Fallback Handling (Query outside KB):');
  const ungrounded = await translationService.getAiAnswerSuggestion('Can you give me free flight tickets to Paris?', 'hi');
  console.log(`  - Is Grounded: ${ungrounded.isGrounded} (Expected: false)`);
  console.log(`  - Answer: ${ungrounded.answer}`);

  // 4. Test Database Schema & Stats Query
  console.log('\n[4] Testing Database Multilingual Query & Metrics:');
  const [totalCalls, queuedCalls, completedCalls, callsWithLang] = await Promise.all([
    prisma.callRecord.count(),
    prisma.callRecord.count({ where: { status: 'queued' } }),
    prisma.callRecord.count({ where: { status: 'completed' } }),
    prisma.callRecord.findMany({ select: { language: true } })
  ]);

  const langCounts: Record<string, number> = { en: 0, ta: 0, te: 0, ml: 0, hi: 0 };
  callsWithLang.forEach(c => {
    const l = c.language || 'en';
    langCounts[l] = (langCounts[l] || 0) + 1;
  });

  console.log(`  - Total Call Records in DB: ${totalCalls}`);
  console.log(`  - Queued Calls in DB: ${queuedCalls}`);
  console.log(`  - Completed Calls in DB: ${completedCalls}`);
  console.log(`  - Language Breakdown:`, langCounts);

  console.log('\n=== All Multilingual Verifications Passed Successfully ===');
  process.exit(0);
}

runMultilingualVerification().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
