/**
 * Standard Mixed-Load FOB cost catalogue, transcribed from the official
 * "Mickys_Standard_Mixed_Load_FOB_Price_List" workbook. These are the per-SKU
 * cost inputs (identical across the workbook's 20 ft / 40 ft / 5-ton sheets);
 * the per-load assumptions (payload, common costs, buffer, overhead, margin)
 * live in Setting.export.fob, and the FOB selling price is computed live:
 *
 *   COGS      = ingredient + primary packing + secondary packing + other variable
 *   Factory   = COGS × (1 + overhead%)
 *   Logistics = (common FCL cost / standard payload) × (1 + buffer%) × net weight
 *   FOB price = (Factory + Logistics) / (1 − margin%)
 *
 * SKUs reference the CP Foods catalogue (seed.js) so the FOB master lines up
 * with the same products as the domestic rate masters.
 */

const CAT = { PD: 'PULSES & DAL', GR: 'GRAVIES', PA: 'PASTE', SA: 'SAUCE' };

// [sku, productName, packSize, category, netWeightKg, ingredientCostInr, unitsPerCarton]
// Packing/other costs are uniform in the workbook: primary 10, secondary 4.5,
// other variable 5 (₹ per unit) — applied below.
const ROWS = [
  ['CPF-PD-01', 'Boiled Toor Dal', '1000 gms', 'PD', 1, 36, 10],
  ['CPF-PD-02', 'Boiled Chana', '1000 gms', 'PD', 1, 38, 10],
  ['CPF-PD-03', 'Dal Tadka', '1000 gms', 'PD', 1, 41, 10],
  ['CPF-PD-04', 'Boiled Chole', '1000 gms', 'PD', 1, 56, 10],
  ['CPF-PD-05', 'Boiled Kidney Beans', '1000 gms', 'PD', 1, 58, 10],
  ['CPF-PD-06', 'Dal Makhani', '1000 gms', 'PD', 1, 76, 10],
  ['CPF-PD-07', 'Amritsari Dal Makhani', '1000 gms', 'PD', 1, 71, 10],
  ['CPF-PD-08', 'Dal Biryani', '1000 gms', 'PD', 1, 76, 10],
  ['CPF-PD-09', 'Jain Dal Makhani', '1000 gms', 'PD', 1, 78, 10],
  ['CPF-GR-01', 'Onion Tomato Gravy', '1000 gms', 'GR', 1, 79, 10],
  ['CPF-GR-02', 'Tomato Concasse', '1000 gms', 'GR', 1, 68, 10],
  ['CPF-GR-03', 'Kadhai Gravy', '1000 gms', 'GR', 1, 56, 10],
  ['CPF-GR-04', 'Makhani Gravy', '1000 gms', 'GR', 1, 123, 10],
  ['CPF-GR-05', 'Malabar Curry', '1000 gms', 'GR', 1, 157, 10],
  ['CPF-GR-06', 'Yellow Gravy', '1000 gms', 'GR', 1, 152, 10],
  ['CPF-GR-07', 'White Gravy', '1000 gms', 'GR', 1, 113, 10],
  ['CPF-GR-08', 'Tangy Malai (Jain) Gravy', '1000 gms', 'GR', 1, 107, 10],
  ['CPF-GR-09', 'Noorani Gravy', '1000 gms', 'GR', 1, 236, 10],
  ['CPF-GR-10', 'Jain White Gravy', '1000 gms', 'GR', 1, 221, 10],
  ['CPF-PA-01', 'Ginger Garlic Paste', '1000 gms', 'PA', 1, 48, 10],
  ['CPF-PA-02', 'Ginger Paste', '1000 gms', 'PA', 1, 48, 10],
  ['CPF-PA-03', 'Garlic Paste', '1000 gms', 'PA', 1, 33, 10],
  ['CPF-PA-04', 'Ginger Garlic Paste', '500 gms', 'PA', 0.5, 24, 20],
  ['CPF-PA-05', 'Ginger Paste', '500 gms', 'PA', 0.5, 24, 20],
  ['CPF-PA-06', 'Garlic Paste', '500 gms', 'PA', 0.5, 17, 20],
  ['CPF-PA-07', 'Cashew Paste', '1000 gms', 'PA', 1, 214, 10],
  ['CPF-SA-01', 'Pizza Pasta Sauce', '1000 gms', 'SA', 1, 83, 10],
  ['CPF-SA-02', 'Tomato Ketchup', '1000 gms', 'SA', 1, 61, 10],
  // Ingredient cost not yet costed in the workbook (COGS = packing + variable only).
  ['CPF-SA-03', 'Tamarind Chutney', '1000 gms', 'SA', 1, 0, 10],
];

const FOB_COST_CATALOGUE = ROWS.map(
  ([sku, productName, packSize, cat, netWeightKg, ingredientCostInr, unitsPerCarton]) => ({
    sku,
    productName,
    packSize,
    category: CAT[cat],
    netWeightKg,
    ingredientCostInr,
    primaryPackingInr: 10,
    secondaryPackingInr: 4.5,
    otherVariableCostInr: 5,
    unitsPerCarton,
  })
);

module.exports = { FOB_COST_CATALOGUE };
