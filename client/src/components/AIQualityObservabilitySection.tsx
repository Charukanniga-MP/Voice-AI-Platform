import React, { useState, useEffect, useMemo } from 'react';
import {
  Sparkles, ShieldCheck, AlertTriangle, AlertCircle, CheckCircle2,
  TrendingUp, Clock, RefreshCw, Download, Search, Eye, X,
  Layers, MessageSquare, ThumbsUp, Activity, ArrowUpRight, ArrowDownRight,
  Filter, ChevronLeft, ChevronRight, Zap, Award
} from 'lucide-react';
import {
  AIQualityOverviewData,
  AIQualityTrendPoint,
  AIQualityAlertItem,
  ConversationEvaluationItem,
  TurnEvaluationDetail,
  RAGEvaluationDetail,
  LatencySpanDetail
} from '../types.js';

interface AIQualityObservabilitySectionProps {
  token: string | null;
}

export const AIQualityObservabilitySection: React.FC<AIQualityObservabilitySectionProps> = ({ token }) => {
  // Filters & State
  const [period, setPeriod] = useState<string>('30d');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Overview & Trends
  const [overview, setOverview] = useState<AIQualityOverviewData | null>(null);
  const [trends, setTrends] = useState<AIQualityTrendPoint[]>([]);
  const [alerts, setAlerts] = useState<AIQualityAlertItem[]>([]);

  // History & Pagination
  const [history, setHistory] = useState<ConversationEvaluationItem[]>([]);
  const [historyPage, setHistoryPage] = useState<number>(1);
  const [historyTotalPages, setHistoryTotalPages] = useState<number>(1);
  const [historySearch, setHistorySearch] = useState<string>('');
  const [historyFilter, setHistoryFilter] = useState<string>('all');
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);

  // Deep-Dive Modal State
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [callDetail, setCallDetail] = useState<{
    conversation: any;
    aiEvaluations: TurnEvaluationDetail[];
    ragEvaluations: RAGEvaluationDetail[];
    latencyMetrics: LatencySpanDetail[];
    speechEvaluations: any[];
    handoverEvaluations: any[];
    feedback: any;
    repetitionIncidents: any[];
    transcripts: any[];
  } | null>(null);

  const [activeModalTab, setActiveModalTab] = useState<'turns' | 'rag' | 'latency' | 'feedback'>('turns');

  // Fetch Overview, Trends, and Alerts
  const fetchDashboardData = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const headers = { Authorization: `Bearer ${token}` };

      const [ovRes, trRes, alRes] = await Promise.all([
        fetch(`/api/ai-evaluation/overview?period=${period}`, { headers }),
        fetch(`/api/ai-evaluation/trends?period=${period}`, { headers }),
        fetch('/api/ai-evaluation/alerts', { headers })
      ]);

      if (!ovRes.ok) throw new Error('Failed to load AI evaluation overview');
      const ovData = await ovRes.json();
      setOverview(ovData);

      if (trRes.ok) {
        const trData = await trRes.json();
        setTrends(trData.trends || []);
      }

      if (alRes.ok) {
        const alData = await alRes.json();
        setAlerts(alData.alerts || []);
      }
    } catch (err: any) {
      console.error('[AIQualityUI] Fetch error:', err);
      setError(err.message || 'Error loading AI quality analytics.');
    } finally {
      setLoading(false);
    }
  };

  // Fetch History Table
  const fetchHistory = async () => {
    if (!token) return;
    setHistoryLoading(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const q = new URLSearchParams({
        page: historyPage.toString(),
        limit: '10',
        search: historySearch,
        filter: historyFilter
      });
      const res = await fetch(`/api/ai-evaluation/history?${q.toString()}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setHistory(data.evaluations || []);
        setHistoryTotalPages(data.totalPages || 1);
      }
    } catch (err) {
      console.error('[AIQualityUI] History error:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, [token, period]);

  useEffect(() => {
    fetchHistory();
  }, [token, historyPage, historyFilter]);

  // Handle Search submit
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setHistoryPage(1);
    fetchHistory();
  };

  // Dismiss Alert
  const dismissAlert = async (id: string) => {
    if (!token) return;
    try {
      await fetch(`/api/ai-evaluation/alerts/${id}/dismiss`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      setAlerts(prev => prev.filter(a => a.id !== id));
      if (overview) {
        setOverview({ ...overview, activeAlertsCount: Math.max(0, overview.activeAlertsCount - 1) });
      }
    } catch (err) {
      console.error('[AIQualityUI] Error dismissing alert:', err);
    }
  };

  // Export CSV
  const handleExportCsv = () => {
    if (!token) return;
    window.open(`/api/ai-evaluation/export-csv?period=${period}`, '_blank');
  };

  // Open Deep-Dive Modal
  const openCallDetail = async (callRecordId: string) => {
    setSelectedCallId(callRecordId);
    setDetailLoading(true);
    setActiveModalTab('turns');
    try {
      const res = await fetch(`/api/ai-evaluation/history/${callRecordId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setCallDetail(data);
      }
    } catch (err) {
      console.error('[AIQualityUI] Detail fetch error:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  // SVG Chart helpers
  const maxScore = 100;
  const chartPoints = useMemo(() => {
    if (trends.length < 2) return [];
    const width = 600;
    const height = 140;
    const step = width / (trends.length - 1);

    return trends.map((t, idx) => ({
      x: idx * step,
      yQuality: height - (t.overallQualityScore / maxScore) * height,
      yRelevance: height - (t.answerRelevance / maxScore) * height,
      date: t.date,
      quality: t.overallQualityScore,
      relevance: t.answerRelevance
    }));
  }, [trends]);

  const qualityPath = useMemo(() => {
    if (chartPoints.length === 0) return '';
    return chartPoints.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x} ${p.yQuality}`, '');
  }, [chartPoints]);

  const relevancePath = useMemo(() => {
    if (chartPoints.length === 0) return '';
    return chartPoints.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x} ${p.yRelevance}`, '');
  }, [chartPoints]);

  return (
    <div className="space-y-6">
      {/* Top Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 rounded-2xl border border-indigo-900/40 shadow-xl text-white">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shadow-inner">
            <Sparkles className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
              AI Quality & Observability Engine
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-medium">
                Live Enterprise Evaluator
              </span>
            </h1>
            <p className="text-xs md:text-sm text-slate-400 mt-1">
              Automated scoring across 9 quality dimensions, RAGAS metrics, hallucination detection, and OpenTelemetry spans.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Period Selector */}
          <div className="flex bg-slate-800/80 p-1 rounded-xl border border-slate-700">
            {[
              { id: 'today', label: 'Today' },
              { id: '7d', label: '7D' },
              { id: '30d', label: '30D' },
              { id: '90d', label: '90D' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setPeriod(tab.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  period === tab.id
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            onClick={fetchDashboardData}
            title="Refresh analytics"
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition-all shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
          </button>

          <button
            onClick={handleExportCsv}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-semibold transition-all shadow-sm"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-center gap-3 text-sm">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* KPI Cards Grid (10 Core Metrics) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {/* 1. Overall Score Hero */}
        <div className="col-span-2 md:col-span-1 bg-gradient-to-br from-indigo-900/40 to-slate-900 border border-indigo-700/40 p-4 rounded-2xl shadow-md">
          <div className="flex items-center justify-between text-indigo-400 text-xs font-semibold mb-2">
            <span>Overall AI Quality</span>
            <Award className="w-4 h-4" />
          </div>
          <div className="text-3xl font-extrabold text-white">
            {overview?.kpis.overallQuality.score.toFixed(1) || '0.0'}
            <span className="text-sm text-slate-400 font-normal"> /100</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-medium">
              {overview?.kpis.overallQuality.status === 'excellent' ? 'Excellent' : 'Healthy'}
            </span>
            <span className="text-[11px] text-slate-400">
              {overview?.totalEvaluatedCalls || 0} calls ({overview?.coveragePercentage || 100}% cov.)
            </span>
          </div>
        </div>

        {/* 2. Answer Relevance */}
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl shadow-md">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>Answer Relevance</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {overview?.kpis.answerRelevance.score.toFixed(1) || '0.0'}%
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
            <div
              className="bg-emerald-500 h-full rounded-full"
              style={{ width: `${Math.min(100, overview?.kpis.answerRelevance.score || 0)}%` }}
            />
          </div>
          <p className="text-[10px] text-slate-500 mt-2">Query intent alignment</p>
        </div>

        {/* 3. Answer Correctness */}
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl shadow-md">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>Answer Correctness</span>
            <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {overview?.kpis.answerCorrectness.score.toFixed(1) || '0.0'}%
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
            <div
              className="bg-blue-500 h-full rounded-full"
              style={{ width: `${Math.min(100, overview?.kpis.answerCorrectness.score || 0)}%` }}
            />
          </div>
          <p className="text-[10px] text-slate-500 mt-2">KB fact verification</p>
        </div>

        {/* 4. Hallucination Control */}
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl shadow-md">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>Hallucination Control</span>
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {overview?.kpis.hallucinationControl.score.toFixed(1) || '0.0'}%
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
            <div
              className="bg-indigo-500 h-full rounded-full"
              style={{ width: `${Math.min(100, overview?.kpis.hallucinationControl.score || 0)}%` }}
            />
          </div>
          <p className="text-[10px] text-slate-500 mt-2">Grounded claim fidelity</p>
        </div>

        {/* 5. Retrieval Accuracy */}
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl shadow-md">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>Retrieval Accuracy</span>
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {overview?.kpis.retrievalAccuracy.score.toFixed(1) || '0.0'}%
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
            <div
              className="bg-cyan-500 h-full rounded-full"
              style={{ width: `${Math.min(100, overview?.kpis.retrievalAccuracy.score || 0)}%` }}
            />
          </div>
          <p className="text-[10px] text-slate-500 mt-2">RAGAS Context Precision</p>
        </div>

        {/* 6. Response Latency */}
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl shadow-md">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>Response Latency</span>
            <Clock className="w-3.5 h-3.5 text-teal-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {overview?.kpis.responseLatency.score.toFixed(0) || '0'}
            <span className="text-xs text-slate-400 font-normal"> ms</span>
          </div>
          <div className="text-[11px] text-teal-400 mt-2 flex items-center gap-1 font-mono">
            <Zap className="w-3 h-3" />
            P95: {overview?.kpis.responseLatency.p95Ms || 0} ms
          </div>
          <p className="text-[10px] text-slate-500 mt-1">STT + LLM + TTS pipeline</p>
        </div>

        {/* 7. Speech Recognition Accuracy */}
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl shadow-md">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>Speech Accuracy</span>
            <Activity className="w-3.5 h-3.5 text-violet-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {overview?.kpis.speechAccuracy.score.toFixed(1) || '0.0'}%
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
            <div
              className="bg-violet-500 h-full rounded-full"
              style={{ width: `${Math.min(100, overview?.kpis.speechAccuracy.score || 0)}%` }}
            />
          </div>
          <p className="text-[10px] text-slate-500 mt-2">WER/CER verified</p>
        </div>

        {/* 8. Handover Success Rate */}
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl shadow-md">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>Handover Success</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {overview?.kpis.handoverSuccess.score.toFixed(1) || '0.0'}%
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
            <div
              className="bg-amber-500 h-full rounded-full"
              style={{ width: `${Math.min(100, overview?.kpis.handoverSuccess.score || 0)}%` }}
            />
          </div>
          <p className="text-[10px] text-slate-500 mt-2">Escalation transfer rate</p>
        </div>

        {/* 9. Customer Satisfaction (CSAT) */}
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl shadow-md">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>Customer CSAT</span>
            <ThumbsUp className="w-3.5 h-3.5 text-pink-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {overview?.kpis.customerSatisfaction.score.toFixed(1) || '0.0'}%
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
            <div
              className="bg-pink-500 h-full rounded-full"
              style={{ width: `${Math.min(100, overview?.kpis.customerSatisfaction.score || 0)}%` }}
            />
          </div>
          <p className="text-[10px] text-slate-500 mt-2">Post-call customer rating</p>
        </div>

        {/* 10. Repetition Control */}
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl shadow-md">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>Repetition Control</span>
            <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {overview?.kpis.repetitionControl.score.toFixed(1) || '0.0'}%
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
            <div
              className="bg-emerald-500 h-full rounded-full"
              style={{ width: `${Math.min(100, overview?.kpis.repetitionControl.score || 0)}%` }}
            />
          </div>
          <p className="text-[10px] text-slate-500 mt-2">Context memory retention</p>
        </div>
      </div>

      {/* Interactive Trends & Quality Alerts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Interactive Trends Line Chart (2 Cols) */}
        <div className="lg:col-span-2 bg-slate-900/90 border border-slate-800 p-5 rounded-2xl shadow-md flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-indigo-400" />
                AI Quality & Relevance Time-Series Trends
              </h2>
              <p className="text-xs text-slate-400">Tracking daily quality score vs answer relevance</p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5 text-indigo-400">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 inline-block" /> Overall Score
              </span>
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> Relevance
              </span>
            </div>
          </div>

          {/* SVG Trend Chart */}
          <div className="w-full h-44 relative bg-slate-950/60 rounded-xl p-3 border border-slate-800 flex items-center justify-center">
            {chartPoints.length > 1 ? (
              <svg viewBox="0 0 600 140" className="w-full h-full overflow-visible">
                {/* Horizontal reference grid lines */}
                <line x1="0" y1="35" x2="600" y2="35" stroke="#334155" strokeDasharray="3 3" strokeWidth="0.5" />
                <line x1="0" y1="70" x2="600" y2="70" stroke="#334155" strokeDasharray="3 3" strokeWidth="0.5" />
                <line x1="0" y1="105" x2="600" y2="105" stroke="#334155" strokeDasharray="3 3" strokeWidth="0.5" />

                {/* Overall Quality Path */}
                <path d={qualityPath} fill="none" stroke="#6366f1" strokeWidth="3" strokeLinecap="round" />
                {/* Relevance Path */}
                <path d={relevancePath} fill="none" stroke="#10b981" strokeWidth="2" strokeDasharray="4 2" strokeLinecap="round" />

                {/* Points */}
                {chartPoints.map((p, idx) => (
                  <g key={idx}>
                    <circle cx={p.x} cy={p.yQuality} r="4" fill="#6366f1" stroke="#1e1b4b" strokeWidth="2" />
                  </g>
                ))}
              </svg>
            ) : (
              <div className="text-center text-xs text-slate-500">
                Evaluating initial calls in this period to populate continuous trend lines.
              </div>
            )}
          </div>
          <div className="flex justify-between text-[11px] text-slate-500 mt-2 px-1">
            <span>{trends[0]?.date || 'Start of period'}</span>
            <span>{trends[trends.length - 1]?.date || 'Present'}</span>
          </div>
        </div>

        {/* Right: Active Quality Alerts (1 Col) */}
        <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl shadow-md flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              Active Quality Alerts
              {alerts.length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-xs border border-amber-500/30">
                  {alerts.length}
                </span>
              )}
            </h2>
          </div>

          <div className="space-y-2.5 overflow-y-auto max-h-56 pr-1">
            {alerts.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-500 flex flex-col items-center gap-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-500/40" />
                <span>Zero active alerts. System operating within optimal quality thresholds.</span>
              </div>
            ) : (
              alerts.map(alert => (
                <div
                  key={alert.id}
                  className={`p-3 rounded-xl border text-xs flex items-start justify-between gap-2 ${
                    alert.severity === 'critical'
                      ? 'bg-rose-950/30 border-rose-800/50 text-rose-200'
                      : 'bg-amber-950/30 border-amber-800/50 text-amber-200'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold ${
                        alert.severity === 'critical' ? 'bg-rose-500 text-white' : 'bg-amber-500 text-slate-950'
                      }`}>
                        {alert.severity}
                      </span>
                      <span className="font-semibold">{alert.alertType.replace('_', ' ')}</span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-slate-300">{alert.message}</p>
                  </div>
                  <button
                    onClick={() => dismissAlert(alert.id)}
                    className="p-1 hover:bg-slate-800/80 rounded text-slate-400 hover:text-white shrink-0"
                    title="Dismiss alert"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="text-[11px] text-slate-500 mt-2">
            Auto-triggered on low relevance, high latency, hallucination spikes, or handover drops.
          </div>
        </div>
      </div>

      {/* Evaluation History Table Section */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl shadow-md overflow-hidden">
        {/* Table Filter Header */}
        <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-950/40">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-400" />
              Call Evaluation Records & Audits
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Filter Tabs */}
            <div className="flex bg-slate-900 p-0.5 rounded-xl border border-slate-800 text-xs">
              {[
                { id: 'all', label: 'All' },
                { id: 'hallucinations', label: 'Hallucinations' },
                { id: 'low_quality', label: 'Low Quality' },
                { id: 'failed', label: 'Failed' }
              ].map(f => (
                <button
                  key={f.id}
                  onClick={() => { setHistoryFilter(f.id); setHistoryPage(1); }}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                    historyFilter === f.id
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Search Input */}
            <form onSubmit={handleSearchSubmit} className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search call ID or customer..."
                value={historySearch}
                onChange={e => setHistorySearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-48 sm:w-56"
              />
            </form>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Call ID / Customer</th>
                <th className="py-3 px-3">Quality Score</th>
                <th className="py-3 px-3">Relevance</th>
                <th className="py-3 px-3">Hallucination</th>
                <th className="py-3 px-3">Avg Latency</th>
                <th className="py-3 px-3">CSAT</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {historyLoading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto text-indigo-400 mb-2" />
                    Loading evaluation history...
                  </td>
                </tr>
              ) : history.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    No evaluated call records found matching current criteria.
                  </td>
                </tr>
              ) : (
                history.map(item => (
                  <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-medium text-white">{item.callRecord.customerName}</div>
                      <div className="text-[11px] text-slate-500 font-mono">{item.callRecord.callId}</div>
                    </td>
                    <td className="py-3 px-3">
                      <span className={`px-2 py-0.5 rounded-full font-bold text-xs ${
                        item.overallQualityScore >= 80
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : item.overallQualityScore >= 65
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                            : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      }`}>
                        {item.overallQualityScore.toFixed(1)}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      {typeof item.relevanceAvg === 'number' ? `${(item.relevanceAvg * 100).toFixed(0)}%` : '—'}
                    </td>
                    <td className="py-3 px-3">
                      {typeof item.hallucinationRate === 'number' && item.hallucinationRate > 0 ? (
                        <span className="text-rose-400 font-semibold">{item.hallucinationRate.toFixed(1)}%</span>
                      ) : (
                        <span className="text-emerald-400">0.0%</span>
                      )}
                    </td>
                    <td className="py-3 px-3 font-mono">
                      {typeof item.latencyAvgMs === 'number' ? `${item.latencyAvgMs} ms` : '—'}
                    </td>
                    <td className="py-3 px-3">
                      {typeof item.csatScore === 'number' ? `${item.csatScore.toFixed(0)}%` : '—'}
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded text-[10px] uppercase font-semibold bg-slate-800 text-slate-300">
                        {item.evaluationStatus}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => openCallDetail(item.callRecordId)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-medium transition-all"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Breakdown
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="p-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 bg-slate-950/40">
          <div>Page {historyPage} of {historyTotalPages}</div>
          <div className="flex items-center gap-2">
            <button
              disabled={historyPage <= 1}
              onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
              className="p-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              disabled={historyPage >= historyTotalPages}
              onClick={() => setHistoryPage(p => p + 1)}
              className="p-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Detailed Call Evaluation Modal / Drawer */}
      {selectedCallId && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-indigo-400" />
                  Call Quality Deep-Dive & Observability Traces
                </h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  Call Record: {selectedCallId}
                </p>
              </div>
              <button
                onClick={() => { setSelectedCallId(null); setCallDetail(null); }}
                className="p-2 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Tabs */}
            <div className="px-5 border-b border-slate-800 flex gap-4 text-xs font-medium bg-slate-950/30">
              {[
                { id: 'turns', label: 'Turn Grounding & Hallucinations', icon: MessageSquare },
                { id: 'rag', label: 'RAG Evidence Chunks', icon: Layers },
                { id: 'latency', label: 'Distributed Tracing (OTel Spans)', icon: Zap },
                { id: 'feedback', label: 'Customer CSAT Feedback', icon: ThumbsUp }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveModalTab(tab.id as any)}
                  className={`py-3 flex items-center gap-2 border-b-2 transition-all ${
                    activeModalTab === tab.id
                      ? 'border-indigo-500 text-indigo-400 font-semibold'
                      : 'border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  <tab.icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Modal Content */}
            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              {detailLoading ? (
                <div className="text-center py-16 text-slate-500">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto text-indigo-400 mb-2" />
                  Loading turn-by-turn evaluation breakdown...
                </div>
              ) : !callDetail ? (
                <div className="text-center py-16 text-slate-500">
                  No evaluation details available for this call.
                </div>
              ) : (
                <>
                  {/* Tab 1: Turns & Grounding */}
                  {activeModalTab === 'turns' && (
                    <div className="space-y-4">
                      {callDetail.aiEvaluations.length === 0 ? (
                        <div className="text-center py-8 text-slate-500 text-xs">
                          No AI turn evaluations recorded for this conversation.
                        </div>
                      ) : (
                        callDetail.aiEvaluations.map((turn, idx) => (
                          <div key={turn.id || idx} className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-3">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-bold text-slate-300">Turn #{turn.turnIndex || idx + 1}</span>
                              <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[11px]">
                                  Relevance: {(turn.relevanceScore * 100).toFixed(0)}%
                                </span>
                                <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                                  turn.isHallucination
                                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                                    : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                }`}>
                                  {turn.isHallucination ? 'Hallucination Flagged' : 'Grounded in KB'}
                                </span>
                              </div>
                            </div>

                            {/* Customer Query */}
                            <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800/60 text-xs">
                              <span className="font-semibold text-indigo-400">Customer: </span>
                              <span className="text-slate-200">{turn.query}</span>
                            </div>

                            {/* AI Response */}
                            <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800/60 text-xs">
                              <span className="font-semibold text-emerald-400">AI Response: </span>
                              <span className="text-slate-200">{turn.response}</span>
                            </div>

                            {/* Claims Grounding Breakdown */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs pt-1">
                              {/* Supported Claims */}
                              <div className="p-2.5 rounded-lg bg-emerald-950/20 border border-emerald-800/30 text-emerald-300">
                                <span className="font-semibold block mb-1 text-[11px] flex items-center gap-1">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                  Supported Statements ({turn.supportedClaims?.length || 0}):
                                </span>
                                <ul className="list-disc list-inside space-y-0.5 text-[11px] text-slate-300">
                                  {turn.supportedClaims?.map((c, i) => (
                                    <li key={i}>{c}</li>
                                  )) || <li>None</li>}
                                </ul>
                              </div>

                              {/* Unsupported Claims */}
                              <div className={`p-2.5 rounded-lg border text-xs ${
                                (turn.unsupportedClaims?.length || 0) > 0
                                  ? 'bg-rose-950/20 border-rose-800/30 text-rose-300'
                                  : 'bg-slate-900/60 border-slate-800 text-slate-500'
                              }`}>
                                <span className="font-semibold block mb-1 text-[11px] flex items-center gap-1">
                                  <AlertCircle className="w-3 h-3 text-rose-400" />
                                  Unsupported Claims ({turn.unsupportedClaims?.length || 0}):
                                </span>
                                {turn.unsupportedClaims && turn.unsupportedClaims.length > 0 ? (
                                  <ul className="list-disc list-inside space-y-0.5 text-[11px] text-rose-200">
                                    {turn.unsupportedClaims.map((c, i) => (
                                      <li key={i}>{c}</li>
                                    ))}
                                  </ul>
                                ) : (
                                  <span className="text-[11px] text-slate-400">None detected. Response is fully verified.</span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {/* Tab 2: RAG Context & Evidence */}
                  {activeModalTab === 'rag' && (
                    <div className="space-y-4">
                      {callDetail.ragEvaluations.length === 0 ? (
                        <div className="text-center py-8 text-slate-500 text-xs">
                          No knowledge base retrieval chunks attached to this call.
                        </div>
                      ) : (
                        callDetail.ragEvaluations.map((rag, idx) => (
                          <div key={rag.id || idx} className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-white">Query #{rag.turnIndex || idx + 1}: {rag.query}</span>
                              <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[11px]">
                                  Precision: {(rag.contextPrecision * 100).toFixed(0)}%
                                </span>
                                <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 text-[11px]">
                                  Recall: {(rag.contextRecall * 100).toFixed(0)}%
                                </span>
                              </div>
                            </div>
                            <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 text-slate-300 font-mono text-[11px] max-h-36 overflow-y-auto">
                              {Array.isArray(rag.retrievedContext)
                                ? rag.retrievedContext.map((c, ci) => <div key={ci} className="mb-2 pb-2 border-b border-slate-800 last:border-none last:mb-0 last:pb-0">{c}</div>)
                                : rag.retrievedContext}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {/* Tab 3: Latency & OTel Spans */}
                  {activeModalTab === 'latency' && (
                    <div className="space-y-4">
                      {callDetail.latencyMetrics.length === 0 ? (
                        <div className="text-center py-8 text-slate-500 text-xs">
                          No latency telemetry spans recorded.
                        </div>
                      ) : (
                        callDetail.latencyMetrics.map((span, idx) => (
                          <div key={span.id || idx} className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3 text-xs">
                            <div className="flex items-center justify-between">
                              <div className="font-mono text-[11px] text-slate-400">
                                Trace ID: <span className="text-indigo-400">{span.traceId}</span> | Span: {span.spanId}
                              </div>
                              <div className="font-bold text-white text-sm">
                                Total: {span.totalMs.toFixed(0)} ms
                              </div>
                            </div>

                            {/* Horizontal Waterfall Timeline */}
                            <div className="space-y-1.5 pt-1">
                              {[
                                { name: 'STT (Transcription)', val: span.sttMs, color: 'bg-teal-500' },
                                { name: 'Intent Classification', val: span.intentMs, color: 'bg-blue-500' },
                                { name: 'RAG Retrieval', val: span.ragMs, color: 'bg-cyan-500' },
                                { name: 'LLM Generation', val: span.llmMs, color: 'bg-indigo-500' },
                                { name: 'TTS (Voice Synthesis)', val: span.ttsMs, color: 'bg-violet-500' }
                              ].map(stage => {
                                const pct = span.totalMs > 0 ? (stage.val / span.totalMs) * 100 : 0;
                                return (
                                  <div key={stage.name} className="flex items-center text-[11px]">
                                    <span className="w-36 text-slate-400 truncate">{stage.name}</span>
                                    <div className="flex-1 bg-slate-900 h-2 rounded-full overflow-hidden mx-2">
                                      <div className={`${stage.color} h-full rounded-full`} style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} />
                                    </div>
                                    <span className="w-14 text-right text-slate-300 font-mono">{stage.val.toFixed(0)} ms</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {/* Tab 4: Customer Feedback */}
                  {activeModalTab === 'feedback' && (
                    <div className="p-6 rounded-xl bg-slate-950/60 border border-slate-800 text-center space-y-3">
                      {callDetail.feedback ? (
                        <>
                          <div className="text-3xl font-extrabold text-amber-400 flex items-center justify-center gap-1">
                            {'★'.repeat(callDetail.feedback.rating)}
                            <span className="text-slate-600">{'★'.repeat(5 - callDetail.feedback.rating)}</span>
                          </div>
                          <div className="text-sm font-semibold text-white">
                            CSAT Score: {callDetail.feedback.csatScore}% ({callDetail.feedback.sentiment})
                          </div>
                          <p className="text-xs text-slate-300 italic max-w-md mx-auto">
                            "{callDetail.feedback.feedbackText || 'Customer provided rating without written feedback.'}"
                          </p>
                        </>
                      ) : (
                        <div className="text-xs text-slate-500 py-6">
                          Customer did not submit a post-call rating for this session.
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
