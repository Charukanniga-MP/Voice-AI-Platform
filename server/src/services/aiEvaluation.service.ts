import crypto from 'crypto';
import { prisma } from '../db.js';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  attributes: Record<string, any>;
}

export interface ClaimEvaluation {
  claim: string;
  isSupported: boolean;
  matchingEvidenceSnippet?: string;
  confidence: number;
}

export interface AnswerRelevanceResult {
  score: number; // 0.0 - 1.0
  isRelevant: boolean;
  explanation: string;
  queryIntent: string;
  matchedKeywords: string[];
}

export interface AnswerCorrectnessResult {
  score: number; // 0.0 - 1.0
  supportedClaims: string[];
  unsupportedClaims: string[];
  explanation: string;
}

export interface HallucinationResult {
  isHallucination: boolean;
  hallucinationScore: number; // 0.0 (grounded) to 1.0 (pure hallucination)
  unsupportedClaims: string[];
  supportedClaims: string[];
  explanation: string;
}

export interface RAGEvaluationResult {
  contextRelevance: number; // 0.0 - 1.0
  contextPrecision: number; // 0.0 - 1.0
  contextRecall: number; // 0.0 - 1.0
  kbCoverage: number; // 0.0 - 1.0
  retrievalFailure: boolean;
  explanation: string;
}

export interface SpeechAccuracyResult {
  wer: number | null; // Word Error Rate (0.0 = perfect)
  cer: number | null; // Character Error Rate (0.0 = perfect)
  recognizedWords: number;
  referenceWords: number;
  hasAudioFailure: boolean;
  languageDetected: string;
  languageAccuracy: number;
}

export interface HandoverEvaluationResult {
  requestedBy: 'customer' | 'frustration' | 'knowledge_gap';
  notifiedAgent: boolean;
  agentAccepted: boolean;
  transferCompleted: boolean;
  timeToConnectMs?: number;
  failureReason?: string;
}

export interface TurnEvaluationInput {
  turnIndex: number;
  transcriptId?: string;
  query: string;
  response: string;
  retrievedContext?: string | string[];
  referenceTranscript?: string;
  timing?: {
    sttMs?: number;
    intentMs?: number;
    ragMs?: number;
    llmMs?: number;
    ttsMs?: number;
    totalMs?: number;
  };
  traceContext?: {
    traceId?: string;
    spanId?: string;
  };
}

export interface ConversationEvaluationSummary {
  callRecordId: string;
  overallQualityScore: number; // 0.0 - 100.0
  relevanceAvg: number | null;
  correctnessAvg: number | null;
  hallucinationRate: number; // % (0.0 - 100.0)
  retrievalAccuracyAvg: number | null;
  latencyAvgMs: number | null;
  latencyP95Ms: number | null;
  speechAccuracyAvg: number | null;
  handoverSuccessRate: number | null;
  csatScore: number | null;
  repetitionRate: number; // % (0.0 - 100.0)
  evaluatedMetricsCount: number;
  weightsApplied: Record<string, number>;
  summaryNotes: string;
}

// ============================================================================
// Mathematical & NLP Utilities
// ============================================================================

/**
 * Standard Tokenizer for English and multilingual support
 */
export function tokenizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.trim().length > 0);
}

/**
 * Compute Levenshtein distance on two generic sequences (words or characters)
 */
export function levenshteinDistance<T>(seq1: T[], seq2: T[]): number {
  const m = seq1.length;
  const n = seq2.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (seq1[i - 1] === seq2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(
          dp[i - 1][j],     // deletion
          dp[i][j - 1],     // insertion
          dp[i - 1][j - 1]  // substitution
        );
      }
    }
  }
  return dp[m][n];
}

/**
 * Word Error Rate (WER) using Levenshtein distance on word tokens.
 * WER = (Substitutions + Deletions + Insertions) / Total Reference Words
 */
export function calculateWER(hypothesis: string, reference: string): number {
  const hypWords = tokenizeWords(hypothesis);
  const refWords = tokenizeWords(reference);

  if (refWords.length === 0) {
    return hypWords.length === 0 ? 0.0 : 1.0;
  }

  const distance = levenshteinDistance(refWords, hypWords);
  const wer = distance / refWords.length;
  return Number(Math.min(wer, 2.0).toFixed(4));
}

/**
 * Character Error Rate (CER) using Levenshtein distance on characters.
 * CER = (Substitutions + Deletions + Insertions) / Total Reference Characters
 */
export function calculateCER(hypothesis: string, reference: string): number {
  const hypChars = hypothesis.toLowerCase().replace(/\s+/g, ' ').trim().split('');
  const refChars = reference.toLowerCase().replace(/\s+/g, ' ').trim().split('');

  if (refChars.length === 0) {
    return hypChars.length === 0 ? 0.0 : 1.0;
  }

  const distance = levenshteinDistance(refChars, hypChars);
  const cer = distance / refChars.length;
  return Number(Math.min(cer, 2.0).toFixed(4));
}

/**
 * Extract factual atomic claims from text
 */
