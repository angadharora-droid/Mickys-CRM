import { useEffect, useRef } from 'react';

/** The Tally add-on pushes every 10 minutes; the Sales pages re-read as often. */
export const AUTO_REFRESH_MS = 10 * 60 * 1000;

/**
 * Re-runs a page's loader every 10 minutes while the page is open, so the
 * Sales module shows what Tally pushed since (invoices, customer ledgers,
 * stock) and what colleagues changed, without a browser reload.
 *
 * The loader is called as refresh({ silent: true }): it should keep the rows
 * already on screen (no skeleton) and stay quiet if the request fails — the
 * next beat tries again. A beat that falls while the tab is hidden is made up
 * the moment the tab is shown again. `paused` holds the refresh while
 * something open on the page (a form fed from the loaded data) would be reset
 * by fresh data.
 */
export default function useAutoRefresh(refresh, { paused = false } = {}) {
  const refreshRef = useRef(refresh);
  const pausedRef = useRef(paused);
  useEffect(() => {
    refreshRef.current = refresh;
    pausedRef.current = paused;
  });

  useEffect(() => {
    let last = Date.now();
    const run = () => {
      if (document.hidden || pausedRef.current) return;
      last = Date.now();
      refreshRef.current?.({ silent: true });
    };
    const timer = setInterval(run, AUTO_REFRESH_MS);
    const onVisible = () => {
      if (!document.hidden && Date.now() - last >= AUTO_REFRESH_MS) run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}
