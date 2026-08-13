const mongoose = require('mongoose');

/**
 * One SKU in the Standard Mixed-Load FOB cost master (the export kit's third
 * rate type). Unlike the domestic rate masters this stores COST INPUTS, not a
 * price: the FOB selling price is computed live from these plus the standard
 * load assumptions in Setting.export.fob — mirroring the official FOB price
 * list workbook (see config/fobCatalog.js for the formula).
 */
const fobItemSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, trim: true, uppercase: true, unique: true },
    productName: { type: String, required: true, trim: true, index: true },
    packSize: { type: String, trim: true, default: '' },
    category: { type: String, trim: true, default: '', index: true },
    netWeightKg: { type: Number, required: true, min: 0 },
    ingredientCostInr: { type: Number, min: 0, default: 0 },
    primaryPackingInr: { type: Number, min: 0, default: 0 },
    secondaryPackingInr: { type: Number, min: 0, default: 0 },
    otherVariableCostInr: { type: Number, min: 0, default: 0 },
    unitsPerCarton: { type: Number, min: 1, default: 10 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('FobItem', fobItemSchema);
