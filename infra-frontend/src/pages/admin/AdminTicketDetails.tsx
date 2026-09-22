import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { format } from 'date-fns';
import { 
  Loader2, ArrowLeft, MapPin, User, Building2, 
  History, ExternalLink, Mail, Phone, Image as ImageIcon,
  ShieldAlert, RefreshCw, FileCheck
} from 'lucide-react';
import { api } from '../../services/api';

const ALL_STATUSES = [
  'ASSIGNED_TO_JE',
  'PENDING_AE_APPROVAL',
  'PENDING_SE_APPROVAL',
  'PENDING_DEAN_APPROVAL',
  'PENDING_DIRECTOR_APPROVAL',
  'APPROVED_FOR_TENDERING',
  'TENDER_PUBLISHED',
  'WORK_IN_PROGRESS',
  'RETURNED_TO_JE',
  'DENIED',
  'CLOSED'
];

export default function AdminTicketDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  
  const [ticket, setTicket] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Override state
  const [overrideStatus, setOverrideStatus] = useState('');
  const [overrideJeId, setOverrideJeId] = useState('');
  const [overrideRemarks, setOverrideRemarks] = useState('');
  const [isSubmittingOverride, setIsSubmittingOverride] = useState(false);
  const [jes, setJes] = useState<any[]>([]);

  const fetchDetails = async () => {
    setLoading(true);
    setError('');
    try {
      // Use the unredacted master admin endpoint
      const response = await api.get(`/admin/tickets/${id}/details`);
      if (response.data.success) {
        setTicket(response.data.ticket);
        setOverrideStatus(response.data.ticket.status);
      }
    } catch (err: any) {
      console.error('Failed to load master details:', err);
      setError(err.response?.data?.message || 'Failed to load ticket details.');
    } finally {
      setLoading(false);
    }
  };

  const fetchJes = async () => {
    try {
      const res = await api.get('/admin/jes');
      if (res.data.success) {
        setJes(res.data.jes || []);
      }
    } catch (err) {
      console.error('Failed to load JEs:', err);
    }
  };

  useEffect(() => {
    fetchDetails();
    fetchJes();
  }, [id]);

  const handleExecuteOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideRemarks.trim()) {
      alert('Administrative justification remarks are strictly required.');
      return;
    }

    setIsSubmittingOverride(true);
    try {
      const res = await api.post(`/admin/tickets/${id}/override`, {
        new_status: overrideStatus !== ticket.status ? overrideStatus : undefined,
        new_assigned_je_id: overrideJeId ? parseInt(overrideJeId, 10) : undefined,
        remarks: overrideRemarks.trim(),
      });
      if (res.data.success) {
        alert('Ticket state and audit record updated successfully.');
        setOverrideRemarks('');
        fetchDetails();
      }
    } catch (err: any) {
      console.error('Override error:', err);
      alert(err.response?.data?.message || 'Failed to execute override.');
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
        <p className="text-base font-bold mb-2">Error Loading Ticket</p>
        <p className="text-sm">{error || 'Ticket not found.'}</p>
        <button
          onClick={() => navigate('/admin/tickets')}
          className="mt-4 px-4 py-2 bg-red-600 text-white text-xs font-bold rounded-xl"
        >
          Return to Master Tickets
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
          <ArrowLeft size={16} /> Back to Master Directory
        </Link>

        <button
          onClick={fetchDetails}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 transition"
        >
          <RefreshCw size={13} /> Refresh Details
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
              {ticket.status.replace(/_/g, ' ')}
            </span>
            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
              {ticket.type === 'non-recurring' ? 'Non-Recurring Proposal' : 'Recurring Maintenance'}
            </span>
          </div>

          <span className="text-xs text-slate-400">
            Reported on {format(new Date(ticket.created_at), 'PPP · p')}
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
            <span>Wing: <strong className="text-slate-800 dark:text-slate-100">{ticket.department}</strong></span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/50 px-3 py-1.5 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
            <MapPin size={15} className="text-slate-400" />
            <span>Location: <strong className="text-slate-800 dark:text-slate-100">{ticket.location || 'Campus'}</strong></span>
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
                <FileCheck size={18} className="text-blue-600" /> Junior Engineer Inspection Report
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
                  <span className="font-bold text-slate-400 uppercase tracking-wider block mb-1">Nature of Work</span>
                  <p className="text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-900/40 p-3 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
                    {latestReport.nature_of_work}
                  </p>
                </div>
                {latestReport.remarks && (
                  <div>
                    <span className="font-bold text-slate-400 uppercase tracking-wider block mb-1">Engineering Remarks</span>
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
                Site inspection pending. No report filed by Junior Engineer yet.
              </div>
            )}
          </div>

          {/* Master Override Controls */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-amber-500/30 dark:border-amber-500/20 space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-700">
              <span className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600">
                <ShieldAlert size={18} />
              </span>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Administrative Override Desk
                </h2>
                <p className="text-xs text-slate-500">Unrestricted authority intervention & ticket routing</p>
              </div>
            </div>

            <form onSubmit={handleExecuteOverride} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Override Status</label>
                  <select
                    value={overrideStatus}
                    onChange={(e) => setOverrideStatus(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    {ALL_STATUSES.map((s) => (
                      <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Reassign Responsible JE <span className="font-normal text-slate-400">(Optional)</span>
                  </label>
                  <select
                    value={overrideJeId}
                    onChange={(e) => setOverrideJeId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="">Keep current ({ticket.assigned_je_name || 'None'})</option>
                    {jes.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.name} ({j.department}) — {j.email}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Audit Justification / Remarks <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={2}
                  value={overrideRemarks}
                  onChange={(e) => setOverrideRemarks(e.target.value)}
                  placeholder="Specify official reason for administrative intervention..."
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
                  {isSubmittingOverride ? 'Executing Override...' : 'Apply Administrative Override'}
                </button>
              </div>
            </form>
          </div>

          {/* Master Audit Log Stream */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-200/80 dark:border-slate-700/80 space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <History size={18} className="text-purple-600" /> Complete Unredacted Audit Trail
            </h2>

            <div className="space-y-3 relative before:absolute before:inset-0 before:left-3.5 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-700">
              {auditLogs.map((log: any, idx: number) => (
                <div key={idx} className="relative flex items-start gap-4 text-xs">
                  <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 border-2 border-purple-500 text-purple-600 flex items-center justify-center shrink-0 z-10 text-[10px] font-bold">
                    {idx + 1}
                  </div>
                  <div className="flex-1 bg-slate-50 dark:bg-slate-900/40 p-3 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-slate-900 dark:text-white">{log.action}</span>
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
              <User size={15} /> Initiator / Applicant
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
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Assigned Junior Engineer</h4>
              {ticket.assigned_je_name ? (
                <div>
                  <p className="font-bold text-slate-900 dark:text-white text-xs">{ticket.assigned_je_name}</p>
                  <p className="text-[11px] text-slate-500">{ticket.assigned_je_email}</p>
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic">No engineer assigned</p>
              )}
            </div>
          </div>

          {/* Attachments Gallery */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-sm border border-slate-200/80 dark:border-slate-700/80 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <ImageIcon size={15} /> All Uploaded Files ({attachments.length})
            </h3>

            {attachments.length > 0 ? (
              <div className="space-y-2">
                {attachments.map((file: any, i: number) => (
                  <a
                    key={i}
                    href={file.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 hover:border-blue-500 transition group text-xs"
                  >
                    <div className="min-w-0 pr-2">
                      <span className="font-medium text-slate-800 dark:text-slate-200 block truncate">
                        {file.file_url.split('/').pop()}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {file.document_category?.replace(/_/g, ' ') || 'Attachment'} · by {file.uploader_name || 'User'}
                      </span>
                    </div>
                    <ExternalLink size={14} className="text-slate-400 group-hover:text-blue-500 shrink-0" />
                  </a>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-400 text-center py-4 bg-slate-50 dark:bg-slate-900/30 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
                No attachments uploaded.
              </div>
            )}
          </div>

        </div>

      </div>

    </div>
  );
}
