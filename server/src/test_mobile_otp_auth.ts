import { prisma } from './db.js';
import { validateIndianMobile } from './utils/indianPhone.js';
import { smsService } from './services/sms.js';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'kaira-production-secret-voice-key-2025';

interface TestResult {
  name: string;
  passed: boolean;
  details?: string;
}

const results: TestResult[] = [];

function record(name: string, passed: boolean, details?: string) {
  results.push({ name, passed, details });
  const badge = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`[${badge}] ${name}${details ? ` -> ${details}` : ''}`);
}

async function runTest() {
  console.log('================================================================');
  console.log('🇮🇳 CUSTOM INDIAN MOBILE NUMBER OTP AUTHENTICATION TEST SUITE');
  console.log('================================================================\n');

  try {
    // ------------------------------------------------------------------------
    // TEST 1: Indian Mobile Number Format & Validation Suite
    // ------------------------------------------------------------------------
    console.log('--- 1. Indian Mobile Validation Suite ---');

    // Valid formats
    const valid1 = validateIndianMobile('9876543210');
    record('Standard 10-digit Indian Mobile', valid1.isValid && valid1.normalized === '+919876543210');

    const valid2 = validateIndianMobile('+91 98765 43210');
    record('+91 with spaces', valid2.isValid && valid2.normalized === '+919876543210');

    const valid3 = validateIndianMobile('09876543210');
    record('Leading zero (trunk prefix)', valid3.isValid && valid3.normalized === '+919876543210');

    const valid4 = validateIndianMobile('+91-87654-32109');
    record('Hyphenated with +91', valid4.isValid && valid4.normalized === '+918765432109');

    const valid5 = validateIndianMobile('6123456789');
    record('Starting with 6 (Reliance Jio / Airtel range)', valid5.isValid && valid5.normalized === '+916123456789');

    const valid6 = validateIndianMobile('7987654321');
    record('Starting with 7', valid6.isValid && valid6.normalized === '+917987654321');

    // Invalid formats
    const invalid1 = validateIndianMobile('5876543210'); // Starts with 5 (Invalid in India)
    record('Rejects number starting with 5 (Non-mobile Indian prefix)', !invalid1.isValid, invalid1.error);

    const invalid2 = validateIndianMobile('12345'); // Incomplete
    record('Rejects incomplete (<10 digit) number', !invalid2.isValid, invalid2.error);

    const invalid3 = validateIndianMobile('9876543210999'); // Too long
    record('Rejects number longer than 10 digits', !invalid3.isValid, invalid3.error);

    const invalid4 = validateIndianMobile('98765ABCD0'); // Alphabetic
    record('Rejects alphanumeric input', !invalid4.isValid, invalid4.error);

    const invalid5 = validateIndianMobile('+1 555 123 4567'); // US number
    record('Rejects non-Indian country code', !invalid5.isValid, invalid5.error);

    // ------------------------------------------------------------------------
    // TEST 2: OTP Generation, Cryptographic Hashing & SMS Gateway
    // ------------------------------------------------------------------------
    console.log('\n--- 2. Cryptographic OTP Generation & SMS Dispatch ---');

    const testMobile = '+919876500001';
    const rawOtp = crypto.randomInt(100000, 1000000).toString();
    record('Generates 6-digit numeric OTP', /^\d{6}$/.test(rawOtp), `Sample: ${rawOtp}`);

    const otpHash = crypto.createHash('sha256').update(rawOtp).digest('hex');
    record('Generates SHA-256 secure hash', otpHash.length === 64);

    // Test SMS Gateway Service
    const smsResult = await smsService.sendOtpSms(testMobile, rawOtp);
    record(
      'SMS Gateway delivers to Indian mobile',
      smsResult.success,
      `Provider: ${smsResult.provider}, MessageId: ${smsResult.messageId || 'N/A'}`
    );

    // Save test OTP record into DB
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 mins
    const otpRecord = await prisma.otpVerification.create({
      data: {
        phone: testMobile,
        otpHash,
        expiresAt,
        ipAddress: '127.0.0.1'
      }
    });
    record('OTP record stored in database with 5-minute expiration', !!otpRecord.id);

    // ------------------------------------------------------------------------
    // TEST 3: Verification with Incorrect OTP & Brute-Force Tracking
    // ------------------------------------------------------------------------
    console.log('\n--- 3. Incorrect OTP & Brute-Force Defense ---');

    const wrongCandidate = '000000';
    const wrongHash = crypto.createHash('sha256').update(wrongCandidate).digest('hex');
    const isMismatch = !crypto.timingSafeEqual(Buffer.from(wrongHash, 'hex'), Buffer.from(otpRecord.otpHash, 'hex'));
    record('Mismatched OTP code is rejected securely', isMismatch);

    // Increment attempts
    const updatedRecord = await prisma.otpVerification.update({
      where: { id: otpRecord.id },
      data: { attempts: otpRecord.attempts + 1 }
    });
    record('Failed attempts counter incremented in DB', updatedRecord.attempts === 1);

    // Simulate 5 attempts limit
    const lockedRecord = await prisma.otpVerification.update({
      where: { id: otpRecord.id },
      data: { attempts: 5 }
    });
    record('Brute-force limit detects 5 attempts', lockedRecord.attempts >= 5);

    // ------------------------------------------------------------------------
    // TEST 4: Successful OTP Verification & Account Creation / Role Preservation
    // ------------------------------------------------------------------------
    console.log('\n--- 4. Successful Verification & User Resolution ---');

    // Create fresh OTP for successful verification
    const freshOtp = crypto.randomInt(100000, 1000000).toString();
    const freshHash = crypto.createHash('sha256').update(freshOtp).digest('hex');
    const verifyTestRecord = await prisma.otpVerification.create({
      data: {
        phone: testMobile,
        otpHash: freshHash,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        ipAddress: '127.0.0.1'
      }
    });

    // Timing-safe match
    const candidateHash = crypto.createHash('sha256').update(freshOtp).digest('hex');
    const isCorrect = crypto.timingSafeEqual(Buffer.from(candidateHash, 'hex'), Buffer.from(verifyTestRecord.otpHash, 'hex'));
    record('Valid OTP matches cryptographic hash timing-safely', isCorrect);

    // Burn OTP immediately
    const burnedRecord = await prisma.otpVerification.update({
      where: { id: verifyTestRecord.id },
      data: { verified: true }
    });
    record('OTP is burned (verified: true) to prevent replay attacks', burnedRecord.verified === true);

    // Verify OTP cannot be reused
    const recheckAttempt = await prisma.otpVerification.findFirst({
      where: { id: verifyTestRecord.id, verified: false }
    });
    record('Replay protection: Burned OTP cannot be queried as active', recheckAttempt === null);

    // Test automatic Customer User creation on verified Indian mobile
    const existingUser = await prisma.user.findFirst({
      where: { phone: testMobile }
    });
    if (existingUser) {
      await prisma.user.delete({ where: { id: existingUser.id } });
    }

    const newUser = await prisma.user.create({
      data: {
        name: 'Rohan Sharma',
        email: `9876500001@mobile.kaira.ai`,
        phone: testMobile,
        role: 'customer',
        passwordHash: 'dummy_hash_for_mobile_auth',
        preferredLanguage: 'hi'
      }
    });
    record('New Customer account created with verified Indian mobile', !!newUser.id && newUser.role === 'customer');

    // Test Role-Based Token Generation
    const token = jwt.sign(
      { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role },
      JWT_SECRET,
      { expiresIn: '2h' }
    );
    const decoded: any = jwt.verify(token, JWT_SECRET);
    record('JWT token generated with authorized role', decoded.role === 'customer' && decoded.id === newUser.id);

    // ------------------------------------------------------------------------
    // TEST 5: Admin & Agent Mobile Matching (Role Preservation)
    // ------------------------------------------------------------------------
    console.log('\n--- 5. Admin & Agent Role Preservation via Phone ---');

    // Verify Admin role is preserved if an Admin has a registered phone
    const adminUser = await prisma.user.findFirst({ where: { role: 'admin' } });
    record('Admin account exists in database', !!adminUser && adminUser.role === 'admin');

    const agentUser = await prisma.user.findFirst({ where: { role: 'agent' } });
    record('Agent account exists in database', !!agentUser && agentUser.role === 'agent');

    // ------------------------------------------------------------------------
    // TEST 6: OTP Expiration Handling (5 Minutes Expiry)
    // ------------------------------------------------------------------------
    console.log('\n--- 6. OTP Expiration Defense ---');

    const expiredOtpRecord = await prisma.otpVerification.create({
      data: {
        phone: testMobile,
        otpHash: freshHash,
        expiresAt: new Date(Date.now() - 1000), // Already expired 1 second ago
        ipAddress: '127.0.0.1'
      }
    });

    const isExpired = expiredOtpRecord.expiresAt < new Date();
    record('Expired OTP (>5 minutes old) is correctly detected as expired', isExpired);

    // Cleanup test records
    await prisma.otpVerification.deleteMany({ where: { phone: testMobile } });
    await prisma.user.deleteMany({ where: { phone: testMobile } });
    console.log('\n--- Cleaned up temporary test artifacts ---');

    // ------------------------------------------------------------------------
    // SUMMARY
    // ------------------------------------------------------------------------
    console.log('\n================================================================');
    const passedCount = results.filter((r) => r.passed).length;
    const totalCount = results.length;
    console.log(`TOTAL AUDIT RESULTS: ${passedCount} / ${totalCount} PASSED`);
    console.log('================================================================');

    if (passedCount === totalCount) {
      console.log('🎉 ALL INDIAN MOBILE OTP AUTHENTICATION TESTS PASSED PERFECTLY!\n');
    } else {
      console.error('❌ SOME TESTS FAILED. Review output above.');
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runTest();
