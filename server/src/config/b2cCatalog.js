/**
 * B2C (retail MRP) rate master — the 25 Phase 1 SKUs from the
 * "Micky's by CP Foods · Phase 1 B2C Nagpur Pilot · Final MRP Decision Sheet"
 * (Google Sheets workbook, v1.0, 15 Aug 2026). B2C prices are printed MRPs,
 * inclusive of all taxes, so gst is 0 and netRate mirrors the MRP.
 *
 * Rows whose decision was still DEFER on the sheet carry their current
 * (pre-decision) MRP and are flagged `pending` below — update them in the
 * Rate Master admin screen once the sheet's column K is signed off.
 */

const CAT = { PD: 'PULSES & DAL', GR: 'GRAVIES', PA: 'PASTE', SA: 'SAUCE' };

// [category, productName, packSize, mrp, pending?]
const ROWS = [
  // PULSES & DAL
  ['PD', 'Boiled Kabuli Chana', '250 g', 90],
  ['PD', 'Boiled Kala Chana', '250 g', 80],
  ['PD', 'Boiled Rajma', '250 g', 90],
  ['PD', 'Boiled Toor Dal', '250 g', 100],
  // PASTE
  ['PA', 'Garlic Paste', '40 g', 15, true],
  ['PA', 'Ginger Garlic Paste', '40 g', 15, true],
  ['PA', 'Ginger Garlic Paste', '200 g', 40],
  ['PA', 'Ginger Garlic Paste', '500 g', 90],
  ['PA', 'Ginger Paste', '200 g', 45, true],
  ['PA', 'Ginger Paste', '500 g', 95, true],
  // SAUCE
  ['SA', 'Imli Chutney', '8 g', 5, true],
  ['SA', 'Imli Chutney', '200 g', 60],
  ['SA', 'Imli Chutney', '500 g', 149],
  ['SA', 'Pizza Sauce (Tomato & Basil)', '250 g', 85],
  ['SA', 'Tomato Concasse', '250 g', 60, true],
  ['SA', 'Tomato Ketchup', '8 g', 4, true],
  ['SA', 'Tomato Ketchup', '200 g', 60],
  ['SA', 'Tomato Ketchup', '500 g', 75],
  // GRAVIES
  ['GR', 'Makhani Sauce', '250 g', 199],
  ['GR', 'Malabari Curry Base', '250 g', 225, true],
  ['GR', 'Punjabi Bhuna Masala', '250 g', 200],
  ['GR', 'Tangy Malai Jain Gravy', '250 g', 150, true],
  ['GR', 'Brown Gravy', '250 g', 175],
  ['GR', 'Mughlai White Gravy', '250 g', 200, true],
  ['GR', 'Yellow Gravy Base', '250 g', 150, true],
];

// Stable, sortable SKUs per category in sheet order: B2C-PD-01, ... The B2C
// prefix keeps these clear of the trade catalogue's CPF- namespace (which the
// manual seed uses to detect whether the trade masters are already loaded).
const counters = {};
const B2C_MRP_CATALOGUE = ROWS.map(([c, productName, packSize, mrp]) => {
  counters[c] = (counters[c] || 0) + 1;
  return {
    sku: `B2C-${c}-${String(counters[c]).padStart(2, '0')}`,
    productName,
    packSize,
    category: CAT[c],
    kitType: 'b2c',
    mrp,
    netRate: mrp, // MRP is the price — kept in lockstep for the kit pipeline
    suggestiveMargin: 0,
    gst: 0, // MRP is inclusive of all taxes; nothing is added on top
    isActive: true,
  };
});

module.exports = { B2C_MRP_CATALOGUE };
