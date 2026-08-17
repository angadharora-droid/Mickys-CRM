/**
 * Export Kit — rate engine + Rate Card renderer.
 *
 * Builds an export Rate Card for a shipment out of India: the caller picks a
 * rate type (which master the base prices come from), a loading type, a
 * destination country and a quote currency, and the engine apportions the
 * shipment's logistics cost onto each product's rate:
 *
 *  - Full Load  — logistics = port transportation for the chosen container
 *    (20/40 ft, from Settings) + CIR insurance (a % of goods value, per
 *    country). The total is split EQUALLY across the product lines.
 *  - Part Load  — freight is calculated first (per-kg country rate × shipment
 *    weight), then freight + CIR is distributed across the lines
 *    PROPORTIONALLY to each line's value.
 *
 * Institution and Distributor rate cards share these mechanics; they differ
 * only in which rate master supplies the base per-pack rates.
 *
 * Conversion uses the stored daily exchange rate (fx.service), never a
 * hardcoded figure; the rate and its as-of date are printed on the card.
 */
const PDFDocument = require('pdfkit');
const RateItem = require('../models/RateItem');
const FobItem = require('../models/FobItem');
const ExportCountry = require('../models/ExportCountry');
const ExchangeRate = require('../models/ExchangeRate');
const Setting = require('../models/Setting');
const ApiError = require('../utils/ApiError');
const brand = require('../config/brand');
const content = require('../config/kitContent');

const RATE_TYPES = ['distributor', 'institution', 'fob'];
const LOADING_TYPES = ['full', 'part'];
const CONTAINER_SIZES = ['ft20', 'ft40'];

// Which rate master backs each export rate type ('fob' uses the FobItem cost
// master instead and is priced by the standard mixed-load engine below).
const MASTER_FOR = { distributor: 'distributor', institution: 'institutional' };

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** "500 g" / "1kg" / "250 gm" -> weight of one pack in kg, or null. */
function parsePackWeightKg(packSize) {
  const m = String(packSize || '').match(/([\d.]+)\s*(kg|kgs|g|gm|gms|gram|grams)\b/i);
  if (!m) return null;
  const qty = Number(m[1]);
  if (!(qty > 0)) return null;
  return /^k/i.test(m[2]) ? qty : qty / 1000;
}

// ---------------------------------------------------- FOB pricing engine ----
// Standard Mixed-Load FOB (per the official workbook): destination-independent
// prices quoted FOB Nhava Sheva. Each load option (20 ft / 40 ft FCL, 5-ton
// mixed load) carries its own commercial assumptions in Setting.export.fob;
// ocean freight and insurance are never included (quoted separately), so the
// destination country is printed on the card for the record only.

/** Which FOB assumption set a shipment maps to. */
const fobVariantKey = (loadingType, containerSize) =>
  loadingType === 'part' ? 'ton5' : containerSize;

/** Validated assumption set for a variant, with the buffered logistics ₹/kg. */
function fobAssumptions(fobCfg, variant) {
  const v = fobCfg?.variants?.[variant];
  const payloadKg = Number(fobCfg?.payloadKg);
  if (!v || !(payloadKg > 0)) {
    throw ApiError.badRequest('FOB assumptions are not configured — set them in Export Settings');
  }
  const marginPercent = Number(v.marginPercent) || 0;
  if (marginPercent >= 100) throw ApiError.badRequest('FOB target margin must be below 100%');
  const logisticsPerKgInr =
    ((Number(v.commonCostInr) || 0) / payloadKg) * (1 + (Number(v.bufferPercent) || 0) / 100);
  return {
    variant,
    label: v.label || variant,
    payloadKg,
    overheadPercent: Number(fobCfg.overheadPercent) || 0,
    commonCostInr: Number(v.commonCostInr) || 0,
    bufferPercent: Number(v.bufferPercent) || 0,
    marginPercent,
    logisticsPerKgInr,
  };
}

/** Unit price build-up (INR) for one FOB cost item under an assumption set. */
function computeFobUnitPricing(item, a) {
  const cogsInr =
    (Number(item.ingredientCostInr) || 0) +
    (Number(item.primaryPackingInr) || 0) +
    (Number(item.secondaryPackingInr) || 0) +
    (Number(item.otherVariableCostInr) || 0);
  const factoryCostInr = cogsInr * (1 + a.overheadPercent / 100);
  const logisticsInr = a.logisticsPerKgInr * (Number(item.netWeightKg) || 0);
  const fobCostInr = factoryCostInr + logisticsInr;
  const priceInr = fobCostInr / (1 - a.marginPercent / 100);
  return {
    cogsInr: round2(cogsInr),
    factoryCostInr: round2(factoryCostInr),
    logisticsInr: round2(logisticsInr),
    fobCostInr: round2(fobCostInr),
    priceInr: round2(priceInr),
    cartonPriceInr: round2(round2(priceInr) * (Number(item.unitsPerCarton) || 1)),
  };
}

/**
 * Resolves shipment lines against the FOB cost master and prices them under
 * the variant's assumptions. Input lines: [{ rateItemId, qty, unitWeightKg?,
 * netRate? }] — netRate overrides the computed standard FOB price.
 */
async function resolveFobLines(lines, fobCfg, variant) {
  const a = fobAssumptions(fobCfg, variant);
  const items = await FobItem.find({ _id: { $in: lines.map((l) => l.rateItemId) } }).lean();
  const itemById = new Map(items.map((it) => [String(it._id), it]));

  return lines.map((l) => {
    const it = itemById.get(String(l.rateItemId));
    if (!it) throw ApiError.badRequest('A selected product no longer exists in the FOB cost master');
    const pricing = computeFobUnitPricing(it, a);
    const baseRateInr =
      l.netRate !== undefined && l.netRate !== null ? Number(l.netRate) : pricing.priceInr;
    if (!(baseRateInr >= 0)) throw ApiError.badRequest(`Invalid rate for "${it.productName}"`);
    const unitWeightKg =
      l.unitWeightKg !== undefined && l.unitWeightKg !== null && l.unitWeightKg !== ''
        ? Number(l.unitWeightKg)
        : it.netWeightKg;
    return {
      rateItemId: String(it._id),
      sku: it.sku,
      productName: it.productName,
      packSize: it.packSize || '',
      category: it.category || 'Other',
      qty: l.qty,
      unitWeightKg: unitWeightKg > 0 ? unitWeightKg : null,
      baseRateInr,
      standardRateInr: pricing.priceInr,
      unitsPerCarton: it.unitsPerCarton || null,
      pricing,
      item: it,
    };
  });
}

