import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { ROLES } from '@/lib/constants';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import PageHeader from '@/components/shared/PageHeader';
import Pagination from '@/components/shared/Pagination';
import EmptyState from '@/components/shared/EmptyState';
import TableSkeleton from '@/components/shared/TableSkeleton';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Search, ReceiptText, Plus, Download, Pencil, Trash2, Loader2, X, Eye, ExternalLink,
} from 'lucide-react';

const ALL = '__all__';

const STATUS_STYLES = {
  open: 'bg-amber-100 text-amber-800 border-amber-200',
  dispatched: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  cancelled: 'bg-red-100 text-red-700 border-red-200',
};

const qty = (n, unit) => {
  const num = Number(n || 0);
  const s = Number.isInteger(num) ? num.toLocaleString('en-IN') : num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return unit ? `${s} ${unit}` : s;
};

/** Every word of the query must appear in the text, in any order. */
const matchesAllWords = (text, query) => {
  const t = text.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => t.includes(w));
};

/** Names starting with the query rank above mid-word matches. */
const rankByPrefix = (list, query, getName) => {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return [...list].sort(
    (a, b) =>
      Number(getName(b).toLowerCase().startsWith(q)) - Number(getName(a).toLowerCase().startsWith(q))
  );
};

/** The rate the order line would be prefilled with. */
const prefillRate = (s) => s.standardPrice || s.lastSalePrice || s.closingRate || 0;

/**
 * Create/edit dialog — customer from Tally, items from live stock.
 * Keyboard flow mimics Tally voucher entry: Enter advances customer → item →
 * qty → rate → next item, ↑/↓ move in suggestion lists, Esc backs out of a
 * list (not the screen), Ctrl+A accepts/saves.
 */
