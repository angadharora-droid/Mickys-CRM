const mongoose = require('mongoose');

/**
 * Every sales voucher the Tally push has carried — matched to a CRM order or
 * not. The order pipeline only needs the matched ones (they live on the
 * order), but the daily report's "invoiced revenue" has to count every
 * invoice raised in Tally, order number or no order number, or the figure is
 * only as complete as accounts' habit of writing the number.
 *
 * Upsert-only. The push carries the last 60 days on every run, so a voucher
 * is refreshed each time it is seen, but one that stops appearing is kept:
 * the Tally report period (F2) can be narrowed by hand before a manual push,
 * and deleting whatever that push did not carry would wipe real history.
 */
const tallyInvoiceSchema = new mongoose.Schema(
  {
    // Tally's GUID, or voucherNumber|date for exports that carry no GUID.
    key: { type: String, required: true, unique: true },
    guid: { type: String, default: '', index: true },
    voucherNumber: { type: String, default: '', index: true },
    voucherType: { type: String, default: '' },
    date: { type: Date, default: null, index: true },
    party: { type: String, default: '', index: true },
    // As billed (with GST), and the pre-GST basic value the revenue report
    // runs on — chosen from the three figures the TDL sends (kept below so a
    // wrong choice can be seen). basicValue stays 0 for vouchers sent by a
    // TDL without them.
    amount: { type: Number, default: 0 },
    basicValue: { type: Number, default: 0 },
    salesLedgerValue: { type: Number, default: 0 },
    itemValue: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    // The voucher's ledger entries as Tally exploded them, and the CRM's own
    // sums over them (Sales Accounts entries / Duties & Taxes entries).
    ledgerEntries: {
      type: [
        {
          name: { type: String, default: '' },
          group: { type: String, default: '' },
          primaryGroup: { type: String, default: '' },
          amount: { type: Number, default: 0 },
        },
      ],
      default: [],
    },
    entryBasic: { type: Number, default: 0 },
    entryTax: { type: Number, default: 0 },
    reference: { type: String, default: '' },
    narration: { type: String, default: '' },
    orderNos: { type: String, default: '' },
    // CRM order numbers written on the voucher, and the orders that exist.
    orderNumbers: { type: [String], default: [] },
    orders: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SalesOrder' }],
    firstSeenAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('TallyInvoice', tallyInvoiceSchema);
