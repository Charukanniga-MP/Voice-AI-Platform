import { prisma } from './db.js';

async function runTests() {
  console.log('================================================================');
  console.log('       KAIRA TECHNOLOGIES - DUPLICATE VERIFICATION SUITE       ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  // 1. Customer records uniqueness check
  console.log('--- Test 1: Customer Records Uniqueness ---');
  const customers = await prisma.user.findMany({
    where: { role: 'customer' }
  });
  const customerEmails = customers.map(c => c.email.trim().toLowerCase());
  const uniqueCustomerEmails = new Set(customerEmails);
  assert(customerEmails.length === uniqueCustomerEmails.size, `All ${customers.length} customer accounts have unique emails.`);

  // 2. Agent records uniqueness check
  console.log('\n--- Test 2: Support Agent Records Uniqueness ---');
  const agents = await prisma.user.findMany({
    where: { role: 'agent' }
  });
  const agentEmails = agents.map(a => a.email.trim().toLowerCase());
  const uniqueAgentEmails = new Set(agentEmails);
  assert(agentEmails.length === uniqueAgentEmails.size, `All ${agents.length} agent accounts have unique emails.`);

  // 3. Call records uniqueness check
  console.log('\n--- Test 3: Call Records Uniqueness ---');
  const calls = await prisma.callRecord.findMany();
  const callIds = calls.map(c => c.callId.trim());
  const uniqueCallIds = new Set(callIds);
  assert(callIds.length === uniqueCallIds.size, `All ${calls.length} call records have unique callIds.`);

  const callSids = calls.filter(c => c.providerCallSid).map(c => c.providerCallSid!.trim());
  const uniqueCallSids = new Set(callSids);
  assert(callSids.length === uniqueCallSids.size, `All providerCallSids are unique without duplicates.`);

  // 4. Repeated Twilio webhook events idempotency test
  console.log('\n--- Test 4: Webhook Idempotency & Duplicate Prevention ---');
  const testCallSid = 'CA_test_' + Date.now();
  const testPhone = '+15551234567';

  // Simulate First Webhook
  const res1 = await fetch('http://localhost:5000/api/telephony/voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      CallSid: testCallSid,
      From: '+15550001111',
      To: testPhone
    })
  });
  assert(res1.ok, 'First Twilio voice webhook accepted.');

  // Count calls with this testCallSid
  const callsAfterFirst = await prisma.callRecord.count({
    where: { providerCallSid: testCallSid }
  });
  assert(callsAfterFirst === 1, 'Exactly one CallRecord created for first webhook event.');

  // Simulate Duplicate / Retried Webhook with same CallSid
  const res2 = await fetch('http://localhost:5000/api/telephony/voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      CallSid: testCallSid,
      From: '+15550001111',
      To: testPhone
    })
  });
  assert(res2.ok, 'Duplicate Twilio voice webhook processed.');

  const callsAfterSecond = await prisma.callRecord.count({
    where: { providerCallSid: testCallSid }
  });
  assert(callsAfterSecond === 1, 'Repeated webhook event DID NOT create duplicate call record (Idempotent).');

  // Clean up test call
  await prisma.callRecord.deleteMany({ where: { providerCallSid: testCallSid } });

  // 5. Transfer request uniqueness check
  console.log('\n--- Test 5: Transfer Requests Uniqueness ---');
  const transfers = await prisma.callTransferRequest.findMany();
  const transferCallIds = transfers.map(t => t.callRecordId);
  const uniqueTransferCallIds = new Set(transferCallIds);
  assert(transferCallIds.length === uniqueTransferCallIds.size, `All ${transfers.length} transfers correspond to distinct call records.`);

  // 6. Knowledge Base uniqueness check
  console.log('\n--- Test 6: Knowledge Base Entries Uniqueness ---');
  const kbEntries = await prisma.knowledgeEntry.findMany();
  const kbKeys = kbEntries.map(e => `${e.title.trim().toLowerCase()}:::${(e.question || '').trim().toLowerCase()}`);
  const uniqueKbKeys = new Set(kbKeys);
  assert(kbKeys.length === uniqueKbKeys.size, `All ${kbEntries.length} Knowledge Base entries are distinct.`);

  // 7. Dashboard statistics verification
  console.log('\n--- Test 7: Dashboard Statistics Verification ---');
  // Login as admin to get token
  const loginRes = await fetch('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@kaira', password: 'kaira@123' })
  });
  const loginData = await loginRes.json();
  const adminToken = loginData.token;

  const statsRes = await fetch('http://localhost:5000/api/calls/stats', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const stats = await statsRes.json();

  const actualCustomerCount = await prisma.user.count({ where: { role: 'customer' } });
  const actualAgentCount = await prisma.user.count({ where: { role: 'agent' } });
  const actualCallCount = await prisma.callRecord.count();
  const actualTransferredCount = await prisma.callRecord.count({ where: { transferred: true } });
  const actualPendingTransfers = await prisma.callTransferRequest.count({ where: { status: { in: ['pending', 'ringing'] } } });

  assert(stats.totalCustomers === actualCustomerCount, `stats.totalCustomers (${stats.totalCustomers}) matches database count (${actualCustomerCount}).`);
  assert(stats.totalAgents === actualAgentCount, `stats.totalAgents (${stats.totalAgents}) matches database count (${actualAgentCount}).`);
  assert(stats.totalCalls === actualCallCount, `stats.totalCalls (${stats.totalCalls}) matches database count (${actualCallCount}).`);
  assert(stats.transferredCalls === actualTransferredCount, `stats.transferredCalls (${stats.transferredCalls}) matches database count (${actualTransferredCount}).`);
  assert(stats.pendingTransfers === actualPendingTransfers, `stats.pendingTransfers (${stats.pendingTransfers}) matches database count (${actualPendingTransfers}).`);

  // 8. Navigation & Filter Consistency Test
  console.log('\n--- Test 8: Navigation, Filter & Search Consistency ---');
  const custRes = await fetch('http://localhost:5000/api/customers', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const custData = await custRes.json();
  const custEmailsFromApi = custData.customers.map((c: any) => c.email.toLowerCase());
  const uniqueCustEmailsFromApi = new Set(custEmailsFromApi);
  assert(custEmailsFromApi.length === uniqueCustEmailsFromApi.size, `GET /api/customers returns unique customers without duplicates (${custEmailsFromApi.length}).`);

  const agentRes = await fetch('http://localhost:5000/api/agents', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const agentData = await agentRes.json();
  const agentEmailsFromApi = agentData.agents.map((a: any) => a.email.toLowerCase());
  const uniqueAgentEmailsFromApi = new Set(agentEmailsFromApi);
  assert(agentEmailsFromApi.length === uniqueAgentEmailsFromApi.size, `GET /api/agents returns unique support agents without duplicates (${agentEmailsFromApi.length}).`);

  const kbRes = await fetch('http://localhost:5000/api/knowledge', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const kbData = await kbRes.json();
  const kbTitlesFromApi = kbData.entries.map((e: any) => e.title.toLowerCase());
  const uniqueKbTitlesFromApi = new Set(kbTitlesFromApi);
  assert(kbTitlesFromApi.length === uniqueKbTitlesFromApi.size, `GET /api/knowledge returns unique entries without duplicates (${kbTitlesFromApi.length}).`);

  console.log('\n================================================================');
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
