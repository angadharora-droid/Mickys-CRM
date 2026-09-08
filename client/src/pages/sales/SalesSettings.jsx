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
import { AlertTriangle, Loader2, Save, TriangleAlert, Send, Clock } from 'lucide-react';

// The accounts list is stored as an array but edited as one comma-separated
// line; the API accepts either and hands back the normalised array on save.
const emailListText = (v) => (Array.isArray(v) ? v.join(', ') : v || '');
const emailListCount = (v) => emailListText(v).split(',').filter((e) => e.trim()).length;

const pad2 = (n) => String(n).padStart(2, '0');
/** "HH:MM" for the time input from the stored hour/minute (blank = default). */
const timeText = (dr) => (dr?.hourIst == null ? '' : `${pad2(dr.hourIst)}:${pad2(dr.minuteIst ?? 0)}`);
const yesterdayInput = () => new Date(Date.now() - 86400000).toLocaleDateString('en-CA');

export default function SalesSettings() {
  const [salesOrder, setSalesOrder] = useState(null);
  const [dailyReport, setDailyReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingReport, setSavingReport] = useState(false);
  const [sendDay, setSendDay] = useState(yesterdayInput);
  const [sendTo, setSendTo] = useState('');
  const [sending, setSending] = useState(false);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/settings');
      setSalesOrder(data.data?.salesOrder || {});
      const dr = data.data?.dailyReport || {};
      setDailyReport({ ...dr, time: timeText(dr) });
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
  const setReportField = (key, value) => setDailyReport((s) => ({ ...s, [key]: value }));

  // The schedule: a blank time keeps the server default. Only the dailyReport
  // section goes up, so the salesOrder card's unsaved edits are untouched.
  const saveDailyReport = async () => {
    setSavingReport(true);
    try {
      const [h, m] = (dailyReport.time || '').split(':');
      const { data } = await api.put('/settings', {
        dailyReport: {
          enabled: dailyReport.enabled !== false,
          to: emailListText(dailyReport.to),
          hourIst: h === undefined || h === '' ? null : Number(h),
          minuteIst: m === undefined || m === '' ? null : Number(m),
        },
      });
      const dr = data.data?.dailyReport || {};
      setDailyReport({ ...dr, time: timeText(dr) });
      toast.success(
        dr.enabled === false
          ? 'Daily report switched off'
          : `Daily report will go out at ${timeText(dr) || dr.effective?.time || 'the default time'} IST`
      );
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSavingReport(false);
    }
  };

  // One report, now, for the chosen day — to the usual recipients, or to a
  // test address typed here.
  const sendNow = async () => {
    setSending(true);
    try {
      const body = { date: sendDay };
      if (sendTo.trim()) body.to = sendTo.trim();
      const { data } = await api.post('/reports/daily-email', body);
      const c = data.data?.counts || {};
      toast.success(data.message || `Daily report for ${data.data?.day} sent`, {
        description: `${c.invoices ?? 0} invoices · ${c.ordersBooked ?? 0} orders booked · ${c.newLeads ?? 0} leads · ${c.visits ?? 0} visits`,
        duration: 8000,
      });
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSending(false);
    }
  };

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
          monthlyRevenueTarget: Number(salesOrder?.monthlyRevenueTarget) || 0,
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

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Daily report — revenue target</CardTitle>
          <CardDescription>
            The morning report email carries yesterday&rsquo;s sales invoices from Tally, the month-to-date invoiced
            revenue, and an on-track / behind verdict against this monthly target, pro-rated to the day of the month.
            Leave it at 0 for no verdict.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="monthlyRevenueTarget">Monthly invoiced revenue target (Rs.)</Label>
            <Input
              id="monthlyRevenueTarget"
              type="number"
              min="0"
              inputMode="numeric"
              placeholder="e.g. 2500000"
              value={salesOrder.monthlyRevenueTarget ?? ''}
              onChange={(e) => setField('monthlyRevenueTarget', e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Compared against the basic value before GST of every sales invoice the Tally push carries (the sales
              register&rsquo;s Basic Value column), whether or not the invoice names a CRM order.
            </p>
          </div>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
        </CardContent>
      </Card>

      {dailyReport && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" /> Daily report — schedule &amp; send
            </CardTitle>
            <CardDescription>
              The report for a day goes out the next day at this time (IST), to these addresses. It carries that
              day&rsquo;s Tally invoices, orders, leads and visits.
              {dailyReport.effective && (
                <>
                  {' '}Currently: {dailyReport.effective.enabled ? `daily at ${dailyReport.effective.time} IST` : 'switched off'} to{' '}
                  {dailyReport.effective.to?.join(', ') || '—'}
                  {dailyReport.lastSentDay ? ` · last sent for ${dailyReport.lastSentDay}` : ''}.
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="dailyReportTime">Send time (IST)</Label>
                <Input
                  id="dailyReportTime"
                  type="time"
                  value={dailyReport.time || ''}
                  onChange={(e) => setReportField('time', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Leave blank for the server default (12:00).</p>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="dailyReportTo">Send to</Label>
                <Input
                  id="dailyReportTo"
                  type="text"
                  inputMode="email"
                  placeholder="report@cpgh.in, md@cpgh.in"
                  value={emailListText(dailyReport.to)}
                  onChange={(e) => setReportField('to', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Comma-separated. Blank keeps the server default address.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={dailyReport.enabled !== false}
                  onChange={(e) => setReportField('enabled', e.target.checked)}
                />
                Send the report every day
              </label>
              <Button onClick={saveDailyReport} disabled={savingReport}>
                {savingReport ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {savingReport ? 'Saving…' : 'Save schedule'}
              </Button>
            </div>

            <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
              <p className="text-sm font-medium">Send one now</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="sendDay">Report for</Label>
                  <Input id="sendDay" type="date" value={sendDay} max={yesterdayInput()} onChange={(e) => setSendDay(e.target.value)} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="sendTo">Send to (optional)</Label>
                  <Input
                    id="sendTo"
                    type="email"
                    placeholder="Blank = the addresses above"
                    value={sendTo}
                    onChange={(e) => setSendTo(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={sendNow} disabled={sending || !sendDay}>
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {sending ? 'Sending…' : 'Send report now'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Type your own address to preview it without mailing everyone. Today&rsquo;s report is available tomorrow.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
