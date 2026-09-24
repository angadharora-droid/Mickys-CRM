import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Download, Loader2, RefreshCw, Save, Send } from 'lucide-react';

/**
 * Settings → "Orders into Tally": confirmed orders go to Tally as Sales Order
 * vouchers through the Tally add-on (the order part of mickys-stock.tdl), see
 * server/src/services/tallyOrder.service.js. Test mode books everything to one
 * dummy ledger with a TEST/ Order no.; live mode to each customer's own
 * ledger. The names below must match Tally exactly.
 */
const NAME_FIELDS = [
  { key: 'voucherType', label: 'Voucher type', hint: 'The sales order voucher type in Tally.' },
  { key: 'godown', label: 'Godown', hint: 'Every line goes here, batch "Any" — accounts pick the batch when invoicing.' },
  { key: 'salesLedger', label: 'Sales ledger', hint: 'Allocated on every item line.' },
  { key: 'roundOffLedger', label: 'Round-off ledger', hint: 'Rounds the total to the rupee. Blank = no rounding.' },
  { key: 'cgstLedger', label: 'CGST ledger', hint: '{rate} becomes half the GST rate, e.g. 2.5.' },
  { key: 'sgstLedger', label: 'SGST ledger', hint: '{rate} becomes half the GST rate, e.g. 2.5.' },
  { key: 'igstLedger', label: 'IGST ledger', hint: '{rate} becomes the GST rate, e.g. 5 (inter-state orders).' },
];

const EDITABLE = ['enabled', 'mode', 'testLedger', ...NAME_FIELDS.map((f) => f.key)];

/** One call from the Tally side, in words. */
function callText(c) {
  if (c.kind === 'feed') {
    const what = c.handedOut?.length ? c.handedOut.join(', ') : 'nothing due';
    return `Collected orders${c.note ? ` (${c.note})` : ''}: ${what}${!c.claim && !c.note ? ' — look only' : ''}`;
  }
  return (
    `Reported Tally's sales orders: ${c.blocks} in the report, ${c.matched} from the CRM, ${c.bytes} bytes` +
    `${c.tdlVersion ? `, TDL v${c.tdlVersion}` : ''}${c.note ? ` — ${c.note}` : ''}`
  );
}

/**
 * What the Tally side actually sent, newest first, beside the last stock push
 * (which shows whether Tally's timer is running at all). Nothing on the Tally
 * screen shows this, so it is the first place to look when an order does not
 * arrive.
 */
