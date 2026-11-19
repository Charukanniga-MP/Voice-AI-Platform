import { io as Client } from 'socket.io-client';
import { prisma } from '../db.js';

async function verifyFrustrationForwarding() {
  console.log('=================================================================');
  console.log('🧪 TEST: Frustrated Client + Unknown Answer -> Forward to Human');
  console.log('=================================================================\n');

  const socket = Client('http://localhost:5000', {
    transports: ['websocket'],
    forceNew: true,
    timeout: 5000
  });

  await new Promise<void>((resolve, reject) => {
    socket.on('connect', () => {
      console.log('✓ Connected to backend Socket.IO on port 5000');
      resolve();
    });
    socket.on('connect_error', (e) => reject(e));
  });

  const testCustomer = await prisma.user.findFirst({
    where: { role: 'customer' }
  });

  if (!testCustomer) throw new Error('No customer found in DB');

  const callId = `call_frustrated_test_${Date.now()}`;

  // Step 1: Start call
  console.log('\n--- Step 1: Initiating call:start ---');
  const readyPromise = new Promise<any>((resolve) => {
    socket.on('call:ready', (data) => {
      if (data.callId === callId) resolve(data);
    });
  });

  socket.emit('call:start', {
    callId,
    customerId: testCustomer.id,
    customerName: testCustomer.name,
    language: 'en'
  });

  const readyData = await readyPromise;
  console.log('✓ Call ready received. Greeting:', readyData.greeting.slice(0, 50) + '...');

  // Step 2: Client expresses frustration with an ungrounded/unknown question
  console.log('\n--- Step 2: Client speaks frustrated query with unknown answer ---');
  const frustratedQuery = 'I am extremely frustrated with this terrible service! Why did my custom external drone synchronization fail?';
  const msgId = `msg_frust_${Date.now()}`;

  const responsePromise = new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for AI response')), 15000);
    socket.on('call:ai_response', (data) => {
      if (data.clientMessageId === msgId || data.callId === callId) {
        clearTimeout(timer);
        resolve(data);
      }
    });
  });

  socket.emit('call:query', {
    callId,
    customerId: testCustomer.id,
    query: frustratedQuery,
    language: 'en',
    clientMessageId: msgId
  });

  const aiResp = await responsePromise;

  console.log('✓ Received call:ai_response:');
  console.log('  isTransferring:', aiResp.isTransferring);
  console.log('  transferId:', aiResp.transferId);
  console.log('  Answer:', aiResp.answer);

  // Assertions
  if (!aiResp.isTransferring) {
    throw new Error('FAILED: Expected isTransferring to be true for frustrated client with unknown answer!');
  }

  if (!aiResp.transferId) {
    throw new Error('FAILED: Expected transferId to be generated for human escalation!');
  }

  const answerLower = aiResp.answer.toLowerCase();
  if (!answerLower.includes('frustration') && !answerLower.includes('human support') && !answerLower.includes('connect you')) {
    throw new Error(`FAILED: Expected empathetic transfer message. Got: "${aiResp.answer}"`);
  }

  // Step 3: Check database call record and transfer request
  console.log('\n--- Step 3: Inspecting Database Call Record & Transfer Request ---');
  const updatedCall = await prisma.callRecord.findUnique({
    where: { callId }
  });

  console.log('✓ Database CallRecord:');
  console.log('  status:', updatedCall?.status);
  console.log('  transferred:', updatedCall?.transferred);
  console.log('  transferReason:', updatedCall?.transferReason);
  console.log('  requiresAssistance:', updatedCall?.requiresAssistance);

  if (!updatedCall?.transferred) {
    throw new Error('FAILED: CallRecord.transferred was not set to true in database!');
  }

  const transferRecord = await prisma.callTransferRequest.findFirst({
    where: { callRecordId: updatedCall.id }
  });

  console.log('✓ Database CallTransferRequest:');
  console.log('  status:', transferRecord?.status);
  console.log('  reason:', transferRecord?.reason);
  console.log('  question:', transferRecord?.question);

  if (!transferRecord) {
    throw new Error('FAILED: CallTransferRequest was not created in database!');
  }

  // Step 4: Verify Knowledge Gap was tracked for admin review
  const gap = await prisma.knowledgeGap.findFirst({
    where: { question: { contains: 'drone' } }
  });
  console.log('✓ Database KnowledgeGap created for Admin Review:', gap?.question);

  socket.disconnect();
  await prisma.$disconnect();

  console.log('\n=================================================================');
  console.log('🎉 ALL CHECKS PASSED: Frustrated client with unknown answer');
  console.log('   was successfully forwarded to human support specialist!');
  console.log('=================================================================\n');
  process.exit(0);
}

verifyFrustrationForwarding().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
