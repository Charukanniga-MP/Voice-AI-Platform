import { knowledgeService } from './services/knowledge.js';

async function test() {
  console.log('Testing Knowledge Base grounding...');

  const r1 = await knowledgeService.answerQuery('What are the subscription pricing plans for KAIRA?');
  console.log('\n--- Grounded Test (Pricing) ---');
  console.log('Answer:', r1.answer);
  console.log('isGrounded:', r1.isGrounded);
  console.log('requiresTransfer:', r1.requiresTransfer);

  const r2 = await knowledgeService.answerQuery('Can I order a pepperoni pizza with extra cheese?');
  console.log('\n--- Ungrounded Test (Pizza) ---');
  console.log('Answer:', r2.answer);
  console.log('isGrounded:', r2.isGrounded);
  console.log('requiresTransfer:', r2.requiresTransfer);

  process.exit(0);
}

test();
