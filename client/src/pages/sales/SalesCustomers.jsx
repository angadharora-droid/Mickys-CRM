import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { ROLES, DEFAULT_KIT_TERMS } from '@/lib/constants';
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
import {
  Search, UserCheck, Plus, Trash2, Loader2, Snowflake, X, Pencil,
  CalendarCheck, CalendarClock, CalendarOff, CalendarX, AlertTriangle,
} from 'lucide-react';

/** All appointed-customer details are entered and stored in CAPS. */
const caps = (v) => v.toUpperCase();

/**
 * Frozen rates run out at the END of their validity day in India, so the day is
 * drawn in IST here too — the same boundary the server judges bookings on —
 * rather than in whatever timezone the browser happens to sit in.
 */
const IST = 'Asia/Kolkata';
const istDateKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(new Date(d));
const istDateLabel = (d) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d));
const istDaysLeft = (d) =>
  Math.round((Date.parse(`${istDateKey(d)}T00:00:00Z`) - Date.parse(`${istDateKey(new Date())}T00:00:00Z`)) / 86400000);

/** Inside this many days the admin should be re-freezing the rates. */
const EXPIRING_SOON_DAYS = 30;

/**
 * How a customer's rate validity reads. Customers appointed before validity
 * existed carry null — they keep trading, so they are flagged as needing
 * attention rather than shown as broken. Everything expired or close to it is
 * coloured, because this list is how the admin polices the frozen prices.
 */
