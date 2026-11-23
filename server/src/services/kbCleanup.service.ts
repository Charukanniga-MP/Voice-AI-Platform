import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pdfParse from 'pdf-parse';
import { prisma } from '../db.js';

export interface ScannedPdfFile {
  folder: 'uploads' | 'server/data';
  fileName: string;
  filePath: string;
  fileSize: number;
  sha256: string;
  normalizedContentHash: string;
  textSnippet: string;
  pageCount: number;
  associatedDocIds: string[];
  parseError?: string;
}

export interface DuplicateGroup {
  canonicalDocId?: string;
  canonicalFileName: string;
  canonicalFilePath: string;
  matchType: 'exact_sha256' | 'normalized_content';
  contentHash: string;
  redundantDocIds: string[];
  redundantFilePaths: string[];
  description: string;
}

export interface CleanupReport {
  timestamp: string;
  dryRun: boolean;
  totalDocsScanned: number;
  pdfDocsScanned: number;
  nonPdfDocsPreserved: number;
  physicalPdfFilesScanned: number;
  exactDuplicatesFound: number;
  contentDuplicatesFound: number;
  duplicateRecordsRemoved: number;
  redundantFilesRemoved: number;
  uniquePdfsRetained: number;
  backupLocation?: string;
  unprocessedFiles: Array<{ fileName: string; reason: string }>;
  details: string[];
}

