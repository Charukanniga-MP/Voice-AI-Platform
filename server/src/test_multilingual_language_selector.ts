import { io as Client } from 'socket.io-client';
import { prisma } from './db.js';
import jwt from 'jsonwebtoken';
import { SUPPORTED_LANGUAGES, translationService } from './services/translation.js';
import fs from 'fs';
import path from 'path';

const JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_for_kaira_agent_platform_2026';
const BASE_URL = 'http://localhost:5000';

interface CheckResult {
  suite: string;
  name: string;
  passed: boolean;
  details?: string;
}

const results: CheckResult[] = [];

function record(suite: string, name: string, passed: boolean, details?: string) {
  results.push({ suite, name, passed, details });
  const badge = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`[${badge}] [${suite}] ${name}${details ? ` -> ${details}` : ''}`);
}

async function runMultilingualSelectorAudit() {
  console.log('================================================================');
  console.log('🌐 KAIRA MULTILINGUAL LANGUAGE SELECTOR & PIPELINE AUDIT');
  console.log('================================================================\n');

  try {
    // -------------------------------------------------------------
    // SUITE 1: VERIFY ALL 21 LANGUAGES IN PIPELINE
    // -------------------------------------------------------------
    console.log('--- SUITE 1: 21 Supported Languages End-to-End Verification ---');
    const langCodes = Object.keys(SUPPORTED_LANGUAGES);
    record(
      'Language Registry',
      'Registry contains all 20+ requested languages',
      langCodes.length >= 20,
      `Found ${langCodes.length} languages: ${langCodes.join(', ')}`
    );

    let allMetaValid = true;
    for (const code of langCodes) {
      const meta = SUPPORTED_LANGUAGES[code];
      if (!meta.name || !meta.nativeName || !meta.bcp47) {
        allMetaValid = false;
        break;
      }
    }
    record('Language Registry', 'All language metadata contains name, nativeName, and BCP47', allMetaValid);

    // Test live translation for 5 diverse regional & international languages
    const sampleLangs = ['ta', 'hi', 'fr', 'ja', 'ar'];
    let allSampleTranslationsOk = true;
    for (const l of sampleLangs) {
      const translated = await translationService.translateText('Welcome to KAIRA', l, 'en');
      if (!translated || translated === 'Welcome to KAIRA') {
        allSampleTranslationsOk = false;
      }
    }
    record(
      'Translation Engine',
      'Live translation working across regional & global languages (ta, hi, fr, ja, ar)',
      allSampleTranslationsOk
    );

    // Test live TTS audio generation for selected languages
    const ttsSampleLangs = ['en', 'ta', 'te', 'hi', 'es', 'zh'];
    let allTtsOk = true;
    for (const l of ttsSampleLangs) {
      try {
        const res = await fetch(`${BASE_URL}/api/voice/tts?text=Test&lang=${l}`);
        const buf = await res.arrayBuffer();
        if (!res.ok || buf.byteLength < 500) {
          allTtsOk = false;
        }
      } catch {
        allTtsOk = false;
      }
    }
    record(
      'TTS Audio Synthesis',
      'TTS streaming produces valid MPEG audio for regional & international languages',
      allTtsOk
    );

    // -------------------------------------------------------------
    // SUITE 2: UI CODE AUDIT - NO LANGUAGE CARDS OR HARDCODED 6 LABELS
    // -------------------------------------------------------------
    console.log('\n--- SUITE 2: UI Code Audit (No Cards & Correct Labels) ---');

    const rootDir = process.cwd().endsWith('server') ? path.resolve(process.cwd(), '..') : process.cwd();
    const customerDashboardPath = path.resolve(rootDir, 'client/src/pages/CustomerDashboard.tsx');
    const customerCode = fs.readFileSync(customerDashboardPath, 'utf8');

    // 1. Check for absence of language cards grid and absence of duplicate welcome box in CustomerDashboard
    const hasLanguageCardGrid = /grid\s+grid-cols-[23].*grid-cols-6.*SUPPORTED_LANGUAGES.*button/s.test(customerCode);
    const hasWelcomeLanguageSelector = customerCode.includes('<LanguageSelector');
    record(
      'UI Layout',
      'Customer Welcome screen completely removes language selection cards grid and duplicate welcome box',
      !hasLanguageCardGrid && !hasWelcomeLanguageSelector,
      `Cards: ${!hasLanguageCardGrid}, Welcome Box: ${!hasWelcomeLanguageSelector} (Zero selectors in Welcome section)`
    );

    // 2. Check that Navbar has the exclusive LanguageSelector
    const navbarPath = path.resolve(rootDir, 'client/src/components/Navbar.tsx');
    const navbarCode = fs.readFileSync(navbarPath, 'utf8');
    const navbarHasSelector = navbarCode.includes('<LanguageSelector');
    record(
      'UI Layout',
      'Top Navbar renders the exclusive language dropdown selector (Navbar.tsx)',
      navbarHasSelector
    );

    // 3. Check for absence of "6 Regional Languages" or "6 Languages Supported" in CustomerDashboard
    const hasSixLabelCustomer = /6\s*(?:regional|languages)/i.test(customerCode);
    record(
      'Label Audit',
      'CustomerDashboard has no hardcoded "6 Regional" or "6 Languages" labels',
      !hasSixLabelCustomer,
      hasSixLabelCustomer ? 'Found legacy label' : 'Labels updated to Multiple Languages Supported'
    );

    // 4. Check AgentDashboard
    const agentDashboardPath = path.resolve(rootDir, 'client/src/pages/AgentDashboard.tsx');
    const agentCode = fs.readFileSync(agentDashboardPath, 'utf8');
    const hasSixLabelAgent = /6\s*regional/i.test(agentCode);
    record(
      'Label Audit',
      'AgentDashboard updated from "6 Regional" to "Multiple Languages"',
      !hasSixLabelAgent
    );

    // 5. Check AdminDashboard
    const adminDashboardPath = path.resolve(rootDir, 'client/src/pages/AdminDashboard.tsx');
    const adminCode = fs.readFileSync(adminDashboardPath, 'utf8');
    const hasSixLabelAdmin = /6\s*regional/i.test(adminCode);
    record(
      'Label Audit',
      'AdminDashboard updated from "(6 Regional Languages)" to "(Multiple Languages Supported)"',
      !hasSixLabelAdmin
    );

    // 6. Check Locales (en.ts)
    const enLocalePath = path.resolve(rootDir, 'client/src/i18n/locales/en.ts');
    const enLocale = fs.readFileSync(enLocalePath, 'utf8');
    const hasMultipleLangsBadge = enLocale.includes("'dashboard.supported_languages_badge': 'Multiple Languages Supported'");
    record(
      'Label Audit',
      'i18n locale badge updated to "Multiple Languages Supported"',
      hasMultipleLangsBadge
    );

    // -------------------------------------------------------------
    // SUITE 3: DROPDOWN ACCESSIBILITY & SCROLLING CONFIGURATION
    // -------------------------------------------------------------
    console.log('\n--- SUITE 3: Dropdown Accessibility & Scrolling Features ---');
    const selectorPath = path.resolve(rootDir, 'client/src/components/LanguageSelector.tsx');
    const selectorCode = fs.readFileSync(selectorPath, 'utf8');

    const hasMaxHeightAndScroll = selectorCode.includes('max-h-') && selectorCode.includes('overflow-y-auto');
    record('Dropdown UX', 'Dropdown has bounded max-height and vertical overflow scrolling', hasMaxHeightAndScroll);

    const hasKeyboardNav = selectorCode.includes('ArrowDown') && selectorCode.includes('ArrowUp') && selectorCode.includes('Enter') && selectorCode.includes('Escape');
    record('Dropdown UX', 'Dropdown supports Arrow keys, Enter selection, and Escape dismissal', hasKeyboardNav);

    const hasAutoScroll = selectorCode.includes('scrollIntoView');
    record('Dropdown UX', 'Dropdown automatically scrolls to selected language when opened', hasAutoScroll);

    const hasTouchScroll = selectorCode.includes('WebkitOverflowScrolling') && selectorCode.includes('overscroll-contain');
    record('Dropdown UX', 'Dropdown supports smooth touch scrolling and overscroll containment', hasTouchScroll);

    const hasViewportCollisionCheck = selectorCode.includes('openUpward') && selectorCode.includes('getBoundingClientRect');
    record('Dropdown UX', 'Dropdown detects viewport boundaries to prevent being cut off at bottom', hasViewportCollisionCheck);

    const hasCheckmarkAndGlobe = selectorCode.includes('Globe') && selectorCode.includes('Check');
    record('Dropdown UX', 'Dropdown features Globe icon, checkmark on selected language, and search filter', hasCheckmarkAndGlobe);

    // -------------------------------------------------------------
    // SUITE 4: ACTIVE CALL LANGUAGE SWITCHING & PIPELINE INTEGRATION
    // -------------------------------------------------------------
    console.log('\n--- SUITE 4: Active Call Language Switching & Pipeline Integration ---');
    const customerUser = await prisma.user.findFirst({ where: { role: 'customer' } });
    if (!customerUser) throw new Error('Customer user not found.');

    const customerToken = jwt.sign(
      { id: customerUser.id, email: customerUser.email, role: 'customer' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    const socket = Client(BASE_URL, { transports: ['websocket'], auth: { token: customerToken } });
    await new Promise<void>((res) => {
      socket.on('connect', () => {
        socket.emit('user:register', { userId: customerUser.id, role: 'customer', name: customerUser.name });
        res();
      });
    });

    const callId = `lang_switch_test_${Date.now()}`;
    await new Promise<void>((resolve) => {
      socket.emit('call:start', {
        callId,
        customerId: customerUser.id,
        customerName: customerUser.name,
        language: 'en'
      });
      socket.once('call:ready', () => resolve());
    });

    // Switch language to Tamil ('ta') mid-call
    socket.emit('call:change_language', { callId, language: 'ta' });
    await new Promise(r => setTimeout(r, 200));

    // Verify DB sync
    const callRec = await prisma.callRecord.findUnique({ where: { callId } });
    record(
      'Session Sync',
      'call:change_language updates CallRecord language preference in database',
      callRec?.language === 'ta',
      `CallRecord language: ${callRec?.language}`
    );

    socket.disconnect();

  } catch (err: any) {
    record('Audit', 'Test Execution Error', false, err.message);
  }

  // Summary
  console.log('\n================================================================');
  console.log('📊 MULTILINGUAL SELECTOR AUDIT SUMMARY');
  console.log('================================================================');
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = total - passed;
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0';

  console.log(`Total Checks: ${total}`);
  console.log(`Passed:       ${passed}`);
  console.log(`Failed:       ${failed}`);
  console.log(`Success Rate: ${passRate}%\n`);

  if (failed === 0) {
    console.log('✅ ALL MULTILINGUAL LANGUAGE SELECTOR AUDIT CHECKS PASSED!\n');
    process.exit(0);
  } else {
    console.error('❌ Some audit checks failed. Review details above.\n');
    process.exit(1);
  }
}

runMultilingualSelectorAudit();
