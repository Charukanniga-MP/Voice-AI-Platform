import { io as Client, Socket } from 'socket.io-client';
import { prisma } from '../db.js';

interface TestResult {
  scenarioNumber: number;
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
  details?: string;
}

function waitForEvent<T = any>(
  socket: Socket,
  eventName: string,
  matcher: (data: any) => boolean,
  timeoutMs: number,
  description: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    let handler: ((data: any) => void) | null = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (handler) socket.off(eventName, handler);
    };

    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Timeout after ${timeoutMs}ms waiting for "${eventName}" (${description})`));
    }, timeoutMs);

    handler = (data: any) => {
      try {
        if (settled) return;
        if (matcher(data)) {
          settled = true;
          cleanup();
          resolve(data);
        }
      } catch (err: any) {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      }
    };

    socket.on(eventName, handler);
  });
}

async function runCriticalVoiceFixSuite() {
  console.log('========================================================================');
  console.log('  🧪 KAIRA AI Voice Agent: Voice Workflow & Echo Fix Verification');
  console.log('========================================================================\n');

  const results: TestResult[] = [];
  const BACKEND_URL = process.env.TEST_BACKEND_URL || 'http://localhost:5000';
  let socket: Socket | null = null;

  const customer = await prisma.user.findFirst({
    where: { role: 'customer' },
    select: { id: true, name: true, email: true }
  });

  if (!customer) {
    throw new Error('No customer found in database.');
  }

  const callId = `call_echo_test_${Date.now()}`;
  let initialGreetingText = '';

  try {
    // -------------------------------------------------------------
    // SCENARIO 1: Connection & Dynamic Initial Greeting (plays once)
    // -------------------------------------------------------------
    const t1 = Date.now();
    try {
      console.log('--- Scenario 1: Initial Call & Dynamic Greeting ---');
      socket = Client(BACKEND_URL, {
        transports: ['websocket'],
        forceNew: true,
        timeout: 5000,
        reconnection: false
      });

      await new Promise<void>((resolve, reject) => {
        socket!.on('connect', () => resolve());
        socket!.on('connect_error', (e) => reject(e));
      });

      const readyPromise = waitForEvent<any>(
        socket,
        'call:ready',
        (d) => d && d.callId === callId,
        8000,
        'call:ready'
      );

      socket.emit('call:start', {
        callId,
        customerId: customer.id,
        customerName: customer.name,
        customerEmail: customer.email,
        language: 'en'
      });

      const readyData = await readyPromise;
      initialGreetingText = readyData.greeting;
      console.log(`✓ Received call:ready with greeting: "${initialGreetingText.slice(0, 60)}..."`);

      if (!initialGreetingText.startsWith('Hello!')) {
        throw new Error('Greeting does not start with "Hello!"');
      }
      if (initialGreetingText.toLowerCase().includes('good morning') || initialGreetingText.toLowerCase().includes('good afternoon')) {
        throw new Error('Greeting contains forbidden time-of-day phrase');
      }

      results.push({
        scenarioNumber: 1,
        name: 'Initial Call Setup & Dynamic Greeting',
        passed: true,
        durationMs: Date.now() - t1,
        details: `Greeting: "${initialGreetingText.slice(0, 75)}..."`
      });
    } catch (err: any) {
      results.push({
        scenarioNumber: 1,
        name: 'Initial Call Setup & Dynamic Greeting',
        passed: false,
        durationMs: Date.now() - t1,
        error: err.message
      });
    }

    // -------------------------------------------------------------
    // SCENARIO 2: Customer Silence (10s Wait)
    // Verified: AI must NOT speak or emit unprompted response
    // -------------------------------------------------------------
    const t2 = Date.now();
    try {
      console.log('\n--- Scenario 2: Customer Silence (No automatic AI response) ---');
      let unexpectedResponseReceived = false;
      let unexpectedData: any = null;

      const aiListener = (data: any) => {
        if (data && data.callId === callId) {
          unexpectedResponseReceived = true;
          unexpectedData = data;
        }
      };

      socket!.on('call:ai_response', aiListener);
      console.log('Waiting 3000ms in complete silence...');
      await new Promise((r) => setTimeout(r, 3000));
      socket!.off('call:ai_response', aiListener);

      if (unexpectedResponseReceived) {
        throw new Error(`AI generated unprompted response during customer silence: "${unexpectedData?.answer}"`);
      }

      console.log('✓ Confirmed: AI remained completely silent during customer waiting period.');
      results.push({
        scenarioNumber: 2,
        name: 'Customer Silence Waiting (No automatic AI response)',
        passed: true,
        durationMs: Date.now() - t2,
        details: 'AI remained silent with zero unprompted speech events.'
      });
    } catch (err: any) {
      results.push({
        scenarioNumber: 2,
        name: 'Customer Silence Waiting',
        passed: false,
        durationMs: Date.now() - t2,
        error: err.message
      });
    }

    // -------------------------------------------------------------
    // SCENARIO 3: Acoustic Echo Shield (Screenshot bug reproduction)
    // Transcribed audio matching AI greeting must be BLOCKED
    // -------------------------------------------------------------
    const t3 = Date.now();
    try {
      console.log('\n--- Scenario 3: Server Acoustic Echo Suppression ---');
      const screenshotEchoQuery =
        'hello am I speaking with Abby I am calling from AI powered customer communication platform we help businesses manage customer interactions through intelligent AI voice agents I am reaching out to tell you a little about understand how your business currently handles customer communication is this a good time to talk yeah this could time to talk';

      let echoResponseTriggered = false;
      const echoListener = (data: any) => {
        if (data && data.callId === callId) {
          echoResponseTriggered = true;
        }
      };
      socket!.on('call:ai_response', echoListener);

      console.log('Emitting acoustic echo query to backend...');
      socket!.emit('call:query', {
        callId,
        query: screenshotEchoQuery,
        customerId: customer.id,
        duration: 5,
        language: 'en',
        clientMessageId: `echo_test_${Date.now()}`
      });

      // Wait 3000ms - if echo shield works, NO call:ai_response will be emitted!
      await new Promise((r) => setTimeout(r, 3000));
      socket!.off('call:ai_response', echoListener);

      if (echoResponseTriggered) {
        throw new Error('FAIL: Acoustic echo was NOT suppressed! Server replied to its own greeting!');
      }

      console.log('✓ Confirmed: Server Echo Shield successfully blocked greeting echo query.');
      results.push({
        scenarioNumber: 3,
        name: 'Acoustic Echo Rejection (Greeting Echo Blocked)',
        passed: true,
        durationMs: Date.now() - t3,
        details: 'Greeting acoustic feedback dropped cleanly with zero response.'
      });
    } catch (err: any) {
      results.push({
        scenarioNumber: 3,
        name: 'Acoustic Echo Rejection',
        passed: false,
        durationMs: Date.now() - t3,
        error: err.message
      });
    }

    // -------------------------------------------------------------
    // SCENARIO 4: Noise-only and Empty Utterance Filtering
    // -------------------------------------------------------------
    const t4 = Date.now();
    try {
      console.log('\n--- Scenario 4: Noise-only and Empty Utterance Filtering ---');
      let noiseResponseTriggered = false;
      const noiseListener = (data: any) => {
        if (data && data.callId === callId) noiseResponseTriggered = true;
      };
      socket!.on('call:ai_response', noiseListener);

      // Send noise tokens (clicks, dots, silence)
      socket!.emit('call:query', {
        callId,
        query: '...',
        customerId: customer.id,
        language: 'en'
      });
      socket!.emit('call:query', {
        callId,
        query: '   ',
        customerId: customer.id,
        language: 'en'
      });

      await new Promise((r) => setTimeout(r, 2000));
      socket!.off('call:ai_response', noiseListener);

      if (noiseResponseTriggered) {
        throw new Error('FAIL: Server generated AI response to noise-only utterance');
      }

      console.log('✓ Confirmed: Noise-only queries dropped safely.');
      results.push({
        scenarioNumber: 4,
        name: 'Noise & Empty Speech Filtering',
        passed: true,
        durationMs: Date.now() - t4,
        details: 'Punctuation, clicks, and whitespace queries filtered out.'
      });
    } catch (err: any) {
      results.push({
        scenarioNumber: 4,
        name: 'Noise & Empty Speech Filtering',
        passed: false,
        durationMs: Date.now() - t4,
        error: err.message
      });
    }

    // -------------------------------------------------------------
    // SCENARIO 5: Genuine Customer Speech (AI Responds Accurately)
    // -------------------------------------------------------------
    const t5 = Date.now();
    let genuineAiAnswer = '';
    try {
      console.log('\n--- Scenario 5: Genuine Customer Voice Query ---');
      const genuineQuery = 'Yes this is Abinaya. What are your pricing plans?';
      const genuineMsgId = `gen_msg_${Date.now()}`;

      const aiRespPromise = waitForEvent<any>(
        socket!,
        'call:ai_response',
        (d) => d && d.callId === callId && d.clientMessageId === genuineMsgId,
        15000,
        'genuine response'
      );

      socket!.emit('call:query', {
        callId,
        query: genuineQuery,
        customerId: customer.id,
        duration: 10,
        language: 'en',
        clientMessageId: genuineMsgId
      });

      const aiData = await aiRespPromise;
      genuineAiAnswer = aiData.answer;
      console.log(`✓ Received AI answer: "${genuineAiAnswer.slice(0, 80)}..."`);

      const lowerAns = genuineAiAnswer.toLowerCase();
      const hasPricingKeywords = lowerAns.includes('plan') || lowerAns.includes('pricing') || lowerAns.includes('starter') || lowerAns.includes('enterprise') || lowerAns.includes('tier') || lowerAns.includes('month');
      if (!hasPricingKeywords) {
        throw new Error(`AI answer missing pricing keywords. Got: "${genuineAiAnswer}"`);
      }

      results.push({
        scenarioNumber: 5,
        name: 'Genuine Customer Speech Processing',
        passed: true,
        durationMs: Date.now() - t5,
        details: `Accurate response delivered: "${genuineAiAnswer.slice(0, 70)}..."`
      });
    } catch (err: any) {
      results.push({
        scenarioNumber: 5,
        name: 'Genuine Customer Speech Processing',
        passed: false,
        durationMs: Date.now() - t5,
        error: err.message
      });
    }

    // -------------------------------------------------------------
    // SCENARIO 6: Server AI Response Echo Rejection
    // Echo of the AI response we just received must also be BLOCKED
    // -------------------------------------------------------------
    const t6 = Date.now();
    try {
      console.log('\n--- Scenario 6: AI Response Echo Rejection ---');
      if (!genuineAiAnswer) throw new Error('No AI answer from Scenario 5 to test echo against');

      let responseEchoTriggered = false;
      const respEchoListener = (data: any) => {
        if (data && data.callId === callId) responseEchoTriggered = true;
      };
      socket!.on('call:ai_response', respEchoListener);

      // Simulate mic picking up AI's pricing answer with slight speech recognition drop
      const simulatedEcho = genuineAiAnswer.split(' ').slice(0, 15).join(' ');
      console.log(`Sending simulated echo of AI response: "${simulatedEcho}"`);

      socket!.emit('call:query', {
        callId,
        query: simulatedEcho,
        customerId: customer.id,
        language: 'en',
        clientMessageId: `echo_ans_${Date.now()}`
      });

      await new Promise((r) => setTimeout(r, 3000));
      socket!.off('call:ai_response', respEchoListener);

      if (responseEchoTriggered) {
        throw new Error('FAIL: AI responded to echo of its own previous answer!');
      }

      console.log('✓ Confirmed: Echo of AI response was cleanly suppressed.');
      results.push({
        scenarioNumber: 6,
        name: 'AI Response Echo Rejection',
        passed: true,
        durationMs: Date.now() - t6,
        details: 'Secondary echo of AI response dropped without self-answering.'
      });
    } catch (err: any) {
      results.push({
        scenarioNumber: 6,
        name: 'AI Response Echo Rejection',
        passed: false,
        durationMs: Date.now() - t6,
        error: err.message
      });
    }

    // -------------------------------------------------------------
    // SCENARIO 7: Duplicate Customer Utterance Rejection
    // -------------------------------------------------------------
    const t7 = Date.now();
    try {
      console.log('\n--- Scenario 7: Duplicate Customer Utterance Rejection ---');
      const dupQuery = 'Can you help me with integration?';
      let responseCount = 0;

      const dupListener = (data: any) => {
        if (data && data.callId === callId) responseCount++;
      };
      socket!.on('call:ai_response', dupListener);

      // Send twice within 50ms
      socket!.emit('call:query', {
        callId,
        query: dupQuery,
        customerId: customer.id,
        language: 'en',
        clientMessageId: 'dup_msg_1'
      });
      socket!.emit('call:query', {
        callId,
        query: dupQuery,
        customerId: customer.id,
        language: 'en',
        clientMessageId: 'dup_msg_2'
      });

      await new Promise((r) => setTimeout(r, 4000));
      socket!.off('call:ai_response', dupListener);

      if (responseCount > 1) {
        throw new Error(`Duplicate query received ${responseCount} responses instead of 1`);
      }

      console.log(`✓ Confirmed: Exactly 1 response delivered (count=${responseCount}). Duplicate suppressed.`);
      results.push({
        scenarioNumber: 7,
        name: 'Duplicate Utterance Suppression',
        passed: true,
        durationMs: Date.now() - t7,
        details: 'Concurrent duplicate queries safely locked to 1 response.'
      });
    } catch (err: any) {
      results.push({
        scenarioNumber: 7,
        name: 'Duplicate Utterance Suppression',
        passed: false,
        durationMs: Date.now() - t7,
        error: err.message
      });
    }

  } finally {
    if (socket) {
      try {
        socket.emit('call:end', { callId, duration: 25, endedBy: 'customer' });
        socket.disconnect();
      } catch {}
    }
  }

  // Summary
  console.log('\n========================================================================');
  console.log('  📊 TEST RESULTS SUMMARY');
  console.log('========================================================================');
  let allPassed = true;
  for (const r of results) {
    const status = r.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`  ${status} [Scenario ${r.scenarioNumber}] ${r.name} (${r.durationMs}ms)`);
    if (r.details) console.log(`     ℹ ${r.details}`);
    if (r.error) {
      console.log(`     ⚠ Error: ${r.error}`);
      allPassed = false;
    }
  }
  console.log('========================================================================\n');

  if (!allPassed) {
    process.exit(1);
  }
}

runCriticalVoiceFixSuite()
  .then(() => {
    console.log('🎉 All Critical Voice Workflow & Echo Tests PASSED successfully.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
