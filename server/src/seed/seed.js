/**
 * Seeds the database with the admin user and the product catalogue
 * (distributor & institutional rate masters).
 * Usage: npm run seed
 */
const mongoose = require('mongoose');
const env = require('../config/env');
const User = require('../models/User');
const RateItem = require('../models/RateItem');
const Setting = require('../models/Setting');

const ADMIN = { name: 'Admin', email: 'admin@mickys.com', role: 'admin', employeeCode: 'ADM001', password: 'Admin@12345' };

// Official Micky's by CP Foods catalogue (from the reference price cards).
// `dist`/`inst` are the Basic (pre-GST) rates for each master; GST is 5%.
// A `dist`/`inst` of 0 marks a "TBD" price not yet finalised.
const CAT = { PD: 'PULSES & DAL', GR: 'GRAVIES', PA: 'PASTE', SA: 'SAUCE' };
const CATALOGUE = [
  // PULSES & DAL
  { c: 'PD', productName: 'Boiled Toor Dal', weight: '1000 gms', mrp: 149, dist: 60, inst: 80 },
  { c: 'PD', productName: 'Boiled Chana', weight: '1000 gms', mrp: 149, dist: 60, inst: 80 },
  { c: 'PD', productName: 'Dal Tadka', weight: '1000 gms', mrp: 149, dist: 60, inst: 80 },
  { c: 'PD', productName: 'Boiled Chole', weight: '1000 gms', mrp: 199, dist: 90, inst: 110 },
  { c: 'PD', productName: 'Boiled Kidney Beans', weight: '1000 gms', mrp: 199, dist: 90, inst: 110 },
  { c: 'PD', productName: 'Dal Makhani', weight: '1000 gms', mrp: 299, dist: 130, inst: 160 },
  { c: 'PD', productName: 'Amritsari Dal Makhani', weight: '1000 gms', mrp: 299, dist: 130, inst: 160 },
  { c: 'PD', productName: 'Dal Biryani', weight: '1000 gms', mrp: 299, dist: 130, inst: 160 },
  { c: 'PD', productName: 'Jain Dal Makhani', weight: '1000 gms', mrp: 299, dist: 130, inst: 170 },
  // GRAVIES
  { c: 'GR', productName: 'Onion Tomato Gravy', weight: '1000 gms', mrp: 299, dist: 130, inst: 170 },
  { c: 'GR', productName: 'Tomato Concasse', weight: '1000 gms', mrp: 299, dist: 130, inst: 170 },
  { c: 'GR', productName: 'Kadhai Gravy', weight: '1000 gms', mrp: 199, dist: 90, inst: 110 },
  { c: 'GR', productName: 'Makhani Gravy', weight: '1000 gms', mrp: 499, dist: 220, inst: 280 },
  { c: 'GR', productName: 'Malabar Curry', weight: '1000 gms', mrp: 499, dist: 270, inst: 340 },
  { c: 'GR', productName: 'Yellow Gravy', weight: '1000 gms', mrp: 499, dist: 220, inst: 280 },
  { c: 'GR', productName: 'White Gravy', weight: '1000 gms', mrp: 499, dist: 220, inst: 280 },
  { c: 'GR', productName: 'Tangy Malai (Jain) Gravy', weight: '1000 gms', mrp: 499, dist: 220, inst: 280 },
  { c: 'GR', productName: 'Noorani Gravy', weight: '1000 gms', mrp: 799, dist: 350, inst: 440 },
  { c: 'GR', productName: 'Jain White Gravy', weight: '1000 gms', mrp: 799, dist: 350, inst: 440 },
  // PASTE
  { c: 'PA', productName: 'Ginger Garlic Paste', weight: '1000 gms', mrp: 149, dist: 60, inst: 80 },
  { c: 'PA', productName: 'Ginger Paste', weight: '1000 gms', mrp: 149, dist: 60, inst: 80 },
  { c: 'PA', productName: 'Garlic Paste', weight: '1000 gms', mrp: 149, dist: 60, inst: 80 },
  { c: 'PA', productName: 'Ginger Garlic Paste', weight: '500 gms', mrp: 99, dist: 40, inst: 50 },
  { c: 'PA', productName: 'Ginger Paste', weight: '500 gms', mrp: 99, dist: 40, inst: 50 },
  { c: 'PA', productName: 'Garlic Paste', weight: '500 gms', mrp: 99, dist: 40, inst: 60 },
  { c: 'PA', productName: 'Cashew Paste', weight: '1000 gms', mrp: 799, dist: 350, inst: 440 },
  // SAUCE
  { c: 'SA', productName: 'Pizza Pasta Sauce', weight: '1000 gms', mrp: 299, dist: 130, inst: 160 },
  { c: 'SA', productName: 'Tomato Ketchup', weight: '1000 gms', mrp: 199, dist: 90, inst: 110 },
  { c: 'SA', productName: 'Tamarind Chutney', weight: '1000 gms', mrp: 149, dist: 0, inst: 0 },
];

// Assign a stable, sortable SKU per category in reference order: CPF-PD-01, ...
const skuCounters = {};
CATALOGUE.forEach((b) => {
  skuCounters[b.c] = (skuCounters[b.c] || 0) + 1;
  b.sku = `CPF-${b.c}-${String(skuCounters[b.c]).padStart(2, '0')}`;
});

const GST_RATE = 5;

/** Build a rate item from a catalogue entry for a given master. */
function rateItem(base, kitType) {
  const netRate = kitType === 'distributor' ? base.dist : base.inst;
  return {
    sku: base.sku,
    productName: base.productName,
    packSize: base.weight,
    category: CAT[base.c],
    kitType,
    mrp: base.mrp,
    netRate, // Basic (pre-GST) rate; DLP / Inst. Price = Basic + GST
    floorPrice: netRate, // firm card price by default; execs may negotiate down later
    suggestiveMargin: 0,
    gst: GST_RATE,
  };
}

async function seed() {
  await mongoose.connect(env.mongoUri);
  console.log('[seed] connected to', mongoose.connection.name);

  let admin = await User.findOne({ email: ADMIN.email });
  if (!admin) {
    admin = await User.create(ADMIN);
    console.log(`[seed] created ${ADMIN.role}: ${ADMIN.email} / ${ADMIN.password}`);
  } else {
    console.log(`[seed] user exists: ${ADMIN.email}`);
  }

  // Seed only when the real CP Foods catalogue is absent. Wipes the old demo
  // catalogue on first run; preserves admin price edits on later runs.
  const hasRealCatalogue = await RateItem.findOne({ sku: /^CPF-/ });
  if (!hasRealCatalogue) {
    await RateItem.deleteMany({});
    const docs = [];
    for (const base of CATALOGUE) {
      docs.push(rateItem(base, 'distributor'));
      docs.push(rateItem(base, 'institutional'));
    }
    await RateItem.insertMany(docs);
    console.log(`[seed] created ${docs.length} rate items (${CATALOGUE.length} SKUs × 2 masters)`);
  } else console.log('[seed] CP Foods catalogue already present, skipping');

  await Setting.getGlobal();
  console.log('[seed] done.');
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
