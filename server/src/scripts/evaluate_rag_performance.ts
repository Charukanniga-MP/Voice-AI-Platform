import { knowledgeService, GroundedResponse } from '../services/knowledge.js';
import { translationService } from '../services/translation.js';
import { prisma } from '../db.js';

interface EvalTestCase {
  id: string;
  category: 'direct' | 'paraphrased' | 'informal' | 'compound' | 'followup' | 'unsupported' | 'multilingual';
  query: string;
  language?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  expectedQNum?: number; // 1 to 100 in official FAQ
  expectedKeywords?: string[];
  isUnsupported?: boolean;
}

const EVALUATION_DATASET: EvalTestCase[] = [
  // 1. Direct Queries
  {
    id: 'DIR-01',
    category: 'direct',
    query: 'What is KAIRA?',
    expectedQNum: 1,
    expectedKeywords: ['multilingual', 'voice-based', 'customer support', 'human-agent']
  },
  {
    id: 'DIR-02',
    category: 'direct',
    query: 'What is the main purpose of KAIRA?',
    expectedQNum: 2,
    expectedKeywords: ['purpose', 'support', 'natural voice']
  },
  {
    id: 'DIR-03',
    category: 'direct',
    query: 'Does KAIRA support human agents?',
    expectedQNum: 4,
    expectedKeywords: ['support agents', 'human', 'take over', 'connect']
  },
  {
    id: 'DIR-04',
    category: 'direct',
    query: 'Can KAIRA answer company-specific questions?',
    expectedQNum: 5,
    expectedKeywords: ['knowledge base', 'company', 'approved']
  },
  {
    id: 'DIR-05',
    category: 'direct',
    query: 'What technology provides live audio calling?',
    expectedQNum: 35,
    expectedKeywords: ['webrtc', 'browser', 'live audio']
  },

  // 2. Paraphrased & Synonym Queries
  {
    id: 'PARA-01',
    category: 'paraphrased',
    query: 'Can customers talk rather than type?',
    expectedQNum: 3,
    expectedKeywords: ['voice-first', 'speak', 'type']
  },
  {
    id: 'PARA-02',
    category: 'paraphrased',
    query: 'Can AI and a human agent speak at the same time?',
    expectedQNum: 13,
    expectedKeywords: ['single-speaker', 'same time', 'overlapping']
  },
  {
    id: 'PARA-03',
    category: 'paraphrased',
    query: 'Can I cut the AI off while it is speaking?',
    expectedQNum: 16,
    expectedKeywords: ['barge-in', 'interrupt', 'interruption']
  },
  {
    id: 'PARA-04',
    category: 'paraphrased',
    query: 'Do you remember what I said earlier in this call?',
    expectedQNum: 17,
    expectedKeywords: ['multi-turn', 'context', 'earlier', 'retain']
  },
  {
    id: 'PARA-05',
    category: 'paraphrased',
    query: 'Can customers choose their preferred language?',
    expectedQNum: 27,
    expectedKeywords: ['select', 'preferred language', 'dashboard', 'language preferences', 'selection', 'preference']
  },

  // 3. Informal & Typo / Speech Quirks
  {
    id: 'INFO-01',
    category: 'informal',
    query: 'which regional langauges are supported right now',
    expectedQNum: 20,
    expectedKeywords: ['supported', 'tamil', 'english', 'hindi', 'regional']
  },
  {
    id: 'INFO-02',
    category: 'informal',
    query: 'does kaira support tamil language calls',
    expectedQNum: 21,
    expectedKeywords: ['tamil', 'supported']
  },
  {
    id: 'INFO-03',
    category: 'informal',
    query: 'are phone calls always recorded automatically',
    expectedQNum: 80,
    expectedKeywords: ['recorded', 'depends', 'policy', 'consent']
  },
  {
    id: 'INFO-04',
    category: 'informal',
    query: 'is consent required before recording customer audio',
    expectedQNum: 81,
    expectedKeywords: ['consent', 'permission', 'recording']
  },

  // 4. Privacy & Governance Queries
  {
    id: 'PRIV-01',
    category: 'paraphrased',
    query: 'Can one customer access another customer private details?',
    expectedQNum: 73,
    expectedKeywords: ['isolated', 'authentication', 'authorization', 'protected']
  },
  {
    id: 'PRIV-02',
    category: 'paraphrased',
    query: 'Who can access customer call recordings in the system?',
    expectedQNum: 82,
    expectedKeywords: ['authorized', 'role-based', 'administrators', 'access']
  },

  // 5. Compound / Multi-Question Queries
  {
    id: 'COMP-01',
    category: 'compound',
    query: 'What is KAIRA and which languages are currently supported?',
    expectedKeywords: ['multilingual', 'tamil', 'first question']
  },
  {
    id: 'COMP-02',
    category: 'compound',
    query: 'Can I interrupt the AI while speaking and does KAIRA support live calls?',
    expectedKeywords: ['barge-in', 'live calls', 'first question']
  },

  // 6. Context-Aware Follow-Up Queries
  {
    id: 'FOL-01',
    category: 'followup',
    query: 'Does it support Tamil?',
    history: [
      { role: 'user', content: 'What languages does KAIRA support?' },
      { role: 'assistant', content: 'KAIRA supports Tamil, Telugu, Hindi, English, and other languages.' }
    ],
    expectedQNum: 21,
    expectedKeywords: ['tamil', 'supported']
  },
  {
    id: 'FOL-02',
    category: 'followup',
    query: 'Can an agent take over?',
    history: [
      { role: 'user', content: 'Tell me about live calls.' },
      { role: 'assistant', content: 'Customers can start a live call from the dashboard.' }
    ],
    expectedQNum: 12,
    expectedKeywords: ['take over', 'agent', 'human']
  },

  // 7. Unsupported / Unsupplied Information & Refusals (Strict Zero Hallucination)
  {
    id: 'UNSUP-01',
    category: 'unsupported',
    query: 'Can I get a full refund for my subscription payment?',
    isUnsupported: true,
    expectedKeywords: ['refund', 'support agent', 'not find']
  },
  {
    id: 'UNSUP-02',
    category: 'unsupported',
    query: 'Do you offer a 50% discount for university students?',
    isUnsupported: true,
    expectedKeywords: ['student', 'discount', 'support agent', 'confirmed information']
  },
  {
    id: 'UNSUP-03',
    category: 'unsupported',
    query: 'What time does your physical office open on Sunday mornings?',
    expectedQNum: 98,
    expectedKeywords: ['business hours', 'not supplied', 'organization']
  },
  {
    id: 'UNSUP-04',
    category: 'unsupported',
    query: 'What is the street address and floor number of your headquarters?',
    expectedQNum: 99,
    expectedKeywords: ['office address', 'not supplied', 'guess']
  },
  {
    id: 'UNSUP-05',
    category: 'unsupported',
    query: 'What is KAIRA official direct telephone helpline number?',
    expectedQNum: 97,
    expectedKeywords: ['contact details were not supplied', 'not supplied']
  },
  {
    id: 'UNSUP-06',
    category: 'unsupported',
    query: 'What are KAIRA official subscription plans or prices?',
    expectedQNum: 100,
    expectedKeywords: ['pricing', 'plans', 'not supplied', 'official pricing']
  },
  {
    id: 'UNSUP-07',
    category: 'unsupported',
    query: 'Can KAIRA voice agents fly autonomous aerial surveillance drones?',
    isUnsupported: true,
    expectedKeywords: ['could not find confirmed information', 'support agents']
  },
  {
    id: 'UNSUP-08',
    category: 'unsupported',
    query: 'What is KAIRA stock ticker symbol on the New York Stock Exchange?',
    isUnsupported: true,
    expectedKeywords: ['could not find confirmed information', 'support agents']
  },

  // 8. Multilingual Queries (End-to-End Multilingual Intelligence)
  {
    id: 'MULTI-01',
    category: 'multilingual',
    query: 'வணக்கம், KAIRA என்றால் என்ன?',
    language: 'ta',
    expectedQNum: 1,
    expectedKeywords: ['KAIRA', 'குரல்', 'வாடிக்கையாளர்']
  },
  {
    id: 'MULTI-02',
    category: 'multilingual',
    query: 'नमस्ते, KAIRA क्या है?',
    language: 'hi',
    expectedQNum: 1,
    expectedKeywords: ['KAIRA', 'सहायता', 'मंच']
  }
];