/**
 * Assembles a Standard FOB price card. Same overall shape as buildCard, but
 * with no destination logistics: the FOB rate IS the base rate (standard
 * mixed-load logistics and margin are already inside it).
 */
function buildFobCard({ loadingType, containerSize, country, currency, lines, fxDoc, assumptions, rateCardTerms }) {
  const fxRate = currency === 'INR' ? 1 : Number(fxDoc.inrPer?.[currency]);
  if (!(fxRate > 0)) throw ApiError.badRequest(`No stored exchange rate for ${currency} — refresh or set rates first`);
  const toCur = (inr) => round2(inr / fxRate);

  const computed = lines.map((l) => {
    const qty = Math.floor(Number(l.qty));
    if (!(qty > 0)) throw ApiError.badRequest(`Quantity for "${l.productName}" must be at least 1`);
    const baseRateInr = round2(l.baseRateInr);
    const cartonInr = l.unitsPerCarton ? round2(baseRateInr * l.unitsPerCarton) : null;
    return {
      ...l,
      qty,
      unitWeightKg: l.unitWeightKg > 0 ? l.unitWeightKg : null,
      baseRateInr,
      lineValueInr: round2(baseRateInr * qty),
      logisticsShareInr: 0,
      perUnitAddonInr: 0,
      exportRateInr: baseRateInr,
      cartonPriceInr: cartonInr,
      baseRate: toCur(baseRateInr),
      perUnitAddon: 0,
      exportRate: toCur(baseRateInr),
      cartonPrice: cartonInr === null ? null : toCur(cartonInr),
      lineTotal: toCur(baseRateInr * qty),
    };
  });
  if (!computed.length) throw ApiError.badRequest('Select at least one product');

  const goodsValueInr = round2(computed.reduce((s, l) => s + l.lineValueInr, 0));
  if (!(goodsValueInr > 0)) throw ApiError.badRequest('The shipment has no value — check the rates');
  const missingWeight = computed.filter((l) => l.unitWeightKg === null).map((l) => l.sku);
  const totalWeightKg = missingWeight.length
    ? null
    : round2(computed.reduce((s, l) => s + l.unitWeightKg * l.qty, 0));

  const warnings = [];
  if (totalWeightKg !== null && totalWeightKg > assumptions.payloadKg) {
    warnings.push(
      `Shipment weight ${(totalWeightKg / 1000).toFixed(2)} t exceeds the standard ${assumptions.payloadKg / 1000} t mixed-load payload — reprice from actuals before confirming the order`
    );
  }

  const freightLabel = 'FOB Nhava Sheva — ocean freight & insurance quoted separately';
  return {
    config: {
      rateType: 'fob',
      loadingType,
      containerSize: loadingType === 'full' ? containerSize : null,
      container: null,
      fob: assumptions,
      country,
      currency,
    },
    fx: {
      currency,
      inrPerUnit: fxRate,
      fetchedAt: fxDoc.fetchedAt,
      source: fxDoc.source,
    },
    lines: computed,
    summary: {
      lineCount: computed.length,
      totalWeightKg,
      goodsValueInr,
      insuranceInr: 0,
      freightInr: 0,
      freightLabel,
      logisticsInr: 0,
      grandTotalInr: goodsValueInr,
      goodsValue: toCur(goodsValueInr),
      insurance: 0,
      freight: 0,
      logistics: 0,
      grandTotal: toCur(goodsValueInr),
      warnings,
    },
    rateCardTerms: rateCardTerms || '',
  };
}

/** Active FOB cost items priced under a variant, for the builder UI. */
async function listFobItems(variant) {
  const settings = await Setting.getGlobal();
  const a = fobAssumptions(settings.export?.fob, variant);
  const items = await FobItem.find({ isActive: true }).sort({ category: 1, sku: 1 }).lean();
  return {
    assumptions: { ...a, logisticsPerKgInr: round2(a.logisticsPerKgInr) },
    items: items.map((it) => ({ ...it, pricing: computeFobUnitPricing(it, a) })),
  };
}

// ---------------------------------------------------------------- engine ----

/**
 * Assembles the rate card from fully-resolved inputs. Shared by the standalone
 * preview (live country doc) and the lead pipeline (the lead's frozen
 * shipment snapshot). `lines` are pre-validated:
 * [{ rateItemId, sku, productName, packSize, category, qty, unitWeightKg|null, baseRateInr }]
 */
