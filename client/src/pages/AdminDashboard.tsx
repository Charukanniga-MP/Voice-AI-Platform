import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { getSocket } from '../services/socket.js';
import { webrtcManager } from '../services/webrtc.js';
import { voiceService } from '../services/voice.js';
import { ringtoneService } from '../services/ringtone.js';
import { SupportTickets } from './SupportTickets.js';
import {
  User, CallRecord, CallTranscript, CallTransferRequest,
  KnowledgeEntry, KnowledgeDocument, CallStats, CallQualityStats, LanguageCode, SUPPORTED_LANGUAGES,
  CallIntelligenceStats, KnowledgeGap, FollowUpTask
} from '../types.js';
import { CustomerProfileModal } from '../components/CustomerProfileModal.js';
import { CallIntelligenceModal } from '../components/CallIntelligenceModal.js';
import { FollowUpTasksManager } from '../components/FollowUpTasksManager.js';
import {
  Users, PhoneCall, PhoneIncoming, PhoneOutgoing, PhoneForwarded,
  PhoneOff, Mic, MicOff, Volume2, VolumeX, Clock, Search,
  BookOpen, Plus, Trash2, Edit3, Upload, CheckCircle2, MessageSquare,
  AlertCircle, ShieldAlert, Eye, Headphones, Radio, RefreshCw, Globe,
  Activity, Wifi, WifiOff, Signal, Zap, AlertTriangle, XCircle, BarChart3, Sliders, ShieldCheck,
  Sparkles, ListTodo, Download, Lightbulb, HeartPulse, TrendingUp
} from 'lucide-react';
import { SentimentDashboardSection } from '../components/SentimentDashboardSection.js';
import { SentimentBadge } from '../components/SentimentBadge.js';
import { PostCallSentimentSummary } from '../components/PostCallSentimentSummary.js';
import { LiveSentimentCard } from '../components/LiveSentimentCard.js';
import { BiReportsSection } from '../components/BiReportsSection.js';

// Pure deduplication utility function
function deduplicate<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyFn(item).trim().toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

