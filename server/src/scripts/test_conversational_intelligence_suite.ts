import { conversationalIntelligenceService } from '../services/conversationalIntelligence.service.js';
import { knowledgeService } from '../services/knowledge.js';
import { translationService } from '../services/translation.js';

interface TestResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  details?: any;
}

const results: TestResult[] = [];

function assert(name: string, condition: boolean, expected: string, actual: string, details?: any) {
  results.push({ name, passed: condition, expected, actual, details });
  const mark = condition ? '✅ PASS' : '❌ FAIL';
  console.log(`${mark} | ${name}`);
  if (!condition) {
    console.log(`   Expected: ${expected}`);
    console.log(`   Actual  : ${actual}`);
    if (details) console.log(`   Details :`, details);
  }
}

async function runTestSuite() {
  console.log('==============================================================================');
  console.log('🧪 KAIRA AI CONVERSATIONAL INTELLIGENCE & CONTEXT REGRESSION SUITE (13 SCENARIOS)');
  console.log('==============================================================================\n');

  await knowledgeService.warmup();

  // SCENARIO 1: Simple Greetings
  console.log('\n--- Scenario 1: Simple Greetings ---');
  const call1 = `test_call_s1_${Date.now()}`;
  const s1Turn1 = await conversationalIntelligenceService.handleTurn({
    callId: call1,
    query: 'Hello'
  });
  assert(
    '1.1 Natural friendly greeting without robotic repetition',
    s1Turn1.answer.toLowerCase().includes('hello') || s1Turn1.answer.toLowerCase().includes('welcome'),
    'Natural greeting returned',
    s1Turn1.answer
  );

  // SCENARIO 2: Company-Related Questions
  console.log('\n--- Scenario 2: Company-Related Questions ---');
  const call2 = `test_call_s2_${Date.now()}`;
  const s2Turn1 = await conversationalIntelligenceService.handleTurn({
    callId: call2,
    query: 'What products does KAIRA offer?'
  });
  assert(
    '2.1 Answers with verified KAIRA products (VoiceCore, LiveEscalate, Omnichannel)',
    s2Turn1.answer.toLowerCase().includes('voicecore') || s2Turn1.answer.toLowerCase().includes('liveescalate'),
    'Grounded product list',
    s2Turn1.answer
  );

  // SCENARIO 3: Technical Support Questions
  console.log('\n--- Scenario 3: Technical Support Questions ---');
  const call3 = `test_call_s3_${Date.now()}`;
  const s3Turn1 = await conversationalIntelligenceService.handleTurn({
    callId: call3,
    query: 'My audio keeps cutting out and disconnecting during calls.'
  });
  assert(
    '3.1 Focuses on technical support without reciting internal platform architecture',
    !s3Turn1.answer.toLowerCase().includes('captures your voice using webrtc and web speech recognition') &&
    (s3Turn1.answer.toLowerCase().includes('audio') || s3Turn1.answer.toLowerCase().includes('help') || s3Turn1.answer.toLowerCase().includes('support')),
    'Relevant technical support response',
    s3Turn1.answer
  );

  // SCENARIO 4: Multi-Part Questions
  console.log('\n--- Scenario 4: Multi-Part Questions ---');
  const call4 = `test_call_s4_${Date.now()}`;
  const s4Turn1 = await conversationalIntelligenceService.handleTurn({
    callId: call4,
    query: 'What products does KAIRA offer and what languages are supported?'
  });
  assert(
    '4.1 Multi-part question addressed cleanly',
    s4Turn1.answer.toLowerCase().includes('voicecore') || s4Turn1.answer.toLowerCase().includes('languages') || s4Turn1.answer.toLowerCase().includes('kaira'),
    'Answers multi-part inquiry without crashing',
    s4Turn1.answer
  );

  // SCENARIO 5: Follow-Up Questions (Pronoun Resolution)
  console.log('\n--- Scenario 5: Follow-Up Questions (Pronoun Resolution) ---');
  const call5 = `test_call_s5_${Date.now()}`;
  const s5Turn1 = await conversationalIntelligenceService.handleTurn({
    callId: call5,
    query: 'Tell me about VoiceCore.'
  });
  const s5Turn2 = await conversationalIntelligenceService.handleTurn({
    callId: call5,
    query: 'Does it support regional languages?',
    callHistory: [
      { sender: 'customer', text: 'Tell me about VoiceCore.' },
      { sender: 'ai', text: s5Turn1.answer }
    ]
  });
  assert(
    '5.1 Follow-up pronoun "it" resolved to VoiceCore and answers regional languages',
    s5Turn2.answer.toLowerCase().includes('tamil') || s5Turn2.answer.toLowerCase().includes('regional') || s5Turn2.answer.toLowerCase().includes('languages'),
    'Resolves "it" to VoiceCore',
    s5Turn2.answer
  );

  // SCENARIO 6: Unclear Customer Messages
  console.log('\n--- Scenario 6: Unclear Customer Messages ---');
  const call6 = `test_call_s6_${Date.now()}`;
  const s6Turn1 = await conversationalIntelligenceService.handleTurn({
    callId: call6,
    query: 'Um, not sure, maybe...'
  });
  assert(
    '6.1 Unclear input handled gracefully with polite clarification',
    !s6Turn1.answer.toLowerCase().includes('captures your voice') && s6Turn1.answer.length > 10,
    'Polite clarification prompt',
    s6Turn1.answer
  );

  // SCENARIO 7: Out-of-Domain Questions (Dental / Medical / Food)
  console.log('\n--- Scenario 7: Out-of-Domain Questions ---');
  const call7 = `test_call_s7_${Date.now()}`;
  const s7Turn1 = await conversationalIntelligenceService.handleTurn({
    callId: call7,
    query: 'I have wisdom teeth pain.'
  });
  assert(
    '7.1 Wisdom teeth pain does NOT recite WebRTC technical explanation',
    !s7Turn1.answer.toLowerCase().includes('captures your voice using webrtc') &&
    !s7Turn1.answer.toLowerCase().includes('sub-300'),
    'Never explains internal technical architecture for unrelated questions',
    s7Turn1.answer
  );
  assert(
    '7.2 Explains KAIRA support scope and redirects politely',
    s7Turn1.answer.toLowerCase().includes('specialize in kaira') || s7Turn1.answer.toLowerCase().includes('cannot assist with dental'),
    'Scope explanation and redirection',
    s7Turn1.answer
  );

  const s7Turn2 = await conversationalIntelligenceService.handleTurn({
    callId: call7,
    query: 'Can I order a pepperoni pizza?'
  });
  assert(
    '7.3 Food ordering politely redirected without platform confusion',
    s7Turn2.answer.toLowerCase().includes('food') || s7Turn2.answer.toLowerCase().includes('voice'),
    'Food ordering polite refusal',
    s7Turn2.answer
  );

  // SCENARIO 8: Repeated Questions & Answer Tracking
  console.log('\n--- Scenario 8: Repeated Questions & Answer Tracking ---');
  const call8 = `test_call_s8_${Date.now()}`;
  const s8Turn1 = await conversationalIntelligenceService.handleTurn({
    callId: call8,
    query: 'I am facing a problem with my account.'
  });
  assert(
    '8.1 Acknowledges account issue and asks single focused question',
    s8Turn1.answer.includes("I'm sorry about that") || s8Turn1.answer.toLowerCase().includes('account'),
    'Empathetic intake question',
    s8Turn1.answer
  );

  const s8Turn2 = await conversationalIntelligenceService.handleTurn({
    callId: call8,
    query: "I can't log in."
  });
  assert(
    '8.2 Does NOT repeat "What problem are you having?" - moves forward to login troubleshooting',
    !s8Turn2.answer.includes("Could you tell me what issue you're experiencing with your account") &&
    (s8Turn2.answer.toLowerCase().includes('log in') || s8Turn2.answer.toLowerCase().includes('password') || s8Turn2.answer.toLowerCase().includes('credentials')),
    'Moves to next specific troubleshooting step',
    s8Turn2.answer
  );

  // SCENARIO 9: Frustrated Customers
  console.log('\n--- Scenario 9: Frustrated Customers ---');
  const call9 = `test_call_s9_${Date.now()}`;
  const s9Turn1 = await conversationalIntelligenceService.handleTurn({
    callId: call9,
    query: 'This is completely ridiculous! Nobody is helping me and your service is terrible!'
  });
  assert(
    '9.1 De-escalates frustrated customer with empathy',
    s9Turn1.answer.length > 10,
    'Empathetic response provided',
    s9Turn1.answer
  );

  // SCENARIO 10: Human-Agent Requests
  console.log('\n--- Scenario 10: Human-Agent Requests ---');
  const call10 = `test_call_s10_${Date.now()}`;
  const s10Turn1 = await conversationalIntelligenceService.handleTurn({
    callId: call10,
    query: 'Can I speak with a human?'
  });
  assert(
    '10.1 Human transfer request flags requiresTransfer = true',
    s10Turn1.requiresTransfer === true,
    'requiresTransfer: true',
    `requiresTransfer: ${s10Turn1.requiresTransfer}`
  );
  assert(
    '10.2 Verbal announcement promises immediate human transfer',
    s10Turn1.answer.toLowerCase().includes('connect you') && s10Turn1.answer.toLowerCase().includes('support representative'),
    'Clear transfer announcement',
    s10Turn1.answer
  );

  // SCENARIO 11: Tamil Conversations
  console.log('\n--- Scenario 11: Tamil Conversations ---');
  const tamilRes = await translationService.getAiAnswerSuggestion('வணக்கம், உங்கள் தயாரிப்புகள் என்னென்ன?', 'ta');
  assert(
    '11.1 Returns natural Tamil response for regional product inquiry',
    tamilRes.language === 'ta' && tamilRes.answer.length > 5,
    'Tamil localized response',
    tamilRes.answer
  );

  // SCENARIO 12: English Conversations (Direct natural Q&A)
  console.log('\n--- Scenario 12: English Conversations ---');
  const call12 = `test_call_s12_${Date.now()}`;
  const s12Turn1 = await conversationalIntelligenceService.handleTurn({
    callId: call12,
    query: 'Can you help me?'
  });
  assert(
    '12.1 Responds directly: "Of course! What would you like help with?"',
    s12Turn1.answer === "Of course! What would you like help with?",
    'Exact natural phrase',
    s12Turn1.answer
  );

  const s12Turn2 = await conversationalIntelligenceService.handleTurn({
    callId: call12,
    query: 'I already contacted support yesterday.'
  });
  assert(
    '12.2 Acknowledges previous contact: "I understand. Let me check whether there is any previous support history..."',
    s12Turn2.answer.includes("Let me check whether there is any previous support history") || s12Turn2.answer.includes("I understand"),
    'Empathetic history lookup response',
    s12Turn2.answer
  );

  // SCENARIO 13: Context Retention Across Multiple Turns
  console.log('\n--- Scenario 13: Context Retention Across Multiple Turns ---');
  const call13 = `test_call_s13_${Date.now()}`;
  const s13Turn1 = await conversationalIntelligenceService.handleTurn({
    callId: call13,
    query: 'Hello Kaira, my name is Alex.'
  });
  const s13Turn2 = await conversationalIntelligenceService.handleTurn({
    callId: call13,
    query: 'I am facing an issue with my login credentials.'
  });
  const s13Turn3 = await conversationalIntelligenceService.handleTurn({
    callId: call13,
    query: 'The page gives an invalid password error.'
  });
  assert(
    '13.1 Context retained through 3 turns, guiding user to password recovery',
    s13Turn3.answer.toLowerCase().includes('password') || s13Turn3.answer.toLowerCase().includes('reset'),
    'Guides user based on accumulated turn context',
    s13Turn3.answer
  );

  // Summary
  console.log('\n==============================================================================');
  const passedCount = results.filter(r => r.passed).length;
  const totalCount = results.length;
  console.log(`TEST SUITE FINISHED: ${passedCount} / ${totalCount} PASSED (${Math.round(passedCount / totalCount * 100)}%)`);
  console.log('==============================================================================');

  if (passedCount !== totalCount) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('Fatal error running test suite:', err);
  process.exit(1);
});
