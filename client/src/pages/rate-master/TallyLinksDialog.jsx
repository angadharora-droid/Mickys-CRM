import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import TableSkeleton from '@/components/shared/TableSkeleton';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Link2, Loader2, Search, Wand2 } from 'lucide-react';

const NONE = '__none__';

const qtyText = (n, unit) => {
  const num = Number(n || 0);
  return `${num.toLocaleString('en-IN', { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}`;
};

/**
 * One row per rate-card SKU: which Tally stock item it is sold as. Card names
 * ("Boiled Toor Dal", 1000 gms) and Tally names ("BOILED TOOR DAL 1KG SFG")
 * differ, so orders booked from a frozen rate list only reach Tally stock
 * through this link. The server pre-selects confident matches; weaker ones
 * are offered in the list for a person to choose.
 */
function LinkRow({ row, value, onChange }) {
  const [search, setSearch] = useState('');
  const [found, setFound] = useState(null);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) { setFound(null); return undefined; }
    const t = setTimeout(() => {
      api.get('/stock', { params: { search: q, limit: 15 } })
        .then((r) => setFound(r.data.data.map((s) => ({
          name: s.name, code: s.code || '', group: s.group || '', closingQty: s.closingQty, baseUnits: s.baseUnits,
        }))))
        .catch(() => setFound([]));
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // The current value stays selectable even when it is not a candidate.
  const options = useMemo(() => {
    const list = [...(found || row.candidates)];
    if (value && !list.some((c) => c.name === value)) list.unshift({ name: value, code: row.tallyCode, group: '' });
    return list;
  }, [found, row.candidates, row.tallyCode, value]);

  const changed = value !== row.tallyItem;

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${changed ? 'border-primary/50 bg-primary/5' : ''}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium leading-tight">
            {row.productName} {row.packSize && <span className="text-muted-foreground font-normal">· {row.packSize}</span>}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            <span className="font-mono">{row.sku}</span> · {row.kitTypes.join(', ')}
            {!row.active && ' · inactive'}
          </p>
        </div>
        {row.tallyItem && !row.linkedInStock && (
          <Badge variant="outline" className="border-red-300 text-red-700">Linked item no longer in Tally</Badge>
        )}
        {!row.tallyItem && value && <Badge variant="outline" className="border-primary/40 text-primary">Suggested</Badge>}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_12rem]">
        <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? '' : v)}>
          <SelectTrigger><SelectValue placeholder="Not linked" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Not linked</SelectItem>
            {options.map((c) => (
              <SelectItem key={c.name} value={c.name}>
                {c.name}
                {c.code ? ` · ${c.code}` : ''}
                {c.closingQty != null ? ` · ${qtyText(c.closingQty, c.baseUnits)}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="pl-8 h-10"
            placeholder="Search Tally…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      {found && found.length === 0 && <p className="text-xs text-muted-foreground">No Tally stock item matches that search.</p>}
      {!found && !row.candidates.length && (
        <p className="text-xs text-muted-foreground">No likely match found. Search Tally by name or code.</p>
      )}
    </div>
  );
}

export default function TallyLinksDialog({ open, onOpenChange }) {
  const [rows, setRows] = useState(null);
  const [values, setValues] = useState({});
  const [filter, setFilter] = useState('');
  const [onlyUnlinked, setOnlyUnlinked] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRows(null);
    api.get('/rate-items/tally-links')
      .then((r) => {
        setRows(r.data.data);
        setValues(Object.fromEntries(r.data.data.map((row) => [row.sku, row.tallyItem || ''])));
      })
      .catch((err) => { toast.error(apiError(err)); onOpenChange(false); });
  }, [open, onOpenChange]);

  const suggestable = (rows || []).filter((r) => !values[r.sku] && r.suggestion);
  const applySuggestions = () => {
    setValues((v) => {
      const next = { ...v };
      suggestable.forEach((r) => { next[r.sku] = r.suggestion.name; });
      return next;
    });
    toast.success(`${suggestable.length} suggested link(s) filled in. Check them, then save.`);
  };

  const changes = (rows || []).filter((r) => (values[r.sku] || '') !== (r.tallyItem || ''));
  const linkedCount = (rows || []).filter((r) => values[r.sku]).length;

  const q = filter.trim().toLowerCase();
  const visible = (rows || []).filter(
    (r) =>
      (!onlyUnlinked || !values[r.sku]) &&
      (!q || `${r.productName} ${r.packSize} ${r.sku}`.toLowerCase().includes(q))
  );

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put('/rate-items/tally-links', {
        links: changes.map((r) => ({ sku: r.sku, tallyItem: values[r.sku] || '' })),
      });
      toast.success(data.message);
      onOpenChange(false);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Link2 className="h-4 w-4" /> Link rate card items to Tally</DialogTitle>
          <DialogDescription>
            Rate card names differ from Tally&rsquo;s stock item names. Pick the Tally item each SKU is sold as. Orders
            booked from a frozen rate list then show and reserve that item&rsquo;s stock. The link is saved by SKU, so it
            applies to every master that carries the SKU.
          </DialogDescription>
        </DialogHeader>

        {!rows ? (
          <TableSkeleton rows={6} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Filter rate items…" value={filter} onChange={(e) => setFilter(e.target.value)} />
              </div>
              <Button type="button" variant={onlyUnlinked ? 'default' : 'outline'} onClick={() => setOnlyUnlinked((v) => !v)}>
                Unlinked only
              </Button>
              <Button type="button" variant="outline" onClick={applySuggestions} disabled={!suggestable.length}>
                <Wand2 className="h-4 w-4" /> Fill {suggestable.length} suggestion{suggestable.length === 1 ? '' : 's'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {linkedCount} of {rows.length} SKUs linked{changes.length ? ` · ${changes.length} unsaved change(s)` : ''}
            </p>
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {visible.map((row) => (
                <LinkRow
                  key={row.sku}
                  row={row}
                  value={values[row.sku] || ''}
                  onChange={(v) => setValues((s) => ({ ...s, [row.sku]: v }))}
                />
              ))}
              {!visible.length && <p className="py-6 text-center text-sm text-muted-foreground">Nothing to show.</p>}
            </div>
          </>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Close</Button>
          <Button type="button" onClick={save} disabled={saving || !changes.length}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save {changes.length || ''} link{changes.length === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
