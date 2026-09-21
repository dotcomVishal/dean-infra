import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { 
  Loader2, ArrowLeft, MapPin, User, Building2, 
  CheckCircle, XCircle, FileText, IndianRupee, 
  History, ExternalLink, Mail, Image as ImageIcon 
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';

export default function TicketDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  
  const [ticket, setTicket] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionRemarks, setActionRemarks] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const fetchDetails = async () => {
      try {
        const response = await api.get(`/tickets/${id}/details`);
        setTicket(response.data.ticket);
      } catch (err: any) {
        setError('Failed to load ticket details.');
      } finally {
        setLoading(false);
      }
    };
    fetchDetails();
  }, [id]);

  const handleAction = async (action: 'APPROVE' | 'RETURN' | 'DENY') => {
    if ((action === 'RETURN' || action === 'DENY') && !actionRemarks.trim()) return alert("Please provide remarks.");
    setIsProcessing(true);
    try {
      await api.post(`/tickets/${id}/review`, { action, remarks: actionRemarks });
      const response = await api.get(`/tickets/${id}/details`);
      setTicket(response.data.ticket);
      setActionRemarks('');
    } catch (err) {
      alert("Failed to process action.");
    } finally {
      setIsProcessing(false);
    }
  };

  if (loading) return <div className="flex h-[60vh] items-center justify-center"><Loader2 className="animate-spin text-blue-500" size={40} /></div>;
  if (error) return <div className="bg-red-50 text-red-600 p-6 rounded-xl border border-red-100 max-w-3xl mx-auto mt-10 font-medium text-center">{error}</div>;
  if (!ticket) return null;

  const isApplicant = user?.role === 'APPLICANT';
  const canApprove = 
    (user?.role === 'AE' && ticket.status === 'PENDING_AE_APPROVAL') ||
    (user?.role === 'SE' && ticket.status === 'PENDING_SE_APPROVAL') ||
    (user?.role === 'DEAN' && ticket.status === 'PENDING_DEAN_APPROVAL') ||
    (user?.role === 'DIRECTOR' && ticket.status === 'PENDING_DIRECTOR_APPROVAL');
  const isRejected = ticket.status === 'RETURNED_TO_JE' || ticket.status === 'DENIED';

  // --- GOOGLE MAPS REGEX FIX ---
  let mapQuery = encodeURIComponent(ticket.location);
  const coordsMatch = ticket.location.match(/Lat:\s*([0-9.-]+),\s*Lng:\s*([0-9.-]+)/);
  if (coordsMatch) {
    mapQuery = `${coordsMatch[1]},${coordsMatch[2]}`; // Extracts pure coords if available
  }

  const apiBaseUrl = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
  const uploadBaseUrl = apiBaseUrl.endsWith('/api') ? apiBaseUrl.slice(0, -4) : apiBaseUrl;
  const toUploadUrl = (fileUrl: string) => {
    if (!fileUrl) return fileUrl;
    if (/^https?:\/\//i.test(fileUrl)) return fileUrl;

    const normalized = fileUrl.startsWith('/') ? fileUrl : `/${fileUrl}`;
    return normalized.startsWith('/uploads/') ? `${uploadBaseUrl}${normalized}` : normalized;
  };

  // --- FULL TIMELINE LOGIC ---
  const allStages = [
    { key: 'ASSIGNED_TO_JE', authLabel: 'JE Desk', appLabel: 'Processing Initiated' },
    { key: 'PENDING_AE_APPROVAL', authLabel: 'AE Desk', appLabel: 'Under Engineering Review' },
    { key: 'PENDING_SE_APPROVAL', authLabel: 'SE Desk', appLabel: 'Under Engineering Review' },
    { key: 'PENDING_DEAN_APPROVAL', authLabel: 'Dean Desk', appLabel: 'Higher Authority Review' },
    { key: 'PENDING_DIRECTOR_APPROVAL', authLabel: 'Director Desk', appLabel: 'Final Authority Review' },
    { key: 'APPROVED_FOR_TENDERING', authLabel: 'Tendering', appLabel: 'Approved & Processing' },
  ];
  const currentStageIndex = allStages.findIndex(s => s.key === ticket.status);

  return (
    <div className="max-w-6xl mx-auto w-full space-y-6 animate-in fade-in duration-500">
      
      {/* Top Bar */}
      <div className="flex items-center gap-4 bg-white dark:bg-slate-800 p-4 md:p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors text-slate-600 dark:text-slate-400">
          <ArrowLeft size={20} />
        </button>
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white">
              {ticket.title || `#TKT-${ticket.id.toString().padStart(4, '0')}`}
            </h1>
            <span className="text-xs font-mono font-bold text-blue-600 dark:text-blue-400">
              #TKT-{ticket.id.toString().padStart(4, '0')}
            </span>
            <span className={`text-[11px] font-bold px-2.5 py-1 rounded-md border tracking-wide uppercase ${isRejected ? 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800' : 'bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>
              {ticket.status.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-1">Reported on {format(new Date(ticket.created_at), 'PPP at p')}</p>
        </div>
      </div>

      {/* FIXED TIMELINE: Shows all nodes, dashes out future ones */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-700 overflow-x-auto">
        <h2 className="text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider uppercase mb-8">Progress Tracker</h2>
        <div className="flex items-center min-w-[700px] px-4 pb-6">
          {allStages.map((stage, index) => {
            const isCompleted = currentStageIndex > index || ticket.status === 'CLOSED';
            const isActive = currentStageIndex === index;

            return (
              <React.Fragment key={stage.key}>
                <div className="flex flex-col items-center relative">
                  
                  {/* Status Node */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 z-10 shrink-0 transition-colors ${
                    isActive ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-500/30' : 
                    isCompleted ? 'bg-green-500 border-green-500 text-white' : 
                    isRejected && index === 0 ? 'bg-red-500 border-red-500 text-white' :
                    'bg-slate-50 dark:bg-slate-900 border-dashed border-slate-300 dark:border-slate-600 text-slate-400'
                  }`}>
                    {isCompleted ? <CheckCircle size={16} /> : isRejected && index === 0 ? <XCircle size={16} /> : <span className="text-xs font-bold">{index + 1}</span>}
                  </div>
                  
                  {/* Label */}
                  <span className={`text-[10px] font-bold uppercase absolute top-10 w-28 text-center transition-colors ${
                    isActive ? 'text-blue-600 dark:text-blue-400' : 
                    isCompleted ? 'text-slate-700 dark:text-slate-300' :
                    'text-slate-400 dark:text-slate-500 opacity-60'
                  }`}>
                    {isApplicant ? stage.appLabel : stage.authLabel}
                  </span>
                </div>
                
                {/* Connector Line */}
                {index < allStages.length - 1 && (
                  <div className={`flex-1 h-1 mx-2 rounded transition-colors ${
                    isCompleted ? 'bg-green-500' : 
                    isActive ? 'bg-gradient-to-r from-blue-500 to-slate-200 dark:to-slate-700' :
                    'bg-slate-200 dark:bg-slate-700'
                  }`} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* LEFT COLUMN: Main Info */}
        <div className="lg:col-span-2 space-y-6">
          
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 md:p-8 shadow-sm border border-slate-200 dark:border-slate-700">
            <h2 className="text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider uppercase mb-4 flex items-center gap-2"><FileText size={16}/> Issue Description</h2>
            
            {/* ADDED break-all AND break-words HERE TO FIX THE LONG TEXT GLITCH */}
            <p className="text-slate-900 dark:text-slate-100 whitespace-pre-wrap break-words break-all leading-relaxed text-sm md:text-base">{ticket.description}</p>
            
            <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-700/50 grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-1">Department</span>
                <div className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                  <Building2 size={16} className="text-blue-500" /> {ticket.department}
                </div>
              </div>
              <div>
                <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-1">Location / Maps</span>
                <div className="flex flex-col gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                  <div className="flex items-start gap-2">
                    <MapPin size={16} className="text-red-500 mt-0.5 shrink-0" /> 
                    <span className="leading-snug">{ticket.location}</span>
                  </div>
                  <a 
                    href={`https://www.google.com/maps/search/?api=1&query=${mapQuery}`}
                    target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline bg-blue-50 dark:bg-blue-900/20 w-fit px-3 py-1.5 rounded-lg border border-blue-100 dark:border-blue-900/50 transition-colors"
                  >
                    <ExternalLink size={14} /> Open in Google Maps
                  </a>
                </div>
              </div>
            </div>
          </div>

          {ticket.report && !isApplicant && (
            <div className="bg-slate-900 dark:bg-slate-900/80 text-white rounded-2xl p-6 md:p-8 shadow-sm border border-slate-800 dark:border-slate-700">
              <div className="flex justify-between items-start mb-6">
                <h2 className="text-xs font-bold text-slate-400 tracking-wider uppercase flex items-center gap-2"><CheckCircle size={16}/> Site Inspection Report</h2>
                <div className="bg-blue-600/20 border border-blue-500/30 text-blue-300 px-3 py-1.5 rounded-lg flex items-center gap-1.5 font-mono text-sm font-bold">
                  <IndianRupee size={16}/> {parseFloat(ticket.report.estimated_amount).toLocaleString('en-IN')}
                </div>
              </div>
              <p className="text-slate-300 whitespace-pre-wrap text-sm leading-relaxed">{ticket.report.nature_of_work}</p>
            </div>
          )}

          {canApprove && !isApplicant && (
            <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-2xl p-6 md:p-8">
              <h2 className="text-xs font-bold text-blue-800 dark:text-blue-400 tracking-wider uppercase mb-4">Authority Action Required</h2>
              <textarea 
                value={actionRemarks} onChange={(e) => setActionRemarks(e.target.value)}
                placeholder="Enter remarks (Required for Return/Deny)..."
                className="w-full p-4 bg-white dark:bg-slate-800 border border-blue-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 mb-4 text-slate-900 dark:text-white" rows={3}
              />
              <div className="flex flex-col sm:flex-row gap-3">
                <button onClick={() => handleAction('APPROVE')} disabled={isProcessing} className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition disabled:opacity-50 text-sm">
                  {isProcessing ? <Loader2 className="animate-spin" size={18}/> : <CheckCircle size={18}/>} Approve
                </button>
                <button onClick={() => handleAction('RETURN')} disabled={isProcessing} className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition disabled:opacity-50 text-sm">
                  {isProcessing ? <Loader2 className="animate-spin" size={18}/> : <ArrowLeft size={18}/>} Return
                </button>
                {user?.role === 'DIRECTOR' && (
                  <button onClick={() => handleAction('DENY')} disabled={isProcessing} className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition disabled:opacity-50 text-sm">
                    {isProcessing ? <Loader2 className="animate-spin" size={18}/> : <XCircle size={18}/>} Reject
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-6">
          
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
            <h2 className="text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider uppercase mb-4 flex items-center gap-2"><User size={14}/> Applicant Details</h2>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-full flex items-center justify-center text-slate-600 dark:text-slate-300 font-bold shrink-0">
                {ticket.applicant_name.substring(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-slate-900 dark:text-white text-sm truncate">{ticket.applicant_name}</p>
                <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400">Initiator</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/50 p-3 rounded-xl border border-slate-100 dark:border-slate-700 truncate">
              <Mail size={14} className="text-slate-400 shrink-0" />
              <span className="truncate">{ticket.applicant_email || 'No email registered'}</span>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
            <h2 className="text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider uppercase mb-4 flex items-center gap-2"><ImageIcon size={14}/> Site Evidence</h2>
            {ticket.attachments && ticket.attachments.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
                {ticket.attachments.map((file: any, i: number) => (
                <a 
                    key={i} 
                    href={toUploadUrl(file.file_url)} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="block relative aspect-square rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 hover:opacity-80 transition-opacity bg-slate-50 dark:bg-slate-900 group shadow-sm"
                >
                    <img 
                    src={toUploadUrl(file.file_url)} 
                    alt="Site Evidence" 
                    className="w-full h-full object-cover" 
                    />
                    <div className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/30 transition-colors flex items-center justify-center">
                    <ExternalLink size={20} className="text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-md" />
                    </div>
                </a>
                ))}
            </div>
            ) : (
            <div className="text-sm font-medium text-slate-400 text-center py-6 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
                No photos attached to this ticket.
            </div>
            )}
          </div>

          {ticket.audit_logs && ticket.audit_logs.length > 0 && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
              <h2 className="text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider uppercase mb-4 flex items-center gap-2"><History size={14}/> Internal Remarks</h2>
              <div className="space-y-4">
                {ticket.audit_logs.map((log: any, i: number) => (
                  <div key={i} className="relative pl-4 border-l-2 border-slate-200 dark:border-slate-700 pb-4 last:pb-0 last:border-transparent">
                    <div className="absolute w-2.5 h-2.5 bg-blue-500 rounded-full -left-[5.5px] top-1 border-2 border-white dark:border-slate-800"></div>
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-xs font-bold text-slate-900 dark:text-white">{log.actor_role}</span>
                      <span className="text-[10px] text-slate-400 font-medium">{format(new Date(log.created_at), 'MMM dd, HH:mm')}</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/50 p-3 rounded-xl mt-2 border border-slate-100 dark:border-slate-700 shadow-sm leading-relaxed">
                      <span className="font-semibold text-slate-900 dark:text-white block mb-0.5">{log.action}</span>
                      {log.remarks || 'No remarks provided.'}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}