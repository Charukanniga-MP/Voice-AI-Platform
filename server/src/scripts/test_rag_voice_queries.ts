import { knowledgeService } from '../services/knowledge.js';
import { prisma } from '../db.js';

async function run() {
  const queries = [
    'Hi, I want to know your services.',
    'What are your working hours?',
    'When do you open?',
    'Can I contact you in the evening?'
  ];

  for (const q of queries) {
    console.log(`\n======================================================`);
    console.log(`QUERY: "${q}"`);
    const res = await knowledgeService.answerQuery(q);
    console.log(`ANSWER: ${res.answer}`);
    console.log(`GROUNDED: ${res.isGrounded}`);
    console.log(`REQUIRES_TRANSFER: ${res.requiresTransfer}`);
    console.log(`SOURCES COUNT: ${res.sources.length}`);
    if (res.sources.length > 0) {
      console.log(`TOP SOURCE: ${res.sources[0].title} (Page ${res.sources[0].pageNumber || 'N/A'})`);
      console.log(`SNIPPET: ${res.sources[0].snippet || 'N/A'}`);
    }
  }

  await prisma.$disconnect();
}

run().catch(console.error);
