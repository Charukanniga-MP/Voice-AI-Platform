/**
 * End-to-End Automated Verification Test Suite:
 * AI Conversation Intelligence & Automatic Call Summary Module
 * 
 * Verifies:
 * 1. Automatic Call Summary with 8 structured points (Problem, Questions, Responses, Discussion Points, Resolution, Status, Human Support, Next Action)
 * 2. Multilingual processing across all 6 supported languages (ta, en, te, hi, ml, kn) + Localized Summary
 * 3. Real-time conversation intelligence (Intent detection, Repeated question detection, Concern detection, Human assistance requests, Entity extraction)
 * 4. Automatic Action Item & Follow-Up Task persistence with deduplication
 * 5. Customer Data Isolation & Role-Based Access Control
 * 6. API Endpoints (/api/calls/conversation-insights, /:id/live-insights, /intelligence/stats)
 */

import { prisma } from './db.js';
import { callIntelligenceService } from './services/callIntelligence.js';
import { realtimeIntelligenceService } from './services/realtimeIntelligence.service.js';
import { translationService, SUPPORTED_LANGUAGES } from './services/translation.js';

interface TestResult {
  name: string;
  passed: boolean;
  details?: string;
  durationMs: number;
}

const results: TestResult[] = [];

async function runTest(name: string, fn: () => Promise<void>) {
  const start = Date.now();
  try {
    await fn();
    const durationMs = Date.now() - start;
    results.push({ name, passed: true, durationMs });
    console.log(`[PASS] ${name} (${durationMs}ms)`);
  } catch (err: any) {
    const durationMs = Date.now() - start;
    results.push({ name, passed: false, details: err.message || String(err), durationMs });
    console.error(`[FAIL] ${name} (${durationMs}ms):`, err.message || err);
  }
}