export const AdminDashboard: React.FC = () => {
  const { user, token } = useAuth();

  // Active navigation section
  const [activeSection, setActiveSection] = useState<'overview' | 'customers' | 'agents' | 'calls' | 'intelligence' | 'tasks' | 'transfers' | 'knowledge' | 'tickets' | 'quality' | 'sentiment' | 'bi'>('overview');

  // Stats state
  const [stats, setStats] = useState<CallStats>({
    totalCustomers: 0,
    totalAgents: 0,
    totalCalls: 0,
    totalIncoming: 0,
    totalOutgoing: 0,
    activeCalls: 0,
    completedCalls: 0,
    transferredCalls: 0,
    pendingTransfers: 0
  });

  // Multi-Admin Operator Session State (Supports up to 10+ concurrent admins using shared admin credentials)
  const [adminSessionId] = useState<string>(() => {
    const existing = sessionStorage.getItem('kaira_admin_session_id');
    if (existing) return existing;
    const newId = 'adm_sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
    sessionStorage.setItem('kaira_admin_session_id', newId);
    return newId;
  });

  const [operatorName, setOperatorName] = useState<string>(() => {
    return localStorage.getItem('kaira_admin_operator_name') || user?.name || 'Ravi Arun';
  });
  const [isEditingOperatorName, setIsEditingOperatorName] = useState(false);
  const [tempOperatorName, setTempOperatorName] = useState(operatorName);
  const [showRoster, setShowRoster] = useState(false);

  // Multi-Admin Presence & ACD live stats
  const [adminPresence, setAdminPresence] = useState<{
    activeAdminSessions: number;
    availableAdminSessions: number;
    busyAdminSessions: number;
    activeCalls: number;
    operators: Array<{
      adminSessionId: string;
      operatorName: string;
      status: 'available' | 'ringing' | 'busy' | 'offline';
      activeCallId: string | null;
    }>;
  }>({
    activeAdminSessions: 1,
    availableAdminSessions: 1,
    busyAdminSessions: 0,
    activeCalls: 0,
    operators: []
  });

  // Dedicated Incoming Call Notification Modal for THIS admin operator session
  const [incomingAdminCall, setIncomingAdminCall] = useState<{
    callId: string;
    transferId?: string;
    customerId?: string;
    customerName: string;
    customerPhone?: string;
    preferredLanguage: string;
    question?: string;
    reason?: string;
    duration?: number;
    adminSessionId: string;
    operatorName: string;
  } | null>(null);

  // Active Dedicated Voice Session for this Admin Operator
  const [activeCall, setActiveCall] = useState<{
    callId: string;
    transferId?: string;
    customerId?: string;
    customerName: string;
    customerPhone?: string;
    preferredLanguage: string;
    question?: string;
  } | null>(null);

  // Legacy Incoming Transfer Notification Modal (for backward compatibility)
  const [incomingTransfer, setIncomingTransfer] = useState<{
    transferId: string;
    callId: string;
    customerName: string;
    customerPhone: string;
    question: string;
    reason: string;
    duration: number;
  } | null>(null);

  // Active Transferred Live Voice Session (for backward compatibility)
  const [activeTransferredCall, setActiveTransferredCall] = useState<{
    callId: string;
    transferId?: string;
    customerName: string;
    customerPhone?: string;
    question?: string;
  } | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [transcripts, setTranscripts] = useState<CallTranscript[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [liveSentiment, setLiveSentiment] = useState<{
    sentiment: any;
    confidenceScore: number;
    reason: string;
    triggerText: string;
    requiresHumanAssistance: boolean;
  } | null>(null);
  const [replyText, setReplyText] = useState('');

  // Section B: Customer Management State
  const [customers, setCustomers] = useState<User[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<User | null>(null);
  const [deletingCustomer, setDeletingCustomer] = useState<User | null>(null);
  const [selectedCustomerHistory, setSelectedCustomerHistory] = useState<User | null>(null);

  // Customer Form State
  const [custFormName, setCustFormName] = useState('');
  const [custFormEmail, setCustFormEmail] = useState('');
  const [custFormPhone, setCustFormPhone] = useState('');
  const [custFormPassword, setCustFormPassword] = useState('');

  // Section C: Agent Management State
  const [agents, setAgents] = useState<User[]>([]);
  const [agentSearch, setAgentSearch] = useState('');
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [showAddAgentModal, setShowAddAgentModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState<User | null>(null);
  const [deletingAgent, setDeletingAgent] = useState<User | null>(null);

  // Agent Form State
  const [agentFormName, setAgentFormName] = useState('');
  const [agentFormEmail, setAgentFormEmail] = useState('');
  const [agentFormPhone, setAgentFormPhone] = useState('');
  const [agentFormPassword, setAgentFormPassword] = useState('');

  // Section D: Call Monitoring State
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [lowRatingFeedback, setLowRatingFeedback] = useState<CallRecord[]>([]);
  const [callFilter, setCallFilter] = useState<'all' | 'incoming' | 'outgoing' | 'transferred' | 'active' | 'completed' | 'missed'>('all');
  const [callSearch, setCallSearch] = useState('');
  const [loadingCalls, setLoadingCalls] = useState(false);
  const [selectedCallDetails, setSelectedCallDetails] = useState<CallRecord | null>(null);

  // Section E: Transfer Management State
  const [allTransfers, setAllTransfers] = useState<CallTransferRequest[]>([]);
  const [loadingTransfers, setLoadingTransfers] = useState(false);

  // Section F: Knowledge Base State
  const [kbEntries, setKbEntries] = useState<KnowledgeEntry[]>([]);
  const [kbDocuments, setKbDocuments] = useState<KnowledgeDocument[]>([]);
  const [kbSearch, setKbSearch] = useState('');
  const [kbCategory, setKbCategory] = useState('all');
  const [loadingKb, setLoadingKb] = useState(false);
  const [showAddKbModal, setShowAddKbModal] = useState(false);
  const [editingKbEntry, setEditingKbEntry] = useState<KnowledgeEntry | null>(null);
  const [deletingKbEntry, setDeletingKbEntry] = useState<KnowledgeEntry | null>(null);

  // Add/Edit KB Entry Form State
  const [kbTitle, setKbTitle] = useState('');
  const [kbCat, setKbCat] = useState('general');
  const [kbQuestion, setKbQuestion] = useState('');
  const [kbAnswer, setKbAnswer] = useState('');
  const [kbContent, setKbContent] = useState('');
  const [kbKeywords, setKbKeywords] = useState('');

  // Document Upload State
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  // Section G: Call Quality Monitoring State
  const [qualityStats, setQualityStats] = useState<CallQualityStats | null>(null);
  const [loadingQuality, setLoadingQuality] = useState(false);
  const [qualityFilter, setQualityFilter] = useState<'all' | 'excellent' | 'good' | 'poor' | 'reconnected' | 'disconnected' | 'failed'>('all');
  const [qualitySearch, setQualitySearch] = useState('');
  const [selectedQualityCall, setSelectedQualityCall] = useState<CallRecord | null>(null);

  // Section H: Call Intelligence & Follow-Up State
  const [intelligenceStats, setIntelligenceStats] = useState<CallIntelligenceStats | null>(null);
  const [loadingIntelligence, setLoadingIntelligence] = useState(false);
  const [gapSearch, setGapSearch] = useState('');
  const [gapLangFilter, setGapLangFilter] = useState('all');
  const [selectedIntelligenceCallId, setSelectedIntelligenceCallId] = useState<string | null>(null);
  const [selectedProfileCustomerId, setSelectedProfileCustomerId] = useState<string | null>(null);

  // Knowledge Gap Approval Modal State
  const [approvingGap, setApprovingGap] = useState<KnowledgeGap | null>(null);
  const [gapTitle, setGapTitle] = useState('');
  const [gapAnswer, setGapAnswer] = useState('');
  const [gapCategory, setGapCategory] = useState('general');
  const [savingGap, setSavingGap] = useState(false);

  // Auto-scroll transcript
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  // Duration timer
  useEffect(() => {
    let timer: any;
    if (activeCall || activeTransferredCall) {
      timer = setInterval(() => setCallDuration(prev => prev + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [activeCall, activeTransferredCall]);

  // Fetch Stats from Database
  const fetchStats = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/calls/stats', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) setStats(data);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  };

  // Fetch Customers with Deduplication
  const fetchCustomers = async () => {
    if (!token) return;
    setLoadingCustomers(true);
    try {
      const res = await fetch(`/api/customers?search=${encodeURIComponent(customerSearch)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        // Enforce strict uniqueness by lowercase email
        const unique = deduplicate<User>(data.customers || [], c => c.email);
        setCustomers(unique);
      }
    } catch (err) {
      console.error('Failed to fetch customers:', err);
    } finally {
      setLoadingCustomers(false);
    }
  };

  // Fetch Support Agents with Deduplication
  const fetchAgents = async () => {
    if (!token) return;
    setLoadingAgents(true);
    try {
      const res = await fetch(`/api/agents?search=${encodeURIComponent(agentSearch)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        const unique = deduplicate<User>(data.agents || [], a => a.email);
        setAgents(unique);
      }
    } catch (err) {
      console.error('Failed to fetch agents:', err);
    } finally {
      setLoadingAgents(false);
    }
  };

  // Fetch Calls with Deduplication
  const fetchCalls = async () => {
    if (!token) return;
    setLoadingCalls(true);
    try {
      const res = await fetch(`/api/calls?filter=${callFilter}&search=${encodeURIComponent(callSearch)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        const unique = deduplicate<CallRecord>(data.calls || [], c => c.providerCallSid || c.callId || c.id);
        setCalls(unique);
      }
    } catch (err) {
      console.error('Failed to fetch calls:', err);
    } finally {
      setLoadingCalls(false);
    }
  };

  const fetchLowRatingFeedback = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/calls/feedback/low', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) setLowRatingFeedback(data.calls || []);
    } catch (err) {
      console.error('Failed to load low-rating feedback:', err);
    }
  };

  const updateFeedbackFollowUp = async (call: CallRecord) => {
    if (!token) return;
    const completed = !call.feedbackFollowUpCompleted;
    try {
      const res = await fetch(`/api/calls/${call.id}/feedback-follow-up`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ completed, notes: call.feedbackFollowUpNotes || '' })
      });
      if (!res.ok) throw new Error('Could not save follow-up status');
      setLowRatingFeedback(prev => prev.map(item => item.id === call.id
        ? { ...item, feedbackFollowUpCompleted: completed }
        : item));
    } catch (err) {
      console.error('Failed to update feedback follow-up:', err);
      window.alert('Could not save the feedback follow-up. Please try again.');
    }
  };

  // Fetch Transfers with Deduplication
  const fetchTransfers = async () => {
    if (!token) return;
    setLoadingTransfers(true);
    try {
      const res = await fetch('/api/calls/transfers', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        // Deduplicate transfers by callRecordId to show each call's latest transfer
        const unique = deduplicate<CallTransferRequest>(data.transfers || [], t => t.callRecordId || t.id);
        setAllTransfers(unique);
      }
    } catch (err) {
      console.error('Failed to fetch transfers:', err);
    } finally {
      setLoadingTransfers(false);
    }
  };

  // Fetch Knowledge Base & Documents with Deduplication
  const fetchKnowledge = async () => {
    if (!token) return;
    setLoadingKb(true);
    try {
      const [entriesRes, docsRes] = await Promise.all([
        fetch(`/api/knowledge?category=${kbCategory}&search=${encodeURIComponent(kbSearch)}`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch('/api/knowledge/documents', {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);

      const entriesData = await entriesRes.json();
      const docsData = await docsRes.json();

      if (entriesRes.ok) {
        const uniqueEntries = deduplicate<KnowledgeEntry>(entriesData.entries || [], e => `${e.title}:::${e.question || ''}`);
        setKbEntries(uniqueEntries);
      }
      if (docsRes.ok) {
        const uniqueDocs = deduplicate<KnowledgeDocument>(docsData.documents || [], d => d.id);
        setKbDocuments(uniqueDocs);
      }
    } catch (err) {
      console.error('Failed to fetch knowledge:', err);
    } finally {
      setLoadingKb(false);
    }
  };

  // Fetch Call Quality Stats & Telemetry
  const fetchQualityStats = async () => {
    if (!token) return;
    setLoadingQuality(true);
    try {
      const res = await fetch('/api/calls/quality/stats', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        setQualityStats(data);
      }
    } catch (err) {
      console.error('Failed to load call quality stats:', err);
    } finally {
      setLoadingQuality(false);
    }
  };

  // Fetch AI Post-Call Intelligence Statistics & Knowledge Gaps
  const fetchIntelligenceStats = async () => {
    if (!token) return;
    setLoadingIntelligence(true);
    try {
      const res = await fetch('/api/calls/intelligence/stats', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setIntelligenceStats(data);
      }
    } catch (err) {
      console.error('Failed to load intelligence stats:', err);
    } finally {
      setLoadingIntelligence(false);
    }
  };

  const handleOpenApproveGap = (gap: KnowledgeGap) => {
    setApprovingGap(gap);
    setGapTitle(gap.topic || 'General Inquiry');
    setGapAnswer('');
    setGapCategory('general');
  };

  const handleSaveApproveGap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approvingGap || !token) return;
    setSavingGap(true);
    try {
      const res = await fetch(`/api/knowledge-gaps/${approvingGap.id}/approve-to-kb`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          title: gapTitle,
          answer: gapAnswer,
          category: gapCategory
        })
      });
      if (res.ok) {
        setApprovingGap(null);
        fetchIntelligenceStats();
        fetchKnowledge();
      } else {
        const err = await res.json();
        alert(err.message || 'Failed to approve knowledge gap');
      }
    } catch (err) {
      console.error('Error approving knowledge gap:', err);
      alert('Network error approving gap');
    } finally {
      setSavingGap(false);
    }
  };

  // Initial stats load
  useEffect(() => {
    fetchStats();
    fetchIntelligenceStats();
  }, [token]);

  // Section-specific data fetching
  useEffect(() => {
    if (activeSection === 'overview') fetchStats();
    if (activeSection === 'customers') fetchCustomers();
    if (activeSection === 'agents') fetchAgents();
    if (activeSection === 'calls') {
      fetchCalls();
      fetchLowRatingFeedback();
    }
    if (activeSection === 'transfers') fetchTransfers();
    if (activeSection === 'knowledge') fetchKnowledge();
    if (activeSection === 'quality') fetchQualityStats();
    if (activeSection === 'intelligence') fetchIntelligenceStats();
  }, [activeSection, token, customerSearch, agentSearch, callFilter, callSearch, kbCategory, kbSearch]);

  // Save Operator Name
  const handleSaveOperatorName = () => {
    const clean = tempOperatorName.trim();
    if (!clean) return;
    setOperatorName(clean);
    localStorage.setItem('kaira_admin_operator_name', clean);
    setIsEditingOperatorName(false);
    const socket = getSocket();
    socket.emit('admin:update_status', {
      adminSessionId,
      operatorName: clean,
      status: activeCall ? 'busy' : 'available'
    });
  };

  // Socket setup with clean teardown
  useEffect(() => {
    const socket = getSocket();

    const registerSession = () => {
      socket.emit('admin:register_session', {
        adminSessionId,
        adminId: user?.id,
        adminName: user?.name || 'Admin',
        operatorName,
        supportedLanguages: ['en', 'ta', 'te', 'ml', 'kn', 'hi']
      });
    };

    // Register immediately and on socket reconnect
    registerSession();
    socket.on('connect', registerSession);

    // Multi-admin session presence update
    const handleSessionsUpdated = (data: any) => {
      if (data) setAdminPresence(data);
    };

    // Incoming call assigned specifically to THIS admin session
    const handleIncomingCall = (data: any) => {
      console.log('[AdminDashboard] Incoming call assigned to session:', data);
      if (data.adminSessionId && data.adminSessionId !== adminSessionId) {
        return; // Directed to another admin session
      }
      setIncomingAdminCall(data);
      ringtoneService.start(data.customerName || 'Customer');
    };

    // Call missed or rerouted to another admin
    const handleCallMissed = (data: any) => {
      ringtoneService.stop();
      setIncomingAdminCall(prev => (prev && prev.callId === data.callId ? null : prev));
      if (incomingTransfer && incomingTransfer.callId === data.callId) {
        setIncomingTransfer(null);
      }
    };

    // Live speech transcript relay (Customer <-> Admin) with real-time deduplication
    const handleLiveTranscript = (data: {
      sender: any;
      senderName: string;
      text: string;
      translation?: string;
      language?: string;
      timestamp?: string;
    }) => {
      setTranscripts(prev => {
        const isDuplicate = prev.some(t =>
          t.sender === data.sender &&
          t.text.trim().toLowerCase() === data.text.trim().toLowerCase() &&
          Math.abs(Date.now() - new Date(t.timestamp).getTime()) < 3500
        );
        if (isDuplicate) return prev;
        return [
          ...prev,
          {
            id: 'tr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            sender: data.sender,
            senderName: data.senderName,
            text: data.text,
            translation: data.translation,
            language: data.language,
            timestamp: data.timestamp || new Date().toISOString()
          }
        ];
      });
    };

    // Backward-compatibility transfer handler
    const handleIncomingTransfer = (data: any) => {
      if (data.adminSessionId && data.adminSessionId !== adminSessionId) {
        return;
      }
      setIncomingTransfer(data);
      setIncomingAdminCall({
        callId: data.callId,
        transferId: data.transferId,
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        preferredLanguage: data.preferredLanguage || 'en',
        question: data.question,
        reason: data.reason || 'AI Knowledge Escalation',
        duration: data.duration || 0,
        adminSessionId,
        operatorName
      });
      ringtoneService.start(data.customerName);
      fetchStats();
    };

    const handleTransferUpdated = (data: any) => {
      if (incomingTransfer && incomingTransfer.transferId === data.transferId) {
        setIncomingTransfer(null);
      }
      if (incomingAdminCall && incomingAdminCall.transferId === data.transferId) {
        ringtoneService.stop();
        setIncomingAdminCall(null);
      }
      fetchTransfers();
      fetchStats();
    };

    const handleStatusChanged = () => {
      fetchStats();
      if (activeSection === 'calls') {
        fetchCalls();
        fetchLowRatingFeedback();
      }
    };

    const handleCallEnded = (data: any) => {
      if (activeCall && (!data?.callId || activeCall.callId === data.callId)) {
        handleEndAdminCall(false);
      } else if (activeTransferredCall && (!data?.callId || activeTransferredCall.callId === data.callId)) {
        handleEndTransferredCall();
      }
    };

    const handleSentimentUpdate = (data: any) => {
      setLiveSentiment(data);
    };

    socket.on('admin:sessions_updated', handleSessionsUpdated);
    socket.on('admin:incoming_call', handleIncomingCall);
    socket.on('admin:call_missed', handleCallMissed);
    socket.on('call:live_transcript', handleLiveTranscript);
    socket.on('transfer:incoming', handleIncomingTransfer);
    socket.on('transfer:status_updated', handleTransferUpdated);
    socket.on('call:status_changed', handleStatusChanged);
    socket.on('call:ended', handleCallEnded);
    socket.on('call:sentiment_update', handleSentimentUpdate);

    return () => {
      socket.off('connect', registerSession);
      socket.off('admin:sessions_updated', handleSessionsUpdated);
      socket.off('admin:incoming_call', handleIncomingCall);
      socket.off('admin:call_missed', handleCallMissed);
      socket.off('call:live_transcript', handleLiveTranscript);
      socket.off('transfer:incoming', handleIncomingTransfer);
      socket.off('transfer:status_updated', handleTransferUpdated);
      socket.off('call:status_changed', handleStatusChanged);
      socket.off('call:ended', handleCallEnded);
      socket.off('call:sentiment_update', handleSentimentUpdate);
      ringtoneService.stop();
    };
  }, [adminSessionId, operatorName, incomingTransfer, incomingAdminCall, activeCall, activeTransferredCall, activeSection]);

  // Handle Admin Accepting Dedicated Call
  const handleAcceptAdminCall = async () => {
    if (!incomingAdminCall) return;
    ringtoneService.stop();

    try {
      webrtcManager.unlockAudio();
      await webrtcManager.getMicrophoneStream();

      const socket = getSocket();
      socket.emit('admin:accept_call', {
        callId: incomingAdminCall.callId,
        adminSessionId,
        adminId: user?.id,
        operatorName,
        transferId: incomingAdminCall.transferId
      });

      const callDetails = {
        callId: incomingAdminCall.callId,
        transferId: incomingAdminCall.transferId,
        customerId: incomingAdminCall.customerId,
        customerName: incomingAdminCall.customerName,
        customerPhone: incomingAdminCall.customerPhone,
        preferredLanguage: incomingAdminCall.preferredLanguage || 'en',
        question: incomingAdminCall.question
      };

      setActiveCall(callDetails);
      setActiveTransferredCall(callDetails);
      setCallDuration(incomingAdminCall.duration || 0);

      const langMeta = SUPPORTED_LANGUAGES[(incomingAdminCall.preferredLanguage || 'en') as LanguageCode];
      const langDisplayName = langMeta ? `${langMeta.nativeName} (${langMeta.name})` : 'English';

      setTranscripts([
        {
          id: 't_init_' + Date.now(),
          sender: 'system',
          senderName: 'System',
          text: `Call connected. Operator ${operatorName} speaking with ${incomingAdminCall.customerName}. Language: ${langDisplayName}. Two-way live voice channel active.`,
          timestamp: new Date().toISOString()
        },
        ...(incomingAdminCall.question ? [{
          id: 't_q_' + Date.now(),
          sender: 'customer' as const,
          senderName: incomingAdminCall.customerName,
          text: `[Escalated Query]: "${incomingAdminCall.question}"`,
          timestamp: new Date().toISOString()
        }] : [])
      ]);

      // Start live speech recognition for Admin operator
      voiceService.setLanguage('en');
      voiceService.startListening((text, isFinal) => {
        if (isFinal && text.trim()) {
          socket.emit('call:live_speech', {
            callId: incomingAdminCall.callId,
            sender: 'admin',
            senderName: `${operatorName} (Admin)`,
            text: text.trim()
          });
        }
      });

      setIncomingAdminCall(null);
      setIncomingTransfer(null);
    } catch (err) {
      console.error('Error accepting admin call:', err);
      alert('Microphone access is required to take voice calls.');
    }
  };

  // Handle Admin Rejecting Dedicated Call (Triggers ACD Reroute)
  const handleRejectAdminCall = () => {
    if (!incomingAdminCall) return;
    ringtoneService.stop();

    const socket = getSocket();
    socket.emit('admin:reject_call', {
      callId: incomingAdminCall.callId,
      adminSessionId,
      reason: 'Admin operator busy'
    });

    setIncomingAdminCall(null);
    setIncomingTransfer(null);
  };

  // End Active Admin Call
  const handleEndAdminCall = (emitEndEvent: boolean = true) => {
    ringtoneService.stop();
    if (activeCall && emitEndEvent) {
      const socket = getSocket();
      socket.emit('call:end', {
        callId: activeCall.callId,
        duration: callDuration,
        adminSessionId
      });
    }

    setActiveCall(null);
    setActiveTransferredCall(null);
    setCallDuration(0);
    voiceService.stopListening();
    webrtcManager.endCall();
    fetchStats();
    if (activeSection === 'calls') fetchCalls();
  };

  // Legacy transfer handlers (delegate to new dedicated handlers)
  const handleAcceptTransfer = handleAcceptAdminCall;
  const handleRejectTransfer = handleRejectAdminCall;
  const handleEndTransferredCall = () => handleEndAdminCall(true);

  // Send typed message from Admin to Customer
  const handleSendAdminMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!replyText.trim() || !activeCall) return;

    const socket = getSocket();
    socket.emit('call:live_speech', {
      callId: activeCall.callId,
      sender: 'admin',
      senderName: `${operatorName} (Admin)`,
      text: replyText.trim()
    });

    setReplyText('');
  };

  // Customer Management Handlers
  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const cleanEmail = custFormEmail.trim().toLowerCase();

      // Client-side uniqueness check
      if (!editingCustomer && customers.some(c => c.email.trim().toLowerCase() === cleanEmail)) {
        alert(`A customer with email "${cleanEmail}" is already registered.`);
        return;
      }

      if (editingCustomer) {
        const res = await fetch(`/api/customers/${editingCustomer.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ name: custFormName, email: cleanEmail, phone: custFormPhone })
        });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || 'Failed to update customer');
        }
      } else {
        const res = await fetch('/api/customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            name: custFormName,
            email: cleanEmail,
            phone: custFormPhone,
            password: custFormPassword || 'customer@123'
          })
        });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || 'Failed to create customer');
        }
      }

      setShowAddCustomerModal(false);
      setEditingCustomer(null);
      setCustFormName('');
      setCustFormEmail('');
      setCustFormPhone('');
      setCustFormPassword('');
      fetchCustomers();
      fetchStats();
    } catch (err: any) {
      alert(err.message || 'Operation failed');
    }
  };

  const handleDeleteCustomer = async () => {
    if (!deletingCustomer) return;
    try {
      const res = await fetch(`/api/customers/${deletingCustomer.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to delete customer');
      setDeletingCustomer(null);
      fetchCustomers();
      fetchStats();
    } catch (err: any) {
      alert(err.message || 'Delete failed');
    }
  };

  // Agent Management Handlers
  const handleSaveAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const cleanEmail = agentFormEmail.trim().toLowerCase();

      if (!editingAgent && agents.some(a => a.email.trim().toLowerCase() === cleanEmail)) {
        alert(`A Support Agent with email "${cleanEmail}" already exists.`);
        return;
      }

      if (editingAgent) {
        const res = await fetch(`/api/agents/${editingAgent.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            name: agentFormName,
            email: cleanEmail,
            phone: agentFormPhone,
            password: agentFormPassword || undefined
          })
        });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || 'Failed to update agent');
        }
      } else {
        const res = await fetch('/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            name: agentFormName,
            email: cleanEmail,
            phone: agentFormPhone,
            password: agentFormPassword || 'kaira@123'
          })
        });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || 'Failed to create agent');
        }
      }

      setShowAddAgentModal(false);
      setEditingAgent(null);
      setAgentFormName('');
      setAgentFormEmail('');
      setAgentFormPhone('');
      setAgentFormPassword('');
      fetchAgents();
      fetchStats();
    } catch (err: any) {
      alert(err.message || 'Operation failed');
    }
  };

  const handleDeleteAgent = async () => {
    if (!deletingAgent) return;
    try {
      const res = await fetch(`/api/agents/${deletingAgent.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to delete agent');
      }
      setDeletingAgent(null);
      fetchAgents();
      fetchStats();
    } catch (err: any) {
      alert(err.message || 'Delete failed');
    }
  };

  // Knowledge Base Handlers
  const handleSaveKbEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        title: kbTitle.trim(),
        category: kbCat,
        question: kbQuestion.trim() || undefined,
        answer: kbAnswer.trim() || undefined,
        content: kbContent.trim(),
        keywords: kbKeywords.trim() || undefined
      };

      if (!editingKbEntry) {
        // Prevent client-side duplicate submission
        if (kbEntries.some(e => e.title.trim().toLowerCase() === payload.title.toLowerCase())) {
          alert(`A Knowledge Base entry with title "${payload.title}" already exists.`);
          return;
        }
      }

      if (editingKbEntry) {
        const res = await fetch(`/api/knowledge/${editingKbEntry.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Failed to update knowledge entry');
      } else {
        const res = await fetch('/api/knowledge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || 'Failed to create knowledge entry');
        }
      }

      setShowAddKbModal(false);
      setEditingKbEntry(null);
      setKbTitle('');
      setKbQuestion('');
      setKbAnswer('');
      setKbContent('');
      setKbKeywords('');
      fetchKnowledge();
    } catch (err: any) {
      alert(err.message || 'Failed to save knowledge entry');
    }
  };

  const handleDeleteKbEntry = async () => {
    if (!deletingKbEntry) return;
    try {
      await fetch(`/api/knowledge/${deletingKbEntry.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      setDeletingKbEntry(null);
      fetchKnowledge();
    } catch (err: any) {
      alert('Failed to delete entry');
    }
  };

  // Upload Document Handler
  const handleUploadDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      if (uploadTitle) formData.append('title', uploadTitle);

      const res = await fetch('/api/knowledge/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });

      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Upload failed');
      }

      setUploadFile(null);
      setUploadTitle('');
      fetchKnowledge();
      setTimeout(fetchKnowledge, 2500);
    } catch (err: any) {
      alert(err.message || 'Document upload error');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    if (!confirm('Are you sure you want to delete this document and all its indexed entries?')) return;
    try {
      await fetch(`/api/knowledge/documents/${docId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchKnowledge();
    } catch (err) {
      alert('Failed to delete document');
    }
  };

  // Format duration helper
  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      {/* 1. SIDEBAR NAVIGATION */}
      <aside className="w-full md:w-64 bg-slate-900 text-slate-300 flex-shrink-0 flex flex-col justify-between p-4 md:min-h-screen border-r border-slate-800">
        <div className="space-y-6">
          <div className="px-3 py-2">
            <div className="flex items-center gap-2.5">
              <img
                src="/kaira-logo.png"
                alt="KAIRA Technologies"
                className="h-10 w-10 object-contain bg-white rounded-xl p-1 shadow-md shadow-slate-950/40"
              />
              <div>
                <span className="text-base font-bold text-white tracking-tight">Admin Console</span>
                <p className="text-[10px] text-purple-400 font-semibold uppercase tracking-wider">Full Authorization</p>
              </div>
            </div>
          </div>

          <nav className="space-y-1">
            <button
              onClick={() => setActiveSection('overview')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${activeSection === 'overview'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-900/40'
                : 'hover:bg-slate-800 text-slate-300 hover:text-white'
                }`}
            >
              <Clock className="w-4 h-4" />
              Dashboard Overview
            </button>

            <button
              onClick={() => setActiveSection('customers')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${activeSection === 'customers'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-900/40'
                : 'hover:bg-slate-800 text-slate-300 hover:text-white'
                }`}
            >
              <Users className="w-4 h-4" />
              Customer Management
            </button>

            <button
              onClick={() => setActiveSection('agents')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${activeSection === 'agents'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-900/40'
                : 'hover:bg-slate-800 text-slate-300 hover:text-white'
                }`}
            >
              <Headphones className="w-4 h-4" />
              Agent Management
            </button>

            <button
              onClick={() => setActiveSection('calls')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${activeSection === 'calls'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-900/40'
                : 'hover:bg-slate-800 text-slate-300 hover:text-white'
                }`}
            >
              <PhoneCall className="w-4 h-4" />
              Call Monitoring
            </button>

            <button
              onClick={() => setActiveSection('intelligence')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${activeSection === 'intelligence'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-900/40'
                : 'hover:bg-slate-800 text-slate-300 hover:text-white'
                }`}
            >
              <Sparkles className="w-4 h-4" />
              AI Call Intelligence
            </button>

            <button
              onClick={() => setActiveSection('tasks')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${activeSection === 'tasks'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-900/40'
                : 'hover:bg-slate-800 text-slate-300 hover:text-white'
                }`}
            >
              <div className="flex items-center gap-3">
                <ListTodo className="w-4 h-4" />
                Follow-Up Tasks
              </div>
              {(intelligenceStats?.pendingFollowUpTasks ?? 0) > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-bold">
                  {intelligenceStats?.pendingFollowUpTasks}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveSection('quality')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${activeSection === 'quality'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-900/40'
                : 'hover:bg-slate-800 text-slate-300 hover:text-white'
                }`}
            >
              <Activity className="w-4 h-4" />
              Call Quality & Reliability
            </button>

            <button
              onClick={() => setActiveSection('transfers')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${activeSection === 'transfers'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-900/40'
                : 'hover:bg-slate-800 text-slate-300 hover:text-white'
                }`}
            >
              <div className="flex items-center gap-3">
                <PhoneForwarded className="w-4 h-4" />
                Live Call Transfers
              </div>
              {stats.pendingTransfers > 0 && (
                <span className="w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center animate-pulse">
                  {stats.pendingTransfers}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveSection('tickets')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${activeSection === 'tickets'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-900/40'
                : 'hover:bg-slate-800 text-slate-300 hover:text-white'
                }`}
            >
              <MessageSquare className="w-4 h-4" />
              Customer Issue Management
            </button>

            <button
              onClick={() => setActiveSection('knowledge')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${activeSection === 'knowledge'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-900/40'
                : 'hover:bg-slate-800 text-slate-300 hover:text-white'
                }`}
            >
              <BookOpen className="w-4 h-4" />
              Knowledge Base
            </button>

            <button
              onClick={() => setActiveSection('sentiment')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${activeSection === 'sentiment'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-900/40'
                : 'hover:bg-slate-800 text-slate-300 hover:text-white'
                }`}
            >
              <HeartPulse className="w-4 h-4 text-rose-400" />
              Sentiment Analysis
            </button>

            <button
              onClick={() => setActiveSection('bi')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${activeSection === 'bi'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-900/40'
                : 'hover:bg-slate-800 text-slate-300 hover:text-white'
                }`}
            >
              <TrendingUp className="w-4 h-4 text-blue-400" />
              Business Intelligence
            </button>
          </nav>
        </div>

        <div className="p-3 bg-slate-800/60 rounded-2xl border border-slate-800 space-y-1">
          <p className="text-[11px] font-bold text-slate-200">{user?.name}</p>
          <p className="text-[10px] text-slate-400 truncate">{user?.email}</p>
        </div>
      </aside>

      {/* 2. MAIN CONTENT AREA */}
      <main className="flex-1 p-6 md:p-8 space-y-8 overflow-y-auto max-w-7xl">

        {/* MULTI-ADMIN CONCURRENCY & OPERATOR IDENTITY BANNER */}
        <div className="bg-white rounded-3xl border border-slate-200/80 p-5 shadow-xs space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            {/* Operator Identity & Status */}
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center font-black text-base shadow-sm">
                {operatorName.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active Operator Session:</span>
                  <span className="font-extrabold text-slate-900 text-sm">{operatorName}</span>
                  <button
                    onClick={() => {
                      setTempOperatorName(operatorName);
                      setIsEditingOperatorName(true);
                    }}
                    className="p-1 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors cursor-pointer"
                    title="Change Operator Name (e.g. Ravi Arun, Arun, Kumar, Prem)"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                  <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-[10px] text-slate-600">
                    ID: #{adminSessionId.slice(-6)}
                  </span>
                  <span>•</span>
                  {activeCall ? (
                    <span className="text-red-600 font-bold flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                      In Active Call with {activeCall.customerName}
                    </span>
                  ) : incomingAdminCall ? (
                    <span className="text-amber-600 font-bold flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-amber-500 animate-bounce" />
                      Ringing ({incomingAdminCall.customerName})
                    </span>
                  ) : (
                    <span className="text-emerald-600 font-bold flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      Available for Customer Calls
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Multi-Admin Live Concurrency Counters */}
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-purple-600" />
                <span className="text-slate-500">Connected Admins:</span>
                <span className="font-extrabold text-slate-900">{adminPresence.activeAdminSessions || 1}</span>
              </div>

              <div className="px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-emerald-700">Available:</span>
                <span className="font-extrabold text-emerald-800">{adminPresence.availableAdminSessions ?? 1}</span>
              </div>

              <div className="px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-xs flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-amber-600" />
                <span className="text-amber-700">Busy:</span>
                <span className="font-extrabold text-amber-800">{adminPresence.busyAdminSessions ?? 0}</span>
              </div>

              <div className="px-3 py-1.5 rounded-xl bg-indigo-50 border border-indigo-200 text-xs flex items-center gap-2">
                <PhoneCall className="w-3.5 h-3.5 text-indigo-600" />
                <span className="text-indigo-700">Live Calls:</span>
                <span className="font-extrabold text-indigo-800">{adminPresence.activeCalls ?? 0}</span>
              </div>

              <button
                onClick={() => setShowRoster(!showRoster)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <span>Operator Roster</span>
                <span className="text-[10px] text-slate-400">({adminPresence.operators?.length || 1})</span>
              </button>
            </div>
          </div>

          {/* Collapsible Operator Roster */}
          {showRoster && (
            <div className="pt-3 border-t border-slate-100 animate-fadeIn">
              <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                Active Concurrent Admin Operators (Shared Login • Independent Calling Sessions)
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
                {(adminPresence.operators?.length ? adminPresence.operators : [
                  { adminSessionId, operatorName, status: activeCall ? 'busy' : 'available', activeCallId: activeCall?.callId || null }
                ]).map((op, idx) => {
                  const isSelf = op.adminSessionId === adminSessionId;
                  const isBusy = op.status === 'busy' || op.status === 'ringing' || Boolean(op.activeCallId);
                  return (
                    <div
                      key={op.adminSessionId || idx}
                      className={`p-2.5 rounded-xl border text-xs flex items-center justify-between ${
                        isSelf ? 'bg-purple-50/70 border-purple-200' : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div className="truncate">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-900 truncate">{op.operatorName}</span>
                          {isSelf && (
                            <span className="text-[9px] font-extrabold px-1.5 py-0.2 bg-purple-600 text-white rounded">
                              YOU
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] font-mono text-slate-400">#{op.adminSessionId?.slice(-6)}</span>
                      </div>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          isBusy
                            ? 'bg-amber-100 text-amber-800 border border-amber-200'
                            : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                        }`}
                      >
                        {isBusy ? (op.status === 'ringing' ? 'Ringing' : 'In Call') : 'Available'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* DEDICATED LIVE ACTIVE CALL CONSOLE (Visible across all tabs) */}
        {activeCall && (
          <div className="bg-white rounded-3xl border border-purple-200 shadow-xl overflow-hidden animate-fadeIn">
            <div className="p-5 bg-gradient-to-r from-purple-900 via-indigo-900 to-slate-900 text-white flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-purple-600 flex items-center justify-center text-white shadow-md">
                  <PhoneForwarded className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold">{activeCall.customerName}</h2>
                    <span className="px-2 py-0.5 rounded-full bg-purple-800 text-purple-200 text-[10px] font-semibold">
                      {SUPPORTED_LANGUAGES[(activeCall.preferredLanguage || 'en') as LanguageCode]?.nativeName || activeCall.preferredLanguage}
                    </span>
                  </div>
                  <p className="text-xs text-purple-200">
                    {activeCall.customerPhone || 'WebRTC Call'} • Operator: <strong className="text-white">{operatorName}</strong>
                    {activeCall.question ? ` • Escalated: "${activeCall.question}"` : ''}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="px-3.5 py-1.5 rounded-xl bg-purple-950/80 border border-purple-700 text-xs font-mono font-bold flex items-center gap-2">
                  <Clock className="w-4 h-4 text-purple-300" />
                  {formatDuration(callDuration)}
                </div>
                <button
                  onClick={() => handleEndAdminCall(true)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-md cursor-pointer transition-colors"
                >
                  <PhoneOff className="w-4 h-4" />
                  End Call
                </button>
              </div>
            </div>

            <div className="p-3.5 bg-purple-50/70 border-b border-purple-100 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    const m = webrtcManager.toggleMute();
                    setIsMuted(m);
                  }}
                  className={`px-3 py-1.5 rounded-xl border font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                    isMuted ? 'bg-red-50 text-red-600 border-red-200' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4 text-emerald-600" />}
                  {isMuted ? 'Unmute Mic' : 'Mute Mic'}
                </button>

                <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200">
                  {volume === 0 ? <VolumeX className="w-4 h-4 text-slate-400" /> : <Volume2 className="w-4 h-4 text-slate-600" />}
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={volume}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setVolume(val);
                      webrtcManager.setVolume(val);
                    }}
                    className="w-20 accent-purple-600 cursor-pointer"
                  />
                </div>
              </div>

              <span className="font-medium text-emerald-600 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                Live Two-Way Audio Active (Low Latency WebRTC • &lt;1.2s)
              </span>
            </div>

            {/* REAL-TIME TWO-WAY CONVERSATION TRANSCRIPT & TRANSLATION */}
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-purple-600" />
                  Live Two-Way Conversation Transcript (Auto-Translated)
                </h3>
                <span className="text-[11px] text-slate-400">
                  Real-time synchronization • Regional language support
                </span>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 h-64 overflow-y-auto space-y-3">
                {transcripts.map((t) => {
                  const isCustomer = t.sender === 'customer';
                  const isSystem = t.sender === 'system';
                  return (
                    <div
                      key={t.id}
                      className={`flex flex-col text-xs ${
                        isSystem ? 'items-center text-center my-2' : isCustomer ? 'items-start' : 'items-end'
                      }`}
                    >
                      {isSystem ? (
                        <div className="px-3 py-1 rounded-full bg-slate-200/70 text-slate-600 text-[10px] font-semibold">
                          {t.text}
                        </div>
                      ) : (
                        <div className="max-w-[80%] space-y-1">
                          <span className={`text-[10px] font-bold block ${isCustomer ? 'text-indigo-600' : 'text-purple-600 text-right'}`}>
                            {t.senderName || (isCustomer ? 'Customer' : `Admin (${operatorName})`)}
                          </span>
                          <div
                            className={`p-3 rounded-2xl leading-relaxed ${
                              isCustomer
                                ? 'bg-white border border-slate-200 text-slate-900 rounded-tl-xs shadow-2xs'
                                : 'bg-purple-600 text-white rounded-tr-xs shadow-sm'
                            }`}
                          >
                            <p className="font-medium">{t.text}</p>
                            {t.translation && (
                              <p className={`text-[11px] mt-1 pt-1 border-t ${
                                isCustomer ? 'border-slate-100 text-slate-500 italic' : 'border-purple-500/50 text-purple-100 italic'
                              }`}>
                                🌐 {t.translation}
                              </p>
                            )}
                          </div>
                          <span className="text-[9px] text-slate-400 block px-1 text-right">
                            {new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div ref={transcriptEndRef} />
              </div>

              {/* Fast Reply / Speech Relay Box */}
              <form onSubmit={handleSendAdminMessage} className="flex gap-2">
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Type a message to customer (auto-translated into their language)..."
                  className="flex-1 px-3.5 py-2 text-xs border border-slate-200 rounded-xl text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-purple-500 bg-white"
                />
                <button
                  type="submit"
                  disabled={!replyText.trim()}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white text-xs font-bold rounded-xl cursor-pointer transition-colors shadow-2xs"
                >
                  Send
                </button>
              </form>
            </div>
          </div>
        )}

        {/* SECTION A: DASHBOARD OVERVIEW */}
        {activeSection === 'overview' && (
          <div className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Executive Dashboard Overview</h1>
                <p className="text-xs text-slate-500 mt-1">
                  Live operational metrics calculated directly from database records without duplication.
                </p>
              </div>
              <button
                onClick={fetchStats}
                className="inline-flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl hover:bg-slate-50 shadow-2xs cursor-pointer transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh Metrics
              </button>
            </div>

            {/* Unique Database Statistic Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Total Customers */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total Customers</span>
                  <Users className="w-4 h-4 text-indigo-500" />
                </div>
                <p className="text-2xl font-extrabold text-slate-900">{stats.totalCustomers}</p>
                <p className="text-[11px] text-slate-400">Unique registered customer accounts</p>
              </div>

              {/* Total Support Agents */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Support Agents</span>
                  <Headphones className="w-4 h-4 text-purple-500" />
                </div>
                <p className="text-2xl font-extrabold text-slate-900">{stats.totalAgents ?? 1}</p>
                <p className="text-[11px] text-slate-400">Authorized support agents</p>
              </div>

              {/* Total Incoming Calls */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Incoming Calls</span>
                  <PhoneIncoming className="w-4 h-4 text-emerald-500" />
                </div>
                <p className="text-2xl font-extrabold text-slate-900">{stats.totalIncoming}</p>
                <p className="text-[11px] text-slate-400">Customer-initiated voice calls</p>
              </div>

              {/* Total Outgoing Calls */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Outgoing Calls</span>
                  <PhoneOutgoing className="w-4 h-4 text-blue-500" />
                </div>
                <p className="text-2xl font-extrabold text-slate-900">{stats.totalOutgoing}</p>
                <p className="text-[11px] text-slate-400">Agent-initiated telephone calls</p>
              </div>

              {/* Total Calls */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total Calls</span>
                  <PhoneCall className="w-4 h-4 text-purple-500" />
                </div>
                <p className="text-2xl font-extrabold text-slate-900">{stats.totalCalls}</p>
                <p className="text-[11px] text-slate-400">Total verified communications</p>
              </div>

              {/* Active Calls */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Active Calls</span>
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
                </div>
                <p className="text-2xl font-extrabold text-emerald-600">{stats.activeCalls}</p>
                <p className="text-[11px] text-slate-400">Currently in progress</p>
              </div>

              {/* Calls Transferred to Admin */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Transferred to Admin</span>
                  <PhoneForwarded className="w-4 h-4 text-amber-500" />
                </div>
                <p className="text-2xl font-extrabold text-amber-600">{stats.transferredCalls}</p>
                <p className="text-[11px] text-slate-400">Escalated from AI Agent</p>
              </div>

              {/* Pending Transfer Requests */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Pending Transfers</span>
                  <ShieldAlert className="w-4 h-4 text-red-500" />
                </div>
                <p className="text-2xl font-extrabold text-red-600">{stats.pendingTransfers}</p>
                <p className="text-[11px] text-slate-400">Awaiting Admin acceptance</p>
              </div>
            </div>

            {/* Multilingual Calling & Queue Metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Waiting Call Queue</span>
                  <Users className="w-4 h-4 text-amber-500" />
                </div>
                <p className="text-2xl font-extrabold text-amber-600">{stats.queuedCalls ?? 0}</p>
                <p className="text-[11px] text-slate-400">Customers waiting for an agent</p>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Agent Concurrency</span>
                  <Headphones className="w-4 h-4 text-emerald-500" />
                </div>
                <p className="text-2xl font-extrabold text-slate-900">
                  <span className="text-emerald-600">{stats.availableAgents ?? 0}</span>
                  <span className="text-slate-400 text-lg font-normal"> / </span>
                  <span className="text-amber-600">{stats.busyAgents ?? 0}</span>
                </p>
                <p className="text-[11px] text-slate-400">Available vs Busy agents</p>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Avg Customer Wait</span>
                  <Clock className="w-4 h-4 text-blue-500" />
                </div>
                <p className="text-2xl font-extrabold text-slate-900">{stats.avgWaitTime ?? 0}s</p>
                <p className="text-[11px] text-slate-400">Average queue wait duration</p>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Avg Call Duration</span>
                  <Clock className="w-4 h-4 text-purple-500" />
                </div>
                <p className="text-2xl font-extrabold text-slate-900">
                  {Math.floor((stats.avgDuration ?? 0) / 60)}m {(stats.avgDuration ?? 0) % 60}s
                </p>
                <p className="text-[11px] text-slate-400">Average call length</p>
              </div>
            </div>

            {/* Multilingual Call Distribution */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe className="w-5 h-5 text-indigo-600" />
                  <h3 className="font-extrabold text-slate-900 text-base">
                    Multilingual Voice Call Distribution (6 Regional Languages)
                  </h3>
                </div>
                <span className="text-xs text-slate-400">Grounded real-time interpretation</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                {[
                  { code: 'en', name: 'English', native: 'English' },
                  { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
                  { code: 'te', name: 'Telugu', native: 'తెలుగు' },
                  { code: 'ml', name: 'Malayalam', native: 'മലയാളം' },
                  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ' },
                  { code: 'hi', name: 'Hindi', native: 'हिन्दी' }
                ].map(l => {
                  const count = stats.callsByLanguage?.[l.code] || 0;
                  return (
                    <div key={l.code} className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-700">{l.name}</span>
                        <span className="text-[11px] text-slate-400 font-medium">{l.native}</span>
                      </div>
                      <div className="text-2xl font-black text-slate-900">{count}</div>
                      <p className="text-[10px] text-slate-400">Total calls handled</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Quick Navigation Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div
                onClick={() => setActiveSection('transfers')}
                className="p-6 rounded-3xl bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 cursor-pointer hover:shadow-md transition-all space-y-3"
              >
                <div className="w-10 h-10 rounded-2xl bg-amber-600 text-white flex items-center justify-center font-bold">
                  <PhoneForwarded className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-slate-900 text-sm">Live Call Transfers</h3>
                <p className="text-xs text-slate-600">
                  Review ringing, connected, and missed call transfer requests escalated from the AI Voice Agent.
                </p>
              </div>

              <div
                onClick={() => setActiveSection('customers')}
                className="p-6 rounded-3xl bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 cursor-pointer hover:shadow-md transition-all space-y-3"
              >
                <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-bold">
                  <Users className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-slate-900 text-sm">Customer Database</h3>
                <p className="text-xs text-slate-600">
                  Add, edit, inspect call histories, and manage registered customer records with full CRUD control.
                </p>
              </div>

              <div
                onClick={() => setActiveSection('agents')}
                className="p-6 rounded-3xl bg-gradient-to-br from-purple-50 to-fuchsia-50 border border-purple-200 cursor-pointer hover:shadow-md transition-all space-y-3"
              >
                <div className="w-10 h-10 rounded-2xl bg-purple-600 text-white flex items-center justify-center font-bold">
                  <Headphones className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-slate-900 text-sm">Agent Management</h3>
                <p className="text-xs text-slate-600">
                  Provision and manage human Support Agents handling customer outbound and escalated voice calls.
                </p>
              </div>

              <div
                onClick={() => setActiveSection('quality')}
                className="p-6 rounded-3xl bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 cursor-pointer hover:shadow-md transition-all space-y-3"
              >
                <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center font-bold">
                  <Activity className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-slate-900 text-sm">Call Quality & Reliability</h3>
                <p className="text-xs text-slate-600">
                  Monitor live network latency, packet loss, automatic reconnection telemetry, and audio performance.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* SECTION B: CUSTOMER MANAGEMENT */}
        {activeSection === 'customers' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Customer Management</h1>
                <p className="text-xs text-slate-500 mt-1">
                  Complete management of all customer accounts. Each customer record is verified and uniquely identified by email.
                </p>
              </div>
              <button
                onClick={() => {
                  setEditingCustomer(null);
                  setCustFormName('');
                  setCustFormEmail('');
                  setCustFormPhone('');
                  setCustFormPassword('');
                  setShowAddCustomerModal(true);
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Add Customer Manually
              </button>
            </div>

            {/* Search Bar */}
            <div className="relative max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Search customers by name, email, phone..."
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/20 text-slate-900"
              />
            </div>

            {/* Customers Table */}
            <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
              {loadingCustomers ? (
                <div className="py-12 text-center text-xs text-slate-500">Loading customers...</div>
              ) : customers.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">No customers found.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-600">
                    <thead className="bg-slate-50 text-slate-700 uppercase font-bold text-[10px] tracking-wider border-b border-slate-200">
                      <tr>
                        <th className="py-3.5 px-4">Customer Name</th>
                        <th className="py-3.5 px-4">Email Address</th>
                        <th className="py-3.5 px-4">Phone Number</th>
                        <th className="py-3.5 px-4">Registration Date</th>
                        <th className="py-3.5 px-4">Total Calls</th>
                        <th className="py-3.5 px-4">Last Call Date</th>
                        <th className="py-3.5 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {customers.map((c) => (
                        <tr key={c.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="py-3.5 px-4 font-semibold text-slate-900">{c.name}</td>
                          <td className="py-3.5 px-4 text-slate-600 font-mono text-[11px]">{c.email}</td>
                          <td className="py-3.5 px-4 text-slate-600 font-mono">{c.phone || 'N/A'}</td>
                          <td className="py-3.5 px-4 text-slate-500">
                            {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : 'N/A'}
                          </td>
                          <td className="py-3.5 px-4 font-mono font-medium text-purple-700">{c.totalCalls || 0}</td>
                          <td className="py-3.5 px-4 text-slate-500">
                            {c.lastCallDate ? new Date(c.lastCallDate).toLocaleDateString() : 'Never'}
                          </td>
                          <td className="py-3.5 px-4 text-right space-x-2">
                            <button
                              onClick={() => setSelectedProfileCustomerId(c.id)}
                              className="px-2.5 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg font-medium transition-colors cursor-pointer inline-flex items-center gap-1"
                              title="Customer Intelligence & Interaction History"
                            >
                              <Sparkles className="w-3 h-3 text-purple-600" />
                              Profile
                            </button>
                            <button
                              onClick={() => {
                                fetch(`/api/customers/${c.id}`, { headers: { Authorization: `Bearer ${token}` } })
                                  .then(r => r.json())
                                  .then(d => setSelectedCustomerHistory(d.customer));
                              }}
                              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition-colors cursor-pointer"
                              title="View Call History"
                            >
                              <Eye className="w-3.5 h-3.5 inline" />
                            </button>
                            <button
                              onClick={() => {
                                setEditingCustomer(c);
                                setCustFormName(c.name);
                                setCustFormEmail(c.email);
                                setCustFormPhone(c.phone || '');
                                setShowAddCustomerModal(true);
                              }}
                              className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg font-medium transition-colors cursor-pointer"
                              title="Edit"
                            >
                              <Edit3 className="w-3.5 h-3.5 inline" />
                            </button>
                            <button
                              onClick={() => setDeletingCustomer(c)}
                              className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg font-medium transition-colors cursor-pointer"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5 inline" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SECTION C: AGENT MANAGEMENT */}
        {activeSection === 'agents' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Support Agent Management</h1>
                <p className="text-xs text-slate-500 mt-1">
                  Manage human Support Agents authorized to place telephone calls and accept customer escalations.
                </p>
              </div>
              <button
                onClick={() => {
                  setEditingAgent(null);
                  setAgentFormName('');
                  setAgentFormEmail('');
                  setAgentFormPhone('');
                  setAgentFormPassword('');
                  setShowAddAgentModal(true);
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Add Support Agent
              </button>
            </div>

            {/* Search Bar */}
            <div className="relative max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Search agents by name, email, phone..."
                value={agentSearch}
                onChange={(e) => setAgentSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/20 text-slate-900"
              />
            </div>

            {/* Agents Table */}
            <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
              {loadingAgents ? (
                <div className="py-12 text-center text-xs text-slate-500">Loading support agents...</div>
              ) : agents.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">No support agents found.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-600">
                    <thead className="bg-slate-50 text-slate-700 uppercase font-bold text-[10px] tracking-wider border-b border-slate-200">
                      <tr>
                        <th className="py-3.5 px-4">Agent Name</th>
                        <th className="py-3.5 px-4">Email / Login ID</th>
                        <th className="py-3.5 px-4">Direct Phone</th>
                        <th className="py-3.5 px-4">Created Date</th>
                        <th className="py-3.5 px-4">Handled Calls</th>
                        <th className="py-3.5 px-4">Status</th>
                        <th className="py-3.5 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {agents.map((a) => (
                        <tr key={a.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="py-3.5 px-4 font-semibold text-slate-900 flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-xs">
                              {a.name.charAt(0).toUpperCase()}
                            </div>
                            {a.name}
                          </td>
                          <td className="py-3.5 px-4 text-slate-600 font-mono text-[11px]">{a.email}</td>
                          <td className="py-3.5 px-4 text-slate-600 font-mono">{a.phone || 'N/A'}</td>
                          <td className="py-3.5 px-4 text-slate-500">
                            {a.createdAt ? new Date(a.createdAt).toLocaleDateString() : 'N/A'}
                          </td>
                          <td className="py-3.5 px-4 font-mono font-medium text-purple-700">
                            {(a as any).totalHandledCalls || 0}
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              Active Agent
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right space-x-2">
                            <button
                              onClick={() => {
                                setEditingAgent(a);
                                setAgentFormName(a.name);
                                setAgentFormEmail(a.email);
                                setAgentFormPhone(a.phone || '');
                                setAgentFormPassword('');
                                setShowAddAgentModal(true);
                              }}
                              className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg font-medium transition-colors cursor-pointer"
                              title="Edit Agent"
                            >
                              <Edit3 className="w-3.5 h-3.5 inline" />
                            </button>
                            {a.email !== 'agent@kaira' && (
                              <button
                                onClick={() => setDeletingAgent(a)}
                                className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg font-medium transition-colors cursor-pointer"
                                title="Delete Agent"
                              >
                                <Trash2 className="w-3.5 h-3.5 inline" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SECTION D: CALL MONITORING */}
        {activeSection === 'calls' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Call Monitoring & Analytics</h1>
                <p className="text-xs text-slate-500 mt-1">Live inspection of all incoming, outgoing, transferred, and historical calls.</p>
              </div>

              {/* Filter Tabs */}
              <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-2xl border border-slate-200 text-xs font-semibold">
                {(['all', 'incoming', 'outgoing', 'transferred', 'active', 'completed', 'missed'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setCallFilter(f)}
                    className={`px-3 py-1.5 rounded-xl capitalize transition-all cursor-pointer ${callFilter === f ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                      }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* Search Bar */}
            <div className="relative max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Search calls by customer name, phone, call ID..."
                value={callSearch}
                onChange={(e) => setCallSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/20 text-slate-900"
              />
            </div>

            <section className="rounded-3xl border border-rose-200 bg-rose-50/70 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-extrabold text-slate-900">Customer feedback needing attention</h2>
                  <p className="mt-1 text-xs text-slate-600">Calls rated 1 or 2 stars. Review the comment and record follow-up.</p>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-rose-700 border border-rose-200">
                  {lowRatingFeedback.filter(call => !call.feedbackFollowUpCompleted).length} pending
                </span>
              </div>
              {lowRatingFeedback.length === 0 ? (
                <div className="rounded-2xl bg-white/80 px-4 py-5 text-center text-xs text-slate-500">
                  No low customer ratings to follow up on.
                </div>
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {lowRatingFeedback.map(call => (
                    <article key={call.id} className="rounded-2xl border border-rose-100 bg-white p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-slate-900">{call.customerName}</p>
                          <p className="text-[11px] text-slate-500">{new Date(call.startTime).toLocaleString()}</p>
                        </div>
                        <span className="shrink-0 rounded-full bg-rose-100 px-2.5 py-1 text-xs font-extrabold text-rose-700">
                          {call.rating} / 5 stars
                        </span>
                      </div>
                      <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-700 whitespace-pre-wrap">
                        {call.ratingComment || 'No comment provided.'}
                      </p>
                      <textarea
                        value={call.feedbackFollowUpNotes || ''}
                        onChange={event => setLowRatingFeedback(prev => prev.map(item => item.id === call.id
                          ? { ...item, feedbackFollowUpNotes: event.target.value.slice(0, 1000) }
                          : item))}
                        rows={2}
                        maxLength={1000}
                        placeholder="Follow-up notes (optional)"
                        className="w-full resize-none rounded-xl border border-slate-200 p-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400"
                      />
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-[11px] font-bold ${call.feedbackFollowUpCompleted ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {call.feedbackFollowUpCompleted ? 'Follow-up completed' : 'Follow-up pending'}
                        </span>
                        <button
                          onClick={() => updateFeedbackFollowUp(call)}
                          className={`rounded-xl px-3 py-2 text-[11px] font-bold cursor-pointer ${call.feedbackFollowUpCompleted ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                        >
                          {call.feedbackFollowUpCompleted ? 'Reopen follow-up' : 'Mark followed up'}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {/* Calls Table */}
            <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
              {loadingCalls ? (
                <div className="py-12 text-center text-xs text-slate-500">Loading call records...</div>
              ) : calls.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">No calls matching selected filter.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-600">
                    <thead className="bg-slate-50 text-slate-700 uppercase font-bold text-[10px] tracking-wider border-b border-slate-200">
                      <tr>
                        <th className="py-3.5 px-4">Date & Time</th>
                        <th className="py-3.5 px-4">Customer</th>
                        <th className="py-3.5 px-4">Phone</th>
                        <th className="py-3.5 px-4">Language</th>
                        <th className="py-3.5 px-4">Handler</th>
                        <th className="py-3.5 px-4">Channel / Type</th>
                        <th className="py-3.5 px-4">Duration</th>
                        <th className="py-3.5 px-4">Call Status</th>
                        <th className="py-3.5 px-4">Sentiment</th>
                        <th className="py-3.5 px-4">Transferred</th>
                        <th className="py-3.5 px-4 text-right">Transcript</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {calls.map((call) => (
                        <tr key={call.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="py-3.5 px-4 font-medium text-slate-800">
                            {new Date(call.startTime).toLocaleString()}
                          </td>
                          <td className="py-3.5 px-4 font-semibold text-slate-900">{call.customerName}</td>
                          <td className="py-3.5 px-4 text-slate-600 font-mono">{call.customerPhone || 'N/A'}</td>
                          <td className="py-3.5 px-4">
                            <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-semibold text-[10px]">
                              {SUPPORTED_LANGUAGES[(call.language as LanguageCode) || 'en']?.name || 'English'}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-slate-700">
                            {call.admin?.name || call.agent?.name || 'KAIRA AI'}
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 capitalize">
                              {call.type.replace('_', ' ')}
                            </span>
                            {call.providerName === 'twilio' && (
                              <span className="ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-100 text-blue-700 border border-blue-200 uppercase">
                                PSTN
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 font-mono font-medium">{formatDuration(call.duration)}</td>
                          <td className="py-3.5 px-4">
                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${call.status === 'completed'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : call.status === 'active'
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'bg-red-50 text-red-700 border border-red-200'
                              }`}>
                              {call.status}
                            </span>
                          </td>
                          <td className="py-3.5 px-4">
                            <SentimentBadge
                              sentiment={call.overallSentiment}
                              score={call.sentimentScore}
                              size="xs"
                              requiresAssistance={call.requiresAssistance}
                            />
                          </td>
                          <td className="py-3.5 px-4">
                            {call.transferred ? (
                              <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-bold text-[10px]">
                                Yes (to Admin)
                              </span>
                            ) : (
                              <span className="text-slate-400">No</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right space-x-1.5 whitespace-nowrap">
                            <button
                              onClick={() => setSelectedIntelligenceCallId(call.id)}
                              className="px-2.5 py-1 bg-purple-100 hover:bg-purple-200 text-purple-800 rounded-lg font-semibold transition-colors cursor-pointer text-xs inline-flex items-center gap-1"
                              title="AI Call Summary & Intelligence"
                            >
                              <Sparkles className="w-3 h-3 text-purple-600" />
                              AI Summary
                            </button>
                            <button
                              onClick={() => setSelectedCallDetails(call)}
                              className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold transition-colors cursor-pointer text-xs"
                            >
                              Details
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SECTION E: LIVE CALL TRANSFERS */}
        {activeSection === 'transfers' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Live Call Transfer Management</h1>
                <p className="text-xs text-slate-500 mt-1">
                  Manage incoming customer calls escalated when the AI Voice Agent encounters unanswered questions.
                </p>
              </div>
              <button
                onClick={fetchTransfers}
                className="inline-flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl hover:bg-slate-50 cursor-pointer shadow-2xs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh Queue
              </button>
            </div>

            {/* Active Live Transferred Call Console */}
            {activeTransferredCall && (
              <div className="bg-white rounded-3xl border border-purple-200 shadow-xl overflow-hidden animate-fadeIn">
                <div className="p-6 bg-gradient-to-r from-purple-900 via-indigo-900 to-slate-900 text-white flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-purple-600 flex items-center justify-center text-white">
                      <PhoneForwarded className="w-6 h-6 animate-pulse" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold">{activeTransferredCall.customerName}</h2>
                      <p className="text-xs text-purple-200">
                        Live Voice Transfer Connected • Original Question: "{activeTransferredCall.question}"
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="px-3.5 py-1.5 rounded-xl bg-purple-950/80 border border-purple-700 text-xs font-mono font-bold flex items-center gap-2">
                      <Clock className="w-4 h-4 text-purple-300" />
                      {formatDuration(callDuration)}
                    </div>
                    <button
                      onClick={handleEndTransferredCall}
                      className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-md cursor-pointer transition-colors"
                    >
                      <PhoneOff className="w-4 h-4" />
                      End Transferred Call
                    </button>
                  </div>
                </div>

                <div className="p-4 bg-purple-50/50 border-b border-purple-100 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        const m = webrtcManager.toggleMute();
                        setIsMuted(m);
                      }}
                      className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${isMuted ? 'bg-red-50 text-red-600 border-red-200' : 'bg-white text-slate-700 border-slate-200'
                        }`}
                    >
                      {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4 text-emerald-600" />}
                      {isMuted ? 'Unmute Mic' : 'Mute Mic'}
                    </button>

                    <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200">
                      {volume === 0 ? <VolumeX className="w-4 h-4 text-slate-400" /> : <Volume2 className="w-4 h-4 text-slate-600" />}
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={volume}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setVolume(val);
                          webrtcManager.setVolume(val);
                        }}
                        className="w-20 accent-purple-600 cursor-pointer"
                      />
                    </div>
                  </div>

                  <span className="text-xs font-medium text-emerald-600 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                    Two-Way Audio Streaming (Admin &lt;--&gt; Customer)
                  </span>
                </div>

                {/* Live Real-Time Customer Sentiment */}
                <div className="p-4 bg-slate-50/70 border-b border-purple-100">
                  <LiveSentimentCard
                    sentiment={liveSentiment?.sentiment}
                    confidenceScore={liveSentiment?.confidenceScore}
                    reason={liveSentiment?.reason}
                    triggerText={liveSentiment?.triggerText}
                    requiresHumanAssistance={liveSentiment?.requiresHumanAssistance}
                    canManageOverride={true}
                    onOverride={(status) => {
                      const socket = getSocket();
                      socket.emit('sentiment:override', { callId: activeTransferredCall.callId, status });
                    }}
                  />
                </div>

                {/* Transcripts in Active Transfer */}
                <div className="p-6">
                  <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">Live Transcript</h3>
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 h-64 overflow-y-auto space-y-3">
                    {transcripts.map((t) => (
                      <div key={t.id} className="text-xs">
                        <span className="font-semibold text-slate-500 block mb-0.5">
                          {t.senderName || t.sender}:
                        </span>
                        <p className="bg-white p-2.5 rounded-xl border border-slate-200 text-slate-800">
                          {t.text}
                        </p>
                      </div>
                    ))}
                    <div ref={transcriptEndRef} />
                  </div>
                </div>
              </div>
            )}

            {/* Transfer Queue & History Table */}
            <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-bold text-slate-900 text-sm">Transfer History & Follow-ups</h3>
                <span className="text-xs text-slate-400">{allTransfers.length} unique transfer events</span>
              </div>

              {loadingTransfers ? (
                <div className="py-12 text-center text-xs text-slate-500">Loading transfers...</div>
              ) : allTransfers.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">No transfer requests recorded yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-600">
                    <thead className="bg-slate-50 text-slate-700 uppercase font-bold text-[10px] tracking-wider border-b border-slate-200">
                      <tr>
                        <th className="py-3.5 px-4">Date & Time</th>
                        <th className="py-3.5 px-4">Customer</th>
                        <th className="py-3.5 px-4">Phone</th>
                        <th className="py-3.5 px-4">Unanswered Question</th>
                        <th className="py-3.5 px-4">Transfer Reason</th>
                        <th className="py-3.5 px-4">Status</th>
                        <th className="py-3.5 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {allTransfers.map((req) => (
                        <tr key={req.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="py-3.5 px-4 font-medium text-slate-800">
                            {new Date(req.createdAt).toLocaleString()}
                          </td>
                          <td className="py-3.5 px-4 font-semibold text-slate-900">{req.customerName}</td>
                          <td className="py-3.5 px-4 text-slate-600 font-mono">{req.customerPhone || 'N/A'}</td>
                          <td className="py-3.5 px-4 font-medium text-indigo-700 max-w-xs truncate">
                            "{req.question}"
                          </td>
                          <td className="py-3.5 px-4 text-slate-500 max-w-xs truncate">{req.reason}</td>
                          <td className="py-3.5 px-4">
                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${req.status === 'connected' || req.status === 'accepted'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : req.status === 'ringing' || req.status === 'pending'
                                ? 'bg-amber-50 text-amber-700 border border-amber-200 animate-pulse font-bold'
                                : req.status === 'missed'
                                  ? 'bg-red-50 text-red-700 border border-red-200'
                                  : 'bg-slate-100 text-slate-700'
                              }`}>
                              {req.status}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            {req.status === 'ringing' && (
                              <button
                                onClick={() => {
                                  setIncomingTransfer({
                                    transferId: req.id,
                                    callId: req.callRecord?.callId || '',
                                    customerName: req.customerName,
                                    customerPhone: req.customerPhone || '',
                                    question: req.question,
                                    reason: req.reason,
                                    duration: 0
                                  });
                                }}
                                className="px-3 py-1 bg-emerald-600 text-white rounded-lg font-bold text-xs cursor-pointer hover:bg-emerald-700 shadow-xs"
                              >
                                Accept Transfer
                              </button>
                            )}
                            {req.callRecord && (
                              <button
                                onClick={() => setSelectedCallDetails(req.callRecord!)}
                                className="ml-2 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium text-xs cursor-pointer"
                              >
                                View Call
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {activeSection === 'tickets' && <SupportTickets />}

        {/* SECTION: AI SENTIMENT ANALYSIS DASHBOARD */}
        {activeSection === 'sentiment' && <SentimentDashboardSection />}

        {/* SECTION: AUTOMATED BUSINESS INTELLIGENCE REPORTS & ANALYTICS */}
        {activeSection === 'bi' && <BiReportsSection token={token} />}

        {/* SECTION F: KNOWLEDGE BASE MANAGEMENT */}
        {activeSection === 'knowledge' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Company Knowledge Base</h1>
                <p className="text-xs text-slate-500 mt-1">
                  Upload official documents (PDF, DOCX) and curate Q&A entries. AI agent strictly answers from here.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setEditingKbEntry(null);
                    setKbTitle('');
                    setKbCat('general');
                    setKbQuestion('');
                    setKbAnswer('');
                    setKbContent('');
                    setKbKeywords('');
                    setShowAddKbModal(true);
                  }}
                  className="inline-flex items-center gap-2 px-3.5 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-xl shadow-xs cursor-pointer transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add Knowledge Entry
                </button>
              </div>
            </div>

            {/* Document Upload Card */}
            <div className="bg-white rounded-3xl border border-slate-200/80 p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2">
                <Upload className="w-5 h-5 text-purple-600" />
                <h3 className="font-bold text-slate-900 text-sm">Upload Corporate Documents (PDF / DOCX)</h3>
              </div>
              <p className="text-xs text-slate-500">
                Uploaded files are parsed by text extractors, sectioned into semantic units, and indexed instantly for the AI voice agent.
              </p>

              <form onSubmit={handleUploadDocument} className="flex flex-wrap items-center gap-4 pt-2">
                <input
                  type="text"
                  placeholder="Document Title (e.g. 2025 Pricing & SLA Guide)"
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  className="px-3 py-2 text-xs border border-slate-200 rounded-xl w-64 bg-slate-50 focus:bg-white text-slate-900"
                />

                <input
                  type="file"
                  accept=".pdf,.docx,.doc,.txt"
                  required
                  onChange={(e) => setUploadFile(e.target.files ? e.target.files[0] : null)}
                  className="text-xs text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100 cursor-pointer"
                />

                <button
                  type="submit"
                  disabled={isUploading || !uploadFile}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-xl shadow-xs disabled:opacity-50 cursor-pointer transition-colors"
                >
                  {isUploading ? 'Extracting & Indexing...' : 'Upload & Process Document'}
                </button>
              </form>

              {/* Uploaded Documents List */}
              {kbDocuments.length > 0 && (
                <div className="pt-4 border-t border-slate-100 space-y-2">
                  <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    Uploaded Document Processing Status
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {kbDocuments.map((doc) => (
                      <div key={doc.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
                        <div className="space-y-0.5 truncate pr-2">
                          <p className="font-bold text-slate-800 truncate">{doc.title}</p>
                          <p className="text-[10px] text-slate-400 truncate">{doc.fileName} • {(doc.fileSize / 1024).toFixed(1)} KB</p>
                          <div className="flex items-center gap-1.5 pt-1">
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${doc.status === 'indexed' ? 'bg-emerald-100 text-emerald-800' :
                              doc.status === 'processing' ? 'bg-amber-100 text-amber-800 animate-pulse' : 'bg-red-100 text-red-800'
                              }`}>
                              {doc.status}
                            </span>
                            <span className="text-[10px] text-slate-500 font-medium">{doc.entryCount} entries extracted</span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeleteDocument(doc.id)}
                          className="text-slate-400 hover:text-red-600 p-1 cursor-pointer"
                          title="Delete Document"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Knowledge Entries Management Table */}
            <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-purple-600" />
                  <h3 className="font-bold text-slate-900 text-sm">Approved Knowledge Entries ({kbEntries.length})</h3>
                </div>

                <div className="flex items-center gap-3">
                  <select
                    value={kbCategory}
                    onChange={(e) => setKbCategory(e.target.value)}
                    className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-700"
                  >
                    <option value="all">All Categories</option>
                    <option value="company">Company</option>
                    <option value="products">Products</option>
                    <option value="pricing">Pricing</option>
                    <option value="policies">Policies</option>
                    <option value="faq">FAQ</option>
                    <option value="support">Support</option>
                    <option value="general">General</option>
                  </select>

                  <div className="relative w-64">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="Search entries..."
                      value={kbSearch}
                      onChange={(e) => setKbSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-900"
                    />
                  </div>
                </div>
              </div>

              {loadingKb ? (
                <div className="py-8 text-center text-xs text-slate-500">Loading knowledge entries...</div>
              ) : kbEntries.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">No knowledge entries found.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {kbEntries.map((entry) => (
                    <div key={entry.id} className="p-5 rounded-2xl border border-slate-200 bg-slate-50/50 hover:bg-white hover:shadow-md transition-all space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="text-sm font-bold text-slate-900">{entry.title}</h4>
                          <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-purple-100 text-purple-800">
                            {entry.category}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              setEditingKbEntry(entry);
                              setKbTitle(entry.title);
                              setKbCat(entry.category);
                              setKbQuestion(entry.question || '');
                              setKbAnswer(entry.answer || '');
                              setKbContent(entry.content);
                              setKbKeywords(entry.keywords || '');
                              setShowAddKbModal(true);
                            }}
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg cursor-pointer"
                            title="Edit Entry"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setDeletingKbEntry(entry)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                            title="Delete Entry"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {entry.question && (
                        <p className="text-xs font-semibold text-slate-700">Q: {entry.question}</p>
                      )}
                      {entry.answer && (
                        <p className="text-xs text-slate-600 bg-white p-2.5 rounded-xl border border-slate-200">
                          A: {entry.answer}
                        </p>
                      )}
                      <p className="text-xs text-slate-500 line-clamp-3 leading-relaxed">{entry.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* SECTION G: CALL QUALITY MONITORING */}
        {activeSection === 'quality' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                    <Activity className="w-5 h-5" />
                  </div>
                  <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Call Quality & Reliability Monitoring</h1>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Live WebRTC audio telemetry, round-trip latency, packet loss, jitter, automatic reconnection tracking, and voice quality performance.
                </p>
              </div>
              <button
                onClick={fetchQualityStats}
                disabled={loadingQuality}
                className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl hover:bg-slate-50 shadow-2xs cursor-pointer transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingQuality ? 'animate-spin text-emerald-600' : ''}`} />
                {loadingQuality ? 'Refreshing...' : 'Refresh Telemetry'}
              </button>
            </div>

            {/* 6 Key Quality Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
              {/* 1. Successful Calls */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Successful Calls</span>
                  <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-2xl font-black text-slate-900">
                  {qualityStats?.successfulCalls ?? 0}
                </div>
                <p className="text-[11px] text-emerald-600 font-semibold">
                  {qualityStats?.totalCalls
                    ? `${Math.round(((qualityStats.successfulCalls) / qualityStats.totalCalls) * 100)}% completion rate`
                    : '100% completion rate'}
                </p>
              </div>

              {/* 2. Failed Calls */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Failed Calls</span>
                  <div className="w-7 h-7 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
                    <XCircle className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-2xl font-black text-slate-900">
                  {qualityStats?.failedCalls ?? 0}
                </div>
                <p className="text-[11px] text-red-500 font-semibold">Carrier / connection aborts</p>
              </div>

              {/* 3. Disconnected Calls */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Disconnected</span>
                  <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                    <WifiOff className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-2xl font-black text-slate-900">
                  {qualityStats?.disconnectedCalls ?? 0}
                </div>
                <p className="text-[11px] text-amber-600 font-semibold">Network interruptions</p>
              </div>

              {/* 4. Reconnected Calls */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Reconnected</span>
                  <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                    <RefreshCw className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-2xl font-black text-slate-900">
                  {qualityStats?.reconnectedCalls ?? 0}
                </div>
                <p className="text-[11px] text-indigo-600 font-semibold">Automatic ICE recovery</p>
              </div>

              {/* 5. Average Duration */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Avg Duration</span>
                  <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                    <Clock className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-2xl font-black text-slate-900 font-mono">
                  {formatDuration(qualityStats?.avgDuration ?? 0)}
                </div>
                <p className="text-[11px] text-slate-400">Active talk conversation</p>
              </div>

              {/* 6. Avg Latency & Loss */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Avg Latency & Loss</span>
                  <div className="w-7 h-7 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
                    <Signal className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-2xl font-black text-slate-900">
                  {qualityStats?.avgLatency ?? 0} <span className="text-xs font-normal text-slate-500">ms RTT</span>
                </div>
                <p className="text-[11px] text-slate-500 font-mono">
                  Loss: <span className="font-bold text-slate-700">{qualityStats?.avgPacketLoss ?? 0}%</span> • Jitter: <span className="font-bold text-slate-700">{qualityStats?.avgJitter ?? 0}ms</span>
                </p>
              </div>
            </div>

            {/* Quality Distribution Breakdown */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Audio Connection Quality Distribution</h3>
                  <p className="text-xs text-slate-500">Real-time breakdown of estimated ITU-T G.107 VoIP MOS ratings across all voice sessions</p>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span className="flex items-center gap-1.5 font-semibold text-emerald-700">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    Excellent ({qualityStats?.qualityBreakdown?.excellent ?? 0})
                  </span>
                  <span className="flex items-center gap-1.5 font-semibold text-blue-700">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                    Good ({qualityStats?.qualityBreakdown?.good ?? 0})
                  </span>
                  <span className="flex items-center gap-1.5 font-semibold text-amber-700">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                    Poor ({qualityStats?.qualityBreakdown?.poor ?? 0})
                  </span>
                </div>
              </div>

              {/* Progress Bar */}
              {(() => {
                const totalBreakdown =
                  (qualityStats?.qualityBreakdown?.excellent || 0) +
                  (qualityStats?.qualityBreakdown?.good || 0) +
                  (qualityStats?.qualityBreakdown?.poor || 0);
                const excPct = totalBreakdown > 0 ? ((qualityStats?.qualityBreakdown?.excellent || 0) / totalBreakdown) * 100 : 70;
                const goodPct = totalBreakdown > 0 ? ((qualityStats?.qualityBreakdown?.good || 0) / totalBreakdown) * 100 : 25;
                const poorPct = totalBreakdown > 0 ? ((qualityStats?.qualityBreakdown?.poor || 0) / totalBreakdown) * 100 : 5;

                return (
                  <div className="space-y-2">
                    <div className="h-4 w-full bg-slate-100 rounded-full overflow-hidden flex shadow-inner">
                      <div
                        style={{ width: `${excPct}%` }}
                        className="bg-emerald-500 h-full transition-all duration-500"
                        title={`Excellent: ${Math.round(excPct)}%`}
                      />
                      <div
                        style={{ width: `${goodPct}%` }}
                        className="bg-blue-500 h-full transition-all duration-500"
                        title={`Good: ${Math.round(goodPct)}%`}
                      />
                      <div
                        style={{ width: `${poorPct}%` }}
                        className="bg-amber-500 h-full transition-all duration-500"
                        title={`Poor: ${Math.round(poorPct)}%`}
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-xs">
                      <div className="p-3 rounded-2xl bg-emerald-50/60 border border-emerald-100">
                        <div className="font-bold text-emerald-800">🟢 Excellent Quality (MOS ≥ 4.0)</div>
                        <p className="text-[11px] text-emerald-700 mt-0.5">Latency &lt; 100ms, Packet Loss &lt; 1%, Jitter &lt; 20ms. Crisp, studio-clear two-way audio.</p>
                      </div>
                      <div className="p-3 rounded-2xl bg-blue-50/60 border border-blue-100">
                        <div className="font-bold text-blue-800">🔵 Good Quality (MOS 3.5 - 4.0)</div>
                        <p className="text-[11px] text-blue-700 mt-0.5">Latency 100-200ms, Packet Loss &lt; 2.5%. Normal natural dialogue with slight compression.</p>
                      </div>
                      <div className="p-3 rounded-2xl bg-amber-50/60 border border-amber-100">
                        <div className="font-bold text-amber-800">🔴 Poor Quality (MOS &lt; 3.5)</div>
                        <p className="text-[11px] text-amber-700 mt-0.5">Latency &gt; 200ms or Packet Loss &gt; 2.5%. Potential jitter buffers, audio cutouts, or auto-reconnections.</p>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Call Quality History Table & Filters */}
            <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden space-y-4 p-6">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900">Call Quality & Reliability History</h3>
                  <p className="text-xs text-slate-500">Detailed historical record of live voice sessions with real-time network metrics and reconnection events</p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {/* Search */}
                  <div className="relative min-w-[240px]">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="Search customer, phone, or agent..."
                      value={qualitySearch}
                      onChange={(e) => setQualitySearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-500/20 text-slate-900"
                    />
                  </div>

                  {/* Filter Pills */}
                  <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl text-xs font-semibold overflow-x-auto">
                    {(['all', 'excellent', 'good', 'poor', 'reconnected', 'disconnected', 'failed'] as const).map((filterKey) => (
                      <button
                        key={filterKey}
                        onClick={() => setQualityFilter(filterKey)}
                        className={`px-3 py-1 rounded-lg capitalize transition-all cursor-pointer ${qualityFilter === filterKey
                            ? 'bg-white text-slate-900 font-bold shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                          }`}
                      >
                        {filterKey}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Table */}
              {(() => {
                const historyList = (qualityStats?.history || []).filter(call => {
                  if (qualityFilter === 'excellent' && call.quality !== 'excellent') return false;
                  if (qualityFilter === 'good' && call.quality !== 'good') return false;
                  if (qualityFilter === 'poor' && call.quality !== 'poor') return false;
                  if (qualityFilter === 'reconnected' && !call.wasReconnected && (!call.reconnectCount || call.reconnectCount === 0)) return false;
                  if (qualityFilter === 'disconnected' && call.status !== 'disconnected') return false;
                  if (qualityFilter === 'failed' && call.status !== 'failed') return false;

                  if (qualitySearch.trim()) {
                    const q = qualitySearch.toLowerCase();
                    const matchName = (call.customerName || '').toLowerCase().includes(q);
                    const matchPhone = (call.customerPhone || '').toLowerCase().includes(q);
                    const matchAgent = (call.agentName || '').toLowerCase().includes(q);
                    const matchId = (call.callId || call.id || '').toLowerCase().includes(q);
                    return matchName || matchPhone || matchAgent || matchId;
                  }
                  return true;
                });

                if (loadingQuality) {
                  return <div className="py-12 text-center text-xs text-slate-500">Loading call quality records...</div>;
                }

                if (historyList.length === 0) {
                  return (
                    <div className="py-12 text-center space-y-2">
                      <Activity className="w-8 h-8 text-slate-300 mx-auto" />
                      <p className="text-xs text-slate-400">No call quality records match the selected filter.</p>
                    </div>
                  );
                }

                return (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-400 font-semibold bg-slate-50/70">
                          <th className="py-3 px-4">Customer & Call</th>
                          <th className="py-3 px-4">Agent / Handler</th>
                          <th className="py-3 px-4">Date & Duration</th>
                          <th className="py-3 px-4">Quality Rating</th>
                          <th className="py-3 px-4">Latency (RTT)</th>
                          <th className="py-3 px-4">Packet Loss & Jitter</th>
                          <th className="py-3 px-4">Reconnections</th>
                          <th className="py-3 px-4">Call Status</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {historyList.map((call) => {
                          const isExcellent = call.quality === 'excellent';
                          const isGood = call.quality === 'good';
                          const isPoor = call.quality === 'poor';

                          return (
                            <tr key={call.id} className="hover:bg-slate-50/80 transition-colors">
                              {/* Customer & Call */}
                              <td className="py-3 px-4">
                                <div className="font-bold text-slate-900">{call.customerName || 'Registered Customer'}</div>
                                <div className="text-[11px] text-slate-500 font-mono">{call.customerPhone || 'WebRTC Call'}</div>
                                <span className="inline-block mt-0.5 px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600">
                                  {call.direction === 'outgoing' || call.callType === 'outgoing' ? 'PSTN Outbound' : call.direction === 'incoming' || call.callType === 'incoming' ? 'Incoming Support' : 'Voice Session'}
                                </span>
                              </td>

                              {/* Agent */}
                              <td className="py-3 px-4">
                                <div className="font-semibold text-slate-800">{call.agentName || (call.adminId || call.adminHandled ? 'Admin Specialist' : 'KAIRA AI')}</div>
                                <div className="text-[10px] text-slate-400">{call.language ? `Lang: ${call.language.toUpperCase()}` : 'Default'}</div>
                              </td>

                              {/* Date & Duration */}
                              <td className="py-3 px-4 font-mono text-[11px]">
                                <div>{new Date(call.startTime).toLocaleDateString()}</div>
                                <div className="text-slate-400">{new Date(call.startTime).toLocaleTimeString()}</div>
                                <div className="font-bold text-slate-700 mt-0.5">{formatDuration(call.duration)}</div>
                              </td>

                              {/* Quality Rating */}
                              <td className="py-3 px-4">
                                <span
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${isExcellent
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                      : isGood
                                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                                        : isPoor
                                          ? 'bg-red-50 text-red-700 border-red-200'
                                          : 'bg-slate-50 text-slate-700 border-slate-200'
                                    }`}
                                >
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full ${isExcellent ? 'bg-emerald-500' : isGood ? 'bg-blue-500' : isPoor ? 'bg-red-500' : 'bg-slate-400'
                                      }`}
                                  />
                                  {isExcellent ? 'Excellent' : isGood ? 'Good' : isPoor ? 'Poor' : 'Normal'}
                                  {call.audioQualityScore ? ` (${call.audioQualityScore.toFixed(1)})` : ''}
                                </span>
                              </td>

                              {/* Latency (RTT) */}
                              <td className="py-3 px-4 font-mono">
                                <span
                                  className={`font-bold ${call.avgLatency && call.avgLatency > 200
                                      ? 'text-red-600'
                                      : call.avgLatency && call.avgLatency > 100
                                        ? 'text-amber-600'
                                        : 'text-emerald-700'
                                    }`}
                                >
                                  {call.avgLatency ? `${Math.round(call.avgLatency)} ms` : '< 50 ms'}
                                </span>
                              </td>

                              {/* Packet Loss & Jitter */}
                              <td className="py-3 px-4 font-mono text-[11px]">
                                <div>Loss: <span className="font-bold text-slate-800">{call.packetLoss ? `${call.packetLoss.toFixed(1)}%` : '0%'}</span></div>
                                <div className="text-slate-400">Jitter: {call.jitter ? `${Math.round(call.jitter)}ms` : '0ms'}</div>
                              </td>

                              {/* Reconnection Status */}
                              <td className="py-3 px-4">
                                {call.wasReconnected || (call.reconnectCount && call.reconnectCount > 0) ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                    <RefreshCw className="w-3 h-3 text-indigo-500" />
                                    Reconnected ({call.reconnectCount || 1}x)
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                    Stable
                                  </span>
                                )}
                              </td>

                              {/* Status */}
                              <td className="py-3 px-4">
                                <span
                                  className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold ${call.status === 'completed'
                                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                      : call.status === 'disconnected'
                                        ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                        : call.status === 'failed'
                                          ? 'bg-red-50 text-red-700 border border-red-200'
                                          : 'bg-slate-100 text-slate-700'
                                    }`}
                                >
                                  {call.status}
                                </span>
                              </td>

                              {/* Actions */}
                              <td className="py-3 px-4 text-right">
                                <button
                                  onClick={() => setSelectedCallDetails(call)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-50 hover:bg-purple-50 text-slate-700 hover:text-purple-700 rounded-lg border border-slate-200 transition-colors font-medium text-[11px] cursor-pointer"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  Details
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* SECTION H: CALL INTELLIGENCE & ANALYTICS */}
        {activeSection === 'intelligence' && (
          <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">AI Call Intelligence & Follow-Up Analytics</h1>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Automated post-call summarization, conversation resolution classification, Knowledge Base gap identification, and agent resolution metrics.
                </p>
              </div>
              <button
                onClick={fetchIntelligenceStats}
                disabled={loadingIntelligence}
                className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl hover:bg-slate-50 shadow-2xs cursor-pointer transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingIntelligence ? 'animate-spin text-purple-600' : ''}`} />
                {loadingIntelligence ? 'Refreshing...' : 'Refresh Intelligence'}
              </button>
            </div>

            {/* 7 Key Intelligence Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
              {/* 1. Analyzed Calls */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Calls Analyzed</span>
                  <Sparkles className="w-4 h-4 text-purple-500" />
                </div>
                <div className="text-xl font-black text-slate-900">{intelligenceStats?.totalCallsAnalyzed ?? 0}</div>
                <p className="text-[10px] text-slate-400">Structured summaries</p>
              </div>

              {/* 2. Resolved Calls */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Resolved</span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                </div>
                <div className="text-xl font-black text-slate-900">{intelligenceStats?.resolvedCalls ?? 0}</div>
                <p className="text-[10px] text-emerald-600 font-bold">
                  {intelligenceStats?.totalCallsAnalyzed
                    ? `${Math.round(((intelligenceStats.resolvedCalls) / intelligenceStats.totalCallsAnalyzed) * 100)}% resolution rate`
                    : '100% rate'}
                </p>
              </div>

              {/* 3. Partially Resolved */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Partially Resolved</span>
                  <Clock className="w-4 h-4 text-blue-500" />
                </div>
                <div className="text-xl font-black text-slate-900">{intelligenceStats?.partiallyResolvedCalls ?? 0}</div>
                <p className="text-[10px] text-blue-600 font-semibold">Follow-up needed</p>
              </div>

              {/* 4. Unresolved Calls */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Unresolved</span>
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                </div>
                <div className="text-xl font-black text-slate-900">{intelligenceStats?.unresolvedCalls ?? 0}</div>
                <p className="text-[10px] text-amber-600 font-semibold">Requires attention</p>
              </div>

              {/* 5. Escalated Calls */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Escalated</span>
                  <PhoneForwarded className="w-4 h-4 text-fuchsia-500" />
                </div>
                <div className="text-xl font-black text-slate-900">{intelligenceStats?.escalatedCalls ?? 0}</div>
                <p className="text-[10px] text-fuchsia-600 font-semibold">Admin transfers</p>
              </div>

              {/* 6. Pending Follow-Ups */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Pending Tasks</span>
                  <ListTodo className="w-4 h-4 text-orange-500" />
                </div>
                <div className="text-xl font-black text-slate-900">{intelligenceStats?.pendingFollowUpTasks ?? 0}</div>
                <p className="text-[10px] text-orange-600 font-semibold">Open agent tasks</p>
              </div>

              {/* 7. Completed Tasks */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Tasks Completed</span>
                  <CheckCircle2 className="w-4 h-4 text-teal-500" />
                </div>
                <div className="text-xl font-black text-slate-900">{intelligenceStats?.completedFollowUpTasks ?? 0}</div>
                <p className="text-[10px] text-teal-600 font-semibold">Confirmed resolved</p>
              </div>
            </div>

            {/* AI Issue Resolution Distribution Progress Bar */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">AI Issue Resolution Classification Distribution</h3>
                  <p className="text-xs text-slate-500">
                    Classified based strictly on dialogue confirmation, agent answers, and customer sentiment — never marked resolved merely because the call ended.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className="flex items-center gap-1.5 font-semibold text-emerald-700">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    Resolved ({intelligenceStats?.resolvedCalls ?? 0})
                  </span>
                  <span className="flex items-center gap-1.5 font-semibold text-blue-700">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                    Partially Resolved ({intelligenceStats?.partiallyResolvedCalls ?? 0})
                  </span>
                  <span className="flex items-center gap-1.5 font-semibold text-amber-700">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                    Unresolved ({intelligenceStats?.unresolvedCalls ?? 0})
                  </span>
                  <span className="flex items-center gap-1.5 font-semibold text-purple-700">
                    <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
                    Escalated ({intelligenceStats?.escalatedCalls ?? 0})
                  </span>
                </div>
              </div>

              {/* Progress Bar */}
              {(() => {
                const total = intelligenceStats?.totalCallsAnalyzed || 0;
                const resPct = total > 0 ? ((intelligenceStats?.resolvedCalls || 0) / total) * 100 : 70;
                const partPct = total > 0 ? ((intelligenceStats?.partiallyResolvedCalls || 0) / total) * 100 : 15;
                const unresPct = total > 0 ? ((intelligenceStats?.unresolvedCalls || 0) / total) * 100 : 10;
                const escPct = total > 0 ? ((intelligenceStats?.escalatedCalls || 0) / total) * 100 : 5;

                return (
                  <div className="space-y-3">
                    <div className="h-4 w-full bg-slate-100 rounded-full overflow-hidden flex shadow-inner">
                      <div style={{ width: `${resPct}%` }} className="bg-emerald-500 h-full transition-all duration-500" title={`Resolved: ${Math.round(resPct)}%`} />
                      <div style={{ width: `${partPct}%` }} className="bg-blue-500 h-full transition-all duration-500" title={`Partially Resolved: ${Math.round(partPct)}%`} />
                      <div style={{ width: `${unresPct}%` }} className="bg-amber-500 h-full transition-all duration-500" title={`Unresolved: ${Math.round(unresPct)}%`} />
                      <div style={{ width: `${escPct}%` }} className="bg-purple-500 h-full transition-all duration-500" title={`Escalated: ${Math.round(escPct)}%`} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
                      <div className="p-3 rounded-2xl bg-emerald-50/60 border border-emerald-100">
                        <span className="font-bold text-emerald-800 block">Resolved</span>
                        <p className="text-[11px] text-emerald-700 mt-0.5">Explicit customer confirmation, verified KB solutions provided, zero pending questions.</p>
                      </div>
                      <div className="p-3 rounded-2xl bg-blue-50/60 border border-blue-100">
                        <span className="font-bold text-blue-800 block">Partially Resolved</span>
                        <p className="text-[11px] text-blue-700 mt-0.5">Primary topic addressed but secondary inquiries remain open or follow-up requested.</p>
                      </div>
                      <div className="p-3 rounded-2xl bg-amber-50/60 border border-amber-100">
                        <span className="font-bold text-amber-800 block">Unresolved</span>
                        <p className="text-[11px] text-amber-700 mt-0.5">Customer issue not resolved; auto-creates a follow-up task for responsible agent.</p>
                      </div>
                      <div className="p-3 rounded-2xl bg-purple-50/60 border border-purple-100">
                        <span className="font-bold text-purple-800 block">Escalated to Admin</span>
                        <p className="text-[11px] text-purple-700 mt-0.5">Ungrounded queries or specialized requests transferred directly to human admin staff.</p>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Knowledge Base Gap Report & Unanswered Questions */}
            <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6 space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-extrabold text-slate-900">Knowledge Base Intelligence & Gaps Report</h3>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
                      {intelligenceStats?.kbGaps?.length ?? 0} Identified Gaps
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Unanswered and repeated customer questions where official KB content is missing. Admins can review, approve, and publish verified answers.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="relative min-w-[200px]">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="Search questions or topics..."
                      value={gapSearch}
                      onChange={(e) => setGapSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white text-slate-900"
                    />
                  </div>

                  {/* Language filter */}
                  <select
                    value={gapLangFilter}
                    onChange={(e) => setGapLangFilter(e.target.value)}
                    className="p-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-700 font-semibold"
                  >
                    <option value="all">All Languages</option>
                    <option value="en">English</option>
                    <option value="ta">Tamil (தமிழ்)</option>
                    <option value="te">Telugu (తెలుగు)</option>
                    <option value="ml">Malayalam (മലയാളം)</option>
                    <option value="hi">Hindi (हिन्दी)</option>
                  </select>
                </div>
              </div>

              {/* Gaps Table */}
              {(() => {
                const gaps = (intelligenceStats?.kbGaps || []).filter(g => {
                  if (gapLangFilter !== 'all' && g.language !== gapLangFilter) return false;
                  if (gapSearch.trim()) {
                    const q = gapSearch.toLowerCase();
                    return g.question.toLowerCase().includes(q) || g.topic.toLowerCase().includes(q);
                  }
                  return true;
                });

                if (gaps.length === 0) {
                  return (
                    <div className="py-8 text-center text-xs text-slate-400">
                      No unresolved Knowledge Base gaps detected. All answered questions are grounded!
                    </div>
                  );
                }

                return (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-400 font-semibold bg-slate-50/70">
                          <th className="py-3 px-4">Repeated Unanswered Question</th>
                          <th className="py-3 px-4">Inferred Topic</th>
                          <th className="py-3 px-4">Language</th>
                          <th className="py-3 px-4">Frequency</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Admin Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {gaps.map((gap) => (
                          <tr key={gap.id} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-3 px-4 font-bold text-slate-900 max-w-md">
                              "{gap.question}"
                            </td>
                            <td className="py-3 px-4">
                              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                {gap.topic}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <span className="font-semibold text-slate-600">
                                {SUPPORTED_LANGUAGES[gap.language as LanguageCode]?.name || gap.language.toUpperCase()}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-mono font-bold text-purple-700">
                              {gap.frequency}x
                            </td>
                            <td className="py-3 px-4">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                gap.status === 'added_to_kb'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}>
                                {gap.status === 'added_to_kb' ? 'Added to KB' : 'Open Gap'}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right">
                              {gap.status !== 'added_to_kb' ? (
                                <button
                                  onClick={() => handleOpenApproveGap(gap)}
                                  className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl text-[11px] shadow-xs cursor-pointer transition-all flex items-center gap-1 ml-auto"
                                >
                                  <Plus className="w-3 h-3" />
                                  Approve & Add to KB
                                </button>
                              ) : (
                                <span className="text-emerald-600 text-[11px] font-semibold flex items-center gap-1 justify-end">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  Published
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>

            {/* Agent Resolution Statistics Leaderboard */}
            <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6 space-y-4">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">Agent Resolution Performance & Resolution Rates</h3>
                <p className="text-xs text-slate-500">Individual support agent metrics computed from real post-call conversation analyses</p>
              </div>

              {(!intelligenceStats?.agentResolutionStats || intelligenceStats.agentResolutionStats.length === 0) ? (
                <p className="text-xs text-slate-400 py-4">No agent resolution records available yet.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {intelligenceStats.agentResolutionStats.map((a) => (
                    <div key={a.agentId} className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="font-bold text-slate-900 text-xs">{a.agentName}</div>
                        <span className="font-mono text-xs font-black text-emerald-600">{a.resolutionRate}% Rate</span>
                      </div>
                      <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                        <div style={{ width: `${a.resolutionRate}%` }} className="bg-emerald-500 h-full" />
                      </div>
                      <div className="flex justify-between text-[11px] text-slate-500 font-mono">
                        <span>Calls: {a.totalCallsHandled}</span>
                        <span>Resolved: {a.resolvedCount}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Frequently Asked Questions (FAQ) Aggregation */}
            {intelligenceStats?.frequentlyAskedQuestions && intelligenceStats.frequentlyAskedQuestions.length > 0 && (
              <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6 space-y-3">
                <h3 className="text-sm font-bold text-slate-900">Frequently Asked Customer Questions (Aggregated)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {intelligenceStats.frequentlyAskedQuestions.map((faq, idx) => (
                    <div key={idx} className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                      <span className="font-medium text-slate-800">"{faq.question}"</span>
                      <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 font-bold font-mono text-[10px]">
                        {faq.count} {faq.count === 1 ? 'call' : 'calls'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* SECTION I: FOLLOW-UP TASKS (Admin View) */}
        {activeSection === 'tasks' && (
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 space-y-6 shadow-xs">
            <FollowUpTasksManager token={token} currentUserId={user?.id} isAgent={false} />
          </div>
        )}

      </main>

      {/* 3. INCOMING DEDICATED ADMIN CALL NOTIFICATION MODAL (WITH RINGTONE & ACD 25s FAILOVER) */}
      {(incomingAdminCall || incomingTransfer) && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-purple-200 space-y-4">
            <div className="flex items-center gap-3 text-purple-700">
              <div className="w-12 h-12 rounded-2xl bg-purple-100 flex items-center justify-center">
                <Radio className="w-6 h-6 animate-pulse text-purple-600" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-extrabold text-slate-900 text-base">Incoming Voice Call</h3>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                    Ringing...
                  </span>
                </div>
                <p className="text-xs text-purple-600 font-medium">
                  Assigned to Operator: <strong>{operatorName}</strong>
                </p>
              </div>
            </div>

            <div className="p-4 bg-purple-50/70 border border-purple-100 rounded-2xl text-xs space-y-2.5">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-slate-500">Customer Name:</span>
                <span className="font-extrabold text-slate-900 text-sm">
                  {incomingAdminCall?.customerName || incomingTransfer?.customerName}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-semibold text-slate-500">Phone / Connection:</span>
                <span className="font-mono text-slate-700 font-bold">
                  {incomingAdminCall?.customerPhone || incomingTransfer?.customerPhone || 'WebRTC Live Audio'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-semibold text-slate-500">Customer Language:</span>
                <span className="px-2 py-0.5 rounded-md bg-purple-200/80 text-purple-900 font-bold text-[11px]">
                  {SUPPORTED_LANGUAGES[((incomingAdminCall?.preferredLanguage || 'en') as LanguageCode)]?.nativeName || 'English'} ({SUPPORTED_LANGUAGES[((incomingAdminCall?.preferredLanguage || 'en') as LanguageCode)]?.name || 'English'})
                </span>
              </div>
              {(incomingAdminCall?.question || incomingTransfer?.question) && (
                <div>
                  <span className="font-semibold text-slate-500 block mb-1">Escalated Question / Inquiries:</span>
                  <p className="p-2.5 bg-white rounded-xl border border-purple-200/80 font-medium text-slate-800">
                    "{incomingAdminCall?.question || incomingTransfer?.question}"
                  </p>
                </div>
              )}
              <div className="pt-1 text-[11px] text-amber-700 bg-amber-50 p-2 rounded-xl border border-amber-200/60 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                <span>ACD Ringing Timeout: 25s failover to next available administrator if unanswered.</span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={handleRejectAdminCall}
                className="flex-1 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer transition-colors"
              >
                Decline / Reroute
              </button>
              <button
                onClick={handleAcceptAdminCall}
                className="flex-1 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-md cursor-pointer flex items-center justify-center gap-1.5 transition-colors"
              >
                <PhoneCall className="w-4 h-4" />
                Accept Voice Call
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3B. EDIT OPERATOR IDENTITY MODAL */}
      {isEditingOperatorName && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-sm">Customize Operator Identity</h3>
              <button onClick={() => setIsEditingOperatorName(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">✕</button>
            </div>
            <div className="space-y-3 text-xs">
              <p className="text-slate-500">
                Set a distinct operator name for this device or browser session (e.g. <strong>Ravi Arun</strong>, <strong>Arun</strong>, <strong>Kumar</strong>, <strong>Prem</strong>). All admins share the same login, but your calls and caller transcripts are routed independently to this operator identity.
              </p>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Operator Display Name</label>
                <input
                  type="text"
                  value={tempOperatorName}
                  onChange={(e) => setTempOperatorName(e.target.value)}
                  placeholder="e.g. Ravi Arun"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900 font-bold"
                  autoFocus
                />
              </div>
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEditingOperatorName(false)}
                  className="flex-1 py-2 font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveOperatorName}
                  className="flex-1 py-2 font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-xs cursor-pointer"
                >
                  Save Identity
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. ADD / EDIT CUSTOMER MODAL */}
      {showAddCustomerModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-sm">
                {editingCustomer ? 'Edit Customer Information' : 'Add New Customer'}
              </h3>
              <button onClick={() => setShowAddCustomerModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">✕</button>
            </div>

            <form onSubmit={handleSaveCustomer} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={custFormName}
                  onChange={(e) => setCustFormName(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Email Address (Unique Identifier)</label>
                <input
                  type="email"
                  required
                  value={custFormEmail}
                  onChange={(e) => setCustFormEmail(e.target.value)}
                  placeholder="e.g. john@example.com"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Phone Number</label>
                <input
                  type="tel"
                  value={custFormPhone}
                  onChange={(e) => setCustFormPhone(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900 font-mono"
                />
              </div>

              {!editingCustomer && (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Password</label>
                  <input
                    type="password"
                    required
                    value={custFormPassword}
                    onChange={(e) => setCustFormPassword(e.target.value)}
                    placeholder="Min. 6 characters"
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900"
                  />
                </div>
              )}

              <div className="flex items-center gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddCustomerModal(false)}
                  className="flex-1 py-2 font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-xs cursor-pointer"
                >
                  {editingCustomer ? 'Update Customer' : 'Create Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. DELETE CUSTOMER CONFIRMATION */}
      {deletingCustomer && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center gap-3 text-red-600">
              <AlertCircle className="w-6 h-6" />
              <h3 className="font-bold text-slate-900 text-sm">Delete Customer Account</h3>
            </div>
            <p className="text-xs text-slate-600">
              Are you sure you want to delete <span className="font-bold text-slate-900">{deletingCustomer.name}</span> ({deletingCustomer.email})? This action cannot be undone.
            </p>
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => setDeletingCustomer(null)}
                className="flex-1 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteCustomer}
                className="flex-1 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-xs cursor-pointer"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. ADD / EDIT AGENT MODAL */}
      {showAddAgentModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-sm">
                {editingAgent ? 'Edit Support Agent' : 'Add New Support Agent'}
              </h3>
              <button onClick={() => setShowAddAgentModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">✕</button>
            </div>

            <form onSubmit={handleSaveAgent} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Agent Full Name</label>
                <input
                  type="text"
                  required
                  value={agentFormName}
                  onChange={(e) => setAgentFormName(e.target.value)}
                  placeholder="e.g. Sarah Jenkins"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Agent Email / Username (Unique Identifier)</label>
                <input
                  type="text"
                  required
                  value={agentFormEmail}
                  onChange={(e) => setAgentFormEmail(e.target.value)}
                  placeholder="e.g. agent2@kaira"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Direct Phone Number</label>
                <input
                  type="tel"
                  value={agentFormPhone}
                  onChange={(e) => setAgentFormPhone(e.target.value)}
                  placeholder="+1 (555) 018-9921"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900 font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {editingAgent ? 'Update Password (leave blank to keep current)' : 'Password'}
                </label>
                <input
                  type="password"
                  required={!editingAgent}
                  value={agentFormPassword}
                  onChange={(e) => setAgentFormPassword(e.target.value)}
                  placeholder="Min. 6 characters"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900"
                />
              </div>

              <div className="flex items-center gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddAgentModal(false)}
                  className="flex-1 py-2 font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-xs cursor-pointer"
                >
                  {editingAgent ? 'Update Agent' : 'Create Agent'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 7. DELETE AGENT CONFIRMATION */}
      {deletingAgent && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center gap-3 text-red-600">
              <AlertCircle className="w-6 h-6" />
              <h3 className="font-bold text-slate-900 text-sm">Delete Support Agent</h3>
            </div>
            <p className="text-xs text-slate-600">
              Are you sure you want to revoke authorization for <span className="font-bold text-slate-900">{deletingAgent.name}</span> ({deletingAgent.email})?
            </p>
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => setDeletingAgent(null)}
                className="flex-1 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAgent}
                className="flex-1 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-xs cursor-pointer"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. CUSTOMER HISTORY MODAL */}
      {selectedCustomerHistory && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl border border-slate-100 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Customer Record & Call History</h3>
                <p className="text-xs text-slate-500">{selectedCustomerHistory.name} • {selectedCustomerHistory.email}</p>
              </div>
              <button onClick={() => setSelectedCustomerHistory(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">✕</button>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Associated Voice Calls</h4>
              {(!selectedCustomerHistory as any).callsAsCustomer || (selectedCustomerHistory as any).callsAsCustomer.length === 0 ? (
                <p className="text-xs text-slate-400 py-4 text-center">No calls recorded for this customer.</p>
              ) : (
                (selectedCustomerHistory as any).callsAsCustomer.map((call: any) => (
                  <div key={call.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs space-y-2">
                    <div className="flex justify-between font-bold text-slate-800">
                      <span>{new Date(call.startTime).toLocaleString()}</span>
                      <span className="font-mono">{formatDuration(call.duration)}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 font-semibold">{call.type}</span>
                      <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 font-semibold">{call.status}</span>
                      {call.transferred && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold">Transferred</span>}
                    </div>
                  </div>
                ))
              )}
            </div>

            <button
              onClick={() => setSelectedCustomerHistory(null)}
              className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* 9. CALL DETAILS & FULL TRANSCRIPT MODAL */}
      {selectedCallDetails && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Call Record Details</h3>
                <p className="text-[11px] text-slate-500 font-mono">
                  {selectedCallDetails.customerName} • {formatDuration(selectedCallDetails.duration)}
                </p>
              </div>
              <button onClick={() => setSelectedCallDetails(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">✕</button>
            </div>

            {/* Telephony & Call Metadata */}
            <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-50 p-3 rounded-2xl border border-slate-200">
              <div>
                <span className="text-slate-400 block font-semibold uppercase text-[9px]">Destination Phone</span>
                <span className="font-mono text-slate-800">{selectedCallDetails.customerPhone || 'N/A'}</span>
              </div>
              <div>
                <span className="text-slate-400 block font-semibold uppercase text-[9px]">Provider / Channel</span>
                <span className="font-medium text-slate-800">
                  {selectedCallDetails.providerName ? `${selectedCallDetails.providerName.toUpperCase()} Telephony` : 'WebRTC Voice'}
                </span>
              </div>
              {selectedCallDetails.providerCallSid && (
                <div className="col-span-2">
                  <span className="text-slate-400 block font-semibold uppercase text-[9px]">Provider Call SID</span>
                  <span className="font-mono text-slate-600 text-[10px] break-all">{selectedCallDetails.providerCallSid}</span>
                </div>
              )}
              {selectedCallDetails.failureReason && (
                <div className="col-span-2">
                  <span className="text-red-400 block font-semibold uppercase text-[9px]">Failure Reason</span>
                  <span className="font-semibold text-red-600">{selectedCallDetails.failureReason}</span>
                </div>
              )}
            </div>

            {/* Call Sentiment Summary */}
            <PostCallSentimentSummary
              overallSentiment={selectedCallDetails.overallSentiment}
              sentimentScore={selectedCallDetails.sentimentScore}
              customerExperience={selectedCallDetails.sentimentRecords?.find(r => r.isFinal)?.customerExperienceNote}
              frustrationDetected={selectedCallDetails.overallSentiment === 'FRUSTRATED'}
              requiresAssistance={selectedCallDetails.requiresAssistance}
              assistanceReason={selectedCallDetails.assistanceReason}
            />

            {/* Call Quality & Telemetry Metadata */}
            {(selectedCallDetails.quality || selectedCallDetails.avgLatency != null || selectedCallDetails.wasReconnected) && (
              <div className="p-3 bg-emerald-50/50 rounded-2xl border border-emerald-100 space-y-1.5 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-950 flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-emerald-600" />
                    Network & Quality Telemetry
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                    selectedCallDetails.quality === 'excellent'
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                      : selectedCallDetails.quality === 'good'
                        ? 'bg-blue-100 text-blue-800 border-blue-300'
                        : 'bg-amber-100 text-amber-800 border-amber-300'
                  }`}>
                    {selectedCallDetails.quality ? selectedCallDetails.quality.toUpperCase() : 'NORMAL'}
                    {selectedCallDetails.audioQualityScore ? ` • MOS ${selectedCallDetails.audioQualityScore.toFixed(1)}` : ''}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 font-mono text-[10px] pt-1">
                  <div>
                    <span className="text-slate-500 block">Latency (RTT)</span>
                    <span className="font-bold text-slate-800">
                      {selectedCallDetails.avgLatency ? `${Math.round(selectedCallDetails.avgLatency)} ms` : '< 50 ms'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Packet Loss</span>
                    <span className="font-bold text-slate-800">
                      {selectedCallDetails.packetLoss ? `${selectedCallDetails.packetLoss.toFixed(1)}%` : '0%'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Reconnections</span>
                    <span className={`font-bold ${selectedCallDetails.wasReconnected ? 'text-indigo-600' : 'text-slate-800'}`}>
                      {selectedCallDetails.reconnectCount ? `${selectedCallDetails.reconnectCount}x (Auto-restored)` : 'None (Stable)'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="max-h-80 overflow-y-auto space-y-3 p-2">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Conversation Transcript</h4>
              {(!selectedCallDetails.transcripts || selectedCallDetails.transcripts.length === 0) ? (
                <p className="text-xs text-slate-400 py-4 text-center">No transcript available.</p>
              ) : (
                selectedCallDetails.transcripts.map((t) => (
                  <div key={t.id} className="text-xs">
                    <span className="font-semibold text-slate-500 block mb-0.5">{t.senderName || t.sender}:</span>
                    <p className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-slate-800">
                      {t.text}
                    </p>
                    {t.translation && (
                      <p className="text-[11px] italic text-indigo-600 mt-1 pl-2">
                        Translation: {t.translation}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>

            <button
              onClick={() => setSelectedCallDetails(null)}
              className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* 10. ADD / EDIT KNOWLEDGE ENTRY MODAL */}
      {showAddKbModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-sm">
                {editingKbEntry ? 'Edit Knowledge Entry' : 'Add Knowledge Entry'}
              </h3>
              <button onClick={() => setShowAddKbModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">✕</button>
            </div>

            <form onSubmit={handleSaveKbEntry} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Title (Unique)</label>
                <input
                  type="text"
                  required
                  value={kbTitle}
                  onChange={(e) => setKbTitle(e.target.value)}
                  placeholder="e.g. Enterprise Plan Pricing"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Category</label>
                <select
                  value={kbCat}
                  onChange={(e) => setKbCat(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900 bg-white"
                >
                  <option value="company">Company</option>
                  <option value="products">Products</option>
                  <option value="pricing">Pricing</option>
                  <option value="policies">Policies</option>
                  <option value="faq">FAQ</option>
                  <option value="support">Support</option>
                  <option value="general">General</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Target Question (Optional Q&A)</label>
                <input
                  type="text"
                  value={kbQuestion}
                  onChange={(e) => setKbQuestion(e.target.value)}
                  placeholder="What is the price of the Enterprise plan?"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Direct Answer (Optional Q&A)</label>
                <textarea
                  rows={2}
                  value={kbAnswer}
                  onChange={(e) => setKbAnswer(e.target.value)}
                  placeholder="Direct response the AI will read to the customer."
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Full Detailed Content</label>
                <textarea
                  rows={4}
                  required
                  value={kbContent}
                  onChange={(e) => setKbContent(e.target.value)}
                  placeholder="Full corporate reference text used for grounding..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Keywords (Comma separated)</label>
                <input
                  type="text"
                  value={kbKeywords}
                  onChange={(e) => setKbKeywords(e.target.value)}
                  placeholder="pricing, enterprise, cost, subscription"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900"
                />
              </div>

              <div className="flex items-center gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddKbModal(false)}
                  className="flex-1 py-2 font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-xs cursor-pointer"
                >
                  Save Entry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 11. DELETE KB ENTRY CONFIRMATION */}
      {deletingKbEntry && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center gap-3 text-red-600">
              <AlertCircle className="w-6 h-6" />
              <h3 className="font-bold text-slate-900 text-sm">Delete Knowledge Entry</h3>
            </div>
            <p className="text-xs text-slate-600">
              Are you sure you want to delete <span className="font-bold text-slate-900">{deletingKbEntry.title}</span>? The AI agent will no longer be able to retrieve this information.
            </p>
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => setDeletingKbEntry(null)}
                className="flex-1 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteKbEntry}
                className="flex-1 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-xs cursor-pointer"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CUSTOMER INTERACTION PROFILE MODAL */}
      {selectedProfileCustomerId && (
        <CustomerProfileModal
          customerId={selectedProfileCustomerId}
          isOpen={!!selectedProfileCustomerId}
          token={token}
          onClose={() => setSelectedProfileCustomerId(null)}
          onOpenIntelligence={(callId: string) => {
            setSelectedProfileCustomerId(null);
            setSelectedIntelligenceCallId(callId);
          }}
        />
      )}

      {/* CALL INTELLIGENCE INSPECTION MODAL */}
      {selectedIntelligenceCallId && (
        <CallIntelligenceModal
          callId={selectedIntelligenceCallId}
          isOpen={!!selectedIntelligenceCallId}
          token={token}
          onClose={() => setSelectedIntelligenceCallId(null)}
          onOpenCustomerProfile={(customerId: string) => {
            setSelectedIntelligenceCallId(null);
            setSelectedProfileCustomerId(customerId);
          }}
        />
      )}

      {/* APPROVE KNOWLEDGE GAP TO OFFICIAL KB MODAL */}
      {approvingGap && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 shadow-2xl border border-purple-200 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-purple-700">
                <Sparkles className="w-5 h-5" />
                <h3 className="font-extrabold text-slate-900 text-sm">Approve & Add Knowledge Base Content</h3>
              </div>
              <button
                onClick={() => setApprovingGap(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-2xl text-xs space-y-1">
              <span className="font-bold text-amber-800">Customer Inquiry:</span>
              <p className="text-slate-800 font-semibold italic">"{approvingGap.question}"</p>
              <div className="flex gap-4 pt-1 text-[11px] text-amber-700">
                <span>Language: <strong>{SUPPORTED_LANGUAGES[approvingGap.language as LanguageCode]?.name || approvingGap.language}</strong></span>
                <span>Repeated: <strong>{approvingGap.frequency} times</strong></span>
              </div>
            </div>

            <form onSubmit={handleSaveApproveGap} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Knowledge Title</label>
                <input
                  type="text"
                  required
                  value={gapTitle}
                  onChange={(e) => setGapTitle(e.target.value)}
                  placeholder="e.g. Refund Policy and Processing Times"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Category</label>
                <select
                  value={gapCategory}
                  onChange={(e) => setGapCategory(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                >
                  <option value="general">General</option>
                  <option value="pricing">Pricing & Plans</option>
                  <option value="technical">Technical Support</option>
                  <option value="billing">Billing & Refunds</option>
                  <option value="account">Account Management</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Official Verified Answer (Spoken by AI & Multilingual Handlers)
                </label>
                <textarea
                  rows={4}
                  required
                  value={gapAnswer}
                  onChange={(e) => setGapAnswer(e.target.value)}
                  placeholder="Enter the official company response. This will be converted to speech and provided whenever customers ask this question."
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                />
              </div>

              <div className="flex items-center gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setApprovingGap(null)}
                  className="flex-1 py-2 font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingGap || !gapAnswer.trim()}
                  className="flex-1 py-2 font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {savingGap ? 'Publishing to KB...' : 'Approve & Publish to KB'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
