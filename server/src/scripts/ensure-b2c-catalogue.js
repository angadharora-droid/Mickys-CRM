const RateItem = require('../models/RateItem');
const { B2C_MRP_CATALOGUE } = require('../config/b2cCatalog');

/**
 * Seeds the B2C (retail MRP) rate master from the Phase 1 Nagpur Pilot MRP
 * decision sheet the first time the server runs against a database (the manual
 * seed script lives in src/seed/, which is deliberately git-ignored and so
 * never deployed). Inserts only when the master has no B2C items, so admin
 * price edits in the Rate Master screen are never overwritten. Returns the
 * number of items inserted.
 */
async function ensureB2cCatalogue() {
  const exists = await RateItem.findOne({ kitType: 'b2c' }).select('_id').lean();
  if (exists) return 0;
  await RateItem.insertMany(B2C_MRP_CATALOGUE);
  return B2C_MRP_CATALOGUE.length;
}

module.exports = { ensureB2cCatalogue };
