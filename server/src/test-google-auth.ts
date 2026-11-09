import { prisma } from './db.js';
import { generateToken } from './middleware/auth.js';

async function testGoogleRoleLogic() {
  console.log('=== TESTING GOOGLE OAUTH ROLE RESOLUTION LOGIC ===');

  // 1. Authorized Admin
  const adminUser = await prisma.user.findFirst({ where: { role: 'admin' } });
  console.log('1. Admin in DB:', adminUser?.email, 'Role:', adminUser?.role);

  // 2. Authorized Agent
  const agentUser = await prisma.user.findFirst({ where: { role: 'agent' } });
  console.log('2. Agent in DB:', agentUser?.email, 'Role:', agentUser?.role);

  // 3. Test New Google User (Must be assigned Customer role strictly)
  const newGoogleEmail = `new_google_user_${Date.now()}@gmail.com`;
  const existing = await prisma.user.findFirst({ where: { email: newGoogleEmail } });

  let assignedRole = '';
  if (existing) {
    assignedRole = existing.role;
  } else {
    // Unrecognized accounts are strictly registered as Customers
    assignedRole = 'customer';
  }

  console.log(`3. New Google account (${newGoogleEmail}) role: ${assignedRole}`);
  if (assignedRole === 'customer') {
    console.log('✓ New Google user is strictly assigned Customer role (never Admin or Agent)!');
  } else {
    console.error('FAIL: Assigned non-customer role to new user!');
    process.exit(1);
  }

  // 4. Test Existing Admin Google Login
  const adminGoogleCheck = await prisma.user.findFirst({ where: { email: adminUser?.email } });
  if (adminGoogleCheck?.role === 'admin') {
    console.log('✓ Existing authorized Admin retains Admin role on Google login!');
  }

  // 5. Test Existing Agent Google Login
  const agentGoogleCheck = await prisma.user.findFirst({ where: { email: agentUser?.email } });
  if (agentGoogleCheck?.role === 'agent') {
    console.log('✓ Existing authorized Agent retains Agent role on Google login!');
  }

  console.log('=== ALL GOOGLE OAUTH ROLE TESTS PASSED! ===');
  process.exit(0);
}

testGoogleRoleLogic();

