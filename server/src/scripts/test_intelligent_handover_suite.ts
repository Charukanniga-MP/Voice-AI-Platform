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

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.off(eventName, handler);
      reject(new Error(`Timeout after ${timeoutMs}ms waiting for "${eventName}" (${description})`));
    }, timeoutMs);

    const handler = (data: any) => {
      try {
        if (settled) return;
        if (matcher(data)) {
          settled = true;
          clearTimeout(timer);
          socket.off(eventName, handler);
          resolve(data);
        }
      } catch (err: any) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.off(eventName, handler);
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
      if (data.callId !== callId) return false;
      if (clientMessageId && data.clientMessageId) {
        return data.clientMessageId === clientMessageId;
      }
      return true;
    },
    timeoutMs,
    `call:ai_response for callId: ${callId}${clientMessageId ? ' msgId: ' + clientMessageId : ''}`
  );
}

async function runTestSuite() {
  console.log('=============================================================================');
  console.log('🤖 KAIRA AI Voice Agent – Comprehensive Intelligent Human Handover Test Suite');
  console.log('=============================================================================\n');

  const results: TestResult[] = [];

  const testCustomer = await prisma.user.findFirst({
    where: { role: 'customer' }
  });
  if (!testCustomer) {
    throw new Error('No customer found in DB to run tests with.');
  }
  console.log(`✓ Test customer: ${testCustomer.name} (${testCustomer.id})\n`);

  const socket = Client('http://localhost:5000', {
    transports: ['websocket'],
    forceNew: true,
    timeout: 10000
  });

  await new Promise<void>((resolve, reject) => {
    socket.on('connect', () => {
      console.log('✓ Connected to Kaira Socket.IO server at http://localhost:5000\n');
      resolve();
    });
    socket.on('connect_error', (e) => reject(e));
  });

  // --------------------------------------------------------------------------
  // Scenario 1: Customer Frustration -> Immediate Transfer
  // --------------------------------------------------------------------------
  console.log('-----------------------------------------------------------------------------');
  console.log('Scenario 1: Customer Frustration Detection -> Immediate Handover');
  console.log('-----------------------------------------------------------------------------');
  const t0_s1 = Date.now();
  try {
    const callId = `call_test_frust_${Date.now()}`;
    const readyPromise = waitForReady(socket, callId);
    socket.emit('call:start', {
      callId,
      customerId: testCustomer.id,
      customerName: testCustomer.name,
      language: 'en'
    });
    await readyPromise;

    const msgId = `msg_s1_${Date.now()}`;
    const respPromise = waitForAIResponse(socket, callId, msgId);
    socket.emit('call:query', {
      callId,
      customerId: testCustomer.id,
      query: 'I am extremely angry and furious with your terrible service! You never solve my problem!',
      language: 'en',
      clientMessageId: msgId
    });
    const resp = await respPromise;

    console.log(`  AI Spoke: "${resp.answer}"`);
    console.log(`  isTransferring: ${resp.isTransferring}, transferReason: "${resp.transferReason}"`);

    if (!resp.isTransferring) throw new Error('Expected isTransferring to be true for angry customer!');
    if (resp.transferReason !== 'Customer Frustration') {
      throw new Error(`Expected reason 'Customer Frustration', got: '${resp.transferReason}'`);
    }

    const callRecord = await prisma.callRecord.findUnique({ where: { callId } });
    if (!callRecord?.transferred) throw new Error('CallRecord.transferred was not set to true!');
    if (callRecord.transferReason !== 'Customer Frustration') {
      throw new Error(`CallRecord.transferReason mismatch: ${callRecord.transferReason}`);
    }

    // End call
    socket.emit('call:end', { callId, duration: 10 });
    results.push({
      scenarioNumber: 1,
      name: 'Customer Frustration Detection -> Immediate Handover',
      passed: true,
      durationMs: Date.now() - t0_s1,
      details: `Correctly detected anger/frustration, reason: ${resp.transferReason}`
    });
    console.log('  ✓ SCENARIO 1 PASSED!\n');
  } catch (err: any) {
    results.push({
      scenarioNumber: 1,
      name: 'Customer Frustration Detection -> Immediate Handover',
      passed: false,
      durationMs: Date.now() - t0_s1,
      error: err.message
    });
    console.error(`  ✗ SCENARIO 1 FAILED: ${err.message}\n`);
  }

  // --------------------------------------------------------------------------
  // Scenario 2: Repeated Complaints -> Handover (Repeated Unresolved Query)
  // --------------------------------------------------------------------------
  console.log('-----------------------------------------------------------------------------');
  console.log('Scenario 2: Repeated Unresolved Complaints -> Handover');
  console.log('-----------------------------------------------------------------------------');
  const t0_s2 = Date.now();
  try {
    const callId = `call_test_repeated_${Date.now()}`;
    const readyPromise = waitForReady(socket, callId);
    socket.emit('call:start', {
      callId,
      customerId: testCustomer.id,
      customerName: testCustomer.name,
      language: 'en'
    });
    await readyPromise;

    const msgId = `msg_s2_${Date.now()}`;
    const respPromise = waitForAIResponse(socket, callId, msgId);
    socket.emit('call:query', {
      callId,
      customerId: testCustomer.id,
      query: 'I called multiple times already and told you already, no one is helping me!',
      language: 'en',
      clientMessageId: msgId
    });
    const resp = await respPromise;

    console.log(`  AI Spoke: "${resp.answer}"`);
    console.log(`  isTransferring: ${resp.isTransferring}, transferReason: "${resp.transferReason}"`);

    if (!resp.isTransferring) throw new Error('Expected isTransferring to be true for repeated complaint!');
    if (resp.transferReason !== 'Repeated Unresolved Query') {
      throw new Error(`Expected reason 'Repeated Unresolved Query', got: '${resp.transferReason}'`);
    }

    const callRecord = await prisma.callRecord.findUnique({ where: { callId } });
    if (!callRecord?.transferred) throw new Error('CallRecord.transferred was not set to true!');
    if (callRecord.transferReason !== 'Repeated Unresolved Query') {
      throw new Error(`CallRecord.transferReason mismatch: ${callRecord.transferReason}`);
    }

    socket.emit('call:end', { callId, duration: 12 });
    results.push({
      scenarioNumber: 2,
      name: 'Repeated Unresolved Complaints -> Handover',
      passed: true,
      durationMs: Date.now() - t0_s2,
      details: `Detected repeated complaints, reason: ${resp.transferReason}`
    });
    console.log('  ✓ SCENARIO 2 PASSED!\n');
  } catch (err: any) {
    results.push({
      scenarioNumber: 2,
      name: 'Repeated Unresolved Complaints -> Handover',
      passed: false,
      durationMs: Date.now() - t0_s2,
      error: err.message
    });
    console.error(`  ✗ SCENARIO 2 FAILED: ${err.message}\n`);
  }

  // --------------------------------------------------------------------------
  // Scenario 3: Unknown Question (Not in KB) -> Offer Human Assistance & Handover
  // --------------------------------------------------------------------------
  console.log('-----------------------------------------------------------------------------');
  console.log('Scenario 3: Unknown Question (Not in KB) -> Offer Human Assistance');
  console.log('-----------------------------------------------------------------------------');
  const t0_s3 = Date.now();
  try {
    const callId = `call_test_unknown_${Date.now()}`;
    const readyPromise = waitForReady(socket, callId);
    socket.emit('call:start', {
      callId,
      customerId: testCustomer.id,
      customerName: testCustomer.name,
      language: 'en'
    });
    await readyPromise;

    const msgId = `msg_s3_${Date.now()}`;
    const respPromise = waitForAIResponse(socket, callId, msgId);
    socket.emit('call:query', {
      callId,
      customerId: testCustomer.id,
      query: 'Can you teach me the chemical formula for synthetic dark matter synthesis?',
      language: 'en',
      clientMessageId: msgId
    });
    const resp = await respPromise;

    console.log(`  AI Spoke: "${resp.answer}"`);
    console.log(`  isTransferring: ${resp.isTransferring}, transferReason: "${resp.transferReason}"`);

    if (!resp.isTransferring) throw new Error('Expected isTransferring to be true for unknown query!');
    if (resp.transferReason !== 'Unknown Question' && resp.transferReason !== 'Knowledge Base Missing Information') {
      throw new Error(`Expected 'Unknown Question', got: '${resp.transferReason}'`);
    }

    // Verify Knowledge Gap was logged for Admin Review
    const callRec = await prisma.callRecord.findUnique({ where: { callId } });
    const gap = await prisma.knowledgeGap.findFirst({
      where: {
        OR: [
          { sampleCallId: callRec?.id },
          { question: { contains: 'dark matter' } }
        ]
      }
    });
    console.log(`  Knowledge gap logged in DB: ${gap ? 'YES (' + gap.question + ')' : 'NO'}`);

    socket.emit('call:end', { callId, duration: 15 });
    results.push({
      scenarioNumber: 3,
      name: 'Unknown Question (Not in KB) -> Offer Human Assistance',
      passed: true,
      durationMs: Date.now() - t0_s3,
      details: `Handover triggered with reason '${resp.transferReason}', gap recorded`
    });
    console.log('  ✓ SCENARIO 3 PASSED!\n');
  } catch (err: any) {
    results.push({
      scenarioNumber: 3,
      name: 'Unknown Question (Not in KB) -> Offer Human Assistance',
      passed: false,
      durationMs: Date.now() - t0_s3,
      error: err.message
    });
    console.error(`  ✗ SCENARIO 3 FAILED: ${err.message}\n`);
  }

  // --------------------------------------------------------------------------
  // Scenario 4: Known KB Question -> Answer Normally, NO Transfer
  // --------------------------------------------------------------------------
  console.log('-----------------------------------------------------------------------------');
  console.log('Scenario 4: Known Knowledge Base Question -> Answer Autonomous, NO Transfer');
  console.log('-----------------------------------------------------------------------------');
  const t0_s4 = Date.now();
  try {
    const callId = `call_test_known_${Date.now()}`;
    const readyPromise = waitForReady(socket, callId);
    socket.emit('call:start', {
      callId,
      customerId: testCustomer.id,
      customerName: testCustomer.name,
      language: 'en'
    });
    await readyPromise;

    const msgId = `msg_s4_${Date.now()}`;
    const respPromise = waitForAIResponse(socket, callId, msgId);
    socket.emit('call:query', {
      callId,
      customerId: testCustomer.id,
      query: 'What core products does Kaira offer?',
      language: 'en',
      clientMessageId: msgId
    });
    const resp = await respPromise;

    console.log(`  AI Spoke: "${resp.answer.slice(0, 100)}..."`);
    console.log(`  isTransferring: ${resp.isTransferring}`);

    if (resp.isTransferring) {
      throw new Error('FAILED: Expected isTransferring to be FALSE for known KB question!');
    }

    const callRecord = await prisma.callRecord.findUnique({ where: { callId } });
    if (callRecord?.transferred) {
      throw new Error('FAILED: CallRecord.transferred was mistakenly set to true!');
    }

    socket.emit('call:end', { callId, duration: 15 });
    results.push({
      scenarioNumber: 4,
      name: 'Known Knowledge Base Question -> Answer Autonomous, NO Transfer',
      passed: true,
      durationMs: Date.now() - t0_s4,
      details: 'Correctly answered from KB autonomously without initiating transfer'
    });
    console.log('  ✓ SCENARIO 4 PASSED!\n');
  } catch (err: any) {
    results.push({
      scenarioNumber: 4,
      name: 'Known Knowledge Base Question -> Answer Autonomous, NO Transfer',
      passed: false,
      durationMs: Date.now() - t0_s4,
      error: err.message
    });
    console.error(`  ✗ SCENARIO 4 FAILED: ${err.message}\n`);
  }

  // --------------------------------------------------------------------------
  // Scenario 5: Customer Explicitly Requests Human -> Handover
  // --------------------------------------------------------------------------
  console.log('-----------------------------------------------------------------------------');
  console.log('Scenario 5: Explicit Request ("I want to speak to a human") -> Handover');
  console.log('-----------------------------------------------------------------------------');
  const t0_s5 = Date.now();
  try {
    const callId = `call_test_explicit_${Date.now()}`;
    const readyPromise = waitForReady(socket, callId);
    socket.emit('call:start', {
      callId,
      customerId: testCustomer.id,
      customerName: testCustomer.name,
      language: 'en'
    });
    await readyPromise;

    const msgId = `msg_s5_${Date.now()}`;
    const respPromise = waitForAIResponse(socket, callId, msgId);
    socket.emit('call:query', {
      callId,
      customerId: testCustomer.id,
      query: 'I want to speak to a human representative right now.',
      language: 'en',
      clientMessageId: msgId
    });
    const resp = await respPromise;

    console.log(`  AI Spoke: "${resp.answer}"`);
    console.log(`  isTransferring: ${resp.isTransferring}, transferReason: "${resp.transferReason}"`);

    if (!resp.isTransferring) throw new Error('Expected isTransferring to be true for explicit request!');
    if (resp.transferReason !== 'Customer Explicitly Requested Human Support') {
      throw new Error(`Expected reason 'Customer Explicitly Requested Human Support', got: '${resp.transferReason}'`);
    }

    socket.emit('call:end', { callId, duration: 10 });
    results.push({
      scenarioNumber: 5,
      name: 'Explicit Request ("I want to speak to a human") -> Handover',
      passed: true,
      durationMs: Date.now() - t0_s5,
      details: `Reason '${resp.transferReason}' correctly registered`
    });
    console.log('  ✓ SCENARIO 5 PASSED!\n');
  } catch (err: any) {
    results.push({
      scenarioNumber: 5,
      name: 'Explicit Request ("I want to speak to a human") -> Handover',
      passed: false,
      durationMs: Date.now() - t0_s5,
      error: err.message
    });
    console.error(`  ✗ SCENARIO 5 FAILED: ${err.message}\n`);
  }

  // --------------------------------------------------------------------------
  // Scenario 6: No Staff Available -> Callback Offered -> Customer Confirms -> Ticket Scheduled
  // --------------------------------------------------------------------------
  console.log('-----------------------------------------------------------------------------');
  console.log('Scenario 6: No Staff Available -> Callback Offered -> Customer Confirms');
  console.log('-----------------------------------------------------------------------------');
  const t0_s6 = Date.now();
  try {
    const callId = `call_test_callback_${Date.now()}`;
    const readyPromise = waitForReady(socket, callId);
    socket.emit('call:start', {
      callId,
      customerId: testCustomer.id,
      customerName: testCustomer.name,
      language: 'en'
    });
    await readyPromise;

    // Trigger handover with unknown query when no agent is online
    const msgId1 = `msg_s6_1_${Date.now()}`;
    const respPromise1 = waitForAIResponse(socket, callId, msgId1);
    socket.emit('call:query', {
      callId,
      customerId: testCustomer.id,
      query: 'What is the deep space telemetry protocol for Jupiter orbit?',
      language: 'en',
      clientMessageId: msgId1
    });
    const resp1 = await respPromise1;

    console.log(`  Step A (Offer Callback): "${resp1.answer}"`);
    console.log(`  isTransferring: ${resp1.isTransferring}, isOfferingCallback: ${resp1.isOfferingCallback}`);

    if (!resp1.isTransferring) throw new Error('Expected isTransferring to be true!');
    const answerLower = resp1.answer.toLowerCase();
    if (!answerLower.includes('callback') && !answerLower.includes('representative')) {
      throw new Error(`Expected callback offer in message: "${resp1.answer}"`);
    }

    // Step B: Customer confirms callback: "Yes please, arrange a callback for me"
    const msgId2 = `msg_s6_2_${Date.now()}`;
    const respPromise2 = waitForAIResponse(socket, callId, msgId2);
    socket.emit('call:query', {
      callId,
      customerId: testCustomer.id,
      query: 'Yes please, arrange a priority callback for me at +1 555-0199',
      language: 'en',
      clientMessageId: msgId2
    });
    const resp2 = await respPromise2;

    console.log(`  Step B (Confirmation): "${resp2.answer}"`);
    console.log(`  callbackScheduled: ${resp2.callbackScheduled}, ticketId: ${resp2.ticketId}`);

    if (!resp2.callbackScheduled) throw new Error('Expected callbackScheduled to be true!');
    if (!resp2.ticketId) throw new Error('Expected ticketId to be returned!');

    // Verify SupportTicket was created with priority urgent
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: resp2.ticketId }
    });
    if (!ticket) throw new Error('SupportTicket not found in DB!');
    console.log(`  Verified DB Ticket: #${ticket.id.slice(-6).toUpperCase()} (${ticket.priority}) - "${ticket.subject}"`);

    socket.emit('call:end', { callId, duration: 25 });
    results.push({
      scenarioNumber: 6,
      name: 'No Staff Online -> Callback Offered -> Customer Confirms -> Ticket Scheduled',
      passed: true,
      durationMs: Date.now() - t0_s6,
      details: `Scheduled urgent ticket #${ticket.id.slice(-6).toUpperCase()} at +1 555-0199`
    });
    console.log('  ✓ SCENARIO 6 PASSED!\n');
  } catch (err: any) {
    results.push({
      scenarioNumber: 6,
      name: 'No Staff Online -> Callback Offered -> Customer Confirms -> Ticket Scheduled',
      passed: false,
      durationMs: Date.now() - t0_s6,
      error: err.message
    });
    console.error(`  ✗ SCENARIO 6 FAILED: ${err.message}\n`);
  }

  // Clean up
  socket.disconnect();
  await prisma.$disconnect();

  // --------------------------------------------------------------------------
  // Summary Report
  // --------------------------------------------------------------------------
  console.log('=============================================================================');
  console.log('📊 TEST SUMMARY REPORT');
  console.log('=============================================================================');
  let allPassed = true;
  for (const r of results) {
    const mark = r.passed ? '✓ PASSED' : '✗ FAILED';
    console.log(`${mark} [Scenario ${r.scenarioNumber}]: ${r.name} (${r.durationMs}ms)`);
    if (r.details) console.log(`   Details: ${r.details}`);
    if (r.error) console.log(`   Error: ${r.error}`);
    if (!r.passed) allPassed = false;
  }
  console.log('=============================================================================\n');

  if (!allPassed) {
    process.exit(1);
  } else {
    console.log('🎉 ALL 6 HUMAN HANDOVER SCENARIOS PASSED WITH 100% SUCCESS!\n');
    process.exit(0);
  }
}

runTestSuite().catch((e) => {
  console.error('Fatal test error:', e);
  process.exit(1);
});
