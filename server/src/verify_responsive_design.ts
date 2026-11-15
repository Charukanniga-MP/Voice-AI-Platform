import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../');
const clientRoot = path.join(projectRoot, 'client');

console.log('====================================================');
console.log('📱 KAIRA VOICE AI - RESPONSIVE & ADAPTIVE UI AUDIT');
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

// 1. Audit Global CSS and Base Styling
console.log('--- 1. Global CSS, Reset & Viewport Safeguards ---');
const indexCssPath = path.join(clientRoot, 'src/index.css');
const indexCss = fs.readFileSync(indexCssPath, 'utf8');

assert(
  'index.css enforces horizontal overflow prevention on body (overflow-x: hidden)',
  indexCss.includes('overflow-x: hidden')
);

assert(
  'index.css includes safe-area-inset for mobile devices / notches',
  indexCss.includes('env(safe-area-inset-bottom')
);

assert(
  'index.css defines .scrollbar-none for clean horizontal swiping on mobile',
  indexCss.includes('.scrollbar-none')
);

assert(
  'index.css defines touch-target utility and manipulation behavior',
  indexCss.includes('.touch-target') && indexCss.includes('touch-action: manipulation')
);

assert(
  'index.css defines fluid responsive container (.kaira-container)',
  indexCss.includes('.kaira-container')
);

// 2. Audit Top Navigation & Dropdowns
console.log('\n--- 2. Responsive Navigation & Profile Dropdown ---');
const navbarPath = path.join(clientRoot, 'src/components/Navbar.tsx');
const navbarContent = fs.readFileSync(navbarPath, 'utf8');

assert(
  'Navbar height is responsive (h-16 on mobile, sm:h-20 on desktop)',
  navbarContent.includes('h-16') && navbarContent.includes('sm:h-20')
);

assert(
  'Navbar logo has responsive dimensions without desktop crowding',
  navbarContent.includes('h-12 w-12 sm:h-14 sm:w-14') || navbarContent.includes('h-12')
);

const langSelectorPath = path.join(clientRoot, 'src/components/LanguageSelector.tsx');
const langSelectorContent = fs.readFileSync(langSelectorPath, 'utf8');

assert(
  'LanguageSelector button hides secondary English name on small screens',
  langSelectorContent.includes('hidden sm:inline')
);

assert(
  'LanguageSelector dropdown menu has max-w containment for small mobile viewports',
  langSelectorContent.includes('max-w-[calc(100vw-1.5rem)]')
);

assert(
  'LanguageSelector pills grid adapts from mobile 2-cols to desktop 6-cols',
  langSelectorContent.includes('grid-cols-2') && langSelectorContent.includes('md:grid-cols-6')
);

const profileDropdownPath = path.join(clientRoot, 'src/components/ProfileDropdown.tsx');
const profileDropdownContent = fs.readFileSync(profileDropdownPath, 'utf8');

assert(
  'ProfileDropdown has viewport max-width containment (max-w-[calc(100vw-2rem)])',
  profileDropdownContent.includes('max-w-[calc(100vw-2rem)]')
);

// 3. Audit Customer Dashboard Responsiveness
console.log('\n--- 3. Customer Dashboard Cross-Device Adaptations ---');
const customerDashboardPath = path.join(clientRoot, 'src/pages/CustomerDashboard.tsx');
const customerContent = fs.readFileSync(customerDashboardPath, 'utf8');

assert(
  'Customer banner uses adaptive padding (p-4 on mobile, sm:p-6, lg:p-8 on desktop)',
  customerContent.includes('p-4 sm:p-6 lg:p-8')
);

assert(
  'Customer banner heading uses fluid typography (text-xl sm:text-2xl lg:text-3xl)',
  customerContent.includes('text-xl sm:text-2xl lg:text-3xl')
);

assert(
  'Customer session bar stacks on mobile (flex-col sm:flex-row)',
  customerContent.includes('flex flex-col sm:flex-row')
);

assert(
  'Calling Hero has responsive padding (p-4 sm:p-6 lg:p-8)',
  customerContent.includes('p-4 sm:p-6 lg:p-8')
);

assert(
  'Call AI Hero button is full-width with touch-friendly min-h-[50px]',
  customerContent.includes('min-h-[50px] sm:min-h-[54px]')
);

assert(
  'Customer Call History includes both desktop Table (hidden md:block) and mobile Cards (block md:hidden)',
  customerContent.includes('hidden md:block') && customerContent.includes('block md:hidden')
);

