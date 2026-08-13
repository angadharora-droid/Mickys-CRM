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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Search, Boxes, Upload, Loader2 } from 'lucide-react';

const ALL = '__all__';

/** "12.5 KG" style display: trim trailing zeros, keep the unit. */
const qty = (n, unit) => {
  const num = Number(n || 0);
  const s = Number.isInteger(num) ? num.toLocaleString('en-IN') : num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return unit ? `${s} ${unit}` : s;
};

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
    </div>
  );
}
