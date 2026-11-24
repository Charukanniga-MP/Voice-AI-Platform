import fs from 'fs';
import path from 'path';
import { prisma } from '../db.js';
import {
  extractDocumentText,
  chunkDocumentText,
  reindexDocument,
  processUploadedDocument,
  calculateFileHash
} from '../services/documentProcessor.js';

interface TestResult {
  name: string;
  passed: boolean;
  details?: string;
}

async function runPdfPageExtractionSuite() {
  console.log('===============================================================');
  console.log('=== KAIRA PDF PAGE-BY-PAGE EXTRACTION & CHUNKING TEST SUITE ===');
  console.log('===============================================================\n');

  const results: TestResult[] = [];
  const pdfPath = path.join(process.cwd(), 'server', 'data', 'KAIRA_100_Customer_Questions_and_Answers.pdf');

  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF file not found at: ${pdfPath}`);
  }

  // 1. Test Page-by-Page Extraction
  console.log('[Test 1] Extracting document text page-by-page from KAIRA 100 Q&A PDF...');
  const extraction = await extractDocumentText(pdfPath, 'application/pdf');
  
  const test1a: TestResult = {
    name: 'Total page count should be exactly 7',
    passed: extraction.pageCount === 7 && extraction.pages.length === 7,
    details: `Extracted ${extraction.pages.length} pages (expected 7).`
  };
  results.push(test1a);

  const test1b: TestResult = {
    name: 'Page 1 contains Platform title and Starter FAQ overview',
    passed: extraction.pages[0]?.text.includes('KAIRA VOICE AI PLATFORM') && (extraction.pages[0]?.text.includes('100 Customer Questions & Answers') || extraction.pages[0]?.text.includes('Starter FAQ Knowledge Base')),
    details: `Page 1 length: ${extraction.pages[0]?.text.length} chars`
  };
  results.push(test1b);

  const test1c: TestResult = {
    name: 'Page 2 contains Question 1 (What is KAIRA?)',
    passed: extraction.pages[1]?.text.includes('1. What is KAIRA?') && extraction.pages[1]?.text.includes('multilingual voice-based customer support platform'),
    details: `Page 2 preview: ${extraction.pages[1]?.text.slice(0, 80).replace(/\n/g, ' ')}`
  };
  results.push(test1c);

  const test1d: TestResult = {
    name: 'Page 3 contains Question 19 (What if the AI is unsure?)',
    passed: extraction.pages[2]?.text.includes('19. What if the AI is unsure?') || extraction.pages[2]?.text.includes('What if the AI is unsure'),
    details: `Page 3 preview: ${extraction.pages[2]?.text.slice(0, 80).replace(/\n/g, ' ')}`
  };
  results.push(test1d);

  const test1e: TestResult = {
    name: 'Page 4 contains Question 37 (Does KAIRA need microphone permission?)',
    passed: extraction.pages[3]?.text.includes('37. Does KAIRA need microphone permission?') || extraction.pages[3]?.text.includes('microphone permission'),
    details: `Page 4 preview: ${extraction.pages[3]?.text.slice(0, 80).replace(/\n/g, ' ')}`
  };
  results.push(test1e);

  const test1f: TestResult = {
    name: 'Page 5 contains Question 55 (Can summaries be generated in regional languages?)',
    passed: extraction.pages[4]?.text.includes('55. Can summaries be generated') || extraction.pages[4]?.text.includes('regional languages'),
    details: `Page 5 preview: ${extraction.pages[4]?.text.slice(0, 80).replace(/\n/g, ' ')}`
  };
  results.push(test1f);

  const test1g: TestResult = {
    name: 'Page 6 contains Question 73 (Can one customer access another customer\'s call?)',
    passed: extraction.pages[5]?.text.includes('73. Can one customer access') || extraction.pages[5]?.text.includes('another customer'),
    details: `Page 6 preview: ${extraction.pages[5]?.text.slice(0, 80).replace(/\n/g, ' ')}`
  };
  results.push(test1g);

  const test1h: TestResult = {
    name: 'Page 7 contains Question 90 through Question 100',
    passed: extraction.pages[6]?.text.includes('90.') && (extraction.pages[6]?.text.includes('100. Does KAIRA publish official pricing plans') || extraction.pages[6]?.text.includes('100.')),
    details: `Page 7 preview: ${extraction.pages[6]?.text.slice(0, 80).replace(/\n/g, ' ')}`
  };
  results.push(test1h);

  // 2. Test Smart Chunking with Exact Page Association
  console.log('\n[Test 2] Chunking extracted text into structured Q&A units...');
  const chunks = chunkDocumentText(extraction.text, 'KAIRA 100 Customer Questions and Answers');

  const test2a: TestResult = {
    name: 'Total generated Q&A chunks should be exactly 100',
    passed: chunks.length === 100,
    details: `Generated ${chunks.length} chunks (expected 100).`
  };
  results.push(test2a);

  // Check specific chunk page numbers
  const q1Chunk = chunks.find(c => c.question?.startsWith('1. '));
  const q19Chunk = chunks.find(c => c.question?.startsWith('19. '));
  const q37Chunk = chunks.find(c => c.question?.startsWith('37. '));
  const q55Chunk = chunks.find(c => c.question?.startsWith('55. '));
  const q73Chunk = chunks.find(c => c.question?.startsWith('73. '));
  const q90Chunk = chunks.find(c => c.question?.startsWith('90. '));
  const q100Chunk = chunks.find(c => c.question?.startsWith('100. '));

  const test2b: TestResult = {
    name: 'Chunk Q1 has accurate page number (Page 2)',
    passed: q1Chunk?.pageNumber === 2,
    details: `Q1 pageNumber: ${q1Chunk?.pageNumber} (expected 2)`
  };
  results.push(test2b);

  const test2c: TestResult = {
    name: 'Chunk Q19 has accurate page number (Page 3)',
    passed: q19Chunk?.pageNumber === 3,
    details: `Q19 pageNumber: ${q19Chunk?.pageNumber} (expected 3)`
  };
  results.push(test2c);

  const test2d: TestResult = {
    name: 'Chunk Q37 has accurate page number (Page 4)',
    passed: q37Chunk?.pageNumber === 4,
    details: `Q37 pageNumber: ${q37Chunk?.pageNumber} (expected 4)`
  };
  results.push(test2d);

  const test2e: TestResult = {
    name: 'Chunk Q55 has accurate page number (Page 5)',
    passed: q55Chunk?.pageNumber === 5,
    details: `Q55 pageNumber: ${q55Chunk?.pageNumber} (expected 5)`
  };
  results.push(test2e);

  const test2f: TestResult = {
    name: 'Chunk Q73 has accurate page number (Page 6)',
    passed: q73Chunk?.pageNumber === 6,
    details: `Q73 pageNumber: ${q73Chunk?.pageNumber} (expected 6)`
  };
  results.push(test2f);

  const test2g: TestResult = {
    name: 'Chunk Q90 and Q100 have accurate page number (Page 7)',
    passed: q90Chunk?.pageNumber === 7 && q100Chunk?.pageNumber === 7,
    details: `Q90 page: ${q90Chunk?.pageNumber}, Q100 page: ${q100Chunk?.pageNumber} (expected 7)`
  };
  results.push(test2g);

  // 3. Test Chunk Metadata Completeness and Hash Deduplication
  console.log('\n[Test 3] Verifying chunk metadata completeness and deduplication...');
  let allMetadataValid = true;
  const hashSet = new Set<string>();
  let duplicateCount = 0;

  for (const c of chunks) {
    if (!c.title || !c.category || !c.section || !c.pageNumber || !c.question || !c.answer || !c.content || !c.keywords || !c.contentHash) {
      allMetadataValid = false;
      break;
    }
    if (hashSet.has(c.contentHash)) {
      duplicateCount++;
    }
    hashSet.add(c.contentHash);
  }

  const test3a: TestResult = {
    name: 'All 100 chunks have complete metadata (title, category, section, page, question, answer, content, keywords, hash)',
    passed: allMetadataValid,
    details: `Verified ${chunks.length} chunks.`
  };
  results.push(test3a);

  const test3b: TestResult = {
    name: 'All 100 chunk hashes are unique with zero internal chunk duplication',
    passed: duplicateCount === 0 && hashSet.size === 100,
    details: `Unique chunk hashes: ${hashSet.size}/100, duplicate count: ${duplicateCount}`
  };
  results.push(test3b);

  // 4. Test Ingestion & Embedding Generation in DB
  console.log('\n[Test 4] Re-indexing canonical PDF document into SQLite database with dense embeddings...');
  const canonicalDoc = await prisma.knowledgeDocument.findFirst({
    where: {
      fileName: 'KAIRA_100_Customer_Questions_and_Answers.pdf',
      status: 'indexed'
    }
  });

  if (!canonicalDoc) {
    throw new Error('Canonical document KAIRA_100_Customer_Questions_and_Answers.pdf not found in database.');
  }

  const reindexRes = await reindexDocument(canonicalDoc.id);
  const test4a: TestResult = {
    name: 'reindexDocument succeeds and indexes 100 chunks',
    passed: reindexRes.success && reindexRes.entryCount === 100,
    details: `Reindex success: ${reindexRes.success}, entry count: ${reindexRes.entryCount}`
  };
  results.push(test4a);

  const dbEntries = await prisma.knowledgeEntry.findMany({
    where: { documentId: canonicalDoc.id }
  });

  let validEmbeddingCount = 0;
  for (const entry of dbEntries) {
    if (entry.embedding) {
      try {
        const vec = JSON.parse(entry.embedding);
        if (Array.isArray(vec) && vec.length === 128) {
          validEmbeddingCount++;
        }
      } catch (_) { }
    }
  }

  const test4b: TestResult = {
    name: 'All 100 DB entries contain valid 128-dimensional embedding vectors',
    passed: validEmbeddingCount === 100,
    details: `Entries with 128-dim embeddings: ${validEmbeddingCount}/100`
  };
  results.push(test4b);

  const test4c: TestResult = {
    name: 'All 100 DB entries correctly link to source documentId and have valid pageNumber',
    passed: dbEntries.every(e => e.documentId === canonicalDoc.id && e.pageNumber !== null && e.pageNumber >= 2 && e.pageNumber <= 7),
    details: `Linked entries count: ${dbEntries.length}, source doc ID: ${canonicalDoc.id}`
  };
  results.push(test4c);

  // 5. Test Duplicate Document Prevention
  console.log('\n[Test 5] Verifying duplicate document prevention via SHA-256...');
  const dupDoc = await prisma.knowledgeDocument.create({
    data: {
      title: 'Duplicate Test Document',
      fileName: 'duplicate_test.pdf',
      fileType: 'application/pdf',
      fileSize: 1024,
      status: 'processing',
      extractedText: ''
    }
  });

  const dupRes = await processUploadedDocument(dupDoc.id, pdfPath, 'application/pdf', 'duplicate_test.pdf');
  const test5: TestResult = {
    name: 'Duplicate document upload with identical SHA-256 is blocked',
    passed: dupRes.isDuplicate === true && dupRes.success === false,
    details: `isDuplicate: ${dupRes.isDuplicate}, duplicateOfDocId: ${dupRes.duplicateOfDocId}`
  };
  results.push(test5);

  // Cleanup test record
  await prisma.knowledgeDocument.delete({ where: { id: dupDoc.id } });

  // 6. Test Corrupt / Empty File Validation
  console.log('\n[Test 6] Verifying corrupt/empty file validation...');
  const emptyFilePath = path.join(process.cwd(), 'server', 'data', 'temp_empty_corrupt.pdf');
  fs.writeFileSync(emptyFilePath, Buffer.from('short'));

  let corruptCaught = false;
  try {
    await extractDocumentText(emptyFilePath, 'application/pdf');
  } catch (err: any) {
    if (err.message.includes('corrupted') || err.message.includes('empty')) {
      corruptCaught = true;
    }
  } finally {
    if (fs.existsSync(emptyFilePath)) fs.unlinkSync(emptyFilePath);
  }

  const test6: TestResult = {
    name: 'Corrupt or empty file under 10 bytes is rejected safely',
    passed: corruptCaught,
    details: `Corrupt caught: ${corruptCaught}`
  };
  results.push(test6);

  // Print Summary
  console.log('\n===============================================================');
  console.log('=== TEST RESULTS SUMMARY ===');
  console.log('===============================================================');
  let passCount = 0;
  for (const r of results) {
    const mark = r.passed ? '✓ PASS' : '✗ FAIL';
    if (r.passed) passCount++;
    console.log(`${mark} | ${r.name}`);
    if (r.details) console.log(`       └─ ${r.details}`);
  }
  console.log('---------------------------------------------------------------');
  console.log(`Total: ${results.length} | Passed: ${passCount} | Failed: ${results.length - passCount}`);
  console.log('===============================================================\n');

  if (passCount !== results.length) {
    process.exit(1);
  }
}

runPdfPageExtractionSuite()
  .catch((err) => {
    console.error('Fatal error during test suite:', err);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
