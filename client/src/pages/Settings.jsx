import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Mail, Building2, Send, ScrollText, ClipboardList, AlertTriangle } from 'lucide-react';

// The accounts list is stored as an array but edited as one comma-separated
// line; the API accepts either and hands back the normalised array on save.
const emailListText = (v) => (Array.isArray(v) ? v.join(', ') : v || '');
const emailListCount = (v) => emailListText(v).split(',').filter((e) => e.trim()).length;

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    api.get('/settings')
      .then((res) => setSettings(res.data.data))
      .catch((err) => toast.error(apiError(err)))
      .finally(() => setLoading(false));
  }, []);

  const setEmail = (key, value) => setSettings((s) => ({ ...s, email: { ...s.email, [key]: value } }));
  const setCompany = (key, value) => setSettings((s) => ({ ...s, company: { ...s.company, [key]: value } }));
  const setKit = (key, value) => setSettings((s) => ({ ...s, kit: { ...s.kit, [key]: value } }));
  const setSalesOrder = (key, value) => setSettings((s) => ({ ...s, salesOrder: { ...s.salesOrder, [key]: value } }));

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put('/settings', {
        email: { ...settings.email, port: Number(settings.email.port) || 587 },
        company: settings.company,
        kit: settings.kit,
        salesOrder: {
          ...settings.salesOrder,
          accountsEmails: emailListText(settings.salesOrder?.accountsEmails),
          emailAccountsOnConfirm: settings.salesOrder?.emailAccountsOnConfirm ?? false,
        },
      });
      setSettings(data.data);
      toast.success('Settings saved');
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const { data } = await api.post('/settings/test-email');
      toast.success(data.message);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading settings…
      </div>
    );
  }
  if (!settings) return null;

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" description="System-wide configuration" />

      <Tabs defaultValue="email">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="email"><Mail className="h-4 w-4 mr-1.5" /> Email</TabsTrigger>
          <TabsTrigger value="company"><Building2 className="h-4 w-4 mr-1.5" /> Company</TabsTrigger>
          <TabsTrigger value="salesOrder"><ClipboardList className="h-4 w-4 mr-1.5" /> Sales Orders</TabsTrigger>
          <TabsTrigger value="kit"><ScrollText className="h-4 w-4 mr-1.5" /> Kit Defaults</TabsTrigger>
        </TabsList>

        <TabsContent value="email">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">SMTP Configuration</CardTitle>
              <CardDescription>
                Used to email generated sales kits (ZIP attached) to clients, presented as the assigned exec.
                For Gmail, use an App Password.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <input id="emailEnabled" type="checkbox" className="h-4 w-4 accent-primary"
                  checked={settings.email?.enabled ?? true} onChange={(e) => setEmail('enabled', e.target.checked)} />
                <Label htmlFor="emailEnabled">Enable email sending</Label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>SMTP host</Label>
                  <Input placeholder="smtp.gmail.com" value={settings.email?.host || ''} onChange={(e) => setEmail('host', e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Port</Label>
                    <Input type="number" value={settings.email?.port ?? 587} onChange={(e) => setEmail('port', e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Secure (TLS)</Label>
                    <div className="h-10 flex items-center">
                      <input type="checkbox" className="h-4 w-4 accent-primary"
                        checked={settings.email?.secure || false} onChange={(e) => setEmail('secure', e.target.checked)} />
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>SMTP user</Label>
                  <Input placeholder="sales@mickys.com" value={settings.email?.user || ''} onChange={(e) => setEmail('user', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>SMTP password</Label>
                  <Input type="password" value={settings.email?.pass || ''} onChange={(e) => setEmail('pass', e.target.value)} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>From address</Label>
                  <Input placeholder='"Micky&apos;s Sales" <no-reply@mickys.com>' value={settings.email?.from || ''} onChange={(e) => setEmail('from', e.target.value)} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Kit inbox (BCC'd on every kit email)</Label>
                  <Input type="email" placeholder="sales@mickys.com" value={settings.email?.kitInbox || ''} onChange={(e) => setEmail('kitInbox', e.target.value)} />
                  <p className="text-xs text-muted-foreground">A copy of every kit emailed to a client is BCC'd here for your records.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</Button>
                <Button variant="outline" onClick={sendTest} disabled={testing}>
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send test email
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="company">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Company Details</CardTitle>
              <CardDescription>Shown on the header of generated kit PDFs.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>Company name</Label><Input value={settings.company?.name || ''} onChange={(e) => setCompany('name', e.target.value)} /></div>
                <div className="space-y-2"><Label>GST number</Label><Input value={settings.company?.gstNumber || ''} onChange={(e) => setCompany('gstNumber', e.target.value)} /></div>
                <div className="space-y-2"><Label>Phone</Label><Input value={settings.company?.phone || ''} onChange={(e) => setCompany('phone', e.target.value)} /></div>
                <div className="space-y-2"><Label>Email</Label><Input value={settings.company?.email || ''} onChange={(e) => setCompany('email', e.target.value)} /></div>
                <div className="space-y-2 sm:col-span-2"><Label>Address</Label><Input value={settings.company?.address || ''} onChange={(e) => setCompany('address', e.target.value)} /></div>
              </div>
              <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="salesOrder">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sales Orders</CardTitle>
              <CardDescription>
                Accounts can be sent the order PDF automatically the moment an exec confirms it, so invoicing never waits
                on someone remembering to forward it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Accounts email addresses</Label>
                <Input
                  placeholder="accounts@mickys.in, billing@mickys.in"
                  value={emailListText(settings.salesOrder?.accountsEmails)}
                  onChange={(e) => setSalesOrder('accountsEmails', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Separate multiple addresses with commas. Every one of them receives the confirmed order PDF.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <input id="emailAccountsOnConfirm" type="checkbox" className="h-4 w-4 accent-primary"
                  checked={settings.salesOrder?.emailAccountsOnConfirm || false}
                  onChange={(e) => setSalesOrder('emailAccountsOnConfirm', e.target.checked)} />
                <Label htmlFor="emailAccountsOnConfirm">Email accounts when an order is confirmed</Label>
              </div>
              {settings.salesOrder?.emailAccountsOnConfirm && emailListCount(settings.salesOrder?.accountsEmails) === 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>
                    This toggle does nothing until you add at least one accounts email address above — confirmed orders
                    will not be mailed anywhere.
                  </span>
                </div>
              )}
              <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="kit">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Kit Defaults</CardTitle>
              <CardDescription>Default commercial terms merged into term sheets and quotations (execs can override per lead).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Default payment terms</Label>
                <Textarea rows={2} value={settings.kit?.defaultPaymentTerms || ''} onChange={(e) => setKit('defaultPaymentTerms', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Default credit period</Label>
                <Input value={settings.kit?.defaultCreditPeriod || ''} onChange={(e) => setKit('defaultCreditPeriod', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Terms &amp; Conditions</Label>
                <Textarea rows={5} value={settings.kit?.termsAndConditions || ''} onChange={(e) => setKit('termsAndConditions', e.target.value)} />
              </div>
              <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
