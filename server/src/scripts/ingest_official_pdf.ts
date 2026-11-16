import path from 'path';
import fs from 'fs';
import { prisma } from '../db.js';
import { processUploadedDocument } from '../services/documentProcessor.js';

async function ingestOfficialPDF() {
  console.log('====================================================');
  console.log('📄 INGESTING OFFICIAL KAIRA 100 FAQ KNOWLEDGE BASE PDF');
  console.log('====================================================\n');

  const pdfPath = path.join(process.cwd(), 'server', 'data', 'KAIRA_Voice_AI_Platform_100_FAQ.pdf');
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF not found at ${pdfPath}`);
  }

  const stat = fs.statSync(pdfPath);
  const fileName = 'KAIRA_Voice_AI_Platform_100_FAQ.pdf';
  const title = 'KAIRA Voice AI Platform - 100 Customer Questions & Answers';

  // Check if existing document already created
  let doc = await prisma.knowledgeDocument.findFirst({
    where: { fileName }
  });

  if (!doc) {
    doc = await prisma.knowledgeDocument.create({
      data: {
        title,
        fileName,
        fileType: 'application/pdf',
        fileSize: stat.size,
        status: 'processing',
        extractedText: ''
      }
    });
    console.log(`✓ Created KnowledgeDocument record: ${doc.id}`);
  } else {
    console.log(`✓ Re-processing existing KnowledgeDocument record: ${doc.id}`);
  }

  const result = await processUploadedDocument(doc.id, pdfPath, 'application/pdf', fileName);

  console.log('\n--- Ingestion Result ---');
  console.log(`Success: ${result.success}`);
  console.log(`Entry Count: ${result.entryCount}`);
  console.log(`File Hash: ${result.fileHash}`);
  console.log(`Is Duplicate: ${result.isDuplicate}`);

  const totalEntries = await prisma.knowledgeEntry.count({
    where: { documentId: doc.id }
  });
  console.log(`\nVerified Database KnowledgeEntry Count: ${totalEntries}`);

  const sampleEntries = await prisma.knowledgeEntry.findMany({
    where: { documentId: doc.id },
    take: 3,
    select: { id: true, title: true, section: true, pageNumber: true, question: true, answer: true }
  });
  console.log('\nSample Indexed Entries:');
  sampleEntries.forEach((e, idx) => {
    console.log(`[${idx + 1}] ${e.title} | Section: ${e.section} (Page ${e.pageNumber})`);
    console.log(`    Q: ${e.question}`);
    console.log(`    A: ${e.answer}\n`);
  });
}

ingestOfficialPDF().then(() => {
  console.log('✓ Official PDF Ingestion Complete!');
  process.exit(0);
}).catch(err => {
  console.error('✗ Ingestion error:', err);
  process.exit(1);
});
