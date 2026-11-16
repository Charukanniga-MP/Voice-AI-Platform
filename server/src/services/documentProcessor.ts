import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { prisma } from '../db.js';

export interface DocumentChunk {
  title: string;
  category: string;
  section: string;
  pageNumber: number;
  question: string | null;
  answer: string | null;
  content: string;
  keywords: string;
}

export interface IngestionResult {
  success: boolean;
  documentId: string;
  entryCount: number;
  fileHash: string;
  isDuplicate: boolean;
  duplicateOfDocId?: string;
  error?: string;
}

/**
 * Calculates SHA-256 hash of a file for duplicate detection
 */
export function calculateFileHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Clean and normalize text extracted from documents
 */
export function cleanDocumentText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Remove repeated page headers and footers like "KAIRA Voice AI Platform | Starter FAQ Knowledge Base Page X"
    .replace(/KAIRA Voice AI Platform \| Starter FAQ Knowledge Base\s*(Page\s*\d+)?/gi, '')
    // Normalize excessive horizontal whitespace while preserving paragraph breaks
    .replace(/[ \t]+/g, ' ')
    // Normalize multiple consecutive blank lines to double newlines
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/**
 * Smart chunker: parses structured Q&A, sections, or sliding windows with overlap
 */
export function chunkDocumentText(rawText: string, baseTitle: string): DocumentChunk[] {
  const cleaned = cleanDocumentText(rawText);
  const chunks: DocumentChunk[] = [];

  // 1. Detect Sections (e.g. "A. KAIRA Overview and Core Capabilities", "Section 1: ...")
  const sectionSplitRegex = /(?:^|\n)(?:([A-Z]\.\s+[^\n]+)|(SECTION\s+[A-Z0-9]+[:\s]+[^\n]+))/gi;
  const sectionMatches: Array<{ index: number; title: string }> = [];
  let sMatch;
  while ((sMatch = sectionSplitRegex.exec(cleaned)) !== null) {
    sectionMatches.push({
      index: sMatch.index,
      title: (sMatch[1] || sMatch[2] || '').trim()
    });
  }

  // 2. Parse Numbered Q&A Pattern (e.g., "1. What is KAIRA?\nKAIRA is a ...")
  // or standard "Q: ... A: ..."
  const numberedQARegex = /(?:^|\n)\s*(\d+)\.\s*([^\n\?]+\?)\s*\n+([\s\S]*?)(?=(?:\n\s*\d+\.\s*[^\n\?]+\?)|(?:\n[A-Z]\.\s+)|$)/gi;
  let qMatch;
  let qaFound = 0;

  while ((qMatch = numberedQARegex.exec(cleaned)) !== null) {
    qaFound++;
    const num = qMatch[1];
    const questionText = qMatch[2].trim();
    const answerText = qMatch[3].trim();
    const fullQuestion = `${num}. ${questionText}`;

    // Find active section
    let activeSection = 'General Overview';
    for (const sm of sectionMatches) {
      if (sm.index <= qMatch.index) {
        activeSection = sm.title;
      }
    }

    // Determine category based on section or question content
    let category = 'faq';
    const lowerSec = activeSection.toLowerCase();
    const lowerQ = questionText.toLowerCase();

    if (lowerSec.includes('overview') || lowerSec.includes('capabilit')) category = 'company';
    else if (lowerSec.includes('language') || lowerSec.includes('voice')) category = 'languages';
    else if (lowerSec.includes('calling') || lowerSec.includes('audio') || lowerSec.includes('webrtc')) category = 'calling';
    else if (lowerSec.includes('intelligence') || lowerSec.includes('summary') || lowerSec.includes('intent')) category = 'intelligence';
    else if (lowerSec.includes('knowledge') || lowerSec.includes('grounding')) category = 'knowledge';
    else if (lowerSec.includes('account') || lowerSec.includes('privacy') || lowerSec.includes('security')) category = 'security';
    else if (lowerSec.includes('polic') || lowerSec.includes('limitation') || lowerSec.includes('practice')) category = 'policies';

    if (lowerQ.includes('price') || lowerQ.includes('cost') || lowerQ.includes('plan')) category = 'pricing';

    // Calculate approximate page (average ~1800 characters per printed page)
    const pageNumber = Math.max(1, Math.min(7, Math.floor(qMatch.index / 1800) + 1));

    // Keyword extraction
    const kwTokens = (questionText + ' ' + answerText)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);
    const keywords = Array.from(new Set(kwTokens)).slice(0, 15).join(' ');

    chunks.push({
      title: `${baseTitle} - Q${num}: ${questionText.slice(0, 60)}`,
      category,
      section: activeSection,
      pageNumber,
      question: fullQuestion,
      answer: answerText,
      content: `Section: ${activeSection}\nQuestion: ${fullQuestion}\nAnswer: ${answerText}`,
      keywords
    });
  }

  // 3. Fallback to Paragraph Chunking with Sliding Window Overlap if no Q&A syntax found
  if (qaFound === 0) {
    const paragraphs = cleaned.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 20);
    const CHUNK_SIZE = 500;
    const CHUNK_OVERLAP = 100;

    let rollingBuffer = '';
    let chunkIdx = 1;

    for (const para of paragraphs) {
      if ((rollingBuffer + '\n\n' + para).length > CHUNK_SIZE && rollingBuffer.length > 100) {
        const pageNumber = Math.max(1, Math.floor(chunks.length / 3) + 1);
        chunks.push({
          title: `${baseTitle} - Part ${chunkIdx++}`,
          category: 'general',
          section: 'Main Content',
          pageNumber,
          question: null,
          answer: rollingBuffer.slice(0, 300),
          content: rollingBuffer,
          keywords: baseTitle.toLowerCase()
        });
        // Retain overlap
        rollingBuffer = rollingBuffer.slice(-CHUNK_OVERLAP) + '\n\n' + para;
      } else {
        rollingBuffer = rollingBuffer ? rollingBuffer + '\n\n' + para : para;
      }
    }

    if (rollingBuffer.trim().length > 20) {
      chunks.push({
        title: `${baseTitle} - Part ${chunkIdx}`,
        category: 'general',
        section: 'Main Content',
        pageNumber: Math.max(1, Math.floor(chunks.length / 3) + 1),
        question: null,
        answer: rollingBuffer.slice(0, 300),
        content: rollingBuffer,
        keywords: baseTitle.toLowerCase()
      });
    }
  }

  return chunks;
}

