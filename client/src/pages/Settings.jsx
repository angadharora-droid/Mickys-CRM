import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import TableSkeleton from '@/components/shared/TableSkeleton';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Mail, Building2, Send, ScrollText, Rss, Plus, Pencil, Trash2, RefreshCw, ExternalLink } from 'lucide-react';

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // ---------- Meta Ads lead sheets ----------
  const [metaSheets, setMetaSheets] = useState([]);
  const [sheetsLoading, setSheetsLoading] = useState(true);
  const [sheetDialogOpen, setSheetDialogOpen] = useState(false);
  const [editingSheet, setEditingSheet] = useState(null);
  const [sheetForm, setSheetForm] = useState({ label: '', url: '', enabled: true });
  const [savingSheet, setSavingSheet] = useState(false);
  const [deletingSheet, setDeletingSheet] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const fetchMetaSheets = useCallback(async () => {
    try {
      const { data } = await api.get('/settings/meta-sheets');
      setMetaSheets(data.data);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSheetsLoading(false);
    }
  }, []);

  useEffect(() => {
    api.get('/settings')
      .then((res) => setSettings(res.data.data))
      .catch((err) => toast.error(apiError(err)))
      .finally(() => setLoading(false));
    fetchMetaSheets();
  }, [fetchMetaSheets]);

  const openCreateSheet = () => {
    setEditingSheet(null);
    setSheetForm({ label: '', url: '', enabled: true });
    setSheetDialogOpen(true);
  };
  const openEditSheet = (s) => {
    setEditingSheet(s);
    setSheetForm({ label: s.label || '', url: s.url || '', enabled: s.enabled !== false });
    setSheetDialogOpen(true);
  };

  const saveSheet = async () => {
    if (!sheetForm.url.trim()) { toast.error('Paste the Google Sheet link'); return; }
    setSavingSheet(true);
    try {
      if (editingSheet) {
        const { data } = await api.put(`/settings/meta-sheets/${editingSheet._id}`, sheetForm);
        setMetaSheets((list) => list.map((s) => (s._id === editingSheet._id ? data.data : s)));
        toast.success('Sheet updated');
      } else {
        const { data } = await api.post('/settings/meta-sheets', sheetForm);
        setMetaSheets((list) => [...list, data.data]);
        toast.success('Sheet added — it will be picked up on the next sync');
      }
      setSheetDialogOpen(false);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSavingSheet(false);
    }
  };

  const deleteSheet = async () => {
    setSavingSheet(true);
    try {
      await api.delete(`/settings/meta-sheets/${deletingSheet._id}`);
      setMetaSheets((list) => list.filter((s) => s._id !== deletingSheet._id));
      toast.success('Sheet removed');
      setDeletingSheet(null);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSavingSheet(false);
    }
  };

  const toggleSheetEnabled = async (s) => {
    try {
      const { data } = await api.put(`/settings/meta-sheets/${s._id}`, { enabled: !s.enabled });
      setMetaSheets((list) => list.map((x) => (x._id === s._id ? data.data : x)));
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const syncSheetsNow = async () => {
    setSyncing(true);
    try {
      const { data } = await api.post('/settings/meta-sheets/sync-now');
      const sheetCount = data.data.bySource?.length ?? 0;
      toast.success(`${data.data.imported} new lead(s) imported from ${sheetCount} sheet${sheetCount === 1 ? '' : 's'}`);
      fetchMetaSheets();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSyncing(false);
    }
  };

  const setEmail = (key, value) => setSettings((s) => ({ ...s, email: { ...s.email, [key]: value } }));
  const setCompany = (key, value) => setSettings((s) => ({ ...s, company: { ...s.company, [key]: value } }));
  const setKit = (key, value) => setSettings((s) => ({ ...s, kit: { ...s.kit, [key]: value } }));

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put('/settings', {
        email: { ...settings.email, port: Number(settings.email.port) || 587 },
        company: settings.company,
        kit: settings.kit,
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
    <div className="max-w-4xl">
      <PageHeader title="Settings" description="System-wide configuration" />

      <Tabs defaultValue="email">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="email"><Mail className="h-4 w-4 mr-1.5" /> Email</TabsTrigger>
          <TabsTrigger value="company"><Building2 className="h-4 w-4 mr-1.5" /> Company</TabsTrigger>
          <TabsTrigger value="kit"><ScrollText className="h-4 w-4 mr-1.5" /> Kit Defaults</TabsTrigger>
          <TabsTrigger value="meta"><Rss className="h-4 w-4 mr-1.5" /> Meta Ads</TabsTrigger>
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

        <TabsContent value="meta">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Meta Ads lead sheets</CardTitle>
                <CardDescription>
                  Leads from every Facebook/Instagram lead-ad form land in a Google Sheet. Add each form&rsquo;s
                  sheet link below — every sheet marked Active is checked automatically, and new rows become
                  leads in the CRM. Each sheet must be shared as &ldquo;Anyone with the link&rdquo; (Viewer).
                </CardDescription>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={syncSheetsNow} disabled={syncing}>
                  <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} /> Sync now
                </Button>
                <Button size="sm" onClick={openCreateSheet}><Plus className="h-4 w-4" /> Add sheet</Button>
              </div>
            </CardHeader>
            <CardContent>
              {sheetsLoading ? (
                <TableSkeleton rows={3} />
              ) : metaSheets.length === 0 ? (
                <EmptyState
                  icon={Rss}
                  title="No sheets configured yet"
                  description="Paste a Google Sheet link below to start pulling in leads from a Meta Ads form."
                >
                  <Button size="sm" onClick={openCreateSheet}><Plus className="h-4 w-4" /> Add sheet</Button>
                </EmptyState>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sheet</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last sync</TableHead>
                      <TableHead className="w-20" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {metaSheets.map((s) => (
                      <TableRow key={s._id}>
                        <TableCell>
                          <p className="font-medium">{s.label || s.sheetId}</p>
                          {s.url && (
                            <a href={s.url} target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary truncate max-w-xs">
                              <span className="truncate">{s.url}</span>
                              <ExternalLink className="h-3 w-3 shrink-0" />
                            </a>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={s.enabled !== false ? 'secondary' : 'outline'}
                            className="cursor-pointer select-none"
                            onClick={() => toggleSheetEnabled(s)}
                            title="Click to toggle"
                          >
                            {s.enabled !== false ? 'Active' : 'Disabled'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {s.lastError ? (
                            <p className="text-destructive" title={s.lastError}>Failed: {s.lastError}</p>
                          ) : s.lastSyncAt ? (
                            <>
                              <p>{s.lastResult}</p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(s.lastSyncAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                              </p>
                            </>
                          ) : (
                            <span className="text-muted-foreground">Never synced</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1 justify-end">
                            <Button variant="ghost" size="icon" onClick={() => openEditSheet(s)}><Pencil className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeletingSheet(s)}><Trash2 className="h-4 w-4" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ---------- Add/edit sheet dialog ---------- */}
      <Dialog open={sheetDialogOpen} onOpenChange={setSheetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSheet ? 'Edit sheet' : 'Add Meta Ads sheet'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Label</Label>
              <Input
                placeholder="e.g. Distributor form, QSR campaign"
                value={sheetForm.label}
                onChange={(e) => setSheetForm((f) => ({ ...f, label: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Shown in this list and, when more than one sheet is configured, noted on each imported lead.</p>
            </div>
            <div className="space-y-2">
              <Label>Google Sheet link *</Label>
              <Input
                placeholder="https://docs.google.com/spreadsheets/d/…/edit"
                value={sheetForm.url}
                onChange={(e) => setSheetForm((f) => ({ ...f, url: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Paste the sheet&rsquo;s address-bar URL. It must be shared as Share → General access →
                &ldquo;Anyone with the link&rdquo; (Viewer) so the sync can read it without signing in.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <input id="sheetEnabled" type="checkbox" className="h-4 w-4 accent-primary"
                checked={sheetForm.enabled} onChange={(e) => setSheetForm((f) => ({ ...f, enabled: e.target.checked }))} />
              <Label htmlFor="sheetEnabled">Active (included in automatic sync)</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSheetDialogOpen(false)} disabled={savingSheet}>Cancel</Button>
            <Button onClick={saveSheet} disabled={savingSheet}>
              {savingSheet ? 'Saving…' : editingSheet ? 'Save changes' : 'Add sheet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deletingSheet)}
        onOpenChange={(o) => !o && setDeletingSheet(null)}
        title={`Remove "${deletingSheet?.label || deletingSheet?.sheetId}"?`}
        description="This sheet will no longer be checked for new leads. Leads already imported from it are unaffected."
        confirmLabel="Remove"
        loading={savingSheet}
        onConfirm={deleteSheet}
      />
    </div>
  );
}
