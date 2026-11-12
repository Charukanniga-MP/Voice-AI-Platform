/**
 * KAIRA Voice AI Platform - Business Intelligence Reports & Analytics Dashboard
 * 100% database-driven KPIs, interactive SVG charts (line, donut, bar),
 * date range filtering, automated Daily/Monthly report generator, and PDF/CSV downloads.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  TrendingUp, BarChart3, PieChart, FileText, Download, Calendar,
  RefreshCw, CheckCircle2, AlertCircle, Clock, Users, PhoneCall,
  PhoneIncoming, PhoneForwarded, PhoneOff, ShieldAlert, Sparkles,
  Lightbulb, Search, Filter, Eye, ChevronRight, X, ArrowUpRight,
  ArrowDownRight, HelpCircle, Layers, FileSpreadsheet
} from 'lucide-react';
import { BiOverviewData, BusinessReportRecord } from '../types.js';

interface BiReportsSectionProps {
  token: string | null;
}

export const BiReportsSection: React.FC<BiReportsSectionProps> = ({ token }) => {
  // Navigation & View
  const [activeTab, setActiveTab] = useState<'analytics' | 'history'>('analytics');

  // Period Filters
  const [period, setPeriod] = useState<string>('30days');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');

  // Data State
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<BiOverviewData | null>(null);

  // Report History State
  const [reports, setReports] = useState<BusinessReportRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [historySearch, setHistorySearch] = useState<string>('');
  const [historyTypeFilter, setHistoryTypeFilter] = useState<string>('all');

  // Generation Modal State
  const [showGenerateModal, setShowGenerateModal] = useState<boolean>(false);
  const [genType, setGenType] = useState<'daily' | 'monthly' | 'custom'>('daily');
  const [genDate, setGenDate] = useState<string>(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
  const [genMonth, setGenMonth] = useState<number>(new Date().getMonth() === 0 ? 12 : new Date().getMonth());
  const [genYear, setGenYear] = useState<number>(new Date().getMonth() === 0 ? new Date().getFullYear() - 1 : new Date().getFullYear());
  const [genStart, setGenStart] = useState<string>('');
  const [genEnd, setGenEnd] = useState<string>('');
  const [genTitle, setGenTitle] = useState<string>('');
  const [generating, setGenerating] = useState<boolean>(false);
  const [genFeedback, setGenFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Report Details Modal
  const [selectedReport, setSelectedReport] = useState<any | null>(null);
  const [viewLoading, setViewLoading] = useState<boolean>(false);

  // Active chart tooltip states
  const [hoveredPoint, setHoveredPoint] = useState<{ label: string; totalCalls: number; completed: number; x: number; y: number } | null>(null);

  // Fetch Overview Data
  const fetchOverview = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      let url = `/api/admin/bi/overview?period=${period}`;
      if (period === 'custom' && customStart && customEnd) {
        url += `&startDate=${customStart}&endDate=${customEnd}`;
      }
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        throw new Error(`Failed to load BI overview (HTTP ${res.status})`);
      }
      const data = await res.json();
      if (data.success) {
        setOverview(data);
      } else {
        throw new Error(data.error || 'Failed to parse BI overview');
      }
    } catch (err: any) {
      setError(err.message || 'Error fetching Business Intelligence data');
    } finally {
      setLoading(false);
    }
  };

  // Fetch Report History
  const fetchReportHistory = async () => {
    if (!token) return;
    setHistoryLoading(true);
    try {
      let url = `/api/admin/bi/reports?reportType=${historyTypeFilter}`;
      if (historySearch.trim()) {
        url += `&search=${encodeURIComponent(historySearch.trim())}`;
      }
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setReports(data.reports || []);
      }
    } catch (err) {
      console.error('Error fetching report history:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, [period, customStart, customEnd, token]);

  useEffect(() => {
    if (activeTab === 'history') {
      fetchReportHistory();
    }
  }, [activeTab, historyTypeFilter, historySearch, token]);

  // Handle Manual Report Generation
  const handleGenerateReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setGenerating(true);
    setGenFeedback(null);
    try {
      const payload: any = { reportType: genType };
      if (genType === 'daily') {
        payload.targetDate = genDate;
      } else if (genType === 'monthly') {
        payload.month = genMonth;
        payload.year = genYear;
      } else {
        payload.startDate = genStart;
        payload.endDate = genEnd;
        payload.title = genTitle || undefined;
      }

      const res = await fetch('/api/admin/bi/reports/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Report generation failed');
      }

      setGenFeedback({
        type: 'success',
        message: data.message || 'Report generated successfully.'
      });
      fetchReportHistory();
      setTimeout(() => {
        setShowGenerateModal(false);
        setGenFeedback(null);
      }, 1500);
    } catch (err: any) {
      setGenFeedback({
        type: 'error',
        message: err.message || 'Failed to generate report.'
      });
    } finally {
      setGenerating(false);
    }
  };

  // View Report Details
  const handleViewReport = async (id: string) => {
    if (!token) return;
    setViewLoading(true);
    try {
      const res = await fetch(`/api/admin/bi/reports/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setSelectedReport(data.report);
      }
    } catch (err) {
      console.error('Failed to load report details:', err);
    } finally {
      setViewLoading(false);
    }
  };

  // Trigger File Download
  const handleDownload = (reportId: string, format: 'pdf' | 'csv') => {
    if (!token) return;
    const url = `/api/admin/bi/reports/${reportId}/${format}`;
    window.open(url, '_blank');
  };

  // Quick Action Buttons
  const handleQuickDailyGen = async () => {
    setGenType('daily');
    setGenDate(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
    setShowGenerateModal(true);
  };

  const handleQuickMonthlyGen = async () => {
    setGenType('monthly');
    const now = new Date();
    setGenMonth(now.getMonth() === 0 ? 12 : now.getMonth());
    setGenYear(now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear());
    setShowGenerateModal(true);
  };

  // Calculations for SVG Line Chart (Call Volume Trends)
  const lineChartData = useMemo(() => {
    if (!overview || !overview.dailyTrends || overview.dailyTrends.length === 0) return null;
    const data = overview.dailyTrends;
    const maxVal = Math.max(...data.map((d) => d.totalCalls), 5);
    const width = 600;
    const height = 180;
    const paddingX = 40;
    const paddingY = 25;

    const points = data.map((d, i) => {
      const x = paddingX + (i / Math.max(data.length - 1, 1)) * (width - paddingX * 2);
      const y = height - paddingY - (d.totalCalls / maxVal) * (height - paddingY * 2);
      const yCompleted = height - paddingY - (d.completed / maxVal) * (height - paddingY * 2);
      return { x, y, yCompleted, ...d };
    });

    const totalPath = points.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`, '');
    const completedPath = points.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x} ${p.yCompleted}`, '');
    const areaPath = `${totalPath} L ${points[points.length - 1].x} ${height - paddingY} L ${points[0].x} ${height - paddingY} Z`;

    return { points, totalPath, completedPath, areaPath, width, height, maxVal };
  }, [overview]);

  // Donut chart calculations for sentiment
  const sentimentDonut = useMemo(() => {
    if (!overview) return null;
    const s = overview.sentiment;
    const total = Math.max(s.totalAnalyzed, 1);
    const posPct = s.positiveCount / total;
    const neuPct = s.neutralCount / total;
    const negPct = s.negativeCount / total;
    const fruPct = s.frustratedCount / total;

    // Circumference for r=38 is 2 * PI * 38 ≈ 238.76
    const C = 238.76;
    const posDash = `${posPct * C} ${C}`;
    const neuDash = `${neuPct * C} ${C}`;
    const negDash = `${negPct * C} ${C}`;
    const fruDash = `${fruPct * C} ${C}`;

    const posOffset = 0;
    const neuOffset = -(posPct * C);
    const negOffset = -((posPct + neuPct) * C);
    const fruOffset = -((posPct + neuPct + negPct) * C);

    return { posDash, neuDash, negDash, fruDash, posOffset, neuOffset, negOffset, fruOffset, C };
  }, [overview]);

  // Donut chart calculations for call status
  const statusDonut = useMemo(() => {
    if (!overview) return null;
    const k = overview.kpis;
    const total = Math.max(k.totalCalls, 1);
    const compPct = k.completedCalls / total;
    const missPct = k.missedCalls / total;
    const tranPct = k.transferredCalls / total;
    const rejPct = k.rejectedCalls / total;

    const C = 238.76;
    const compDash = `${compPct * C} ${C}`;
    const missDash = `${missPct * C} ${C}`;
    const tranDash = `${tranPct * C} ${C}`;
    const rejDash = `${rejPct * C} ${C}`;

    const compOffset = 0;
    const missOffset = -(compPct * C);
    const tranOffset = -((compPct + missPct) * C);
    const rejOffset = -((compPct + missPct + tranPct) * C);

    return { compDash, missDash, tranDash, rejDash, compOffset, missOffset, tranOffset, rejOffset, C };
  }, [overview]);

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
              <BarChart3 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-slate-900 tracking-tight">Business Intelligence & Analytics</h1>
                <span className="bg-blue-100 text-blue-700 font-semibold px-2.5 py-0.5 rounded-full text-[10px] tracking-wide uppercase">
                  Enterprise
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Real database aggregation, customer issue classification, sentiment distribution, and automated exportable reports.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleQuickDailyGen}
              className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-xs active:scale-95"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Generate Daily</span>
            </button>
            <button
              onClick={handleQuickMonthlyGen}
              className="flex items-center gap-2 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-xs shadow-blue-500/20 active:scale-95"
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Generate Monthly</span>
            </button>
            <button
              onClick={() => { setGenType('custom'); setShowGenerateModal(true); }}
              className="flex items-center gap-2 px-3.5 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-xs"
            >
              <Layers className="w-3.5 h-3.5 text-slate-500" />
              <span>Custom Range</span>
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center justify-between border-t border-slate-100 mt-6 pt-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('analytics')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'analytics'
                  ? 'bg-blue-50 text-blue-700 border border-blue-200 shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <TrendingUp className="w-4 h-4" />
              <span>Interactive Analytics & Charts</span>
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'history'
                  ? 'bg-blue-50 text-blue-700 border border-blue-200 shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>Report History & Downloads ({reports.length})</span>
            </button>
          </div>

          {activeTab === 'analytics' && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-slate-400">Period:</span>
              <div className="flex items-center bg-slate-100 p-1 rounded-xl">
                {[
                  { id: 'today', label: 'Today' },
                  { id: 'yesterday', label: 'Yesterday' },
                  { id: '7days', label: '7D' },
                  { id: '30days', label: '30D' },
                  { id: 'this_month', label: 'This Month' },
                  { id: 'last_month', label: 'Last Month' }
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setPeriod(item.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      period === item.id ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <button
                onClick={fetchOverview}
                disabled={loading}
                title="Refresh Analytics"
                className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600 cursor-pointer transition-all"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-600' : ''}`} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {activeTab === 'analytics' ? (
        loading ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-16 flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
            <p className="text-sm font-semibold text-slate-600">Calculating Business Intelligence metrics from database...</p>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700">
            <AlertCircle className="w-8 h-8 mx-auto text-red-500 mb-2" />
            <p className="text-sm font-bold">Failed to load Business Intelligence data</p>
            <p className="text-xs text-red-600 mt-1">{error}</p>
            <button
              onClick={fetchOverview}
              className="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold cursor-pointer"
            >
              Retry Loading
            </button>
          </div>
        ) : !overview ? null : (
          <div className="space-y-6">
            {/* 1. KPI Cards Grid (12 Key Metrics) */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3.5">
              {/* Total Calls */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total Calls</span>
                  <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                    <PhoneCall className="w-3.5 h-3.5" />
                  </div>
                </div>
                <div className="mt-2.5">
                  <div className="text-2xl font-black text-slate-900 tracking-tight">{overview.kpis.totalCalls}</div>
                  {overview.comparisons && (
                    <div className="flex items-center gap-1 mt-1 text-[10px] font-bold">
                      {overview.comparisons.totalCalls.isPositiveChange ? (
                        <span className="text-emerald-600 flex items-center">
                          <ArrowUpRight className="w-3 h-3" />+{overview.comparisons.totalCalls.changePct}%
                        </span>
                      ) : (
                        <span className="text-red-600 flex items-center">
                          <ArrowDownRight className="w-3 h-3" />{overview.comparisons.totalCalls.changePct}%
                        </span>
                      )}
                      <span className="text-slate-400 font-normal">vs prev</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Completed Calls */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Completed</span>
                  <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </div>
                </div>
                <div className="mt-2.5">
                  <div className="text-2xl font-black text-emerald-700 tracking-tight">{overview.kpis.completedCalls}</div>
                  <div className="text-[10px] font-semibold text-slate-400 mt-1">
                    {Math.round((overview.kpis.completedCalls / Math.max(overview.kpis.totalCalls, 1)) * 100)}% completion rate
                  </div>
                </div>
              </div>

              {/* Missed Calls */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Missed</span>
                  <div className="w-7 h-7 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
                    <PhoneOff className="w-3.5 h-3.5" />
                  </div>
                </div>
                <div className="mt-2.5">
                  <div className="text-2xl font-black text-red-700 tracking-tight">{overview.kpis.missedCalls}</div>
                  <div className="text-[10px] font-semibold text-slate-400 mt-1">
                    {Math.round((overview.kpis.missedCalls / Math.max(overview.kpis.totalCalls, 1)) * 100)}% drop rate
                  </div>
                </div>
              </div>

              {/* Transferred Calls */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Transferred</span>
                  <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                    <PhoneForwarded className="w-3.5 h-3.5" />
                  </div>
                </div>
                <div className="mt-2.5">
                  <div className="text-2xl font-black text-amber-700 tracking-tight">{overview.kpis.transferredCalls}</div>
                  <div className="text-[10px] font-semibold text-slate-400 mt-1">Live human handoffs</div>
                </div>
              </div>

              {/* Average Duration */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Avg Duration</span>
                  <div className="w-7 h-7 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
                    <Clock className="w-3.5 h-3.5" />
                  </div>
                </div>
                <div className="mt-2.5">
                  <div className="text-2xl font-black text-slate-900 tracking-tight">{overview.kpis.averageDurationFormatted}</div>
                  <div className="text-[10px] font-semibold text-slate-400 mt-1">Across all calls</div>
                </div>
              </div>

              {/* Unique Customers */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Customers</span>
                  <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                    <Users className="w-3.5 h-3.5" />
                  </div>
                </div>
                <div className="mt-2.5">
                  <div className="text-2xl font-black text-slate-900 tracking-tight">{overview.kpis.uniqueCustomers}</div>
                  <div className="text-[10px] font-semibold text-slate-400 mt-1">Distinct callers</div>
                </div>
              </div>

              {/* Positive Sentiment % */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Positive %</span>
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                </div>
                <div className="mt-2.5">
                  <div className="text-2xl font-black text-emerald-600 tracking-tight">{overview.kpis.positiveSentimentPct}%</div>
                  <div className="text-[10px] font-semibold text-slate-400 mt-1">{overview.sentiment.positiveCount} calls</div>
                </div>
              </div>

              {/* Neutral Sentiment % */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Neutral %</span>
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                </div>
                <div className="mt-2.5">
                  <div className="text-2xl font-black text-blue-600 tracking-tight">{overview.kpis.neutralSentimentPct}%</div>
                  <div className="text-[10px] font-semibold text-slate-400 mt-1">{overview.sentiment.neutralCount} calls</div>
                </div>
              </div>

              {/* Negative Sentiment % */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Negative %</span>
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                </div>
                <div className="mt-2.5">
                  <div className="text-2xl font-black text-amber-600 tracking-tight">{overview.kpis.negativeSentimentPct}%</div>
                  <div className="text-[10px] font-semibold text-slate-400 mt-1">{overview.sentiment.negativeCount} calls</div>
                </div>
              </div>

              {/* Frustrated Sentiment % */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Frustrated %</span>
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                </div>
                <div className="mt-2.5">
                  <div className="text-2xl font-black text-red-600 tracking-tight">{overview.kpis.frustratedSentimentPct}%</div>
                  <div className="text-[10px] font-semibold text-slate-400 mt-1">{overview.sentiment.frustratedCount} calls</div>
                </div>
              </div>

              {/* Calls Requiring Assistance */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Assistance Flag</span>
                  <div className="w-7 h-7 rounded-lg bg-red-100 text-red-700 flex items-center justify-center font-bold text-xs">
                    !
                  </div>
                </div>
                <div className="mt-2.5">
                  <div className="text-2xl font-black text-red-700 tracking-tight">{overview.kpis.totalCallsRequiringAssistance}</div>
                  <div className="text-[10px] font-semibold text-red-600 mt-1">High friction calls</div>
                </div>
              </div>

              {/* Active Support Agents */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Support Agents</span>
                  <div className="w-7 h-7 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center">
                    <Users className="w-3.5 h-3.5" />
                  </div>
                </div>
                <div className="mt-2.5">
                  <div className="text-2xl font-black text-teal-700 tracking-tight">{overview.kpis.totalActiveAgents}</div>
                  <div className="text-[10px] font-semibold text-slate-400 mt-1">Online & Available</div>
                </div>
              </div>
            </div>

            {/* 2. Executive Summary & Observations Card */}
            <div className="bg-gradient-to-br from-slate-900 to-blue-950 rounded-2xl p-6 text-white shadow-md relative overflow-hidden">
              <div className="absolute right-0 top-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-300 flex items-center justify-center border border-blue-400/30">
                  <Lightbulb className="w-4 h-4" />
                </div>
                <h3 className="text-base font-bold tracking-tight">AI-Assisted Executive Summary & Insights</h3>
                <span className="text-[10px] font-semibold bg-white/10 px-2 py-0.5 rounded-full text-blue-200">
                  {overview.period.startDate} to {overview.period.endDate}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 text-xs leading-relaxed text-slate-300">
                {overview.executiveSummary.map((bullet, idx) => (
                  <div key={idx} className="flex items-start gap-2.5 bg-white/5 p-3 rounded-xl border border-white/10">
                    <span className="w-2 h-2 rounded-full bg-blue-400 mt-1 shrink-0" />
                    <span>{bullet}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 3. Charts Row 1: Volume Trend & Donut Distributions */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Call Volume Trend Line Chart */}
              <div className="lg:col-span-2 bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">Call Volume & Completion Trend</h4>
                      <p className="text-[11px] text-slate-500">Daily trajectory of total vs successfully completed calls</p>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] font-semibold">
                      <span className="flex items-center gap-1.5 text-blue-600">
                        <span className="w-2.5 h-2.5 rounded-full bg-blue-600" /> Total Calls
                      </span>
                      <span className="flex items-center gap-1.5 text-emerald-600">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" /> Completed
                      </span>
                    </div>
                  </div>

                  {lineChartData && lineChartData.points.length > 0 ? (
                    <div className="relative mt-4">
                      <svg
                        viewBox={`0 0 ${lineChartData.width} ${lineChartData.height}`}
                        className="w-full h-44 overflow-visible"
                      >
                        <defs>
                          <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.25" />
                            <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.0" />
                          </linearGradient>
                        </defs>
                        {/* Horizontal Grid Lines */}
                        {[0, 0.25, 0.5, 0.75, 1].map((pct, idx) => {
                          const y = lineChartData.height - 25 - pct * (lineChartData.height - 50);
                          return (
                            <g key={idx}>
                              <line
                                x1="40"
                                y1={y}
                                x2={lineChartData.width - 40}
                                y2={y}
                                stroke="#F1F5F9"
                                strokeWidth="1"
                              />
                              <text x="32" y={y + 3} textAnchor="end" className="text-[9px] fill-slate-400 font-mono">
                                {Math.round(pct * lineChartData.maxVal)}
                              </text>
                            </g>
                          );
                        })}

                        {/* Area Fill */}
                        <path d={lineChartData.areaPath} fill="url(#areaGradient)" />

                        {/* Total Calls Line */}
                        <path
                          d={lineChartData.totalPath}
                          fill="none"
                          stroke="#2563EB"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />

                        {/* Completed Calls Line */}
                        <path
                          d={lineChartData.completedPath}
                          fill="none"
                          stroke="#10B981"
                          strokeWidth="2"
                          strokeDasharray="4 3"
                          strokeLinecap="round"
                        />

                        {/* Interactive Points */}
                        {lineChartData.points.map((p, idx) => (
                          <g key={idx}>
                            <circle
                              cx={p.x}
                              cy={p.y}
                              r={hoveredPoint?.label === p.label ? '5' : '3'}
                              className="fill-white stroke-blue-600 stroke-2 cursor-pointer transition-all hover:scale-150"
                              onMouseEnter={() => setHoveredPoint(p)}
                              onMouseLeave={() => setHoveredPoint(null)}
                            />
                            {/* X-axis labels */}
                            {(idx === 0 || idx === Math.floor(lineChartData.points.length / 2) || idx === lineChartData.points.length - 1) && (
                              <text
                                x={p.x}
                                y={lineChartData.height - 6}
                                textAnchor="middle"
                                className="text-[10px] fill-slate-400 font-medium"
                              >
                                {p.label}
                              </text>
                            )}
                          </g>
                        ))}
                      </svg>

                      {/* Hover Tooltip */}
                      {hoveredPoint && (
                        <div
                          className="absolute bg-slate-900 text-white text-[11px] p-2 rounded-xl shadow-lg pointer-events-none transform -translate-x-1/2 -translate-y-full"
                          style={{ left: `${(hoveredPoint.x / lineChartData.width) * 100}%`, top: `${(hoveredPoint.y / lineChartData.height) * 100}%` }}
                        >
                          <div className="font-bold">{hoveredPoint.label}</div>
                          <div>Total: {hoveredPoint.totalCalls} calls</div>
                          <div className="text-emerald-400">Completed: {hoveredPoint.completed}</div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="h-44 flex items-center justify-center text-xs text-slate-400">
                      No call trend records logged in this reporting window.
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                  <span>Peak Call Hours: <strong className="text-slate-900">{overview.peakCallHours}</strong></span>
                  <span>Days Covered: <strong className="text-slate-900">{overview.period.daysCovered} days</strong></span>
                </div>
              </div>

              {/* Customer Sentiment Donut Chart */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Sentiment Distribution</h4>
                  <p className="text-[11px] text-slate-500 mb-4">Real-time classification of customer emotion</p>

                  {sentimentDonut && overview.kpis.totalCalls > 0 ? (
                    <div className="flex flex-col items-center">
                      <div className="relative w-36 h-36">
                        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                          {/* Background Track */}
                          <circle cx="50" cy="50" r="38" fill="transparent" stroke="#F1F5F9" strokeWidth="11" />
                          {/* Positive */}
                          <circle
                            cx="50"
                            cy="50"
                            r="38"
                            fill="transparent"
                            stroke="#10B981"
                            strokeWidth="11"
                            strokeDasharray={sentimentDonut.posDash}
                            strokeDashoffset={sentimentDonut.posOffset}
                          />
                          {/* Neutral */}
                          <circle
                            cx="50"
                            cy="50"
                            r="38"
                            fill="transparent"
                            stroke="#3B82F6"
                            strokeWidth="11"
                            strokeDasharray={sentimentDonut.neuDash}
                            strokeDashoffset={sentimentDonut.neuOffset}
                          />
                          {/* Negative */}
                          <circle
                            cx="50"
                            cy="50"
                            r="38"
                            fill="transparent"
                            stroke="#F59E0B"
                            strokeWidth="11"
                            strokeDasharray={sentimentDonut.negDash}
                            strokeDashoffset={sentimentDonut.negOffset}
                          />
                          {/* Frustrated */}
                          <circle
                            cx="50"
                            cy="50"
                            r="38"
                            fill="transparent"
                            stroke="#EF4444"
                            strokeWidth="11"
                            strokeDasharray={sentimentDonut.fruDash}
                            strokeDashoffset={sentimentDonut.fruOffset}
                          />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-xl font-black text-slate-900">{overview.kpis.positiveSentimentPct}%</span>
                          <span className="text-[9px] uppercase tracking-wider font-bold text-emerald-600">Satisfaction</span>
                        </div>
                      </div>

                      {/* Legend */}
                      <div className="grid grid-cols-2 gap-2 w-full mt-4 text-[11px]">
                        <div className="flex items-center justify-between p-1.5 rounded-lg bg-emerald-50 text-emerald-800">
                          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Positive</span>
                          <strong className="font-mono">{overview.sentiment.positiveCount}</strong>
                        </div>
                        <div className="flex items-center justify-between p-1.5 rounded-lg bg-blue-50 text-blue-800">
                          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-500" /> Neutral</span>
                          <strong className="font-mono">{overview.sentiment.neutralCount}</strong>
                        </div>
                        <div className="flex items-center justify-between p-1.5 rounded-lg bg-amber-50 text-amber-800">
                          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" /> Negative</span>
                          <strong className="font-mono">{overview.sentiment.negativeCount}</strong>
                        </div>
                        <div className="flex items-center justify-between p-1.5 rounded-lg bg-red-50 text-red-800">
                          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500" /> Frustrated</span>
                          <strong className="font-mono">{overview.sentiment.frustratedCount}</strong>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="h-44 flex items-center justify-center text-xs text-slate-400">
                      No customer sentiment records recorded in this period.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 4. Charts Row 2: Customer Issues & Agent Performance */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Most Common Customer Issues Bar Chart */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">Frequently Reported Customer Issues</h4>
                    <p className="text-[11px] text-slate-500">Derived from call transcripts, queries, and resolution data</p>
                  </div>
                  <span className="text-[10px] bg-slate-100 text-slate-600 font-bold px-2 py-0.5 rounded-full">
                    {overview.issues.reduce((acc, i) => acc + i.count, 0)} Total Classified
                  </span>
                </div>

                <div className="space-y-3.5">
                  {overview.issues.map((issue, idx) => (
                    <div key={idx} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-700">{issue.category}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900">{issue.count} calls</span>
                          <span className="text-[11px] text-slate-400 font-mono">({issue.percentage}%)</span>
                        </div>
                      </div>
                      <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.max(issue.percentage, 2)}%`,
                            backgroundColor:
                              idx === 0
                                ? '#2563EB'
                                : idx === 1
                                ? '#4F46E5'
                                : idx === 2
                                ? '#0284C7'
                                : idx === 3
                                ? '#0D9488'
                                : '#64748B'
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Support Agent Performance */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">Support Specialist Performance</h4>
                    <p className="text-[11px] text-slate-500">Transparent call metrics and average handling duration</p>
                  </div>
                  <span className="text-[10px] bg-teal-50 text-teal-700 font-bold px-2 py-0.5 rounded-full">
                    {overview.agentPerformance.length} Specialists
                  </span>
                </div>

                {overview.agentPerformance.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                          <th className="pb-2.5">Agent</th>
                          <th className="pb-2.5 text-center">Handled</th>
                          <th className="pb-2.5 text-center">Completed</th>
                          <th className="pb-2.5 text-center">Avg Time</th>
                          <th className="pb-2.5 text-right">Sentiment</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {overview.agentPerformance.map((agent, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/60 transition-colors">
                            <td className="py-2.5">
                              <div className="font-bold text-slate-800">{agent.name}</div>
                              <div className="text-[10px] text-slate-400 font-mono">{agent.email}</div>
                            </td>
                            <td className="py-2.5 text-center font-bold text-slate-900">{agent.callsHandled}</td>
                            <td className="py-2.5 text-center text-emerald-600 font-semibold">{agent.completed}</td>
                            <td className="py-2.5 text-center font-mono text-slate-600">{agent.avgDurationFormatted}</td>
                            <td className="py-2.5 text-right">
                              <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded mr-1">
                                {agent.sentimentDistribution.positive}P
                              </span>
                              <span className="text-[10px] font-semibold bg-red-50 text-red-700 px-1.5 py-0.5 rounded">
                                {agent.sentimentDistribution.frustrated}F
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="h-44 flex items-center justify-center text-xs text-slate-400">
                    No specialist handling activity recorded during this period.
                  </div>
                )}
              </div>
            </div>

            {/* 5. Hourly Call Activity Bar Distribution */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">24-Hour Call Volume Profile</h4>
                  <p className="text-[11px] text-slate-500">Hourly density highlighting operational peak traffic windows</p>
                </div>
                <div className="text-xs font-bold text-blue-700 bg-blue-50 px-3 py-1 rounded-xl">
                  Peak: {overview.peakCallHours}
                </div>
              </div>

              <div className="grid grid-cols-24 gap-1 h-24 items-end mt-4 pt-4 border-t border-slate-100">
                {overview.hourlyVolume.map((h, idx) => {
                  const maxH = Math.max(...overview.hourlyVolume.map((item) => item.total), 1);
                  const hPct = (h.total / maxH) * 100;
                  const isPeak = h.label === overview.peakCallHours.split(' - ')[0];

                  return (
                    <div key={idx} className="flex flex-col items-center h-full justify-end group relative cursor-pointer">
                      <div
                        className={`w-full rounded-t transition-all ${
                          isPeak
                            ? 'bg-gradient-to-t from-blue-700 to-indigo-600'
                            : h.total > 0
                            ? 'bg-blue-400 hover:bg-blue-500'
                            : 'bg-slate-100'
                        }`}
                        style={{ height: `${Math.max(hPct, 4)}%` }}
                      />
                      <span className="text-[8px] text-slate-400 font-mono mt-1 opacity-70 group-hover:opacity-100">
                        {idx % 4 === 0 ? h.hour : ''}
                      </span>
                      {/* Tooltip */}
                      <div className="absolute -top-8 bg-slate-900 text-white text-[9px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-all z-10 whitespace-nowrap">
                        {h.label}: {h.total} calls
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )
      ) : (
        /* Report History View */
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">Archived Business Reports</h3>
              <p className="text-xs text-slate-500">Stored official daily, monthly, and custom business intelligence reports</p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search report title..."
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <select
                value={historyTypeFilter}
                onChange={(e) => setHistoryTypeFilter(e.target.value)}
                className="py-1.5 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 cursor-pointer focus:outline-hidden"
              >
                <option value="all">All Types</option>
                <option value="daily">Daily Reports</option>
                <option value="monthly">Monthly Reports</option>
                <option value="custom">Custom Reports</option>
              </select>

              <button
                onClick={fetchReportHistory}
                disabled={historyLoading}
                className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${historyLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {historyLoading ? (
            <div className="py-16 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
              <span className="text-xs">Loading report archives...</span>
            </div>
          ) : reports.length === 0 ? (
            <div className="py-16 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
              <FileText className="w-10 h-10 text-slate-300" />
              <span className="text-xs font-semibold">No business reports found matching this criteria.</span>
              <button
                onClick={handleQuickDailyGen}
                className="mt-2 text-xs text-blue-600 font-bold hover:underline cursor-pointer"
              >
                Generate Daily Report Now
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                    <th className="pb-3">Report Title</th>
                    <th className="pb-3">Type</th>
                    <th className="pb-3">Reporting Period</th>
                    <th className="pb-3">Generated At</th>
                    <th className="pb-3">Author</th>
                    <th className="pb-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reports.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5">
                        <div className="font-bold text-slate-800">{r.title}</div>
                        <div className="text-[10px] text-slate-400 font-mono">ID: {r.id}</div>
                      </td>
                      <td className="py-3.5">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                            r.reportType === 'daily'
                              ? 'bg-blue-100 text-blue-700'
                              : r.reportType === 'monthly'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {r.reportType}
                        </span>
                      </td>
                      <td className="py-3.5 font-mono text-slate-600">
                        {r.startDate} to {r.endDate}
                      </td>
                      <td className="py-3.5 text-slate-500">
                        {new Date(r.generatedAt).toLocaleString()}
                      </td>
                      <td className="py-3.5">
                        <span className="text-[11px] font-semibold text-slate-700">{r.generatedBy}</span>
                      </td>
                      <td className="py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleViewReport(r.id)}
                            className="p-1.5 hover:bg-slate-100 text-slate-600 rounded-lg cursor-pointer transition-colors"
                            title="Inspect Report Data"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {r.hasPdf && (
                            <button
                              onClick={() => handleDownload(r.id, 'pdf')}
                              className="flex items-center gap-1 px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg text-[11px] font-bold cursor-pointer transition-colors"
                              title="Download PDF"
                            >
                              <FileText className="w-3.5 h-3.5" />
                              <span>PDF</span>
                            </button>
                          )}
                          {r.hasCsv && (
                            <button
                              onClick={() => handleDownload(r.id, 'csv')}
                              className="flex items-center gap-1 px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-[11px] font-bold cursor-pointer transition-colors"
                              title="Download Excel CSV"
                            >
                              <FileSpreadsheet className="w-3.5 h-3.5" />
                              <span>CSV</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Manual Report Generation Modal */}
      {showGenerateModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-slate-900">Generate Business Report</h3>
              </div>
              <button
                onClick={() => setShowGenerateModal(false)}
                className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleGenerateReport} className="space-y-4 mt-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Report Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'daily', label: 'Daily' },
                    { id: 'monthly', label: 'Monthly' },
                    { id: 'custom', label: 'Custom' }
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setGenType(t.id as any)}
                      className={`py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                        genType === t.id
                          ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {genType === 'daily' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Target Date</label>
                  <input
                    type="date"
                    required
                    value={genDate}
                    onChange={(e) => setGenDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">Aggregates calls occurring from 00:00 to 23:59 on this date.</p>
                </div>
              )}

              {genType === 'monthly' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Month</label>
                    <select
                      value={genMonth}
                      onChange={(e) => setGenMonth(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs"
                    >
                      {Array.from({ length: 12 }, (_, i) => (
                        <option key={i + 1} value={i + 1}>
                          {new Date(2026, i, 1).toLocaleString('en-US', { month: 'long' })}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Year</label>
                    <input
                      type="number"
                      value={genYear}
                      onChange={(e) => setGenYear(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs"
                    />
                  </div>
                </div>
              )}

              {genType === 'custom' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Start Date</label>
                      <input
                        type="date"
                        required
                        value={genStart}
                        onChange={(e) => setGenStart(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">End Date</label>
                      <input
                        type="date"
                        required
                        value={genEnd}
                        onChange={(e) => setGenEnd(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Custom Title (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. Q4 Executive Voice Review"
                      value={genTitle}
                      onChange={(e) => setGenTitle(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs"
                    />
                  </div>
                </div>
              )}

              {genFeedback && (
                <div
                  className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2 ${
                    genFeedback.type === 'success'
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-red-50 text-red-800 border border-red-200'
                  }`}
                >
                  {genFeedback.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                  )}
                  <span>{genFeedback.message}</span>
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowGenerateModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={generating}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50 flex items-center gap-2"
                >
                  {generating ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Generating...</span>
                    </>
                  ) : (
                    <span>Generate & Save</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Report Details Viewer Modal */}
      {selectedReport && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[85vh] overflow-y-auto p-6 shadow-2xl border border-slate-200 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-slate-900 text-base">{selectedReport.title}</h3>
                <p className="text-xs text-slate-500">
                  Period: {selectedReport.startDate} to {selectedReport.endDate} | Author: {selectedReport.generatedBy}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDownload(selectedReport.id, 'pdf')}
                  className="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Download PDF</span>
                </button>
                <button
                  onClick={() => handleDownload(selectedReport.id, 'csv')}
                  className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Download CSV</span>
                </button>
                <button
                  onClick={() => setSelectedReport(null)}
                  className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Executive Summary */}
            {selectedReport.executiveSummary && (
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs text-slate-700 leading-relaxed space-y-2">
                <div className="font-bold text-slate-900 flex items-center gap-1.5">
                  <Lightbulb className="w-4 h-4 text-amber-500" />
                  <span>Executive Summary</span>
                </div>
                <div className="whitespace-pre-line text-slate-600">{selectedReport.executiveSummary}</div>
              </div>
            )}

            {/* Snapshot KPI Grid */}
            {selectedReport.data?.kpis && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-slate-50 rounded-xl text-center">
                  <div className="text-lg font-black text-slate-900">{selectedReport.data.kpis.totalCalls}</div>
                  <div className="text-[10px] text-slate-500 font-semibold">Total Calls</div>
                </div>
                <div className="p-3 bg-emerald-50 rounded-xl text-center">
                  <div className="text-lg font-black text-emerald-700">{selectedReport.data.kpis.completedCalls}</div>
                  <div className="text-[10px] text-emerald-600 font-semibold">Completed</div>
                </div>
                <div className="p-3 bg-amber-50 rounded-xl text-center">
                  <div className="text-lg font-black text-amber-700">{selectedReport.data.kpis.transferredCalls}</div>
                  <div className="text-[10px] text-amber-600 font-semibold">Transferred</div>
                </div>
                <div className="p-3 bg-purple-50 rounded-xl text-center">
                  <div className="text-lg font-black text-purple-700">{selectedReport.data.kpis.averageDurationFormatted}</div>
                  <div className="text-[10px] text-purple-600 font-semibold">Avg Duration</div>
                </div>
              </div>
            )}

            {/* Issue Breakdown */}
            {selectedReport.data?.issues && (
              <div>
                <h4 className="text-xs font-bold text-slate-900 mb-2">Classified Customer Inquiries</h4>
                <div className="space-y-1.5">
                  {selectedReport.data.issues.map((iss: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 text-xs">
                      <span className="font-medium text-slate-700">{iss.category}</span>
                      <span className="font-mono font-bold text-slate-900">{iss.count} calls ({iss.percentage}%)</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
