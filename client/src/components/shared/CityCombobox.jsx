import { useEffect, useMemo, useRef, useState } from 'react';
import api from '@/lib/api';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ChevronDown, MapPin } from 'lucide-react';

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

/**
 * Searchable city dropdown restricted to the server's city list (all Indian
 * cities + any city already stored on a lead). Typing filters the list; only a
 * listed city can be committed — free text reverts on blur, so every saved
 * lead carries one canonical spelling.
 */
export default function CityCombobox({ value, onChange, disabled, placeholder = 'Select city…' }) {
  const [cities, setCities] = useState([]);
  const [text, setText] = useState(value || '');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    loadCities().then((list) => mounted && setCities(list));
    return () => { mounted = false; };
  }, []);

  // Follow external value changes (form resets, prefill from suggestions).
  useEffect(() => { setText(value || ''); }, [value]);

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    // When the field shows the committed value, present the full list rather
    // than a single self-match, so reopening lets the user switch city.
    if (!q || q === String(value || '').toLowerCase()) return cities.slice(0, 60);
    const starts = [];
    const contains = [];
    for (const c of cities) {
      const lc = c.toLowerCase();
      if (lc.startsWith(q)) starts.push(c);
      else if (lc.includes(q)) contains.push(c);
      if (starts.length >= 60) break;
    }
    return [...starts, ...contains].slice(0, 60);
  }, [cities, text, value]);

  const commit = (city) => {
    onChange(city);
    setText(city);
    setOpen(false);
  };

  // Only a listed city can be committed; anything else falls back to the last
  // committed value (or clears the field).
  const onBlur = () => {
    setOpen(false);
    const q = text.trim().toLowerCase();
    if (!q) { onChange(''); setText(''); return; }
    const match = cities.find((c) => c.toLowerCase() === q);
    if (match) commit(match);
    else setText(value || '');
  };

  const onKeyDown = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlight]) commit(filtered[highlight]);
    } else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className="relative" ref={rootRef}>
      <Input
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        className="pr-8"
        onChange={(e) => { setText(e.target.value); setOpen(true); setHighlight(0); }}
        onFocus={() => setOpen(true)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
      />
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      {open && filtered.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg">
          {filtered.map((c, i) => (
            <button
              key={c}
              type="button"
              className={cn(
                'flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none',
                i === highlight && 'bg-muted',
                c === value && 'font-medium text-primary'
              )}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => commit(c)}
            >
              <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
