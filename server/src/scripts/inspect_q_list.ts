import { prisma } from '../db.js';

async function listAllQuestions() {
  const entries = await prisma.knowledgeEntry.findMany({
    orderBy: { pageNumber: 'asc' },
    select: { question: true, pageNumber: true }
  });
  for (const e of entries) {
    if (e.question) {
      console.log(`P${e.pageNumber}: ${e.question}`);
    }
  }
}

listAllQuestions().finally(() => prisma.$disconnect());
