import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import { prisma } from '../db.js';
import { calculateFileHash, processUploadedDocument } from '../services/documentProcessor.js';
import { knowledgeService } from '../services/knowledge.js';
import { translationService } from '../services/translation.js';

async function main() {
  console.log('================================================================');
  console.log('📄 KAIRA KNOWLEDGE BASE PDF INTEGRATION AUDIT');
  console.log('================================================================\n');

  // 1. Inspect original PDF
  const originalPdfPath = path.resolve(process.cwd(), 'server/data/KAIRA_100_Customer_Questions_and_Answers.pdf');
  console.log('Target PDF Path:', originalPdfPath);

  if (!fs.existsSync(originalPdfPath)) {
    throw new Error(`File does not exist at: ${originalPdfPath}`);
  }

  const pdfBuffer = fs.readFileSync(originalPdfPath);
  const pdfHash = calculateFileHash(pdfBuffer);
  console.log(`File Size: ${pdfBuffer.length} bytes`);
  console.log(`SHA-256 Hash: ${pdfHash}`);

  const parsedPdf = await pdfParse(pdfBuffer);
  console.log(`PDF Pages: ${parsedPdf.numpages}`);
  console.log(`Extracted Text Length: ${parsedPdf.text.length} characters`);
  console.log(`PDF Info:`, parsedPdf.info);

  // Check Q1 through Q100 in extracted text
  const missingQuestions: number[] = [];
  const foundQuestions: Array<{ num: number; question: string; answerSnippet: string }> = [];

  for (let i = 1; i <= 100; i++) {
    // Look for e.g. "1. " or "100. "
    const regex = new RegExp(`(?:^|\\n)\\s*${i}\\.\\s*([^\\n\\?]+\\?)\\s*\\n+([\\s\\S]*?)(?=(?:\\n\\s*\\d+\\.\\s*)|(?:\\n[A-Z]\\.\\s+)|$)`, 'i');
    const match = regex.exec(parsedPdf.text);
    if (match) {
      foundQuestions.push({
        num: i,
        question: match[1].trim(),
        answerSnippet: match[2].trim().replace(/\n+/g, ' ').slice(0, 100)
      });
    } else {
      missingQuestions.push(i);
    }
  }

  console.log(`\nVerified Questions Found in PDF: ${foundQuestions.length} / 100`);
  if (missingQuestions.length > 0) {
    console.warn(`Missing question numbers in regex scan: ${missingQuestions.join(', ')}`);
  } else {
    console.log('✅ ALL 100 QUESTIONS AND ANSWERS VERIFIED IN THE PDF TEXT!');
  }

  console.log('\nSample Questions extracted:');
  console.log(`Q1: ${foundQuestions[0]?.question} -> ${foundQuestions[0]?.answerSnippet}`);
  console.log(`Q50: ${foundQuestions[49]?.question} -> ${foundQuestions[49]?.answerSnippet}`);
  console.log(`Q97: ${foundQuestions[96]?.question} -> ${foundQuestions[96]?.answerSnippet}`);
  console.log(`Q98: ${foundQuestions[97]?.question} -> ${foundQuestions[97]?.answerSnippet}`);
  console.log(`Q99: ${foundQuestions[98]?.question} -> ${foundQuestions[98]?.answerSnippet}`);
  console.log(`Q100: ${foundQuestions[99]?.question} -> ${foundQuestions[99]?.answerSnippet}`);

  // 2. Database Inspection
  console.log('\n--- Checking Database State ---');
  const existingDocs = await prisma.knowledgeDocument.findMany({
    include: { _count: { select: { entries: true } } }
  });
  console.log(`Existing Documents in DB: ${existingDocs.length}`);
  for (const doc of existingDocs) {
    console.log(`- Doc ID: ${doc.id}`);
    console.log(`  Title: "${doc.title}"`);
    console.log(`  FileName: "${doc.fileName}"`);
    console.log(`  Status: ${doc.status}`);
    console.log(`  FileHash: ${doc.fileHash}`);
    console.log(`  Indexed Entries: ${doc._count.entries}`);
  }

  const pricingEntries = await prisma.knowledgeEntry.findMany({
    where: {
      OR: [
        { title: { contains: 'Subscription' } },
        { question: { contains: 'subscription' } },
        { title: { contains: 'Pricing' } },
        { question: { contains: 'pricing' } }
      ]
    },
    select: { id: true, title: true, question: true, answer: true, documentId: true }
  });
  console.log('\nPricing / Subscription entries in DB:', pricingEntries);

  // Check if KAIRA_100_Customer_Questions_and_Answers.pdf is the indexed document
  let primaryDoc = existingDocs.find(d => d.fileName === 'KAIRA_100_Customer_Questions_and_Answers.pdf' || d.fileHash === pdfHash);

  if (!primaryDoc || primaryDoc.fileHash !== pdfHash || primaryDoc._count.entries < 100) {
    console.log('\n--- Ingesting and Indexing original PDF into Database ---');
    // Create new document record or update existing
    let targetDocId = primaryDoc?.id;
    if (!targetDocId) {
      // Remove any old/stale starter documents with different hash if desired, or keep clean
      const oldDoc = await prisma.knowledgeDocument.findFirst({
        where: { fileName: 'KAIRA_100_Customer_Questions_and_Answers.pdf' }
      });
      if (oldDoc) {
        targetDocId = oldDoc.id;
      } else {
        const created = await prisma.knowledgeDocument.create({
          data: {
            title: 'KAIRA 100 Customer Questions and Answers',
            fileName: 'KAIRA_100_Customer_Questions_and_Answers.pdf',
            fileType: 'application/pdf',
            fileSize: pdfBuffer.length,
            fileHash: pdfHash,
            extractedText: parsedPdf.text.slice(0, 20000),
            status: 'processing'
          }
        });
        targetDocId = created.id;
      }
    }

    const ingestResult = await processUploadedDocument(
      targetDocId,
      originalPdfPath,
      'application/pdf',
      'KAIRA_100_Customer_Questions_and_Answers.pdf'
    );
    console.log('Ingestion Result:', ingestResult);
  } else {
    console.log('✅ Document is already indexed with full chunk count!');
  }

  // Verify Entries in DB
  const docInDb = await prisma.knowledgeDocument.findFirst({
    where: { fileName: 'KAIRA_100_Customer_Questions_and_Answers.pdf' },
    include: { entries: true }
  });

  if (docInDb) {
    console.log(`\nVerified Document in DB:`);
    console.log(`ID: ${docInDb.id}`);
    console.log(`Title: ${docInDb.title}`);
    console.log(`Status: ${docInDb.status}`);
    console.log(`Total Entries Count: ${docInDb.entries.length}`);

    // Check page numbers distribution
    const pageCounts: Record<number, number> = {};
    for (const e of docInDb.entries) {
      const p = e.pageNumber || 0;
      pageCounts[p] = (pageCounts[p] || 0) + 1;
    }
    console.log('Entries per page in DB:', pageCounts);
  }

  // 3. Live Knowledge Retrieval & Grounding Tests
  console.log('\n--- Testing Live Knowledge Retrieval ---');

  // Test 1: Explicit question present in PDF
  const testQ1 = 'What is KAIRA?';
  const res1 = await knowledgeService.answerQuery(testQ1);
  console.log(`Q: "${testQ1}"`);
  console.log(`Answer: "${res1.answer}"`);
  console.log(`isGrounded: ${res1.isGrounded}`);
  console.log(`Sources:`, res1.sources);

  // Test 2: Another explicit question
  const testQ2 = 'Can customers interrupt the AI?';
  const res2 = await knowledgeService.answerQuery(testQ2);
  console.log(`\nQ: "${testQ2}"`);
  console.log(`Answer: "${res2.answer}"`);
  console.log(`isGrounded: ${res2.isGrounded}`);
  console.log(`Sources:`, res2.sources);

  // Test 3: Missing information (Q97, Q98, Q99, Q100 in PDF explicitly say not supplied)
  const testQ3 = "What is KAIRA's official support phone number?";
  const res3 = await knowledgeService.answerQuery(testQ3);
  console.log(`\nQ (Missing Info): "${testQ3}"`);
  console.log(`Answer: "${res3.answer}"`);
  console.log(`isGrounded: ${res3.isGrounded}`);
  console.log(`Mentions not supplied/refer:`, /not supplied|refer|authorized/i.test(res3.answer));

  const testQ4 = "What are KAIRA's subscription plans or prices?";
  const res4 = await knowledgeService.answerQuery(testQ4);
  console.log(`\nQ (Missing Info): "${testQ4}"`);
  console.log(`Answer: "${res4.answer}"`);
  console.log(`Sources:`, res4.sources);
  console.log(`Mentions not supplied/refer:`, /not supplied|refer|pricing/i.test(res4.answer));

  // Test 4: Copilot suggestion (Agent Dashboard)
  const copilotRes = await translationService.getCopilotSuggestion('What is the main purpose of KAIRA?', 'en');
  console.log(`\nCopilot Suggestion:`);
  console.log(`Answer: "${copilotRes.answer}"`);
  console.log(`isGrounded: ${copilotRes.isGrounded}`);
  console.log(`Sources:`, copilotRes.sources);

  console.log('\n================================================================');
  console.log('✅ KAIRA KNOWLEDGE BASE PDF AUDIT COMPLETE');
  console.log('================================================================\n');
}

main().catch(err => {
  console.error('Audit failed with error:', err);
  process.exit(1);
});
