export const ROLES = {
  ADMIN: 'admin',
  SALES_EXEC: 'sales_exec',
  PR_MANAGER: 'pr_manager',
};

export const ROLE_LABELS = {
  admin: 'Admin',
  sales_exec: 'Sales Executive',
  pr_manager: 'PR Manager',
};

export const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'sales_exec', label: 'Sales Executive' },
  { value: 'pr_manager', label: 'PR Manager' },
];

export const LEAD_STATUSES = ['new', 'kit_selected', 'rates_confirmed', 'generated', 'delivered'];

export const STATUS_LABELS = {
  new: 'New Lead',
  kit_selected: 'Kit Selected',
  rates_confirmed: 'Rates Confirmed',
  generated: 'Kit Generated',
  delivered: 'Delivered',
};

/** Tailwind classes per lead status, used by StatusBadge. */
export const STATUS_STYLES = {
  new: 'bg-stone-100 text-stone-600 ring-stone-300/60 dark:bg-stone-800 dark:text-stone-300 dark:ring-stone-700',
  kit_selected: 'bg-amber-50 text-amber-800 ring-amber-300/70 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800',
  rates_confirmed: 'bg-sky-50 text-sky-800 ring-sky-300/70 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-800',
  generated: 'bg-violet-50 text-violet-800 ring-violet-300/70 dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-800',
  delivered: 'bg-emerald-50 text-emerald-800 ring-emerald-300/70 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800',
};

export const BUSINESS_TYPES = [
  'Hotel',
  'Restaurant',
  'Cloud Kitchen',
  'Caterer',
  'Distributor',
  'Institution',
  'QSR',
  'Other',
];

/** Selectable next-action for a lead's follow-up. */
export const ACTION_POINTS = [
  'Need to revisit',
  'Send Sample',
  'Send distributor kit',
  'Send institutional kit',
  'Send export kit',
];

/** Optional lead fields worth completing. Keys match both the create form and
 *  the lead document; used to notify what's still blank (LeadCreate toast,
 *  LeadDetail banner). The follow-up date lives at followUp.date on the
 *  document, so each page checks it separately. */
export const LEAD_OPTIONAL_FIELDS = [
  ['designation', 'Designation'],
  ['email', 'Email'],
  ['whatsappNumber', 'WhatsApp number'],
  ['state', 'State'],
  ['address', 'Full address'],
  ['gstin', 'GSTIN'],
  ['leadSource', 'Lead source'],
  ['actionPoint', 'Action point'],
];

export const KIT_TYPES = [
  { value: 'distributor', label: 'Distributor Kit' },
  { value: 'stockist', label: 'Stockist Kit' },
  { value: 'institutional', label: 'Institutional Kit' },
  { value: 'export', label: 'Export Kit' },
];

export const KIT_TYPE_LABELS = {
  distributor: 'Distributor Kit',
  stockist: 'Stockist Kit',
  institutional: 'Institutional Kit',
  export: 'Export Kit',
};

/** Document set per kit type (matches the developer brief). */
// Always CC'd on outgoing kit emails (enforced again on the server). Shown in
// the email form so the sender knows it's included and can add more addresses.
export const FIXED_KIT_CC = 'angadh.arora@cpgh.in';

export const KIT_DOCS = {
  distributor: [
    'Distributor Price Card',
    'HORECA Distributor Agreement',
    'Annexure B – Onboarding Checklist',
    "Micky's Brochure",
  ],
  stockist: [
    'Stockist Price Card',
    'HORECA Stockist Agreement',
    'Annexure B – Onboarding Checklist',
    "Micky's Brochure",
  ],
  institutional: [
    'Quotation with Terms & Conditions',
    "Micky's Brochure",
  ],
  export: [
    'Export Rate Card',
    "Micky's Brochure",
  ],
};

/**
 * Default Terms & Conditions pre-filled in the Step 3 review (one clause per
 * line). Mirrors the server's kitContent.js; the edited text is printed on the
 * distributor price card / institutional quotation.
 */
