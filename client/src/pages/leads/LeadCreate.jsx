import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { BUSINESS_TYPES, ACTION_POINTS, LEAD_OPTIONAL_FIELDS } from '@/lib/constants';
import { formatBytes } from '@/lib/utils';
import PageHeader from '@/components/shared/PageHeader';
import FilePreviewDialog from '@/components/shared/FilePreviewDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ChevronDown, Loader2, UserPlus, Contact, MapPin, Tag,
  Paperclip, Upload, Eye, FileText, X, Image as ImageIcon,
} from 'lucide-react';

const schema = z.object({
  businessName: z.string().min(2, 'Business name is required'),
  contactPerson: z.string().min(2, 'Contact person is required'),
  designation: z.string().optional(),
  mobileNumber: z.string().min(6, 'Mobile number is required'),
  email: z.string().email('Enter a valid email').optional().or(z.literal('')),
  whatsappNumber: z.string().optional(),
  city: z.string().min(1, 'City is required'),
  state: z.string().optional(),
  address: z.string().optional(),
  gstin: z.string().optional(),
  businessType: z.enum(BUSINESS_TYPES, { errorMap: () => ({ message: 'Select a business type' }) }),
  assignedExecId: z.string().optional(),
  leadSource: z.string().optional(),
  leadDate: z.string().min(1, 'Lead date is required'),
  internalNotes: z.string().optional(),
  actionPoint: z.string().optional(),
  followUpDate: z.string().optional(),
  followUpNote: z.string().optional(),
});

const NO_ACTION = '__none__';

// Friendly names for the toast that lists which fields are blocking a save.
const FIELD_LABELS = {
  businessName: 'Business name',
  contactPerson: 'Contact person',
  mobileNumber: 'Mobile number',
  email: 'Email',
  city: 'City',
  businessType: 'Business type',
  leadDate: 'Lead date',
};

// Which form section each required field lives in, so a failed save can tell
// the user which section they missed.
const FIELD_SECTIONS = {
  businessName: 'Contact Details',
  contactPerson: 'Contact Details',
  mobileNumber: 'Contact Details',
  email: 'Contact Details',
  city: 'Business Info',
  businessType: 'Business Info',
  leadDate: 'CRM Metadata',
};

function Field({ label, required, error, children }) {
  return (
    <div className="space-y-2">
      <Label>{label}{required && ' *'}</Label>
      {children}
      {error && <p className="text-sm text-destructive">{error.message}</p>}
    </div>
  );
}

