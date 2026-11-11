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

  // Check if Customer exists (customer@kaira & raviarun2004@gmail.com)
  const existingCustomer = await prisma.user.findFirst({
    where: { email: 'customer@kaira' }
  });
  if (!existingCustomer) {
    await prisma.user.create({
      data: {
        name: 'Ravi Arun (Customer)',
        email: 'customer@kaira',
        phone: '+1 (555) 789-0123',
        role: 'customer',
        passwordHash,
      }
    });
    console.log('✓ Customer account created: customer@kaira');
  } else {
    await prisma.user.update({
      where: { id: existingCustomer.id },
      data: { passwordHash, role: 'customer' }
    });
  }

  // Ensure raviarun2004@gmail.com exists with password so the user can test with their real Google email
  const existingRavi = await prisma.user.findFirst({
    where: { email: 'raviarun2004@gmail.com' }
  });
  if (!existingRavi) {
    await prisma.user.create({
      data: {
        name: 'raviarun',
        email: 'raviarun2004@gmail.com',
        phone: '+1 (555) 999-0001',
        role: 'customer',
        passwordHash,
      }
    });
    console.log('✓ Customer account created: raviarun2004@gmail.com');
  } else {
    await prisma.user.update({
      where: { id: existingRavi.id },
      data: { passwordHash, role: 'customer' }
    });
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

  await seedDefaultKnowledgeEntries();
  console.log('--- Database Initialization Complete ---');
}

