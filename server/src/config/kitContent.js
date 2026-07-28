/**
 * Static template content for the sales kit documents, transcribed from the
 * official reference files in /docs. Product pricing lives in the RateItem
 * catalogue (data-driven); the legal/boilerplate content below is fixed text.
 */

// Order in which catalogue categories are grouped on the price cards.
const CATEGORY_ORDER = ['PULSES & DAL', 'GRAVIES', 'PASTE', 'SAUCE'];

// 34-clause HORECA Distributor Agreement — [Sr, Particulars, Terms]. {distributor}
// and {territory} placeholders are filled per lead at render time.
const DISTRIBUTOR_AGREEMENT_TERMS = [
  ['Company Name', "MICKY'S BY CP FOODS"],
  ['Distributor Name', '{distributor}'],
  ['Nature of Appointment', 'Authorized HORECA Distributor on a Principal-to-Principal basis'],
  ['Territory', 'Exclusive Territory to be mutually finalized'],
  ['Territory Restriction', 'Distributor shall not sell outside the allotted territory without written approval'],
  ['Product Category', 'RTC & RTE Products and any products introduced by the Company from time to time'],
  ['Pricing Structure', 'Products to be supplied at Distributor Transfer Price (DTP) as per prevailing price list'],
  ['MOQ (Minimum Order Quantity)', '5 Ton per dispatch'],
  ['Distributor Margin', 'Embedded in DTP pricing structure'],
  ['Additional Commission', 'No additional commission payable'],
  ['Payment Terms', 'Initial supplies on Advance Payment basis'],
  ['Credit Facility', 'Credit period may be extended post approval by management'],
  ['Payment Default Clause', 'Company reserves right to suspend dispatch in case of delayed payments'],
  ['Inventory Requirement', 'Distributor to maintain 21–30 days rolling inventory'],
  ['Mandatory SKU Requirement', 'Core SKUs to be maintained at all times'],
  ['Logistics Responsibility', 'Distributor responsible for local storage, transportation & secondary invoicing'],
  ['Risk Transfer', 'Risk & title transfer upon dispatch from Company warehouse'],
  ['Required Documents', 'GST, FSSAI, Trade License, PAN, Bank Details, Financial Statements, Horeca Client List'],
  ['Infrastructure Requirement', 'Warehouse & logistics capability verification mandatory'],
  ['Security Deposit', 'Not Applicable'],
  ['Initial Stocking Requirement', 'Mandatory opening stock equivalent to 21–30 days projected sales'],
  ['Sales Team Training', 'Mandatory product induction & sales training'],
  ['Launch Plan Submission', 'Within 30 days from appointment'],
  ['Reporting Requirement', 'Monthly Stock Report & Secondary Sales Report'],
  ['Market Feedback Submission', 'Quarterly market feedback & credit ageing report'],
  ['Sales Target', 'Quarterly targets to be mutually agreed'],
  ['Performance Review Clause', 'Failure to achieve 70% target for 2 consecutive quarters may lead to termination'],
  ['Agreement Tenure', '1 Year from execution date'],
  ['Termination Notice', '30 Days written notice by either party'],
  ['Immediate Termination Conditions', 'Payment default, insolvency, brand misconduct'],
  ['Confidentiality', 'Distributor to maintain confidentiality of pricing, recipes & commercial strategy'],
  ['Governing Law', 'Laws of India'],
  ['Jurisdiction', 'Nagpur Courts only'],
];

// Annexure B — Distributor Onboarding Checklist, grouped sections.
const ONBOARDING_CHECKLIST = [
  {
    section: 'Compliance & Legal Documents',
    items: [
      ['GST Registration', 'Provide GST certificate copy'],
      ['FSSAI License', 'Valid and active; include license number'],
      ['Trade License', 'Current municipal trade license'],
      ['PAN & Bank Details', 'PAN card + cancelled cheque / bank letter'],
      ['Financial Statements', 'Last 2 years audited statements'],
    ],
  },
  {
    section: 'Infrastructure & Operations',
    items: [
      ['Warehouse Verification', 'Minimum cold/dry storage as per requirement'],
      ['Logistics Capability', 'Owned or contracted last-mile delivery fleet'],
      ['Horeca Client List', 'Existing hotel/restaurant/cafe accounts'],
    ],
  },
  {
    section: 'Commercial Readiness',
    items: [
      ['Initial Stocking Order Completed', 'Minimum 21–30 days projected sales'],
      ['Advance Payment Processed', 'As per payment terms in agreement'],
    ],
  },
  {
    section: 'Training & Launch',
    items: [
      ['Sales Training Conducted', 'Product induction session completed'],
      ['Launch Plan Submitted', 'Within 30 days from appointment date'],
      ['Quarterly Target Agreed', 'Mutually signed target sheet attached'],
    ],
  },
];

// Price-card terms & conditions (shared by both price cards). {priceLabel} is
// "DLP" (distributor) or "Inst." (institutional).
const PRICE_CARD_TERMS = [
  'The above {priceLabel} prices are inclusive of GST @ 5%.',
  'Prices can be changed without any prior notice.',
  'Orders will be billed at prevailing prices at the time of dispatch.',
  'Orders must meet the MOQ.',
  'Returns are not accepted unless there are verified quality issues.',
  'Rates are inclusive of logistics cost to the desired customer address / warehouse.',
  'All disputes will be subjected to Nagpur jurisdiction.',
];

// Monthly incentive scheme slabs — [Slab, Incentive %].
const INCENTIVE_SLABS = [
  ['500 – 999 Kg', '3%'],
  ['1.0 Ton – 1.99 Ton', '4%'],
  ['2 Ton & Above', '5%'],
];
const INCENTIVE_VALIDITY = 'W.E.F. 01/06/2025 TO 30/09/2026';

// Quotation terms & conditions.
const QUOTATION_TERMS = [
  'Prices are inclusive of GST @ 5%.',
  'Prices are valid for the period mentioned above only.',
  'Orders billed at prevailing prices at time of dispatch.',
  'Orders must meet the MOQ.',
  'Returns not accepted unless there are verified quality issues.',
  'Rates are inclusive of logistics to customer address / warehouse.',
  'All disputes subject to Nagpur jurisdiction.',
  'This quotation does not constitute a binding order confirmation.',
];

const QUOTATION_DEFAULTS = {
  paymentTerms: '15 days from date of invoice',
  validityDays: 15,
};

// The landed price a distributor pays: the product's Basic rate plus its GST,
// to the paisa — e.g. Basic 130 @ 5% → DLP 136.50. Shared by the distributor
// and stockist cards, which differ only in what they do with it.
const dlp = (basic, gst) => Math.round((Number(basic) || 0) * (1 + (Number(gst) || 0) / 100) * 100) / 100;

// Stockist pricing (Stockist Price Card): 5% below the DLP, rounded to the
// paisa — e.g. Basic 130 → DLP 136.50 → Stockist Price 129.68.
const STOCKIST_FACTOR = 0.95;
// `dlp * 95` stays exact for paisa-precision DLPs, so half-values round up
// (136.50 → 129.68) the way the reference price card does.
const stockistPrice = (dlp) => Math.round((Number(dlp) || 0) * 95) / 100;

module.exports = {
  CATEGORY_ORDER,
  DISTRIBUTOR_AGREEMENT_TERMS,
  ONBOARDING_CHECKLIST,
  PRICE_CARD_TERMS,
  INCENTIVE_SLABS,
  INCENTIVE_VALIDITY,
  QUOTATION_TERMS,
  QUOTATION_DEFAULTS,
  STOCKIST_FACTOR,
  dlp,
  stockistPrice,
};
