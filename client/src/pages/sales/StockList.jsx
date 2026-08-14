import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import PageHeader from '@/components/shared/PageHeader';
import Pagination from '@/components/shared/Pagination';
import EmptyState from '@/components/shared/EmptyState';
import TableSkeleton from '@/components/shared/TableSkeleton';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Search, Boxes, Upload, Loader2, CalendarDays, Truck, Users } from 'lucide-react';

const ALL = '__all__';

/** "12.5 KG" style display: trim trailing zeros, keep the unit. */
const qty = (n, unit) => {
  const num = Number(n || 0);
  const s = Number.isInteger(num) ? num.toLocaleString('en-IN') : num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return unit ? `${s} ${unit}` : s;
};

/** "2026-08-14" -> "Fri, 14 Aug 2026" */
const dateLabel = (d) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

/** Day-wise opening/closing register built from the daily sync snapshots. */
function DailyView() {
  const [data, setData] = useState(null); // { date, dates, items }
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const fetchDaily = useCallback(async (date) => {
    setLoading(true);
    try {
      const res = await api.get('/stock/daily', { params: date ? { date } : {} });
      setData(res.data.data);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDaily(); }, [fetchDaily]);

  if (loading && !data) return <Card><TableSkeleton rows={10} /></Card>;

  if (!data?.date) {
    return (
      <Card>
        <EmptyState
          icon={CalendarDays}
          title="No day-wise history yet"
          description="It builds up automatically — one snapshot per day, taken from each day's Tally sync. Check back after tomorrow's sync."
        />
      </Card>
    );
  }

  const q = search.trim().toLowerCase();
  const items = data.items.filter(
    (i) => !q || i.name.toLowerCase().includes(q) || (i.group || '').toLowerCase().includes(q)
  );
  const provisional = items.some((i) => !i.settled);

  return (
    <>
      <Card className="p-4 mb-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select value={data.date} onValueChange={(v) => fetchDaily(v)}>
            <SelectTrigger><SelectValue placeholder="Date" /></SelectTrigger>
            <SelectContent>
              {data.dates.map((d) => <SelectItem key={d} value={d}>{dateLabel(d)}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search items…"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </Card>

      <Card>
        {loading ? (
          <TableSkeleton rows={10} />
        ) : items.length === 0 ? (
          <EmptyState icon={CalendarDays} title="No matching items" description="Try a different search." />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="hidden md:table-cell">Group</TableHead>
                  <TableHead className="text-right">Opening</TableHead>
                  <TableHead className="text-right">Closing</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">Change</TableHead>
                  <TableHead className="text-right hidden lg:table-cell">Closing value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const delta = item.closingQty - item.openingQty;
                  return (
                    <TableRow key={item.name}>
                      <TableCell>
                        <p className="font-medium leading-tight">{item.name}</p>
                        <p className="text-xs text-muted-foreground md:hidden mt-0.5">{item.group || 'Ungrouped'}</p>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant="secondary">{item.group || 'Ungrouped'}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {qty(item.openingQty, item.baseUnits)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {qty(item.closingQty, item.baseUnits)}{!item.settled && ' *'}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums hidden sm:table-cell ${delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                        {delta > 0 ? '+' : ''}{qty(delta, item.baseUnits)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums hidden lg:table-cell">
                        {formatCurrency(item.closingValue)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {provisional && (
              <p className="px-4 py-3 text-xs text-muted-foreground border-t">
                * Closing is as of the day's last sync — it settles with the next morning's sync from Tally.
              </p>
            )}
          </>
        )}
      </Card>
    </>
  );
}

/**
 * Vendors (Sundry Creditors) / customers (Sundry Debtors) mirrored from
 * Tally — same shape, so one view serves both tabs.
 */
function LedgerView({ endpoint, icon, singular, plural, tallyGroup }) {
  const Icon = icon;
  const [ledgers, setLedgers] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.get(endpoint)
      .then((res) => setLedgers(res.data.data))
      .catch((err) => { toast.error(apiError(err)); setLedgers([]); });
  }, [endpoint]);

  if (ledgers === null) return <Card><TableSkeleton rows={10} /></Card>;

  if (ledgers.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Icon}
          title={`No ${plural} synced yet`}
          description={`${plural[0].toUpperCase()}${plural.slice(1)} come from the ledgers under ${tallyGroup} in Tally. Load the updated mickys-stock.tdl on the Tally PC, then sync again to bring them in.`}
        />
      </Card>
    );
  }

  const q = search.trim().toLowerCase();
  const filtered = ledgers.filter(
    (l) => !q || l.name.toLowerCase().includes(q) || (l.group || '').toLowerCase().includes(q)
  );

  return (
    <>
      <Card className="p-4 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={`Search ${plural}…`}
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </Card>

      <Card>
        {filtered.length === 0 ? (
          <EmptyState icon={Icon} title={`No matching ${plural}`} description="Try a different search." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{singular}</TableHead>
                <TableHead className="hidden sm:table-cell">Group</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((l) => (
                <TableRow key={l._id}>
                  <TableCell>
                    <p className="font-medium leading-tight">{l.name}</p>
                    <p className="text-xs text-muted-foreground sm:hidden mt-0.5">{l.group || '—'}</p>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge variant="secondary">{l.group || '—'}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}

export default function StockList() {
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState(null);
  const [groups, setGroups] = useState([]);
  const [lastSync, setLastSync] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState(ALL);
  const [stockFilter, setStockFilter] = useState(ALL); // ALL | 'in'
  const [view, setView] = useState('live');
  const fileRef = useRef(null);

  const fetchMetaData = useCallback(async () => {
    try {
      const [groupsRes, summaryRes] = await Promise.all([
        api.get('/stock/groups'),
        api.get('/stock/summary'),
      ]);
      setGroups(groupsRes.data.data);
      setLastSync(summaryRes.data.data.lastSync);
    } catch {
      // Non-fatal: the list itself still loads.
    }
  }, []);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 20 };
      if (search) params.search = search;
      if (group !== ALL) params.group = group;
      if (stockFilter === 'in') params.inStock = 'true';
      const { data } = await api.get('/stock', { params });
      setItems(data.data);
      setMeta(data.meta);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  }, [page, search, group, stockFilter]);

  useEffect(() => {
    fetchMetaData();
  }, [fetchMetaData]);

  useEffect(() => {
    const t = setTimeout(fetchItems, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [fetchItems, search]);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setUploading(true);
    try {
      const xml = await file.text();
      const { data } = await api.post('/stock/sync', { xml });
      toast.success(data.message);
      setPage(1);
      await Promise.all([fetchItems(), fetchMetaData()]);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Stock from Tally"
        description={
          lastSync
            ? `Last synced ${formatDateTime(lastSync.at)} · ${lastSync.itemCount} items (${lastSync.source === 'push' ? 'Tally push' : 'manual upload'})`
            : 'Upload the Mickys Stock Export XML from Tally to bring your inventory in'
        }
      >
        <input ref={fileRef} type="file" accept=".xml,text/xml,application/xml" className="hidden" onChange={handleUpload} />
        <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {uploading ? 'Syncing…' : 'Upload Tally XML'}
        </Button>
      </PageHeader>

      <Tabs value={view} onValueChange={setView}>
        <TabsList className="mb-4">
          <TabsTrigger value="live">Live stock</TabsTrigger>
          <TabsTrigger value="daily">Day-wise</TabsTrigger>
          <TabsTrigger value="vendors">Vendors</TabsTrigger>
          <TabsTrigger value="customers">Customers</TabsTrigger>
        </TabsList>

        <TabsContent value="live">
          <Card className="p-4 mb-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="relative col-span-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search items…"
                  className="pl-9"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                />
              </div>
              <Select value={group} onValueChange={(v) => { setGroup(v); setPage(1); }}>
                <SelectTrigger><SelectValue placeholder="Group" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All groups</SelectItem>
                  {groups.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={stockFilter} onValueChange={(v) => { setStockFilter(v); setPage(1); }}>
                <SelectTrigger><SelectValue placeholder="Availability" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All items</SelectItem>
                  <SelectItem value="in">In stock only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </Card>

          <Card>
            {loading ? (
              <TableSkeleton rows={10} />
            ) : items.length === 0 ? (
              <EmptyState
                icon={Boxes}
                title={meta?.total === 0 && !search && group === ALL && stockFilter === ALL ? 'No stock data yet' : 'No matching items'}
                description={
                  meta?.total === 0 && !search && group === ALL && stockFilter === ALL
                    ? 'Export the report from Tally (Mickys Stock Export → Alt+E → XML) and upload the file here.'
                    : 'Try a different search or filter.'
                }
              />
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="hidden md:table-cell">Group</TableHead>
                      <TableHead className="text-right hidden lg:table-cell">Opening</TableHead>
                      <TableHead className="text-right hidden sm:table-cell">Inward</TableHead>
                      <TableHead className="text-right hidden sm:table-cell">Outward</TableHead>
                      <TableHead className="text-right">Closing</TableHead>
                      <TableHead className="text-right hidden lg:table-cell">Rate</TableHead>
                      <TableHead className="text-right hidden md:table-cell">Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item._id}>
                        <TableCell>
                          <p className="font-medium leading-tight">{item.name}</p>
                          <p className="text-xs text-muted-foreground md:hidden mt-0.5">{item.group || 'Ungrouped'}</p>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <Badge variant="secondary">{item.group || 'Ungrouped'}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums hidden lg:table-cell">
                          {qty(item.openingQty, item.baseUnits)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums hidden sm:table-cell">
                          {qty(item.inwardQty, item.baseUnits)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums hidden sm:table-cell">
                          {qty(item.outwardQty, item.baseUnits)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">
                          {qty(item.closingQty, item.baseUnits)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums hidden lg:table-cell">
                          {item.closingRate
                            ? `${formatCurrency(item.closingRate)}${item.baseUnits ? `/${item.baseUnits}` : ''}`
                            : '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums hidden md:table-cell">
                          {formatCurrency(item.closingValue)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Pagination meta={meta} onPageChange={setPage} />
              </>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="daily">
          <DailyView />
        </TabsContent>

        <TabsContent value="vendors">
          <LedgerView
            endpoint="/stock/vendors"
            icon={Truck}
            singular="Vendor"
            plural="vendors"
            tallyGroup="Sundry Creditors"
          />
        </TabsContent>

        <TabsContent value="customers">
          <LedgerView
            endpoint="/stock/customers"
            icon={Users}
            singular="Customer"
            plural="customers"
            tallyGroup="Sundry Debtors"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
