/**
 * Runs the Tally pushes (stock sync, day-end sync) one at a time, in arrival
 * order.
 *
 * Each push mirrors Tally: it stamps every row it carries, then deletes the
 * rows left with an older stamp. Two pushes overlapping — several users on the
 * hosted Tally each run the add-on's 10-minute timer, and opening the company
 * or Ctrl+F10 pushes too — interleave those steps: the slower push re-stamps
 * rows with its older time just before the faster one clears everything older
 * than its own, and customers, stock items and vouchers vanish until the next
 * push. Queuing the pushes removes the overlap; the stamps are also written
 * with $max (never lowered) as a second guard should the backend ever run on
 * more than one instance — the same guard keeps a push safe when the queue
 * stops waiting below.
 *
 * A push waits for the one before it for at most MAX_WAIT_MS: one that never
 * finishes (a database call that hangs) must not stop every later push, which
 * would read on the Tally side as "the CRM takes no data at all".
 *
 * Per process. A task that fails does not hold up the ones behind it.
 */
const MAX_WAIT_MS = 60 * 1000;

let tail = Promise.resolve();

function runTallyPush(task) {
  const previous = tail;
  let timer;
  const turn = Promise.race([
    previous,
    new Promise((resolve) => {
      timer = setTimeout(() => {
        console.warn(`[tally-push] previous push still running after ${MAX_WAIT_MS / 1000}s — not waiting any longer`);
        resolve();
      }, MAX_WAIT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
  const run = turn.then(task, task);
  tail = run.catch(() => {});
  return run;
}

module.exports = { runTallyPush, MAX_WAIT_MS };