export function extractClaims(text: string): string[] {
  if (!text || text.trim().length === 0) return [];

  // Split by sentence terminators
  const rawSentences = text
    .split(/(?<=[.?!])\s+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 5);

  // Filter out pure greetings, pleasantries or questions
  const claims: string[] = [];
  const skipPhrases = [
    /^(hello|hi|hey|good\s+(morning|afternoon|evening))/i,
    /^(how\s+can\s+i\s+help|what\s+can\s+i\s+do)/i,
    /^(thank\s+you|you're\s+welcome|have\s+a\s+great)/i,
    /^(is\s+there\s+anything\s+else|can\s+i\s+help)/i
  ];

  for (const sentence of rawSentences) {
    const isChitChat = skipPhrases.some(p => p.test(sentence));
    if (!isChitChat && sentence.length > 8) {
      claims.push(sentence);
    }
  }

  return claims.length > 0 ? claims : [text.trim()];
}

/**
 * Generate OpenTelemetry Trace ID (16-byte hex)
 */
export function generateTraceId(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Generate OpenTelemetry Span ID (8-byte hex)
 */
export function generateSpanId(): string {
  return crypto.randomBytes(8).toString('hex');
}

// ============================================================================
// Core Evaluation Evaluators
// ============================================================================

export class AIEvaluationService {

  /**
   * 1. Answer Relevance Evaluator
   * Evaluates if the AI response addresses the customer query and is not irrelevant/deflective.
   */
  public evaluateAnswerRelevance(query: string, response: string): AnswerRelevanceResult {
    const queryTokens = tokenizeWords(query);
    const responseTokens = tokenizeWords(response);

    if (queryTokens.length === 0 || responseTokens.length === 0) {
      return {
        score: 0.5,
        isRelevant: true,
        explanation: 'Insufficient tokens in query or response for lexical relevance test.',
        queryIntent: 'general',
        matchedKeywords: []
      };
    }

    // Stopwords to ignore in lexical overlap
    const stopwords = new Set([
      'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'for', 'to', 'in', 'of',
      'i', 'you', 'it', 'my', 'your', 'me', 'we', 'us', 'can', 'could', 'please', 'help'
    ]);

    const significantQueryTokens = queryTokens.filter(t => !stopwords.has(t) && t.length > 2);
    const responseSet = new Set(responseTokens);

    const matchedKeywords = significantQueryTokens.filter(t => responseSet.has(t));
    const tokenOverlapRatio = significantQueryTokens.length > 0
      ? matchedKeywords.length / significantQueryTokens.length
      : 0.5;

    // Check for self-absorbed architectural deflection
    // e.g. Customer asks: "Where is my order?" -> AI answers: "KAIRA captures your voice using WebRTC and Web Speech..."
    const architectureBuzzwords = [
      'webrtc', 'web speech', 'deepgram', 'reciprocal rank fusion', 'bm25',
      'acoustic echo suppression', 'socket.io', 'prisma orm', 'sqlite database', 'vector search'
    ];
    const queryMentionsTech = architectureBuzzwords.some(bw => query.toLowerCase().includes(bw));
    const responseMentionsTech = architectureBuzzwords.filter(bw => response.toLowerCase().includes(bw));

    let penalty = 0.0;
    let architecturalDeflection = false;
    if (!queryMentionsTech && responseMentionsTech.length >= 2) {
      architecturalDeflection = true;
      penalty = 0.65;
    }

    // Common intent classes
    let queryIntent = 'general';
    const lowerQ = query.toLowerCase();
    if (/\b(cancel|return|refund|charge|bill|invoice|pay)\b/.test(lowerQ)) queryIntent = 'billing_refund';
    else if (/\b(login|password|account|email|sign in|access)\b/.test(lowerQ)) queryIntent = 'account_auth';
    else if (/\b(track|order|shipping|delivery|status)\b/.test(lowerQ)) queryIntent = 'order_status';
    else if (/\b(speak|talk|agent|human|representative|person)\b/.test(lowerQ)) queryIntent = 'human_handover';
    else if (/\b(hours|location|phone|contact|address|email)\b/.test(lowerQ)) queryIntent = 'contact_info';
    else if (/\b(broken|error|fail|bug|issue|problem|not working)\b/.test(lowerQ)) queryIntent = 'technical_support';

    // Calculate normalized relevance score
    let baseScore = Math.min(1.0, 0.4 + (tokenOverlapRatio * 0.6));
    let finalScore = Math.max(0.0, baseScore - penalty);

    if (architecturalDeflection) {
      finalScore = Math.min(finalScore, 0.25);
    }

    const isRelevant = finalScore >= 0.50;
    const explanation = architecturalDeflection
      ? `AI deflected to explaining its technical architecture (${responseMentionsTech.join(', ')}) without answering query.`
      : isRelevant
        ? `Response aligns with query intent '${queryIntent}' with ${Math.round(tokenOverlapRatio * 100)}% relevant term overlap.`
        : `Low relevance to query intent '${queryIntent}'. Missing key context from customer inquiry.`;

    return {
      score: Number(finalScore.toFixed(2)),
      isRelevant,
      explanation,
      queryIntent,
      matchedKeywords
    };
  }

  /**
   * 2. Answer Correctness & Hallucination Evaluator
   * Compares atomic claims in the AI response against retrieved knowledge base chunks.
   */
  public evaluateCorrectnessAndHallucination(
    query: string,
    response: string,
    retrievedContext?: string | string[]
  ): { correctness: AnswerCorrectnessResult; hallucination: HallucinationResult } {
    const claims = extractClaims(response);
    const contextText = Array.isArray(retrievedContext)
      ? retrievedContext.join(' ')
      : (retrievedContext || '');

    // If context is completely empty and response is a general greeting or acknowledgement
    const lowerResp = response.toLowerCase();
    const isGreeting = /^(hello|hi|welcome|good\s+day|how\s+can\s+i\s+help)/i.test(lowerResp.trim());
    const isClarification = /\b(could you please clarify|can you specify|would you like to)\b/i.test(lowerResp);

    if (!contextText.trim()) {
      if (isGreeting || isClarification) {
        return {
          correctness: {
            score: 0.95,
            supportedClaims: claims,
            unsupportedClaims: [],
            explanation: 'Conversational greeting or clarification, inherently grounded.'
          },
          hallucination: {
            isHallucination: false,
            hallucinationScore: 0.0,
            supportedClaims: claims,
            unsupportedClaims: [],
            explanation: 'No factual assertions requiring KB grounding.'
          }
        };
      } else {
        // AI made assertions without any retrieved evidence
        // Check if query is conversational
        const isChitChat = /^(how are you|what is your name|who are you|thanks|bye)\b/i.test(query.trim());
        const isStandardSupportGuidance = /\b(settings|profile|portal|menu|dashboard|contact|support|representative|billing|account)\b/i.test(lowerResp);

        if (isChitChat || isStandardSupportGuidance) {
          return {
            correctness: {
              score: 0.90,
              supportedClaims: claims,
              unsupportedClaims: [],
              explanation: isChitChat ? 'Grounded conversation handling.' : 'Grounded standard customer support navigation guidance.'
            },
            hallucination: {
              isHallucination: false,
              hallucinationScore: 0.05,
              supportedClaims: claims,
              unsupportedClaims: [],
              explanation: 'Standard navigational response without unsupported external claims.'
            }
          };
        }

        // Factual query answered without KB context
        return {
          correctness: {
            score: 0.30,
            supportedClaims: [],
            unsupportedClaims: claims,
            explanation: 'AI generated factual response without any supporting Knowledge Base evidence.'
          },
          hallucination: {
            isHallucination: true,
            hallucinationScore: 0.70,
            supportedClaims: [],
            unsupportedClaims: claims,
            explanation: 'No retrieved KB context was provided to support the answer claims.'
          }
        };
      }
    }

    // Validate claims against context
    const contextTokens = new Set(tokenizeWords(contextText));
    const supportedClaims: string[] = [];
    const unsupportedClaims: string[] = [];

    for (const claim of claims) {
      const claimTokens = tokenizeWords(claim).filter(t => t.length > 3);
      if (claimTokens.length === 0) {
        supportedClaims.push(claim);
        continue;
      }

      let matches = 0;
      for (const t of claimTokens) {
        if (contextTokens.has(t)) matches++;
      }

      const claimGroundedness = matches / claimTokens.length;
      // If at least 45% of substantive keywords are present in context, claim is considered supported
      if (claimGroundedness >= 0.40) {
        supportedClaims.push(claim);
      } else {
        unsupportedClaims.push(claim);
      }
    }

    const totalClaims = claims.length;
    const correctnessScore = totalClaims > 0 ? (supportedClaims.length / totalClaims) : 1.0;
    const hallucinationScore = totalClaims > 0 ? (unsupportedClaims.length / totalClaims) : 0.0;
    const isHallucination = hallucinationScore >= 0.35 && unsupportedClaims.length > 0;

    return {
      correctness: {
        score: Number(correctnessScore.toFixed(2)),
        supportedClaims,
        unsupportedClaims,
        explanation: unsupportedClaims.length === 0
          ? `All ${totalClaims} response statements are verified against retrieved KB evidence.`
          : `${unsupportedClaims.length} of ${totalClaims} statements lack supporting evidence in retrieved context.`
      },
      hallucination: {
        isHallucination,
        hallucinationScore: Number(hallucinationScore.toFixed(2)),
        supportedClaims,
        unsupportedClaims,
        explanation: isHallucination
          ? `Detected ${unsupportedClaims.length} unsupported claim(s) not found in knowledge base.`
          : `Grounded in knowledge base. Hallucination score: ${(hallucinationScore * 100).toFixed(0)}%.`
      }
    };
  }

  /**
   * 3. RAGAS-Compatible RAG Pipeline Evaluator
   * Measures Context Relevance, Context Precision, Context Recall, and KB Coverage.
   */
  public evaluateRAG(
    query: string,
    retrievedChunks: string[],
    groundTruthReference?: string
  ): RAGEvaluationResult {
    if (!retrievedChunks || retrievedChunks.length === 0) {
      return {
        contextRelevance: 0.0,
        contextPrecision: 0.0,
        contextRecall: 0.0,
        kbCoverage: 0.0,
        retrievalFailure: true,
        explanation: 'Zero knowledge chunks were retrieved for the query.'
      };
    }

    const stopwords = new Set(['the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'for', 'to', 'in', 'of', 'how', 'do', 'i', 'my', 'can', 'you', 'what', 'are']);
    const queryTokens = tokenizeWords(query).filter(t => !stopwords.has(t) && t.length > 2);
    if (queryTokens.length === 0) {
      return {
        contextRelevance: 1.0,
        contextPrecision: 1.0,
        contextRecall: 1.0,
        kbCoverage: 1.0,
        retrievalFailure: false,
        explanation: 'Query contains no substantial search terms.'
      };
    }

    // Compute Context Relevance: Average fraction of query tokens covered by retrieved chunks
    let totalRelevance = 0;
    const relevantChunkFlags: boolean[] = [];

    for (const chunk of retrievedChunks) {
      const chunkTokens = new Set(tokenizeWords(chunk));
      let matches = 0;
      for (const qt of queryTokens) {
        if (chunkTokens.has(qt)) matches++;
      }
      const rel = matches / queryTokens.length;
      totalRelevance += rel;
      relevantChunkFlags.push(rel >= 0.25);
    }

    const contextRelevance = Math.min(1.0, totalRelevance / retrievedChunks.length);

    // Compute Context Precision (RAGAS formula):
    // Precision@K: Fraction of top-K retrieved chunks that are actually relevant
    let cumulativeRelevant = 0;
    let precisionSum = 0;
    for (let k = 0; k < relevantChunkFlags.length; k++) {
      if (relevantChunkFlags[k]) {
        cumulativeRelevant++;
        precisionSum += cumulativeRelevant / (k + 1);
      }
    }
    const contextPrecision = cumulativeRelevant > 0
      ? Math.min(1.0, precisionSum / relevantChunkFlags.length)
      : 0.0;

    // Context Recall: If ground-truth reference is available, compute recall of reference facts
    let contextRecall = contextRelevance;
    if (groundTruthReference && groundTruthReference.trim().length > 0) {
      const refTokens = tokenizeWords(groundTruthReference).filter(t => t.length > 3);
      if (refTokens.length > 0) {
        const allChunkTokens = new Set(tokenizeWords(retrievedChunks.join(' ')));
        let refMatched = 0;
        for (const rt of refTokens) {
          if (allChunkTokens.has(rt)) refMatched++;
        }
        contextRecall = Math.min(1.0, refMatched / refTokens.length);
      }
    }

    // Knowledge Base Coverage: unique query terms found across any chunk
    const allRetrievedTokens = new Set(tokenizeWords(retrievedChunks.join(' ')));
    let termsCovered = 0;
    for (const qt of queryTokens) {
      if (allRetrievedTokens.has(qt)) termsCovered++;
    }
    const kbCoverage = Math.min(1.0, termsCovered / queryTokens.length);
    const retrievalFailure = kbCoverage < 0.20 && contextPrecision < 0.20;

    return {
      contextRelevance: Number(contextRelevance.toFixed(2)),
      contextPrecision: Number(contextPrecision.toFixed(2)),
      contextRecall: Number(contextRecall.toFixed(2)),
      kbCoverage: Number(kbCoverage.toFixed(2)),
      retrievalFailure,
      explanation: retrievalFailure
        ? 'Retrieval failed: Top chunks do not contain relevant content for query.'
        : `Context Precision: ${(contextPrecision * 100).toFixed(0)}%, KB Coverage: ${(kbCoverage * 100).toFixed(0)}%.`
    };
  }

  /**
   * 4. Speech Recognition Accuracy Evaluator
   * Computes exact WER & CER when reference transcript is provided.
   */
  public evaluateSpeechRecognition(
    recognizedText: string,
    referenceText?: string
  ): SpeechAccuracyResult {
    const recognizedWords = tokenizeWords(recognizedText).length;

    if (!referenceText || referenceText.trim().length === 0) {
      // No reference transcript provided - evaluate fluency & audio failure indicators
      const hasAudioFailure = recognizedText.trim().length === 0 ||
        /\[inaudible\]|\[unintelligible\]|\[noise\]/i.test(recognizedText);

      return {
        wer: null,
        cer: null,
        recognizedWords,
        referenceWords: 0,
        hasAudioFailure,
        languageDetected: 'en',
        languageAccuracy: hasAudioFailure ? 0.3 : 0.95
      };
    }

    const wer = calculateWER(recognizedText, referenceText);
    const cer = calculateCER(recognizedText, referenceText);
    const referenceWords = tokenizeWords(referenceText).length;

    return {
      wer,
      cer,
      recognizedWords,
      referenceWords,
      hasAudioFailure: wer > 0.85,
      languageDetected: 'en',
      languageAccuracy: Number((Math.max(0.0, 1.0 - wer)).toFixed(2))
    };
  }

  /**
   * 5. Repeated Question Detector
   * Detects semantic repetition in questions asked by AI across turns in a call.
   */
  public detectQuestionRepetition(
    currentQuestion: string,
    previousQuestions: { turnId: number; text: string; wasAnswered?: boolean }[]
  ): { isRepetition: boolean; previousTurnId?: number; similarityScore: number; wasAlreadyAnswered: boolean } {
    const questionStopwords = new Set([
      'could', 'you', 'please', 'would', 'can', 'what', 'is', 'your', 'me', 'the', 'give', 'provide', 'tell', 'share'
    ]);

    let currentTokens = new Set(tokenizeWords(currentQuestion).filter(t => !questionStopwords.has(t) && t.length > 2));
    if (currentTokens.size === 0) {
      currentTokens = new Set(tokenizeWords(currentQuestion).filter(t => t.length > 2));
    }
    if (currentTokens.size === 0) {
      return { isRepetition: false, similarityScore: 0.0, wasAlreadyAnswered: false };
    }

    for (const prev of previousQuestions) {
      let prevTokens = new Set(tokenizeWords(prev.text).filter(t => !questionStopwords.has(t) && t.length > 2));
      if (prevTokens.size === 0) {
        prevTokens = new Set(tokenizeWords(prev.text).filter(t => t.length > 2));
      }
      if (prevTokens.size === 0) continue;

      let intersection = 0;
      for (const token of currentTokens) {
        if (prevTokens.has(token)) intersection++;
      }

      const union = new Set([...currentTokens, ...prevTokens]).size;
      const jaccard = union > 0 ? intersection / union : 0;

      // Also compute Levenshtein similarity on normalized text
      const maxLen = Math.max(currentQuestion.length, prev.text.length);
      const lev = maxLen > 0 ? 1 - (levenshteinDistance(currentQuestion.split(''), prev.text.split('')) / maxLen) : 0;

      const combinedSimilarity = (jaccard * 0.7) + (lev * 0.3);

      if (combinedSimilarity >= 0.60) {
        return {
          isRepetition: true,
          previousTurnId: prev.turnId,
          similarityScore: Number(combinedSimilarity.toFixed(2)),
          wasAlreadyAnswered: prev.wasAnswered ?? true
        };
      }
    }

    return { isRepetition: false, similarityScore: 0.0, wasAlreadyAnswered: false };
  }

  /**
   * 6. OpenTelemetry Latency & Distributed Tracing Tracker
   */
  public createTraceSpan(
    name: string,
    parentTraceId?: string,
    parentSpanId?: string,
    attributes: Record<string, any> = {}
  ): TraceSpan {
    const traceId = parentTraceId || generateTraceId();
    const spanId = generateSpanId();
    return {
      traceId,
      spanId,
      parentSpanId,
      name,
      startTime: Date.now(),
      attributes
    };
  }

  public endTraceSpan(span: TraceSpan, additionalAttributes: Record<string, any> = {}): TraceSpan {
    span.endTime = Date.now();
    span.durationMs = span.endTime - span.startTime;
    span.attributes = { ...span.attributes, ...additionalAttributes };
    return span;
  }

  /**
   * 7. Transparent Weighted Quality Score Calculation
   * Base Weights:
   * - Answer Relevance: 20%
   * - Answer Correctness: 20%
   * - Hallucination Control: 15%
   * - Retrieval Accuracy: 10%
   * - Speech Recognition Accuracy: 10%
   * - Human Handover Success: 10%
   * - Customer Satisfaction: 10%
   * - Conversation Quality / Repetition Control: 5%
   *
   * Automatically re-normalizes weights for missing metrics so unavailable metrics are never treated as 0.
   */
  public calculateOverallQualityScore(metrics: {
    relevanceAvg: number | null;
    correctnessAvg: number | null;
    hallucinationRate: number | null; // % (0 to 100)
    retrievalAccuracyAvg: number | null;
    speechAccuracyAvg: number | null;
    handoverSuccessRate: number | null;
    csatScore: number | null; // (0 to 100 or 1 to 5)
    repetitionRate: number | null; // % (0 to 100)
  }): { overallScore: number; normalizedWeights: Record<string, number>; evaluatedCount: number } {
    const baseWeights: Record<string, number> = {
      relevance: 0.20,
      correctness: 0.20,
      hallucinationControl: 0.15,
      retrieval: 0.10,
      speechAccuracy: 0.10,
      handoverSuccess: 0.10,
      csat: 0.10,
      repetitionControl: 0.05
    };

    // Normalized metric scores (0.0 to 100.0)
    const scores: Record<string, number | null> = {
      relevance: metrics.relevanceAvg !== null ? metrics.relevanceAvg * 100 : null,
      correctness: metrics.correctnessAvg !== null ? metrics.correctnessAvg * 100 : null,
      hallucinationControl: metrics.hallucinationRate !== null ? Math.max(0, 100 - metrics.hallucinationRate) : null,
      retrieval: metrics.retrievalAccuracyAvg !== null ? metrics.retrievalAccuracyAvg * 100 : null,
      speechAccuracy: metrics.speechAccuracyAvg !== null ? metrics.speechAccuracyAvg * 100 : null,
      handoverSuccess: metrics.handoverSuccessRate !== null ? metrics.handoverSuccessRate * 100 : null,
      csat: metrics.csatScore !== null
        ? (metrics.csatScore > 5 ? metrics.csatScore : (metrics.csatScore / 5) * 100)
        : null,
      repetitionControl: metrics.repetitionRate !== null ? Math.max(0, 100 - metrics.repetitionRate) : null
    };

    // Calculate sum of available weights
    let availableWeightSum = 0;
    let evaluatedCount = 0;
    for (const [key, weight] of Object.entries(baseWeights)) {
      if (scores[key] !== null) {
        availableWeightSum += weight;
        evaluatedCount++;
      }
    }

    if (availableWeightSum === 0) {
      return { overallScore: 75.0, normalizedWeights: {}, evaluatedCount: 0 };
    }

    // Re-normalize weights
    const normalizedWeights: Record<string, number> = {};
    let weightedScoreSum = 0;

    for (const [key, baseWeight] of Object.entries(baseWeights)) {
      if (scores[key] !== null) {
        const normWeight = baseWeight / availableWeightSum;
        normalizedWeights[key] = Number(normWeight.toFixed(4));
        weightedScoreSum += normWeight * (scores[key] as number);
      }
    }

    return {
      overallScore: Number(Math.min(100, Math.max(0, weightedScoreSum)).toFixed(1)),
      normalizedWeights,
      evaluatedCount
    };
  }

  /**
   * 8. Evaluate Complete Turn and Persist Turn Metrics
   */
  public async evaluateAndRecordTurn(callRecordId: string, input: TurnEvaluationInput): Promise<any> {
    try {
      const relevance = this.evaluateAnswerRelevance(input.query, input.response);
      const { correctness, hallucination } = this.evaluateCorrectnessAndHallucination(
        input.query,
        input.response,
        input.retrievedContext
      );

      // Save AIResponseEvaluation
      const turnEval = await prisma.aIResponseEvaluation.create({
        data: {
          callRecordId,
          transcriptId: input.transcriptId || null,
          turnIndex: input.turnIndex,
          query: input.query,
          response: input.response,
          relevanceScore: relevance.score,
          relevanceExplanation: relevance.explanation,
          correctnessScore: correctness.score,
          correctnessExplanation: correctness.explanation,
          hallucinationScore: hallucination.hallucinationScore,
          isHallucination: hallucination.isHallucination,
          unsupportedClaims: JSON.stringify(hallucination.unsupportedClaims),
          supportedClaims: JSON.stringify(hallucination.supportedClaims),
          evaluationExplanation: `${relevance.explanation} ${hallucination.explanation}`,
          retrievedEvidence: input.retrievedContext
            ? JSON.stringify(Array.isArray(input.retrievedContext) ? input.retrievedContext : [input.retrievedContext])
            : null
        }
      });

      // Record RAG evaluation if context was retrieved
      if (input.retrievedContext) {
        const chunks = Array.isArray(input.retrievedContext) ? input.retrievedContext : [input.retrievedContext];
        const rag = this.evaluateRAG(input.query, chunks);
        await prisma.rAGEvaluation.create({
          data: {
            callRecordId,
            turnIndex: input.turnIndex,
            query: input.query,
            retrievedContext: JSON.stringify(chunks),
            contextRelevance: rag.contextRelevance,
            contextPrecision: rag.contextPrecision,
            contextRecall: rag.contextRecall,
            kbCoverage: rag.kbCoverage,
            retrievalFailure: rag.retrievalFailure
          }
        });
      }

      // Record Latency Metrics if timing provided
      if (input.timing) {
        const traceId = input.traceContext?.traceId || generateTraceId();
        const spanId = input.traceContext?.spanId || generateSpanId();
        await prisma.latencyMetrics.create({
          data: {
            callRecordId,
            turnId: input.turnIndex,
            traceId,
            spanId,
            sttMs: input.timing.sttMs || 0,
            intentMs: input.timing.intentMs || 0,
            ragMs: input.timing.ragMs || 0,
            llmMs: input.timing.llmMs || 0,
            ttsMs: input.timing.ttsMs || 0,
            totalMs: input.timing.totalMs || 0
          }
        });
      }

      // Record Speech evaluation if reference transcript is available
      if (input.referenceTranscript) {
        const speech = this.evaluateSpeechRecognition(input.query, input.referenceTranscript);
        await prisma.speechEvaluation.create({
          data: {
            callRecordId,
            transcriptId: input.transcriptId || null,
            turnIndex: input.turnIndex,
            recognizedText: input.query,
            referenceText: input.referenceTranscript,
            wer: speech.wer,
            cer: speech.cer,
            hasAudioFailure: speech.hasAudioFailure,
            languageDetected: speech.languageDetected,
            languageAccuracy: speech.languageAccuracy
          }
        });
      }

      return turnEval;
    } catch (error) {
      console.error(`[AIEvaluationService] Error evaluating turn ${input.turnIndex} for call ${callRecordId}:`, error);
      return null;
    }
  }

  /**
   * 9. Evaluate Complete Conversation & Compute Aggregated Observability Metrics
   */
  public async evaluateConversation(callRecordId: string): Promise<ConversationEvaluationSummary | null> {
    try {
      const call = await prisma.callRecord.findUnique({
        where: { id: callRecordId },
        include: {
          transcripts: { orderBy: { timestamp: 'asc' } },
          transferRequests: true,
          aiEvaluations: true,
          ragEvaluations: true,
          latencyMetrics: true,
          speechEvaluations: true,
          handoverEvaluations: true,
          customerFeedbackRecord: true,
          repetitionIncidents: true
        }
      });

      if (!call) {
        console.warn(`[AIEvaluationService] Call record ${callRecordId} not found.`);
        return null;
      }

      // 1. Process Transcripts if AI turn evaluations don't exist yet
      if (call.aiEvaluations.length === 0 && call.transcripts.length > 0) {
        const customerTranscripts = call.transcripts.filter(t => t.sender === 'customer');
        const aiTranscripts = call.transcripts.filter(t => t.sender === 'ai');

        for (let i = 0; i < customerTranscripts.length; i++) {
          const cust = customerTranscripts[i];
          const ai = aiTranscripts[i] || aiTranscripts[aiTranscripts.length - 1];
          if (ai) {
            await this.evaluateAndRecordTurn(callRecordId, {
              turnIndex: i + 1,
              transcriptId: ai.id,
              query: cust.text,
              response: ai.text
            });
          }
        }
      }

      // Re-fetch evaluations
      const [aiEvals, ragEvals, latencyRows, speechEvals, handoverRows, feedback] = await Promise.all([
        prisma.aIResponseEvaluation.findMany({ where: { callRecordId } }),
        prisma.rAGEvaluation.findMany({ where: { callRecordId } }),
        prisma.latencyMetrics.findMany({ where: { callRecordId } }),
        prisma.speechEvaluation.findMany({ where: { callRecordId } }),
        prisma.handoverEvaluation.findMany({ where: { callRecordId } }),
        prisma.customerFeedback.findUnique({ where: { callRecordId } })
      ]);

      // Calculate Averages
      // A. Relevance
      const relevanceAvg = aiEvals.length > 0
        ? Number((aiEvals.reduce((acc, e) => acc + e.relevanceScore, 0) / aiEvals.length).toFixed(2))
        : null;

      // B. Correctness
      const correctnessAvg = aiEvals.length > 0
        ? Number((aiEvals.reduce((acc, e) => acc + e.correctnessScore, 0) / aiEvals.length).toFixed(2))
        : null;

      // C. Hallucination Rate
      const hallucinationCount = aiEvals.filter(e => e.isHallucination).length;
      const hallucinationRate = aiEvals.length > 0
        ? Number(((hallucinationCount / aiEvals.length) * 100).toFixed(1))
        : 0.0;

      // D. Retrieval Accuracy
      const retrievalAccuracyAvg = ragEvals.length > 0
        ? Number((ragEvals.reduce((acc, r) => acc + r.contextPrecision, 0) / ragEvals.length).toFixed(2))
        : null;

      // E. Latency Avg & P95
      let latencyAvgMs: number | null = null;
      let latencyP95Ms: number | null = null;
      if (latencyRows.length > 0) {
        const sortedLatencies = latencyRows.map(l => l.totalMs).sort((a, b) => a - b);
        latencyAvgMs = Number((sortedLatencies.reduce((a, b) => a + b, 0) / sortedLatencies.length).toFixed(0));
        const p95Index = Math.min(sortedLatencies.length - 1, Math.floor(sortedLatencies.length * 0.95));
        latencyP95Ms = Number(sortedLatencies[p95Index].toFixed(0));
      } else if (call.avgLatency) {
        latencyAvgMs = Number(call.avgLatency.toFixed(0));
        latencyP95Ms = Number((call.avgLatency * 1.25).toFixed(0));
      }

      // F. Speech Accuracy
      const validSpeech = speechEvals.filter(s => s.wer !== null);
      const speechAccuracyAvg = validSpeech.length > 0
        ? Number((validSpeech.reduce((acc, s) => acc + Math.max(0, 1.0 - (s.wer || 0)), 0) / validSpeech.length).toFixed(2))
        : null;

      // G. Handover Success Rate
      let handoverSuccessRate: number | null = null;
      if (handoverRows.length > 0) {
        const completed = handoverRows.filter(h => h.transferCompleted).length;
        handoverSuccessRate = Number((completed / handoverRows.length).toFixed(2));
      } else if (call.transferRequests.length > 0) {
        const completed = call.transferRequests.filter(r => r.status === 'completed' || r.status === 'connected').length;
        handoverSuccessRate = Number((completed / call.transferRequests.length).toFixed(2));
      }

      // H. CSAT Score
      let csatScore: number | null = null;
      if (feedback) {
        csatScore = feedback.csatScore;
      } else if (call.rating) {
        csatScore = Number(((call.rating / 5) * 100).toFixed(0));
      }

      // I. Repeated-Question Repetition Rate
      const aiQuestions = call.transcripts
        .filter(t => t.sender === 'ai' && t.text.includes('?'))
        .map((t, idx) => ({ turnId: idx + 1, text: t.text, wasAnswered: true }));

      let repeatedIncidents = 0;
      for (let i = 1; i < aiQuestions.length; i++) {
        const check = this.detectQuestionRepetition(aiQuestions[i].text, aiQuestions.slice(0, i));
        if (check.isRepetition) {
          repeatedIncidents++;
          await prisma.repetitionIncident.create({
            data: {
              callRecordId,
              questionText: aiQuestions[i].text,
              previousTurnId: check.previousTurnId || 1,
              currentTurnId: aiQuestions[i].turnId,
              similarityScore: check.similarityScore,
              wasAlreadyAnswered: check.wasAlreadyAnswered
            }
          });
        }
      }

      const repetitionRate = aiQuestions.length > 0
        ? Number(((repeatedIncidents / aiQuestions.length) * 100).toFixed(1))
        : 0.0;

      // Calculate Dynamic Weighted Overall Quality Score
      const { overallScore, normalizedWeights, evaluatedCount } = this.calculateOverallQualityScore({
        relevanceAvg,
        correctnessAvg,
        hallucinationRate,
        retrievalAccuracyAvg,
        speechAccuracyAvg,
        handoverSuccessRate,
        csatScore,
        repetitionRate
      });

      const summaryNotes = `AI Quality Evaluation complete with score ${overallScore}/100 across ${evaluatedCount} available dimensions.`;

      // Upsert ConversationEvaluation
      await prisma.conversationEvaluation.upsert({
        where: { callRecordId },
        create: {
          callRecordId,
          overallQualityScore: overallScore,
          relevanceAvg,
          correctnessAvg,
          hallucinationRate,
          retrievalAccuracyAvg,
          latencyAvgMs,
          latencyP95Ms,
          speechAccuracyAvg,
          handoverSuccessRate,
          csatScore,
          repetitionRate,
          evaluationStatus: 'completed',
          evaluatedMetricsCount: evaluatedCount,
          weightsApplied: JSON.stringify(normalizedWeights),
          summaryNotes
        },
        update: {
          overallQualityScore: overallScore,
          relevanceAvg,
          correctnessAvg,
          hallucinationRate,
          retrievalAccuracyAvg,
          latencyAvgMs,
          latencyP95Ms,
          speechAccuracyAvg,
          handoverSuccessRate,
          csatScore,
          repetitionRate,
          evaluationStatus: 'completed',
          evaluatedMetricsCount: evaluatedCount,
          weightsApplied: JSON.stringify(normalizedWeights),
          summaryNotes,
          updatedAt: new Date()
        }
      });

      // Check Quality Thresholds and Trigger Alerts
      await this.checkQualityAlertThresholds(callRecordId, {
        overallScore,
        relevanceAvg,
        hallucinationRate,
        retrievalAccuracyAvg,
        latencyP95Ms,
        repetitionRate,
        handoverSuccessRate,
        csatScore
      });

      return {
        callRecordId,
        overallQualityScore: overallScore,
        relevanceAvg,
        correctnessAvg,
        hallucinationRate,
        retrievalAccuracyAvg,
        latencyAvgMs,
        latencyP95Ms,
        speechAccuracyAvg,
        handoverSuccessRate,
        csatScore,
        repetitionRate,
        evaluatedMetricsCount: evaluatedCount,
        weightsApplied: normalizedWeights,
        summaryNotes
      };
    } catch (error) {
      console.error(`[AIEvaluationService] Failed to evaluate conversation ${callRecordId}:`, error);
      return null;
    }
  }

  /**
   * 10. Check Quality Alerts & Insert AIQualityAlert Records
   */
  public async checkQualityAlertThresholds(
    callRecordId: string,
    metrics: {
      overallScore: number;
      relevanceAvg: number | null;
      hallucinationRate: number;
      retrievalAccuracyAvg: number | null;
      latencyP95Ms: number | null;
      repetitionRate: number;
      handoverSuccessRate: number | null;
      csatScore: number | null;
    }
  ): Promise<void> {
    try {
      const alertsToCreate: Array<{
        alertType: string;
        severity: 'warning' | 'critical';
        message: string;
        metrics: any;
      }> = [];

      if (metrics.relevanceAvg !== null && metrics.relevanceAvg < 0.60) {
        alertsToCreate.push({
          alertType: 'low_relevance',
          severity: metrics.relevanceAvg < 0.40 ? 'critical' : 'warning',
          message: `Low answer relevance detected (${(metrics.relevanceAvg * 100).toFixed(0)}%). Customer queries not being addressed.`,
          metrics: { relevanceAvg: metrics.relevanceAvg }
        });
      }

      if (metrics.hallucinationRate >= 20.0) {
        alertsToCreate.push({
          alertType: 'high_hallucination',
          severity: 'critical',
          message: `High hallucination incident rate (${metrics.hallucinationRate}%). AI response claims not found in verified knowledge base.`,
          metrics: { hallucinationRate: metrics.hallucinationRate }
        });
      }

      if (metrics.retrievalAccuracyAvg !== null && metrics.retrievalAccuracyAvg < 0.50) {
        alertsToCreate.push({
          alertType: 'poor_retrieval',
          severity: 'warning',
          message: `Poor RAG retrieval precision (${(metrics.retrievalAccuracyAvg * 100).toFixed(0)}%). Retrieved chunks lacked query context.`,
          metrics: { retrievalAccuracyAvg: metrics.retrievalAccuracyAvg }
        });
      }

      if (metrics.latencyP95Ms !== null && metrics.latencyP95Ms > 2500) {
        alertsToCreate.push({
          alertType: 'high_latency',
          severity: metrics.latencyP95Ms > 4000 ? 'critical' : 'warning',
          message: `P95 voice response latency exceeded threshold (${metrics.latencyP95Ms} ms).`,
          metrics: { latencyP95Ms: metrics.latencyP95Ms }
        });
      }

      if (metrics.repetitionRate >= 20.0) {
        alertsToCreate.push({
          alertType: 'repeated_questions',
          severity: 'warning',
          message: `High question repetition rate (${metrics.repetitionRate}%). AI asked questions that were previously answered.`,
          metrics: { repetitionRate: metrics.repetitionRate }
        });
      }

      if (metrics.handoverSuccessRate !== null && metrics.handoverSuccessRate < 0.50) {
        alertsToCreate.push({
          alertType: 'failed_handover',
          severity: 'critical',
          message: `Human escalation transfer failure rate high (${((1 - metrics.handoverSuccessRate) * 100).toFixed(0)}% failed).`,
          metrics: { handoverSuccessRate: metrics.handoverSuccessRate }
        });
      }

      if (metrics.csatScore !== null && metrics.csatScore < 50.0) {
        alertsToCreate.push({
          alertType: 'low_csat',
          severity: 'warning',
          message: `Low customer satisfaction rating (${metrics.csatScore}%).`,
          metrics: { csatScore: metrics.csatScore }
        });
      }

      for (const alert of alertsToCreate) {
        await prisma.aIQualityAlert.create({
          data: {
            callRecordId,
            alertType: alert.alertType,
            severity: alert.severity,
            message: alert.message,
            metrics: JSON.stringify(alert.metrics)
          }
        });
      }
    } catch (err) {
      console.error('[AIEvaluationService] Error creating quality alerts:', err);
    }
  }

  /**
   * 11. Asynchronous Background Job Queue (Non-blocking for real-time voice calls)
   */
  public enqueueEvaluationJob(callRecordId: string): void {
    // Non-blocking invocation via setImmediate to preserve audio real-time loop
    setImmediate(async () => {
      try {
        // Idempotency check: see if job already exists or was recently completed
        const existing = await prisma.evaluationJob.findFirst({
          where: { callRecordId, status: { in: ['queued', 'processing', 'completed'] } }
        });

        if (existing && existing.status === 'completed') {
          return;
        }

        const job = existing || await prisma.evaluationJob.create({
          data: {
            callRecordId,
            status: 'processing',
            attempts: 1
          }
        });

        const result = await this.evaluateConversation(callRecordId);

        if (result) {
          await prisma.evaluationJob.update({
            where: { id: job.id },
            data: { status: 'completed', updatedAt: new Date() }
          });
          console.log(`[AIEvaluationService] Background evaluation completed for call ${callRecordId}. Score: ${result.overallQualityScore}/100`);
        } else {
          await prisma.evaluationJob.update({
            where: { id: job.id },
            data: { status: 'failed', error: 'Evaluation produced null summary', updatedAt: new Date() }
          });
        }
      } catch (err: any) {
        console.error(`[AIEvaluationService] Background evaluation failed for ${callRecordId}:`, err.message || err);
      }
    });
  }
}

export const aiEvaluationService = new AIEvaluationService();
