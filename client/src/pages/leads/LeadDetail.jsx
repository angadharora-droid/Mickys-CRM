import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import {
  LEAD_STATUSES,
  STATUS_LABELS,
  KIT_TYPE_LABELS,
  KIT_DOCS,
  ACTION_POINTS,
  DEFAULT_KIT_TERMS,
  DEFAULT_DISTRIBUTOR_AGREEMENT_TERMS,
} from '@/lib/constants';
import { cn, formatCurrency, formatDate, formatDateTime, formatBytes } from '@/lib/utils';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import FilePreviewDialog from '@/components/shared/FilePreviewDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Loader2, Package, Download, Mail, Trash2, RotateCcw, FileText, CheckCircle2,
  AlertTriangle, ArrowLeft, Boxes, Building2, Sparkles, Eye, EyeOff, Lock, Pencil, ExternalLink,
  MessageSquare, CalendarClock, CalendarCheck, Paperclip, Upload, Image as ImageIcon,
} from 'lucide-react';

const NO_ACTION = '__none__';

const STEPS = ['Client Data', 'Kit Type', 'Rate Review', 'Generate', 'Deliver'];

const agreementTermsText = (businessName = '{distributor}') =>
  DEFAULT_DISTRIBUTOR_AGREEMENT_TERMS
    .map(([particular, term]) => `${particular} | ${term.replace('{distributor}', businessName)}`)
    .join('\n');

function parseAgreementTerms(text, businessName) {
  const fallback = DEFAULT_DISTRIBUTOR_AGREEMENT_TERMS.map(([particular, term]) => ({
    particular,
    term: term.replace('{distributor}', businessName),
  }));

  if (!text?.trim()) return fallback;

  return text.split('\n').map((line, index) => {
    const parts = line.split('|');
    if (parts.length >= 2) {
      return {
        particular: parts.shift().trim(),
        term: parts.join('|').trim(),
      };
    }
    return { particular: `Clause ${index + 1}`, term: line.trim() };
  }).filter((row) => row.particular || row.term);
}

const serializeAgreementRows = (rows) =>
  rows
    .map((row) => `${row.particular.trim()} | ${row.term.trim()}`)
    .filter((line) => line !== '|')
    .join('\n');

function deriveLine(r) {
  const net = Number(r.netRate);
  const valid = !Number.isNaN(net) && r.netRate !== '';
  const aboveMrp = valid && net > r.mrp;
  const deviation = valid && r.standardNetRate > 0 && net < r.standardNetRate
    ? ((r.standardNetRate - net) / r.standardNetRate) * 100
    : 0;
  const netInclGst = valid ? net * (1 + r.gst / 100) : 0;
  return { net, valid, aboveMrp, deviation, netInclGst, error: !valid || aboveMrp };
}

function Stepper({ status }) {
  const idx = LEAD_STATUSES.indexOf(status);
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {STEPS.map((label, i) => {
        const done = i <= idx;
        const active = i === idx + 1;
        return (
          <div key={label} className="flex items-center gap-1 shrink-0">
            <div className={cn(
              'flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium',
              done ? 'bg-primary text-primary-foreground' : active ? 'bg-gold/20 text-foreground ring-1 ring-gold' : 'bg-muted text-muted-foreground'
            )}>
              <span className={cn('flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold',
                done ? 'bg-primary-foreground/20' : 'bg-foreground/10')}>{i + 1}</span>
              {label}
            </div>
            {i < STEPS.length - 1 && <span className="text-muted-foreground">→</span>}
          </div>
        );
      })}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{value || '—'}</dd>
    </div>
  );
}

