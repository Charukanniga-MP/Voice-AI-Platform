import { io as ClientIO } from 'socket.io-client';
import { prisma } from './db.js';
import { knowledgeService } from './services/knowledge.js';
import { translationService } from './services/translation.js';

const SERVER_URL = 'http://localhost:5000';

async function runVerification() {
  console.log('================================================================');
  console.log('🤖 KAIRA VOICE AI - COMPREHENSIVE AI VOICE CALLING VERIFICATION');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, testName: string, extraInfo: string = '') {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`✅ [PASS] ${testName} ${extraInfo ? `(${extraInfo})` : ''}`);
    } else {
      console.error(`❌ [FAIL] ${testName} ${extraInfo ? `(${extraInfo})` : ''}`);
    }
  }

  // Find real customer and agent accounts from DB
  const dbCustomer = await prisma.user.findFirst({ where: { role: 'customer' } });
  const dbAgent = await prisma.user.findFirst({ where: { role: 'agent' } });

  const customerId = dbCustomer?.id || 'cust_test_1';
  const customerName = dbCustomer?.name || 'Muthu Kumar';
  const agentId = dbAgent?.id || 'agent_test_1';
  const agentName = dbAgent?.name || 'Agent Anita';

  // 1. Knowledge Base and Multi-turn Response Engine Test
  console.log('\n--- 1. Testing AI Knowledge Base & Operational Latency ---');
  // First query initializes provider state
  await knowledgeService.warmup();

  // Measure live query latency
  const t0 = Date.now();
  const testResponse = await knowledgeService.answerQuery(
    'What are your pricing plans?',
    []
  );
  const engineLatency = Date.now() - t0;
  assert(!!testResponse.answer, 'Knowledge Service generates grounded response', `Latency: ${engineLatency}ms`);
  assert(testResponse.isGrounded, 'Knowledge Service answers grounded query');
  assert(engineLatency < 800, 'AI response generated within target latency (<800ms)', `${engineLatency}ms`);

  // 2. Multilingual Translations & TTS for 6 Languages
  console.log('\n--- 2. Testing Multilingual Pipeline (6 Regional Languages) ---');
  const testLanguages = ['en', 'ta', 'te', 'hi', 'ml', 'kn'];
  for (const lang of testLanguages) {
    const startT = Date.now();
    const translatedGreeting = await translationService.translateText(
      "Hello! Welcome to KAIRA. I am your AI assistant. How may I help you today?",
      lang,
      'en'
    );
    const ms = Date.now() - startT;
    assert(
      !!translatedGreeting && translatedGreeting.length > 0,
      `Translation to ${lang.toUpperCase()}`,
      `Length: ${translatedGreeting.length}, ${ms}ms`
    );
  }

  // 3. Socket.IO End-to-End AI Voice Calling Flow
  console.log('\n--- 3. Testing Socket.IO End-to-End Voice Calling Flow ---');

  const customerSocket = ClientIO(SERVER_URL, {
    transports: ['websocket'],
    forceNew: true
  });

  const agentSocket = ClientIO(SERVER_URL, {
    transports: ['websocket'],
    forceNew: true
  });

  await new Promise<void>((resolve) => {
    let connected = 0;
    const check = () => {
      connected++;
      if (connected === 2) resolve();
    };
    customerSocket.on('connect', () => {
      customerSocket.emit('user:register', { userId: customerId, role: 'customer', name: customerName, preferredLanguage: 'ta' });
      check();
    });
    agentSocket.on('connect', () => {
      agentSocket.emit('user:register', { userId: agentId, role: 'agent', name: agentName, agentStatus: 'available' });
      check();
    });
  });

  assert(customerSocket.connected, 'Customer Socket connected');
  assert(agentSocket.connected, 'Agent Socket connected');

  // Test Customer Call to AI Voice Agent
  const testCallId = 'test_ai_call_' + Date.now();
  console.log(`\nInitiating AI call ${testCallId} in Tamil ('ta')...`);

  // Step A: call:start -> call:ready
  const callReadyPromise = new Promise<any>((resolve) => {
    customerSocket.on('call:ready', (data) => {
      resolve(data);
    });
  });

  const aiStartedPromise = new Promise<any>((resolve) => {
    agentSocket.on('ai_call:started', (data) => {
      resolve(data);
    });
  });

  customerSocket.emit('call:start', {
    callId: testCallId,
    customerId,
    customerName,
    customerPhone: '+91 98765 43210',
    language: 'ta'
  });

  const callReadyData = await callReadyPromise;
  assert(callReadyData.callId === testCallId, 'AI Voice Call accepted automatically without human agent intervention');
  assert(callReadyData.language === 'ta', 'AI Voice Greeting language set to Tamil (ta)');
  assert(!!callReadyData.greeting, 'AI Greeting received', callReadyData.greeting.slice(0, 30) + '...');
  assert(!!callReadyData.audioUrl, 'AI Audio TTS stream URL provided');

  const aiStartedData = await aiStartedPromise;
  assert(aiStartedData.callId === testCallId, 'Agent Console alerted to active AI Voice Call in real time');

  // Step B: Customer speaks query -> AI responds with speech and latency
  console.log('\nCustomer speaking query to AI Voice Agent...');
  const queryStart = Date.now();

  const aiResponsePromise = new Promise<any>((resolve) => {
    customerSocket.on('call:ai_response', (data) => {
      resolve(data);
    });
  });

  const agentLiveMetricsPromise = new Promise<any>((resolve) => {
    agentSocket.on('ai_call:live_metrics', (data) => {
      resolve(data);
    });
  });

  customerSocket.emit('call:query', {
    callId: testCallId,
    query: 'What products does KAIRA offer?',
    customerId,
    duration: 5,
    language: 'ta',
    clientSentAt: queryStart
  });

  const aiResponseData = await aiResponsePromise;
  const roundTripMs = Date.now() - queryStart;
  assert(!!aiResponseData.answer, 'AI Voice Response received', aiResponseData.answer.slice(0, 40) + '...');
  assert(!!aiResponseData.audioUrl, 'AI Response includes synthesized audio URL');
  assert(roundTripMs < 1200, 'Round-trip response latency meets target (<1200ms)', `${roundTripMs}ms`);

  const agentLiveMetrics = await agentLiveMetricsPromise;
  assert(agentLiveMetrics.callId === testCallId, 'Agent Console received live conversation telemetry & latency metrics');

  // Step C: Test Real-Time Interruption (Barge-in)
  console.log('\nTesting Real-Time Barge-in / Interruption...');
  const interruptedPromise = new Promise<any>((resolve) => {
    customerSocket.on('call:interrupted', (data) => {
      resolve(data);
    });
  });

  customerSocket.emit('call:interrupt', { callId: testCallId });
  const interruptedData = await interruptedPromise;
  assert(interruptedData.callId === testCallId, 'AI Speech interrupted cleanly via barge-in event');

  // Step D: Test Human Escalation
  console.log('\nTesting Human Escalation Protocol...');
  const escalationPromise = new Promise<any>((resolve) => {
    agentSocket.on('transfer:incoming', (data) => {
      resolve(data);
    });
  });

  customerSocket.emit('call:escalate', {
    callId: testCallId,
    reason: 'Customer requested human specialist intervention'
  });

  const escalationData = await escalationPromise;
  assert(escalationData.callId === testCallId, 'Agent Console received urgent escalation alert');
  assert(escalationData.customerName === customerName, 'Escalation includes full customer context');

  // Step E: End Call
  console.log('\nEnding Call...');
  const callEndedPromise = new Promise<any>((resolve) => {
    agentSocket.on('ai_call:ended', (data) => {
      resolve(data);
    });
  });

  customerSocket.emit('call:end', {
    callId: testCallId,
    duration: 35,
    endedBy: 'customer'
  });

  const callEndedData = await callEndedPromise;
  assert(callEndedData.callId === testCallId, 'Agent Console notified of AI Call termination');

  customerSocket.disconnect();
  agentSocket.disconnect();
  await new Promise(r => setTimeout(r, 150));

  // Verify Database Record Persistence
  console.log('\n--- 4. Verifying Database Call Records & Transcripts ---');
  const dbCall = await prisma.callRecord.findUnique({
    where: { callId: testCallId },
    include: { transcripts: true }
  });
  assert(!!dbCall, 'Call Record persisted in SQLite DB');
  assert(dbCall?.status === 'completed', 'Call Record status updated to completed');
  assert((dbCall?.transcripts?.length || 0) >= 2, 'Call Transcripts persisted with multi-turn conversation exchanges');

  console.log('\n================================================================');
  console.log(`🎯 VERIFICATION RESULTS: ${passedTests} / ${totalTests} TESTS PASSED`);
  console.log('================================================================\n');

  await prisma.$disconnect();
  process.exit(passedTests === totalTests ? 0 : 1);
}

runVerification().catch(err => {
  console.error('Verification failed with error:', err);
  process.exit(1);
});
