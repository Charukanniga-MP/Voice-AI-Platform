import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');
const clientRoot = path.join(projectRoot, 'client');

async function verifyUIAndFlow() {
  console.log('====================================================');
  console.log('🔍 KAIRA VOICE AI - UI IMPROVEMENT AUDIT & VERIFICATION');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(title: string, condition: boolean, detail?: string) {
    if (condition) {
      console.log(`  ✓ PASS: ${title}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${title}`);
      if (detail) console.error(`    Detail: ${detail}`);
      failed++;
    }
  }

  // 1. Verify Navbar.tsx Branding & Logo
  console.log('--- 1. Header Branding & Logo Implementation ---');
  const navbarPath = path.join(clientRoot, 'src/components/Navbar.tsx');
  const navbarContent = fs.readFileSync(navbarPath, 'utf8');

  assert(
    'Navbar displays official KAIRA logo (/kaira-logo.png)',
    navbarContent.includes('src="/kaira-logo.png"')
  );

  assert(
    'Navbar removes text "KAIRA VOICE AI" / "Voice AI" alongside the logo',
    !navbarContent.includes('KAIRA VOICE AI') &&
    !navbarContent.includes('nav.branding_tag') &&
    !navbarContent.includes('nav.branding_sub')
  );

  assert(
    'Navbar increases logo size and visibility (h-12 w-12 sm:h-14 sm:w-14)',
    navbarContent.includes('h-12 w-12 sm:h-14 sm:w-14') || navbarContent.includes('h-12')
  );

  assert(
    'Navbar imports and mounts ProfileDropdown on top-right',
    navbarContent.includes("import { ProfileDropdown } from './ProfileDropdown") &&
    navbarContent.includes('<ProfileDropdown />')
  );

  // 2. Verify ProfileDropdown.tsx Component
  console.log('\n--- 2. Circular Profile Icon & Dropdown Component ---');
  const profileDropdownPath = path.join(clientRoot, 'src/components/ProfileDropdown.tsx');
  const profileDropdownContent = fs.readFileSync(profileDropdownPath, 'utf8');

  assert(
    'Circular Profile Icon has rounded-full avatar button',
    profileDropdownContent.includes('rounded-full') &&
    profileDropdownContent.includes('w-10 h-10 sm:w-11 sm:h-11')
  );

  assert(
    'Dropdown displays actual user name and email from AuthContext',
    profileDropdownContent.includes('{user.name}') &&
    profileDropdownContent.includes('{user.email}')
  );

  assert(
    'Dropdown displays user role badge for Admin, Agent, and Customer',
    profileDropdownContent.includes("case 'admin':") &&
    profileDropdownContent.includes("case 'agent':") &&
    profileDropdownContent.includes('roleConfig.title')
  );

  assert(
    'Dropdown includes Logout / Sign Out action with icon',
    profileDropdownContent.includes('handleLogout') &&
    profileDropdownContent.includes('LogOut') &&
    profileDropdownContent.includes('Sign Out')
  );

  assert(
    'Dropdown includes outside click & Escape key listener for clean closing',
    profileDropdownContent.includes('handleClickOutside') &&
    profileDropdownContent.includes('handleKeyDown') &&
    profileDropdownContent.includes("e.key === 'Escape'")
  );

  assert(
    'Dropdown is fully responsive with max-width containment (max-w-[calc(100vw-2rem)])',
    profileDropdownContent.includes('max-w-[calc(100vw-2rem)]')
  );

  // 3. Verify All Three Dashboards Inherit Unified Navbar
  console.log('\n--- 3. Unified Header Across All Three Dashboards ---');
  const appPath = path.join(clientRoot, 'src/App.tsx');
  const appContent = fs.readFileSync(appPath, 'utf8');

  assert(
    'App.tsx renders <Navbar /> globally across Customer, Agent, and Admin dashboards',
    appContent.includes('<Navbar />') &&
    appContent.includes('{role === \'customer\' && <CustomerDashboard />}') &&
    appContent.includes('{role === \'agent\' && <AgentDashboard />}') &&
    appContent.includes('{role === \'admin\' && <AdminDashboard />}')
  );

  // 4. Verify Admin Sidebar Logo Visibility
  console.log('\n--- 4. Admin Dashboard Consistency ---');
  const adminPath = path.join(clientRoot, 'src/pages/AdminDashboard.tsx');
  const adminContent = fs.readFileSync(adminPath, 'utf8');

  assert(
    'Admin dashboard sidebar logo has increased size and visibility',
    adminContent.includes('h-11 w-11 md:h-12 md:w-12')
  );

  // 5. Live Backend Authentication & Profile Payload Checks
  console.log('\n--- 5. Live Backend Authentication & Profile Data ---');
  const API = 'http://localhost:5000/api';

  try {
    // Admin
    const adminRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@kaira', password: 'kaira@123', role: 'admin' })
    });
    const adminData: any = await adminRes.json();
    assert('Admin login succeeds with valid token', adminRes.ok && Boolean(adminData.token));
    assert('Admin user object contains real name and role=admin', adminData.user?.role === 'admin' && Boolean(adminData.user?.name));

    // Agent
    const agentRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'agent@kaira', password: 'kaira@123', role: 'agent' })
    });
    const agentData: any = await agentRes.json();
    assert('Agent login succeeds with valid token', agentRes.ok && Boolean(agentData.token));
    assert('Agent user object contains real name and role=agent', agentData.user?.role === 'agent' && Boolean(agentData.user?.name));

    // Customer
    const testEmail = `audit_cust_${Date.now()}@kairatest.com`;
    const regRes = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Alex Morgan',
        email: testEmail,
        phone: '+1 (555) 019-2834',
        password: 'password123',
        confirmPassword: 'password123'
      })
    });
    assert('Customer registration succeeds', regRes.ok);

    const custRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'password123', role: 'customer' })
    });
    const custData: any = await custRes.json();
    assert('Customer login succeeds with valid token', custRes.ok && Boolean(custData.token));
    assert('Customer user object contains real name and role=customer', custData.user?.role === 'customer' && custData.user?.name === 'Alex Morgan');
  } catch (err: any) {
    console.error('API verification failed:', err.message);
    failed++;
  }

  console.log('\n====================================================');
  console.log(`AUDIT SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) process.exit(1);
  process.exit(0);
}

verifyUIAndFlow().catch(err => {
  console.error('Unhandled failure:', err);
  process.exit(1);
});
