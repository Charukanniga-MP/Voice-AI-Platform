# KAIRA – Enterprise AI Quality Evaluation & Observability Engine Report

## 1. Executive Summary

This report documents the implementation and architectural deployment of the **Enterprise-Grade AI Quality Evaluation & Observability Engine** inside **KAIRA – AI Voice Agent & Customer Communication Platform**.

The system establishes automated real-time and post-call evaluation across **nine core quality dimensions**, OpenTelemetry-style distributed latency tracing, RAGAS-compatible RAG evaluation, SQLite database persistence via Prisma ORM, an asynchronous background evaluation worker, quality alerts, a dedicated Admin Dashboard observability UI, and automated test coverage.

All voice conversation capabilities (WebRTC, Socket.IO, Deepgram streaming, Web Speech API, VoiceOutputController barge-in, client & server acoustic echo suppression, and multi-turn conversational memory) remain intact with zero latency degradation.

---

## 2. Nine Core Evaluation Dimensions

The engine evaluates every voice interaction across nine distinct dimensions:

| Dimension | Range | Measurement Method | Target Baseline |
| :--- | :---: | :--- | :---: |
| **1. Answer Relevance** | 0.0 – 1.0 | Lexical and semantic token alignment with customer query intent. Penalizes architectural deflections. | $\ge 0.85$ (85%) |
| **2. Answer Correctness** | 0.0 – 1.0 | Factual verification of AI statements against retrieved Knowledge Base evidence snippets. | $\ge 0.85$ (85%) |
| **3. Hallucination Control** | 0.0 – 1.0 | Unsupported claim extraction. Flags assertions not grounded in verified company documents. | $\ge 0.90$ (90%) |
| **4. Retrieval Accuracy** | 0.0 – 1.0 | RAGAS-compatible Context Precision@K, Context Relevance, Recall, and Knowledge Base Coverage. | $\ge 0.80$ (80%) |
| **5. Response Latency** | Milliseconds | Sub-component latency breakdown (STT, Intent, RAG, LLM, TTS, Total) with Avg & P95 calculation. | P95 $< 1,200$ ms |
| **6. Speech Recognition** | WER & CER | Levenshtein dynamic programming on verified reference transcripts; audio failure detection. | WER $< 0.15$ |
| **7. Handover Success** | 0.0 – 1.0 | Tracking handover pipeline: request trigger, specialist notification, acceptance, and transfer. | $\ge 0.90$ (90%) |
| **8. Customer Satisfaction** | 0 – 100% | 1–5 star post-call ratings, sentiment classification of feedback text, independent of AI emotion. | $\ge 85\%$ |
| **9. Repetition Control** | 0 – 100% | Jaccard & Levenshtein similarity on AI questions across turns. Flags re-asking answered questions. | Repetition $< 5\%$ |

---

## 3. Mathematical Formulations & Algorithms

### A. Word Error Rate (WER) & Character Error Rate (CER)
Using standard Levenshtein dynamic programming on word and character tokens:
$$\text{WER} = \frac{S + D + I}{N}$$
where:
- $S$ = Substitutions (words replaced)
- $D$ = Deletions (words omitted)
- $I$ = Insertions (words hallucinated or extra)
- $N$ = Total words in reference ground-truth transcript

Similarly for Character Error Rate:
$$\text{CER} = \frac{S_c + D_c + I_c}{N_c}$$

### B. RAGAS Context Precision@K
$$\text{Context Precision@K} = \frac{\sum_{k=1}^K (\text{Precision@k} \times v_k)}{\text{Total Relevant Chunks}}$$
where $v_k \in \{0, 1\}$ indicates whether the $k$-th retrieved chunk contains ground-truth query terms.

### C. OpenTelemetry Distributed Tracing Context
Each voice turn is assigned a W3C-compatible trace context:
- `traceId`: 16-byte cryptographically secure hexadecimal string (32 characters).
- `spanId`: 8-byte cryptographically secure hexadecimal string (16 characters).
- Sub-component spans: `sttMs` $\rightarrow$ `intentMs` $\rightarrow$ `ragMs` $\rightarrow$ `llmMs` $\rightarrow$ `ttsMs` $\rightarrow$ `totalMs`.

### D. Transparent Weighted Overall Quality Score
The overall score uses transparent weights:
- **Answer Relevance**: 20%
- **Answer Correctness**: 20%
- **Hallucination Control**: 15%
- **Retrieval Accuracy**: 10%
- **Speech Recognition Accuracy**: 10%
- **Human Handover Success**: 10%
- **Customer Satisfaction**: 10%
- **Conversation Repetition Control**: 5%