function TallyCalls({ calls, lastStockPush }) {
  const latestReport = (calls || []).find((c) => c.kind === 'seen' && c.sample);
  return (
    <details open className="rounded-md border bg-background p-3 text-xs">
      <summary className="cursor-pointer font-medium">What Tally sent{calls?.length ? ` (latest ${calls.length})` : ''}</summary>
      <p className="mt-2 text-muted-foreground">
        Last stock push from Tally:{' '}
        {lastStockPush ? `${formatDateTime(lastStockPush.at)}${lastStockPush.tdlVersion ? ` [TDL v${lastStockPush.tdlVersion}]` : ''}` : '—'}
      </p>
      {calls?.length ? (
        <ul className="mt-2 space-y-1">
          {calls.map((c) => (
            <li key={c._id}>
              <span className="font-medium">{formatDateTime(c.at)}</span> — {callText(c)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-muted-foreground">Nothing from Tally's order sync yet.</p>
      )}
      {latestReport && (
        <>
          <p className="mt-2 text-muted-foreground">Start of the latest report from Tally:</p>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-[11px]">
            {latestReport.sample}
          </pre>
        </>
      )}
    </details>
  );
}

export default function TallyOrdersSettings({ initial }) {
  const [cfg, setCfg] = useState(initial || {});
  const [overview, setOverview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    try {
      const { data } = await api.get('/tally-orders/overview');
      setOverview(data.data);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const set = (key, value) => setCfg((c) => ({ ...c, [key]: value }));

  const save = async () => {
    const goingLive = cfg.enabled && cfg.mode === 'live' && overview?.config?.mode !== 'live';
    if (
      goingLive &&
      !window.confirm(
        'Switch to LIVE?\n\nConfirmed orders will go to Tally against each customer\'s own ledger, ready to invoice. Orders already sent in test mode go again under their customer — delete the TEST ones in Tally.'
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      const body = Object.fromEntries(EDITABLE.map((k) => [k, cfg[k]]));
      body.enabled = Boolean(cfg.enabled);
      const { data } = await api.put('/settings', { tallyOrders: body });
      setCfg(data.data?.tallyOrders || cfg);
      toast.success(
        body.enabled ? `Orders go to Tally — ${body.mode === 'live' ? 'LIVE' : 'test mode'}` : 'Sending orders to Tally is switched off'
      );
      loadOverview();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  // The fallback while the add-on is not running: the due orders as a Tally
  // import file. They count as sent from here, so the add-on will not create
  // them again.
  const downloadImportFile = async () => {
    if (
      !window.confirm(
        'Download the due orders as a Tally import file?\n\nThey count as sent from now on — import the file in Tally (Import → Transactions) or the orders will not be there.'
      )
    ) {
      return;
    }
    setDownloading(true);
    try {
      const res = await api.get('/tally-orders/import-file', { params: { claim: 1 }, responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `crm-sales-orders-${new Date().toLocaleDateString('en-CA')}.xml`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      loadOverview();
    } catch (err) {
      // A blob error body has to be read before it can be shown.
      let message = apiError(err);
      if (err?.response?.data instanceof Blob) {
        try {
          message = JSON.parse(await err.response.data.text()).message || message;
        } catch {
          /* keep the generic message */
        }
      }
      toast.error(message);
    } finally {
      setDownloading(false);
    }
  };

  const ov = overview;
  const saved = ov?.config || {};
  const neverCalled = saved.enabled && !saved.lastPullAt && !saved.lastSeenAt;

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Send className="h-4 w-4 text-primary" /> Orders into Tally
        </CardTitle>
        <CardDescription>
          Every confirmed order is created in Tally as a Sales Order by the Tally add-on (mickys-stock.tdl, v6 or later),
          which calls in every 10 minutes. Tally numbers it; the Order no. is the CRM number, so the invoice raised against it matches
          back here by itself. Godown as below, batch &ldquo;Any&rdquo; — accounts pick the batch when invoicing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer sm:col-span-2">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={Boolean(cfg.enabled)}
              onChange={(e) => set('enabled', e.target.checked)}
            />
            Send confirmed orders to Tally
          </label>
          <div className="space-y-2">
            <Label>Mode</Label>
            <Select value={cfg.mode || 'test'} onValueChange={(v) => set('mode', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="test">Test — all to the test ledger</SelectItem>
                <SelectItem value="live">Live — each customer&rsquo;s own ledger</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {cfg.mode === 'live'
                ? 'Orders land under the customer, ready to invoice. Appointed customers need their Tally ledger linked (Customers → Link to Tally).'
                : 'Every order goes to the test ledger with Order no. TEST/SO-…, so nobody invoices it. Invoices naming a TEST/ number never move an order here.'}
            </p>
          </div>
          {cfg.mode !== 'live' && (
            <div className="space-y-2">
              <Label htmlFor="testLedger">Test ledger in Tally</Label>
              <Input id="testLedger" value={cfg.testLedger || ''} onChange={(e) => set('testLedger', e.target.value)} />
              {ov && !ov.testLedgerInTally && saved.testLedger && (
                <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
                  &ldquo;{saved.testLedger}&rdquo; is not among Tally&rsquo;s Sundry Debtors in the last stock sync. Check
                  the name and that it sits under Sundry Debtors.
                </p>
              )}
            </div>
          )}
        </div>

        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">Names in Tally</summary>
          <div className="grid gap-4 sm:grid-cols-2 mt-3">
            {NAME_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={`to-${f.key}`}>{f.label}</Label>
                <Input id={`to-${f.key}`} value={cfg[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} />
                <p className="text-xs text-muted-foreground">{f.hint}</p>
              </div>
            ))}
          </div>
        </details>

        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save'}
        </Button>

        {ov && saved.enabled && (
          <div className="rounded-lg border bg-muted/40 p-4 space-y-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">
                Now — {saved.mode === 'live' ? 'LIVE' : 'test mode'}
                {saved.sendFrom ? `, orders confirmed since ${formatDateTime(saved.sendFrom)}` : ''}
              </p>
              <Button size="sm" variant="ghost" onClick={loadOverview} disabled={loadingOverview}>
                <RefreshCw className={`h-4 w-4 ${loadingOverview ? 'animate-spin' : ''}`} />
              </Button>
            </div>

            {neverCalled ? (
              <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
                The Tally add-on has not called in yet. Load the current mickys-stock.tdl (v6 or later) on the Tally
                machine from …/api/stock/tdl?key=&lt;TALLY_SYNC_KEY&gt; and restart Tally — see tally/README.md.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Add-on last collected orders {saved.lastPullAt ? `${formatDateTime(saved.lastPullAt)} (${saved.lastPullCount})` : '—'} ·
                last reported Tally&rsquo;s sales orders {saved.lastSeenAt ? `${formatDateTime(saved.lastSeenAt)} (${saved.lastSeenCount})` : '—'}
                {saved.lastTdlVersion && !ov.tdlCurrent && (
                  <span className="text-amber-700 dark:text-amber-400">
                    {' '}· OLD add-on v{saved.lastTdlVersion} loaded — download v{ov.tdlLatest} and restart Tally
                  </span>
                )}
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Due in Tally</p>
                <p className="font-semibold">{ov.queued.length}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Sent, not in Tally&rsquo;s report yet</p>
                <p className="font-semibold">{ov.sentWaiting.length}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">In Tally</p>
                <p className="font-semibold">{ov.inTally}</p>
              </div>
            </div>

            {ov.queued.length > 0 && (
              <p className="text-xs">
                Due: {ov.queued.map((q) => `${q.number} (${q.party}, ${formatCurrency(q.total)})`).join(' · ')}
              </p>
            )}
            {ov.sentWaiting.length > 0 && (
              <p className="text-xs">
                Sent: {ov.sentWaiting.map((s) => `${s.number} ${formatDateTime(s.sentAt)}`).join(' · ')}
              </p>
            )}
            {ov.held.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200 space-y-1">
                <p className="font-medium flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" /> {ov.held.length} confirmed order{ov.held.length === 1 ? '' : 's'} cannot go yet
                </p>
                {ov.held.map((h) => (
                  <p key={h.id}>
                    <span className="font-medium">{h.number}</span> {h.customerName} — {h.reason}
                  </p>
                ))}
              </div>
            )}

            <TallyCalls calls={ov.calls} lastStockPush={ov.lastStockPush} />

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button size="sm" variant="outline" onClick={downloadImportFile} disabled={downloading || !ov.queued.length}>
                {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Download import file
              </Button>
              <p className="text-xs text-muted-foreground">
                Only while the add-on is not running: import it in Tally under Import → Transactions.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
