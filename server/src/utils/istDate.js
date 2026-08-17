/**
 * The business runs on the Indian calendar day, not on UTC and not on whatever
 * timezone the server happens to boot in. Anything that is a DATE rather than
 * an instant — a stock register day, the last day a frozen rate list may be
 * used — is judged here so every part of the app draws the day boundary in the
 * same place.
 */

/** Business date in IST, e.g. "2026-08-14". */
const istDateKey = (d) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(d));

/**
 * Pins a date the user picked to the IST day they meant. A browser sends the
 * chosen day as an instant (midnight in its own zone), so the raw value can sit
 * either side of UTC midnight; storing the IST day's own midnight makes the
 * stored value read back as the day that was typed.
 */
const istDayStart = (value) => new Date(`${istDateKey(value)}T00:00:00.000Z`);

/**
 * Whether an IST day is already over. Inclusive of the whole day: a deadline of
 * the 14th is still live all through the 14th in India.
 */
const istDayPassed = (value, at = new Date()) => istDateKey(value) < istDateKey(at);

/** Human date for messages and emails, e.g. "14 Aug 2026". */
const istDateLabel = (value) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));

module.exports = { istDateKey, istDayStart, istDayPassed, istDateLabel };
