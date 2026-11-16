import { io as Client } from 'socket.io-client';
import { prisma } from './db.js';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_for_kaira_agent_platform_2026';
const BASE_URL = 'http://localhost:5000';

async function runWebRTCCallQualityTests() {
  console.log('====================================================');
  console.log('🧪 TESTING WEBRTC CALLING & CALL QUALITY MONITORING');
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

  // 1. Setup Test Users & Tokens
  const adminUser = await prisma.user.findFirst({ where: { role: 'admin' } });
  const agentUser = await prisma.user.findFirst({ where: { role: 'agent' } });
  const customerUser = await prisma.user.findFirst({ where: { role: 'customer' } });

  assert(Boolean(adminUser && agentUser && customerUser), 'Admin, Agent, and Customer accounts exist in database');

  const adminToken = jwt.sign({ id: adminUser!.id, email: adminUser!.email, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
  const agentToken = jwt.sign({ id: agentUser!.id, email: agentUser!.email, role: 'agent' }, JWT_SECRET, { expiresIn: '1h' });
  const customerToken = jwt.sign({ id: customerUser!.id, email: customerUser!.email, role: 'customer' }, JWT_SECRET, { expiresIn: '1h' });

  // 2. WebRTC ICE Servers Endpoint
  console.log('\n--- 1. WebRTC ICE & TURN Servers Endpoint ---');
  const iceRes = await fetch(`${BASE_URL}/api/telephony/ice-servers`, {
    headers: { Authorization: `Bearer ${customerToken}` }
  });
  assert(iceRes.ok, `GET /api/telephony/ice-servers returned HTTP ${iceRes.status}`);
  const iceData = await iceRes.json();
  assert(Array.isArray(iceData.iceServers) && iceData.iceServers.length > 0, `Returned ${iceData.iceServers?.length} ICE servers`);
  assert(typeof iceData.turnAvailable === 'boolean', `turnAvailable flag present: ${iceData.turnAvailable}`);

  // 3. Call Quality Alert Settings (GET & PUT)
  console.log('\n--- 2. Call Quality Alert Thresholds Settings ---');
  const getSettingsRes = await fetch(`${BASE_URL}/api/calls/quality/alerts/settings`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(getSettingsRes.ok, `GET /api/calls/quality/alerts/settings returned HTTP ${getSettingsRes.status}`);
  const initialSettings = await getSettingsRes.json();
  assert(typeof initialSettings.speechRecognitionThreshold === 'number', `speechRecognitionThreshold is ${initialSettings.speechRecognitionThreshold}`);
  assert(typeof initialSettings.droppedCallThreshold === 'number', `droppedCallThreshold is ${initialSettings.droppedCallThreshold}`);
  assert(typeof initialSettings.windowMinutes === 'number', `windowMinutes is ${initialSettings.windowMinutes}`);

  // Update thresholds to 2 for testing alert trigger
  const updateSettingsRes = await fetch(`${BASE_URL}/api/calls/quality/alerts/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      speechRecognitionThreshold: 2,
      droppedCallThreshold: 2,
      recordingUploadThreshold: 2,
      windowMinutes: 60
    })
  });
  assert(updateSettingsRes.ok, `PUT /api/calls/quality/alerts/settings updated thresholds to 2`);

  // 4. Socket.IO Admin Room Quality Alert Delivery
  console.log('\n--- 3. Real-Time Call Quality Alert Delivery via Socket.IO ---');
  const adminSocket = Client(BASE_URL, {
    transports: ['websocket'],
    auth: { token: adminToken }
  });

  const customerSocket = Client(BASE_URL, {
    transports: ['websocket'],
    auth: { token: customerToken }
  });

  await new Promise<void>((resolve) => {
    let connectedCount = 0;
    const check = () => {
      connectedCount++;
      if (connectedCount === 2) {
        setTimeout(resolve, 500);
      }
    };
    adminSocket.on('connect', () => {
      adminSocket.emit('user:register', { userId: adminUser!.id, role: 'admin', name: adminUser!.name });
      check();
    });
    customerSocket.on('connect', () => {
      customerSocket.emit('user:register', { userId: customerUser!.id, role: 'customer', name: customerUser!.name });
      check();
    });
  });

  assert(adminSocket.connected && customerSocket.connected, 'Admin and Customer Sockets successfully connected');

  // Reset alert state for speech_recognition_failure so window rate-limit doesn't suppress test alert
  await prisma.callQualityAlertState.deleteMany({ where: { eventType: 'speech_recognition_failure' } });

  // Create a test call record
  const testCallId = `test_qual_call_${Date.now()}`;
  const testCallRecord = await prisma.callRecord.create({
    data: {
      callId: testCallId,
      customerId: customerUser!.id,
      customerName: customerUser!.name,
      agentId: agentUser!.id,
      agentName: agentUser!.name,
      status: 'active',
      direction: 'incoming',
      type: 'agent_call',
      startTime: new Date(),
      language: 'en'
    }
  });

  // 5. WebRTC ICE Candidate Routing via Socket.IO
  console.log('\n--- 4. WebRTC ICE Candidate Exchange via Socket.IO ---');
  customerSocket.emit('call:join', { callId: testCallId });
  adminSocket.emit('call:join', { callId: testCallId });

  let iceCandidateReceived = false;
  adminSocket.on('webrtc:ice-candidate', (data: any) => {
    if (data.callId === testCallId && data.candidate) {
      iceCandidateReceived = true;
    }
  });

  customerSocket.emit('webrtc:ice-candidate', {
    target: adminSocket.id,
    candidate: { candidate: 'candidate:1 1 UDP 2130706431 192.168.1.1 50000 typ host', sdpMid: '0', sdpMLineIndex: 0 },
    callId: testCallId
  });

  await new Promise((r) => setTimeout(r, 600));
  assert(iceCandidateReceived, 'WebRTC ICE candidate successfully routed between customer and admin peers');

  // 6. Call Quality Telemetry Endpoint
  console.log('\n--- 5. Call Quality Telemetry Submission Endpoint ---');
  const qualityTelemetryRes = await fetch(`${BASE_URL}/api/calls/${testCallRecord.id}/quality`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${customerToken}`
    },
    body: JSON.stringify({
      quality: 'Good',
      avgLatency: 85,
      avgPacketLoss: 0.5,
      jitter: 12
    })
  });
  assert(qualityTelemetryRes.ok, `POST /api/calls/:id/quality returned HTTP ${qualityTelemetryRes.status}`);

  const updatedCallWithQuality = await prisma.callRecord.findUnique({
    where: { id: testCallRecord.id }
  });
  assert(updatedCallWithQuality?.quality === 'Good' && updatedCallWithQuality?.avgLatency === 85, 'Quality telemetry safely persisted in database');

  // 7. Call Quality Event Recording & Alert Trigger
  console.log('\n--- 6. Call Quality Event Recording & Alert Trigger ---');
  let alertReceived: any = null;
  adminSocket.on('call-quality:alert', (alert: any) => {
    alertReceived = alert;
  });

  // Post 1st failure
  await fetch(`${BASE_URL}/api/calls/${testCallRecord.id}/quality-events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${customerToken}`
    },
    body: JSON.stringify({
      eventType: 'speech_recognition_failure',
      details: 'no-speech'
    })
  });

  // Post 2nd failure (should reach threshold of 2 and trigger alert)
  await fetch(`${BASE_URL}/api/calls/${testCallRecord.id}/quality-events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${customerToken}`
    },
    body: JSON.stringify({
      eventType: 'speech_recognition_failure',
      details: 'network-error'
    })
  });

  await new Promise((r) => setTimeout(r, 800));
  assert(Boolean(alertReceived), 'Admin received real-time call-quality:alert via Socket.IO');
  if (alertReceived) {
    assert(alertReceived.eventType === 'speech_recognition_failure', `Alert eventType matched: ${alertReceived.eventType}`);
    assert(alertReceived.count >= 2, `Alert count matched threshold: ${alertReceived.count}`);
  }

  // 8. Dropped Call Network Failure Handling
  console.log('\n--- 7. Dropped Call Network Disconnection & Quality Event ---');
  customerSocket.emit('call:reconnect_failed', {
    callId: testCallId,
    reason: 'WiFi carrier loss during active call'
  });

  await new Promise((r) => setTimeout(r, 1000));
  const droppedCallRecord = await prisma.callRecord.findUnique({
    where: { id: testCallRecord.id }
  });
  assert(droppedCallRecord?.status === 'disconnected', `Call marked disconnected: ${droppedCallRecord?.status}`);
  assert(droppedCallRecord?.endedBy === 'network', `Call endedBy marked network: ${droppedCallRecord?.endedBy}`);

  const droppedQualityEvents = await prisma.callQualityEvent.findMany({
    where: { callRecordId: testCallRecord.id, eventType: 'dropped_call' }
  });
  assert(droppedQualityEvents.length > 0, `dropped_call event recorded in CallQualityEvent table: ${droppedQualityEvents.length}`);

  // 9. Admin Call Quality Statistics API
  console.log('\n--- 8. Admin Call Quality Statistics & First Response Calculation ---');
  const qualityStatsRes = await fetch(`${BASE_URL}/api/calls/quality/stats`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(qualityStatsRes.ok, `GET /api/calls/quality/stats returned HTTP ${qualityStatsRes.status}`);
  const qualityStatsData = await qualityStatsRes.json();
  assert(typeof qualityStatsData.totalCalls === 'number', `totalCalls: ${qualityStatsData.totalCalls}`);
  assert(typeof qualityStatsData.avgFirstResponseMs === 'number', `avgFirstResponseMs computed: ${qualityStatsData.avgFirstResponseMs}ms`);
  assert(typeof qualityStatsData.speechRecognitionFailures === 'number', `speechRecognitionFailures: ${qualityStatsData.speechRecognitionFailures}`);
  assert(typeof qualityStatsData.droppedCalls === 'number', `droppedCalls: ${qualityStatsData.droppedCalls}`);
  assert(Boolean(qualityStatsData.transferOutcomes), 'transferOutcomes breakdown present');

  // Cleanup
  adminSocket.disconnect();
  customerSocket.disconnect();

  // Reset thresholds back to standard values
  await fetch(`${BASE_URL}/api/calls/quality/alerts/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      speechRecognitionThreshold: 5,
      droppedCallThreshold: 5,
      recordingUploadThreshold: 3,
      windowMinutes: 60
    })
  });

  console.log('\n====================================================');
  console.log(`RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runWebRTCCallQualityTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
