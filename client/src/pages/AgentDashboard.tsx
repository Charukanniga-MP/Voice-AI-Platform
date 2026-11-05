import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { getSocket } from '../services/socket.js';
import { webrtcManager } from '../services/webrtc.js';
import { voiceService } from '../services/voice.js';
import { User, CallRecord, CallTranscript, KnowledgeEntry } from '../types.js';
import {
  PhoneCall, PhoneIncoming, PhoneOutgoing, PhoneOff, Mic, MicOff,
  Volume2, VolumeX, Clock, Search, BookOpen, Lock, MessageSquare, History, UserCheck
} from 'lucide-react';

export const AgentDashboard: React.FC = () => {
  const { user, token } = useAuth();

  // Navigation tab: 'console' | 'outgoing' | 'history' | 'knowledge'
  const [activeTab, setActiveTab] = useState<'console' | 'outgoing' | 'history' | 'knowledge'>('outgoing');

  // Active call state
  const [activeCall, setActiveCall] = useState<CallRecord | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [transcripts, setTranscripts] = useState<CallTranscript[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);

  // Incoming call notification modal
  const [incomingCall, setIncomingCall] = useState<{
    callId: string;
    customerId: string;
    customerName: string;
    customerPhone?: string;
    senderSocketId: string;
  } | null>(null);

  // Outgoing calls: Customer list and search
  const [customers, setCustomers] = useState<User[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<User | null>(null);
  const [loadingCustomers, setLoadingCustomers] = useState(false);

  // Call history
  const [callHistory, setCallHistory] = useState<CallRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Knowledge Base read-only search
  const [kbEntries, setKbEntries] = useState<KnowledgeEntry[]>([]);
  const [kbSearch, setKbSearch] = useState('');
  const [loadingKb, setLoadingKb] = useState(false);

  // Transcript auto-scroll
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  // Duration timer
  useEffect(() => {
    let timer: any;
    if (activeCall) {
      timer = setInterval(() => setCallDuration(prev => prev + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [activeCall]);

  // Fetch customers
  const fetchCustomers = async () => {
    if (!token) return;
    setLoadingCustomers(true);
    try {
      const res = await fetch(`/api/customers?search=${encodeURIComponent(customerSearch)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) setCustomers(data.customers || []);
    } catch (err) {
      console.error('Failed to fetch customers:', err);
    } finally {
      setLoadingCustomers(false);
    }
  };

  // Fetch call history
  const fetchHistory = async () => {
    if (!token) return;
    setLoadingHistory(true);
    try {
      const res = await fetch('/api/calls', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) setCallHistory(data.calls || []);
    } catch (err) {
      console.error('Failed to fetch calls:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  // Fetch Knowledge Base entries
  const fetchKnowledge = async () => {
    if (!token) return;
    setLoadingKb(true);
    try {
      const res = await fetch(`/api/knowledge?search=${encodeURIComponent(kbSearch)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) setKbEntries(data.entries || []);
    } catch (err) {
      console.error('Failed to fetch knowledge entries:', err);
    } finally {
      setLoadingKb(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, [token, customerSearch]);

  useEffect(() => {
    if (activeTab === 'history') fetchHistory();
    if (activeTab === 'knowledge') fetchKnowledge();
  }, [activeTab, kbSearch]);

  // Socket listener setup
  useEffect(() => {
    const socket = getSocket();

    // Outgoing call initiated response
    socket.on('agent:call:initiated', (data: { callId: string; callRecordId: string; customerName: string }) => {
      setActiveCall({
        id: data.callRecordId,
        callId: data.callId,
        customerName: data.customerName,
        type: 'agent_voice',
        direction: 'outgoing',
        status: 'active',
        startTime: new Date().toISOString(),
        duration: 0,
        transferred: false
      });
      setActiveTab('console');
      setCallDuration(0);
      setTranscripts([
        {
          id: 't_' + Date.now(),
          sender: 'system',
          senderName: 'System',
          text: `Outgoing voice call initiated to ${data.customerName}.`,
          timestamp: new Date().toISOString()
        }
      ]);
    });

    // Customer accepted call -> WebRTC audio connected
    socket.on('agent:call_connected', async (data: { callId: string; customerSocketId: string }) => {
      setTranscripts(prev => [
        ...prev,
        {
          id: 't_' + Date.now(),
          sender: 'system',
          senderName: 'System',
          text: 'Customer connected. Two-way voice audio active.',
          timestamp: new Date().toISOString()
        }
      ]);

      try {
        await webrtcManager.startCall(data.customerSocketId, data.callId);
        // Start listening to Agent voice for transcript
        voiceService.startListening((text, isFinal) => {
          if (isFinal && text.trim()) {
            socket.emit('call:live_speech', {
              callId: data.callId,
              sender: 'agent',
              senderName: user?.name || 'Agent',
              text: text.trim()
            });
          }
        });
      } catch (err) {
        console.error('Error starting WebRTC audio:', err);
      }
    });

    // Live transcript stream
    socket.on('call:live_transcript', (data: { sender: any; senderName: string; text: string; timestamp: string }) => {
      setTranscripts(prev => [
        ...prev,
        {
          id: 't_' + Date.now() + Math.random(),
          sender: data.sender,
          senderName: data.senderName,
          text: data.text,
          timestamp: data.timestamp
        }
      ]);
    });

    // Call ended
    socket.on('call:ended', () => {
      handleCallCleanup();
    });

    return () => {
      socket.off('agent:call:initiated');
      socket.off('agent:call_connected');
      socket.off('call:live_transcript');
      socket.off('call:ended');
    };
  }, [user]);

  // Initiate Outgoing Call
  const handleInitiateCall = async (customer: User) => {
    try {
      await webrtcManager.getMicrophoneStream();
      const socket = getSocket();
      socket.emit('agent:call:customer', {
        agentId: user?.id,
        agentName: user?.name,
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone
      });
    } catch (err) {
      alert('Microphone access is required to make calls. Please allow microphone permissions.');
    }
  };

  // End Call
  const handleEndCall = () => {
    if (activeCall) {
      const socket = getSocket();
      socket.emit('call:end', { callId: activeCall.callId, duration: callDuration });
    }
    handleCallCleanup();
  };

  const handleCallCleanup = () => {
    setActiveCall(null);
    setCallDuration(0);
    voiceService.stopListening();
    webrtcManager.endCall();
    fetchHistory();
  };

  // Format duration
  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-200 shadow-xs">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Support Agent Console</h1>
          <p className="text-xs text-slate-500 mt-1">
            Real-time customer voice management, outgoing calling, and knowledge reference.
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-2xl border border-slate-200 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('outgoing')}
            className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
              activeTab === 'outgoing' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Outgoing Calls
          </button>
          <button
            onClick={() => setActiveTab('console')}
            className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'console' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {activeCall && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />}
            Active Call
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
              activeTab === 'history' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Call History
          </button>
          <button
            onClick={() => setActiveTab('knowledge')}
            className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'knowledge' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 text-blue-600" />
            Knowledge Base
          </button>
        </div>
      </div>

      {/* 1. OUTGOING CALLS TAB */}
      {activeTab === 'outgoing' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 space-y-6 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Registered Customer Directory</h2>
              <p className="text-xs text-slate-500">Search and place bidirectional outgoing voice calls to customers.</p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search by name, email, phone..."
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-900"
              />
            </div>
          </div>

          {loadingCustomers ? (
            <div className="py-8 text-center text-xs text-slate-500">Loading customers...</div>
          ) : customers.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">No customers found.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {customers.map((c) => (
                <div key={c.id} className="p-5 rounded-2xl border border-slate-200 hover:border-blue-300 transition-all bg-slate-50/50 hover:bg-white hover:shadow-md space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm">
                      {c.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-800">{c.name}</h3>
                      <p className="text-xs text-slate-500">{c.email}</p>
                    </div>
                  </div>

                  <div className="text-xs text-slate-600 space-y-1">
                    <p><span className="font-semibold text-slate-400">Phone:</span> {c.phone || 'N/A'}</p>
                    <p><span className="font-semibold text-slate-400">Total Calls:</span> {c.totalCalls || 0}</p>
                  </div>

                  <button
                    onClick={() => handleInitiateCall(c)}
                    disabled={!!activeCall}
                    className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
                  >
                    <PhoneOutgoing className="w-3.5 h-3.5" />
                    Initiate Voice Call
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 2. ACTIVE CALL CONSOLE */}
      {activeTab === 'console' && (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
          {!activeCall ? (
            <div className="p-12 text-center text-slate-400 space-y-3">
              <PhoneOff className="w-12 h-12 mx-auto stroke-1 text-slate-300" />
              <h3 className="text-base font-bold text-slate-700">No Call Currently Active</h3>
              <p className="text-xs max-w-sm mx-auto">
                Select a customer from the Outgoing Calls tab to initiate a voice call, or wait for an incoming customer call.
              </p>
            </div>
          ) : (
            <div>
              {/* Call Top Bar */}
              <div className="p-6 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center text-white">
                    <PhoneCall className="w-6 h-6 animate-pulse" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold">{activeCall.customerName}</h2>
                    <p className="text-xs text-slate-400">Active Two-Way Voice Call ({activeCall.type})</p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="px-3.5 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-xs font-mono font-bold flex items-center gap-2">
                    <Clock className="w-4 h-4 text-slate-400" />
                    {formatDuration(callDuration)}
                  </div>

                  <button
                    onClick={handleEndCall}
                    className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-md cursor-pointer transition-colors"
                  >
                    <PhoneOff className="w-4 h-4" />
                    End Call
                  </button>
                </div>
              </div>

              {/* Call Controls Bar */}
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      const muted = webrtcManager.toggleMute();
                      setIsMuted(muted);
                    }}
                    className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                      isMuted ? 'bg-red-50 text-red-600 border-red-200' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
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
                      className="w-20 accent-blue-600 cursor-pointer"
                    />
                  </div>
                </div>

                <span className="text-xs font-medium text-emerald-600 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Live Audio Stream Active
                </span>
              </div>

              {/* Live Transcript Area */}
              <div className="p-6">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">
                  Live Conversation Transcript
                </h3>
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 h-80 overflow-y-auto space-y-3">
                  {transcripts.map((t) => (
                    <div key={t.id} className="text-xs">
                      <span className="font-semibold text-slate-500 block mb-0.5">
                        {t.senderName || t.sender}:
                      </span>
                      <p className="bg-white p-2.5 rounded-xl border border-slate-200/80 text-slate-800 shadow-2xs">
                        {t.text}
                      </p>
                    </div>
                  ))}
                  <div ref={transcriptEndRef} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3. CALL HISTORY TAB */}
      {activeTab === 'history' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 space-y-4 shadow-xs">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">Handled Call Records</h2>
            <button
              onClick={fetchHistory}
              className="text-xs font-semibold text-blue-600 hover:underline cursor-pointer"
            >
              Refresh
            </button>
          </div>

          {loadingHistory ? (
            <div className="py-8 text-center text-xs text-slate-500">Loading call records...</div>
          ) : callHistory.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">No calls recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 text-slate-700 uppercase font-bold text-[10px] tracking-wider border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">Date & Time</th>
                    <th className="py-3 px-4">Customer</th>
                    <th className="py-3 px-4">Direction</th>
                    <th className="py-3 px-4">Duration</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {callHistory.map((call) => (
                    <tr key={call.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-4 font-medium text-slate-800">
                        {new Date(call.startTime).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-800">
                        {call.customerName}
                      </td>
                      <td className="py-3 px-4 capitalize">{call.direction}</td>
                      <td className="py-3 px-4 font-mono font-medium">{formatDuration(call.duration)}</td>
                      <td className="py-3 px-4 capitalize">{call.type.replace('_', ' ')}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${
                          call.status === 'completed'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-slate-100 text-slate-700'
                        }`}>
                          {call.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 4. KNOWLEDGE BASE TAB (STRICT READ-ONLY RESTRICTIONS FOR AGENT) */}
      {activeTab === 'knowledge' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 space-y-6 shadow-xs">
          {/* Agent Restriction Notice */}
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3 text-xs text-amber-800">
            <Lock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Read-Only Knowledge Access</p>
              <p className="text-amber-700 mt-0.5">
                Support Agents can search and view company knowledge to assist customers. Adding, editing, deleting entries, or uploading documents is strictly restricted to Administrators.
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Official Company Knowledge Base</h2>
              <p className="text-xs text-slate-500">Search approved policies, plans, and answers for customer support.</p>
            </div>
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search approved knowledge..."
                value={kbSearch}
                onChange={(e) => setKbSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-900"
              />
            </div>
          </div>

          {loadingKb ? (
            <div className="py-8 text-center text-xs text-slate-500">Searching knowledge base...</div>
          ) : kbEntries.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">No knowledge entries found matching search.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {kbEntries.map((entry) => (
                <div key={entry.id} className="p-5 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-800">{entry.title}</h3>
                    <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-semibold uppercase">
                      {entry.category}
                    </span>
                  </div>
                  {entry.question && (
                    <p className="text-xs font-semibold text-slate-700">Q: {entry.question}</p>
                  )}
                  {entry.answer && (
                    <p className="text-xs text-slate-600 bg-white p-3 rounded-xl border border-slate-200">
                      A: {entry.answer}
                    </p>
                  )}
                  <p className="text-xs text-slate-500 leading-relaxed">{entry.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

