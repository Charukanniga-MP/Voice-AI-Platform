import fs from 'fs/promises';
import path from 'path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { prisma } from '../db.js';

export async function processUploadedDocument(documentId: string, filePath: string, fileType: string, originalName: string) {
  try {
    console.log(`[DocProcessor] Processing document ${documentId}: ${originalName}`);
    let extractedText = '';

    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.pdf' || fileType.includes('pdf')) {
      const dataBuffer = await fs.readFile(filePath);
      const pdfData = await pdfParse(dataBuffer);
      extractedText = pdfData.text || '';
    } else if (ext === '.docx' || fileType.includes('word') || fileType.includes('officedocument')) {
      const result = await mammoth.extractRawText({ path: filePath });
      extractedText = result.value || '';
    } else {
      // Plain text or fallback
      extractedText = await fs.readFile(filePath, 'utf-8');
    }

    if (!extractedText.trim()) {
      throw new Error('No readable text could be extracted from document.');
    }

    // Clean up any previously extracted entries for this document to prevent duplicate indexing
    await prisma.knowledgeEntry.deleteMany({
      where: { documentId }
    });

    // Break text into logical sections/paragraphs
    const paragraphs = extractedText
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(p => p.length > 30);

    const baseTitle = path.basename(originalName, path.extname(originalName));
    let entryCount = 0;

    // Detect Q&A patterns or create structured section entries
    const qaRegex = /(?:Q(?:uestion)?:\s*(.*?))\s*(?:A(?:nswer)?:\s*(.*?))(?=(?:Q(?:uestion)?:|$))/gis;
    let qaMatch;
    let foundQA = false;

    while ((qaMatch = qaRegex.exec(extractedText)) !== null) {
      foundQA = true;
      const question = qaMatch[1].trim();
      const answer = qaMatch[2].trim();
      if (question && answer) {
        await prisma.knowledgeEntry.create({
          data: {
            documentId,
            title: `${baseTitle} - Q&A: ${question.slice(0, 50)}...`,
            category: 'faq',
            question,
            answer,
            content: `Question: ${question}\nAnswer: ${answer}`,
            keywords: question.toLowerCase().replace(/[^\w\s]/g, '')
          }
        });
        entryCount++;
      }
    }

    // If no Q&A syntax, chunk into semantic paragraph sections
    if (!foundQA || entryCount === 0) {
      for (let i = 0; i < paragraphs.length; i++) {
        const p = paragraphs[i];
        const lines = p.split('\n').map(l => l.trim()).filter(Boolean);
        const sectionTitle = lines[0].slice(0, 80) || `${baseTitle} Section ${i + 1}`;

        await prisma.knowledgeEntry.create({
          data: {
            documentId,
            title: `${baseTitle}: ${sectionTitle}`,
            category: 'general',
            question: lines.length > 1 ? lines[0] : null,
            answer: lines.length > 1 ? lines.slice(1).join(' ') : p,
            content: p,
            keywords: baseTitle.toLowerCase() + ' ' + sectionTitle.toLowerCase()
          }
        });
        entryCount++;
      }
    }

    // Update document record status
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: {
        status: 'indexed',
        extractedText: extractedText.slice(0, 15000), // store preview
        entryCount
      }
    });

    console.log(`[DocProcessor] Successfully indexed ${entryCount} entries for document ${documentId}`);
  } catch (error: any) {
    console.error(`[DocProcessor] Error processing document ${documentId}:`, error);
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: {
        status: 'failed',
        extractedText: `Error processing file: ${error.message || 'Unknown error'}`
      }
    }).catch(() => { });
  }
}

