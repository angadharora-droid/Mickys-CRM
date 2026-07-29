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
import { Landmark, Pencil, RefreshCw } from 'lucide-react';

const QUOTED = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
];

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
              <Button size="sm" variant="ghost" onClick={() => setDraft({ USD: fx?.inrPer?.USD, EUR: fx?.inrPer?.EUR, GBP: fx?.inrPer?.GBP })} disabled={!fx}>
                <Pencil className="h-4 w-4" /> Set manually
              </Button>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {QUOTED.map((c) => <Skeleton key={c.code} className="h-24 rounded-lg" />)}
        </div>
      ) : !fx ? null : !draft ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {QUOTED.map((c) => (
              <div key={c.code} className="rounded-lg border p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{c.name}</p>
                <p className="text-2xl font-semibold tabular-nums mt-1">
                  {c.symbol}1 = ₹{Number(fx.inrPer?.[c.code] || 0).toLocaleString('en-IN', { maximumFractionDigits: 4 })}
                </p>
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
          <div className="grid gap-4 sm:grid-cols-3">
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
