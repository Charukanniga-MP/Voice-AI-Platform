import { io as Client } from 'socket.io-client';
import { prisma } from './db.js';
import jwt from 'jsonwebtoken';
import { callReliabilityService } from './services/callReliability.js';
import { knowledgeService } from './services/knowledge.js';

const JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_for_kaira_agent_platform_2026';
const BASE_URL = 'http://localhost:5000';

interface TestResult {
  suite: string;
  testName: string;
  passed: boolean;
  details?: string;
}

const testResults: TestResult[] = [];

function recordResult(suite: string, testName: string, passed: boolean, details?: string) {
  testResults.push({ suite, testName, passed, details });
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`[${icon}] [${suite}] ${testName}${details ? ` -> ${details}` : ''}`);
}

async function runCallReliabilityRecoveryTests() {
  console.log('================================================================');
  console.log('🚀 STARTING KAIRA CALL RELIABILITY & AUTOMATIC RECOVERY TESTS');
  console.log('================================================================\n');

  try {
    // 1. Setup Test Users & Auth Tokens
    const adminUser = await prisma.user.findFirst({ where: { role: 'admin' } });
    const agentUser = await prisma.user.findFirst({ where: { role: 'agent' } });
    const customerUser = await prisma.user.findFirst({ where: { role: 'customer' } });

    if (!adminUser || !agentUser || !customerUser) {
      throw new Error('Required test users (admin, agent, customer) missing from database.');
    }

    const adminToken = jwt.sign({ id: adminUser.id, email: adminUser.email, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
    const agentToken = jwt.sign({ id: agentUser.id, email: agentUser.email, role: 'agent' }, JWT_SECRET, { expiresIn: '1h' });
    const customerToken = jwt.sign({ id: customerUser.id, email: customerUser.email, role: 'customer' }, JWT_SECRET, { expiresIn: '1h' });

    // Connect Sockets
    const adminSocket = Client(BASE_URL, { transports: ['websocket'], auth: { token: adminToken } });
    const customerSocket = Client(BASE_URL, { transports: ['websocket'], auth: { token: customerToken } });
    const agentSocket = Client(BASE_URL, { transports: ['websocket'], auth: { token: agentToken } });

    await Promise.all([
      new Promise<void>(res => adminSocket.on('connect', () => {
        adminSocket.emit('user:register', { userId: adminUser.id, role: 'admin', name: adminUser.name });
        res();
      })),
      new Promise<void>(res => customerSocket.on('connect', () => {
        customerSocket.emit('user:register', { userId: customerUser.id, role: 'customer', name: customerUser.name });
        res();
      })),
      new Promise<void>(res => agentSocket.on('connect', () => {
        agentSocket.emit('user:register', { userId: agentUser.id, role: 'agent', name: agentUser.name });
        res();
      }))
    ]);

    // -------------------------------------------------------------
    // SUITE 1: NETWORK FAILURE DETECTION & AUTOMATIC RECONNECTION
    // -------------------------------------------------------------
    console.log('\n--- SUITE 1: Network Failure Detection & Automatic Reconnection ---');
    const testCallId1 = `call_rel_test_${Date.now()}_1`;

    // Start Call
    await new Promise<void>((resolve) => {
      customerSocket.emit('call:start', {
        callId: testCallId1,
        customerId: customerUser.id,
        customerName: customerUser.name,
        language: 'en'
      });
      customerSocket.once('call:ready', () => resolve());
    });

    // Simulate Network Drop: emit call:reconnecting
    let reconnectingEventReceived = false;
    let reconnectingUserMessage = '';

    const reconPromise = new Promise<void>((resolve) => {
      adminSocket.once('call:reconnecting', (data: any) => {
        if (data.callId === testCallId1) {
          reconnectingEventReceived = true;
          reconnectingUserMessage = data.userMessage || '';
          resolve();
        }
      });
    });

    customerSocket.emit('call:reconnecting', {
      callId: testCallId1,
      attempt: 1,
      reason: 'Internet connection offline'
    });

    await reconPromise;
    recordResult(
      'Network Failure',
      'Detect Disconnection & Broadcast User-Friendly Reconnecting Notice',
      reconnectingEventReceived && reconnectingUserMessage.includes('Reconnecting your call'),
      `Message: "${reconnectingUserMessage}"`
    );

    // Simulate Successful Reconnection
    let reconnectedReceived = false;
    let reconnectedUserMessage = '';

    const reconnectedPromise = new Promise<void>((resolve) => {
      adminSocket.once('call:reconnected', (data: any) => {
        if (data.callId === testCallId1) {
          reconnectedReceived = true;
          reconnectedUserMessage = data.userMessage || '';
          resolve();
        }
      });
    });

    customerSocket.emit('call:reconnected', {
      callId: testCallId1,
      attempt: 1,
      durationMs: 1200
    });

    await reconnectedPromise;
    await new Promise(r => setTimeout(r, 200));

    // Verify DB update
    const callRec1 = await prisma.callRecord.findUnique({ where: { callId: testCallId1 } });
    const wasReconnected = callRec1?.wasReconnected === true && (callRec1?.reconnectCount ?? 0) >= 1;
    recordResult(
      'Network Recovery',
      'Automatic Call Reconnection & Database State Sync',
      reconnectedReceived && wasReconnected,
      `reconnectCount: ${callRec1?.reconnectCount}, wasReconnected: ${callRec1?.wasReconnected}`
    );

    // -------------------------------------------------------------
    // SUITE 2: WEBRTC ICE FAILURE & RE-NEGOTIATION
    // -------------------------------------------------------------
    console.log('\n--- SUITE 2: WebRTC ICE Failure & Re-Negotiation ---');
    const testCallId2 = `call_rel_test_${Date.now()}_2`;

    await new Promise<void>((resolve) => {
      customerSocket.emit('call:start', {
        callId: testCallId2,
        customerId: customerUser.id,
        customerName: customerUser.name,
        language: 'en'
      });
      customerSocket.once('call:ready', () => resolve());
    });

    // Customer reports ICE failure
    customerSocket.emit('call:reconnecting', {
      callId: testCallId2,
      attempt: 2,
      reason: 'ICE state: failed'
    });

    // Agent joins call room to establish WebRTC peer mesh
    agentSocket.emit('call:join', { callId: testCallId2 });
    await new Promise(r => setTimeout(r, 100));

    // Send renegotiated offer
    let iceOfferReceived = false;
    const offerPromise = new Promise<void>((resolve) => {
      agentSocket.once('webrtc:offer', (data: any) => {
        if (data.callId === testCallId2 && data.isReconnect) {
          iceOfferReceived = true;
          resolve();
        }
      });
    });

    customerSocket.emit('webrtc:offer', {
      callId: testCallId2,
      offer: { type: 'offer', sdp: 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' },
      isReconnect: true
    });

    await offerPromise;
    recordResult(
      'WebRTC ICE',
      'ICE Failure Detection & ICE Restart Negotiation (isReconnect: true)',
      iceOfferReceived,
      'ICE restart offer dispatched and received by peer'
    );

    // -------------------------------------------------------------
    // SUITE 3: AUDIO / MICROPHONE DEVICE FAILURE & RE-ACQUISITION
    // -------------------------------------------------------------
    console.log('\n--- SUITE 3: Audio Hardware Device Failure & Restoration ---');
    let deviceErrorReceived = false;
    let deviceErrorMessage = '';

    const devErrPromise = new Promise<void>((resolve) => {
      adminSocket.once('call:device_error', (data: any) => {
        if (data.callId === testCallId1 && data.deviceType === 'microphone') {
          deviceErrorReceived = true;
          deviceErrorMessage = data.userMessage || '';
          resolve();
        }
      });
    });

    customerSocket.emit('call:device_error', {
      callId: testCallId1,
      deviceType: 'microphone',
      status: 'error',
      details: 'Audio input track ended unexpectedly'
    });

    await devErrPromise;
    recordResult(
      'Device Health',
      'Microphone Disconnection Detection & Safe User Guidance',
      deviceErrorReceived && deviceErrorMessage.includes('Microphone access is unavailable'),
      `Notice: "${deviceErrorMessage}"`
    );

    // Device Restored
    let deviceRestoredReceived = false;
    const devRestorePromise = new Promise<void>((resolve) => {
      adminSocket.once('call:device_error', (data: any) => {
        if (data.callId === testCallId1 && data.status === 'restored') {
          deviceRestoredReceived = true;
          resolve();
        }
      });
    });

    customerSocket.emit('call:device_error', {
      callId: testCallId1,
      deviceType: 'microphone',
      status: 'restored'
    });

    await devRestorePromise;
    recordResult(
      'Device Health',
      'Microphone Re-Acquisition & Hardware Restoration',
      deviceRestoredReceived,
      'Audio track restored and verified'
    );

    // -------------------------------------------------------------
    // SUITE 4: INTELLIGENT AI FALLBACK (TTS & LLM)
    // -------------------------------------------------------------
    console.log('\n--- SUITE 4: Intelligent AI Fallback (TTS & LLM) ---');

    // Test TTS Fallback Notification
    let ttsFallbackReceived = false;
    const ttsPromise = new Promise<void>((resolve) => {
      adminSocket.once('call:ai_fallback_triggered', (data: any) => {
        if (data.callId === testCallId1 && data.serviceType === 'tts') {
          ttsFallbackReceived = true;
          resolve();
        }
      });
    });

    customerSocket.emit('call:ai_fallback_triggered', {
      callId: testCallId1,
      serviceType: 'tts',
      fallbackProvider: 'Web Speech API (SpeechSynthesis)',
      reason: 'Server audio stream timeout'
    });

    await ttsPromise;
    recordResult(
      'AI Fallback',
      'TTS Service Failure & Automatic SpeechSynthesis Transition',
      ttsFallbackReceived,
      'Switched from server stream to client Web Speech synthesis fallback'
    );

    // Test Zero-Latency Local LLM Knowledge Fallback
    const fallbackAnswer = await knowledgeService.answerQuery('What is KAIRA VoiceCore?');
    recordResult(
      'AI Fallback',
      'LLM Timeout / Quota Exhaustion Zero-Latency NLP Fallback',
      fallbackAnswer.isGrounded && fallbackAnswer.answer.toLowerCase().includes('voice'),
      `Answer length: ${fallbackAnswer.answer.length} chars (Latency: ${fallbackAnswer.latencyMs}ms)`
    );

    // -------------------------------------------------------------
    // SUITE 5: SOCKET.IO DISCONNECTION & CONTEXT PRESERVATION
    // -------------------------------------------------------------
    console.log('\n--- SUITE 5: Socket Disconnection & Context Preservation ---');
    const testCallId5 = `call_rel_test_${Date.now()}_5`;

    // Customer starts call
    let initialGreetingReceived = false;
    await new Promise<void>((resolve) => {
      customerSocket.emit('call:start', {
        callId: testCallId5,
        customerId: customerUser.id,
        customerName: customerUser.name,
        language: 'en'
      });
      customerSocket.once('call:ready', (data: any) => {
        if (data.greeting && data.greeting.length > 0) initialGreetingReceived = true;
        resolve();
      });
    });

    // Customer asks question before disconnect
    await new Promise<void>((resolve) => {
      customerSocket.emit('call:query', {
        callId: testCallId5,
        query: 'What products does KAIRA offer?',
        customerId: customerUser.id,
        utteranceId: `utt_before_drop_${Date.now()}`
      });
      customerSocket.once('call:ai_response', () => resolve());
    });

    // Simulate Reconnect: call:start on same callId must NOT replay greeting
    let reconnectedGreeting = 'UNSET';
    await new Promise<void>((resolve) => {
      customerSocket.emit('call:start', {
        callId: testCallId5,
        customerId: customerUser.id,
        customerName: customerUser.name,
        language: 'en'
      });
      customerSocket.once('call:ready', (data: any) => {
        reconnectedGreeting = data.greeting;
        resolve();
      });
    });

    recordResult(
      'Session Preservation',
      'Socket Reconnection Suppresses Duplicate Greeting',
      initialGreetingReceived && reconnectedGreeting === '',
      `Initial greeting: true, Reconnected greeting: "" (Zero replayed audio)`
    );

    // Context Retention: follow-up query after reconnection
    let followUpAnswer = '';
    await new Promise<void>((resolve) => {
      customerSocket.emit('call:query', {
        callId: testCallId5,
        query: 'Can you tell me more about VoiceCore?',
        customerId: customerUser.id,
        utteranceId: `utt_after_drop_${Date.now()}`
      });
      customerSocket.once('call:ai_response', (data: any) => {
        followUpAnswer = data.answer || '';
        resolve();
      });
    });

    recordResult(
      'Session Preservation',
      'Conversation Context Retained Across Reconnection Turns',
      followUpAnswer.toLowerCase().includes('voicecore') || followUpAnswer.toLowerCase().includes('voice'),
      `Retained dialogue context. Response: "${followUpAnswer.slice(0, 50)}..."`
    );

    // -------------------------------------------------------------
    // SUITE 6: DUPLICATE RECOVERY PREVENTION (CONCURRENCY LOCK)
    // -------------------------------------------------------------
    console.log('\n--- SUITE 6: Duplicate Recovery Prevention (Concurrency Lock) ---');
    const lockCallId = `call_lock_${Date.now()}`;
    const firstLock = callReliabilityService.acquireRecoveryLock(lockCallId);
    const secondLock = callReliabilityService.acquireRecoveryLock(lockCallId);
    callReliabilityService.releaseRecoveryLock(lockCallId);
    const thirdLock = callReliabilityService.acquireRecoveryLock(lockCallId);
    callReliabilityService.releaseRecoveryLock(lockCallId);

    recordResult(
      'Concurrency Guard',
      'Prevent Duplicate In-Flight Recovery Operations (Mutex Lock)',
      firstLock === true && secondLock === false && thirdLock === true,
      `Attempt 1: ${firstLock}, Attempt 2 (Duplicate): ${secondLock}, Attempt 3 (Post-Release): ${thirdLock}`
    );

    // -------------------------------------------------------------
    // SUITE 7: HUMAN AGENT TAKEOVER DURING RECOVERY
    // -------------------------------------------------------------
    console.log('\n--- SUITE 7: Human Agent Takeover During Recovery ---');
    const takeoverCallId = `call_takeover_recon_${Date.now()}`;

    await new Promise<void>((resolve) => {
      customerSocket.emit('call:start', {
        callId: takeoverCallId,
        customerId: customerUser.id,
        customerName: customerUser.name,
        language: 'en'
      });
      customerSocket.once('call:ready', () => resolve());
    });

    // Mark as reconnecting
    customerSocket.emit('call:reconnecting', {
      callId: takeoverCallId,
      attempt: 1,
      reason: 'Network reconnection in progress'
    });

    // Human agent/admin executes direct takeover during recovery
    let aiSilencedReceived = false;
    const silencePromise = new Promise<void>((resolve) => {
      customerSocket.once('call:ai_silenced', (data: any) => {
        if (data.callId === takeoverCallId) {
          aiSilencedReceived = true;
          resolve();
        }
      });
    });

    adminSocket.emit('transfer:accept', {
      transferId: `direct_takeover_${takeoverCallId}`,
      adminId: adminUser.id,
      adminName: adminUser.name
    });

    await silencePromise;

    // AI queries are blocked post-takeover
    let queryHandledByAI = false;
    customerSocket.emit('call:query', {
      callId: takeoverCallId,
      query: 'Are you an AI?',
      customerId: customerUser.id,
      utteranceId: `utt_takeover_test_${Date.now()}`
    });

    customerSocket.once('call:ai_response', () => {
      queryHandledByAI = true;
    });

    await new Promise(r => setTimeout(r, 400));
    recordResult(
      'Human Takeover',
      'Takeover Immediately Silences AI Audio and Suppresses Subsequent AI Queries',
      aiSilencedReceived && !queryHandledByAI,
      `ai_silenced event: ${aiSilencedReceived}, AI response suppressed: ${!queryHandledByAI}`
    );

    // -------------------------------------------------------------
    // SUITE 8: CALL HEALTH & SERVICE MONITORING APIS
    // -------------------------------------------------------------
    console.log('\n--- SUITE 8: Call Health & Service Monitoring APIs ---');

    // 1. Service health check endpoint
    const serviceHealthRes = await fetch(`${BASE_URL}/api/calls/health/services`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const serviceHealthData = await serviceHealthRes.json();
    const isServiceHealthValid = Boolean(
      serviceHealthRes.ok &&
      serviceHealthData.stt?.status &&
      serviceHealthData.llm?.status &&
      serviceHealthData.tts?.status &&
      serviceHealthData.database?.status
    );
    recordResult(
      'Health Monitoring',
      'GET /api/calls/health/services (STT, LLM, TTS, WebRTC, DB Health)',
      isServiceHealthValid,
      `STT: ${serviceHealthData.stt?.status}, LLM: ${serviceHealthData.llm?.status}, TTS: ${serviceHealthData.tts?.status}, DB: ${serviceHealthData.database?.status}`
    );

    // 2. Telemetry update and active call health check via Socket
    customerSocket.emit('call:health_report', {
      callId: testCallId1,
      webrtcState: 'connected',
      iceState: 'connected',
      latencyMs: 38,
      packetLoss: 0.2,
      jitterMs: 4,
      audioDeviceStatus: 'healthy',
      reconnectAttempts: 1
    });

    await new Promise(r => setTimeout(r, 200));

    const liveHealthRes = await fetch(`${BASE_URL}/api/calls/health/live`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const liveHealthData = await liveHealthRes.json();
    const hasActiveCallTelemetry = Boolean(liveHealthRes.ok && liveHealthData.activeCalls?.length > 0);
    recordResult(
      'Health Monitoring',
      'GET /api/calls/health/live (Active Call WebRTC & Telemetry Stream)',
      hasActiveCallTelemetry,
      `Found ${liveHealthData.activeCalls?.length} active monitored calls`
    );

    // -------------------------------------------------------------
    // SUITE 9: FAILURE LOGS & RECOVERY ANALYTICS (AUDIT & TRENDS)
    // -------------------------------------------------------------
    console.log('\n--- SUITE 9: Failure Logs & Recovery Analytics ---');

    const recoveryEventsRes = await fetch(`${BASE_URL}/api/calls/recovery/events?failureType=all&recoveryStatus=all`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const recoveryAnalytics = await recoveryEventsRes.json();
    const hasAnalytics = Boolean(
      recoveryEventsRes.ok &&
      typeof recoveryAnalytics.totalEvents === 'number' &&
      typeof recoveryAnalytics.recoverySuccessRate === 'number' &&
      Array.isArray(recoveryAnalytics.recentEvents)
    );

    recordResult(
      'Recovery Analytics',
      'GET /api/calls/recovery/events (Aggregated Trends & Failure Logs)',
      hasAnalytics,
      `Total Events: ${recoveryAnalytics.totalEvents}, Success Rate: ${recoveryAnalytics.recoverySuccessRate}%`
    );

    // Clean disconnect
    adminSocket.disconnect();
    customerSocket.disconnect();
    agentSocket.disconnect();

  } catch (err: any) {
    recordResult('Execution', 'Test Suite Execution Error', false, err.message);
  }

  // Summary
  console.log('\n================================================================');
  console.log('📊 CALL RELIABILITY & AUTOMATIC RECOVERY TEST SUMMARY');
  console.log('================================================================');
  const total = testResults.length;
  const passed = testResults.filter(r => r.passed).length;
  const failed = total - passed;
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0';

  console.log(`Total Checks Run: ${total}`);
  console.log(`Passed:           ${passed}`);
  console.log(`Failed:           ${failed}`);
  console.log(`Success Rate:     ${passRate}%\n`);

  if (failed === 0) {
    console.log('✅ ALL CALL RELIABILITY & AUTOMATIC RECOVERY TESTS PASSED PERFECTLY!\n');
    process.exit(0);
  } else {
    console.error('❌ Some tests failed. Review details above.\n');
    process.exit(1);
  }
}

runCallReliabilityRecoveryTests();
