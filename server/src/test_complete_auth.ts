import fetch from 'node-fetch';

const BASE = 'http://localhost:5000/api';

async function runTests() {
  console.log('--- STARTING COMPLETE AUTHENTICATION VALIDATION SUITE ---');
  let passed = 0;
  let total = 0;

  function assert(desc: string, condition: boolean, extra?: any) {
    total++;
    if (condition) {
      passed++;
      console.log(`  ✓ PASS: ${desc}`);
    } else {
      console.error(`  ✗ FAIL: ${desc}`, extra ? extra : '');
    }
  }

  // 1. Google Config check
  const cfgRes = await fetch(`${BASE}/auth/google/config`);
  const cfgData: any = await cfgRes.json();
  assert('Google config endpoint returns 200', cfgRes.ok);
  assert('Google client_id matches configured ID', cfgData.clientId?.startsWith('1018334787224'));

  // 2. Google OAuth URL check
  const urlRes = await fetch(`${BASE}/auth/google/url`);
  const urlData: any = await urlRes.json();
  assert('Google OAuth URL endpoint returns 200', urlRes.ok);
  assert('Google OAuth URL has accounts.google.com and prompt=select_account',
    urlData.authUrl?.includes('accounts.google.com') && urlData.authUrl?.includes('prompt=select_account'));

  // 3. Customer Sign Up (New customer)
  const testCustomerEmail = `customer_${Date.now()}@example.com`;
  const regRes = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Ravi Kumar',
      email: testCustomerEmail,
      phone: '+1 555-0199',
      password: 'password123',
      confirmPassword: 'password123'
    })
  });
  const regData: any = await regRes.json();
  assert('Customer registration succeeds with 201/200', regRes.ok);
  assert('Customer registration returns JWT token', Boolean(regData.token));
  assert('Customer registration returns user with role=customer', regData.user?.role === 'customer');

  // 4. Duplicate Registration prevention
  const dupRes = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Ravi Duplicate',
      email: testCustomerEmail,
      password: 'password123',
      confirmPassword: 'password123'
    })
  });
  assert('Duplicate registration is rejected with 409', dupRes.status === 409);

  // 5. Password mismatch check
  const mismatchRes = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test Mismatch',
      email: `mismatch_${Date.now()}@example.com`,
      password: 'password123',
      confirmPassword: 'wrongpassword'
    })
  });
  assert('Mismatched passwords rejected with 400', mismatchRes.status === 400);

  // 6. Customer Login with Email & Password
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: testCustomerEmail,
      password: 'password123',
      role: 'customer'
    })
  });
  const loginData: any = await loginRes.json();
  assert('Customer email/password login returns 200', loginRes.ok);
  assert('Customer login returns valid JWT token', Boolean(loginData.token));
  assert('Customer login returns user email', loginData.user?.email === testCustomerEmail);

  // 7. Invalid password check
  const wrongPassRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: testCustomerEmail,
      password: 'incorrectpassword',
      role: 'customer'
    })
  });
  assert('Invalid password returns 401', wrongPassRes.status === 401);

  // 8. Staff Admin Login
  const adminRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@kaira',
      password: 'kaira@123',
      role: 'admin'
    })
  });
  const adminData: any = await adminRes.json();
  assert('Admin login returns 200', adminRes.ok);
  assert('Admin has role=admin', adminData.user?.role === 'admin');

  // 9. Staff Agent Login
  const agentRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'agent@kaira',
      password: 'kaira@123',
      role: 'agent'
    })
  });
  const agentData: any = await agentRes.json();
  assert('Agent login returns 200', agentRes.ok);
  assert('Agent has role=agent', agentData.user?.role === 'agent');

  // 10. Role isolation check: Customer trying to sign in via Admin portal
  const custAsAdminRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: testCustomerEmail,
      password: 'password123',
      role: 'admin'
    })
  });
  assert('Customer attempting Admin login is rejected with 403', custAsAdminRes.status === 403);

  // 11. Role isolation check: Admin trying to sign in via Customer portal
  const adminAsCustRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@kaira',
      password: 'kaira@123',
      role: 'customer'
    })
  });
  assert('Admin attempting Customer portal login is redirected with 403', adminAsCustRes.status === 403);

  // 12. Forgot password endpoint
  const forgotRes = await fetch(`${BASE}/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testCustomerEmail })
  });
  assert('Forgot password endpoint returns 200', forgotRes.ok);

  // 13. Authenticated session /me endpoint with Customer token
  const meRes = await fetch(`${BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${loginData.token}` }
  });
  const meData: any = await meRes.json();
  assert('Profile /me endpoint returns 200 for customer', meRes.ok);
  assert('Profile /me returns correct customer user id', meData.user?.id === loginData.user?.id);

  console.log(`\n--- SUMMARY: ${passed}/${total} TESTS PASSED ---`);
  if (passed === total) {
    console.log('✅ ALL TESTS PASSED SUCCESSFULLY!');
  } else {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