function buildCard({ rateType, loadingType, containerSize, container, country, currency, lines, fxDoc, rateCardTerms }) {
  const fxRate = currency === 'INR' ? 1 : Number(fxDoc.inrPer?.[currency]);
  if (!(fxRate > 0)) throw ApiError.badRequest(`No stored exchange rate for ${currency} — refresh or set rates first`);
  const toCur = (inr) => round2(inr / fxRate);

  const computed = lines.map((l) => {
    const qty = Math.floor(Number(l.qty));
    if (!(qty > 0)) throw ApiError.badRequest(`Quantity for "${l.productName}" must be at least 1`);
    return {
      ...l,
      qty,
      unitWeightKg: l.unitWeightKg > 0 ? l.unitWeightKg : null,
      baseRateInr: round2(l.baseRateInr),
      lineValueInr: round2(l.baseRateInr * qty),
    };
  });
  if (!computed.length) throw ApiError.badRequest('Select at least one product');
  const missingWeight = computed.filter((l) => l.unitWeightKg === null).map((l) => l.sku);

  const goodsValueInr = round2(computed.reduce((s, l) => s + l.lineValueInr, 0));
  if (!(goodsValueInr > 0)) throw ApiError.badRequest('The shipment has no value — check the rates');
  const totalWeightKg = missingWeight.length
    ? null
    : round2(computed.reduce((s, l) => s + l.unitWeightKg * l.qty, 0));

  const insuranceInr = round2((goodsValueInr * country.cirPercent) / 100);
  const warnings = [];
  let freightInr;
  let freightLabel;
  let containerInfo = null;

  if (loadingType === 'full') {
    if (!container) throw ApiError.badRequest('Select a container size for a full-load shipment');
    containerInfo = {
      size: containerSize,
      label: container.label,
      capacityTonsMin: container.capacityTonsMin,
      capacityTonsMax: container.capacityTonsMax,
      portTransportInr: container.portTransportInr,
    };
    freightInr = round2(container.portTransportInr);
    freightLabel = `Port transportation — ${container.label}`;
    if (totalWeightKg === null) {
      warnings.push(`Container utilisation cannot be checked — no pack weight for: ${missingWeight.join(', ')}`);
    } else if (totalWeightKg > container.capacityTonsMax * 1000) {
      warnings.push(
        `Shipment weight ${(totalWeightKg / 1000).toFixed(2)} t exceeds the ${container.label}'s ${container.capacityTonsMax} t capacity`
      );
    } else if (totalWeightKg < container.capacityTonsMin * 1000) {
      warnings.push(
        `Shipment weight ${(totalWeightKg / 1000).toFixed(2)} t is below the ${container.label}'s rated ${container.capacityTonsMin}–${container.capacityTonsMax} t band`
      );
    }
  } else {
    if (totalWeightKg === null) {
      throw ApiError.badRequest(
        `Part-load freight needs a weight for every product — set a unit weight for: ${missingWeight.join(', ')}`
      );
    }
    freightInr = round2(country.partLoadFreightPerKg * totalWeightKg);
    freightLabel = `Part-load freight — ${totalWeightKg.toLocaleString('en-IN')} kg × Rs. ${country.partLoadFreightPerKg}/kg`;
  }

  const logisticsInr = round2(freightInr + insuranceInr);

  // Apportion logistics onto the lines: full load splits equally per product,
  // part load follows each line's share of the goods value.
  computed.forEach((l) => {
    const shareInr =
      loadingType === 'full'
        ? logisticsInr / computed.length
        : (logisticsInr * l.lineValueInr) / goodsValueInr;
    l.logisticsShareInr = round2(shareInr);
    l.perUnitAddonInr = round2(shareInr / l.qty);
    l.exportRateInr = round2(l.baseRateInr + shareInr / l.qty);
    l.baseRate = toCur(l.baseRateInr);
    l.perUnitAddon = toCur(shareInr / l.qty);
    l.exportRate = toCur(l.baseRateInr + shareInr / l.qty);
    l.lineTotal = toCur(l.baseRateInr * l.qty + shareInr);
  });

  const grandTotalInr = round2(goodsValueInr + logisticsInr);
  return {
    config: {
      rateType,
      loadingType,
      containerSize: loadingType === 'full' ? containerSize : null,
      container: containerInfo,
      country,
      currency,
    },
    fx: {
      currency,
      inrPerUnit: fxRate,
      fetchedAt: fxDoc.fetchedAt,
      source: fxDoc.source,
    },
    lines: computed,
    summary: {
      lineCount: computed.length,
      totalWeightKg,
      goodsValueInr,
      insuranceInr,
      freightInr,
      freightLabel,
      logisticsInr,
      grandTotalInr,
      goodsValue: toCur(goodsValueInr),
      insurance: toCur(insuranceInr),
      freight: toCur(freightInr),
      logistics: toCur(logisticsInr),
      grandTotal: toCur(grandTotalInr),
      warnings,
    },
    rateCardTerms: rateCardTerms || '',
  };
}

/**
 * Resolves and validates the shipment lines against the rate master backing
 * `rateType`. Input lines: [{ rateItemId, qty, unitWeightKg?, netRate? }] —
 * weight defaults to the pack size parsed off the master; netRate overrides
 * the master's base rate. Returns lines ready for buildCard, each carrying its
 * master item for callers that snapshot more fields.
 */
async function resolveLines(rateType, lines) {
  const masterKitType = MASTER_FOR[rateType];
  const items = await RateItem.find({ _id: { $in: lines.map((l) => l.rateItemId) } }).lean();
  const itemById = new Map(items.map((it) => [String(it._id), it]));

  return lines.map((l) => {
    const it = itemById.get(String(l.rateItemId));
    if (!it) throw ApiError.badRequest('A selected product no longer exists in the rate master');
    if (it.kitType !== masterKitType) {
      throw ApiError.badRequest(`"${it.productName}" is not in the ${rateType} rate master`);
    }
    const baseRateInr = l.netRate !== undefined && l.netRate !== null ? Number(l.netRate) : it.netRate;
    if (!(baseRateInr >= 0)) throw ApiError.badRequest(`Invalid rate for "${it.productName}"`);
    const unitWeightKg =
      l.unitWeightKg !== undefined && l.unitWeightKg !== null && l.unitWeightKg !== ''
        ? Number(l.unitWeightKg)
        : parsePackWeightKg(it.packSize);
    return {
      rateItemId: String(it._id),
      sku: it.sku,
      productName: it.productName,
      packSize: it.packSize || '',
      category: it.category || 'Other',
      qty: l.qty,
      unitWeightKg: unitWeightKg > 0 ? unitWeightKg : null,
      baseRateInr,
      item: it,
    };
  });
}

/** Standalone computation (preview): live country doc + current settings/FX.
 *  FOB cards are destination-independent, so no country is involved there. */
