import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { getSocket, registerSocketUser } from '../services/socket.js';
import { telephonyVoiceManager, TelephonyCallState } from '../services/telephonyVoice.js';
import { webrtcManager } from '../services/webrtc.js';
import { voiceService } from '../services/voice.js';
import { ringtoneService } from '../services/ringtone.js';
import { SupportTickets } from './SupportTickets.js';
import { FollowUpTasksManager } from '../components/FollowUpTasksManager.js';
import { CustomerProfileModal } from '../components/CustomerProfileModal.js';
import { CallIntelligenceModal } from '../components/CallIntelligenceModal.js';
import { CallQualityIndicator } from '../components/CallQualityIndicator.js';
import { AudioDeviceModal } from '../components/AudioDeviceModal.js';
import { audioDeviceManager } from '../services/audioDevice.js';
import { User, CallRecord, KnowledgeEntry, LanguageCode, SUPPORTED_LANGUAGES } from '../types.js';
import {
  PhoneCall, PhoneOutgoing, PhoneOff, Mic, MicOff, Grid3X3, MoreHorizontal,
  Volume2, VolumeX, Clock, Search, BookOpen,
  Smartphone, AlertCircle, CheckCircle2, Radio, Info,
  Globe, Sparkles, MessageSquare, Pause, Play, Send, Copy, Users, Settings, ListTodo,
  HeartPulse, Flame, Mail, Phone
} from 'lucide-react';
import { SentimentBadge } from '../components/SentimentBadge.js';
import { LiveSentimentCard } from '../components/LiveSentimentCard.js';
import { PostCallSentimentSummary } from '../components/PostCallSentimentSummary.js';
import { SentimentType } from '../types.js';

interface LogEntry {
  id: string;
  sender: 'system' | 'agent' | 'customer';
  senderName: string;
  text: string;
  translation?: string;
  timestamp: string;
}

interface IncomingCall {
  callId: string;
  callRecordId?: string;
  customerId?: string;
  customerName: string;
  customerEmail?: string;
  customerPhone: string;
  preferredLanguage: string;
  languageName: string;
  customerSocketId: string;
  startTime: number;
}

