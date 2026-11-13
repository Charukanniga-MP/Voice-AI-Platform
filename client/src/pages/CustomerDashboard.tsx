import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { useLanguage } from '../context/LanguageContext.js';
import { getSocket, registerSocketUser } from '../services/socket.js';
import { voiceService } from '../services/voice.js';
import { webrtcManager } from '../services/webrtc.js';
import { SupportTickets } from './SupportTickets.js';
import { CallQualityIndicator } from '../components/CallQualityIndicator.js';
import { AudioDeviceModal } from '../components/AudioDeviceModal.js';
import { audioDeviceManager } from '../services/audioDevice.js';
import { CallRecord, CallTranscript, LanguageCode, SUPPORTED_LANGUAGES } from '../types.js';
import {
  PhoneCall, PhoneOff, Mic, MicOff, Volume2, VolumeX,
  Clock, ShieldAlert, Sparkles, MessageSquare, History, User as UserIcon,
  Headphones, Globe, Star, Users, CheckCircle2, RefreshCw, Settings,
  Send, Download, Lightbulb, Play, Pause, Bot, Radio, FileText, CheckCircle
} from 'lucide-react';
import { SentimentBadge } from '../components/SentimentBadge.js';
import { LiveSentimentCard } from '../components/LiveSentimentCard.js';
import { PostCallSentimentSummary } from '../components/PostCallSentimentSummary.js';
import { SentimentType } from '../types.js';

const SUGGESTED_QUESTIONS = [
  'What are your pricing plans?',
  'What products does KAIRA offer?',
  'Where is your office located?',
  'What is your refund policy?',
  'What are your business hours?',
  'Connect me to an Admin'
];

