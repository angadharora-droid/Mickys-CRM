import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, Loader2, Save, TriangleAlert } from 'lucide-react';

// The accounts list is stored as an array but edited as one comma-separated
// line; the API accepts either and hands back the normalised array on save.
const emailListText = (v) => (Array.isArray(v) ? v.join(', ') : v || '');
const emailListCount = (v) => emailListText(v).split(',').filter((e) => e.trim()).length;

export default function SalesSettings() {
  const [salesOrder, setSalesOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/settings');
      setSalesOrder(data.data?.salesOrder || {});
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const setField = (key, value) => setSalesOrder((s) => ({ ...s, [key]: value }));

  // Only the salesOrder section goes up — the email, company and kit sections
  // are edited elsewhere and must not be overwritten by this screen.
  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put('/settings', {
        salesOrder: {
          ...salesOrder,
          accountsEmails: emailListText(salesOrder?.accountsEmails),
          emailAccountsOnConfirm: salesOrder?.emailAccountsOnConfirm ?? false,
        },
      });
      setSalesOrder(data.data?.salesOrder || {});
      toast.success('Sales order settings saved');
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const noAddresses = emailListCount(salesOrder?.accountsEmails) === 0;

  if (loading) {
    return (
      <div>
        <PageHeader title="Sales Order Settings" description="How confirmed orders reach accounts" />
        <Card className="p-4 space-y-4">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-10 w-36" />
        </Card>
      </div>
    );
  }

  if (!salesOrder) {
    return (
      <div>
        <PageHeader title="Sales Order Settings" description="How confirmed orders reach accounts" />
        <Card>
          <EmptyState
            icon={TriangleAlert}
            title="Settings could not be loaded"
            description="The settings could not be fetched just now. Check your connection and try again."
          >
            <Button variant="outline" onClick={fetchSettings}>Try again</Button>
          </EmptyState>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Sales Order Settings" description="How confirmed orders reach accounts" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Accounts notification</CardTitle>
          <CardDescription>
            Accounts can be sent the order PDF automatically the moment an exec confirms it, so invoicing never waits
            on someone remembering to forward it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="accountsEmails">Accounts email addresses</Label>
            <Input
              id="accountsEmails"
              type="text"
              inputMode="email"
              placeholder="accounts@mickys.in, billing@mickys.in"
              value={emailListText(salesOrder.accountsEmails)}
              onChange={(e) => setField('accountsEmails', e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Separate multiple addresses with commas. Every one of them receives the confirmed order PDF.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <input
              id="emailAccountsOnConfirm"
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={salesOrder.emailAccountsOnConfirm || false}
              onChange={(e) => setField('emailAccountsOnConfirm', e.target.checked)}
            />
            <Label htmlFor="emailAccountsOnConfirm">Email accounts when an order is confirmed</Label>
          </div>

          {salesOrder.emailAccountsOnConfirm && noAddresses && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                This toggle does nothing until you add at least one accounts email address above — confirmed orders
                will not be mailed anywhere.
              </span>
            </div>
          )}

          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