#### Dynamic Normalization Formula:
When metrics are unavailable for a specific call (e.g., call did not trigger a human handover, customer did not submit a post-call rating, or no audio reference transcript exists), **the missing dimensions are excluded dynamically and the remaining weights are re-normalized to 100%**:
$$\hat{w}_i = \frac{w_i}{\sum_{j \in \text{Available}} w_j}$$
$$\text{Overall AI Quality Score} = \sum_{i \in \text{Available}} \hat{w}_i \times \text{Score}_i$$
Missing metrics are never penalized or treated as 0.

---

## 4. Database Schema Extensions (Prisma / SQLite)

The following models were integrated into `server/prisma/schema.prisma`:

1. `AIResponseEvaluation`: Turn-level evaluation capturing query, AI response, relevanceScore, correctnessScore, hallucinationScore, isHallucination, supportedClaims, unsupportedClaims, and retrieved evidence.
2. `ConversationEvaluation`: Call-level summary aggregating overallQualityScore (0–100), metric averages, weightsApplied (JSON), and evaluation status.
3. `RAGEvaluation`: Retrieval performance metrics including contextRelevance, contextPrecision, contextRecall, and kbCoverage.
4. `LatencyMetrics`: OpenTelemetry trace spans tracking sttMs, intentMs, ragMs, llmMs, ttsMs, and totalMs.
5. `SpeechEvaluation`: Exact WER and CER records, audio failure flags, and language identification accuracy.
6. `HandoverEvaluation`: Human escalation stage tracking (request reason, agent notification, acceptance, completion, timeToConnectMs).
7. `CustomerFeedback`: Customer post-call 1–5 star ratings, feedback comments, and sentiment.
8. `RepetitionIncident`: Records duplicate question occurrences with previousTurnId and similarityScore.
9. `EvaluationJob`: Idempotent queue tracking background evaluation processing.
10. `AIQualityAlert`: Automated alerts for low relevance, high hallucination rates, latency threshold breaches, or handover transfer failures.

---

## 5. Admin Dashboard UI (`AIQualityObservabilitySection.tsx`)

The Admin Dashboard now features a dedicated **"AI Quality & Observability"** tab:
1. **Interactive KPI Overview Cards**: 10 progress bars, scores, and status badges.
2. **Interactive SVG Trends Visualizations**: Line charts tracking daily quality score and answer relevance over time.
3. **Active Quality Alerts Panel**: Real-time notifications for critical or warning quality events with one-click dismissal.
4. **Call Evaluation History Table**: Searchable, paginated audit records with status filters (All, Hallucinations, Low Quality, Failed) and CSV export.
5. **Call Quality Deep-Dive Modal**:
   - Turn-by-turn grounding viewer: highlights supported statements in green and unsupported claims in red.
   - RAG evidence snippets with precision and recall scores.
   - OpenTelemetry latency waterfall timeline (STT $\rightarrow$ Intent $\rightarrow$ RAG $\rightarrow$ LLM $\rightarrow$ TTS).
   - Post-call customer satisfaction feedback rating stars and customer notes.

---

## 6. Verification & Automated Test Coverage

The platform was verified through automated test suites:

| Test Suite | Total Assertions | Passed | Pass Rate |
| :--- | :---: | :---: | :---: |
| `test_ai_quality_evaluation_suite.ts` | 38 | 38 | **100%** |
| `test_barge_in_interruption.ts` | 6 | 6 | **100%** |
| `test_voice_workflow_critical_fix.ts` | 7 | 7 | **100%** |
| `test_conversational_intelligence_suite.ts` | 18 | 18 | **100%** |
| **Combined Platform Total** | **69** | **69** | **100%** |

### Verified Test Capabilities:
- ✅ Answer relevance detection (penalizes architectural deflection to $\le 0.35$).
- ✅ Grounded correctness calculation vs retrieved context chunks.
- ✅ Hallucination claim extraction and incident flagging.
- ✅ RAGAS Context Precision and Knowledge Base coverage.
- ✅ Exact Word Error Rate (WER) and Character Error Rate (CER) via dynamic programming.
- ✅ OpenTelemetry 16-byte hex Trace IDs and 8-byte Span IDs with lifecycle attributes.
- ✅ Semantic repeated question detection with stop-phrase suppression.
- ✅ Dynamic missing-metric weight normalization summing to 1.0 (100%).
- ✅ Idempotent background evaluation worker queue (`setImmediate`).
- ✅ Real-time acoustic echo suppression, barge-in voice interruption, and multi-turn context retention.
