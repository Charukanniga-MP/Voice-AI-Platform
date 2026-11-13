/**
 * KAIRA Voice AI Platform - Business Intelligence PDF Generator
 * Pure TypeScript implementation producing standards-compliant PDF 1.4 documents
 * Zero external native dependencies, 100% offline, cross-platform compatible.
 */

import fs from 'fs';
import path from 'path';

export interface ReportPdfData {
  id: string;
  title: string;
  reportType: string;
  startDate: string;
  endDate: string;
  generatedAt: string;
  generatedBy: string;
  executiveSummary: string[];
  kpis: {
    totalCalls: number;
    completedCalls: number;
    missedCalls: number;
    transferredCalls: number;
    averageDuration: string;
    uniqueCustomers: number;
    positivePct: number;
    negativePct: number;
    neutralPct: number;
    frustratedPct: number;
    callsRequiringAssistance: number;
    activeAgents: number;
  };
  issueBreakdown: Array<{ category: string; count: number; percentage: number }>;
  sentimentBreakdown: {
    positive: number;
    neutral: number;
    negative: number;
    frustrated: number;
  };
  agentPerformance: Array<{
    name: string;
    callsHandled: number;
    completed: number;
    transferred: number;
    avgDuration: string;
    sentimentSummary: string;
  }>;
  keyFindings: string[];
}

// Escape special characters in PDF string literals: (, ), \
function escapePdfText(str: string): string {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, ' '); // Clean non-ASCII for standard Type1 Helvetica
}

export class SimplePdfDocument {
  private pages: string[] = [];
  private currentPageOps: string[] = [];
  private currentY: number = 780; // Starting Y from top (A4 height is 842 pt)
  private readonly pageWidth: number = 595.28;
  private readonly pageHeight: number = 841.89;
  private readonly margin: number = 45;

  constructor() {
    this.startNewPage();
  }

  public startNewPage() {
    if (this.currentPageOps.length > 0) {
      this.pages.push(this.currentPageOps.join('\n'));
      this.currentPageOps = [];
    }
    this.currentY = 780;

    // Header bar styling (KAIRA Brand Blue #2563EB)
    this.currentPageOps.push(`0.145 0.388 0.922 rg`); // Fill color: #2563EB
    this.currentPageOps.push(`0 812 ${this.pageWidth} 30 re f`); // Top colored banner

    // Header Title
    this.currentPageOps.push(`BT`);
    this.currentPageOps.push(`/F2 11 Tf`);
    this.currentPageOps.push(`1 1 1 rg`); // White text
    this.currentPageOps.push(`${this.margin} 822 Td`);
    this.currentPageOps.push(`(${escapePdfText('KAIRA VOICE AI PLATFORM - BUSINESS INTELLIGENCE REPORT')}) Tj`);
    this.currentPageOps.push(`ET`);

    // Reset default text color
    this.currentPageOps.push(`0.1 0.1 0.1 rg`);
  }

  public checkPageBreak(requiredHeight: number) {
    if (this.currentY - requiredHeight < 55) {
      this.startNewPage();
    }
  }

  public drawHeading(text: string, subtitle?: string) {
    this.checkPageBreak(subtitle ? 55 : 35);
    this.currentPageOps.push(`BT`);
    this.currentPageOps.push(`/F2 18 Tf`);
    this.currentPageOps.push(`0.08 0.15 0.35 rg`);
    this.currentPageOps.push(`${this.margin} ${this.currentY} Td`);
    this.currentPageOps.push(`(${escapePdfText(text)}) Tj`);
    this.currentPageOps.push(`ET`);
    this.currentY -= 22;

    if (subtitle) {
      this.currentPageOps.push(`BT`);
      this.currentPageOps.push(`/F1 10 Tf`);
      this.currentPageOps.push(`0.4 0.45 0.55 rg`);
      this.currentPageOps.push(`${this.margin} ${this.currentY} Td`);
      this.currentPageOps.push(`(${escapePdfText(subtitle)}) Tj`);
      this.currentPageOps.push(`ET`);
      this.currentY -= 20;
    }
  }

