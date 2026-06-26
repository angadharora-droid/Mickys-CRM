/**
 * One-time backfill of the per-lead email log from the legacy `delivery` record.
 *
 * The app now keeps an append-only `emailLog` on each lead capturing exactly what
 * was emailed (recipients, subject, body, attachments). Sends made before this
 * feature existed only left the small `delivery` summary (recipient, date,
 * messageId) — the original subject and body were never stored. This script
 * creates one reconstructed log entry per already-emailed lead from that summary
 * so past sends still appear in the in-app log.
 *
 * Reconstructed entries carry:
 *   - accurate recipient, send date, status, messageId and attachment names,
 *   - the fixed CC (angadh.arora@cpgh.in) that every kit email always included,
 *   - the default subject (the original, if customised, wasn't recorded),
 *   - a blank body, and `reconstructed: true` so the UI flags them as such.
 *
 * Idempotent: leads that already have any emailLog entry are skipped.
 *
 * Usage:
 *   node src/scripts/backfill-email-log.js          # dry run (reports, no changes)
 *   node src/scripts/backfill-email-log.js --apply  # write reconstructed entries
 */
const mongoose = require('mongoose');
const env = require('../config/env');
const Lead = require('../models/Lead');

// The address every kit email is always CC'd to (see lead.controller FIXED_KIT_CC).
const FIXED_KIT_CC = 'angadh.arora@cpgh.in';
const APPLY = process.argv.includes('--apply');

async function run() {
  await mongoose.connect(env.mongoUri);
  console.log(
    `[backfill-email-log] connected to ${mongoose.connection.name} (${APPLY ? 'APPLY' : 'DRY RUN'})`
  );

  // Emailed leads that don't yet have a log entry.
  const leads = await Lead.find({
    'delivery.method': 'email',
    'delivery.sentAt': { $ne: null },
    $or: [{ emailLog: { $exists: false } }, { emailLog: { $size: 0 } }],
  }).select('refNumber businessName email delivery generatedFiles assignedExecId modifiedBy');

  console.log(`[backfill-email-log] ${leads.length} emailed lead(s) without a log entry`);

  let written = 0;
  for (const lead of leads) {
    const d = lead.delivery || {};
    const entry = {
      to: d.sentTo || lead.email || '',
      cc: [FIXED_KIT_CC],
      bcc: [],
      subject: `Micky's Sales Kit for ${lead.businessName} — Ref: ${lead.refNumber}`,
      message: '',
      bodyHtml: '',
      attachments: (lead.generatedFiles || []).map((f) => f.fileName),
      provider: '',
      status: d.status || 'sent',
      messageId: d.messageId || '',
      sentBy: lead.modifiedBy || lead.assignedExecId || null,
      reconstructed: true,
      // Preserve the original send time as the entry's timestamp.
      createdAt: d.sentAt,
      updatedAt: d.sentAt,
    };
    console.log(`  ${lead.refNumber}: ${entry.to} on ${new Date(d.sentAt).toISOString()}`);
    if (APPLY) {
      // Raw $push bypasses subdocument-timestamp middleware, so the supplied
      // createdAt (original send date) is written verbatim instead of "now".
      await Lead.updateOne({ _id: lead._id }, { $push: { emailLog: entry } });
      written += 1;
    }
  }

  console.log(
    `[backfill-email-log] ${
      APPLY ? `wrote ${written} entry(ies)` : 'DRY RUN — re-run with --apply to write entries'
    }`
  );
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
