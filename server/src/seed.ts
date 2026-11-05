import bcrypt from 'bcryptjs';
import { prisma } from './db.js';

export async function seedDatabase() {
  console.log('--- Initializing KAIRA Database ---');

  // Check if Admin exists
  const existingAdmin = await prisma.user.findFirst({
    where: { email: 'admin@kaira' }
  });

  const passwordHash = await bcrypt.hash('kaira@123', 10);

  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        name: 'KAIRA Administrator',
        email: 'admin@kaira',
        phone: '+1 (555) 019-2834',
        role: 'admin',
        passwordHash,
      }
    });
    console.log('✓ Admin account created: admin@kaira');
  } else {
    // Ensure password is up to date
    await prisma.user.update({
      where: { id: existingAdmin.id },
      data: { passwordHash, role: 'admin' }
    });
    console.log('✓ Admin account verified');
  }

  // Check if Agent exists
  const existingAgent = await prisma.user.findFirst({
    where: { email: 'agent@kaira' }
  });

  if (!existingAgent) {
    await prisma.user.create({
      data: {
        name: 'Sarah Jenkins (Senior Agent)',
        email: 'agent@kaira',
        phone: '+1 (555) 018-9921',
        role: 'agent',
        passwordHash,
      }
    });
    console.log('✓ Agent account created: agent@kaira');
  } else {
    await prisma.user.update({
      where: { id: existingAgent.id },
      data: { passwordHash, role: 'agent' }
    });
    console.log('✓ Agent account verified');
  }

  // Seed sample customers if none exist
  const customerCount = await prisma.user.count({
    where: { role: 'customer' }
  });

  if (customerCount === 0) {
    const cust1 = await prisma.user.create({
      data: {
        name: 'Alex Morgan',
        email: 'alex.morgan@example.com',
        phone: '+1 (555) 234-5678',
        role: 'customer',
        passwordHash: await bcrypt.hash('customer@123', 10),
      }
    });

    const cust2 = await prisma.user.create({
      data: {
        name: 'Emily Zhang',
        email: 'emily.zhang@example.com',
        phone: '+1 (555) 876-5432',
        role: 'customer',
        passwordHash: await bcrypt.hash('customer@123', 10),
      }
    });

    console.log('✓ Sample customers created');
  }

  // Seed Knowledge Base entries if none exist
  const kbCount = await prisma.knowledgeEntry.count();
  if (kbCount === 0) {
    const entries = [
      {
        title: 'Company Overview & Mission',
        category: 'company',
        question: 'What is KAIRA and what does the company do?',
        answer: 'KAIRA is an AI-powered enterprise customer communication and autonomous voice agent platform. We enable businesses to deploy ultra-low-latency, bidirectional AI voice agents that resolve customer queries autonomously while providing seamless real-time escalation to human administrators when needed.',
        content: 'KAIRA was established in 2024 to modernize enterprise voice communications. Our proprietary voice core achieves sub-second response latency, integrates with CRM systems, and ensures 100% grounded answers using verified corporate knowledge bases.',
        keywords: 'kaira, company, mission, overview, voice agent, communication'
      },
      {
        title: 'Core Voice Products & Capabilities',
        category: 'products',
        question: 'What products does KAIRA offer?',
        answer: 'KAIRA offers three primary products: KAIRA VoiceCore (autonomous bidirectional AI voice agent), KAIRA LiveEscalate (real-time voice call transfer to human administrators and agents), and KAIRA Omnichannel Hub (centralized call analytics and monitoring).',
        content: '1. KAIRA VoiceCore: Natural conversational voice AI handling inbound customer calls with natural speech recognition and grounded responses.\n2. KAIRA LiveEscalate: Zero-drop audio transfer protocol that connects customers directly to Admin when the AI encounters ungrounded questions.\n3. KAIRA Omnichannel Hub: Real-time transcript inspection, customer management, and compliance auditing.',
        keywords: 'products, voicecore, liveescalate, omnichannel, capabilities, voice agent'
      },
      {
        title: 'Subscription Pricing & Plans',
        category: 'pricing',
        question: 'What are the pricing plans for KAIRA?',
        answer: 'KAIRA offers three subscription plans: Starter at $49/month (500 voice minutes), Professional at $199/month (2,500 voice minutes, includes live human transfer), and Enterprise at $799/month (unlimited knowledge bases, dedicated WebRTC SIP trunking, 24/7 SLA).',
        content: '- Starter Plan: $49 per month. Includes 500 voice minutes, 1 knowledge base, standard email support.\n- Professional Plan: $199 per month. Includes 2,500 voice minutes, 5 knowledge bases, real-time live transfer to human agents, priority email & chat support.\n- Enterprise Plan: $799 per month. Custom minutes, unlimited knowledge bases, dedicated WebRTC SIP trunking, 99.99% uptime SLA, and a dedicated 24/7 account manager.',
        keywords: 'pricing, plans, cost, subscription, starter, professional, enterprise, price'
      },
      {
        title: 'Business Operating Hours & Support Availability',
        category: 'support',
        question: 'What are KAIRA\'s operating hours and support availability?',
        answer: 'KAIRA AI voice agents operate 24/7/365. Human administrators and live support specialists are available Monday through Friday from 8:00 AM to 8:00 PM EST. Enterprise plan customers receive 24/7 human emergency escalation.',
        content: 'Our automated voice systems are always online. Live transfer to human staff operates standard business hours (8am - 8pm EST weekdays). If an admin is unavailable outside these hours, customer questions are queued in the Admin pending follow-up console.',
        keywords: 'hours, operating hours, support, availability, schedule, contact times'
      },
      {
        title: 'Refund & Cancellation Policy',
        category: 'policies',
        question: 'What is KAIRA\'s refund policy?',
        answer: 'KAIRA provides a 30-day money-back guarantee for all new monthly and annual subscriptions. If you are not completely satisfied with our voice agent performance, you can request a full refund within 30 days of initial purchase with no cancellation fees.',
        content: 'Customers can cancel their subscription at any time via the billing portal. Refunds requested within 30 days of purchase are processed within 3-5 business days back to the original payment method.',
        keywords: 'refund, cancellation, policy, money back, guarantee, return'
      },
      {
        title: 'Security, Compliance & Data Privacy',
        category: 'policies',
        question: 'Is KAIRA secure and compliant with data privacy regulations?',
        answer: 'Yes, KAIRA is SOC2 Type II certified and GDPR compliant, with a HIPAA-eligible architecture for healthcare clients. All audio streams and transcripts are encrypted in transit using TLS 1.3 and at rest using AES-256.',
        content: 'We adhere to strict data segregation. Customer voice recordings and transcripts are retained according to the company\'s configured retention window. Zero customer voice data is used to train public foundational models.',
        keywords: 'security, compliance, gdpr, hipaa, soc2, encryption, privacy'
      },
      {
        title: 'Automatic Call Transfer to Admin Workflow',
        category: 'faq',
        question: 'How does the automatic call transfer to Admin work?',
        answer: 'When a customer asks a question that is not covered in KAIRA\'s approved Knowledge Base, the AI voice agent politely informs the customer and immediately initiates a live voice transfer to the Admin. The Admin receives a real-time incoming call notification with the customer\'s question and reason, and upon accepting, enters a live bidirectional voice conversation.',
        content: 'The transfer is seamless and preserves the active voice session. If the Admin is busy or rejects the call, the customer is notified, and their contact information and question are saved in the Admin\'s pending follow-up queue.',
        keywords: 'transfer, live transfer, admin escalation, call transfer, human handoff'
      },
      {
        title: 'Supported Document Formats for Knowledge Base',
        category: 'services',
        question: 'What document formats can be uploaded to KAIRA Knowledge Base?',
        answer: 'KAIRA supports direct PDF documents (.pdf) and Microsoft Word documents (.docx), as well as direct text entry for Question & Answer pairs. Uploaded documents are automatically parsed, sectioned, indexed, and made available to the AI agent instantly.',
        content: 'Administrators can upload product manuals, pricing sheets, support guides, and policy handbooks in PDF or DOCX format. The system extracts full text, parses headings and bullet points, and builds a grounded retrieval index.',
        keywords: 'upload, pdf, docx, documents, knowledge base, formats'
      }
    ];

    for (const entry of entries) {
      await prisma.knowledgeEntry.create({ data: entry });
    }
    console.log(`✓ Seeded ${entries.length} official KAIRA Knowledge Base entries`);
  }

  console.log('--- Database Initialization Complete ---');
}

// Allow standalone execution
if (process.argv[1]?.includes('seed')) {
  seedDatabase()
    .then(() => {
      console.log('Seed finished successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}