function OrderDialog({ open, onClose, order, onSaved }) {
  const [customers, setCustomers] = useState([]);
  const [stock, setStock] = useState([]);
  const [customerName, setCustomerName] = useState('');
  const [customerFocus, setCustomerFocus] = useState(false);
  const [customerHl, setCustomerHl] = useState(0);
  const [itemSearch, setItemSearch] = useState('');
  const [itemFocus, setItemFocus] = useState(false);
  const [itemHl, setItemHl] = useState(0);
  const [defaultStock, setDefaultStock] = useState([]); // in-stock list shown before typing
  const itemNav = useRef(false); // true once ↑/↓ used on the current list
  const [lines, setLines] = useState([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const customerRef = useRef(null);
  const itemRef = useRef(null);
  const notesRef = useRef(null);
  const fieldRefs = useRef({}); // "qty-0", "rate-0", …

  // Customers load once per dialog open; items are searched server-side.
  useEffect(() => {
    if (!open) return;
    setCustomerName(order?.customerName || '');
    setLines(
      (order?.items || []).map((i) => ({
        name: i.name, baseUnits: i.baseUnits, qty: String(i.qty), rate: String(i.rate), available: i.stockQtyAtOrder,
      }))
    );
    setNotes(order?.notes || '');
    setItemSearch('');
    setStock([]);
    api.get('/stock/customers').then((r) => setCustomers(r.data.data)).catch(() => {});
    // Tally shows the item list as soon as you land on the field — preload
    // the top in-stock items for the before-you-type list.
    api.get('/stock', { params: { inStock: 'true', limit: 20 } })
      .then((r) => setDefaultStock(r.data.data))
      .catch(() => {});
    // Land on the customer field, like opening a fresh voucher in Tally.
    setTimeout(() => customerRef.current?.focus(), 80);
  }, [open, order]);

  // Debounced stock search against the Tally mirror (list is capped at 100
  // rows per request, so we search instead of loading everything upfront).
  useEffect(() => {
    if (!open) return;
    const q = itemSearch.trim();
    if (!q) { setStock([]); return; }
    const t = setTimeout(() => {
      api.get('/stock', { params: { search: q, limit: 20 } })
        .then((r) => setStock(r.data.data))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [open, itemSearch]);

  const customerMatches = useMemo(() => {
    const q = customerName.trim();
    if (!q) return customers.slice(0, 10);
    const hits = customers.filter((c) => matchesAllWords(`${c.name} ${c.group || ''}`, q));
    return rankByPrefix(hits, q, (c) => c.name).slice(0, 10);
  }, [customers, customerName]);

  // Typed query → server results; empty query + focused field → the
  // preloaded in-stock list (Tally shows the item list before you type).
  const itemMatches = useMemo(() => {
    const q = itemSearch.trim();
    const base = q ? rankByPrefix(stock, q, (s) => s.name) : itemFocus ? defaultStock : [];
    return base.filter((s) => !lines.some((l) => l.name === s.name)).slice(0, 20);
  }, [stock, defaultStock, itemFocus, itemSearch, lines]);

  // Keep list highlights in range as the matches change under them.
  useEffect(() => { setCustomerHl(0); }, [customerName, customers]);
  useEffect(() => { setItemHl(0); itemNav.current = false; }, [itemSearch, stock]);

  const focusField = (key) => setTimeout(() => fieldRefs.current[key]?.focus(), 0);

  /** ↑/↓ over a suggestion list; returns the new highlight for Enter to use. */
  const moveHl = (e, hl, setHl, count) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHl((hl + 1) % count); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHl((hl - 1 + count) % count); }
  };

  const pickCustomer = (name) => {
    setCustomerName(name);
    setCustomerFocus(false);
    itemRef.current?.focus();
  };

  const addLine = (s) => {
    const idx = lines.length;
    setLines((prev) => [
      ...prev,
      {
        name: s.name,
        baseUnits: s.baseUnits,
        qty: '',
        // Selling-rate prefill: maintained standard price, else the rate of
        // the item's last sales voucher, else the stock valuation rate.
        rate: String(prefillRate(s) || ''),
        available: s.closingQty,
      },
    ]);
    setItemSearch('');
    itemNav.current = false;
    focusField(`qty-${idx}`); // Tally flow: item → qty
  };

  const setLine = (idx, patch) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const total = lines.reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);

  const save = async () => {
    const items = lines
      .map((l) => ({ name: l.name, qty: Number(l.qty), rate: Number(l.rate) || 0 }))
      .filter((l) => l.qty > 0);
    if (customerName.trim().length < 2) return toast.error('Pick or type a customer name');
    if (!items.length) return toast.error('Add at least one item with a quantity');

    setSaving(true);
    try {
      const body = { customerName: customerName.trim(), items, notes: notes.trim() };
      const { data } = order?._id
        ? await api.put(`/sales-orders/${order._id}`, body)
        : await api.post('/sales-orders', body);
      toast.success(data.message);
      onSaved();
      onClose();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const suggestionsOpen = itemMatches.length > 0 || (customerFocus && customerMatches.length > 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-2xl max-h-[92dvh] overflow-y-auto"
        // Tally-style Esc: first press backs out of an open list; only a
        // second press (nothing open) closes the voucher screen.
        onEscapeKeyDown={(e) => {
          if (suggestionsOpen) {
            e.preventDefault();
            setItemSearch('');
            setItemFocus(false);
            setCustomerFocus(false);
          }
        }}
        // Ctrl+A = Accept, exactly like saving a voucher in Tally.
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
            e.preventDefault();
            if (!saving) save();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{order?._id ? `Edit ${order.number}` : 'New sales order'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Customer picker: type-ahead over the Tally customer mirror */}
          <div className="relative">
            <p className="text-sm font-medium mb-1.5">Customer</p>
            <Input
              ref={customerRef}
              placeholder="Type to search customers…"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              onFocus={() => setCustomerFocus(true)}
              onBlur={() => setTimeout(() => setCustomerFocus(false), 150)}
              onKeyDown={(e) => {
                const open = customerFocus && customerMatches.length > 0;
                if (open) moveHl(e, customerHl, setCustomerHl, customerMatches.length);
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (open) pickCustomer(customerMatches[customerHl].name);
                  else itemRef.current?.focus(); // free-typed name → next field
                }
              }}
            />
            {customerFocus && customerMatches.length > 0 && (
              <div className="absolute z-50 mt-1 w-full rounded-md border bg-card shadow-lg max-h-56 overflow-y-auto">
                {customerMatches.map((c, i) => (
                  <button
                    key={c._id}
                    type="button"
                    ref={(el) => { if (i === customerHl) el?.scrollIntoView({ block: 'nearest' }); }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-muted ${i === customerHl ? 'bg-muted' : ''}`}
                    onMouseDown={() => pickCustomer(c.name)}
                    onMouseEnter={() => setCustomerHl(i)}
                  >
                    {c.name}
                    {c.group && <span className="text-xs text-muted-foreground ml-2">{c.group}</span>}
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              From Tally (Sundry Debtors). A new name can be typed as-is.
            </p>
          </div>

          {/* Item picker */}
          <div className="relative">
            <p className="text-sm font-medium mb-1.5">Add items</p>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={itemRef}
                placeholder="Search stock items…"
                className="pl-9"
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                onFocus={() => { setItemFocus(true); itemNav.current = false; }}
                onBlur={() => setTimeout(() => setItemFocus(false), 150)}
                onKeyDown={(e) => {
                  if (itemMatches.length > 0) {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') itemNav.current = true;
                    moveHl(e, itemHl, setItemHl, itemMatches.length);
                  }
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    // Blank field + plain Enter = Tally's End of List → notes.
                    // A typed query or an arrowed-to row means "add this item".
                    if (itemMatches.length > 0 && (itemSearch.trim() || itemNav.current)) {
                      addLine(itemMatches[itemHl]);
                    } else if (!itemSearch.trim()) {
                      notesRef.current?.focus();
                    }
                  }
                }}
              />
            </div>
            {itemMatches.length > 0 && (
              <div className="absolute z-50 mt-1 w-full rounded-md border bg-card shadow-lg max-h-56 overflow-y-auto">
                {itemMatches.map((s, i) => (
                  <button
                    key={s._id}
                    type="button"
                    ref={(el) => { if (i === itemHl) el?.scrollIntoView({ block: 'nearest' }); }}
                    className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted ${i === itemHl ? 'bg-muted' : ''}`}
                    onMouseDown={() => addLine(s)}
                    onMouseEnter={() => setItemHl(i)}
                  >
                    <span className="truncate">{s.name}</span>
                    <span className="ml-2 shrink-0 text-right">
                      <span className={`block text-xs ${s.closingQty > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {qty(s.closingQty, s.baseUnits)} in stock
                      </span>
                      {prefillRate(s) > 0 && (
                        <span className="block text-[11px] text-muted-foreground">
                          {formatCurrency(prefillRate(s))}{s.baseUnits ? `/${s.baseUnits}` : ''}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Lines */}
          {lines.length > 0 && (
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={l.name} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-tight truncate">{l.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {l.available == null ? 'Not in stock mirror' : `${qty(l.available, l.baseUnits)} in stock`}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    <div>
                      <p className="text-[11px] text-muted-foreground mb-1">Qty{l.baseUnits ? ` (${l.baseUnits})` : ''}</p>
                      <Input
                        ref={(el) => { fieldRefs.current[`qty-${i}`] = el; }}
                        type="number" min="0" inputMode="decimal" value={l.qty}
                        onChange={(e) => setLine(i, { qty: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusField(`rate-${i}`); } }}
                      />
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground mb-1">Rate (Rs.)</p>
                      <Input
                        ref={(el) => { fieldRefs.current[`rate-${i}`] = el; }}
                        type="number" min="0" inputMode="decimal" value={l.rate}
                        onChange={(e) => setLine(i, { rate: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); itemRef.current?.focus(); } }}
                      />
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground mb-1">Amount</p>
                      <p className="h-10 flex items-center text-sm font-semibold tabular-nums">
                        {formatCurrency((Number(l.qty) || 0) * (Number(l.rate) || 0))}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Notes + total */}
          <div>
            <p className="text-sm font-medium mb-1.5">Notes (optional)</p>
            <Textarea
              ref={notesRef}
              rows={2}
              placeholder="Delivery instructions, payment terms…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              // Tally flow: Enter on the narration accepts the voucher.
              // Shift+Enter still inserts a line break for longer notes.
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (!saving) save();
                }
              }}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-3">
            <p className="text-sm font-medium">Total</p>
            <p className="text-lg font-bold tabular-nums">{formatCurrency(total)}</p>
          </div>
        </div>

        <p className="hidden sm:block text-[11px] text-muted-foreground text-center">
          Enter: next field (saves from Notes) · Shift+Enter: new line · ↑↓: choose from list · Esc: back · <span className="font-medium">Ctrl+A: save</span>
        </p>
        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {order?._id ? 'Save changes' : 'Create order'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function SalesOrders() {
  const { user } = useAuth();
  const isAdmin = user?.role === ROLES.ADMIN;

  const [orders, setOrders] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(ALL);
  const [dialog, setDialog] = useState({ open: false, order: null });
  const [previewFile, setPreviewFile] = useState(null); // { url, filename }

  const canManage = (o) => isAdmin || String(o.createdBy?._id || o.createdBy) === String(user?._id || '');

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 20 };
      if (search) params.search = search;
      if (status !== ALL) params.status = status;
      const { data } = await api.get('/sales-orders', { params });
      setOrders(data.data);
      setMeta(data.meta);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  }, [page, search, status]);

  useEffect(() => {
    const t = setTimeout(fetchOrders, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [fetchOrders, search]);

  const downloadPdf = async (o) => {
    try {
      const res = await api.get(`/sales-orders/${o._id}/pdf`, { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${o.number}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const previewPdf = async (o) => {
    try {
      const res = await api.get(`/sales-orders/${o._id}/pdf`, { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(res.data);
      setPreviewFile((current) => {
        if (current?.url) URL.revokeObjectURL(current.url);
        return { url: blobUrl, filename: `${o.number}.pdf` };
      });
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const closePreview = (open) => {
    if (open) return;
    setPreviewFile((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });
  };

  const changeStatus = async (o, next) => {
    try {
      const { data } = await api.put(`/sales-orders/${o._id}/status`, { status: next });
      toast.success(data.message);
      fetchOrders();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const remove = async (o) => {
    if (!window.confirm(`Delete ${o.number} (${o.customerName})? This cannot be undone.`)) return;
    try {
      const { data } = await api.delete(`/sales-orders/${o._id}`);
      toast.success(data.message);
      fetchOrders();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  return (
    <div>
      <PageHeader title="Sales Orders" description="Create and track sales orders against live Tally stock">
        <Button onClick={() => setDialog({ open: true, order: null })}>
          <Plus className="h-4 w-4" /> New order
        </Button>
      </PageHeader>

      <Card className="p-4 mb-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="relative col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search order no. or customer…"
              className="pl-9"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="dispatched">Dispatched</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card>
        {loading ? (
          <TableSkeleton rows={8} />
        ) : orders.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title={meta?.total === 0 && !search && status === ALL ? 'No sales orders yet' : 'No matching orders'}
            description={
              meta?.total === 0 && !search && status === ALL
                ? 'Create your first order — pick a customer and add items from live Tally stock.'
                : 'Try a different search or filter.'
            }
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">Items</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Booked by</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={o._id}>
                    <TableCell>
                      <p className="font-medium leading-tight whitespace-nowrap">{o.number}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{formatDateTime(o.createdAt)}</p>
                    </TableCell>
                    <TableCell className="max-w-[160px]">
                      <p className="truncate">{o.customerName}</p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums hidden sm:table-cell">{o.items?.length || 0}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{formatCurrency(o.total)}</TableCell>
                    <TableCell>
                      {canManage(o) ? (
                        <Select value={o.status} onValueChange={(v) => changeStatus(o, v)}>
                          <SelectTrigger className={`h-7 w-[122px] text-xs border ${STATUS_STYLES[o.status] || ''}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="open">Open</SelectItem>
                            <SelectItem value="dispatched">Dispatched</SelectItem>
                            <SelectItem value="cancelled">Cancelled</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge className={`border ${STATUS_STYLES[o.status] || ''}`} variant="outline">
                          {o.status}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                      {o.createdBy?.name || '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Preview PDF" onClick={() => previewPdf(o)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Download PDF" onClick={() => downloadPdf(o)}>
                          <Download className="h-4 w-4" />
                        </Button>
                        {canManage(o) && o.status === 'open' && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" onClick={() => setDialog({ open: true, order: o })}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {isAdmin && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:text-red-700" title="Delete" onClick={() => remove(o)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination meta={meta} onPageChange={setPage} />
          </>
        )}
      </Card>

      <OrderDialog
        open={dialog.open}
        order={dialog.order}
        onClose={() => setDialog({ open: false, order: null })}
        onSaved={fetchOrders}
      />

      <Dialog open={Boolean(previewFile)} onOpenChange={closePreview}>
        <DialogContent className="max-w-5xl p-0">
          <DialogHeader className="px-5 pt-5">
            <DialogTitle className="truncate pr-8">{previewFile?.filename || 'PDF Preview'}</DialogTitle>
            {previewFile?.url && (
              <a
                href={previewFile.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-fit items-center gap-1 text-xs text-primary hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Open in new tab
              </a>
            )}
          </DialogHeader>
          {previewFile?.url && (
            <iframe
              title={previewFile.filename}
              src={previewFile.url}
              className="h-[75vh] w-full rounded-b-2xl border-0"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
