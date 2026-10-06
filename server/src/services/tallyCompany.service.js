/**
 * Which Tally company may feed the CRM.
 *
 * Every push replaces whole lists — stock items, customer and vendor ledgers,
 * the day's stock register, receipts and production in their windows — so a
 * push from the wrong company does not add to the CRM's picture, it swaps it
 * out: the customers only the right company has vanish until it pushes again
 * (a linked ledger "disappears", then comes back), and stock flips between
 * the two companies' figures. Any company whose name starts with CENTRE POINT
 * passes the basic guard, so an older or second company (last year's books, a
 * legacy company) open in some user's Tally pushes too.
 *
 * Settings.tallyOrders.company names the one company accepted ('' = any
 * CENTRE POINT company, the old behaviour). Compared case-insensitively with
 * whitespace collapsed, since Tally prints the name as typed.
 */
const Setting = require('../models/Setting');
const TallyOrderCall = require('../models/TallyOrderCall');

const CENTRE_POINT = /^CENTRE POINT/i;

const companyKey = (name) => String(name || '').trim().replace(/\s+/g, ' ').toUpperCase();

/**
 * { ok, locked, reason } for a push from `company` ('' when the export did
 * not say). Without a lock an unnamed push is let through, as before; with
 * one it is refused — there is no telling which company sent it.
 */
async function checkCompany(company) {
  const name = String(company || '').trim();
  if (name && !CENTRE_POINT.test(name)) {
    return { ok: false, locked: '', reason: `"${name}" is not CENTRE POINT FOODS — only the Mickys company feeds the CRM` };
  }
  const settings = await Setting.getGlobal();
  const locked = String(settings.tallyOrders?.company || '').trim();
  if (locked && companyKey(name) !== companyKey(locked)) {
    return {
      ok: false,
      locked,
      reason:
        `this push came from "${name || 'an unnamed company'}" — the CRM takes Tally data only from "${locked}" ` +
        '(Sales Settings → Orders into Tally → Tally company). Open that company in Tally.',
    };
  }
  return { ok: true, locked, reason: '' };
}

/**
 * Logs a refused push beside the add-on's other calls (models/TallyOrderCall.js),
 * so the Tally card shows which company tried and why. Never throws.
 */
const recordRefusal = (req, { what, company, reason }) =>
  TallyOrderCall.create({
    kind: 'refused',
    company: String(company || '').trim(),
    note: `${what} refused: ${reason}`,
    userAgent: String(req.headers?.['user-agent'] || '').slice(0, 200),
  }).catch((err) => console.error(`[tally-company] could not record refusal: ${err.message}`));

module.exports = { CENTRE_POINT, companyKey, checkCompany, recordRefusal };