export const DEFAULT_KNOWLEDGE_ENTRIES = [
  {
    title: 'Company Overview & Mission',
    category: 'company',
    question: 'What is KAIRA and what does the company do?',
    answer: 'KAIRA is an AI-powered enterprise customer communication and autonomous voice agent platform. We enable businesses to deploy ultra-low-latency, bidirectional AI voice agents that resolve customer queries autonomously while providing seamless real-time escalation to human administrators when needed.',
    content: 'KAIRA was established in 2024 to modernize enterprise voice communications. Our proprietary voice core achieves sub-second response latency, integrates with CRM systems, and ensures 100% grounded answers using verified corporate knowledge bases.',
    keywords: 'kaira, company, mission, overview, voice agent, communication, about'
  },
  {
    title: 'Official Headquarters & Global Offices',
    category: 'company',
    question: 'Where is KAIRA headquartered and where are your offices located?',
    answer: 'KAIRA is headquartered at 500 Howard Street, Suite 400, San Francisco, California 94105, United States, with regional technology hubs in London, United Kingdom and Bengaluru, India.',
    content: 'Corporate Headquarters: KAIRA Technologies Inc., 500 Howard Street, Suite 400, San Francisco, CA 94105, USA. International operations are supported from London (EMEA hub) and Bengaluru (APAC hub).',
    keywords: 'headquarters, location, office, address, san francisco, where located, based'
  },
  {
    title: 'Official Support Email & Contact Phone',
    category: 'company',
    question: 'How can I contact KAIRA customer support by phone or email?',
    answer: 'You can reach KAIRA support by emailing support@kaira.ai or calling our toll-free phone number at +1 (800) 555-5247. Enterprise customers also have access to a dedicated Slack and Microsoft Teams bridge.',
    content: 'Primary Email: support@kaira.ai. Sales Inquiries: sales@kaira.ai. Global Toll-Free Phone: +1 (800) 555-5247 / +1 (800) 555-KAIR. Business Hours: Monday to Friday, 8:00 AM to 8:00 PM EST.',
    keywords: 'contact, email, phone, phone number, call us, reach, telephone, contact info'
  },
  {
    title: 'Official Website & Documentation Links',
    category: 'company',
    question: 'What is KAIRA\'s official website and documentation portal?',
    answer: 'Our official platform website is located at https://kaira.ai and our developer and administrator documentation is accessible at https://docs.kaira.ai.',
    content: 'Platform Website: https://kaira.ai. Documentation: https://docs.kaira.ai. Status Page: https://status.kaira.ai. Community Portal: https://community.kaira.ai.',
    keywords: 'website, link, docs, documentation, portal, url, web'
  },
  {
    title: 'Core Voice Products & Capabilities',
    category: 'products',
    question: 'What products does KAIRA offer?',
    answer: 'KAIRA offers three primary products: KAIRA VoiceCore (autonomous bidirectional AI voice agent), KAIRA LiveEscalate (real-time voice call transfer to human administrators and agents), and KAIRA Omnichannel Hub (centralized call analytics, tickets, and monitoring).',
    content: '1. KAIRA VoiceCore: Natural conversational voice AI handling inbound customer calls with natural speech recognition and grounded responses.\n2. KAIRA LiveEscalate: Zero-drop audio transfer protocol that connects customers directly to Admin when the AI encounters ungrounded questions.\n3. KAIRA Omnichannel Hub: Real-time transcript inspection, customer management, and compliance auditing.',
    keywords: 'products, voicecore, liveescalate, omnichannel, capabilities, voice agent, features'
  },
  {
    title: 'How Does the AI Voice Agent Work?',
    category: 'products',
    question: 'How does the KAIRA AI voice agent work behind the scenes?',
    answer: 'KAIRA captures your voice using WebRTC and Web Speech recognition, grounds the query against verified company knowledge, and generates conversational speech in under 400 milliseconds. If the answer is unverified, it automatically transfers the call to a human administrator.',
    content: 'The system uses bidirectional WebSockets, neural speech recognition, strict retrieval-augmented grounding (RAG), and WebRTC audio pipelines to guarantee zero hallucinations and instantaneous live voice response.',
    keywords: 'how works, technology, voice agent, architecture, ai voice, speech recognition'
  },
  {
    title: 'Multilingual Voice Support & Regional Languages',
    category: 'products',
    question: 'What languages does KAIRA support for voice calls?',
    answer: 'KAIRA supports 5 regional languages: English, Tamil (தமிழ்), Telugu (తెలుగు), Malayalam (മലയാളം), and Hindi (हिन्दी), with real-time speech recognition, text-to-speech, and automatic live transcript translation.',
    content: 'Supported Regional Languages: English (en-US), Tamil (ta-IN), Telugu (te-IN), Malayalam (ml-IN), and Hindi (hi-IN). Both customer voice recognition and agent live console support real-time cross-language interpretation.',
    keywords: 'languages, multilingual, tamil, telugu, malayalam, hindi, english, regional'
  },
  {
    title: 'CRM and Helpdesk Integrations',
    category: 'products',
    question: 'Does KAIRA integrate with external CRMs like Salesforce or Zendesk?',
    answer: 'Yes, KAIRA provides pre-built bidirectional integrations with Salesforce, HubSpot, Zendesk, Zoho CRM, and custom internal systems via REST webhooks and WebRTC SIP trunks.',
    content: 'Customer call logs, recordings, sentiment ratings, and conversation transcripts automatically sync to contact timelines in Salesforce, HubSpot, and Zendesk via secure OAuth webhooks.',
    keywords: 'integrations, crm, salesforce, hubspot, zendesk, zoho, webhooks, api'
  },
  {
    title: 'Custom Voice, Accent and Tone Tuning',
    category: 'products',
    question: 'Can we customize the AI voice, accent, or speaking style?',
    answer: 'Yes! Administrators can customize speech rate, pitch, language accent, greeting scripts, and conversational tone (Professional, Friendly, or Technical) directly from the Admin settings console.',
    content: 'KAIRA supports custom voice personas, regional accent selection, pronunciation dictionaries for proprietary brand names, and adjustable greeting messages for each phone line.',
    keywords: 'voice, accent, tone, customize, speech rate, pitch, persona, custom voice'
  },
  {
    title: 'Subscription Pricing & Plans',
    category: 'pricing',
    question: 'What are the pricing plans for KAIRA?',
    answer: 'KAIRA offers three subscription plans: Starter at $49/month (500 voice minutes), Professional at $199/month (2,500 voice minutes, includes live human transfer), and Enterprise at $799/month (unlimited knowledge bases, dedicated WebRTC SIP trunking, 24/7 SLA).',
    content: '- Starter Plan: $49 per month. Includes 500 voice minutes, 1 knowledge base, standard email support.\n- Professional Plan: $199 per month. Includes 2,500 voice minutes, 5 knowledge bases, real-time live transfer to human agents, priority email & chat support.\n- Enterprise Plan: $799 per month. Custom minutes, unlimited knowledge bases, dedicated WebRTC SIP trunking, 99.99% uptime SLA, and a dedicated 24/7 account manager.',
    keywords: 'pricing, plans, cost, subscription, starter, professional, enterprise, price, how much'
  },
  {
    title: 'Free Trial Duration & Inclusions',
    category: 'pricing',
    question: 'Do you offer a free trial for KAIRA and what is included?',
    answer: 'Yes, KAIRA offers a 14-day free trial with 100 complimentary voice minutes, full access to the AI voice agent, document upload, and the live transfer console. No credit card is required to sign up.',
    content: 'Free Trial Terms: 14 consecutive calendar days from registration, 100 voice minutes, 1 document upload up to 10MB, up to 2 agent accounts. Upgrades can be activated at any time without downtime.',
    keywords: 'free trial, trial, test, free minutes, demo, try for free, cost free'
  },
  {
    title: 'Accepted Payment Methods & Invoicing',
    category: 'pricing',
    question: 'What payment methods do you accept and do you support corporate invoicing?',
    answer: 'We accept all major credit and debit cards (Visa, MasterCard, American Express), PayPal, ACH bank transfers, UPI for India, and net-30 corporate purchase orders for annual Enterprise accounts.',
    content: 'Payment Processing: Stripe PCI-DSS Level 1 certified gateway. Invoices are automatically delivered via email upon renewal and downloadable from the customer billing dashboard.',
    keywords: 'payment, credit card, visa, mastercard, paypal, ach, wire, upi, invoice, billing'
  },
  {
    title: 'Annual Billing Discounts & Upgrades',
    category: 'pricing',
    question: 'Do you offer discounts for annual upfront payments?',
    answer: 'Yes, customers who choose annual upfront billing receive a 20% discount on all plans, equivalent to more than two months of free service every year.',
    content: 'Annual commitments receive a 20% flat discount: Starter is $470/year (saves $118), Professional is $1,910/year (saves $478), and Enterprise starts at $7,670/year.',
    keywords: 'annual, yearly, discount, annual plan, savings, 20 percent discount'
  },
  {
    title: 'Voice Minute Limits & Overage Rates',
    category: 'pricing',
    question: 'What happens if we exceed our included voice minutes in a month?',
    answer: 'If you exceed your monthly plan minutes, additional calls continue uninterrupted at a standard overage rate of $0.04 per minute. You can also upgrade your tier anytime with prorated billing.',
    content: 'Overage Policy: Calls are never cut off. Overage is billed at $0.04/minute on Starter/Professional and $0.025/minute on Enterprise. Admins receive automated usage warning emails at 80% and 95% thresholds.',
    keywords: 'overage, extra minutes, exceed, limit, minute rate, additional minutes'
  },
  {
    title: 'Business Operating Hours & Support Availability',
    category: 'support',
    question: 'What are KAIRA\'s operating hours and support availability?',
    answer: 'KAIRA AI voice agents operate 24/7/365. Human administrators and live support specialists are available Monday through Friday from 8:00 AM to 8:00 PM EST. Enterprise plan customers receive 24/7 human emergency escalation.',
    content: 'Our automated voice systems are always online. Live transfer to human staff operates standard business hours (8am - 8pm EST weekdays). If an admin is unavailable outside these hours, customer questions are queued in the Admin pending follow-up console.',
    keywords: 'hours, operating hours, support, availability, schedule, contact times, business hours'
  },
  {
    title: 'Automatic Call Transfer to Admin Workflow',
    category: 'support',
    question: 'How does the automatic call transfer to Admin work?',
    answer: 'When a customer asks a question that is not covered in KAIRA\'s approved Knowledge Base, the AI voice agent politely informs the customer and immediately initiates a live voice transfer to the Admin. The Admin receives a real-time incoming call notification with the customer\'s question and reason, and upon accepting, enters a live bidirectional voice conversation.',
    content: 'The transfer is seamless and preserves the active voice session. If the Admin is busy or rejects the call, the customer is notified, and their contact information and question are saved in the Admin\'s pending follow-up queue.',
    keywords: 'transfer, live transfer, admin escalation, call transfer, human handoff, escalate'
  },
  {
    title: 'How to Request a Live Human Agent or Admin',
    category: 'support',
    question: 'Can I speak directly with a human support agent or administrator?',
    answer: 'Yes! You can say "Connect me to an Admin" or "Speak to a human" at any time during an AI voice call, or click the "Connect with Support Agent" button on your dashboard to enter the live agent queue.',
    content: 'Customers have the right to request human assistance at any point. The voice agent immediately yields audio and initiates an prioritized WebRTC call to available support specialists.',
    keywords: 'speak to human, talk to admin, human agent, live person, representative, talk to someone'
  },
  {
    title: 'Support Ticket Response Times & SLA',
    category: 'support',
    question: 'What are the response time SLAs for submitted support tickets?',
    answer: 'Urgent priority tickets receive a guaranteed response within 1 hour. High priority tickets are addressed within 4 hours, and standard or low priority tickets are resolved within 24 business hours.',
    content: 'Ticket SLAs: Urgent (production outage): < 1 hour. High (critical feature impaired): < 4 hours. Medium (general inquiry): < 12 hours. Low (feature request): < 24 business hours.',
    keywords: 'ticket, sla, response time, turnaround, support ticket, resolution time'
  },
  {
    title: 'Technical Support Escalation Channels',
    category: 'support',
    question: 'What channels can I use to get technical help?',
    answer: 'You can submit a ticket from the Support Tickets tab, initiate a live voice call from the Customer Dashboard, email support@kaira.ai, or access the Knowledge Base search copilot.',
    content: 'Available Support Channels: 1. In-App AI Voice Assistant (instant). 2. Live Agent WebRTC Calling. 3. Support Ticket Portal. 4. Email: support@kaira.ai. 5. Admin Live Chat Console.',
    keywords: 'help, technical support, channels, assistance, contact options, trouble'
  },
  {
    title: 'Refund & Cancellation Policy',
    category: 'policies',
    question: 'What is KAIRA\'s refund policy?',
    answer: 'KAIRA provides a 30-day money-back guarantee for all new monthly and annual subscriptions. If you are not completely satisfied with our voice agent performance, you can request a full refund within 30 days of initial purchase with no cancellation fees.',
    content: 'Customers can cancel their subscription at any time via the billing portal. Refunds requested within 30 days of purchase are processed within 3-5 business days back to the original payment method.',
    keywords: 'refund, cancellation, policy, money back, guarantee, return, cancel subscription'
  },
  {
    title: 'Security, Compliance & Data Privacy',
    category: 'policies',
    question: 'Is KAIRA secure and compliant with data privacy regulations?',
    answer: 'Yes, KAIRA is SOC2 Type II certified and GDPR compliant, with a HIPAA-eligible architecture for healthcare clients. All audio streams and transcripts are encrypted in transit using TLS 1.3 and at rest using AES-256.',
    content: 'We adhere to strict data segregation. Customer voice recordings and transcripts are retained according to the company\'s configured retention window. Zero customer voice data is used to train public foundational models.',
    keywords: 'security, compliance, gdpr, hipaa, soc2, encryption, privacy, data safety'
  },
  {
    title: 'Call Recording & Consent Regulations',
    category: 'policies',
    question: 'Are calls recorded and does KAIRA comply with recording consent laws?',
    answer: 'Call recording is fully configurable by the Administrator. When enabled, KAIRA plays an automated two-party consent announcement complying with FCC, GDPR, and California privacy regulations.',
    content: 'Recording compliance: Admins can toggle recording per phone line, configure custom consent disclosure audio, and automatically mask PCI/PII data in transcripts using automated redaction.',
    keywords: 'recording, consent, call recording, privacy, two-party consent, audio recording'
  },
  {
    title: 'Data Retention and Deletion Policy',
    category: 'policies',
    question: 'How long are call transcripts and customer records retained?',
    answer: 'By default, call records and transcripts are retained for 90 days. Customers can request immediate deletion under GDPR and CCPA "Right to Be Forgotten" by contacting privacy@kaira.ai.',
    content: 'Data Retention Window: Configurable between 30 days and 7 years. Automated hard-deletion purges database rows and storage buckets upon expiration.',
    keywords: 'retention, deletion, gdpr, data privacy, delete account, purge, record storage'
  },
  {
    title: 'Supported Document Formats for Knowledge Base',
    category: 'faq',
    question: 'What document formats can be uploaded to KAIRA Knowledge Base?',
    answer: 'KAIRA supports direct PDF documents (.pdf) and Microsoft Word documents (.docx), as well as direct text entry for Question & Answer pairs. Uploaded documents are automatically parsed, sectioned, indexed, and made available to the AI agent instantly.',
    content: 'Administrators can upload product manuals, pricing sheets, support guides, and policy handbooks in PDF or DOCX format. The system extracts full text, parses headings and bullet points, and builds a grounded retrieval index.',
    keywords: 'upload, pdf, docx, documents, knowledge base, formats, files'
  },
  {
    title: 'Minimum Internet Speed and Network Requirements',
    category: 'faq',
    question: 'What are the network and internet speed requirements for voice calls?',
    answer: 'KAIRA requires a minimum internet connection speed of 100 kilobits per second per active call, with under 150 milliseconds of latency and less than 1 percent packet loss for crystal-clear HD audio.',
    content: 'Network Requirements: 100 Kbps upstream and downstream per call. WebRTC over UDP ports 10000-20000 or secure TLS fallback. Works smoothly over 4G, 5G, Wi-Fi, and Ethernet connections.',
    keywords: 'network, internet speed, bandwidth, connection, latency, requirements, wifi'
  },
  {
    title: 'Recommended Microphones and Headsets',
    category: 'faq',
    question: 'What microphones or audio headsets are recommended for best voice clarity?',
    answer: 'Any standard USB, 3.5mm, or Bluetooth headset with built-in echo cancellation works well. Noise-canceling headsets from Jabra, Plantronics, Logitech, or standard Apple AirPods deliver optimal voice recognition.',
    content: 'For best results, use a headset with a directional microphone and hardware noise suppression to prevent room echoes from interfering with voice recognition.',
    keywords: 'microphone, headset, audio, headphones, mic, airpods, hardware, echo cancellation'
  },
  {
    title: 'Web Browser and Device Compatibility',
    category: 'faq',
    question: 'Which web browsers and devices support KAIRA Voice AI?',
    answer: 'KAIRA is fully supported on modern web browsers including Google Chrome, Microsoft Edge, Apple Safari, and Mozilla Firefox across Windows, macOS, Linux, iOS, and Android devices.',
    content: 'Browser Compatibility: Google Chrome 90+, Microsoft Edge 90+, Apple Safari 14.1+, Mozilla Firefox 88+. Requires browser permission for Microphone access.',
    keywords: 'browser, chrome, safari, edge, firefox, mobile, iphone, android, compatibility'
  },
  {
    title: 'Troubleshooting Microphone and Audio Issues',
    category: 'faq',
    question: 'How do I fix microphone permissions or audio echo issues?',
    answer: 'Click the padlock or tune icon on the left of your browser address bar, set "Microphone" to "Allow", and reload the page. For audio echo, lower your speaker volume or wear a headset so the mic does not hear the speakers.',
    content: 'Troubleshooting Guide: 1. Chrome/Edge: Click Lock Icon -> Site Settings -> Microphone -> Allow. 2. Windows: Settings -> Privacy -> Microphone -> Allow apps to access microphone. 3. Echo Fix: Wear headphones to eliminate acoustic feedback.',
    keywords: 'troubleshoot, microphone, mic not working, permission, fix audio, echo, problem'
  }
];

export async function seedDefaultKnowledgeEntries(): Promise<number> {
  console.log(`--- Seeding ${DEFAULT_KNOWLEDGE_ENTRIES.length} Knowledge Base Entries ---`);
  let count = 0;
  for (const entry of DEFAULT_KNOWLEDGE_ENTRIES) {
    const existing = await prisma.knowledgeEntry.findFirst({
      where: { title: entry.title }
    });

    if (existing) {
      await prisma.knowledgeEntry.update({
        where: { id: existing.id },
        data: entry
      });
    } else {
      await prisma.knowledgeEntry.create({
        data: entry
      });
    }
    count++;
  }
  console.log(`✓ Seeded / Updated ${count} Knowledge Base entries successfully.`);
  return count;
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

