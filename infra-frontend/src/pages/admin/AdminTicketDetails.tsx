import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { format } from 'date-fns';
import { 
  Loader2, ArrowLeft, MapPin, User, Building2, 
  History, Mail, Phone, Image as ImageIcon,
  ShieldAlert, RefreshCw, FileCheck
} from 'lucide-react';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { toast } from '../../store/toastStore';
import { GroupedAttachments } from '../../components/ticket/Attachments';
import DeleteTicket from '../../components/admin/DeleteTicket';
import ReassignFields from '../../components/admin/ReassignFields';
import { NO_REASSIGN, reassignBody, type ReassignValue } from '../../lib/reassign';
import { deskLabel, placeLabel, staffStatusLabel } from '../../lib/ticketUi';
import { ALL_STATUSES } from '../../lib/statuses';

export default function AdminTicketDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isDemo = useAuthStore((s) => !!s.user?.is_demo); // the demo Sysadmin is read-only
  
  const [ticket, setTicket] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Override state
  const [overrideStatus, setOverrideStatus] = useState('');
  const [overridePriority, setOverridePriority] = useState('NORMAL');
  const [reassign, setReassign] = useState<ReassignValue>(NO_REASSIGN);
  const [overrideRemarks, setOverrideRemarks] = useState('');
  const [isSubmittingOverride, setIsSubmittingOverride] = useState(false);

  const fetchDetails = async () => {
    setLoading(true);
    setError('');
    try {
      // Use the unredacted master admin endpoint
      const response = await api.get(`/admin/tickets/${id}/details`);
      if (response.data.success) {
        setTicket(response.data.ticket);
        setOverrideStatus(response.data.ticket.status);
        setOverridePriority(response.data.ticket.priority ?? 'NORMAL');
      }
    } catch (err: any) {
      console.error('Failed to load master details:', err);
      setError(err.response?.data?.message || 'Failed to load ticket details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetails();
  }, [id]);

  const handleExecuteOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideRemarks.trim()) {
      toast.error('Enter a reason.');
      return;
    }

    setIsSubmittingOverride(true);
    try {
      const res = await api.post(`/admin/tickets/${id}/override`, {
        new_status: overrideStatus !== ticket.status ? overrideStatus : undefined,
        priority: overridePriority !== (ticket.priority ?? 'NORMAL') ? overridePriority : undefined,
        reassign: reassignBody(reassign),
        remarks: overrideRemarks.trim(),
      });
      if (res.data.success) {
        toast.success('Ticket updated.');
        setOverrideRemarks('');
        setReassign(NO_REASSIGN);
        fetchDetails();
      }
    } catch (err: any) {
      console.error('Override error:', err);
      toast.error(err.response?.data?.message || 'Could not update the ticket.');
    } finally {
      setIsSubmittingOverride(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="animate-spin text-blue-500" size={40} />
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="bg-red-50 text-red-600 p-6 rounded-2xl border border-red-200 max-w-3xl mx-auto mt-10 font-medium text-center">
        <p className="text-base font-bold mb-2">Could not load the ticket</p>
        <p className="text-sm">{error || 'Ticket not found.'}</p>
        <button
          onClick={() => navigate('/admin/tickets')}
          className="mt-4 px-4 py-2 bg-red-600 text-white text-xs font-bold rounded-xl"
        >
          Back to Tickets
        </button>
      </div>
    );
  }

  const latestReport = ticket.reports && ticket.reports.length > 0 ? ticket.reports[0] : null;
  const attachments = ticket.attachments || [];
  const auditLogs = ticket.audit_logs || [];

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20 animate-in fade-in duration-200 text-slate-800 dark:text-slate-100">
      
      {/* Top Breadcrumb & Actions */}
      <div className="flex items-center justify-between">
        <Link
          to="/admin/tickets"
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition"
        >
          <ArrowLeft size={16} /> Back to Tickets
        </Link>

        <button
          onClick={fetchDetails}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 transition"
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Main Ticket Banner */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-200/80 dark:border-slate-700/80 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-700 pb-4">
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-3 py-1 rounded-xl border border-blue-200 dark:border-blue-800/50">
              #TKT-{ticket.id.toString().padStart(4, '0')}
            </span>
            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
              {staffStatusLabel(ticket.status)}
            </span>
            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
              {ticket.type === 'non-recurring' ? 'Proposal' : 'Recurring'}
            </span>
          </div>

          <span className="text-xs text-slate-400">
            Raised {format(new Date(ticket.created_at), 'PPP · p')}
          </span>
        </div>

        <div>
          <h1 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white">
            {ticket.title || ticket.description}
          </h1>
          {ticket.title && (
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 whitespace-pre-line leading-relaxed">
              {ticket.description}
            </p>
          )}
        </div>

        {/* Location & Department */}
        <div className="flex flex-wrap gap-4 pt-2 text-xs">
          <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/50 px-3 py-1.5 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
            <Building2 size={15} className="text-slate-400" />
            <span>Department: <strong className="text-slate-800 dark:text-slate-100">{ticket.department}</strong></span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/50 px-3 py-1.5 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
            <MapPin size={15} className="text-slate-400" />
            <span>Location: <strong className="text-slate-800 dark:text-slate-100">{placeLabel(ticket)}</strong></span>
          </div>
        </div>
      </div>

      {/* Grid: 2 Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column (2 Cols): Engineering Report & Admin Override */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Engineering Report Card */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-200/80 dark:border-slate-700/80 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700">
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <FileCheck size={18} className="text-blue-600" /> Inspection Report
              </h2>
              {latestReport && (
                <span className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400">
                  Estimate: ₹{parseFloat(String(latestReport.estimated_amount)).toLocaleString('en-IN')}
                </span>
              )}
            </div>

            {latestReport ? (
              <div className="space-y-3 text-xs">
                <div>
                  <span className="font-bold text-slate-400 uppercase tracking-wider block mb-1">Findings</span>
                  <p className="text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-900/40 p-3 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
                    {latestReport.nature_of_work}
                  </p>
                </div>
                {latestReport.remarks && (
                  <div>
                    <span className="font-bold text-slate-400 uppercase tracking-wider block mb-1">Remarks</span>
                    <p className="text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-900/40 p-3 rounded-xl border border-slate-200/60 dark:border-slate-700/60 italic">
                      "{latestReport.remarks}"
                    </p>
                  </div>
                )}
                <div className="text-[11px] text-slate-400 pt-1">
                  Filed by JE {latestReport.je_name} on {format(new Date(latestReport.created_at), 'PPP · p')}
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-400 text-center py-6 bg-slate-50 dark:bg-slate-900/30 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
                No report filed yet.
              </div>
            )}
          </div>

          {/* Override */}
          {!isDemo && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-amber-500/30 dark:border-amber-500/20 space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-700">
              <span className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600">
                <ShieldAlert size={18} />
              </span>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Override
                </h2>
                <p className="text-xs text-slate-500">Change the status or reassign any desk.</p>
              </div>
            </div>

            <form onSubmit={handleExecuteOverride} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Status</label>
                  <select
                    value={overrideStatus}
                    onChange={(e) => setOverrideStatus(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    {ALL_STATUSES.map((s) => (
                      <option key={s} value={s}>{staffStatusLabel(s)}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Priority</label>
                  <select
                    value={overridePriority}
                    onChange={(e) => setOverridePriority(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    {['LOW', 'NORMAL', 'URGENT'].map((p) => <option key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</option>)}
                  </select>
                </div>
              </div>

              <ReassignFields department={ticket.department} campus={ticket.campus} value={reassign} onChange={setReassign} />

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Reason <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={2}
                  value={overrideRemarks}
                  onChange={(e) => setOverrideRemarks(e.target.value)}
                  placeholder="Why is this change needed?"
                  required
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={isSubmittingOverride}
                  className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold transition shadow-sm disabled:opacity-50"
                >
                  {isSubmittingOverride ? 'Applying…' : 'Apply'}
                </button>
              </div>
            </form>
          </div>
          )}

          {/* Audit log */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-200/80 dark:border-slate-700/80 space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <History size={18} className="text-purple-600" /> Audit Log
            </h2>

            <div className="space-y-3 relative before:absolute before:inset-0 before:left-3.5 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-700">
              {auditLogs.map((log: any, idx: number) => (
                <div key={idx} className="relative flex items-start gap-4 text-xs">
                  <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 border-2 border-purple-500 text-purple-600 flex items-center justify-center shrink-0 z-10 text-[10px] font-bold">
                    {idx + 1}
                  </div>
                  <div className="flex-1 bg-slate-50 dark:bg-slate-900/40 p-3 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-slate-900 dark:text-white">
                        {log.action}
                        {log.is_self_action ? <span title="The actor raised this ticket" className="ml-2 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-violet-800 dark:bg-violet-900/30 dark:text-violet-300">Self</span> : null}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {format(new Date(log.created_at), 'dd MMM · HH:mm')}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      By {log.actor_name} ({log.actor_role})
                    </p>
                    {log.remarks && (
                      <p className="mt-1 text-slate-700 dark:text-slate-300 font-medium">
                        {log.remarks}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* Right Column (1 Col): Initiator Info & Attachment Gallery */}
        <div className="space-y-6">
          
          {/* Applicant Info Card */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-sm border border-slate-200/80 dark:border-slate-700/80 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <User size={15} /> Raised by
            </h3>
            <div>
              <p className="font-bold text-slate-900 dark:text-white text-sm">{ticket.applicant_name}</p>
              <div className="mt-2 space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
                <p className="flex items-center gap-2">
                  <Mail size={13} className="text-slate-400" />
                  <a href={`mailto:${ticket.applicant_email}`} className="hover:underline">{ticket.applicant_email}</a>
                </p>
                {ticket.applicant_phone && (
                  <p className="flex items-center gap-2">
                    <Phone size={13} className="text-slate-400" />
                    <a href={`tel:${ticket.applicant_phone}`} className="hover:underline">{ticket.applicant_phone}</a>
                  </p>
                )}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-700/60">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Desk holders</h4>
              <ul className="space-y-1 text-xs">
                {(['JE', 'AE', 'SE', 'DEAN', 'DIRECTOR'] as const).map((d) => (
                  <li key={d} className="flex justify-between gap-2">
                    <span className="text-slate-500">{deskLabel(d)}</span>
                    <span className={`truncate font-semibold ${ticket.assignees?.current?.desk === d ? 'text-blue-600 dark:text-blue-400' : 'text-slate-800 dark:text-slate-200'}`}>
                      {ticket.assignees?.[d]?.name ?? '—'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Attachments Gallery */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-sm border border-slate-200/80 dark:border-slate-700/80 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <ImageIcon size={15} /> Files ({attachments.length})
            </h3>

            {attachments.length > 0 ? (
              <GroupedAttachments
                files={attachments.map((file: any) => ({
                  id: file.id,
                  created_at: file.created_at,
                  document_category: file.document_category,
                  file_name: file.original_name || String(file.file_url).split('/').pop()?.replace(/^\d+-\d+-/, '') || 'file',
                  download_url: `/api/attachments/${file.id}`,
                  uploader_desk: file.uploader_desk ?? file.uploader_role,
                  uploader_name: file.uploader_name,
                  audit_log_id: file.audit_log_id ?? undefined,
                }))}
              />
            ) : (
              <div className="text-xs text-slate-400 text-center py-4 bg-slate-50 dark:bg-slate-900/30 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
                No files.
              </div>
            )}
          </div>

        </div>

      </div>

      {!isDemo && <DeleteTicket ticketId={ticket.id} onDeleted={() => navigate('/admin/tickets')} />}

    </div>
  );
}