export default function LeadDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState('');
  const [step3Tab, setStep3Tab] = useState('rates');
  const [rates, setRates] = useState([]);
  const [terms, setTerms] = useState({
    paymentTerms: '',
    creditPeriod: '',
    termsAndConditions: '',
    agreementTermsAndConditions: '',
  });
  const [switching, setSwitching] = useState(false);
  const [confirmSwitch, setConfirmSwitch] = useState(null); // pending kitType
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [emailForm, setEmailForm] = useState({ to: '', cc: '', subject: '', message: '' });
  const [previewFile, setPreviewFile] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [editingNote, setEditingNote] = useState(false);
  const [followUpForm, setFollowUpForm] = useState({ actionPoint: '', date: '' });
  const [closingOpen, setClosingOpen] = useState(false);
  const [closeNote, setCloseNote] = useState('');
  const [attUploading, setAttUploading] = useState(false);
  const [attPreview, setAttPreview] = useState(null); // { url, name, type }
  const [confirmAttId, setConfirmAttId] = useState(null);
  const attInputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/leads/${id}`);
      setLead(data.data);
    } catch (err) {
      toast.error(apiError(err));
      navigate('/leads');
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => { load(); }, [load]);

  // Re-seed the editable rate table whenever the server copy changes.
  useEffect(() => {
    if (!lead) return;
    setRates((lead.rates || []).map((r) => ({ ...r, included: r.included !== false })));
    setTerms({
      paymentTerms: lead.customTerms?.paymentTerms || '',
      creditPeriod: lead.customTerms?.creditPeriod || '',
      // Pre-fill with the kit's standard T&C so they can be reviewed and edited.
      termsAndConditions:
        lead.customTerms?.termsAndConditions || (DEFAULT_KIT_TERMS[lead.kitType] || []).join('\n'),
      agreementTermsAndConditions:
        lead.customTerms?.agreementTermsAndConditions || agreementTermsText(lead.businessName),
    });
    setEmailForm((f) => ({ ...f, to: f.to || lead.email || '' }));
    setFollowUpForm({
      actionPoint: lead.followUp?.actionPoint || '',
      date: lead.followUp?.date ? new Date(lead.followUp.date).toISOString().slice(0, 10) : '',
    });
    const latestLegacyNote = [...(lead.notes || [])]
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0];
    setNoteDraft(latestLegacyNote?.text || lead.internalNotes || '');
    setSwitching(false);
  }, [lead?.updatedAt, lead?._id, lead?.kitType]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !lead) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading lead…
      </div>
    );
  }

  const isDistributor = lead.kitType === 'distributor';
  const hasKit = Boolean(lead.kitType);
  const statusIdx = LEAD_STATUSES.indexOf(lead.status);
  const ratesEdited = statusIdx >= LEAD_STATUSES.indexOf('rates_confirmed');
  // A generated kit freezes the lead until the user clicks Edit (unlock).
  const locked = Boolean(lead.locked);
  const editedAfterGen = Boolean(lead.editedAfterGeneration);
  const includedRates = rates.filter((r) => r.included !== false);
  const anyError = includedRates.length === 0 || includedRates.some((r) => deriveLine(r).error);
  const agreementRows = parseAgreementTerms(terms.agreementTermsAndConditions, lead.businessName);

  // Follow-up display state (date strings compared in YYYY-MM-DD form).
  const followUp = lead.followUp || {};
  const followUpOpen = followUp.status === 'open';
  const followUpClosed = followUp.status === 'closed';
  const todayStr = new Date().toISOString().slice(0, 10);
  const followUpDateStr = followUp.date ? new Date(followUp.date).toISOString().slice(0, 10) : '';
  const followUpOverdue = followUpOpen && followUpDateStr && followUpDateStr < todayStr;
  const followUpDueToday = followUpOpen && followUpDateStr === todayStr;

  // Internal note (single, editable) — latest legacy note or the new single field.
  const savedNote =
    [...(lead.notes || [])]
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0]
      ?.text || lead.internalNotes || '';

  const run = async (key, fn) => {
    setAction(key);
    try {
      const { data } = await fn();
      setLead(data.data);
      return data.data;
    } catch (err) {
      toast.error(apiError(err));
      throw err;
    } finally {
      setAction('');
    }
  };

  const selectKit = (kitType) =>
    run('kit', () => api.post(`/leads/${lead._id}/kit-type`, { kitType }))
      .then(() => toast.success(`${KIT_TYPE_LABELS[kitType]} selected`))
      .catch(() => {});

  const onPickKit = (kitType) => {
    if (kitType === lead.kitType && !switching) return;
    // Switching kit after rates/generation wipes the rate snapshot — confirm first.
    if (lead.kitType && lead.kitType !== kitType && ratesEdited) setConfirmSwitch(kitType);
    else selectKit(kitType);
  };

  const confirmRates = () =>
    run('rates', () =>
      api.put(`/leads/${lead._id}/rates`, {
        rates: rates.map((r) => ({
          rateItemId: r.rateItemId,
          netRate: Number(r.netRate),
          included: r.included !== false,
        })),
        customTerms: terms,
      })
    ).then(() => toast.success('Rates confirmed')).catch(() => {});

  const generate = () =>
    run('generate', () => api.post(`/leads/${lead._id}/generate`))
      .then(() => toast.success('Kit generated')).catch(() => {});

  const unlock = () =>
    run('unlock', () => api.post(`/leads/${lead._id}/unlock`))
      .then(() => toast.success('Lead unlocked — you can edit and regenerate')).catch(() => {});

  const sendEmail = () =>
    run('email', () => api.post(`/leads/${lead._id}/email`, emailForm))
      .then(() => toast.success('Kit emailed to client')).catch(() => {});

  const download = async (url, filename) => {
    try {
      const res = await api.get(url, { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const previewPdf = async (url, filename) => {
    try {
      const res = await api.get(url, { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(res.data);
      setPreviewFile((current) => {
        if (current?.url) URL.revokeObjectURL(current.url);
        return { url: blobUrl, filename };
      });
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const closePreview = (open) => {
    if (open) return;
    setPreviewFile((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });
  };

  const deleteLead = async () => {
    try {
      await api.delete(`/leads/${lead._id}`);
      toast.success('Lead deleted');
      navigate('/leads');
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  // ---- Internal notes ----
  const saveInternalNote = () =>
    run('note-add', () => api.post(`/leads/${lead._id}/notes`, { text: noteDraft.trim() }))
      .then(() => { setEditingNote(false); toast.success('Internal note saved'); })
      .catch(() => {});

  // ---- Follow-up ----
  const saveFollowUp = () =>
    run('followup', () =>
      api.put(`/leads/${lead._id}/follow-up`, {
        actionPoint: followUpForm.actionPoint,
        date: followUpForm.date,
      })
    ).then(() => toast.success(followUpForm.date ? 'Follow-up saved' : 'Follow-up cleared')).catch(() => {});

  const closeFollowUp = () =>
    run('followup-close', () =>
      api.post(`/leads/${lead._id}/follow-up/close`, { closingNote: closeNote.trim() })
    ).then(() => { setClosingOpen(false); setCloseNote(''); toast.success('Follow-up closed'); }).catch(() => {});

  // ---- Attachments ----
  const onPickAttachments = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // allow re-picking the same file later
    if (!files.length) return;
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    setAttUploading(true);
    try {
      const { data } = await api.post(`/leads/${lead._id}/attachments`, form);
      setLead(data.data);
      toast.success(`${files.length} file${files.length > 1 ? 's' : ''} uploaded`);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setAttUploading(false);
    }
  };

  const previewAttachment = async (att) => {
    try {
      const res = await api.get(`/leads/${lead._id}/attachments/${att._id}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      setAttPreview((cur) => {
        if (cur?.url) URL.revokeObjectURL(cur.url);
        return { url, name: att.fileName, type: att.contentType };
      });
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const closeAttPreview = (open) => {
    if (open) return;
    setAttPreview((cur) => {
      if (cur?.url) URL.revokeObjectURL(cur.url);
      return null;
    });
  };

  const deleteAttachment = (attId) =>
    run('att-del', () => api.delete(`/leads/${lead._id}/attachments/${attId}`))
      .then(() => { setConfirmAttId(null); toast.success('Attachment deleted'); })
      .catch(() => {});

  const setRate = (idx, val) => setRates((rs) => rs.map((r, i) => (i === idx ? { ...r, netRate: val } : r)));
  const resetRate = (idx) => setRates((rs) => rs.map((r, i) => (i === idx ? { ...r, netRate: r.standardNetRate } : r)));
  const toggleProduct = (idx) =>
    setRates((rs) => rs.map((r, i) => (i === idx ? { ...r, included: r.included === false } : r)));
  const setAgreementRow = (idx, key, value) => {
    setTerms((current) => {
      const rows = parseAgreementTerms(current.agreementTermsAndConditions, lead.businessName);
      rows[idx] = { ...rows[idx], [key]: value };
      return { ...current, agreementTermsAndConditions: serializeAgreementRows(rows) };
    });
  };

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader title={lead.businessName} description={`Ref ${lead.refNumber}`}>
        <Button variant="outline" onClick={() => navigate('/leads')}><ArrowLeft className="h-4 w-4" /> Back</Button>
        <Button variant="outline" className="text-destructive" onClick={() => setConfirmDelete(true)}>
          <Trash2 className="h-4 w-4" /> Delete
        </Button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={lead.status} />
        {hasKit && <Badge variant="outline">{KIT_TYPE_LABELS[lead.kitType]}</Badge>}
        <Badge variant="secondary">{lead.businessType}</Badge>
        {locked && (
          <Badge className="bg-slate-200 text-slate-700 hover:bg-slate-200">
            <Lock className="h-3 w-3" /> Locked
          </Badge>
        )}
        {editedAfterGen && (
          <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
            <AlertTriangle className="h-3 w-3" /> Edited after generation
          </Badge>
        )}
        <span className="text-sm text-muted-foreground">Exec: {lead.assignedExecId?.name || '—'}</span>
      </div>

      {/* Lock banner — kit is generated; editing is frozen until unlocked. */}
      {locked && (
        <Card className="border-amber-300 bg-amber-50/60">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                <Lock className="h-4 w-4" />
              </span>
              <div>
                <p className="font-semibold">Kit generated — this lead is locked</p>
                <p className="text-xs text-muted-foreground">
                  The generated documents below stay available to download and email.
                  Click <span className="font-medium">Edit</span> to change rates, terms or the kit and regenerate.
                </p>
              </div>
            </div>
            <Button onClick={unlock} disabled={action === 'unlock'}>
              {action === 'unlock' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
              Edit
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Out-of-sync warning once an unlocked lead has been edited post-generation. */}
      {!locked && editedAfterGen && (
        <Card className="border-amber-300 bg-amber-50/60">
          <CardContent className="flex items-center gap-3 py-3 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            <span>
              This lead has been edited since the last kit was generated. Regenerate to refresh the
              documents the client receives.
            </span>
          </CardContent>
        </Card>
      )}

      <Card><CardContent className="pt-5"><Stepper status={lead.status} /></CardContent></Card>

      {/* Client summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Client Details</span>
            {lead.status !== 'new' && <span className="text-xs font-normal text-muted-foreground">🔒 Locked (kit selected)</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-3">
            <InfoRow label="Contact" value={`${lead.contactPerson}${lead.designation ? `, ${lead.designation}` : ''}`} />
            <InfoRow label="Mobile" value={lead.mobileNumber} />
            <InfoRow label="Email" value={lead.email} />
            <InfoRow label="WhatsApp" value={lead.whatsappNumber} />
            <InfoRow label="City / State" value={[lead.city, lead.state].filter(Boolean).join(', ')} />
            <InfoRow label="GSTIN" value={lead.gstin} />
            <InfoRow label="Lead source" value={lead.leadSource} />
            <InfoRow label="Lead date" value={formatDate(lead.leadDate)} />
            <InfoRow label="Address" value={lead.address} />
          </dl>
        </CardContent>
      </Card>

      {/* Follow-up */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-muted-foreground" /> Follow-Up
            </span>
            {followUpOpen && (
              <span
                className={cn(
                  'text-xs font-medium rounded-full px-2.5 py-0.5 ring-1',
                  followUpOverdue
                    ? 'bg-destructive/10 text-destructive ring-destructive/30'
                    : followUpDueToday
                      ? 'bg-amber-50 text-amber-700 ring-amber-300/70 dark:bg-amber-950 dark:text-amber-300'
                      : 'bg-sky-50 text-sky-700 ring-sky-300/70 dark:bg-sky-950 dark:text-sky-300'
                )}
              >
                {followUpOverdue ? 'Overdue' : followUpDueToday ? 'Due today' : `Due ${formatDate(followUp.date)}`}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label>Action point</Label>
              <Select
                value={followUpForm.actionPoint || NO_ACTION}
                onValueChange={(v) =>
                  setFollowUpForm((f) => ({ ...f, actionPoint: v === NO_ACTION ? '' : v }))
                }
              >
                <SelectTrigger><SelectValue placeholder="Select an action" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ACTION}>No action</SelectItem>
                  {ACTION_POINTS.map((ap) => (
                    <SelectItem key={ap} value={ap}>{ap}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Follow-up date</Label>
              <Input
                type="date"
                className="w-full sm:w-44"
                value={followUpForm.date}
                onChange={(e) => setFollowUpForm((f) => ({ ...f, date: e.target.value }))}
              />
            </div>
            <Button onClick={saveFollowUp} disabled={action === 'followup'}>
              {action === 'followup' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Save
            </Button>
          </div>

          {followUpOpen && (
            <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
              <p className="text-sm">
                <span className="text-muted-foreground">Open follow-up: </span>
                <span className="font-medium">{followUp.actionPoint || 'Action'}</span>
                {' · due '}{formatDate(followUp.date)}
              </p>
              <Button size="sm" variant="outline" onClick={() => { setCloseNote(''); setClosingOpen(true); }}>
                <CalendarCheck className="h-4 w-4" /> Close
              </Button>
            </div>
          )}

          {followUpClosed && (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <p className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium">
                <CalendarCheck className="h-4 w-4" /> Last follow-up closed
              </p>
              {followUp.closingNote && <p className="mt-1 whitespace-pre-wrap break-words">{followUp.closingNote}</p>}
              <p className="mt-1 text-xs text-muted-foreground">
                {followUp.closedBy?.name || 'Unknown'} · {formatDateTime(followUp.closedAt)}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Internal notes */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-muted-foreground" /> Internal Notes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {editingNote ? (
            <div className="space-y-2">
              <Textarea
                rows={4}
                placeholder="Internal note (visible to your team, not the client)…"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setNoteDraft(savedNote); setEditingNote(false); }}
                  disabled={action === 'note-add'}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={saveInternalNote} disabled={!noteDraft.trim() || action === 'note-add'}>
                  {action === 'note-add' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Save note
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Saving replaces the existing internal note; it does not create another note.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {savedNote ? (
                <p className="text-sm whitespace-pre-wrap">{savedNote}</p>
              ) : (
                <p className="text-sm text-muted-foreground">No internal note yet.</p>
              )}
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setNoteDraft(savedNote); setEditingNote(true); }}
                >
                  <Pencil className="h-4 w-4" />
                  {savedNote ? 'Edit note' : 'Add note'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 2 — Kit type */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Step 2 · Kit Type</CardTitle></CardHeader>
        <CardContent>
          {hasKit && !switching ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {isDistributor ? <Boxes className="h-8 w-8 text-primary" /> : <Building2 className="h-8 w-8 text-primary" />}
                <div>
                  <p className="font-semibold">{KIT_TYPE_LABELS[lead.kitType]} selected</p>
                  <p className="text-xs text-muted-foreground">{(KIT_DOCS[lead.kitType] || []).length} documents · {lead.rates.length} rate lines</p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => setSwitching(true)} disabled={locked || action === 'kit'}>
                <RotateCcw className="h-4 w-4" /> Switch kit
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                { type: 'distributor', icon: Boxes },
                { type: 'institutional', icon: Building2 },
              ].map(({ type, icon: Icon }) => (
                <button
                  key={type}
                  type="button"
                  disabled={locked || action === 'kit'}
                  onClick={() => onPickKit(type)}
                  className={cn(
                    'text-left rounded-xl border-2 p-5 transition-all hover:shadow-lifted disabled:opacity-60',
                    lead.kitType === type ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                  )}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <Icon className="h-7 w-7 text-primary" />
                    <span className="font-semibold">{KIT_TYPE_LABELS[type]}</span>
                  </div>
                  <ul className="space-y-1.5">
                    {KIT_DOCS[type].map((d) => (
                      <li key={d} className="flex items-start gap-2 text-xs text-muted-foreground">
                        <FileText className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {d}
                      </li>
                    ))}
                  </ul>
                </button>
              ))}
              {switching && (
                <div className="sm:col-span-2">
                  <Button variant="ghost" size="sm" onClick={() => setSwitching(false)}>Cancel switch</Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 3 - Rate review */}
      {hasKit && (
        <Card>
          <Tabs value={step3Tab} onValueChange={setStep3Tab}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-base">Step 3</CardTitle>
                {isDistributor ? (
                  <TabsList>
                    <TabsTrigger value="rates">Rate Review</TabsTrigger>
                    <TabsTrigger value="agreement">Agreement Terms</TabsTrigger>
                  </TabsList>
                ) : (
                  <CardTitle className="text-base">Rate Review</CardTitle>
                )}
              </div>
            </CardHeader>

            <TabsContent value="rates" className="mt-0">
              <CardContent className="space-y-4">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">MRP</TableHead>
                        <TableHead className="text-right hidden sm:table-cell">Std net</TableHead>
                        <TableHead className="text-right">Net rate</TableHead>
                        {isDistributor && <TableHead className="text-right hidden md:table-cell">Margin</TableHead>}
                        <TableHead className="text-right hidden md:table-cell">GST</TableHead>
                        <TableHead className="text-right">Net+GST</TableHead>
                        <TableHead className="text-center">Include</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rates.map((r, idx) => {
                        const d = deriveLine(r);
                        return (
                          <TableRow key={r.rateItemId || idx}>
                            <TableCell className={cn(r.included === false && 'opacity-50')}>
                              <p className={cn('font-medium', r.included === false && 'line-through')}>{r.productName}</p>
                              <p className="text-xs text-muted-foreground">{r.packSize} {r.sku ? `· ${r.sku}` : ''}</p>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{formatCurrency(r.mrp)}</TableCell>
                            <TableCell className="text-right tabular-nums hidden sm:table-cell text-muted-foreground">{formatCurrency(r.standardNetRate)}</TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number" step="any" min="0"
                                value={r.netRate}
                                readOnly={locked || r.included === false}
                                onChange={(e) => setRate(idx, e.target.value)}
                                className={cn(
                                  'h-9 w-24 ml-auto text-right tabular-nums',
                                  (locked || r.included === false) && 'cursor-not-allowed bg-muted/50',
                                  r.included !== false && d.error && 'border-destructive focus-visible:ring-destructive',
                                  r.included !== false && !d.error && d.deviation > 0 && 'border-orange-400 text-orange-600'
                                )}
                              />
                              {r.included !== false && d.aboveMrp && <p className="text-[11px] text-destructive mt-1">Above MRP</p>}
                              {r.included !== false && !d.error && d.deviation > 10 && (
                                <p className="text-[11px] text-orange-600 mt-1 flex items-center justify-end gap-1">
                                  <AlertTriangle className="h-3 w-3" /> {d.deviation.toFixed(1)}% off
                                </p>
                              )}
                            </TableCell>
                            {isDistributor && <TableCell className="text-right tabular-nums hidden md:table-cell">{r.suggestiveMargin || 0}%</TableCell>}
                            <TableCell className="text-right tabular-nums hidden md:table-cell text-muted-foreground">{r.gst}%</TableCell>
                            <TableCell className="text-right tabular-nums font-medium">{formatCurrency(d.netInclGst)}</TableCell>
                            <TableCell className="text-center">
                              <Button
                                type="button"
                                variant={r.included === false ? 'outline' : 'ghost'}
                                size="sm"
                                disabled={locked}
                                title={r.included === false ? 'Include product in generated PDFs' : 'Exclude product from generated PDFs'}
                                onClick={() => toggleProduct(idx)}
                              >
                                {r.included === false ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                <span className="hidden xl:inline">{r.included === false ? 'Excluded' : 'Included'}</span>
                              </Button>
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost" size="icon" className="h-8 w-8"
                                title="Reset to standard"
                                disabled={locked || r.included === false || Number(r.netRate) === r.standardNetRate}
                                onClick={() => resetRate(idx)}
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Payment terms</Label>
                    <Textarea rows={2} disabled={locked} value={terms.paymentTerms} onChange={(e) => setTerms((t) => ({ ...t, paymentTerms: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Credit period</Label>
                    <Input disabled={locked} value={terms.creditPeriod} onChange={(e) => setTerms((t) => ({ ...t, creditPeriod: e.target.value }))} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>
                    Terms &amp; Conditions
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      one clause per line - printed on the {isDistributor ? 'price card' : 'quotation'}
                    </span>
                  </Label>
                  <Textarea
                    rows={8}
                    disabled={locked}
                    value={terms.termsAndConditions}
                    onChange={(e) => setTerms((t) => ({ ...t, termsAndConditions: e.target.value }))}
                  />
                  <div className="flex justify-end">
                    <Button
                      type="button" variant="ghost" size="sm" disabled={locked}
                      onClick={() => setTerms((t) => ({ ...t, termsAndConditions: (DEFAULT_KIT_TERMS[lead.kitType] || []).join('\n') }))}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Reset to standard terms
                    </Button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    {includedRates.length} of {rates.length} products included. Excluded products will not appear in generated PDFs.
                  </p>
                  <Button onClick={confirmRates} disabled={locked || anyError || action === 'rates'}>
                    {action === 'rates' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Confirm rates
                  </Button>
                </div>
              </CardContent>
            </TabsContent>

            {isDistributor && (
              <TabsContent value="agreement" className="mt-0">
                <CardContent className="space-y-4">
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-primary hover:bg-primary">
                          <TableHead className="w-12 text-primary-foreground">Sr.</TableHead>
                          <TableHead className="w-56 text-primary-foreground">Particulars</TableHead>
                          <TableHead className="min-w-[360px] text-primary-foreground">Terms &amp; Conditions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {agreementRows.map((row, idx) => (
                          <TableRow key={`${idx}-${row.particular}`} className="odd:bg-muted/30">
                            <TableCell className="align-top text-xs tabular-nums text-muted-foreground">{idx + 1}</TableCell>
                            <TableCell className="align-top">
                              <Input
                                value={row.particular}
                                readOnly={locked}
                                onChange={(e) => setAgreementRow(idx, 'particular', e.target.value)}
                                className="h-8 border-0 bg-transparent px-0 font-semibold shadow-none focus-visible:ring-0"
                              />
                            </TableCell>
                            <TableCell className="align-top">
                              <Textarea
                                rows={1}
                                readOnly={locked}
                                value={row.term}
                                onChange={(e) => setAgreementRow(idx, 'term', e.target.value)}
                                className="min-h-8 resize-y border-0 bg-transparent px-0 py-1 shadow-none focus-visible:ring-0"
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      type="button" variant="ghost" size="sm" disabled={locked}
                      onClick={() => setTerms((t) => ({ ...t, agreementTermsAndConditions: agreementTermsText(lead.businessName) }))}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Reset agreement terms
                    </Button>
                  </div>
                </CardContent>
              </TabsContent>
            )}
          </Tabs>
        </Card>
      )}
      {/* Step 4 — Generate */}
      {ratesEdited && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Step 4 · Generate Kit</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Builds {(KIT_DOCS[lead.kitType] || []).length} pre-filled PDFs and bundles them into a ZIP.
                {lead.generatedAt && <> Last generated {formatDateTime(lead.generatedAt)}.</>}
                {locked && <> Click <span className="font-medium">Edit</span> above to regenerate.</>}
              </p>
              {locked ? (
                <Button variant="outline" onClick={unlock} disabled={action === 'unlock'}>
                  {action === 'unlock' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
                  Edit to regenerate
                </Button>
              ) : (
                <Button onClick={generate} disabled={action === 'generate'}>
                  {action === 'generate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
                  {lead.generatedFiles?.length ? 'Regenerate kit' : 'Generate kit'}
                </Button>
              )}
            </div>

            {lead.generatedFiles?.length > 0 && (
              <div className="rounded-lg border divide-y">
                {lead.generatedFiles.map((f, i) => (
                  <div key={f.fileName} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-4 w-4 text-primary shrink-0" />
                      <span className="text-sm truncate">{f.label || f.docType}</span>
                      {f.static && <Badge variant="outline" className="text-[10px]">static</Badge>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => previewPdf(`/leads/${lead._id}/documents/${i}`, f.fileName)}>
                        <Eye className="h-4 w-4" /> Preview
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => download(`/leads/${lead._id}/documents/${i}`, f.fileName)}>
                        <Download className="h-4 w-4" /> PDF
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Manual attachments — photos, PDFs, spreadsheets */}
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium flex items-center gap-2"><Paperclip className="h-4 w-4" /> Attachments</p>
                <input ref={attInputRef} type="file" multiple className="hidden" onChange={onPickAttachments} />
                <Button size="sm" variant="outline" onClick={() => attInputRef.current?.click()} disabled={attUploading}>
                  {attUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Upload files
                </Button>
              </div>
              {(lead.attachments?.length || 0) === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No files yet. Upload photos, PDFs or spreadsheets to keep them with this lead.
                </p>
              ) : (
                <div className="rounded-lg border divide-y bg-card">
                  {lead.attachments.map((att) => {
                    const isImage = (att.contentType || '').startsWith('image/');
                    return (
                      <div key={att._id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                        <div className="flex min-w-0 items-center gap-2">
                          {isImage
                            ? <ImageIcon className="h-4 w-4 text-primary shrink-0" />
                            : <FileText className="h-4 w-4 text-primary shrink-0" />}
                          <div className="min-w-0">
                            <p className="text-sm truncate">{att.fileName}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatBytes(att.size)}
                              {att.uploadedBy?.name ? ` · ${att.uploadedBy.name}` : ''}
                              {att.createdAt ? ` · ${formatDate(att.createdAt)}` : ''}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button variant="ghost" size="sm" onClick={() => previewAttachment(att)}>
                            <Eye className="h-4 w-4" /> Preview
                          </Button>
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => download(`/leads/${lead._id}/attachments/${att._id}`, att.fileName)}
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                            title="Delete attachment" onClick={() => setConfirmAttId(att._id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 5 — Deliver */}
      {lead.generatedFiles?.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Step 5 · Deliver</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={() => download(`/leads/${lead._id}/kit.zip`, lead.zipFile?.fileName || 'kit.zip')}>
                <Download className="h-4 w-4" /> Download ZIP
              </Button>
              {lead.delivery?.sentAt && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  Emailed to {lead.delivery.sentTo} on {formatDateTime(lead.delivery.sentAt)}
                </span>
              )}
            </div>

            <div className="rounded-lg border p-4 space-y-3">
              <p className="text-sm font-medium flex items-center gap-2"><Mail className="h-4 w-4" /> Email the kit to the client</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>To</Label>
                  <Input type="email" value={emailForm.to} onChange={(e) => setEmailForm((f) => ({ ...f, to: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>CC (optional)</Label>
                  <Input
                    type="text"
                    placeholder="Comma-separate multiple emails"
                    value={emailForm.cc}
                    onChange={(e) => setEmailForm((f) => ({ ...f, cc: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Subject (optional)</Label>
                <Input
                  placeholder={`Micky's Sales Kit for ${lead.businessName} — Ref: ${lead.refNumber}`}
                  value={emailForm.subject}
                  onChange={(e) => setEmailForm((f) => ({ ...f, subject: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Message (optional — a default note is used if blank)</Label>
                <Textarea rows={3} value={emailForm.message} onChange={(e) => setEmailForm((f) => ({ ...f, message: e.target.value }))} />
              </div>
              <p className="text-xs text-muted-foreground">Sent from the system SMTP account with your name and reply-to. The ZIP is attached.</p>
              <Button onClick={sendEmail} disabled={action === 'email'}>
                {action === 'email' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Send kit email
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* History / audit */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4" /> Activity & Audit</CardTitle></CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Pipeline history</p>
            <ul className="space-y-3">
              {[...(lead.statusHistory || [])].reverse().map((h, i) => (
                <li key={i} className="flex items-start gap-3 text-sm">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />
                  <div>
                    <p>{STATUS_LABELS[h.to] || h.to}{h.note ? <span className="text-muted-foreground"> — {h.note}</span> : null}</p>
                    <p className="text-xs text-muted-foreground">
                      {h.changedBy?.name ? `${h.changedBy.name} · ` : ''}{formatDateTime(h.at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Rate overrides</p>
            {lead.rateEditLog?.length ? (
              <ul className="space-y-2">
                {lead.rateEditLog.map((e, i) => (
                  <li key={i} className="text-sm flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                    <span>{e.productName}: {formatCurrency(e.from)} → {formatCurrency(e.to)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No rate overrides — confirmed at standard rates.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={Boolean(confirmSwitch)}
        onOpenChange={(o) => !o && setConfirmSwitch(null)}
        title="Switch kit type?"
        description="Switching reloads the rate master and discards your current rate overrides for this lead. You'll need to confirm rates and regenerate."
        confirmLabel="Switch kit"
        variant="default"
        onConfirm={() => { const k = confirmSwitch; setConfirmSwitch(null); selectKit(k); }}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete lead ${lead.refNumber}?`}
        description="This permanently removes the lead and any generated kit files."
        confirmLabel="Delete lead"
        onConfirm={deleteLead}
      />

      <ConfirmDialog
        open={Boolean(confirmAttId)}
        onOpenChange={(o) => { if (!o) setConfirmAttId(null); }}
        title="Delete attachment?"
        description="This file will be permanently removed from the lead."
        confirmLabel="Delete file"
        loading={action === 'att-del'}
        onConfirm={() => deleteAttachment(confirmAttId)}
      />

      <FilePreviewDialog file={attPreview} onOpenChange={closeAttPreview} />

      <Dialog open={closingOpen} onOpenChange={(o) => { if (!o) setClosingOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Close follow-up</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="close-note">Closing note</Label>
            <Textarea
              id="close-note"
              rows={3}
              placeholder="What was the outcome of this follow-up?"
              value={closeNote}
              onChange={(e) => setCloseNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClosingOpen(false)} disabled={action === 'followup-close'}>
              Cancel
            </Button>
            <Button onClick={closeFollowUp} disabled={!closeNote.trim() || action === 'followup-close'}>
              {action === 'followup-close' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />}
              Close follow-up
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(previewFile)} onOpenChange={closePreview}>
        <DialogContent className="max-w-5xl p-0">
          <DialogHeader className="px-5 pt-5">
            <DialogTitle className="truncate pr-8">{previewFile?.filename || 'PDF Preview'}</DialogTitle>
            {previewFile?.url && (
              <a
                href={previewFile.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-fit items-center gap-1 text-xs text-primary hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Open in new tab
              </a>
            )}
          </DialogHeader>
          {previewFile?.url && (
            <iframe
              title={previewFile.filename}
              src={previewFile.url}
              className="h-[75vh] w-full rounded-b-2xl border-0"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
