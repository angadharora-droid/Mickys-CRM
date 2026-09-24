const mongoose = require('mongoose');

/**
 * One call from the Tally side of the order sync (services/tallyOrder.service.js):
 * a report of the sales orders Tally holds ('seen') or a request for the
 * orders to create ('feed'). Kept for two weeks so the settings screen can
 * show what Tally actually sent — nothing on the Tally screen does.
 */
const tallyOrderCallSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now, index: { expires: 60 * 60 * 24 * 14 } },
    kind: { type: String, enum: ['feed', 'seen'], required: true },
    claim: { type: Boolean, default: false },
    tdlVersion: { type: String, default: '' },
    company: { type: String, default: '' },
    bytes: { type: Number, default: 0 },
    // 'seen': <SALESORDER> blocks in the body, and how many were CRM orders
    blocks: { type: Number, default: 0 },
    matched: { type: Number, default: 0 },
    // 'feed': the orders handed out by this call
    handedOut: { type: [String], default: [] },
    // Start of the body, to see what arrived when the counts look wrong.
    sample: { type: String, default: '' },
    note: { type: String, default: '' },
    userAgent: { type: String, default: '' },
  },
  { versionKey: false }
);

module.exports = mongoose.model('TallyOrderCall', tallyOrderCallSchema);
