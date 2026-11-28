import { prisma } from '../db.js';
import {
  aiEvaluationService,
  calculateWER,
  calculateCER,
  extractClaims,
  tokenizeWords,
  generateTraceId,
  generateSpanId
} from '../services/aiEvaluation.service.js';

let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ [PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${testName} ${detail ? `- ${detail}` : ''}`);
    failedTests++;
  }
}

async function runTestSuite() {
  console.log('\n===============================================================');
  console.log('🧪 KAIRA AI QUALITY EVALUATION & OBSERVABILITY TEST SUITE');
  console.log('===============================================================\n');

  // --------------------------------------------------------------------------
  // TEST 1: Answer Relevance Scorer
  // --------------------------------------------------------------------------
  console.log('--- Test Group 1: Answer Relevance Scoring ---');
  {
    // 1.1 Relevant Answer
    const q1 = "How do I update the shipping address on my order?";
    const a1 = "You can update your shipping address in your order history before the order ships.";
    const rel1 = aiEvaluationService.evaluateAnswerRelevance(q1, a1);
    assert(rel1.isRelevant && rel1.score >= 0.70, '1.1 Relevant answer scores >= 0.70', `Score: ${rel1.score}`);

    // 1.2 Irrelevant Deflection (Self-absorbed architectural explanation)
    const q2 = "I want to return a defective keyboard.";
    const a2 = "KAIRA captures your voice using WebRTC and Web Speech recognition while querying SQLite via Prisma ORM and Reciprocal Rank Fusion.";
    const rel2 = aiEvaluationService.evaluateAnswerRelevance(q2, a2);
    assert(!rel2.isRelevant && rel2.score <= 0.35, '1.2 Self-absorbed architectural deflection penalized <= 0.35', `Score: ${rel2.score}`);
    assert(rel2.explanation.includes('architecture'), '1.3 Deflection explanation correctly mentions architectural deflection');
  }

  // --------------------------------------------------------------------------
  // TEST 2: Answer Correctness & Hallucination Detection
  // --------------------------------------------------------------------------
  console.log('\n--- Test Group 2: Answer Correctness & Hallucination Detection ---');
  {
    const kbSnippet = "Standard shipping takes 3-5 business days. Express shipping delivers within 24 hours for an additional $15 fee. Returns are accepted within 30 days of purchase.";

    // 2.1 Fully Grounded Answer
    const q1 = "What are your shipping times and return window?";
    const a1 = "Standard shipping takes 3-5 business days. You can also return items within 30 days.";
    const res1 = aiEvaluationService.evaluateCorrectnessAndHallucination(q1, a1, kbSnippet);
    assert(res1.correctness.score >= 0.85, '2.1 Fully grounded answer scores high correctness >= 0.85', `Score: ${res1.correctness.score}`);
    assert(!res1.hallucination.isHallucination, '2.2 Fully grounded answer has isHallucination = false');
    assert(res1.hallucination.hallucinationScore <= 0.20, '2.3 Hallucination score is low', `Score: ${res1.hallucination.hallucinationScore}`);

    // 2.2 Hallucinated Unsupported Claims
    const q2 = "Can I get international shipping to Antarctica for free?";
    const a2 = "Yes, we offer completely free worldwide delivery to Antarctica with complimentary drone air-drops on weekends.";
    const res2 = aiEvaluationService.evaluateCorrectnessAndHallucination(q2, a2, kbSnippet);
    assert(res2.hallucination.isHallucination, '2.4 Hallucinated answer flagged isHallucination = true');
    assert(res2.hallucination.unsupportedClaims.length > 0, '2.5 Unsupported claims extracted');
    assert(res2.correctness.score <= 0.40, '2.6 Hallucinated answer correctness <= 0.40', `Score: ${res2.correctness.score}`);
  }

  // --------------------------------------------------------------------------
  // TEST 3: RAGAS-Compatible RAG Evaluation
  // --------------------------------------------------------------------------
  console.log('\n--- Test Group 3: RAGAS Context Precision & Recall ---');
  {
    const query = "How do I reset my account password?";
    const relevantChunk = "To reset your password, click 'Forgot Password' on the login screen and enter your registered email address.";
    const irrelevantChunk = "Our office headquarters are located in San Francisco, California.";

    const ragGood = aiEvaluationService.evaluateRAG(query, [relevantChunk, irrelevantChunk], relevantChunk);
    assert(ragGood.contextPrecision >= 0.50, '3.1 Context precision calculated accurately', `Precision: ${ragGood.contextPrecision}`);
    assert(ragGood.kbCoverage >= 0.60, '3.2 Query KB coverage calculated accurately', `Coverage: ${ragGood.kbCoverage}`);
    assert(!ragGood.retrievalFailure, '3.3 No retrieval failure when top chunk matches');

    // Retrieval Failure test
    const ragFail = aiEvaluationService.evaluateRAG("billing refund policy dispute", [irrelevantChunk]);
    assert(ragFail.retrievalFailure, '3.4 Retrieval failure correctly flagged for irrelevant chunks');
  }

  // --------------------------------------------------------------------------
  // TEST 4: Speech Recognition Accuracy (Exact WER & CER)
  // --------------------------------------------------------------------------
  console.log('\n--- Test Group 4: Speech Recognition WER & CER ---');
  {
    const ref = "the quick brown fox jumps over the lazy dog";
    const hypIdentical = "the quick brown fox jumps over the lazy dog";
    const hypOneError = "the quick brown fox jumped over the lazy dog"; // 1 substitution ("jumped") out of 9 words

    const werZero = calculateWER(hypIdentical, ref);
    const cerZero = calculateCER(hypIdentical, ref);
    assert(werZero === 0.0, '4.1 Exact WER for identical transcript is 0.0');
    assert(cerZero === 0.0, '4.2 Exact CER for identical transcript is 0.0');

    const werOne = calculateWER(hypOneError, ref);
    assert(werOne > 0.10 && werOne < 0.15, '4.3 WER for 1 substitution in 9 words is ~0.1111', `WER: ${werOne}`);

    // Evaluation without reference transcript
    const speechNoRef = aiEvaluationService.evaluateSpeechRecognition("I need help with my account");
    assert(speechNoRef.wer === null, '4.4 WER is null when no ground-truth reference transcript provided (never hallucinated)');
    assert(!speechNoRef.hasAudioFailure, '4.5 Fluency passes without audio failure');
  }

  // --------------------------------------------------------------------------
  // TEST 5: OpenTelemetry Distributed Latency Tracing
  // --------------------------------------------------------------------------
  console.log('\n--- Test Group 5: OpenTelemetry Latency Tracing ---');
  {
    const traceId = generateTraceId();
    const spanId = generateSpanId();
    assert(traceId.length === 32, '5.1 Trace ID is 32 hex chars (16 bytes)');
    assert(spanId.length === 16, '5.2 Span ID is 16 hex chars (8 bytes)');

    const span = aiEvaluationService.createTraceSpan('stt_transcription', traceId);
    assert(span.traceId === traceId, '5.3 Span inherits trace ID');
    assert(span.startTime > 0, '5.4 Span has valid start timestamp');

    const endedSpan = aiEvaluationService.endTraceSpan(span, { confidence: 0.98 });
    assert(endedSpan.durationMs !== undefined && endedSpan.durationMs >= 0, '5.5 Ended span has valid duration');
    assert(endedSpan.attributes.confidence === 0.98, '5.6 Span preserves custom attributes');
  }

  // --------------------------------------------------------------------------
  // TEST 6: Repeated-Question Detection
  // --------------------------------------------------------------------------
  console.log('\n--- Test Group 6: Repeated-Question Repetition Detection ---');
  {
    const prevQuestions = [
      { turnId: 1, text: "Could you please provide your order number?", wasAnswered: true },
      { turnId: 2, text: "What is your email address?", wasAnswered: true }
    ];

    const duplicateQ = "Could you give me your order number please?";
    const rep1 = aiEvaluationService.detectQuestionRepetition(duplicateQ, prevQuestions);
    assert(rep1.isRepetition, '6.1 Semantically duplicate question flagged as repetition');
    assert(rep1.previousTurnId === 1, '6.2 Correctly identified previous turn #1 as source of repetition');

    const novelQ = "Would you like a replacement or a direct refund?";
    const rep2 = aiEvaluationService.detectQuestionRepetition(novelQ, prevQuestions);
    assert(!rep2.isRepetition, '6.3 Novel question is NOT flagged as repetition');
  }

  // --------------------------------------------------------------------------
  // TEST 7: Dynamic Weight Normalization (No Treating Missing Metrics as 0)
  // --------------------------------------------------------------------------
  console.log('\n--- Test Group 7: Dynamic Missing-Metric Weight Normalization ---');
  {
    // Case A: All metrics present
    const fullMetrics = {
      relevanceAvg: 0.95,       // 95
      correctnessAvg: 0.90,     // 90
      hallucinationRate: 5.0,   // 95 control
      retrievalAccuracyAvg: 0.85, // 85
      speechAccuracyAvg: 0.90,  // 90
      handoverSuccessRate: 1.0, // 100
      csatScore: 4.5,           // 90
      repetitionRate: 0.0       // 100 control
    };
    const scoreA = aiEvaluationService.calculateOverallQualityScore(fullMetrics);
    assert(scoreA.evaluatedCount === 8, '7.1 Full metrics evaluated count = 8');
    assert(scoreA.overallScore >= 90 && scoreA.overallScore <= 95, '7.2 Full score in expected range', `Score: ${scoreA.overallScore}`);

    // Case B: Missing handover, CSAT, and speech accuracy
    const partialMetrics = {
      relevanceAvg: 0.95,
      correctnessAvg: 0.90,
      hallucinationRate: 0.0,
      retrievalAccuracyAvg: 0.90,
      speechAccuracyAvg: null, // missing
      handoverSuccessRate: null, // missing
      csatScore: null, // missing
      repetitionRate: 0.0
    };
    const scoreB = aiEvaluationService.calculateOverallQualityScore(partialMetrics);
    assert(scoreB.evaluatedCount === 5, '7.3 Partial metrics evaluated count = 5');
    // Sum of normalized weights should equal 1.0
    const weightSum = Object.values(scoreB.normalizedWeights).reduce((a, b) => a + b, 0);
    assert(Math.abs(weightSum - 1.0) < 0.005, '7.4 Re-normalized weights sum to 1.0 (100%)', `Sum: ${weightSum}`);
    assert(scoreB.overallScore >= 90, '7.5 Score NOT penalized for missing metrics', `Score: ${scoreB.overallScore}`);
  }

  // --------------------------------------------------------------------------
  // TEST 8: End-to-End Call Evaluation & Persistence
  // --------------------------------------------------------------------------
  console.log('\n--- Test Group 8: End-to-End Database Evaluation & Alerts ---');
  {
    // Create test call record
    const testCallId = `test_eval_${Date.now()}`;
    const callRecord = await prisma.callRecord.create({
      data: {
        callId: testCallId,
        customerName: 'Evaluation Test User',
        type: 'ai_voice',
        direction: 'incoming',
        status: 'completed',
        duration: 45,
        rating: 5,
        ratingComment: 'Excellent AI assistance!'
      }
    });

    // Add transcripts
    await prisma.callTranscript.createMany({
      data: [
        {
          callRecordId: callRecord.id,
          sender: 'customer',
          text: 'How can I change my subscription plan?'
        },
        {
          callRecordId: callRecord.id,
          sender: 'ai',
          text: 'You can change your subscription plan directly from your account billing settings.'
        }
      ]
    });

    // Run evaluation
    const summary = await aiEvaluationService.evaluateConversation(callRecord.id);
    assert(summary !== null, '8.1 Conversation evaluated successfully');
    assert(summary!.overallQualityScore > 75, '8.2 Quality score recorded in DB', `Score: ${summary?.overallQualityScore}`);

    // Verify DB records
    const convDb = await prisma.conversationEvaluation.findUnique({
      where: { callRecordId: callRecord.id }
    });
    assert(convDb !== null, '8.3 ConversationEvaluation persisted in SQLite database');
    assert(convDb?.evaluationStatus === 'completed', '8.4 Evaluation status is completed');

    const turnsDb = await prisma.aIResponseEvaluation.findMany({
      where: { callRecordId: callRecord.id }
    });
    assert(turnsDb.length > 0, '8.5 AIResponseEvaluation turns persisted in SQLite');

    // Clean up test call
    await prisma.callRecord.delete({ where: { id: callRecord.id } });
    assert(true, '8.6 Test fixtures cleaned up safely');
  }

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log('\n===============================================================');
  console.log(`🏁 TEST SUITE COMPLETE: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('===============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('[TestSuite] Unhandled error:', err);
  process.exit(1);
});