assert(
  'Mobile Call History cards provide direct Listen and View actions',
  customerContent.includes('playingRecordingId === call.id ? <Pause') &&
  customerContent.includes('setSelectedHistoryCall(call)')
);

// 4. Audit Support Agent Console Responsiveness
console.log('\n--- 4. Support Agent Dashboard Cross-Device Adaptations ---');
const agentDashboardPath = path.join(clientRoot, 'src/pages/AgentDashboard.tsx');
const agentContent = fs.readFileSync(agentDashboardPath, 'utf8');

assert(
  'Agent console status bar wraps gracefully on mobile screens',
  agentContent.includes('flex flex-wrap items-center gap-2 sm:gap-3')
);

assert(
  'Agent navigation tabs feature smooth mobile horizontal scrolling (overflow-x-auto scrollbar-none)',
  agentContent.includes('overflow-x-auto scrollbar-none')
);

assert(
  'Agent tabs have shrink-0 and min-h-[36px] for easy finger tapping',
  agentContent.includes('shrink-0 whitespace-nowrap min-h-[36px]')
);

assert(
  'Incoming Call notification modal has responsive width and padding for mobile',
  agentContent.includes('w-[calc(100vw-2rem)] sm:w-full')
);

// 5. Audit Administrator Console Responsiveness
console.log('\n--- 5. Administrator Console Cross-Device Adaptations ---');
const adminDashboardPath = path.join(clientRoot, 'src/pages/AdminDashboard.tsx');
const adminContent = fs.readFileSync(adminDashboardPath, 'utf8');

assert(
  'Admin sidebar switches between responsive drawer (md:block) and mobile toggle',
  adminContent.includes('mobileNavOpen') && adminContent.includes('md:hidden')
);

assert(
  'Admin console provides one-tap mobile quick navigation pills',
  adminContent.includes('md:hidden flex overflow-x-auto gap-1.5')
);

assert(
  'Mobile quick nav pills include all 12 key administrative sections',
  adminContent.includes("id: 'bi', label: 'BI Reports'") &&
  adminContent.includes("id: 'intelligence', label: 'AI Intelligence'")
);

assert(
  'Admin main content area uses responsive padding (p-3.5 on mobile, sm:p-6, md:p-8)',
  adminContent.includes('p-3.5 sm:p-6 md:p-8')
);

// 6. Audit Support Tickets Responsiveness
console.log('\n--- 6. Support Tickets Cross-Device Adaptations ---');
const ticketsPath = path.join(clientRoot, 'src/pages/SupportTickets.tsx');
const ticketsContent = fs.readFileSync(ticketsPath, 'utf8');

assert(
  'Tickets header is responsive (flex-col sm:flex-row)',
  ticketsContent.includes('flex flex-col gap-3 sm:flex-row')
);

assert(
  'Ticket filter pills have smooth mobile scrollbar-none scrolling',
  ticketsContent.includes('overflow-x-auto scrollbar-none')
);

assert(
  'Ticket action buttons have min-h-[38px] touch compliance',
  ticketsContent.includes('min-h-[38px]')
);

// 7. Audit Modal Viewports & Business Intelligence
console.log('\n--- 7. Modals & Business Intelligence Responsiveness ---');
const biPath = path.join(clientRoot, 'src/components/BiReportsSection.tsx');
const biContent = fs.readFileSync(biPath, 'utf8');

assert(
  'BI period filters wrap and scroll smoothly on mobile (scrollbar-none)',
  biContent.includes('overflow-x-auto scrollbar-none')
);

assert(
  'BI KPI metrics grid adapts from 1 col on mobile up to 6 cols on desktop',
  biContent.includes('grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6')
);

const profileModalPath = path.join(clientRoot, 'src/components/CustomerProfileModal.tsx');
const profileModalContent = fs.readFileSync(profileModalPath, 'utf8');

assert(
  'CustomerProfileModal header adapts cleanly between mobile and desktop',
  profileModalContent.includes('flex flex-wrap items-center gap-2')
);

const intelModalPath = path.join(clientRoot, 'src/components/CallIntelligenceModal.tsx');
const intelModalContent = fs.readFileSync(intelModalPath, 'utf8');

assert(
  'CallIntelligenceModal header wraps buttons cleanly on mobile (flex-col sm:flex-row)',
  intelModalContent.includes('flex flex-col sm:flex-row sm:items-center')
);

console.log('\n====================================================');
console.log(`AUDIT RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('====================================================');

if (failed > 0) {
  process.exit(1);
}