export const AgentDashboard: React.FC = () => {
  const { user, token } = useAuth();



  // Navigation tab: 'incoming' | 'outgoing' | 'console' | 'history' | 'knowledge' | 'tickets' | 'tasks'
  const [activeTab, setActiveTab] = useState<'incoming' | 'outgoing' | 'console' | 'history' | 'knowledge' | 'tickets' | 'tasks'>('outgoing');

  // Customer Profile & Call Intelligence modals
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedCallIdForIntel, setSelectedCallIdForIntel] = useState<string | null>(null);

  // Agent Availability & Supported Languages
  const [agentStatus, setAgentStatus] = useState<'available' | 'busy'>(
    (user?.agentStatus as 'available' | 'busy') || 'available'
  );

  const [supportedLanguages, setSupportedLanguages] = useState<string[]>(
    user?.supportedLanguages ? user.supportedLanguages.split(',') : ['en', 'ta', 'te', 'ml', 'hi']
  );

  // Incoming call state & ringing
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [incomingRingSec, setIncomingRingSec] = useState(0);

  // Live waiting queue count
  const [queueCount, setQueueCount] = useState<number>(0);

  // Telephony provider configuration status
  const [providerStatus, setProviderStatus] = useState<{
    configured: boolean;
    provider: string;
    callerId?: string;
    message?: string;
  } | null>(null);

  // Active call state (Supports both WebRTC incoming support calls and Outgoing PSTN calls)
  const [activeCall, setActiveCall] = useState<{
    callId: string;
    callRecordId?: string;
    customerName: string;
    customerEmail?: string;
    customerPhone: string;
    customerId?: string;
    preferredLanguage?: string;
    isIncomingSupport?: boolean;
    state: TelephonyCallState | 'ringing' | 'connected' | 'on_hold';
    statusText: string;
  } | null>(null);

  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [isKeypadOpen, setIsKeypadOpen] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [dtmfInput, setDtmfInput] = useState('');
  const [lastEndedCall, setLastEndedCall] = useState<{ name: string; phone: string } | null>(null);
  const previousVolumeRef = useRef(1);
  const [isCallHeld, setIsCallHeld] = useState(false);
  const [callNotes, setCallNotes] = useState('');
  const [notesSaved, setNotesSaved] = useState(false);

  // Live logs / transcript
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [callError, setCallError] = useState<string | null>(null);
  const [showAudioDeviceModal, setShowAudioDeviceModal] = useState(false);


  // Sentiment Analysis State
  const [liveSentiment, setLiveSentiment] = useState<{
    sentiment: SentimentType;
    confidenceScore: number;
    reason: string;
    triggerText: string;
    requiresHumanAssistance: boolean;
  } | null>(null);

  const [assistanceAlert, setAssistanceAlert] = useState<{
    callId: string;
    customerName: string;
    customerPhone: string;
    reason: string;
    triggerText: string;
    priority: string;
  } | null>(null);


  // Embedded Knowledge Base Copilot
  const [copilotSearch, setCopilotSearch] = useState('');
  const [copilotSuggestion, setCopilotSuggestion] = useState<{
    query: string;
    answer: string;
    sources: any[];
    isGrounded: boolean;
    language: string;
  } | null>(null);
  const [copilotLoading, setCopilotLoading] = useState(false);

  // Outgoing calls: Customer list and search
  const [customers, setCustomers] = useState<User[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [loadingCustomers, setLoadingCustomers] = useState(false);

  // Direct manual dial input state
  const [manualName, setManualName] = useState('');
  const [manualPhone, setManualPhone] = useState('');

  // Call history
  const [callHistory, setCallHistory] = useState<CallRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Knowledge Base tab search
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
    const status = await telephonyVoiceManager.checkProviderStatus(token || undefined);
    setProviderStatus(status);
  };

  useEffect(() => {
    checkStatus();
  }, []);

  // Sync Agent Availability Toggle
  const handleToggleStatus = async () => {
    const nextStatus = agentStatus === 'available' ? 'busy' : 'available';
    setAgentStatus(nextStatus);

    const socket = getSocket();
    socket.emit('agent:status_toggle', { agentStatus: nextStatus });

    if (token) {
      try {
        await fetch('/api/auth/preferences', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ agentStatus: nextStatus })
        });
      } catch (err) {
        console.warn('Could not save agent status:', err);
      }
    }
  };

  // Sync Supported Languages
  const handleToggleLanguage = async (code: string) => {
    let next: string[];
    if (supportedLanguages.includes(code)) {
      if (supportedLanguages.length === 1) return; // Must have at least 1 language
      next = supportedLanguages.filter(l => l !== code);
    } else {
      next = [...supportedLanguages, code];
    }
    setSupportedLanguages(next);

    const socket = getSocket();
    socket.emit('agent:languages_update', { supportedLanguages: next });

    if (token) {
      try {
        await fetch('/api/auth/preferences', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ supportedLanguages: next })
        });
      } catch (err) {
        console.warn('Could not save agent languages:', err);
      }
    }
  };

  // Incoming call ringing timer
  useEffect(() => {
    let interval: any;
    if (incomingCall) {
      interval = setInterval(() => {
        setIncomingRingSec(Math.floor((Date.now() - incomingCall.startTime) / 1000));
      }, 1000);
    } else {
      setIncomingRingSec(0);
    }
    return () => clearInterval(interval);
  }, [incomingCall]);

  // Live Call Duration timer (Unlimited duration)
  useEffect(() => {
    let timer: any;
    if (activeCall && (activeCall.state === 'connected' || activeCall.state === 'on_hold')) {
      timer = setInterval(() => setCallDuration(prev => prev + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [activeCall]);

  // Socket event listeners for incoming support calls and queue
  useEffect(() => {
    const socket = getSocket();

    // 1. Incoming Call Notification
    socket.on('agent:incoming_call', (data: IncomingCall) => {
      console.log('[Agent] Incoming call from customer:', data.customerName, data.preferredLanguage);
      setIncomingCall(data);
      // Play synthetic ringtone audio & trigger desktop notification
      ringtoneService.start(data.customerName);
    });

    // 2. Incoming Call Missed / Cancelled
    socket.on('agent:call_missed', (data: { callId: string }) => {
      if (incomingCall?.callId === data.callId) {
        ringtoneService.stop();
        setIncomingCall(null);
      }
    });

    // 3. Queue update
    socket.on('queue:status_updated', (data: { queueLength: number }) => {
      setQueueCount(data.queueLength || 0);
    });

    // 4. Live speech transcript relay (Multilingual with deduplication)
    socket.on('call:live_transcript', (data: {
      sender: any;
      senderName: string;
      text: string;
      translation?: string;
      language?: string;
      timestamp: string;
    }) => {
      setLogs(prev => {
        const isDuplicate = prev.some(l =>
          l.sender === data.sender &&
          l.text.trim().toLowerCase() === data.text.trim().toLowerCase()
        );
        if (isDuplicate) return prev;
        return [
          ...prev,
          {
            id: 'log_' + Date.now() + Math.random(),
            sender: data.sender,
            senderName: data.senderName,
            text: data.text,
            translation: data.translation,
            timestamp: new Date().toLocaleTimeString()
          }
        ];
      });
    });

    // 5. AI Knowledge Base Answer Suggestion
    socket.on('call:kb_suggestion', (data: {
      callId: string;
      query: string;
      answer: string;
      sources: any[];
      isGrounded: boolean;
      language: string;
    }) => {
      setCopilotLoading(false);
      setCopilotSuggestion({
        query: data.query,
        answer: data.answer,
        sources: data.sources || [],
        isGrounded: data.isGrounded,
        language: data.language
      });
    });

    // 6. Call ended by customer or system
    socket.on('call:ended', (data: { callId: string; duration?: number }) => {
      if (activeCall && activeCall.callId === data.callId) {
        cleanupActiveCall();
        fetchHistory();
      }
    });


    // 7. Live Customer Sentiment Update
    const handleSentimentUpdate = (data: any) => {
      setLiveSentiment(data);
    };
    socket.on('call:sentiment_update', handleSentimentUpdate);

    // 8. Human Assistance Recommendation Alert
    const handleAssistanceAlert = (data: any) => {
      setAssistanceAlert(data);
    };
    socket.on('sentiment:assistance_alert', handleAssistanceAlert);

    // 9. Automatic call reconnection updates

    socket.on('call:reconnecting', (data: { callId: string; attempt: number; maxAttempts: number }) => {
      setLogs(prev => [
        ...prev,
        {
          id: 'recon_' + Date.now(),
          sender: 'system',
          senderName: 'System',
          text: `⚠️ Network connection interrupted. Attempting automatic reconnection (${data.attempt}/${data.maxAttempts})...`,
          timestamp: new Date().toLocaleTimeString()
        }
      ]);
    });

    socket.on('call:reconnected', () => {
      setLogs(prev => [
        ...prev,
        {
          id: 'recon_ok_' + Date.now(),
          sender: 'system',
          senderName: 'System',
          text: `✅ Network connection restored. Voice stream resumed.`,
          timestamp: new Date().toLocaleTimeString()
        }
      ]);
    });

    socket.on('call:reconnect_failed', (data: { reason: string }) => {
      setLogs(prev => [
        ...prev,
        {
          id: 'recon_fail_' + Date.now(),
          sender: 'system',
          senderName: 'System',
          text: `❌ Automatic reconnection failed: ${data.reason}.`,
          timestamp: new Date().toLocaleTimeString()
        }
      ]);
    });

    return () => {
      socket.off('agent:incoming_call');
      socket.off('agent:call_missed');
      socket.off('queue:status_updated');
      socket.off('call:live_transcript');
      socket.off('call:kb_suggestion');
      socket.off('call:ended');
      socket.off('call:sentiment_update', handleSentimentUpdate);
      socket.off('sentiment:assistance_alert', handleAssistanceAlert);
      socket.off('call:reconnecting');
      socket.off('call:reconnected');
      socket.off('call:reconnect_failed');
    };
  }, [incomingCall, activeCall]);

  // WebRTC Manager Callback Hooks
  useEffect(() => {
    webrtcManager.setCallbacks({
      onReconnecting: (attempt, max) => {
        setLogs(prev => [
          ...prev,
          {
            id: 'webrtc_recon_' + Date.now(),
            sender: 'system',
            senderName: 'System',
            text: `⚠️ WebRTC audio link interrupted. Auto-reconnecting (${attempt}/${max})...`,
            timestamp: new Date().toLocaleTimeString()
          }
        ]);
      },
      onReconnected: () => {
        setLogs(prev => [
          ...prev,
          {
            id: 'webrtc_recon_ok_' + Date.now(),
            sender: 'system',
            senderName: 'System',
            text: `✅ WebRTC audio link re-established.`,
            timestamp: new Date().toLocaleTimeString()
          }
        ]);
      }
    });
  }, []);

  // Accept Incoming Customer Call
  const handleAcceptIncomingCall = async () => {
    if (!incomingCall) return;

    // Check microphone permission before accepting
    const hasMic = await audioDeviceManager.ensureMicrophoneAccess();
    if (!hasMic) {
      setShowAudioDeviceModal(true);
      return;
    }

    // Stop ringtone immediately
    ringtoneService.stop();
    webrtcManager.unlockAudio();

    const selectedCall = incomingCall;
    setIncomingCall(null);
    setLastEndedCall(null);
    setCallDuration(0);
    setIsMuted(false);
    setIsSpeakerOn(true);
    setIsKeypadOpen(false);
    setIsMoreOpen(false);
    setDtmfInput('');
    setIsCallHeld(false);
    setCallNotes('');
    setCopilotSuggestion(null);

    setActiveCall({
      callId: selectedCall.callId,
      callRecordId: selectedCall.callRecordId,
      customerName: selectedCall.customerName,
      customerEmail: selectedCall.customerEmail,
      customerPhone: selectedCall.customerPhone,
      customerId: selectedCall.customerId,
      preferredLanguage: selectedCall.preferredLanguage,
      isIncomingSupport: true,
      state: 'connected',
      statusText: `Connected with ${selectedCall.customerName} (${selectedCall.languageName})`
    });

    setLogs([
      {
        id: 'log_0',
        sender: 'system',
        senderName: 'System',
        text: `Call accepted by Support Specialist ${user?.name}. Language: ${selectedCall.languageName}. Two-way voice established.`,
        timestamp: new Date().toLocaleTimeString()
      }
    ]);

    setActiveTab('console');

    // Notify backend
    const socket = getSocket();
    socket.emit('agent:accept_call', {
      callId: selectedCall.callId,
      agentId: user?.id,
      agentName: user?.name
    });

    // Acquire microphone and start speech recognition
    try {
      await webrtcManager.getMicrophoneStream();
      voiceService.setLanguage('en'); // Agent speaks in English or selected language
      voiceService.startListening((text, isFinal) => {
        if (isFinal && text.trim()) {
          socket.emit('call:live_speech', {
            callId: selectedCall.callId,
            sender: 'agent',
            senderName: user?.name || 'Support Agent',
            text: text.trim(),
            language: 'en'
          });
        }
      });
    } catch (err) {
      console.error('Failed to access microphone for agent call:', err);
    }
  };

  // Reject Incoming Customer Call
  const handleRejectIncomingCall = () => {
    if (!incomingCall) return;

    ringtoneService.stop();
    const socket = getSocket();
    socket.emit('agent:reject_call', {
      callId: incomingCall.callId,
      agentId: user?.id,
      reason: 'Agent busy or rejected'
    });

    setIncomingCall(null);
  };

  // Toggle Hold / Resume
  const handleToggleHold = () => {
    if (!activeCall) return;
    const socket = getSocket();
    if (!isCallHeld) {
      setIsCallHeld(true);
      socket.emit('call:hold', { callId: activeCall.callId });
      addLog('system', 'Call placed on hold by Support Agent.');
    } else {
      setIsCallHeld(false);
      socket.emit('call:resume', { callId: activeCall.callId });
      addLog('system', 'Call resumed.');
    }
  };

  // Save Call Notes
  const handleSaveNotes = async () => {
    if (!activeCall) return;
    const socket = getSocket();
    socket.emit('call:save_notes', { callId: activeCall.callId, notes: callNotes });
    if (activeCall.callRecordId && token) {
      try {
        await fetch(`/api/calls/${activeCall.callRecordId}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ notes: callNotes })
        });
      } catch (e) { }
    }
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 2000);
  };

  // Request AI Knowledge Base Answer Suggestion
  const handleRequestKbCopilot = (queryText?: string) => {
    const query = (queryText || copilotSearch).trim();
    if (!query || !activeCall) return;

    setCopilotLoading(true);
    const socket = getSocket();
    socket.emit('call:request_kb_suggest', {
      callId: activeCall.callId,
      query,
      targetLanguage: activeCall.preferredLanguage || 'en'
    });
  };

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

  // Initiate Outbound Voice AI Call to customer's mobile phone
  const handleStartAiCall = async (targetName: string, targetPhone: string, customerId?: string, preferredLang: string = 'en') => {
    if (!targetPhone.trim()) {
      alert('Please provide a valid destination mobile phone number.');
      return;
    }

    setCallError(null);
    setLastEndedCall(null);
    setCallDuration(0);
    setIsMuted(false);
    setIsSpeakerOn(true);
    setIsKeypadOpen(false);
    setIsMoreOpen(false);
    setDtmfInput('');
    setIsCallHeld(false);
    setCallNotes('');

    const callInitId = 'pstn_ai_' + Date.now();
    setActiveCall({
      callId: callInitId,
      customerName: targetName,
      customerPhone: targetPhone,
      customerId,
      preferredLanguage: preferredLang,
      isIncomingSupport: false,
      state: 'initiating',
      statusText: `Initiating AI Voice Call to ${targetName} (${targetPhone})...`
    });

    setLogs([
      {
        id: 'log_0',
        sender: 'system',
        senderName: 'System',
        text: `Automated KAIRA AI Voice Call initiated to ${targetName} at ${targetPhone} (Language: ${SUPPORTED_LANGUAGES[preferredLang as LanguageCode]?.name || 'English'}).`,
        timestamp: new Date().toLocaleTimeString()
      }
    ]);

    setActiveTab('console');

    try {
      const res = await fetch('/api/telephony/ai-call', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          customerId: customerId || null,
          customerName: targetName,
          customerPhone: targetPhone,
          language: preferredLang
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to initiate AI call.');
      }

      if (data.callRecord) {
        setActiveCall(prev => prev ? {
          ...prev,
          callId: data.callRecord.callId,
          callRecordId: data.callRecord.id,
          state: 'ringing',
          statusText: `Ringing ${targetName}'s phone (${targetPhone})...`
        } : null);
      }
    } catch (err: any) {
      setCallError(err.message || 'Error placing AI call');
      addLog('system', `Error: ${err.message}`);
    }
  };

  // Initiate Outbound Real Telephone Call (PSTN)
  const handleStartCall = async (targetName: string, targetPhone: string, customerId?: string) => {
    if (!targetPhone.trim()) {
      alert('Please provide a valid destination mobile phone number.');
      return;
    }

    const status = await telephonyVoiceManager.checkProviderStatus(token || undefined);
    setProviderStatus(status);
    if (!status.configured) {
      setCallError(status.message || 'Mobile phone calling is not configured. Add the Twilio settings in server/.env.');
      setActiveTab('outgoing');
      return;
    }

    // Check microphone access before placing call
    const hasMic = await audioDeviceManager.ensureMicrophoneAccess();
    if (!hasMic) {
      setShowAudioDeviceModal(true);
      return;
    }

    setCallError(null);
    setLastEndedCall(null);
    setCallDuration(0);
    setIsMuted(false);
    setIsSpeakerOn(true);
    setIsKeypadOpen(false);
    setIsMoreOpen(false);
    setDtmfInput('');
    setIsCallHeld(false);
    setCallNotes('');

    const callInitId = 'call_' + Date.now();
    setActiveCall({
      callId: callInitId,
      customerName: targetName,
      customerPhone: targetPhone,
      customerId,
      isIncomingSupport: false,
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

    await telephonyVoiceManager.makeCall(
      targetPhone,
      targetName,
      token || '',
      user?.id || '',
      {
        onStateChange: (state: TelephonyCallState, message?: string) => {
          if (state === 'ended' || state === 'failed') {
            setLastEndedCall({ name: targetName, phone: targetPhone });
            setActiveCall(null);
          } else {
            setActiveCall(prev => prev ? { ...prev, state, statusText: message || state } : null);
          }
          if (message) addLog('system', message);
          if (state === 'ended' || state === 'failed') {
            if (token) {
              fetch('/api/telephony/end-call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                  callId: registeredCallRecordId || callInitId,
                  duration: telephonyVoiceManager.getDurationSeconds(),
                  failureReason: state === 'failed' ? (message || 'Call failed') : null
                })
              }).catch(() => { });
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

  // End active call (Handles both WebRTC and Telephony)
  const handleEndCall = () => {
    if (!activeCall) return;

    if (activeCall.isIncomingSupport) {
      // WebRTC call
      const socket = getSocket();
      socket.emit('call:end', {
        callId: activeCall.callId,
        duration: callDuration,
        endedBy: 'agent',
        notes: callNotes
      });
      cleanupActiveCall();
    } else {
      // Twilio Telephony call
      telephonyVoiceManager.endCall();
      if (token) {
        fetch('/api/telephony/end-call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            callId: activeCall.callRecordId || activeCall.callId,
            duration: callDuration
          })
        }).catch(() => { });
      }
      cleanupActiveCall();
    }
    fetchHistory();
  };

  const cleanupActiveCall = () => {
    if (activeCall) setLastEndedCall({ name: activeCall.customerName, phone: activeCall.customerPhone });
    voiceService.stopListening();
    webrtcManager.endCall();
    setActiveCall(null);
    setIsCallHeld(false);
    setIsKeypadOpen(false);
    setIsMoreOpen(false);
    setCopilotSuggestion(null);
  };

  const handleToggleMute = () => {
    if (activeCall?.isIncomingSupport) {
      const muted = webrtcManager.toggleMute();
      setIsMuted(muted);
    } else {
      const muted = telephonyVoiceManager.toggleMute();
      setIsMuted(muted);
    }
  };

  const handleToggleSpeaker = () => {
    if (isSpeakerOn) {
      previousVolumeRef.current = volume > 0 ? volume : previousVolumeRef.current;
      setVolume(0);
      if (activeCall?.isIncomingSupport) webrtcManager.setVolume(0);
      else telephonyVoiceManager.setVolume(0);
      setIsSpeakerOn(false);
      return;
    }

    const restoredVolume = previousVolumeRef.current || 1;
    setVolume(restoredVolume);
    if (activeCall?.isIncomingSupport) webrtcManager.setVolume(restoredVolume);
    else telephonyVoiceManager.setVolume(restoredVolume);
    setIsSpeakerOn(true);
  };

  const handleSendDtmf = (digit: string) => {
    if (!activeCall || !/^[0-9*#]$/.test(digit)) return;
    if (activeCall.isIncomingSupport) webrtcManager.sendDigits(digit);
    else telephonyVoiceManager.sendDigits(digit);
    setDtmfInput(current => `${current}${digit}`.slice(-24));
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    setIsSpeakerOn(val > 0);
    if (val > 0) previousVolumeRef.current = val;
    if (activeCall?.isIncomingSupport) {
      webrtcManager.setVolume(val);
    } else {
      telephonyVoiceManager.setVolume(val);
    }
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Incoming Call Notification Modal & Ringing Sound */}
      {incomingCall && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border-2 border-indigo-500 animate-in fade-in zoom-in-95 duration-200 space-y-5 text-center">
            {/* Ringing Visual */}
            <div className="relative w-20 h-20 mx-auto">
              <div className="absolute inset-0 rounded-full bg-indigo-500/20 animate-ping" />
              <div className="relative w-20 h-20 rounded-full bg-gradient-to-tr from-indigo-600 to-blue-600 text-white flex items-center justify-center shadow-lg shadow-indigo-300">
                <PhoneCall className="w-9 h-9 animate-bounce" />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-center gap-2 mb-1">
                <span className="px-3 py-1 rounded-full text-xs font-black bg-indigo-50 text-indigo-700 border border-indigo-200">
                  Incoming Customer Call ({incomingRingSec}s)
                </span>
              </div>
              <h3 className="text-xl font-black text-slate-900 mt-2">{incomingCall.customerName}</h3>
              <div className="mt-1.5 flex flex-col items-center gap-1">
                {incomingCall.customerEmail && (
                  <p className="text-xs text-slate-600 font-medium flex items-center justify-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-slate-400" />
                    <span>{incomingCall.customerEmail}</span>
                  </p>
                )}
                <p className="text-xs text-slate-700 font-mono font-semibold flex items-center justify-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-slate-400" />
                  <span>{incomingCall.customerPhone || 'Not provided'}</span>
                </p>
              </div>
            </div>

            {/* Language Badge */}
            <div className="p-3.5 bg-blue-50/70 border border-blue-200 rounded-2xl flex items-center justify-between text-left">
              <div className="flex items-center gap-2.5">
                <Globe className="w-5 h-5 text-blue-600 shrink-0" />
                <div>
                  <div className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">
                    Customer's Preferred Language
                  </div>
                  <div className="text-sm font-extrabold text-blue-950">
                    {incomingCall.languageName}
                  </div>
                </div>
              </div>
              <span className="px-2.5 py-1 bg-white text-blue-800 text-xs font-bold rounded-lg border border-blue-200">
                {incomingCall.preferredLanguage.toUpperCase()}
              </span>
            </div>

            {/* Accept / Reject Buttons */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={handleRejectIncomingCall}
                className="min-h-[48px] py-3.5 px-4 rounded-2xl bg-slate-100 hover:bg-red-50 hover:text-red-600 hover:border-red-300 border border-slate-200 text-slate-700 font-bold text-xs active:scale-[0.97] transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <PhoneOff className="w-4 h-4 text-red-500" />
                Reject
              </button>

              <button
                onClick={handleAcceptIncomingCall}
                className="min-h-[48px] py-3.5 px-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white font-black text-xs shadow-lg shadow-emerald-500/25 active:scale-[0.97] transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <PhoneCall className="w-4 h-4" />
                Accept Call
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Real-Time Human Assistance Priority Warning Banner */}
      {assistanceAlert && (
        <div className="bg-rose-50 border-2 border-rose-300 rounded-3xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-sm animate-fadeIn">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-rose-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-rose-200">
              <Flame className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-black text-rose-950">Customer May Require Human Assistance</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-600 text-white uppercase tracking-wider">
                  Urgent Priority
                </span>
              </div>
              <p className="text-xs text-rose-800 mt-0.5">
                <strong>{assistanceAlert.customerName}</strong> ({assistanceAlert.customerPhone}): {assistanceAlert.reason}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setActiveTab('incoming');
                setAssistanceAlert(null);
              }}
              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer"
            >
              View Call Queue
            </button>
            <button
              type="button"
              onClick={() => setAssistanceAlert(null)}
              className="px-3 py-1.5 bg-white hover:bg-rose-100 text-rose-700 border border-rose-300 rounded-xl text-xs font-semibold transition cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Top Header & Agent Status Bar */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Support Agent Console</h1>
              {/* Agent Status Toggle */}
              <button
                onClick={handleToggleStatus}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border transition-all cursor-pointer ${agentStatus === 'available'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                    : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                  }`}
                title="Click to toggle Available / Busy"
              >
                <span className={`w-2 h-2 rounded-full ${agentStatus === 'available' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                Status: {agentStatus === 'available' ? 'Available for Calls' : 'Busy / Break'}
              </button>

              {/* Waiting Queue Count Pill */}
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
                <Users className="w-3.5 h-3.5 text-blue-600" />
                Queue: {queueCount} Waiting
              </div>

              {/* Audio Device Settings Pill */}
              <button
                onClick={() => setShowAudioDeviceModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-all cursor-pointer"
                title="Microphone & Speaker Test / Device Selection"
              >
                <Settings className="w-3.5 h-3.5 text-slate-500" />
                <span>Audio Settings</span>
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Multilingual customer incoming voice calls, WebRTC audio, grounded KB copilot, and PSTN outbound dialer.
            </p>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-2xl border border-slate-200 text-xs font-semibold overflow-x-auto">
            <button
              onClick={() => setActiveTab('outgoing')}
              className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer ${activeTab === 'outgoing' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
                }`}
            >
              Outgoing Calls
            </button>
            <button
              onClick={() => setActiveTab('console')}
              className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 ${activeTab === 'console' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
                }`}
            >
              {activeCall && (activeCall.state === 'connected' || activeCall.state === 'on_hold') && (
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              )}
              Active Call {activeCall && activeCall.state !== 'ended' ? '(Live)' : ''}
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer ${activeTab === 'history' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
                }`}
            >
              Call History
            </button>
            <button
              onClick={() => setActiveTab('knowledge')}
              className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 ${activeTab === 'knowledge' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
                }`}
            >
              <BookOpen className="w-3.5 h-3.5 text-blue-600" />
              Knowledge Base
            </button>
            <button
              onClick={() => setActiveTab('tickets')}
              className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'tickets' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5 text-purple-600" />
              Tickets
            </button>
            <button
              onClick={() => setActiveTab('tasks')}
              className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'tasks' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ListTodo className="w-3.5 h-3.5 text-amber-600" />
              Follow-Up Tasks
            </button>
          </div>
        </div>

      </div>

      {/* 1. OUTGOING CALLS TAB */}
      {activeTab === 'outgoing' && (
        <div className="space-y-6">
          {(callError || (providerStatus && !providerStatus.configured)) && (
            <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
              <p className="font-bold">Mobile phone calling is unavailable</p>
              <p className="mt-1">{callError || providerStatus?.message || 'Configure Twilio in server/.env before placing PSTN calls.'}</p>
              <p className="mt-1 text-xs text-amber-800">In-app Support Specialist calls use the Incoming Calls tab and require an agent to be signed in and available.</p>
            </div>
          )}
          {/* Direct Dial Any Phone Number Card */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-blue-600" />
                  Quick Outbound Dial to Any Mobile Phone
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Dial any registered customer or mobile number. The customer's mobile phone rings over PSTN.
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
                  disabled={!manualPhone.trim() || Boolean(activeCall && activeCall.state === 'connected')}
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
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-bold text-slate-900 truncate">{c.name}</h3>
                        <p className="text-[11px] text-slate-500 truncate">{c.email}</p>
                      </div>
                    </div>

                    <div className="text-xs space-y-1">
                      <div className="flex items-center justify-between text-slate-600">
                        <span>Phone:</span>
                        <span className="font-mono font-medium text-slate-900">{c.phone || 'Not provided'}</span>
                      </div>
                      <div className="flex items-center justify-between text-slate-600">
                        <span>Language:</span>
                        <span className="font-semibold text-indigo-700">
                          {SUPPORTED_LANGUAGES[(c.preferredLanguage as LanguageCode) || 'en']?.name || 'English'}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-2 pt-1">
                      <button
                        onClick={() => handleStartCall(c.name, c.phone || '', c.id)}
                        disabled={!c.phone || Boolean(activeCall && activeCall.state === 'connected')}
                        className="py-2 px-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-bold text-[11px] flex items-center justify-center gap-1 shadow-xs transition-colors cursor-pointer"
                        title="Agent speaks directly to customer phone"
                      >
                        <PhoneOutgoing className="w-3.5 h-3.5" />
                        Agent Call
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. ACTIVE LIVE CALL CONSOLE TAB */}
      {activeTab === 'console' && (
        <div className="space-y-6">
          {!activeCall ? lastEndedCall ? (
            <div className="min-h-[70vh] rounded-[2rem] border border-blue-100 bg-gradient-to-b from-blue-50 via-sky-50 to-white p-8 flex flex-col items-center justify-center text-center">
              <span className="text-sm font-bold tracking-wide text-slate-500">Ended</span>
              <div className="mt-7 flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-5xl font-bold text-white shadow-xl shadow-blue-200">
                {lastEndedCall.name.charAt(0).toUpperCase()}
              </div>
              <h2 className="mt-5 text-3xl font-bold text-slate-900">{lastEndedCall.name}</h2>
              <p className="mt-2 text-base text-slate-500">{lastEndedCall.phone || 'Phone number unavailable'}</p>
              {callError && <p role="alert" className="mt-5 max-w-lg rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{callError}</p>}
            </div>
          ) : (
            <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center space-y-4">
              <PhoneOff className="w-12 h-12 text-slate-300 mx-auto" />
              <h3 className="text-base font-bold text-slate-900">No Active Voice Call</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                When an incoming customer call is accepted, or an outbound telephone call is initiated, the live two-way audio session and copilot appear here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left 2 Cols: Main Voice Console & Transcripts */}
              <div className="lg:col-span-2 space-y-6">
                {/* Modern mobile-style live call screen */}
                <div className="relative min-h-[560px] overflow-hidden rounded-[2rem] border border-blue-100 bg-gradient-to-b from-[#eaf4ff] via-[#f3f8ff] to-white px-5 py-5 shadow-sm sm:px-8 sm:py-7">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <CallQualityIndicator isCallActive={!!activeCall && activeCall.state !== 'ended'} />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowAudioDeviceModal(true)}
                        className="flex items-center gap-2 rounded-full border border-blue-100 bg-white/80 px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-white"
                        title="Configure audio devices"
                      >
                        <Settings className="h-4 w-4 text-blue-600" />
                        <span>Audio</span>
                      </button>
                      <div className="flex items-center gap-2 rounded-full border border-blue-100 bg-white/80 px-3 py-2 font-mono text-xs font-bold text-slate-700 shadow-sm">
                        <Clock className="h-4 w-4 text-blue-500" />
                        {formatDuration(callDuration)}
                      </div>
                    </div>
                  </div>

                  <div className="flex min-h-[280px] flex-col items-center justify-center py-7 text-center">
                    <p className={`mb-6 text-sm font-semibold tracking-wide ${activeCall.state === 'connected' || activeCall.state === 'on_hold' ? 'text-emerald-700' : activeCall.state === 'ended' || activeCall.state === 'failed' ? 'text-slate-500' : 'text-blue-700'}`}>
                      {activeCall.state === 'ringing' ? 'Calling...'
                        : activeCall.state === 'connected' || activeCall.state === 'on_hold' ? 'Connected'
                          : activeCall.state === 'ended' || activeCall.state === 'failed' ? 'Ended'
                            : 'Connecting...'}
                    </p>
                    <div className="flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-5xl font-bold text-white shadow-xl shadow-blue-200 ring-8 ring-white/70 sm:h-32 sm:w-32">
                      {activeCall.customerName.charAt(0).toUpperCase()}
                    </div>
                    <h2 className="mt-6 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{activeCall.customerName}</h2>
                    <div className="mt-2 flex flex-col items-center gap-1">
                      {activeCall.customerEmail && (
                        <p className="text-sm font-medium text-slate-600 flex items-center justify-center gap-1.5">
                          <Mail className="w-4 h-4 text-slate-400" />
                          <span>{activeCall.customerEmail}</span>
                        </p>
                      )}
                      <p className="text-base font-semibold text-slate-700 font-mono flex items-center justify-center gap-1.5">
                        <Phone className="w-4 h-4 text-slate-400" />
                        <span>{activeCall.customerPhone || 'Phone number unavailable'}</span>
                      </p>
                    </div>
                    <span className="mt-3 rounded-full border border-blue-100 bg-white/70 px-3 py-1 text-[11px] font-semibold text-blue-700">
                      {activeCall.isIncomingSupport ? 'Support call' : 'PSTN outbound call'}
                    </span>
                    <div className="mt-7 flex h-12 items-center justify-center gap-1.5" aria-hidden="true">
                      {['animate-soundwave-1', 'animate-soundwave-2', 'animate-soundwave-3', 'animate-soundwave-4', 'animate-soundwave-5', 'animate-soundwave-2', 'animate-soundwave-4'].map((animation, index) => (
                        <span key={index} style={{ animationDelay: `${index * 90}ms` }} className={`w-1.5 rounded-full bg-emerald-500 ${animation}`} />
                      ))}
                    </div>
                  </div>

                  {(isKeypadOpen || isMoreOpen) && (
                    <div className="mx-auto mb-6 max-w-sm rounded-3xl border border-blue-100 bg-white/90 p-4 shadow-sm">
                      {isKeypadOpen ? (
                        <>
                          <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-3">
                            <span className="text-xs font-semibold text-slate-500">Touch tones</span>
                            <span className="font-mono text-sm font-bold tracking-widest text-slate-800">{dtmfInput || ' '}</span>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map(digit => (
                              <button key={digit} onClick={() => handleSendDtmf(digit)} className="h-11 rounded-xl bg-blue-50 text-lg font-semibold text-blue-900 transition hover:bg-blue-100 active:scale-95">{digit}</button>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-wrap items-center justify-center gap-3">
                          <button onClick={handleToggleHold} className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 transition hover:bg-amber-100">
                            {isCallHeld ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                            {isCallHeld ? 'Resume call' : 'Hold call'}
                          </button>
                          <button onClick={() => setShowAudioDeviceModal(true)} className="flex items-center gap-2 rounded-xl bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800 transition hover:bg-blue-100">
                            <Settings className="h-4 w-4" /> Audio devices
                          </button>
                          <label className="flex w-full items-center gap-3 px-2 pt-2 text-xs font-medium text-slate-600">
                            <VolumeX className="h-4 w-4" />
                            <input type="range" min="0" max="1" step="0.05" value={volume} onChange={handleVolumeChange} className="flex-1 accent-blue-600" />
                            <Volume2 className="h-4 w-4" />
                          </label>
                        </div>
                      )}
                    </div>
                  )}

                  {isCallHeld && <p className="mb-4 text-center text-xs font-semibold text-amber-700">Call on hold</p>}

                  <div className="mx-auto flex max-w-md flex-col items-center gap-5">
                    <div className="grid w-full grid-cols-4 gap-2 sm:gap-4">
                      <button onClick={() => { setIsKeypadOpen(value => !value); setIsMoreOpen(false); }} className={`flex flex-col items-center gap-2 rounded-2xl py-2 text-xs font-medium transition ${isKeypadOpen ? 'text-blue-700' : 'text-slate-600 hover:text-blue-700'}`} aria-pressed={isKeypadOpen}>
                        <span className={`flex h-14 w-14 items-center justify-center rounded-full border shadow-sm transition ${isKeypadOpen ? 'border-blue-300 bg-blue-100 text-blue-700' : 'border-blue-100 bg-white text-slate-700 hover:bg-blue-50'}`}><Grid3X3 className="h-5 w-5" /></span>
                        Keypad
                      </button>
                      <button onClick={handleToggleMute} className={`flex flex-col items-center gap-2 rounded-2xl py-2 text-xs font-medium transition ${isMuted ? 'text-red-700' : 'text-slate-600 hover:text-blue-700'}`} aria-pressed={isMuted}>
                        <span className={`flex h-14 w-14 items-center justify-center rounded-full border shadow-sm transition ${isMuted ? 'border-red-200 bg-red-50 text-red-600' : 'border-blue-100 bg-white text-slate-700 hover:bg-blue-50'}`}>{isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}</span>
                        {isMuted ? 'Unmute' : 'Mute'}
                      </button>
                      <button onClick={handleToggleSpeaker} className={`flex flex-col items-center gap-2 rounded-2xl py-2 text-xs font-medium transition ${isSpeakerOn ? 'text-blue-700' : 'text-slate-600 hover:text-blue-700'}`} aria-pressed={isSpeakerOn}>
                        <span className={`flex h-14 w-14 items-center justify-center rounded-full border shadow-sm transition ${isSpeakerOn ? 'border-blue-300 bg-blue-100 text-blue-700' : 'border-blue-100 bg-white text-slate-500 hover:bg-blue-50'}`}>{isSpeakerOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}</span>
                        Speaker
                      </button>
                      <button onClick={() => { setIsMoreOpen(value => !value); setIsKeypadOpen(false); }} className={`flex flex-col items-center gap-2 rounded-2xl py-2 text-xs font-medium transition ${isMoreOpen ? 'text-blue-700' : 'text-slate-600 hover:text-blue-700'}`} aria-pressed={isMoreOpen}>
                        <span className={`flex h-14 w-14 items-center justify-center rounded-full border shadow-sm transition ${isMoreOpen ? 'border-blue-300 bg-blue-100 text-blue-700' : 'border-blue-100 bg-white text-slate-700 hover:bg-blue-50'}`}><MoreHorizontal className="h-5 w-5" /></span>
                        More
                      </button>
                    </div>
                    <button onClick={handleEndCall} className="flex h-14 w-16 items-center justify-center rounded-full bg-red-600 text-white shadow-lg shadow-red-200 transition hover:bg-red-700 active:scale-95" aria-label="End call" title="End call">
                      <PhoneOff className="h-6 w-6" />
                    </button>
                  </div>
                </div>

                {/* Real-Time AI Customer Sentiment Indicator */}
                <LiveSentimentCard
                  sentiment={liveSentiment?.sentiment}
                  confidenceScore={liveSentiment?.confidenceScore}
                  reason={liveSentiment?.reason}
                  triggerText={liveSentiment?.triggerText}
                  requiresHumanAssistance={liveSentiment?.requiresHumanAssistance || Boolean(assistanceAlert && assistanceAlert.callId === activeCall.callId)}
                  canManageOverride={true}
                  onOverride={(status) => {
                    const socket = getSocket();
                    socket.emit('sentiment:override', { callId: activeCall.callId, status });
                    if (status === 'dismissed') {
                      setAssistanceAlert(null);
                    }
                  }}
                />

                {/* Live Multilingual Conversation Logs */}
                <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-indigo-600" />
                      <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                        Live Conversation Transcript & Translations
                      </h3>
                    </div>
                    <span className="text-[11px] text-slate-400">{logs.length} messages</span>
                  </div>

                  <div className="bg-slate-50/70 rounded-2xl border border-slate-200 p-4 h-72 overflow-y-auto space-y-3">
                    {logs.map((log) => (
                      <div
                        key={log.id}
                        className={`flex flex-col ${log.sender === 'agent'
                            ? 'items-end'
                            : log.sender === 'system'
                              ? 'items-center'
                              : 'items-start'
                          }`}
                      >
                        {log.sender === 'system' ? (
                          <span className="px-3 py-1 bg-slate-200/60 text-slate-700 text-[11px] rounded-full font-medium my-0.5">
                            {log.text}
                          </span>
                        ) : (
                          <div className="max-w-[85%] space-y-1">
                            <span className="text-[10px] font-semibold text-slate-400 px-1 block">
                              {log.senderName} • {log.timestamp}
                            </span>
                            <div
                              className={`px-4 py-2.5 rounded-2xl text-xs leading-relaxed ${log.sender === 'agent'
                                  ? 'bg-blue-600 text-white rounded-tr-xs shadow-xs'
                                  : 'bg-white text-slate-900 border border-slate-200 rounded-tl-xs shadow-2xs'
                                }`}
                            >
                              <div>{log.text}</div>
                              {log.translation && (
                                <div className={`mt-1.5 pt-1.5 border-t text-[11px] font-normal italic ${log.sender === 'agent' ? 'border-blue-400/50 text-blue-100' : 'border-slate-100 text-indigo-600'
                                  }`}>
                                  Translated: {log.translation}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                </div>

                {/* Call Notes Area */}
                <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                      Agent Call Notes & Summary
                    </h3>
                    <button
                      onClick={handleSaveNotes}
                      className="px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-lg border border-indigo-200 transition-colors cursor-pointer"
                    >
                      {notesSaved ? 'Saved ✓' : 'Save Notes'}
                    </button>
                  </div>
                  <textarea
                    rows={3}
                    placeholder="Enter customer call notes, inquiries discussed, resolution steps..."
                    value={callNotes}
                    onChange={(e) => setCallNotes(e.target.value)}
                    className="w-full p-3 text-xs bg-slate-50 border border-slate-200 rounded-2xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-900"
                  />
                </div>
              </div>

              {/* Right 1 Col: Grounded Corporate Knowledge Base Copilot */}
              <div className="space-y-6">
                <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Approved Knowledge Base Copilot</h3>
                      <p className="text-[11px] text-slate-500">Grounded strictly in company verified data</p>
                    </div>
                  </div>

                  {/* Search query input */}
                  <div className="space-y-2">
                    <input
                      type="text"
                      placeholder="Ask copilot or search product inquiry..."
                      value={copilotSearch}
                      onChange={(e) => setCopilotSearch(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleRequestKbCopilot()}
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-900"
                    />
                    <button
                      onClick={() => handleRequestKbCopilot()}
                      disabled={copilotLoading || !copilotSearch.trim()}
                      className="w-full py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
                    >
                      {copilotLoading ? (
                        <span>Searching Knowledge Base...</span>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Get Grounded AI Answer</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Suggestion Card */}
                  {copilotSuggestion && (
                    <div className="p-4 bg-indigo-50/70 border border-indigo-200 rounded-2xl space-y-2.5">
                      <div className="flex items-center justify-between text-[11px] text-indigo-700 font-bold">
                        <span>Grounded Answer Suggestion</span>
                        <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-900 font-mono text-[10px]">
                          {copilotSuggestion.language.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-xs text-slate-800 leading-relaxed font-medium">
                        {copilotSuggestion.answer}
                      </p>

                      {/* Source references */}
                      {copilotSuggestion.sources.length > 0 && (
                        <div className="pt-2 border-t border-indigo-200/60 text-[10px] text-slate-500">
                          <span className="font-bold">Verified Sources: </span>
                          {copilotSuggestion.sources.map(s => s.title).join(', ')}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          onClick={() => {
                            voiceService.speak(copilotSuggestion.answer, undefined, copilotSuggestion.language);
                            if (activeCall) {
                              const socket = getSocket();
                              socket.emit('call:live_speech', {
                                callId: activeCall.callId,
                                sender: 'agent',
                                senderName: `${user?.name || 'Agent'} (AI Voice)`,
                                text: copilotSuggestion.answer,
                                language: copilotSuggestion.language
                              });
                            }
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold shadow-xs transition-colors cursor-pointer"
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                          Speak to Call
                        </button>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(copilotSuggestion.answer);
                            alert('Copied suggestion to clipboard!');
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold transition-colors cursor-pointer"
                        >
                          <Copy className="w-3 h-3" />
                          Copy
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Quick Knowledge Base References */}
                  <div className="pt-2 space-y-2">
                    <h4 className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                      Quick KB Topics
                    </h4>
                    <div className="space-y-1.5 max-h-56 overflow-y-auto">
                      {[
                        'KAIRA VoiceCore Features',
                        'Voice Agent Pricing & Subscription',
                        'LiveEscalate Human Transfer Protocol',
                        'Refund & Cancellation Policy'
                      ].map((topic) => (
                        <button
                          key={topic}
                          onClick={() => {
                            setCopilotSearch(topic);
                            handleRequestKbCopilot(topic);
                          }}
                          className="w-full text-left p-2 rounded-xl bg-slate-50 hover:bg-indigo-50 hover:text-indigo-700 text-xs text-slate-700 border border-slate-200 transition-colors cursor-pointer truncate"
                        >
                          {topic}
                        </button>
                      ))}
                    </div>
                  </div>
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
            <h2 className="text-lg font-bold text-slate-900">Enterprise Call History</h2>
            <button
              onClick={fetchHistory}
              className="text-xs font-bold text-blue-600 hover:text-blue-800 cursor-pointer"
            >
              Refresh
            </button>
          </div>

          {loadingHistory ? (
            <div className="py-8 text-center text-xs text-slate-500">Loading call history...</div>
          ) : callHistory.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">No calls recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 text-slate-700 uppercase font-bold text-[10px] tracking-wider border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">Date & Time</th>
                    <th className="py-3 px-4">Customer</th>
                    <th className="py-3 px-4">Language</th>
                    <th className="py-3 px-4">Duration</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Sentiment</th>
                    <th className="py-3 px-4">Notes</th>
                    <th className="py-3 px-4 text-right">Intelligence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {callHistory.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-4 font-medium text-slate-800">
                        {new Date(c.startTime).toLocaleString()}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{c.customerName}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{c.customerPhone || 'N/A'}</div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-semibold text-[10px]">
                          {SUPPORTED_LANGUAGES[(c.language as LanguageCode) || 'en']?.name || 'English'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono font-medium">{formatDuration(c.duration)}</td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                          {c.type}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${c.status === 'completed'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-slate-100 text-slate-700'
                          }`}>
                          {c.status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <SentimentBadge
                          sentiment={c.overallSentiment}
                          score={c.sentimentScore}
                          size="xs"
                          requiresAssistance={c.requiresAssistance}
                        />
                      </td>
                      <td className="py-3 px-4 text-slate-600 max-w-xs truncate">
                        {c.callNotes || '-'}
                      </td>
                      <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                        <button
                          onClick={() => setSelectedCallIdForIntel(c.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 font-bold rounded-lg border border-purple-200 transition-colors cursor-pointer text-[11px]"
                          title="View post-call AI intelligence, summary, and resolution analysis"
                        >
                          <Sparkles className="w-3 h-3" />
                          AI Summary
                        </button>
                        {c.customerId && (
                          <button
                            onClick={() => setSelectedCustomerId(c.customerId!)}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-[11px] cursor-pointer"
                            title="View customer interaction history"
                          >
                            <Users className="w-3 h-3" />
                            Profile
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
      )}

      {/* 4. KNOWLEDGE BASE SEARCH TAB */}
      {activeTab === 'knowledge' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 space-y-6 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Approved Corporate Knowledge Base</h2>
              <p className="text-xs text-slate-500">
                Official verified answers managed by Administrators. Grounded reference for all customer questions.
              </p>
            </div>
            <div className="relative w-full sm:w-72">
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
            <div className="py-8 text-center text-xs text-slate-500">Loading knowledge entries...</div>
          ) : kbEntries.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">No knowledge entries found.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {kbEntries.map((kb) => (
                <div key={kb.id} className="p-5 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-bold border border-blue-200">
                      {kb.category}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {new Date(kb.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-slate-900">{kb.title}</h3>
                  <p className="text-xs text-slate-600 leading-relaxed">{kb.content}</p>
                  {kb.answer && (
                    <div className="mt-2 p-3 bg-white rounded-xl border border-slate-200 text-xs text-indigo-900">
                      <span className="font-bold text-indigo-600 block mb-1">Direct Verified Answer:</span>
                      {kb.answer}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 5. SUPPORT TICKETS TAB */}
      {activeTab === 'tickets' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 space-y-6 shadow-xs">
          <SupportTickets isAgentView />
        </div>
      )}

      {/* 6. FOLLOW-UP TASKS TAB */}
      {activeTab === 'tasks' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 space-y-6 shadow-xs">
          <FollowUpTasksManager token={token} currentUserId={user?.id} isAgent={true} />
        </div>
      )}

      {/* Customer Profile Modal */}
      <CustomerProfileModal
        customerId={selectedCustomerId}
        isOpen={!!selectedCustomerId}
        onClose={() => setSelectedCustomerId(null)}
        token={token}
      />

      {/* Call Intelligence Modal */}
      <CallIntelligenceModal
        callId={selectedCallIdForIntel}
        isOpen={!!selectedCallIdForIntel}
        onClose={() => setSelectedCallIdForIntel(null)}
        token={token}
        onIntelligenceUpdated={fetchHistory}
      />

      {/* Audio Device Settings Modal */}
      <AudioDeviceModal
        isOpen={showAudioDeviceModal}
        onClose={() => setShowAudioDeviceModal(false)}
      />
    </div>
  );
};
