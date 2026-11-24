import fs from 'fs';
import path from 'path';
import { extractDocumentText } from '../services/documentProcessor.js';

async function check() {
  const pdfPath = path.join(process.cwd(), 'server', 'data', 'KAIRA_100_Customer_Questions_and_Answers.pdf');
  const res = await extractDocumentText(pdfPath, 'application/pdf');
  console.log('PAGE 1 TEXT:');
  console.log(res.pages[0].text);
  console.log('\nPAGE 2 FIRST 500 CHARS:');
  console.log(res.pages[1].text.slice(0, 500));
}
check();
