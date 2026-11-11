import React from 'react';
import { Smile, Frown, Meh, AlertTriangle, Flame } from 'lucide-react';
import { SentimentType } from '../types.js';

interface SentimentBadgeProps {
  sentiment?: SentimentType | string | null;
  score?: number | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showScore?: boolean;
  requiresAssistance?: boolean;
}

export const SentimentBadge: React.FC<SentimentBadgeProps> = ({
  sentiment,
  score,
  size = 'md',
  showScore = true,
  requiresAssistance = false
}) => {
  if (!sentiment) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500 border border-slate-200">
        <Meh className="w-3 h-3" />
        <span>Pending</span>
      </span>
    );
  }

  const s = String(sentiment).toUpperCase();

  const getStyle = () => {
    switch (s) {
      case 'POSITIVE':
        return {
          bg: 'bg-emerald-50 text-emerald-800 border-emerald-200',
          icon: <Smile className="w-3.5 h-3.5 text-emerald-600" />,
          label: 'Positive',
          dot: 'bg-emerald-500'
        };
      case 'NEGATIVE':
        return {
          bg: 'bg-amber-50 text-amber-800 border-amber-200',
          icon: <Frown className="w-3.5 h-3.5 text-amber-600" />,
          label: 'Negative',
          dot: 'bg-amber-500'
        };
      case 'FRUSTRATED':
        return {
          bg: 'bg-rose-50 text-rose-800 border-rose-300 shadow-xs',
          icon: <Flame className="w-3.5 h-3.5 text-rose-600 animate-pulse" />,
          label: 'Frustrated',
          dot: 'bg-rose-500 animate-ping'
        };
      case 'NEUTRAL':
      default:
        return {
          bg: 'bg-blue-50 text-blue-800 border-blue-200',
          icon: <Meh className="w-3.5 h-3.5 text-blue-600" />,
          label: 'Neutral',
          dot: 'bg-blue-500'
        };
    }
  };

  const style = getStyle();

  const sizeClasses = {
    xs: 'text-[10px] px-1.5 py-0.5 gap-1',
    sm: 'text-xs px-2 py-0.5 gap-1.5',
    md: 'text-xs px-2.5 py-1 gap-1.5 font-semibold',
    lg: 'text-sm px-3.5 py-1.5 gap-2 font-bold'
  };

  const scorePct = score != null ? Math.round(score * 100) : null;

  return (
    <span
      className={`inline-flex items-center rounded-full border transition-all ${style.bg} ${sizeClasses[size]}`}
    >
      {style.icon}
      <span>{style.label}</span>
      {showScore && scorePct !== null && (
        <span className="opacity-75 text-[10px] font-mono">({scorePct}%)</span>
      )}
      {requiresAssistance && (
        <span className="flex h-2 w-2 relative ml-0.5" title="Requires Human Assistance">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
        </span>
      )}
    </span>
  );
};

