import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import {
  LEAD_STATUSES,
  STATUS_LABELS,
  KIT_TYPE_LABELS,
  KIT_DOCS,
  DEFAULT_KIT_TERMS,
  DEFAULT_DISTRIBUTOR_AGREEMENT_TERMS,
} from '@/lib/constants';
import { cn, formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Loader2, Package, Download, Mail, Trash2, RotateCcw, FileText, CheckCircle2,
  AlertTriangle, ArrowLeft, Boxes, Building2, Sparkles, Eye, Lock, Pencil,
} from 'lucide-react';

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
  const belowFloor = valid && net < r.floorPrice;
  const aboveMrp = valid && net > r.mrp;
  const deviation = valid && r.standardNetRate > 0 && net < r.standardNetRate
    ? ((r.standardNetRate - net) / r.standardNetRate) * 100
    : 0;
  const netInclGst = valid ? net * (1 + r.gst / 100) : 0;
  return { net, valid, belowFloor, aboveMrp, deviation, netInclGst, error: !valid || belowFloor || aboveMrp };
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
  const [emailForm, setEmailForm] = useState({ to: '', subject: '', message: '' });
  const [previewFile, setPreviewFile] = useState(null);

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
    setRates((lead.rates || []).map((r) => ({ ...r })));
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
  const anyError = rates.some((r) => deriveLine(r).error);
  const agreementRows = parseAgreementTerms(terms.agreementTermsAndConditions, lead.businessName);

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
        rates: rates.map((r) => ({ rateItemId: r.rateItemId, netRate: Number(r.netRate) })),
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

  const setRate = (idx, val) => setRates((rs) => rs.map((r, i) => (i === idx ? { ...r, netRate: val } : r)));
  const resetRate = (idx) => setRates((rs) => rs.map((r, i) => (i === idx ? { ...r, netRate: r.standardNetRate } : r)));
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
            <InfoRow label="City / State" value={`${lead.city}, ${lead.state}`} />
            <InfoRow label="GSTIN" value={lead.gstin} />
            <InfoRow label="Lead source" value={lead.leadSource} />
            <InfoRow label="Lead date" value={formatDate(lead.leadDate)} />
            <InfoRow label="Address" value={lead.address} />
          </dl>
          {lead.internalNotes && (
            <div className="mt-4 rounded-lg bg-muted/40 p-3 text-sm">
              <span className="font-medium">Internal notes: </span>{lead.internalNotes}
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
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rates.map((r, idx) => {
                        const d = deriveLine(r);
                        return (
                          <TableRow key={r.rateItemId || idx}>
                            <TableCell>
                              <p className="font-medium">{r.productName}</p>
                              <p className="text-xs text-muted-foreground">{r.packSize} {r.sku ? `· ${r.sku}` : ''}</p>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{formatCurrency(r.mrp)}</TableCell>
                            <TableCell className="text-right tabular-nums hidden sm:table-cell text-muted-foreground">{formatCurrency(r.standardNetRate)}</TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number" step="any" min="0"
                                value={r.netRate}
                                readOnly={locked}
                                onChange={(e) => setRate(idx, e.target.value)}
                                className={cn(
                                  'h-9 w-24 ml-auto text-right tabular-nums',
                                  locked && 'cursor-not-allowed bg-muted/50',
                                  d.error && 'border-destructive focus-visible:ring-destructive',
                                  !d.error && d.deviation > 0 && 'border-orange-400 text-orange-600'
                                )}
                              />
                              {d.belowFloor && <p className="text-[11px] text-destructive mt-1">Below floor {formatCurrency(r.floorPrice)}</p>}
                              {d.aboveMrp && <p className="text-[11px] text-destructive mt-1">Above MRP</p>}
                              {!d.error && d.deviation > 10 && (
                                <p className="text-[11px] text-orange-600 mt-1 flex items-center justify-end gap-1">
                                  <AlertTriangle className="h-3 w-3" /> {d.deviation.toFixed(1)}% off
                                </p>
                              )}
                            </TableCell>
                            {isDistributor && <TableCell className="text-right tabular-nums hidden md:table-cell">{r.suggestiveMargin || 0}%</TableCell>}
                            <TableCell className="text-right tabular-nums hidden md:table-cell text-muted-foreground">{r.gst}%</TableCell>
                            <TableCell className="text-right tabular-nums font-medium">{formatCurrency(d.netInclGst)}</TableCell>
                            <TableCell>
                              <Button
                                variant="ghost" size="icon" className="h-8 w-8"
                                title="Reset to standard"
                                disabled={locked || Number(r.netRate) === r.standardNetRate}
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
                  <p className="text-xs text-muted-foreground">Net rate must be between floor price and MRP. Deviations from standard show in orange.</p>
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
                  <Label>Subject (optional)</Label>
                  <Input
                    placeholder={`Micky's Sales Kit for ${lead.businessName} — Ref: ${lead.refNumber}`}
                    value={emailForm.subject}
                    onChange={(e) => setEmailForm((f) => ({ ...f, subject: e.target.value }))}
                  />
                </div>
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

      <Dialog open={Boolean(previewFile)} onOpenChange={closePreview}>
        <DialogContent className="max-w-5xl p-0">
          <DialogHeader className="px-5 pt-5">
            <DialogTitle className="truncate pr-8">{previewFile?.filename || 'PDF Preview'}</DialogTitle>
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