async function computeRateCard({ rateType, loadingType, containerSize, countryId, currency, lines }) {
  const [settings, fxDoc, country] = await Promise.all([
    Setting.getGlobal(),
    ExchangeRate.getGlobal(),
    countryId ? ExportCountry.findById(countryId) : null,
  ]);

  let countryInfo = null;
  if (countryId) {
    if (!country || !country.isActive) throw ApiError.badRequest('Unknown or inactive destination country');
    countryInfo = {
      id: String(country._id),
      name: country.name,
      code: country.code,
      cirPercent: country.cirPercent,
      partLoadFreightPerKg: country.partLoadFreightPerKg,
    };
  }

  if (rateType === 'fob') {
    const variant = fobVariantKey(loadingType, containerSize);
    const resolved = await resolveFobLines(lines, settings.export?.fob, variant);
    return buildFobCard({
      loadingType,
      containerSize,
      country: countryInfo,
      currency,
      lines: resolved,
      fxDoc,
      assumptions: fobAssumptions(settings.export?.fob, variant),
      rateCardTerms: settings.export?.fobRateCardTerms || '',
    });
  }

  if (!countryInfo) throw ApiError.badRequest('Destination country is required');
  const resolved = await resolveLines(rateType, lines);
  return buildCard({
    rateType,
    loadingType,
    containerSize,
    container: loadingType === 'full' ? settings.export?.containers?.[containerSize] : null,
    country: countryInfo,
    currency,
    lines: resolved,
    fxDoc,
    rateCardTerms: settings.export?.rateCardTerms || '',
  });
}

/**
 * Computes the card for an export lead from its frozen shipment snapshot
 * (exportConfig + confirmed rate lines). Only the currency conversion is live:
 * it uses the stored daily rate at generation time, as printed on the card.
 */
async function computeRateCardFromLead(lead, settings, fxDoc) {
  const cfg = lead.exportConfig;
  // FOB shipments carry no destination; any other rate type must have one.
  if (!cfg || (cfg.rateType !== 'fob' && !cfg.countryId)) {
    throw ApiError.badRequest('This lead has no confirmed export shipment');
  }
  if (!settings) settings = await Setting.getGlobal();
  if (!fxDoc) fxDoc = await ExchangeRate.getGlobal();

  const lines = (lead.rates || [])
    .filter((l) => l.included !== false)
    .map((l) => ({
      rateItemId: String(l.rateItemId),
      sku: l.sku,
      productName: l.productName,
      packSize: l.packSize || '',
      category: l.category || 'Other',
      qty: l.qty,
      unitWeightKg: l.unitWeightKg > 0 ? l.unitWeightKg : null,
      baseRateInr: l.netRate,
    }));

  if (cfg.rateType === 'fob') {
    // Prices are frozen on the lead (netRate); the cost master is re-read only
    // for the carton pack counts, and the assumptions block prints the current
    // settings the frozen prices were built from.
    const variant = fobVariantKey(cfg.loadingType, cfg.containerSize);
    const items = await FobItem.find({ _id: { $in: lines.map((l) => l.rateItemId) } })
      .select('_id unitsPerCarton')
      .lean();
    const cartonById = new Map(items.map((it) => [String(it._id), it.unitsPerCarton]));
    return buildFobCard({
      loadingType: cfg.loadingType,
      containerSize: cfg.containerSize,
      country: cfg.countryId
        ? {
            id: String(cfg.countryId),
            name: cfg.countryName,
            code: cfg.countryCode,
            cirPercent: cfg.cirPercent,
            partLoadFreightPerKg: cfg.partLoadFreightPerKg,
          }
        : null,
      currency: cfg.currency,
      lines: lines.map((l) => ({ ...l, unitsPerCarton: cartonById.get(l.rateItemId) || null })),
      fxDoc,
      assumptions: fobAssumptions(settings.export?.fob, variant),
      rateCardTerms:
        (lead.customTerms?.termsAndConditions || '').trim() || settings.export?.fobRateCardTerms || '',
    });
  }

  return buildCard({
    rateType: cfg.rateType,
    loadingType: cfg.loadingType,
    containerSize: cfg.containerSize,
    container: cfg.loadingType === 'full' ? settings.export?.containers?.[cfg.containerSize] : null,
    country: {
      id: String(cfg.countryId),
      name: cfg.countryName,
      code: cfg.countryCode,
      cirPercent: cfg.cirPercent,
      partLoadFreightPerKg: cfg.partLoadFreightPerKg,
    },
    currency: cfg.currency,
    lines,
    fxDoc,
    // A lead's edited T&C (one clause per line) overrides the standard terms.
    rateCardTerms: (lead.customTerms?.termsAndConditions || '').trim() || settings.export?.rateCardTerms || '',
  });
}

// -------------------------------------------------------------- renderer ----

const MAROON = '#6F0E13';
const GOLD = '#F1C53E';
const SLATE = '#454343';
const INK = '#2a2220';
const LIGHT = '#f4f1ec';
const BAND = '#efe7e0';
const BORDER = '#e2ddd7';
const M = 40;

// £ and € are in PDFKit's WinAnsi built-ins; ₹ is not, hence the Rs. prefix.
const CUR_FMT = {
  USD: { prefix: '$', locale: 'en-US' },
  EUR: { prefix: '€', locale: 'en-US' },
  GBP: { prefix: '£', locale: 'en-US' },
  INR: { prefix: 'Rs. ', locale: 'en-IN' },
};
const money = (n, currency) => {
  const f = CUR_FMT[currency] || CUR_FMT.INR;
  return f.prefix + Number(n || 0).toLocaleString(f.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const inr = (n) => money(n, 'INR');

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

function renderPdfBuffer(draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: M });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      draw(doc);
    } catch (err) {
      return reject(err);
    }
    doc.end();
  });
}

const contentWidth = (doc) => doc.page.width - 2 * M;
const bottomLimit = (doc) => doc.page.height - 56;

