import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Building2, Image as ImageIcon, Loader2, Mail, MapPin, Phone, User, FileText, ExternalLink, Paperclip } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';
import { errorMessage, mapsHref } from '../lib/ticketUi';
import type { TicketDetail } from '../components/ticket/types';
import { Card, Label } from '../components/ticket/Card';
import TicketHeader from '../components/ticket/TicketHeader';
import PathTracker from '../components/ticket/PathTracker';
import ActionPanel from '../components/ticket/ActionPanel';
import { ChangeRequestBanner, MessagesTimeline } from '../components/ticket/Messages';
import { DecisionBrief, ReportCard } from '../components/ticket/Brief';
import PostApproval from '../components/ticket/PostApproval';
import ApplicantView from '../components/ticket/ApplicantView';
import { AttachmentList, GroupedAttachments, UploadFiles } from '../components/ticket/Attachments';

// Roles that get the Decision Brief (AE and above).
const BRIEF_ROLES = ['AE', 'SE', 'DEAN', 'DIRECTOR', 'SYSADMIN'];

/**
 * The one ticket page for every role. The test page passes ticketId and roleOverride to show it as another role. What renders is decided by the role token
 * AND by what the API actually returned: the API already redacts per viewer, so
 * a section without data simply does not appear.
 */
export default function TicketDetails({ ticketId, roleOverride }: { ticketId?: number; roleOverride?: string } = {}) {
  const params = useParams();
  const id = ticketId ?? params.id;
  const authRole = useAuthStore((s) => s.user?.role) ?? 'APPLICANT';
  // roleOverride is only ever passed by the Sysadmin test page.
  const role = roleOverride ?? authRole;
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/tickets/${id}/details`);
      setTicket(res.data.ticket);
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Failed to load ticket details.'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  if (loading) {
    return <div className="flex h-[60vh] items-center justify-center"><Loader2 className="animate-spin text-blue-500" size={40} /></div>;
  }
  if (error || !ticket) {
    return (
      <div role="alert" className="mx-auto mt-10 max-w-3xl rounded-xl border border-red-100 bg-red-50 p-6 text-center font-medium text-red-600 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
        {error || 'Ticket not found.'}
      </div>
    );
  }

  // Applicant lockdown: an APPLICANT account, or any viewer whose payload has no
  // staff view (the staff payload always carries applicant_id).
  if (role === 'APPLICANT' || ticket.applicant_id === undefined) {
    return <ApplicantView ticket={ticket} onChanged={load} />;
  }

  const myDesk = ticket.available_actions?.desk ?? (['JE', 'AE', 'SE', 'DEAN', 'DIRECTOR'].includes(role) ? role : null);
  const hasBrief = BRIEF_ROLES.includes(role);
  const applicantPhotos = ticket.attachments.filter((a) => !a.document_category || a.document_category === 'APPLICANT_EVIDENCE');
  // Everything not shown elsewhere: officers' files, tender/finance docs, JE work photos.
  const deskFiles = ticket.attachments.filter(
    (a) => a.document_category && a.document_category !== 'APPLICANT_EVIDENCE' && a.report_id == null);
  const open = ticket.status !== 'CLOSED' && ticket.status !== 'DENIED';
  const phone = ticket.applicant_phone || ticket.contact_phone;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 pb-16 animate-in fade-in duration-300">
      <TicketHeader ticket={ticket} role={role} />

      {/* Above the panel: the return thread that needs an answer. */}
      <ChangeRequestBanner ticket={ticket} myDesk={myDesk} />
      <ActionPanel ticket={ticket} onDone={load} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {hasBrief ? <DecisionBrief ticket={ticket} /> : <ReportCard ticket={ticket} />}
          <PathTracker ticket={ticket} />

          <Card title="Description" icon={<FileText size={14} />}>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-900 dark:text-slate-100 md:text-base">{ticket.description}</p>
            <div className="mt-5 grid gap-4 border-t border-slate-100 pt-4 dark:border-slate-700/60 sm:grid-cols-2">
              <div>
                <Label>Department</Label>
                <p className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200"><Building2 size={15} className="text-blue-500" />{ticket.department}</p>
              </div>
              <div>
                <Label>Location</Label>
                <p className="flex items-start gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                  <MapPin size={15} className="mt-0.5 shrink-0 text-rose-500" />
                  <span>{[ticket.campus, ticket.building, ticket.landmark, ticket.location].filter(Boolean).join(' · ')}</span>
                </p>
                <a href={mapsHref(ticket)} target="_blank" rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400">
                  <ExternalLink size={12} /> Open in Maps
                </a>
              </div>
            </div>
          </Card>

          <PostApproval ticket={ticket} />
          <MessagesTimeline ticket={ticket} />
        </div>

        <div className="space-y-4">
          {ticket.applicant_name && (
            <Card title="Raised by" icon={<User size={14} />}>
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-sm font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  {ticket.applicant_name.substring(0, 2).toUpperCase()}
                </span>
                <p className="min-w-0 truncate text-sm font-semibold text-slate-900 dark:text-white">{ticket.applicant_name}</p>
              </div>
              {(ticket.applicant_email || phone) && (
                <div className="mt-3 space-y-2">
                  {ticket.applicant_email && (
                    <a href={`mailto:${ticket.applicant_email}`} className="flex items-center gap-2 truncate rounded-xl bg-slate-50 p-3 text-xs text-slate-600 hover:text-blue-600 dark:bg-slate-900/50 dark:text-slate-300">
                      <Mail size={14} className="shrink-0 text-slate-400" /><span className="truncate">{ticket.applicant_email}</span>
                    </a>
                  )}
                  {phone && (
                    <a href={`tel:${phone}`} className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600 hover:text-blue-600 dark:bg-slate-900/50 dark:text-slate-300">
                      <Phone size={14} className="shrink-0 text-slate-400" />{phone}
                    </a>
                  )}
                </div>
              )}
            </Card>
          )}

          <Card title="Photos" icon={<ImageIcon size={14} />}>
            <AttachmentList files={applicantPhotos} empty="No photos." cols="grid-cols-2" />
          </Card>

          <Card title="Documents" icon={<Paperclip size={14} />}>
            <GroupedAttachments files={deskFiles} empty="No documents yet." />
            {open && <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-700/60"><UploadFiles ticketId={ticket.id} onDone={load} /></div>}
          </Card>
        </div>
      </div>
    </div>
  );
}