  public drawSectionTitle(title: string) {
    this.checkPageBreak(35);
    this.currentY -= 8;
    // Section header background box
    this.currentPageOps.push(`0.94 0.96 0.98 rg`);
    this.currentPageOps.push(`${this.margin} ${this.currentY - 4} ${this.pageWidth - this.margin * 2} 22 re f`);

    this.currentPageOps.push(`0.15 0.39 0.92 rg`);
    this.currentPageOps.push(`${this.margin} ${this.currentY - 4} 4 22 re f`); // Accent left border

    this.currentPageOps.push(`BT`);
    this.currentPageOps.push(`/F2 11 Tf`);
    this.currentPageOps.push(`0.1 0.15 0.3 rg`);
    this.currentPageOps.push(`${this.margin + 12} ${this.currentY + 2} Td`);
    this.currentPageOps.push(`(${escapePdfText(title.toUpperCase())}) Tj`);
    this.currentPageOps.push(`ET`);
    this.currentY -= 22;
  }

  public drawParagraph(text: string, isBold: boolean = false) {
    const words = text.split(' ');
    let line = '';
    const maxChars = 85;

    for (const w of words) {
      if ((line + ' ' + w).length > maxChars) {
        this.checkPageBreak(15);
        this.currentPageOps.push(`BT`);
        this.currentPageOps.push(`/${isBold ? 'F2' : 'F1'} 9.5 Tf`);
        this.currentPageOps.push(`0.2 0.25 0.3 rg`);
        this.currentPageOps.push(`${this.margin} ${this.currentY} Td`);
        this.currentPageOps.push(`(${escapePdfText(line.trim())}) Tj`);
        this.currentPageOps.push(`ET`);
        this.currentY -= 14;
        line = w;
      } else {
        line = line ? line + ' ' + w : w;
      }
    }

    if (line.trim().length > 0) {
      this.checkPageBreak(15);
      this.currentPageOps.push(`BT`);
      this.currentPageOps.push(`/${isBold ? 'F2' : 'F1'} 9.5 Tf`);
      this.currentPageOps.push(`0.2 0.25 0.3 rg`);
      this.currentPageOps.push(`${this.margin} ${this.currentY} Td`);
      this.currentPageOps.push(`(${escapePdfText(line.trim())}) Tj`);
      this.currentPageOps.push(`ET`);
      this.currentY -= 14;
    }
    this.currentY -= 4;
  }

  public drawBullet(text: string) {
    this.checkPageBreak(16);
    this.currentPageOps.push(`BT`);
    this.currentPageOps.push(`/F2 9.5 Tf`);
    this.currentPageOps.push(`0.15 0.39 0.92 rg`);
    this.currentPageOps.push(`${this.margin + 4} ${this.currentY} Td`);
    this.currentPageOps.push(`(> ) Tj`);
    this.currentPageOps.push(`ET`);

    const words = text.split(' ');
    let line = '';
    const maxChars = 80;
    let isFirst = true;

    for (const w of words) {
      if ((line + ' ' + w).length > maxChars) {
        this.checkPageBreak(14);
        this.currentPageOps.push(`BT`);
        this.currentPageOps.push(`/F1 9 Tf`);
        this.currentPageOps.push(`0.2 0.25 0.3 rg`);
        this.currentPageOps.push(`${this.margin + 18} ${this.currentY} Td`);
        this.currentPageOps.push(`(${escapePdfText(line.trim())}) Tj`);
        this.currentPageOps.push(`ET`);
        this.currentY -= 13;
        line = w;
        isFirst = false;
      } else {
        line = line ? line + ' ' + w : w;
      }
    }
    if (line.trim().length > 0) {
      this.checkPageBreak(14);
      this.currentPageOps.push(`BT`);
      this.currentPageOps.push(`/F1 9 Tf`);
      this.currentPageOps.push(`0.2 0.25 0.3 rg`);
      this.currentPageOps.push(`${this.margin + 18} ${this.currentY} Td`);
      this.currentPageOps.push(`(${escapePdfText(line.trim())}) Tj`);
      this.currentPageOps.push(`ET`);
      this.currentY -= 15;
    }
  }

