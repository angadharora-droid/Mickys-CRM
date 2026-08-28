import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { ROLES } from '@/lib/constants';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
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
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Search, ReceiptText, Plus, Download, Pencil, Trash2, Loader2, X, Eye, ExternalLink, Snowflake,
  AlertTriangle, Mail, MoreVertical, Lock, History, PackageCheck, Ban, MessageCircle, CheckCircle2, Undo2,
} from 'lucide-react';

const ALL = '__all__';

const STATUS_STYLES = {
  open: 'bg-amber-100 text-amber-800 border-amber-200',
  confirmed: 'bg-sky-100 text-sky-800 border-sky-200',
  closed: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  cancelled: 'bg-red-100 text-red-700 border-red-200',
};

const STATUS_LABELS = {
  open: 'Open', confirmed: 'Confirmed', closed: 'Closed', cancelled: 'Cancelled',
};

/**
 * Frozen rates run out at the end of their validity day in India, whatever
 * timezone the browser is set to. The server judges that same IST boundary
 * before it accepts an order, so the screen has to agree with it — otherwise an
 * exec types a whole voucher against rates the save then refuses.
 *
 * A customer appointed before validity was recorded carries no date at all:
 * those are grandfathered and keep working.
 */
const IST = 'Asia/Kolkata';
const istDayKey = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: IST });
// Named in IST as well: a date judged on the Indian day must not be printed as
// the day before it on a browser sitting west of India, or the screen and the
// server's refusal would name two different dates.
const istDateLabel = (d) =>
  new Date(d).toLocaleDateString('en-GB', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric' });

const EXPIRING_SOON_DAYS = 30;

const rateValidity = (customer) => {
  if (!customer?.validUntil) return { state: 'none' };
  const today = istDayKey(Date.now());
  const until = istDayKey(customer.validUntil);
  // The whole validity day counts — an order booked on it is still valid.
  if (until < today) return { state: 'expired', until: customer.validUntil };
  const days = Math.round((Date.parse(until) - Date.parse(today)) / 86400000);
  return { state: days <= EXPIRING_SOON_DAYS ? 'soon' : 'valid', until: customer.validUntil, days };
};

const qty = (n, unit) => {
  const num = Number(n || 0);
  const s = Number.isInteger(num) ? num.toLocaleString('en-IN') : num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return unit ? `${s} ${unit}` : s;
};

/**
 * Order lines and stock rows only ever meet through this key. An appointed
 * customer's frozen item names are stored UPPERCASE while Tally's are mixed
 * case, so the raw names never match; the server joins on the same normalised
 * key, and the dialog has to key its availability lookups the same way.
 */
const nameKeyOf = (name) => String(name || '').trim().toUpperCase().replace(/\s+/g, ' ');

/** Something left to sell, nothing left, or oversold. */
const availTone = (n) => (n > 0 ? 'text-emerald-600' : n < 0 ? 'text-red-600' : 'text-amber-600');

/**
 * The server re-checks availability while it saves and reports every line that
 * went past it. It is never a rejection — orders are routinely booked against
 * goods still in production — so by the time this shows, the order is saved.
 */
const warnShortfalls = (warnings) => {
  if (!warnings?.length) return;
  toast.warning(`${warnings.length} item(s) booked beyond available stock`, {
    description: warnings
      .map((w) => `${w.name}: ${qty(w.requested)} ordered, ${qty(w.available)} available (short ${qty(w.short)})`)
      .join(' · '),
    duration: 10000,
  });
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
 *
 * Quantities are promised against availability — Tally's closing stock less
 * what other orders have already committed — not against closing stock, which
 * still counts goods that are spoken for. The order being edited is excluded
 * from its own reservation, so re-saving it unchanged never reads as short.
 */
function OrderDialog({ open, onClose, order, onSaved }) {
  const [customers, setCustomers] = useState([]);
  const [appointed, setAppointed] = useState([]); // rate-frozen customers
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const bookedFor = useRef(null); // the frozen customer this order was booked for
  const [stock, setStock] = useState([]);
  const [customerName, setCustomerName] = useState('');
  const [customerFocus, setCustomerFocus] = useState(false);
  const [customerHl, setCustomerHl] = useState(0);
  const [itemSearch, setItemSearch] = useState('');
  const [itemFocus, setItemFocus] = useState(false);
  const [itemHl, setItemHl] = useState(0);
  const [defaultStock, setDefaultStock] = useState([]); // in-stock list shown before typing
  const [avail, setAvail] = useState({}); // nameKey → availability, excluding this order
  const availDone = useRef(new Set()); // nameKeys the batch lookup has answered
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
    // The stored stockQtyAtOrder/availableAtOrder are an audit record of the
    // last save, not today's position — the lines take their figures from the
    // live lookup below instead.
    setLines(
      (order?.items || []).map((i) => ({
        name: i.name, baseUnits: i.baseUnits, qty: String(i.qty), rate: String(i.rate), packSize: i.packSize,
      }))
    );
    setNotes(order?.notes || '');
    setItemSearch('');
    setStock([]);
    setSelectedCustomer(null);
    bookedFor.current = null;
    setAvail({});
    availDone.current = new Set();
    api.get('/stock/customers').then((r) => setCustomers(r.data.data)).catch(() => {});
    api.get('/sales-customers')
      .then((r) => {
        setAppointed(r.data.data);
        // Editing an order for an appointed customer → restore the frozen link.
        const cid = order?.customer?._id || order?.customer;
        if (cid) {
          bookedFor.current = r.data.data.find((c) => c._id === cid) || null;
          setSelectedCustomer(bookedFor.current);
        }
      })
      .catch(() => {});
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
  // A frozen customer's items are matched locally instead.
  useEffect(() => {
    if (!open || selectedCustomer) return;
    const q = itemSearch.trim();
    if (!q) { setStock([]); return; }
    const t = setTimeout(() => {
      api.get('/stock', { params: { search: q, limit: 20 } })
        .then((r) => setStock(r.data.data))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [open, itemSearch, selectedCustomer]);

  // Availability for every name the dialog can show a figure for: the lines on
  // the voucher, plus a frozen customer's whole price list (their suggestions
  // come from that list, not from a stock search, so they carry no stock data).
  const wantedNames = useMemo(() => {
    const byKey = new Map();
    const want = (name) => {
      const key = nameKeyOf(name);
      if (key && key.length <= 200 && !byKey.has(key)) byKey.set(key, String(name));
    };
    lines.forEach((l) => want(l.name));
    (selectedCustomer?.items || []).forEach((f) => want(f.name));
    return [...byKey.values()];
  }, [lines, selectedCustomer]);

  // One batched request per change rather than one per keystroke, and each
  // name is asked for only once: the figure excludes this order, so it does
  // not move as this order's own quantities are typed.
  useEffect(() => {
    if (!open) return;
    // The endpoint takes 500 names at a time; a longer list is picked up by
    // the next pass, since answering one batch marks it done.
    const done = availDone.current;
    const names = wantedNames.filter((n) => !done.has(nameKeyOf(n))).slice(0, 500);
    if (!names.length) return;
    const t = setTimeout(() => {
      api.post('/stock/availability', { names, excludeOrder: order?._id })
        .then((r) => {
          // A reply that lands after the dialog was reset belongs to another
          // voucher and would carry the wrong order's exclusion.
          if (availDone.current !== done) return;
          names.forEach((n) => done.add(nameKeyOf(n)));
          setAvail((prev) => {
            const next = { ...prev };
            r.data.data.forEach((a) => { next[a.nameKey] = a; });
            return next;
          });
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [open, order, wantedNames, avail]);

  /**
   * Netted availability for a name. A stock row already carries its own
   * reservation figures, so it stands in until the batch lookup — which is the
   * only one that excludes this order — answers for that name.
   */
  const availOf = (name, fallback) => avail[nameKeyOf(name)] || fallback || null;

  // Appointed (rate-frozen) customers list first, then the Tally ledgers.
  const customerMatches = useMemo(() => {
    const q = customerName.trim();
    const apps = (q ? appointed.filter((c) => matchesAllWords(c.companyName, q)) : appointed)
      .map((c) => ({
        kind: 'appointed',
        key: `a-${c._id}`,
        name: c.companyName,
        sub: `${c.items?.length || 0} frozen rates`,
        validity: rateValidity(c),
        data: c,
      }));
    const tally = (q ? customers.filter((c) => matchesAllWords(`${c.name} ${c.group || ''}`, q)) : customers)
      .map((c) => ({ kind: 'tally', key: `t-${c._id}`, name: c.name, sub: c.group || '', data: c }));
    return [
      ...rankByPrefix(apps, q, (e) => e.name),
      ...rankByPrefix(tally, q, (e) => e.name),
    ].slice(0, 10);
  }, [appointed, customers, customerName]);

  // Item source: a frozen customer's own list, matched locally — otherwise
  // typed query → server results; empty query + focused field → the
  // preloaded in-stock list (Tally shows the item list before you type).
  const itemMatches = useMemo(() => {
    const q = itemSearch.trim();
    if (selectedCustomer) {
      const source = q
        ? selectedCustomer.items.filter((f) => matchesAllWords(`${f.name} ${f.packSize || ''}`, q))
        : itemFocus
          ? selectedCustomer.items
          : [];
      return rankByPrefix(source, q, (f) => f.name)
        .filter((f) => !lines.some((l) => l.name === f.name))
        .slice(0, 20);
    }
    const base = q ? rankByPrefix(stock, q, (s) => s.name) : itemFocus ? defaultStock : [];
    return base.filter((s) => !lines.some((l) => l.name === s.name)).slice(0, 20);
  }, [selectedCustomer, stock, defaultStock, itemFocus, itemSearch, lines]);

  // Keep list highlights in range as the matches change under them.
  useEffect(() => { setCustomerHl(0); }, [customerName, customers]);
  useEffect(() => { setItemHl(0); itemNav.current = false; }, [itemSearch, stock]);

  const focusField = (key) => setTimeout(() => fieldRefs.current[key]?.focus(), 0);

  /** ↑/↓ over a suggestion list; returns the new highlight for Enter to use. */
  const moveHl = (e, hl, setHl, count) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHl((hl + 1) % count); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHl((hl - 1 + count) % count); }
  };

  const pickCustomer = (entry) => {
    // Lapsed rates are refused by the server on save, so the voucher is stopped
    // here rather than after a whole order has been typed into it.
    if (entry.kind === 'appointed' && entry.validity.state === 'expired') {
      toast.error(`${entry.name}'s frozen rates expired on ${istDateLabel(entry.validity.until)}`, {
        description: 'Edit the customer on the Customers page to re-freeze the rates with a new validity date before booking for them.',
        duration: 8000,
      });
      return;
    }
    setCustomerName(entry.name);
    setCustomerFocus(false);
    if (entry.kind === 'appointed') {
      const c = entry.data;
      setSelectedCustomer(c);
      // Enforce the freeze on any lines already added: keep only items on the
      // frozen list, at the frozen rate.
      const frozen = new Map(c.items.map((i) => [i.name, i]));
      setLines((prev) => {
        const kept = prev.filter((l) => frozen.has(String(l.name).toUpperCase()));
        if (kept.length !== prev.length) {
          toast.info(`Removed ${prev.length - kept.length} item(s) outside ${c.companyName}'s frozen list`);
        }
        return kept.map((l) => {
          const f = frozen.get(String(l.name).toUpperCase());
          return { ...l, name: f.name, rate: String(f.rate), packSize: f.packSize };
        });
      });
    } else {
      setSelectedCustomer(null);
    }
    itemRef.current?.focus();
  };

  const addLine = (s) => {
    const idx = lines.length;
    const line = selectedCustomer
      ? // Frozen list line: the rate is dictated by the customer's price list.
        { name: s.name, baseUnits: '', qty: '', rate: String(s.rate), packSize: s.packSize }
      : {
          name: s.name,
          baseUnits: s.baseUnits,
          qty: '',
          // Selling-rate prefill: maintained standard price, else the rate of
          // the item's last sales voucher, else the stock valuation rate.
          rate: String(prefillRate(s) || ''),
        };
    // The stock row's figures stand in until the lookup answers, so the new
    // line has something to show the moment it lands.
    if (!selectedCustomer) {
      const key = nameKeyOf(s.name);
      setAvail((prev) => (prev[key] ? prev : { ...prev, [key]: { ...s, nameKey: key } }));
    }
    setLines((prev) => [...prev, line]);
    setItemSearch('');
    itemNav.current = false;
    focusField(`qty-${idx}`); // Tally flow: item → qty
  };

  const setLine = (idx, patch) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const total = lines.reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);

  // An order already on screen for a customer whose rates lapsed since (an edit,
  // or a validity that ran out while the dialog was open) cannot be saved.
  const validity = rateValidity(selectedCustomer);
  const ratesExpired = validity.state === 'expired';

  // Lines that ask for more than is left to sell. An item with no figure —
  // free-typed, or not in the Tally mirror — is never called short, because a
  // shortfall cannot be asserted against a quantity nobody knows.
  const shortfalls = useMemo(() => {
    const byKey = new Map();
    lines.forEach((l) => {
      const key = nameKeyOf(l.name);
      const a = avail[key];
      if (!a || a.availableQty == null) return;
      const seen = byKey.get(key);
      byKey.set(key, {
        name: a.name || l.name,
        baseUnits: a.baseUnits || l.baseUnits,
        requested: (seen?.requested || 0) + (Number(l.qty) || 0),
        available: a.availableQty,
      });
    });
    return [...byKey.values()].filter((s) => s.requested > s.available);
  }, [lines, avail]);

  /** What a line has left to sell, and why it is less than Tally's figure. */
  const lineCaption = (l, a) => {
    const parts = selectedCustomer ? [l.packSize, 'rate frozen'].filter(Boolean) : [];
    if (!a) parts.push('checking availability…');
    else if (a.availableQty == null) parts.push('not in stock mirror');
    else {
      const unit = a.baseUnits || l.baseUnits;
      parts.push(`${qty(a.availableQty, unit)} available`);
      if (a.reservedQty > 0) {
        parts.push(`${qty(a.closingQty, unit)} in Tally, ${qty(a.reservedQty, unit)} on other orders`);
      }
    }
    return parts.join(' · ');
  };

  const save = async () => {
    const items = lines
      .map((l) => ({ name: l.name, qty: Number(l.qty), rate: Number(l.rate) || 0 }))
      .filter((l) => l.qty > 0);
    if (customerName.trim().length < 2) return toast.error('Pick or type a customer name');
    if (!items.length) return toast.error('Add at least one item with a quantity');
    if (ratesExpired) {
      return toast.error(
        `${selectedCustomer.companyName}'s frozen rates expired on ${istDateLabel(validity.until)} — re-freeze them on the Customers page before booking this order`
      );
    }

    setSaving(true);
    try {
      const body = {
        customerName: customerName.trim(),
        customerId: selectedCustomer?._id,
        items,
        notes: notes.trim(),
      };
      const { data } = order?._id
        ? await api.put(`/sales-orders/${order._id}`, body)
        : await api.post('/sales-orders', body);
      toast.success(data.message);
      warnShortfalls(data.data?.warnings);
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
              onChange={(e) => {
                setCustomerName(e.target.value);
                const typed = e.target.value.trim().toUpperCase();
                // Editing the name breaks the frozen-customer link — but typing
                // the booked customer's name back restores it, so correcting a
                // typo cannot quietly turn their order into a free-typed one.
                // The server reads an unchanged name the same way.
                if (selectedCustomer && typed !== selectedCustomer.companyName) {
                  setSelectedCustomer(null);
                } else if (!selectedCustomer && bookedFor.current && typed === bookedFor.current.companyName) {
                  setSelectedCustomer(bookedFor.current);
                }
              }}
              onFocus={() => setCustomerFocus(true)}
              onBlur={() => setTimeout(() => setCustomerFocus(false), 150)}
              onKeyDown={(e) => {
                const open = customerFocus && customerMatches.length > 0;
                if (open) moveHl(e, customerHl, setCustomerHl, customerMatches.length);
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (open) pickCustomer(customerMatches[customerHl]);
                  else itemRef.current?.focus(); // free-typed name → next field
                }
              }}
            />
            {customerFocus && customerMatches.length > 0 && (
              <div className="absolute z-50 mt-1 w-full rounded-md border bg-card shadow-lg max-h-56 overflow-y-auto">
                {customerMatches.map((entry, i) => (
                  <button
                    key={entry.key}
                    type="button"
                    ref={(el) => { if (i === customerHl) el?.scrollIntoView({ block: 'nearest' }); }}
                    className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted ${i === customerHl ? 'bg-muted' : ''}`}
                    onMouseDown={() => pickCustomer(entry)}
                    onMouseEnter={() => setCustomerHl(i)}
                  >
                    <span className={`truncate ${entry.validity?.state === 'expired' ? 'text-red-600 line-through' : ''}`}>
                      {entry.name}
                      {entry.sub && <span className="text-xs text-muted-foreground ml-2">{entry.sub}</span>}
                    </span>
                    {entry.kind === 'appointed' && (
                      entry.validity.state === 'expired' ? (
                        <Badge className="ml-2 shrink-0 border bg-red-100 text-red-700 border-red-200" variant="outline">
                          <AlertTriangle className="h-3 w-3 mr-1" /> RATES EXPIRED
                        </Badge>
                      ) : (
                        <Badge
                          className={`ml-2 shrink-0 border ${entry.validity.state === 'soon' ? 'bg-amber-100 text-amber-800 border-amber-200' : 'bg-sky-100 text-sky-800 border-sky-200'}`}
                          variant="outline"
                        >
                          <Snowflake className="h-3 w-3 mr-1" />
                          {entry.validity.state === 'soon' ? `${entry.validity.days}D LEFT` : 'FROZEN'}
                        </Badge>
                      )
                    )}
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {selectedCustomer
                ? `Rate-frozen customer — this order can contain only their ${selectedCustomer.items?.length || 0} frozen items.`
                : 'Appointed customers (frozen rates) and Tally ledgers. A new name can be typed as-is.'}
            </p>
            {selectedCustomer && validity.state === 'soon' && (
              <p className="text-xs text-amber-700 mt-1">
                These frozen rates expire in {validity.days} day{validity.days === 1 ? '' : 's'}, on {istDateLabel(validity.until)}.
              </p>
            )}
            {selectedCustomer && validity.state === 'none' && (
              <p className="text-xs text-muted-foreground mt-1">No validity recorded on these frozen rates.</p>
            )}
            {/* An order priced at rates the company stopped honouring is far
                costlier than a refused booking, so the save is barred outright. */}
            {ratesExpired && (
              <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
                  <AlertTriangle className="h-4 w-4" />
                  {selectedCustomer.companyName}&rsquo;s frozen rates expired on {istDateLabel(validity.until)}
                </p>
                <p className="mt-1 text-xs text-red-700">
                  This order cannot be saved. Edit the customer on the Customers page — that re-freezes their
                  rates against a new validity date.
                </p>
              </div>
            )}
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
                {itemMatches.map((s, i) => {
                  // A frozen item has no stock figures of its own; a searched
                  // stock row does, and stands in until the lookup answers.
                  const a = selectedCustomer ? availOf(s.name) : availOf(s.name, s);
                  return (
                    <button
                      key={s._id || s.name}
                      type="button"
                      ref={(el) => { if (i === itemHl) el?.scrollIntoView({ block: 'nearest' }); }}
                      className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted ${i === itemHl ? 'bg-muted' : ''}`}
                      onMouseDown={() => addLine(s)}
                      onMouseEnter={() => setItemHl(i)}
                    >
                      <span className="truncate">{s.name}</span>
                      <span className="ml-2 shrink-0 text-right">
                        {a && a.availableQty != null && (
                          <span className={`block text-xs ${availTone(a.availableQty)}`}>
                            {qty(a.availableQty, a.baseUnits || s.baseUnits)} available
                          </span>
                        )}
                        {a?.reservedQty > 0 && (
                          <span className="block text-[11px] text-muted-foreground">
                            {qty(a.closingQty, a.baseUnits || s.baseUnits)} in Tally · {qty(a.reservedQty)} on order
                          </span>
                        )}
                        {selectedCustomer ? (
                          <>
                            {s.packSize && <span className="block text-[11px] text-muted-foreground">{s.packSize}</span>}
                            <span className="block text-xs font-medium">{formatCurrency(s.rate)}</span>
                          </>
                        ) : (
                          prefillRate(s) > 0 && (
                            <span className="block text-[11px] text-muted-foreground">
                              {formatCurrency(prefillRate(s))}{s.baseUnits ? `/${s.baseUnits}` : ''}
                            </span>
                          )
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Lines */}
          {lines.length > 0 && (
            <div className="space-y-2">
              {lines.map((l, i) => {
                const a = availOf(l.name);
                const over = Boolean(a) && a.availableQty != null && (Number(l.qty) || 0) > a.availableQty;
                return (
                  <div key={l.name} className={`rounded-lg border p-3 ${over ? 'border-red-300' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-tight truncate">{l.name}</p>
                        <p className={`text-xs mt-0.5 ${over ? 'text-red-600' : 'text-muted-foreground'}`}>
                          {lineCaption(l, a)}
                          {over && ` · short by ${qty((Number(l.qty) || 0) - a.availableQty, a.baseUnits || l.baseUnits)}`}
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
                          className={over ? 'border-red-500 text-red-600 focus-visible:border-red-500 focus-visible:ring-red-500/20' : undefined}
                          onChange={(e) => setLine(i, { qty: e.target.value })}
                          // Frozen rate = disabled field, so Enter skips it and
                          // goes straight back to the item search.
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              if (selectedCustomer) itemRef.current?.focus();
                              else focusField(`rate-${i}`);
                            }
                          }}
                        />
                      </div>
                      <div>
                        <p className="text-[11px] text-muted-foreground mb-1">
                          Rate (Rs.){selectedCustomer ? ' · frozen' : ''}
                        </p>
                        <Input
                          ref={(el) => { fieldRefs.current[`rate-${i}`] = el; }}
                          type="number" min="0" inputMode="decimal" value={l.rate}
                          disabled={Boolean(selectedCustomer)}
                          title={selectedCustomer ? 'Frozen rate — edit it on the Customers page' : undefined}
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
                  );
              })}
            </div>
          )}

          {/* Shortfalls warn, they never block: goods still in production are
              routinely booked, so the order goes through either way. */}
          {shortfalls.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium text-amber-800">
                <AlertTriangle className="h-4 w-4" />
                {shortfalls.length} item{shortfalls.length > 1 ? 's' : ''} ordered beyond available stock
              </p>
              <ul className="mt-1 space-y-0.5">
                {shortfalls.map((s) => (
                  <li key={s.name} className="text-xs text-amber-800">
                    {s.name} — {qty(s.requested, s.baseUnits)} ordered, {qty(s.available, s.baseUnits)} available
                    <span className="font-medium"> (short {qty(s.requested - s.available, s.baseUnits)})</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] text-amber-700">
                Available = closing stock in Tally minus quantities already committed on other open orders.
                The order can still be saved.
              </p>
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
          <Button onClick={save} disabled={saving || ratesExpired}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {order?._id ? 'Save changes' : 'Create order'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Sends the order PDF to the customer, and shows everything this order has
 * already been mailed to anyone. The automatic send to accounts on confirmation
 * writes to the same history, so one list answers "who has seen this order" —
 * failed sends included, since a mail that did not go is exactly what someone
 * needs to see.
 */
function EmailDialog({ open, order, onClose, onSent }) {
  const [form, setForm] = useState({ to: '', cc: '', subject: '', message: '' });
  const [detail, setDetail] = useState(null);
  const [sending, setSending] = useState(false);

  // The list rows carry the history with sentBy unpopulated; the order itself
  // names who sent each mail, so the dialog reloads it on open.
  const reload = useCallback((id) => {
    api.get(`/sales-orders/${id}`).then((r) => setDetail(r.data.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!open || !order) return;
    setForm({
      // Only an appointed customer has an address on file — an order booked
      // against a free-typed Tally name starts blank and must be typed.
      to: order.customer?.email || '',
      cc: '',
      subject: `Sales order ${order.number} — ${order.customerName}`,
      message: `Thank you for your order. Please find your sales order ${order.number} attached for your records. Do let us know if anything needs correcting.`,
    });
    setDetail(order);
    reload(order._id);
  }, [open, order, reload]);

  const send = async () => {
    if (!form.to.trim()) return toast.error('Type the recipient email address');
    setSending(true);
    try {
      const { data } = await api.post(`/sales-orders/${order._id}/email`, {
        to: form.to.trim(),
        cc: form.cc.trim(),
        subject: form.subject.trim(),
        message: form.message.trim(),
      });
      toast.success(data.message);
      setDetail(data.data);
      onSent();
    } catch (err) {
      toast.error(apiError(err));
      // A refused send is recorded on the order too — reload so it shows up.
      reload(order._id);
    } finally {
      setSending(false);
    }
  };

  const history = [...(detail?.emails || [])].reverse();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Email {order?.number} to the customer</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-sm font-medium mb-1.5">To</p>
              <Input
                type="email"
                placeholder="customer@company.com"
                value={form.to}
                onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))}
              />
              {!order?.customer?.email && (
                <p className="text-xs text-muted-foreground mt-1">
                  No address on file for {order?.customerName} — type one to send.
                </p>
              )}
            </div>
            <div>
              <p className="text-sm font-medium mb-1.5">CC</p>
              <Input
                placeholder="Add more emails, comma-separated"
                value={form.cc}
                onChange={(e) => setForm((f) => ({ ...f, cc: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <p className="text-sm font-medium mb-1.5">Subject</p>
            <Input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} />
          </div>
          <div>
            <p className="text-sm font-medium mb-1.5">Message</p>
            <Textarea
              rows={4}
              value={form.message}
              onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground mt-1">
              The order PDF is attached automatically, and the order number, date and value are added below your note.
            </p>
          </div>

          {history.length > 0 && (
            <div>
              <p className="text-sm font-medium flex items-center gap-2 mb-1.5">
                <History className="h-4 w-4" /> Email history ({history.length})
              </p>
              <ul className="divide-y rounded-lg border">
                {history.map((m, i) => (
                  <li key={i} className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium truncate">{m.subject || '(no subject)'}</p>
                      <Badge
                        className={`shrink-0 border ${m.status === 'failed' ? 'bg-red-100 text-red-700 border-red-200' : 'bg-emerald-100 text-emerald-800 border-emerald-200'}`}
                        variant="outline"
                      >
                        {m.kind === 'accounts' ? 'Accounts' : 'Customer'} · {m.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      To {m.to?.join(', ') || '—'}{m.cc?.length ? ` · CC ${m.cc.join(', ')}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(m.sentAt)}{m.sentBy?.name ? ` · ${m.sentBy.name}` : ''}
                    </p>
                    {m.error && <p className="text-xs text-red-600 mt-0.5">{m.error}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={onClose} disabled={sending}>Close</Button>
          <Button onClick={send} disabled={sending}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Send order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The order as a WhatsApp message: wa.me links carry text only, so the
 * "attached" order is a formatted summary of the voucher rather than the PDF
 * itself — WhatsApp renders the *stars* as bold.
 */
const buildWhatsAppText = (o) => {
  const items = (o?.items || [])
    .map(
      (i, n) =>
        `${n + 1}. ${i.name}\n   ${qty(i.qty, i.baseUnits)} × ${formatCurrency(i.rate)} = ${formatCurrency(
          i.amount != null ? i.amount : (Number(i.qty) || 0) * (Number(i.rate) || 0)
        )}`
    )
    .join('\n');
  return [
    `Hello ${o?.customerName || ''},`,
    '',
    'Thank you for your order! Here are the details:',
    '',
    `*Sales Order ${o?.number || ''}*`,
    `Date: ${formatDate(o?.createdAt)}`,
    '',
    '*Items*',
    items,
    '',
    `*Total: ${formatCurrency(o?.total)}*`,
  ].join('\n');
};

/**
 * A number the wa.me link accepts: digits only, no leading zeros, and a bare
 * 10-digit Indian mobile gets the 91 country code it needs — wa.me refuses
 * numbers without one.
 */
const waNumber = (raw) => {
  const digits = String(raw || '').replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return null;
  return digits.length === 10 ? `91${digits}` : digits;
};

/**
 * Sends the order to the customer's WhatsApp via a wa.me link. The payment
 * link is kept as its own field and appended to the end of the message at
 * send time, so editing either never means retyping the other. The PDF cannot
 * ride along on a wa.me link — the download button here exists so it can be
 * attached by hand in the chat that opens.
 */
function WhatsAppDialog({ open, order, onClose, onDownloadPdf }) {
  const [phone, setPhone] = useState('');
  const [paymentLink, setPaymentLink] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!open || !order) return;
    // Only an appointed customer has a mobile on file — an order booked
    // against a free-typed Tally name starts blank and must be typed.
    setPhone(order.customer?.mobile || '');
    setPaymentLink('');
    setMessage(buildWhatsAppText(order));
  }, [open, order]);

  const send = () => {
    const num = waNumber(phone);
    if (!num || num.length < 10) {
      return toast.error("Type the customer's WhatsApp number", {
        description: 'A 10-digit Indian mobile works as-is; other countries need the country code.',
      });
    }
    const text = paymentLink.trim()
      ? `${message.trim()}\n\nPay online: ${paymentLink.trim()}`
      : message.trim();
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send {order?.number} on WhatsApp</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-sm font-medium mb-1.5">WhatsApp number</p>
              <Input
                type="tel"
                inputMode="tel"
                placeholder="10-digit mobile or with country code"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              {!order?.customer?.mobile && (
                <p className="text-xs text-muted-foreground mt-1">
                  No mobile on file for {order?.customerName} — type one to send.
                </p>
              )}
            </div>
            <div>
              <p className="text-sm font-medium mb-1.5">Payment link (optional)</p>
              <Input
                placeholder="UPI / payment gateway link"
                value={paymentLink}
                onChange={(e) => setPaymentLink(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">Added at the end of the message.</p>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-1.5">Message</p>
            <Textarea
              rows={10}
              className="font-mono text-xs"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            {paymentLink.trim() && (
              <p className="text-xs text-muted-foreground mt-1 break-all">
                Ends with: <span className="font-medium">Pay online: {paymentLink.trim()}</span>
              </p>
            )}
          </div>

          <div className="rounded-lg border bg-muted/50 p-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              WhatsApp links carry text only — to send the PDF too, download it and attach it in the chat.
            </p>
            <Button variant="outline" size="sm" onClick={() => onDownloadPdf(order)}>
              <Download className="h-4 w-4" /> Download PDF
            </Button>
          </div>
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={send}>
            <MessageCircle className="h-4 w-4" /> Open WhatsApp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Read view of one order, opened from its row. Confirming lives HERE and not
 * on the list — an order should be looked at before it is agreed, so the
 * confirm button only exists once the order is open on screen. Un-confirming
 * stays an admin's call, same as everywhere else.
 */
function DetailDialog({ open, order: o, onClose, isAdmin, canManage, onChangeStatus, onEmail, onWhatsApp, onDownloadPdf }) {
  const [busy, setBusy] = useState(false);

  const act = async (next) => {
    setBusy(true);
    await onChangeStatus(o, next);
    setBusy(false);
  };

  if (!o) return null;
  const manage = canManage(o);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap pr-8">
            {o.number}
            <Badge className={`border ${STATUS_STYLES[o.status] || ''}`} variant="outline">
              {o.status === 'confirmed' && <Lock className="h-3 w-3 mr-1" />}
              {STATUS_LABELS[o.status] || o.status}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2 min-w-0">
              <p className="text-xs text-muted-foreground">Customer</p>
              <p className="text-sm font-medium truncate">{o.customerName}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Booked</p>
              <p className="text-sm">{formatDateTime(o.createdAt)}</p>
              {o.createdBy?.name && <p className="text-xs text-muted-foreground">by {o.createdBy.name}</p>}
            </div>
          </div>

          <div className="rounded-lg border divide-y">
            {(o.items || []).map((i) => (
              <div key={i.name} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-tight truncate">{i.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {qty(i.qty, i.baseUnits)} × {formatCurrency(i.rate)}
                    {i.packSize ? ` · ${i.packSize}` : ''}
                  </p>
                </div>
                <p className="text-sm font-semibold tabular-nums shrink-0">
                  {formatCurrency(i.amount != null ? i.amount : (Number(i.qty) || 0) * (Number(i.rate) || 0))}
                </p>
              </div>
            ))}
            <div className="flex items-center justify-between px-3 py-2 bg-muted/50">
              <p className="text-sm font-medium">Total</p>
              <p className="text-base font-bold tabular-nums">{formatCurrency(o.total)}</p>
            </div>
          </div>

          {o.notes && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Notes</p>
              <p className="text-sm whitespace-pre-wrap rounded-lg border p-3">{o.notes}</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => onDownloadPdf(o)}>
              <Download className="h-4 w-4" /> PDF
            </Button>
            <Button variant="outline" size="sm" disabled={o.status === 'cancelled'} onClick={() => onEmail(o)}>
              <Mail className="h-4 w-4" /> Email
            </Button>
            <Button variant="outline" size="sm" disabled={o.status === 'cancelled'} onClick={() => onWhatsApp(o)}>
              <MessageCircle className="h-4 w-4" /> WhatsApp
            </Button>
          </div>

          {manage && o.status === 'open' && (
            <p className="text-xs text-muted-foreground">
              Confirming marks the order as agreed with the customer and locks it against edits.
            </p>
          )}
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Close</Button>
          {isAdmin && o.status === 'confirmed' && (
            <Button variant="outline" onClick={() => act('open')} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
              Re-open for editing
            </Button>
          )}
          {manage && o.status === 'open' && (
            <Button onClick={() => act('confirmed')} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Confirm order
            </Button>
          )}
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
  const [emailDialog, setEmailDialog] = useState({ open: false, order: null });
  const [waDialog, setWaDialog] = useState({ open: false, order: null });
  const [detailDialog, setDetailDialog] = useState({ open: false, order: null });
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

  /**
   * Confirming mails the order to accounts on its own when Settings asks for
   * it, and that send is deliberately allowed to fail without touching the
   * confirmation — so this toast is the only place anyone learns it did not go.
   */
  const reportAccountsEmail = (result) => {
    if (!result || result.reason === 'already-sent') return;
    if (result.sent) {
      toast.success(`Accounts emailed this order — ${result.to.join(', ')}`);
      return;
    }
    toast.warning('Accounts were NOT emailed this order', {
      description: `${result.reason} The order is confirmed either way — send it by hand from the email action.`,
      duration: 12000,
    });
  };

  const changeStatus = async (o, next) => {
    try {
      const { data } = await api.put(`/sales-orders/${o._id}/status`, { status: next });
      toast.success(data.message);
      // Re-opening re-takes the reservation against stock that has moved since.
      warnShortfalls(data.data?.warnings);
      reportAccountsEmail(data.data?.accountsEmail);
      fetchOrders();
      return data.data;
    } catch (err) {
      toast.error(apiError(err));
      return null;
    }
  };

  // Status moves made inside the detail view keep the dialog on screen — the
  // order it shows has to move with them, or a just-confirmed order would
  // still offer its confirm button.
  const changeStatusFromDetail = async (o, next) => {
    const updated = await changeStatus(o, next);
    if (updated) {
      setDetailDialog((d) => (d.order && String(d.order._id) === String(o._id) ? { ...d, order: updated } : d));
    }
  };

  // Closing and cancelling both release the order's hold on stock and lock it
  // for good, so neither sits in the status dropdown alongside the everyday
  // open ↔ confirmed switch.
  const closeOrder = (o) => {
    if (!window.confirm(`Mark ${o.number} as closed? The order locks and stops holding stock — use this once the goods have gone and the invoice is in Tally.`)) return;
    changeStatus(o, 'closed');
  };

  const cancelOrder = (o) => {
    if (!window.confirm(`Cancel ${o.number} (${o.customerName})? The order locks and releases its stock at once.`)) return;
    changeStatus(o, 'cancelled');
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
              <SelectItem value="confirmed">Confirmed</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
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
                  <TableRow
                    key={o._id}
                    className="cursor-pointer"
                    onClick={() => setDetailDialog({ open: true, order: o })}
                  >
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
                      {/* Deliberately a badge, never a control: confirming from
                          the list was a one-click slip on a row nobody had read.
                          The confirm button lives in the detail view the row
                          click opens, so the order is on screen before it can be
                          agreed. */}
                      <Badge
                        className={`border ${STATUS_STYLES[o.status] || ''}`}
                        variant="outline"
                        title={
                          o.status === 'open'
                            ? 'Open — click the row to view and confirm the order'
                            : o.status === 'confirmed'
                              ? 'Confirmed and locked — only an admin can re-open it for editing'
                              : undefined
                        }
                      >
                        {o.status === 'confirmed' && <Lock className="h-3 w-3 mr-1" />}
                        {STATUS_LABELS[o.status] || o.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                      {o.createdBy?.name || '—'}
                    </TableCell>
                    {/* Buttons in this cell act on the order, they never open
                        it — the row click stops at the cell boundary. */}
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Preview PDF" onClick={() => previewPdf(o)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Download PDF" onClick={() => downloadPdf(o)}>
                          <Download className="h-4 w-4" />
                        </Button>
                        {/* Only an open order can be edited; once confirmed the
                            booking stands until an admin re-opens it. */}
                        {canManage(o) && o.status === 'open' ? (
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" onClick={() => setDialog({ open: true, order: o })}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        ) : canManage(o) && o.status === 'confirmed' ? (
                          <span
                            className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground"
                            title="Confirmed and locked — an admin must re-open it before it can be edited"
                          >
                            <Lock className="h-4 w-4" />
                          </span>
                        ) : null}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="More actions">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem onSelect={() => setDetailDialog({ open: true, order: o })}>
                              <ReceiptText /> View order
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={o.status === 'cancelled'}
                              onSelect={() => setEmailDialog({ open: true, order: o })}
                            >
                              <Mail /> Email to customer
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={o.status === 'cancelled'}
                              onSelect={() => setWaDialog({ open: true, order: o })}
                            >
                              <MessageCircle /> Send on WhatsApp
                            </DropdownMenuItem>
                            {canManage(o) && (o.status === 'open' || o.status === 'confirmed') && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={() => closeOrder(o)}>
                                  <PackageCheck /> Mark as closed
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-red-600 focus:text-red-700"
                                  onSelect={() => cancelOrder(o)}
                                >
                                  <Ban /> Cancel order
                                </DropdownMenuItem>
                              </>
                            )}
                            {isAdmin && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-red-600 focus:text-red-700"
                                  onSelect={() => remove(o)}
                                >
                                  <Trash2 /> Delete order
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
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

      <EmailDialog
        open={emailDialog.open}
        order={emailDialog.order}
        onClose={() => setEmailDialog({ open: false, order: null })}
        onSent={fetchOrders}
      />

      <WhatsAppDialog
        open={waDialog.open}
        order={waDialog.order}
        onClose={() => setWaDialog({ open: false, order: null })}
        onDownloadPdf={downloadPdf}
      />

      <DetailDialog
        open={detailDialog.open}
        order={detailDialog.order}
        onClose={() => setDetailDialog({ open: false, order: null })}
        isAdmin={isAdmin}
        canManage={canManage}
        onChangeStatus={changeStatusFromDetail}
        onEmail={(o) => setEmailDialog({ open: true, order: o })}
        onWhatsApp={(o) => setWaDialog({ open: true, order: o })}
        onDownloadPdf={downloadPdf}
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