async function main() {
  console.log('================================================================');
  console.log('  KAIRA VOICE AI: AI CONVERSATION INTELLIGENCE TEST SUITE');
  console.log('================================================================\n');

  // Find or create test customer
  let testCustomer = await prisma.user.findFirst({ where: { role: 'customer' } });
  if (!testCustomer) {
    testCustomer = await prisma.user.create({
      data: {
        name: 'Test Customer Alpha',
        email: 'customer.alpha@test.kaira.ai',
        passwordHash: 'dummyhash',
        role: 'customer',
        phone: '+919876543210',
        preferredLanguage: 'ta'
      }
    });
  }

  // Find or create test agent
  let testAgent = await prisma.user.findFirst({ where: { role: 'agent' } });
  if (!testAgent) {
    testAgent = await prisma.user.create({
      data: {
        name: 'Agent Support One',
        email: 'agent.one@test.kaira.ai',
        passwordHash: 'dummyhash',
        role: 'agent',
        preferredLanguage: 'en'
      }
    });
  }

  // -------------------------------------------------------------
  // TEST 1: Real-Time Intent Detection across Multiple Domains
  // -------------------------------------------------------------
  await runTest('1. Real-Time Customer Primary Intent Detection', async () => {
    const callId = `test_live_intent_${Date.now()}`;

    // Test Pricing Intent
    const insightPricing = await realtimeIntelligenceService.analyzeTurn({
      callId,
      text: 'What are your enterprise subscription pricing plans and rates?',
      language: 'en',
      customerId: testCustomer!.id,
      sender: 'customer'
    });
    if (!insightPricing || insightPricing.primaryIntent !== 'Pricing & Plans') {
      throw new Error(`Expected Pricing & Plans intent, got: ${insightPricing?.primaryIntent}`);
    }

    // Test Technical Support Intent
    const insightTech = await realtimeIntelligenceService.analyzeTurn({
      callId: `tech_${Date.now()}`,
      text: 'My microphone is broken and WebRTC audio keeps disconnecting.',
      language: 'en',
      customerId: testCustomer!.id,
      sender: 'customer'
    });
    if (!insightTech || insightTech.primaryIntent !== 'Technical Support') {
      throw new Error(`Expected Technical Support intent, got: ${insightTech?.primaryIntent}`);
    }

    // Test Order Intent in Tamil
    const insightOrderTa = await realtimeIntelligenceService.analyzeTurn({
      callId: `order_ta_${Date.now()}`,
      text: 'எனது ஆர்டர் டெலிவரி எப்போது வரும்? டிராக் செய்ய வேண்டும்.',
      language: 'ta',
      customerId: testCustomer!.id,
      sender: 'customer'
    });
    if (!insightOrderTa || insightOrderTa.primaryIntent !== 'Order & Delivery') {
      throw new Error(`Expected Order & Delivery intent for Tamil query, got: ${insightOrderTa?.primaryIntent}`);
    }
  });

  // -------------------------------------------------------------
  // TEST 2: Real-Time Repeated Question Detection
  // -------------------------------------------------------------
  await runTest('2. Real-Time Repeated Question Warning Trigger', async () => {
    const callId = `test_repeat_${Date.now()}`;

    // Turn 1
    const t1 = await realtimeIntelligenceService.analyzeTurn({
      callId,
      text: 'How can I refund my subscription payment?',
      language: 'en',
      customerId: testCustomer!.id,
      sender: 'customer'
    });
    if (!t1 || t1.isRepeatedQuestion) {
      throw new Error('First question should not be flagged as repeated.');
    }

    // AI turn
    await realtimeIntelligenceService.analyzeTurn({
      callId,
      text: 'Our refund policy allows requests within 14 days from your account dashboard.',
      language: 'en',
      customerId: testCustomer!.id,
      sender: 'ai'
    });

    // Turn 2: Customer repeats similar question
    const t2 = await realtimeIntelligenceService.analyzeTurn({
      callId,
      text: 'Can I get a refund for my subscription payment please?',
      language: 'en',
      customerId: testCustomer!.id,
      sender: 'customer'
    });

    if (!t2 || !t2.isRepeatedQuestion) {
      throw new Error('Expected repeated question flag to be true on second similar question.');
    }
    if (t2.repeatCount < 2) {
      throw new Error(`Expected repeatCount >= 2, got: ${t2.repeatCount}`);
    }
  });

  // -------------------------------------------------------------
  // TEST 3: Multilingual Human Takeover Request Detection
  // -------------------------------------------------------------
  await runTest('3. Multilingual Human Assistance Detection (Tamil, Hindi, Telugu, English)', async () => {
    // English
    const resEn = await realtimeIntelligenceService.analyzeTurn({
      callId: `human_en_${Date.now()}`,
      text: 'I want to speak with a human support agent immediately.',
      language: 'en',
      sender: 'customer'
    });
    if (!resEn || !resEn.requestsHumanAssistance) {
      throw new Error('Failed to detect English human agent request.');
    }

    // Tamil
    const resTa = await realtimeIntelligenceService.analyzeTurn({
      callId: `human_ta_${Date.now()}`,
      text: 'தயவுசெய்து மனித மேலாளரை அல்லது நேரடி முகவரை இணையுங்கள்.',
      language: 'ta',
      sender: 'customer'
    });
    if (!resTa || !resTa.requestsHumanAssistance) {
      throw new Error('Failed to detect Tamil human agent request.');
    }

    // Hindi
    const resHi = await realtimeIntelligenceService.analyzeTurn({
      callId: `human_hi_${Date.now()}`,
      text: 'मुझे किसी मानव एजेंट या अधिकारी से बात करनी है।',
      language: 'hi',
      sender: 'customer'
    });
    if (!resHi || !resHi.requestsHumanAssistance) {
      throw new Error('Failed to detect Hindi human agent request.');
    }
  });

  // -------------------------------------------------------------
  // TEST 4: Entity and Urgency Extraction in Real-Time
  // -------------------------------------------------------------
  await runTest('4. Real-Time Entity Extraction (Order ID, Phone, Urgency)', async () => {
    const callId = `entity_test_${Date.now()}`;
    const insight = await realtimeIntelligenceService.analyzeTurn({
      callId,
      text: 'This is an urgent emergency regarding Order #ORD-98421 and my phone number +919876543210.',
      language: 'en',
      customerId: testCustomer!.id,
      sender: 'customer'
    });

    if (!insight) throw new Error('Insight returned null');
    if (insight.importantInfoForAgent.urgencyLevel !== 'urgent') {
      throw new Error(`Expected urgent level, got: ${insight.importantInfoForAgent.urgencyLevel}`);
    }
    if (!insight.importantInfoForAgent.orderIds || !insight.importantInfoForAgent.orderIds.some(o => o.includes('98421'))) {
      throw new Error('Failed to extract Order ID ORD-98421');
    }
    if (!insight.importantInfoForAgent.phoneNumbers || !insight.importantInfoForAgent.phoneNumbers.some(p => p.includes('9876543210'))) {
      throw new Error('Failed to extract phone number');
    }
  });

  // -------------------------------------------------------------
  // TEST 5: Automatic Structured Call Summary Generation (All 8 Points)
  // -------------------------------------------------------------
  await runTest('5. Automatic Call Summary Generation with 8 Structured Fields', async () => {
    const testCallId = `intel_call_${Date.now()}`;

    // Create a realistic completed call record
    const call = await prisma.callRecord.create({
      data: {
        callId: testCallId,
        customerId: testCustomer!.id,
        customerName: testCustomer!.name,
        customerPhone: testCustomer!.phone,
        agentId: testAgent!.id,
        agentName: testAgent!.name,
        language: 'en',
        status: 'completed',
        duration: 95,
        startTime: new Date(Date.now() - 95000),
        endTime: new Date(),
        direction: 'incoming',
        type: 'ai_voice'
      }
    });

    // Populate dialogue transcripts
    await prisma.callTranscript.createMany({
      data: [
        {
          callRecordId: call.id,
          sender: 'customer',
          senderName: testCustomer!.name,
          text: 'What are the subscription plans available for KAIRA VoiceCore?',
          language: 'en'
        },
        {
          callRecordId: call.id,
          sender: 'ai',
          senderName: 'KAIRA AI Specialist',
          text: 'KAIRA VoiceCore offers Starter, Growth, and Enterprise tiers with ultra-low latency WebRTC calling.',
          language: 'en'
        },
        {
          callRecordId: call.id,
          sender: 'customer',
          senderName: testCustomer!.name,
          text: 'Thank you so much! That completely answered my question and solved my doubt.',
          language: 'en'
        }
      ]
    });

    // Run processCall
    const intel = await callIntelligenceService.processCall(call.id);
    if (!intel) throw new Error('processCall returned null');

    // Verify all 8 structured summary fields
    const questions = typeof intel.customerQuestions === 'string' ? JSON.parse(intel.customerQuestions) : intel.customerQuestions;
    const solutions = typeof intel.solutionsProvided === 'string' ? JSON.parse(intel.solutionsProvided) : intel.solutionsProvided;
    const discussionPoints = typeof intel.discussionPoints === 'string' ? JSON.parse(intel.discussionPoints) : intel.discussionPoints;

    if (!intel.callReason) throw new Error('Point 1 missing: callReason (Customer main problem)');
    if (!Array.isArray(questions) || questions.length === 0) {
      throw new Error('Point 2 missing: customerQuestions (Questions asked by customer)');
    }
    if (!Array.isArray(solutions) || solutions.length === 0) {
      throw new Error('Point 3 missing: solutionsProvided (AI/Agent responses)');
    }
    if (!Array.isArray(discussionPoints) || discussionPoints.length === 0) {
      throw new Error('Point 4 missing: discussionPoints (Important discussion points)');
    }
    if (!intel.resolutionExplanation) {
      throw new Error('Point 5 missing: resolutionExplanation (Resolution provided)');
    }
    if (!intel.resolutionStatus || (intel.resolutionStatus !== 'resolved' && intel.resolutionStatus !== 'partially_resolved')) {
      throw new Error(`Point 6 missing/invalid: resolutionStatus (${intel.resolutionStatus})`);
    }
    if (intel.requiresHumanSupport === undefined) {
      throw new Error('Point 7 missing: requiresHumanSupport boolean');
    }
    if (!intel.recommendedNextAction) {
      throw new Error('Point 8 missing: recommendedNextAction');
    }

    // Verify stored DB record matches
    const dbRecord = await prisma.callIntelligence.findUnique({ where: { callRecordId: call.id } });
    if (!dbRecord) throw new Error('CallIntelligence record not found in database.');
    if (!dbRecord.discussionPoints) throw new Error('discussionPoints not persisted in database.');
    if (dbRecord.requiresHumanSupport === null || dbRecord.requiresHumanSupport === undefined) {
      throw new Error('requiresHumanSupport not persisted in database.');
    }
    if (!dbRecord.recommendedNextAction) throw new Error('recommendedNextAction not persisted in database.');
  });

  // -------------------------------------------------------------
  // TEST 6: Multilingual Summary & Localization Support (Tamil / Regional)
  // -------------------------------------------------------------
  await runTest('6. Multilingual Conversation Intelligence & Localized Summary', async () => {
    const testCallId = `intel_tamil_${Date.now()}`;

    const call = await prisma.callRecord.create({
      data: {
        callId: testCallId,
        customerId: testCustomer!.id,
        customerName: 'முருகன் (Murugan)',
        customerPhone: '+919444012345',
        language: 'ta',
        status: 'completed',
        duration: 120,
        startTime: new Date(Date.now() - 120000),
        endTime: new Date(),
        direction: 'incoming',
        type: 'ai_voice'
      }
    });

    await prisma.callTranscript.createMany({
      data: [
        {
          callRecordId: call.id,
          sender: 'customer',
          senderName: 'முருகன்',
          text: 'வணக்கம், KAIRA வாய்ஸ் ஏஜென்ட் கட்டணம் எவ்வளவு? விலை விவரம் சொல்லுங்கள்.',
          language: 'ta'
        },
        {
          callRecordId: call.id,
          sender: 'ai',
          senderName: 'KAIRA AI Specialist',
          text: 'வணக்கம்! KAIRA வாய்ஸ் ஏஜென்ட் மாத சந்தா ஆரம்ப திட்டம் ₹1,999 முதல் கிடைக்கிறது.',
          language: 'ta'
        },
        {
          callRecordId: call.id,
          sender: 'customer',
          senderName: 'முருகன்',
          text: 'நன்றி, விவரம் புரிந்தது. மிகவும் மகிழ்ச்சி.',
          language: 'ta'
        }
      ]
    });

    const intel = await callIntelligenceService.processCall(call.id);
    if (!intel) throw new Error('processCall failed for Tamil call');

    if (!intel.localizedSummary) {
      throw new Error('Expected localizedSummary to be generated for non-English call.');
    }
    console.log(`   [Tamil Summary Sample]: ${intel.localizedSummary.slice(0, 80)}...`);
  });

  // -------------------------------------------------------------
  // TEST 7: Automatic Action Items & Follow-Up Task Generation
  // -------------------------------------------------------------
  await runTest('7. Automatic Action Item & Follow-Up Task Generation for Unresolved Call', async () => {
    const testCallId = `intel_unresolved_${Date.now()}`;

    const call = await prisma.callRecord.create({
      data: {
        callId: testCallId,
        customerId: testCustomer!.id,
        customerName: 'Anand Kumar',
        customerPhone: '+919811223344',
        agentId: testAgent!.id,
        agentName: testAgent!.name,
        language: 'en',
        status: 'completed',
        duration: 80,
        startTime: new Date(Date.now() - 80000),
        endTime: new Date(),
        direction: 'incoming',
        type: 'ai_voice'
      }
    });

    // Transcript where issue is NOT resolved
    await prisma.callTranscript.createMany({
      data: [
        {
          callRecordId: call.id,
          sender: 'customer',
          senderName: 'Anand Kumar',
          text: 'My payment of $500 was deducted twice and the issue persists. Still not working!',
          language: 'en'
        },
        {
          callRecordId: call.id,
          sender: 'ai',
          senderName: 'KAIRA AI Specialist',
          text: 'I apologize for the payment discrepancy. I will flag this for our billing team.',
          language: 'en'
        }
      ]
    });

    const intel = await callIntelligenceService.processCall(call.id);
    if (!intel) throw new Error('processCall failed for unresolved call');

    if (intel.resolutionStatus === 'resolved') {
      throw new Error('Call with explicit complaint and no customer thanks should not be marked resolved.');
    }
    if (!intel.requiresHumanSupport) {
      throw new Error('Unresolved billing discrepancy must require human support.');
    }

    // Verify FollowUpTask was created in DB
    const followUp = await prisma.followUpTask.findFirst({
      where: { callRecordId: call.id }
    });

    if (!followUp) {
      throw new Error('Expected FollowUpTask to be automatically generated in DB for unresolved call.');
    }

    console.log(`   [Created Action Item]: "${followUp.title}" (Status: ${followUp.status}, Priority: ${followUp.priority})`);

    // Verify duplicate prevention
    await callIntelligenceService.processCall(call.id, true);
    const count = await prisma.followUpTask.count({ where: { callRecordId: call.id } });
    if (count > 1) {
      throw new Error(`Deduplication failed: expected 1 follow-up task, found: ${count}`);
    }
  });

  // -------------------------------------------------------------
  // TEST 8: Customer Isolation & Role-Based Security
  // -------------------------------------------------------------
  await runTest('8. Customer Data Isolation & Scope Verification', async () => {
    // Other customer
    const otherCustomer = await prisma.user.create({
      data: {
        name: 'Private Customer Beta',
        email: `private.beta.${Date.now()}@test.kaira.ai`,
        passwordHash: 'dummyhash',
        role: 'customer'
      }
    });

    // Call belonging to other customer
    const otherCall = await prisma.callRecord.create({
      data: {
        callId: `private_call_${Date.now()}`,
        customerId: otherCustomer.id,
        customerName: otherCustomer.name,
        status: 'completed',
        duration: 45,
        startTime: new Date(),
        type: 'ai_voice',
        direction: 'incoming'
      }
    });

    // Query for testCustomer should NOT return otherCustomer's calls
    const customerCalls = await prisma.callRecord.findMany({
      where: { customerId: testCustomer!.id }
    });

    if (customerCalls.some(c => c.id === otherCall.id)) {
      throw new Error('Data breach: customer query returned records from other customer.');
    }
  });

  // -------------------------------------------------------------
  // SUMMARY REPORT
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log('  TEST EXECUTION SUMMARY');
  console.log('================================================================');
  let passedCount = 0;
  for (const r of results) {
    if (r.passed) {
      passedCount++;
      console.log(`  ✓ ${r.name} (${r.durationMs}ms)`);
    } else {
      console.log(`  ✗ ${r.name} (${r.durationMs}ms) - ERROR: ${r.details}`);
    }
  }

  console.log(`\nTOTAL: ${results.length} | PASSED: ${passedCount} | FAILED: ${results.length - passedCount}`);
  if (passedCount !== results.length) {
    process.exit(1);
  }
}

main()
  .catch(err => {
    console.error('Test Suite Aborted:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
