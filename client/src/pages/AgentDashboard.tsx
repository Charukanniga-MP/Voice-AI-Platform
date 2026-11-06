import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { getSocket } from '../services/socket.js';
import { telephonyVoiceManager, TelephonyCallState } from '../services/telephonyVoice.js';
import { User, CallRecord, KnowledgeEntry } from '../types.js';
import {
  PhoneCall, PhoneOutgoing, PhoneOff, Mic, MicOff,
  Volume2, VolumeX, Clock, Search, BookOpen, Lock,
  Smartphone, AlertCircle, CheckCircle2, Radio, Info, X
} from 'lucide-react';

interface LogEntry {
  id: string;
  sender: 'system' | 'agent' | 'customer';
  senderName: string;
  text: string;
  timestamp: string;
}

export const AgentDashboard: React.FC = () => {
  const { user, token } = useAuth();

  // Navigation tab: 'outgoing' | 'console' | 'history' | 'knowledge'
  const [activeTab, setActiveTab] = useState<'outgoing' | 'console' | 'history' | 'knowledge'>('outgoing');

  // Provider configuration status
  const [providerStatus, setProviderStatus] = useState<{
    configured: boolean;
    provider: string;
    callerId?: string;
    message?: string;
  } | null>(null);

  // Active call state
  const [activeCall, setActiveCall] = useState<{
    callId: string;
    callRecordId?: string;
    customerName: string;
    customerPhone: string;
    customerId?: string;
    state: TelephonyCallState;
    statusText: string;
  } | null>(null);

  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [callError, setCallError] = useState<string | null>(null);

  // Outgoing calls: Customer list and search
  const [customers, setCustomers] = useState<User[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [loadingCustomers, setLoadingCustomers] = useState(false);

  // Dial confirmation modal state
  const [dialTarget, setDialTarget] = useState<{
    customer?: User;
    name: string;
    phone: string;
  } | null>(null);

  // Direct manual dial input state
  const [manualName, setManualName] = useState('');
  const [manualPhone, setManualPhone] = useState('');

  // Call history
  const [callHistory, setCallHistory] = useState<CallRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Knowledge Base read-only search
  const [kbEntries, setKbEntries] = useState<KnowledgeEntry[]>([]);
  const [kbSearch, setKbSearch] = useState('');
  const [loadingKb, setLoadingKb] = useState(false);

  // Log auto-scroll
  const logEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Check telephony provider status on load
  const checkStatus = async () => {
    const status = await telephonyVoiceManager.checkProviderStatus();
    setProviderStatus(status);
  };

  useEffect(() => {
    checkStatus();
  }, []);

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

  // Socket listener for backend status updates
  useEffect(() => {
    const socket = getSocket();

    const onStatusUpdate = (data: { callSid: string; status: string; duration?: number }) => {
      if (activeCall) {
        addLog('system', `Telephony Provider Event: Status updated to "${data.status}".`);
      }
    };

    socket.on('telephony:status_update', onStatusUpdate);
    return () => {
      socket.off('telephony:status_update', onStatusUpdate);
    };
  }, [activeCall]);

  const addLog = (sender: 'system' | 'agent' | 'customer', text: string) => {
    setLogs(prev => [
      ...prev,
      {
        id: 'log_' + Date.now() + Math.random(),
        sender,
        senderName: sender === 'agent' ? (user?.name || 'Agent') : sender === 'customer' ? (activeCall?.customerName || 'Customer') : 'System',
        text,
        timestamp: new Date().toLocaleTimeString()
      }
    ]);
  };

  // Open dial modal for selected registered customer
  const handleSelectCustomerToCall = (customer: User) => {
    setDialTarget({
      customer,
      name: customer.name,
      phone: customer.phone || ''
    });
  };

  // Initiate Outbound Real Telephone Call
  const handleStartCall = async (targetName: string, targetPhone: string, customerId?: string) => {
    if (!targetPhone.trim()) {
      alert('Please provide a valid destination mobile phone number.');
      return;
    }

    setDialTarget(null);
    setCallError(null);
    setCallDuration(0);
    setIsMuted(false);

    const callInitId = 'call_' + Date.now();
    setActiveCall({
      callId: callInitId,
      customerName: targetName,
      customerPhone: targetPhone,
      customerId,
      state: 'initiating',
      statusText: `Preparing outbound call to ${targetName} (${targetPhone})...`
    });

    setLogs([
      {
        id: 'log_0',
        sender: 'system',
        senderName: 'System',
        text: `Support Agent ${user?.name || 'Agent'} is placing an outbound telephone call to ${targetName} at ${targetPhone}.`,
        timestamp: new Date().toLocaleTimeString()
      }
    ]);

    setActiveTab('console');

    // 1. Pre-register call in backend database
    let registeredCallRecordId: string | undefined;
    try {
      const regRes = await fetch('/api/telephony/register-call', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          customerId: customerId || null,
          customerName: targetName,
          customerPhone: targetPhone
        })
      });

      const regData = await regRes.json();
      if (regRes.ok && regData.callRecord) {
        registeredCallRecordId = regData.callRecord.id;
        setActiveCall(prev => prev ? { ...prev, callRecordId: registeredCallRecordId, callId: regData.callRecord.callId } : null);
      }
    } catch (err) {
      console.warn('Could not pre-register call record in DB:', err);
    }

    // 2. Place call via Twilio Voice SDK
    await telephonyVoiceManager.makeCall(
      targetPhone,
      targetName,
      token || '',
      user?.id || '',
      {
        onStateChange: (state: TelephonyCallState, message?: string) => {
          setActiveCall(prev => prev ? {
            ...prev,
            state,
            statusText: message || state
          } : null);

          if (message) {
            addLog('system', message);
          }

          if (state === 'ended' || state === 'failed') {
            // Log completion with duration in backend
            if (token) {
              fetch('/api/telephony/end-call', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                  callId: registeredCallRecordId || callInitId,
                  duration: telephonyVoiceManager.getDurationSeconds(),
                  failureReason: state === 'failed' ? (message || 'Call failed') : null
                })
              }).catch(() => {});
            }
          }
        },
        onError: (err: string) => {
          setCallError(err);
          addLog('system', `Error: ${err}`);
        },
        onDurationTick: (sec: number) => {
          setCallDuration(sec);
        }
      }
    );
  };

  // End Call
  const handleEndCall = () => {
    telephonyVoiceManager.endCall();
    if (activeCall && token) {
      fetch('/api/telephony/end-call', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          callId: activeCall.callRecordId || activeCall.callId,
          duration: callDuration
        })
      }).catch(() => {});
    }
    setActiveCall(prev => prev ? { ...prev, state: 'ended', statusText: 'Call ended by agent.' } : null);
    addLog('system', 'Call hung up by agent.');
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
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Support Agent Console</h1>
            {providerStatus?.configured ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Telephony Provider: Active ({providerStatus.provider.toUpperCase()})
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                <Radio className="w-3 h-3 text-amber-600" />
                Telephony Provider: Setup Needed
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Browser-to-mobile outbound calling to customer mobile phones, live audio console, and knowledge reference.
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
            {activeCall && activeCall.state === 'connected' && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            )}
            Active Call {activeCall && activeCall.state !== 'ended' && activeCall.state !== 'failed' ? '(Live)' : ''}
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

      {/* Setup Guide Banner if provider credentials are not configured yet */}
      {providerStatus && !providerStatus.configured && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-4 text-xs text-blue-900 flex items-start gap-3 shadow-xs">
          <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold">Telephony Provider Credentials Setup</p>
            <p className="text-blue-800 leading-relaxed">
              To place real telephone calls that ring on customers' actual mobile phones, configure your provider in{' '}
              <code className="bg-white px-1.5 py-0.5 rounded border border-blue-200 font-mono text-blue-900">server/.env</code>:
              <br />
              <code className="bg-white/80 px-2 py-1 rounded inline-block mt-1 font-mono text-[11px] text-slate-800 border border-blue-100">
                TWILIO_ACCOUNT_SID=your_account_sid &nbsp; TWILIO_AUTH_TOKEN=your_token &nbsp; TWILIO_TWIML_APP_SID=your_twiml_app &nbsp; TWILIO_CALLER_ID=+1...
              </code>
            </p>
          </div>
        </div>
      )}

      {/* 1. OUTGOING CALLS TAB */}
      {activeTab === 'outgoing' && (
        <div className="space-y-6">
          {/* Direct Dial Any Phone Number Card */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-blue-600" />
                  Quick Outbound Dial to Any Mobile Phone
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Dial any customer or personal mobile number directly. The customer's mobile phone will ring over the telephone network.
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                  Recipient Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. John Doe or Test Customer"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-900"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                  Mobile Phone Number (E.164 with Country Code)
                </label>
                <input
                  type="tel"
                  placeholder="e.g. +919876543210 or +14155552671"
                  value={manualPhone}
                  onChange={(e) => setManualPhone(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-900 font-mono"
                />
              </div>

              <div className="flex items-end">
                <button
                  onClick={() => {
                    if (!manualPhone.trim()) {
                      alert('Please enter a mobile phone number.');
                      return;
                    }
                    handleStartCall(manualName.trim() || 'Mobile Customer', manualPhone.trim());
                  }}
                  disabled={!manualPhone.trim() || Boolean(activeCall && (activeCall.state === 'ringing' || activeCall.state === 'connected'))}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
                >
                  <PhoneOutgoing className="w-4 h-4" />
                  Dial Mobile Phone
                </button>
              </div>
            </div>
          </div>

          {/* Registered Customer Directory */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 space-y-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Registered Customer Directory</h2>
                <p className="text-xs text-slate-500">
                  Select a registered customer to place an outbound telephone call to their verified phone number.
                </p>
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
              <div className="py-8 text-center text-xs text-slate-400">No registered customers found.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {customers.map((c) => (
                  <div key={c.id} className="p-5 rounded-2xl border border-slate-200 hover:border-blue-300 transition-all bg-slate-50/50 hover:bg-white hover:shadow-md space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm">
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="overflow-hidden">
                        <h3 className="text-sm font-bold text-slate-800 truncate">{c.name}</h3>
                        <p className="text-xs text-slate-500 truncate">{c.email}</p>
                      </div>
                    </div>

                    <div className="text-xs text-slate-600 space-y-1">
                      <p className="flex items-center gap-1.5">
                        <Smartphone className="w-3.5 h-3.5 text-slate-400" />
                        <span className="font-semibold text-slate-700 font-mono">{c.phone || 'No phone registered'}</span>
                      </p>
                      <p className="text-[11px] text-slate-400">Total Calls: {c.totalCalls || 0}</p>
                    </div>

                    <button
                      onClick={() => handleSelectCustomerToCall(c)}
                      disabled={!c.phone || Boolean(activeCall && (activeCall.state === 'ringing' || activeCall.state === 'connected'))}
                      className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 transition-colors shadow-xs cursor-pointer"
                    >
                      <PhoneOutgoing className="w-3.5 h-3.5" />
                      Initiate Voice Call
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. ACTIVE CALL CONSOLE */}
      {activeTab === 'console' && (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
          {!activeCall ? (
            <div className="p-16 text-center text-slate-400 space-y-3">
              <PhoneOff className="w-12 h-12 mx-auto stroke-1 text-slate-300" />
              <h3 className="text-base font-bold text-slate-700">No Call Currently Active</h3>
              <p className="text-xs max-w-sm mx-auto">
                Select a customer from the Outgoing Calls tab or use Quick Outbound Dial to initiate a telephone call.
              </p>
              <button
                onClick={() => setActiveTab('outgoing')}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl cursor-pointer shadow-xs"
              >
                Go to Outgoing Calls
              </button>
            </div>
          ) : (
            <div>
              {/* Call Top Banner */}
              <div className="p-6 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white ${
                    activeCall.state === 'connected' ? 'bg-emerald-600 animate-pulse' :
                    activeCall.state === 'ringing' ? 'bg-amber-600 animate-bounce' :
                    activeCall.state === 'failed' ? 'bg-red-600' : 'bg-blue-600'
                  }`}>
                    {activeCall.state === 'connected' ? <PhoneCall className="w-6 h-6" /> :
                     activeCall.state === 'ringing' ? <Smartphone className="w-6 h-6" /> :
                     activeCall.state === 'failed' ? <PhoneOff className="w-6 h-6" /> :
                     <Radio className="w-6 h-6 animate-pulse" />}
                  </div>
                  <div>
                    <h2 className="text-base font-bold">{activeCall.customerName}</h2>
                    <p className="text-xs text-slate-300 font-mono flex items-center gap-2">
                      <span>{activeCall.customerPhone}</span>
                      <span className="text-slate-500">•</span>
                      <span className="text-blue-400 font-sans">Real Telephone (PSTN / Mobile)</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {/* Status Badge */}
                  <span className={`px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${
                    activeCall.state === 'connected' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                    activeCall.state === 'ringing' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                    activeCall.state === 'failed' ? 'bg-red-500/20 text-red-300 border border-red-500/30' :
                    'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                  }`}>
                    <span className={`w-2 h-2 rounded-full ${
                      activeCall.state === 'connected' ? 'bg-emerald-400 animate-ping' :
                      activeCall.state === 'ringing' ? 'bg-amber-400 animate-ping' :
                      activeCall.state === 'failed' ? 'bg-red-400' : 'bg-blue-400 animate-pulse'
                    }`} />
                    {activeCall.state.replace('_', ' ')}
                  </span>

                  {/* Duration */}
                  <div className="px-3.5 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-xs font-mono font-bold flex items-center gap-2">
                    <Clock className="w-4 h-4 text-slate-400" />
                    {formatDuration(callDuration)}
                  </div>

                  {/* End Call / Reset Button */}
                  {activeCall.state !== 'ended' && activeCall.state !== 'failed' ? (
                    <button
                      onClick={handleEndCall}
                      className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-md cursor-pointer transition-colors"
                    >
                      <PhoneOff className="w-4 h-4" />
                      End Call
                    </button>
                  ) : (
                    <button
                      onClick={() => setActiveCall(null)}
                      className="flex items-center gap-1.5 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-xs font-bold cursor-pointer transition-colors"
                    >
                      Close Session
                    </button>
                  )}
                </div>
              </div>

              {/* Status Bar */}
              <div className="p-3 bg-slate-100 border-b border-slate-200 text-xs flex items-center justify-between text-slate-700">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900">Call Status:</span>
                  <span className="text-slate-600">{activeCall.statusText}</span>
                </div>
                {activeCall.state === 'ringing' && (
                  <span className="text-amber-700 font-semibold animate-pulse">
                    Waiting for customer to answer mobile phone...
                  </span>
                )}
                {activeCall.state === 'connected' && (
                  <span className="text-emerald-700 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Two-Way Audio Bridged (Laptop &harr; Mobile Phone)
                  </span>
                )}
              </div>

              {/* Error Alert if any */}
              {callError && (
                <div className="p-4 bg-red-50 border-b border-red-200 text-xs text-red-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">Call Connection Alert</p>
                    <p>{callError}</p>
                  </div>
                </div>
              )}

              {/* Call Controls Bar */}
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  {/* Mute Button */}
                  <button
                    onClick={() => {
                      const muted = telephonyVoiceManager.toggleMute();
                      setIsMuted(muted);
                      addLog('agent', muted ? 'Agent muted microphone.' : 'Agent unmuted microphone.');
                    }}
                    disabled={activeCall.state !== 'connected'}
                    className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 ${
                      isMuted ? 'bg-red-50 text-red-600 border-red-200' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4 text-emerald-600" />}
                    {isMuted ? 'Unmute Mic' : 'Mute Mic'}
                  </button>

                  {/* Speaker Output Volume */}
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
                        telephonyVoiceManager.setVolume(val);
                      }}
                      className="w-20 accent-blue-600 cursor-pointer"
                    />
                  </div>
                </div>

                <div className="text-xs text-slate-500 flex items-center gap-2">
                  <span>Using Laptop Microphone & Headset</span>
                </div>
              </div>

              {/* Call Event Log */}
              <div className="p-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Call Lifecycle & Audio Activity Log
                  </h3>
                  <span className="text-[11px] text-slate-400">
                    Logged in Database & Accessible in Admin Monitoring
                  </span>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 h-80 overflow-y-auto space-y-3">
                  {logs.map((log) => (
                    <div key={log.id} className="text-xs space-y-1">
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span className="font-semibold text-slate-600">{log.senderName}</span>
                        <span>{log.timestamp}</span>
                      </div>
                      <p className={`p-2.5 rounded-xl border text-slate-800 ${
                        log.sender === 'agent' ? 'bg-blue-50/70 border-blue-200 text-blue-900' :
                        log.sender === 'system' ? 'bg-white border-slate-200 text-slate-700' :
                        'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                      }`}>
                        {log.text}
                      </p>
                    </div>
                  ))}
                  <div ref={logEndRef} />
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
            <div>
              <h2 className="text-lg font-bold text-slate-900">Handled Outbound Call Records</h2>
              <p className="text-xs text-slate-500">History of customer telephone calls and duration.</p>
            </div>
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
                    <th className="py-3 px-4">Destination Phone</th>
                    <th className="py-3 px-4">Channel / Type</th>
                    <th className="py-3 px-4">Duration</th>
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
                      <td className="py-3 px-4 font-mono text-slate-600">
                        {call.customerPhone || 'N/A'}
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                          {call.providerName === 'twilio' ? 'Telephone (PSTN)' : 'Voice Call'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono font-medium">{formatDuration(call.duration)}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${
                          call.status === 'completed'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : call.status === 'active'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'bg-red-50 text-red-700 border border-red-200'
                        }`}>
                          {call.status}
                          {call.failureReason ? ` (${call.failureReason})` : ''}
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

      {/* 4. KNOWLEDGE BASE TAB (READ-ONLY FOR AGENT) */}
      {activeTab === 'knowledge' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 space-y-6 shadow-xs">
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

      {/* DIAL CONFIRMATION MODAL */}
      {dialTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-slate-900 text-sm">Initiate Telephone Voice Call</h3>
              </div>
              <button onClick={() => setDialTarget(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Customer Name</label>
                <input
                  type="text"
                  value={dialTarget.name}
                  onChange={(e) => setDialTarget({ ...dialTarget, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900 bg-slate-50"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Customer Phone Number (E.164 Format)
                </label>
                <input
                  type="tel"
                  value={dialTarget.phone}
                  onChange={(e) => setDialTarget({ ...dialTarget, phone: e.target.value })}
                  placeholder="+919876543210"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900 font-mono"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Include country code (e.g. +91 for India, +1 for US/Canada).
                </p>
              </div>

              <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl text-[11px] text-blue-800 space-y-1">
                <p className="font-bold">Real Telephone Call Behavior:</p>
                <p>1. You will use your laptop microphone and headphones.</p>
                <p>2. The customer's physical mobile phone will ring.</p>
                <p>3. Two-way telephone audio is bridged automatically when answered.</p>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDialTarget(null)}
                className="flex-1 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleStartCall(dialTarget.name, dialTarget.phone, dialTarget.customer?.id)}
                className="flex-1 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs cursor-pointer flex items-center justify-center gap-1.5"
              >
                <PhoneOutgoing className="w-3.5 h-3.5" />
                Place Call
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
