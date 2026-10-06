const mongoose = require('mongoose');

/**
 * Planned production for one Tally stock item on one IST day, entered by an
 * admin on the Day End Report — Tally has no notion of a plan, so the
 * "Planned Production" column and the achievement % rest on this.
 */
const productionPlanSchema = new mongoose.Schema(
  {
    date: { type: String, required: true }, // 'YYYY-MM-DD' in IST
    item: { type: String, required: true, trim: true },
    qty: { type: Number, required: true, min: 0 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

productionPlanSchema.index({ date: 1, item: 1 }, { unique: true });

module.exports = mongoose.model('ProductionPlan', productionPlanSchema);