function brandHeader(doc, title, subtitle, lead) {
  const W = doc.page.width;
  doc.rect(0, 0, W, 88).fill(MAROON);
  doc.rect(0, 88, W, 3).fill(GOLD);
  doc.fill('#ffffff').font('Helvetica-Bold').fontSize(18).text(brand.brandName, M, 16);
  doc.font('Helvetica-Oblique').fontSize(8).fill('#f1d4d6').text(brand.tagline, M, 39);
  doc.font('Helvetica').fontSize(7.5).fill('#e7c4c6').text(brand.legalEntityShort, M, 52);
  const titleX = M + 250;
  doc.font('Helvetica-Bold').fontSize(12.5).fill('#ffffff').text(String(title).toUpperCase(), titleX, 18, { width: W - M - titleX, align: 'right' });
  if (subtitle) doc.font('Helvetica').fontSize(8.5).fill(GOLD).text(subtitle, titleX, 39, { width: W - M - titleX, align: 'right' });
  const meta = [lead?.refNumber ? `Ref: ${lead.refNumber}` : null, `Date: ${fmtDate(new Date())}`].filter(Boolean).join('   ·   ');
  doc.font('Helvetica').fontSize(8).fill('#f1d4d6').text(meta, M, 64, { width: W - 2 * M, align: 'right' });
  doc.fillColor(INK);
  return 104;
}

/** Compact client + executive card for lead-bound cards. */
function clientBlock(doc, y, lead, exec) {
  const W = contentWidth(doc);
  const half = W / 2 - 12;
  const who = [
    `${lead.contactPerson || ''}${lead.designation ? ', ' + lead.designation : ''}`,
    [lead.city, lead.state].filter(Boolean).join(', '),
  ].filter(Boolean).join('  ·  ');
  // Wrapped and measured rather than held to one line: lineBreak:false does
  // not clip, so a long business name or contact line used to run straight
  // across into the executive column beside it.
  doc.font('Helvetica-Bold').fontSize(12);
  const nameH = doc.heightOfString(lead.businessName, { width: half });
  doc.font('Helvetica').fontSize(8.5);
  const whoH = doc.heightOfString(who, { width: half });
  const mobH = lead.mobileNumber ? doc.heightOfString(`Mob: ${lead.mobileNumber}`, { width: half }) : 0;
  const leftBottom = 19 + nameH + 5 + whoH + (lead.mobileNumber ? 3 + mobH : 0);
  const boxH = Math.max(64, leftBottom + 8);

  doc.roundedRect(M, y, W, boxH, 6).fill(LIGHT);
  doc.fill(SLATE).font('Helvetica-Bold').fontSize(7.5).text('PREPARED FOR', M + 12, y + 8);
  doc.font('Helvetica-Bold').fontSize(12).fill(MAROON).text(lead.businessName, M + 12, y + 19, { width: half });
  doc.font('Helvetica').fontSize(8.5).fill(SLATE);
  const whoY = y + 19 + nameH + 5;
  doc.text(who, M + 12, whoY, { width: half });
  if (lead.mobileNumber) doc.text(`Mob: ${lead.mobileNumber}`, M + 12, whoY + whoH + 3, { width: half });
  const rx = M + W / 2 + 8;
  doc.font('Helvetica-Bold').fontSize(7.5).fill(SLATE).text('SALES EXECUTIVE', rx, y + 8);
  doc.font('Helvetica').fontSize(9.5).fill(INK).text(exec?.name || '-', rx, y + 19, { width: half, lineBreak: false });
  doc.fontSize(8).fill(SLATE).text(exec?.email || '', rx, y + 32, { width: half, lineBreak: false });
  if (exec?.phone) doc.text(`Mob: ${exec.phone}`, rx, y + 44, { width: half, lineBreak: false });
  doc.fillColor(INK);
  return y + boxH + 12;
}

function slimHeader(doc) {
  const W = doc.page.width;
  doc.rect(0, 0, W, 30).fill(MAROON);
  doc.rect(0, 30, W, 2).fill(GOLD);
  doc.fill('#ffffff').font('Helvetica-Bold').fontSize(10).text(brand.brandName, M, 9);
  doc.font('Helvetica-Oblique').fontSize(7.5).fill('#f1d4d6').text(brand.tagline, M, 9, { width: W - 2 * M, align: 'right' });
  doc.fillColor(INK);
  return 44;
}

function pageFooter(doc, label) {
  const W = doc.page.width;
  const y = doc.page.height - 44;
  const savedBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.moveTo(M, y).lineTo(W - M, y).stroke(BORDER);
  doc.font('Helvetica').fontSize(6.8).fill(SLATE)
    .text(`${brand.legalEntity}  ·  ${brand.address}  ·  FSSAI: ${brand.fssai}`, M, y + 5, { width: W - 2 * M, align: 'center', lineBreak: false });
  doc.font('Helvetica').fontSize(6.8).fill(SLATE)
    .text(`${brand.contact.name}  ·  ${brand.contact.phone}  ·  ${brand.contact.email}  ·  ${brand.website}`, M, y + 15, { width: W - 2 * M, align: 'center', lineBreak: false });
  if (label) doc.font('Helvetica-Oblique').fontSize(6.5).fill(MAROON).text(label, M, y + 25, { width: W - 2 * M, align: 'center', lineBreak: false });
  doc.page.margins.bottom = savedBottom;
}

function newPage(doc, label) {
  doc.addPage();
  const y = slimHeader(doc);
  pageFooter(doc, label);
  return y;
}

/** Two-column labelled facts card describing the shipment configuration. */
function shipmentCard(doc, y, card) {
  const { config, summary } = card;
  const W = contentWidth(doc);
  const rows = [
    ['Rate Type', config.rateType === 'institution' ? 'Institution Rate' : 'Distributor Rate'],
    ['Loading Type', config.loadingType === 'full' ? 'Full Load (FCL)' : 'Part Load (LCL)'],
    config.container
      ? ['Container', `${config.container.label} · ${config.container.capacityTonsMin}–${config.container.capacityTonsMax} ton`]
      : ['Freight Basis', `Rs. ${config.country.partLoadFreightPerKg}/kg × shipment weight`],
    ['Destination', config.country.code ? `${config.country.name} (${config.country.code})` : config.country.name],
    ['CIR (Insurance)', `${config.country.cirPercent}% of goods value`],
    ['Shipment Weight', summary.totalWeightKg === null ? 'Not available' : `${summary.totalWeightKg.toLocaleString('en-IN')} kg`],
    ['Currency', config.currency],
  ];
  const colW = W / 2 - 12;
  const rowH = 26;
  const boxH = Math.ceil(rows.length / 2) * rowH + 16;
  doc.roundedRect(M, y, W, boxH, 6).fill(LIGHT);
  rows.forEach(([k, v], i) => {
    const x = M + 12 + (i % 2) * (W / 2);
    const yy = y + 10 + Math.floor(i / 2) * rowH;
    doc.font('Helvetica-Bold').fontSize(7.5).fill(SLATE).text(k.toUpperCase(), x, yy, { width: colW });
    doc.font('Helvetica').fontSize(9).fill(INK).text(v, x, yy + 10, { width: colW, lineBreak: false });
  });
  doc.fillColor(INK);
  return y + boxH + 14;
}

