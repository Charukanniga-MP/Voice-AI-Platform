import jwt from 'jsonwebtoken';
import twilio from 'twilio';
import { prisma } from './db.js';
import { validateJwtConfig, generateToken } from './middleware/auth.js';
import { validateTwilioWebhook, validateCallbackParams } from './routes/telephony.routes.js';

const BASE = 'http://localhost:5000/api';

async function runSecurityTestSuite() {
  console.log('\n=============================================================');
  console.log('🛡️  KAIRA VOICE AI – PHASE 1 SECURITY VERIFICATION SUITE');
  console.log('=============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(name: string, condition: boolean, extraInfo: string = '') {
    if (condition) {
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${name} ${extraInfo}`);
      failed++;
    }
  }

  // --------------------------------------------------------------------------
  // TEST 1: JWT Secret Configuration & Validation Rules
  // --------------------------------------------------------------------------
  console.log('--- TEST 1: JWT SECRET CONFIGURATION & VALIDATION ---');

  // Test missing secret
  const oldSecret = process.env.JWT_SECRET;
  try {
    delete process.env.JWT_SECRET;
    let threw = false;
    try {
      validateJwtConfig();
    } catch (e: any) {
      threw = e.message.includes('missing');
    }
    assert('Throws error when JWT_SECRET is missing', threw);

    // Test short secret (< 32 chars)
    process.env.JWT_SECRET = 'short-key-12345';
    threw = false;
    try {
      validateJwtConfig();
    } catch (e: any) {
      threw = e.message.includes('too short');
    }
    assert('Throws error when JWT_SECRET is shorter than 32 characters', threw);

    // Test insecure default secret
    process.env.JWT_SECRET = 'kaira-production-secret-voice-key-2025';
    threw = false;
    try {
      validateJwtConfig();
    } catch (e: any) {
      threw = e.message.includes('Insecure or default');
    }
    assert('Throws error when default insecure placeholder is used', threw);
  } finally {
    process.env.JWT_SECRET = oldSecret;
  }

  const activeSecret = validateJwtConfig();
  assert('Current JWT_SECRET is strong and valid (length >= 32)', activeSecret.length >= 32);

  // --------------------------------------------------------------------------
  // TEST 2: Role-Based Logins (Admin, Agent, Customer)
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 2: ADMIN, AGENT, AND CUSTOMER AUTHENTICATION ---');

  // 2a. Admin Login
  const adminRes = await fetch(`${BASE}/auth/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@kaira', password: 'kaira@123' })
  });
  const adminData = await adminRes.json();
  assert('Admin login succeeds with 200', adminRes.ok);
  assert('Admin receives valid JWT', Boolean(adminData.token && adminData.user?.role === 'admin'));
  const adminToken = adminData.token;

  // 2b. Agent Login
  const agentRes = await fetch(`${BASE}/auth/agent/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'agent@kaira', password: 'kaira@123' })
  });
  const agentData = await agentRes.json();
  assert('Agent login succeeds with 200', agentRes.ok);
  assert('Agent receives valid JWT', Boolean(agentData.token && agentData.user?.role === 'agent'));
  const agentToken = agentData.token;

  // 2c. Customer Registration & Login
  const testCustomerEmail = `sec_test_${Date.now()}@kairatest.com`;
  const regRes = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Security Test Customer',
      email: testCustomerEmail,
      phone: '+919876543210',
      password: 'CustomerPass123!',
      confirmPassword: 'CustomerPass123!'
    })
  });
  const regData = await regRes.json();
  assert('Customer registration succeeds with 201', regRes.status === 201);
  assert('Customer registration issues JWT token', Boolean(regData.token && regData.user?.role === 'customer'));
  const customerToken = regData.token;
  const customerId = regData.user.id;

  // Customer Login with same credentials
  const custLoginRes = await fetch(`${BASE}/auth/customer/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testCustomerEmail, password: 'CustomerPass123!' })
  });
  const custLoginData = await custLoginRes.json();
  assert('Customer login succeeds with 200', custLoginRes.ok && custLoginData.user?.role === 'customer');

  // --------------------------------------------------------------------------
  // TEST 3: Token Manipulation & Tampering Protection
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 3: TOKEN SIGNATURE & TAMPERING VERIFICATION ---');

  // Customer tries to elevate privilege to 'admin' by forging a token with arbitrary secret
  const forgedAdminToken = jwt.sign(
    { id: customerId, email: testCustomerEmail, name: 'Forged Admin', role: 'admin' },
    'forged-fake-secret-key-that-does-not-match-server',
    { algorithm: 'HS256' }
  );

  const forgedAccessRes = await fetch(`${BASE}/agents`, {
    headers: { Authorization: `Bearer ${forgedAdminToken}` }
  });
  assert('Forged JWT with attacker secret is rejected (401)', forgedAccessRes.status === 401);

  // Manipulate token payload without resigning
  const parts = customerToken.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ id: customerId, email: testCustomerEmail, role: 'admin' })).toString('base64');
  const tamperedToken = `${parts[0]}.${forgedPayload}.${parts[2]}`;

  const tamperedRes = await fetch(`${BASE}/agents`, {
    headers: { Authorization: `Bearer ${tamperedToken}` }
  });
  assert('Tampered JWT with modified payload is rejected (401)', tamperedRes.status === 401);

  // Expired token rejection
  const expiredToken = jwt.sign(
    { id: customerId, email: testCustomerEmail, name: 'Expired', role: 'customer' },
    activeSecret,
    { algorithm: 'HS256', expiresIn: -10 }
  );
  const expiredRes = await fetch(`${BASE}/calls/my-history`, {
    headers: { Authorization: `Bearer ${expiredToken}` }
  });
  assert('Expired token is rejected (401)', expiredRes.status === 401);

  // --------------------------------------------------------------------------
  // TEST 4: Dev Git Sync Endpoint Access Control
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 4: DEV GIT SYNC ENDPOINT SECURITY ---');

  // 4a. Unauthenticated access must be rejected
  const unauthDevRes = await fetch(`${BASE}/dev/git/status`);
  assert('Unauthenticated access to /api/dev/git/status is blocked (401)', unauthDevRes.status === 401);

  // 4b. Customer role must be forbidden
  const customerDevRes = await fetch(`${BASE}/dev/git/status`, {
    headers: { Authorization: `Bearer ${customerToken}` }
  });
  assert('Customer access to /api/dev/git/status is denied (403)', customerDevRes.status === 403);

  // 4c. Agent role must be forbidden
  const agentDevRes = await fetch(`${BASE}/dev/git/status`, {
    headers: { Authorization: `Bearer ${agentToken}` }
  });
  assert('Agent access to /api/dev/git/status is denied (403)', agentDevRes.status === 403);

  // 4d. Authorized Admin access succeeds
  const adminDevRes = await fetch(`${BASE}/dev/git/status`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const devStatus = await adminDevRes.json();
  assert('Admin access to /api/dev/git/status succeeds (200)', adminDevRes.ok && devStatus.success === true);

  // --------------------------------------------------------------------------
  // TEST 5: Secure Knowledge Base File Access & Path Traversal Prevention
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 5: KNOWLEDGE BASE UPLOADS & PATH TRAVERSAL DEFENSE ---');

  // 5a. Direct access to /uploads without authentication must be blocked
  const unauthUploadRes = await fetch('http://localhost:5000/uploads/test.pdf');
  assert('Unauthenticated public GET /uploads/test.pdf is blocked (401)', unauthUploadRes.status === 401);

  // 5b. Customer role cannot access private uploaded documents
  const customerUploadRes = await fetch('http://localhost:5000/uploads/test.pdf', {
    headers: { Authorization: `Bearer ${customerToken}` }
  });
  assert('Customer role blocked from GET /uploads/:file (403)', customerUploadRes.status === 403);

  // 5c. Path traversal attack attempt blocked
  const traversalAttemptRes = await fetch('http://localhost:5000/uploads/..%2f..%2fpackage.json', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert('Directory traversal (..%2f) blocked (403 or 404)', traversalAttemptRes.status === 403 || traversalAttemptRes.status === 404);

  // 5d. Authenticated KB list endpoint works
  const kbListRes = await fetch(`${BASE}/knowledge`, {
    headers: { Authorization: `Bearer ${agentToken}` }
  });
  assert('Authenticated Agent can query /api/knowledge (200)', kbListRes.ok);

  // --------------------------------------------------------------------------
  // TEST 6: Twilio Webhook Security (Signature & Parameter Validation)
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 6: TWILIO WEBHOOK SIGNATURE & PARAMETER DEFENSE ---');

  // 6a. Post to /api/telephony/status-callback with fraudulent fake signature
  const fakeSigRes = await fetch(`${BASE}/telephony/status-callback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Twilio-Signature': 'invalid-forged-signature-9876543210'
    },
    body: new URLSearchParams({
      CallSid: 'CA1234567890abcdef1234567890abcdef',
      CallStatus: 'completed'
    })
  });
  assert('Spoofed Twilio webhook with invalid signature is rejected (403)', fakeSigRes.status === 403);

  // 6b. Post to status-callback with malformed CallSid format
  const badParamRes = await fetch(`${BASE}/telephony/status-callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      CallSid: 'invalid!*bad?chars',
      CallStatus: 'completed'
    })
  });
  assert('Webhook with malformed CallSid format is rejected (400)', badParamRes.status === 400);

  // 6c. Post to status-callback with unrecognized CallStatus
  const badStatusRes = await fetch(`${BASE}/telephony/status-callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      CallSid: 'CA00000000000000000000000000000000',
      CallStatus: 'injected_hacked_status'
    })
  });
  assert('Webhook with invalid CallStatus is rejected (400)', badStatusRes.status === 400);

  // 6d. Direct Cryptographic Signature Verification Unit Test
  const testTwilioToken = '1234567890abcdef1234567890abcdef';
  const origToken = process.env.TWILIO_AUTH_TOKEN;
  process.env.TWILIO_AUTH_TOKEN = testTwilioToken;

  try {
    const testUrl = 'http://localhost:5000/api/telephony/status-callback';
    const testParams = {
      CallSid: 'CA11112222333344445555666677778888',
      CallStatus: 'completed',
      CallDuration: '45'
    };
    const validSignature = twilio.getExpectedTwilioSignature(testTwilioToken, testUrl, testParams);

    // Test with VALID signature
    let validPassed = false;
    const mockReqValid: any = {
      headers: { 'x-twilio-signature': validSignature },
      protocol: 'http',
      get: () => 'localhost:5000',
      originalUrl: '/api/telephony/status-callback',
      body: testParams
    };
    const mockResValid: any = {
      status: () => mockResValid,
      type: () => mockResValid,
      send: () => { }
    };
    validateTwilioWebhook(mockReqValid, mockResValid, () => {
      validPassed = true;
    });
    assert('Twilio webhook with valid cryptographic signature invokes next()', validPassed);

    // Test with INVALID signature
    let invalidRejected = false;
    const mockReqInvalid: any = {
      headers: { 'x-twilio-signature': 'forged_tampered_signature_value' },
      protocol: 'http',
      get: () => 'localhost:5000',
      originalUrl: '/api/telephony/status-callback',
      body: testParams
    };
    const mockResInvalid: any = {
      status: (code: number) => {
        if (code === 403) invalidRejected = true;
        return mockResInvalid;
      },
      type: () => mockResInvalid,
      send: () => { }
    };
    validateTwilioWebhook(mockReqInvalid, mockResInvalid, () => {
      invalidRejected = false;
    });
    assert('Twilio webhook with tampered signature is rejected with 403', invalidRejected);
  } finally {
    process.env.TWILIO_AUTH_TOKEN = origToken;
  }

  // --------------------------------------------------------------------------
  // TEST 7: Broken Object Level Authorization (BOLA) Protection
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 7: BROKEN OBJECT LEVEL AUTHORIZATION (BOLA) DEFENSE ---');

  // Create a dummy call record owned by Customer A
  const callRecord = await prisma.callRecord.create({
    data: {
      callId: `sec_call_${Date.now()}`,
      providerCallSid: `CA_sec_${Date.now()}`,
      customerId,
      customerName: 'Security Test Customer',
      status: 'completed',
      direction: 'incoming',
      type: 'customer_support',
      startTime: new Date()
    }
  });

  // Create Customer B
  const customerBEmail = `attacker_${Date.now()}@kairatest.com`;
  const regB = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Attacker Customer B',
      email: customerBEmail,
      password: 'Password123!',
      confirmPassword: 'Password123!'
    })
  });
  const dataB = await regB.json();
  const customerBToken = dataB.token;

  // Customer B attempts to rate Customer A's call
  const unauthorizedRateRes = await fetch(`${BASE}/calls/${callRecord.id}/rating`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${customerBToken}`
    },
    body: JSON.stringify({ rating: 1 })
  });
  assert('Customer B cannot rate Customer A call (403 BOLA blocked)', unauthorizedRateRes.status === 403);

  // Customer A rates their OWN call
  const authorizedRateRes = await fetch(`${BASE}/calls/${callRecord.id}/rating`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${customerToken}`
    },
    body: JSON.stringify({ rating: 5 })
  });
  assert('Customer A can successfully rate their own call (200)', authorizedRateRes.ok);

  // Customer B attempts to edit agent notes on call
  const unauthorizedNotesRes = await fetch(`${BASE}/calls/${callRecord.id}/notes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${customerBToken}`
    },
    body: JSON.stringify({ notes: 'Hacked notes' })
  });
  assert('Customer B cannot edit agent notes (403 forbidden)', unauthorizedNotesRes.status === 403);

  // Customer B attempts to submit telemetry/quality metrics for Customer A's call
  const unauthorizedQualityRes = await fetch(`${BASE}/calls/${callRecord.id}/quality`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${customerBToken}`
    },
    body: JSON.stringify({ quality: 'Poor', avgLatency: 999 })
  });
  assert('Customer B cannot tamper with call quality metrics (403 BOLA blocked)', unauthorizedQualityRes.status === 403);

  // --------------------------------------------------------------------------
  // TEST 8: Preserved Call & Dashboard Functionality
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 8: PRESERVED CALL & DASHBOARD FUNCTIONALITY ---');

  // Customer history query
  const historyRes = await fetch(`${BASE}/calls/my-history`, {
    headers: { Authorization: `Bearer ${customerToken}` }
  });
  const historyData = await historyRes.json();
  assert('Customer can fetch own call history (200)', historyRes.ok && Array.isArray(historyData.calls));

  // Agent queue query
  const queueRes = await fetch(`${BASE}/calls/queue`, {
    headers: { Authorization: `Bearer ${agentToken}` }
  });
  const queueData = await queueRes.json();
  assert('Agent can fetch active call queue (200)', queueRes.ok && Array.isArray(queueData.queuedCalls));

  // Admin stats query
  const statsRes = await fetch(`${BASE}/calls/stats`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert('Admin can fetch platform call analytics (200)', statsRes.ok);

  // Clean up test call
  await prisma.callRecord.delete({ where: { id: callRecord.id } });

  console.log('\n=============================================================');
  console.log(`📊 FINAL TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('=============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSecurityTestSuite().catch(err => {
  console.error('Test Suite Crashed:', err);
  process.exit(1);
});
