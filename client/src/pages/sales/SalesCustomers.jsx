import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { ROLES } from '@/lib/constants';
import { formatDateTime } from '@/lib/utils';
import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import TableSkeleton from '@/components/shared/TableSkeleton';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, UserCheck, Plus, Trash2, Loader2, Snowflake, X, Pencil } from 'lucide-react';

/** All appointed-customer details are entered and stored in CAPS. */
const caps = (v) => v.toUpperCase();

/**
 * Appoint/edit form. Reached three ways:
 *  - /sales/customers/new?lead=<id>  → prefilled from a delivered lead's kit
 *  - /sales/customers/new            → blank (manual customer)
 *  - /sales/customers/:id            → edit an appointed customer (re-freeze)
 */
export function SalesCustomerForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const leadId = params.get('lead') || '';
  const navigate = useNavigate();

  const [form, setForm] = useState({ companyName: '', email: '', gstin: '', mobile: '', address: '' });
  const [items, setItems] = useState([]);
  const [frozenAt, setFrozenAt] = useState(null);
  const [loading, setLoading] = useState(Boolean(id || leadId));
  const [saving, setSaving] = useState(false);

  const setField = (key, value, upper = true) =>
    setForm((f) => ({ ...f, [key]: upper ? caps(value) : value }));

  useEffect(() => {
    if (id) {
      api.get(`/sales-customers/${id}`)
        .then(({ data }) => {
          const c = data.data;
          setForm({ companyName: c.companyName, email: c.email, gstin: c.gstin, mobile: c.mobile, address: c.address });
          setItems(c.items.map((i) => ({ ...i, rate: String(i.rate) })));
          setFrozenAt(c.frozenAt);
        })
        .catch((err) => toast.error(apiError(err)))
        .finally(() => setLoading(false));
    } else if (leadId) {
      api.get(`/leads/${leadId}`)
        .then(({ data }) => {
          const lead = data.data;
          setForm({
            companyName: caps(lead.businessName || ''),
            email: caps(lead.email || ''),
            gstin: caps(lead.gstin || ''),
            mobile: lead.mobileNumber || '',
            address: caps([lead.address, lead.city, lead.state].filter(Boolean).join(', ')),
          });
          // The rate list that went out in the kit — netRate is the price
          // stated on the emailed rate card (exclusive of GST).
          setItems(
            (lead.rates || [])
              .filter((r) => r.included !== false)
              .map((r) => ({
                sku: caps(r.sku || ''),
                name: caps(r.productName),
                packSize: caps(r.packSize || ''),
                rate: String(r.netRate ?? ''),
              }))
          );
        })
        .catch((err) => toast.error(apiError(err)))
        .finally(() => setLoading(false));
    }
  }, [id, leadId]);

  const setItem = (idx, patch) => setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const save = async () => {
    const body = {
      ...form,
      leadId: leadId || undefined,
      items: items
        .filter((i) => i.name.trim())
        .map((i) => ({ sku: i.sku, name: i.name, packSize: i.packSize, rate: Number(i.rate) || 0 })),
    };
    if (!body.items.length) return toast.error('Keep at least one item in the rate list');
    setSaving(true);
    try {
      const { data } = id
        ? await api.put(`/sales-customers/${id}`, body)
        : await api.post('/sales-customers', body);
      toast.success(data.message);
      navigate('/sales/customers');
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Card><TableSkeleton rows={8} /></Card>;

  return (
    <div>
      <PageHeader
        title={id ? 'Edit customer' : 'Appoint as customer'}
        description={
          id
            ? `Rates frozen ${frozenAt ? formatDateTime(frozenAt) : ''} — saving freezes them again`
            : 'Review the details and the emailed kit rates, then freeze them'
        }
      >
        <Button variant="outline" onClick={() => navigate('/sales/customers')}>Cancel</Button>
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Snowflake className="h-4 w-4" />}
          {id ? 'Save & re-freeze rates' : 'Freeze rates & appoint'}
        </Button>
      </PageHeader>

      <Card className="p-4 mb-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <p className="text-sm font-medium mb-1.5">Company name *</p>
            <Input className="uppercase" value={form.companyName} onChange={(e) => setField('companyName', e.target.value)} />
          </div>
          <div>
            <p className="text-sm font-medium mb-1.5">Email *</p>
            <Input className="uppercase" value={form.email} onChange={(e) => setField('email', e.target.value)} />
          </div>
          <div>
            <p className="text-sm font-medium mb-1.5">GSTIN</p>
            <Input className="uppercase" value={form.gstin} onChange={(e) => setField('gstin', e.target.value)} />
          </div>
          <div>
            <p className="text-sm font-medium mb-1.5">Mobile *</p>
            <Input inputMode="tel" value={form.mobile} onChange={(e) => setField('mobile', e.target.value, false)} />
          </div>
          <div className="sm:col-span-2">
            <p className="text-sm font-medium mb-1.5">Address *</p>
            <Textarea className="uppercase" rows={2} value={form.address} onChange={(e) => setField('address', e.target.value)} />
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between px-4 pt-4">
          <p className="font-medium">Frozen rate list</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setItems((prev) => [...prev, { sku: '', name: '', packSize: '', rate: '' }])}
          >
            <Plus className="h-4 w-4" /> Add item
          </Button>
        </div>
        {items.length === 0 ? (
          <EmptyState
            icon={Snowflake}
            title="No items"
            description="Appoint from a delivered lead to pull in the emailed kit rates, or add items manually."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="hidden sm:table-cell w-32">Pack</TableHead>
                <TableHead className="text-right w-36">Rate (Rs.)</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Input className="uppercase" value={it.name} onChange={(e) => setItem(i, { name: caps(e.target.value) })} />
                    {it.sku && <p className="text-[11px] text-muted-foreground mt-1">{it.sku}</p>}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Input className="uppercase" value={it.packSize} onChange={(e) => setItem(i, { packSize: caps(e.target.value) })} />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="text-right tabular-nums"
                      type="number" min="0" inputMode="decimal"
                      value={it.rate}
                      onChange={(e) => setItem(i, { rate: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}>
                      <X className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="px-4 py-3 text-xs text-muted-foreground border-t">
          Sales orders for this customer can contain <span className="font-medium">only these items at these rates</span>.
        </p>
      </Card>
    </div>
  );
}

/** Appointed customers list — the rate-frozen customer dashboard. */
export default function SalesCustomers() {
  const { user } = useAuth();
  const isAdmin = user?.role === ROLES.ADMIN;
  const navigate = useNavigate();

  const [customers, setCustomers] = useState(null);
  const [search, setSearch] = useState('');

  const fetchCustomers = useCallback(() => {
    api.get('/sales-customers', { params: search ? { search } : {} })
      .then(({ data }) => setCustomers(data.data))
      .catch((err) => { toast.error(apiError(err)); setCustomers([]); });
  }, [search]);

  useEffect(() => {
    const t = setTimeout(fetchCustomers, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [fetchCustomers, search]);

  const remove = async (c) => {
    if (!window.confirm(`Remove ${c.companyName}? Their frozen rate list will be deleted.`)) return;
    try {
      const { data } = await api.delete(`/sales-customers/${c._id}`);
      toast.success(data.message);
      fetchCustomers();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  return (
    <div>
      <PageHeader title="Customers" description="Appointed customers with frozen rate lists — orders use only these items and rates">
        <Button onClick={() => navigate('/sales/customers/new')}>
          <Plus className="h-4 w-4" /> New customer
        </Button>
      </PageHeader>

      <Card className="p-4 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search company, GSTIN or mobile…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </Card>

      <Card>
        {customers === null ? (
          <TableSkeleton rows={8} />
        ) : customers.length === 0 ? (
          <EmptyState
            icon={UserCheck}
            title={search ? 'No matching customers' : 'No appointed customers yet'}
            description={
              search
                ? 'Try a different search.'
                : 'Open a delivered lead in the CRM and use "Appoint as Customer" to freeze their kit rates.'
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead className="hidden md:table-cell">GSTIN</TableHead>
                <TableHead className="hidden sm:table-cell">Mobile</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="hidden lg:table-cell">Rates frozen</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((c) => (
                <TableRow key={c._id} className="cursor-pointer" onClick={() => navigate(`/sales/customers/${c._id}`)}>
                  <TableCell>
                    <p className="font-medium leading-tight">{c.companyName}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 sm:hidden">{c.mobile}</p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm">{c.gstin || '—'}</TableCell>
                  <TableCell className="hidden sm:table-cell text-sm">{c.mobile}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary">
                      <Snowflake className="h-3 w-3 mr-1" />
                      {c.items?.length || 0}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                    {formatDateTime(c.frozenAt)}
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit / re-freeze" onClick={() => navigate(`/sales/customers/${c._id}`)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {isAdmin && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:text-red-700" title="Remove" onClick={() => remove(c)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
