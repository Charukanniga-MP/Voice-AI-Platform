import React, { useState, useEffect } from 'react';
import { FollowUpTask, LanguageCode, SUPPORTED_LANGUAGES } from '../types.js';
import { CustomerProfileModal } from './CustomerProfileModal.js';
import { CallIntelligenceModal } from './CallIntelligenceModal.js';
import {
  CheckCircle2, Clock, AlertTriangle, XCircle, Search, Filter,
  Phone, User, ArrowRight, Save, FileText, Sparkles, MessageSquare,
  Check, RefreshCw, ChevronDown
} from 'lucide-react';

interface FollowUpTasksManagerProps {
  token: string | null;
  currentUserId?: string;
  isAgent?: boolean;
}

export const FollowUpTasksManager: React.FC<FollowUpTasksManagerProps> = ({
  token,
  currentUserId,
  isAgent = true
}) => {
  const [tasks, setTasks] = useState<FollowUpTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'in_progress' | 'completed' | 'cancelled'>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'urgent' | 'high' | 'medium' | 'low'>('all');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'me'>('all');
  const [search, setSearch] = useState('');

  // Editing notes state
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [editResolutionNotes, setEditResolutionNotes] = useState('');
  const [editStatus, setEditStatus] = useState<string>('pending');
  const [savingTask, setSavingTask] = useState(false);

  // Modals
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedCallIdForIntel, setSelectedCallIdForIntel] = useState<string | null>(null);

  const fetchTasks = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.append('status', statusFilter);
      if (priorityFilter !== 'all') params.append('priority', priorityFilter);
      if (scopeFilter === 'me') params.append('scope', 'me');
      if (search.trim()) params.append('search', search.trim());

      const res = await fetch(`/api/follow-up-tasks?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        setTasks(data.tasks || []);
      }
    } catch (err) {
      console.error('[FollowUpTasksManager] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, [token, statusFilter, priorityFilter, scopeFilter, search]);

  const handleStartEdit = (task: FollowUpTask) => {
    setActiveTaskId(task.id);
    setEditNotes(task.notes || '');
    setEditResolutionNotes(task.resolutionNotes || '');
    setEditStatus(task.status);
  };

  const handleSaveProgress = async (taskId: string, forceStatus?: string) => {
    if (!token) return;
    setSavingTask(true);
    try {
      const finalStatus = forceStatus || editStatus;
      const res = await fetch(`/api/follow-up-tasks/${taskId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          status: finalStatus,
          notes: editNotes,
          resolutionNotes: editResolutionNotes
        })
      });

      if (res.ok) {
        setActiveTaskId(null);
        await fetchTasks();
      } else {
        const d = await res.json();
        alert(d.error || 'Failed to update task.');
      }
    } catch (err: any) {
      alert(`Error updating task: ${err.message}`);
    } finally {
      setSavingTask(false);
    }
  };

  const handleClaimTask = async (taskId: string) => {
    if (!token || !currentUserId) return;
    try {
      const res = await fetch(`/api/follow-up-tasks/${taskId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          assignedAgentId: currentUserId
        })
      });
      if (res.ok) {
        await fetchTasks();
      }
    } catch (err) {
      console.error('Claim task error:', err);
    }
  };

  const getPriorityBadge = (p: string) => {
    switch (p) {
      case 'urgent':
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-red-100 text-red-800 border border-red-300 animate-pulse">URGENT</span>;
      case 'high':
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">HIGH</span>;
      case 'medium':
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-300">MEDIUM</span>;
      default:
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-300">LOW</span>;
    }
  };

  const getStatusBadge = (s: string) => {
    switch (s) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            COMPLETED
          </span>
        );
      case 'in_progress':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-300">
            <Clock className="w-3 h-3 text-blue-600" />
            IN PROGRESS
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-300">
            <XCircle className="w-3 h-3 text-slate-500" />
            CANCELLED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
            <AlertTriangle className="w-3 h-3 text-amber-600" />
            PENDING
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Action & Filter Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black text-slate-900 tracking-tight">Post-Call Follow-Up Tasks</h2>
            <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 font-bold text-xs border border-blue-200">
              {tasks.length} {tasks.length === 1 ? 'Task' : 'Tasks'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Auto-created tasks linked to unresolved customer calls with original transcripts, previous summaries, and customer profiles.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Scope Toggle for Agents */}
          {isAgent && (
            <div className="flex items-center p-1 bg-slate-100 rounded-xl text-xs font-semibold border border-slate-200">
              <button
                onClick={() => setScopeFilter('all')}
                className={`px-3 py-1 rounded-lg cursor-pointer transition-all ${
                  scopeFilter === 'all' ? 'bg-white text-slate-900 font-bold shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All Team Tasks
              </button>
              <button
                onClick={() => setScopeFilter('me')}
                className={`px-3 py-1 rounded-lg cursor-pointer transition-all ${
                  scopeFilter === 'me' ? 'bg-white text-slate-900 font-bold shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Assigned to Me
              </button>
            </div>
          )}

          {/* Search */}
          <div className="relative min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search customer, question, or agent..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-900"
            />
          </div>

          <button
            onClick={fetchTasks}
            className="p-2 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-xl border border-slate-200 cursor-pointer transition-colors"
            title="Refresh Task List"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-600' : ''}`} />
          </button>
        </div>
      </div>

      {/* Filter Badges Row */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-bold text-slate-400 text-[11px] uppercase tracking-wider mr-1">Status:</span>
        {(['all', 'pending', 'in_progress', 'completed', 'cancelled'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1 rounded-xl capitalize transition-all cursor-pointer font-semibold ${
              statusFilter === s
                ? 'bg-blue-600 text-white shadow-xs font-bold'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {s.replace('_', ' ')}
          </button>
        ))}

        <span className="font-bold text-slate-400 text-[11px] uppercase tracking-wider ml-3 mr-1">Priority:</span>
        {(['all', 'urgent', 'high', 'medium', 'low'] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPriorityFilter(p)}
            className={`px-2.5 py-1 rounded-xl uppercase transition-all cursor-pointer font-semibold text-[11px] ${
              priorityFilter === p
                ? 'bg-slate-800 text-white shadow-xs font-bold'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Tasks List */}
      {loading ? (
        <div className="py-16 text-center space-y-3 bg-white rounded-3xl border border-slate-200 p-8">
          <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mx-auto" />
          <p className="text-xs text-slate-500 font-medium">Loading follow-up tasks...</p>
        </div>
      ) : tasks.length === 0 ? (
        <div className="py-16 text-center space-y-3 bg-white rounded-3xl border border-slate-200 p-8">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
          <h3 className="text-base font-bold text-slate-900">All Follow-Up Tasks Clear!</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            No unresolved issues match the selected filter. Newly ended calls with unanswered questions will automatically appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {tasks.map((task) => {
            const isEditing = activeTaskId === task.id;
            const isMyTask = currentUserId && task.assignedAgentId === currentUserId;

            return (
              <div
                key={task.id}
                className="bg-white rounded-3xl border border-slate-200/90 p-6 shadow-xs hover:border-blue-300 transition-all space-y-4"
              >
                {/* Header row */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {getPriorityBadge(task.priority)}
                    {getStatusBadge(task.status)}
                    <h3 className="text-base font-extrabold text-slate-900">{task.title}</h3>
                    {task.language && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                        {SUPPORTED_LANGUAGES[task.language as LanguageCode]?.name || task.language.toUpperCase()}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    {/* Customer Profile Button */}
                    {task.customerId && (
                      <button
                        onClick={() => setSelectedCustomerId(task.customerId!)}
                        className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-xl border border-blue-200 cursor-pointer flex items-center gap-1 transition-colors"
                      >
                        <User className="w-3.5 h-3.5" />
                        Customer Profile
                      </button>
                    )}

                    {/* View Original Call Intelligence Button */}
                    <button
                      onClick={() => setSelectedCallIdForIntel(task.callRecordId)}
                      className="px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 font-bold rounded-xl border border-purple-200 cursor-pointer flex items-center gap-1 transition-colors"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      View Call Report
                    </button>
                  </div>
                </div>

                {/* Customer Contact Banner */}
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100 flex flex-wrap items-center gap-4 text-xs">
                  <div className="flex items-center gap-1.5 text-slate-800 font-bold">
                    <User className="w-3.5 h-3.5 text-slate-400" />
                    <span>{task.customerName}</span>
                  </div>
                  {task.customerPhone && (
                    <div className="flex items-center gap-1.5 text-slate-600 font-mono">
                      <Phone className="w-3.5 h-3.5 text-blue-500" />
                      <span>{task.customerPhone}</span>
                    </div>
                  )}
                  <div className="text-slate-400 text-[11px] ml-auto font-mono">
                    Created: {new Date(task.createdAt).toLocaleString()}
                  </div>
                </div>

                {/* Unresolved Question & Summary */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="p-4 rounded-2xl bg-amber-50/60 border border-amber-200 space-y-1">
                    <span className="font-extrabold text-amber-900 block text-[11px] uppercase tracking-wider">
                      Unresolved Customer Question:
                    </span>
                    <p className="text-amber-950 font-medium leading-relaxed">
                      "{task.unresolvedQuestion}"
                    </p>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
                    <span className="font-extrabold text-slate-700 block text-[11px] uppercase tracking-wider">
                      Previous Conversation Summary:
                    </span>
                    <p className="text-slate-600 leading-relaxed line-clamp-3">
                      {task.previousSummary}
                    </p>
                  </div>
                </div>

                {/* Action Required */}
                {task.actionRequired && (
                  <div className="text-xs text-slate-700 bg-blue-50/50 p-3 rounded-2xl border border-blue-100 flex items-start gap-2">
                    <ArrowRight className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-blue-900">Required Action: </span>
                      <span>{task.actionRequired}</span>
                    </div>
                  </div>
                )}

                {/* Follow-up notes & Resolution if completed */}
                {task.notes && (
                  <div className="text-xs text-slate-700 bg-slate-50 p-3 rounded-2xl border border-slate-100">
                    <span className="font-bold text-slate-600 block mb-0.5">Agent Notes:</span>
                    {task.notes}
                  </div>
                )}

                {task.resolutionNotes && (
                  <div className="text-xs text-emerald-900 bg-emerald-50 p-3 rounded-2xl border border-emerald-200">
                    <span className="font-bold text-emerald-800 block mb-0.5">Resolution Notes (Resolved by {task.resolvedBy}):</span>
                    {task.resolutionNotes}
                  </div>
                )}

                {/* Edit Form or Task Controls */}
                {isEditing ? (
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3 pt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800">Update Task Progress & Notes</span>
                      <button
                        onClick={() => setActiveTaskId(null)}
                        className="text-xs text-slate-400 hover:text-slate-600 font-semibold cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div>
                        <label className="font-semibold text-slate-600 block mb-1">Status:</label>
                        <select
                          value={editStatus}
                          onChange={(e) => setEditStatus(e.target.value)}
                          className="w-full p-2 bg-white border border-slate-200 rounded-xl font-semibold text-slate-800"
                        >
                          <option value="pending">Pending</option>
                          <option value="in_progress">In Progress</option>
                          <option value="completed">Completed (Resolved)</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </div>

                      <div>
                        <label className="font-semibold text-slate-600 block mb-1">Internal Notes:</label>
                        <input
                          type="text"
                          placeholder="e.g. Called customer, left voicemail..."
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                          className="w-full p-2 bg-white border border-slate-200 rounded-xl text-slate-800"
                        />
                      </div>
                    </div>

                    {editStatus === 'completed' && (
                      <div className="text-xs">
                        <label className="font-semibold text-emerald-800 block mb-1">Resolution Summary / Notes:</label>
                        <textarea
                          rows={2}
                          placeholder="Explain how the customer issue was verified and resolved..."
                          value={editResolutionNotes}
                          onChange={(e) => setEditResolutionNotes(e.target.value)}
                          className="w-full p-2 bg-white border border-emerald-300 rounded-xl text-slate-800"
                        />
                      </div>
                    )}

                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        onClick={() => handleSaveProgress(task.id)}
                        disabled={savingTask}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md cursor-pointer transition-all flex items-center gap-1.5"
                      >
                        <Save className="w-3.5 h-3.5" />
                        {savingTask ? 'Saving...' : 'Save Task Progress'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 text-xs">
                    <div className="flex items-center gap-2 text-slate-500 font-medium">
                      <span>Assigned to:</span>
                      <span className="font-bold text-slate-800">
                        {task.assignedAgentName || 'Unassigned / Team Pool'}
                      </span>
                      {!task.assignedAgentId && isAgent && (
                        <button
                          onClick={() => handleClaimTask(task.id)}
                          className="px-2 py-0.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-[11px] border border-indigo-200 cursor-pointer transition-colors"
                        >
                          Claim Task
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleStartEdit(task)}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl cursor-pointer transition-colors"
                      >
                        Update Progress
                      </button>

                      {task.status !== 'completed' && (
                        <button
                          onClick={() => {
                            setActiveTaskId(task.id);
                            setEditStatus('completed');
                            setEditNotes(task.notes || '');
                            setEditResolutionNotes(task.resolutionNotes || 'Issue verified and resolved with customer.');
                          }}
                          className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5 transition-all"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Mark Completed
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
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
        onIntelligenceUpdated={fetchTasks}
      />
    </div>
  );
};
