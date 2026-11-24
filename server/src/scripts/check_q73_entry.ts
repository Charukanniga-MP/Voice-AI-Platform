import { prisma } from '../db.js';
import { knowledgeService } from '../services/knowledge.js';

async function check() {
  const query = "Can one customer access another customer private details?";
  const matches = await knowledgeService.search(query, 3);
  console.log(`Query: "${query}" -> Found ${matches.length} matches:`);
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    console.log(`Match ${i + 1}: Score=${m.score}, ID=${m.entry.id}`);
    console.log(`  Title: ${m.entry.title}`);
    console.log(`  Question: ${m.entry.question}`);
    console.log(`  Answer: ${m.entry.answer}`);
  }

  const ans = await knowledgeService.answerQuery(query);
  console.log('\nAnswer result:');
  console.log('Answer:', ans.answer);
  console.log('isGrounded:', ans.isGrounded);
  console.log('sources:', ans.sources);
}

check().finally(() => prisma.$disconnect());
