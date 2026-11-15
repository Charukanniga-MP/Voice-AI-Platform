import { io as Client } from 'socket.io-client';
import { translationService, SUPPORTED_LANGUAGES } from './services/translation.js';
import { prisma } from './db.js';

async function runSingleVoiceMultilingualTests() {
  console.log('====================================================');
  console.log('🧪 TESTING SINGLE-VOICE & UNIVERSAL MULTILINGUAL SUPPORT');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string) {
    if (condition) {
      console.log(`  ✓ PASS: ${name}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${name}`);
      failed++;
    }
  }

  // TEST 1: Universal 21-Language Detection & Script Parsing
  console.log('--- 1. Universal 21-Language Detection Verification ---');
  const languageSamples = [
    { text: 'வணக்கம், உங்கள் கட்டண விவரங்கள் என்ன?', expected: 'ta', name: 'Tamil' },
    { text: 'హలో, మీ ధర ప్రణాళికలు ఏమిటి?', expected: 'te', name: 'Telugu' },
    { text: 'നിങ്ങളുടെ സേവനങ്ങളുടെ നിരക്കുകൾ എന്തൊക്കെയാണ്?', expected: 'ml', name: 'Malayalam' },
    { text: 'ನಿಮ್ಮ ಚಂದಾದಾರಿಕೆ ಯೋಜನೆಗಳ ಬೆಲೆ ಎಷ್ಟು?', expected: 'kn', name: 'Kannada' },
    { text: 'আপনার মূল্য নির্ধারণের পরিকল্পনা কী কী?', expected: 'bn', name: 'Bengali' },
    { text: 'आपकी मूल्य निर्धारण योजनाएं क्या हैं?', expected: 'hi', name: 'Hindi' },
    { text: 'तुमचे दर आणि प्लॅन्स काय आहेत?', expected: 'mr', name: 'Marathi' },
    { text: 'مرحبا، ما هي خطط الأسعار والخدمات؟', expected: 'ar', name: 'Arabic' },
    { text: '你好，请问你们的价格方案是什么？', expected: 'zh', name: 'Chinese' },
    { text: 'こんにちは、料金プランについて教えてください。', expected: 'ja', name: 'Japanese' },
    { text: '안녕하세요, 요금제는 어떻게 되나요?', expected: 'ko', name: 'Korean' },
    { text: 'Здравствуйте, какие у вас тарифные планы?', expected: 'ru', name: 'Russian' },
    { text: 'Bonjour, quels sont vos forfaits et tarifs?', expected: 'fr', name: 'French' },
    { text: 'Hola, ¿cuáles son los planes de precios disponibles?', expected: 'es', name: 'Spanish' },
    { text: 'Hallo, was sind Ihre Preispläne und Abonnements?', expected: 'de', name: 'German' },
    { text: 'Ciao, quali sono i vostri piani tariffari?', expected: 'it', name: 'Italian' },
    { text: 'Olá, quais são os seus planos de preços?', expected: 'pt', name: 'Portuguese' },
    { text: 'Merhaba, fiyatlandırma planlarınız nelerdir?', expected: 'tr', name: 'Turkish' },
    { text: 'Halo, apa saja paket harga yang tersedia?', expected: 'id', name: 'Indonesian' },
    { text: 'Xin chào, các gói giá của bạn như thế nào?', expected: 'vi', name: 'Vietnamese' },
    { text: 'What are your enterprise subscription pricing plans?', expected: 'en', name: 'English' }
  ];

  for (const sample of languageSamples) {
    const detected = translationService.detectLanguage(sample.text);
    assert(detected === sample.expected, `Detected ${sample.name} [${sample.expected}] correctly`);
  }

  // TEST 2: Supported Languages List Completeness
  console.log('\n--- 2. Supported Languages Catalog Completeness ---');
  assert(Object.keys(SUPPORTED_LANGUAGES).length >= 21, `At least 21 languages supported (Found ${Object.keys(SUPPORTED_LANGUAGES).length})`);
  const requiredCodes = ['en', 'ta', 'te', 'ml', 'kn', 'hi', 'bn', 'mr', 'ar', 'zh', 'ja', 'ko', 'ru', 'fr', 'es', 'de', 'it', 'pt', 'tr', 'id', 'vi'];
  const allCodesPresent = requiredCodes.every(c => c in SUPPORTED_LANGUAGES);
  assert(allCodesPresent, 'All 21 requested global & regional language codes present in catalog');

  // TEST 3: Pre-cached Greetings across Languages
  console.log('\n--- 3. Pre-cached High-Performance Greetings Verification ---');
  for (const code of ['en', 'ta', 'te', 'hi', 'ml', 'kn', 'fr', 'es', 'de', 'ar', 'zh', 'ja']) {
    const greeting = await translationService.translateText(
      "Hello! Welcome to KAIRA TECHNOLOGY Customer Support. Thank you for calling us. I'm your AI support assistant. How may I help you today?",
      code,
      'en'
    );
    assert(Boolean(greeting && greeting.length > 10), `Greeting for [${code}] generated/cached: "${greeting.slice(0, 40)}..."`);
  }

  // TEST 4: Single-Voice Backend Socket Deduplication & Locking
  console.log('\n--- 4. Backend Single-Voice Socket Handshake & Deduplication Shield ---');
  const socket = Client('http://localhost:5000', {
    transports: ['websocket'],
    reconnection: false
  });

  const testCallId = `test_single_voice_${Date.now()}`;
  let readyResponseId = '';
  let aiResponseCount = 0;
  let receivedResponseIds: string[] = [];
  let isInterruptedReceived = false;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Socket tests timed out after 15s'));
    }, 15000);

    socket.on('connect', () => {
      console.log('  ✓ Connected to backend WebSocket server');

      // 4A. Call ready check
      socket.on('call:ready', (data: any) => {
        assert(data.callId === testCallId, 'call:ready returned matching callId');
        assert(typeof data.responseId === 'string' && data.responseId.length > 5, `call:ready provides unique responseId: ${data.responseId}`);
        readyResponseId = data.responseId;

        // 4B. Send initial query
        const clientMsgId = `cmsg_${Date.now()}_1`;
        socket.emit('call:query', {
          callId: testCallId,
          query: 'What are your pricing plans?',
          customerId: 'test_cust_1',
          duration: 5,
          language: 'en',
          clientMessageId: clientMsgId,
          clientSentAt: Date.now()
        });

        // 4C. Immediately send identical query to simulate duplicate VAD / double-trigger
        socket.emit('call:query', {
          callId: testCallId,
          query: 'What are your pricing plans?',
          customerId: 'test_cust_1',
          duration: 5,
          language: 'en',
          clientMessageId: clientMsgId,
          clientSentAt: Date.now()
        });
      });

      // 4D. Listen for AI responses
      socket.on('call:ai_response', (data: any) => {
        aiResponseCount++;
        receivedResponseIds.push(data.responseId);
        assert(typeof data.responseId === 'string' && data.responseId.length > 5, `call:ai_response carries unique responseId: ${data.responseId}`);

        // Trigger Barge-In / Interruption
        socket.emit('call:interrupt', { callId: testCallId });
      });

      // 4E. Listen for barge-in broadcast
      socket.on('call:interrupted', (data: any) => {
        assert(data.callId === testCallId, 'call:interrupted broadcasted for callId');
        isInterruptedReceived = true;

        // End the call
        socket.emit('call:end', {
          callId: testCallId,
          duration: 10,
          endedBy: 'customer'
        });
      });

      // 4F. Call ended
      socket.on('call:ended', (data: any) => {
        assert(data.callId === testCallId, 'call:ended broadcasted successfully');
        clearTimeout(timer);
        resolve();
      });

      // Start call
      socket.emit('call:start', {
        callId: testCallId,
        customerId: 'test_cust_1',
        customerName: 'Test Customer',
        customerEmail: 'test@example.com',
        customerPhone: '+1234567890',
        language: 'en'
      });
    });

    socket.on('connect_error', (err) => {
      reject(err);
    });
  });

  // Check that duplicate query was suppressed (only 1 AI response emitted)
  assert(aiResponseCount === 1, `Zero duplicate responses generated: received exactly 1 response (count=${aiResponseCount})`);
  assert(isInterruptedReceived, 'Barge-in interruption successfully handled');

  // Verify call record persisted in database
  const callRecord = await prisma.callRecord.findUnique({
    where: { callId: testCallId }
  });
  assert(callRecord !== null, 'Call record safely written in database');
  assert(callRecord?.status === 'completed', 'Call record status marked completed');

  socket.disconnect();

  console.log('\n====================================================');
  console.log(`RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runSingleVoiceMultilingualTests().catch(err => {
  console.error('Test suite failed with unexpected error:', err);
  process.exit(1);
});
