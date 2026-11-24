import { prisma } from '../db.js';
import crypto from 'crypto';

interface TestResult {
  name: string;
  passed: boolean;
  details?: string;
}

async function runOtpDbTests() {
  console.log('========================================================================');
  console.log('🧪 KAIRA OTP VERIFICATION PRISMA DATABASE CRUD & INTEGRITY TEST');
  console.log('========================================================================\n');

  const results: TestResult[] = [];
  const testPhone = '+919876543210';
  const testOtp = '123456';
  const testHash = crypto.createHash('sha256').update(testOtp).digest('hex');
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  // 1. Check existing users preserved
  const userCount = await prisma.user.count();
  const adminUser = await prisma.user.findFirst({ where: { role: 'admin' } });
  const agentUser = await prisma.user.findFirst({ where: { role: 'agent' } });
  const customerUser = await prisma.user.findFirst({ where: { role: 'customer' } });

  results.push({
    name: 'Existing database users preserved',
    passed: userCount > 0 && !!adminUser,
    details: `Total users: ${userCount}, Admin: ${adminUser?.email}, Agent: ${agentUser?.email}, Customer: ${customerUser?.email}`
  });

  // 2. Test findFirst on empty or non-existent number
  let findFirstWorked = false;
  try {
    const res = await prisma.otpVerification.findFirst({
      where: { phone: '+919999999999', verified: false }
    });
    findFirstWorked = res === null;
  } catch (err: any) {
    console.error('findFirst failed:', err);
  }
  results.push({
    name: 'prisma.otpVerification.findFirst() executes cleanly without table error',
    passed: findFirstWorked,
    details: 'Returned null for non-existent record without throwing SQL error'
  });

  // 3. Test Create
  let createdRecord: any = null;
  try {
    createdRecord = await prisma.otpVerification.create({
      data: {
        phone: testPhone,
        otpHash: testHash,
        expiresAt,
        ipAddress: '127.0.0.1'
      }
    });
  } catch (err: any) {
    console.error('Create failed:', err);
  }
  results.push({
    name: 'prisma.otpVerification.create() successfully inserts OTP record',
    passed: !!createdRecord && createdRecord.phone === testPhone && createdRecord.otpHash === testHash,
    details: `Created ID: ${createdRecord?.id}, Phone: ${createdRecord?.phone}, Verified: ${createdRecord?.verified}`
  });

  // 4. Test Update
  let updatedRecord: any = null;
  try {
    if (createdRecord) {
      updatedRecord = await prisma.otpVerification.update({
        where: { id: createdRecord.id },
        data: {
          attempts: 1,
          verified: true
        }
      });
    }
  } catch (err: any) {
    console.error('Update failed:', err);
  }
  results.push({
    name: 'prisma.otpVerification.update() updates attempts and verified flag',
    passed: !!updatedRecord && updatedRecord.attempts === 1 && updatedRecord.verified === true,
    details: `Updated ID: ${updatedRecord?.id}, Attempts: ${updatedRecord?.attempts}, Verified: ${updatedRecord?.verified}`
  });

  // 5. Test Delete
  let deleteWorked = false;
  try {
    if (createdRecord) {
      await prisma.otpVerification.delete({
        where: { id: createdRecord.id }
      });
      const checkDeleted = await prisma.otpVerification.findUnique({
        where: { id: createdRecord.id }
      });
      deleteWorked = checkDeleted === null;
    }
  } catch (err: any) {
    console.error('Delete failed:', err);
  }
  results.push({
    name: 'prisma.otpVerification.delete() safely cleans up test record',
    passed: deleteWorked,
    details: `Deleted record successfully confirmed gone from database`
  });

  console.log('RESULTS:');
  let allPassed = true;
  for (const r of results) {
    const mark = r.passed ? '✅ PASS' : '❌ FAIL';
    if (!r.passed) allPassed = false;
    console.log(`${mark} | ${r.name}`);
    if (r.details) console.log(`        └─ ${r.details}`);
  }
  console.log('\n========================================================================\n');

  if (!allPassed) {
    process.exit(1);
  }
}

runOtpDbTests()
  .catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
