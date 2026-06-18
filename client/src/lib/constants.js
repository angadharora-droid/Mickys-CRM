export const ROLES = {
  ADMIN: 'admin',
  SALES_EXEC: 'sales_exec',
};

export const ROLE_LABELS = {
  admin: 'Admin',
  sales_exec: 'Sales Executive',
};

export const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'sales_exec', label: 'Sales Executive' },
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
];

export const KIT_TYPES = [
  { value: 'distributor', label: 'Distributor Kit' },
  { value: 'institutional', label: 'Institutional Kit' },
];

export const KIT_TYPE_LABELS = {
  distributor: 'Distributor Kit',
  institutional: 'Institutional Kit',
};

/** Document set per kit type (matches the developer brief). */
export const KIT_DOCS = {
  distributor: [
    'Distributor Price Card',
    'HORECA Distributor Agreement',
    'Annexure B – Onboarding Checklist',
  ],
  institutional: [
    'Institutional Price Card',
    'Quotation with Terms & Conditions',
  ],
};

/**
 * Default Terms & Conditions pre-filled in the Step 3 review (one clause per
 * line). Mirrors the server's kitContent.js; the edited text is printed on the
 * distributor price card / institutional quotation.
 */
export const DEFAULT_KIT_TERMS = {
  distributor: [
    'The above DLP prices are inclusive of GST @ 5%.',
    'Prices can be changed without any prior notice.',
    'Orders will be billed at prevailing prices at the time of dispatch.',
    'Orders must meet the MOQ.',
    'Returns are not accepted unless there are verified quality issues.',
    'Rates are inclusive of logistics cost to the desired customer address / warehouse.',
    'All disputes will be subjected to Nagpur jurisdiction.',
  ],
  institutional: [
    'Prices are inclusive of GST @ 5%.',
    'Prices are valid for the period mentioned above only.',
    'Orders billed at prevailing prices at time of dispatch.',
    'Orders must meet the MOQ.',
    'Returns not accepted unless there are verified quality issues.',
    'Rates are inclusive of logistics to customer address / warehouse.',
    'All disputes subject to Nagpur jurisdiction.',
    'This quotation does not constitute a binding order confirmation.',
  ],
};

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
