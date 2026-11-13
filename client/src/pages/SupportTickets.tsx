import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Plus, RefreshCw, Trash2, CheckCircle2, Clock, Filter, User as UserIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { useLanguage } from '../context/LanguageContext.js';
import { getSocket } from '../services/socket.js';

interface Ticket {
  id: string;
  customerId?: string | null;
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
  messages: TicketMessage[];
}

interface TicketMessage {
  id: string;
  senderName: string;
  senderRole: string;
  message: string;
  createdAt: string;
}

const priorityColors: Record<string, string> = {
  low: 'bg-slate-100 text-slate-700 border-slate-200',
  normal: 'bg-blue-50 text-blue-700 border-blue-200',
  high: 'bg-amber-50 text-amber-700 border-amber-200',
  urgent: 'bg-red-50 text-red-700 border-red-200'
};

const statusColors: Record<string, string> = {
  open: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  in_progress: 'bg-blue-50 text-blue-700 border-blue-200',
  waiting: 'bg-amber-50 text-amber-700 border-amber-200',
  resolved: 'bg-purple-50 text-purple-700 border-purple-200',
  closed: 'bg-slate-100 text-slate-600 border-slate-200'
};

export const SupportTickets: React.FC<{ isCustomerView?: boolean; isAgentView?: boolean }> = ({ isCustomerView = false, isAgentView = false }) => {
  const { user, token } = useAuth();
  const { t } = useLanguage();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showForm, setShowForm] = useState(false);
  const [customerName, setCustomerName] = useState(user?.name || '');
  const [customerEmail, setCustomerEmail] = useState(user?.email || '');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('normal');
  const [assignedTo, setAssignedTo] = useState('');
  const [followUpAt, setFollowUpAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openConversationId, setOpenConversationId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  const isCustomer = isCustomerView || user?.role === 'customer';
  const canAssignTickets = !isCustomer && !isAgentView;

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'open': return t('tickets.filter_open');
      case 'in_progress': return t('tickets.filter_in_progress');
      case 'waiting': return t('tickets.filter_waiting');
      case 'resolved': return t('tickets.filter_resolved');
      case 'closed': return t('tickets.filter_closed');
      default: return status;
    }
  };

  const getPriorityLabel = (priorityVal: string) => {
    switch (priorityVal) {
      case 'low': return t('tickets.priority_low');
      case 'normal': return t('tickets.priority_normal');
      case 'high': return t('tickets.priority_high');
      case 'urgent': return t('tickets.priority_urgent');
      default: return priorityVal;
    }
  };

  const statusOptions = [
    { value: 'open', label: t('tickets.filter_open') },
    { value: 'in_progress', label: t('tickets.filter_in_progress') },
    { value: 'waiting', label: t('tickets.filter_waiting') },
    { value: 'resolved', label: t('tickets.filter_resolved') },
    { value: 'closed', label: t('tickets.filter_closed') }
  ];

  const parseJsonResponse = async (response: Response) => {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      if (!response.ok) {
        throw new Error(`Server returned ${response.status} (${response.statusText || 'Backend server unavailable'}). Please make sure the backend server is running.`);
      }
      return {};
    }
  };

  const fetchTickets = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const response = await fetch('/api/tickets', { headers: { Authorization: `Bearer ${token}` } });
      const data = await parseJsonResponse(response);
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

  useEffect(() => {
    const socket = getSocket();
    const handleTicketNotification = () => {
      void fetchTickets();
    };
    socket.on('ticket:notification', handleTicketNotification);
    return () => { socket.off('ticket:notification', handleTicketNotification); };
  }, [fetchTickets]);

  const updateTicket = async (id: string, updates: Partial<Pick<Ticket, 'status' | 'priority' | 'assignedTo' | 'followUpAt'>>) => {
    try {
      const response = await fetch(`/api/tickets/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      const data = await parseJsonResponse(response);
      if (!response.ok) throw new Error(data.error || 'Unable to update ticket.');
      setTickets(current => current.map(ticket => ticket.id === id ? data.ticket : ticket));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update ticket.');
    }
  };

  const sendReply = async (ticketId: string) => {
    if (!replyText.trim()) return;
    setSendingReply(true);
    setError('');
    try {
      const response = await fetch(`/api/tickets/${ticketId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: replyText.trim() })
      });
      const data = await parseJsonResponse(response);
      if (!response.ok) throw new Error(data.error || 'Unable to send ticket reply.');
      setReplyText('');
      await fetchTickets();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send ticket reply.');
    } finally {
      setSendingReply(false);
    }
  };

  const deleteTicket = async (id: string) => {
    if (!confirm('Are you sure you want to delete this support ticket?')) return;
    setDeletingId(id);
    try {
      const response = await fetch(`/api/tickets/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await parseJsonResponse(response);
      if (!response.ok) throw new Error(data.error || 'Unable to delete ticket.');
      setTickets(current => current.filter(t => t.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete ticket.');
    } finally {
      setDeletingId(null);
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
        body: JSON.stringify({
          customerName: isCustomer ? (user?.name || customerName) : customerName,
          customerEmail: isCustomer ? (user?.email || customerEmail) : customerEmail,
          subject,
          description,
          priority,
          assignedTo: canAssignTickets ? (assignedTo || undefined) : undefined,
          followUpAt: isCustomer ? undefined : (followUpAt || undefined)
        })
      });
      const data = await parseJsonResponse(response);
      if (!response.ok) throw new Error(data.error || 'Unable to create ticket.');
      setTickets(current => [data.ticket, ...current]);
      setSubject('');
      setDescription('');
      setPriority('normal');
      setAssignedTo('');
      setFollowUpAt('');
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create ticket.');
    } finally {
      setSaving(false);
    }
  };

  const filteredTickets = statusFilter === 'all'
    ? tickets
    : tickets.filter(t => t.status === statusFilter);

  const overdueCount = tickets.filter(
    ticket => ticket.followUpAt && new Date(ticket.followUpAt) < new Date() && !['resolved', 'closed'].includes(ticket.status)
  ).length;

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
            {isCustomer ? 'My Support Tickets' : isAgentView ? 'Tickets' : 'Support Tickets'}
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            {isCustomer
              ? 'Track your inquiries, reported issues, and responses from support agents.'
              : isAgentView
                ? 'View customer issues, ticket conversations, and status updates.'
                : 'Track customer issues, ownership, priority, and follow-up across all channels.'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void fetchTickets()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer shadow-xs transition-colors"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button
            onClick={() => {
              if (isCustomer) {
                setCustomerName(user?.name || '');
                setCustomerEmail(user?.email || '');
              }
              setShowForm(value => !value);
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-purple-700 cursor-pointer shadow-sm transition-colors"
          >
            <Plus className="h-4 w-4" /> {isCustomer ? 'Open New Ticket' : 'New Ticket'}
          </button>
        </div>
      </header>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-2xl border border-slate-200 text-xs font-semibold overflow-x-auto">
        {['all', 'open', 'in_progress', 'waiting', 'resolved', 'closed'].map(st => (
          <button
            key={st}
            type="button"
            onClick={() => setStatusFilter(st)}
            className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer whitespace-nowrap ${
              statusFilter === st
                ? 'bg-white text-slate-900 shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {st === 'all' ? `${t('tickets.filter_all')} (${tickets.length})` : `${getStatusLabel(st)} (${tickets.filter(t => t.status === st).length})`}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}


      {!isCustomer && overdueCount > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-800 flex items-center gap-2">
          <Clock className="w-4 h-4 text-amber-600 shrink-0" />
          <span><strong>{overdueCount} ticket{overdueCount === 1 ? '' : 's'}</strong> need overdue follow-up attention.</span>
        </div>
      )}

      {showForm && (
        <form onSubmit={createTicket} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2">
          <h2 className="font-bold text-slate-900 sm:col-span-2">
            {isCustomer ? 'Submit a Support Ticket' : 'Create a Support Ticket'}
          </h2>

          {!isCustomer && (
            <>
              <input
                required
                value={customerName}
                onChange={event => setCustomerName(event.target.value)}
                placeholder="Customer name"
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20"
              />
              <input
                type="email"
                value={customerEmail}
                onChange={event => setCustomerEmail(event.target.value)}
                placeholder="Customer email (optional)"
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20"
              />
            </>
          )}

          <input
            required
            value={subject}
            onChange={event => setSubject(event.target.value)}
            placeholder="Issue summary / subject"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm sm:col-span-2 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
          />

          <textarea
            required
            value={description}
            onChange={event => setDescription(event.target.value)}
            placeholder="Describe the issue in detail..."
            rows={3}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm sm:col-span-2 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
          />

          <label className="space-y-1 text-xs font-medium text-slate-600">
            Priority
            <select
              value={priority}
              onChange={event => setPriority(event.target.value)}
              className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>

          {canAssignTickets && (
            <label className="space-y-1 text-xs font-medium text-slate-600">
                Assign to
                <input
                  value={assignedTo}
                  onChange={event => setAssignedTo(event.target.value)}
                  placeholder="Agent name"
                  className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
          )}
          {!isCustomer && (
            <>
              <label className="space-y-1 text-xs font-medium text-slate-600">
                Follow-up date
                <input
                  type="date"
                  value={followUpAt}
                  onChange={event => setFollowUpAt(event.target.value)}
                  className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
            </>
          )}

          <div className="flex items-end justify-end gap-2 sm:col-span-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              disabled={saving}
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 cursor-pointer disabled:opacity-50"
            >
              {saving ? 'Saving…' : (isCustomer ? 'Submit Ticket' : 'Create Ticket')}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-xs">
        {loading ? (
          <p className="p-8 text-center text-sm text-slate-500">Loading tickets…</p>
        ) : filteredTickets.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">
            {statusFilter === 'all'
              ? t('tickets.empty')
              : `No tickets found with status "${getStatusLabel(statusFilter)}".`}
          </p>
        ) : (
          <table className="w-full min-w-[850px] text-left text-xs text-slate-600">
            <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-700">
              <tr>
                <th className="px-4 py-3">Issue / Customer</th>
                <th className="px-4 py-3">Priority</th>
                {canAssignTickets && <th className="px-4 py-3">Assigned to</th>}
                <th className="px-4 py-3">Follow-up</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Updated</th>
                {!isCustomer && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTickets.map(ticket => {
                const overdue = ticket.followUpAt && new Date(ticket.followUpAt) < new Date() && !['resolved', 'closed'].includes(ticket.status);
                return (
                  <React.Fragment key={ticket.id}>
                  <tr key={ticket.id} className="align-top hover:bg-slate-50/60">
                    <td className="max-w-xs px-4 py-3">
                      <p className="font-bold text-slate-900">{ticket.subject}</p>
                      {!isCustomer && (
                        <p className="mt-0.5 text-slate-700 font-medium">
                          {ticket.customerName}
                          {ticket.customerEmail ? ` · ${ticket.customerEmail}` : ''}
                        </p>
                      )}
                      <p className="mt-1 line-clamp-2 text-slate-500">{ticket.description}</p>
                      {isCustomer && (
                        <button
                          type="button"
                          onClick={() => { setOpenConversationId(openConversationId === ticket.id ? null : ticket.id); setReplyText(''); }}
                          className="mt-2 rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          {openConversationId === ticket.id ? 'Hide replies' : `View conversation (${ticket.messages?.length || 0})`}
                        </button>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      {isCustomer ? (
                        <span className={`inline-flex px-2 py-0.5 rounded-md border text-[11px] font-semibold capitalize ${priorityColors[ticket.priority] || priorityColors.normal}`}>
                          {ticket.priority}
                        </span>
                      ) : (
                        <select
                          aria-label={`Priority for ${ticket.subject}`}
                          value={ticket.priority}
                          onChange={event => void updateTicket(ticket.id, { priority: event.target.value })}
                          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
                        >
                          <option value="low">Low</option>
                          <option value="normal">Normal</option>
                          <option value="high">High</option>
                          <option value="urgent">Urgent</option>
                        </select>
                      )}
                    </td>

                    {canAssignTickets && (
                      <td className="px-4 py-3">
                        <input
                          aria-label={`Assignee for ${ticket.subject}`}
                          defaultValue={ticket.assignedTo || ''}
                          onBlur={event => {
                            if (event.target.value !== (ticket.assignedTo || '')) {
                              void updateTicket(ticket.id, { assignedTo: event.target.value });
                            }
                          }}
                          placeholder="Unassigned"
                          className="w-28 rounded-md border border-slate-200 px-2 py-1 text-xs"
                        />
                      </td>
                    )}

                    <td className={`px-4 py-3 ${overdue ? 'font-bold text-red-600' : ''}`}>
                      {ticket.followUpAt ? new Date(ticket.followUpAt).toLocaleDateString() : '—'}
                      {overdue ? ' · Overdue' : ''}
                    </td>

                    <td className="px-4 py-3">
                      {isCustomer ? (
                        <span className={`inline-flex px-2 py-0.5 rounded-md border text-[11px] font-semibold ${statusColors[ticket.status] || statusColors.open}`}>
                          {getStatusLabel(ticket.status)}
                        </span>
                      ) : (
                        <select
                          aria-label={`Status for ${ticket.subject}`}
                          value={ticket.status}
                          onChange={event => void updateTicket(ticket.id, { status: event.target.value })}
                          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
                        >
                          {statusOptions.map(({ value, label }) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      )}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                      {new Date(ticket.updatedAt).toLocaleDateString()}
                    </td>

                    {!isCustomer && (
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => { setOpenConversationId(openConversationId === ticket.id ? null : ticket.id); setReplyText(''); }}
                          className="mr-2 rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          {openConversationId === ticket.id ? 'Hide replies' : `Replies (${ticket.messages?.length || 0})`}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteTicket(ticket.id)}
                          disabled={deletingId === ticket.id}
                          className="p-1 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-50"
                          title="Delete ticket"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                  {openConversationId === ticket.id && (
                    <tr>
                      <td colSpan={isCustomer ? 5 : isAgentView ? 6 : 7} className="bg-slate-50 px-5 py-4">
                        <div className="mx-auto max-w-3xl space-y-3">
                          <h3 className="font-bold text-slate-900">Ticket conversation</h3>
                          {ticket.messages?.length ? ticket.messages.map(message => (
                            <article key={message.id} className="rounded-lg border border-slate-200 bg-white p-3">
                              <div className="flex justify-between gap-3 text-xs">
                                <strong className="text-slate-800">{message.senderName} · {message.senderRole}</strong>
                                <time className="text-slate-500">{new Date(message.createdAt).toLocaleString()}</time>
                              </div>
                              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{message.message}</p>
                            </article>
                          )) : <p className="text-sm text-slate-500">No replies yet. Use this conversation to update the customer.</p>}
                          <form onSubmit={event => { event.preventDefault(); void sendReply(ticket.id); }} className="space-y-2">
                            <textarea
                              value={replyText}
                              onChange={event => setReplyText(event.target.value)}
                              maxLength={4000}
                              rows={3}
                              placeholder={isCustomer ? 'Reply to support…' : 'Write an update or explain the resolution…'}
                              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                            />
                            <div className="flex items-center justify-between">
                              {!isCustomer && <span className="text-xs text-slate-500">The customer will receive an email when delivery is configured.</span>}
                              <button disabled={sendingReply || !replyText.trim()} className="ml-auto rounded-lg bg-purple-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
                                {sendingReply ? 'Sending…' : 'Send reply'}
                              </button>
                            </div>
                          </form>
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
};
