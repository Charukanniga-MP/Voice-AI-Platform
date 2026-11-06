export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: 'admin' | 'agent' | 'customer';
  avatar?: string | null;
  createdAt?: string;
  totalCalls?: number;
  lastCallDate?: string | null;
}

export interface CallTranscript {
  id: string;
  sender: 'customer' | 'ai' | 'agent' | 'admin' | 'system';
  senderName?: string | null;
  text: string;
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
  status: 'active' | 'completed' | 'missed' | 'transferred' | 'rejected';
  startTime: string;
  endTime?: string | null;
  duration: number; // in seconds
  transferred: boolean;
  transferReason?: string | null;
  customerQuestion?: string | null;
  providerCallSid?: string | null;
  providerName?: string | null;
  failureReason?: string | null;
  customer?: { id: string; name: string; email: string; phone?: string | null };
  agent?: { id: string; name: string };
  admin?: { id: string; name: string };
  transcripts?: CallTranscript[];
  transferRequests?: CallTransferRequest[];
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
  totalCalls: number;
  totalIncoming: number;
  totalOutgoing: number;
  activeCalls: number;
  completedCalls: number;
  transferredCalls: number;
  pendingTransfers: number;
}

