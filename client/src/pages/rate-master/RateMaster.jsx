import { Fragment, useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import PageHeader from '@/components/shared/PageHeader';
import Pagination from '@/components/shared/Pagination';
import EmptyState from '@/components/shared/EmptyState';
import TableSkeleton from '@/components/shared/TableSkeleton';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChevronDown, ChevronRight, Plus, Search, Tags, Pencil, Trash2 } from 'lucide-react';

const schema = z.object({
  sku: z.string().min(1, 'Required'),
  productName: z.string().min(2, 'Required'),
  packSize: z.string().optional(),
  category: z.string().optional(),
  mrp: z.coerce.number().min(0, 'Must be ≥ 0'),
  netRate: z.coerce.number().min(0, 'Must be ≥ 0'),
  suggestiveMargin: z.coerce.number().min(0).max(100).optional(),
  gst: z.coerce.number().min(0).max(100),
  floorPrice: z.coerce.number().min(0, 'Must be ≥ 0'),
});

const EMPTY = { sku: '', productName: '', packSize: '', category: '', mrp: 0, netRate: 0, suggestiveMargin: 0, gst: 18, floorPrice: 0 };

export default function RateMaster() {
  const [kitType, setKitType] = useState('distributor');
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [saving, setSaving] = useState(false);
  const [expandedRows, setExpandedRows] = useState({});

  const isDistributor = kitType === 'distributor';
  const { register, handleSubmit, reset, formState: { errors } } = useForm({ resolver: zodResolver(schema), defaultValues: EMPTY });

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 10, kitType };
      if (search) params.search = search;
      const { data } = await api.get('/rate-items', { params });
      setItems(data.data);
      setMeta(data.meta);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  }, [page, search, kitType]);

  useEffect(() => {
    const t = setTimeout(fetchItems, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [fetchItems, search]);

  const toggleRow = (id) => setExpandedRows((c) => ({ ...c, [id]: !c[id] }));

  const openCreate = () => { setEditing(null); reset(EMPTY); setDialogOpen(true); };
  const openEdit = (p) => {
    setEditing(p);
    reset({
      sku: p.sku, productName: p.productName, packSize: p.packSize || '', category: p.category || '',
      mrp: p.mrp, netRate: p.netRate, suggestiveMargin: p.suggestiveMargin || 0, gst: p.gst, floorPrice: p.floorPrice,
    });
    setDialogOpen(true);
  };

  const onSubmit = async (values) => {
    setSaving(true);
    try {
      const payload = { ...values, kitType };
      if (editing) {
        await api.put(`/rate-items/${editing._id}`, payload);
        toast.success('Rate updated');
      } else {
        await api.post('/rate-items', payload);
        toast.success('Rate created');
      }
      setDialogOpen(false);
      fetchItems();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    setSaving(true);
    try {
      await api.delete(`/rate-items/${deleting._id}`);
      toast.success('Rate deactivated');
      setDeleting(null);
      fetchItems();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Rate Master" description="Master price lists used to pre-fill kit rate cards">
        <Button onClick={openCreate}><Plus className="h-4 w-4" /> New Rate</Button>
      </PageHeader>

      <Tabs value={kitType} onValueChange={(v) => { setKitType(v); setPage(1); setExpandedRows({}); }} className="mb-4">
        <TabsList>
          <TabsTrigger value="distributor">Distributor</TabsTrigger>
          <TabsTrigger value="institutional">Institutional</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card className="p-4 mb-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search name, SKU or category…" className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
      </Card>

      <Card>
        {loading ? (
          <TableSkeleton />
        ) : items.length === 0 ? (
          <EmptyState icon={Tags} title="No rates yet" description={`Add ${kitType} rates so execs can build kits.`} />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 px-2 lg:hidden" />
                  <TableHead>Product</TableHead>
                  <TableHead className="hidden sm:table-cell">SKU</TableHead>
                  <TableHead className="text-right">MRP</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  {isDistributor && <TableHead className="text-right hidden md:table-cell">Margin</TableHead>}
                  <TableHead className="text-right hidden md:table-cell">Floor</TableHead>
                  <TableHead className="text-right hidden lg:table-cell">GST</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((p) => {
                  const isExpanded = !!expandedRows[p._id];
                  const ExpandIcon = isExpanded ? ChevronDown : ChevronRight;
                  return (
                    <Fragment key={p._id}>
                      <TableRow>
                        <TableCell className="px-2 lg:hidden">
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleRow(p._id)} aria-expanded={isExpanded}>
                            <ExpandIcon className="h-4 w-4" />
                          </Button>
                        </TableCell>
                        <TableCell>
                          <p className="font-medium">{p.productName}</p>
                          <p className="text-xs text-muted-foreground">{p.packSize} {p.category ? `· ${p.category}` : ''}</p>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell font-mono text-xs">{p.sku}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(p.mrp)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{formatCurrency(p.netRate)}</TableCell>
                        {isDistributor && <TableCell className="text-right tabular-nums hidden md:table-cell">{p.suggestiveMargin || 0}%</TableCell>}
                        <TableCell className="text-right tabular-nums hidden md:table-cell text-muted-foreground">{formatCurrency(p.floorPrice)}</TableCell>
                        <TableCell className="text-right tabular-nums hidden lg:table-cell">{p.gst}%</TableCell>
                        <TableCell><Badge variant={p.isActive ? 'secondary' : 'outline'}>{p.isActive ? 'Active' : 'Inactive'}</Badge></TableCell>
                        <TableCell>
                          <div className="flex gap-1 justify-end">
                            <Button variant="ghost" size="icon" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
                            {p.isActive && (
                              <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleting(p)}><Trash2 className="h-4 w-4" /></Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow className="bg-muted/25 hover:bg-muted/25 lg:hidden">
                          <TableCell colSpan={9} className="px-4 py-3">
                            <dl className="grid gap-3 text-sm grid-cols-2 sm:grid-cols-4">
                              <div><dt className="text-xs uppercase text-muted-foreground">Floor</dt><dd className="mt-1 font-medium">{formatCurrency(p.floorPrice)}</dd></div>
                              <div><dt className="text-xs uppercase text-muted-foreground">GST</dt><dd className="mt-1 font-medium">{p.gst}%</dd></div>
                              {isDistributor && <div><dt className="text-xs uppercase text-muted-foreground">Margin</dt><dd className="mt-1 font-medium">{p.suggestiveMargin || 0}%</dd></div>}
                              <div><dt className="text-xs uppercase text-muted-foreground">SKU</dt><dd className="mt-1 font-mono text-xs">{p.sku}</dd></div>
                            </dl>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
            <Pagination meta={meta} onPageChange={setPage} />
          </>
        )}
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Rate' : 'New Rate'} · {isDistributor ? 'Distributor' : 'Institutional'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>SKU *</Label>
                <Input {...register('sku')} disabled={Boolean(editing)} />
                {errors.sku && <p className="text-sm text-destructive">{errors.sku.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Product name *</Label>
                <Input {...register('productName')} />
                {errors.productName && <p className="text-sm text-destructive">{errors.productName.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Pack size</Label>
                <Input placeholder="e.g. 100g" {...register('packSize')} />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Input placeholder="e.g. Biscuits" {...register('category')} />
              </div>
              <div className="space-y-2">
                <Label>MRP (₹) *</Label>
                <Input type="number" step="any" min="0" {...register('mrp')} />
                {errors.mrp && <p className="text-sm text-destructive">{errors.mrp.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Net rate (₹) *</Label>
                <Input type="number" step="any" min="0" {...register('netRate')} />
                {errors.netRate && <p className="text-sm text-destructive">{errors.netRate.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Floor price (₹) *</Label>
                <Input type="number" step="any" min="0" {...register('floorPrice')} />
                {errors.floorPrice && <p className="text-sm text-destructive">{errors.floorPrice.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>GST % *</Label>
                <Input type="number" step="any" min="0" max="100" {...register('gst')} />
                {errors.gst && <p className="text-sm text-destructive">{errors.gst.message}</p>}
              </div>
              {isDistributor && (
                <div className="space-y-2">
                  <Label>Suggestive margin %</Label>
                  <Input type="number" step="any" min="0" max="100" {...register('suggestiveMargin')} />
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Floor price ≤ net rate ≤ MRP. These bound the rates an exec can set when building a kit.</p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create rate'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Deactivate ${deleting?.productName}?`}
        description="It will no longer be loaded into new kits of this type."
        confirmLabel="Deactivate"
        loading={saving}
        onConfirm={onDelete}
      />
    </div>
  );
}
