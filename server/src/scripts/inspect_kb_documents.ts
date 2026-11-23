import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pdfParse from 'pdf-parse';
import { prisma } from '../db.js';

export function calculateFileHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function normalizeContentText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/KAIRA Voice AI Platform \| Starter FAQ Knowledge Base\s*(Page\s*\d+)?/gi, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function runInspection() {
  console.log('================================================================');
  console.log('🔍 KAIRA KNOWLEDGE BASE DOCUMENT & FILE INSPECTION REPORT');
  console.log('================================================================\n');

  // 1. Ensure directories exist
  const uploadsDir = path.resolve(process.cwd(), 'uploads');
  const serverDataDir = path.resolve(process.cwd(), 'server', 'data');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  // 2. Fetch all documents from Database
  const dbDocs = await prisma.knowledgeDocument.findMany({
    include: {
      _count: {
        select: { entries: true }
      }
    },
    orderBy: { createdAt: 'asc' }
  });

  console.log(`[1] Total Knowledge Documents in Database: ${dbDocs.length}`);
  for (const doc of dbDocs) {
    console.log(`  - ID: ${doc.id}`);
    console.log(`    Title: "${doc.title}"`);
    console.log(`    FileName: "${doc.fileName}"`);
    console.log(`    FileType: "${doc.fileType}"`);
    console.log(`    FileSize: ${doc.fileSize} bytes`);
    console.log(`    FileHash: ${doc.fileHash}`);
    console.log(`    Status: ${doc.status}`);
    console.log(`    EntryCount (field): ${doc.entryCount}, Entries in DB: ${doc._count.entries}`);
    console.log(`    Created: ${doc.createdAt.toISOString()}`);
    console.log(`    Updated: ${doc.updatedAt.toISOString()}`);
  }

  // 3. Scan physical files in server/data and uploads
  console.log('\n[2] Scanning Physical Files on Disk:');
  const directoriesToScan = [
    { label: 'server/data', dirPath: serverDataDir },
    { label: 'uploads', dirPath: uploadsDir }
  ];

  interface ScannedFile {
    folder: string;
    fileName: string;
    fullPath: string;
    isPdf: boolean;
    size: number;
    sha256: string;
    normalizedTextHash: string;
    textLength: number;
    pages: number;
    parseError?: string;
  }

  const scannedFiles: ScannedFile[] = [];

  for (const { label, dirPath } of directoriesToScan) {
    if (!fs.existsSync(dirPath)) continue;
    const files = fs.readdirSync(dirPath);
    for (const f of files) {
      const fullPath = path.join(dirPath, f);
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) continue;

      const isPdf = f.toLowerCase().endsWith('.pdf');
      const buf = fs.readFileSync(fullPath);
      const sha256 = calculateFileHash(buf);

      let textLength = 0;
      let pages = 0;
      let normalizedTextHash = '';
      let parseError: string | undefined;

      if (isPdf) {
        try {
          const parsed = await pdfParse(buf);
          pages = parsed.numpages;
          textLength = parsed.text.length;
          const normText = normalizeContentText(parsed.text);
          normalizedTextHash = crypto.createHash('sha256').update(normText).digest('hex');
        } catch (e: any) {
          parseError = e?.message || 'Failed to parse PDF';
        }
      }

      scannedFiles.push({
        folder: label,
        fileName: f,
        fullPath,
        isPdf,
        size: stat.size,
        sha256,
        normalizedTextHash,
        textLength,
        pages,
        parseError
      });
    }
  }

  console.log(`Total Physical Files Found: ${scannedFiles.length}`);
  for (const sf of scannedFiles) {
    console.log(`  - [${sf.folder}] ${sf.fileName}`);
    console.log(`    Size: ${sf.size} bytes | IsPDF: ${sf.isPdf} | Pages: ${sf.pages}`);
    console.log(`    SHA-256: ${sf.sha256}`);
    if (sf.normalizedTextHash) {
      console.log(`    Content Hash (normalized): ${sf.normalizedTextHash}`);
    }
    if (sf.parseError) {
      console.log(`    ⚠️ Parse Error: ${sf.parseError}`);
    }
  }

  // 4. Duplicate Analysis across Database records and Physical files
  console.log('\n[3] Duplicate PDF Detection Analysis:');
  const pdfDocsInDb = dbDocs.filter(d => (d.fileType && d.fileType.toLowerCase().includes('pdf')) || d.fileName.toLowerCase().endsWith('.pdf'));
  const nonPdfDocsInDb = dbDocs.filter(d => !pdfDocsInDb.includes(d));

  console.log(`- Database PDF Documents: ${pdfDocsInDb.length}`);
  console.log(`- Database Non-PDF Documents: ${nonPdfDocsInDb.length} (MUST BE PRESERVED 100%)`);

  // Exact duplicates by SHA-256 in DB
  const hashGroups = new Map<string, typeof dbDocs>();
  for (const doc of pdfDocsInDb) {
    if (!doc.fileHash) continue;
    const group = hashGroups.get(doc.fileHash) || [];
    group.push(doc);
    hashGroups.set(doc.fileHash, group);
  }

  let exactDuplicateDbRecords = 0;
  for (const [hash, group] of hashGroups.entries()) {
    if (group.length > 1) {
      exactDuplicateDbRecords += (group.length - 1);
      console.log(`  ⚠️ Exact Duplicate Hash (${hash}): ${group.length} records in DB:`);
      for (const d of group) {
        console.log(`     -> ID: ${d.id}, File: "${d.fileName}", Title: "${d.title}", Entries: ${d._count.entries}`);
      }
    }
  }

  // Content duplicates by normalized text
  const contentHashGroups = new Map<string, Array<{ docId?: string; file: ScannedFile }>>();
  for (const sf of scannedFiles) {
    if (!sf.isPdf || !sf.normalizedTextHash) continue;
    const group = contentHashGroups.get(sf.normalizedTextHash) || [];
    // Check if matches a db doc
    const matchingDbDoc = dbDocs.find(d => d.fileName === sf.fileName || d.fileHash === sf.sha256);
    group.push({ docId: matchingDbDoc?.id, file: sf });
    contentHashGroups.set(sf.normalizedTextHash, group);
  }

  let contentDuplicateFiles = 0;
  for (const [cHash, group] of contentHashGroups.entries()) {
    if (group.length > 1) {
      contentDuplicateFiles += (group.length - 1);
      console.log(`  ℹ️ Content Duplicate (Normalized Text Match): ${group.length} files:`);
      for (const item of group) {
        console.log(`     -> [${item.file.folder}] "${item.file.fileName}" (Doc ID: ${item.docId || 'None in DB'}, Size: ${item.file.size})`);
      }
    }
  }

  console.log('\n================================================================');
  console.log('📊 SUMMARY OF INSPECTION:');
  console.log(`  Total DB Documents Scanned: ${dbDocs.length}`);
  console.log(`  PDF Documents in DB: ${pdfDocsInDb.length}`);
  console.log(`  Non-PDF Documents in DB: ${nonPdfDocsInDb.length}`);
  console.log(`  Physical PDF files scanned on disk: ${scannedFiles.filter(f => f.isPdf).length}`);
  console.log(`  Exact Duplicate DB records: ${exactDuplicateDbRecords}`);
  console.log(`  Content Duplicate PDF groups on disk: ${contentDuplicateFiles}`);
  console.log('================================================================');
}

runInspection()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('Inspection failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