const validity = (validUntil) => {
  if (!validUntil) {
    return {
      state: 'none',
      icon: CalendarOff,
      label: 'No validity set',
      cls: 'bg-muted text-muted-foreground hover:bg-muted',
    };
  }
  const days = istDaysLeft(validUntil);
  const on = istDateLabel(validUntil);
  if (days < 0) {
    return {
      state: 'expired',
      icon: CalendarX,
      label: 'EXPIRED',
      sub: on,
      title: `Rates expired on ${on}`,
      cls: 'bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-950 dark:text-red-300',
      row: 'bg-red-50/70 dark:bg-red-950/30',
    };
  }
  if (days <= EXPIRING_SOON_DAYS) {
    return {
      state: 'soon',
      icon: CalendarClock,
      label: days === 0 ? 'Expires today' : `Expires in ${days} day${days === 1 ? '' : 's'}`,
      sub: on,
      title: `Rates valid up to and including ${on}`,
      cls: 'bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-300',
      row: 'bg-amber-50/70 dark:bg-amber-950/30',
    };
  }
  return {
    state: 'ok',
    icon: CalendarCheck,
    label: `Valid till ${on}`,
    title: `Rates valid up to and including ${on}`,
    cls: 'bg-muted text-muted-foreground hover:bg-muted',
  };
};

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
  const [terms, setTerms] = useState({ paymentTerms: '', creditPeriod: '', termsAndConditions: '' });
  // The IST day the frozen rates run out on, as the date input's YYYY-MM-DD.
  // Blank on a new appointment and on customers appointed before validity
  // existed — the admin must state it either way, since saving re-freezes.
  const [validUntil, setValidUntil] = useState('');
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
          setTerms({
            paymentTerms: c.terms?.paymentTerms || '',
            creditPeriod: c.terms?.creditPeriod || '',
            termsAndConditions: c.terms?.termsAndConditions || '',
          });
          setValidUntil(c.validUntil ? istDateKey(c.validUntil) : '');
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
            email: (lead.email || '').toLowerCase(),
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
          // The commercial terms the kit went out with — the lead's edited
          // values, else the standard kit-type T&C (same fallback the kit
          // documents themselves use).
          setTerms({
            paymentTerms: lead.customTerms?.paymentTerms || '',
            creditPeriod: lead.customTerms?.creditPeriod || '',
            termsAndConditions:
              lead.customTerms?.termsAndConditions || (DEFAULT_KIT_TERMS[lead.kitType] || []).join('\n'),
          });
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
      validUntil,
      items: items
        .filter((i) => i.name.trim())
        .map((i) => ({ sku: i.sku, name: i.name, packSize: i.packSize, rate: Number(i.rate) || 0 })),
      terms,
    };
    if (!body.items.length) return toast.error('Keep at least one item in the rate list');
    if (!validUntil) return toast.error('Enter the date these frozen rates are valid until');
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

  // Customers are appointed only from delivered leads — a bare /new URL has
  // nothing to freeze, so point back at the Leads CRM.
  if (!id && !leadId) {
    return (
      <div>
        <PageHeader title="Appoint as customer" description="Customers are appointed only from delivered leads" />
        <Card>
          <EmptyState
            icon={UserCheck}
            title="Start from a delivered lead"
            description='Open a delivered lead in the Leads CRM and click "Appoint as Customer" — the company details and the emailed kit rates come across automatically.'
          />
        </Card>
      </div>
    );
  }

  if (loading) return <Card><TableSkeleton rows={8} /></Card>;

  return (
    <div>
      <PageHeader
        title={id ? 'Edit customer' : 'Appoint as customer'}
        description={
          id
            ? `Rates & terms frozen ${frozenAt ? formatDateTime(frozenAt) : ''} — saving freezes them again`
            : 'Review the details, the emailed kit rates and the terms, then freeze them'
        }
      >
        <Button variant="outline" onClick={() => navigate('/sales/customers')}>Cancel</Button>
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Snowflake className="h-4 w-4" />}
          {id ? 'Save & re-freeze' : 'Freeze & appoint'}
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
            <Input
              type="email"
              inputMode="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value.toLowerCase() }))}
            />
          </div>
          <div>
            <p className="text-sm font-medium mb-1.5">GSTIN *</p>
            <Input className="uppercase" maxLength={15} placeholder="15-character GSTIN" value={form.gstin} onChange={(e) => setField('gstin', e.target.value)} />
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
        <div className="px-4 pt-3 sm:flex sm:items-end sm:gap-4">
          <div className="sm:w-56 sm:shrink-0">
            <p className="text-sm font-medium mb-1.5">Rates valid until *</p>
            <Input type="date" min={istDateKey(new Date())} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground mt-2 sm:mt-0 sm:pb-2.5">
            Orders can be booked at these rates up to and including this day, India time. After it, edit this customer to re-freeze the rates with a new date.
          </p>
        </div>
        {validUntil && istDaysLeft(`${validUntil}T00:00:00Z`) < 0 && (
          <p className="mx-4 mt-3 flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            That day has already passed — sales orders for this customer stay blocked until the rates are re-frozen with a later date.
          </p>
        )}
        {id && !validUntil && (
          <p className="mx-4 mt-3 flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            No validity was recorded when this customer was appointed. Set one now — saving re-freezes the rates.
          </p>
        )}
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

      <Card className="p-4 mt-4">
        <p className="font-medium mb-3">Frozen terms &amp; conditions</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <p className="text-sm font-medium mb-1.5">Payment terms</p>
            <Input
              value={terms.paymentTerms}
              onChange={(e) => setTerms((t) => ({ ...t, paymentTerms: e.target.value }))}
            />
          </div>
          <div>
            <p className="text-sm font-medium mb-1.5">Credit period</p>
            <Input
              value={terms.creditPeriod}
              onChange={(e) => setTerms((t) => ({ ...t, creditPeriod: e.target.value }))}
            />
          </div>
          <div className="sm:col-span-2">
            <p className="text-sm font-medium mb-1.5">Terms &amp; conditions (one clause per line)</p>
            <Textarea
              rows={6}
              value={terms.termsAndConditions}
              onChange={(e) => setTerms((t) => ({ ...t, termsAndConditions: e.target.value }))}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Frozen along with the rates and printed on this customer's sales orders.
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

  // Rate lists that have run out, or are about to, are the ones the admin has
  // to act on — counted up front so they are visible without reading the table.
  const rows = (customers || []).map((c) => ({ c, v: validity(c.validUntil) }));
  const expired = rows.filter((r) => r.v.state === 'expired').length;
  const soon = rows.filter((r) => r.v.state === 'soon').length;
  const unset = rows.filter((r) => r.v.state === 'none').length;

  return (
    <div>
      <PageHeader title="Customers" description="Appointed from delivered leads with frozen rate lists — orders use only these items and rates" />

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
        {(expired > 0 || soon > 0 || unset > 0) && (
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {expired > 0 && (
              <Badge className="bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-950 dark:text-red-300">
                <CalendarX className="h-3 w-3 mr-1" />
                {expired} expired
              </Badge>
            )}
            {soon > 0 && (
              <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-300">
                <CalendarClock className="h-3 w-3 mr-1" />
                {soon} expiring within {EXPIRING_SOON_DAYS} days
              </Badge>
            )}
            {unset > 0 && (
              <Badge variant="secondary">
                <CalendarOff className="h-3 w-3 mr-1" />
                {unset} with no validity set
              </Badge>
            )}
            <p className="text-xs text-muted-foreground">Open a customer to re-freeze the rates with a new validity.</p>
          </div>
        )}
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
                <TableHead className="hidden sm:table-cell">Rates valid</TableHead>
                <TableHead className="hidden md:table-cell">GSTIN</TableHead>
                <TableHead className="hidden sm:table-cell">Mobile</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="hidden lg:table-cell">Rates frozen</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ c, v }) => (
                <TableRow
                  key={c._id}
                  className={`cursor-pointer ${v.row || ''}`}
                  onClick={() => navigate(`/sales/customers/${c._id}`)}
                >
                  <TableCell>
                    <p className="font-medium leading-tight">{c.companyName}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 sm:hidden">{c.mobile}</p>
                    <Badge className={`mt-1.5 sm:hidden ${v.cls}`} title={v.title}>
                      <v.icon className="h-3 w-3 mr-1" />
                      {v.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge className={v.cls} title={v.title}>
                      <v.icon className="h-3 w-3 mr-1" />
                      {v.label}
                    </Badge>
                    {v.sub && <p className="text-[11px] text-muted-foreground mt-0.5">{v.sub}</p>}
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
