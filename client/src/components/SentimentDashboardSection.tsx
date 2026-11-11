import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { SentimentBadge } from './SentimentBadge.js';
import { SentimentAnalyticsData, SentimentType } from '../types.js';
import {
  HeartPulse,
  Smile,
  Frown,
  Meh,
  Flame,
  AlertCircle,
  Calendar,
  Filter,
  RefreshCw,
  Loader2,
  TrendingUp,
  UserCheck,
  XCircle,
  Clock,
  Globe,
  Sparkles
} from 'lucide-react';

export const SentimentDashboardSection: React.FC = () => {
  const { token } = useAuth();

  const [data, setData] = useState<SentimentAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [period, setPeriod] = useState<'today' | '7days' | '30days' | 'all' | 'custom'>('all');
  const [category, setCategory] = useState<'ALL' | 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'FRUSTRATED'>('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Fetch sentiment statistics from real DB endpoint
  const fetchAnalytics = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        period,
        category
      });

      if (period === 'custom' && startDate && endDate) {
        params.append('startDate', startDate);
        params.append('endDate', endDate);
      }

      const res = await fetch(`/api/sentiment/analytics?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!res.ok) {
        throw new Error('Failed to load sentiment analytics');
      }

      const result = await res.json();
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Error fetching sentiment data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, [period, category]);

  // Handle manual override
  const handleOverride = async (callId: string, status: 'accepted' | 'dismissed') => {
    try {
      const res = await fetch(`/api/sentiment/calls/${callId}/override`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status })
      });

      if (res.ok) {
        // Refresh local data
        fetchAnalytics();
      }
    } catch (err) {
      console.error('Failed to update override:', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Control Bar */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
            <HeartPulse className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900">AI Sentiment Analysis & Experience Metrics</h2>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                Real-Time ML
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Continuously monitors multilingual customer interactions, predicts emotional valence, and detects frustration.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={fetchAnalytics}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-indigo-600' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Period Selector Tabs */}
        <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-xl">
          {[
            { id: 'today', label: 'Today' },
            { id: '7days', label: 'Last 7 Days' },
            { id: '30days', label: 'Last 30 Days' },
            { id: 'all', label: 'All Time' },
            { id: 'custom', label: 'Custom Range' }
          ].map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id as any)}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                period === p.id
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Category Filter */}
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <span className="font-semibold text-slate-600 text-xs">Category:</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as any)}
            className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="ALL">All Categories</option>
            <option value="POSITIVE">Positive Only</option>
            <option value="NEUTRAL">Neutral Only</option>
            <option value="NEGATIVE">Negative Only</option>
            <option value="FRUSTRATED">Frustrated Only</option>
          </select>
        </div>

        {/* Custom Date Inputs if selected */}
        {period === 'custom' && (
          <div className="flex items-center gap-2 w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-2 py-1 bg-slate-50 border border-slate-300 rounded-lg text-xs"
            />
            <span className="text-slate-400">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-2 py-1 bg-slate-50 border border-slate-300 rounded-lg text-xs"
            />
            <button
              type="button"
              onClick={fetchAnalytics}
              className="px-2.5 py-1 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700"
            >
              Apply
            </button>
          </div>
        )}
      </div>

      {loading && !data ? (
        <div className="py-20 flex flex-col items-center justify-center text-center">
          <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-3" />
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Loading Real-Time Sentiment Telemetry...
          </p>
        </div>
      ) : error ? (
        <div className="p-6 bg-rose-50 border border-rose-200 text-rose-700 rounded-2xl text-xs">
          <p className="font-bold">Error loading sentiment analytics</p>
          <p className="mt-1">{error}</p>
        </div>
      ) : data ? (
        <>
          {/* KPI Statistics Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3.5">
            {/* Total Analyzed */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
              <div className="flex items-center justify-between text-slate-500 mb-2">
                <span className="text-xs font-semibold">Analyzed Calls</span>
                <HeartPulse className="w-4 h-4 text-indigo-600" />
              </div>
              <p className="text-2xl font-extrabold text-slate-900">{data.totalAnalyzed}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">100% of finished calls</p>
            </div>

            {/* Positive */}
            <div className="bg-white p-4 rounded-2xl border border-emerald-100 shadow-2xs">
              <div className="flex items-center justify-between text-emerald-700 mb-2">
                <span className="text-xs font-semibold">Positive</span>
                <Smile className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="flex items-baseline gap-2">
                <p className="text-2xl font-extrabold text-emerald-700">{data.counts.positive}</p>
                <span className="text-xs font-bold text-emerald-600">{data.percentages.positive}%</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">Satisfied customers</p>
            </div>

            {/* Neutral */}
            <div className="bg-white p-4 rounded-2xl border border-blue-100 shadow-2xs">
              <div className="flex items-center justify-between text-blue-700 mb-2">
                <span className="text-xs font-semibold">Neutral</span>
                <Meh className="w-4 h-4 text-blue-600" />
              </div>
              <div className="flex items-baseline gap-2">
                <p className="text-2xl font-extrabold text-blue-700">{data.counts.neutral}</p>
                <span className="text-xs font-bold text-blue-600">{data.percentages.neutral}%</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">Standard inquiries</p>
            </div>

            {/* Negative */}
            <div className="bg-white p-4 rounded-2xl border border-amber-100 shadow-2xs">
              <div className="flex items-center justify-between text-amber-700 mb-2">
                <span className="text-xs font-semibold">Negative</span>
                <Frown className="w-4 h-4 text-amber-600" />
              </div>
              <div className="flex items-baseline gap-2">
                <p className="text-2xl font-extrabold text-amber-700">{data.counts.negative}</p>
                <span className="text-xs font-bold text-amber-600">{data.percentages.negative}%</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">Dissatisfied/issues</p>
            </div>

            {/* Frustrated */}
            <div className="bg-white p-4 rounded-2xl border border-rose-100 shadow-2xs">
              <div className="flex items-center justify-between text-rose-700 mb-2">
                <span className="text-xs font-semibold">Frustrated</span>
                <Flame className="w-4 h-4 text-rose-600 animate-pulse" />
              </div>
              <div className="flex items-baseline gap-2">
                <p className="text-2xl font-extrabold text-rose-700">{data.counts.frustrated}</p>
                <span className="text-xs font-bold text-rose-600">{data.percentages.frustrated}%</span>
              </div>
              <p className="text-[11px] text-rose-500 font-medium mt-0.5">High anger/repeat</p>
            </div>

            {/* Requires Assistance */}
            <div className="bg-white p-4 rounded-2xl border border-rose-200 shadow-2xs bg-rose-50/20">
              <div className="flex items-center justify-between text-rose-800 mb-2">
                <span className="text-xs font-semibold">Assistance Needed</span>
                <AlertCircle className="w-4 h-4 text-rose-600" />
              </div>
              <p className="text-2xl font-extrabold text-rose-800">{data.requiresHumanAssistance}</p>
              <p className="text-[11px] text-rose-600 font-semibold mt-0.5">Escalated calls</p>
            </div>
          </div>

          {/* Visual Distribution Bar & Trend */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs space-y-5">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-indigo-600" />
                Sentiment Category Distribution
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Proportional breakdown of customer conversations across the 4 primary emotion classifications.
              </p>
            </div>

            {/* Multi-segment distribution progress bar */}
            <div className="w-full h-5 rounded-full overflow-hidden flex bg-slate-100 border border-slate-200">
              {data.percentages.positive > 0 && (
                <div
                  style={{ width: `${data.percentages.positive}%` }}
                  className="bg-emerald-500 h-full transition-all"
                  title={`Positive: ${data.percentages.positive}%`}
                />
              )}
              {data.percentages.neutral > 0 && (
                <div
                  style={{ width: `${data.percentages.neutral}%` }}
                  className="bg-blue-400 h-full transition-all"
                  title={`Neutral: ${data.percentages.neutral}%`}
                />
              )}
              {data.percentages.negative > 0 && (
                <div
                  style={{ width: `${data.percentages.negative}%` }}
                  className="bg-amber-400 h-full transition-all"
                  title={`Negative: ${data.percentages.negative}%`}
                />
              )}
              {data.percentages.frustrated > 0 && (
                <div
                  style={{ width: `${data.percentages.frustrated}%` }}
                  className="bg-rose-500 h-full transition-all"
                  title={`Frustrated: ${data.percentages.frustrated}%`}
                />
              )}
            </div>

            {/* Visual Legend */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="flex items-center gap-2 p-2 bg-slate-50 rounded-xl">
                <span className="w-3 h-3 rounded-full bg-emerald-500 shrink-0" />
                <span className="font-semibold text-slate-700">Positive:</span>
                <span className="font-bold text-slate-900">{data.counts.positive} ({data.percentages.positive}%)</span>
              </div>
              <div className="flex items-center gap-2 p-2 bg-slate-50 rounded-xl">
                <span className="w-3 h-3 rounded-full bg-blue-400 shrink-0" />
                <span className="font-semibold text-slate-700">Neutral:</span>
                <span className="font-bold text-slate-900">{data.counts.neutral} ({data.percentages.neutral}%)</span>
              </div>
              <div className="flex items-center gap-2 p-2 bg-slate-50 rounded-xl">
                <span className="w-3 h-3 rounded-full bg-amber-400 shrink-0" />
                <span className="font-semibold text-slate-700">Negative:</span>
                <span className="font-bold text-slate-900">{data.counts.negative} ({data.percentages.negative}%)</span>
              </div>
              <div className="flex items-center gap-2 p-2 bg-slate-50 rounded-xl">
                <span className="w-3 h-3 rounded-full bg-rose-500 shrink-0" />
                <span className="font-semibold text-slate-700">Frustrated:</span>
                <span className="font-bold text-slate-900">{data.counts.frustrated} ({data.percentages.frustrated}%)</span>
              </div>
            </div>
          </div>

          {/* Recent Analyzed Conversations Table */}
          <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Analyzed Customer Conversations</h3>
                <p className="text-xs text-slate-500">Real-time database log of classified customer interactions</p>
              </div>
              <span className="text-xs text-slate-400 font-medium">
                Showing {data.recentCalls.length} records
              </span>
            </div>

            {data.recentCalls.length === 0 ? (
              <div className="p-12 text-center text-slate-400 text-xs">
                No conversation sentiment records found matching this filter.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 uppercase tracking-wider text-[11px]">
                    <tr>
                      <th className="py-3 px-4 font-semibold">Customer</th>
                      <th className="py-3 px-4 font-semibold">Overall Sentiment</th>
                      <th className="py-3 px-4 font-semibold">Language</th>
                      <th className="py-3 px-4 font-semibold">Duration</th>
                      <th className="py-3 px-4 font-semibold">Human Assistance</th>
                      <th className="py-3 px-4 font-semibold">Date & Time</th>
                      <th className="py-3 px-4 font-semibold text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {data.recentCalls.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 font-medium text-slate-900">
                          <div>
                            <p className="font-bold">{c.customerName || 'Anonymous Customer'}</p>
                            <p className="text-[11px] text-slate-400 font-mono">{c.customerPhone || c.callId.slice(0, 14)}</p>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <SentimentBadge
                            sentiment={c.overallSentiment}
                            score={c.sentimentScore}
                            size="sm"
                          />
                        </td>
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center gap-1 uppercase font-semibold text-[10px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                            <Globe className="w-3 h-3 text-slate-400" />
                            {c.language || 'en'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-600 font-mono">
                          {c.duration}s
                        </td>
                        <td className="py-3 px-4">
                          {c.requiresAssistance ? (
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                                <AlertCircle className="w-3 h-3 text-rose-600" />
                                Recommended
                              </span>
                              {c.assistanceReason && (
                                <p className="text-[10px] text-slate-500 max-w-xs truncate" title={c.assistanceReason}>
                                  {c.assistanceReason}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-400 font-medium">Not Required</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-500">
                          {new Date(c.createdAt).toLocaleString(undefined, {
                            dateStyle: 'short',
                            timeStyle: 'short'
                          })}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {c.requiresAssistance && (
                            <div className="flex items-center justify-end gap-1.5">
                              {c.assistanceStatus !== 'accepted' && (
                                <button
                                  type="button"
                                  onClick={() => handleOverride(c.callId, 'accepted')}
                                  className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-semibold cursor-pointer shadow-xs"
                                  title="Accept & mark attended"
                                >
                                  <UserCheck className="w-3 h-3" />
                                  Attend
                                </button>
                              )}
                              {c.assistanceStatus !== 'dismissed' && (
                                <button
                                  type="button"
                                  onClick={() => handleOverride(c.callId, 'dismissed')}
                                  className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-[10px] font-medium cursor-pointer"
                                  title="Dismiss recommendation"
                                >
                                  <XCircle className="w-3 h-3" />
                                  Dismiss
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
};

