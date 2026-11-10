import React, { useState, useEffect } from 'react';
import { CallRecord, CallIntelligence, FollowUpTask, LanguageCode, SUPPORTED_LANGUAGES } from '../types.js';
import {
  Sparkles, CheckCircle2, AlertTriangle, Clock, RefreshCw, X,
  HelpCircle, Check, ArrowRight, User, Phone, BookOpen, MessageSquare
} from 'lucide-react';

interface CallIntelligenceModalProps {
  callId: string | null;
  isOpen?: boolean;
  onClose: () => void;
  token: string | null;
  onIntelligenceUpdated?: () => void;
  onOpenCustomerProfile?: (customerId: string) => void;
}

export const CallIntelligenceModal: React.FC<CallIntelligenceModalProps> = ({
  callId,
  isOpen = true,
  onClose,
  token,
  onIntelligenceUpdated,
  onOpenCustomerProfile
}) => {
  const [data, setData] = useState<{
    call: CallRecord;
    intelligence: CallIntelligence | null;
    followUpTasks: FollowUpTask[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchIntelligence = async () => {
    if (!callId || !token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/calls/${callId}/intelligence`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error || 'Failed to fetch call intelligence.');
      }
      setData(resData);
    } catch (err: any) {
      console.error('[CallIntelligenceModal] Fetch error:', err);
      setError(err.message || 'Error loading intelligence.');
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async () => {
    if (!callId || !token) return;
    setRetrying(true);
    try {
      const res = await fetch(`/api/calls/${callId}/intelligence/retry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error || 'Retry analysis failed.');
      }
      await fetchIntelligence();
      if (onIntelligenceUpdated) onIntelligenceUpdated();
    } catch (err: any) {
      alert(`Retry failed: ${err.message}`);
    } finally {
      setRetrying(false);
    }
  };

  useEffect(() => {
    if (isOpen && callId) {
      fetchIntelligence();
    } else {
      setData(null);
    }
  }, [isOpen, callId]);

  if (!isOpen) return null;

  const intel = data?.intelligence;
  const call = data?.call;

  let questions: string[] = [];
  let solutions: string[] = [];
  let kbSources: string[] = [];
  let unresolved: string[] = [];
  let actions: string[] = [];

  try {
    if (intel?.customerQuestions) questions = JSON.parse(intel.customerQuestions);
    if (intel?.solutionsProvided) solutions = JSON.parse(intel.solutionsProvided);
    if (intel?.kbSourcesUsed) kbSources = JSON.parse(intel.kbSourcesUsed);
    if (intel?.unresolvedQuestions) unresolved = JSON.parse(intel.unresolvedQuestions);
    if (intel?.actionItems) actions = JSON.parse(intel.actionItems);
  } catch (e) {}

  const getResolutionBadge = (status?: string) => {
    switch (status) {
      case 'resolved':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            Resolved
          </span>
        );
      case 'partially_resolved':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-300">
            <Clock className="w-3.5 h-3.5 text-blue-600" />
            Partially Resolved
          </span>
        );
      case 'escalated_admin':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-800 border border-purple-300">
            <AlertTriangle className="w-3.5 h-3.5 text-purple-600" />
            Escalated to Admin
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            Unresolved
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
        {/* Top Header */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-purple-50/50 via-slate-50 to-blue-50/40">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center font-bold shadow-md shadow-purple-200">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black text-slate-900">AI Call Intelligence Report</h2>
                {intel?.resolutionStatus && getResolutionBadge(intel.resolutionStatus)}
              </div>
              <p className="text-xs text-slate-500 font-mono mt-0.5">
                Call ID: {call?.callId || callId} • Customer: {call?.customerName || 'N/A'} • Duration: {call?.duration || 0}s
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-xl border border-slate-200 flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer"
              title="Force re-run AI intelligence analysis"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin text-purple-600' : ''}`} />
              {retrying ? 'Analyzing...' : 'Retry Analysis'}
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 cursor-pointer transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading && (
            <div className="py-16 text-center space-y-3">
              <RefreshCw className="w-8 h-8 text-purple-600 animate-spin mx-auto" />
              <p className="text-xs text-slate-500 font-medium">Extracting post-call intelligence & resolution telemetry...</p>
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && intel && (
            <>
              {/* Executive Summary Card */}
              <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-50 to-purple-50/30 border border-purple-100 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-purple-900 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-purple-600" />
                    Structured Call Summary
                  </span>
                  <span className="text-[11px] font-mono text-slate-500">
                    Language: {(intel.language || 'en').toUpperCase()} • Sentiment: {(intel.sentiment || 'neutral').toUpperCase()}
                  </span>
                </div>
                <div className="text-xs font-semibold text-slate-800">
                  <span className="text-slate-400">Main Call Reason:</span> {intel.callReason}
                </div>
                <p className="text-xs text-slate-700 leading-relaxed bg-white/80 p-3.5 rounded-xl border border-purple-100/80">
                  {intel.overallSummary}
                </p>
                {intel.resolutionExplanation && (
                  <div className="text-[11px] text-purple-950 font-medium bg-purple-100/50 p-2.5 rounded-xl">
                    <span className="font-bold text-purple-900">Resolution Explanation:</span> {intel.resolutionExplanation}
                  </div>
                )}
              </div>

              {/* Questions & Solutions Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Questions Asked */}
                <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-2">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <HelpCircle className="w-4 h-4 text-blue-500" />
                    Customer Questions ({questions.length})
                  </span>
                  {questions.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">No explicit questions detected.</p>
                  ) : (
                    <ul className="space-y-1.5 text-xs text-slate-700">
                      {questions.map((q, idx) => (
                        <li key={idx} className="p-2 rounded-xl bg-slate-50 border border-slate-100">
                          {q}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Solutions Delivered */}
                <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-2">
                  <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Solutions & Answers Provided ({solutions.length})
                  </span>
                  {solutions.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">No full solution recorded in transcript.</p>
                  ) : (
                    <ul className="space-y-1.5 text-xs text-slate-700">
                      {solutions.map((s, idx) => (
                        <li key={idx} className="p-2 rounded-xl bg-emerald-50/50 border border-emerald-100 text-slate-800">
                          {s}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Knowledge Base Sources Used */}
              {kbSources.length > 0 && (
                <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-2">
                  <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <BookOpen className="w-4 h-4 text-indigo-600" />
                    Knowledge Base Sources Referenced
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {kbSources.map((source, idx) => (
                      <span key={idx} className="px-2.5 py-1 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-indigo-900 shadow-2xs">
                        {source}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Unresolved Questions & Required Follow-Ups */}
              {(unresolved.length > 0 || actions.length > 0) && (
                <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50/40 space-y-3">
                  <div className="flex items-center gap-2 text-amber-900 font-bold text-xs">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <span>Unresolved Inquiries & Required Action Items</span>
                  </div>
                  {unresolved.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[11px] font-semibold text-amber-800 block">Open Questions:</span>
                      <ul className="list-disc list-inside text-xs text-amber-950 space-y-0.5 pl-1">
                        {unresolved.map((u, idx) => (
                          <li key={idx}>{u}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {actions.length > 0 && (
                    <div className="space-y-1 pt-1">
                      <span className="text-[11px] font-semibold text-amber-800 block">Required Follow-Up Action:</span>
                      <ul className="list-disc list-inside text-xs text-amber-950 space-y-0.5 pl-1">
                        {actions.map((a, idx) => (
                          <li key={idx}>{a}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Linked Follow-Up Tasks */}
              {data.followUpTasks && data.followUpTasks.length > 0 && (
                <div className="p-4 rounded-2xl border border-indigo-200 bg-indigo-50/30 space-y-2">
                  <span className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-indigo-600" />
                    Auto-Created Follow-Up Task
                  </span>
                  {data.followUpTasks.map(t => (
                    <div key={t.id} className="p-3 bg-white rounded-xl border border-indigo-100 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-bold text-slate-900">{t.title}</div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          Assigned: {t.assignedAgentName || 'Unassigned'} • Priority: {t.priority.toUpperCase()}
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800">
                        {t.status.toUpperCase()}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Conversation Transcripts */}
              {call?.transcripts && call.transcripts.length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                    Recorded Conversation Transcript ({call.transcripts.length} entries)
                  </span>
                  <div className="max-h-60 overflow-y-auto space-y-2 p-3 bg-slate-50 rounded-2xl border border-slate-200 text-xs">
                    {call.transcripts.map(t => (
                      <div key={t.id} className="p-2 rounded-xl bg-white border border-slate-100">
                        <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono mb-0.5">
                          <span className="font-bold text-slate-600">{t.senderName || t.sender}:</span>
                          <span>{new Date(t.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <p className="text-slate-800">{t.text}</p>
                        {t.translation && (
                          <p className="text-[10px] italic text-blue-600 mt-1 pl-2 border-l-2 border-blue-200">
                            Translation: {t.translation}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {!loading && !error && !intel && (
            <div className="py-12 text-center space-y-3">
              <Sparkles className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-xs text-slate-500">No intelligence record found. Click below to analyze this call.</p>
              <button
                onClick={handleRetry}
                disabled={retrying}
                className="px-4 py-2 bg-purple-600 text-white font-bold text-xs rounded-xl shadow-md cursor-pointer hover:bg-purple-700 transition-all"
              >
                {retrying ? 'Analyzing Call...' : 'Generate AI Summary & Classification'}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs rounded-xl cursor-pointer transition-colors"
          >
            Close Report
          </button>
        </div>
      </div>
    </div>
  );
};
