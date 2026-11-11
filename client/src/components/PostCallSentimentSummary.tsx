import React from 'react';
import { SentimentBadge } from './SentimentBadge.js';
import { SentimentType } from '../types.js';
import { CheckCircle2, AlertTriangle, ShieldCheck, HeartPulse } from 'lucide-react';

interface PostCallSentimentSummaryProps {
  overallSentiment?: SentimentType | string | null;
  sentimentScore?: number | null;
  customerExperience?: string | null;
  frustrationDetected?: boolean;
  requiresAssistance?: boolean;
  assistanceReason?: string | null;
  compact?: boolean;
}

export const PostCallSentimentSummary: React.FC<PostCallSentimentSummaryProps> = ({
  overallSentiment,
  sentimentScore,
  customerExperience,
  frustrationDetected = false,
  requiresAssistance = false,
  assistanceReason,
  compact = false
}) => {
  if (!overallSentiment) return null;

  const isFrustrated = String(overallSentiment).toUpperCase() === 'FRUSTRATED' || frustrationDetected;

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <SentimentBadge sentiment={overallSentiment} score={sentimentScore} size="sm" />
        {requiresAssistance && (
          <span className="text-[10px] text-rose-600 font-semibold bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
            Assistance Needed
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="bg-slate-50 border border-slate-200/90 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <HeartPulse className="w-4 h-4 text-indigo-600" />
          <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
            Call Sentiment Summary
          </h4>
        </div>
        <SentimentBadge
          sentiment={overallSentiment}
          score={sentimentScore}
          size="sm"
          requiresAssistance={requiresAssistance}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <div className="p-2.5 bg-white rounded-xl border border-slate-200">
          <p className="text-[10px] font-semibold text-slate-400 uppercase">Customer Experience</p>
          <p className="text-slate-800 font-medium mt-0.5">
            {customerExperience || (
              overallSentiment === 'POSITIVE'
                ? 'Satisfied with resolution and service.'
                : overallSentiment === 'NEGATIVE'
                ? 'Expressed issues or dissatisfaction.'
                : overallSentiment === 'FRUSTRATED'
                ? 'Customer experienced significant frustration.'
                : 'Standard informational exchange.'
            )}
          </p>
        </div>

        <div className="p-2.5 bg-white rounded-xl border border-slate-200 flex flex-col justify-between">
          <p className="text-[10px] font-semibold text-slate-400 uppercase">Signals & Flags</p>
          <div className="flex items-center gap-2 mt-1">
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md ${
              isFrustrated ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-600'
            }`}>
              Frustration: {isFrustrated ? 'Yes' : 'No'}
            </span>
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md ${
              requiresAssistance ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
            }`}>
              Human Assistance: {requiresAssistance ? 'Recommended' : 'Not Required'}
            </span>
          </div>
        </div>
      </div>

      {assistanceReason && requiresAssistance && (
        <p className="text-[11px] text-amber-800 bg-amber-50/80 p-2 rounded-xl border border-amber-200">
          <strong>Recommendation Reason:</strong> {assistanceReason}
        </p>
      )}
    </div>
  );
};

