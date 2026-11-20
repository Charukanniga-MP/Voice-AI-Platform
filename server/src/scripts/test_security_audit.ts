import { io as Client } from 'socket.io-client';

const BACKEND_URL = 'http://localhost:5000';

async function runSecurityAudit() {
  console.log('=================================================================');
  console.log('🔒 KAIRA PLATFORM SECURITY ENHANCEMENT VERIFICATION');
  console.log('=================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, desc: string) {
    total++;
    if (condition) {
      console.log(`  ✅ PASS: ${desc}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${desc}`);
    }
  }

  // 1. Unauthenticated SMTP verify check
  const smtpRes = await fetch(`${BACKEND_URL}/api/auth/smtp/verify`);
  assert(smtpRes.status === 401, 'Unauthenticated GET /api/auth/smtp/verify is rejected with 401');

  // 2. Unauthenticated Google configure check
  const gConfigRes = await fetch(`${BACKEND_URL}/api/auth/google/configure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: 'test.apps.googleusercontent.com' })
  });
  assert(gConfigRes.status === 401, 'Unauthenticated POST /api/auth/google/configure is rejected with 401');

  // 3. Admin login and Logout test
  const adminLoginRes = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@kaira', password: 'kaira@123' })
  });
  const adminData = await adminLoginRes.json();
  assert(adminLoginRes.status === 200 && Boolean(adminData.token), 'Admin authentication returns valid JWT');

  // 4. Authenticated admin access to SMTP verify
  const authSmtpRes = await fetch(`${BACKEND_URL}/api/auth/smtp/verify`, {
    headers: { Authorization: `Bearer ${adminData.token}` }
  });
  assert(authSmtpRes.status === 200, 'Authenticated Admin can access GET /api/auth/smtp/verify');

  // 5. Logout endpoint test
  const logoutRes = await fetch(`${BACKEND_URL}/api/auth/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminData.token}`, 'Content-Type': 'application/json' }
  });
  const logoutData = await logoutRes.json();
  assert(logoutRes.status === 200 && logoutData.success === true, 'POST /api/auth/logout processes successfully');

  // 6. Customer details passwordHash leak test
  const custRes = await fetch(`${BACKEND_URL}/api/customers/cmw3icw9k0002124hd1bn1nmw`, {
    headers: { Authorization: `Bearer ${adminData.token}` }
  });
  const custData = await custRes.json();
  assert(custRes.status === 200 && custData.customer?.passwordHash === undefined, 'GET /api/customers/:id omits passwordHash');

  // 7. TTS length boundary test
  const hugeText = 'A'.repeat(3000);
  const ttsRes = await fetch(`${BACKEND_URL}/api/voice/tts?text=${encodeURIComponent(hugeText)}`);
  assert(ttsRes.status === 400, 'TTS input length boundary limit enforces 400 on oversized payload');

  // 8. WebSocket unauthorized room join test
  const socket = Client(BACKEND_URL, { transports: ['websocket'] });
  await new Promise<void>((resolve) => socket.on('connect', () => resolve()));

  const joinErrorPromise = new Promise<boolean>((resolve) => {
    socket.on('call:error', (data) => {
      if (data.error && data.error.includes('Access denied')) {
        resolve(true);
      }
    });
    // Set a timeout in case no error is sent
    setTimeout(() => resolve(false), 3000);
  });

  socket.emit('call:join', { callId: 'call_secret_unauthorized_99999' });
  const joinBlocked = await joinErrorPromise;
  assert(joinBlocked, 'Socket call:join for unauthorized session is blocked and emits call:error');

  socket.disconnect();

  console.log('\n=================================================================');
  console.log(`📊 SECURITY AUDIT COMPLETE: ${passed}/${total} checks passed (${Math.round((passed / total) * 100)}%)`);
  console.log('=================================================================\n');

  if (passed !== total) process.exit(1);
}

runSecurityAudit().catch((err) => {
  console.error('Security audit script error:', err);
  process.exit(1);
});
