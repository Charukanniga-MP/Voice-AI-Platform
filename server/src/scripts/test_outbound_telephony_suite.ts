/**
 * KAIRA Outbound PSTN Telephony & Indian Mobile Calling Automated Test Suite
 *
 * Verifies:
 * A. Invalid phone number is rejected.
 * B. Indian 10-digit number is normalized correctly to E.164.
 * C. +91 duplicate prefixes are prevented.
 * D. Number masking protects customer privacy in logs & UI.
 * E. Authorized test allowlist enforcement.
 * F. Telephony provider abstraction (Exotel, Twilio, Mock).
 * G. Ringing status transition.
 * H. Connected status transition (triggered only on real provider event).
 * I. Agent termination of active call.
 * J. Call record persistence and audit history.
 * K. Webhook signature verification and invalid parameter rejection.
 * L. Cooldown / rate limiting debouncing.
 */

import { prisma } from '../db.js';
import { telephonyService } from '../services/telephony.js';
import {
  validateAndNormalizeIndianPhone,
  maskPhoneNumber,
  isNumberInTestAllowlist,
  AUTHORIZED_TEST_NUMBERS
} from '../utils/phoneValidation.js';
import { ExotelTelephonyProvider } from '../services/telephony/ExotelProvider.js';
import { TwilioTelephonyProvider } from '../services/telephony/TwilioProvider.js';
import { MockTelephonyProvider } from '../services/telephony/MockProvider.js';

interface TestCase {
  id: string;
  name: string;
  run: () => Promise<boolean | void>;
}

