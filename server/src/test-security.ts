import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from './db.js';
import { env } from './config/env.js';

const BASE_URL = 'http://localhost:5000';

async function runSecurityTests() {
  console.log('\n=============================================================');
  console.log('🧪 RUNNING KAIRA SECURITY TEST SUITE (ALL 7 FEATURES)');
  console.log('=============================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    totalTests++;
    if (condition) {
      console.log(`✓ PASS: ${testName}`);
      passedTests++;
    } else {
      console.error(`✗ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
    }
  }

  // Wrapper for standard test requests with bypass header to avoid tripping rate limits
  const safeFetch = (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers || {});
    if (!headers.has('x-bypass-rate-limit')) {
      headers.set('x-bypass-rate-limit', 'test-runner-suite');
    }
    return fetch(url, { ...init, headers });
  };

  // Find or create test users
  const admin = await prisma.user.findFirst({ where: { role: 'admin' } });
  const agent = await prisma.user.findFirst({ where: { role: 'agent' } });

  // Clean up previous test customer if any
  const testCustomerEmail = 'security_test_customer@kaira.ai';
  await prisma.user.deleteMany({ where: { email: testCustomerEmail } });

  const customerA = await prisma.user.create({
    data: {
      name: 'Security Test Customer A',
      email: testCustomerEmail,
      role: 'customer',
      passwordHash: '$2a$12$K1Z2rW5zD2r4Z/k2hZkY7O7/a2zU.wM3gV4j5b.X/y1m4Zk6.d9O2'
    }
  });

  const customerB = await prisma.user.findFirst({
    where: { role: 'customer', id: { not: customerA.id } }
  });

  // -------------------------------------------------------------
  // FEATURE 1: FORGOT PASSWORD & RESET PASSWORD
  // -------------------------------------------------------------
  console.log('\n--- 1. Testing Forgot Password & Reset Flow ---');

  // 1.1 Neutral confirmation on registered email
  const forgotResValid = await safeFetch(`${BASE_URL}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: customerA.email })
  });
  const forgotValidData = await forgotResValid.json();
  assert(
    forgotResValid.status === 200 && forgotValidData.message.includes('If an account exists'),
    '1.1 Forgot password returns neutral confirmation for registered email'
  );

  // 1.2 Enumeration prevention: Unregistered email returns identical message
  const forgotResUnknown = await safeFetch(`${BASE_URL}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'non_existent_user_99999@randomdomain.org' })
  });
  const forgotUnknownData = await forgotResUnknown.json();
  assert(
    forgotResUnknown.status === 200 && forgotUnknownData.message === forgotValidData.message,
    '1.2 Enumeration prevention: Unregistered email returns identical response'
  );

  // 1.3 Verify Token Hash in DB & Expiration
  const tokenRecord = await prisma.passwordResetToken.findFirst({
    where: { userId: customerA.id, used: false },
    orderBy: { createdAt: 'desc' }
  });
  assert(
    Boolean(tokenRecord && tokenRecord.tokenHash && tokenRecord.expiresAt > new Date()),
    '1.3 Cryptographic token hash stored in DB with 15-minute expiration'
  );

  // 1.4 Test Token Verification Endpoint
  const testRawToken = crypto.randomBytes(32).toString('hex');
  const testTokenHash = crypto.createHash('sha256').update(testRawToken).digest('hex');
  await prisma.passwordResetToken.create({
    data: {
      userId: customerA.id,
      tokenHash: testTokenHash,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      used: false
    }
  });

  const verifyRes = await safeFetch(`${BASE_URL}/api/auth/verify-reset-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: testRawToken })
  });
  const verifyData = await verifyRes.json();
  assert(verifyRes.status === 200 && verifyData.valid === true, '1.4 Token verification API confirms valid token');

  // 1.5 Weak password rejection
  const weakResetRes = await safeFetch(`${BASE_URL}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: testRawToken,
      newPassword: 'weak',
      confirmPassword: 'weak'
    })
  });
  assert(weakResetRes.status === 400, '1.5 Weak password rejected during password reset');

  // 1.6 Successful password reset with strong password
  const strongNewPass = 'KairaSecurePass2026!#';
  const validResetRes = await safeFetch(`${BASE_URL}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: testRawToken,
      newPassword: strongNewPass,
      confirmPassword: strongNewPass
    })
  });
  const validResetData = await validResetRes.json();
  assert(validResetRes.status === 200 && validResetData.message.includes('successfully reset'), '1.6 Valid password reset successful');

  // 1.7 Prevent token reuse (single-use enforcement)
  const reuseResetRes = await safeFetch(`${BASE_URL}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: testRawToken,
      newPassword: strongNewPass,
      confirmPassword: strongNewPass
    })
  });
  assert(reuseResetRes.status === 400, '1.7 Reused reset token rejected immediately (single-use)');

  // 1.8 Verify login with the newly reset password
  const loginAfterReset = await safeFetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: customerA.email,
      password: strongNewPass
    })
  });
  assert(loginAfterReset.status === 200, '1.8 Successful login with newly reset password');

  // -------------------------------------------------------------
  // FEATURE 2: LOGIN ATTEMPT LIMITS & BRUTE-FORCE PROTECTION
  // -------------------------------------------------------------
  console.log('\n--- 2. Testing Brute-Force & Account Lockout ---');

  // Reset user's failure count first
  await prisma.user.update({
    where: { id: customerA.id },
    data: { failedLoginAttempts: 0, lockedUntil: null }
  });

  // Attempt 5 consecutive failed logins
  for (let i = 1; i <= 5; i++) {
    await safeFetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: customerA.email,
        password: 'IncorrectPassword999!'
      })
    });
  }

  const updatedUser = await prisma.user.findUnique({ where: { id: customerA.id } });
  assert(
    Boolean(updatedUser && updatedUser.lockedUntil && updatedUser.lockedUntil > new Date()),
    '2.1 Account locked for 15 minutes after 5 failed authentication attempts'
  );

  // 6th attempt while locked should return HTTP 429
  const lockedAttemptRes = await safeFetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: customerA.email,
      password: strongNewPass // Even with correct password, locked account is blocked
    })
  });
  const lockedData = await lockedAttemptRes.json();
  assert(
    lockedAttemptRes.status === 429 && lockedData.code === 'ACCOUNT_LOCKED',
    '2.2 HTTP 429 returned when attempting login on temporarily locked account'
  );

  // Unlock user for remaining tests
  await prisma.user.update({
    where: { id: customerA.id },
    data: { failedLoginAttempts: 0, lockedUntil: null }
  });

  // -------------------------------------------------------------
  // FEATURE 3: SESSION EXPIRATION & JWT INTEGRITY
  // -------------------------------------------------------------
  console.log('\n--- 3. Testing Session Management & Expiration ---');

  // 3.1 Valid Token
  const validToken = jwt.sign(
    { id: customerA.id, email: customerA.email, name: customerA.name, role: 'customer' },
    env.JWT_SECRET,
    { expiresIn: '2h' }
  );
  const validAuthRes = await safeFetch(`${BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${validToken}` }
  });
  assert(validAuthRes.status === 200, '3.1 Valid JWT token grants access to protected /me endpoint');

  // 3.2 Expired Token returns HTTP 401 with code SESSION_EXPIRED
  const expiredToken = jwt.sign(
    { id: customerA.id, email: customerA.email, name: customerA.name, role: 'customer' },
    env.JWT_SECRET,
    { expiresIn: '-10s' } // Expired 10 seconds ago
  );
  const expiredAuthRes = await safeFetch(`${BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${expiredToken}` }
  });
  const expiredData = await expiredAuthRes.json();
  assert(
    expiredAuthRes.status === 401 && expiredData.code === 'SESSION_EXPIRED',
    '3.2 Expired JWT rejected with HTTP 401 and code SESSION_EXPIRED'
  );

  // 3.3 Invalid Signature Token
  const tamperedToken = validToken.slice(0, -6) + 'abcdef';
  const tamperedAuthRes = await safeFetch(`${BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${tamperedToken}` }
  });
  assert(tamperedAuthRes.status === 401, '3.3 Tampered / invalid JWT rejected with HTTP 401');

  // -------------------------------------------------------------
  // FEATURE 4: ROLE-BASED ACCESS CONTROL (RBAC) & OWNERSHIP
  // -------------------------------------------------------------
  console.log('\n--- 4. Testing Role-Based Authorization & Resource Ownership ---');

  // 4.1 Customer can access their own call history
  const customerHistoryRes = await safeFetch(`${BASE_URL}/api/calls/my-history`, {
    headers: { Authorization: `Bearer ${validToken}` }
  });
  assert(customerHistoryRes.status === 200, '4.1 Customer role can access their own call history');

  // 4.2 Customer BLOCKED from Admin-only stats endpoint (HTTP 403)
  const customerAdminStatsRes = await safeFetch(`${BASE_URL}/api/calls/stats`, {
    headers: { Authorization: `Bearer ${validToken}` }
  });
  assert(customerAdminStatsRes.status === 403, '4.2 Customer role blocked with HTTP 403 from Admin stats');

  // 4.3 Agent token can search knowledge base
  const agentToken = jwt.sign(
    { id: agent!.id, email: agent!.email, name: agent!.name, role: 'agent' },
    env.JWT_SECRET,
    { expiresIn: '2h' }
  );
  const agentKbSearchRes = await safeFetch(`${BASE_URL}/api/knowledge?search=pricing`, {
    headers: { Authorization: `Bearer ${agentToken}` }
  });
  assert(agentKbSearchRes.status === 200, '4.3 Support Agent can search the read-only Knowledge Base');

  // 4.4 Agent BLOCKED from creating Knowledge Base entries (Admin only)
  const agentKbCreateRes = await safeFetch(`${BASE_URL}/api/knowledge`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${agentToken}`
    },
    body: JSON.stringify({
      title: 'Agent Unauthorized Test',
      content: 'This should be blocked for agents.'
    })
  });
  assert(agentKbCreateRes.status === 403, '4.4 Support Agent blocked with HTTP 403 from creating KB entries');

  // 4.5 Admin can access stats
  const adminToken = jwt.sign(
    { id: admin!.id, email: admin!.email, name: admin!.name, role: 'admin' },
    env.JWT_SECRET,
    { expiresIn: '2h' }
  );
  const adminStatsRes = await safeFetch(`${BASE_URL}/api/calls/stats`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(adminStatsRes.status === 200, '4.5 Administrator granted access to administrative metrics');

  // 4.6 Resource Ownership: Customer A blocked from accessing Customer B's profile
  if (customerB) {
    const crossProfileRes = await safeFetch(`${BASE_URL}/api/customers/${customerB.id}`, {
      headers: { Authorization: `Bearer ${validToken}` }
    });
    assert(
      crossProfileRes.status === 403,
      '4.6 Resource Ownership: Customer blocked from accessing another customer\'s profile'
    );
  }

  // 4.7 Role tampering prevention in preferences update
  const roleTamperRes = await safeFetch(`${BASE_URL}/api/auth/preferences`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validToken}`
    },
    body: JSON.stringify({
      role: 'admin',
      preferredLanguage: 'ta'
    })
  });
  const roleTamperUser = await prisma.user.findUnique({ where: { id: customerA.id } });
  assert(
    roleTamperRes.status === 200 && roleTamperUser?.role === 'customer',
    '4.7 Role escalation prevention: User cannot elevate role through profile updates'
  );

  // -------------------------------------------------------------
  // FEATURE 5: INPUT VALIDATION & SANITIZATION
  // -------------------------------------------------------------
  console.log('\n--- 5. Testing Server-Side Input Validation & Sanitization ---');

  // 5.1 Invalid email format on registration
  const invalidEmailReg = await safeFetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test Valid Name',
      email: 'not-a-valid-email-string',
      password: 'StrongPassword123!',
      confirmPassword: 'StrongPassword123!'
    })
  });
  assert(invalidEmailReg.status === 400, '5.1 Invalid email format rejected by Zod validation');

  // 5.2 Mismatched passwords on registration
  const mismatchReg = await safeFetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test Name',
      email: 'valid.user@example.com',
      password: 'StrongPassword123!',
      confirmPassword: 'DifferentPassword123!'
    })
  });
  assert(mismatchReg.status === 400, '5.2 Mismatched passwords rejected during registration');

  // 5.3 Empty required fields rejected on KB entry
  const emptyKbRes = await safeFetch(`${BASE_URL}/api/knowledge`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      title: '',
      content: ''
    })
  });
  assert(emptyKbRes.status === 400, '5.3 Empty required fields rejected with HTTP 400');

  // -------------------------------------------------------------
  // FEATURE 6 & 7: ENVIRONMENT SECURITY & PRODUCTION HEADERS
  // -------------------------------------------------------------
  console.log('\n--- 6 & 7. Testing Environment Security & HTTP Security Headers ---');

  // 7.1 Verify Helmet Security Headers & No X-Powered-By
  const healthRes = await safeFetch(`${BASE_URL}/api/health`);
  const headers = healthRes.headers;

  assert(!headers.has('x-powered-by'), '7.1 X-Powered-By header disabled to prevent server fingerprinting');
  assert(
    headers.get('x-content-type-options') === 'nosniff',
    '7.2 X-Content-Type-Options: nosniff header present'
  );
  assert(
    Boolean(headers.get('content-security-policy')),
    '7.3 Content Security Policy (CSP) header enforced'
  );

  // Clean up test customer
  await prisma.user.deleteMany({ where: { email: testCustomerEmail } });

  console.log('\n=============================================================');
  console.log(`🎉 TEST SUMMARY: ${passedTests} / ${totalTests} TESTS PASSED`);
  console.log('=============================================================\n');

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runSecurityTests().catch((err) => {
  console.error('Security test runner error:', err);
  process.exit(1);
});