export const DEFAULT_KIT_TERMS = {
  distributor: [
    'The above DLP prices are exclusive of GST @ 5%.',
    'Prices can be changed without any prior notice.',
    'Orders will be billed at prevailing prices at the time of dispatch.',
    'Orders must meet the MOQ.',
    'Returns are not accepted unless there are verified quality issues.',
    'Rates are inclusive of logistics cost to the desired customer address / warehouse.',
    'All disputes will be subjected to Nagpur jurisdiction.',
  ],
  stockist: [
    'The above prices are exclusive of GST @ 5%.',
    'Prices can be changed without any prior notice.',
    'Orders will be billed at prevailing prices at the time of dispatch.',
    'Orders must meet the MOQ.',
    'Returns are not accepted unless there are verified quality issues.',
    'Rates are inclusive of logistics cost to the desired customer address / warehouse.',
    'All disputes will be subjected to Nagpur jurisdiction.',
  ],
  institutional: [
    'Prices are exclusive of GST @ 5%.',
    'Prices are valid for the period mentioned above only.',
    'Orders billed at prevailing prices at time of dispatch.',
    'Orders must meet the MOQ.',
    'Returns not accepted unless there are verified quality issues.',
    'Rates are inclusive of logistics to customer address / warehouse.',
    'All disputes subject to Nagpur jurisdiction.',
    'This quotation does not constitute a binding order confirmation.',
  ],
  // Mirrors the server's Setting.export.rateCardTerms default.
  export: [
    "Rates are quoted per pack and include the shipment's apportioned logistics as itemised on this card.",
    'Exports are zero-rated under GST (supply under LUT); prices exclude destination-country duties, taxes and clearance charges.',
    'Rates are indicative until confirmed by proforma invoice and are valid for 15 days from the card date.',
    'Exchange rate as printed on this card; final invoicing at the rate prevailing on the invoice date.',
    'Subject to Nagpur jurisdiction.',
  ],
};

// Terms for the export kit's FOB rate type (mirrors the server's
// Setting.export.fobRateCardTerms default — the workbook's standard
// quotation conditions).
export const DEFAULT_FOB_TERMS = [
  'Prices are FOB Nhava Sheva, Incoterms® 2020 — ocean freight and insurance are quoted separately based on destination port and booking date.',
  'Rates are based on one standard mixed-load consignment with approximately 18 MT saleable payload per FCL.',
  'Minimum commercial order: one mixed-load FCL, subject to minimum SKU quantities.',
  'Rates are valid for 15 days and subject to exchange-rate and statutory-cost changes.',
  'The final proforma invoice may be adjusted if actual container utilisation is materially below the standard payload.',
  'Exports are zero-rated under GST (supply under LUT); prices exclude destination-country duties, taxes and clearance charges.',
  'Subject to Nagpur jurisdiction.',
];

export const DEFAULT_DISTRIBUTOR_AGREEMENT_TERMS = [
  ["Company Name", "MICKY'S BY CP FOODS"],
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
  ['Inventory Requirement', 'Distributor to maintain 21-30 days rolling inventory'],
  ['Mandatory SKU Requirement', 'Core SKUs to be maintained at all times'],
  ['Logistics Responsibility', 'Distributor responsible for local storage, transportation & secondary invoicing'],
  ['Risk Transfer', 'Risk & title transfer upon dispatch from Company warehouse'],
  ['Required Documents', 'GST, FSSAI, Trade License, PAN, Bank Details, Financial Statements, Horeca Client List'],
  ['Infrastructure Requirement', 'Warehouse & logistics capability verification mandatory'],
  ['Security Deposit', 'Not Applicable'],
  ['Initial Stocking Requirement', 'Mandatory opening stock equivalent to 21-30 days projected sales'],
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

/** Brand chart palette: maroon, saffron gold, warm neutrals + semantic greens/reds. */
export const CHART_COLORS = ['#8c2424', '#f0a417', '#3f2a24', '#c97b4a', '#e7c668', '#0f9d6e', '#d64545', '#2d7fb8'];

/** Shared recharts tooltip styling that follows the design system. */
export const CHART_TOOLTIP_STYLE = {
  borderRadius: 12,
  border: '1px solid hsl(var(--border))',
  background: 'hsl(var(--card))',
  color: 'hsl(var(--card-foreground))',
  fontSize: 13,
  boxShadow: '0 8px 24px -8px rgb(16 24 40 / 0.16)',
};
