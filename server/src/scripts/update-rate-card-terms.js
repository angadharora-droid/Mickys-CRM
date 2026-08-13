/**
 * The export rate-card terms changed (2026-08): the exchange-rate clauses are
 * gone and rate validity is now 48 hours instead of 15 days. Schema defaults
 * only apply when the settings document is first created, and each export
 * lead snapshots its own copy of the terms into customTerms — so both already
 * hold the old wording in production.
 *
 * This rewrites exactly the old default clauses wherever they still appear
 * (global settings + lead customTerms) and leaves any hand-edited wording
 * alone. Idempotent, so it also runs automatically at server boot (see
 * server.js).
 *
 *   node src/scripts/update-rate-card-terms.js
 */
const Setting = require('../models/Setting');
const Lead = require('../models/Lead');

// [old clause, replacement] — '' removes the clause (and its line) entirely.
const CLAUSE_REWRITES = [
  [
    'Rates are valid for 15 days and subject to exchange-rate and statutory-cost changes.',
    'Rates are valid for 48 hours from the card date only.',
  ],
  [
    'Rates are indicative until confirmed by proforma invoice and are valid for 15 days from the card date.',
    'Rates are indicative until confirmed by proforma invoice and are valid for 48 hours from the card date.',
  ],
  ['Exchange rate as printed on this card; final invoicing at the rate prevailing on the invoice date.', ''],
];

function rewriteTerms(text) {
  if (!text) return text;
  let out = text;
  for (const [oldClause, newClause] of CLAUSE_REWRITES) out = out.split(oldClause).join(newClause);
  // Collapse the blank line left behind where a clause was removed.
  return out.replace(/\n{2,}/g, '\n').replace(/^\n+|\n+$/g, '');
}

/** Returns the number of documents updated (settings + leads). */
async function updateRateCardTerms() {
  let touched = 0;

  const settings = await Setting.getGlobal();
  for (const field of ['fobRateCardTerms', 'rateCardTerms']) {
    const next = rewriteTerms(settings.export?.[field]);
    if (next !== settings.export?.[field]) {
      settings.export[field] = next;
      touched += 1;
    }
  }
  if (touched) await settings.save();

  // Export leads snapshot the terms into customTerms when the kit is built;
  // regex narrows the scan to leads that still carry an old clause.
  const leads = await Lead.find({
    'customTerms.termsAndConditions': { $regex: /valid for 15 days|Exchange rate as printed/ },
  })
    .select('customTerms.termsAndConditions')
    .lean();
  for (const lead of leads) {
    const next = rewriteTerms(lead.customTerms.termsAndConditions);
    if (next === lead.customTerms.termsAndConditions) continue;
    await Lead.updateOne({ _id: lead._id }, { $set: { 'customTerms.termsAndConditions': next } });
    touched += 1;
  }

  return touched;
}

if (require.main === module) {
  require('dotenv').config();
  const mongoose = require('mongoose');
  const env = require('../config/env');

  (async () => {
    await mongoose.connect(env.mongoUri);
    const touched = await updateRateCardTerms();
    console.log(
      touched
        ? `[terms] rewrote rate-card terms on ${touched} document(s)`
        : '[terms] every document already carries the new terms'
    );
    await mongoose.disconnect();
  })().catch((err) => {
    console.error('[terms] failed:', err.message);
    process.exit(1);
  });
}

module.exports = { updateRateCardTerms };
