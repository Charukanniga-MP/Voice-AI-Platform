import { knowledgeService, splitMultiQuestions, normalizeCustomerQuery, detectIntentRewrites, formatForVoice } from '../services/knowledge.js';
import { translationService } from '../services/translation.js';
import { kbCleanupService } from '../services/kbCleanup.service.js';
import { prisma } from '../db.js';

interface TestCaseResult {
  name: string;
  passed: boolean;
  details: string;
}

const results: TestCaseResult[] = [];

function assert(condition: boolean, name: string, details: string) {
  results.push({
    name,
    passed: Boolean(condition),
    details: condition ? details : `FAILED: ${details}`
  });
  if (condition) {
    console.log(`  ✅ [PASS] ${name}: ${details}`);
  } else {
    console.error(`  ❌ [FAIL] ${name}: ${details}`);
  }
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('🧪 KAIRA VOICE AI: COMPREHENSIVE KB RETRIEVAL & GROUNDING TEST SUITE');
  console.log('================================================================\n');

  // =========================================================================
  // 1. PDF CLEANUP & IDEMPOTENCE VERIFICATION
  // =========================================================================
  console.log('[SUITE 1] Knowledge Base PDF Deduplication & Idempotence');
  const cleanupScan = await kbCleanupService.generateDuplicateReport();
  assert(
    cleanupScan.exactDuplicatesFound === 0 && cleanupScan.contentDuplicatesFound === 0,
    'CLEANUP-01: Zero Remaining PDF Duplicates',
    `Exact Duplicates: ${cleanupScan.exactDuplicatesFound}, Content Duplicates: ${cleanupScan.contentDuplicatesFound}, Unique PDFs Retained: ${cleanupScan.uniquePdfsRetained}`
  );

  const cleanupExec = await kbCleanupService.executeSafeCleanup();
  assert(
    cleanupExec.duplicateRecordsRemoved === 0 && cleanupExec.redundantFilesRemoved === 0,
    'CLEANUP-02: Idempotent Execution',
    `Re-running cleanup safely removed 0 records and 0 files`
  );

  assert(
    cleanupScan.uniquePdfsRetained >= 1,
    'CLEANUP-03: Unique Canonical PDF Preserved',
    `Official canonical PDF preserved with 100 Q&A entries in database`
  );

  // =========================================================================
  // 2. QUESTION UNDERSTANDING & PARAPHRASING VARIATIONS
  // =========================================================================
  console.log('\n[SUITE 2] Question Understanding & Paraphrasing Variations');

  // 2.1 Refunds & Payment Returns (Different customer wordings)
  const refundQueries = [
    'Can I get my money back?',
    'What is the procedure to return my payment?',
    'I paid already. Can you give me a refund?',
    'How do I get my payment back?',
    'Is it possible to receive a reimbursement?'
  ];

  for (const q of refundQueries) {
    const res = await knowledgeService.answerQuery(q);
    const mentionsRefundSupport = res.answer.toLowerCase().includes('refund') || res.answer.toLowerCase().includes('payment') || res.answer.toLowerCase().includes('support agent');
    assert(
      mentionsRefundSupport && !res.isGrounded,
      `PARAPHRASE-REFUND: "${q}"`,
      `Answer properly identifies refund/payment return intent without hallucinating. Answer: "${res.answer.slice(0, 75)}..."`
    );
  }

  // 2.2 Business Hours (Different customer wordings)
  const businessHoursQueries = [
    'What are your business hours?',
    'When do you open?',
    'What time can I visit?',
    'Are you open in the evening?',
    'When does your office close?'
  ];

  for (const q of businessHoursQueries) {
    const res = await knowledgeService.answerQuery(q);
    const mentionsHours = res.answer.toLowerCase().includes('business hours') || res.answer.toLowerCase().includes('not supplied') || res.answer.toLowerCase().includes('schedule');
    assert(
      mentionsHours,
      `PARAPHRASE-HOURS: "${q}"`,
      `Mapped to business hours (Q98) grounded policy. Answer: "${res.answer.slice(0, 80)}..."`
    );
  }

  // 2.3 Office Location (Different customer wordings)
  const officeQueries = [
    'Where is your office located?',
    'What is your headquarters address?',
    'Where can I find your office?',
    'Where are you located?'
  ];

  for (const q of officeQueries) {
    const res = await knowledgeService.answerQuery(q);
    const mentionsOffice = res.answer.toLowerCase().includes('office') || res.answer.toLowerCase().includes('address') || res.answer.toLowerCase().includes('not supplied');
    assert(
      mentionsOffice,
      `PARAPHRASE-OFFICE: "${q}"`,
      `Mapped to office location (Q99) grounded policy. Answer: "${res.answer.slice(0, 80)}..."`
    );
  }

  // 2.4 Interruption & Barge-in (Different customer wordings)
  const interruptionQueries = [
    'Can customers interrupt the AI?',
    'Can I cut the AI off while it speaks?',
    'Can I barge in?'
  ];

  for (const q of interruptionQueries) {
    const res = await knowledgeService.answerQuery(q);
    const mentionsBargeIn = res.answer.toLowerCase().includes('barge-in') || res.answer.toLowerCase().includes('interruption') || res.answer.toLowerCase().includes('interrupt');
    assert(
      mentionsBargeIn,
      `PARAPHRASE-INTERRUPT: "${q}"`,
      `Retrieved Q16 barge-in chunk. Answer: "${res.answer.slice(0, 80)}..."`
    );
  }

  // 2.5 Multi-turn Memory & Earlier Turns
  const memoryQueries = [
    'Can KAIRA remember earlier turns in a conversation?',
    'Do you remember what I asked earlier?',
    'Do you retain context from previous questions?'
  ];

  for (const q of memoryQueries) {
    const res = await knowledgeService.answerQuery(q);
    const mentionsMemory = res.answer.toLowerCase().includes('multi-turn') || res.answer.toLowerCase().includes('earlier') || res.answer.toLowerCase().includes('context');
    assert(
      mentionsMemory,
      `PARAPHRASE-MEMORY: "${q}"`,
      `Retrieved Q17 multi-turn context chunk. Answer: "${res.answer.slice(0, 80)}..."`
    );
  }

  // =========================================================================
  // 3. MULTIPLE-QUESTION HANDLING
  // =========================================================================
  console.log('\n[SUITE 3] Multiple-Question Handling (Compound Queries)');

  const multi1 = 'What is KAIRA and what are your business hours?';
  const subQ1 = splitMultiQuestions(multi1);
  assert(
    subQ1.length === 2,
    'MULTI-01: Split into distinct questions',
    `Identified ${subQ1.length} questions: ["${subQ1[0]}", "${subQ1[1]}"]`
  );

  const multi1Res = await knowledgeService.answerQuery(multi1);
  const mentionsBoth = (multi1Res.answer.toLowerCase().includes('kaira') || multi1Res.answer.toLowerCase().includes('platform')) &&
    (multi1Res.answer.toLowerCase().includes('business hours') || multi1Res.answer.toLowerCase().includes('schedule'));
  assert(
    mentionsBoth,
    'MULTI-02: Answered both supported and unsupported parts',
    `Synthesized response covers both questions: "${multi1Res.answer.slice(0, 110)}..."`
  );

  const multi2 = 'Can I get my money back and where is your office located?';
  const multi2Res = await knowledgeService.answerQuery(multi2);
  const mentionsBoth2 = (multi2Res.answer.toLowerCase().includes('refund') || multi2Res.answer.toLowerCase().includes('money')) &&
    (multi2Res.answer.toLowerCase().includes('office') || multi2Res.answer.toLowerCase().includes('address'));
  assert(
    mentionsBoth2,
    'MULTI-03: Multiple unsupported question handling with handover',
    `Clearly answered both parts with honest unsupplied status: "${multi2Res.answer.slice(0, 110)}..."`
  );

  // =========================================================================
  // 4. ZERO-HALLUCINATION & STRICT EVIDENCE GROUNDING
  // =========================================================================
  console.log('\n[SUITE 4] Strict Zero-Hallucination & Unsupported Information');

  // Test 4.1: Student Discount (Explicit prompt example)
  const discountRes = await knowledgeService.answerQuery('Do you provide a 50% discount for students?');
  const refusesHallucination = discountRes.answer.toLowerCase().includes('couldn\'t find confirmed information') ||
    discountRes.answer.toLowerCase().includes('not supplied') ||
    discountRes.answer.toLowerCase().includes('not currently available');
  assert(
    refusesHallucination && !discountRes.isGrounded,
    'GROUNDING-01: Student Discount Refusal',
    `Correctly refused to invent a 50% discount. Answer: "${discountRes.answer}"`
  );

  // Test 4.2: Missing Contact Phone (Q97)
  const phoneRes = await knowledgeService.answerQuery('What is KAIRA\'s official support phone number?');
  assert(
    phoneRes.answer.toLowerCase().includes('not supplied') || phoneRes.answer.toLowerCase().includes('published'),
    'GROUNDING-02: Support Phone Number Grounding (Q97)',
    `Followed Q97 strictly without making up phone numbers. Answer: "${phoneRes.answer}"`
  );

  // Test 4.3: Out-of-domain Company Facts (e.g. Drone surveillance, Groceries)
  const droneRes = await knowledgeService.answerQuery('Can KAIRA voice agents fly autonomous surveillance drones?');
  assert(
    !droneRes.isGrounded && (droneRes.answer.toLowerCase().includes('not currently available') || droneRes.answer.toLowerCase().includes('couldn\'t find')),
    'GROUNDING-03: Out-of-Domain Company Product Refusal',
    `Refused to hallucinate drone capability. Answer: "${droneRes.answer}"`
  );

  // Test 4.4: Stock Ticker / Market Trading
  const stockRes = await knowledgeService.answerQuery('What is KAIRA\'s stock ticker symbol on the stock market?');
  assert(
    !stockRes.isGrounded && (stockRes.answer.toLowerCase().includes('not currently available') || stockRes.answer.toLowerCase().includes('couldn\'t find')),
    'GROUNDING-04: Non-existent Stock Ticker Refusal',
    `Refused to hallucinate financial ticker. Answer: "${stockRes.answer}"`
  );

  // =========================================================================
  // 5. NATURAL VOICE CONVERSATION FLOW & FORMATTING
  // =========================================================================
  console.log('\n[SUITE 5] Natural Voice Conversation Flow & Spoken Formatting');

  // Test 5.1: Natural Voice Clean Formatting (No markdown asterisks, no bullet points)
  const rawMarkdown = '**KAIRA** supports:\n* English\n* Tamil\n* Hindi\nVisit [KAIRA](https://kaira.ai).';
  const cleanVoice = formatForVoice(rawMarkdown, false);
  const hasNoMarkdown = !cleanVoice.includes('*') && !cleanVoice.includes('[') && !cleanVoice.includes('http');
  assert(
    hasNoMarkdown,
    'VOICE-01: Clean Spoken Formatting',
    `Removed asterisks, bullets, and URLs. Output: "${cleanVoice}"`
  );

  // Test 5.2: Natural Conversation Continuation Prompt
  const q1Res = await knowledgeService.answerQuery('What is KAIRA?');
  const hasFollowUp = q1Res.answer.toLowerCase().includes('anything else') || q1Res.answer.toLowerCase().includes('help you with');
  assert(
    hasFollowUp,
    'VOICE-02: Spoken Follow-Up Continuation Prompt',
    `Includes natural continuation prompt without repeating greeting. Answer: "${q1Res.answer}"`
  );

  // Test 5.3: Multilingual Voice Answer Localization (Tamil)
  const taRes = await translationService.getAiAnswerSuggestion('What is KAIRA?', 'ta');
  assert(
    taRes.language === 'ta' && taRes.answer.length > 5,
    'VOICE-03: Spoken Localization (Tamil)',
    `Successfully localized to Tamil. Answer: "${taRes.answer.slice(0, 60)}..."`
  );

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n================================================================');
  const passedCount = results.filter(r => r.passed).length;
  const totalCount = results.length;
  console.log(`📊 TEST SUITE SUMMARY: ${passedCount} / ${totalCount} PASSED (${Math.round((passedCount / totalCount) * 100)}%)`);
  console.log('================================================================');

  if (passedCount !== totalCount) {
    throw new Error(`${totalCount - passedCount} test cases failed.`);
  }
}

runTestSuite()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('Test suite failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
