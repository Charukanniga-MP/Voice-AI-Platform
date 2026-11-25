import { knowledgeService } from '../services/knowledge.js';
import { prisma } from '../db.js';

async function main() {
  const testQueries = [
    "What is KAIRA?",
    "Can you explain your platform?",
    "What problem does KAIRA solve?",
    "What are the main features?",
    "What technologies are used?",
    "Why are these technologies used?",
    "How does the AI voice assistant work?",
    "How does speech recognition work?",
    "How does the Knowledge Base work?",
    "How does human-agent handover work?",
    "What languages are supported?",
    "What is the customer workflow?",
    "What is the agent workflow?",
    "What is the admin workflow?",
    "What security features are implemented?",
    "What are the current limitations?"
  ];

  console.log('Testing Platform Questions Retrieval:');
  for (const q of testQueries) {
    const res = await knowledgeService.answerQuery(q);
    console.log(`\nQ: "${q}"`);
    console.log(`Grounded: ${res.isGrounded}, TopSource: ${res.sources[0]?.title || 'None'}`);
    console.log(`A: ${res.answer}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
