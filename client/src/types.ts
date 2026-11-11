export type LanguageCode = 'en' | 'ta' | 'te' | 'ml' | 'hi';

export const SUPPORTED_LANGUAGES: Record<LanguageCode, { name: string; nativeName: string; bcp47: string }> = {
  en: { name: 'English', nativeName: 'English', bcp47: 'en-US' },
  ta: { name: 'Tamil', nativeName: 'தமிழ்', bcp47: 'ta-IN' },
  te: { name: 'Telugu', nativeName: 'తెలుగు', bcp47: 'te-IN' },
  ml: { name: 'Malayalam', nativeName: 'മലയാളം', bcp47: 'ml-IN' },
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
  type: 'ai_voice' | 'agent_voice' | 'admin_transfer';
  direction: 'incoming' | 'outgoing';
  status: 'queued' | 'ringing' | 'active' | 'completed' | 'missed' | 'transferred' | 'rejected';
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
  providerCallSid?: string | null;
  providerName?: string | null;
  failureReason?: string | null;
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

