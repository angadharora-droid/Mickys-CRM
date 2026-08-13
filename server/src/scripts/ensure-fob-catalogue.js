const FobItem = require('../models/FobItem');
const { FOB_COST_CATALOGUE } = require('../config/fobCatalog');

/**
 * Seeds the Standard Mixed-Load FOB cost master from the official workbook the
 * first time the server runs against a database (the manual seed script lives
 * in src/seed/, which is deliberately git-ignored and so never deployed).
 * Inserts only when the collection is empty, so admin cost edits are never
 * overwritten. Returns the number of items inserted.
 */
async function ensureFobCatalogue() {
  const exists = await FobItem.findOne({}).select('_id').lean();
  if (exists) return 0;
  await FobItem.insertMany(FOB_COST_CATALOGUE);
  return FOB_COST_CATALOGUE.length;
}

module.exports = { ensureFobCatalogue };
