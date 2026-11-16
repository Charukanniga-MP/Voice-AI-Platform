import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

export const OFFICIAL_FAQ_DATA = [
  // SECTION A: KAIRA Overview and Core Capabilities
  {
    section: 'A. KAIRA Overview and Core Capabilities',
    page: 2,
    category: 'company',
    qa: [
      { q: '1. What is KAIRA?', a: 'KAIRA is a multilingual voice-based customer support platform that supports AI assistance and live human-agent calls.' },
      { q: '2. What is the main purpose of KAIRA?', a: 'It helps customers get support through natural voice conversations, approved company information, and human-agent assistance.' },
      { q: '3. Can customers speak instead of typing?', a: 'Yes. The intended experience is voice-first: customers speak and receive spoken responses during a call.' },
      { q: '4. Does KAIRA support human agents?', a: 'Yes. Customers can connect with human support agents, and agents can take over an AI-assisted call.' },
      { q: '5. Can KAIRA answer company-specific questions?', a: 'Yes, when the relevant information is included in the approved Knowledge Base.' },
      { q: '6. Can KAIRA answer general questions?', a: 'The platform is designed to use its AI model for general questions and approved Knowledge Base content for company-specific questions.' },
      { q: '7. What if the answer is not in the Knowledge Base?', a: 'KAIRA should say the information is unavailable and offer human assistance instead of guessing.' },
      { q: '8. Can KAIRA invent prices or policies?', a: 'No. Company-specific facts must be supported by approved information.' },
      { q: '9. Does KAIRA support live calls?', a: 'Yes. The platform includes real-time customer-to-agent calling using WebRTC.' },
      { q: '10. Can customers start a support call from the dashboard?', a: 'Yes. The customer dashboard is designed to let logged-in customers initiate support calls.' },
      { q: '11. Can agents receive incoming calls?', a: 'Yes. The agent dashboard is designed to display incoming call activity for agents.' },
      { q: '12. Can an agent take over an AI call?', a: 'Yes. Human takeover is supported, and AI speech should stop when the agent takes control.' },
      { q: '13. Can AI and a human agent speak at the same time?', a: 'No. The intended single-speaker design prevents overlapping AI and human-agent speech.' },
      { q: '14. Does KAIRA prevent duplicate AI responses?', a: 'Yes. Voice-output controls and server-side session handling are designed to prevent duplicate speech.' },
      { q: '15. Does KAIRA play the greeting more than once?', a: 'The call-session logic is designed to play the greeting only once per call.' },
      { q: '16. Can customers interrupt the AI?', a: 'The platform is designed to support barge-in and interruption handling, subject to call and audio conditions.' },
      { q: '17. Does KAIRA remember earlier turns in a call?', a: 'The conversation flow is designed to retain multi-turn context for follow-up questions.' },
      { q: '18. Can customers request a human?', a: 'Yes. Requests for human assistance should trigger the configured escalation flow.' },
      { q: '19. What if the AI is unsure?', a: 'It should acknowledge uncertainty and avoid making unsupported claims.' },
      { q: '20. Which languages are currently supported?', a: 'The project configuration described supports Tamil, English, Telugu, Hindi, Malayalam, and Kannada.' }
    ]
  },
  // SECTION B: Languages and Voice Experience
  {
    section: 'B. Languages and Voice Experience',
    page: 3,
    category: 'languages',
    qa: [
      { q: '21. Does KAIRA support Tamil?', a: 'Yes. Tamil is one of the configured supported languages.' },
      { q: '22. Does KAIRA support English?', a: 'Yes. English is supported.' },
      { q: '23. Does KAIRA support Telugu?', a: 'Yes. Telugu is supported.' },
      { q: '24. Does KAIRA support Hindi?', a: 'Yes. Hindi is supported.' },
      { q: '25. Does KAIRA support Malayalam?', a: 'Yes. Malayalam is supported.' },
      { q: '26. Does KAIRA support Kannada?', a: 'Yes. Kannada is supported.' },
      { q: '27. Can the customer select a preferred language?', a: 'The platform includes language preferences and language-aware handling; exact UI steps depend on the deployed version.' },
      { q: '28. Can KAIRA detect the spoken language?', a: 'The voice pipeline is designed to detect or identify language and use it in the recognition and response flow.' },
      { q: '29. Can KAIRA handle mixed-language speech?', a: 'This depends on the speech-recognition and language-detection configuration. Perfect recognition for every language mix should not be promised without testing.' },
      { q: '30. Will KAIRA reply in the customer\'s language?', a: 'It is designed to respond in the detected supported language when the speech services identify it correctly.' },
      { q: '31. Does KAIRA convert speech into text?', a: 'Yes. Speech-to-text is part of the voice pipeline.' },
      { q: '32. Does KAIRA convert text into speech?', a: 'Yes. Text-to-speech generates spoken AI responses.' }
    ]
  },
  // SECTION C: Calling, Audio, and Technical Support
  {
    section: 'C. Calling, Audio, and Technical Support',
    page: 3,
    category: 'calling',
    qa: [
      { q: '33. Must customers press play for every answer?', a: 'The intended flow plays generated speech into the active call without requiring manual playback for every answer.' },
      { q: '34. Can the AI speak during a live call?', a: 'Yes. The platform is designed to deliver AI-generated audio into the active call.' },
      { q: '35. What technology provides live audio calling?', a: 'WebRTC provides the real-time audio connection.' },
      { q: '36. What is Socket.IO used for?', a: 'Socket.IO carries real-time events such as call signaling, call-state updates, and notifications.' },
      { q: '37. Does KAIRA need microphone permission?', a: 'Yes. Browser-based calling requires the user to grant microphone access.' },
      { q: '38. What if microphone permission is blocked?', a: 'Enable microphone access in the browser\'s site settings, then retry the call.' },
      { q: '39. What if the customer cannot hear the AI?', a: 'Check that the call is connected, the correct output device is selected, browser audio is allowed, and device volume is audible.' },
      { q: '40. What if the agent cannot hear the customer?', a: 'Check microphone permission, selected input device, call status, and network conditions.' },
      { q: '41. Can users switch audio devices?', a: 'The platform includes audio-device selection; available devices depend on the browser and connected hardware.' },
      { q: '42. Does KAIRA work on mobile?', a: 'The project includes mobile-browser and responsive-use considerations. Exact compatibility depends on device, browser, and deployment.' },
      { q: '43. Does KAIRA require internet access?', a: 'Yes. Live calls, AI processing, and real-time updates require an internet connection.' },
      { q: '44. What happens when the network is poor?', a: 'Poor network conditions can reduce call quality. Call-quality metrics and configurable alerts help identify issues.' },
      { q: '45. Can KAIRA monitor call quality?', a: 'Yes. The platform includes call-quality metrics and configurable alerts.' },
      { q: '46. What are call-quality alerts?', a: 'They are notifications based on configured call-quality conditions; thresholds depend on administrator settings.' },
      { q: '47. Can administrators configure call-quality alerts?', a: 'Yes. Configurable call-quality alerts are included in the platform.' },
      { q: '48. Does KAIRA provide call history?', a: 'Yes. Call-history functionality is included in the dashboards, subject to role permissions.' },
      { q: '49. Can customers view previous calls?', a: 'The customer dashboard is designed to show the customer\'s own call history and summaries.' },
      { q: '50. Can agents view conversation insights?', a: 'Yes. The agent dashboard includes conversation-insight functionality.' }
    ]
  },
  // SECTION D: Conversation Intelligence and Follow-ups
  {
    section: 'D. Conversation Intelligence and Follow-ups',
    page: 4,
    category: 'intelligence',
    qa: [
      { q: '51. Can administrators view analytics?', a: 'Yes. The admin dashboard includes analytics and reporting features.' },
      { q: '52. Does KAIRA generate call summaries automatically?', a: 'Yes. Conversation Intelligence is designed to generate structured summaries after calls.' },
      { q: '53. What can a call summary contain?', a: 'It can include the main problem, questions, solutions, discussion points, resolution status, human-support requirement, and recommended next action.' },
      { q: '54. Can summaries show whether an issue was resolved?', a: 'Yes. The summary is designed to record resolved or unresolved status when supported by the conversation.' },
      { q: '55. Can summaries be generated in regional languages?', a: 'The feature is designed to provide localized summaries for supported regional languages as well as English.' },
      { q: '56. Can KAIRA identify customer intent?', a: 'Yes. Real-time Conversation Intelligence is designed to identify the primary intent expressed during a call.' },
      { q: '57. Can KAIRA detect repeated questions?', a: 'Yes. Live insights are designed to detect repeated questions and raise alerts based on configured similarity logic.' },
      { q: '58. Can KAIRA detect frustration?', a: 'It is designed to identify possible frustration or unresolved concerns. These are AI indicators, not definitive judgments.' },
      { q: '59. Can KAIRA detect requests for human support?', a: 'Yes. The system is designed to recognize escalation requests, including multilingual requests.' },
      { q: '60. Can KAIRA extract order numbers or phone numbers?', a: 'The live-intelligence feature is designed to extract entities such as order identifiers, phone numbers, and urgency indicators when spoken.' },
      { q: '61. Does KAIRA create follow-up tasks?', a: 'The Conversation Intelligence workflow is designed to create follow-up tasks for cases requiring further action.' },
      { q: '62. Who can see follow-up tasks?', a: 'They are intended for relevant support staff or assigned agents, subject to role permissions.' },
      { q: '63. Can agents use a Knowledge Base during calls?', a: 'Yes. The in-call Knowledge Base Copilot helps agents find approved company information during customer conversations.' },
      { q: '64. What is the Knowledge Base?', a: 'It is the approved collection of company documents and information used to answer company-specific questions.' }
    ]
  },
  // SECTION E: Knowledge Base and Answer Grounding
  {
    section: 'E. Knowledge Base and Answer Grounding',
    page: 5,
    category: 'knowledge',
    qa: [
      { q: '65. Can KAIRA answer from an uploaded PDF?', a: 'Yes, if the PDF is ingested, indexed, and made available to the approved Knowledge Base retrieval process.' },
      { q: '66. Will every uploaded document be used automatically?', a: 'Not necessarily. Documents must be processed and indexed before the AI can reliably retrieve their content.' },
      { q: '67. Can KAIRA answer questions about company services?', a: 'Only when service details are included in the approved Knowledge Base.' },
      { q: '68. Can KAIRA answer pricing questions?', a: 'Only when current pricing is explicitly documented in the approved Knowledge Base. Otherwise, it should offer human assistance.' },
      { q: '69. Can KAIRA explain company policies?', a: 'Yes, when the relevant policy is included in approved Knowledge Base content.' },
      { q: '70. Can KAIRA answer refund questions?', a: 'Only if refund rules and conditions are documented. Otherwise, it should refer the customer to an authorized representative.' },
      { q: '71. Can KAIRA answer an individual order-status question?', a: 'Only if it can securely access the relevant live order record and verify the caller\'s authorization.' },
      { q: '72. Can KAIRA provide account-specific information?', a: 'Only when authorized customer records are securely retrieved and access permissions are checked.' },
      { q: '73. Can one customer access another customer\'s details?', a: 'No. Customer-specific data must be protected by authentication and authorization.' },
      { q: '74. Does KAIRA support role-based access?', a: 'Yes. The platform includes customer, agent, and administrator roles.' },
      { q: '75. What can customers do in the customer dashboard?', a: 'They can access customer functions, initiate support calls, and view their own call history and related summaries.' },
      { q: '76. What can agents do in the agent dashboard?', a: 'Agents can handle customer calls, view relevant conversation insights, and access support information.' }
    ]
  },
  // SECTION F: Accounts, Privacy, and Customer Support
  {
    section: 'F. Accounts, Privacy, and Customer Support',
    page: 6,
    category: 'security',
    qa: [
      { q: '77. What can administrators do in the admin dashboard?', a: 'Administrators can oversee platform functions, analytics, call-quality monitoring, and administrative features.' },
      { q: '78. Does KAIRA support customer registration and login?', a: 'The project includes customer registration and login. Exact available methods depend on the deployed version.' },
      { q: '79. Are passwords stored securely?', a: 'The implementation uses bcrypt password hashing. Passwords should never be stored or displayed in plain text.' },
      { q: '80. Are calls always recorded?', a: 'No. Recording depends on deployment settings and the required customer-consent process.' },
      { q: '81. Is consent required before recording?', a: 'The project includes a consent-before-recording requirement. Recording should occur only after the required consent.' },
      { q: '82. Who can access call recordings?', a: 'Access should follow the organization\'s authorization rules and official policy. Retention and access details must be supplied by the organization.' },
      { q: '83. How does KAIRA protect customer information?', a: 'The platform includes authentication, role-based access, and customer-data isolation. Exact privacy commitments must come from the official company policy.' },
      { q: '84. Are conversation summaries stored?', a: 'The Conversation Intelligence feature is designed to save call summaries and related insight data in the application database.' },
      { q: '85. Can administrators download reports?', a: 'The admin dashboard includes reporting and download-related functionality; exact report types depend on the deployed version.' },
      { q: '86. What should a customer do if a call disconnects?', a: 'Retry the call. If disconnections continue, contact support through an approved alternative channel.' },
      { q: '87. What if the AI gives an unclear answer?', a: 'Ask again or request a human agent. The AI should acknowledge uncertainty rather than guess.' },
      { q: '88. What if the Knowledge Base has no answer?', a: 'KAIRA should state that approved information is unavailable and offer escalation to a human agent.' },
      { q: '89. Can a human agent correct an AI answer?', a: 'A human agent can take over and provide the correct information. Any formal feedback workflow depends on the deployed application.' },
      { q: '90. Does KAIRA guarantee perfect speech recognition?', a: 'No. Recognition varies with noise, microphone quality, accent, language, and network conditions.' }
    ]
  },
  // SECTION G: Policies, Limitations, and Best Practices
  {
    section: 'G. Policies, Limitations, and Best Practices',
    page: 7,
    category: 'policies',
    qa: [
      { q: '91. Does KAIRA guarantee uninterrupted calls?', a: 'No. Reliability depends on connectivity, device permissions, browser support, and service availability.' },
      { q: '92. Can more languages be added later?', a: 'Potentially, after speech recognition, language handling, text-to-speech, and end-to-end testing are configured for the new language.' },
      { q: '93. Can a company customize KAIRA with its own information?', a: 'Yes. Company documents can be added to the Knowledge Base, subject to ingestion and access configuration.' },
      { q: '94. Who should update the Knowledge Base?', a: 'An authorized company administrator or Knowledge Base owner should maintain approved and current documents.' },
      { q: '95. How can a customer request human help?', a: 'Ask for a human agent during the call. The platform is designed to support escalation and agent takeover.' },
      { q: '96. What details should be shared when reporting a technical issue?', a: 'Describe what happened, when it happened, the device and browser used, and any error message. Never share passwords or one-time codes.' },
      { q: '97. What is KAIRA\'s official support phone number or email?', a: 'These contact details were not supplied in this FAQ. The AI must use only contact information published by the organization.' },
      { q: '98. What are KAIRA\'s business hours?', a: 'Business hours were not supplied in this FAQ. The AI must refer to the organization\'s officially published hours.' },
      { q: '99. Where is KAIRA\'s office located?', a: 'The office address was not supplied. The AI must not guess an address.' },
      { q: '100. What are KAIRA\'s subscription plans or prices?', a: 'Pricing information was not supplied. Refer customers to an authorized sales representative or official pricing document.' }
    ]
  }
];

