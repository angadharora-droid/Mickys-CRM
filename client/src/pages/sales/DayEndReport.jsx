import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import useAutoRefresh from '@/lib/useAutoRefresh';
import { cn, formatCurrency, formatDate, formatDateTime, formatQty, todayInput } from '@/lib/utils';
import PageHeader from '@/components/shared/PageHeader';
import TableSkeleton from '@/components/shared/TableSkeleton';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  RefreshCw, Printer, Settings2, Pencil, Check, X, ChevronRight, Plus, Trash2, Loader2, AlertTriangle,
  CheckCircle2, XCircle, Search,
} from 'lucide-react';

const DAYEND_TDL_HINT = '…/api/stock/dayend/tdl?key=<TALLY_SYNC_KEY>';
const DUES_PREVIEW = 25;

const pct = (n) => `${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`;
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
/** "+₹5.00" / "−₹9.53" — a change, signed ahead of the rupee sign. */
const signedCurrency = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatCurrency(Math.abs(n))}`;
const signedPct = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${pct(Math.abs(n))}`;

const prettyDay = (key) =>
  new Date(`${key}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });

// ------------------------------------------------------------- pieces ----

function Section({ title, hint, action, children }) {
  return (
    <Card className="mb-4 overflow-hidden break-inside-avoid">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-display text-sm sm:text-base font-bold uppercase tracking-wide">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {action && <div className="shrink-0 print:hidden">{action}</div>}
      </div>
      {children}
    </Card>
  );
}

function Awaiting({ children }) {
  return (
    <div className="m-4 flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

function Muted({ children }) {
  return <p className="px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

const Sub = ({ children }) => <p className="text-[11px] font-normal text-muted-foreground">{children}</p>;

function ExpiryBadge({ expiry }) {
  const status = expiry?.status || 'unknown';
  if (status === 'unknown') {
    return <span className="text-xs text-muted-foreground" title="No batch with an expiry date for this stock">—</span>;
  }
  const critical = status === 'critical';
  const detail = expiry.expiryDate
    ? `${expiry.daysLeft < 0 ? `Expired ${-expiry.daysLeft} days ago` : `${expiry.daysLeft} days left`} — earliest batch${
        expiry.batch ? ` ${expiry.batch}` : ''
      } expires ${formatDate(expiry.expiryDate)}`
    : undefined;
  return (
    <Badge
      variant="outline"
      title={detail}
      className={cn(
        'text-[10px] font-bold tracking-wide',
        critical
          ? 'border-red-200 bg-red-100 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300'
          : 'border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
      )}
    >
      {critical ? (expiry.daysLeft < 0 ? 'CRITICAL · EXPIRED' : 'CRITICAL') : 'Normal'}
    </Badge>
  );
}

/** A KPI figure against its target: green once met, red until then. */
function TargetFigure({ value, met }) {
  return (
    <span
      className={cn(
        'inline-flex min-w-[2.25rem] justify-center rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums',
        met ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-red-500/10 text-red-700 dark:text-red-400'
      )}
    >
      {value}
    </span>
  );
}

function StatusMark({ ok }) {
  if (ok == null) return <span className="text-muted-foreground">—</span>;
  return ok ? (
    <CheckCircle2 className="mx-auto h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-label="Within tolerance" />
  ) : (
    <XCircle className="mx-auto h-5 w-5 text-red-600 dark:text-red-400" aria-label="Above tolerance" />
  );
}

function FeedStatus({ feed }) {
  const { stock, dayEnd } = feed;
  const line = (label, ok, children) => (
    <div className="flex items-start gap-2">
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      )}
      <p>
        <span className="font-medium">{label}:</span> {children}
      </p>
    </div>
  );
  return (
    <Card className="mb-4 space-y-1.5 p-4 text-xs text-muted-foreground print:hidden">
      {line(
        'Stock & invoices (mickys-stock.tdl)',
        stock?.tdlCurrent,
        stock
          ? `last push ${formatDateTime(stock.at)} · ${
              stock.tdlCurrent ? `TDL v${stock.tdlVersion}` : `Tally runs ${stock.tdlVersion ? `v${stock.tdlVersion}` : 'an old copy'}, current is v${stock.tdlLatest}`
            }`
          : 'nothing received yet'
      )}
      {line(
        'Day end (mickys-dayend.tdl)',
        dayEnd?.at && dayEnd.tdlCurrent,
        dayEnd?.at ? (
          <>
            last push {formatDateTime(dayEnd.at)} ·{' '}
            {dayEnd.tdlCurrent ? `TDL v${dayEnd.tdlVersion}` : `Tally runs ${dayEnd.tdlVersion ? `v${dayEnd.tdlVersion}` : 'an old copy'}, current is v${dayEnd.tdlLatest} — re-download and restart Tally`}{' '}
            · {plural(dayEnd.counts?.receipts || 0, 'receipt')}, {plural(dayEnd.counts?.debtors || 0, 'customer')} with balances (
            {plural(dayEnd.counts?.bills || 0, 'bill')}), {plural(dayEnd.counts?.production || 0, 'production voucher')}
            {dayEnd.batchesSent ? `, ${plural(dayEnd.counts?.batches || 0, 'batch', 'batches')}` : ', batches not sent'}
            {dayEnd.counts?.historyDays
              ? ` · balances and closing stock of the last ${dayEnd.counts.historyDays} days re-read on every push`
              : ' · past days not re-read (needs TDL v2 with history)'}
          </>
        ) : (
          <>
            not received yet. Load the day-end add-on next to mickys-stock.tdl on the Tally machine — download it from{' '}
            <code className="rounded bg-muted px-1">{DAYEND_TDL_HINT}</code>, add its path under F1 › TDLs &amp; AddOns › F4 and restart Tally
            (tally/README.md, section 7).
          </>
        )
      )}
    </Card>
  );
}

// ----------------------------------------------------- follow-up editor ----

function FollowUpCell({ ledger, followUp, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(followUp?.status || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setText(followUp?.status || '');
  }, [followUp, editing]);

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put('/day-end/follow-up', { ledger, status: text.trim() });
      onSaved(ledger, data.data);
      setEditing(false);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          autoFocus
          value={text}
          maxLength={300}
          placeholder="e.g. Promised NEFT by Friday"
          className="h-8 text-sm"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={save} disabled={saving} title="Save">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </Button>
        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => setEditing(false)} title="Cancel">
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <button type="button" onClick={() => setEditing(true)} className="group flex w-full items-start gap-2 text-left">
      <div className="min-w-0 flex-1">
        {followUp ? (
          <>
            <p className="text-sm">{followUp.status}</p>
            <Sub>
              {followUp.by ? `${followUp.by} · ` : ''}
              {formatDateTime(followUp.updatedAt)}
            </Sub>
          </>
        ) : (
          <p className="text-sm italic text-muted-foreground print:hidden">Add follow-up…</p>
        )}
      </div>
      <Pencil className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-40 group-hover:opacity-100 print:hidden" />
    </button>
  );
}

// ------------------------------------------------------- plan editor ----

function PlanDialog({ open, date, rows, onClose, onSaved }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setItems(rows.filter((r) => r.planned != null).map((r) => ({ item: r.item, unit: r.unit, qty: String(r.planned) })));
    setSearch('');
    setResults([]);
  }, [open, rows]);

  useEffect(() => {
    if (!open || search.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get('/stock', { params: { search: search.trim(), limit: 12 } });
        setResults(data.data);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [search, open]);

  const has = (name) => items.some((i) => i.item === name);
  const add = (name, unit) => {
    if (!has(name)) setItems((cur) => [...cur, { item: name, unit, qty: '' }]);
    setSearch('');
    setResults([]);
  };
  const unplanned = rows.filter((r) => r.planned == null && !has(r.item));

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/day-end/plan', { date, items: items.map((i) => ({ item: i.item, qty: Number(i.qty) || 0 })) });
      toast.success('Production plan saved');
      onSaved();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Production plan — {formatDate(`${date}T12:00:00`)}</DialogTitle>
          <DialogDescription>
            Planned quantity per Tally stock item, in the item&rsquo;s own unit. Achievement % compares it with what Tally
            records as produced that day. A quantity of 0 removes the item from the plan.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Add an item — search the Tally stock list…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {results.length > 0 && (
            <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border bg-popover shadow-lg">
              {results.map((s) => (
                <button
                  key={s._id}
                  type="button"
                  disabled={has(s.name)}
                  onClick={() => add(s.name, s.baseUnits)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-40"
                >
                  <span className="truncate">{s.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{s.code || s.baseUnits}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {unplanned.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Produced without a plan:</span>
            {unplanned.map((r) => (
              <button
                key={r.item}
                type="button"
                onClick={() => add(r.item, r.unit)}
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 hover:bg-accent"
              >
                <Plus className="h-3 w-3" /> {r.item}
              </button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
          {items.length === 0 ? (
            <Muted>No items planned for this day yet.</Muted>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="w-40 text-right">Planned qty</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((i, idx) => (
                  <TableRow key={i.item}>
                    <TableCell className="text-sm">{i.item}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          className="h-8 text-right"
                          value={i.qty}
                          onChange={(e) => setItems((cur) => cur.map((x, j) => (j === idx ? { ...x, qty: e.target.value } : x)))}
                        />
                        <span className="w-10 shrink-0 text-xs text-muted-foreground">{i.unit}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        title="Remove"
                        onClick={() => setItems((cur) => cur.filter((_, j) => j !== idx))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------- report settings ----

function SettingsDialog({ open, settings, onClose, onSaved }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !settings) return;
    setForm({
      visits: settings.targets.visits,
      calls: settings.targets.calls,
      leads: settings.targets.leads,
      expiryWarnDays: settings.expiryWarnDays,
      costTolerancePct: settings.costTolerancePct,
      families: settings.families.map((f) => ({ label: f.label, keywords: f.keywords.join(', ') })),
    });
  }, [open, settings]);

  if (!form) return null;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setFamily = (idx, patch) => set({ families: form.families.map((f, i) => (i === idx ? { ...f, ...patch } : f)) });

  const save = async () => {
    const families = form.families
      .filter((f) => f.label.trim() || f.keywords.trim())
      .map((f) => ({ label: f.label.trim(), keywords: f.keywords.split(',').map((k) => k.trim()).filter(Boolean) }));
    if (families.some((f) => !f.label || !f.keywords.length)) {
      toast.error('Every SKU family needs a name and at least one keyword');
      return;
    }
    setSaving(true);
    try {
      await api.put('/settings', {
        dayEnd: {
          targets: { visits: Number(form.visits) || 0, calls: Number(form.calls) || 0, leads: Number(form.leads) || 0 },
          expiryWarnDays: Number(form.expiryWarnDays) || 0,
          costTolerancePct: Number(form.costTolerancePct) || 0,
          families,
        },
      });
      toast.success('Day end report settings saved');
      onSaved();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const num = (key, label, hint) => (
    <div className="space-y-1.5">
      <Label htmlFor={`de-${key}`}>{label}</Label>
      <Input id={`de-${key}`} type="number" min="0" value={form[key]} onChange={(e) => set({ [key]: e.target.value })} />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Day end report settings</DialogTitle>
          <DialogDescription>Daily targets per sales executive, the expiry and cost thresholds, and the SKU families listed by name.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            {num('visits', 'Visits target')}
            {num('calls', 'Calls target')}
            {num('leads', 'New leads target')}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {num('expiryWarnDays', 'Expiry warning (days)', 'A SKU turns CRITICAL when a batch holding stock expires within this many days.')}
            {num('costTolerancePct', 'Cost tolerance (%)', "Today's cost per kg may sit this far above the historical average before it shows ✗.")}
          </div>

          <div className="space-y-2">
            <Label>SKU families in the closing-stock table</Label>
            <p className="text-[11px] text-muted-foreground">
              An item belongs to the first family whose keyword appears in its Tally name (any pack size, kits included). Separate
              keywords with commas — add misspellings used in Tally. Everything else is &ldquo;Other SKU&rdquo;.
            </p>
            {form.families.map((f, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input className="w-40 shrink-0" placeholder="Name" value={f.label} onChange={(e) => setFamily(idx, { label: e.target.value })} />
                <Input placeholder="Keywords, e.g. MAKHANI GRAVY, MAKHNI GRAVY" value={f.keywords} onChange={(e) => setFamily(idx, { keywords: e.target.value })} />
                <Button size="icon" variant="ghost" className="shrink-0" title="Remove" onClick={() => set({ families: form.families.filter((_, i) => i !== idx) })}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => set({ families: [...form.families, { label: '', keywords: '' }] })}>
              <Plus className="h-4 w-4" /> Add family
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------- sections ----

function SalesTable({ sales, receivablesAsOf, dayEndLive }) {
  const { totalSales: ts, ordersReceived: or, ordersDispatched: od, collection: col, receivables: rc } = sales;
  const waitingDayEnd = <span className="text-xs text-muted-foreground">awaiting day-end TDL</span>;
  const rows = [
    [
      'Total Sales',
      ts.live ? (
        <>
          <b>{formatCurrency(ts.today.value)}</b>
          <Sub>{plural(ts.today.count, 'invoice')} · before GST</Sub>
        </>
      ) : (
        <span className="text-xs text-muted-foreground">no Tally invoices yet</span>
      ),
      ts.live ? (
        <>
          {formatCurrency(ts.mtd.value)}
          <Sub>{plural(ts.mtd.count, 'invoice')}</Sub>
        </>
      ) : null,
    ],
    [
      'Orders Received',
      <>
        <b>{or.today.count}</b>
        <Sub>{formatCurrency(or.today.value)}</Sub>
      </>,
      <>
        {or.mtd.count}
        <Sub>{formatCurrency(or.mtd.value)}</Sub>
      </>,
    ],
    [
      'Orders Dispatched',
      <>
        <b>{od.today.count}</b>
        <Sub>{formatCurrency(od.today.value)}</Sub>
      </>,
      <>
        {od.mtd.count}
        <Sub>{formatCurrency(od.mtd.value)}</Sub>
      </>,
    ],
    [
      'Collection Received',
      col.live ? (
        <span title={col.rows.map((r) => `${r.party} — ${formatCurrency(r.amount)}${r.voucherNumber ? ` (Rcpt ${r.voucherNumber})` : ''}`).join('\n') || undefined}>
          <b>{formatCurrency(col.today.value)}</b>
          <Sub>{plural(col.today.count, 'receipt')}</Sub>
        </span>
      ) : (
        waitingDayEnd
      ),
      col.live ? (
        <>
          {formatCurrency(col.mtd.value)}
          <Sub>{plural(col.mtd.count, 'receipt')}</Sub>
        </>
      ) : null,
    ],
    [
      'Outstanding Receivables',
      rc ? <b>{formatCurrency(rc.total)}</b> : dayEndLive ? <span className="text-xs text-muted-foreground">—</span> : waitingDayEnd,
      rc ? (
        <Sub>
          {plural(rc.customers, 'customer')}
          {rc.overdue ? ` · ${formatCurrency(rc.overdue)} past due date` : ''}
          {rc.advances ? ` · advances ${formatCurrency(rc.advances)}` : ''}
          {receivablesAsOf ? ` · as on ${formatDate(`${receivablesAsOf}T12:00:00`)}` : ''}
        </Sub>
      ) : null,
    ],
  ];
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">Sr.</TableHead>
            <TableHead>Particular</TableHead>
            <TableHead className="text-right">Today</TableHead>
            <TableHead className="text-right">MTD / Remarks</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(([label, today, mtd], i) => (
            <TableRow key={label}>
              <TableCell className="text-muted-foreground">{i + 1}</TableCell>
              <TableCell className="font-medium">{label}</TableCell>
              <TableCell className="text-right tabular-nums">{today}</TableCell>
              <TableCell className="text-right tabular-nums">{mtd ?? <span className="text-muted-foreground">—</span>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ExecKpiTable({ kpi }) {
  const t = kpi.targets;
  if (!kpi.rows.length) return <Muted>No active sales executives.</Muted>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Executive</TableHead>
            <TableHead className="text-center">Visits (Target {t.visits})</TableHead>
            <TableHead className="text-center">Calls (Target {t.calls})</TableHead>
            <TableHead className="text-center">New Leads Made / Assigned (Target {t.leads})</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {kpi.rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">
                {r.name}
                {r.role !== 'sales_exec' && <Sub>{r.role === 'pr_manager' ? 'PR manager' : r.role}</Sub>}
              </TableCell>
              <TableCell className="text-center"><TargetFigure value={r.visits} met={r.met.visits} /></TableCell>
              <TableCell className="text-center"><TargetFigure value={r.calls} met={r.met.calls} /></TableCell>
              <TableCell className="text-center">
                <TargetFigure value={r.leads} met={r.met.leads} />
                <Sub>{r.leadsMade} made / {r.leadsAssigned} assigned</Sub>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="font-semibold">Team total</TableCell>
            <TableCell className="text-center tabular-nums font-semibold">{kpi.totals.visits}</TableCell>
            <TableCell className="text-center tabular-nums font-semibold">{kpi.totals.calls}</TableCell>
            <TableCell className="text-center tabular-nums font-semibold">
              {kpi.totals.leads}
              <Sub>{kpi.totals.leadsMade} made / {kpi.totals.leadsAssigned} assigned</Sub>
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

function DuesTable({ dues, onFollowUpSaved }) {
  const [sort, setSort] = useState('amount');
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => {
    const list = [...dues.rows];
    if (sort === 'days') list.sort((a, b) => (b.days ?? -1) - (a.days ?? -1) || b.amount - a.amount);
    return list;
  }, [dues.rows, sort]);
  const visible = showAll ? rows : rows.slice(0, DUES_PREVIEW);

  if (!rows.length) return <Muted>No customer owes anything as on {formatDate(`${dues.asOf}T12:00:00`)}.</Muted>;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 text-xs text-muted-foreground print:hidden">
        <span>
          {plural(rows.length, 'customer')} · as on {formatDate(`${dues.asOf}T12:00:00`)}
          {dues.updatedAt && ` · re-read from Tally ${formatDateTime(dues.updatedAt)}`}
          {!dues.billsCaptured
            ? ' · the day-end TDL did not run on this day, so these balances have no bill-wise detail (due dates unknown)'
            : !dues.billWise && ' · ledgers are not kept bill-wise in Tally, so the due date is not known'}
        </span>
        <div className="flex items-center gap-1">
          Sort by
          {[['amount', 'Amount'], ['days', 'Oldest']].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSort(key)}
              className={cn('rounded-md px-2 py-1', sort === key ? 'bg-accent font-medium text-foreground' : 'hover:bg-accent/60')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Amount Due</TableHead>
              <TableHead>Due Since / Days</TableHead>
              <TableHead className="min-w-[220px]">Follow-up Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => (
              <TableRow key={r.name}>
                <TableCell className="max-w-[260px]">
                  <p className="truncate font-medium">{r.name}</p>
                  {r.group && !/^sundry debtors$/i.test(r.group) && <Sub>{r.group}</Sub>}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <b>{formatCurrency(r.amount)}</b>
                  {r.overdue > 0 && <Sub>{formatCurrency(r.overdue)} past due</Sub>}
                </TableCell>
                <TableCell>
                  {r.oldestBillDate ? (
                    <>
                      <p className="text-sm">
                        {formatDate(r.oldestBillDate)}{' '}
                        <span
                          className={cn(
                            'ml-1 rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums',
                            r.days > 60
                              ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                              : r.days > 30
                                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                                : 'bg-muted text-muted-foreground'
                          )}
                        >
                          {r.days} d
                        </span>
                      </p>
                      <Sub>
                        {plural(r.bills, 'bill')} open
                        {r.overdueDays != null ? ` · ${r.overdueDays} d past due date` : r.dueKnown ? ' · none past due date' : ''}
                      </Sub>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground" title="No pending bills came with this ledger — it is not kept bill-wise in Tally">
                      —
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <FollowUpCell ledger={r.name} followUp={r.followUp} onSaved={onFollowUpSaved} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {rows.length > DUES_PREVIEW && (
        <div className="border-t p-2 text-center print:hidden">
          <Button variant="ghost" size="sm" onClick={() => setShowAll((s) => !s)}>
            {showAll ? `Show top ${DUES_PREVIEW}` : `Show all ${rows.length} customers`}
          </Button>
        </div>
      )}
    </>
  );
}

function ProductionTable({ production }) {
  if (!production.rows.length) {
    return <Muted>Nothing produced in Tally and nothing planned for this day.</Muted>;
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SKU Produced Today</TableHead>
            <TableHead className="text-right">Planned Production</TableHead>
            <TableHead className="text-right">Actual Production</TableHead>
            <TableHead className="text-right">Achievement %</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {production.rows.map((r) => (
            <TableRow key={r.item}>
              <TableCell>
                <span className="font-medium">{r.item}</span>
                {r.bulk && (
                  <Badge variant="outline" className="ml-2 text-[10px]" title="Bulk cooked batch (kit), before packing">
                    Bulk
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.planned != null ? formatQty(r.planned, r.unit) : <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatQty(r.actual, r.unit)}
                {r.kg != null && !/^kgs?$/i.test(r.unit) && r.actual > 0 && <Sub>{formatQty(r.kg, 'kg')}</Sub>}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.achievementPct == null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span
                    className={cn(
                      'font-semibold',
                      r.achievementPct >= 100
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : r.achievementPct >= 80
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-red-700 dark:text-red-400'
                    )}
                  >
                    {r.achievementPct}%
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function CostTable({ cost }) {
  if (!cost.rows.length) return <Muted>Nothing was produced this day.</Muted>;
  const per = (r) => (r.per === 'kg' ? '' : ` /${r.per}`);
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SKU</TableHead>
            <TableHead className="text-right">Avg. Historical Cost / Kg</TableHead>
            <TableHead className="text-right">Today&rsquo;s Cost / Kg</TableHead>
            <TableHead className="text-right">Variance</TableHead>
            <TableHead className="text-center">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cost.rows.map((r) => (
            <TableRow key={r.item}>
              <TableCell className="font-medium">
                {r.item}
                {r.per !== 'kg' && <Sub>pack weight unknown — cost per {r.per}</Sub>}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.histCost != null ? `${formatCurrency(r.histCost)}${per(r)}` : <span className="text-muted-foreground">—</span>}
                {r.histSource && <Sub>{r.histSource}</Sub>}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.todayCost != null ? (
                  `${formatCurrency(r.todayCost)}${per(r)}`
                ) : (
                  <span className="text-xs text-muted-foreground" title="The produced item carries no value in Tally">not valued</span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.variance != null ? (
                  <span className={cn(r.variance > 0 ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400')}>
                    {signedCurrency(r.variance)}
                    <Sub>{signedPct(r.variancePct)}</Sub>
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-center">
                <StatusMark ok={r.ok} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ClosingStockTable({ stock }) {
  const [open, setOpen] = useState(() => new Set());
  const toggle = (label) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  const groups = [...stock.families, stock.other];

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SKU</TableHead>
            <TableHead className="text-right">Closing Stock Value</TableHead>
            <TableHead className="text-center">Expiry Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((g) => {
            const isOpen = open.has(g.label);
            return (
              <Fragment key={g.label}>
                <TableRow className={g.items.length ? 'cursor-pointer' : undefined} onClick={() => g.items.length && toggle(g.label)}>
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <ChevronRight
                        className={cn('h-4 w-4 text-muted-foreground transition-transform print:hidden', isOpen && 'rotate-90', !g.items.length && 'invisible')}
                      />
                      {g.label}
                    </span>
                    <Sub>
                      <span className="pl-6">
                        {plural(g.itemCount, 'item')} in stock
                        {g.criticalItems ? ` · ${g.criticalItems} near expiry` : ''}
                      </span>
                    </Sub>
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{formatCurrency(g.value)}</TableCell>
                  <TableCell className="text-center">
                    <ExpiryBadge expiry={{ status: g.status }} />
                  </TableCell>
                </TableRow>
                {isOpen &&
                  g.items.map((i) => (
                    <TableRow key={`${g.label}:${i.name}`} className="bg-muted/30 text-sm">
                      <TableCell className="pl-12">
                        {i.name}
                        <Sub>{formatQty(i.qty, i.unit)}</Sub>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(i.value)}</TableCell>
                      <TableCell className="text-center">
                        <ExpiryBadge expiry={i.expiry} />
                      </TableCell>
                    </TableRow>
                  ))}
              </Fragment>
            );
          })}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="font-semibold">Total Closing Stock</TableCell>
            <TableCell className="text-right tabular-nums font-bold">{formatCurrency(stock.total)}</TableCell>
            <TableCell />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

function TopStockTable({ top }) {
  if (!top.rows.length) return <Muted>No stock held.</Muted>;
  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead className="text-right">Closing Stock Value</TableHead>
              <TableHead className="text-center">Expiry Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {top.rows.map((i) => (
              <TableRow key={i.name}>
                <TableCell className="font-medium">
                  {i.name}
                  <Sub>{formatQty(i.qty, i.unit)}</Sub>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatCurrency(i.value)}</TableCell>
                <TableCell className="text-center">
                  <ExpiryBadge expiry={i.expiry} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="grid gap-1 border-t px-4 py-3 text-sm sm:grid-cols-2">
        <p>
          Top 20% Stock Value: <b className="tabular-nums">{formatCurrency(top.value)}</b>
        </p>
        <p className="sm:text-right">
          % of Total Closing Stock: <b className="tabular-nums">{pct(top.pctOfTotal)}</b>
          <span className="text-xs text-muted-foreground"> ({top.count} of {top.of} SKUs held)</span>
        </p>
      </div>
    </>
  );
}

// -------------------------------------------------------------- page ----

/**
 * The admin Day End Report — the "MICKY'S – DAY END REPORT" sheet, filled
 * from the CRM and the two Tally feeds (stock export + day-end add-on). Only
 * the production plan and the dues follow-up notes are typed in here.
 */
export default function DayEndReport() {
  const [date, setDate] = useState(todayInput());
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [planOpen, setPlanOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const { data } = await api.get('/day-end', { params: { date } });
      setReport(data.data);
    } catch (err) {
      if (!silent) toast.error(apiError(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);
  // Held while the plan or settings dialog is open: both are filled from the
  // loaded report, and fresh data would reset what is being typed.
  useAutoRefresh(load, { paused: planOpen || settingsOpen });

  const onFollowUpSaved = (ledger, followUp) =>
    setReport((r) => ({
      ...r,
      dues: { ...r.dues, rows: r.dues.rows.map((row) => (row.name === ledger ? { ...row, followUp } : row)) },
    }));

  const r = report;
  const dayEndLive = Boolean(r?.feed?.dayEnd?.at);

  return (
    <div>
      <PageHeader title="Day End Report" description="Sales, team KPI, dues, production and closing stock for the day — from the CRM and Tally">
        <Input
          type="date"
          className="w-auto print:hidden"
          value={date}
          max={r?.today || todayInput()}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
        <Button variant="outline" onClick={load} className="print:hidden">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /> Refresh
        </Button>
        <Button variant="outline" onClick={() => setSettingsOpen(true)} disabled={!r} className="print:hidden">
          <Settings2 className="h-4 w-4" /> Settings
        </Button>
        <Button onClick={() => window.print()} disabled={!r} className="print:hidden">
          <Printer className="h-4 w-4" /> Print
        </Button>
      </PageHeader>

      {!r ? (
        <Card>
          <TableSkeleton rows={10} />
        </Card>
      ) : (
        <div className={cn('transition-opacity', loading && 'opacity-60')}>
          <Card className="mb-4 px-4 py-3 text-sm">
            <p>
              <span className="text-muted-foreground">Date:</span> <b>{prettyDay(r.date)}</b>
              {r.date === r.today && <span className="text-xs text-muted-foreground"> · figures as of the latest Tally push</span>}
            </p>
          </Card>

          <FeedStatus feed={r.feed} />

          <Section title="Sales" hint="Total sales are Tally sales invoices at basic value (before GST); orders are the CRM's sales orders">
            <SalesTable sales={r.sales} receivablesAsOf={r.sales.receivablesAsOf} dayEndLive={dayEndLive} />
          </Section>

          <Section title="Sales Executive KPI" hint="Visits and calls from visit reports logged for the day; new leads dated that day">
            <ExecKpiTable kpi={r.execKpi} />
          </Section>

          <Section title="Due Customer List" hint="Sundry Debtors with a balance in Tally; due since = oldest pending bill">
            {r.dues.available ? (
              <DuesTable dues={r.dues} onFollowUpSaved={onFollowUpSaved} />
            ) : (
              <Awaiting>
                Customer balances come from the day-end TDL, which has not sent anything for this date yet. See the feed status above.
              </Awaiting>
            )}
          </Section>

          <Section
            title="Production"
            hint="Actual = items made through stock / manufacturing journals in Tally; planned = the plan entered here"
            action={
              <Button size="sm" variant="outline" onClick={() => setPlanOpen(true)}>
                <Pencil className="h-3.5 w-3.5" /> Edit plan
              </Button>
            }
          >
            {!r.production.live && <Awaiting>No production vouchers have arrived from Tally yet — they come with the day-end TDL.</Awaiting>}
            <ProductionTable production={r.production} />
          </Section>

          <Section
            title="Production Cost"
            hint={`Value of the produced item ÷ kg produced; ✗ when today's cost is more than ${r.production.cost.tolerancePct}% above the average`}
          >
            <CostTable cost={r.production.cost} />
          </Section>

          <Section
            title="Closing Stock – SKU Wise"
            hint={
              !r.stock.available
                ? undefined
                : r.stock.source === 'tally'
                  ? `Tally closing stock as on ${formatDate(`${r.stock.asOf}T12:00:00`)}${r.stock.settled ? '' : ' (so far today)'}` +
                    (r.stock.updatedAt ? ` · re-read ${formatDateTime(r.stock.updatedAt)}` : '')
                  : `Tally stock register for ${formatDate(`${r.stock.asOf}T12:00:00`)}${r.stock.settled ? '' : ' (last sync — provisional until the next morning)'}`
            }
          >
            {r.stock.available ? (
              <>
                {!r.stock.expiry.sent && (
                  <Awaiting>
                    Expiry status needs batch-wise stock from the day-end TDL{dayEndLive ? ', and the copy loaded in Tally does not send it' : ''}.
                  </Awaiting>
                )}
                <ClosingStockTable stock={r.stock} />
                <p className="border-t px-4 py-2 text-xs text-muted-foreground">
                  CRITICAL = a batch holding stock expires within {r.stock.expiry.warnDays} days (or already has). Click a row to see its items.
                </p>
              </>
            ) : (
              <Awaiting>No stock register exists for this date — Tally had not synced stock by then.</Awaiting>
            )}
          </Section>

          <Section title="Top 20% High-Value Closing Stock" hint="The fifth of SKUs holding the most stock value">
            {r.stock.available ? <TopStockTable top={r.stock.top} /> : <Muted>—</Muted>}
          </Section>
        </div>
      )}

      {r && (
        <>
          <PlanDialog
            open={planOpen}
            date={r.date}
            rows={r.production.rows}
            onClose={() => setPlanOpen(false)}
            onSaved={() => {
              setPlanOpen(false);
              load();
            }}
          />
          <SettingsDialog
            open={settingsOpen}
            settings={r.settings}
            onClose={() => setSettingsOpen(false)}
            onSaved={() => {
              setSettingsOpen(false);
              load();
            }}
          />
        </>
      )}
    </div>
  );
}
