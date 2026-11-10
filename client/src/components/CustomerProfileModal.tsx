import React, { useState, useEffect } from 'react';
import { CustomerInteractionHistory, LanguageCode, SUPPORTED_LANGUAGES } from '../types.js';
import {
  User as UserIcon, Phone, Mail, Globe, Calendar, Clock,
  CheckCircle2, AlertTriangle, HelpCircle, FileText,
  ChevronRight, RefreshCw, X, ShieldAlert, Sparkles, MessageSquare
} from 'lucide-react';

interface CustomerProfileModalProps {
  customerId: string | null;
  isOpen?: boolean;
  onClose: () => void;
  token: string | null;
  onOpenIntelligence?: (callId: string) => void;
}

export const CustomerProfileModal: React.FC<CustomerProfileModalProps> = ({
  customerId,
  isOpen = true,
  onClose,
  token,
  onOpenIntelligence
}) => {
  const [data, setData] = useState<CustomerInteractionHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'calls' | 'questions' | 'tasks'>('calls');
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);

  const fetchHistory = async () => {
    if (!customerId || !token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/customers/${customerId}/interaction-history`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error || 'Failed to fetch customer interaction history.');
      }
      setData(resData);
    } catch (err: any) {
      console.error('[CustomerProfileModal] Fetch error:', err);
      setError(err.message || 'Error loading profile.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && customerId) {
      fetchHistory();
    } else {
      setData(null);
      setSelectedCallId(null);
    }
  }, [isOpen, customerId]);

  if (!isOpen) return null;

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s}s`;
  };

  const getResolutionBadge = (status?: string) => {
    switch (status) {
      case 'resolved':
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">Resolved</span>;
      case 'partially_resolved':
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-300">Partially Resolved</span>;
      case 'escalated_admin':
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-300">Escalated to Admin</span>;
      default:
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">Unresolved</span>;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 to-blue-50/30">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-extrabold text-lg shadow-md shadow-blue-200">
              {data?.customer?.name ? data.customer.name.charAt(0).toUpperCase() : <UserIcon className="w-6 h-6" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black text-slate-900">{data?.customer?.name || 'Customer Profile'}</h2>
                {data?.customer?.preferredLanguage && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                    {SUPPORTED_LANGUAGES[data.customer.preferredLanguage as LanguageCode]?.name || data.customer.preferredLanguage.toUpperCase()}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 font-mono">
                Customer ID: {customerId} • Member since {data?.customer?.createdAt ? new Date(data.customer.createdAt).toLocaleDateString() : 'N/A'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Contact Strip */}
        {data?.customer && (
          <div className="px-6 py-3 bg-slate-50/80 border-b border-slate-100 flex flex-wrap items-center gap-6 text-xs text-slate-600">
            <div className="flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5 text-blue-600" />
              <span className="font-mono font-medium">{data.customer.phone || 'No phone recorded'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-indigo-600" />
              <span className="font-medium">{data.customer.email}</span>
            </div>
            <div className="flex items-center gap-1.5 ml-auto text-slate-400">
              <Clock className="w-3.5 h-3.5" />
              <span>Last interaction: {new Date(data.customer.lastInteraction).toLocaleDateString()}</span>
            </div>
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading && (
            <div className="py-16 text-center space-y-3">
              <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mx-auto" />
              <p className="text-xs text-slate-500 font-medium">Retrieving customer interaction history & AI summaries...</p>
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && data && (
            <>
              {/* Interaction Tabs */}
              <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                <button
                  onClick={() => setActiveTab('calls')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    activeTab === 'calls'
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <Phone className="w-3.5 h-3.5" />
                  Calls & Summaries ({data.calls.length})
                </button>
                <button
                  onClick={() => setActiveTab('questions')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    activeTab === 'questions'
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                  Questions & Solutions ({data.questionsAsked.length})
                </button>
                <button
                  onClick={() => setActiveTab('tasks')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    activeTab === 'tasks'
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Follow-Up Tasks ({data.followUpTasks.length})
                </button>
              </div>

              {/* 1. Calls & Summaries Tab */}
              {activeTab === 'calls' && (
                <div className="space-y-4">
                  {data.calls.length === 0 ? (
                    <p className="text-xs text-slate-400 py-8 text-center">No call records found for this customer.</p>
                  ) : (
                    data.calls.map((call) => {
                      const intel = call.intelligence;
                      const isExpanded = selectedCallId === call.id;

                      let questions: string[] = [];
                      let solutions: string[] = [];
                      try {
                        if (intel?.customerQuestions) questions = JSON.parse(intel.customerQuestions);
                        if (intel?.solutionsProvided) solutions = JSON.parse(intel.solutionsProvided);
                      } catch (e) {}

                      return (
                        <div key={call.id} className="border border-slate-200 rounded-2xl p-4 bg-white hover:border-blue-300 transition-all space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900 text-xs">
                                {new Date(call.startTime).toLocaleString()}
                              </span>
                              <span className="text-[10px] text-slate-500 font-mono">
                                ({formatDuration(call.duration)})
                              </span>
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600">
                                {call.direction === 'incoming' ? 'Incoming Support' : 'Outbound Call'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              {getResolutionBadge(intel?.resolutionStatus)}
                              <button
                                onClick={() => setSelectedCallId(isExpanded ? null : call.id)}
                                className="text-xs font-bold text-blue-600 hover:text-blue-800 cursor-pointer flex items-center gap-0.5"
                              >
                                {isExpanded ? 'Hide Details' : 'View Details'}
                                <ChevronRight className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                              </button>
                            </div>
                          </div>

                          {/* Intelligence Call Reason & Summary */}
                          {intel ? (
                            <div className="space-y-2">
                              <div className="text-xs font-semibold text-slate-800 flex items-start gap-1.5">
                                <span className="text-slate-400 shrink-0">Reason:</span>
                                <span>{intel.callReason}</span>
                              </div>
                              <p className="text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100 leading-relaxed">
                                <span className="font-bold text-slate-700 block mb-0.5">AI Summary:</span>
                                {intel.overallSummary}
                              </p>
                              {intel.resolutionExplanation && (
                                <p className="text-[11px] text-slate-500 italic pl-1">
                                  Evaluation rationale: {intel.resolutionExplanation}
                                </p>
                              )}
                            </div>
                          ) : (
                            <p className="text-xs text-slate-400 italic">No structured intelligence generated yet for this call.</p>
                          )}

                          {/* Expanded Transcript & Questions */}
                          {isExpanded && (
                            <div className="pt-3 border-t border-slate-100 space-y-3">
                              {questions.length > 0 && (
                                <div>
                                  <span className="text-[11px] font-bold text-slate-700 block mb-1">Customer Questions Asked:</span>
                                  <ul className="list-disc list-inside text-xs text-slate-600 space-y-0.5 pl-1">
                                    {questions.map((q, idx) => (
                                      <li key={idx}>{q}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {solutions.length > 0 && (
                                <div>
                                  <span className="text-[11px] font-bold text-emerald-800 block mb-1">Solutions / Guidance Provided:</span>
                                  <ul className="list-disc list-inside text-xs text-slate-600 space-y-0.5 pl-1">
                                    {solutions.map((s, idx) => (
                                      <li key={idx}>{s}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {call.transcripts && call.transcripts.length > 0 && (
                                <div>
                                  <span className="text-[11px] font-bold text-slate-700 block mb-1">Conversation Dialogue:</span>
                                  <div className="max-h-48 overflow-y-auto space-y-1.5 p-2 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                                    {call.transcripts.map((t) => (
                                      <div key={t.id}>
                                        <span className="font-semibold text-slate-600">{t.senderName || t.sender}:</span>{' '}
                                        <span className="text-slate-800">{t.text}</span>
                                        {t.translation && <span className="text-[10px] text-blue-600 italic block pl-2">Translation: {t.translation}</span>}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* 2. Questions & Solutions Tab */}
              {activeTab === 'questions' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">All Recorded Inquiries & Questions</h3>
                    {data.questionsAsked.length === 0 ? (
                      <p className="text-xs text-slate-400">No questions recorded in interaction history.</p>
                    ) : (
                      <div className="space-y-2">
                        {data.questionsAsked.map((item, idx) => (
                          <div key={idx} className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs flex items-start gap-2">
                            <HelpCircle className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                            <div>
                              <p className="font-bold text-slate-900">{item.question}</p>
                              <span className="text-[10px] text-slate-400 font-mono">{new Date(item.date).toLocaleString()}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2 pt-2">
                    <h3 className="text-xs font-bold text-emerald-800 uppercase tracking-wider">Solutions & Recommendations Delivered</h3>
                    {data.solutionsProvided.length === 0 ? (
                      <p className="text-xs text-slate-400">No solutions recorded in interaction history.</p>
                    ) : (
                      <div className="space-y-2">
                        {data.solutionsProvided.map((item, idx) => (
                          <div key={idx} className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-200 text-xs flex items-start gap-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                            <div>
                              <p className="text-slate-800">{item.solution}</p>
                              <span className="text-[10px] text-emerald-700 font-mono">{new Date(item.date).toLocaleString()}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 3. Follow-Up Tasks Tab */}
              {activeTab === 'tasks' && (
                <div className="space-y-3">
                  {data.followUpTasks.length === 0 ? (
                    <p className="text-xs text-slate-400 py-8 text-center">No follow-up tasks recorded for this customer.</p>
                  ) : (
                    data.followUpTasks.map((task) => (
                      <div key={task.id} className="p-4 rounded-2xl border border-slate-200 bg-white space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900 text-xs">{task.title}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            task.status === 'completed'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : task.status === 'in_progress'
                                ? 'bg-blue-100 text-blue-800 border border-blue-300'
                                : 'bg-amber-100 text-amber-800 border border-amber-300'
                          }`}>
                            {task.status.replace('_', ' ').toUpperCase()}
                          </span>
                        </div>
                        <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                          <span className="font-bold text-slate-700 block mb-0.5">Unresolved Question:</span>
                          {task.unresolvedQuestion}
                        </div>
                        {task.actionRequired && (
                          <div className="text-xs text-slate-600">
                            <span className="font-semibold text-slate-500">Action:</span> {task.actionRequired}
                          </div>
                        )}
                        <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 font-mono">
                          <span>Assigned Agent: {task.assignedAgentName || 'Unassigned / Team'}</span>
                          <span>Created: {new Date(task.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs rounded-xl cursor-pointer transition-colors"
          >
            Close Profile
          </button>
        </div>
      </div>
    </div>
  );
};
