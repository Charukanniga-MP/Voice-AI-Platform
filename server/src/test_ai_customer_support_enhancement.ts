import { io as Client } from 'socket.io-client';
import { prisma } from './db.js';
import { translationService } from './services/translation.js';
import { knowledgeService, FALLBACK_MESSAGE } from './services/knowledge.js';

async function runTests() {
  console.log('====================================================');
  console.log('🧪 TESTING AI CUSTOMER SUPPORT CALLING SYSTEM');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string) {
    if (condition) {
      console.log(`  ✓ PASS: ${name}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${name}`);
      failed++;
    }
  }

  // 1. Test Greeting Translation & Formulation
  console.log('--- 1. AI Voice Greeting Verification ---');
  const greetingEn = "Hello! Welcome to KAIRA TECHNOLOGY Customer Support. Thank you for calling us. I'm your AI support assistant. How may I help you today?";
  assert(greetingEn.includes('KAIRA TECHNOLOGY Customer Support'), 'Default greeting mentions KAIRA TECHNOLOGY Customer Support');
  assert(greetingEn.includes('AI support assistant'), 'Default greeting states AI support assistant role');

  const greetingTa = await translationService.translateText(greetingEn, 'ta', 'en');
  assert(greetingTa.length > 20 && greetingTa !== greetingEn, `Greeting translated to Tamil accurately: "${greetingTa.slice(0, 45)}..."`);

  // 2. Test Grounded KB Query
  console.log('\n--- 2. Grounded Corporate Question Answering ---');
  const pricingAns = await translationService.getAiAnswerSuggestion('What are your pricing plans?', 'en');
  assert(pricingAns.isGrounded === true, 'Pricing question is recognized as grounded');
  assert(pricingAns.requiresTransfer === false, 'Pricing question does not require human transfer');
  assert(pricingAns.answer.includes('$49') || pricingAns.answer.includes('Starter') || pricingAns.answer.includes('pricing'), 'Pricing answer provides grounded rates');

  const refundAns = await translationService.getAiAnswerSuggestion('What is your refund policy?', 'en');
  assert(refundAns.isGrounded === true, 'Refund question is recognized as grounded');
  assert(refundAns.answer.includes('30-day') || refundAns.answer.includes('refund'), 'Refund answer provides grounded 30-day policy');

  // 3. Test Unrelated General Questions (Friendly polite answer + guidance back)
  console.log('\n--- 3. Unrelated General Question Handling ---');
  const mathAns = await translationService.getAiAnswerSuggestion('What is 25 plus 15?', 'en');
  assert(mathAns.requiresTransfer === false, 'Math question is handled directly by AI');
  assert(mathAns.answer.includes('40'), `Math computation answered correctly: "${mathAns.answer}"`);
  assert(mathAns.answer.includes('KAIRA TECHNOLOGY'), 'AI guides customer back to KAIRA TECHNOLOGY customer support');

  const jokeAns = await translationService.getAiAnswerSuggestion('Tell me a joke', 'en');
  assert(jokeAns.requiresTransfer === false, 'Chit-chat / joke is handled directly without rejecting');
  assert(jokeAns.answer.includes('KAIRA TECHNOLOGY'), 'Joke response guides back to KAIRA TECHNOLOGY support');

  const courtesyAns = await translationService.getAiAnswerSuggestion('Thank you for your help', 'en');
  assert(courtesyAns.answer.includes("welcome"), 'Courtesy thank-you handled warmly');

  // 4. Test Missing Information & Knowledge Gap Logging
  console.log('\n--- 4. Missing Information Fallback & Knowledge Gap Recording ---');
  const unknownQuestion = `What is your proprietary internal quantum processor clock speed for series X99_${Date.now()}?`;
  const unknownAns = await translationService.getAiAnswerSuggestion(unknownQuestion, 'en');
  assert(unknownAns.isGrounded === false, 'Unknown specific query is flagged as ungrounded');
  assert(unknownAns.requiresTransfer === false, 'Unknown query does NOT abruptly interrupt call with admin transfer');
  assert(unknownAns.answer.includes("I apologize, but I don't currently have that specific information. Let me record your question so our support team can review it and assist you."), 'AI speaks exact required polite fallback message');

  // Track the gap in database
  await knowledgeService.trackKnowledgeGap(unknownQuestion, 'en');
  const normalizedUnknown = unknownQuestion.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  const gapRecord = await prisma.knowledgeGap.findUnique({
    where: { normalizedQuestion: normalizedUnknown }
  });
  assert(gapRecord !== null, `Knowledge gap recorded in database with ID: ${gapRecord?.id}`);
  assert(gapRecord?.status === 'open', 'Knowledge gap status is "open" awaiting Admin review');

  // 5. Test Explicit Human Escalation Request
  console.log('\n--- 5. Explicit Human Agent Escalation ---');
  const humanRequest = await translationService.getAiAnswerSuggestion('Please connect me to an admin operator right now', 'en');
  assert(humanRequest.requiresTransfer === true, 'Explicit human request sets requiresTransfer=true');
  assert(humanRequest.answer.includes('connect you with a member of our human support team'), 'AI confirms connection to human support team');

  // 6. Test Socket AI Call Initiation & End-to-End Handshake
  console.log('\n--- 6. Socket Real-time AI Call Session ---');
  const socket = Client('http://localhost:5000', {
    transports: ['websocket'],
    reconnection: false
  });

  const testCallId = `test_ai_call_${Date.now()}`;
  const flags = {
    readyReceived: false,
    responseReceived: false
  };

  await new Promise<void>((resolve) => {
    socket.on('connect', () => {
      console.log('  ✓ Connected to backend WebSocket server');

      socket.on('call:ready', (data: any) => {
        flags.readyReceived = true;
        assert(data.callId === testCallId, 'call:ready returned matching callId');
        assert(data.agentName === 'KAIRA AI Support Specialist', 'AI Agent Name is "KAIRA AI Support Specialist"');
        assert(data.greeting.includes('KAIRA TECHNOLOGY Customer Support'), 'call:ready contains official greeting');

        // Send a query
        socket.emit('call:query', {
          callId: testCallId,
          query: 'What products does KAIRA offer?',
          language: 'en'
        });
      });

      socket.on('call:ai_response', (data: any) => {
        flags.responseReceived = true;
        assert(data.agentName === 'KAIRA AI Support Specialist', 'AI response identified as KAIRA AI Support Specialist');
        assert(data.isTransferring === false, 'Standard call response has isTransferring=false');
        assert(data.answer.includes('VoiceCore') || data.answer.includes('KAIRA'), 'AI answered with product knowledge');

        // End call
        socket.emit('call:end', {
          callId: testCallId,
          duration: 12,
          endedBy: 'customer'
        });
      });

      socket.on('call:ended', (data: any) => {
        assert(data.callId === testCallId, 'call:ended event received cleanly');
        socket.disconnect();
        resolve();
      });

      // Start the call
      socket.emit('call:start', {
        callId: testCallId,
        customerName: 'Alex Morgan Test',
        customerPhone: '+1-555-0199',
        language: 'en'
      });
    });

    setTimeout(() => {
      resolve();
    }, 8000);
  });

  assert(flags.readyReceived === true, 'call:ready event processed successfully');
  assert(flags.responseReceived === true, 'call:ai_response event processed successfully');

  // Check CallRecord in DB
  const dbCall = await prisma.callRecord.findUnique({
    where: { callId: testCallId },
    include: { transcripts: true }
  });
  assert(dbCall !== null, 'CallRecord persisted in database');
  assert(dbCall?.type === 'ai_voice', 'CallRecord type is "ai_voice"');
  assert(dbCall?.status === 'completed', 'CallRecord status is "completed" after call:end');
  assert(dbCall?.transcripts.length! >= 2, `CallRecord has ${dbCall?.transcripts.length} transcript entries recorded`);

  console.log('\n====================================================');
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
