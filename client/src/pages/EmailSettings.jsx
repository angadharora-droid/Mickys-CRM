import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import PageHeader from '@/components/shared/PageHeader';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Mail, CheckCircle2, Unlink, ShieldCheck } from 'lucide-react';

// Mirrors the server-side presets (the server resolves these authoritatively —
// this list only drives the form UI).
const PROVIDERS = [
  { value: 'rediffmail', label: 'Rediffmail Pro', detail: 'smtp.rediffmailpro.com · port 465 · SSL' },
  { value: 'hostinger', label: 'Hostinger', detail: 'smtp.hostinger.com · port 465 · SSL' },
  { value: 'gmail', label: 'Gmail', detail: 'smtp.gmail.com · port 587 · STARTTLS' },
  { value: 'custom', label: 'Custom SMTP', detail: 'Enter your own host and port' },
];

export default function EmailSettings() {
  const [status, setStatus] = useState(null); // GET /email-settings payload
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [form, setForm] = useState({
    provider: 'rediffmail',
    email: '',
    password: '',
    host: '',
    port: '',
    secure: true,
  });

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const provider = PROVIDERS.find((p) => p.value === form.provider);
  const isCustom = form.provider === 'custom';

  useEffect(() => {
    api
      .get('/email-settings')
      .then(({ data }) => {
        setStatus(data.data);
        // Prefill the form from the existing link so "replace" edits are easy.
        if (data.data.linked) {
          setForm((f) => ({
            ...f,
            provider: data.data.provider || 'custom',
            email: data.data.email || '',
            host: data.data.provider === 'custom' ? data.data.host || '' : '',
            port: data.data.provider === 'custom' ? String(data.data.port || '') : '',
            secure: data.data.secure ?? true,
          }));
        }
      })
      .catch((err) => toast.error(apiError(err)))
      .finally(() => setLoading(false));
  }, []);

  const save = async (e) => {
    e.preventDefault();
    if (!form.email || !form.password) {
      toast.error('Enter your email address and mailbox password');
      return;
    }
    if (isCustom && (!form.host || !form.port)) {
      toast.error('Enter the SMTP host and port for your custom provider');
      return;
    }
    setSaving(true);
    try {
      const payload = { provider: form.provider, email: form.email, password: form.password };
      if (isCustom) {
        payload.host = form.host;
        payload.port = Number(form.port);
        payload.secure = form.secure;
      }
      const { data } = await api.put('/email-settings', payload);
      setStatus(data.data);
      setField('password', '');
      toast.success(data.message || 'Mailbox verified and linked');
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const unlink = async () => {
    setUnlinking(true);
    try {
      const { data } = await api.delete('/email-settings');
      setStatus(data.data);
      setUnlinkOpen(false);
      toast.success(data.message || 'Mailbox unlinked');
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setUnlinking(false);
    }
  };

  return (
    <div className="max-w-lg">
      <PageHeader
        title="Email Settings"
        description="Link your official mailbox so client emails go out from your own address"
      />

      {loading ? (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Current status */}
          <Card>
            <CardContent className="pt-6">
              {status?.linked ? (
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{status.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {status.host}:{status.port} · {status.secure ? 'SSL' : 'STARTTLS'}
                        {status.verifiedAt
                          ? ` · verified ${new Date(status.verifiedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
                          : ''}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Client emails you send go out from this mailbox, so replies land in your inbox.
                      </p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" className="shrink-0" onClick={() => setUnlinkOpen(true)}>
                    <Unlink className="h-4 w-4" /> Unlink
                  </Button>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <Mail className="h-5 w-5 shrink-0 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">No mailbox linked</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {status?.company?.configured
                        ? `Client emails you send currently go out from the company mailbox${status.company.email ? ` (${status.company.email})` : ''}. Link your official ID below so they come from you instead.`
                        : 'No company mailbox is configured either — link your official ID below to be able to email clients.'}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Link / replace form */}
          <Card>
            <CardContent className="pt-6">
              <form onSubmit={save} className="space-y-4">
                <div className="space-y-2">
                  <Label>Email provider</Label>
                  <Select value={form.provider} onValueChange={(val) => setField('provider', val)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select provider" />
                    </SelectTrigger>
                    <SelectContent>
                      {PROVIDERS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {provider && <p className="text-xs text-muted-foreground">{provider.detail}</p>}
                </div>

                {isCustom && (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-2 col-span-2">
                        <Label>SMTP host</Label>
                        <Input
                          placeholder="smtp.example.com"
                          value={form.host}
                          onChange={(e) => setField('host', e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Port</Label>
                        <Input
                          type="number"
                          placeholder="465"
                          value={form.port}
                          onChange={(e) => setField('port', e.target.value)}
                        />
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={form.secure} onCheckedChange={(val) => setField('secure', Boolean(val))} />
                      Use SSL (port 465). Leave off for STARTTLS ports like 587.
                    </label>
                  </>
                )}

                <div className="space-y-2">
                  <Label>Official email address</Label>
                  <Input
                    type="email"
                    autoComplete="email"
                    placeholder="you@mickys.in"
                    value={form.email}
                    onChange={(e) => setField('email', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Mailbox password</Label>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={form.password}
                    onChange={(e) => setField('password', e.target.value)}
                  />
                  {form.provider === 'gmail' && (
                    <p className="text-xs text-muted-foreground">
                      Gmail needs an App Password (Google Account → Security → App passwords), not your regular password.
                    </p>
                  )}
                </div>

                <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                  <p className="text-xs text-muted-foreground">
                    Your login is verified with the mail server before it&rsquo;s saved, and the password is
                    stored encrypted. It is never shown again anywhere in the app.
                  </p>
                </div>

                <Button type="submit" disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  {saving ? 'Verifying with mail server…' : status?.linked ? 'Verify & replace mailbox' : 'Verify & link mailbox'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={unlinkOpen}
        onOpenChange={setUnlinkOpen}
        title="Unlink your mailbox?"
        description={
          status?.company?.configured
            ? 'Client emails you send will go out from the shared company mailbox instead of your own address.'
            : 'No company mailbox is configured — you will not be able to email clients until a mailbox is linked again.'
        }
        confirmLabel="Unlink"
        loading={unlinking}
        onConfirm={unlink}
      />
    </div>
  );
}