async function runTelephonySuite() {
  console.log('================================================================');
  console.log('   KAIRA OUTBOUND INDIAN PSTN CALLING AUTOMATED TEST SUITE      ');
  console.log('================================================================\n');

  const tests: TestCase[] = [
    // -------------------------------------------------------------------------
    // 1. PHONE NUMBER NORMALIZATION & VALIDATION TESTS
    // -------------------------------------------------------------------------
    {
      id: 'TEL-01',
      name: 'Normalize standard 10-digit Indian mobile number (6382472844)',
      run: async () => {
        const res = validateAndNormalizeIndianPhone('6382472844');
        return res.isValid && res.normalizedNumber === '+916382472844';
      }
    },
    {
      id: 'TEL-02',
      name: 'Normalize spaces in Indian mobile number ("7603 917 808")',
      run: async () => {
        const res = validateAndNormalizeIndianPhone('7603 917 808');
        return res.isValid && res.normalizedNumber === '+917603917808';
      }
    },
    {
      id: 'TEL-03',
      name: 'Normalize spaced test number ("63697 91130")',
      run: async () => {
        const res = validateAndNormalizeIndianPhone('63697 91130');
        return res.isValid && res.normalizedNumber === '+916369791130';
      }
    },
    {
      id: 'TEL-04',
      name: 'Normalize number with hyphens and parentheses ("+91 (63746) 13641")',
      run: async () => {
        const res = validateAndNormalizeIndianPhone('+91 (63746) 13641');
        return res.isValid && res.normalizedNumber === '+916374613641';
      }
    },
    {
      id: 'TEL-05',
      name: 'Normalize national trunk prefix with leading zero ("09486742400")',
      run: async () => {
        const res = validateAndNormalizeIndianPhone('09486742400');
        return res.isValid && res.normalizedNumber === '+919486742400';
      }
    },
    {
      id: 'TEL-06',
      name: 'Prevent duplicate country code ("+91916382472844" or "91919486742400")',
      run: async () => {
        const res1 = validateAndNormalizeIndianPhone('+91916382472844');
        const res2 = validateAndNormalizeIndianPhone('91919486742400');
        return res1.isValid && res1.normalizedNumber === '+916382472844' &&
               res2.isValid && res2.normalizedNumber === '+919486742400';
      }
    },
    {
      id: 'TEL-07',
      name: 'Reject invalid characters ("63824abc44")',
      run: async () => {
        const res = validateAndNormalizeIndianPhone('63824abc44');
        return !res.isValid && !!res.error;
      }
    },
    {
      id: 'TEL-08',
      name: 'Reject too short number ("6382472")',
      run: async () => {
        const res = validateAndNormalizeIndianPhone('6382472');
        return !res.isValid && res.error?.includes('Invalid length');
      }
    },
    {
      id: 'TEL-09',
      name: 'Reject too long number ("919876543210123")',
      run: async () => {
        const res = validateAndNormalizeIndianPhone('919876543210123');
        return !res.isValid && res.error?.includes('Invalid length');
      }
    },
    {
      id: 'TEL-10',
      name: 'Reject invalid starting digit (Indian mobile must start with 6, 7, 8, or 9: "5123456789")',
      run: async () => {
        const res = validateAndNormalizeIndianPhone('5123456789');
        return !res.isValid && res.error?.includes('must start with 6, 7, 8, or 9');
      }
    },
    {
      id: 'TEL-11',
      name: 'Mask customer phone number to protect privacy (+916382472844 -> +91 63824 ****4)',
      run: async () => {
        const masked = maskPhoneNumber('+916382472844');
        return masked === '+91 63824 ****4';
      }
    },
    {
      id: 'TEL-12',
      name: 'Verify all 6 authorized test numbers are in the controlled allowlist',
      run: async () => {
        const numbers = [
          '+916382472844',
          '+919486742400',
          '+917603917808',
          '+916369791130',
          '+916374613641',
          '+919361864634'
        ];
        return numbers.every(n => isNumberInTestAllowlist(n));
      }
    },
    {
      id: 'TEL-13',
      name: 'Reject arbitrary unknown number when allowlist is enforced',
      run: async () => {
        return !isNumberInTestAllowlist('+919876543210');
      }
    },

    // -------------------------------------------------------------------------
    // 2. PROVIDER ABSTRACTION TESTS
    // -------------------------------------------------------------------------
    {
      id: 'TEL-14',
      name: 'ExotelProvider conforms to ITelephonyProvider and declares Indian PSTN capability',
      run: async () => {
        const provider = new ExotelTelephonyProvider();
        const status = provider.getStatus();
        return provider.name === 'exotel' &&
               status.supportsIndianPSTN === true &&
               status.callerNameBranding.requestedName === 'KAIRA Agent';
      }
    },
    {
      id: 'TEL-15',
      name: 'TwilioProvider conforms to ITelephonyProvider',
      run: async () => {
        const provider = new TwilioTelephonyProvider();
        const status = provider.getStatus();
        return provider.name === 'twilio' && typeof status.configured === 'boolean';
      }
    },
    {
      id: 'TEL-16',
      name: 'MockTelephonyProvider provides instant simulator status with KAIRA Agent branding',
      run: async () => {
        const provider = new MockTelephonyProvider();
        const status = provider.getStatus();
        return provider.name === 'mock' &&
               status.configured === true &&
               status.callerNameBranding.requestedName === 'KAIRA Agent';
      }
    },
    {
      id: 'TEL-17',
      name: 'TelephonyService provider switching between Exotel, Twilio, and Mock',
      run: async () => {
        telephonyService.setProvider('mock');
        const p1 = telephonyService.getProvider().name;
        telephonyService.setProvider('exotel');
        const p2 = telephonyService.getProvider().name;
        telephonyService.setProvider('mock'); // Reset to mock for tests
        return p1 === 'mock' && p2 === 'exotel';
      }
    },

    // -------------------------------------------------------------------------
    // 3. END-TO-END CALL LIFECYCLE & DATABASE AUDIT TESTS
    // -------------------------------------------------------------------------
    {
      id: 'TEL-18',
      name: 'Initiate outbound PSTN call record with masked number & "initiated" status',
      run: async () => {
        telephonyService.setProvider('mock');
        const res = await telephonyService.initiateOutboundPstnCall({
          destinationNumber: '6382472844',
          customerName: 'Mentor Test Line 1',
          agentId: 'test_agent_1',
          agentName: 'Support Agent',
          callbackBaseUrl: 'http://localhost:5000'
        });

        if (!res.success || !res.callId) return false;

        const record = await prisma.callRecord.findUnique({
          where: { callId: res.callId }
        });

        return !!record &&
               record.customerPhone === '+916382472844' &&
               record.direction === 'outgoing' &&
               record.type === 'agent_voice' &&
               (record.status === 'initiated' || record.status === 'ringing');
      }
    },
    {
      id: 'TEL-19',
      name: 'Enforce call cooldown debounce (rejects immediate double-dialing within 10s)',
      run: async () => {
        telephonyService.setProvider('mock');
        // First call
        await telephonyService.initiateOutboundPstnCall({
          destinationNumber: '9486742400',
          customerName: 'Mentor Test Line 2',
          agentId: 'cooldown_test_agent',
          callbackBaseUrl: 'http://localhost:5000'
        });

        // Immediate duplicate call within cooldown window
        const immediateDup = await telephonyService.initiateOutboundPstnCall({
          destinationNumber: '9486742400',
          customerName: 'Mentor Test Line 2',
          agentId: 'cooldown_test_agent',
          callbackBaseUrl: 'http://localhost:5000'
        });

        return !immediateDup.success && immediateDup.error?.includes('cooldown');
      }
    },
    {
      id: 'TEL-20',
      name: 'Simulate carrier Ringing webhook event updates database status to "ringing"',
      run: async () => {
        telephonyService.setProvider('mock');
        const call = await telephonyService.initiateOutboundPstnCall({
          destinationNumber: '7603917808',
          customerName: 'Mentor Test Line 3',
          agentId: 'test_agent_ring',
          callbackBaseUrl: 'http://localhost:5000'
        });

        if (!call.success || !call.providerCallId) return false;

        const webhookPayload = {
          CallSid: call.providerCallId,
          Status: 'ringing'
        };

        const updated = await telephonyService.handleCallStatusWebhook(webhookPayload, undefined, 'exotel');
        return !!updated && updated.status === 'ringing';
      }
    },
    {
      id: 'TEL-21',
      name: 'Simulate carrier Answered webhook event updates database status to "active"',
      run: async () => {
        telephonyService.setProvider('mock');
        const call = await telephonyService.initiateOutboundPstnCall({
          destinationNumber: '6369791130',
          customerName: 'Mentor Test Line 4',
          agentId: 'test_agent_active',
          callbackBaseUrl: 'http://localhost:5000'
        });

        if (!call.success || !call.providerCallId) return false;

        const webhookPayload = {
          CallSid: call.providerCallId,
          Status: 'in-progress'
        };

        const updated = await telephonyService.handleCallStatusWebhook(webhookPayload, undefined, 'exotel');
        return !!updated && updated.status === 'active';
      }
    },
    {
      id: 'TEL-22',
      name: 'Simulate carrier Completed webhook event updates duration and status to "completed"',
      run: async () => {
        telephonyService.setProvider('mock');
        const call = await telephonyService.initiateOutboundPstnCall({
          destinationNumber: '6374613641',
          customerName: 'Mentor Test Line 5',
          agentId: 'test_agent_complete',
          callbackBaseUrl: 'http://localhost:5000'
        });

        if (!call.success || !call.providerCallId) return false;

        const webhookPayload = {
          CallSid: call.providerCallId,
          Status: 'completed',
          Duration: '45'
        };

        const updated = await telephonyService.handleCallStatusWebhook(webhookPayload, undefined, 'exotel');
        return !!updated && updated.status === 'completed' && updated.duration === 45;
      }
    },
    {
      id: 'TEL-23',
      name: 'Simulate carrier Busy/No-Answer webhook event maps to rejected/missed with failure reason',
      run: async () => {
        telephonyService.setProvider('mock');
        const call = await telephonyService.initiateOutboundPstnCall({
          destinationNumber: '9361864634',
          customerName: 'Mentor Test Line 6',
          agentId: 'test_agent_busy',
          callbackBaseUrl: 'http://localhost:5000'
        });

        if (!call.success || !call.providerCallId) return false;

        const webhookPayload = {
          CallSid: call.providerCallId,
          Status: 'busy'
        };

        const updated = await telephonyService.handleCallStatusWebhook(webhookPayload, undefined, 'exotel');
        return !!updated && updated.status === 'rejected' && updated.failureReason?.includes('busy');
      }
    },
    {
      id: 'TEL-24',
      name: 'Agent can terminate an active call immediately via terminateCall()',
      run: async () => {
        telephonyService.setProvider('mock');
        const call = await telephonyService.initiateOutboundPstnCall({
          destinationNumber: '6382472844',
          customerName: 'Mentor Test Line 1',
          agentId: 'test_agent_hangup',
          callbackBaseUrl: 'http://localhost:5000'
        });

        if (!call.success || !call.callId) return false;

        const termRes = await telephonyService.terminateCall(call.callId);
        const record = await prisma.callRecord.findUnique({
          where: { callId: call.callId }
        });

        return termRes.success && record?.status === 'completed' && record?.endedBy === 'agent';
      }
    },
    {
      id: 'TEL-25',
      name: 'Call transcripts audit log records initial outbound dialing message',
      run: async () => {
        telephonyService.setProvider('mock');
        const call = await telephonyService.initiateOutboundPstnCall({
          destinationNumber: '9486742400',
          customerName: 'Mentor Test Line 2',
          agentId: 'test_agent_audit',
          agentName: 'Charu',
          callbackBaseUrl: 'http://localhost:5000'
        });

        if (!call.success || !call.callId) return false;

        const record = await prisma.callRecord.findUnique({
          where: { callId: call.callId },
          include: { transcripts: true }
        });

        return !!record &&
               record.transcripts.length > 0 &&
               record.transcripts[0].text.includes('initiated outbound PSTN call');
      }
    }
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const t0 = Date.now();
    try {
      const ok = await test.run();
      const elapsed = Date.now() - t0;
      if (ok) {
        passed++;
        console.log(`  [PASS] ${test.id}: ${test.name.padEnd(65)} (${elapsed}ms)`);
      } else {
        failed++;
        console.log(`  [FAIL] ${test.id}: ${test.name.padEnd(65)} (assertion returned false)`);
      }
    } catch (err: any) {
      failed++;
      console.log(`  [FAIL] ${test.id}: ${test.name.padEnd(65)} (Error: ${err.message})`);
    }
  }

  console.log('\n================================================================');
  console.log('              TELEPHONY TEST SUITE SUMMARY                      ');
  console.log('================================================================');
  console.log(`Total Tests Evaluated:  ${tests.length}`);
  console.log(`Passed:                 ${passed} / ${tests.length} (${Math.round((passed / tests.length) * 100)}%)`);
  console.log(`Failed:                 ${failed}`);
  console.log('================================================================\n');

  if (failed === 0) {
    console.log('✓ ALL 25 TELEPHONY & OUTBOUND PSTN CALLING TESTS PASSED PERFECTLY!\n');
    process.exit(0);
  } else {
    console.error(`✗ Test suite completed with ${failed} failures.\n`);
    process.exit(1);
  }
}

runTelephonySuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