function rateTable(doc, y, card, footerLabel) {
  const { lines, config } = card;
  const cur = config.currency;
  const W = contentWidth(doc);
  const splitLabel = config.loadingType === 'full' ? 'Logistics\n(equal split)' : 'Logistics\n(pro-rata)';

  const defs = [
    ['sr', 'Sr', 20, 'left'],
    ['name', 'Product Name', 148, 'left'],
    ['pack', 'Pack', 42, 'left'],
    ['qty', 'Qty', 30, 'right'],
    ['wt', 'Wt (kg)', 40, 'right'],
    ['base', `Base Rate\n(${cur})`, 55, 'right'],
    ['addon', splitLabel, 55, 'right'],
    ['rate', `Export Rate\n(${cur})`, 60, 'right'],
    ['total', `Amount\n(${cur})`, W - 450, 'right'],
  ];
  let cx = M;
  const cols = defs.map(([key, label, w, align]) => {
    const c = { key, label, x: cx, w, align };
    cx += w;
    return c;
  });

  const HEAD_H = 26;
  const drawHead = (yy) => {
    doc.rect(M, yy, W, HEAD_H).fill(MAROON);
    doc.font('Helvetica-Bold').fontSize(7).fill('#ffffff');
    cols.forEach((c) => doc.text(c.label, c.x + 3, yy + 4, { width: c.w - 6, align: c.align }));
    return yy + HEAD_H;
  };
  y = drawHead(y);

  const groups = {};
  lines.forEach((l) => {
    (groups[l.category] = groups[l.category] || []).push(l);
  });
  const categoryOrder = [
    ...content.CATEGORY_ORDER,
    ...Object.keys(groups).filter((cat) => !content.CATEGORY_ORDER.includes(cat)),
  ];

  const num = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let sr = 0;
  categoryOrder.forEach((cat) => {
    const rows = groups[cat];
    if (!rows || !rows.length) return;
    if (y > bottomLimit(doc) - 28) { y = newPage(doc, footerLabel); y = drawHead(y); }
    doc.rect(M, y, W, 16).fill(BAND);
    doc.font('Helvetica-Bold').fontSize(8).fill(MAROON).text(cat, M + 6, y + 4);
    y += 16;
    rows.forEach((l) => {
      if (y > bottomLimit(doc)) { y = newPage(doc, footerLabel); y = drawHead(y); }
      sr += 1;
      if (sr % 2 === 0) doc.rect(M, y, W, 16).fill('#faf7f2');
      const vals = {
        sr: String(sr),
        name: l.productName,
        pack: l.packSize,
        qty: String(l.qty),
        wt: l.unitWeightKg === null ? '-' : num(l.unitWeightKg * l.qty),
        base: num(l.baseRate),
        addon: num(l.perUnitAddon),
        rate: num(l.exportRate),
        total: num(l.lineTotal),
      };
      doc.font('Helvetica').fontSize(7.5);
      cols.forEach((c) => doc.fill(c.key === 'rate' ? MAROON : INK).text(vals[c.key], c.x + 3, y + 4, { width: c.w - 6, align: c.align, lineBreak: false }));
      y += 16;
      doc.moveTo(M, y).lineTo(M + W, y).stroke(BORDER);
    });
  });
  return y + 6;
}

/** Logistics build-up + grand total, in the card currency with an INR reference. */
function totalsBlock(doc, y, card, footerLabel) {
  const { summary, config } = card;
  const cur = config.currency;
  const W = contentWidth(doc);
  const rows = [
    ['Goods Value', summary.goodsValue, summary.goodsValueInr],
    [summary.freightLabel, summary.freight, summary.freightInr],
    [`CIR Insurance (${config.country.cirPercent}% of goods value)`, summary.insurance, summary.insuranceInr],
    ['Total Logistics', summary.logistics, summary.logisticsInr],
  ];
  const blockH = 20 + rows.length * 16 + 22;
  if (y > bottomLimit(doc) - blockH) y = newPage(doc, footerLabel);
  doc.font('Helvetica-Bold').fontSize(10).fill(MAROON).text('SHIPMENT COST SUMMARY', M, y);
  y += 16;
  const valX = M + W - 200;
  rows.forEach(([label, val, valInr], i) => {
    if (i % 2 === 1) doc.rect(M, y, W, 16).fill('#faf7f2');
    doc.font('Helvetica').fontSize(8.5).fill(INK).text(label, M + 4, y + 4, { width: valX - M - 8 });
    doc.font('Helvetica-Bold').fontSize(8.5).fill(INK)
      .text(money(val, cur) + (cur !== 'INR' ? `   (${inr(valInr)})` : ''), valX, y + 4, { width: 200 - 4, align: 'right' });
    y += 16;
    doc.moveTo(M, y).lineTo(M + W, y).stroke(BORDER);
  });
  doc.rect(M, y, W, 20).fill(MAROON);
  doc.font('Helvetica-Bold').fontSize(9).fill('#ffffff').text('GRAND TOTAL (GOODS + LOGISTICS)', M + 4, y + 6);
  doc.font('Helvetica-Bold').fontSize(9).fill(GOLD)
    .text(money(summary.grandTotal, cur) + (cur !== 'INR' ? `   (${inr(summary.grandTotalInr)})` : ''), valX, y + 6, { width: 200 - 4, align: 'right' });
  doc.fillColor(INK);
  return y + 28;
}

