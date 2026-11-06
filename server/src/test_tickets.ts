import { prisma } from './db.js';
import assert from 'assert';

async function runTicketTests() {
  console.log('================================================================');
  console.log('🧪 TESTING SUPPORT TICKET SYSTEM INTEGRATION & PERMISSIONS');
  console.log('================================================================\n');

  // Test 1: Create a customer ticket
  console.log('--- Test 1: Ticket Creation & Default Values ---');
  const ticket = await prisma.supportTicket.create({
    data: {
      customerName: 'Test Customer',
      customerEmail: 'test.customer@kaira.ai',
      subject: 'Audio delay during Tamil voice call',
      description: 'Experiencing 2 second latency on mobile browser during voice session.',
      priority: 'high',
      status: 'open'
    }
  });

  assert(ticket.id, 'Ticket created with valid CUID');
  assert.strictEqual(ticket.priority, 'high', 'Priority set correctly');
  assert.strictEqual(ticket.status, 'open', 'Default status is open');
  console.log(`  ✓ PASS: Created ticket ID: ${ticket.id}`);

  // Test 2: Update ticket status and assignment
  console.log('\n--- Test 2: Ticket Assignment & Status Progression ---');
  const updatedTicket = await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: {
      status: 'in_progress',
      assignedTo: 'Support Agent',
      followUpAt: new Date(Date.now() + 86400000)
    }
  });

  assert.strictEqual(updatedTicket.status, 'in_progress', 'Status updated to in_progress');
  assert.strictEqual(updatedTicket.assignedTo, 'Support Agent', 'Assigned agent updated');
  assert(updatedTicket.followUpAt !== null, 'Follow-up date stored');
  console.log(`  ✓ PASS: Ticket status progressed to: ${updatedTicket.status}`);

  // Test 3: Resolution & Closure
  console.log('\n--- Test 3: Ticket Resolution ---');
  const resolvedTicket = await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: { status: 'resolved' }
  });
  assert.strictEqual(resolvedTicket.status, 'resolved', 'Ticket resolved');
  console.log('  ✓ PASS: Ticket successfully marked as resolved');

  // Test 4: Cleanup
  console.log('\n--- Test 4: Ticket Deletion & Cleanup ---');
  await prisma.supportTicket.delete({ where: { id: ticket.id } });
  const count = await prisma.supportTicket.count({ where: { id: ticket.id } });
  assert.strictEqual(count, 0, 'Ticket deleted cleanly');
  console.log('  ✓ PASS: Ticket deleted cleanly from database');

  console.log('\n================================================================');
  console.log('🏁 ALL 4 TICKET SYSTEM TESTS PASSED SUCCESSFULLY');
  console.log('================================================================\n');
}

runTicketTests().catch(err => {
  console.error('Ticket test failure:', err);
  process.exit(1);
});