export const CustomerDashboard: React.FC = () => {
  const { user, token } = useAuth();

  // Register customer on socket whenever mounted
  useEffect(() => {
    if (user) {
      registerSocketUser(user.id, user.role, user.name);
    }
  }, [user]);
  const { language: selectedLanguage, setLanguage: setSelectedLanguage, t } = useLanguage();

  // Call status: 'idle' | 'connecting' | 'ringing' | 'queued' | 'active_agent' | 'active_ai' | 'transferring' | 'active_admin' | 'ended'
  const [callStatus, setCallStatus] = useState<
    'idle' | 'connecting' | 'ringing' | 'queued' | 'active_agent' | 'active_ai' | 'transferring' | 'active_admin' | 'ended'
  >('idle');

  const [callId, setCallId] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [transcripts, setTranscripts] = useState<CallTranscript[]>([]);
  const [interimText, setInterimText] = useState('');
  const [aiIsSpeaking, setAiIsSpeaking] = useState(false);
  const aiIsSpeakingRef = useRef(false);
  const [isCustomerSpeaking, setIsCustomerSpeaking] = useState(false);
  const [wasInterrupted, setWasInterrupted] = useState(false);
  const [liveLatency, setLiveLatency] = useState<number | null>(null);
  const speechEndTimeRef = useRef<number | null>(null);
  const currentAiSpeechTextRef = useRef('');
  const [textInput, setTextInput] = useState('');

  // Agent/Admin details
  const [activePartner, setActivePartner] = useState<{
    id?: string;
    name?: string;
    role: 'ai' | 'agent' | 'admin';
    language?: string;
  } | null>(null);

  // Queue details
  const [queueInfo, setQueueInfo] = useState<{
    position: number;
    estimatedWaitTime: number;
  } | null>(null);

  // Audio controls
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isCallHeld, setIsCallHeld] = useState(false);

  // Post-call rating
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [ratingVal, setRatingVal] = useState(5);
  const [ratingCallId, setRatingCallId] = useState<string | null>(null);
  const [ratingComment, setRatingComment] = useState('');

  // Call history
  const [history, setHistory] = useState<CallRecord[]>([]);
  const [selectedHistoryCall, setSelectedHistoryCall] = useState<CallRecord | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(new Date());
  const [showAudioDeviceModal, setShowAudioDeviceModal] = useState(false);

  // AI visual states: 'idle' | 'listening' | 'thinking' | 'speaking'
  const [aiVisualState, setAiVisualState] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');

  // Call recording playback state
  const [playingRecordingId, setPlayingRecordingId] = useState<string | null>(null);
  const activeAudioPlayerRef = useRef<HTMLAudioElement | null>(null);

  const handlePlayRecording = (recordingUrl: string, recCallId: string) => {
    if (playingRecordingId === recCallId) {
      if (activeAudioPlayerRef.current) {
        activeAudioPlayerRef.current.pause();
      }
      setPlayingRecordingId(null);
      return;
    }

    if (activeAudioPlayerRef.current) {
      activeAudioPlayerRef.current.pause();
    }

    const audio = new Audio(recordingUrl);
    activeAudioPlayerRef.current = audio;
    setPlayingRecordingId(recCallId);

    audio.onended = () => {
      setPlayingRecordingId(null);
    };
    audio.onerror = () => {
      setPlayingRecordingId(null);
      alert('Unable to play recording. The audio stream may still be processing.');
    };

    audio.play().catch(err => {
      console.warn('Playback error:', err);
      setPlayingRecordingId(null);
    });
  };


  // Live Sentiment Telemetry State
  const [liveSentiment, setLiveSentiment] = useState<{
    sentiment: SentimentType;
    confidenceScore: number;
    reason: string;
    triggerText: string;
    requiresHumanAssistance: boolean;
  } | null>(null);

  const [transferNotice, setTransferNotice] = useState<{
    message: string;
    ticketId?: string;
  } | null>(null);

  // Auto-scroll transcript
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Listen to WebRTC automatic reconnection events
  useEffect(() => {
    webrtcManager.setCallbacks({
      onReconnecting: (attempt, max) => {
        setTranscripts(prev => [
          ...prev,
          {
            id: 'reconnect_' + Date.now(),
            sender: 'system',
            senderName: 'System',
            text: `⚠️ Network connection interrupted. Attempting automatic reconnection... (${attempt}/${max})`,
            timestamp: new Date().toISOString()
          }
        ]);
      },
      onReconnected: () => {
        setTranscripts(prev => [
          ...prev,
          {
            id: 'reconnect_' + Date.now(),
            sender: 'system',
            senderName: 'System',
            text: `✓ Connection restored! Live two-way voice resumed.`,
            timestamp: new Date().toISOString()
          }
        ]);
      },
      onReconnectFailed: (msg) => {
        setCallStatus('ended');
        setTranscripts(prev => [
          ...prev,
          {
            id: 'reconnect_fail_' + Date.now(),
            sender: 'system',
            senderName: 'System',
            text: `❌ ${msg}`,
            timestamp: new Date().toISOString()
          }
        ]);
      }
    });
  }, []);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts, interimText]);

  // Set voice recognition language on mount and when language changes
  useEffect(() => {
    voiceService.setLanguage(selectedLanguage);
  }, [selectedLanguage]);

  // Sync language selection with server and active call session
  const handleLanguageChange = async (lang: LanguageCode) => {
    setSelectedLanguage(lang);
    voiceService.setLanguage(lang);

    // If call is active, sync with backend call session in real-time
    if (callId && callStatus !== 'idle') {
      const socket = getSocket();
      socket.emit('call:change_language', { callId, language: lang });
    }

    if (token) {
      try {
        await fetch('/api/auth/preferences', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ preferredLanguage: lang })
        });
      } catch (err) {
        console.warn('Could not save language preference:', err);
      }
    }
  };


  // Duration timer: runs continuously without artificial limit
  useEffect(() => {
    let timer: any;
    if (callStatus === 'active_agent' || callStatus === 'active_ai' || callStatus === 'transferring' || callStatus === 'active_admin') {
      timer = setInterval(() => setDuration(prev => prev + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [callStatus]);

  // Fetch Customer Call History
  const fetchHistory = async () => {
    const authToken = token || localStorage.getItem('kaira_token') || localStorage.getItem('token');
    if (!authToken) return;
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/calls/my-history?_t=${Date.now()}`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache'
        }
      });
      const data = await res.json();
      if (res.ok) {
        setHistory(data.calls || []);
        setLastRefreshedAt(new Date());
      }
    } catch (err) {
      console.error('Failed to load call history:', err);
    } finally {
      setTimeout(() => setLoadingHistory(false), 450);
    }
  };

  useEffect(() => {
    fetchHistory();
    // Auto-refresh every 8 seconds to reflect call status updates
    const interval = setInterval(fetchHistory, 8000);
    return () => clearInterval(interval);
  }, [token]);

  // Send typed query to active AI call
  const handleSendTextQuery = (qText: string) => {
    const clean = qText.trim();
    if (!clean || !callId) return;
    setTextInput('');
    setTranscripts(prev => [
      ...prev,
      {
        id: 'user_' + Date.now(),
        sender: 'customer',
        senderName: user?.name || 'You',
        text: clean,
        language: selectedLanguage,
        timestamp: new Date().toISOString()
      }
    ]);
    const socket = getSocket();
    socket.emit('call:query', {
      callId,
      query: clean,
      customerId: user?.id,
      duration,
      language: selectedLanguage,
      clientSentAt: Date.now()
    });
  };

  // Manually request human specialist escalation during AI call
  const handleEscalateToHuman = () => {
    if (!callId) return;
    const socket = getSocket();
    socket.emit('call:escalate', {
      callId,
      reason: 'Customer requested live human specialist'
    });
  };
  // Socket event listeners
  useEffect(() => {
    const socket = getSocket();

    // 1. Call ringing for Agent
    socket.on('customer:call_ringing', (data: { callId: string; agentName: string; preferredLanguage: string }) => {
      setCallStatus('ringing');
      setActivePartner({ name: data.agentName, role: 'agent', language: data.preferredLanguage });
    });

    // 2. Call queued
    socket.on('customer:call_queued', (data: { callId: string; queuePosition: number; estimatedWaitTime: number }) => {
      setCallStatus('queued');
      setQueueInfo({ position: data.queuePosition, estimatedWaitTime: data.estimatedWaitTime });
    });

    // 3. Queue position update
    socket.on('customer:queue_position_update', (data: { queuePosition: number; estimatedWaitTime: number }) => {
      setQueueInfo(prev => ({
        position: data.queuePosition,
        estimatedWaitTime: data.estimatedWaitTime
      }));
    });

    // 4. Queue cancelled
    socket.on('customer:queue_cancelled', () => {
      cleanupCall();
    });

    // 4b. Agent declined/rejected call
    socket.on('customer:call_declined', (data: { callId: string; reason?: string }) => {
      console.log('[Customer] Support call declined:', data.reason);
      cleanupCall();
      alert(data.reason || 'Support Specialist is currently unavailable or declined the call. Please try again shortly.');
    });

    // 5. Agent accepted call -> WebRTC audio connected
    socket.on('customer:call_accepted', async (data: {
      callId: string;
      agentId: string;
      agentName: string;
      agentSocketId: string;
      preferredLanguage: string;
      languageName: string;
    }) => {
      console.log('[Customer] Agent accepted call:', data.agentName);
      setCallStatus('active_agent');
      setQueueInfo(null);
      setActivePartner({ id: data.agentId, name: data.agentName, role: 'agent', language: data.preferredLanguage });

      setTranscripts(prev => [
        ...prev,
        {
          id: 't_' + Date.now(),
          sender: 'system',
          senderName: 'System',
          text: `Connected with Support Specialist ${data.agentName}. Language: ${data.languageName}. Two-way voice established.`,
          timestamp: new Date().toISOString()
        }
      ]);

      // Establish WebRTC connection to Agent
      try {
        await webrtcManager.startCall(data.agentSocketId, data.callId);
        // Start live human speech recognition in customer's preferred language
        voiceService.setLanguage(selectedLanguage);
        startSpeechRecognition(data.callId, true);
      } catch (err) {
        console.error('Failed to establish WebRTC with Agent:', err);
      }
    });

    // 6. AI Voice call ready
    socket.on('call:ready', (data: { callId: string; greeting: string; language: string; audioUrl?: string }) => {
      setCallStatus('active_ai');
      setActivePartner({ name: 'KAIRA AI', role: 'ai', language: data.language });
      setTranscripts(prev => [
        ...prev,
        {
          id: 't_' + Date.now(),
          sender: 'ai',
          senderName: 'KAIRA AI',
          text: data.greeting,
          language: data.language,
          timestamp: new Date().toISOString()
        }
      ]);

      setAiIsSpeaking(true);
      aiIsSpeakingRef.current = true;
      currentAiSpeechTextRef.current = data.greeting;

      // Start listening right away so customer can interrupt or speak naturally
      startSpeechRecognition(data.callId, false);

      voiceService.speak(data.greeting, () => {
        setAiIsSpeaking(false);
        aiIsSpeakingRef.current = false;
        currentAiSpeechTextRef.current = '';
      }, data.language);
    });

    // 7. AI response
    socket.on('call:ai_response', (data: {
      answer: string;
      isTransferring: boolean;
      sources?: any[];
      language?: string;
      audioUrl?: string;
      latency?: { aiMs: number; totalRoundTripMs: number };
    }) => {
      // Calculate true round-trip latency
      const roundTrip = speechEndTimeRef.current ? (Date.now() - speechEndTimeRef.current) : (data.latency?.totalRoundTripMs || data.latency?.aiMs || 0);
      setLiveLatency(roundTrip);

      setAiIsSpeaking(true);
      aiIsSpeakingRef.current = true;
      currentAiSpeechTextRef.current = data.answer;

      setTranscripts(prev => {
        const isDuplicate = prev.some(t =>
          t.sender === 'ai' &&
          t.text.trim().toLowerCase() === data.answer.trim().toLowerCase() &&
          Math.abs(Date.now() - new Date(t.timestamp).getTime()) < 4000
        );
        if (isDuplicate) return prev;
        return [
          ...prev,
          {
            id: 't_' + Date.now(),
            sender: 'ai',
            senderName: 'KAIRA AI',
            text: data.answer,
            language: data.language || selectedLanguage,
            timestamp: new Date().toISOString()
          }
        ];
      });

      if (data.isTransferring) {
        setCallStatus('transferring');
      }

      // Ensure listening stays active for continuous dialogue and barge-in
      if (!data.isTransferring) {
        startSpeechRecognition(callId || '', false);
      }

      // Play synthesized natural speech in customer's preferred language
      voiceService.speak(data.answer, () => {
        setAiIsSpeaking(false);
        aiIsSpeakingRef.current = false;
        currentAiSpeechTextRef.current = '';
      }, data.language || selectedLanguage);
    });

    // 8. Admin transfer connected
    socket.on('transfer:connected', async (data: { callId: string; adminName: string; adminSocketId: string }) => {
      console.log('[Customer] Admin connected via transfer:', data.adminName);
      setCallStatus('active_admin');
      setActivePartner({ name: data.adminName, role: 'admin' });

      setTranscripts(prev => [
        ...prev,
        {
          id: 't_' + Date.now(),
          sender: 'system',
          senderName: 'System',
          text: `Live voice transfer connected! You are now speaking with Admin ${data.adminName}.`,
          timestamp: new Date().toISOString()
        }
      ]);

      voiceService.cancelSpeech();

      try {
        await webrtcManager.startCall(data.adminSocketId, data.callId);
        startSpeechRecognition(data.callId, true);
      } catch (err) {
        console.error('Failed to establish WebRTC with Admin:', err);
      }
    });

    // 8B. No staff available for live transfer
    socket.on('transfer:no_staff_available', (data: { callId: string; message: string; ticketId?: string }) => {
      console.warn('[Customer] Transfer notice - no staff online:', data.message);
      setTransferNotice({
        message: data.message,
        ticketId: data.ticketId
      });
      setTranscripts(prev => [
        ...prev,
        {
          id: 't_' + Date.now(),
          sender: 'system',
          senderName: 'System',
          text: data.message,
          timestamp: new Date().toISOString()
        }
      ]);
    });

    // 8C. Transfer rejected by staff
    socket.on('transfer:rejected_notice', (data: { message?: string }) => {
      const msg = data.message || 'Support agents are currently assisting other callers. Please leave a message or try again.';
      setTransferNotice({ message: msg });
      setTranscripts(prev => [
        ...prev,
        {
          id: 't_' + Date.now(),
          sender: 'system',
          senderName: 'System',
          text: msg,
          timestamp: new Date().toISOString()
        }
      ]);
    });

    // 8D. Mid-call language change confirmation
    socket.on('call:language_changed', (data: { callId: string; language: LanguageCode; languageName: string }) => {
      setSelectedLanguage(data.language);
      voiceService.setLanguage(data.language);
      setTranscripts(prev => [
        ...prev,
        {
          id: 't_' + Date.now(),
          sender: 'system',
          senderName: 'System',
          text: `Conversation language set to ${data.languageName}.`,
          timestamp: new Date().toISOString()
        }
      ]);
    });

    // 9. Live human speech transcript relay & translation (with deduplication)
    socket.on('call:live_transcript', (data: {
      sender: any;
      senderName: string;
      text: string;
      translation?: string;
      language?: string;
      timestamp: string;
    }) => {
      setTranscripts(prev => {
        const isDuplicate = prev.some(t =>
          t.sender === data.sender &&
          t.text.trim().toLowerCase() === data.text.trim().toLowerCase() &&
          Math.abs(Date.now() - new Date(t.timestamp).getTime()) < 4000
        );
        if (isDuplicate) return prev;
        return [
          ...prev,
          {
            id: 't_' + Date.now() + Math.random(),
            sender: data.sender,
            senderName: data.senderName,
            text: data.text,
            translation: data.translation,
            language: data.language,
            timestamp: data.timestamp || new Date().toISOString()
          }
        ];
      });
    });

    // 10. Call held & resumed
    socket.on('call:held', () => setIsCallHeld(true));
    socket.on('call:resumed', () => setIsCallHeld(false));

    // 11. Call ended
    socket.on('call:ended', (data: { callId: string; duration?: number }) => {
      setRatingComment('');
      setRatingVal(5);
      setRatingSubmitted(false);
      setRatingCallId(data.callId || callId);
      cleanupCall();
      fetchHistory();
    });

    // 12. Real-Time Customer Sentiment
    const handleSentimentUpdate = (data: any) => {
      setLiveSentiment(data);
    };
    socket.on('call:sentiment_update', handleSentimentUpdate);

    return () => {
      socket.off('customer:call_ringing');
      socket.off('customer:call_queued');
      socket.off('customer:queue_position_update');
      socket.off('customer:queue_cancelled');
      socket.off('customer:call_accepted');
      socket.off('call:ready');
      socket.off('call:ai_response');
      socket.off('transfer:connected');
      socket.off('call:language_changed');
      socket.off('call:live_transcript');
      socket.off('call:held');
      socket.off('call:resumed');
      socket.off('call:ended');
      socket.off('call:sentiment_update', handleSentimentUpdate);
    };
  }, [callId, callStatus, user, selectedLanguage]);

  // Speech recognition helper with automatic interruption and Echo Guard
  const startSpeechRecognition = (activeCallId: string, isHumanCall: boolean = false) => {
    voiceService.setLanguage(selectedLanguage);

    voiceService.onInterruption = () => {
      voiceService.cancelSpeech();
      setAiIsSpeaking(false);
      aiIsSpeakingRef.current = false;
      currentAiSpeechTextRef.current = '';
      setWasInterrupted(true);
      setTimeout(() => setWasInterrupted(false), 2500);
      const socket = getSocket();
      socket.emit('call:interrupt', { callId: activeCallId });
    };

    voiceService.onSpeechStart = () => {
      setIsCustomerSpeaking(true);
    };

    voiceService.startListening((text, isFinal) => {
      const trimmed = text.trim();

      // --- ECHO GUARD & NATURAL VOICE INTERRUPTION (BARGE-IN) ---
      if (!isHumanCall && trimmed.length > 0 && (aiIsSpeakingRef.current || (typeof window !== 'undefined' && window.speechSynthesis?.speaking))) {
        const isAiEcho = currentAiSpeechTextRef.current &&
          currentAiSpeechTextRef.current.toLowerCase().trim().startsWith(trimmed.toLowerCase()) &&
          trimmed.length < 6;

        if (!isAiEcho) {
          voiceService.cancelSpeech();
          setAiIsSpeaking(false);
          aiIsSpeakingRef.current = false;
          currentAiSpeechTextRef.current = '';
          setWasInterrupted(true);
          setTimeout(() => setWasInterrupted(false), 2500);
          const socket = getSocket();
          socket.emit('call:interrupt', { callId: activeCallId });
        }
      }

      if (!isFinal) {
        setInterimText(text);
      } else {
        setInterimText('');
        setIsCustomerSpeaking(false);
        if (!trimmed) return;

        speechEndTimeRef.current = Date.now();

        setTranscripts(prev => {
          const isDup = prev.some(t =>
            t.sender === 'customer' &&
            t.text.trim().toLowerCase() === text.trim().toLowerCase() &&
            Math.abs(Date.now() - new Date(t.timestamp).getTime()) < 3000
          );
          if (isDup) return prev;
          return [
            ...prev,
            {
              id: 't_' + Date.now(),
              sender: 'customer',
              senderName: user?.name || 'Customer',
              text: text.trim(),
              language: selectedLanguage,
              timestamp: new Date().toISOString()
            }
          ];
        });

        const socket = getSocket();
        if (isHumanCall) {
          socket.emit('call:live_speech', {
            callId: activeCallId,
            sender: 'customer',
            senderName: user?.name || 'Customer',
            text: text.trim(),
            language: selectedLanguage
          });
        } else {
          socket.emit('call:query', {
            callId: activeCallId,
            query: text.trim(),
            customerId: user?.id,
            duration,
            language: selectedLanguage,
            clientSentAt: speechEndTimeRef.current
          });
        }
      }
    });
  };

  // Export transcript as clean text document
  const handleDownloadTranscript = (transcriptList: CallTranscript[], title: string = 'KAIRA-Call-Transcript') => {
    if (transcriptList.length === 0) return;
    const header = `=================================================\nKAIRA Voice Platform - Call Transcript\nDate: ${new Date().toLocaleString()}\nLanguage: ${selectedLanguage}\n=================================================\n\n`;
    const body = transcriptList.map(tItem => {
      const time = tItem.timestamp ? new Date(tItem.timestamp).toLocaleTimeString() : '';
      const speaker = tItem.senderName || (tItem.sender === 'customer' ? 'Customer' : tItem.sender === 'ai' ? 'KAIRA AI' : 'Agent');
      return `[${time}] ${speaker}:\n${tItem.text}${tItem.translation ? `\n(Translation: ${tItem.translation})` : ''}\n`;
    }).join('\n');

    const blob = new Blob([header + body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title}-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 1. Customer initiates Support Agent Voice Call
  const handleStartAgentCall = async () => {
    try {
      // Check microphone permission first
      const perm = await audioDeviceManager.checkMicrophonePermission();
      if (perm.state === 'denied') {
        setShowAudioDeviceModal(true);
        return;
      }

      voiceService.unlockAudio();
      webrtcManager.unlockAudio();
      setCallStatus('connecting');
      setDuration(0);
      setTranscripts([]);
      setActivePartner(null);
      setIsCallHeld(false);

      // Access microphone
      await webrtcManager.getMicrophoneStream();
      voiceService.setLanguage(selectedLanguage);

      const newCallId = 'kaira_agent_call_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      setCallId(newCallId);

      const socket = getSocket();
      socket.emit('customer:call_agent', {
        callId: newCallId,
        customerId: user?.id,
        customerName: user?.name,
        customerEmail: user?.email,
        customerPhone: user?.phone,
        preferredLanguage: selectedLanguage
      });
    } catch (err) {
      console.error('Microphone access denied:', err);
      setCallStatus('idle');
      setShowAudioDeviceModal(true);
    }
  };

  // 2. Customer initiates AI Voice Assistant Call
  const handleStartAiCall = async () => {
    try {
      // Check microphone permission first
      const perm = await audioDeviceManager.checkMicrophonePermission();
      if (perm.state === 'denied') {
        setShowAudioDeviceModal(true);
        return;
      }

      voiceService.unlockAudio();
      webrtcManager.unlockAudio();
      setCallStatus('connecting');
      setDuration(0);
      setTranscripts([]);
      setActivePartner(null);
      setIsCallHeld(false);

      await webrtcManager.getMicrophoneStream();
      voiceService.setLanguage(selectedLanguage);

      const newCallId = 'kaira_ai_call_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      setCallId(newCallId);

      const socket = getSocket();
      socket.emit('call:start', {
        callId: newCallId,
        customerId: user?.id,
        customerName: user?.name,
        customerEmail: user?.email,
        customerPhone: user?.phone,
        language: selectedLanguage
      });
    } catch (err) {
      console.error('Microphone access denied:', err);
      setCallStatus('idle');
      setShowAudioDeviceModal(true);
    }
  };

  // 3. Cancel waiting in queue
  const handleCancelQueue = () => {
    if (callId) {
      const socket = getSocket();
      socket.emit('customer:cancel_queue', { callId });
    }
    cleanupCall();
  };

  // 4. End Call
  const handleEndCall = () => {
    if (callId) {
      const socket = getSocket();
      socket.emit('call:end', { callId, duration, endedBy: 'customer' });
      setRatingComment('');
      setRatingVal(5);
      setRatingSubmitted(false);
      setRatingCallId(callId);
    }
    cleanupCall();
    fetchHistory();
  };

  const cleanupCall = () => {
    setCallStatus('idle');
    setCallId(null);
    setAiIsSpeaking(false);
    aiIsSpeakingRef.current = false;
    currentAiSpeechTextRef.current = '';
    setWasInterrupted(false);
    setLiveLatency(null);
    setIsCustomerSpeaking(false);
    speechEndTimeRef.current = null;
    setInterimText('');
    setIsCallHeld(false);
    setQueueInfo(null);
    setLiveSentiment(null);
    setTransferNotice(null);
    voiceService.cancelSpeech();
    voiceService.stopListening();
    webrtcManager.endCall();
    setTimeout(fetchHistory, 600);
  };

  // Submit Rating
  const handleRatingSubmit = async (stars: number) => {
    setRatingVal(stars);
    if (ratingCallId && token) {
      try {
        const response = await fetch(`/api/calls/${ratingCallId}/rating`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ rating: stars, comment: ratingComment })
        });
        if (!response.ok) throw new Error('Could not save call feedback');
      } catch (e) {
        console.error('Failed to save call feedback:', e);
        window.alert('Could not save your feedback. Please try again.');
        return;
      }
    }
    setRatingSubmitted(true);
    setTimeout(() => {
      setRatingCallId(null);
      setRatingSubmitted(false);
    }, 2500);
  };

  // Toggle Mute
  const handleToggleMute = () => {
    const muted = webrtcManager.toggleMute();
    setIsMuted(muted);
  };

  // Change Volume
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    webrtcManager.setVolume(val);
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const isCallActive = ['connecting', 'ringing', 'queued', 'active_agent', 'active_ai', 'transferring', 'active_admin'].includes(callStatus);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Welcome & Language Selection Banner */}
      <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-indigo-800 rounded-3xl p-6 sm:p-8 text-white shadow-xl shadow-blue-100 relative overflow-hidden">
        <div className="absolute -right-10 -bottom-10 w-72 h-72 rounded-full bg-white/10 blur-2xl pointer-events-none" />
        <div className="relative z-10 max-w-3xl space-y-4">
          <div className="flex items-center gap-2">

            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-rose-50 border border-rose-200 rounded-lg">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-600 animate-ping" />
              <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider">REC</span>
            </div>

            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-white/20 text-white backdrop-blur-xs border border-white/20">
              <Sparkles className="w-3.5 h-3.5" />
              {t('dashboard.platform_badge')}
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-400/20 text-emerald-200 border border-emerald-400/30">
              {t('dashboard.supported_languages_badge')}
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            {t('dashboard.welcome_user', { name: user?.name || 'Valued Customer' })}
          </h1>
          <p className="text-blue-100 text-sm leading-relaxed">
            {t('dashboard.banner_desc')}
          </p>

          {/* 6 Languages Selector */}
          <div className="pt-2">
            <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-blue-200">
              <Globe className="w-4 h-4 text-blue-300" />
              <span>{t('dashboard.select_language_title')}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5">
              {(Object.entries(SUPPORTED_LANGUAGES) as [LanguageCode, typeof SUPPORTED_LANGUAGES[LanguageCode]][]).map(([code, meta]) => {
                const isSelected = selectedLanguage === code;
                return (
                  <button
                    key={code}
                    disabled={isCallActive}
                    onClick={() => handleLanguageChange(code)}
                    className={`px-3 py-2.5 rounded-2xl text-left border transition-all cursor-pointer ${isSelected
                      ? 'bg-white text-indigo-900 border-white shadow-md font-bold scale-[1.02]'
                      : 'bg-white/10 text-white border-white/20 hover:bg-white/20 hover:border-white/40'
                      } ${isCallActive ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    <div className="text-sm font-extrabold leading-tight">{meta.nativeName}</div>
                    <div className={`text-[11px] ${isSelected ? 'text-indigo-600 font-semibold' : 'text-blue-200'}`}>
                      {meta.name}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Main Calling Stage Console */}
      <div className="bg-white rounded-3xl shadow-xl shadow-slate-100 border border-slate-200/80 overflow-hidden">
        {/* Top Session Bar */}
        <div className="px-6 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4 bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div
              className={`w-3.5 h-3.5 rounded-full ${callStatus === 'idle'
                ? 'bg-slate-300'
                : callStatus === 'queued'
                  ? 'bg-amber-500 animate-pulse'
                  : callStatus === 'ringing'
                    ? 'bg-indigo-500 animate-ping'
                    : 'bg-emerald-500 animate-pulse'
                }`}
            />
            <div>
              <h2 className="text-sm font-bold text-slate-800">{t('call.session_title')}</h2>
              <p className="text-xs text-slate-500">
                {callStatus === 'idle' && t('call.status_ready', { language: SUPPORTED_LANGUAGES[selectedLanguage]?.name, nativeName: SUPPORTED_LANGUAGES[selectedLanguage]?.nativeName })}
                {callStatus === 'connecting' && t('call.status_connecting')}
                {callStatus === 'ringing' && t('call.status_ringing', { name: activePartner?.name || 'Agent' })}
                {callStatus === 'queued' && t('call.status_queued', { position: queueInfo?.position || 1 })}
                {callStatus === 'active_agent' && t('call.status_active_agent', { name: activePartner?.name || '', language: SUPPORTED_LANGUAGES[selectedLanguage]?.name })}
                {callStatus === 'active_ai' && (aiIsSpeaking ? t('call.status_ai_speaking') : t('call.status_ai_listening'))}
                {callStatus === 'transferring' && t('call.status_transferring')}
                {callStatus === 'active_admin' && t('call.status_active_admin', { name: activePartner?.name || '' })}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
            {/* Live Call Quality Indicator */}
            <CallQualityIndicator isCallActive={isCallActive} />

            {/* Audio Device Settings Button */}
            <button
              onClick={() => setShowAudioDeviceModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:border-blue-400 hover:bg-blue-50 text-slate-700 hover:text-blue-700 rounded-xl text-xs font-semibold shadow-2xs transition-all cursor-pointer"
              title="Audio & Microphone Settings"
            >
              <Settings className="w-3.5 h-3.5 text-slate-500" />
              <span className="hidden sm:inline">Audio Settings</span>
            </button>

            {/* Live Timer */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-700 shadow-2xs">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              {formatDuration(duration)}
            </div>

            {/* Microphone Status */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-600 shadow-2xs">
              {isMuted ? (
                <>
                  <MicOff className="w-3.5 h-3.5 text-red-500" />
                  <span className="text-red-600 font-semibold">{t('call.mic_muted')}</span>
                </>
              ) : (
                <>
                  <Mic className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-slate-700 font-semibold">{t('call.mic_live')}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Central Call Actions & Active UI */}
        <div className="p-8 text-center flex flex-col items-center justify-center">
          {callStatus === 'idle' && (
            <div className="w-full max-w-2xl py-4 space-y-6">
              {/* PRIMARY HERO: Call KAIRA AI Voice Agent */}
              <div className="p-8 rounded-3xl border-2 border-indigo-200/80 bg-gradient-to-br from-indigo-50/80 via-white to-blue-50/50 text-left shadow-xl shadow-indigo-100/50 relative overflow-hidden transition-all hover:border-indigo-400">
                <div className="absolute -top-12 -right-12 w-48 h-48 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />

                <div className="relative z-10 space-y-5">
                  <div className="flex items-center justify-between">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-600 to-teal-500 text-white flex items-center justify-center shadow-lg shadow-indigo-500/30">
                      <Bot className="w-9 h-9" />
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      24/7 INSTANT AI SUPPORT • NO WAITING
                    </span>
                  </div>

                  <div>
                    <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">
                      Call KAIRA AI Voice Agent
                    </h3>
                    <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                      Instant, human-like voice conversation in <strong>{SUPPORTED_LANGUAGES[selectedLanguage]?.name} ({SUPPORTED_LANGUAGES[selectedLanguage]?.nativeName})</strong>. Connect directly to our autonomous AI voice agent with zero wait time. Answers questions on products, pricing, policies, technical issues, account inquiries, and general topics with continuous dialogue and voice interruption.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-500">
                    <span className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-indigo-700 flex items-center gap-1 shadow-2xs">
                      ⚡ Ultra-fast speech (&lt;1.2s)
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 flex items-center gap-1 shadow-2xs">
                      🌐 6 Regional Languages
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 flex items-center gap-1 shadow-2xs">
                      🎙️ Voice Interruption
                    </span>
                  </div>

                  <button
                    onClick={handleStartAiCall}
                    className="w-full min-h-[54px] py-4 rounded-2xl bg-gradient-to-r from-indigo-600 via-blue-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white font-extrabold text-base shadow-xl shadow-indigo-600/30 hover:shadow-2xl active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-3"
                  >
                    <PhoneCall className="w-5 h-5 animate-bounce" />
                    <span>Call AI Voice Agent Now</span>
                  </button>
                </div>
              </div>

              {/* SECONDARY OPTION: Live Support Specialist */}
              <div className="p-4 sm:p-5 rounded-2xl border border-slate-200/90 bg-white text-left flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                    <Headphones className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-800">Prefer human assistance?</h4>
                    <p className="text-[11px] text-slate-500">
                      Connect with an authorized customer support specialist.
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleStartAgentCall}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 hover:border-slate-400 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold cursor-pointer transition-colors flex items-center justify-center gap-2"
                >
                  <PhoneCall className="w-3.5 h-3.5 text-slate-500" />
                  <span>Call Human Agent</span>
                </button>
              </div>
            </div>
          )}

          {/* Queue Waiting Screen */}
          {callStatus === 'queued' && (
            <div className="w-full max-w-md py-6 space-y-6">
              <div className="w-20 h-20 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto animate-pulse">
                <Users className="w-10 h-10" />
              </div>
              <div className="space-y-2">
                <span className="px-3 py-1 rounded-full text-xs font-extrabold bg-amber-50 text-amber-800 border border-amber-200">
                  {t('queue.all_busy')}
                </span>
                <h3 className="text-xl font-extrabold text-slate-900">{t('queue.in_queue_title')}</h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Your call is a request until an agent accepts it. {t('queue.in_queue_desc', { language: SUPPORTED_LANGUAGES[selectedLanguage]?.name })}
                </p>
              </div>

              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-around">
                <div>
                  <div className="text-xs text-slate-400 font-semibold uppercase">{t('queue.position_label')}</div>
                  <div className="text-2xl font-black text-indigo-700">#{queueInfo?.position || 1}</div>
                </div>
                <div className="h-8 w-px bg-slate-200" />
                <div>
                  <div className="text-xs text-slate-400 font-semibold uppercase">{t('queue.wait_time_label')}</div>
                  <div className="text-2xl font-black text-slate-800">~{queueInfo?.estimatedWaitTime || 45}s</div>
                </div>
              </div>

              <button
                onClick={handleCancelQueue}
                className="px-6 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors cursor-pointer"
              >
                {t('queue.cancel_btn')}
              </button>
            </div>
          )}

          {/* Active Call State Graphic & Controls */}
          {['connecting', 'ringing', 'active_agent', 'active_ai', 'transferring', 'active_admin'].includes(callStatus) && (
            <div className="w-full max-w-xl space-y-6 py-2">
              {/* Caller Identity Indicator */}
              <div className="mx-auto flex flex-wrap items-center justify-between gap-3 px-5 py-3 bg-slate-50 border border-slate-200/90 rounded-2xl shadow-xs text-left w-full">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-sm shadow-xs">
                    {user?.name?.charAt(0) || 'C'}
                  </div>
                  <div>
                    <div className="text-xs font-black text-slate-900">{user?.name || 'Customer'}</div>
                    <div className="text-[11px] text-slate-500 font-mono flex flex-wrap items-center gap-2">
                      <span>ID: #{user?.id ? user.id.slice(-8).toUpperCase() : 'CUST-001'}</span>
                      {user?.email && <span>• {user.email}</span>}
                      {user?.phone && <span>• Tel: {user.phone}</span>}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                    Language: {SUPPORTED_LANGUAGES[selectedLanguage]?.name}
                  </span>
                </div>
              </div>

              {/* Dedicated AI Agent Avatar with Real-time State Indicators */}
              <div className="relative flex flex-col items-center justify-center py-4">
                <div className="relative mb-3">
                  {/* Visual Status Halo Ring */}
                  <div
                    className={`w-28 h-28 rounded-full flex items-center justify-center transition-all duration-500 ${
                      aiVisualState === 'speaking'
                        ? 'bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 p-1 animate-pulse shadow-xl shadow-indigo-500/40 ring-4 ring-indigo-300/50'
                        : aiVisualState === 'thinking'
                          ? 'bg-gradient-to-tr from-amber-400 via-purple-500 to-indigo-600 p-1 animate-spin shadow-lg shadow-amber-400/30'
                          : aiVisualState === 'listening'
                            ? 'bg-gradient-to-tr from-emerald-500 to-teal-400 p-1 shadow-lg shadow-emerald-500/30 ring-4 ring-emerald-300/40 animate-pulse'
                            : 'bg-slate-200 p-1 shadow-xs'
                    }`}
                  >
                    <div className="w-full h-full bg-white rounded-full flex items-center justify-center shadow-inner">
                      <div className="w-22 h-22 rounded-full bg-gradient-to-tr from-indigo-600 to-teal-600 text-white flex items-center justify-center shadow-md">
                        {aiVisualState === 'speaking' ? (
                          <Volume2 className="w-10 h-10 animate-bounce" />
                        ) : aiVisualState === 'thinking' ? (
                          <Sparkles className="w-10 h-10 animate-spin" />
                        ) : (
                          <Bot className="w-10 h-10" />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Connected Live Badge */}
                  <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap px-3 py-0.5 bg-white border border-slate-200 rounded-full shadow-xs flex items-center gap-1.5 text-[10px] font-bold text-slate-700">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                    <span>CONNECTED</span>
                  </div>
                </div>

                <h3 className="text-base font-extrabold text-slate-900 mt-2">
                  {activePartner?.name || 'KAIRA AI Support Specialist'}
                </h3>
                <p className="text-xs text-slate-500">
                  AI-Powered Voice Customer Support Platform
                </p>

                {/* Status Indicator Banners */}
                <div className="mt-3">
                  {aiVisualState === 'listening' && (
                    <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold animate-pulse">
                      <Mic className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Listening... (Speak your question now)</span>
                    </div>
                  )}

                  {aiVisualState === 'thinking' && (
                    <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold animate-pulse">
                      <Sparkles className="w-3.5 h-3.5 text-amber-600 animate-spin" />
                      <span>Thinking & searching Knowledge Base...</span>
                    </div>
                  )}

                  {aiVisualState === 'speaking' && (
                    <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-800 text-xs font-bold animate-pulse">
                      <Volume2 className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Speaking with natural AI voice...</span>
                    </div>
                  )}

                  {aiVisualState === 'idle' && callStatus === 'connecting' && (
                    <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold">
                      <Radio className="w-3.5 h-3.5 text-slate-500 animate-pulse" />
                      <span>Connecting call session...</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Soundwave animation with conversational state indication */}
              <div className="h-24 flex flex-col items-center justify-center gap-3 py-2">
                <div className="flex items-center justify-center gap-1.5">
                  <span className={`w-1.5 rounded-full ${aiVisualState === 'speaking' || aiIsSpeaking ? 'bg-indigo-600 animate-soundwave-1' : (aiVisualState === 'listening' || isCustomerSpeaking) ? 'bg-emerald-500 animate-soundwave-1' : 'bg-slate-300 h-3'}`} />
                  <span className={`w-1.5 rounded-full ${aiVisualState === 'speaking' || aiIsSpeaking ? 'bg-indigo-600 animate-soundwave-2' : (aiVisualState === 'listening' || isCustomerSpeaking) ? 'bg-emerald-500 animate-soundwave-2' : 'bg-slate-300 h-5'}`} />
                  <span className={`w-1.5 rounded-full ${aiVisualState === 'speaking' || aiIsSpeaking ? 'bg-indigo-600 animate-soundwave-3' : (aiVisualState === 'listening' || isCustomerSpeaking) ? 'bg-emerald-500 animate-soundwave-3' : 'bg-slate-300 h-8'}`} />
                  <span className={`w-1.5 rounded-full ${aiVisualState === 'speaking' || aiIsSpeaking ? 'bg-indigo-600 animate-soundwave-4' : (aiVisualState === 'listening' || isCustomerSpeaking) ? 'bg-emerald-500 animate-soundwave-4' : 'bg-slate-300 h-4'}`} />
                  <span className={`w-1.5 rounded-full ${aiVisualState === 'speaking' || aiIsSpeaking ? 'bg-indigo-600 animate-soundwave-5' : (aiVisualState === 'listening' || isCustomerSpeaking) ? 'bg-emerald-500 animate-soundwave-5' : 'bg-slate-300 h-7'}`} />
                  <span className={`w-1.5 rounded-full ${aiVisualState === 'speaking' || aiIsSpeaking ? 'bg-indigo-600 animate-soundwave-2' : (aiVisualState === 'listening' || isCustomerSpeaking) ? 'bg-emerald-500 animate-soundwave-2' : 'bg-slate-300 h-5'}`} />
                  <span className={`w-1.5 rounded-full ${aiVisualState === 'speaking' || aiIsSpeaking ? 'bg-indigo-600 animate-soundwave-4' : (aiVisualState === 'listening' || isCustomerSpeaking) ? 'bg-emerald-500 animate-soundwave-4' : 'bg-slate-300 h-3'}`} />
                </div>

                {/* State Pills */}
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {callStatus === 'active_ai' && (
                    <>
                      {(aiVisualState === 'speaking' || aiIsSpeaking) ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                          <Volume2 className="w-3.5 h-3.5 text-indigo-600 animate-pulse" />
                          KAIRA AI is Speaking
                        </span>
                      ) : aiVisualState === 'thinking' ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                          <Sparkles className="w-3.5 h-3.5 text-amber-600 animate-spin" />
                          AI is Thinking & Searching...
                        </span>
                      ) : (aiVisualState === 'listening' || isCustomerSpeaking) ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <Mic className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
                          Listening to you (Speak freely)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-slate-50 text-slate-600 border border-slate-200">
                          <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                          Continuous Voice Dialogue Active
                        </span>
                      )}

                      {liveLatency !== null && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          ⚡ Latency: {liveLatency}ms
                        </span>
                      )}

                      {wasInterrupted && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-300 animate-pulse">
                          ⚡ Interrupted (Barge-in)
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Call Status Banners */}
              {callStatus === 'ringing' && (
                <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-2xl text-indigo-800 text-xs flex items-center justify-center gap-3 animate-pulse">
                  <PhoneCall className="w-5 h-5 text-indigo-600 shrink-0" />
                  <div className="text-left">
                    <p className="font-bold">{t('call.contacting_specialist')}</p>
                    <p className="text-indigo-700">{t('call.connecting_wait', { language: SUPPORTED_LANGUAGES[selectedLanguage]?.name })}</p>
                  </div>
                </div>
              )}

              {callStatus === 'active_agent' && (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 text-xs flex items-center justify-center gap-3">
                  <Headphones className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div className="text-left">
                    <p className="font-bold">{t('call.agent_connected', { name: activePartner?.name || '' })}</p>
                    <p className="text-emerald-700">
                      {t('call.two_way_active', {
                        language: SUPPORTED_LANGUAGES[selectedLanguage]?.name,
                        nativeName: SUPPORTED_LANGUAGES[selectedLanguage]?.nativeName
                      })}
                    </p>
                  </div>
                </div>
              )}

              {callStatus === 'transferring' && (
                <div className="p-5 bg-amber-50 border border-amber-200 rounded-3xl text-amber-900 text-xs space-y-3 shadow-xs">
                  <div className="flex items-center justify-center gap-3">
                    <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 animate-pulse" />
                    <div className="text-left">
                      <p className="font-bold">{t('call.transfer_in_progress')}</p>
                      <p className="text-amber-700 leading-relaxed">{transferNotice?.message || t('call.transfer_wait')}</p>
                    </div>
                  </div>

                  {transferNotice?.ticketId && (
                    <div className="bg-white/95 p-3 rounded-2xl border border-amber-200/80 text-center font-medium shadow-2xs">
                      <span className="text-slate-600">Priority Support Ticket Created: </span>
                      <span className="font-bold text-amber-800 font-mono">#{transferNotice.ticketId.slice(-6).toUpperCase()}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-center gap-2 pt-1">
                    <button
                      onClick={() => {
                        setCallStatus('active_ai');
                        setTransferNotice(null);
                        startSpeechRecognition(callId || '', false);
                      }}
                      className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-xs transition-all cursor-pointer"
                    >
                      Return to AI Assistant
                    </button>
                    <button
                      onClick={handleEndCall}
                      className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs shadow-xs transition-all cursor-pointer"
                    >
                      End Call
                    </button>
                  </div>
                </div>
              )}

              {isCallHeld && (
                <div className="p-3 bg-amber-100 border border-amber-300 text-amber-900 rounded-2xl text-xs font-bold animate-pulse">
                  {t('call.call_on_hold')}
                </div>
              )}

              {/* In-Call Controls */}
              <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4 pt-2">
                {/* Mute Button with 48px touch target */}
                <button
                  type="button"
                  onClick={handleToggleMute}
                  className={`min-h-[48px] min-w-[48px] px-4 py-3 rounded-2xl border font-semibold text-xs transition-all cursor-pointer flex items-center gap-2 active:scale-95 shadow-xs ${isMuted
                      ? 'bg-red-50 border-red-300 text-red-700 hover:bg-red-100 ring-2 ring-red-500/20'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                    }`}
                  title={isMuted ? t('call.unmute') : t('call.mute')}
                >
                  {isMuted ? <MicOff className="w-5 h-5 text-red-600" /> : <Mic className="w-5 h-5 text-emerald-600" />}
                  <span>{isMuted ? t('call.unmute') : t('call.mute')}</span>
                </button>

                {/* End Call Button with 48px touch target */}
                <button
                  type="button"
                  onClick={handleEndCall}
                  className="min-h-[48px] min-w-[140px] flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white font-bold text-sm shadow-lg shadow-red-500/25 active:scale-95 transition-all cursor-pointer border border-red-500/30"
                >
                  <PhoneOff className="w-5 h-5" />
                  <span>{t('call.end_call')}</span>
                </button>

                {/* Optional Request Human Escalation during AI Call */}
                {callStatus === 'active_ai' && (
                  <button
                    type="button"
                    onClick={handleEscalateToHuman}
                    className="min-h-[48px] px-4 py-3 rounded-2xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 font-semibold text-xs flex items-center gap-2 cursor-pointer shadow-xs active:scale-95 transition-all"
                    title="Transfer this call to a human support specialist"
                  >
                    <Headphones className="w-4 h-4 text-amber-600" />
                    <span>Talk to Human</span>
                  </button>
                )}

                {/* Speaker Volume */}
                <div className="flex items-center gap-2 px-3.5 py-2.5 bg-white border border-slate-200 rounded-2xl shadow-xs" title={t('call.speaker_volume')}>
                  {volume === 0 ? <VolumeX className="w-4 h-4 text-slate-400" /> : <Volume2 className="w-4 h-4 text-slate-600" />}
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={volume}
                    onChange={handleVolumeChange}
                    className="w-20 sm:w-24 accent-indigo-600 cursor-pointer"
                    aria-label="Volume slider"
                  />
                </div>
              </div>

              {/* Suggested Questions for AI Call */}
              {callStatus === 'active_ai' && (
                <div className="pt-4 space-y-3 w-full">
                  <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-500">
                    <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                    <span>Suggested Questions (Click to Ask):</span>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    {SUGGESTED_QUESTIONS.map((q) => (
                      <button
                        key={q}
                        onClick={() => handleSendTextQuery(q)}
                        className="px-3 py-1.5 bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 rounded-xl text-xs text-slate-700 hover:text-indigo-700 transition-all cursor-pointer font-medium"
                      >
                        {q}
                      </button>
                    ))}
                  </div>

                  {/* Text Input Option for Quiet Environments */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSendTextQuery(textInput);
                    }}
                    className="flex gap-2 max-w-md mx-auto pt-2"
                  >
                    <input
                      type="text"
                      placeholder="Type a question to the AI..."
                      value={textInput}
                      onChange={(e) => setTextInput(e.target.value)}
                      className="flex-1 px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    />
                    <button
                      type="submit"
                      disabled={!textInput.trim()}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Send</span>
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Real-time Customer Sentiment Indicator */}
        {callStatus !== 'idle' && (
          <div className="px-6 py-3 border-t border-slate-200/80 bg-slate-50/40">
            <LiveSentimentCard
              sentiment={liveSentiment?.sentiment}
              confidenceScore={liveSentiment?.confidenceScore}
              reason={liveSentiment?.reason}
              triggerText={liveSentiment?.triggerText}
              requiresHumanAssistance={liveSentiment?.requiresHumanAssistance}
            />
          </div>
        )}

        {/* Live Conversation Transcript */}
        <div className="border-t border-slate-200/80 bg-slate-50/60 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-indigo-600" />
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                {t('transcript.title')}
              </h3>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-slate-400">
                {t('transcript.exchanges_recorded', { count: transcripts.length })}
              </span>
              {transcripts.length > 0 && (
                <button
                  onClick={() => handleDownloadTranscript(transcripts, `KAIRA-LiveCall-${callId || 'active'}`)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-[11px] font-semibold text-slate-600 cursor-pointer shadow-2xs transition-colors"
                  title="Export call transcript as text file"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  Export .txt
                </button>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4 h-72 overflow-y-auto space-y-3.5 shadow-2xs">
            {transcripts.length === 0 && !interimText && (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 text-xs text-center p-4 space-y-3">
                <div>
                  <MessageSquare className="w-8 h-8 text-slate-300 mx-auto mb-2 stroke-1" />
                  <p>{t('transcript.empty_notice')}</p>
                </div>
                <div className="space-y-1.5 max-w-md pt-2">
                  <div className="flex items-center justify-center gap-1.5 text-[11px] font-semibold text-slate-500">
                    <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                    <span>Suggested questions (click or speak aloud):</span>
                  </div>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {SUGGESTED_QUESTIONS.map((q) => (
                      <span
                        key={q}
                        className="px-2.5 py-1 text-[11px] bg-indigo-50 text-indigo-700 border border-indigo-200/80 rounded-lg font-medium"
                      >
                        "{q}"
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {transcripts.map((tItem) => (
              <div
                key={tItem.id}
                className={`flex flex-col ${tItem.sender === 'customer'
                  ? 'items-end'
                  : tItem.sender === 'system'
                    ? 'items-center'
                    : 'items-start'
                  }`}
              >
                {tItem.sender === 'system' ? (
                  <span className="px-3 py-1 bg-amber-50 border border-amber-200 text-amber-800 text-[11px] rounded-full font-medium my-1">
                    {tItem.text}
                  </span>
                ) : (
                  <div className="max-w-[85%] sm:max-w-[75%] space-y-1">
                    <span className="text-[10px] font-semibold text-slate-400 px-1 block">
                      {tItem.senderName || (tItem.sender === 'customer' ? t('transcript.speaker_you') : tItem.sender === 'ai' ? t('transcript.speaker_ai') : t('transcript.speaker_agent'))}
                    </span>
                    <div
                      className={`px-4 py-2.5 rounded-2xl text-xs leading-relaxed ${tItem.sender === 'customer'
                        ? 'bg-blue-600 text-white rounded-tr-xs shadow-xs'
                        : tItem.sender === 'ai'
                          ? 'bg-slate-100 text-slate-800 rounded-tl-xs border border-slate-200'
                          : 'bg-emerald-50 text-emerald-950 border border-emerald-200 rounded-tl-xs'
                        }`}
                    >
                      <div>{tItem.text}</div>
                      {/* Translation subtitle */}
                      {tItem.translation && (
                        <div className={`mt-1.5 pt-1.5 border-t text-[11px] font-normal italic ${tItem.sender === 'customer' ? 'border-blue-400/50 text-blue-100' : 'border-emerald-200 text-emerald-700'
                          }`}>
                          {t('transcript.translation_prefix', { text: tItem.translation })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {interimText && (
              <div className="flex flex-col items-end">
                <div className="max-w-[85%] px-4 py-2 bg-blue-50 text-blue-700 text-xs rounded-2xl rounded-tr-xs border border-blue-200 italic animate-pulse">
                  {interimText}...
                </div>
              </div>
            )}

            <div ref={transcriptEndRef} />
          </div>
        </div>
      </div>

      {/* Post-Call Rating Modal */}
      {ratingCallId && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-100 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-500 flex items-center justify-center mx-auto">
              <Star className="w-6 h-6 fill-amber-400" />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-900 text-base">{t('rating.title')}</h3>
              <p className="text-xs text-slate-500 mt-1">
                {t('rating.desc', { language: SUPPORTED_LANGUAGES[selectedLanguage]?.name })}
              </p>
            </div>

            {ratingSubmitted ? (
              <div className="p-3 bg-emerald-50 text-emerald-800 rounded-2xl text-xs font-bold flex items-center justify-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                {t('rating.thank_you')}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-center gap-2 py-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      onClick={() => setRatingVal(star)}
                      aria-label={`${star} star${star === 1 ? '' : 's'}`}
                      className="p-2 rounded-xl hover:scale-125 transition-transform text-amber-400 cursor-pointer"
                    >
                      <Star className={`w-6 h-6 ${star <= ratingVal ? 'fill-amber-400' : 'text-slate-300'}`} />
                    </button>
                  ))}
                </div>
                <textarea
                  value={ratingComment}
                  onChange={(e) => setRatingComment(e.target.value.slice(0, 1000))}
                  placeholder="Tell us what went well or what we could improve (optional)"
                  maxLength={1000}
                  rows={3}
                  className="w-full resize-none rounded-xl border border-slate-200 p-3 text-left text-xs text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                />
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>{ratingComment.length}/1000</span>
                  <button onClick={() => handleRatingSubmit(ratingVal)} className="rounded-xl bg-indigo-600 px-4 py-2 font-bold text-white hover:bg-indigo-700 cursor-pointer">
                    Submit feedback
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={() => setRatingCallId(null)}
              className="text-xs text-slate-400 hover:text-slate-600 font-semibold cursor-pointer"
            >
              {t('rating.skip')}
            </button>
          </div>
        </div>
      )}

      {/* Customer Call History Table */}
      <div className="bg-white rounded-3xl shadow-xl shadow-slate-100 border border-slate-200/80 p-6 sm:p-8 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-bold text-slate-900">{t('history.title')}</h2>
            {lastRefreshedAt && (
              <span className="hidden sm:inline-block text-[11px] text-slate-400 font-mono">
                • Updated {lastRefreshedAt.toLocaleTimeString()}
              </span>
            )}
          </div>
          <button
            type="button"
            disabled={loadingHistory}
            onClick={fetchHistory}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 border border-transparent hover:border-indigo-100 transition-all cursor-pointer active:scale-95 disabled:opacity-60"
            title="Refresh Call History"
          >
            <RefreshCw className={`w-3.5 h-3.5 transition-transform ${loadingHistory ? 'animate-spin text-indigo-700' : ''}`} />
            <span>{loadingHistory ? 'Refreshing...' : t('history.refresh')}</span>
          </button>
        </div>

        {loadingHistory && history.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">{t('history.loading')}</div>
        ) : history.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400">
            {t('history.empty')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 uppercase font-bold text-[10px] tracking-wider border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Customer Details</th>
                  <th className="py-3 px-4">Date & Time</th>
                  <th className="py-3 px-4">Duration</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">AI Agent Name</th>
                  <th className="py-3 px-4">Call Summary</th>
                  <th className="py-3 px-4">Resolution</th>
                  <th className="py-3 px-4 text-right">Recording & Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((call) => {
                  const resolution = call.intelligence?.resolutionStatus || call.conversationAnalysis?.resolutionStatus || 'resolved';
                  const summaryText = call.intelligence?.overallSummary || call.intelligence?.callReason || call.conversationAnalysis?.summary || call.customerQuestion || 'AI Voice support inquiry';
                  const recUrl = call.recordingUrl || (call.recording ? `/api/recordings/file/${call.recording.id}` : `/api/calls/${call.callId}/recording`);

                  return (
                    <tr key={call.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-extrabold text-slate-900 text-xs">
                          {call.customerName || call.customer?.name || user?.name || 'Customer'}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          ID: #{call.customerId ? call.customerId.slice(-6).toUpperCase() : (user?.id ? user.id.slice(-6).toUpperCase() : 'CUST')}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {call.customerPhone || call.customer?.phone || user?.phone || 'No phone'}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 font-medium text-slate-800">
                        <div>{new Date(call.startTime).toLocaleDateString()}</div>
                        <div className="text-[10px] text-slate-400">{new Date(call.startTime).toLocaleTimeString()}</div>
                      </td>

                      <td className="py-3.5 px-4 font-mono font-bold text-slate-700">
                        {formatDuration(call.duration)}
                      </td>

                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold capitalize ${
                            call.status === 'completed'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : call.status === 'active'
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'bg-slate-100 text-slate-700 border border-slate-200'
                          }`}
                        >
                          {call.status}
                        </span>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5">
                          <Bot className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                          <span className="font-bold text-indigo-950">
                            {call.agentName || (call.type === 'ai_voice' ? 'KAIRA AI Support Specialist' : call.type === 'admin_transfer' ? 'Admin' : 'Agent')}
                          </span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 max-w-xs">
                        <p className="line-clamp-2 text-[11px] text-slate-600 font-medium leading-relaxed" title={summaryText}>
                          {summaryText}
                        </p>
                      </td>

                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold capitalize ${
                            resolution === 'resolved'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : resolution === 'partially_resolved'
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : resolution === 'escalated_admin'
                                  ? 'bg-purple-50 text-purple-700 border border-purple-200'
                                  : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}
                        >
                          {resolution.replace('_', ' ')}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {/* Audio Playback button */}
                          {(call.recordingUrl || call.recording || call.recordingStatus === 'completed' || call.duration > 2) ? (
                            <button
                              onClick={() => handlePlayRecording(recUrl, call.id)}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer ${
                                playingRecordingId === call.id
                                  ? 'bg-red-600 text-white animate-pulse ring-2 ring-red-400'
                                  : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200'
                              }`}
                              title={playingRecordingId === call.id ? 'Pause Recording' : 'Listen to Call Recording'}
                            >
                              {playingRecordingId === call.id ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                              <span>{playingRecordingId === call.id ? 'Playing' : 'Listen'}</span>
                            </button>
                          ) : (
                            <span className="text-[10px] text-slate-400 italic">No audio</span>
                          )}

                          {/* View Transcript modal button */}
                          <button
                            onClick={() => setSelectedHistoryCall(call)}
                            className="p-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg border border-slate-200 cursor-pointer shadow-2xs"
                            title="View Transcript & Intelligence"
                          >
                            <FileText className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Customer Support Tickets Section */}
      <div className="bg-white rounded-3xl shadow-xl shadow-slate-100 border border-slate-200/80 p-6 sm:p-8 space-y-4">
        <SupportTickets isCustomerView={true} />
      </div>

      {/* Transcript Modal for Historical Calls */}
      {selectedHistoryCall && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">{t('history.modal_title')}</h3>
                <p className="text-[11px] text-slate-500 font-mono">
                  {new Date(selectedHistoryCall.startTime).toLocaleString()} • Duration: {formatDuration(selectedHistoryCall.duration)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {selectedHistoryCall.transcripts && selectedHistoryCall.transcripts.length > 0 && (
                  <button
                    onClick={() => handleDownloadTranscript(selectedHistoryCall.transcripts as any, `KAIRA-History-${selectedHistoryCall.id}`)}
                    className="p-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-600 cursor-pointer"
                    title="Export transcript as text"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => setSelectedHistoryCall(null)}
                  className="text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer"
                >
                  ✕ {t('history.modal_close')}
                </button>
              </div>
            </div>

            {/* Audio Recording Playback in Modal */}
            {(selectedHistoryCall.recordingUrl || selectedHistoryCall.recording || selectedHistoryCall.recordingStatus === 'completed' || selectedHistoryCall.duration > 2) && (
              <div className="p-3 bg-indigo-50/70 border border-indigo-200/80 rounded-2xl flex items-center justify-between gap-3 shadow-2xs">
                <div className="flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-indigo-600" />
                  <div>
                    <span className="text-xs font-bold text-indigo-950 block">Call Recording Audio</span>
                    <span className="text-[10px] text-indigo-600 font-mono">Format: WebM / Opus HD</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handlePlayRecording(selectedHistoryCall.recordingUrl || `/api/calls/${selectedHistoryCall.callId}/recording`, selectedHistoryCall.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer ${
                      playingRecordingId === selectedHistoryCall.id
                        ? 'bg-red-600 text-white animate-pulse'
                        : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                    }`}
                  >
                    {playingRecordingId === selectedHistoryCall.id ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    <span>{playingRecordingId === selectedHistoryCall.id ? 'Pause' : 'Play Audio'}</span>
                  </button>
                  <a
                    href={selectedHistoryCall.recordingUrl || `/api/calls/${selectedHistoryCall.callId}/recording`}
                    download={`call-${selectedHistoryCall.callId}.webm`}
                    className="p-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl cursor-pointer"
                    title="Download Audio File"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            )}

            {/* Post-Call Sentiment Evaluation */}
            <PostCallSentimentSummary
              overallSentiment={selectedHistoryCall.overallSentiment}
              sentimentScore={selectedHistoryCall.sentimentScore}
              customerExperience={selectedHistoryCall.sentimentRecords?.find(r => r.isFinal)?.customerExperienceNote}
              frustrationDetected={selectedHistoryCall.overallSentiment === 'FRUSTRATED'}
              requiresAssistance={selectedHistoryCall.requiresAssistance}
              assistanceReason={selectedHistoryCall.assistanceReason}
            />


            {/* AI Call Intelligence Summary if generated */}
            {selectedHistoryCall.intelligence && (
              <div className="p-3.5 bg-gradient-to-r from-purple-50/80 to-indigo-50/80 border border-purple-100 rounded-2xl space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-bold text-purple-900">
                    <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                    AI Call Summary
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${selectedHistoryCall.intelligence.resolutionStatus === 'resolved'
                      ? 'bg-emerald-100 text-emerald-800'
                      : selectedHistoryCall.intelligence.resolutionStatus === 'partially_resolved'
                        ? 'bg-blue-100 text-blue-800'
                        : selectedHistoryCall.intelligence.resolutionStatus === 'escalated_admin'
                          ? 'bg-purple-100 text-purple-800'
                          : 'bg-amber-100 text-amber-800'
                    }`}>
                    {selectedHistoryCall.intelligence.resolutionStatus.replace('_', ' ')}
                  </span>
                </div>
                <p className="text-slate-700 leading-relaxed font-medium">
                  {selectedHistoryCall.intelligence.overallSummary}
                </p>
                {selectedHistoryCall.intelligence.solutionsProvided && (
                  <div className="text-[11px] text-slate-600 bg-white/70 p-2 rounded-xl border border-purple-100">
                    <strong className="text-purple-800 block">Solutions Provided:</strong>
                    {selectedHistoryCall.intelligence.solutionsProvided}
                  </div>
                )}
                {selectedHistoryCall.intelligence.actionItems && (
                  <div className="text-[11px] text-amber-800 bg-amber-50/80 p-2 rounded-xl border border-amber-200 font-semibold">
                    Follow-Up Action: {selectedHistoryCall.intelligence.actionItems}
                  </div>
                )}
              </div>
            )}

            <div className="max-h-80 overflow-y-auto space-y-3 p-2">
              {(!selectedHistoryCall.transcripts || selectedHistoryCall.transcripts.length === 0) ? (
                <p className="text-xs text-slate-400 text-center py-4">{t('history.no_entries')}</p>
              ) : (
                selectedHistoryCall.transcripts.map((tItem) => (
                  <div key={tItem.id} className="text-xs">
                    <span className="font-semibold text-slate-500 block mb-0.5">
                      {tItem.senderName || tItem.sender}:
                    </span>
                    <p className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-slate-800">
                      {tItem.text}
                    </p>
                    {tItem.translation && (
                      <p className="text-[11px] italic text-indigo-600 mt-1 pl-2">
                        {t('transcript.translation_prefix', { text: tItem.translation })}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>

            <button
              onClick={() => setSelectedHistoryCall(null)}
              className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
            >
              {t('history.modal_close')}
            </button>
          </div>
        </div>
      )}
      {/* Audio Device Settings Modal */}
      <AudioDeviceModal
        isOpen={showAudioDeviceModal}
        onClose={() => setShowAudioDeviceModal(false)}
      />
    </div>
  );
};