export default function LeadCreate() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [submitting, setSubmitting] = useState(false);
  const [companySuggestions, setCompanySuggestions] = useState([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [files, setFiles] = useState([]);
  const [attPreview, setAttPreview] = useState(null); // { url, name, type }
  const fileRef = useRef(null);

  const { register, control, handleSubmit, watch, setValue, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      businessName: '', contactPerson: '', designation: '', mobileNumber: '', email: '',
      whatsappNumber: '', city: '', state: '', address: '', gstin: '', businessType: '',
      assignedExecId: user._id, leadSource: '',
      leadDate: new Date().toISOString().slice(0, 10), internalNotes: '',
      actionPoint: '', followUpDate: '', followUpNote: '',
    },
  });
  const businessName = watch('businessName');

  useEffect(() => {
    const query = businessName?.trim();
    if (!query || query.length < 2) {
      setCompanySuggestions([]);
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get('/leads', { params: { search: query, limit: 8 } });
        if (cancelled) return;
        const matches = (data.data || [])
          .filter((lead) => lead.businessName?.toLowerCase().includes(query.toLowerCase()))
          .map((lead) => ({
            id: lead._id,
            businessName: lead.businessName,
            contactPerson: lead.contactPerson,
            city: lead.city,
            state: lead.state,
            address: lead.address,
            gstin: lead.gstin,
            businessType: lead.businessType,
          }));
        setCompanySuggestions(matches);
        setSuggestionsOpen(matches.length > 0);
      } catch {
        if (!cancelled) setCompanySuggestions([]);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [businessName]);

  const openExistingCompanies = async () => {
    const query = businessName?.trim();
    try {
      const { data } = await api.get('/leads', {
        params: query?.length >= 2 ? { search: query, limit: 8 } : { limit: 8 },
      });
      const matches = (data.data || [])
        .filter((lead) => !query || query.length < 2 || lead.businessName?.toLowerCase().includes(query.toLowerCase()))
        .map((lead) => ({
          id: lead._id,
          businessName: lead.businessName,
          contactPerson: lead.contactPerson,
          city: lead.city,
          state: lead.state,
        }));
      setCompanySuggestions(matches);
      setSuggestionsOpen(matches.length > 0);
      if (!matches.length) toast.info('No existing companies found');
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const selectCompany = (lead) => {
    setValue('businessName', lead.businessName, { shouldValidate: true });
    setSuggestionsOpen(false);
  };

  const onPickFiles = (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (picked.length) setFiles((prev) => [...prev, ...picked]);
  };

  const removeFile = (idx) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const previewLocal = (file) =>
    setAttPreview((cur) => {
      if (cur?.url) URL.revokeObjectURL(cur.url);
      return { url: URL.createObjectURL(file), name: file.name, type: file.type };
    });

  const closePreview = (open) => {
    if (open) return;
    setAttPreview((cur) => {
      if (cur?.url) URL.revokeObjectURL(cur.url);
      return null;
    });
  };

  // Validation failures leave the user with no feedback if the errored field is
  // scrolled off-screen (e.g. Save clicked from the bottom of the form), so
  // announce them with a toast. Scrolling to the field is handled by RHF's
  // shouldFocusError — a manual window scrollIntoView fights it and drags the
  // overflow-hidden app shell around.
  const onInvalid = (errs) => {
    const bySection = new Map();
    Object.keys(errs).forEach((key) => {
      const section = FIELD_SECTIONS[key] || 'the form';
      if (!bySection.has(section)) bySection.set(section, []);
      bySection.get(section).push(FIELD_LABELS[key] || key);
    });
    const sections = [...bySection.keys()];
    toast.error(
      sections.length === 1
        ? `You've missed the ${sections[0]} section`
        : `You've missed the ${sections.join(' and ')} sections`,
      {
        description:
          sections.length === 1
            ? bySection.get(sections[0]).join(', ')
            : [...bySection.entries()].map(([s, f]) => `${s}: ${f.join(', ')}`).join(' · '),
        duration: 8000,
      }
    );
  };

  const onSubmit = async (values) => {
    setSubmitting(true);
    try {
      // Leads are always owned by their creator.
      const payload = { ...values, assignedExecId: user._id };
      const { data } = await api.post('/leads', payload);
      const leadId = data.data._id;

      // Upload any selected attachments to the freshly created lead.
      if (files.length) {
        try {
          const form = new FormData();
          files.forEach((f) => form.append('files', f));
          await api.post(`/leads/${leadId}/attachments`, form);
        } catch (uploadErr) {
          toast.error(`Lead created, but file upload failed: ${apiError(uploadErr)}`);
        }
      }

      toast.success(`Lead ${data.data.refNumber} created`);

      const missing = LEAD_OPTIONAL_FIELDS
        .filter(([key]) => !String(values[key] ?? '').trim())
        .map(([, label]) => label);
      if (!values.followUpDate) missing.push('Follow-up date');
      if (missing.length) {
        toast.warning('Still left to fill in', {
          description: missing.join(', '),
          duration: 10000,
        });
      }

      navigate(`/leads/${leadId}`);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl">
      <PageHeader title="New Lead" description="Capture client details — you'll pick a kit and generate it next" />

      <form className="space-y-6" onSubmit={handleSubmit(onSubmit, onInvalid)}>
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Contact className="h-4 w-4" /> Contact Details</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Client / Business name" required error={errors.businessName}>
              <div className="relative">
                <div className="flex gap-2">
                  <Input
                    {...register('businessName')}
                    autoComplete="off"
                    className="flex-1"
                    onFocus={() => setSuggestionsOpen(companySuggestions.length > 0)}
                  />
                  <Button type="button" variant="outline" size="icon" onClick={openExistingCompanies} title="Show existing companies">
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </div>
                {suggestionsOpen && companySuggestions.length > 0 && (
                  <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg">
                    {companySuggestions.map((lead) => (
                      <button
                        key={lead.id}
                        type="button"
                        className="w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => selectCompany(lead)}
                      >
                        <span className="font-medium">{lead.businessName}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {[lead.city, lead.state].filter(Boolean).join(', ') || 'No branch location'}
                          {lead.contactPerson ? ` · ${lead.contactPerson}` : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Field>
            <Field label="Contact person" required error={errors.contactPerson}>
              <Input {...register('contactPerson')} />
            </Field>
            <Field label="Designation / Role" error={errors.designation}>
              <Input placeholder="e.g. Owner, Purchase Manager" {...register('designation')} />
            </Field>
            <Field label="Mobile number" required error={errors.mobileNumber}>
              <Input {...register('mobileNumber')} />
            </Field>
            <Field label="Email" error={errors.email}>
              <Input type="email" {...register('email')} />
            </Field>
            <Field label="WhatsApp number" error={errors.whatsappNumber}>
              <Input {...register('whatsappNumber')} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><MapPin className="h-4 w-4" /> Business Info</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="City" required error={errors.city}>
              <Input {...register('city')} />
            </Field>
            <Field label="State" error={errors.state}>
              <Input {...register('state')} />
            </Field>
            <Field label="Business type" required error={errors.businessType}>
              <Controller
                control={control}
                name="businessType"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    {/* field.ref lets RHF focus (and scroll to) this select on error */}
                    <SelectTrigger ref={field.ref}><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent>
                      {BUSINESS_TYPES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="GSTIN" error={errors.gstin}>
              <Input className="uppercase" {...register('gstin')} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Full address" error={errors.address}>
                <Textarea rows={2} {...register('address')} />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Tag className="h-4 w-4" /> CRM Metadata</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Assigned to">
              <Input value={user.name} disabled />
            </Field>
            <Field label="Lead source" error={errors.leadSource}>
              <Input placeholder="e.g. Field visit, Referral, Call" {...register('leadSource')} />
            </Field>
            <Field label="Lead date" required error={errors.leadDate}>
              <Input type="date" {...register('leadDate')} />
            </Field>
            <Field label="Action point" error={errors.actionPoint}>
              <Controller
                control={control}
                name="actionPoint"
                render={({ field }) => (
                  <Select
                    value={field.value || NO_ACTION}
                    onValueChange={(v) => field.onChange(v === NO_ACTION ? '' : v)}
                  >
                    <SelectTrigger><SelectValue placeholder="Select an action" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_ACTION}>No action</SelectItem>
                      {ACTION_POINTS.map((ap) => <SelectItem key={ap} value={ap}>{ap}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="Follow-up date" error={errors.followUpDate}>
              <Input type="date" {...register('followUpDate')} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Follow-up note" error={errors.followUpNote}>
                <Textarea rows={2} placeholder="Why are you following up? (optional)…" {...register('followUpNote')} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Internal notes" error={errors.internalNotes}>
                <Textarea rows={3} placeholder="Notes for your team (not shown to the client)…" {...register('internalNotes')} />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              A quotation reference number is generated automatically on save (format MKY-CITY-DDMMYY-###).
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between gap-2">
              <span className="flex items-center gap-2"><Paperclip className="h-4 w-4" /> Attachments</span>
              <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4" /> Add files
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <input ref={fileRef} type="file" multiple className="hidden" onChange={onPickFiles} />
            {files.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Optionally attach photos, PDFs or spreadsheets — they&rsquo;ll be uploaded with the lead.
              </p>
            ) : (
              <div className="rounded-lg border divide-y">
                {files.map((file, idx) => {
                  const isImage = (file.type || '').startsWith('image/');
                  return (
                    <div key={`${file.name}-${idx}`} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-2">
                        {isImage
                          ? <ImageIcon className="h-4 w-4 text-primary shrink-0" />
                          : <FileText className="h-4 w-4 text-primary shrink-0" />}
                        <div className="min-w-0">
                          <p className="text-sm truncate">{file.name}</p>
                          <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button type="button" variant="ghost" size="sm" onClick={() => previewLocal(file)}>
                          <Eye className="h-4 w-4" /> Preview
                        </Button>
                        <Button
                          type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                          title="Remove" onClick={() => removeFile(idx)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col-reverse sm:flex-row justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => navigate(-1)} disabled={submitting}>Cancel</Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Save lead & continue
          </Button>
        </div>
      </form>

      <FilePreviewDialog file={attPreview} onOpenChange={closePreview} />
    </div>
  );
}
