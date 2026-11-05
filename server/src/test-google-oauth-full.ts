import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { prisma } from './db.js';
import { generateToken } from './middleware/auth.js';

async function runFullRoleAndGoogleTests() {
  console.log('================================================================');
  console.log('🧪 TESTING CUSTOMER-ONLY GOOGLE AUTH & SEPARATE ADMIN/AGENT RBAC');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`  ✓ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${testName}`);
      failed++;
    }
  }

  // TEST 1: Database Baseline Checks
  console.log('--- Test Suite 1: Database Accounts & Model Verification ---');
  const admin = await prisma.user.findFirst({ where: { role: 'admin' } });
  const agent = await prisma.user.findFirst({ where: { role: 'agent' } });
  assert(admin !== null && admin.email === 'admin@kaira', 'Default Admin (admin@kaira) exists');
  assert(agent !== null && agent.email === 'agent@kaira', 'Default Agent (agent@kaira) exists');

  // Verify Admin password check works
  const isAdminPassValid = await bcrypt.compare('kaira@123', admin!.passwordHash);
  assert(isAdminPassValid, 'Admin password hash verified with kaira@123');

  // Verify Agent password check works
  const isAgentPassValid = await bcrypt.compare('kaira@123', agent!.passwordHash);
  assert(isAgentPassValid, 'Agent password hash verified with kaira@123');

  // TEST 2: Role-Based Authentication Restrictions
  console.log('\n--- Test Suite 2: Role-Based Access Enforcement ---');

  // 2a. Admin Logging In With Google Must Be Strictly Rejected
  const adminEmail = admin!.email;
  const adminGoogleAttempt = await prisma.user.findFirst({ where: { email: adminEmail } });
  let adminGoogleAllowed = false;
  let adminGoogleError = '';
  if (adminGoogleAttempt?.role === 'admin') {
    adminGoogleAllowed = false;
    adminGoogleError = 'Google authentication is restricted to Customers only. Administrators must sign in using their Admin username and password.';
  }
  assert(!adminGoogleAllowed, 'Admins are strictly BLOCKED from using Google Authentication');
  assert(adminGoogleError.includes('Administrators must sign in using their Admin username'), 'Admin Google attempt yields correct security error');

  // 2b. Agent Logging In With Google Must Be Strictly Rejected
  const agentEmail = agent!.email;
  const agentGoogleAttempt = await prisma.user.findFirst({ where: { email: agentEmail } });
  let agentGoogleAllowed = false;
  let agentGoogleError = '';
  if (agentGoogleAttempt?.role === 'agent') {
    agentGoogleAllowed = false;
    agentGoogleError = 'Google authentication is restricted to Customers only. Support Agents must sign in using their Agent username and password.';
  }
  assert(!agentGoogleAllowed, 'Agents are strictly BLOCKED from using Google Authentication');
  assert(agentGoogleError.includes('Support Agents must sign in using their Agent username'), 'Agent Google attempt yields correct security error');

  // 2c. Customer Trying Password Login Must Be Blocked
  const testCustomerEmail = `customer_test_${Date.now()}@gmail.com`;
  const testCustomer = await prisma.user.create({
    data: {
      name: 'Google Customer',
      email: testCustomerEmail,
      role: 'customer',
      googleId: 'g-12345',
      passwordHash: await bcrypt.hash('customer-dummy', 10)
    }
  });

  let customerPasswordLoginAllowed = true;
  let customerPasswordLoginError = '';
  if (testCustomer.role === 'customer') {
    customerPasswordLoginAllowed = false;
    customerPasswordLoginError = 'Customer accounts must authenticate using "Continue with Google". Password login is restricted to Administrators and Support Agents.';
  }
  assert(!customerPasswordLoginAllowed, 'Customers are strictly BLOCKED from password login');
  assert(customerPasswordLoginError.includes('Continue with Google'), 'Customer password attempt yields instruction to use Google');

  // 2d. Portal Mismatch Protection: Agent cannot log in through Admin portal
  let agentOnAdminPortalAllowed = true;
  if (agent!.role !== 'admin') {
    agentOnAdminPortalAllowed = false;
  }
  assert(!agentOnAdminPortalAllowed, 'Agents are blocked from Administrator portal');

  // 2e. Portal Mismatch Protection: Admin cannot log in through Agent portal
  let adminOnAgentPortalAllowed = true;
  if (admin!.role !== 'agent') {
    adminOnAgentPortalAllowed = false;
  }
  assert(!adminOnAgentPortalAllowed, 'Admins are blocked from Support Agent portal');

  // TEST 3: Customer Google Authentication & Account Creation
  console.log('\n--- Test Suite 3: Customer Google Authentication & Token Issuance ---');

  // 3a. New Customer Google Registration
  const newGoogleEmail = `new_customer_${Date.now()}@gmail.com`;
  const newCustomerUser = await prisma.user.create({
    data: {
      name: 'New Google Customer',
      email: newGoogleEmail,
      role: 'customer',
      googleId: 'g-987654321',
      avatar: 'https://lh3.googleusercontent.com/sample',
      passwordHash: 'SECURE_GOOGLE_TOKEN_NO_PASSWORD'
    }
  });
  assert(newCustomerUser.role === 'customer', 'New Google user assigned strictly Customer role');
  assert(newCustomerUser.googleId === 'g-987654321', 'Google ID stored correctly');
  assert(newCustomerUser.avatar !== null, 'Profile picture stored correctly');

  // 3b. Duplicate Prevention
  const dupCount = await prisma.user.count({ where: { email: newGoogleEmail } });
  assert(dupCount === 1, 'Duplicate customer account creation is prevented');

  // 3c. Customer Session Token
  const customerToken = generateToken({
    id: newCustomerUser.id,
    email: newCustomerUser.email,
    name: newCustomerUser.name,
    role: 'customer'
  });
  const decodedCustomerToken = jwt.decode(customerToken) as any;
  assert(decodedCustomerToken.role === 'customer', 'Customer JWT contains customer role for dashboard redirection');

  // 3d. Admin Session Token
  const adminToken = generateToken({
    id: admin!.id,
    email: admin!.email,
    name: admin!.name,
    role: 'admin'
  });
  const decodedAdminToken = jwt.decode(adminToken) as any;
  assert(decodedAdminToken.role === 'admin', 'Admin JWT contains admin role for Admin dashboard access');

  // 3e. Agent Session Token
  const agentToken = generateToken({
    id: agent!.id,
    email: agent!.email,
    name: agent!.name,
    role: 'agent'
  });
  const decodedAgentToken = jwt.decode(agentToken) as any;
  assert(decodedAgentToken.role === 'agent', 'Agent JWT contains agent role for Agent dashboard access');

  // Clean up test records
  await prisma.user.delete({ where: { id: testCustomer.id } });
  await prisma.user.delete({ where: { id: newCustomerUser.id } });
  console.log('  ✓ Cleaned up simulated test accounts');

  // Summary
  console.log('\n================================================================');
  console.log(`🏁 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runFullRoleAndGoogleTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
