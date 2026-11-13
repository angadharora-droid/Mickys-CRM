import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { QUOTED_CURRENCIES as QUOTED } from '@/lib/currencies';
import { Landmark, Pencil, RefreshCw } from 'lucide-react';

// One compact row per currency on phones; from `sm` up, as many 16rem cards as
// fit the panel (the longest rate, "KWD 1 = ₹302.3889", needs that width).
const RATE_GRID = 'grid gap-2 sm:gap-3 sm:grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]';

/**
 * The stored daily exchange rates used on every export rate card (INR per one
 * unit of currency). Synced daily by the server; admins can pull the live feed
 * on demand or set the numbers by hand.
 */
export default function ExchangeRates({ isAdmin }) {
  const [fx, setFx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  const fetchFx = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/export/exchange-rates');
      setFx(data.data);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchFx(); }, [fetchFx]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const { data } = await api.post('/export/exchange-rates/refresh');
      setFx(data.data);
      toast.success('Exchange rates refreshed from the live feed');
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setRefreshing(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const inrPer = {};
      for (const { code } of QUOTED) {
        const n = Number(draft[code]);
        if (!(n > 0)) {
          toast.error(`Enter a valid ${code} rate`);
          setSaving(false);
          return;
        }
        inrPer[code] = n;
      }
      const { data } = await api.put('/export/exchange-rates', { inrPer });
      setFx(data.data);
      setDraft(null);
      toast.success('Exchange rates saved');
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Landmark className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">Export exchange rates</h3>
          {fx && <Badge variant="secondary">{fx.source === 'manual' ? 'Set manually' : fx.source === 'seed' ? 'Seed values' : `Feed: ${fx.source}`}</Badge>}
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing || Boolean(draft)}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> {refreshing ? 'Refreshing…' : 'Refresh from feed'}
            </Button>
            {!draft && (
              <Button size="sm" variant="ghost" onClick={() => setDraft(Object.fromEntries(QUOTED.map((c) => [c.code, fx?.inrPer?.[c.code]])))} disabled={!fx}>
                <Pencil className="h-4 w-4" /> Set manually
              </Button>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className={RATE_GRID}>
          {QUOTED.map((c) => <Skeleton key={c.code} className="h-10 rounded-lg sm:h-[5.25rem]" />)}
        </div>
      ) : !fx ? null : !draft ? (
        <>
          <div className={RATE_GRID}>
            {QUOTED.map((c) => (
              <div key={c.code} className="flex items-baseline justify-between gap-3 rounded-lg border px-4 py-2.5 sm:block sm:p-4">
                <p className="min-w-0 truncate text-xs text-muted-foreground sm:uppercase sm:tracking-wide">{c.name}</p>
                {/* A newly added currency has no rate until the next feed refresh. */}
                {fx.inrPer?.[c.code] > 0 ? (
                  <p className="shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums sm:mt-1 sm:text-xl">
                    {c.symbol}1 = ₹{Number(fx.inrPer[c.code]).toLocaleString('en-IN', { maximumFractionDigits: 4 })}
                  </p>
                ) : (
                  <p className="shrink-0 text-sm text-muted-foreground sm:mt-2">
                    Not set yet<span className="hidden sm:inline"> — refresh from feed</span>
                  </p>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            {fx.fetchedAt
              ? `Last updated ${formatDateTime(fx.fetchedAt)}. `
              : 'Never fetched — showing seed values. '}
            Rates refresh automatically once a day and are printed (with their as-of date) on every export rate card.
          </p>
        </>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            {QUOTED.map((c) => (
              <div key={c.code} className="space-y-2">
                <Label>{c.code} — ₹ per {c.symbol}1</Label>
                <Input
                  type="number" step="any" min="0"
                  value={draft[c.code] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [c.code]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Manual rates stay in effect until the next daily feed refresh (or another manual edit).
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setDraft(null)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save rates'}</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
