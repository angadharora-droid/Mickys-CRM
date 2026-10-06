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
 * more than one instance.
 *
 * Per process. A task that fails does not hold up the ones behind it.
 */
let tail = Promise.resolve();

function runTallyPush(task) {
  const run = tail.then(task, task);
  tail = run.catch(() => {});
  return run;
}

module.exports = { runTallyPush };
