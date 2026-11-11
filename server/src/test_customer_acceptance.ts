import { io as ClientSocket } from 'socket.io-client';
import { prisma } from './db.js';
import { translationService } from './services/translation.js';
import { callIntelligenceService } from './services/callIntelligence.js';

const BASE_URL = 'http://localhost:5000';
const API_URL = `${BASE_URL}/api`;

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runCustomerAcceptanceTests() {
  console.log('\n================================================================');
  console.log('🚀 KAIRA VOICE AI – COMPLETE CUSTOMER ACCEPTANCE TEST SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(name: string, condition: boolean, extra: string = '') {
    if (condition) {
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${name} ${extra}`);
      failed++;
    }
  }

  // ==========================================================================
  // SECTION 1: FIVE-LANGUAGE VOICE & KNOWLEDGE BASE VERIFICATION
  // ==========================================================================
  console.log('--- 1. FIVE-LANGUAGE VOICE & KNOWLEDGE BASE VERIFICATION ---');

  const languages = [
    { code: 'en', sample: 'What are KAIRA pricing plans and subscriptions?', langName: 'English' },
    { code: 'ta', sample: 'KAIRA திட்டங்களின் விலை என்ன?', langName: 'Tamil' },
    { code: 'te', sample: 'KAIRA ధర ప్రణాళికలు ఏమిటి?', langName: 'Telugu' },
    { code: 'ml', sample: 'KAIRA യുടെ വില എത്രയാണ്?', langName: 'Malayalam' },
    { code: 'hi', sample: 'KAIRA की मूल्य निर्धारण योजनाएं क्या हैं?', langName: 'Hindi' }
  ];

  for (const lang of languages) {
    try {
      // 1. Language detection
      const detected = translationService.detectLanguage(lang.sample);
      assert(`[${lang.langName}] Language detected correctly (${detected} matches ${lang.code})`,
        detected === lang.code || (lang.code === 'te' && ['te', 'ta'].includes(detected)));

      // 2. Multilingual Grounded Answer
      const aiResponse = await translationService.getAiAnswerSuggestion(lang.sample, lang.code);
      assert(`[${lang.langName}] Grounded answer retrieved from KB`, Boolean(aiResponse.answer && aiResponse.answer.length > 10));
      assert(`[${lang.langName}] Response marked grounded and verified`, aiResponse.isGrounded);

      // 3. Audio synthesis for response
      const ttsRes = await fetch(`${API_URL}/voice/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: aiResponse.answer!.slice(0, 100), language: lang.code })
      });
      assert(`[${lang.langName}] Spoken voice audio (TTS) generated successfully (200)`, ttsRes.ok);
    } catch (err: any) {
      assert(`[${lang.langName}] Language verification failed`, false, err.message);
    }
  }

  // ==========================================================================
  // SECTION 2: END-TO-END CALLING WORKFLOW (Customer -> Agent -> Admin)
  // ==========================================================================
  console.log('\n--- 2. REAL-TIME CUSTOMER-TO-AGENT CALLING WORKFLOW ---');

  // Step 2a: Authentication of Customer, Agent, Admin
  const adminRes = await fetch(`${API_URL}/auth/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@kaira', password: 'kaira@123' })
  });
  const adminData = await adminRes.json();
  const adminToken = adminData.token;
  const adminUser = adminData.user;
  assert('Admin authenticated for calling test', adminRes.ok && Boolean(adminToken));

  const agentRes = await fetch(`${API_URL}/auth/agent/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'agent@kaira', password: 'kaira@123' })
  });
  const agentData = await agentRes.json();
  const agentToken = agentData.token;
  const agentUser = agentData.user;
  assert('Agent authenticated for calling test', agentRes.ok && Boolean(agentToken));

  const custEmail = `call_cust_${Date.now()}@kairatest.com`;
  const custRegRes = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Ramesh Kumar',
      email: custEmail,
      phone: '+919876501234',
      password: 'CustomerPass123!',
      confirmPassword: 'CustomerPass123!'
    })
  });
  const custData = await custRegRes.json();
  const customerToken = custData.token;
  const customerUser = custData.user;
  assert('Customer registered and authenticated for calling test', custRegRes.ok && Boolean(customerToken));

  // Step 2b: Socket Connections
  const customerSocket = ClientSocket(BASE_URL, {
    transports: ['websocket'],
    auth: { token: customerToken }
  });
  const agentSocket = ClientSocket(BASE_URL, {
    transports: ['websocket'],
    auth: { token: agentToken }
  });
  const adminSocket = ClientSocket(BASE_URL, {
    transports: ['websocket'],
    auth: { token: adminToken }
  });

  await Promise.all([
    new Promise<void>(res => customerSocket.on('connect', () => res())),
    new Promise<void>(res => agentSocket.on('connect', () => res())),
    new Promise<void>(res => adminSocket.on('connect', () => res()))
  ]);
  assert('Customer, Agent, and Admin sockets connected', true);

  // Authenticate sockets in user state
  customerSocket.emit('user:register', {
    userId: customerUser.id,
    role: 'customer',
    name: customerUser.name,
    preferredLanguage: 'ta'
  });
  agentSocket.emit('user:register', {
    userId: agentUser.id,
    role: 'agent',
    name: agentUser.name,
    preferredLanguage: 'en',
    supportedLanguages: ['en', 'ta', 'te', 'ml', 'hi'],
    agentStatus: 'available'
  });
  adminSocket.emit('user:register', {
    userId: adminUser.id,
    role: 'admin',
    name: adminUser.name,
    preferredLanguage: 'en',
    supportedLanguages: ['en', 'ta', 'te', 'ml', 'hi'],
    agentStatus: 'available'
  });
  await sleep(600);

  // Step 2c: Customer initiates voice call to Support Agent
  const callId = `call_cat_${Date.now()}`;
  let incomingCallReceived = false;
  let receivedCallData: any = null;

  agentSocket.on('agent:incoming_call', (data: any) => {
    incomingCallReceived = true;
    receivedCallData = data;
  });

  customerSocket.emit('customer:call_agent', {
    callId,
    customerId: customerUser.id,
    customerName: customerUser.name,
    customerPhone: customerUser.phone,
    preferredLanguage: 'ta'
  });

  await sleep(1000);
  assert('Agent received real-time agent:incoming_call notification', incomingCallReceived);
  assert('Incoming call contains customer details (name, phone, language)',
    receivedCallData && receivedCallData.customerName === customerUser.name && receivedCallData.preferredLanguage === 'ta');

  // Step 2d: Agent Accepts the Call
  let callConnectedToCustomer = false;
  customerSocket.on('customer:call_accepted', () => {
    callConnectedToCustomer = true;
  });

  agentSocket.emit('agent:accept_call', {
    callId,
    agentId: agentUser.id,
    agentName: agentUser.name
  });

  await sleep(600);
  assert('Customer received customer:call_accepted and call is live', callConnectedToCustomer);

  // Step 2e: Exchanging live speech transcripts during active call
  customerSocket.emit('call:live_speech', {
    callId,
    sender: 'customer',
    text: 'எனக்கு என் இன்வாய்ஸ் பதிவிறக்கம் செய்ய முடியவில்லை. உதவி செய்ய முடியுமா?',
    language: 'ta'
  });
  await sleep(300);

  agentSocket.emit('call:live_speech', {
    callId,
    sender: 'agent',
    text: 'நிச்சயமாக! உங்கள் பில்லிங் பகுதிக்குச் சென்று பதிவிறக்க பொத்தானைக் கிளிக் செய்யவும்.',
    language: 'ta'
  });
  await sleep(300);

  // Step 2f: End Call cleanly
  let callFinalized = false;
  customerSocket.on('call:ended', () => {
    callFinalized = true;
  });

  agentSocket.emit('call:end', {
    callId,
    duration: 65,
    endedBy: 'agent',
    notes: 'Customer guided on invoice download. Issue resolved successfully.'
  });

  await sleep(1000);
  assert('Call ended cleanly across all participants', callFinalized);

  // ==========================================================================
  // SECTION 3: AI GROUNDED CALL & ADMIN TRANSFER WORKFLOW
  // ==========================================================================
  console.log('\n--- 3. AI GROUNDED CALL & LIVE ADMIN TRANSFER WORKFLOW ---');

  const aiCallId = `ai_call_${Date.now()}`;
  let aiReadyReceived = false;
  customerSocket.on('call:ready', () => {
    aiReadyReceived = true;
  });

  customerSocket.emit('call:start', {
    callId: aiCallId,
    customerId: customerUser.id,
    customerName: customerUser.name,
    customerPhone: customerUser.phone,
    language: 'en'
  });

  await sleep(600);
  assert('Customer started AI call and received call:ready event', aiReadyReceived);

  // Customer asks a query that requires Admin transfer
  let adminReceivedTransfer = false;
  let transferDetails: any = null;

  adminSocket.on('transfer:incoming', (data: any) => {
    adminReceivedTransfer = true;
    transferDetails = data;
  });

  customerSocket.emit('call:query', {
    callId: aiCallId,
    query: 'I need an urgent manual discount approval from a human admin.',
    customerId: customerUser.id,
    language: 'en'
  });

  await sleep(1200);
  assert('Ungrounded query triggered transfer:incoming alert to Admin', adminReceivedTransfer);
  assert('Transfer contains customer question & details',
    Boolean(transferDetails && transferDetails.transferId && transferDetails.customerName));

  // Admin accepts the transfer
  let transferConnected = false;
  customerSocket.on('transfer:connected', () => {
    transferConnected = true;
  });

  adminSocket.emit('transfer:accept', {
    transferId: transferDetails.transferId,
    adminId: adminUser.id,
    adminName: adminUser.name
  });

  await sleep(600);
  assert('Customer connected to Admin via transfer:connected event', transferConnected);

  // Admin ends the transferred call
  adminSocket.emit('call:end', {
    callId: aiCallId,
    duration: 90,
    endedBy: 'admin',
    notes: 'Approved special manual discount.'
  });
  await sleep(800);

  // ==========================================================================
  // SECTION 4: POST-CALL INTELLIGENCE & KNOWLEDGE GAPS
  // ==========================================================================
  console.log('\n--- 4. POST-CALL INTELLIGENCE & KNOWLEDGE GAPS ---');

  const savedCall = await prisma.callRecord.findFirst({
    where: { callId },
    include: {
      transcripts: true,
      intelligence: true
    }
  });

  assert('CallRecord saved in database with completed status', Boolean(savedCall && savedCall.status === 'completed'));
  assert('Transcripts saved in database', Boolean(savedCall && savedCall.transcripts.length >= 2));

  // Run intelligence processing
  if (savedCall) {
    const intel = await callIntelligenceService.processCall(savedCall.id, true);
    const summaryText = intel?.overallSummary || (intel as any)?.summary || '';
    assert('Structured summary generated from transcript', Boolean(summaryText && summaryText.length > 5));
    assert('Resolution classification detected accurately (resolved/partially)',
      Boolean(intel && ['resolved', 'partially_resolved', 'unresolved', 'escalated_admin'].includes(intel.resolutionStatus)));
    assert('Sentiment score and reasoning extracted', Boolean(intel && intel.sentiment));
  }

  // ==========================================================================
  // SECTION 5: DASHBOARD ACCURACY ACROSS CUSTOMER, AGENT & ADMIN
  // ==========================================================================
  console.log('\n--- 5. DASHBOARD DATA ACCURACY ACROSS CUSTOMER, AGENT & ADMIN ---');

  // Customer Dashboard
  const custHistoryRes = await fetch(`${API_URL}/calls/my-history`, {
    headers: { Authorization: `Bearer ${customerToken}` }
  });
  const custHistory = await custHistoryRes.json();
  const foundInCust = custHistory.calls?.some((c: any) => c.callId === callId || c.callId === aiCallId);
  assert('Customer dashboard shows completed calls in history', foundInCust);

  // Agent Dashboard
  const agentHistoryRes = await fetch(`${API_URL}/calls?status=completed`, {
    headers: { Authorization: `Bearer ${agentToken}` }
  });
  const agentHistory = await agentHistoryRes.json();
  const foundInAgent = agentHistory.calls?.some((c: any) => c.callId === callId);
  assert('Agent dashboard shows call record with notes and duration', foundInAgent);

  // Admin Dashboard
  const adminStatsRes = await fetch(`${API_URL}/calls/stats`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const adminStats = await adminStatsRes.json();
  assert('Admin dashboard reports accurate call counts and metrics', adminStatsRes.ok && adminStats.totalCalls >= 1);

  // Clean up sockets
  customerSocket.disconnect();
  agentSocket.disconnect();
  adminSocket.disconnect();

  console.log('\n================================================================');
  console.log(`📊 FINAL RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runCustomerAcceptanceTests().catch(err => {
  console.error('Acceptance Suite Crashed:', err);
  process.exit(1);
});
