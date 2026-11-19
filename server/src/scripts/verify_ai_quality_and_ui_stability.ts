import { knowledgeService, CustomerContext } from '../services/knowledge.js';
import { prisma } from '../db.js';

interface TestCase {
  id: string;
  category: string;
  query: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  context?: CustomerContext;
  expectedKeywords: string[];
  expectedGrounded: boolean;
  expectTransfer?: boolean;
  notes?: string;
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('🤖 KAIRA AI QUALITY & UI STABILITY VERIFICATION TEST SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  // 1. 20 Actual Questions from KAIRA_100_Customer_Questions_and_Answers.pdf
  const official20Questions: TestCase[] = [
    {
      id: 'OFFICIAL_Q1',
      category: 'Official 100 Q&A',
      query: 'What is KAIRA?',
      expectedKeywords: ['multilingual', 'voice', 'customer support'],
      expectedGrounded: true
    },
    {
      id: 'OFFICIAL_Q2',
      category: 'Official 100 Q&A',
      query: 'What is the main purpose of KAIRA?',
      expectedKeywords: ['support', 'natural voice', 'conversations'],
      expectedGrounded: true
    },
    {
      id: 'OFFICIAL_Q3',
      category: 'Official 100 Q&A',
      query: 'Can customers speak instead of typing?',
      expectedKeywords: ['voice-first', 'speak', 'spoken responses'],
      expectedGrounded: true
    },
    {
      id: 'OFFICIAL_Q4',
      category: 'Official 100 Q&A',
      query: 'Does KAIRA support human agents?',
      expectedKeywords: ['human support agents', 'take over', 'call'],
      expectedGrounded: true,
      expectTransfer: false
    },
    {
      id: 'OFFICIAL_Q8',
      category: 'Official 100 Q&A',
      query: 'Can KAIRA invent prices or policies?',
      expectedKeywords: ['no', 'approved information', 'supported'],
      expectedGrounded: true
    },
    {
      id: 'OFFICIAL_Q9',
      category: 'Official 100 Q&A',
      query: 'Does KAIRA support live calls?',
      expectedKeywords: ['real-time', 'webrtc', 'calling'],
      expectedGrounded: true
    },
    {
      id: 'OFFICIAL_Q10',
      category: 'Official 100 Q&A',
      query: 'Can customers start a support call from the dashboard?',
      expectedKeywords: ['customer dashboard', 'initiate support calls'],
      expectedGrounded: true
    },
    {
      id: 'OFFICIAL_Q12',
      category: 'Official 100 Q&A',
      query: 'Can an agent take over an AI call?',
      expectedKeywords: ['human takeover', 'stop', 'takes control'],
      expectedGrounded: true,
      expectTransfer: false
    },
    {
      id: 'OFFICIAL_Q13',
      category: 'Official 100 Q&A',
      query: 'Can AI and a human agent speak at the same time?',
      expectedKeywords: ['single-speaker', 'prevents overlapping', 'single-voice'],
      expectedGrounded: true,
      expectTransfer: false
    },
    {
      id: 'OFFICIAL_Q14',
      category: 'Official 100 Q&A',
      query: 'Does KAIRA prevent duplicate AI responses?',
      expectedKeywords: ['voice-output controls', 'duplicate speech', 'session'],
      expectedGrounded: true
    },
    {
      id: 'OFFICIAL_Q16',
      category: 'Official 100 Q&A',
      query: 'Can customers interrupt the AI?',
      expectedKeywords: ['barge-in', 'interruption'],
      expectedGrounded: true
    },
    {
      id: 'OFFICIAL_Q17',
      category: 'Official 100 Q&A',
      query: 'Does KAIRA remember earlier turns in a call?',
      expectedKeywords: ['multi-turn context', 'follow-up questions', 'conversation'],
      expectedGrounded: true
    },
    {
      id: 'OFFICIAL_Q20',
      category: 'Official 100 Q&A',
      query: 'Which languages are currently supported?',
      expectedKeywords: ['tamil', 'telugu', 'hindi', 'kannada', 'malayalam'],
      expectedGrounded: true
    },
    {
      id: 'OFFICIAL_Q27',
      category: 'Official 100 Q&A',
      query: 'Can the customer select a preferred language?',
      expectedKeywords: ['language preferences', 'language-aware'],
      expectedGrounded: true
    },
    {
      id: 'OFFICIAL_Q35',
      category: 'Official 100 Q&A',
      query: 'What technology provides live audio calling?',
      expectedKeywords: ['webrtc', 'real-time audio'],
      expectedGrounded: true
    },
    {
      id: 'OFFICIAL_Q36',
      category: 'Official 100 Q&A',
      query: 'What is Socket.IO used for?',
      expectedKeywords: ['real-time events', 'signaling', 'notifications'],
      expectedGrounded: true
    },
    {
      id: 'OFFICIAL_Q50',
      category: 'Official 100 Q&A',
      query: 'Can agents view conversation insights?',
      expectedKeywords: ['agent dashboard', 'conversation-insight'],
      expectedGrounded: true
    },
    {
      id: 'OFFICIAL_Q81',
      category: 'Official 100 Q&A',
      query: 'Is consent required before recording?',
      expectedKeywords: ['consent-before-recording', 'consent', 'recording'],
      expectedGrounded: true
    },
    {
      id: 'OFFICIAL_Q84',
      category: 'Official 100 Q&A',
      query: 'Are conversation summaries stored?',
      expectedKeywords: ['conversation intelligence', 'summaries', 'save'],
      expectedGrounded: true
    },
    {
      id: 'OFFICIAL_Q89',
      category: 'Official 100 Q&A',
      query: 'Can a human agent correct an AI answer?',
      expectedKeywords: ['human agent can take over', 'correct information', 'take over'],
      expectedGrounded: true,
      expectTransfer: false
    }
  ];

  // 2. 10 Paraphrased Questions (Semantic understanding & natural speech)
  const paraphrased10Questions: TestCase[] = [
    {
      id: 'PARA_1',
      category: 'Paraphrased / Typos',
      query: 'what is the main goal or purpose of kaira platform?',
      expectedKeywords: ['support', 'natural voice', 'conversations'],
      expectedGrounded: true,
      notes: 'Paraphrase of Q2'
    },
    {
      id: 'PARA_2',
      category: 'Paraphrased / Typos',
      query: 'what regional langauges does kaira suport?',
      expectedKeywords: ['tamil', 'telugu', 'hindi', 'kannada', 'malayalam'],
      expectedGrounded: true,
      notes: 'Typos in languages and support'
    },
    {
      id: 'PARA_3',
      category: 'Paraphrased / Typos',
      query: 'can i cut off the ai while it is speaking to me?',
      expectedKeywords: ['barge-in', 'interruption', 'interrupt'],
      expectedGrounded: true,
      notes: 'Paraphrase of Q16 (barge-in)'
    },
    {
      id: 'PARA_4',
      category: 'Paraphrased / Typos',
      query: 'can the human agent jump in and take over the call?',
      expectedKeywords: ['human takeover', 'takes control', 'take over'],
      expectedGrounded: true,
      expectTransfer: false,
      notes: 'Paraphrase of Q12'
    },
    {
      id: 'PARA_5',
      category: 'Paraphrased / Typos',
      query: 'does the system need my consent before recording our voice?',
      expectedKeywords: ['consent', 'recording'],
      expectedGrounded: true,
      notes: 'Paraphrase of Q81'
    },
    {
      id: 'PARA_6',
      category: 'Paraphrased / Typos',
      query: 'do ai and human ever talk at the same time?',
      expectedKeywords: ['single-speaker', 'prevents overlapping', 'no'],
      expectedGrounded: true,
      expectTransfer: false,
      notes: 'Paraphrase of Q13'
    },
    {
      id: 'PARA_7',
      category: 'Paraphrased / Typos',
      query: 'does kaira save summaries after the call ends?',
      expectedKeywords: ['conversation intelligence', 'save', 'summaries'],
      expectedGrounded: true,
      notes: 'Paraphrase of Q84'
    },
    {
      id: 'PARA_8',
      category: 'Paraphrased / Typos',
      query: 'can i choose my preferred language?',
      expectedKeywords: ['language preferences', 'language-aware'],
      expectedGrounded: true,
      notes: 'Paraphrase of Q27'
    },
    {
      id: 'PARA_9',
      category: 'Paraphrased / Typos',
      query: 'what web tech powers live voice calling?',
      expectedKeywords: ['webrtc', 'real-time audio'],
      expectedGrounded: true,
      notes: 'Paraphrase of Q35'
    },
    {
      id: 'PARA_10',
      category: 'Paraphrased / Typos',
      query: 'does the ai make up fake prices or policy rules?',
      expectedKeywords: ['no', 'approved information', 'supported'],
      expectedGrounded: true,
      notes: 'Paraphrase of Q8'
    }
  ];

  // 3. 10 Conversational Follow-up Questions Across Turns
  const followUp10Questions: TestCase[] = [
    {
      id: 'FOLLOW_1',
      category: 'Follow-Up Across Turns',
      query: 'Can I pick my preferred language?',
      history: [
        { role: 'user', content: 'Which languages are currently supported?' },
        { role: 'assistant', content: 'The project configuration described supports Tamil, English, Telugu, Hindi, Malayalam, and Kannada.' }
      ],
      expectedKeywords: ['language preferences', 'language-aware'],
      expectedGrounded: true
    },
    {
      id: 'FOLLOW_2',
      category: 'Follow-Up Across Turns',
      query: 'What about Telugu and Tamil?',
      history: [
        { role: 'user', content: 'Which languages are currently supported?' },
        { role: 'assistant', content: 'KAIRA supports six languages.' }
      ],
      expectedKeywords: ['telugu', 'tamil'],
      expectedGrounded: true
    },
    {
      id: 'FOLLOW_3',
      category: 'Follow-Up Across Turns',
      query: 'Can I interrupt it while speaking?',
      history: [
        { role: 'user', content: 'Can the AI speak during a live call?' },
        { role: 'assistant', content: 'Yes, the platform delivers AI-generated audio into the active call.' }
      ],
      expectedKeywords: ['barge-in', 'interruption'],
      expectedGrounded: true
    },
    {
      id: 'FOLLOW_4',
      category: 'Follow-Up Across Turns',
      query: 'Can you elaborate more on that?',
      history: [
        { role: 'user', content: 'Can a human agent correct an AI answer?' },
        { role: 'assistant', content: 'A human agent can take over and provide the correct information.' }
      ],
      expectedKeywords: ['human agent', 'correct', 'take over'],
      expectedGrounded: true
    },
    {
      id: 'FOLLOW_5',
      category: 'Follow-Up Across Turns',
      query: 'Is my permission required before doing so?',
      history: [
        { role: 'user', content: 'Are calls always recorded?' },
        { role: 'assistant', content: 'Recording depends on deployment settings and user consent.' }
      ],
      expectedKeywords: ['consent', 'recording'],
      expectedGrounded: true
    },
    {
      id: 'FOLLOW_6',
      category: 'Follow-Up Across Turns',
      query: 'Does the human agent take over immediately?',
      history: [
        { role: 'user', content: 'Can an agent take over an AI call?' },
        { role: 'assistant', content: 'Yes, human takeover is supported.' }
      ],
      expectedKeywords: ['human takeover', 'takes control', 'stop'],
      expectedGrounded: true
    },
    {
      id: 'FOLLOW_7',
      category: 'Follow-Up Across Turns',
      query: 'Can both of them speak at the same time though?',
      history: [
        { role: 'user', content: 'Can an agent take over an AI call?' },
        { role: 'assistant', content: 'Yes, human takeover is supported.' }
      ],
      expectedKeywords: ['single-speaker', 'prevents overlapping', 'no'],
      expectedGrounded: true
    },
    {
      id: 'FOLLOW_8',
      category: 'Follow-Up Across Turns',
      query: 'Does it remember what I asked earlier?',
      history: [
        { role: 'user', content: 'Can customers speak instead of typing?' },
        { role: 'assistant', content: 'Yes, the experience is voice-first.' }
      ],
      expectedKeywords: ['multi-turn context', 'follow-up questions', 'conversation'],
      expectedGrounded: true
    },
    {
      id: 'FOLLOW_9',
      category: 'Follow-Up Across Turns',
      query: 'Are conversation summaries saved after the call?',
      history: [
        { role: 'user', content: 'Does KAIRA create follow-up tasks?' },
        { role: 'assistant', content: 'The Conversation Intelligence workflow creates follow-up tasks.' }
      ],
      expectedKeywords: ['conversation intelligence', 'save', 'summaries'],
      expectedGrounded: true
    },
    {
      id: 'FOLLOW_10',
      category: 'Follow-Up Across Turns',
      query: 'What if the customer cannot hear the audio?',
      history: [
        { role: 'user', content: 'What technology provides live audio calling?' },
        { role: 'assistant', content: 'WebRTC provides the real-time audio connection.' }
      ],
      expectedKeywords: ['connected', 'output device', 'volume'],
      expectedGrounded: true
    }
  ];

  // 4. 10 Ungrounded / Missing Information Questions (Strict Non-Hallucination)
  const ungrounded10Questions: TestCase[] = [
    {
      id: 'UNGROUND_1',
      category: 'Missing Info & Non-Hallucination',
      query: "What is KAIRA's official customer support phone number or email?",
      expectedKeywords: ['not supplied', 'officially published'],
      expectedGrounded: true,
      notes: 'Official Q97 in PDF'
    },
    {
      id: 'UNGROUND_2',
      category: 'Missing Info & Non-Hallucination',
      query: "What are KAIRA's official business hours?",
      expectedKeywords: ['not supplied', 'officially published'],
      expectedGrounded: true,
      notes: 'Official Q98 in PDF'
    },
    {
      id: 'UNGROUND_3',
      category: 'Missing Info & Non-Hallucination',
      query: "Where is KAIRA's physical corporate office located?",
      expectedKeywords: ['not supplied', 'guess'],
      expectedGrounded: true,
      notes: 'Official Q99 in PDF'
    },
    {
      id: 'UNGROUND_4',
      category: 'Missing Info & Non-Hallucination',
      query: "What are KAIRA's subscription plans and monthly prices?",
      expectedKeywords: ['not supplied', 'pricing information was not supplied'],
      expectedGrounded: true,
      notes: 'Official Q100 in PDF'
    },
    {
      id: 'UNGROUND_5',
      category: 'Missing Info & Non-Hallucination',
      query: "What is KAIRA's stock market ticker symbol?",
      expectedKeywords: ['not currently available', 'approved knowledge base'],
      expectedGrounded: false,
      notes: 'Company fact outside KB: must refuse to invent and offer human assistance'
    },
    {
      id: 'UNGROUND_6',
      category: 'Missing Info & Non-Hallucination',
      query: "Does KAIRA manufacture surveillance drones?",
      expectedKeywords: ['not currently available', 'approved knowledge base'],
      expectedGrounded: false,
      notes: 'Fabrication check: must refuse to invent'
    },
    {
      id: 'UNGROUND_7',
      category: 'Missing Info & Non-Hallucination',
      query: "Who is the lead venture capital investor in KAIRA?",
      expectedKeywords: ['not currently available', 'approved knowledge base'],
      expectedGrounded: false,
      notes: 'Unlisted investor info: non-hallucination'
    },
    {
      id: 'UNGROUND_8',
      category: 'Missing Info & Non-Hallucination',
      query: "Can KAIRA deliver groceries to my home?",
      expectedKeywords: ['not currently available', 'approved knowledge base', 'specialize'],
      expectedGrounded: false,
      notes: 'Irrelevant external service'
    },
    {
      id: 'UNGROUND_9',
      category: 'Missing Info & Non-Hallucination',
      query: "Does KAIRA have an unlisted VIP lifetime discount code?",
      expectedKeywords: ['not currently available', 'approved knowledge base'],
      expectedGrounded: false,
      notes: 'Refuses to invent unauthorized discount codes'
    },
    {
      id: 'UNGROUND_10',
      category: 'Missing Info & Non-Hallucination',
      query: "What is the private cell phone number of KAIRA's CEO?",
      expectedKeywords: ['not currently available', 'approved knowledge base', 'not supplied'],
      expectedGrounded: false,
      notes: 'Refuses to invent private executive data'
    }
  ];

  // 5. 5 Customer-Specific Questions (Strict Authorized DB Data Retrieval)
  const testCustomerContext: CustomerContext = {
    customerId: 'CUST-8842',
    customerName: 'Sarah Jenkins',
    customerEmail: 'sarah.jenkins@enterprise.com',
    customerPhone: '+1-555-0199',
    tickets: [
      {
        id: 'cmwkticket101',
        subject: 'Multilingual speech recognition lag on iOS',
        description: 'Customer noticed a 500ms delay when switching from English to Tamil.',
        status: 'investigating',
        priority: 'high'
      }
    ]
  };

  const customerSpecific5Questions: TestCase[] = [
    {
      id: 'CUST_1',
      category: 'Customer-Specific (Authorized)',
      query: 'What is my customer ID?',
      context: testCustomerContext,
      expectedKeywords: ['CUST-8842'],
      expectedGrounded: true,
      notes: 'Strict Level 1 customer ID lookup'
    },
    {
      id: 'CUST_2',
      category: 'Customer-Specific (Authorized)',
      query: 'What is my registered name?',
      context: testCustomerContext,
      expectedKeywords: ['Sarah Jenkins'],
      expectedGrounded: true,
      notes: 'Strict Level 1 customer name lookup'
    },
    {
      id: 'CUST_3',
      category: 'Customer-Specific (Authorized)',
      query: 'What is my registered email on file?',
      context: testCustomerContext,
      expectedKeywords: ['sarah.jenkins@enterprise.com'],
      expectedGrounded: true,
      notes: 'Strict Level 1 customer email lookup'
    },
    {
      id: 'CUST_4',
      category: 'Customer-Specific (Authorized)',
      query: 'What is my registered phone number?',
      context: testCustomerContext,
      expectedKeywords: ['+1-555-0199'],
      expectedGrounded: true,
      notes: 'Strict Level 1 customer phone lookup'
    },
    {
      id: 'CUST_5',
      category: 'Customer-Specific (Authorized)',
      query: 'What is the status of my support ticket?',
      context: testCustomerContext,
      expectedKeywords: ['investigating', 'high priority', 'Multilingual speech recognition lag'],
      expectedGrounded: true,
      notes: 'Strict Level 1 support ticket status lookup'
    }
  ];

  // 6. 5 General Questions (Level 3: World Knowledge, Tech, Math)
  const generalQuestions: TestCase[] = [
    {
      id: 'GEN_1',
      category: 'General Questions (Level 3)',
      query: 'What is WebRTC?',
      expectedKeywords: ['webrtc', 'audio'],
      expectedGrounded: true
    },
    {
      id: 'GEN_2',
      category: 'General Questions (Level 3)',
      query: 'What is cloud computing?',
      expectedKeywords: ['cloud computing', 'computing'],
      expectedGrounded: true
    },
    {
      id: 'GEN_3',
      category: 'General Questions (Level 3)',
      query: 'What is the capital of India?',
      expectedKeywords: ['New Delhi'],
      expectedGrounded: true
    },
    {
      id: 'GEN_4',
      category: 'General Questions (Level 3)',
      query: 'What is 45 plus 55?',
      expectedKeywords: ['100'],
      expectedGrounded: true
    },
    {
      id: 'GEN_5',
      category: 'General Questions (Level 3)',
      query: 'Tell me a joke',
      expectedKeywords: ['atom'],
      expectedGrounded: false
    }
  ];

  const allTestCases: TestCase[] = [
    ...official20Questions,
    ...paraphrased10Questions,
    ...followUp10Questions,
    ...ungrounded10Questions,
    ...customerSpecific5Questions,
    ...generalQuestions
  ];

  for (const tc of allTestCases) {
    total++;
    try {
      const res = await knowledgeService.answerQuery(tc.query, tc.history || [], tc.context);
      const answerLower = res.answer.toLowerCase();

      // Check keyword matches
      const matchedKeywords = tc.expectedKeywords.filter(kw => answerLower.includes(kw.toLowerCase()));
      const passedKeywords = matchedKeywords.length > 0;

      // Check transfer flag expectation
      const transferOk = tc.expectTransfer !== undefined ? res.requiresTransfer === tc.expectTransfer : true;

      const isPass = passedKeywords && transferOk;

      if (isPass) {
        passed++;
        console.log(`✅ [${tc.id}] (${tc.category})`);
        console.log(`   Q: "${tc.query}"`);
        console.log(`   A: "${res.answer.slice(0, 110)}${res.answer.length > 110 ? '...' : ''}"`);
        console.log(`   Matches: [${matchedKeywords.join(', ')}] | Grounded: ${res.isGrounded} | Latency: ${res.latencyMs}ms\n`);
      } else {
        console.error(`❌ [${tc.id}] FAILED (${tc.category})`);
        console.error(`   Q: "${tc.query}"`);
        console.error(`   A: "${res.answer}"`);
        console.error(`   Expected Keywords: [${tc.expectedKeywords.join(', ')}]`);
        console.error(`   Matched: [${matchedKeywords.join(', ')}] | Grounded: ${res.isGrounded} (expected ${tc.expectedGrounded}) | RequiresTransfer: ${res.requiresTransfer}\n`);
      }
    } catch (err) {
      console.error(`❌ [${tc.id}] EXCEPTION:`, err);
    }
  }

  console.log('================================================================');
  console.log(`📊 FINAL TEST RESULTS: ${passed} / ${total} PASSED (${Math.round((passed / total) * 100)}%)`);
  console.log('================================================================');

  if (passed === total) {
    console.log('🎉 ALL 60 AI QUALITY, RETRIEVAL, AND CONTEXT TESTS PASSED 100%!');
  } else {
    process.exitCode = 1;
  }
}

runTestSuite()
  .catch(err => {
    console.error('Fatal test runner error:', err);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
