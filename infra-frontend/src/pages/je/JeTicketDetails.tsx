import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import {
  Loader2, ArrowLeft, MapPin, User, Building2,
  CheckCircle, XCircle, FileText, IndianRupee,
  ExternalLink, Mail, Phone, Image as ImageIcon,
  AlertTriangle, UploadCloud, FileSpreadsheet,
  CheckCircle2, X, ClipboardCheck
} from 'lucide-react';
import { api } from '../../services/api';

interface Attachment {
  id?: number;
  file_url: string;
  uploaded_by: number;
  created_at: string;
  document_category?: string;
}

interface Report {
  id: number;
  nature_of_work: string;
  estimated_amount: number | string;
  created_at: string;
}

interface TicketData {
  id: number;
  applicant_id: number;
  applicant_name: string;
  applicant_email?: string;
  applicant_phone?: string;
  assigned_je_id?: number;
  department: string;
  title?: string;
  type: 'recurring' | 'non-recurring';
  description: string;
  location: string;
  status: string;
  created_at: string;
  report?: Report | null;
  attachments?: Attachment[];
}

export default function JeTicketDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Inspection Report Form State
  const [natureOfWork, setNatureOfWork] = useState('');
  const [estimatedAmount, setEstimatedAmount] = useState('');
  const [remarks, setRemarks] = useState('');
  const [sitePhotos, setSitePhotos] = useState<File[]>([]);
  const [sitePhotoPreviews, setSitePhotoPreviews] = useState<string[]>([]);
  const [estimateDocs, setEstimateDocs] = useState<File[]>([]);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState('');

  const fetchDetails = async () => {
    try {
      const response = await api.get(`/tickets/${id}/details`);
      const t: TicketData = response.data.ticket;
      setTicket(t);

      // Pre-fill form if existing report was returned
      if (t.report && t.status === 'RETURNED_TO_JE') {
        setNatureOfWork(t.report.nature_of_work || '');
        setEstimatedAmount(String(t.report.estimated_amount || ''));
      }
    } catch (err: any) {
      console.error('Error fetching ticket details:', err);
      setError(err.response?.data?.message || 'Failed to load ticket details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetails();
  }, [id]);

  useEffect(() => {
    return () => {
      sitePhotoPreviews.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [sitePhotoPreviews]);

  const handleSitePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const incoming = Array.from(e.target.files).slice(0, 8);
      setSitePhotos((prev) => [...prev, ...incoming].slice(0, 8));
      const urls = incoming.map((file) => URL.createObjectURL(file));
      setSitePhotoPreviews((prev) => [...prev, ...urls].slice(0, 8));
    }
  };

  const removeSitePhoto = (index: number) => {
    setSitePhotos((prev) => prev.filter((_, i) => i !== index));
    setSitePhotoPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleEstimateDocsSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const incoming = Array.from(e.target.files).slice(0, 5);
      setEstimateDocs((prev) => [...prev, ...incoming].slice(0, 5));
    }
  };

  const removeEstimateDoc = (index: number) => {
    setEstimateDocs((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!natureOfWork.trim()) {
      return alert('Please specify the Nature of Work / Inspection findings.');
    }
    const numericAmount = parseFloat(estimatedAmount);
    if (!numericAmount || numericAmount <= 0) {
      return alert('Please enter a valid estimated amount greater than 0.');
    }

    setIsSubmittingReport(true);
    setSubmitSuccess('');

    const formData = new FormData();
    formData.append('nature_of_work', natureOfWork.trim());
    formData.append('estimated_amount', numericAmount.toString());
    if (remarks.trim()) {
      formData.append('remarks', remarks.trim());
    }

    sitePhotos.forEach((file) => formData.append('site_photos', file));
    estimateDocs.forEach((file) => formData.append('estimate_docs', file));

    try {
      const response = await api.post(`/tickets/${id}/report`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      if (response.data.success) {
        setSubmitSuccess(response.data.message || 'Report filed successfully and escalated to AE.');
        await fetchDetails();
      }
    } catch (err: any) {
      console.error('Report submission failed:', err);
      alert(err.response?.data?.message || 'Failed to submit inspection report.');
    } finally {
      setIsSubmittingReport(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-blue-600 dark:text-blue-400">
        <Loader2 className="animate-spin" size={40} />
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 p-6 rounded-2xl border border-rose-200 dark:border-rose-900/50 max-w-2xl mx-auto mt-10 font-medium text-center">
        {error || 'Ticket not found'}
      </div>
    );
  }

  // Google Maps coordinate extraction
  let mapQuery = encodeURIComponent(ticket.location);
  const coordsMatch = ticket.location.match(/Lat:\s*([0-9.-]+),\s*Lng:\s*([0-9.-]+)/);
  if (coordsMatch) {
    mapQuery = `${coordsMatch[1]},${coordsMatch[2]}`;
  }

  const apiBaseUrl = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
  const uploadBaseUrl = apiBaseUrl.endsWith('/api') ? apiBaseUrl.slice(0, -4) : apiBaseUrl;
  const toUploadUrl = (fileUrl: string) => {
    if (!fileUrl) return fileUrl;
    if (/^https?:\/\//i.test(fileUrl)) return fileUrl;
    const normalized = fileUrl.startsWith('/') ? fileUrl : `/${fileUrl}`;
    return normalized.startsWith('/uploads/') ? `${uploadBaseUrl}${normalized}` : normalized;
  };

  const isInspectingStage =
    ticket.status === 'ASSIGNED_TO_JE' || ticket.status === 'RETURNED_TO_JE';

  const isReturned = ticket.status === 'RETURNED_TO_JE';

  // Categorize attachments
  const applicantAttachments = (ticket.attachments || []).filter(
    (a) => !a.document_category || a.document_category === 'APPLICANT_EVIDENCE'
  );
  const jePhotos = (ticket.attachments || []).filter(
    (a) => a.document_category === 'JE_SITE_PHOTO'
  );
  const jeEstimateDocs = (ticket.attachments || []).filter(
    (a) => a.document_category === 'JE_ESTIMATE_DOC'
  );

  // Progressive Stage Ladder (JE Visibility View - No internal remarks shown)
  const allStages = [
    { key: 'ASSIGNED_TO_JE', label: 'JE Inspection' },
    { key: 'PENDING_AE_APPROVAL', label: 'AE Review' },
    { key: 'PENDING_SE_APPROVAL', label: 'SE Sanction' },
    { key: 'PENDING_DEAN_APPROVAL', label: 'Dean Sanction' },
    { key: 'PENDING_DIRECTOR_APPROVAL', label: 'Director Sanction' },
    { key: 'APPROVED_FOR_TENDERING', label: 'Sanctioned / Tendering' },
  ];

  const currentStageIndex = allStages.findIndex((s) => s.key === ticket.status);

  return (
    <div className="max-w-5xl mx-auto w-full space-y-6 animate-in fade-in duration-300 pb-16">
      {/* Top Navigation Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white/80 dark:bg-slate-800/80 backdrop-blur-md p-5 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-700/80">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/je/dashboard')}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors text-slate-600 dark:text-slate-300"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white font-mono">
                #TKT-{ticket.id.toString().padStart(4, '0')}
              </h1>
              {ticket.title && (
                <span className="text-base md:text-lg font-bold text-slate-800 dark:text-slate-200">
                  · {ticket.title}
                </span>
              )}
              <span
                className={`text-[10px] uppercase font-bold px-2.5 py-1 rounded-full ${
                  isReturned
                    ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                    : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20'
                }`}
              >
                {ticket.status.replace(/_/g, ' ')}
              </span>
              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-md bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
                {ticket.type}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Reported on {format(new Date(ticket.created_at), 'PPP')} · {ticket.department} Department
            </p>
          </div>
        </div>

        {(ticket.status === 'APPROVED_FOR_TENDERING' ||
          ticket.status === 'TENDER_PUBLISHED' ||
          ticket.status === 'WORK_IN_PROGRESS' ||
          ticket.status === 'CLOSED') && (
          <button
            onClick={() => navigate(`/je/tender/${ticket.id}`)}
            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs md:text-sm flex items-center gap-2 shadow-sm transition self-start sm:self-center"
          >
            <FileSpreadsheet size={16} />
            Tender Milestones Control
          </button>
        )}
      </div>

      {/* Returned Warning Alert */}
      {isReturned && (
        <div className="p-5 rounded-2xl bg-rose-50/90 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 flex items-start gap-3.5 text-rose-900 dark:text-rose-200 shadow-sm animate-pulse">
          <AlertTriangle size={22} className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-bold text-sm">Ticket Returned for Technical Revision</h3>
            <p className="text-xs mt-1 text-rose-800 dark:text-rose-300 leading-relaxed">
              Higher authorities have returned this ticket back to your desk for revision. Please re-assess the site conditions, revise the financial estimate or work scope as needed, and resubmit the inspection report below.
            </p>
          </div>
        </div>
      )}

      {/* Hierarchical Progress Tracker (Hides internal authority remarks) */}
      <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-md rounded-2xl p-6 shadow-sm border border-slate-200/80 dark:border-slate-700/80 overflow-x-auto">
        <h2 className="text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider uppercase mb-6">
          Hierarchical Escalation Ladder
        </h2>
        <div className="flex items-center min-w-[650px] px-2 pb-4">
          {allStages.map((stage, index) => {
            const isCompleted = currentStageIndex > index || ticket.status === 'CLOSED';
            const isActive = currentStageIndex === index;

            return (
              <React.Fragment key={stage.key}>
                <div className="flex flex-col items-center relative">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center border-2 z-10 shrink-0 transition-colors ${
                      isActive
                        ? isReturned
                          ? 'bg-rose-600 border-rose-600 text-white shadow-lg'
                          : 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-500/30'
                        : isCompleted
                        ? 'bg-emerald-500 border-emerald-500 text-white'
                        : 'bg-slate-50 dark:bg-slate-900 border-dashed border-slate-300 dark:border-slate-600 text-slate-400'
                    }`}
                  >
                    {isCompleted ? (
                      <CheckCircle size={16} />
                    ) : isReturned && isActive ? (
                      <XCircle size={16} />
                    ) : (
                      <span className="text-xs font-bold">{index + 1}</span>
                    )}
                  </div>
                  <span
                    className={`text-[10px] font-bold uppercase absolute top-10 w-24 text-center transition-colors ${
                      isActive
                        ? isReturned
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-blue-600 dark:text-blue-400'
                        : isCompleted
                        ? 'text-slate-700 dark:text-slate-300'
                        : 'text-slate-400 dark:text-slate-500 opacity-60'
                    }`}
                  >
                    {stage.label}
                  </span>
                </div>

                {index < allStages.length - 1 && (
                  <div
                    className={`flex-1 h-1 mx-2 rounded transition-colors ${
                      isCompleted
                        ? 'bg-emerald-500'
                        : isActive
                        ? 'bg-gradient-to-r from-blue-500 to-slate-200 dark:to-slate-700'
                        : 'bg-slate-200 dark:bg-slate-700'
                    }`}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT 2 COLS: Request Details & Inspection Form */}
        <div className="lg:col-span-2 space-y-6">
          {/* Read-Only Applicant Request Card */}
          <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-md rounded-2xl p-6 shadow-sm border border-slate-200/80 dark:border-slate-700/80 space-y-4">
            <h2 className="text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider uppercase flex items-center gap-2">
              <FileText size={15} /> Applicant Work Request
            </h2>

            <p className="text-slate-900 dark:text-slate-100 whitespace-pre-wrap break-words break-all leading-relaxed text-sm md:text-base font-normal">
              {ticket.description}
            </p>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-700/60 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <span className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                  Department
                </span>
                <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-200">
                  <Building2 size={16} className="text-blue-500" />
                  {ticket.department}
                </div>
              </div>

              <div>
                <span className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                  Field Location / Landmark
                </span>
                <div className="flex items-start gap-1.5 text-sm font-medium text-slate-800 dark:text-slate-200">
                  <MapPin size={16} className="text-rose-500 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <span className="leading-snug">{ticket.location}</span>
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${mapQuery}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1 font-semibold"
                    >
                      <ExternalLink size={13} /> Open in Google Maps
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Existing Filed Report Card (If Report Submitted) */}
          {ticket.report && (
            <div className="bg-slate-900 dark:bg-slate-900/90 text-white rounded-2xl p-6 shadow-md border border-slate-800 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={18} className="text-emerald-400" />
                  <h2 className="text-xs font-bold tracking-wider uppercase text-slate-300">
                    Latest Filed Site Inspection Report
                  </h2>
                </div>
                <div className="px-3 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 font-mono font-bold text-sm flex items-center gap-1">
                  <IndianRupee size={15} />
                  {parseFloat(String(ticket.report.estimated_amount)).toLocaleString('en-IN')}
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  Nature of Work & Methodology
                </span>
                <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
                  {ticket.report.nature_of_work}
                </p>
              </div>

              {/* JE Site Photos & Docs Preview */}
              {(jePhotos.length > 0 || jeEstimateDocs.length > 0) && (
                <div className="pt-3 border-t border-slate-800 space-y-3">
                  {jePhotos.length > 0 && (
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-2">
                        Inspection Site Photos ({jePhotos.length})
                      </span>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {jePhotos.map((photo, i) => (
                          <a
                            key={i}
                            href={toUploadUrl(photo.file_url)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block aspect-square rounded-lg overflow-hidden border border-slate-700 hover:opacity-80 transition"
                          >
                            <img
                              src={toUploadUrl(photo.file_url)}
                              alt="JE Inspection"
                              className="w-full h-full object-cover"
                            />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {jeEstimateDocs.length > 0 && (
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-2">
                        Estimate Documents ({jeEstimateDocs.length})
                      </span>
                      <div className="space-y-1.5">
                        {jeEstimateDocs.map((doc, i) => (
                          <a
                            key={i}
                            href={toUploadUrl(doc.file_url)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 p-2 rounded-lg bg-slate-800/80 hover:bg-slate-800 text-xs text-blue-300 font-medium transition"
                          >
                            <FileSpreadsheet size={15} />
                            <span className="truncate flex-1">Estimate Document #{i + 1}</span>
                            <ExternalLink size={13} />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* INSPECTION REPORT FORM (Shown when ASSIGNED_TO_JE or RETURNED_TO_JE) */}
          {isInspectingStage && (
            <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-md rounded-2xl p-6 md:p-8 shadow-sm border border-slate-200/80 dark:border-slate-700/80 space-y-6">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <ClipboardCheck className="text-blue-600 dark:text-blue-400" size={22} />
                  {isReturned ? 'Submit Revised Inspection Report' : 'Digital Site Inspection & Financial Estimate'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Assess the physical site, compute the required budget, and attach inspection evidence for Assistant Engineer scrutiny.
                </p>
              </div>

              {submitSuccess && (
                <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-300 text-xs md:text-sm font-medium flex items-center gap-2">
                  <CheckCircle2 size={18} />
                  {submitSuccess}
                </div>
              )}

              <form onSubmit={handleSubmitReport} className="space-y-5">
                {/* Nature of Work */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-2 tracking-wider uppercase">
                    Nature of Work & Inspection Findings <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    rows={4}
                    required
                    value={natureOfWork}
                    onChange={(e) => setNatureOfWork(e.target.value)}
                    placeholder="Specify the exact engineering scope, materials needed, structural findings, or repair procedure..."
                    className="w-full border border-slate-200 dark:border-slate-700 rounded-xl p-3.5 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all resize-none bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  />
                </div>

                {/* Estimated Amount in INR */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-2 tracking-wider uppercase">
                    Financial Estimate Amount (INR) <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-base">
                      ₹
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="1"
                      required
                      value={estimatedAmount}
                      onChange={(e) => setEstimatedAmount(e.target.value)}
                      placeholder="e.g. 45000"
                      className="w-full pl-9 pr-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono font-bold focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400"
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Approval thresholds: AE passes to SE · SE sanctions up to ₹50,000 · Dean sanctions up to ₹5,00,000 · Director sanctions &gt; ₹5,00,000
                  </p>
                </div>

                {/* Remarks */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-2 tracking-wider uppercase">
                    Internal Inspection Remarks / Urgency Justification (Optional)
                  </label>
                  <textarea
                    rows={2}
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="Any observations regarding warranty, urgency, vendor availability..."
                    className="w-full border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all resize-none bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400"
                  />
                </div>

                {/* DUAL FILE UPLOADS: site_photos AND estimate_docs */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  {/* Upload 1: Site Photos */}
                  <div className="p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-900/30 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide flex items-center gap-1.5">
                        <ImageIcon size={15} /> Site Photos ({sitePhotos.length})
                      </span>
                      <label className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold cursor-pointer transition">
                        Select Photos
                        <input
                          type="file"
                          multiple
                          accept="image/*"
                          className="hidden"
                          onChange={handleSitePhotoSelect}
                        />
                      </label>
                    </div>

                    {sitePhotoPreviews.length === 0 ? (
                      <div className="py-4 text-center text-xs text-slate-400">
                        No inspection photos attached
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        {sitePhotoPreviews.map((url, index) => (
                          <div
                            key={index}
                            className="relative aspect-square rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 group"
                          >
                            <img src={url} alt="Site" className="w-full h-full object-cover" />
                            <button
                              type="button"
                              onClick={() => removeSitePhoto(index)}
                              className="absolute top-1 right-1 bg-slate-900/70 text-white p-0.5 rounded-full hover:bg-rose-600 transition"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Upload 2: Estimate Documents / Quotations */}
                  <div className="p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-900/30 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide flex items-center gap-1.5">
                        <UploadCloud size={15} /> Estimate Docs ({estimateDocs.length})
                      </span>
                      <label className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-[11px] font-bold cursor-pointer transition">
                        Select Docs
                        <input
                          type="file"
                          multiple
                          accept=".pdf,.doc,.docx,.xls,.xlsx"
                          className="hidden"
                          onChange={handleEstimateDocsSelect}
                        />
                      </label>
                    </div>

                    {estimateDocs.length === 0 ? (
                      <div className="py-4 text-center text-xs text-slate-400">
                        No estimate PDFs/sheets attached
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {estimateDocs.map((file, index) => (
                          <div
                            key={index}
                            className="flex items-center justify-between p-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                          >
                            <span className="truncate max-w-[140px] text-slate-700 dark:text-slate-300">
                              {file.name}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeEstimateDoc(index)}
                              className="text-slate-400 hover:text-rose-600 p-0.5"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Form Submit Button */}
                <button
                  type="submit"
                  disabled={isSubmittingReport}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-xl shadow-md transition flex items-center justify-center gap-2 text-sm disabled:opacity-60"
                >
                  {isSubmittingReport ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Submitting Report & Forwarding to AE...
                    </>
                  ) : (
                    <>
                      <ClipboardCheck size={18} />
                      {isReturned ? 'Submit Revised Report & Forward to AE' : 'Submit Inspection Report & Forward to AE'}
                    </>
                  )}
                </button>
              </form>
            </div>
          )}
        </div>

        {/* RIGHT COL: Applicant Information & Evidence Gallery */}
        <div className="space-y-6">
          {/* Applicant Info Card */}
          <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-md rounded-2xl p-5 shadow-sm border border-slate-200/80 dark:border-slate-700/80 space-y-3">
            <h2 className="text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider uppercase flex items-center gap-1.5">
              <User size={15} /> Initiator / Applicant
            </h2>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-full flex items-center justify-center font-bold text-sm">
                {ticket.applicant_name ? ticket.applicant_name.substring(0, 2).toUpperCase() : 'AP'}
              </div>
              <div className="min-w-0">
                <p className="font-bold text-slate-900 dark:text-white text-sm truncate">
                  {ticket.applicant_name}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Campus Applicant</p>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-700/60">
              {ticket.applicant_email && (
                <a
                  href={`mailto:${ticket.applicant_email}`}
                  className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 p-2 rounded-lg bg-slate-50 dark:bg-slate-900/40 truncate transition"
                >
                  <Mail size={14} className="text-slate-400 shrink-0" />
                  <span className="truncate">{ticket.applicant_email}</span>
                </a>
              )}
              {ticket.applicant_phone && (
                <a
                  href={`tel:${ticket.applicant_phone}`}
                  className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 p-2 rounded-lg bg-slate-50 dark:bg-slate-900/40 truncate transition"
                >
                  <Phone size={14} className="text-slate-400 shrink-0" />
                  <span>{ticket.applicant_phone}</span>
                </a>
              )}
            </div>
          </div>

          {/* Applicant Photos Card */}
          <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-md rounded-2xl p-5 shadow-sm border border-slate-200/80 dark:border-slate-700/80 space-y-3">
            <h2 className="text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider uppercase flex items-center gap-1.5">
              <ImageIcon size={15} /> Applicant Site Evidence
            </h2>

            {applicantAttachments.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {applicantAttachments.map((file, i) => (
                  <a
                    key={i}
                    href={toUploadUrl(file.file_url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block relative aspect-square rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 hover:opacity-80 transition group shadow-sm bg-slate-100 dark:bg-slate-900"
                  >
                    <img
                      src={toUploadUrl(file.file_url)}
                      alt="Site Evidence"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/30 transition-colors flex items-center justify-center">
                      <ExternalLink
                        size={18}
                        className="text-white opacity-0 group-hover:opacity-100 transition drop-shadow"
                      />
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-400 text-center py-6 bg-slate-50 dark:bg-slate-900/30 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
                No initial photos attached by applicant.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
