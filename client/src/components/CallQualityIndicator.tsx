import React, { useState, useEffect } from 'react';
import { Wifi, AlertTriangle, RefreshCw, CheckCircle2, Activity, Info, X } from 'lucide-react';
import { callQualityMonitor, CallQualityStats } from '../services/callQuality.js';

interface CallQualityIndicatorProps {
  className?: string;
  showDetailsModal?: boolean;
  isCallActive?: boolean;
}

export const CallQualityIndicator: React.FC<CallQualityIndicatorProps> = ({ className = '', isCallActive = true }) => {
  const [stats, setStats] = useState<CallQualityStats>(callQualityMonitor.getCurrentStats());
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    const unsubscribe = callQualityMonitor.onQuality((newStats) => {
      setStats(newStats);
    });
    return () => unsubscribe();
  }, []);

  if (!isCallActive) return null;

  // Styling helpers
  const getBadgeConfig = () => {
    if (stats.connectionState === 'reconnecting') {
      return {
        bg: 'bg-amber-500/10 border-amber-500/30 text-amber-600',
        dot: 'bg-amber-500 animate-ping',
        label: 'Reconnecting...',
        color: 'text-amber-500'
      };
    }
    if (stats.connectionState === 'failed' || stats.connectionState === 'disconnected') {
      return {
        bg: 'bg-red-500/10 border-red-500/30 text-red-600',
        dot: 'bg-red-500',
        label: 'Disconnected',
        color: 'text-red-500'
      };
    }

    switch (stats.quality) {
      case 'excellent':
        return {
          bg: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700',
          dot: 'bg-emerald-500',
          label: 'Excellent',
          color: 'text-emerald-500'
        };
      case 'good':
        return {
          bg: 'bg-sky-500/10 border-sky-500/30 text-sky-700',
          dot: 'bg-sky-500',
          label: 'Good',
          color: 'text-sky-500'
        };
      case 'poor':
      default:
        return {
          bg: 'bg-rose-500/10 border-rose-500/30 text-rose-700',
          dot: 'bg-rose-500 animate-pulse',
          label: 'Poor',
          color: 'text-rose-500'
        };
    }
  };

  const badge = getBadgeConfig();

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      {/* Clickable Quality Pill */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold transition-all shadow-xs cursor-pointer hover:scale-105 ${badge.bg}`}
        title="Click to view live network & audio telemetry"
      >
        <span className={`w-2 h-2 rounded-full ${badge.dot}`} />
        <Wifi className="w-3.5 h-3.5" />
        <span>{badge.label}</span>
        <span className="text-[10px] font-mono opacity-80 font-normal">
          {stats.latency}ms
        </span>
      </button>

      {/* Reconnection Status Banner (Prominent during network interruptions) */}
      {stats.connectionState === 'reconnecting' && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl bg-amber-500 text-white shadow-2xl border border-amber-400 font-sans text-xs font-bold animate-bounce">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>
            Network connection interrupted. Attempting automatic reconnection...
            {stats.reconnectAttempts > 0 ? ` (Attempt ${stats.reconnectAttempts}/3)` : ''}
          </span>
        </div>
      )}

      {/* Detailed Technical Telemetry Popover */}
      {showDetails && (
        <div className="absolute top-full right-0 mt-2 z-50 w-72 p-4 rounded-2xl bg-white border border-slate-200 shadow-2xl text-slate-900 text-xs space-y-3 animate-in fade-in zoom-in-95 duration-100">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <div className="flex items-center gap-2 font-black text-slate-800">
              <Activity className="w-4 h-4 text-indigo-600" />
              <span>Real-Time Call Telemetry</span>
            </div>
            <button
              onClick={() => setShowDetails(false)}
              className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Latency (RTT)</span>
              <span className="font-mono text-slate-800 font-extrabold text-sm">{stats.latency} ms</span>
            </div>
            <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Packet Loss</span>
              <span className={`font-mono font-extrabold text-sm ${stats.packetLoss > 2 ? 'text-rose-600' : 'text-slate-800'}`}>
                {stats.packetLoss.toFixed(1)}%
              </span>
            </div>
            <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Jitter Buffer</span>
              <span className="font-mono text-slate-800 font-extrabold text-sm">{stats.jitter} ms</span>
            </div>
            <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Estimated MOS</span>
              <span className="font-mono text-slate-800 font-extrabold text-sm">{stats.mos.toFixed(1)} / 5.0</span>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 space-y-1 text-[11px] text-slate-500">
            <div className="flex items-center justify-between">
              <span>Connection Status:</span>
              <span className="font-semibold text-slate-800 capitalize">{stats.connectionState}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Automatic Reconnects:</span>
              <span className="font-semibold text-slate-800">{stats.reconnectAttempts}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