  public drawKpiGrid(items: Array<{ label: string; value: string; color?: [number, number, number] }>) {
    const cols = 4;
    const cardWidth = (this.pageWidth - this.margin * 2 - (cols - 1) * 8) / cols;
    const cardHeight = 44;

    for (let i = 0; i < items.length; i += cols) {
      this.checkPageBreak(cardHeight + 10);
      const rowItems = items.slice(i, i + cols);

      for (let c = 0; c < rowItems.length; c++) {
        const item = rowItems[c];
        const x = this.margin + c * (cardWidth + 8);
        const y = this.currentY - cardHeight;

        // Card background
        this.currentPageOps.push(`0.97 0.98 0.99 rg`);
        this.currentPageOps.push(`${x} ${y} ${cardWidth} ${cardHeight} re f`);

        // Card border
        this.currentPageOps.push(`0.88 0.90 0.93 RG`);
        this.currentPageOps.push(`0.5 w`);
        this.currentPageOps.push(`${x} ${y} ${cardWidth} ${cardHeight} re S`);

        // Value
        this.currentPageOps.push(`BT`);
        this.currentPageOps.push(`/F2 13 Tf`);
        if (item.color) {
          this.currentPageOps.push(`${item.color[0]} ${item.color[1]} ${item.color[2]} rg`);
        } else {
          this.currentPageOps.push(`0.1 0.15 0.25 rg`);
        }
        this.currentPageOps.push(`${x + 8} ${y + 24} Td`);
        this.currentPageOps.push(`(${escapePdfText(item.value)}) Tj`);
        this.currentPageOps.push(`ET`);

        // Label
        this.currentPageOps.push(`BT`);
        this.currentPageOps.push(`/F1 7.5 Tf`);
        this.currentPageOps.push(`0.45 0.5 0.6 rg`);
        this.currentPageOps.push(`${x + 8} ${y + 10} Td`);
        this.currentPageOps.push(`(${escapePdfText(item.label)}) Tj`);
        this.currentPageOps.push(`ET`);
      }

      this.currentY -= cardHeight + 8;
    }
    this.currentY -= 6;
  }

  public drawTable(headers: string[], rows: string[][], colWidths: number[]) {
    const tableWidth = this.pageWidth - this.margin * 2;
    const rowHeight = 20;

    // Header
    this.checkPageBreak(rowHeight * 2);
    this.currentPageOps.push(`0.15 0.39 0.92 rg`);
    this.currentPageOps.push(`${this.margin} ${this.currentY - rowHeight} ${tableWidth} ${rowHeight} re f`);

    let curX = this.margin;
    for (let c = 0; c < headers.length; c++) {
      this.currentPageOps.push(`BT`);
      this.currentPageOps.push(`/F2 8.5 Tf`);
      this.currentPageOps.push(`1 1 1 rg`);
      this.currentPageOps.push(`${curX + 6} ${this.currentY - rowHeight + 6} Td`);
      this.currentPageOps.push(`(${escapePdfText(headers[c])}) Tj`);
      this.currentPageOps.push(`ET`);
      curX += colWidths[c];
    }
    this.currentY -= rowHeight;

    // Rows
    for (let r = 0; r < rows.length; r++) {
      this.checkPageBreak(rowHeight + 4);
      const isAlt = r % 2 === 1;

      if (isAlt) {
        this.currentPageOps.push(`0.97 0.98 0.99 rg`);
        this.currentPageOps.push(`${this.margin} ${this.currentY - rowHeight} ${tableWidth} ${rowHeight} re f`);
      }

      // Bottom border
      this.currentPageOps.push(`0.90 0.92 0.95 RG`);
      this.currentPageOps.push(`0.5 w`);
      this.currentPageOps.push(`${this.margin} ${this.currentY - rowHeight} m ${this.margin + tableWidth} ${this.currentY - rowHeight} l S`);

      curX = this.margin;
      for (let c = 0; c < rows[r].length; c++) {
        this.currentPageOps.push(`BT`);
        this.currentPageOps.push(`/F1 8 Tf`);
        this.currentPageOps.push(`0.15 0.2 0.3 rg`);
        this.currentPageOps.push(`${curX + 6} ${this.currentY - rowHeight + 6} Td`);
        this.currentPageOps.push(`(${escapePdfText(rows[r][c])}) Tj`);
        this.currentPageOps.push(`ET`);
        curX += colWidths[c];
      }
      this.currentY -= rowHeight;
    }
    this.currentY -= 8;
  }

