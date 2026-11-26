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

async function runBargeInTestSuite() {
  console.log('========================================================================');
  console.log('  🧪 KAIRA AI Voice Agent: Real-Time Barge-in & Interruption Test Suite');
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

  const callId = `call_bargein_test_${Date.now()}`;
  let currentTurnId = 1;

  try {
    // -------------------------------------------------------------------------
    // SCENARIO 1: Call Initialization & Initial AI Speaking State
    // -------------------------------------------------------------------------
    const t1 = Date.now();
    try {
      console.log('--- Scenario 1: Call Initialization & Ready State ---');
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
        6000,
        'call:ready'
      );

      socket.emit('call:start', {
        callId,
        customerId: customer.id,
        customerName: customer.name,
        preferredLanguage: 'en',
        isAiAgent: true
      });

      const readyData = await readyPromise;
      const firstName = (customer.name || '').split(' ')[0];
      if (!readyData.greeting || (!readyData.greeting.includes(customer.name) && !readyData.greeting.includes(firstName))) {
        throw new Error(`Greeting did not include customer name: "${readyData.greeting}"`);
      }

      console.log(`✓ Call initialized successfully. Greeting received: "${readyData.greeting.slice(0, 50)}..."`);
      results.push({
        scenarioNumber: 1,
        name: 'Call Initialization & Ready State',
        passed: true,
        durationMs: Date.now() - t1,
        details: `Greeting received (${readyData.greeting.length} chars) with customer name: ${customer.name}`
      });
    } catch (err: any) {
      console.error('❌ Scenario 1 Failed:', err.message);
      results.push({
        scenarioNumber: 1,
        name: 'Call Initialization & Ready State',
        passed: false,
        durationMs: Date.now() - t1,
        error: err.message
      });
    }

    // -------------------------------------------------------------------------
    // SCENARIO 2: Mid-Greeting Barge-in Interruption Event
    // -------------------------------------------------------------------------
    const t2 = Date.now();
    try {
      console.log('\n--- Scenario 2: Immediate Voice Interruption (Barge-in) ---');
      currentTurnId = 2;

      const interruptPromise = waitForEvent<any>(
        socket!,
        'call:interrupted',
        (d) => d && d.callId === callId && d.turnId === currentTurnId,
        5000,
        'call:interrupted turn 2'
      );

      // Customer interrupts the AI greeting
      socket!.emit('call:interrupt', {
        callId,
        turnId: currentTurnId
      });

      const interruptData = await interruptPromise;
      console.log(`✓ Barge-in acknowledged by server for call ${callId}, turn ${interruptData.turnId}`);

      results.push({
        scenarioNumber: 2,
        name: 'Immediate Voice Interruption (Barge-in)',
        passed: true,
        durationMs: Date.now() - t2,
        details: `Server acknowledged interruption on turn ${interruptData.turnId}`
      });
    } catch (err: any) {
      console.error('❌ Scenario 2 Failed:', err.message);
      results.push({
        scenarioNumber: 2,
        name: 'Immediate Voice Interruption (Barge-in)',
        passed: false,
        durationMs: Date.now() - t2,
        error: err.message
      });
    }

    // -------------------------------------------------------------------------
    // SCENARIO 3: Complete Customer Speech Processing After Interruption
    // -------------------------------------------------------------------------
    const t3 = Date.now();
    try {
      console.log('\n--- Scenario 3: Process Post-Interruption Query ---');
      const queryText = "Wait, what plans and pricing do you offer for small businesses?";

      const aiResponsePromise = waitForEvent<any>(
        socket!,
        'call:ai_response',
        (d) => d && d.callId === callId && d.turnId === currentTurnId,
        15000,
        'call:ai_response turn 2'
      );

      socket!.emit('call:query', {
        callId,
        query: queryText,
        customerId: customer.id,
        language: 'en',
        turnId: currentTurnId,
        utteranceId: `utt_bargein_${Date.now()}`
      });

      const aiResp = await aiResponsePromise;
      if (!aiResp.answer || aiResp.answer.length < 10) {
        throw new Error(`Invalid AI response: "${aiResp.answer}"`);
      }
      console.log(`✓ AI responded to post-interruption query on turn ${aiResp.turnId}: "${aiResp.answer.slice(0, 70)}..."`);

      results.push({
        scenarioNumber: 3,
        name: 'Post-Interruption Speech Processing',
        passed: true,
        durationMs: Date.now() - t3,
        details: `Turn ${aiResp.turnId} responded correctly with ${aiResp.answer.length} chars`
      });
    } catch (err: any) {
      console.error('❌ Scenario 3 Failed:', err.message);
      results.push({
        scenarioNumber: 3,
        name: 'Post-Interruption Speech Processing',
        passed: false,
        durationMs: Date.now() - t3,
        error: err.message
      });
    }

    // -------------------------------------------------------------------------
    // SCENARIO 4: Stale Turn Supersession (Dropping Interrupted Turn Responses)
    // -------------------------------------------------------------------------
    const t4 = Date.now();
    try {
      console.log('\n--- Scenario 4: Stale Turn Supersession ---');
      // Turn 3 is initiated
      const turn3 = 3;
      // Turn 4 interrupts turn 3 before response
      const turn4 = 4;
      currentTurnId = turn4;

      // Start turn 3 query
      socket!.emit('call:query', {
        callId,
        query: "Tell me more about enterprise features",
        customerId: customer.id,
        language: 'en',
        turnId: turn3,
        utteranceId: `utt_superseded_${Date.now()}`
      });

      // Quickly interrupt and advance turn to turn 4
      socket!.emit('call:interrupt', {
        callId,
        turnId: turn4
      });

      // Immediately send turn 4 query
      socket!.emit('call:query', {
        callId,
        query: "Actually never mind, what are your support hours?",
        customerId: customer.id,
        language: 'en',
        turnId: turn4,
        utteranceId: `utt_active_${Date.now()}`
      });

      // We expect response ONLY for turn 4
      const response = await waitForEvent<any>(
        socket!,
        'call:ai_response',
        (d) => d && d.callId === callId,
        15000,
        'call:ai_response'
      );

      if (response.turnId === turn3) {
        throw new Error(`Turn 3 was NOT superseded! Received response for obsolete turn 3.`);
      }

      if (response.turnId !== turn4) {
        throw new Error(`Expected response for turn 4, got turn ${response.turnId}`);
      }

      console.log(`✓ Stale turn 3 correctly superseded! Responded to turn 4: "${response.answer.slice(0, 60)}..."`);
      results.push({
        scenarioNumber: 4,
        name: 'Stale Turn Supersession',
        passed: true,
        durationMs: Date.now() - t4,
        details: `Obsolete turn 3 was successfully discarded, active turn 4 fulfilled.`
      });
    } catch (err: any) {
      console.error('❌ Scenario 4 Failed:', err.message);
      results.push({
        scenarioNumber: 4,
        name: 'Stale Turn Supersession',
        passed: false,
        durationMs: Date.now() - t4,
        error: err.message
      });
    }

    // -------------------------------------------------------------------------
    // SCENARIO 5: Short Command Barge-in (1-2 Word Interruption Commands)
    // -------------------------------------------------------------------------
    const t5 = Date.now();
    try {
      console.log('\n--- Scenario 5: Short Command Barge-in (Wait / Stop) ---');
      const turn5 = 5;
      currentTurnId = turn5;

      const interruptPromise = waitForEvent<any>(
        socket!,
        'call:interrupted',
        (d) => d && d.callId === callId && d.turnId === turn5,
        5000,
        'call:interrupted turn 5'
      );

      socket!.emit('call:interrupt', {
        callId,
        turnId: turn5
      });

      await interruptPromise;

      const respPromise = waitForEvent<any>(
        socket!,
        'call:ai_response',
        (d) => d && d.callId === callId && d.turnId === turn5,
        15000,
        'call:ai_response turn 5'
      );

      socket!.emit('call:query', {
        callId,
        query: "Hold on, how do I reset my password?",
        customerId: customer.id,
        language: 'en',
        turnId: turn5,
        utteranceId: `utt_holdon_${Date.now()}`
      });

      const resp = await respPromise;
      if (!resp.answer) throw new Error('No answer received for password query.');
      console.log(`✓ Handled short command barge-in turn 5: "${resp.answer.slice(0, 60)}..."`);

      results.push({
        scenarioNumber: 5,
        name: 'Short Command Barge-in',
        passed: true,
        durationMs: Date.now() - t5,
        details: `Short command 'Hold on' barge-in processed seamlessly.`
      });
    } catch (err: any) {
      console.error('❌ Scenario 5 Failed:', err.message);
      results.push({
        scenarioNumber: 5,
        name: 'Short Command Barge-in',
        passed: false,
        durationMs: Date.now() - t5,
        error: err.message
      });
    }

    // -------------------------------------------------------------------------
    // SCENARIO 6: Multilingual Interruption (Tamil Barge-in)
    // -------------------------------------------------------------------------
    const t6 = Date.now();
    try {
      console.log('\n--- Scenario 6: Multilingual Interruption (Tamil) ---');
      const turn6 = 6;
      currentTurnId = turn6;

      const interruptPromise = waitForEvent<any>(
        socket!,
        'call:interrupted',
        (d) => d && d.callId === callId && d.turnId === turn6,
        5000,
        'call:interrupted turn 6'
      );

      socket!.emit('call:interrupt', {
        callId,
        turnId: turn6
      });

      await interruptPromise;

      const respPromise = waitForEvent<any>(
        socket!,
        'call:ai_response',
        (d) => d && d.callId === callId && d.turnId === turn6,
        15000,
        'call:ai_response turn 6'
      );

      socket!.emit('call:query', {
        callId,
        query: "ஒரு நிமிடம், உங்கள் வாடிக்கையாளர் சேவை நேரம் என்ன?",
        customerId: customer.id,
        language: 'ta',
        turnId: turn6,
        utteranceId: `utt_tamil_${Date.now()}`
      });

      const resp = await respPromise;
      if (!resp.answer) throw new Error('No Tamil answer received.');
      console.log(`✓ Handled multilingual Tamil barge-in: "${resp.answer.slice(0, 60)}..." (lang: ${resp.language})`);

      results.push({
        scenarioNumber: 6,
        name: 'Multilingual Barge-in (Tamil)',
        passed: true,
        durationMs: Date.now() - t6,
        details: `Tamil barge-in acknowledged and answered in language ${resp.language}.`
      });
    } catch (err: any) {
      console.error('❌ Scenario 6 Failed:', err.message);
      results.push({
        scenarioNumber: 6,
        name: 'Multilingual Barge-in (Tamil)',
        passed: false,
        durationMs: Date.now() - t6,
        error: err.message
      });
    }

  } finally {
    if (socket) {
      socket.disconnect();
    }
  }

  console.log('\n========================================================================');
  console.log('  📊 BARGE-IN TEST RESULTS SUMMARY');
  console.log('========================================================================');
  let allPassed = true;
  for (const r of results) {
    const status = r.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} [Scenario ${r.scenarioNumber}] ${r.name} (${r.durationMs}ms)`);
    if (r.details) console.log(`       ↳ ${r.details}`);
    if (r.error) console.log(`       ↳ Error: ${r.error}`);
    if (!r.passed) allPassed = false;
  }
  console.log('========================================================================\n');

  if (!allPassed) {
    process.exit(1);
  }
}

runBargeInTestSuite()
  .then(() => {
    console.log('All barge-in test scenarios passed successfully!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Test execution failed:', err);
    process.exit(1);
  });
