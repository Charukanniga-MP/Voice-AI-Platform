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
  customerDeleted?: boolean;
  customer?: { id: string; name: string; email: string } | null;
}
interface DeletionPreview {
  customer: { name: string; email: string };
  counts: Record<string, number>;
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
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletionPreviews, setDeletionPreviews] = useState<Record<string, DeletionPreview>>({});
  const [confirmationWords, setConfirmationWords] = useState<Record<string, string>>({});

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

  const generateExport = async (row: DataRequest) => {
    if (!token) return;
    setExportingId(row.id); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/data-requests/${row.id}/export`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Could not generate the customer export.');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `customer-data-${row.id}.json`;
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl; link.download = filename; link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setNotice('Customer export downloaded. The request and export action were audited.');
      await loadRequests();
    } catch (err: any) { setError(err.message || 'Could not generate the customer export.'); }
    finally { setExportingId(null); }
  };

  const previewDeletion = async (id: string) => {
    if (!token) return;
    setPreviewingId(id); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/data-requests/${id}/deletion-preview`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not prepare deletion preview.');
      setDeletionPreviews(current => ({ ...current, [id]: data }));
      setConfirmationWords(current => ({ ...current, [id]: '' }));
    } catch (err: any) { setError(err.message || 'Could not prepare deletion preview.'); }
    finally { setPreviewingId(null); }
  };

  const fulfillDeletion = async (id: string) => {
    if (!token || confirmationWords[id] !== 'DELETE') return;
    setDeletingId(id); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/data-requests/${id}/fulfill-deletion`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: confirmationWords[id] })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not delete customer data.');
      setDeletionPreviews(current => { const next = { ...current }; delete next[id]; return next; });
      setNotice('Customer account data deleted. The request and fulfillment audit remain available.');
      await loadRequests();
    } catch (err: any) { setError(err.message || 'Could not delete customer data.'); }
    finally { setDeletingId(null); }
  };

  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
    <div className="flex items-start gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-purple-700">
        <ShieldCheck className="h-5 w-5" />
      </div>
      <div>
        <h2 className="text-base font-bold text-slate-900">{admin ? 'Customer data requests' : 'Your data requests'}</h2>
        <p className="mt-1 text-xs text-slate-500">{admin
        ? 'Generate customer exports or preview and confirm deletion requests. Every action is audited.'
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
            <div className="text-xs text-slate-600">{row.customerDeleted ? 'Customer account deleted' : `${row.customer?.name || 'Customer'} · ${row.customer?.email || 'No account email'}`}</div>
            <div className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
              <select aria-label="Request status" value={drafts[row.id]?.status || row.status} disabled={row.status === 'completed'}
                onChange={e => setDrafts(current => ({ ...current, [row.id]: { ...current[row.id], status: e.target.value as RequestStatus } }))}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs">
                {Object.entries(statusLabels).filter(([value]) => value !== 'completed').map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                {row.status === 'completed' && <option value="completed">Completed</option>}
              </select>
              <input aria-label="Resolution note" maxLength={1000} placeholder="Action taken / resolution note"
                disabled={row.status === 'completed'} value={drafts[row.id]?.resolutionNote || ''}
                onChange={e => setDrafts(current => ({ ...current, [row.id]: { ...current[row.id], resolutionNote: e.target.value } }))}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs" />
              <button type="button" onClick={() => void saveRequest(row.id)} disabled={savingId === row.id || row.status === 'completed'}
                className="rounded-lg bg-purple-600 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50">
                {savingId === row.id ? 'Saving…' : 'Save update'}
              </button>
            </div>
            {row.requestType === 'export' && row.status !== 'rejected' && <button type="button" onClick={() => void generateExport(row)} disabled={exportingId === row.id || row.customerDeleted}
              className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50">
              <Download className="h-3.5 w-3.5" />{exportingId === row.id ? 'Preparing export…' : 'Generate & download export'}
            </button>}
            {row.requestType === 'deletion' && !['completed', 'rejected'].includes(row.status) && !row.customerDeleted && <div className="space-y-3">
              {!deletionPreviews[row.id] ? <button type="button" onClick={() => void previewDeletion(row.id)} disabled={previewingId === row.id}
                className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50">
                <Trash2 className="h-3.5 w-3.5" />{previewingId === row.id ? 'Preparing preview…' : 'Preview deletion'}
              </button> : <div className="space-y-3 rounded-xl border border-rose-200 bg-rose-50/70 p-4">
                <div>
                  <p className="text-sm font-bold text-rose-900">Review records before permanent deletion</p>
                  <p className="mt-1 text-xs text-rose-800">Account: {deletionPreviews[row.id].customer.name} · {deletionPreviews[row.id].customer.email}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {Object.entries(deletionPreviews[row.id].counts).map(([key, count]) => <div key={key} className="rounded-lg bg-white px-3 py-2">
                    <div className="text-lg font-bold text-slate-900">{count}</div>
                    <div className="text-[11px] capitalize text-slate-500">{key.replace(/([A-Z])/g, ' $1')}</div>
                  </div>)}
                </div>
                <p className="text-xs font-medium text-rose-900">This permanently removes the account, calls, transcripts, recordings, tickets, and linked customer data. The request audit remains.</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input aria-label="Type DELETE to confirm" value={confirmationWords[row.id] || ''}
                    onChange={e => setConfirmationWords(current => ({ ...current, [row.id]: e.target.value }))}
                    placeholder="Type DELETE to confirm" className="min-w-0 flex-1 rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs" />
                  <button type="button" onClick={() => void fulfillDeletion(row.id)} disabled={deletingId === row.id || confirmationWords[row.id] !== 'DELETE'}
                    className="rounded-lg bg-rose-700 px-3 py-2 text-xs font-bold text-white hover:bg-rose-800 disabled:opacity-50">
                    {deletingId === row.id ? 'Deleting…' : 'Confirm permanent deletion'}
                  </button>
                  <button type="button" onClick={() => setDeletionPreviews(current => { const next = { ...current }; delete next[row.id]; return next; })}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">Cancel</button>
                </div>
              </div>}
            </div>}
            {row.handledBy && <p className="text-[11px] text-slate-400">Last handled by {row.handledBy}{row.resolvedAt ? ` · ${new Date(row.resolvedAt).toLocaleString()}` : ''}</p>}
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer font-medium">Audit history ({auditHistory.filter(entry => entry.requestId === row.id).length})</summary>
              <div className="mt-2 space-y-2 border-l-2 border-slate-200 pl-3">
                {auditHistory.filter(entry => entry.requestId === row.id).map(entry => <div key={entry.id}>
                  <p className="font-medium text-slate-700">{entry.eventType === 'CUSTOMER_DATA_REQUEST_CREATED' ? 'Request submitted'
                    : entry.eventType === 'CUSTOMER_DATA_REQUEST_UPDATED' ? `Status: ${entry.details.previousStatus || '—'} → ${entry.details.status || 'updated'}`
                    : entry.eventType === 'CUSTOMER_DATA_EXPORT_GENERATED' ? 'Customer export generated'
                    : entry.eventType === 'CUSTOMER_DATA_DELETION_PREVIEWED' ? 'Deletion impact previewed'
                    : 'Customer data deletion fulfilled'}</p>
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