async function runRAGEvaluation() {
  console.log('========================================================================');
  console.log('📊 KAIRA RAG BENCHMARK & EVALUATION SUITE (100 Q&A PDF DATASET)');
  console.log('========================================================================\n');

  let hitAt1 = 0;
  let hitAt3 = 0;
  let hitAt5 = 0;
  let totalReciprocalRank = 0;
  let evaluatedRetrievalCount = 0;

  let totalGroundedCorrect = 0;
  let unsupportedCount = 0;
  let handoverOfferedForUnsupported = 0;

  const latencies: number[] = [];

  for (const test of EVALUATION_DATASET) {
    const t0 = Date.now();
    let searchResults: any[] = [];
    let answerResult: GroundedResponse;

    if (test.category === 'multilingual' && test.language) {
      const suggestion = await translationService.getAiAnswerSuggestion(test.query, test.language, test.history || []);
      answerResult = {
        answer: suggestion.answer,
        isGrounded: suggestion.isGrounded,
        requiresTransfer: suggestion.requiresTransfer,
        sources: suggestion.sources,
        confidence: suggestion.confidence,
        latencyMs: suggestion.latencyMs,
        supportingDocument: suggestion.sources[0]?.documentTitle || suggestion.sources[0]?.title,
        supportingPage: suggestion.sources[0]?.pageNumber || 1,
        retrievedEvidence: suggestion.sources[0]?.snippet || suggestion.sources[0]?.title,
        handoverRecommendation: suggestion.requiresTransfer || !suggestion.isGrounded
      };
      // For multilingual ranking check, search translated English query
      const translatedEn = await translationService.translateText(test.query, 'en', test.language);
      searchResults = await knowledgeService.search(translatedEn, 5);
    } else {
      searchResults = await knowledgeService.search(test.query, 5);
      answerResult = await knowledgeService.answerQuery(test.query, test.history || []);
    }

    const latency = Date.now() - t0;
    latencies.push(latency);

    // 1. Retrieval Ranking Metric
    if (test.expectedQNum) {
      evaluatedRetrievalCount++;
      let rank = 0;
      for (let i = 0; i < searchResults.length; i++) {
        const item = searchResults[i];
        const itemQ = item.entry.question || '';
        const matchQNum = itemQ.match(/^(\d+)\./);
        if (matchQNum && parseInt(matchQNum[1], 10) === test.expectedQNum) {
          rank = i + 1;
          break;
        }
      }

      if (rank === 1) {
        hitAt1++;
        hitAt3++;
        hitAt5++;
        totalReciprocalRank += 1.0;
      } else if (rank === 2 || rank === 3) {
        hitAt3++;
        hitAt5++;
        totalReciprocalRank += 1.0 / rank;
      } else if (rank === 4 || rank === 5) {
        hitAt5++;
        totalReciprocalRank += 1.0 / rank;
      }
    }

    // 2. Answer Groundedness & Zero Hallucination
    const ansLower = answerResult.answer.toLowerCase();
    let isCorrect = true;

    if (test.isUnsupported) {
      unsupportedCount++;
      const offersHandover = (
        ansLower.includes('support agent') ||
        ansLower.includes('human representative') ||
        ansLower.includes('connect you') ||
        ansLower.includes('transfer you') ||
        ansLower.includes('not supplied') ||
        answerResult.handoverRecommendation === true
      );
      if (offersHandover) {
        handoverOfferedForUnsupported++;
      } else {
        isCorrect = false;
      }

      if (answerResult.isGrounded && !ansLower.includes('not supplied')) {
        isCorrect = false;
      }
    } else if (test.expectedKeywords) {
      const matchKey = test.expectedKeywords.some(kw => ansLower.includes(kw.toLowerCase()));
      if (!matchKey) isCorrect = false;
    }

    if (isCorrect) totalGroundedCorrect++;

    const statusMark = isCorrect ? '✅' : '❌';
    console.log(`${statusMark} [${test.id}] [${test.category.toUpperCase()}] "${test.query.slice(0, 50)}"`);
    console.log(`     └─ Answer: "${answerResult.answer.slice(0, 75)}..." | Latency: ${latency}ms | Handover: ${answerResult.handoverRecommendation}`);
    if (answerResult.supportingDocument) {
      console.log(`     └─ Cited: ${answerResult.supportingDocument} (Page ${answerResult.supportingPage})`);
    }
  }

  // Calculate Metrics
  const recallAt1 = Math.round((hitAt1 / evaluatedRetrievalCount) * 100);
  const recallAt3 = Math.round((hitAt3 / evaluatedRetrievalCount) * 100);
  const recallAt5 = Math.round((hitAt5 / evaluatedRetrievalCount) * 100);
  const mrr = Math.round((totalReciprocalRank / evaluatedRetrievalCount) * 1000) / 1000;

  const groundednessRate = Math.round((totalGroundedCorrect / EVALUATION_DATASET.length) * 100);
  const handoverRate = Math.round((handoverOfferedForUnsupported / Math.max(1, unsupportedCount)) * 100);

  const meanLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  const minLatency = Math.min(...latencies);
  const maxLatency = Math.max(...latencies);

  console.log('\n========================================================================');
  console.log('📈 RAG EVALUATION BENCHMARK METRICS SUMMARY');
  console.log('========================================================================');
  console.log(`Total Evaluation Queries:         ${EVALUATION_DATASET.length}`);
  console.log(`Evaluated Document Q&A Queries:   ${evaluatedRetrievalCount}`);
  console.log(`Recall@1:                         ${recallAt1}% (${hitAt1}/${evaluatedRetrievalCount})`);
  console.log(`Recall@3:                         ${recallAt3}% (${hitAt3}/${evaluatedRetrievalCount})`);
  console.log(`Recall@5:                         ${recallAt5}% (${hitAt5}/${evaluatedRetrievalCount})`);
  console.log(`Mean Reciprocal Rank (MRR):       ${mrr}`);
  console.log(`Answer Groundedness Rate:         ${groundednessRate}% (${totalGroundedCorrect}/${EVALUATION_DATASET.length})`);
  console.log(`Unsupported Handover Rate:        ${handoverRate}% (${handoverOfferedForUnsupported}/${unsupportedCount})`);
  console.log(`Latency (Mean / Min / Max):       ${meanLatency}ms / ${minLatency}ms / ${maxLatency}ms`);
  console.log('========================================================================\n');

  if (recallAt3 < 80 || groundednessRate < 85 || handoverRate < 85) {
    console.error('Benchmark did not meet target thresholds.');
    process.exit(1);
  }
}

runRAGEvaluation()
  .catch((err) => {
    console.error('Error in RAG evaluation:', err);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