  public toBuffer(): Buffer {
    if (this.currentPageOps.length > 0) {
      this.pages.push(this.currentPageOps.join('\n'));
      this.currentPageOps = [];
    }

    const totalPages = this.pages.length;
    const objects: string[] = [];

    // Add footer page numbers to all page streams
    const finalPageStreams = this.pages.map((streamContent, idx) => {
      const footer = [
        `0.85 0.88 0.92 RG 0.5 w`,
        `${this.margin} 40 m ${this.pageWidth - this.margin} 40 l S`,
        `BT`,
        `/F1 8 Tf 0.5 0.55 0.6 rg`,
        `${this.margin} 28 Td`,
        `(${escapePdfText(`KAIRA Voice AI Platform - Confidential Internal Business Report`)} ) Tj`,
        `ET`,
        `BT`,
        `/F1 8 Tf 0.5 0.55 0.6 rg`,
        `${this.pageWidth - this.margin - 65} 28 Td`,
        `(${escapePdfText(`Page ${idx + 1} of ${totalPages}`)} ) Tj`,
        `ET`
      ].join('\n');
      return streamContent + '\n' + footer;
    });

    // Object 1: Catalog
    // Object 2: Pages root
    // Object 3: Font Helvetica (F1)
    // Object 4: Font Helvetica-Bold (F2)
    // Objects 5 .. 4 + totalPages: Page objects
    // Objects 5 + totalPages .. 4 + 2*totalPages: Content streams

    const pageObjStart = 5;
    const contentObjStart = pageObjStart + totalPages;

    const pageObjRefs = Array.from({ length: totalPages }, (_, i) => `${pageObjStart + i} 0 R`).join(' ');

    objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj`);
    objects.push(`2 0 obj\n<< /Type /Pages /Kids [${pageObjRefs}] /Count ${totalPages} >>\nendobj`);
    objects.push(`3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj`);
    objects.push(`4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj`);

    for (let i = 0; i < totalPages; i++) {
      const contentRef = `${contentObjStart + i} 0 R`;
      objects.push(
        `${pageObjStart + i} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.pageWidth} ${this.pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentRef} >>\nendobj`
      );
    }

    for (let i = 0; i < totalPages; i++) {
      const stream = Buffer.from(finalPageStreams[i], 'latin1');
      objects.push(
        `${contentObjStart + i} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream.toString('latin1')}\nendstream\nendobj`
      );
    }

    // Assemble PDF file with xref
    let offset = 15; // length of header '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
    const header = `%PDF-1.4\n%\xE2\xE3\xCF\xD3\n`;
    const offsets: number[] = [];

    const objStrings: string[] = [];
    for (const obj of objects) {
      offsets.push(offset);
      const str = obj + '\n';
      objStrings.push(str);
      offset += Buffer.byteLength(str, 'latin1');
    }

    const startXref = offset;
    const totalObjs = objects.length + 1; // 0 + objects
    let xref = `xref\n0 ${totalObjs}\n0000000000 65535 f \n`;
    for (const off of offsets) {
      xref += off.toString().padStart(10, '0') + ` 00000 n \n`;
    }

    const trailer = `trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;

    const fullPdf = header + objStrings.join('') + xref + trailer;
    return Buffer.from(fullPdf, 'latin1');
  }
}

/**
 * Generates a full professional Business Intelligence PDF Report
 */
