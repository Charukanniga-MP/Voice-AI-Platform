import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';

interface Ticket {
  id: string;
  customerName: string;
  customerEmail?: string | null;
  subject: string;
  description: string;
  priority: string;
  status: string;
  assignedTo?: string | null;
  followUpAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

const statusLabels: Record<string, string> = {
  open: 'Open', in_progress: 'In progress', waiting: 'Waiting', resolved: 'Resolved', closed: 'Closed'
};

export const SupportTickets: React.FC = () => {
  const { token } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('normal');
  const [assignedTo, setAssignedTo] = useState('');
  const [followUpAt, setFollowUpAt] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchTickets = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const response = await fetch('/api/tickets', { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to load tickets.');
      setTickets(data.tickets || []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load tickets.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void fetchTickets(); }, [fetchTickets]);

  const updateTicket = async (id: string, updates: Partial<Pick<Ticket, 'status' | 'priority' | 'assignedTo'>>) => {
    try {
      const response = await fetch(`/api/tickets/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to update ticket.');
      setTickets(current => current.map(ticket => ticket.id === id ? data.ticket : ticket));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update ticket.');
    }
  };

  const createTicket = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/tickets', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerName, customerEmail, subject, description, priority, assignedTo, followUpAt: followUpAt || null })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to create ticket.');
      setTickets(current => [data.ticket, ...current]);
      setCustomerName(''); setCustomerEmail(''); setSubject(''); setDescription('');
      setPriority('normal'); setAssignedTo(''); setFollowUpAt(''); setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create ticket.');
    } finally {
      setSaving(false);
    }
  };

  const overdueCount = tickets.filter(ticket => ticket.followUpAt && new Date(ticket.followUpAt) < new Date() && !['resolved', 'closed'].includes(ticket.status)).length;

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Support Tickets</h1>
          <p className="mt-1 text-xs text-slate-500">Track customer issues, ownership, priority, and follow-up.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void fetchTickets()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button onClick={() => setShowForm(value => !value)} className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-purple-700">
            <Plus className="h-4 w-4" /> New Ticket
          </button>
        </div>
      </header>

      {error && <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle className="h-4 w-4" />{error}</div>}
      {overdueCount > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-800">{overdueCount} ticket{overdueCount === 1 ? '' : 's'} need{overdueCount === 1 ? 's' : ''} an overdue follow-up.</div>}

      {showForm && <form onSubmit={createTicket} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2">
        <h2 className="font-bold text-slate-900 sm:col-span-2">Create a support ticket</h2>
        <input required value={customerName} onChange={event => setCustomerName(event.target.value)} placeholder="Customer name" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        <input type="email" value={customerEmail} onChange={event => setCustomerEmail(event.target.value)} placeholder="Customer email (optional)" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        <input required value={subject} onChange={event => setSubject(event.target.value)} placeholder="Issue subject" className="rounded-lg border border-slate-200 px-3 py-2 text-sm sm:col-span-2" />
        <textarea required value={description} onChange={event => setDescription(event.target.value)} placeholder="Describe the customer's issue" rows={3} className="rounded-lg border border-slate-200 px-3 py-2 text-sm sm:col-span-2" />
        <label className="space-y-1 text-xs font-medium text-slate-600">Priority<select value={priority} onChange={event => setPriority(event.target.value)} className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
        <label className="space-y-1 text-xs font-medium text-slate-600">Assign to<input value={assignedTo} onChange={event => setAssignedTo(event.target.value)} placeholder="Agent name" className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
        <label className="space-y-1 text-xs font-medium text-slate-600">Follow-up date<input type="date" value={followUpAt} onChange={event => setFollowUpAt(event.target.value)} className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
        <div className="flex items-end justify-end gap-2"><button type="button" onClick={() => setShowForm(false)} className="rounded-lg px-3 py-2 text-sm text-slate-600">Cancel</button><button disabled={saving} className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Create ticket'}</button></div>
      </form>}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? <p className="p-8 text-center text-sm text-slate-500">Loading tickets…</p> : tickets.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">No support tickets yet. Create one to track a customer issue.</p> :
          <table className="w-full min-w-[900px] text-left text-xs text-slate-600">
            <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-700"><tr><th className="px-4 py-3">Customer / Issue</th><th className="px-4 py-3">Priority</th><th className="px-4 py-3">Assigned to</th><th className="px-4 py-3">Follow-up</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Updated</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{tickets.map(ticket => {
              const overdue = ticket.followUpAt && new Date(ticket.followUpAt) < new Date() && !['resolved', 'closed'].includes(ticket.status);
              return <tr key={ticket.id} className="align-top hover:bg-slate-50/60"><td className="max-w-sm px-4 py-3"><p className="font-bold text-slate-900">{ticket.subject}</p><p className="mt-1 text-slate-700">{ticket.customerName}{ticket.customerEmail ? ` · ${ticket.customerEmail}` : ''}</p><p className="mt-1 line-clamp-2 text-slate-500">{ticket.description}</p></td>
                <td className="px-4 py-3"><select aria-label={`Priority for ${ticket.subject}`} value={ticket.priority} onChange={event => void updateTicket(ticket.id, { priority: event.target.value })} className="rounded-md border border-slate-200 bg-white px-2 py-1"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></td>
                <td className="px-4 py-3"><input aria-label={`Assignee for ${ticket.subject}`} defaultValue={ticket.assignedTo || ''} onBlur={event => { if (event.target.value !== (ticket.assignedTo || '')) void updateTicket(ticket.id, { assignedTo: event.target.value }); }} placeholder="Unassigned" className="w-28 rounded-md border border-slate-200 px-2 py-1" /></td>
                <td className={`px-4 py-3 ${overdue ? 'font-bold text-red-600' : ''}`}>{ticket.followUpAt ? new Date(ticket.followUpAt).toLocaleDateString() : '—'}{overdue ? ' · Overdue' : ''}</td>
                <td className="px-4 py-3"><select aria-label={`Status for ${ticket.subject}`} value={ticket.status} onChange={event => void updateTicket(ticket.id, { status: event.target.value })} className="rounded-md border border-slate-200 bg-white px-2 py-1">{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
                <td className="whitespace-nowrap px-4 py-3">{new Date(ticket.updatedAt).toLocaleDateString()}</td></tr>;
            })}</tbody>
          </table>}
      </div>
    </section>
  );
};
