const mongoose = require('mongoose');

const KIT_TYPES = ['distributor', 'institutional'];

/**
 * A single SKU in a rate master. The two masters (Distributor & Institutional)
 * are the same collection distinguished by `kitType`. MRP and floorPrice bound
 * the editable net rate when a kit is built; suggestiveMargin only applies to
 * the distributor master.
 */
const rateItemSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, trim: true, uppercase: true, index: true },
    productName: { type: String, required: true, trim: true, index: true },
    packSize: { type: String, trim: true, default: '' },
    category: { type: String, trim: true, default: '', index: true },
    kitType: { type: String, enum: KIT_TYPES, required: true, index: true },
    mrp: { type: Number, required: true, min: 0 },
    netRate: { type: Number, required: true, min: 0 }, // standard net rate
    suggestiveMargin: { type: Number, min: 0, max: 100, default: 0 }, // % (distributor)
    gst: { type: Number, required: true, min: 0, max: 100, default: 18 },
    floorPrice: { type: Number, required: true, min: 0 }, // minimum allowed net rate
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// SKU is unique per master, not globally (same product can exist in both rate cards).
rateItemSchema.index({ sku: 1, kitType: 1 }, { unique: true });
rateItemSchema.index({ productName: 'text', sku: 'text', category: 'text' });

const RateItem = mongoose.model('RateItem', rateItemSchema);
RateItem.KIT_TYPES = KIT_TYPES;
module.exports = RateItem;