/**
 * Ingest, extract, clean, chunk, and index an uploaded document
 */
export async function processUploadedDocument(
  documentId: string,
  filePath: string,
  fileType: string,
  originalName: string
): Promise<IngestionResult> {
  try {
    console.log(`[DocProcessor] Processing document ${documentId}: ${originalName}`);

    if (!fsSync.existsSync(filePath)) {
      throw new Error(`File not found on disk at: ${filePath}`);
    }

    const dataBuffer = await fs.readFile(filePath);
    const fileHash = calculateFileHash(dataBuffer);

    // Duplicate detection: check if another indexed document has identical content hash
    const existingDuplicate = await prisma.knowledgeDocument.findFirst({
      where: {
        fileHash,
        status: 'indexed',
        id: { not: documentId }
      }
    });

    if (existingDuplicate) {
      console.warn(`[DocProcessor] Duplicate document detected: ${originalName} matches existing document ${existingDuplicate.id} (${existingDuplicate.fileName})`);
      await prisma.knowledgeDocument.update({
        where: { id: documentId },
        data: {
          fileHash,
          status: 'failed',
          errorMessage: `Duplicate document detected. Identical content already indexed under "${existingDuplicate.title}" (${existingDuplicate.fileName}).`
        }
      });
      return {
        success: false,
        documentId,
        entryCount: 0,
        fileHash,
        isDuplicate: true,
        duplicateOfDocId: existingDuplicate.id,
        error: `Duplicate document of "${existingDuplicate.title}".`
      };
    }

    let extractedText = '';
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.pdf' || fileType.includes('pdf')) {
      const pdfData = await pdfParse(dataBuffer);
      extractedText = pdfData.text || '';
    } else if (ext === '.docx' || fileType.includes('word') || fileType.includes('officedocument')) {
      const result = await mammoth.extractRawText({ path: filePath });
      extractedText = result.value || '';
    } else {
      extractedText = dataBuffer.toString('utf-8');
    }

    if (!extractedText.trim()) {
      throw new Error('No readable text could be extracted from document.');
    }

    const baseTitle = path.basename(originalName, path.extname(originalName)).replace(/_/g, ' ');
    const chunks = chunkDocumentText(extractedText, baseTitle);

    if (chunks.length === 0) {
      throw new Error('Failed to generate knowledge chunks from extracted document text.');
    }

    // Atomically remove prior entries for this document (if re-indexing) and insert new chunks
    await prisma.$transaction(async (tx) => {
      await tx.knowledgeEntry.deleteMany({
        where: { documentId }
      });

      for (const chunk of chunks) {
        await tx.knowledgeEntry.create({
          data: {
            documentId,
            title: chunk.title,
            category: chunk.category,
            section: chunk.section,
            pageNumber: chunk.pageNumber,
            question: chunk.question,
            answer: chunk.answer,
            content: chunk.content,
            keywords: chunk.keywords
          }
        });
      }

      await tx.knowledgeDocument.update({
        where: { id: documentId },
        data: {
          title: baseTitle,
          fileHash,
          status: 'indexed',
          errorMessage: null,
          extractedText: extractedText.slice(0, 20000), // Preview text
          entryCount: chunks.length
        }
      });
    });

    console.log(`[DocProcessor] Successfully indexed ${chunks.length} chunks for document: "${baseTitle}"`);

    return {
      success: true,
      documentId,
      entryCount: chunks.length,
      fileHash,
      isDuplicate: false
    };
  } catch (err: any) {
    console.error(`[DocProcessor] Ingestion failed for document ${documentId}:`, err);
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: {
        status: 'failed',
        errorMessage: err.message || 'Unknown ingestion error occurred.'
      }
    }).catch(() => { });

    return {
      success: false,
      documentId,
      entryCount: 0,
      fileHash: '',
      isDuplicate: false,
      error: err.message || 'Ingestion failed'
    };
  }
}