/**
 * Facts card for the FOB card: the standard mixed-load pricing basis.
 *
 * Only the basis the buyer needs in order to read the price is stated. The
 * load option, the common-cost build-up, the overhead and margin assumptions
 * and the currency line are deliberately absent — they are our own workings,
 * and the margin figure in particular is not a customer's business. All of
 * them still drive the rates through fobAssumptions() and
 * computeFobUnitPricing(); this card just stops printing them.
 */
function fobBasisCard(doc, y, card) {
  const { config } = card;
  const a = config.fob;
  const W = contentWidth(doc);
  const rows = [
    ['Price Basis', 'FOB Nhava Sheva · Incoterms® 2020'],
    ['Standard Payload', `${(a.payloadKg / 1000).toLocaleString('en-IN')} MT saleable product per FCL`],
    // FOB prices are destination-independent; a country appears only on legacy
    // cards whose shipment snapshot still carries one.
    ...(config.country
      ? [['Destination', config.country.code ? `${config.country.name} (${config.country.code})` : config.country.name]]
      : []),
  ];
  const colW = W / 2 - 12;
  const rowH = 26;
  const boxH = Math.ceil(rows.length / 2) * rowH + 16;
  doc.roundedRect(M, y, W, boxH, 6).fill(LIGHT);
  rows.forEach(([k, v], i) => {
    const x = M + 12 + (i % 2) * (W / 2);
    const yy = y + 10 + Math.floor(i / 2) * rowH;
    doc.font('Helvetica-Bold').fontSize(7.5).fill(SLATE).text(k.toUpperCase(), x, yy, { width: colW });
    doc.font('Helvetica').fontSize(8.5).fill(INK).text(v, x, yy + 10, { width: colW, lineBreak: false });
  });
  doc.fillColor(INK);
  return y + boxH + 14;
}

/** FOB price table: per-unit and per-carton FOB selling prices, no logistics
 *  split (the standard mixed-load logistics is already inside the rate). */
function fobRateTable(doc, y, card, footerLabel) {
  const { lines, config } = card;
  const cur = config.currency;
  const W = contentWidth(doc);

  const defs = [
    ['sr', 'Sr', 20, 'left'],
    ['name', 'Product Name', cur === 'INR' ? 185 : 140, 'left'],
    ['pack', 'Pack', 42, 'left'],
    ['qty', 'Qty', 30, 'right'],
    ...(cur === 'INR' ? [] : [['rateInr', 'FOB Rate\n(Rs.)', 55, 'right']]),
    ['rate', `FOB Rate\n(${cur})`, 58, 'right'],
    ['upc', 'Units/\nCarton', 34, 'right'],
    ['carton', `FOB/Carton\n(${cur})`, 60, 'right'],
    ['total', `Amount\n(${cur})`, W - (cur === 'INR' ? 429 : 439), 'right'],
  ];
  let cx = M;
  const cols = defs.map(([key, label, w, align]) => {
    const c = { key, label, x: cx, w, align };
    cx += w;
    return c;
  });

  const HEAD_H = 26;
  const drawHead = (yy) => {
    doc.rect(M, yy, W, HEAD_H).fill(MAROON);
    doc.font('Helvetica-Bold').fontSize(7).fill('#ffffff');
    cols.forEach((c) => doc.text(c.label, c.x + 3, yy + 4, { width: c.w - 6, align: c.align }));
    return yy + HEAD_H;
  };
  y = drawHead(y);

  const groups = {};
  lines.forEach((l) => {
    (groups[l.category] = groups[l.category] || []).push(l);
  });
  const categoryOrder = [
    ...content.CATEGORY_ORDER,
    ...Object.keys(groups).filter((cat) => !content.CATEGORY_ORDER.includes(cat)),
  ];

  const num = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let sr = 0;
  categoryOrder.forEach((cat) => {
    const rows = groups[cat];
    if (!rows || !rows.length) return;
    if (y > bottomLimit(doc) - 28) { y = newPage(doc, footerLabel); y = drawHead(y); }
    doc.rect(M, y, W, 16).fill(BAND);
    doc.font('Helvetica-Bold').fontSize(8).fill(MAROON).text(cat, M + 6, y + 4);
    y += 16;
    rows.forEach((l) => {
      if (y > bottomLimit(doc)) { y = newPage(doc, footerLabel); y = drawHead(y); }
      sr += 1;
      if (sr % 2 === 0) doc.rect(M, y, W, 16).fill('#faf7f2');
      const vals = {
        sr: String(sr),
        name: l.productName,
        pack: l.packSize,
        qty: String(l.qty),
        rateInr: num(l.baseRateInr),
        rate: num(l.exportRate),
        upc: l.unitsPerCarton ? String(l.unitsPerCarton) : '-',
        carton: l.cartonPrice === null ? '-' : num(l.cartonPrice),
        total: num(l.lineTotal),
      };
      doc.font('Helvetica').fontSize(7.5);
      cols.forEach((c) => doc.fill(c.key === 'rate' ? MAROON : INK).text(vals[c.key], c.x + 3, y + 4, { width: c.w - 6, align: c.align, lineBreak: false }));
      y += 16;
      doc.moveTo(M, y).lineTo(M + W, y).stroke(BORDER);
    });
  });
  return y + 6;
}

/** FOB total: goods value only — freight/insurance are quoted separately. */
function fobTotalsBlock(doc, y, card, footerLabel) {
  const { summary, config } = card;
  const cur = config.currency;
  const W = contentWidth(doc);
  if (y > bottomLimit(doc) - 60) y = newPage(doc, footerLabel);
  const valX = M + W - 200;
  doc.rect(M, y, W, 20).fill(MAROON);
  doc.font('Helvetica-Bold').fontSize(9).fill('#ffffff').text('TOTAL FOB VALUE', M + 4, y + 6);
  doc.font('Helvetica-Bold').fontSize(9).fill(GOLD)
    .text(money(summary.grandTotal, cur) + (cur !== 'INR' ? `   (${inr(summary.grandTotalInr)})` : ''), valX, y + 6, { width: 200 - 4, align: 'right' });
  y += 26;
  doc.font('Helvetica-Oblique').fontSize(7.5).fill(SLATE)
    .text(`${summary.freightLabel}.`, M, y, { width: W });
  doc.fillColor(INK);
  return y + 16;
}

