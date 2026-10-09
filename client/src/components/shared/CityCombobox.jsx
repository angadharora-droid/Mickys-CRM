import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ChevronDown, Loader2, MapPin, Plus } from 'lucide-react';

// One fetch per session — both the create form and the edit form share it.
let citiesPromise = null;
function loadCities() {
  if (!citiesPromise) {
    citiesPromise = api
      .get('/cities')
      .then((res) => res.data.data)
      .catch(() => {
        citiesPromise = null; // allow a retry on the next mount
        return [];
      });
  }
  return citiesPromise;
}

// Same key the server dedupes on: letters only, so case, spacing and
// punctuation never make two entries for one city.
const cityKey = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const tidy = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const titleCase = (s) =>
  tidy(s).replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

const ADD = Symbol('add-city');

/**
 * Searchable city dropdown over the server's city list (all Indian cities,
 * user-added cities, and any city already stored on a lead). Typing filters
 * the list; free text reverts on blur, so every saved lead carries one
 * canonical spelling. A city that isn't listed can be added from the bottom of
 * the list — the server refuses duplicates (any spelling or old name of a
 * listed city selects that city) and asks before adding a near-miss.
 */
export default function CityCombobox({ value, onChange, disabled, placeholder = 'Select city…' }) {
  const [cities, setCities] = useState([]);
  const [text, setText] = useState(value || '');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState(null); // { name, similar } near-miss awaiting a choice
  const rootRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    loadCities().then((list) => mounted && setCities(list));
    return () => { mounted = false; };
  }, []);

  // Follow external value changes (form resets, prefill from suggestions).
  useEffect(() => { setText(value || ''); }, [value]);

  const filtered = useMemo(() => {
    // Matched on the letters-only key, so "kuala-lumpur" finds "Kuala Lumpur".
    const q = cityKey(text);
    // When the field shows the committed value, present the full list rather
    // than a single self-match, so reopening lets the user switch city.
    if (!q || q === cityKey(value)) return cities.slice(0, 60);
    const starts = [];
    const contains = [];
    for (const c of cities) {
      const lc = cityKey(c);
      if (lc.startsWith(q)) starts.push(c);
      else if (lc.includes(q)) contains.push(c);
      if (starts.length >= 60) break;
    }
    return [...starts, ...contains].slice(0, 60);
  }, [cities, text, value]);

  const listed = (s) => cities.find((c) => cityKey(c) === cityKey(s));
  // Offer "Add" only for text that isn't already a listed city in any spelling.
  const canAdd = cityKey(text).length >= 2 && !listed(text);
  const options = canAdd ? [...filtered, ADD] : filtered;

  const commit = (city) => {
    onChange(city);
    setText(city);
    setOpen(false);
    setConfirm(null);
  };

  const addCity = async (force = false) => {
    const name = confirm?.name || tidy(text);
    setAdding(true);
    try {
      const { data } = await api.post('/cities', { name, force });
      const result = data.data;
      if (result.similar) {
        setConfirm({ name: result.name, similar: result.similar });
        setOpen(false);
        return;
      }
      if (!listed(result.city)) {
        const next = [...cities, result.city].sort((a, b) => a.localeCompare(b));
        citiesPromise = Promise.resolve(next); // other city fields this session see it too
        setCities(next);
      }
      commit(result.city);
      toast.success(
        result.created
          ? `Added “${result.city}” to the city list`
          : `“${result.city}” is already on the list — selected it`
      );
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setAdding(false);
    }
  };

  // Only a listed city can be committed (matched in any spelling); anything
  // else falls back to the last committed value (or clears the field).
  const onBlur = () => {
    setOpen(false);
    setConfirm(null);
    if (!tidy(text)) { onChange(''); setText(''); return; }
    const match = listed(text);
    if (match) commit(match);
    else setText(value || '');
  };

  const choose = (opt) => (opt === ADD ? addCity() : commit(opt));

  const onKeyDown = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (options[highlight] && !adding) choose(options[highlight]);
    } else if (e.key === 'Escape') setOpen(false);
  };

  // Clicks inside the dropdown must not blur the input (blur reverts the text).
  const keepFocus = (e) => e.preventDefault();

  return (
    <div className="relative" ref={rootRef}>
      <div className="relative">
        <Input
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          className="pr-8"
          onChange={(e) => { setText(e.target.value); setOpen(true); setHighlight(0); setConfirm(null); }}
          onFocus={() => setOpen(true)}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
        />
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      </div>
      {open && options.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg">
          {options.map((c, i) =>
            c === ADD ? (
              <button
                key="__add"
                type="button"
                disabled={adding}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-left text-sm text-primary hover:bg-muted focus:bg-muted focus:outline-none',
                  filtered.length > 0 && 'mt-1 border-t pt-2',
                  i === highlight && 'bg-muted'
                )}
                onMouseDown={keepFocus}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => addCity()}
              >
                {adding ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <Plus className="h-3.5 w-3.5 shrink-0" />}
                Add “{titleCase(text)}” as a new city
              </button>
            ) : (
              <button
                key={c}
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none',
                  i === highlight && 'bg-muted',
                  c === value && 'font-medium text-primary'
                )}
                onMouseDown={keepFocus}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => commit(c)}
              >
                <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {c}
              </button>
            )
          )}
        </div>
      )}
      {confirm && (
        <div className="mt-1.5 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <p>
            “{confirm.name}” looks like <strong>{confirm.similar}</strong>, which is already on the list.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" onMouseDown={keepFocus} onClick={() => commit(confirm.similar)}>
              Use {confirm.similar}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={adding} onMouseDown={keepFocus} onClick={() => addCity(true)}>
              {adding && <Loader2 className="animate-spin" />}
              Add “{confirm.name}” anyway
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