/**
 * Re-indexes an existing document by re-running the chunking pipeline
 */
export async function reindexDocument(documentId: string): Promise<IngestionResult> {
  const doc = await prisma.knowledgeDocument.findUnique({
    where: { id: documentId }
  });

  if (!doc) {
    throw new Error(`Knowledge document with id ${documentId} not found.`);
  }

  // Look for file in uploads directory or server/data
  const uploadsDir = path.join(process.cwd(), 'uploads');
  const serverDataDir = path.join(process.cwd(), 'server', 'data');
  let targetPath = path.join(uploadsDir, doc.fileName);

  if (!fsSync.existsSync(targetPath)) {
    targetPath = path.join(serverDataDir, doc.fileName);
  }

  if (!fsSync.existsSync(targetPath)) {
    // If physical file moved, re-index from saved extractedText
    if (doc.extractedText && doc.extractedText.length > 50) {
      const chunks = chunkDocumentText(doc.extractedText, doc.title);
      await prisma.$transaction(async (tx) => {
        await tx.knowledgeEntry.deleteMany({ where: { documentId } });
        for (const chunk of chunks) {
          await tx.knowledgeEntry.create({
            data: {
              documentId,
              title: chunk.title,
              category: chunk.category,
              section: chunk.section,
              pageNumber: chunk.pageNumber,
              question: chunk.question,
              answer: chunk.answer,
              content: chunk.content,
              keywords: chunk.keywords
            }
          });
        }
        await tx.knowledgeDocument.update({
          where: { id: documentId },
          data: {
            status: 'indexed',
            errorMessage: null,
            entryCount: chunks.length
          }
        });
      });

      return {
        success: true,
        documentId,
        entryCount: chunks.length,
        fileHash: doc.fileHash || '',
        isDuplicate: false
      };
    }
    throw new Error(`Source file "${doc.fileName}" could not be found to re-index.`);
  }

  return processUploadedDocument(doc.id, targetPath, doc.fileType, doc.fileName);
}

/**
 * Safely deletes a document and all associated entries
 */
export async function deleteDocument(documentId: string): Promise<void> {
  const doc = await prisma.knowledgeDocument.findUnique({
    where: { id: documentId }
  });

  if (!doc) {
    throw new Error(`Document with ID ${documentId} not found.`);
  }

  // Delete all entries and document record (Prisma onDelete: Cascade also cleans entries)
  await prisma.knowledgeDocument.delete({
    where: { id: documentId }
  });

  // Clean file from disk if present
  try {
    const uploadPath = path.join(process.cwd(), 'uploads', doc.fileName);
    if (fsSync.existsSync(uploadPath)) {
      await fs.unlink(uploadPath);
    }
  } catch (err) {
    console.warn(`[DocProcessor] Could not delete disk file for ${doc.fileName}:`, err);
  }
}

export const documentProcessor = {
  calculateFileHash,
  cleanDocumentText,
  chunkDocumentText,
  processUploadedDocument,
  reindexDocument,
  deleteDocument
};