export function generateBiPdfDocument(data: ReportPdfData): Buffer {
  const doc = new SimplePdfDocument();

  // Heading & Metadata
  doc.drawHeading(data.title, `Reporting Period: ${data.startDate} to ${data.endDate} | Generated: ${data.generatedAt} (By: ${data.generatedBy})`);

  // Section 1: Executive Summary
  doc.drawSectionTitle('1. Executive Summary & Key Observations');
  if (data.executiveSummary.length === 0) {
    doc.drawParagraph('No executive summary observations recorded for this reporting period.');
  } else {
    for (const obs of data.executiveSummary) {
      doc.drawBullet(obs);
    }
  }

  // Section 2: Key Performance Indicators
  doc.drawSectionTitle('2. Key Performance Indicators (Actual Database Totals)');
  doc.drawKpiGrid([
    { label: 'Total Calls', value: data.kpis.totalCalls.toString(), color: [0.15, 0.39, 0.92] },
    { label: 'Completed Calls', value: data.kpis.completedCalls.toString(), color: [0.13, 0.69, 0.33] },
    { label: 'Missed Calls', value: data.kpis.missedCalls.toString(), color: [0.93, 0.27, 0.27] },
    { label: 'Transferred Calls', value: data.kpis.transferredCalls.toString(), color: [0.95, 0.55, 0.15] },
    { label: 'Avg Duration', value: data.kpis.averageDuration },
    { label: 'Unique Customers', value: data.kpis.uniqueCustomers.toString() },
    { label: 'Active Agents', value: data.kpis.activeAgents.toString() },
    { label: 'Assistance Needed', value: data.kpis.callsRequiringAssistance.toString(), color: [0.93, 0.27, 0.27] }
  ]);

  // Section 3: Customer Sentiment Distribution
  doc.drawSectionTitle('3. Customer Conversation Sentiment Analysis');
  doc.drawKpiGrid([
    { label: 'Positive Calls', value: `${data.sentimentBreakdown.positive} (${data.kpis.positivePct}%)`, color: [0.13, 0.69, 0.33] },
    { label: 'Neutral Calls', value: `${data.sentimentBreakdown.neutral} (${data.kpis.neutralPct}%)`, color: [0.23, 0.51, 0.96] },
    { label: 'Negative Calls', value: `${data.sentimentBreakdown.negative} (${data.kpis.negativePct}%)`, color: [0.95, 0.55, 0.15] },
    { label: 'Frustrated Calls', value: `${data.sentimentBreakdown.frustrated} (${data.kpis.frustratedPct}%)`, color: [0.93, 0.27, 0.27] }
  ]);

  // Section 4: Most Frequently Reported Customer Issues
  doc.drawSectionTitle('4. Customer Issue & Intent Analysis');
  const issueHeaders = ['Customer Issue Classification', 'Call Volume', 'Percentage Share', 'Recommended Action'];
  const issueColWidths = [210, 80, 95, 120];
  const issueRows = data.issueBreakdown.map((item) => [
    item.category,
    `${item.count} calls`,
    `${item.percentage}%`,
    item.percentage > 25 ? 'Prioritize KB Grounding' : 'Routine Monitoring'
  ]);
  doc.drawTable(issueHeaders, issueRows, issueColWidths);

  // Section 5: Support Specialist & Agent Performance
  doc.drawSectionTitle('5. Support Agent & Specialist Performance');
  const agentHeaders = ['Agent / Specialist', 'Calls Handled', 'Completed', 'Transferred', 'Avg Duration', 'Sentiment'];
  const agentColWidths = [140, 75, 65, 70, 75, 80];
  const agentRows =
    data.agentPerformance.length > 0
      ? data.agentPerformance.map((a) => [a.name, a.callsHandled.toString(), a.completed.toString(), a.transferred.toString(), a.avgDuration, a.sentimentSummary])
      : [['No agent calls recorded in this period', '-', '-', '-', '-', '-']];
  doc.drawTable(agentHeaders, agentRows, agentColWidths);

  // Section 6: Strategic Recommendations
  doc.drawSectionTitle('6. Strategic Recommendations & Key Findings');
  if (data.keyFindings.length === 0) {
    doc.drawParagraph('Standard operational stability maintained. Continuous monitoring of voice call quality recommended.');
  } else {
    for (const finding of data.keyFindings) {
      doc.drawBullet(finding);
    }
  }

  return doc.toBuffer();
}

/**
 * Saves generated PDF buffer to disk in reports directory
 */
export function saveReportPdf(filename: string, buffer: Buffer): string {
  const reportsDir = path.resolve(process.cwd(), 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  const filePath = path.resolve(reportsDir, filename);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

