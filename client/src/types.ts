export type LanguageCode = 'en' | 'ta' | 'te' | 'ml' | 'kn' | 'hi';

export const SUPPORTED_LANGUAGES: Record<LanguageCode, { name: string; nativeName: string; bcp47: string }> = {
  en: { name: 'English', nativeName: 'English', bcp47: 'en-US' },
  ta: { name: 'Tamil', nativeName: 'தமிழ்', bcp47: 'ta-IN' },
  te: { name: 'Telugu', nativeName: 'తెలుగు', bcp47: 'te-IN' },
  ml: { name: 'Malayalam', nativeName: 'മലയാളം', bcp47: 'ml-IN' },
  kn: { name: 'Kannada', nativeName: 'ಕನ್ನಡ', bcp47: 'kn-IN' },
  hi: { name: 'Hindi', nativeName: 'हिन्दी', bcp47: 'hi-IN' }
};

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: 'admin' | 'agent' | 'customer';
  avatar?: string | null;
  preferredLanguage?: LanguageCode | string;
  supportedLanguages?: string;
  agentStatus?: 'available' | 'busy' | 'offline';
  maxConcurrentCalls?: number;
  createdAt?: string;
  totalCalls?: number;
  lastCallDate?: string | null;
}

export interface CallTranscript {
  id: string;
  sender: 'customer' | 'ai' | 'agent' | 'admin' | 'system';
  senderName?: string | null;
  text: string;
  translation?: string | null;
  language?: string | null;
  timestamp: string;
}

export interface CallTransferRequest {
  id: string;
  callRecordId: string;
  customerId?: string | null;
  customerName: string;
  customerPhone?: string | null;
  question: string;
  reason: string;
  status: 'pending' | 'ringing' | 'accepted' | 'connected' | 'rejected' | 'missed' | 'completed';
  adminId?: string | null;
  createdAt: string;
  respondedAt?: string | null;
  callRecord?: CallRecord;
}

export interface CallRecord {
  id: string;
  callId: string;
  customerId?: string | null;
  customerName: string;
  customerPhone?: string | null;
  agentId?: string | null;
  agentName?: string | null;
  adminId?: string | null;
  adminName?: string | null;
  adminSessionId?: string | null;
  adminOperatorName?: string | null;
  adminHandled?: boolean;
  type: 'ai_voice' | 'agent_voice' | 'admin_transfer';
  direction: 'incoming' | 'outgoing';
  callType?: 'incoming' | 'outgoing' | string;
  status: 'queued' | 'ringing' | 'active' | 'completed' | 'missed' | 'transferred' | 'rejected' | 'disconnected' | 'failed' | string;
  language?: LanguageCode | string;
  startTime: string;
  endTime?: string | null;
  duration: number; // in seconds
  queueDuration?: number;
  transferred: boolean;
  transferReason?: string | null;
  customerQuestion?: string | null;
  callNotes?: string | null;
  endedBy?: string | null;
  rating?: number | null;
  overallSentiment?: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'FRUSTRATED' | null;
  sentimentScore?: number | null;
  requiresAssistance?: boolean;
  assistanceReason?: string | null;
  assistanceStatus?: 'none' | 'pending' | 'accepted' | 'dismissed' | null;
  ratingComment?: string | null;
  feedbackFollowUpCompleted?: boolean;
  feedbackFollowUpNotes?: string | null;
  providerCallSid?: string | null;
  providerName?: string | null;
  failureReason?: string | null;
  quality?: 'excellent' | 'good' | 'poor' | string | null;
  avgLatency?: number | null;
  packetLoss?: number | null;
  jitter?: number | null;
  reconnectCount?: number;
  wasReconnected?: boolean;
  audioQualityScore?: number | null;
  intelligence?: CallIntelligence | null;
  followUpTasks?: FollowUpTask[];
  customer?: { id: string; name: string; email: string; phone?: string | null };
  agent?: { id: string; name: string };
  admin?: { id: string; name: string };
  transcripts?: CallTranscript[];
  transferRequests?: CallTransferRequest[];
  sentimentRecords?: SentimentRecord[];
}

export interface KnowledgeEntry {
  id: string;
  documentId?: string | null;
  title: string;
  category: string;
  question?: string | null;
  answer?: string | null;
  content: string;
  keywords?: string | null;
  createdAt: string;
  updatedAt: string;
  document?: { id: string; fileName: string; title: string };
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  status: 'processing' | 'indexed' | 'failed';
  extractedText: string;
  entryCount: number;
  createdAt: string;
  _count?: { entries: number };
}