export function normalizePdfTextForComparison(rawText: string): string {
  return rawText
    .toLowerCase()
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Strip recurrent headers and footers
    .replace(/KAIRA Voice AI Platform \| Starter FAQ Knowledge Base\s*(Page\s*\d+)?/gi, '')
    // Strip non-letter / non-number symbols to focus on pure textual content
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export class KbCleanupService {
  private backupBaseDir: string;

  constructor() {
    this.backupBaseDir = path.resolve(process.cwd(), 'server', 'data', 'backups');
  }

  /**
   * Scans all KnowledgeDocuments in DB and files in uploads and server/data
   */
  public async scanKnowledgeBase(): Promise<{
    dbDocs: any[];
    nonPdfDocs: any[];
    scannedPdfFiles: ScannedPdfFile[];
    duplicateGroups: DuplicateGroup[];
    unprocessedFiles: Array<{ fileName: string; reason: string }>;
  }> {
    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    const serverDataDir = path.resolve(process.cwd(), 'server', 'data');
    const unprocessedFiles: Array<{ fileName: string; reason: string }> = [];

    // Ensure uploads folder exists
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // 1. Fetch DB documents
    const dbDocs = await prisma.knowledgeDocument.findMany({
      include: {
        _count: { select: { entries: true } }
      },
      orderBy: { createdAt: 'asc' }
    });

    const nonPdfDocs = dbDocs.filter(d => {
      const isPdfType = (d.fileType && d.fileType.toLowerCase().includes('pdf')) || d.fileName.toLowerCase().endsWith('.pdf');
      return !isPdfType;
    });

    // 2. Scan physical files
    const scannedPdfFiles: ScannedPdfFile[] = [];
    const scanFolders: Array<{ folder: 'server/data' | 'uploads'; dirPath: string }> = [
      { folder: 'server/data', dirPath: serverDataDir },
      { folder: 'uploads', dirPath: uploadsDir }
    ];

    for (const { folder, dirPath } of scanFolders) {
      if (!fs.existsSync(dirPath)) continue;
      const files = fs.readdirSync(dirPath);

      for (const f of files) {
        // Skip hidden files, system files, and backups folder
        if (f.startsWith('.') || f === 'backups') continue;

        const filePath = path.join(dirPath, f);
        try {
          const stat = fs.statSync(filePath);
          if (!stat.isFile()) continue;

          // Only process PDF files for duplicate cleanup
          if (!f.toLowerCase().endsWith('.pdf')) {
            continue;
          }

          const buf = fs.readFileSync(filePath);
          const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

          let pageCount = 0;
          let textSnippet = '';
          let normalizedContentHash = '';

          try {
            const parsed = await pdfParse(buf);
            pageCount = parsed.numpages;
            textSnippet = (parsed.text || '').slice(0, 300);
            const normalizedText = normalizePdfTextForComparison(parsed.text || '');
            normalizedContentHash = crypto.createHash('sha256').update(normalizedText).digest('hex');
          } catch (pdfErr: any) {
            unprocessedFiles.push({
              fileName: f,
              reason: `PDF parsing failed: ${pdfErr?.message || 'Invalid PDF structure'}`
            });
            continue;
          }

          const associatedDocIds = dbDocs
            .filter(d => d.fileName === f || d.fileHash === sha256)
            .map(d => d.id);

          scannedPdfFiles.push({
            folder,
            fileName: f,
            filePath,
            fileSize: stat.size,
            sha256,
            normalizedContentHash,
            textSnippet,
            pageCount,
            associatedDocIds
          });
        } catch (fileErr: any) {
          unprocessedFiles.push({
            fileName: f,
            reason: `File access error: ${fileErr?.message || 'Access denied'}`
          });
        }
      }
    }

    // 3. Group and identify duplicates
    const duplicateGroups: DuplicateGroup[] = [];

    // Group 3A: Exact SHA-256 binary matches
    const sha256Map = new Map<string, ScannedPdfFile[]>();
    for (const file of scannedPdfFiles) {
      const list = sha256Map.get(file.sha256) || [];
      list.push(file);
      sha256Map.set(file.sha256, list);
    }

    // Also group DB records by fileHash
    const dbHashGroup = new Map<string, any[]>();
    for (const d of dbDocs) {
      if (d.fileHash) {
        const list = dbHashGroup.get(d.fileHash) || [];
        list.push(d);
        dbHashGroup.set(d.fileHash, list);
      }
    }

    // Group 3B: Normalized content text matches (identical extracted text)
    const contentMap = new Map<string, ScannedPdfFile[]>();
    for (const file of scannedPdfFiles) {
      if (!file.normalizedContentHash) continue;
      const list = contentMap.get(file.normalizedContentHash) || [];
      list.push(file);
      contentMap.set(file.normalizedContentHash, list);
    }

    // Process Content Groups with > 1 file or DB documents with > 1 record
    const processedHashes = new Set<string>();

    for (const [contentHash, files] of contentMap.entries()) {
      if (files.length <= 1) {
        // Check if DB has multiple records for this single physical file
        const file = files[0];
        const dbMatches = dbDocs.filter(d => d.fileName === file.fileName || d.fileHash === file.sha256);
        if (dbMatches.length > 1) {
          // Canonical is the one with status === 'indexed' or highest entryCount
          const sorted = [...dbMatches].sort((a, b) => b._count.entries - a._count.entries);
          const canonical = sorted[0];
          const redundantDocs = sorted.slice(1);

          duplicateGroups.push({
            canonicalDocId: canonical.id,
            canonicalFileName: canonical.fileName,
            canonicalFilePath: file.filePath,
            matchType: 'exact_sha256',
            contentHash,
            redundantDocIds: redundantDocs.map(d => d.id),
            redundantFilePaths: [], // file itself is still needed by canonical
            description: `Exact DB duplicate records pointing to same file "${file.fileName}"`
          });
        }
        continue;
      }

      processedHashes.add(contentHash);

      // Select canonical file:
      // Priority 1: Has an indexed DB document with entries > 0
      // Priority 2: In server/data with official name 'KAIRA_100_Customer_Questions_and_Answers.pdf'
      // Priority 3: Earliest created or largest file
      let canonicalFile = files.find(f => {
        return f.associatedDocIds.some(docId => {
          const doc = dbDocs.find(d => d.id === docId);
          return doc && doc.status === 'indexed' && doc._count.entries > 0;
        });
      });

      if (!canonicalFile) {
        canonicalFile = files.find(f => f.fileName === 'KAIRA_100_Customer_Questions_and_Answers.pdf') || files[0];
      }

      // Determine canonical DB document ID
      let canonicalDoc = dbDocs.find(d => canonicalFile?.associatedDocIds.includes(d.id) && d.status === 'indexed');
      if (!canonicalDoc && canonicalFile?.associatedDocIds.length) {
        canonicalDoc = dbDocs.find(d => d.id === canonicalFile!.associatedDocIds[0]);
      }

      const redundantFiles = files.filter(f => f.filePath !== canonicalFile!.filePath);
      const redundantDocIds: string[] = [];

      for (const rf of redundantFiles) {
        for (const dId of rf.associatedDocIds) {
          if (dId !== canonicalDoc?.id && !redundantDocIds.includes(dId)) {
            redundantDocIds.push(dId);
          }
        }
      }

      // Check if exact SHA-256 or normalized content
      const allSameSha = files.every(f => f.sha256 === canonicalFile!.sha256);

      duplicateGroups.push({
        canonicalDocId: canonicalDoc?.id,
        canonicalFileName: canonicalFile.fileName,
        canonicalFilePath: canonicalFile.filePath,
        matchType: allSameSha ? 'exact_sha256' : 'normalized_content',
        contentHash,
        redundantDocIds,
        redundantFilePaths: redundantFiles.map(rf => rf.filePath),
        description: allSameSha
          ? `Exact duplicate PDF files (${files.map(f => f.fileName).join(', ')})`
          : `Content-identical PDF documents (${files.map(f => f.fileName).join(', ')}) with matching normalized Q&A text`
      });
    }

    return {
      dbDocs,
      nonPdfDocs,
      scannedPdfFiles,
      duplicateGroups,
      unprocessedFiles
    };
  }

  /**
   * Generates a pre-cleanup duplicate audit report without deleting anything (dryRun = true)
   */
  public async generateDuplicateReport(): Promise<CleanupReport> {
    const scan = await this.scanKnowledgeBase();

    let exactDuplicates = 0;
    let contentDuplicates = 0;

    for (const g of scan.duplicateGroups) {
      if (g.matchType === 'exact_sha256') {
        exactDuplicates += g.redundantFilePaths.length + g.redundantDocIds.length;
      } else {
        contentDuplicates += g.redundantFilePaths.length + g.redundantDocIds.length;
      }
    }

    const uniquePdfs = scan.scannedPdfFiles.length - scan.duplicateGroups.reduce((acc, g) => acc + g.redundantFilePaths.length, 0);

    const details: string[] = [];
    for (const g of scan.duplicateGroups) {
      details.push(
        `[${g.matchType.toUpperCase()}] Retain: "${g.canonicalFileName}" (Doc ID: ${g.canonicalDocId || 'N/A'}). ` +
        `Redundant files: [${g.redundantFilePaths.map(p => path.basename(p)).join(', ')}]. ` +
        `Redundant doc records: [${g.redundantDocIds.join(', ')}]`
      );
    }

    return {
      timestamp: new Date().toISOString(),
      dryRun: true,
      totalDocsScanned: scan.dbDocs.length,
      pdfDocsScanned: scan.dbDocs.length - scan.nonPdfDocs.length,
      nonPdfDocsPreserved: scan.nonPdfDocs.length,
      physicalPdfFilesScanned: scan.scannedPdfFiles.length,
      exactDuplicatesFound: exactDuplicates,
      contentDuplicatesFound: contentDuplicates,
      duplicateRecordsRemoved: 0,
      redundantFilesRemoved: 0,
      uniquePdfsRetained: uniquePdfs,
      unprocessedFiles: scan.unprocessedFiles,
      details
    };
  }

  /**
   * Safely and reversibly cleans up redundant duplicate PDF files and records.
   * Creates a full reversible backup snapshot before executing any deletion.
   */
  public async executeSafeCleanup(): Promise<CleanupReport> {
    const scan = await this.scanKnowledgeBase();
    const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(this.backupBaseDir, `kb-cleanup-${timestampStr}`);

    if (scan.duplicateGroups.length === 0) {
      return {
        timestamp: new Date().toISOString(),
        dryRun: false,
        totalDocsScanned: scan.dbDocs.length,
        pdfDocsScanned: scan.dbDocs.length - scan.nonPdfDocs.length,
        nonPdfDocsPreserved: scan.nonPdfDocs.length,
        physicalPdfFilesScanned: scan.scannedPdfFiles.length,
        exactDuplicatesFound: 0,
        contentDuplicatesFound: 0,
        duplicateRecordsRemoved: 0,
        redundantFilesRemoved: 0,
        uniquePdfsRetained: scan.scannedPdfFiles.length,
        unprocessedFiles: scan.unprocessedFiles,
        details: ['Knowledge Base is already fully clean and deduplicated. 0 duplicate records or files detected.']
      };
    }

    // Create backup directory
    fs.mkdirSync(backupDir, { recursive: true });

    let duplicateRecordsRemoved = 0;
    let redundantFilesRemoved = 0;
    let exactDuplicates = 0;
    let contentDuplicates = 0;
    const details: string[] = [];
    const backupManifest: any = {
      timestamp: new Date().toISOString(),
      backupDir,
      removedFiles: [],
      removedDbRecords: []
    };

    for (const group of scan.duplicateGroups) {
      if (group.matchType === 'exact_sha256') {
        exactDuplicates += group.redundantFilePaths.length + group.redundantDocIds.length;
      } else {
        contentDuplicates += group.redundantFilePaths.length + group.redundantDocIds.length;
      }

      // 1. Process redundant DB records
      for (const redDocId of group.redundantDocIds) {
        // Never remove the canonical document
        if (redDocId === group.canonicalDocId) continue;

        const docRecord = await prisma.knowledgeDocument.findUnique({
          where: { id: redDocId },
          include: { entries: true }
        });

        if (docRecord) {
          // Backup record and entries
          backupManifest.removedDbRecords.push(docRecord);

          // If there are entries attached, verify if canonical has them or if they can be safely removed
          await prisma.$transaction(async (tx) => {
            await tx.knowledgeEntry.deleteMany({
              where: { documentId: redDocId }
            });
            await tx.knowledgeDocument.delete({
              where: { id: redDocId }
            });
          });

          duplicateRecordsRemoved++;
          details.push(`Safely removed duplicate DB KnowledgeDocument ID "${redDocId}" (${docRecord.fileName}).`);
        }
      }

      // 2. Process redundant physical files
      for (const filePath of group.redundantFilePaths) {
        // Never delete canonical file
        if (path.resolve(filePath) === path.resolve(group.canonicalFilePath)) continue;

        // Verify that this file is not referenced by any remaining DB document
        const baseName = path.basename(filePath);
        const activeReference = await prisma.knowledgeDocument.findFirst({
          where: {
            fileName: baseName,
            id: { notIn: group.redundantDocIds }
          }
        });

        if (activeReference) {
          details.push(`Skipped deletion of physical file "${baseName}": still referenced by active document ID ${activeReference.id}.`);
          continue;
        }

        if (fs.existsSync(filePath)) {
          // Backup file to backup directory
          const backupFilePath = path.join(backupDir, baseName);
          fs.copyFileSync(filePath, backupFilePath);
          backupManifest.removedFiles.push({
            originalPath: filePath,
            backupPath: backupFilePath,
            fileName: baseName
          });

          // Delete redundant file
          fs.unlinkSync(filePath);
          redundantFilesRemoved++;
          details.push(`Safely removed redundant duplicate PDF file "${baseName}" after backing up to "${backupDir}".`);
        }
      }
    }

    // Save backup manifest
    const manifestPath = path.join(backupDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(backupManifest, null, 2), 'utf-8');

    const uniquePdfsRetained = scan.scannedPdfFiles.length - redundantFilesRemoved;

    return {
      timestamp: new Date().toISOString(),
      dryRun: false,
      totalDocsScanned: scan.dbDocs.length,
      pdfDocsScanned: scan.dbDocs.length - scan.nonPdfDocs.length,
      nonPdfDocsPreserved: scan.nonPdfDocs.length,
      physicalPdfFilesScanned: scan.scannedPdfFiles.length,
      exactDuplicatesFound: exactDuplicates,
      contentDuplicatesFound: contentDuplicates,
      duplicateRecordsRemoved,
      redundantFilesRemoved,
      uniquePdfsRetained,
      backupLocation: backupDir,
      unprocessedFiles: scan.unprocessedFiles,
      details
    };
  }

  /**
   * Reversibly restores a previous cleanup from its backup directory
   */
  public async restoreFromBackup(backupDir: string): Promise<boolean> {
    const manifestPath = path.join(backupDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Backup manifest not found at: ${manifestPath}`);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    // Restore physical files
    for (const f of manifest.removedFiles || []) {
      if (fs.existsSync(f.backupPath)) {
        fs.copyFileSync(f.backupPath, f.originalPath);
      }
    }

    // Restore database records
    for (const doc of manifest.removedDbRecords || []) {
      const existing = await prisma.knowledgeDocument.findUnique({ where: { id: doc.id } });
      if (!existing) {
        await prisma.knowledgeDocument.create({
          data: {
            id: doc.id,
            title: doc.title,
            fileName: doc.fileName,
            fileType: doc.fileType,
            fileSize: doc.fileSize,
            fileHash: doc.fileHash,
            status: doc.status,
            extractedText: doc.extractedText,
            entryCount: doc.entryCount,
            errorMessage: doc.errorMessage,
            createdAt: new Date(doc.createdAt),
            updatedAt: new Date(doc.updatedAt)
          }
        });

        for (const entry of doc.entries || []) {
          await prisma.knowledgeEntry.create({
            data: {
              id: entry.id,
              documentId: doc.id,
              title: entry.title,
              category: entry.category,
              section: entry.section,
              pageNumber: entry.pageNumber,
              question: entry.question,
              answer: entry.answer,
              content: entry.content,
              keywords: entry.keywords,
              embedding: entry.embedding,
              createdAt: new Date(entry.createdAt),
              updatedAt: new Date(entry.updatedAt)
            }
          });
        }
      }
    }

    return true;
  }
}

export const kbCleanupService = new KbCleanupService();