function termsBlock(doc, y, termsText, footerLabel) {
  const items = String(termsText || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!items.length) return y;
  const W = contentWidth(doc);
  if (y > bottomLimit(doc) - 60) y = newPage(doc, footerLabel);
  doc.font('Helvetica-Bold').fontSize(10).fill(MAROON).text('TERMS & CONDITIONS', M, y);
  y += 16;
  items.forEach((t, i) => {
    if (y > bottomLimit(doc)) y = newPage(doc, footerLabel);
    doc.font('Helvetica-Bold').fontSize(8.5).fill(SLATE).text(`${i + 1}.`, M, y, { width: 16 });
    doc.font('Helvetica').fontSize(8.5).fill(INK).text(t, M + 18, y, { width: W - 18 });
    y += doc.heightOfString(t, { width: W - 18 }) + 5;
  });
  return y + 4;
}

/** Renders the computed rate card to a PDF buffer. Pass ctx { lead, exec } to
 *  address the card to a specific client (lead pipeline). */
function renderRateCardPdf(card, ctx = {}) {
  const { config, summary } = card;
  if (config.rateType === 'fob') return renderFobCardPdf(card, ctx);
  const roleLabel = config.rateType === 'institution' ? 'Institution' : 'Distributor';
  const footerLabel = `Export Rate Card (${roleLabel})  ·  Trade Confidential`;
  return renderPdfBuffer((doc) => {
    const W = contentWidth(doc);
    let y = brandHeader(doc, `Export Rate Card — ${roleLabel}`, `${config.country.name}  ·  ${config.currency}`, ctx.lead);
    pageFooter(doc, footerLabel);
    if (ctx.lead) y = clientBlock(doc, y, ctx.lead, ctx.exec);
    y = shipmentCard(doc, y, card);

    doc.rect(M, y, W, 18).fill(MAROON);
    doc.font('Helvetica-Bold').fontSize(9).fill('#ffffff')
      .text('EXPORT PRODUCT PRICE LIST', M, y + 5, { width: W, align: 'center' });
    y += 24;
    doc.font('Helvetica').fontSize(7.5).fill(SLATE)
      .text(
        `All prices in ${config.currency} per pack  ·  Export Rate = Base Rate + apportioned logistics ` +
          `(${config.loadingType === 'full' ? 'split equally across products' : "distributed pro-rata to each product's value"})  ·  GST zero-rated for export`,
        M, y, { width: W }
      );
    y += 16;
    y = rateTable(doc, y, card, footerLabel);
    y = totalsBlock(doc, y + 4, card, footerLabel);

    if (summary.warnings.length) {
      if (y > bottomLimit(doc) - 40) y = newPage(doc, footerLabel);
      summary.warnings.forEach((w) => {
        doc.font('Helvetica-Oblique').fontSize(7.5).fill(MAROON).text(`Note: ${w}`, M, y, { width: W });
        y += doc.heightOfString(`Note: ${w}`, { width: W }) + 4;
      });
      doc.fillColor(INK);
    }
    termsBlock(doc, y + 6, card.rateCardTerms, footerLabel);
  });
}

/** The Standard FOB Price List layout (rate type "fob"). */
function renderFobCardPdf(card, ctx = {}) {
  const { config, summary } = card;
  const footerLabel = 'Standard FOB Price List  ·  Trade Confidential';
  return renderPdfBuffer((doc) => {
    const W = contentWidth(doc);
    let y = brandHeader(
      doc,
      'Standard FOB Price List',
      `FOB Nhava Sheva  ·  ${config.fob.label}  ·  ${config.currency}`,
      ctx.lead
    );
    pageFooter(doc, footerLabel);
    if (ctx.lead) y = clientBlock(doc, y, ctx.lead, ctx.exec);
    y = fobBasisCard(doc, y, card);

    doc.rect(M, y, W, 18).fill(MAROON);
    doc.font('Helvetica-Bold').fontSize(9).fill('#ffffff')
      .text('STANDARD FOB PRICE LIST BY SKU', M, y + 5, { width: W, align: 'center' });
    y += 24;
    doc.font('Helvetica').fontSize(7.5).fill(SLATE)
      .text(
        `All prices in ${config.currency} per pack  ·  standard mixed-load export logistics and target margin ` +
          'are built into every rate  ·  GST zero-rated for export',
        M, y, { width: W }
      );
    y += 16;
    y = fobRateTable(doc, y, card, footerLabel);
    y = fobTotalsBlock(doc, y + 4, card, footerLabel);

    if (summary.warnings.length) {
      if (y > bottomLimit(doc) - 40) y = newPage(doc, footerLabel);
      summary.warnings.forEach((w) => {
        doc.font('Helvetica-Oblique').fontSize(7.5).fill(MAROON).text(`Note: ${w}`, M, y, { width: W });
        y += doc.heightOfString(`Note: ${w}`, { width: W }) + 4;
      });
      doc.fillColor(INK);
    }
    termsBlock(doc, y + 6, card.rateCardTerms, footerLabel);
  });
}

/** "United Arab Emirates" -> "UnitedArabEmirates" for file names. */
function sanitizeName(s) {
  return (
    String(s || '')
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join('') || 'Export'
  );
}

function rateCardFileName(card) {
  if (card.config.rateType === 'fob') {
    return `Mickys_Standard_FOB_PriceList_${sanitizeName(card.config.fob.label)}_${card.config.currency}.pdf`;
  }
  const role = card.config.rateType === 'institution' ? 'Institution' : 'Distributor';
  return `Mickys_Export_RateCard_${role}_${sanitizeName(card.config.country.name)}_${card.config.currency}.pdf`;
}

module.exports = {
  RATE_TYPES,
  LOADING_TYPES,
  CONTAINER_SIZES,
  MASTER_FOR,
  parsePackWeightKg,
  fobVariantKey,
  fobAssumptions,
  computeFobUnitPricing,
  resolveLines,
  resolveFobLines,
  listFobItems,
  computeRateCard,
  computeRateCardFromLead,
  renderRateCardPdf,
  rateCardFileName,
};