export interface CallStats {
  totalCustomers: number;
  totalAgents?: number;
  totalCalls: number;
  totalIncoming: number;
  totalOutgoing: number;
  activeCalls: number;
  completedCalls: number;
  transferredCalls: number;
  pendingTransfers: number;
  queuedCalls?: number;
  availableAgents?: number;
  busyAgents?: number;
  avgWaitTime?: number; // in seconds
  avgDuration?: number; // in seconds
  callsByLanguage?: Record<string, number>;
  successfulCalls?: number;
  failedCalls?: number;
  disconnectedCalls?: number;
  reconnectedCalls?: number;
  avgLatency?: number;
  avgPacketLoss?: number;
  qualityBreakdown?: Record<string, number>;
}

export interface CallQualityStats {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  disconnectedCalls: number;
  reconnectedCalls: number;
  avgDuration: number;
  avgLatency: number;
  avgPacketLoss: number;
  avgJitter?: number;
  qualityBreakdown: {
    excellent: number;
    good: number;
    poor: number;
  };
  history: CallRecord[];
}

export interface CallIntelligence {
  id: string;
  callRecordId: string;
  customerId?: string | null;
  customerName: string;
  agentId?: string | null;
  agentName?: string | null;
  duration: number;
  language: string;
  callReason: string;
  customerQuestions: string; // JSON string or array
  solutionsProvided: string; // JSON string or array
  kbSourcesUsed?: string | null;
  resolutionStatus: 'resolved' | 'partially_resolved' | 'unresolved' | 'escalated_admin';
  resolutionExplanation: string;
  unresolvedQuestions?: string | null;
  actionItems?: string | null;
  overallSummary: string;
  sentiment?: 'positive' | 'neutral' | 'negative' | null;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  errorMessage?: string | null;
  retryCount: number;
  createdAt: string;
}

export interface FollowUpTask {
  id: string;
  callRecordId: string;
  customerId?: string | null;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  assignedAgentId?: string | null;
  assignedAgentName?: string | null;
  title: string;
  unresolvedQuestion: string;
  previousSummary: string;
  actionRequired: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  language?: string | null;
  notes?: string | null;
  resolutionNotes?: string | null;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  dueDate?: string | null;
  createdAt: string;
  updatedAt?: string;
  callRecord?: {
    id: string;
    callId: string;
    startTime: string;
    duration: number;
    language?: string;
    direction?: string;
    transcripts?: CallTranscript[];
    intelligence?: CallIntelligence | null;
  };
  assignedAgent?: { id: string; name: string; email: string };
}

export interface KnowledgeGap {
  id: string;
  question: string;
  normalizedQuestion: string;
  language: string;
  frequency: number;
  topic: string;
  sampleCallId?: string | null;
  status: 'open' | 'in_review' | 'added_to_kb' | 'dismissed';
  lastAskedAt: string;
  createdAt: string;
}

export interface CallIntelligenceStats {
  totalCallsAnalyzed: number;
  resolvedCalls: number;
  partiallyResolvedCalls: number;
  unresolvedCalls: number;
  escalatedCalls: number;
  pendingFollowUpTasks: number;
  completedFollowUpTasks: number;
  frequentlyAskedQuestions: Array<{ question: string; count: number; category: string }>;
  kbGaps: KnowledgeGap[];
  agentResolutionStats: Array<{
    agentId: string;
    agentName: string;
    email: string;
    totalCallsHandled: number;
    resolvedCount: number;
    resolutionRate: number;
  }>;
  recentIntelligence: Array<{
    id: string;
    callRecordId: string;
    customerName: string;
    agentName?: string | null;
    resolutionStatus: string;
    customerQuestions: string;
    sentiment?: string | null;
    createdAt: string;
  }>;
}

export interface CustomerInteractionHistory {
  customer: {
    id: string;
    name: string;
    email: string;
    phone?: string | null;
    preferredLanguage: string;
    createdAt: string;
    lastInteraction: string;
  };
  calls: Array<{
    id: string;
    callId: string;
    startTime: string;
    duration: number;
    type: string;
    direction: string;
    status: string;
    agentName?: string | null;
    language?: string | null;
    intelligence?: CallIntelligence | null;
    transcripts?: CallTranscript[];
  }>;
  followUpTasks: FollowUpTask[];
  questionsAsked: Array<{ callId: string; date: string; question: string }>;
  solutionsProvided: Array<{ callId: string; date: string; solution: string }>;
  unresolvedIssues: Array<{ callId: string; date: string; issue: string; status: string }>;
}

