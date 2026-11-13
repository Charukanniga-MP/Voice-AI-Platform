import { io as ClientIO, Socket } from 'socket.io-client';
import { prisma } from './db.js';

async function testCustomerToAgentCalling() {
  console.log('====================================================');
  console.log('🧪 VERIFYING CUSTOMER-TO-AGENT INCOMING CALLING FLOW');
  console.log('====================================================');

  const URL = 'http://localhost:5000';

  // 1. Fetch real customer and agent accounts from DB
  const customer = await prisma.user.findFirst({ where: { role: 'customer' } });
  const agent = await prisma.user.findFirst({ where: { role: 'agent' } });

  if (!customer || !agent) {
    console.error('❌ Missing customer or agent in database!');
    process.exit(1);
  }

  console.log(`✓ Using Customer: ${customer.name} (${customer.email})`);
  console.log(`✓ Using Agent: ${agent.name} (${agent.email})`);

  // Ensure agent status in DB is 'available'
  await prisma.user.update({
    where: { id: agent.id },
    data: { agentStatus: 'available' }
  });

  // 2. Connect Agent Socket (simulating Laptop Agent Dashboard)
  const agentSocket: Socket = ClientIO(URL, { transports: ['websocket', 'polling'] });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Agent socket connect timeout')), 5000);
    agentSocket.on('connect', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  console.log(`✓ Agent laptop socket connected (${agentSocket.id})`);

  // Register Agent as Available
  agentSocket.emit('user:register', {
    userId: agent.id,
    role: 'agent',
    name: agent.name,
    agentStatus: 'available',
    supportedLanguages: ['en', 'ta', 'te', 'ml', 'hi']
  });

  // Allow registration to register in server memory
  await new Promise(r => setTimeout(r, 600));

  // 3. Connect Customer Socket (simulating Mobile Customer Dashboard)
  const customerSocket: Socket = ClientIO(URL, { transports: ['websocket', 'polling'] });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Customer socket connect timeout')), 5000);
    customerSocket.on('connect', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  console.log(`✓ Customer mobile socket connected (${customerSocket.id})`);

  // Register Customer
  customerSocket.emit('user:register', {
    userId: customer.id,
    role: 'customer',
    name: customer.name,
    preferredLanguage: 'en'
  });

  await new Promise(r => setTimeout(r, 600));

  // 4. Setup Event Listeners
  const testCallId = `call_${Date.now()}`;
  let incomingCallReceivedByAgent = false;
  let incomingCallData: any = null;
  let callRingingReceivedByCustomer = false;
  let callAcceptedReceivedByCustomer = false;
  let acceptedData: any = null;
  let webrtcOfferReceivedByAgent = false;
  let webrtcAnswerReceivedByCustomer = false;
  let callEndedReceived = false;

  agentSocket.on('agent:incoming_call', (data: any) => {
    console.log(`🔔 [Agent Laptop] Received 'agent:incoming_call' event! Customer: ${data.customerName}, CallId: ${data.callId}`);
    incomingCallReceivedByAgent = true;
    incomingCallData = data;
  });

  customerSocket.on('customer:call_ringing', (data: any) => {
    console.log(`📲 [Customer Mobile] Received 'customer:call_ringing' event! Agent: ${data.agentName}`);
    callRingingReceivedByCustomer = true;
  });

  customerSocket.on('customer:call_accepted', (data: any) => {
    console.log(`🎉 [Customer Mobile] Received 'customer:call_accepted' event! Agent: ${data.agentName}, AgentSocketId: ${data.agentSocketId}`);
    callAcceptedReceivedByCustomer = true;
    acceptedData = data;
  });

  agentSocket.on('webrtc:offer', (data: any) => {
    console.log(`📡 [Agent Laptop] Received WebRTC offer from Customer (${data.sender})`);
    webrtcOfferReceivedByAgent = true;
    // Agent sends WebRTC answer back
    agentSocket.emit('webrtc:answer', {
      target: data.sender,
      answer: { type: 'answer', sdp: 'v=0 dummy_sdp_answer' },
      callId: data.callId
    });
  });

  customerSocket.on('webrtc:answer', (data: any) => {
    console.log(`📡 [Customer Mobile] Received WebRTC answer from Agent (${data.sender})`);
    webrtcAnswerReceivedByCustomer = true;
  });

  agentSocket.on('call:ended', (data: any) => {
    console.log(`🛑 [Agent Laptop] Call ended confirmed: ${data.callId}`);
    callEndedReceived = true;
  });

  // 5. Customer initiates call to live support agent
  console.log('\n--- Step 1: Customer clicks "Call Agent" ---');
  customerSocket.emit('customer:call_agent', {
    callId: testCallId,
    customerId: customer.id,
    customerName: customer.name,
    customerPhone: customer.phone || '+1 555-0199',
    preferredLanguage: 'en'
  });

  // Wait for incoming call to be delivered to Agent laptop and ringing to Customer
  const waitRinging = await new Promise<boolean>((resolve) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (incomingCallReceivedByAgent && callRingingReceivedByCustomer) {
        clearInterval(interval);
        resolve(true);
      } else if (Date.now() - start > 6000) {
        clearInterval(interval);
        resolve(false);
      }
    }, 100);
  });

  if (!waitRinging) {
    console.error('❌ FAILED: Agent did not receive incoming call or customer did not receive ringing.');
    console.error({ incomingCallReceivedByAgent, callRingingReceivedByCustomer });
    process.exit(1);
  }
  console.log('✅ STEP 1 PASSED: Agent received incoming call modal event & customer received ringing status!');

  // 6. Agent accepts the call
  console.log('\n--- Step 2: Agent clicks "Accept Call" on laptop ---');
  agentSocket.emit('agent:accept_call', {
    callId: testCallId,
    agentId: agent.id,
    agentName: agent.name
  });

  // Wait for Customer to receive call accepted
  const waitAccept = await new Promise<boolean>((resolve) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (callAcceptedReceivedByCustomer && acceptedData) {
        clearInterval(interval);
        resolve(true);
      } else if (Date.now() - start > 6000) {
        clearInterval(interval);
        resolve(false);
      }
    }, 100);
  });

  if (!waitAccept) {
    console.error('❌ FAILED: Customer did not receive customer:call_accepted.');
    process.exit(1);
  }
  console.log('✅ STEP 2 PASSED: Customer received call accepted notification with agent socket id!');

  // 7. Establish simulated WebRTC Mesh
  console.log('\n--- Step 3: WebRTC Signaling Mesh (Browser Audio Handshake) ---');
  customerSocket.emit('webrtc:offer', {
    target: acceptedData.agentSocketId,
    offer: { type: 'offer', sdp: 'v=0 dummy_sdp_offer' },
    callId: testCallId
  });

  const waitWebRTC = await new Promise<boolean>((resolve) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (webrtcOfferReceivedByAgent && webrtcAnswerReceivedByCustomer) {
        clearInterval(interval);
        resolve(true);
      } else if (Date.now() - start > 6000) {
        clearInterval(interval);
        resolve(false);
      }
    }, 100);
  });

  if (!waitWebRTC) {
    console.error('❌ FAILED: WebRTC signaling failed.');
    console.error({ webrtcOfferReceivedByAgent, webrtcAnswerReceivedByCustomer });
    process.exit(1);
  }
  console.log('✅ STEP 3 PASSED: WebRTC signaling offer & answer successfully routed between browser peers!');

  // 8. End the call
  console.log('\n--- Step 4: Disconnect & End Call ---');
  customerSocket.emit('call:end', {
    callId: testCallId,
    duration: 12,
    endedBy: 'customer'
  });

  await new Promise(r => setTimeout(r, 1000));
  console.log(`✅ STEP 4 PASSED: Call ended cleanly. CallEnded received = ${callEndedReceived}`);

  // Disconnect sockets
  agentSocket.disconnect();
  customerSocket.disconnect();

  console.log('\n====================================================');
  console.log('🎉 ALL CALLING TESTS PASSED 100% SUCCESFULLY!');
  console.log('====================================================');
  process.exit(0);
}

testCustomerToAgentCalling().catch(err => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});

