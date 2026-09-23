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

/**
 * One row per appointed customer: which Tally ledger (Sundry Debtors) is this
 * customer. The CRM name comes from the lead and seldom matches Tally's
 * spelling, so the link is made by hand once. Confident name matches are
 * offered as suggestions; nothing is linked until it is saved.
 */
function LinkRow({ row, value, onChange }) {
  const [search, setSearch] = useState('');
  const [found, setFound] = useState(null);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) { setFound(null); return undefined; }
    const t = setTimeout(() => {
      api.get('/stock/customers', { params: { search: q } })
        .then((r) => setFound(r.data.data.slice(0, 20).map((l) => ({ name: l.name, group: l.group || '' }))))
        .catch(() => setFound([]));
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const options = useMemo(() => {
    const list = [...(found || row.candidates)];
    if (value && !list.some((c) => c.name === value)) list.unshift({ name: value, group: '' });
    return list;
  }, [found, row.candidates, value]);

  const changed = value !== row.tallyLedger;

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${changed ? 'border-primary/50 bg-primary/5' : ''}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium leading-tight">{row.companyName}</p>
          {row.gstin && <p className="text-xs text-muted-foreground mt-0.5 font-mono">{row.gstin}</p>}
        </div>
        {row.tallyLedger && !row.linkedInTally && (
          <Badge variant="outline" className="border-red-300 text-red-700">Linked ledger no longer in Tally</Badge>
        )}
        {!row.tallyLedger && value && <Badge variant="outline" className="border-primary/40 text-primary">Suggested</Badge>}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_12rem]">
        <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? '' : v)}>
          <SelectTrigger><SelectValue placeholder="Not linked" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Not linked</SelectItem>
            {options.map((c) => (
              <SelectItem key={c.name} value={c.name}>
                {c.name}{c.group ? ` · ${c.group}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input className="pl-8 h-10" placeholder="Search Tally…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      {found && found.length === 0 && <p className="text-xs text-muted-foreground">No Sundry Debtors ledger matches that search.</p>}
      {!found && !row.candidates.length && (
        <p className="text-xs text-muted-foreground">
          No likely ledger found. Search Tally, or create the ledger in Tally first; it appears here after the next sync.
        </p>
      )}
    </div>
  );
}

export default function CustomerLinksDialog({ open, onOpenChange, onSaved }) {
  const [rows, setRows] = useState(null);
  const [values, setValues] = useState({});
  const [filter, setFilter] = useState('');
  const [onlyUnlinked, setOnlyUnlinked] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRows(null);
    api.get('/sales-customers/tally-links')
      .then((r) => {
        setRows(r.data.data);
        setValues(Object.fromEntries(r.data.data.map((row) => [row.id, row.tallyLedger || ''])));
      })
      .catch((err) => { toast.error(apiError(err)); onOpenChange(false); });
  }, [open, onOpenChange]);

  const suggestable = (rows || []).filter((r) => !values[r.id] && r.suggestion);
  const applySuggestions = () => {
    setValues((v) => {
      const next = { ...v };
      suggestable.forEach((r) => { next[r.id] = r.suggestion.name; });
      return next;
    });
    toast.success(`${suggestable.length} suggested link(s) filled in. Check them, then save.`);
  };

  const changes = (rows || []).filter((r) => (values[r.id] || '') !== (r.tallyLedger || ''));
  const linkedCount = (rows || []).filter((r) => values[r.id]).length;

  // The same ledger picked for two customers is almost certainly a slip.
  const dupes = useMemo(() => {
    const seen = new Map();
    Object.values(values).filter(Boolean).forEach((v) => seen.set(v, (seen.get(v) || 0) + 1));
    return [...seen.entries()].filter(([, n]) => n > 1).map(([v]) => v);
  }, [values]);

  const q = filter.trim().toLowerCase();
  const visible = (rows || []).filter(
    (r) => (!onlyUnlinked || !values[r.id]) && (!q || `${r.companyName} ${r.gstin}`.toLowerCase().includes(q))
  );

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put('/sales-customers/tally-links', {
        links: changes.map((r) => ({ id: r.id, tallyLedger: values[r.id] || '' })),
      });
      toast.success(data.message);
      onOpenChange(false);
      onSaved?.();
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
          <DialogTitle className="flex items-center gap-2"><Link2 className="h-4 w-4" /> Link customers to Tally ledgers</DialogTitle>
          <DialogDescription>
            Pick each customer&rsquo;s own ledger from Tally&rsquo;s Sundry Debtors. Their orders are sent to Tally
            against that ledger. A customer with no ledger in Tally yet stays unlinked until accounts create it there.
          </DialogDescription>
        </DialogHeader>

        {!rows ? (
          <TableSkeleton rows={6} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Filter customers…" value={filter} onChange={(e) => setFilter(e.target.value)} />
              </div>
              <Button type="button" variant={onlyUnlinked ? 'default' : 'outline'} onClick={() => setOnlyUnlinked((v) => !v)}>
                Unlinked only
              </Button>
              <Button type="button" variant="outline" onClick={applySuggestions} disabled={!suggestable.length}>
                <Wand2 className="h-4 w-4" /> Fill {suggestable.length} suggestion{suggestable.length === 1 ? '' : 's'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {linkedCount} of {rows.length} customers linked{changes.length ? ` · ${changes.length} unsaved change(s)` : ''}
            </p>
            {dupes.length > 0 && (
              <p className="text-xs text-red-600">Linked to more than one customer: {dupes.join(', ')}</p>
            )}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {visible.map((row) => (
                <LinkRow
                  key={row.id}
                  row={row}
                  value={values[row.id] || ''}
                  onChange={(v) => setValues((s) => ({ ...s, [row.id]: v }))}
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
