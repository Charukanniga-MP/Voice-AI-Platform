import { knowledgeService, FALLBACK_MESSAGE } from './services/knowledge.js';
import { translationService } from './services/translation.js';
import { prisma } from './db.js';

let passed = 0;
let total = 0;

function assert(desc: string, cond: boolean) {
  total++;
  if (cond) {
    passed++;
    console.log(`  ✓ ${desc}`);
  } else {
    console.error(`  ✗ FAIL: ${desc}`);
  }
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🤖 AI Grounding, Fallback & Zero-Hallucination Test Suite');
  console.log('======================================================\n');

  // Verify KB has entries
  const entriesCount = await prisma.knowledgeEntry.count();
  console.log(`[Setup] Knowledge Base entries in DB: ${entriesCount}`);
  assert('Knowledge base has loaded entries', entriesCount > 0);

  // 1. Test conversational pleasantry
  console.log('\n--- Test 1: Conversational Pleasantries ---');
  const greeting = await knowledgeService.answerQuery('Hello');
  assert('Greeting is grounded and friendly', greeting.isGrounded && greeting.answer.includes('Welcome to KAIRA'));
  assert('Greeting does not require escalation', !greeting.requiresTransfer);

  // 2. Test verified in-domain KB query (English)
  console.log('\n--- Test 2: Verified In-Domain Knowledge Queries ---');
  const kbPricing = await knowledgeService.answerQuery('What pricing plans do you offer?');
  console.log(`   Query: "What pricing plans do you offer?"`);
  console.log(`   Answer: "${kbPricing.answer.slice(0, 100)}..."`);
  assert('In-domain query returns grounded response', kbPricing.isGrounded);
  assert('Sources are cited for verified answer', kbPricing.sources.length > 0);
  assert('Verified query does not require admin transfer', !kbPricing.requiresTransfer);

  // 3. Test completely out-of-domain query (Chocolate cake / Capital of France)
  console.log('\n--- Test 3: Out-of-Domain Zero-Hallucination Query ---');
  const outOfDomain = await knowledgeService.answerQuery('How do I bake a chocolate cake at home?');
  console.log(`   Query: "How do I bake a chocolate cake at home?"`);
  console.log(`   Answer: "${outOfDomain.answer}"`);
  assert('Out-of-domain query is NOT grounded', !outOfDomain.isGrounded);
  assert('Out-of-domain query triggers admin transfer', outOfDomain.requiresTransfer);
  assert('Out-of-domain returns strict fallback message', outOfDomain.answer === FALLBACK_MESSAGE);
  assert('Out-of-domain sources array is empty', outOfDomain.sources.length === 0);

  // 4. Test predatory / adversarial discount query
  console.log('\n--- Test 4: Adversarial Unsupported Query ---');
  const discountQuery = await knowledgeService.answerQuery('Can you give me a secret 90% discount right now?');
  console.log(`   Query: "Can you give me a secret 90% discount right now?"`);
  console.log(`   Answer: "${discountQuery.answer}"`);
  assert('Unsupported discount query is NOT grounded', !discountQuery.isGrounded);
  assert('Unsupported discount query requires transfer', discountQuery.requiresTransfer);
  assert('Adversarial query does not hallucinate fake discounts', discountQuery.answer === FALLBACK_MESSAGE);

  // 5. Test Multilingual Grounded Queries
  console.log('\n--- Test 5: Multilingual Grounded Queries (Tamil, Telugu, Malayalam, Hindi) ---');
  const multiGrounded = [
    { lang: 'ta', name: 'Tamil', query: 'உங்கள் சேவைகள் என்ன?' }, // What are your services?
    { lang: 'te', name: 'Telugu', query: 'మీరు ఏ సేవలను అందిస్తారు?' },
    { lang: 'ml', name: 'Malayalam', query: 'നിങ്ങളുടെ സേവനങ്ങൾ എന്തൊക്കെയാണ്?' },
    { lang: 'hi', name: 'Hindi', query: 'आपकी सेवाएं क्या हैं?' }
  ];

  for (const item of multiGrounded) {
    const res = await translationService.getAiAnswerSuggestion(item.query, item.lang);
    console.log(`   [${item.name}] Q: "${item.query}" -> A: "${res.answer?.slice(0, 70)}..."`);
    assert(`${item.name} in-domain query returns valid answer`, !!res.answer && res.answer.length > 5);
    assert(`${item.name} query returns grounded status`, res.isGrounded);
  }

  // 6. Test Multilingual Out-of-Domain / Unsupported Queries
  console.log('\n--- Test 6: Multilingual Out-of-Domain Queries (Fallback Verification) ---');
  const multiUnsupported = [
    { lang: 'ta', name: 'Tamil', query: 'சாக்லேட் கேக் எப்படி செய்வது?' }, // How to make chocolate cake?
    { lang: 'hi', name: 'Hindi', query: 'मुझे 95% डिस्काउंट चाहिए' } // I want 95% discount
  ];

  for (const item of multiUnsupported) {
    const res = await translationService.getAiAnswerSuggestion(item.query, item.lang);
    console.log(`   [${item.name} Unsupported] Q: "${item.query}" -> A: "${res.answer}"`);
    assert(`${item.name} unsupported query marked NOT grounded`, !res.isGrounded);
    assert(`${item.name} unsupported query has no sources`, res.sources.length === 0);
    assert(`${item.name} unsupported query returned non-empty fallback`, !!res.answer && res.answer.length > 5);
  }

  console.log(`\n======================================================`);
  console.log(`Results: ${passed} / ${total} tests passed (${Math.round((passed / total) * 100)}%)`);
  console.log(`======================================================\n`);

  process.exit(passed === total ? 0 : 1);
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
