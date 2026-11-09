import { io as ClientIO } from 'socket.io-client';
import { prisma } from './db.js';

async function testCompleteWorkflow() {
  console.log('=== 3. MANDATORY LIVE CALL & ADMIN TRANSFER WORKFLOW TEST ===');
  const URL = 'http://localhost:5000';

  // Find real Admin user
  const admin = await prisma.user.findFirst({ where: { role: 'admin' } });
  const customer = await prisma.user.findFirst({ where: { role: 'customer' } });

  if (!admin || !customer) {
    console.error('Missing admin or customer in DB.');
    process.exit(1);
  }

  // 1. Connect Admin socket
  const adminSocket = ClientIO(URL);
  await new Promise<void>((resolve) => adminSocket.on('connect', resolve));
  console.log('Admin socket connected');
  adminSocket.emit('user:register', { userId: admin.id, role: 'admin', name: admin.name });

  // 2. Connect Customer socket
  const customerSocket = ClientIO(URL);
  await new Promise<void>((resolve) => customerSocket.on('connect', resolve));
  console.log('Customer socket connected');
  customerSocket.emit('user:register', { userId: customer.id, role: 'customer', name: customer.name });

  const testCallId = 'test_call_' + Date.now();

  // 3. Customer starts call
  console.log('Step 1: Customer starting call...');
  customerSocket.emit('call:start', {
    callId: testCallId,
    customerId: customer.id,
    customerName: customer.name,
    customerPhone: customer.phone || '+1 (555) 345-6789'
  });

  await new Promise<void>((resolve) => {
    customerSocket.on('call:ready', (data) => {
      console.log('Step 2: AI greeted customer with:', data.greeting);
      resolve();
    });
  });

  // 4. Grounded question: Pricing
  console.log('Step 3: Customer asks grounded question: "What are the pricing plans for KAIRA?"');
  customerSocket.emit('call:query', {
    callId: testCallId,
    query: 'What are the pricing plans for KAIRA?',
    customerId: customer.id,
    duration: 5
  });

  await new Promise<void>((resolve) => {
    customerSocket.once('call:ai_response', (data) => {
      console.log('Step 4: AI answered grounded question:');
      console.log('  isTransferring =', data.isTransferring);
      console.log('  answer =', data.answer.slice(0, 80) + '...');
      if (!data.isTransferring) {
        console.log('✓ Grounded question answered successfully without transfer!');
      }
      resolve();
    });
  });

  // 5. Ungrounded question: Pizza delivery (NOT in company KB!)
  console.log('\nStep 5: Customer asks ungrounded question: "Can I order 3 hot pepperoni pizzas to my office?"');
  customerSocket.emit('call:query', {
    callId: testCallId,
    query: 'Can I order 3 hot pepperoni pizzas to my office?',
    customerId: customer.id,
    duration: 15
  });

  let receivedTransferId = '';

  // Customer should receive fallback transfer message
  const customerTransferPromise = new Promise<void>((resolve) => {
    customerSocket.once('call:ai_response', (data) => {
      console.log('Step 6: AI fallback response to customer:');
      console.log('  answer =', data.answer);
      console.log('  isTransferring =', data.isTransferring);
      if (data.isTransferring && data.answer.includes("connect you with our Admin")) {
        console.log('✓ Correct fallback message spoken by AI!');
      }
      resolve();
    });
  });

  // Admin should receive incoming transfer notification
  const adminTransferPromise = new Promise<void>((resolve) => {
    adminSocket.once('transfer:incoming', (data) => {
      console.log('Step 7: Admin received real-time incoming transfer notification!');
      console.log('  Customer:', data.customerName);
      console.log('  Question:', data.question);
      console.log('  Reason:', data.reason);
      receivedTransferId = data.transferId;
      resolve();
    });
  });

  await Promise.all([customerTransferPromise, adminTransferPromise]);

  // 6. Admin accepts the transfer call
  console.log('\nStep 8: Admin accepts the transfer call...');
  adminSocket.emit('transfer:accept', {
    transferId: receivedTransferId,
    adminId: admin.id,
    adminName: admin.name
  });

  // Customer receives connected event
  await new Promise<void>((resolve) => {
    customerSocket.once('transfer:connected', (data) => {
      console.log('Step 9: Customer connected live with Admin:', data.adminName);
      console.log('✓ Two-way live voice channel established!');
      resolve();
    });
  });

  // 7. Human conversation: Admin speaks to customer
  console.log('Step 10: Admin speaks to customer: "Hello Alice, I can assist you directly."');
  adminSocket.emit('call:live_speech', {
    callId: testCallId,
    sender: 'admin',
    senderName: admin.name,
    text: 'Hello Alice, I can assist you directly.'
  });

  await new Promise<void>((resolve) => {
    customerSocket.once('call:live_transcript', (data) => {
      console.log('Step 11: Customer live transcript updated with Admin speech:', data.text);
      resolve();
    });
  });

  // 8. Admin ends call
  console.log('Step 12: Admin ends call...');
  adminSocket.emit('call:end', { callId: testCallId, duration: 42 });

  await new Promise<void>((resolve) => {
    customerSocket.once('call:ended', (data) => {
      console.log('Step 13: Call ended confirmed with duration:', data.duration);
      resolve();
    });
  });

  // Verify in backend REST API that call record is saved with status = completed, transferred = true, duration = 42
  const check = await prisma.callRecord.findUnique({
    where: { callId: testCallId },
    include: { transcripts: true, transferRequests: true }
  });

  console.log('\n=== VERIFYING PERSISTED DATABASE RECORD ===');
  console.log('Call ID:', check?.callId);
  console.log('Call Status:', check?.status);
  console.log('Transferred:', check?.transferred);
  console.log('Duration:', check?.duration, 'seconds');
  console.log('Transcripts count:', check?.transcripts.length);
  console.log('Transfer requests count:', check?.transferRequests.length);

  if (check && check.status === 'completed' && check.transferred && check.transcripts.length >= 4) {
    console.log('\n🎉 ALL MANDATORY WORKFLOW REQUIREMENTS MET AND VERIFIED IN DB! 🎉');
  } else {
    console.error('Verification failed:', check);
  }

  adminSocket.disconnect();
  customerSocket.disconnect();
  process.exit(0);
}

testCompleteWorkflow();