export type SentimentType = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'FRUSTRATED';

export interface SentimentRecord {
  id: string;
  callRecordId: string;
  customerId?: string | null;
  sentiment: SentimentType;
  confidenceScore: number;
  reason?: string | null;
  triggerText?: string | null;
  language?: string | null;
  requiresHumanAssistance: boolean;
  isFinal: boolean;
  customerExperienceNote?: string | null;
  detectedAt: string;
}

export interface SentimentAnalyticsData {
  totalAnalyzed: number;
  counts: {
    positive: number;
    negative: number;
    neutral: number;
    frustrated: number;
  };
  percentages: {
    positive: number;
    negative: number;
    neutral: number;
    frustrated: number;
  };
  requiresHumanAssistance: number;
  recentCalls: Array<{
    id: string;
    callId: string;
    customerName: string;
    customerPhone?: string | null;
    overallSentiment: SentimentType;
    sentimentScore: number;
    requiresAssistance: boolean;
    assistanceReason?: string | null;
    assistanceStatus?: string | null;
    language?: string | null;
    duration: number;
    createdAt: string;
  }>;
  dailyTrend: Array<{
    date: string;
    positive: number;
    negative: number;
    neutral: number;
    frustrated: number;
  }>;
  filterApplied: {
    period: string;
    category: string;
  };
}

// Business Intelligence Reports Types
export interface BiKpis {
  totalCalls: number;
  completedCalls: number;
  missedCalls: number;
  transferredCalls: number;
  rejectedCalls: number;
  averageDurationSeconds: number;
  averageDurationFormatted: string;
  totalDurationSeconds: number;
  uniqueCustomers: number;
  positiveSentimentPct: number;
  negativeSentimentPct: number;
  neutralSentimentPct: number;
  frustratedSentimentPct: number;
  totalCallsRequiringAssistance: number;
  totalActiveAgents: number;
}

export interface BiIssueCategory {
  category: string;
  count: number;
  percentage: number;
}

export interface BiAgentPerformance {
  agentId: string;
  name: string;
  email: string;
  role: string;
  status: string;
  callsHandled: number;
  completed: number;
  transferred: number;
  missed: number;
  avgDurationSeconds: number;
  avgDurationFormatted: string;
  sentimentDistribution: {
    positive: number;
    neutral: number;
    negative: number;
    frustrated: number;
  };
}

export interface BiHourlyVolume {
  hour: number;
  label: string;
  total: number;
  completed: number;
  missed: number;
  transferred: number;
}

export interface BiDailyTrend {
  date: string;
  label: string;
  totalCalls: number;
  completed: number;
  missed: number;
  transferred: number;
  avgDurationSeconds: number;
}

export interface BiComparison {
  current: number;
  previous: number;
  changePct: number;
  isPositiveChange: boolean;
  comparisonAvailable: boolean;
}

export interface BiOverviewData {
  period: {
    startDate: string;
    endDate: string;
    reportType: 'daily' | 'monthly' | 'custom';
    daysCovered: number;
  };
  kpis: BiKpis;
  sentiment: {
    positiveCount: number;
    neutralCount: number;
    negativeCount: number;
    frustratedCount: number;
    totalAnalyzed: number;
    callsRequiringAssistance: number;
    topDissatisfactionReasons: Array<{ reason: string; count: number }>;
  };
  issues: BiIssueCategory[];
  agentPerformance: BiAgentPerformance[];
  hourlyVolume: BiHourlyVolume[];
  dailyTrends: BiDailyTrend[];
  peakCallHours: string;
  comparisons?: {
    totalCalls: BiComparison;
    completedCalls: BiComparison;
    averageDuration: BiComparison;
    uniqueCustomers: BiComparison;
    frustratedPct: BiComparison;
  };
  executiveSummary: string[];
}

export interface BusinessReportRecord {
  id: string;
  title: string;
  reportType: 'daily' | 'monthly' | 'custom';
  startDate: string;
  endDate: string;
  generatedAt: string;
  generatedBy: string;
  status: string;
  hasPdf: boolean;
  hasCsv: boolean;
}


