import { prisma } from './db.js';

const BASE_URL = 'http://localhost:5000';

async function testApiEndpoints() {
  console.log('Testing Live OTP REST Endpoints against http://localhost:5000...\n');

  const testNumber = '9876543299';
  const testNormalized = '+919876543299';

  // 1. Send OTP Request
  console.log('1. Testing POST /api/auth/otp/send...');
  const sendRes = await fetch(`${BASE_URL}/api/auth/otp/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bypass-rate-limit': 'test-runner-suite'
    },
    body: JSON.stringify({ phone: testNumber })
  });

  const sendData: any = await sendRes.json();
  console.log('Send OTP status:', sendRes.status, sendData);

  if (!sendRes.ok || !sendData.success) {
    throw new Error(`Failed to send OTP: ${sendData.error}`);
  }

  // Ensure raw OTP is NOT in the response (security rule)
  if (sendData.otp || sendData.rawOtp || sendData.code) {
    throw new Error('SECURITY VIOLATION: Raw OTP leaked in HTTP response body!');
  }
  console.log('✓ Security Check: Raw OTP is NOT leaked in HTTP response');

  // Find the generated OTP hash from DB for verification test
  const record = await prisma.otpVerification.findFirst({
    where: { phone: testNormalized, verified: false },
    orderBy: { createdAt: 'desc' }
  });

  if (!record) {
    throw new Error('OTP record was not created in database.');
  }
  console.log('✓ DB Record verified with SHA-256 hash:', record.otpHash.slice(0, 16) + '...');

  // 2. Test Invalid OTP verification
  console.log('\n2. Testing POST /api/auth/otp/verify with WRONG OTP (000000)...');
  const wrongVerifyRes = await fetch(`${BASE_URL}/api/auth/otp/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bypass-rate-limit': 'test-runner-suite'
    },
    body: JSON.stringify({ phone: testNumber, otp: '000000' })
  });

  const wrongVerifyData: any = await wrongVerifyRes.json();
  console.log('Wrong OTP status:', wrongVerifyRes.status, wrongVerifyData);
  if (wrongVerifyRes.status !== 400) {
    throw new Error('Expected 400 for incorrect OTP');
  }
  console.log('✓ Correctly rejected incorrect OTP with remaining attempts');

  // 3. Test Invalid Phone Format
  console.log('\n3. Testing POST /api/auth/otp/send with INVALID prefix (5555555555)...');
  const invalidRes = await fetch(`${BASE_URL}/api/auth/otp/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bypass-rate-limit': 'test-runner-suite'
    },
    body: JSON.stringify({ phone: '5555555555' })
  });
  const invalidData: any = await invalidRes.json();
  console.log('Invalid number status:', invalidRes.status, invalidData);
  if (invalidRes.status !== 400) {
    throw new Error('Expected 400 for invalid Indian phone number');
  }
  console.log('✓ Correctly rejected invalid Indian mobile prefix');

  // Clean up
  await prisma.otpVerification.deleteMany({ where: { phone: testNormalized } });
  await prisma.user.deleteMany({ where: { phone: testNormalized } });

  console.log('\n================================================================');
  console.log('🎉 LIVE REST API ENDPOINT TESTS PASSED WITH 100% SUCCESS!');
  console.log('================================================================\n');
}

testApiEndpoints()
  .catch((err) => {
    console.error('API Test Error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
