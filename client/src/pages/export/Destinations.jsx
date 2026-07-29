import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import EmptyState from '@/components/shared/EmptyState';
import TableSkeleton from '@/components/shared/TableSkeleton';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Container, Globe, Pencil, Plus, Trash2 } from 'lucide-react';

const schema = z.object({
  name: z.string().min(2, 'Required'),
  code: z.string().max(3, 'Max 3 letters').optional(),
  cirPercent: z.coerce.number().min(0, 'Must be ≥ 0').max(100),
  partLoadFreightPerKg: z.coerce.number().min(0, 'Must be ≥ 0'),
});

const EMPTY = { name: '', code: '', cirPercent: 0.5, partLoadFreightPerKg: 0 };

/**
 * Export destinations (CIR insurance % + part-load freight per country) and
 * the full-load container / port-cost settings. Read-only for non-admins.
 */
export default function Destinations({ isAdmin }) {
  const [countries, setCountries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [saving, setSaving] = useState(false);

  const [config, setConfig] = useState(null);
  const [containerDraft, setContainerDraft] = useState(null);
  const [savingConfig, setSavingConfig] = useState(false);

  const { register, handleSubmit, reset, formState: { errors } } = useForm({ resolver: zodResolver(schema), defaultValues: EMPTY });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [countriesRes, configRes] = await Promise.all([
        api.get('/export/countries'),
        api.get('/export/config'),
      ]);
      setCountries(countriesRes.data.data);
      setConfig(configRes.data.data);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const openCreate = () => { setEditing(null); reset(EMPTY); setDialogOpen(true); };
  const openEdit = (c) => {
    setEditing(c);
    reset({ name: c.name, code: c.code || '', cirPercent: c.cirPercent, partLoadFreightPerKg: c.partLoadFreightPerKg });
    setDialogOpen(true);
  };

  const onSubmit = async (values) => {
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/export/countries/${editing._id}`, values);
        toast.success('Destination updated');
      } else {
        await api.post('/export/countries', values);
        toast.success('Destination added');
      }
      setDialogOpen(false);
      fetchAll();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    setSaving(true);
    try {
      await api.delete(`/export/countries/${deleting._id}`);
      toast.success('Destination deactivated');
      setDeleting(null);
      fetchAll();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const editContainers = () => {
    setContainerDraft(JSON.parse(JSON.stringify(config.containers)));
  };

  const saveContainers = async () => {
    setSavingConfig(true);
    try {
      await api.put('/settings', { export: { containers: containerDraft } });
      toast.success('Container settings saved');
      setContainerDraft(null);
      fetchAll();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSavingConfig(false);
    }
  };

  const setContainerField = (size, field, value) =>
    setContainerDraft((d) => ({ ...d, [size]: { ...d[size], [field]: value } }));

  return (
    <div className="space-y-4">
      {/* ---------- Countries ---------- */}
      <Card>
        <div className="flex items-center justify-between p-4 pb-0">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">Destination countries</h3>
          </div>
          {isAdmin && <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" /> New destination</Button>}
        </div>
        <div className="p-4">
          {loading ? (
            <TableSkeleton />
          ) : countries.length === 0 ? (
            <EmptyState icon={Globe} title="No destinations yet" description="Add the countries you export to, with their CIR and part-load freight rates." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Country</TableHead>
                  <TableHead className="text-right">CIR (insurance)</TableHead>
                  <TableHead className="text-right">Part-load freight</TableHead>
                  <TableHead>Status</TableHead>
                  {isAdmin && <TableHead className="w-24" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {countries.map((c) => (
                  <TableRow key={c._id}>
                    <TableCell>
                      <p className="font-medium">{c.name}</p>
                      {c.code && <p className="text-xs text-muted-foreground font-mono">{c.code}</p>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.cirPercent}% of goods value</TableCell>
                    <TableCell className="text-right tabular-nums">₹{Number(c.partLoadFreightPerKg).toLocaleString('en-IN')}/kg</TableCell>
                    <TableCell><Badge variant={c.isActive ? 'secondary' : 'outline'}>{c.isActive ? 'Active' : 'Inactive'}</Badge></TableCell>
                    {isAdmin && (
                      <TableCell>
                        <div className="flex gap-1 justify-end">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(c)}><Pencil className="h-4 w-4" /></Button>
                          {c.isActive && (
                            <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleting(c)}><Trash2 className="h-4 w-4" /></Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>

      {/* ---------- Containers / port costs ---------- */}
      {config && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Container className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold text-sm">Full-load containers</h3>
            </div>
            {isAdmin && !containerDraft && (
              <Button size="sm" variant="outline" onClick={editContainers}><Pencil className="h-4 w-4" /> Edit</Button>
            )}
          </div>

          {!containerDraft ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(config.containers).map(([size, c]) => (
                <div key={size} className="rounded-lg border p-3">
                  <p className="font-medium">{c.label}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Capacity {c.capacityTonsMin}–{c.capacityTonsMax} ton · Port transportation ₹{Number(c.portTransportInr).toLocaleString('en-IN')}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {Object.entries(containerDraft).map(([size, c]) => (
                  <div key={size} className="rounded-lg border p-3 space-y-3">
                    <div className="space-y-2">
                      <Label>Label</Label>
                      <Input value={c.label} onChange={(e) => setContainerField(size, 'label', e.target.value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Capacity min (t)</Label>
                        <Input type="number" step="any" min="0" value={c.capacityTonsMin} onChange={(e) => setContainerField(size, 'capacityTonsMin', e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>Capacity max (t)</Label>
                        <Input type="number" step="any" min="0" value={c.capacityTonsMax} onChange={(e) => setContainerField(size, 'capacityTonsMax', e.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Port transportation (₹)</Label>
                      <Input type="number" step="any" min="0" value={c.portTransportInr} onChange={(e) => setContainerField(size, 'portTransportInr', e.target.value)} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setContainerDraft(null)} disabled={savingConfig}>Cancel</Button>
                <Button onClick={saveContainers} disabled={savingConfig}>{savingConfig ? 'Saving…' : 'Save containers'}</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ---------- Country dialog ---------- */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : 'New destination'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Country name *</Label>
                <Input placeholder="e.g. United Arab Emirates" {...register('name')} />
                {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Code</Label>
                <Input placeholder="e.g. AE" maxLength={3} {...register('code')} />
                {errors.code && <p className="text-sm text-destructive">{errors.code.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>CIR — insurance % of goods value *</Label>
                <Input type="number" step="any" min="0" max="100" {...register('cirPercent')} />
                {errors.cirPercent && <p className="text-sm text-destructive">{errors.cirPercent.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Part-load freight (₹ per kg) *</Label>
                <Input type="number" step="any" min="0" {...register('partLoadFreightPerKg')} />
                {errors.partLoadFreightPerKg && <p className="text-sm text-destructive">{errors.partLoadFreightPerKg.message}</p>}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              CIR is applied to the shipment&rsquo;s goods value on every card for this destination. The per-kg rate only
              applies to part-load shipments.
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add destination'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Deactivate ${deleting?.name}?`}
        description="It will no longer be selectable as an export destination."
        confirmLabel="Deactivate"
        loading={saving}
        onConfirm={onDelete}
      />
    </div>
  );
}
