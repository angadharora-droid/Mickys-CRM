import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import EmptyState from '@/components/shared/EmptyState';
import TableSkeleton from '@/components/shared/TableSkeleton';
import { Calculator, Loader2, Package, Search, Ship, TriangleAlert } from 'lucide-react';

// Which FOB assumption set a shipment maps to (mirrors the server).
const fobVariantKey = (loadingType, containerSize) =>
  loadingType === 'part' ? 'ton5' : containerSize;

const CONTAINER_OPTIONS = [
  { size: 'ft20', label: '20 ft FCL' },
  { size: 'ft40', label: '40 ft FCL' },
];

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR'];
const CUR_SYMBOL = { USD: '$', EUR: '€', GBP: '£', INR: '₹' };

/** "500 g" / "1kg" -> pack weight in kg, or null (mirrors the server parser). */
function parsePackWeightKg(packSize) {
  const m = String(packSize || '').match(/([\d.]+)\s*(kg|kgs|g|gm|gms|gram|grams)\b/i);
  if (!m) return null;
  const qty = Number(m[1]);
  if (!(qty > 0)) return null;
  return /^k/i.test(m[2]) ? qty : qty / 1000;
}

const fmtMoney = (n, cur) =>
  `${CUR_SYMBOL[cur] || ''}${Number(n || 0).toLocaleString(cur === 'INR' ? 'en-IN' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * Step 3 for export leads: configure the FOB shipment (load option, currency,
 * products with quantity & weight), preview the standard mixed-load FOB rates,
 * edit the card's T&C, and confirm — which snapshots everything on the lead
 * and generates the kit. All export kits price FOB Nhava Sheva off the FOB
 * cost master; ocean freight & insurance are quoted separately.
 */
export default function ExportKitStep({ lead, locked, busy, terms, onTermsChange, onConfirm }) {
  const cfg = lead.exportConfig;
  const [loadingType, setLoadingType] = useState(cfg?.loadingType || 'full');
  const [containerSize, setContainerSize] = useState(cfg?.containerSize || 'ft20');
  const [currency, setCurrency] = useState(cfg?.currency || 'USD');

  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [fobInfo, setFobInfo] = useState(null); // assumptions behind the FOB prices

  // { [rateItemId]: { qty, unitWeightKg, netRate } }
  const [selection, setSelection] = useState({});
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState(null);
  const [computing, setComputing] = useState(false);

  // Re-seed the editable state whenever the server copy changes (confirm,
  // unlock, kit switch) so re-editing picks up from the confirmed shipment.
  useEffect(() => {
    const c = lead.exportConfig;
    setLoadingType(c?.loadingType || 'full');
    setContainerSize(c?.containerSize || 'ft20');
    setCurrency(c?.currency || 'USD');
    setSelection(
      Object.fromEntries(
        (lead.rates || [])
          .filter((r) => r.included !== false && r.rateItemId)
          .map((r) => [
            String(r.rateItemId),
            { qty: r.qty || 1, unitWeightKg: r.unitWeightKg || parsePackWeightKg(r.packSize) || '', netRate: r.netRate },
          ])
      )
    );
    setPreview(null);
  }, [lead._id, lead.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Which FOB assumption set the current load option maps to.
  const fobVariant = fobVariantKey(loadingType, containerSize);

  // The FOB cost master with prices computed for the selected load option, so
  // it refetches whenever the load option (and with it the price basis) changes.
  const fetchProducts = useCallback(async () => {
    setLoadingProducts(true);
    try {
      const { data } = await api.get('/export/fob-items', { params: { variant: fobVariant } });
      setFobInfo(data.data.assumptions);
      setProducts(
        data.data.items.map((it) => ({
          ...it,
          netRate: it.pricing.priceInr,
          cartonPriceInr: it.pricing.cartonPriceInr,
        }))
      );
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoadingProducts(false);
    }
  }, [fobVariant]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const invalidate = () => setPreview(null);

  // The load option IS the price basis, so switching it invalidates the
  // selected lines' prices as well as the preview.
  const switchLoadOption = (apply) => {
    apply();
    setSelection({});
    invalidate();
  };

  const toggleProduct = (p) => {
    if (locked) return;
    invalidate();
    setSelection((sel) => {
      if (sel[p._id]) {
        const next = { ...sel };
        delete next[p._id];
        return next;
      }
      const w = p.netWeightKg ?? parsePackWeightKg(p.packSize);
      return { ...sel, [p._id]: { qty: 1, unitWeightKg: w ?? '', netRate: p.netRate } };
    });
  };

  const setLine = (id, field, value) => {
    invalidate();
    setSelection((sel) => ({ ...sel, [id]: { ...sel[id], [field]: value } }));
  };

  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.productName.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q)
    );
  }, [products, search]);

  const grouped = useMemo(() => {
    const groups = {};
    visibleProducts.forEach((p) => {
      const cat = p.category || 'Other';
      (groups[cat] = groups[cat] || []).push(p);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [visibleProducts]);

  const selectedCount = Object.keys(selection).length;
  const ready = selectedCount > 0;

  const payload = () => ({
    rateType: 'fob',
    loadingType,
    ...(loadingType === 'full' ? { containerSize } : {}),
    currency,
    lines: Object.entries(selection).map(([rateItemId, l]) => ({
      rateItemId,
      qty: l.qty,
      unitWeightKg: l.unitWeightKg === '' ? null : l.unitWeightKg,
      netRate: l.netRate === '' ? null : l.netRate,
    })),
  });

  const compute = async () => {
    setComputing(true);
    try {
      const { data } = await api.post('/export/rate-card/preview', payload());
      setPreview(data.data);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setComputing(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Step 3 · Export Shipment (FOB)</CardTitle>
          {cfg && (cfg.countryId || cfg.rateType === 'fob') && (
            <Badge variant="secondary">
              Confirmed: {cfg.countryName ? `${cfg.countryName} · ` : ''}
              {cfg.rateType === 'fob'
                ? `FOB ${cfg.loadingType === 'full' ? (cfg.containerSize === 'ft40' ? '40 ft FCL' : '20 ft FCL') : '5 ton mixed load'}`
                : cfg.loadingType === 'full' ? 'Full load' : 'Part load'}{' '}
              · {cfg.currency}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* ---------- Shipment configuration ---------- */}
        <div>
          <p className="text-sm font-medium flex items-center gap-2 mb-3"><Ship className="h-4 w-4" /> Shipment</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label>Loading type</Label>
              <Select value={loadingType} onValueChange={(v) => switchLoadOption(() => setLoadingType(v))} disabled={locked}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Full Load (FCL)</SelectItem>
                  <SelectItem value="part">5 Ton Mixed Load</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {loadingType === 'full' && (
              <div className="space-y-2">
                <Label>Container</Label>
                <Select value={containerSize} onValueChange={(v) => switchLoadOption(() => setContainerSize(v))} disabled={locked}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CONTAINER_OPTIONS.map((c) => <SelectItem key={c.size} value={c.size}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Currency</Label>
              <Select value={currency} onValueChange={(v) => { setCurrency(v); invalidate(); }} disabled={locked}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            FOB Nhava Sheva · standard mixed-load pricing
            {fobInfo
              ? ` (${fobInfo.label}: logistics ₹${fobInfo.logisticsPerKgInr}/kg on an ${(fobInfo.payloadKg / 1000).toLocaleString('en-IN')} MT payload, margin ${fobInfo.marginPercent}%)`
              : ''}
            . Ocean freight &amp; insurance are quoted separately.
          </p>
        </div>

        {/* ---------- Product selection ---------- */}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <p className="text-sm font-medium flex items-center gap-2">
              <Package className="h-4 w-4" /> Products in the shipment
              {selectedCount > 0 && <Badge variant="secondary">{selectedCount} selected</Badge>}
            </p>
            {!locked && (
              <div className="flex items-center gap-2">
                <Button
                  type="button" variant="outline" size="sm"
                  onClick={() => {
                    invalidate();
                    setSelection((sel) => {
                      const next = { ...sel };
                      visibleProducts.forEach((p) => {
                        if (!next[p._id]) {
                          const w = p.netWeightKg ?? parsePackWeightKg(p.packSize);
                          next[p._id] = { qty: 1, unitWeightKg: w ?? '', netRate: p.netRate };
                        }
                      });
                      return next;
                    });
                  }}
                >
                  Select all
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => { invalidate(); setSelection({}); }} disabled={!selectedCount}>
                  Clear
                </Button>
              </div>
            )}
          </div>
          <div className="relative max-w-md mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search name, SKU or category…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          {loadingProducts ? (
            <TableSkeleton />
          ) : visibleProducts.length === 0 ? (
            <EmptyState icon={Package} title="No products" description="No active products in the FOB cost master." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">FOB rate (₹)</TableHead>
                    <TableHead className="text-right w-24">Qty (packs)</TableHead>
                    <TableHead className="text-right w-28">Unit wt (kg)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grouped.map(([cat, rows]) => (
                    <Fragment key={cat}>
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableCell colSpan={5} className="py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {cat}
                        </TableCell>
                      </TableRow>
                      {rows.map((p) => {
                        const line = selection[p._id];
                        return (
                          <TableRow key={p._id}>
                            <TableCell>
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-primary cursor-pointer"
                                checked={Boolean(line)}
                                disabled={locked}
                                onChange={() => toggleProduct(p)}
                              />
                            </TableCell>
                            <TableCell onClick={() => toggleProduct(p)} className={locked ? '' : 'cursor-pointer'}>
                              <p className="font-medium">{p.productName}</p>
                              <p className="text-xs text-muted-foreground">{p.sku} {p.packSize ? `· ${p.packSize}` : ''}</p>
                            </TableCell>
                            <TableCell className="text-right">
                              {line ? (
                                <Input
                                  type="number" step="any" min="0"
                                  className="h-8 w-24 ml-auto text-right"
                                  value={line.netRate}
                                  disabled={locked}
                                  onChange={(e) => setLine(p._id, 'netRate', e.target.value)}
                                />
                              ) : (
                                <span className="tabular-nums text-muted-foreground">₹{Number(p.netRate).toLocaleString('en-IN')}</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {line && (
                                <Input
                                  type="number" min="1" step="1"
                                  className="h-8 w-20 ml-auto text-right"
                                  value={line.qty}
                                  disabled={locked}
                                  onChange={(e) => setLine(p._id, 'qty', e.target.value)}
                                />
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {line && (
                                <Input
                                  type="number" min="0" step="any" placeholder="kg"
                                  className="h-8 w-24 ml-auto text-right"
                                  value={line.unitWeightKg}
                                  disabled={locked}
                                  onChange={(e) => setLine(p._id, 'unitWeightKg', e.target.value)}
                                />
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* ---------- Terms printed on the rate card ---------- */}
        <div className="space-y-2">
          <Label>Terms &amp; Conditions (one clause per line, printed on the price list)</Label>
          <Textarea
            rows={5}
            value={terms}
            disabled={locked}
            onChange={(e) => onTermsChange(e.target.value)}
          />
        </div>

        {/* ---------- Preview + confirm ---------- */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={compute} disabled={!ready || computing}>
            {computing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
            {computing ? 'Calculating…' : 'Preview rates'}
          </Button>
          {!locked && (
            <Button onClick={() => onConfirm(payload())} disabled={!ready || busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ship className="h-4 w-4" />}
              {busy ? 'Generating…' : 'Confirm shipment & generate kit'}
            </Button>
          )}
          {!ready && (
            <span className="text-sm text-muted-foreground">Pick at least one product to continue.</span>
          )}
        </div>

        {preview && (
          <div className="space-y-3">
            {preview.summary.warnings.map((w) => (
              <Alert key={w} variant="destructive">
                <TriangleAlert className="h-4 w-4" />
                <AlertDescription>{w}</AlertDescription>
              </Alert>
            ))}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">Computed FOB rates · {preview.config.fob?.label} · {preview.config.currency}</p>
              <p className="text-xs text-muted-foreground">
                {preview.config.currency === 'INR'
                  ? 'Base currency (no conversion)'
                  : `1 ${preview.config.currency} = ₹${preview.fx.inrPerUnit} · rate of ${preview.fx.fetchedAt ? new Date(preview.fx.fetchedAt).toLocaleDateString('en-IN') : 'seed values'}`}
              </p>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Wt (kg)</TableHead>
                    <TableHead className="text-right">FOB rate</TableHead>
                    <TableHead className="text-right">Units/carton</TableHead>
                    <TableHead className="text-right">FOB/carton</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.lines.map((l) => (
                    <TableRow key={l.rateItemId}>
                      <TableCell>
                        <p className="font-medium">{l.productName}</p>
                        <p className="text-xs text-muted-foreground">{l.sku} {l.packSize ? `· ${l.packSize}` : ''}</p>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{l.qty}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.unitWeightKg === null ? '—' : (l.unitWeightKg * l.qty).toLocaleString('en-IN')}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold text-primary">{fmtMoney(l.exportRate, preview.config.currency)}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.unitsPerCarton || '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.cartonPrice === null ? '—' : fmtMoney(l.cartonPrice, preview.config.currency)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(l.lineTotal, preview.config.currency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="grid gap-2 sm:max-w-md sm:ml-auto text-sm">
              <div className="flex justify-between gap-4 border-t pt-2 font-semibold">
                <span>Total FOB value</span>
                <span className="tabular-nums">
                  {fmtMoney(preview.summary.grandTotal, preview.config.currency)}
                  {preview.config.currency !== 'INR' && (
                    <span className="text-xs text-muted-foreground ml-1 font-normal">({fmtMoney(preview.summary.grandTotalInr, 'INR')})</span>
                  )}
                </span>
              </div>
              <p className="text-xs text-muted-foreground text-right">{preview.summary.freightLabel}.</p>
              {preview.summary.totalWeightKg !== null && (
                <p className="text-xs text-muted-foreground text-right">
                  Shipment weight: {preview.summary.totalWeightKg.toLocaleString('en-IN')} kg
                  {preview.config.fob ? ` · standard payload ${(preview.config.fob.payloadKg / 1000).toLocaleString('en-IN')} t` : ''}
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
