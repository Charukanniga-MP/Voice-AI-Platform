import React, { useCallback, useEffect, useState } from 'react';
import { Download, ShieldCheck, Trash2, RefreshCw } from 'lucide-react';

type RequestStatus = 'pending' | 'in_progress' | 'completed' | 'rejected';
interface DataRequest {
  id: string;
  requestType: 'export' | 'deletion';
  status: RequestStatus;
  resolutionNote: string | null;
  handledBy?: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
  customer?: { id: string; name: string; email: string };
}
interface AuditEntry {
  id: string;
  requestId: string;
  eventType: string;
  email: string | null;
  createdAt: string;
  details: { status?: string; previousStatus?: string; requestType?: string; resolutionNote?: string | null };
}

interface Props { token: string | null; admin?: boolean }

const statusLabels: Record<RequestStatus, string> = {
  pending: 'Pending', in_progress: 'In progress', completed: 'Completed', rejected: 'Rejected'
};

export const DataRequestCenter: React.FC<Props> = ({ token, admin = false }) => {
  const [requests, setRequests] = useState<DataRequest[]>([]);
  const [auditHistory, setAuditHistory] = useState<AuditEntry[]>([]);
  const [requestType, setRequestType] = useState<'export' | 'deletion'>('export');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [drafts, setDrafts] = useState<Record<string, { status: RequestStatus; resolutionNote: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    try {
      const response = await fetch(admin ? '/api/data-requests' : '/api/data-requests/mine', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load data requests.');
      const rows: DataRequest[] = data.requests || [];
      setRequests(rows);
      setAuditHistory(data.auditHistory || []);
      setDrafts(Object.fromEntries(rows.map(row => [row.id, {
        status: row.status, resolutionNote: row.resolutionNote || ''
      }])));
      setError('');
    } catch (err: any) {
      setError(err.message || 'Could not load data requests.');
    } finally { setLoading(false); }
  }, [admin, token]);

  useEffect(() => { void loadRequests(); }, [loadRequests]);

  const submitRequest = async () => {
    if (!token) return;
    setSubmitting(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/data-requests', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestType })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not submit your request.');
      setNotice('Your request was submitted. An administrator will update its status here.');
      await loadRequests();
    } catch (err: any) { setError(err.message || 'Could not submit your request.'); }
    finally { setSubmitting(false); }
  };

  const saveRequest = async (id: string) => {
    if (!token) return;
    const draft = drafts[id];
    if (!draft) return;
    setSavingId(id); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/data-requests/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(draft)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not update the request.');
      setNotice('Request updated and audit entry recorded.');
      await loadRequests();
    } catch (err: any) { setError(err.message || 'Could not update the request.'); }
    finally { setSavingId(null); }
  };

  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
    <div className="flex items-start gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-purple-700">
        <ShieldCheck className="h-5 w-5" />
      </div>
      <div>
        <h2 className="text-base font-bold text-slate-900">{admin ? 'Customer data requests' : 'Your data requests'}</h2>
        <p className="mt-1 text-xs text-slate-500">{admin
          ? 'Review customer export and deletion requests. Record the action taken and its outcome.'
          : 'Request a copy of your account data or ask for your account data to be deleted. You can track progress here.'}</p>
      </div>
      <button type="button" onClick={() => void loadRequests()} disabled={loading} aria-label="Refresh requests"
        className="ml-auto rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
    </div>

    {!admin && <div className="flex flex-col gap-3 rounded-xl bg-slate-50 p-4 sm:flex-row sm:items-end">
      <label className="flex-1 space-y-1.5">
        <span className="text-xs font-semibold text-slate-700">Request type</span>
        <select value={requestType} onChange={e => setRequestType(e.target.value as 'export' | 'deletion')}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
          <option value="export">Export a copy of my data</option>
          <option value="deletion">Delete my account data</option>
        </select>
      </label>
      <button type="button" onClick={() => void submitRequest()} disabled={submitting}
        className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50">
        {submitting ? 'Submitting…' : 'Submit request'}
      </button>
    </div>}

    {!admin && <p className="text-[11px] text-slate-500">Deletion requests are reviewed by an administrator. Your data is not removed automatically when you submit this form.</p>}
    {notice && <p role="status" className="text-sm font-medium text-emerald-700">{notice}</p>}
    {error && <p role="alert" className="text-sm font-medium text-red-600">{error}</p>}
    {loading ? <p className="py-4 text-sm text-slate-500">Loading requests…</p> : requests.length === 0
      ? <p className="py-4 text-sm text-slate-500">No data requests yet.</p>
      : <div className="divide-y divide-slate-100">
        {requests.map(row => <article key={row.id} className="space-y-3 py-4 first:pt-1">
          <div className="flex flex-wrap items-center gap-2">
            {row.requestType === 'export' ? <Download className="h-4 w-4 text-blue-600" /> : <Trash2 className="h-4 w-4 text-rose-600" />}
            <span className="text-sm font-semibold capitalize text-slate-800">{row.requestType} request</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{statusLabels[row.status]}</span>
            <time className="ml-auto text-xs text-slate-400">Submitted {new Date(row.createdAt).toLocaleString()}</time>
          </div>
          {admin ? <>
            <div className="text-xs text-slate-600">{row.customer?.name} · {row.customer?.email}</div>
            <div className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
              <select aria-label="Request status" value={drafts[row.id]?.status || row.status}
                onChange={e => setDrafts(current => ({ ...current, [row.id]: { ...current[row.id], status: e.target.value as RequestStatus } }))}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs">
                {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <input aria-label="Resolution note" maxLength={1000} placeholder="Action taken / resolution note"
                value={drafts[row.id]?.resolutionNote || ''}
                onChange={e => setDrafts(current => ({ ...current, [row.id]: { ...current[row.id], resolutionNote: e.target.value } }))}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs" />
              <button type="button" onClick={() => void saveRequest(row.id)} disabled={savingId === row.id}
                className="rounded-lg bg-purple-600 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50">
                {savingId === row.id ? 'Saving…' : 'Save update'}
              </button>
            </div>
            {row.handledBy && <p className="text-[11px] text-slate-400">Last handled by {row.handledBy}{row.resolvedAt ? ` · ${new Date(row.resolvedAt).toLocaleString()}` : ''}</p>}
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer font-medium">Audit history ({auditHistory.filter(entry => entry.requestId === row.id).length})</summary>
              <div className="mt-2 space-y-2 border-l-2 border-slate-200 pl-3">
                {auditHistory.filter(entry => entry.requestId === row.id).map(entry => <div key={entry.id}>
                  <p className="font-medium text-slate-700">{entry.eventType.endsWith('CREATED') ? 'Request submitted' : `Status: ${entry.details.previousStatus || '—'} → ${entry.details.status || 'updated'}`}</p>
                  <p>{entry.email || 'Account'} · {new Date(entry.createdAt).toLocaleString()}</p>
                  {entry.details.resolutionNote && <p>Note: {entry.details.resolutionNote}</p>}
                </div>)}
              </div>
            </details>
          </> : row.resolutionNote && <p className="text-xs text-slate-600">Admin note: {row.resolutionNote}</p>}
        </article>)}
      </div>}
  </section>;
};
