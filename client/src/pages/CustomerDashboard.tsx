import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { getSocket } from '../services/socket.js';
import { voiceService } from '../services/voice.js';
import { webrtcManager } from '../services/webrtc.js';
import { CallRecord, CallTranscript } from '../types.js';
import {
  PhoneCall, PhoneOff, Mic, MicOff, Volume2, VolumeX,
  Clock, ShieldAlert, Sparkles, MessageSquare, History, User as UserIcon, AlertCircle
} from 'lucide-react';

export const CustomerDashboard: React.FC = () => {
  const { user, token } = useAuth();

  // Call status: 'idle' | 'connecting' | 'active_ai' | 'transferring' | 'active_admin' | 'ended'
  const [callStatus, setCallStatus] = useState<'idle' | 'connecting' | 'active_ai' | 'transferring' | 'active_admin' | 'ended'>('idle');
  const [callId, setCallId] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [transcripts, setTranscripts] = useState<CallTranscript[]>([]);
  const [interimText, setInterimText] = useState('');
  const [aiIsSpeaking, setAiIsSpeaking] = useState(false);
  const [transferDetails, setTransferDetails] = useState<{ adminName?: string; reason?: string } | null>(null);

  // Audio controls
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [micPermissionGranted, setMicPermissionGranted] = useState<boolean | null>(null);

  // Call history
  const [history, setHistory] = useState<CallRecord[]>([]);
  const [selectedHistoryCall, setSelectedHistoryCall] = useState<CallRecord | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Auto-scroll transcript
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts, interimText]);

  // Duration timer
  useEffect(() => {
    let timer: any;
    if (callStatus === 'active_ai' || callStatus === 'transferring' || callStatus === 'active_admin') {
      timer = setInterval(() => setDuration(prev => prev + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [callStatus]);

  // Fetch Customer Call History
  const fetchHistory = async () => {
    if (!token) return;
    setLoadingHistory(true);
    try {
      const res = await fetch('/api/calls/my-history', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) setHistory(data.calls || []);
    } catch (err) {
      console.error('Failed to load call history:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [token]);

  // Socket event listeners
  useEffect(() => {
    const socket = getSocket();

    // Call ready
    socket.on('call:ready', (data: { callId: string; greeting: string }) => {
      setCallStatus('active_ai');
      setTranscripts(prev => [
        ...prev,
        {
          id: 't_' + Date.now(),
          sender: 'ai',
          senderName: 'KAIRA AI',
          text: data.greeting,
          timestamp: new Date().toISOString()
        }
      ]);

      // Speak greeting
      setAiIsSpeaking(true);
      voiceService.speak(data.greeting, () => {
        setAiIsSpeaking(false);
        // Start listening to customer after AI speaks
        startSpeechRecognition(data.callId);
      });
    });

    // AI grounded response or fallback transfer
    socket.on('call:ai_response', (data: { answer: string; isTransferring: boolean; sources?: any[] }) => {
      setAiIsSpeaking(true);
      voiceService.stopListening();

      setTranscripts(prev => [
        ...prev,
        {
          id: 't_' + Date.now(),
          sender: 'ai',
          senderName: 'KAIRA AI',
          text: data.answer,
          timestamp: new Date().toISOString()
        }
      ]);

      if (data.isTransferring) {
        setCallStatus('transferring');
        setTransferDetails({ reason: 'Question not found in Knowledge Base' });
      }

      voiceService.speak(data.answer, () => {
        setAiIsSpeaking(false);
        if (!data.isTransferring) {
          // Resume customer listening
          startSpeechRecognition(callId || '');
        }
      });
    });

    // Admin accepted transfer -> Live WebRTC connected!
    socket.on('transfer:connected', async (data: { callId: string; adminName: string; adminSocketId: string }) => {
      console.log('[Customer] Admin connected via transfer:', data.adminName);
      setCallStatus('active_admin');
      setTransferDetails(prev => ({ ...prev, adminName: data.adminName }));

      setTranscripts(prev => [
        ...prev,
        {
          id: 't_' + Date.now(),
          sender: 'system',
          senderName: 'System',
          text: `Live voice transfer connected! You are now speaking with ${data.adminName}.`,
          timestamp: new Date().toISOString()
        }
      ]);

      // Stop AI voice synthesis
      voiceService.cancelSpeech();

      // Start WebRTC connection to Admin socket
      try {
        await webrtcManager.startCall(data.adminSocketId, data.callId);
        // Start live human speech recognition so live transcript updates
        startSpeechRecognition(data.callId, true);
      } catch (err) {
        console.error('Failed to establish WebRTC connection with Admin:', err);
      }
    });

    // Admin rejected or timed out
    socket.on('transfer:rejected_notice', (data: { message: string }) => {
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
      voiceService.speak(data.message);
    });

    socket.on('transfer:timeout', (data: { message: string }) => {
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
      voiceService.speak(data.message);
    });

    // Live human speech transcript during Admin call
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
      cleanupCall();
      fetchHistory();
    });

    return () => {
      socket.off('call:ready');
      socket.off('call:ai_response');
      socket.off('transfer:connected');
      socket.off('transfer:rejected_notice');
      socket.off('transfer:timeout');
      socket.off('call:live_transcript');
      socket.off('call:ended');
    };
  }, [callId, callStatus, user]);

  // Start speech recognition helper
  const startSpeechRecognition = (activeCallId: string, isHumanCall: boolean = false) => {
    voiceService.startListening((text, isFinal) => {
      if (!isFinal) {
        setInterimText(text);
      } else {
        setInterimText('');
        if (!text.trim()) return;

        // Add to transcript
        setTranscripts(prev => [
          ...prev,
          {
            id: 't_' + Date.now(),
            sender: 'customer',
            senderName: user?.name || 'Customer',
            text: text.trim(),
            timestamp: new Date().toISOString()
          }
        ]);

        const socket = getSocket();
        if (isHumanCall) {
          // Human Admin conversation
          socket.emit('call:live_speech', {
            callId: activeCallId,
            sender: 'customer',
            senderName: user?.name || 'Customer',
            text: text.trim()
          });
        } else {
          // AI conversation query
          socket.emit('call:query', {
            callId: activeCallId,
            query: text.trim(),
            customerId: user?.id,
            duration
          });
        }
      }
    });
  };

  // 1. Customer clicks Start Call
  const handleStartCall = async () => {
    try {
      setCallStatus('connecting');
      setDuration(0);
      setTranscripts([]);
      setTransferDetails(null);

      // Request browser microphone
      await webrtcManager.getMicrophoneStream();
      setMicPermissionGranted(true);

      const newCallId = 'kaira_call_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      setCallId(newCallId);

      const socket = getSocket();
      socket.emit('call:start', {
        callId: newCallId,
        customerId: user?.id,
        customerName: user?.name,
        customerPhone: user?.phone
      });
    } catch (err) {
      console.error('Microphone access denied:', err);
      setMicPermissionGranted(false);
      setCallStatus('idle');
      alert('Microphone access is required for real-time voice communication. Please enable microphone permissions in your browser.');
    }
  };

  // 2. Customer clicks End Call
  const handleEndCall = () => {
    if (callId) {
      const socket = getSocket();
      socket.emit('call:end', { callId, duration });
    }
    cleanupCall();
    fetchHistory();
  };

  const cleanupCall = () => {
    setCallStatus('idle');
    setCallId(null);
    setAiIsSpeaking(false);
    setInterimText('');
    voiceService.cancelSpeech();
    voiceService.stopListening();
    webrtcManager.endCall();
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

  // Format seconds to mm:ss
  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-indigo-700 via-indigo-600 to-blue-600 rounded-3xl p-6 sm:p-8 text-white shadow-xl shadow-indigo-100 relative overflow-hidden">
        <div className="absolute -right-10 -bottom-10 w-64 h-64 rounded-full bg-white/10 blur-2xl pointer-events-none" />
        <div className="relative z-10 max-w-2xl">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-white/20 text-white backdrop-blur-xs mb-3 border border-white/20">
            <Sparkles className="w-3.5 h-3.5" />
            24/7 Autonomous Voice Support
          </span>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Welcome, {user?.name || 'Valued Customer'}
          </h1>
          <p className="mt-2 text-indigo-100 text-sm leading-relaxed">
            Communicate naturally with KAIRA's AI voice agent. Ask questions regarding products, pricing, policies, and subscriptions. If our AI cannot locate a verified answer, you will be seamlessly transferred to an Administrator live.
          </p>
        </div>
      </div>

      {/* Main Real-time Call Console */}
      <div className="bg-white rounded-3xl shadow-xl shadow-slate-100 border border-slate-200/80 overflow-hidden">
        {/* Header Bar */}
        <div className="px-6 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4 bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className={`w-3.5 h-3.5 rounded-full ${callStatus === 'idle' ? 'bg-slate-300' : callStatus === 'active_admin' ? 'bg-emerald-500 animate-ping' : 'bg-indigo-500 animate-pulse'}`} />
            <div>
              <h2 className="text-sm font-bold text-slate-800">Voice Communication Session</h2>
              <p className="text-xs text-slate-500">
                {callStatus === 'idle' && 'Ready to connect'}
                {callStatus === 'connecting' && 'Establishing real-time voice channel...'}
                {callStatus === 'active_ai' && (aiIsSpeaking ? 'AI Voice Agent Speaking...' : 'Listening to your question...')}
                {callStatus === 'transferring' && 'Escalating to Administrator (Live Ringing)...'}
                {callStatus === 'active_admin' && `Connected with Admin: ${transferDetails?.adminName || 'Support Specialist'}`}
                {callStatus === 'ended' && 'Call Completed'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Call Duration */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-700 shadow-2xs">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              {formatDuration(duration)}
            </div>

            {/* Microphone Status */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-600 shadow-2xs">
              {isMuted ? (
                <>
                  <MicOff className="w-3.5 h-3.5 text-red-500" />
                  <span className="text-red-600">Mic Muted</span>
                </>
              ) : (
                <>
                  <Mic className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-slate-700">Mic Active</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Call Stage Graphic & Primary Controls */}
        <div className="p-8 text-center flex flex-col items-center justify-center">
          {callStatus === 'idle' ? (
            <div className="space-y-6 max-w-md py-4">
              <button
                onClick={handleStartCall}
                className="w-24 h-24 rounded-full bg-gradient-to-tr from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white flex items-center justify-center shadow-xl shadow-indigo-200 hover:shadow-2xl hover:scale-105 transition-all cursor-pointer mx-auto group"
              >
                <PhoneCall className="w-10 h-10 group-hover:scale-110 transition-transform" />
              </button>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Start Voice Call</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Click to establish a bidirectional voice call with KAIRA's AI agent.
                </p>
              </div>
            </div>
          ) : (
            <div className="w-full max-w-xl space-y-6">
              {/* Active Soundwave Visualization */}
              <div className="h-20 flex items-center justify-center gap-1.5 py-4">
                <span className={`w-1.5 rounded-full ${callStatus === 'active_admin' ? 'bg-emerald-500' : 'bg-indigo-600'} animate-soundwave-1`} />
                <span className={`w-1.5 rounded-full ${callStatus === 'active_admin' ? 'bg-emerald-500' : 'bg-indigo-600'} animate-soundwave-2`} />
                <span className={`w-1.5 rounded-full ${callStatus === 'active_admin' ? 'bg-emerald-500' : 'bg-indigo-600'} animate-soundwave-3`} />
                <span className={`w-1.5 rounded-full ${callStatus === 'active_admin' ? 'bg-emerald-500' : 'bg-indigo-600'} animate-soundwave-4`} />
                <span className={`w-1.5 rounded-full ${callStatus === 'active_admin' ? 'bg-emerald-500' : 'bg-indigo-600'} animate-soundwave-5`} />
                <span className={`w-1.5 rounded-full ${callStatus === 'active_admin' ? 'bg-emerald-500' : 'bg-indigo-600'} animate-soundwave-2`} />
                <span className={`w-1.5 rounded-full ${callStatus === 'active_admin' ? 'bg-emerald-500' : 'bg-indigo-600'} animate-soundwave-4`} />
              </div>

              {/* Status Banner */}
              {callStatus === 'transferring' && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-800 text-xs flex items-center justify-center gap-3 animate-pulse">
                  <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
                  <div className="text-left">
                    <p className="font-bold">Live Admin Escalation in Progress</p>
                    <p className="text-amber-700">Connecting you with our Administrator over live bidirectional voice. Please hold...</p>
                  </div>
                </div>
              )}

              {callStatus === 'active_admin' && (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 text-xs flex items-center justify-center gap-3">
                  <UserIcon className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div className="text-left">
                    <p className="font-bold">Direct Human Voice Connected</p>
                    <p className="text-emerald-700">You are speaking live with Administrator {transferDetails?.adminName}.</p>
                  </div>
                </div>
              )}

              {/* In-Call Action Bar */}
              <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
                {/* Mute Button */}
                <button
                  onClick={handleToggleMute}
                  className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${isMuted ? 'bg-red-50 border-red-200 text-red-600' : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
                    }`}
                  title={isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
                >
                  {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>

                {/* End Call Button */}
                <button
                  onClick={handleEndCall}
                  className="flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-semibold text-sm shadow-lg shadow-red-200 transition-all cursor-pointer"
                >
                  <PhoneOff className="w-5 h-5" />
                  End Call
                </button>

                {/* Speaker Volume Slider */}
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-2xl">
                  {volume === 0 ? <VolumeX className="w-4 h-4 text-slate-400" /> : <Volume2 className="w-4 h-4 text-slate-600" />}
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={volume}
                    onChange={handleVolumeChange}
                    className="w-20 accent-indigo-600 cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Live Conversation Transcript */}
        <div className="border-t border-slate-200/80 bg-slate-50/60 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-indigo-600" />
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Live Conversation Transcript
              </h3>
            </div>
            <span className="text-[11px] text-slate-400">
              {transcripts.length} exchanges recorded
            </span>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4 h-72 overflow-y-auto space-y-3.5 shadow-2xs">
            {transcripts.length === 0 && !interimText && (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 text-xs text-center p-4">
                <MessageSquare className="w-8 h-8 text-slate-300 mb-2 stroke-1" />
                <p>When the call begins, the live transcript will stream here in real time.</p>
              </div>
            )}

            {transcripts.map((t) => (
              <div
                key={t.id}
                className={`flex flex-col ${t.sender === 'customer'
                    ? 'items-end'
                    : t.sender === 'system'
                      ? 'items-center'
                      : 'items-start'
                  }`}
              >
                {t.sender === 'system' ? (
                  <span className="px-3 py-1 bg-amber-50 border border-amber-200 text-amber-800 text-[11px] rounded-full font-medium my-1">
                    {t.text}
                  </span>
                ) : (
                  <div className="max-w-[85%] sm:max-w-[75%]">
                    <span className="text-[10px] font-semibold text-slate-400 px-1 mb-0.5 block">
                      {t.senderName || (t.sender === 'customer' ? 'You' : t.sender === 'ai' ? 'KAIRA AI' : 'Admin')}
                    </span>
                    <div
                      className={`px-4 py-2.5 rounded-2xl text-xs leading-relaxed ${t.sender === 'customer'
                          ? 'bg-indigo-600 text-white rounded-tr-xs shadow-xs'
                          : t.sender === 'ai'
                            ? 'bg-slate-100 text-slate-800 rounded-tl-xs border border-slate-200/80'
                            : 'bg-emerald-50 text-emerald-900 border border-emerald-200 rounded-tl-xs'
                        }`}
                    >
                      {t.text}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Interim live speech bubble */}
            {interimText && (
              <div className="flex flex-col items-end">
                <div className="max-w-[85%] px-4 py-2 bg-indigo-50 text-indigo-700 text-xs rounded-2xl rounded-tr-xs border border-indigo-200 italic animate-pulse">
                  {interimText}...
                </div>
              </div>
            )}

            <div ref={transcriptEndRef} />
          </div>
        </div>
      </div>

      {/* Customer Call History Table */}
      <div className="bg-white rounded-3xl shadow-xl shadow-slate-100 border border-slate-200/80 p-6 sm:p-8 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-bold text-slate-900">My Call History</h2>
          </div>
          <button
            onClick={fetchHistory}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer"
          >
            Refresh
          </button>
        </div>

        {loadingHistory ? (
          <div className="py-8 text-center text-xs text-slate-500">Loading call history...</div>
        ) : history.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400">
            No previous voice calls found. Click "Start Voice Call" above to begin your first session!
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 uppercase font-bold text-[10px] tracking-wider border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Date & Time</th>
                  <th className="py-3 px-4">Duration</th>
                  <th className="py-3 px-4">Call Type</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Handled By</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((call) => (
                  <tr key={call.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-4 font-medium text-slate-800">
                      {new Date(call.startTime).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 font-mono font-medium">
                      {formatDuration(call.duration)}
                    </td>
                    <td className="py-3 px-4">
                      {call.type === 'ai_voice' && (
                        <span className="px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 font-semibold text-[10px]">
                          AI Voice
                        </span>
                      )}
                      {call.type === 'admin_transfer' && (
                        <span className="px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200 font-semibold text-[10px]">
                          Admin Transfer
                        </span>
                      )}
                      {call.type === 'agent_voice' && (
                        <span className="px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-semibold text-[10px]">
                          Agent Call
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${call.status === 'completed'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : call.status === 'active'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'bg-red-50 text-red-700 border border-red-200'
                        }`}>
                        {call.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-700">
                      {call.transferred ? (
                        <span className="text-purple-700 font-medium">
                          Transferred to Admin {call.admin?.name ? `(${call.admin.name})` : ''}
                        </span>
                      ) : call.type === 'agent_voice' ? (
                        <span className="text-blue-700 font-medium">
                          Support Agent {call.agent?.name ? `(${call.agent.name})` : ''}
                        </span>
                      ) : (
                        <span className="text-indigo-700 font-medium">KAIRA AI Voice</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => setSelectedHistoryCall(call)}
                        className="px-3 py-1 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-700 rounded-lg font-medium transition-colors cursor-pointer"
                      >
                        Transcript
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Transcript Modal for Historical Calls */}
      {selectedHistoryCall && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Call Transcript</h3>
                <p className="text-[11px] text-slate-500 font-mono">
                  {new Date(selectedHistoryCall.startTime).toLocaleString()} • Duration: {formatDuration(selectedHistoryCall.duration)}
                </p>
              </div>
              <button
                onClick={() => setSelectedHistoryCall(null)}
                className="text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer"
              >
                ✕ Close
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto space-y-3 p-2">
              {(!selectedHistoryCall.transcripts || selectedHistoryCall.transcripts.length === 0) ? (
                <p className="text-xs text-slate-400 text-center py-4">No transcript entries recorded.</p>
              ) : (
                selectedHistoryCall.transcripts.map((t) => (
                  <div key={t.id} className="text-xs">
                    <span className="font-semibold text-slate-500 block mb-0.5">
                      {t.senderName || t.sender}:
                    </span>
                    <p className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-slate-800">
                      {t.text}
                    </p>
                  </div>
                ))
              )}
            </div>

            <button
              onClick={() => setSelectedHistoryCall(null)}
              className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