export async function generateOfficialPDF(outputPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const writeStream = fs.createWriteStream(outputPath);

    doc.pipe(writeStream);

    // Page 1: Cover & Scope Note
    doc.fontSize(22).font('Helvetica-Bold').fillColor('#0f2b48').text('KAIRA VOICE AI PLATFORM', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(16).fillColor('#1e3a8a').text('100 Customer Questions & Answers', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica').fillColor('#475569').text('Starter FAQ Knowledge Base for AI and Human Customer Support', { align: 'center' });
    doc.moveDown(2);

    // Scope note box
    doc.rect(50, 180, 500, 100).fillAndStroke('#fef3c7', '#f59e0b');
    doc.fillColor('#92400e').fontSize(10).font('Helvetica-Bold')
      .text('Scope note: ', 60, 190, { continued: true })
      .font('Helvetica')
      .text('This draft is based on the KAIRA platform capabilities described so far: multilingual voice support, WebRTC calling, AI/human handover, Knowledge Base assistance, Conversation Intelligence, and call-quality monitoring. It is not an official company policy document. Exact business facts such as products, pricing, office address, business hours, refund rules, billing contacts, and service commitments were not supplied; the answers do not invent them.', 60, 190, { width: 480 });

    doc.moveDown(4);
    doc.fillColor('#0f172a').fontSize(13).font('Helvetica-Bold').text('How to use this document', 50, 310);
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica').fillColor('#334155').text(
      'Review this PDF before uploading it to the KAIRA Knowledge Base. Add the official company information that is missing. Configure the AI to answer company-specific questions only from approved Knowledge Base content, acknowledge missing information, and offer human escalation when appropriate.',
      { width: 500 }
    );
    doc.moveDown(1.5);
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a').text('Total: 100 questions with answers');

    doc.fontSize(9).font('Helvetica').fillColor('#94a3b8').text('KAIRA Voice AI Platform | Starter FAQ Knowledge Base', 50, 750);
    doc.text('Page 1', 500, 750);

    // Pages 2 to 7
    let currentY = 50;

    for (const sectionData of OFFICIAL_FAQ_DATA) {
      doc.addPage();
      currentY = 50;

      // Section Header
      doc.fontSize(14).font('Helvetica-Bold').fillColor('#0f2b48').text(sectionData.section, 50, currentY);
      currentY += 25;

      for (const item of sectionData.qa) {
        if (currentY > 700) {
          doc.addPage();
          currentY = 50;
        }

        doc.fontSize(10).font('Helvetica-Bold').fillColor('#0f172a').text(item.q, 50, currentY, { width: 500 });
        currentY += doc.heightOfString(item.q, { width: 500 }) + 3;

        doc.fontSize(9).font('Helvetica').fillColor('#334155').text(item.a, 60, currentY, { width: 490 });
        currentY += doc.heightOfString(item.a, { width: 490 }) + 10;
      }

      // Footer
      doc.fontSize(8).font('Helvetica').fillColor('#94a3b8').text('KAIRA Voice AI Platform | Starter FAQ Knowledge Base', 50, 760);
      doc.text(`Page ${sectionData.page}`, 500, 760);
    }

    doc.end();

    writeStream.on('finish', () => resolve(outputPath));
    writeStream.on('error', reject);
  });
}

// If run directly via CLI
if (process.argv[1]?.includes('generate_official_pdf')) {
  const target = path.join(process.cwd(), 'server', 'data', 'KAIRA_Voice_AI_Platform_100_FAQ.pdf');
  generateOfficialPDF(target).then((p) => {
    console.log('✓ Generated official PDF at:', p);
  }).catch(console.error);
}
