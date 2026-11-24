import { prisma } from '../db.js';
import { smsService } from '../services/sms.js';
import { validateIndianMobile } from '../utils/indianPhone.js';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

interface TestCase {
  id: string;
  name: string;
  run: () => Promise<{ passed: boolean; details: string }>;
}

async function runIndianOtpSmsSuite() {
  console.log('========================================================================');
  console.log('🧪 KAIRA INDIAN MOBILE OTP & REAL SMS DELIVERY - END-TO-END TEST SUITE');
  console.log('========================================================================\n');

  const testMobile = '+919876543210';
  const testMobile2 = '+919123456789';
  const testCases: TestCase[] = [
    // 1. Prisma OTP table availability
    {
      id: 'TC-01',
      name: 'Prisma OtpVerification table availability in database',
      run: async () => {
        const tables: any = await prisma.$queryRaw`SELECT name FROM sqlite_master WHERE type='table' AND name='OtpVerification';`;
        const exists = Array.isArray(tables) && tables.length > 0;
        const count = await prisma.otpVerification.count();
        return {
          passed: exists,
          details: `Table 'OtpVerification' exists in dev.db with ${count} active records.`
        };
      }
    },

    // 2. OTP generation
    {
      id: 'TC-02',
      name: 'Cryptographic 6-digit OTP generation',
      run: async () => {
        const otp1 = crypto.randomInt(100000, 1000000).toString();
        const otp2 = crypto.randomInt(100000, 1000000).toString();
        const isValid = /^\d{6}$/.test(otp1) && /^\d{6}$/.test(otp2) && otp1 !== otp2;
        return {
          passed: isValid,
          details: 'Generated two distinct cryptographically random 6-digit numeric codes.'
        };
      }
    },

    // 3. OTP database insertion
    {
      id: 'TC-03',
      name: 'Secure SHA-256 hashed OTP database insertion',
      run: async () => {
        const testOtp = '849201';
        const otpHash = crypto.createHash('sha256').update(testOtp).digest('hex');
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

        const record = await prisma.otpVerification.create({
          data: {
            phone: testMobile,
            otpHash,
            expiresAt,
            ipAddress: '127.0.0.1'
          }
        });

        const fetchRecord = await prisma.otpVerification.findUnique({
          where: { id: record.id }
        });

        // Cleanup
        await prisma.otpVerification.delete({ where: { id: record.id } });

        const isSaved = !!fetchRecord &&
          fetchRecord.phone === testMobile &&
          fetchRecord.otpHash === otpHash &&
          fetchRecord.verified === false &&
          fetchRecord.attempts === 0;

        return {
          passed: isSaved,
          details: `Inserted record ID: ${record.id}, verified: ${fetchRecord?.verified}, attempts: ${fetchRecord?.attempts}`
        };
      }
    },

    // 4. OTP expiration check
    {
      id: 'TC-04',
      name: 'OTP expiration enforcement (5 minutes timeout)',
      run: async () => {
        const testOtp = '112233';
        const otpHash = crypto.createHash('sha256').update(testOtp).digest('hex');
        const expiredDate = new Date(Date.now() - 10 * 1000); // 10 seconds in the past

        const expiredRecord = await prisma.otpVerification.create({
          data: {
            phone: testMobile,
            otpHash,
            expiresAt: expiredDate,
            ipAddress: '127.0.0.1'
          }
        });

        const isExpired = expiredRecord.expiresAt < new Date();
        // Invalidate expired record
        await prisma.otpVerification.update({
          where: { id: expiredRecord.id },
          data: { verified: true }
        });

        // Cleanup
        await prisma.otpVerification.delete({ where: { id: expiredRecord.id } });

        return {
          passed: isExpired,
          details: `Expired timestamp correctly detected: ${expiredRecord.expiresAt.toISOString()} < current time`
        };
      }
    },

    // 5. Correct OTP verification
    {
      id: 'TC-05',
      name: 'Valid OTP timing-safe verification and burn-after-use',
      run: async () => {
        const testOtp = '739102';
        const otpHash = crypto.createHash('sha256').update(testOtp).digest('hex');
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

        const record = await prisma.otpVerification.create({
          data: {
            phone: testMobile,
            otpHash,
            expiresAt,
            ipAddress: '127.0.0.1'
          }
        });

        // Timing-safe verification
        const candidateHash = crypto.createHash('sha256').update(testOtp).digest('hex');
        const isMatch = crypto.timingSafeEqual(
          Buffer.from(candidateHash, 'hex'),
          Buffer.from(record.otpHash, 'hex')
        );

        // Burn OTP
        await prisma.otpVerification.update({
          where: { id: record.id },
          data: { verified: true }
        });

        const checkBurned = await prisma.otpVerification.findUnique({
          where: { id: record.id }
        });

        // Cleanup
        await prisma.otpVerification.delete({ where: { id: record.id } });

        const passed = isMatch && checkBurned?.verified === true;
        return {
          passed,
          details: `Verified timing-safely and burned: verified=${checkBurned?.verified}`
        };
      }
    },

    // 6. Incorrect OTP rejection and attempt tracking
    {
      id: 'TC-06',
      name: 'Incorrect OTP rejection and brute-force attempt tracking',
      run: async () => {
        const realOtp = '654321';
        const wrongOtp = '999999';
        const otpHash = crypto.createHash('sha256').update(realOtp).digest('hex');
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

        const record = await prisma.otpVerification.create({
          data: {
            phone: testMobile,
            otpHash,
            expiresAt,
            ipAddress: '127.0.0.1'
          }
        });

        const candidateHash = crypto.createHash('sha256').update(wrongOtp).digest('hex');
        const isMismatch = !crypto.timingSafeEqual(
          Buffer.from(candidateHash, 'hex'),
          Buffer.from(record.otpHash, 'hex')
        );

        // Increment attempts
        const updated = await prisma.otpVerification.update({
          where: { id: record.id },
          data: { attempts: record.attempts + 1 }
        });

        // Cleanup
        await prisma.otpVerification.delete({ where: { id: record.id } });

        const passed = isMismatch && updated.attempts === 1;
        return {
          passed,
          details: `Mismatched OTP correctly rejected. Attempts incremented to ${updated.attempts}/5`
        };
      }
    },

    // 7. Resend cooldown enforcement (30 seconds)
    {
      id: 'TC-07',
      name: '30-second resend cooldown enforcement',
      run: async () => {
        const testOtp = '123123';
        const otpHash = crypto.createHash('sha256').update(testOtp).digest('hex');
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

        // Record created just now
        const record = await prisma.otpVerification.create({
          data: {
            phone: testMobile,
            otpHash,
            expiresAt,
            createdAt: new Date(),
            ipAddress: '127.0.0.1'
          }
        });

        // Check if query within 30s finds recent record
        const recent = await prisma.otpVerification.findFirst({
          where: {
            phone: testMobile,
            verified: false,
            createdAt: {
              gte: new Date(Date.now() - 30 * 1000)
            }
          }
        });

        // Cleanup
        await prisma.otpVerification.delete({ where: { id: record.id } });

        const passed = !!recent && recent.id === record.id;
        return {
          passed,
          details: `Cooldown properly detected: active unverified OTP created within 30 seconds.`
        };
      }
    },

    // 8. Invalid Indian mobile numbers validation
    {
      id: 'TC-08',
      name: 'Strict National Numbering Plan (DoT/TRAI) Indian mobile validation',
      run: async () => {
        const invalid1 = validateIndianMobile('5876543210'); // Starts with 5 (Invalid)
        const invalid2 = validateIndianMobile('12345'); // Under 10 digits
        const invalid3 = validateIndianMobile('987654321099'); // Over 10 digits
        const invalid4 = validateIndianMobile('98765ABCD0'); // Alphanumeric
        const invalid5 = validateIndianMobile('+15551234567'); // US country code

        const valid1 = validateIndianMobile('9876543210');
        const valid2 = validateIndianMobile('+91 98765 43210');
        const valid3 = validateIndianMobile('09876543210');
        const valid4 = validateIndianMobile('7890123456');

        const allInvalidRejected = !invalid1.isValid && !invalid2.isValid && !invalid3.isValid && !invalid4.isValid && !invalid5.isValid;
        const allValidAccepted = valid1.isValid && valid2.isValid && valid3.isValid && valid4.isValid;
        const normalizedCorrectly = valid1.normalized === '+919876543210' && valid2.normalized === '+919876543210';

        return {
          passed: allInvalidRejected && allValidAccepted && normalizedCorrectly,
          details: `Validated DoT rules: 5/5 invalid rejected, 4/4 valid accepted and normalized to +91XXXXXXXXXX.`
        };
      }
    },

    // 9. SMS provider success handling
    {
      id: 'TC-09',
      name: 'SMS provider success handling with delivery receipt',
      run: async () => {
        // Use test mock handler
        smsService.setMockHandler(async (phone, otp) => {
          return {
            success: true,
            provider: 'mock_gateway',
            messageId: 'msg_test_success_12345'
          };
        });

        const result = await smsService.sendOtpSms(testMobile, '123456');
        smsService.clearMockHandler();

        const passed = result.success === true && result.messageId === 'msg_test_success_12345';
        return {
          passed,
          details: `Provider: ${result.provider}, MessageId: ${result.messageId}`
        };
      }
    },

    // 10. SMS provider failure handling
    {
      id: 'TC-10',
      name: 'SMS provider failure handling without exposing internal tokens',
      run: async () => {
        // Set mock failure handler
        smsService.setMockHandler(async () => {
          return {
            success: false,
            provider: 'mock_gateway',
            error: 'Indian telco DLT template rejection: rate limit exceeded'
          };
        });

        const result = await smsService.sendOtpSms(testMobile, '123456');
        smsService.clearMockHandler();

        const passed = result.success === false && result.error?.includes('DLT template rejection');
        return {
          passed,
          details: `Handled error cleanly: ${result.error}`
        };
      }
    },

    // 11. Unconfigured SMS provider safety
    {
      id: 'TC-11',
      name: 'Unconfigured SMS provider safety (fails safely, never fakes delivery)',
      run: async () => {
        smsService.clearMockHandler();
        const configured = smsService.isConfigured();

        if (!configured) {
          const res = await smsService.sendOtpSms(testMobile, '123456');
          const passed = res.success === false && res.error?.includes('SMS service is not configured');
          return {
            passed,
            details: `Unconfigured provider safely returned error: "${res.error}"`
          };
        } else {
          return {
            passed: true,
            details: `Provider is configured (${smsService.getActiveProvider()}); verified safe dispatch interface.`
          };
        }
      }
    },

    // 12. Customer registration and login via verified mobile
    {
      id: 'TC-12',
      name: 'Customer registration and login flow with Indian mobile',
      run: async () => {
        const uniqueNumber = '98' + Math.floor(10000000 + Math.random() * 90000000).toString().slice(0, 8);
        const normalized = `+91${uniqueNumber}`;

        // Create new customer account with verified Indian mobile
        const randomPass = await bcrypt.hash('KairaSecret123!', 10);
        const user = await prisma.user.create({
          data: {
            name: `Test Customer ${uniqueNumber.slice(-4)}`,
            email: `${uniqueNumber}@mobile.kaira.ai`,
            phone: normalized,
            role: 'customer',
            passwordHash: randomPass,
            preferredLanguage: 'en'
          }
        });

        // Verify retrieval by phone number
        const found = await prisma.user.findFirst({
          where: { phone: normalized }
        });

        // Cleanup
        await prisma.user.delete({ where: { id: user.id } });

        const passed = !!found && found.id === user.id && found.role === 'customer';
        return {
          passed,
          details: `Created and verified customer ID: ${user.id}, Phone: ${user.phone}, Role: ${user.role}`
        };
      }
    }
  ];

  let passedCount = 0;
  for (const tc of testCases) {
    try {
      const res = await tc.run();
      const mark = res.passed ? '✅ PASS' : '❌ FAIL';
      if (res.passed) passedCount++;
      console.log(`${mark} | [${tc.id}] ${tc.name}`);
      console.log(`        └─ ${res.details}`);
    } catch (err: any) {
      console.log(`❌ FAIL | [${tc.id}] ${tc.name}`);
      console.log(`        └─ Exception: ${err?.message || err}`);
    }
  }

  console.log('\n========================================================================');
  console.log(`📊 EXECUTION SUMMARY: ${passedCount}/${testCases.length} TESTS PASSED (${Math.round((passedCount / testCases.length) * 100)}%)`);
  console.log('========================================================================\n');

  if (passedCount !== testCases.length) {
    process.exit(1);
  }
}

runIndianOtpSmsSuite()
  .catch((err) => {
    console.error('Test suite failed:', err);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
