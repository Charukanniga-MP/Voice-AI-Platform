import { prisma } from './db.js';
import { sentimentService } from './services/sentiment.js';
import jwt from 'jsonwebtoken';
import { env } from './config/env.js';

const BASE_URL = 'http://localhost:5000/api';

async function runSentimentTestSuite() {
  console.log('\n=============================================================');
  console.log('🧪 RUNNING KAIRA AI SENTIMENT ANALYSIS TEST SUITE');
  console.log('=============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, title: string, details?: string) {
    if (condition) {
      console.log(`✓ PASS: ${title}`);
      passed++;
    } else {
      console.error(`✗ FAIL: ${title}`);
      if (details) console.error(`   Details: ${details}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // Setup Test Users and Tokens
    // -------------------------------------------------------------
    const adminUser = await prisma.user.findFirst({ where: { role: 'admin' } });
    const customerUser = await prisma.user.findFirst({ where: { role: 'customer' } }) ||
      await prisma.user.create({
        data: {
          name: 'Test Customer',
          email: `test_sentiment_${Date.now()}@example.com`,
          role: 'customer',
          passwordHash: 'dummyhash'
        }
      });

    const adminToken = jwt.sign(
      { id: adminUser!.id, email: adminUser!.email, role: 'admin' },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    const customerToken = jwt.sign(
      { id: customerUser.id, email: customerUser.email, role: 'customer' },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // -------------------------------------------------------------
    // Test 1: Positive Customer Conversation (English)
    // -------------------------------------------------------------
    console.log('\n--- 1. Testing Core Sentiment Categories ---');
    const posText = 'Thank you, your service was very helpful.';
    const posResult = sentimentService.analyzeText(posText, 'en');
    assert(
      posResult.sentiment === 'POSITIVE' && posResult.confidenceScore >= 0.75,
      '1. Positive customer conversation identified as POSITIVE with high confidence',
      `Got ${posResult.sentiment} (confidence: ${posResult.confidenceScore})`
    );

    // -------------------------------------------------------------
    // Test 2: Negative Customer Conversation (English)
    // -------------------------------------------------------------
    const negText = 'I am not satisfied with your service.';
    const negResult = sentimentService.analyzeText(negText, 'en');
    assert(
      negResult.sentiment === 'NEGATIVE' && negResult.confidenceScore >= 0.70,
      '2. Negative customer conversation identified as NEGATIVE with high confidence',
      `Got ${negResult.sentiment} (confidence: ${negResult.confidenceScore})`
    );

    // -------------------------------------------------------------
    // Test 3: Neutral Customer Conversation (English)
    // -------------------------------------------------------------
    const neuText = 'I want to know the status of my order.';
    const neuResult = sentimentService.analyzeText(neuText, 'en');
    assert(
      neuResult.sentiment === 'NEUTRAL',
      '3. Neutral customer inquiry identified as NEUTRAL',
      `Got ${neuResult.sentiment} (confidence: ${neuResult.confidenceScore})`
    );

    // -------------------------------------------------------------
    // Test 4: Frustrated Customer Conversation (English)
    // -------------------------------------------------------------
    const fruText = 'I have called several times, but nobody is helping me. This is very frustrating.';
    const fruResult = sentimentService.analyzeText(fruText, 'en');
    assert(
      fruResult.sentiment === 'FRUSTRATED' && fruResult.confidenceScore >= 0.80,
      '4. Strong complaint identified as FRUSTRATED with high confidence',
      `Got ${fruResult.sentiment} (confidence: ${fruResult.confidenceScore})`
    );

    // -------------------------------------------------------------
    // Multilingual Tests (5 Supported Regional Languages)
    // -------------------------------------------------------------
    console.log('\n--- 2. Testing Multilingual Sentiment Analysis ---');

    // Test 6: Tamil (தமிழ்)
    const taText = 'மிக்க நன்றி, உங்கள் சேவை மிகவும் உதவியாக இருந்தது.';
    const taResult = sentimentService.analyzeText(taText, 'ta');
    assert(
      taResult.sentiment === 'POSITIVE',
      '6. Tamil customer appreciation correctly classified as POSITIVE',
      `Got ${taResult.sentiment}`
    );

    // Test 7: English
    const enText = 'Where is my package located?';
    const enResult = sentimentService.analyzeText(enText, 'en');
    assert(
      enResult.sentiment === 'NEUTRAL',
      '7. English informational inquiry correctly classified as NEUTRAL',
      `Got ${enResult.sentiment}`
    );

    // Test 8: Telugu (తెలుగు)
    const teText = 'చాలా సార్లు కాల్ చేశాను, ఎవరూ సహాయం చేయడం లేదు. చాలా విసుగుగా ఉంది.';
    const teResult = sentimentService.analyzeText(teText, 'te');
    assert(
      teResult.sentiment === 'FRUSTRATED',
      '8. Telugu repeated complaint correctly classified as FRUSTRATED',
      `Got ${teResult.sentiment}`
    );

    // Test 9: Malayalam (മലയാളം)
    const mlText = 'എനിക്ക് ഈ സേവനത്തിൽ തൃപ്തിയില്ല, പ്രശ്നം ഉണ്ട്.';
    const mlResult = sentimentService.analyzeText(mlText, 'ml');
    assert(
      mlResult.sentiment === 'NEGATIVE',
      '9. Malayalam dissatisfaction correctly classified as NEGATIVE',
      `Got ${mlResult.sentiment}`
    );

    // Test 10: Hindi (हिन्दी)
    const hiText = 'धन्यवाद, आपकी सहायता बहुत अच्छी और संतोषजनक थी।';
    const hiResult = sentimentService.analyzeText(hiText, 'hi');
    assert(
      hiResult.sentiment === 'POSITIVE',
      '10. Hindi appreciation correctly classified as POSITIVE',
      `Got ${hiResult.sentiment}`
    );

    // -------------------------------------------------------------
    // Test 5: Mixed Sentiment during a Single Active Call
    // -------------------------------------------------------------
    console.log('\n--- 3. Testing Real-Time Call Session & Assistance Priority ---');
    const testCallId = `test_call_sentiment_${Date.now()}`;

    // Create CallRecord in DB
    const callRecord = await prisma.callRecord.create({
      data: {
        callId: testCallId,
        customerId: customerUser.id,
        customerName: 'Alex Sentiment Tester',
        customerPhone: '+15550199',
        type: 'ai_voice',
        direction: 'incoming',
        status: 'active',
        language: 'en',
        startTime: new Date()
      }
    });

    // Utterance 1: Neutral
    const u1 = await sentimentService.processCustomerUtterance({
      callId: testCallId,
      text: 'I want to check my subscription details.',
      language: 'en',
      customerId: customerUser.id
    });
    assert(
      u1.sentiment === 'NEUTRAL' && !u1.requiresHumanAssistance,
      '5.1 First utterance: Neutral inquiry does not trigger human assistance',
      `Got ${u1.sentiment}, assistance: ${u1.requiresHumanAssistance}`
    );

    // Utterance 2: Negative
    const u2 = await sentimentService.processCustomerUtterance({
      callId: testCallId,
      text: 'Your billing system has a mistake and charged me twice.',
      language: 'en',
      customerId: customerUser.id
    });
    assert(
      u2.sentiment === 'NEGATIVE',
      '5.2 Second utterance: Issue complaint classified as NEGATIVE',
      `Got ${u2.sentiment}`
    );

    // Utterance 3: Severe Frustration -> Escalates to Human Assistance Priority
    const u3 = await sentimentService.processCustomerUtterance({
      callId: testCallId,
      text: 'I have called several times, nobody helps me and this is very frustrating!',
      language: 'en',
      customerId: customerUser.id
    });
    assert(
      u3.sentiment === 'FRUSTRATED' && u3.requiresHumanAssistance,
      '11. Severe frustration triggers Human Assistance Priority recommendation',
      `Got ${u3.sentiment}, assistance: ${u3.requiresHumanAssistance}`
    );

    // Verify DB update on CallRecord
    const updatedCall = await prisma.callRecord.findUnique({ where: { callId: testCallId } });
    assert(
      updatedCall?.requiresAssistance === true && updatedCall.assistanceStatus === 'pending',
      '11.1 CallRecord marked as requiring assistance in database with pending status',
      `requiresAssistance: ${updatedCall?.requiresAssistance}, status: ${updatedCall?.assistanceStatus}`
    );

    // -------------------------------------------------------------
    // Test 12: Manual Override of Assistance Recommendation
    // -------------------------------------------------------------
    console.log('\n--- 4. Testing Manual Agent/Admin Override ---');
    const overrideRes = await fetch(`${BASE_URL}/sentiment/calls/${testCallId}/override`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: 'dismissed' })
    });

    assert(
      overrideRes.status === 200,
      '12. Agent/Admin can override or dismiss human assistance recommendation via API',
      `HTTP status: ${overrideRes.status}`
    );

    const callAfterOverride = await prisma.callRecord.findUnique({ where: { callId: testCallId } });
    assert(
      callAfterOverride?.assistanceStatus === 'dismissed',
      '12.1 Override reflected in database (status: dismissed)',
      `assistanceStatus: ${callAfterOverride?.assistanceStatus}`
    );

    // -------------------------------------------------------------
    // Test 13: Post-Call Sentiment Summary & Historical Persistence
    // -------------------------------------------------------------
    console.log('\n--- 5. Testing Post-Call Summary & History ---');
    const summary = await sentimentService.finalizeCall(testCallId);
    assert(
      summary !== null && summary.frustrationDetected === true,
      '13. Finalized call generates Post-Call Sentiment Summary with frustration detection',
      `Overall: ${summary?.overallSentiment}, Frustration: ${summary?.frustrationDetected}`
    );

    const finalRecord = await prisma.sentimentAnalysis.findFirst({
      where: { callRecordId: callRecord.id, isFinal: true }
    });
    assert(
      finalRecord !== null && finalRecord.sentiment === 'FRUSTRATED',
      '13.1 Final aggregate sentiment record persisted to SentimentAnalysis table',
      `Persisted sentiment: ${finalRecord?.sentiment}, isFinal: ${finalRecord?.isFinal}`
    );

    // Test GET /api/sentiment/calls/:callId
    const getCallSentimentRes = await fetch(`${BASE_URL}/sentiment/calls/${testCallId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const callSentimentData = await getCallSentimentRes.json();
    assert(
      getCallSentimentRes.status === 200 && callSentimentData.sentimentRecords.length >= 3,
      '13.2 GET /api/sentiment/calls/:callId returns full historical utterance updates',
      `Found ${callSentimentData.sentimentRecords?.length} records`
    );

    // -------------------------------------------------------------
    // Test 14: Security & Permissions (RBAC Enforcement)
    // -------------------------------------------------------------
    console.log('\n--- 6. Testing RBAC & Access Control ---');

    // 14.1 Customer access rejected with 403 Forbidden
    const custAnalyticsRes = await fetch(`${BASE_URL}/sentiment/analytics`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    assert(
      custAnalyticsRes.status === 403,
      '14.1 Unauthorized customer blocked from sentiment analytics with HTTP 403',
      `HTTP status: ${custAnalyticsRes.status}`
    );

    // 14.2 Admin access granted with 200 OK and real database statistics
    const adminAnalyticsRes = await fetch(`${BASE_URL}/sentiment/analytics?period=all`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const analyticsData = await adminAnalyticsRes.json();
    assert(
      adminAnalyticsRes.status === 200 &&
      typeof analyticsData.totalAnalyzed === 'number' &&
      analyticsData.counts !== undefined &&
      analyticsData.percentages !== undefined,
      '14.2 Admin granted access to real sentiment analytics with calculated percentages',
      `Total analyzed: ${analyticsData.totalAnalyzed}, Frustrated count: ${analyticsData.counts?.frustrated}`
    );

    // Clean up test call
    await prisma.sentimentAnalysis.deleteMany({ where: { callRecordId: callRecord.id } });
    await prisma.callRecord.delete({ where: { id: callRecord.id } });

  } catch (err: any) {
    console.error('Unexpected test suite error:', err);
    failed++;
  }

  console.log('\n=============================================================');
  console.log(`🎉 TEST SUMMARY: ${passed} / ${passed + failed} TESTS PASSED (${failed === 0 ? '100%' : 'SOME FAILED'})`);
  console.log('=============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSentimentTestSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

