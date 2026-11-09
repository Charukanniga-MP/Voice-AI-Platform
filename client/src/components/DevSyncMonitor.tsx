import React, { useState, useEffect, useCallback } from 'react';
import { GitBranch, GitPullRequest, GitCommit, RefreshCw, AlertCircle, CheckCircle2, ArrowDownCircle, ArrowUpCircle, X, ShieldCheck } from 'lucide-react';

interface GitStatus {
  currentBranch: string;
  localSha: string;
  remoteSha: string;
  ahead: number;
  behind: number;
  dirtyFiles: Array<{ status: string; file: string }>;
  conflictFiles: string[];
  incomingCommits: string[];
  incomingFiles: Array<{ status: string; file: string }>;
  isClean: boolean;
  state: 'in_sync' | 'behind' | 'ahead' | 'diverged' | 'conflicts';
}

export const DevSyncMonitor: React.FC = () => {
  // CRITICAL PRODUCTION SAFETY: Never render or mount in production builds
  if (!import.meta.env.DEV) {
    return null;
  }

  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [logOutput, setLogOutput] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/dev/git/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStatus(data);
    } catch (err: any) {
      setError(err.message || 'Failed to connect to dev git API');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    // Poll every 30 seconds only in development
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleFetchUpdates = async () => {
    setActionLoading('fetch');
    try {
      const res = await fetch('/api/dev/git/fetch', { method: 'POST' });
      await res.json();
      await fetchStatus();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handlePullChanges = async () => {
    setActionLoading('pull');
    setLogOutput('Initiating safe pull with auto-backup...');
    try {
      const res = await fetch('/api/dev/git/pull', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setLogOutput(data.stdout || data.details || data.error);
        throw new Error(data.error || 'Pull failed');
      }
      setLogOutput(data.output || 'Pulled and synchronized successfully!');
      await fetchStatus();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handlePushChanges = async () => {
    setActionLoading('push');
    setLogOutput('Running pre-push checks and verification...');
    try {
      const res = await fetch('/api/dev/git/push', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setLogOutput(data.stdout || data.details || data.error);
        throw new Error(data.error || 'Push failed');
      }
      setLogOutput(data.output || 'Pushed successfully to origin/main!');
      await fetchStatus();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  // Status Badge Styling
  const getBadgeStyle = () => {
    if (!status) return 'bg-slate-800 text-slate-300 border-slate-700';
    if (status.state === 'conflicts') return 'bg-rose-950 text-rose-300 border-rose-700 animate-pulse';
    if (status.state === 'diverged') return 'bg-amber-950 text-amber-300 border-amber-700';
    if (status.state === 'behind') return 'bg-sky-950 text-sky-300 border-sky-700';
    if (status.state === 'ahead') return 'bg-emerald-950 text-emerald-300 border-emerald-700';
    return 'bg-slate-900 text-emerald-400 border-slate-800';
  };

  return (
    <aside aria-label="Developer Git Synchronization Monitor" className="fixed bottom-4 right-4 z-50 font-sans text-xs">
      {/* Floating Pill Toggle */}
      {!isOpen ? (
        <button
          onClick={() => { setIsOpen(true); fetchStatus(); }}
          className={`flex items-center gap-2 px-3 py-2 rounded-full border shadow-xl backdrop-blur-md transition-all cursor-pointer hover:scale-105 ${getBadgeStyle()}`}
          title="KAIRA Team Git Sync Status (Dev-Only)"
        >
          <GitBranch className="w-3.5 h-3.5 text-indigo-400" />
          <span className="font-semibold tracking-wide">
            {status?.currentBranch || 'Git'}
          </span>
          {status && (
            <>
              {status.state === 'in_sync' && <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium"><CheckCircle2 className="w-3 h-3" /> Synced</span>}
              {status.state === 'behind' && <span className="flex items-center gap-1 text-[11px] text-sky-300 font-semibold"><ArrowDownCircle className="w-3 h-3" /> {status.behind} new</span>}
              {status.state === 'ahead' && <span className="flex items-center gap-1 text-[11px] text-emerald-300 font-semibold"><ArrowUpCircle className="w-3 h-3" /> {status.ahead} to push</span>}
              {status.state === 'diverged' && <span className="flex items-center gap-1 text-[11px] text-amber-300 font-semibold">⚡ Diverged</span>}
              {status.state === 'conflicts' && <span className="flex items-center gap-1 text-[11px] text-rose-300 font-bold"><AlertCircle className="w-3 h-3" /> Conflicts</span>}
            </>
          )}
        </button>
      ) : (
        /* Expanded Developer Synchronization Modal / Drawer */
        <div className="w-96 max-w-[calc(100vw-2rem)] rounded-2xl bg-slate-900 border border-slate-800 text-slate-100 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-slate-950/70 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                <GitBranch className="w-4 h-4" />
              </div>
              <div>
                <h4 className="font-bold text-slate-100 text-sm">Team Code Sync</h4>
                <p className="text-[10px] text-slate-400">shared: origin/main (dev-only)</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={fetchStatus}
                disabled={loading}
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                title="Refresh Status"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Body Content */}
          <div className="p-4 space-y-3.5 max-h-[75vh] overflow-y-auto">
            {error && (
              <div className="p-2.5 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-[11px] flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Commit and Sync Overview */}
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="p-2.5 rounded-xl bg-slate-950/50 border border-slate-800">
                <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">Local HEAD</span>
                <span className="font-mono text-emerald-400 font-semibold">{status?.localSha || '...'}</span>
                <span className="text-slate-400 block text-[10px] mt-0.5">Ahead: {status?.ahead || 0}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-950/50 border border-slate-800">
                <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">Remote SHA</span>
                <span className="font-mono text-sky-400 font-semibold">{status?.remoteSha || '...'}</span>
                <span className="text-slate-400 block text-[10px] mt-0.5">Behind: {status?.behind || 0}</span>
              </div>
            </div>

            {/* Incoming Teammate Commits */}
            {status?.incomingCommits && status.incomingCommits.length > 0 && (
              <div className="p-3 rounded-xl bg-sky-950/30 border border-sky-900/50">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-bold text-sky-300 flex items-center gap-1.5">
                    <ArrowDownCircle className="w-3.5 h-3.5" /> Incoming Updates ({status.incomingCommits.length})
                  </span>
                  <span className="text-[10px] text-sky-400 font-medium">from teammates</span>
                </div>
                <div className="space-y-1 max-h-24 overflow-y-auto font-mono text-[10px] text-slate-300">
                  {status.incomingCommits.map((cm, i) => (
                    <div key={i} className="truncate hover:text-sky-200">
                      • {cm}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Uncommitted Local Work */}
            {status?.dirtyFiles && status.dirtyFiles.length > 0 && (
              <div className="p-3 rounded-xl bg-amber-950/20 border border-amber-900/40 text-[11px]">
                <span className="font-bold text-amber-300 block mb-1">
                  Local Uncommitted Work ({status.dirtyFiles.length})
                </span>
                <p className="text-[10px] text-slate-400 mb-2">
                  Auto-stash & safety backup protects these during pull.
                </p>
                <div className="space-y-0.5 max-h-20 overflow-y-auto font-mono text-[10px] text-slate-300">
                  {status.dirtyFiles.slice(0, 5).map((f, i) => (
                    <div key={i} className="truncate">[{f.status}] {f.file}</div>
                  ))}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="space-y-2 pt-1">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleFetchUpdates}
                  disabled={!!actionLoading}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold border border-slate-700 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${actionLoading === 'fetch' ? 'animate-spin' : ''}`} />
                  Check Updates
                </button>
                <button
                  onClick={handlePullChanges}
                  disabled={!!actionLoading}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold transition-colors shadow-md disabled:opacity-50 cursor-pointer"
                >
                  <ArrowDownCircle className={`w-3.5 h-3.5 ${actionLoading === 'pull' ? 'animate-bounce' : ''}`} />
                  Pull Latest
                </button>
              </div>

              {status?.ahead ? (
                <button
                  onClick={handlePushChanges}
                  disabled={!!actionLoading || status.behind > 0}
                  className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors shadow-md disabled:opacity-50 cursor-pointer"
                >
                  <ArrowUpCircle className={`w-3.5 h-3.5 ${actionLoading === 'push' ? 'animate-bounce' : ''}`} />
                  Push My Commits ({status.ahead})
                </button>
              ) : null}
            </div>

            {/* Console Log Output */}
            {logOutput && (
              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-[10px] text-slate-400 font-bold block mb-1">Execution Log:</span>
                <pre className="font-mono text-[9px] text-slate-300 whitespace-pre-wrap max-h-24 overflow-y-auto">
                  {logOutput}
                </pre>
              </div>
            )}

            {/* Safety Guarantee Footer */}
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400 pt-1 border-t border-slate-800/80">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Safety guarantee: Auto-backup created before every pull.</span>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};

