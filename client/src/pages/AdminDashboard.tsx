import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { getSocket } from '../services/socket.js';
import { webrtcManager } from '../services/webrtc.js';
import { voiceService } from '../services/voice.js';
import { SupportTickets } from './SupportTickets.js';
import {
  User, CallRecord, CallTranscript, CallTransferRequest,
  KnowledgeEntry, KnowledgeDocument, CallStats, LanguageCode, SUPPORTED_LANGUAGES
} from '../types.js';
import {
  Users, PhoneCall, PhoneIncoming, PhoneOutgoing, PhoneForwarded,
  PhoneOff, Mic, MicOff, Volume2, VolumeX, Clock, Search,
  BookOpen, Plus, Trash2, Edit3, Upload, CheckCircle2, MessageSquare,
  AlertCircle, ShieldAlert, Eye, Headphones, Radio, RefreshCw, Globe
} from 'lucide-react';

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
  const [activeSection, setActiveSection] = useState<'overview' | 'customers' | 'agents' | 'calls' | 'transfers' | 'knowledge' | 'tickets'>('overview');

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

  // Real-time Incoming Transfer Notification Modal
  const [incomingTransfer, setIncomingTransfer] = useState<{
    transferId: string;
    callId: string;
    customerName: string;
    customerPhone: string;
    question: string;
    reason: string;
    duration: number;
  } | null>(null);

  // Active Transferred Live Voice Session
  const [activeTransferredCall, setActiveTransferredCall] = useState<{
    callId: string;
    transferId: string;
    customerName: string;
    customerPhone?: string;
    question: string;
  } | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [transcripts, setTranscripts] = useState<CallTranscript[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);

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

  // Auto-scroll transcript
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  // Duration timer
  useEffect(() => {
    let timer: any;
    if (activeTransferredCall) {
      timer = setInterval(() => setCallDuration(prev => prev + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [activeTransferredCall]);

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

  // Initial stats load
  useEffect(() => {
    fetchStats();
  }, [token]);

  // Section-specific data fetching
  useEffect(() => {
    if (activeSection === 'overview') fetchStats();
    if (activeSection === 'customers') fetchCustomers();
    if (activeSection === 'agents') fetchAgents();
    if (activeSection === 'calls') fetchCalls();
    if (activeSection === 'transfers') fetchTransfers();
    if (activeSection === 'knowledge') fetchKnowledge();
  }, [activeSection, token, customerSearch, agentSearch, callFilter, callSearch, kbCategory, kbSearch]);

  // Socket setup with clean teardown
  useEffect(() => {
    const socket = getSocket();

    const handleIncomingTransfer = (data: any) => {
      setIncomingTransfer(data);
      fetchStats();
    };

    const handleTransferUpdated = (data: any) => {
      if (incomingTransfer && incomingTransfer.transferId === data.transferId) {
        setIncomingTransfer(null);
      }
      fetchTransfers();
      fetchStats();
    };

    const handleStatusChanged = () => {
      fetchStats();
      if (activeSection === 'calls') fetchCalls();
    };

    const handleCallEnded = () => {
      if (activeTransferredCall) {
        handleEndTransferredCall();
      }
    };

    socket.on('transfer:incoming', handleIncomingTransfer);
    socket.on('transfer:status_updated', handleTransferUpdated);
    socket.on('call:status_changed', handleStatusChanged);
    socket.on('call:ended', handleCallEnded);

    return () => {
      socket.off('transfer:incoming', handleIncomingTransfer);
      socket.off('transfer:status_updated', handleTransferUpdated);
      socket.off('call:status_changed', handleStatusChanged);
      socket.off('call:ended', handleCallEnded);
    };
  }, [incomingTransfer, activeTransferredCall, activeSection]);

  // Handle Admin Accepting Live Transfer
  const handleAcceptTransfer = async () => {
    if (!incomingTransfer) return;

    try {
      await webrtcManager.getMicrophoneStream();
      const socket = getSocket();
      socket.emit('transfer:accept', {
        transferId: incomingTransfer.transferId,
        adminId: user?.id,
        adminName: user?.name
      });

      setActiveTransferredCall({
        callId: incomingTransfer.callId,
        transferId: incomingTransfer.transferId,
        customerName: incomingTransfer.customerName,
        customerPhone: incomingTransfer.customerPhone,
        question: incomingTransfer.question
      });

      setCallDuration(incomingTransfer.duration || 0);
      setTranscripts([
        {
          id: 't_' + Date.now(),
          sender: 'system',
          senderName: 'System',
          text: `Live voice transfer accepted. Connected with ${incomingTransfer.customerName}.`,
          timestamp: new Date().toISOString()
        },
        {
          id: 't_q_' + Date.now(),
          sender: 'customer',
          senderName: incomingTransfer.customerName,
          text: `[Original Question]: "${incomingTransfer.question}"`,
          timestamp: new Date().toISOString()
        }
      ]);

      voiceService.startListening((text, isFinal) => {
        if (isFinal && text.trim()) {
          socket.emit('call:live_speech', {
            callId: incomingTransfer.callId,
            sender: 'admin',
            senderName: user?.name || 'Admin',
            text: text.trim()
          });
        }
      });

      setIncomingTransfer(null);
      setActiveSection('transfers');
    } catch (err) {
      console.error('Error accepting transfer:', err);
      alert('Microphone access is required to take transferred voice calls.');
    }
  };

  // Handle Admin Rejecting Live Transfer
  const handleRejectTransfer = () => {
    if (!incomingTransfer) return;
    const socket = getSocket();
    socket.emit('transfer:reject', {
      transferId: incomingTransfer.transferId,
      adminId: user?.id,
      reason: 'Admin busy'
    });
    setIncomingTransfer(null);
    fetchTransfers();
    fetchStats();
  };

  // End Active Transferred Call
  const handleEndTransferredCall = () => {
    if (activeTransferredCall) {
      const socket = getSocket();
      socket.emit('call:end', {
        callId: activeTransferredCall.callId,
        duration: callDuration
      });
    }

    setActiveTransferredCall(null);
    setCallDuration(0);
    voiceService.stopListening();
    webrtcManager.endCall();
    fetchStats();
    fetchTransfers();
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
          </nav>
        </div>

        <div className="p-3 bg-slate-800/60 rounded-2xl border border-slate-800 space-y-1">
          <p className="text-[11px] font-bold text-slate-200">{user?.name}</p>
          <p className="text-[10px] text-slate-400 truncate">{user?.email}</p>
        </div>
      </aside>

      {/* 2. MAIN CONTENT AREA */}
      <main className="flex-1 p-6 md:p-8 space-y-8 overflow-y-auto max-w-7xl">

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
                    Multilingual Voice Call Distribution (5 Regional Languages)
                  </h3>
                </div>
                <span className="text-xs text-slate-400">Grounded real-time interpretation</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {[
                  { code: 'en', name: 'English', native: 'English' },
                  { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
                  { code: 'te', name: 'Telugu', native: 'తెలుగు' },
                  { code: 'ml', name: 'Malayalam', native: 'മലയാളം' },
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
                            {call.transferred ? (
                              <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-bold text-[10px]">
                                Yes (to Admin)
                              </span>
                            ) : (
                              <span className="text-slate-400">No</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <button
                              onClick={() => setSelectedCallDetails(call)}
                              className="px-3 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg font-semibold transition-colors cursor-pointer text-xs"
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

      </main>

      {/* 3. INCOMING TRANSFER NOTIFICATION MODAL */}
      {incomingTransfer && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-purple-200 space-y-4">
            <div className="flex items-center gap-3 text-purple-700">
              <div className="w-12 h-12 rounded-2xl bg-purple-100 flex items-center justify-center">
                <Radio className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <h3 className="font-extrabold text-slate-900 text-base">Incoming Call Transfer</h3>
                <p className="text-xs text-slate-500">AI Voice Agent escalated to Admin</p>
              </div>
            </div>

            <div className="p-4 bg-purple-50/70 border border-purple-100 rounded-2xl text-xs space-y-2">
              <div className="flex justify-between">
                <span className="font-semibold text-slate-500">Customer:</span>
                <span className="font-bold text-slate-900">{incomingTransfer.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold text-slate-500">Phone:</span>
                <span className="font-mono text-slate-700">{incomingTransfer.customerPhone || 'N/A'}</span>
              </div>
              <div>
                <span className="font-semibold text-slate-500 block mb-1">Customer Question:</span>
                <p className="p-2.5 bg-white rounded-xl border border-purple-200/80 font-medium text-slate-800">
                  "{incomingTransfer.question}"
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={handleRejectTransfer}
                className="flex-1 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
              >
                Decline
              </button>
              <button
                onClick={handleAcceptTransfer}
                className="flex-1 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-md cursor-pointer flex items-center justify-center gap-1.5"
              >
                <PhoneCall className="w-4 h-4" />
                Accept Voice Call
              </button>
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

    </div>
  );
};
