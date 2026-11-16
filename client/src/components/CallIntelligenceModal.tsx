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
  const [showLocalized, setShowLocalized] = useState(false);

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
  let discussionPoints: string[] = [];

  try {
    if (intel?.customerQuestions) questions = JSON.parse(intel.customerQuestions);
    if (intel?.solutionsProvided) solutions = JSON.parse(intel.solutionsProvided);
    if (intel?.kbSourcesUsed) kbSources = JSON.parse(intel.kbSourcesUsed);
    if (intel?.unresolvedQuestions) unresolved = JSON.parse(intel.unresolvedQuestions);
    if (intel?.actionItems) actions = JSON.parse(intel.actionItems);
    if (intel?.discussionPoints) {
      discussionPoints = typeof intel.discussionPoints === 'string'
        ? (intel.discussionPoints.startsWith('[') ? JSON.parse(intel.discussionPoints) : intel.discussionPoints.split('\n').filter(Boolean))
        : (Array.isArray(intel.discussionPoints) ? intel.discussionPoints : []);
    }
  } catch (e) { }

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
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-fadeIn">
      <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
        {/* Top Header */}
        <div className="p-4 sm:p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gradient-to-r from-purple-50/50 via-slate-50 to-blue-50/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center font-bold shadow-md shadow-purple-200 shrink-0">
              <Sparkles className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-slate-900">AI Call Intelligence Report</h2>
                {intel?.resolutionStatus && getResolutionBadge(intel.resolutionStatus)}
              </div>
              <p className="text-[11px] sm:text-xs text-slate-500 font-mono mt-0.5">
                Call ID: {call?.callId || callId} • Customer: {call?.customerName || 'N/A'} • Duration: {call?.duration || 0}s
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-xl border border-slate-200 flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer min-h-[36px]"
              title="Force re-run AI intelligence analysis"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin text-purple-600' : ''}`} />
              {retrying ? 'Analyzing...' : 'Retry Analysis'}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 sm:p-2 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 cursor-pointer transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
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
              {/* Executive Summary Card (8 Structured Core Items) */}
              <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-50 to-purple-50/30 border border-purple-100 space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-purple-900 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-purple-600" />
                    Structured Call Intelligence & Summary
                  </span>
                  <div className="flex items-center gap-2">
                    {intel.requiresHumanSupport ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                        <AlertTriangle className="w-3 h-3 text-rose-600" />
                        Human Support Required
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                        <Check className="w-3 h-3 text-emerald-600" />
                        Autonomous AI Handled
                      </span>
                    )}
                    <span className="text-[11px] font-mono text-slate-500">
                      Language: {(intel.language || 'en').toUpperCase()}
                    </span>
                  </div>
                </div>

                {/* 1. Main Problem */}
                <div className="p-3 bg-white rounded-xl border border-purple-100 flex items-start gap-2 text-xs">
                  <span className="font-bold text-slate-900 shrink-0">Customer's Main Problem:</span>
                  <span className="text-slate-700 font-medium">{intel.callReason || 'General inquiry'}</span>
                </div>

                {/* 2 & 3. Summary Content with Localized Toggle */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                      {showLocalized && intel.localizedSummary ? `Summary (${(intel.language || 'en').toUpperCase()})` : 'Comprehensive Summary'}
                    </span>
                    {intel.localizedSummary && intel.localizedSummary !== intel.overallSummary && (
                      <button
                        onClick={() => setShowLocalized(!showLocalized)}
                        className="text-[11px] font-bold text-purple-700 hover:text-purple-900 underline cursor-pointer"
                      >
                        {showLocalized ? 'View in English' : `View in Regional (${(intel.language || 'en').toUpperCase()})`}
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed bg-white/90 p-3.5 rounded-xl border border-purple-100/80">
                    {showLocalized && intel.localizedSummary ? intel.localizedSummary : intel.overallSummary}
                  </p>
                </div>

                {/* 4. Resolution Provided */}
                {intel.resolutionExplanation && (
                  <div className="text-[11px] text-purple-950 font-medium bg-purple-100/60 p-3 rounded-xl border border-purple-200/50">
                    <span className="font-bold text-purple-900">Resolution Provided:</span> {intel.resolutionExplanation}
                  </div>
                )}

                {/* 5. Recommended Next Action */}
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-950 flex items-start gap-2">
                  <ArrowRight className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-amber-900">Recommended Next Action: </span>
                    <span className="font-semibold">{intel.recommendedNextAction || 'No further action required.'}</span>
                  </div>
                </div>
              </div>

              {/* Discussion Points Section */}
              {discussionPoints.length > 0 && (
                <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-2">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <MessageSquare className="w-4 h-4 text-indigo-500" />
                    Important Discussion Points ({discussionPoints.length})
                  </span>
                  <ul className="space-y-1.5 text-xs text-slate-700">
                    {discussionPoints.map((point, idx) => (
                      <li key={idx} className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex items-start gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1.5 shrink-0" />
                        <span>{point.replace(/^[•\s-]+/, '')}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

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
