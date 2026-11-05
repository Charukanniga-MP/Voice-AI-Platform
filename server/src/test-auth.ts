async function runAuthTests() {
  console.log('=== 1. TESTING AUTHENTICATION & RBAC ===');
  const BASE = 'http://localhost:5000/api';

  // 1. Admin Login
  const adminRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@kaira', password: 'kaira@123' })
  });
  const adminData = await adminRes.json();
  console.log('Admin login test:', adminRes.ok && adminData.user.role === 'admin' ? 'PASS ✓' : 'FAIL ✗');

  // 2. Agent Login
  const agentRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'agent@kaira', password: 'kaira@123' })
  });
  const agentData = await agentRes.json();
  console.log('Agent login test:', agentRes.ok && agentData.user.role === 'agent' ? 'PASS ✓' : 'FAIL ✗');

  // 3. Customer Registration
  const testEmail = `test_customer_${Date.now()}@test.com`;
  const regRes = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test Customer',
      email: testEmail,
      phone: '+15559990000',
      password: 'password123',
      confirmPassword: 'password123'
    })
  });
  const regData = await regRes.json();
  console.log('Customer registration test:', regRes.ok && regData.user.role === 'customer' ? 'PASS ✓' : 'FAIL ✗');

  // 4. Customer Login
  const custRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: 'password123' })
  });
  const custData = await custRes.json();
  console.log('Customer login test:', custRes.ok && custData.user.role === 'customer' ? 'PASS ✓' : 'FAIL ✗');

  // 5. Google OAuth 2.0 URL Endpoint
  const gUrlRes = await fetch(`${BASE}/auth/google/url`);
  const gUrlData = await gUrlRes.json();
  console.log('Google OAuth 2.0 URL endpoint test:', gUrlRes.ok && typeof gUrlData.configured === 'boolean' ? 'PASS ✓' : 'FAIL ✗');

  // 6. RBAC Protection: Customer attempts to call Admin-only route
  const rbacRes = await fetch(`${BASE}/calls/stats`, {
    headers: { Authorization: `Bearer ${custData.token}` }
  });
  console.log('RBAC protection (Customer blocked from Admin stats):', rbacRes.status === 403 ? 'PASS (403 Forbidden) ✓' : 'FAIL ✗');

  // 7. Admin access to stats
  const adminStatsRes = await fetch(`${BASE}/calls/stats`, {
    headers: { Authorization: `Bearer ${adminData.token}` }
  });
  const statsData = await adminStatsRes.json();
  console.log('Admin access to real DB stats:', adminStatsRes.ok && typeof statsData.totalCustomers === 'number' ? 'PASS ✓' : 'FAIL ✗');

  process.exit(0);
}

runAuthTests();

