import { io as Client, Socket } from 'socket.io-client';
import { prisma } from './db.js';

interface TestResult {
  scenarioNumber: number;
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
  details?: string;
}

/**
 * Robust Socket.IO event waiter with individual handler cleanup and timeout
 */
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
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (handler) {
        socket.off(eventName, handler);
        handler = null;
      }
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

function waitForReady(socket: Socket, callId: string, timeoutMs = 10000) {
  return waitForEvent<any>(
    socket,
    'call:ready',
    (data) => data && data.callId === callId,
    timeoutMs,
    `call:ready for callId: ${callId}`
  );
}

function waitForAIResponse(socket: Socket, callId: string, clientMessageId?: string, timeoutMs = 15000) {
  return waitForEvent<any>(
    socket,
    'call:ai_response',
    (data) => {
      if (!data) return false;
      if (data.callId && data.callId !== callId) return false;
      if (clientMessageId && data.clientMessageId && data.clientMessageId !== clientMessageId) return false;
      return true;
    },
    timeoutMs,
    `call:ai_response for callId: ${callId}${clientMessageId ? ` (msgId: ${clientMessageId})` : ''}`
  );
}

/**
 * Validates greeting according to KAIRA requirements:
 * 1. Starts with "Hello!"
 * 2. Dynamically includes the customer name
 * 3. Does NOT include time-of-day phrases ("Good morning", "Good afternoon", "Good evening")
 * 4. Includes company purpose & opening question
 * 5. Tolerates minor whitespace / punctuation differences
 */
