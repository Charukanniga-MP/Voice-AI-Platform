import React from 'react';
import { SentimentBadge } from './SentimentBadge.js';
import { SentimentType } from '../types.js';
import { AlertCircle, UserCheck, XCircle, Sparkles, MessageSquare, ShieldAlert } from 'lucide-react';

interface LiveSentimentCardProps {
  sentiment?: SentimentType | null;
  confidenceScore?: number | null;
  reason?: string | null;
  triggerText?: string | null;
  requiresHumanAssistance?: boolean;
  assistanceStatus?: 'none' | 'pending' | 'accepted' | 'dismissed' | null;
  onOverride?: (status: 'accepted' | 'dismissed') => void;
  canManageOverride?: boolean;
}

export const LiveSentimentCard: React.FC<LiveSentimentCardProps> = ({
  sentiment,
  confidenceScore,
  reason,
  triggerText,
  requiresHumanAssistance = false,
  assistanceStatus = 'none',
  onOverride,
  canManageOverride = false
}) => {
  if (!sentiment) {
    return (
      <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3 text-xs text-slate-500 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-500 animate-spin" />
          <span>Awaiting customer speech for live sentiment analysis...</span>
        </div>
        <SentimentBadge sentiment={null} size="xs" />
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border transition-all overflow-hidden ${
      requiresHumanAssistance
        ? 'bg-rose-50/70 border-rose-300 shadow-sm'
        : sentiment === 'POSITIVE'
        ? 'bg-emerald-50/50 border-emerald-200'
        : sentiment === 'NEGATIVE'
        ? 'bg-amber-50/50 border-amber-200'
        : 'bg-slate-50 border-slate-200'
    }`}>
      {/* Top Header Bar */}
      <div className="px-4 py-2.5 flex items-center justify-between border-b border-inherit gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
            Customer Sentiment
          </span>
          <SentimentBadge
            sentiment={sentiment}
            score={confidenceScore}
            size="sm"
            requiresAssistance={requiresHumanAssistance}
          />
        </div>

        {requiresHumanAssistance && (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-600 text-white shadow-xs animate-pulse">
            <AlertCircle className="w-3 h-3" />
            Human Assistance Priority
          </span>
        )}
      </div>

      <div className="p-3.5 space-y-2.5 text-xs">
        {/* Human Assistance Alert Banner */}
        {requiresHumanAssistance && (
          <div className="p-2.5 bg-white/90 border border-rose-200 rounded-xl text-rose-800 flex items-start justify-between gap-3 shadow-2xs">
            <div className="flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-rose-900">Customer may require human assistance.</p>
                <p className="text-[11px] text-rose-700 mt-0.5">
                  {reason || 'Strong or repeated frustration signals detected in customer messages.'}
                </p>
              </div>
            </div>

            {/* Manual Override Action Controls */}
            {canManageOverride && onOverride && (
              <div className="flex items-center gap-1.5 shrink-0">
                {assistanceStatus !== 'accepted' && (
                  <button
                    type="button"
                    onClick={() => onOverride('accepted')}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-semibold transition cursor-pointer shadow-xs"
                    title="Accept recommendation and prioritize assistance"
                  >
                    <UserCheck className="w-3 h-3" />
                    Accept
                  </button>
                )}
                {assistanceStatus !== 'dismissed' && (
                  <button
                    type="button"
                    onClick={() => onOverride('dismissed')}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-[10px] font-medium transition cursor-pointer"
                    title="Override recommendation (customer is fine or false positive)"
                  >
                    <XCircle className="w-3 h-3" />
                    Dismiss
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Latest Customer Utterance Snippet */}
        {triggerText && (
          <div className="flex items-start gap-2 bg-white/80 p-2.5 rounded-xl border border-slate-200/70 text-slate-700">
            <MessageSquare className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
            <div className="flex-1 overflow-hidden">
              <p className="text-[10px] font-semibold uppercase text-slate-400">Trigger Utterance</p>
              <p className="italic text-slate-800 text-[11px] line-clamp-2 mt-0.5">
                "{triggerText}"
              </p>
            </div>
          </div>
        )}

        {/* Rationale explanation if not frustrated */}
        {!requiresHumanAssistance && reason && (
          <p className="text-[11px] text-slate-500">
            <strong>Analysis:</strong> {reason}
          </p>
        )}
      </div>
    </div>
  );
};

