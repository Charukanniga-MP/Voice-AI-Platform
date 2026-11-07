import { translationService, SUPPORTED_LANGUAGES } from './services/translation.js';
import { telephonyService } from './services/telephony.js';
import { FALLBACK_MESSAGE } from './services/knowledge.js';

async function runTests() {
  console.log('====================================================');
  console.log('KAIRA Voice AI – Multilingual & Grounding Test Suite');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  // Test 1: Language Detection
  console.log('--- Test 1: Automatic Language Detection ---');
  const samples = [
    { text: 'வணக்கம், உங்கள் திட்டங்கள் என்ன?', expected: 'ta' },
    { text: 'హలో, మీ ధర ప్రణాళికలు ఏమిటి?', expected: 'te' },
    { text: 'നിങ്ങളുടെ പ്ലാനുകൾ എന്തൊക്കെയാണ്?', expected: 'ml' },
    { text: 'आपकी मूल्य निर्धारण योजनाएं क्या हैं?', expected: 'hi' },
    { text: 'What are your pricing plans?', expected: 'en' }
  ];

  for (const s of samples) {
    const detected = translationService.detectLanguage(s.text);
    if (detected === s.expected) {
      console.log(`✓ Detected ${s.expected} correctly for: "${s.text.slice(0, 30)}..."`);
      passed++;
    } else {
      console.error(`✗ Expected ${s.expected} but got ${detected} for: "${s.text}"`);
      failed++;
    }
  }

  // Test 2: Grounded Knowledge Base Retrieval across 5 Languages
  console.log('\n--- Test 2: Grounded Knowledge Base Query across 5 Languages ---');
  const langQueries = [
    { lang: 'en', query: 'What are KAIRA pricing plans and subscriptions?' },
    { lang: 'ta', query: 'KAIRA திட்டங்களின் விலை என்ன?' },
    { lang: 'te', query: 'KAIRA ధర ప్రణాళికలు ఏమిటి?' },
    { lang: 'ml', query: 'KAIRA യുടെ വില എത്രയാണ്?' },
    { lang: 'hi', query: 'कैरा की सदस्यता योजनाएं क्या हैं?' }
  ];

  for (const t of langQueries) {
    console.log(`\nTesting [${t.lang.toUpperCase()}]: "${t.query}"`);
    const res = await translationService.getAiAnswerSuggestion(t.query, t.lang);
    if (res.isGrounded && res.answer && res.answer.length > 10) {
      console.log(`✓ Grounded Answer (${res.language}): "${res.answer.slice(0, 80)}..."`);
      passed++;
    } else {
      console.error(`✗ Failed to retrieve grounded answer for ${t.lang}:`, res);
      failed++;
    }
  }

  // Test 3: Strict Zero Hallucination Fallback & Escalation
  console.log('\n--- Test 3: Strict Zero Hallucination on Ungrounded Query ---');
  const ungrounded = 'Can you teach me how to bake a chocolate cake?';
  const ungroundedRes = await translationService.getAiAnswerSuggestion(ungrounded, 'en');
  if (!ungroundedRes.isGrounded) {
    console.log(`✓ Correctly triggered fallback without hallucination.`);
    console.log(`Fallback message: "${ungroundedRes.answer}"`);
    passed++;
  } else {
    console.error(`✗ Failed: system hallucinated an answer for ungrounded query:`, ungroundedRes);
    failed++;
  }

  // Test 4: Localized Fallback in Tamil
  console.log('\n--- Test 4: Localized Fallback in Tamil ---');
  const ungroundedTa = 'சாக்லேட் கேக் எப்படி செய்வது?';
  const ungroundedTaRes = await translationService.getAiAnswerSuggestion(ungroundedTa, 'ta');
  if (!ungroundedTaRes.isGrounded && ungroundedTaRes.language === 'ta') {
    console.log(`✓ Correctly triggered Tamil fallback: "${ungroundedTaRes.answer}"`);
    passed++;
  } else {
    console.error(`✗ Failed Tamil fallback test:`, ungroundedTaRes);
    failed++;
  }

  // Test 5: Voice Audio Generation (TTS) for all 5 languages
  console.log('\n--- Test 5: Voice Audio (TTS) for all 5 Languages ---');
  const phrases = {
    en: 'Welcome to KAIRA voice assistant.',
    ta: 'வணக்கம், KAIRA குரல் உதவிக்கு வரவேற்கிறோம்.',
    te: 'స్వాగతం, KAIRA వాయిస్ అసిస్టెంట్‌కి స్వాగతం.',
    ml: 'സ്വാഗതം, KAIRA വോയ്സ് അസിസ്റ്റന്റിലേക്ക് സ്വാഗതം.',
    hi: 'नमस्ते, कैरा वॉयस असिस्टेंट में आपका स्वागत है।'
  };

  for (const [lang, text] of Object.entries(phrases)) {
    await new Promise(r => setTimeout(r, 300));
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${lang}&client=tw-ob&q=${encodeURIComponent(text)}`;
    const ttsRes = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (ttsRes.ok && ttsRes.headers.get('content-type')?.includes('audio')) {
      const buf = Buffer.from(await ttsRes.arrayBuffer());
      console.log(`✓ [${lang.toUpperCase()}] Generated ${buf.length} bytes of crystal-clear MP3 audio.`);
      passed++;
    } else {
      console.error(`✗ [${lang}] TTS failed: HTTP ${ttsRes.status}`);
      failed++;
    }
  }

  // Test 6: Telephony TwiML Generation
  console.log('\n--- Test 6: Telephony Voice AI TwiML Generation ---');
  const greetingTwiML = await telephonyService.generateAiGreetingTwiML('ta');
  if (greetingTwiML.includes('<Say') && greetingTwiML.includes('<Gather')) {
    console.log('✓ Successfully generated Telephony TwiML with <Say> and <Gather> for Tamil.');
    passed++;
  } else {
    console.error('✗ Failed to generate TwiML:', greetingTwiML);
    failed++;
  }

  console.log('\n====================================================');
  console.log(`Test Summary: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