function validateGreeting(greeting: string, customerName: string): { valid: boolean; reason?: string } {
  if (!greeting || typeof greeting !== 'string') {
    return { valid: false, reason: 'Greeting is empty or not a string' };
  }

  const normalized = greeting.replace(/\s+/g, ' ').trim();
  const lower = normalized.toLowerCase();

  if (!normalized.startsWith('Hello!')) {
    return { valid: false, reason: `Greeting does not start with "Hello!". Received: "${normalized.slice(0, 30)}..."` };
  }

  // Check no time-of-day greetings
  if (lower.includes('good morning') || lower.includes('good afternoon') || lower.includes('good evening')) {
    return { valid: false, reason: 'Greeting contains forbidden time-of-day phrase (Good morning/afternoon/evening)' };
  }

  // Clean customer display name
  const cleanName = customerName.replace(/\s*\((?:customer|client|user)\)/i, '').trim();
  if (cleanName && !lower.includes(cleanName.toLowerCase())) {
    return { valid: false, reason: `Greeting does not contain customer name "${cleanName}". Received: "${normalized}"` };
  }

  // Check company info
  if (!lower.includes('kaira') || !lower.includes('ai-powered customer communication platform')) {
    return { valid: false, reason: 'Greeting missing Kaira platform introduction' };
  }

  // Check opening question
  if (!lower.includes('is this a good time to talk?')) {
    return { valid: false, reason: 'Greeting missing opening question "Is this a good time to talk?"' };
  }

  // Check undefined/null
  if (lower.includes('undefined') || lower.includes('null')) {
    return { valid: false, reason: 'Greeting contains "undefined" or "null"' };
  }

  return { valid: true };
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('  🧪 KAIRA AI Calling Agent Test Suite');
  console.log('  Verifying Socket.IO, Dynamic Greeting, Knowledge & Multi-Turn');
  console.log('================================================================\n');

  const results: TestResult[] = [];
  const BACKEND_URL = process.env.TEST_BACKEND_URL || 'http://localhost:5000';
  let socket: Socket | null = null;

  // Query valid, existing customers from database (no random IDs or modifying real data)
  console.log('🔍 Querying existing customer records from database...');
  const existingCustomers = await prisma.user.findMany({
    where: { role: 'customer' },
    select: { id: true, name: true, email: true },
    orderBy: { createdAt: 'desc' },
    take: 5
  });

  if (!existingCustomers || existingCustomers.length === 0) {
    throw new Error('Database contains zero customer records. Cannot proceed without valid customer IDs.');
  }

  console.log(`✓ Loaded ${existingCustomers.length} valid customer records from database:`);
  existingCustomers.forEach((c, idx) => {
    console.log(`  [${idx + 1}] ID: ${c.id} | Name: "${c.name}" | Email: ${c.email}`);
  });

  const primaryCustomer = existingCustomers[0];
  const secondaryCustomer = existingCustomers.length > 1 ? existingCustomers[1] : existingCustomers[0];
  const mainCallId = `call_test_main_${Date.now()}`;

  try {
    // -------------------------------------------------------------
    // SCENARIO 1: Socket.IO Backend Connection
    // -------------------------------------------------------------
    const t1Start = Date.now();
    try {
      console.log('\n--- Scenario 1: Socket.IO Backend Connection ---');
      socket = Client(BACKEND_URL, {
        transports: ['websocket'],
        forceNew: true,
        timeout: 5000,
        reconnection: false
      });

      await new Promise<void>((resolve, reject) => {
        const connTimer = setTimeout(() => {
          reject(new Error(`Connection to Socket.IO backend timed out at ${BACKEND_URL}`));
        }, 6000);

        socket!.on('connect', () => {
          clearTimeout(connTimer);
          resolve();
        });

        socket!.on('connect_error', (err) => {
          clearTimeout(connTimer);
          reject(new Error(`Socket connection error: ${err.message}`));
        });
      });

      console.log(`✓ Connected to Socket.IO backend (${BACKEND_URL}) with socket ID: ${socket.id}`);
      results.push({
        scenarioNumber: 1,
        name: 'Socket.IO backend connection',
        passed: true,
        durationMs: Date.now() - t1Start,
        details: `Connected with socket ID: ${socket.id}`
      });
    } catch (err: any) {
      results.push({
        scenarioNumber: 1,
        name: 'Socket.IO backend connection',
        passed: false,
        durationMs: Date.now() - t1Start,
        error: `${err.message} (Is the KAIRA server running on ${BACKEND_URL}?)`
      });
      console.error(`❌ Scenario 1 Failed: ${err.message}`);
      console.error(`👉 Ensure backend is running with "cd server && npm start" or "node dist/index.js"`);
      return; // Gracefully proceed to finally and print summary
    }

    // -------------------------------------------------------------
    // SCENARIO 2: Initial Customer Greeting
    // -------------------------------------------------------------
    const t2Start = Date.now();
    try {
      console.log(`\n--- Scenario 2: Initial Customer Greeting (Customer: "${primaryCustomer.name}") ---`);
      const readyPromise = waitForReady(socket!, mainCallId, 10000);

      socket!.emit('call:start', {
        callId: mainCallId,
        customerId: primaryCustomer.id,
        customerName: primaryCustomer.name,
        language: 'en'
      });

      const readyData = await readyPromise;

      const validation = validateGreeting(readyData.greeting, primaryCustomer.name);
      if (!validation.valid) {
        throw new Error(`Greeting validation failed: ${validation.reason}`);
      }

      console.log('✓ Greeting received and verified:');
      console.log(`  "${readyData.greeting}"`);
      results.push({
        scenarioNumber: 2,
        name: 'Initial customer greeting',
        passed: true,
        durationMs: Date.now() - t2Start,
        details: `Greeting: "${readyData.greeting.slice(0, 60)}..."`
      });
    } catch (err: any) {
      results.push({
        scenarioNumber: 2,
        name: 'Initial customer greeting',
        passed: false,
        durationMs: Date.now() - t2Start,
        error: err.message
      });
    }

    // -------------------------------------------------------------
    // SCENARIO 3: Dynamic Customer-Name Resolution
    // -------------------------------------------------------------
    const t3Start = Date.now();
    try {
      console.log('\n--- Scenario 3: Dynamic Customer-Name Resolution across multiple database customers ---');
      const testCases = existingCustomers.slice(0, 3);
      const passedUsers: string[] = [];

      for (const cust of testCases) {
        const dynCallId = `call_test_dyn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const dynReadyPromise = waitForReady(socket!, dynCallId, 8000);

        socket!.emit('call:start', {
          callId: dynCallId,
          customerId: cust.id,
          customerName: cust.name,
          language: 'en'
        });

        const dynData = await dynReadyPromise;
        const dynValidation = validateGreeting(dynData.greeting, cust.name);
        if (!dynValidation.valid) {
          throw new Error(`Dynamic greeting failed for "${cust.name}": ${dynValidation.reason}`);
        }
        passedUsers.push(cust.name);
        console.log(`  ✓ Dynamic greeting verified for "${cust.name}"`);
      }

      results.push({
        scenarioNumber: 3,
        name: 'Dynamic customer-name resolution',
        passed: true,
        durationMs: Date.now() - t3Start,
        details: `Verified for ${passedUsers.length} customer accounts (${passedUsers.join(', ')})`
      });
    } catch (err: any) {
      results.push({
        scenarioNumber: 3,
        name: 'Dynamic customer-name resolution',
        passed: false,
        durationMs: Date.now() - t3Start,
        error: err.message
      });
    }

    // -------------------------------------------------------------
    // SCENARIO 4: First AI Conversation Response
    // -------------------------------------------------------------
    const t4Start = Date.now();
    try {
      console.log('\n--- Scenario 4: First AI Conversation Response (Affirmative Opening) ---');
      const msgId1 = `msg_${Date.now()}_turn1`;
      const aiResponsePromise1 = waitForAIResponse(socket!, mainCallId, msgId1, 15000);

      socket!.emit('call:query', {
        callId: mainCallId,
        customerId: primaryCustomer.id,
        query: 'Yes speaking, tell me more about Kaira.',
        language: 'en',
        clientMessageId: msgId1
      });

      const response1 = await aiResponsePromise1;
      if (!response1 || typeof response1.answer !== 'string' || !response1.answer.trim()) {
        throw new Error('Received empty or invalid answer in call:ai_response');
      }

      const lowerAnswer1 = response1.answer.toLowerCase();
      if (lowerAnswer1.includes('i apologize, but i don\'t currently have') || lowerAnswer1.includes('error occurred')) {
        throw new Error(`Agent returned ungrounded failure response: "${response1.answer}"`);
      }

      console.log('✓ Received Turn 1 AI Response:');
      console.log(`  "${response1.answer}"`);
      results.push({
        scenarioNumber: 4,
        name: 'First AI conversation response',
        passed: true,
        durationMs: Date.now() - t4Start,
        details: `Answer: "${response1.answer.slice(0, 60)}..."`
      });
    } catch (err: any) {
      results.push({
        scenarioNumber: 4,
        name: 'First AI conversation response',
        passed: false,
        durationMs: Date.now() - t4Start,
        error: err.message
      });
    }

    // -------------------------------------------------------------
    // SCENARIO 5: Kaira Product Knowledge Response
    // -------------------------------------------------------------
    const t5Start = Date.now();
    try {
      console.log('\n--- Scenario 5: Kaira Product Knowledge Response ---');
      const msgId2 = `msg_${Date.now()}_turn2`;
      const aiResponsePromise2 = waitForAIResponse(socket!, mainCallId, msgId2, 15000);

      socket!.emit('call:query', {
        callId: mainCallId,
        customerId: primaryCustomer.id,
        query: 'What core products does Kaira offer?',
        language: 'en',
        clientMessageId: msgId2
      });

      const response2 = await aiResponsePromise2;
      if (!response2 || typeof response2.answer !== 'string' || !response2.answer.trim()) {
        throw new Error('Received empty or invalid answer in call:ai_response');
      }

      const lowerAnswer2 = response2.answer.toLowerCase();
      const hasProductKeywords = (
        lowerAnswer2.includes('voicecore') ||
        lowerAnswer2.includes('liveescalate') ||
        lowerAnswer2.includes('omnichannel') ||
        lowerAnswer2.includes('voice agent') ||
        lowerAnswer2.includes('voice platform')
      );

      if (!hasProductKeywords) {
        throw new Error(`Answer did not mention core KAIRA products. Received: "${response2.answer}"`);
      }

      console.log('✓ Received Turn 2 Product Knowledge Response:');
      console.log(`  "${response2.answer}"`);
      results.push({
        scenarioNumber: 5,
        name: 'Kaira product knowledge response',
        passed: true,
        durationMs: Date.now() - t5Start,
        details: `Answer: "${response2.answer.slice(0, 60)}..."`
      });
    } catch (err: any) {
      results.push({
        scenarioNumber: 5,
        name: 'Kaira product knowledge response',
        passed: false,
        durationMs: Date.now() - t5Start,
        error: err.message
      });
    }

    // -------------------------------------------------------------
    // SCENARIO 6: Supported-Language Response
    // -------------------------------------------------------------
    const t6Start = Date.now();
    try {
      console.log('\n--- Scenario 6: Supported-Language Response ---');
      const msgId3 = `msg_${Date.now()}_turn3`;
      const aiResponsePromise3 = waitForAIResponse(socket!, mainCallId, msgId3, 15000);

      socket!.emit('call:query', {
        callId: mainCallId,
        customerId: primaryCustomer.id,
        query: 'What languages do you support for voice calls?',
        language: 'en',
        clientMessageId: msgId3
      });

      const response3 = await aiResponsePromise3;
      if (!response3 || typeof response3.answer !== 'string' || !response3.answer.trim()) {
        throw new Error('Received empty or invalid answer in call:ai_response');
      }

      const lowerAnswer3 = response3.answer.toLowerCase();
      const supportedMatches = ['tamil', 'telugu', 'malayalam', 'hindi', 'english', 'regional'].filter(l => lowerAnswer3.includes(l));

      if (supportedMatches.length < 2) {
        throw new Error(`Answer did not adequately list supported languages. Received: "${response3.answer}"`);
      }

      console.log('✓ Received Turn 3 Multilingual Knowledge Response:');
      console.log(`  "${response3.answer}"`);
      results.push({
        scenarioNumber: 6,
        name: 'Supported-language response',
        passed: true,
        durationMs: Date.now() - t6Start,
        details: `Detected languages: ${supportedMatches.join(', ')}`
      });
    } catch (err: any) {
      results.push({
        scenarioNumber: 6,
        name: 'Supported-language response',
        passed: false,
        durationMs: Date.now() - t6Start,
        error: err.message
      });
    }

    // -------------------------------------------------------------
    // CONCURRENCY & ISOLATION CHECK: Multi-call Event Isolation
    // -------------------------------------------------------------
    const tIsoStart = Date.now();
    try {
      console.log('\n--- Concurrency Check: Simultaneous Calls Event Isolation ---');
      const callAlphaId = `call_iso_alpha_${Date.now()}`;
      const callBetaId = `call_iso_beta_${Date.now()}`;

      const readyPromiseAlpha = waitForReady(socket!, callAlphaId, 8000);
      const readyPromiseBeta = waitForReady(socket!, callBetaId, 8000);

      // Start both calls in parallel
      socket!.emit('call:start', {
        callId: callAlphaId,
        customerId: primaryCustomer.id,
        customerName: primaryCustomer.name,
        language: 'en'
      });

      socket!.emit('call:start', {
        callId: callBetaId,
        customerId: secondaryCustomer.id,
        customerName: secondaryCustomer.name,
        language: 'en'
      });

      const [readyAlpha, readyBeta] = await Promise.all([readyPromiseAlpha, readyPromiseBeta]);

      if (readyAlpha.callId !== callAlphaId || readyBeta.callId !== callBetaId) {
        throw new Error('Call ready events cross-talked or mismatched between concurrent calls');
      }

      // Query both calls simultaneously with distinct clientMessageIds
      const msgAlpha = `msg_iso_alpha_${Date.now()}`;
      const msgBeta = `msg_iso_beta_${Date.now()}`;

      const aiPromiseAlpha = waitForAIResponse(socket!, callAlphaId, msgAlpha, 15000);
      const aiPromiseBeta = waitForAIResponse(socket!, callBetaId, msgBeta, 15000);

      socket!.emit('call:query', {
        callId: callAlphaId,
        customerId: primaryCustomer.id,
        query: 'What core products does Kaira offer?',
        language: 'en',
        clientMessageId: msgAlpha
      });

      socket!.emit('call:query', {
        callId: callBetaId,
        customerId: secondaryCustomer.id,
        query: 'What languages do you support?',
        language: 'en',
        clientMessageId: msgBeta
      });

      const [respAlpha, respBeta] = await Promise.all([aiPromiseAlpha, aiPromiseBeta]);

      if (!respAlpha.answer || !respBeta.answer) {
        throw new Error('One or both concurrent calls failed to receive an answer');
      }

      console.log('✓ Concurrent call isolation verified without event interference:');
      console.log(`  Call Alpha (${callAlphaId.slice(-8)}) -> "${respAlpha.answer.slice(0, 40)}..."`);
      console.log(`  Call Beta (${callBetaId.slice(-8)}) -> "${respBeta.answer.slice(0, 40)}..."`);

      results.push({
        scenarioNumber: 7,
        name: 'Concurrent call Socket.IO event isolation',
        passed: true,
        durationMs: Date.now() - tIsoStart,
        details: 'Simultaneous calls handled independently without cross-talk'
      });
    } catch (err: any) {
      results.push({
        scenarioNumber: 7,
        name: 'Concurrent call Socket.IO event isolation',
        passed: false,
        durationMs: Date.now() - tIsoStart,
        error: err.message
      });
    }

  } finally {
    // -------------------------------------------------------------
    // TEARDOWN & CLEANUP: Disconnect socket and database
    // -------------------------------------------------------------
    if (socket) {
      try {
        socket.disconnect();
        console.log('\n✓ Socket.IO connection cleanly closed.');
      } catch (e) {
        console.warn('Error disconnecting socket:', e);
      }
    }
    try {
      await prisma.$disconnect();
      console.log('✓ Database connection cleanly closed.');
    } catch (e) {
      console.warn('Error disconnecting database:', e);
    }
  }

  // -------------------------------------------------------------
  // PRINT FINAL REPORT
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log('                     📊 TEST SUITE SUMMARY                      ');
  console.log('================================================================');

  const passedTests = results.filter(r => r.passed);
  const failedTests = results.filter(r => !r.passed);

  results.forEach(r => {
    const symbol = r.passed ? '✓ PASSED' : '✗ FAILED';
    console.log(`  [${symbol}] Scenario ${r.scenarioNumber}: ${r.name} (${r.durationMs}ms)`);
    if (r.details) console.log(`             ${r.details}`);
    if (r.error) console.log(`             Error: ${r.error}`);
  });

  console.log('----------------------------------------------------------------');
  console.log(`  Total Tests Run : ${results.length}`);
  console.log(`  Tests Passed    : ${passedTests.length}`);
  console.log(`  Tests Failed    : ${failedTests.length}`);
  console.log('================================================================\n');

  if (failedTests.length > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTestSuite().catch((fatalErr) => {
  console.error('❌ Fatal error running test suite:', fatalErr);
  process.exit(1);
});
