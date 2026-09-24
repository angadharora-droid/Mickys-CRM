/**
 * CRM SALES ORDERS -> TALLY SALES ORDER VOUCHERS
 *
 * The CRM cannot reach the hosted Tally, so Tally fetches: after every stock
 * push (assets/mickys-stock.tdl, every 10 minutes) the TDL reports the sales
 * orders Tally holds, asks the CRM for the orders it should create, and
 * creates each one as a Sales Order voucher. The format was proven by
 * hand-imported test orders on the company's TallyPrime 7.0, and the TDL's
 * way of building them by a one-off test add-on (SO/26-27/246):
 *
 *   - Tally numbers the voucher itself (SO/26-27/245). An imported order line
 *     MUST carry an Order no. ("Order No. is missing in Item Allocations"),
 *     and Tally's own number is unknown until it saves — so the Order no. is
 *     the CRM number, SO-2026-0042, and the narration names it too. An
 *     invoice raised against the order then carries SO-2026-0042 in its Order
 *     No(s), which orderPipeline.matchInvoices already reads.
 *   - Godown from Settings (PRIMARY PACKAGING SFG — the CRM books SFG only),
 *     batch "Any": accounts pick the real batch at invoicing/dispatch.
 *   - Item value before GST against the sales ledger, GST as CGST+SGST (or
 *     IGST) ledger lines per rate, rounded to the rupee like accounts' own.
 *
 * Test mode books every order against one dummy ledger with a TEST/ Order
 * no., so nobody invoices it; live mode books it against the customer's own
 * ledger. An order goes once it is confirmed (with payment) — once per mode,
 * handed out to a single request only. A send that never shows up in Tally's
 * next report is shown in the CRM with a "send again" for an admin; nothing is
 * re-sent automatically, because a re-send of an order that did arrive would
 * put it in Tally twice.
 */
const SalesOrder = require('../models/SalesOrder');
const Setting = require('../models/Setting');
const StockItem = require('../models/StockItem');
const Customer = require('../models/Customer');
const AppointedCustomer = require('../models/AppointedCustomer');
const TallyOrderCall = require('../models/TallyOrderCall');
const StockSyncLog = require('../models/StockSyncLog');
const { resolveLines } = require('./tallyLink.service');
const { tagValue, cleanName, parseTallyDate, TDL_VERSION } = require('./tallyStock.service');
const { round2 } = require('../utils/gst');
const { istDateKey } = require('../utils/istDate');


const DAY_MS = 24 * 60 * 60 * 1000;

/** Settings.tallyOrders as a plain object (schema defaults included). */
async function getConfig() {
  const settings = await Setting.getGlobal();
  const t = settings.tallyOrders;
  return t?.toObject ? t.toObject() : { ...(t || {}) };
}

/** The Order no. an order goes to Tally with in a mode. */
const orderNoFor = (number, mode) => (mode === 'test' ? `TEST/${number}` : number);

/**
 * Orders the add-on may still be given: confirmed since the switch-on and not
 * yet sent (or seen) in the current mode. An order sent in test mode is due
 * again once live mode is on — under its own customer this time.
 */
const eligibleFilter = (cfg) => ({
  status: 'confirmed',
  ...(cfg.sendFrom ? { confirmedAt: { $gte: cfg.sendFrom } } : {}),
  $or: [{ 'tally.mode': { $ne: cfg.mode } }, { 'tally.sentAt': null, 'tally.seenAt': null }],
});

// ---------------------------------------------------------------------------
// Building the voucher
// ---------------------------------------------------------------------------

/** 2.5 -> "2.5", 6 -> "6", for GST ledger names like "OUTPUT CGST @ 2.5%". */
const rateText = (r) => String(Number(Number(r).toFixed(2)));
const ledgerName = (pattern, rate) => String(pattern || '').replace(/\{rate\}/gi, rateText(rate));
const qtyText = (q) => String(Math.round((Number(q) || 0) * 1000) / 1000);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A date as Tally takes it typed: "24-Sep-2026" (the IST day). */
function tallyDateText(d) {
  const [y, m, day] = istDateKey(d).split('-');
  return `${Number(day)}-${MONTHS[Number(m) - 1]}-${y}`;
}

/**
 * Builds the Tally voucher for each order, or the reason it cannot go yet.
 * Returns [{ order, voucher } | { order, reason }] in the input order.
 *
 * voucher = { orderNo, date, party, narration,
 *             lines: [{ item, qty, unit, rate, amount }],
 *             ledgers: [{ name, amount, deemedPositive, isParty }] }
 * Ledger amounts carry Tally's sign: credits positive, debits negative.
 */
async function buildVouchers(orders, cfg) {
  const allLines = orders.flatMap((o) => (o.items || []).map((it) => ({ sku: it.sku, name: it.name })));
  const resolved = await resolveLines(allLines);
  const keys = [...new Set(resolved.map((r) => r.nameKey).filter(Boolean))];
  const appointedIds = [...new Set(orders.map((o) => o.customer?._id || o.customer).filter(Boolean).map(String))];
  const [stock, appointed, ledgers] = await Promise.all([
    StockItem.find({ nameKey: { $in: keys } }).select('name nameKey baseUnits').lean(),
    AppointedCustomer.find({ _id: { $in: appointedIds } }).select('companyName tallyLedger').lean(),
    Customer.find({}).select('name').lean(),
  ]);
  const stockByKey = new Map();
  for (const s of stock) {
    const seen = stockByKey.get(s.nameKey);
    if (!seen || String(s.name) < String(seen.name)) stockByKey.set(s.nameKey, s);
  }
  const appointedById = new Map(appointed.map((a) => [String(a._id), a]));
  const tallyLedgers = new Set(ledgers.map((l) => l.name));

  let cursor = 0;
  return orders.map((order) => {
    const items = order.items || [];
    const lineKeys = items.map(() => resolved[cursor++]);
    const fail = (reason) => ({ order, reason });

    // ---- the party ----
    let party = cfg.testLedger;
    if (cfg.mode === 'live') {
      const customerId = order.customer?._id || order.customer;
      if (customerId) {
        const a = appointedById.get(String(customerId));
        party = a?.tallyLedger || '';
        if (!party) {
          return fail(`${a?.companyName || order.customerName} is not linked to a Tally ledger — link it under Customers → Link to Tally`);
        }
      } else {
        party = order.customerName;
      }
      if (tallyLedgers.size && !tallyLedgers.has(party)) {
        return fail(`Ledger "${party}" is not in Tally's Sundry Debtors — create it in Tally or fix the customer's link`);
      }
    }
    if (!party) return fail('No test ledger is set in Settings → Tally orders');

    // ---- the items ----
    const lines = [];
    const taxByRate = new Map();
    for (let i = 0; i < items.length; i += 1) {
      const it = items[i];
      const qty = Number(it.qty) || 0;
      if (qty <= 0) continue;
      const s = stockByKey.get(lineKeys[i]?.nameKey);
      if (!s) {
        return fail(
          it.sku
            ? `"${it.name}" is not linked to a Tally stock item — link it under Rate Master → Link to Tally`
            : `"${it.name}" is not in Tally's stock list`
        );
      }
      if (!s.baseUnits) return fail(`Tally item "${s.name}" has no unit in the stock mirror`);
      const amount = round2(Number(it.taxable) || Number(it.amount) || qty * (Number(it.rate) || 0));
      lines.push({ item: s.name, qty: qtyText(qty), unit: s.baseUnits, rate: round2(amount / qty), amount });
      const gst = Number(it.gst) || 0;
      if (gst > 0) taxByRate.set(gst, round2((taxByRate.get(gst) || 0) + amount));
    }
    if (!lines.length) return fail('The order has no item with a quantity');

    // ---- GST, round-off, party ----
    // Worked out the way Tally does on the value per rate — CGST and SGST each
    // at half the rate, so the two always match — which can sit a paisa off
    // the CRM's per-line figures; the round-off to the rupee absorbs it.
    const entries = [];
    const inter = order.gst?.supplyType === 'inter';
    for (const [gst, taxable] of [...taxByRate.entries()].sort((a, b) => a[0] - b[0])) {
      if (inter) {
        entries.push({ name: ledgerName(cfg.igstLedger, gst), amount: round2((taxable * gst) / 100), deemedPositive: false, isParty: false });
      } else {
        const half = round2((taxable * gst) / 200);
        entries.push({ name: ledgerName(cfg.cgstLedger, gst / 2), amount: half, deemedPositive: false, isParty: false });
        entries.push({ name: ledgerName(cfg.sgstLedger, gst / 2), amount: half, deemedPositive: false, isParty: false });
      }
    }
    if (entries.some((e) => !e.name)) return fail('A GST ledger name is blank in Settings → Tally orders');
    const gross = round2(lines.reduce((s, l) => s + l.amount, 0) + entries.reduce((s, e) => s + e.amount, 0));
    let total = gross;
    if (cfg.roundOffLedger) {
      total = Math.round(gross);
      const diff = round2(total - gross);
      if (diff) entries.push({ name: cfg.roundOffLedger, amount: diff, deemedPositive: diff < 0, isParty: false });
    }
    entries.unshift({ name: party, amount: -total, deemedPositive: true, isParty: true });

    const orderNo = orderNoFor(order.number, cfg.mode);
    const exec = order.createdBy?.name ? `, booked by ${order.createdBy.name}` : '';
    const narration =
      (cfg.mode === 'test' ? 'CRM TEST ORDER - do not invoice. ' : '') +
      `CRM order ${order.number} for ${order.customerName}${exec}`;

    return {
      order,
      voucher: {
        orderNo,
        date: order.confirmedAt || order.createdAt,
        party,
        narration,
        lines,
        ledgers: entries,
        total,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Handing orders to the add-on
// ---------------------------------------------------------------------------

/**
 * The confirmed orders Tally should create now, built. With `claim`, each
 * buildable order is marked sent — atomically, so two Tally sessions asking at
 * once never both get it — and only the ones this call won are returned.
 * Unbuildable orders get their reason recorded and are left for next time.
 */
async function takeOrders({ claim = false, limit = 50 } = {}) {
  const cfg = await getConfig();
  if (!cfg.enabled) return { cfg, vouchers: [], held: [] };
  const orders = await SalesOrder.find(eligibleFilter(cfg))
    .sort({ confirmedAt: 1 })
    .limit(limit)
    .populate('createdBy', 'name')
    .lean();
  const built = await buildVouchers(orders, cfg);
  const now = new Date();
  const vouchers = [];
  const held = [];

  for (const b of built) {
    if (b.reason) {
      held.push({ id: String(b.order._id), number: b.order.number, customerName: b.order.customerName, reason: b.reason });
      if (claim && b.order.tally?.holdReason !== b.reason) {
        await SalesOrder.updateOne({ _id: b.order._id }, { $set: { 'tally.holdReason': b.reason } });
      }
      continue;
    }
    if (!claim) {
      vouchers.push({ ...b.voucher, number: b.order.number, id: String(b.order._id) });
      continue;
    }
    const won = await SalesOrder.updateOne(
      { _id: b.order._id, ...eligibleFilter(cfg) },
      {
        $set: {
          'tally.mode': cfg.mode,
          'tally.orderNo': b.voucher.orderNo,
          'tally.sentAt': now,
          'tally.voucherNumber': '',
          'tally.guid': '',
          'tally.seenAt': null,
          'tally.holdReason': '',
        },
        $inc: { 'tally.sendCount': 1 },
      }
    );
    if (won.modifiedCount === 1) vouchers.push({ ...b.voucher, number: b.order.number, id: String(b.order._id) });
  }

  if (claim) {
    await Setting.updateOne(
      { key: 'global' },
      { $set: { 'tallyOrders.lastPullAt': now, 'tallyOrders.lastPullCount': vouchers.length } }
    );
  }
  return { cfg, vouchers, held };
}

const esc = (s) =>
  String(s ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const money = (n) => (Number(n) || 0).toFixed(2);

/**
 * The feed the add-on walks: one flat <ROW> per step of building a voucher.
 *   HEAD    new voucher (party, Order no., narration, voucher type)
 *   ITEM    item line with its godown / batch Any / Order no. and its
 *           sales-ledger allocation; QTY, RATE, AMOUNT plain positive numbers
 *   PARTY   the party ledger line (debit)
 *   CREDIT  a GST or upward round-off line (credit)
 *   DEBIT   a downward round-off line (debit)
 *   END     save the voucher
 * Every amount is positive: the TDL applies the sign that goes with the row
 * kind, as literals, so it never has to read a sign or a Yes/No off the feed.
 * Flat rather than nested so the TDL is a single pass with no
 * sub-collections; every row carries every tag, empty where it does not
 * apply. The order and due dates are the day Tally creates the voucher.
 */
const ROW_TAGS = ['KIND', 'ORDER', 'VCHTYPE', 'DATE', 'PARTY', 'ORDERNO', 'NARRATION', 'ITEM', 'QTY', 'RATE', 'AMOUNT', 'GODOWN', 'LEDGER'];

function rowsXml(vouchers, cfg) {
  const row = (fields) => `<ROW>${ROW_TAGS.map((t) => `<${t}>${esc(fields[t])}</${t}>`).join('')}</ROW>`;
  const out = [];
  for (const v of vouchers) {
    const common = { ORDER: v.number, ORDERNO: v.orderNo };
    out.push(row({ ...common, KIND: 'HEAD', VCHTYPE: cfg.voucherType, DATE: tallyDateText(v.date), PARTY: v.party, NARRATION: v.narration }));
    for (const l of v.lines) {
      out.push(
        row({
          ...common,
          KIND: 'ITEM',
          ITEM: l.item,
          // Plain numbers: the add-on turns them into quantity and rate in
          // the item line's context, which supplies the item's own unit.
          QTY: l.qty,
          RATE: money(l.rate),
          AMOUNT: money(l.amount),
          GODOWN: cfg.godown,
          LEDGER: cfg.salesLedger,
        })
      );
    }
    for (const e of v.ledgers) {
      const kind = e.isParty ? 'PARTY' : e.deemedPositive ? 'DEBIT' : 'CREDIT';
      out.push(row({ ...common, KIND: kind, LEDGER: e.name, AMOUNT: money(Math.abs(e.amount)) }));
    }
    out.push(row({ ...common, KIND: 'END' }));
  }
  return `<MICKYSORDERS>\n${out.join('\n')}\n</MICKYSORDERS>\n`;
}

/**
 * A fixed sample order for checking the Tally side without touching a real
 * CRM order: one item at 190 + 5% GST, party = the test ledger, Order no.
 * TEST/SAMPLE-HHMM. The "Sample order" button in Tally's Mickys CRM Orders
 * report creates it from this feed; it is never recorded as sent anywhere.
 */
async function sampleVouchers() {
  const cfg = await getConfig();
  const stock =
    (await StockItem.findOne({ name: 'MAKHANI GRAVY 1KG -SFG' }).select('name baseUnits').lean()) ||
    (await StockItem.findOne({ baseUnits: { $nin: ['', null] }, closingQty: { $gt: 0 } }).sort({ name: 1 }).select('name baseUnits').lean());
  if (!stock) return { cfg, vouchers: [] };
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
    .format(new Date())
    .replace(':', '');
  const taxable = 190;
  const half = round2((taxable * 5) / 200);
  const gross = round2(taxable + 2 * half);
  const total = cfg.roundOffLedger ? Math.round(gross) : gross;
  const ledgers = [
    { name: cfg.testLedger || 'TEST', amount: -total, deemedPositive: true, isParty: true },
    { name: ledgerName(cfg.cgstLedger, 2.5), amount: half, deemedPositive: false, isParty: false },
    { name: ledgerName(cfg.sgstLedger, 2.5), amount: half, deemedPositive: false, isParty: false },
  ];
  const diff = round2(total - gross);
  if (diff) ledgers.push({ name: cfg.roundOffLedger, amount: diff, deemedPositive: diff < 0, isParty: false });
  return {
    cfg,
    vouchers: [
      {
        number: `SAMPLE-${hhmm}`,
        orderNo: `TEST/SAMPLE-${hhmm}`,
        date: new Date(),
        party: cfg.testLedger || 'TEST',
        narration: 'CRM SAMPLE ORDER - Tally add-on check. Delete after checking.',
        lines: [{ item: stock.name, qty: '1', unit: stock.baseUnits, rate: taxable, amount: taxable }],
        ledgers,
        total,
      },
    ],
  };
}

/**
 * The same orders as a Tally import file (Import → Transactions), in the
 * exact shape the hand-imported test orders proved — the fallback while the
 * add-on is not loaded, and a way to look at what the add-on would create.
 */
function importXml(vouchers, cfg) {
  const vch = (v) => {
    const d = istDateKey(v.date);
    const [y, m, day] = d.split('-').map(Number);
    const jd = Math.round((Date.UTC(y, m - 1, day) - Date.UTC(1900, 0, 1)) / DAY_MS) + 1;
    const p = `${day}-${MONTHS[m - 1]}-${String(y).slice(2)}`;
    const compact = d.replace(/-/g, '');
    const items = v.lines
      .map((l) => {
        const q = ` ${l.qty} ${l.unit}`;
        return `      <ALLINVENTORYENTRIES.LIST>
       <STOCKITEMNAME>${esc(l.item)}</STOCKITEMNAME>
       <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
       <RATE>${money(l.rate)}/${esc(l.unit)}</RATE>
       <AMOUNT>${money(l.amount)}</AMOUNT>
       <ACTUALQTY>${esc(q)}</ACTUALQTY>
       <BILLEDQTY>${esc(q)}</BILLEDQTY>
       <BATCHALLOCATIONS.LIST>
        <GODOWNNAME>${esc(cfg.godown)}</GODOWNNAME>
        <BATCHNAME>&#4; Any</BATCHNAME>
        <ORDERNO>${esc(v.orderNo)}</ORDERNO>
        <AMOUNT>${money(l.amount)}</AMOUNT>
        <ACTUALQTY>${esc(q)}</ACTUALQTY>
        <BILLEDQTY>${esc(q)}</BILLEDQTY>
        <ORDERDUEDATE JD="${jd}" P="${p}">${p}</ORDERDUEDATE>
       </BATCHALLOCATIONS.LIST>
       <ACCOUNTINGALLOCATIONS.LIST>
        <LEDGERNAME>${esc(cfg.salesLedger)}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <AMOUNT>${money(l.amount)}</AMOUNT>
       </ACCOUNTINGALLOCATIONS.LIST>
      </ALLINVENTORYENTRIES.LIST>`;
      })
      .join('\n');
    const ledgers = v.ledgers
      .map(
        (e) => `      <LEDGERENTRIES.LIST>
       <LEDGERNAME>${esc(e.name)}</LEDGERNAME>
       <ISDEEMEDPOSITIVE>${e.deemedPositive ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
${e.isParty ? '       <ISPARTYLEDGER>Yes</ISPARTYLEDGER>\n' : ''}       <AMOUNT>${money(e.amount)}</AMOUNT>
      </LEDGERENTRIES.LIST>`
      )
      .join('\n');
    return `    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <VOUCHER VCHTYPE="${esc(cfg.voucherType)}" ACTION="Create" OBJVIEW="Invoice Voucher View">
      <DATE>${compact}</DATE>
      <EFFECTIVEDATE>${compact}</EFFECTIVEDATE>
      <VOUCHERTYPENAME>${esc(cfg.voucherType)}</VOUCHERTYPENAME>
      <PARTYNAME>${esc(v.party)}</PARTYNAME>
      <PARTYLEDGERNAME>${esc(v.party)}</PARTYLEDGERNAME>
      <BASICBUYERNAME>${esc(v.party)}</BASICBUYERNAME>
      <BASICBASEPARTYNAME>${esc(v.party)}</BASICBASEPARTYNAME>
      <PARTYMAILINGNAME>${esc(v.party)}</PARTYMAILINGNAME>
      <REFERENCE>${esc(v.orderNo)}</REFERENCE>
      <NARRATION>${esc(v.narration)}</NARRATION>
      <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
      <ISINVOICE>No</ISINVOICE>
${items}
${ledgers}
     </VOUCHER>
    </TALLYMESSAGE>`;
  };
  return `<ENVELOPE>
 <HEADER>
  <TALLYREQUEST>Import Data</TALLYREQUEST>
 </HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>
     <SVCURRENTCOMPANY>CENTRE POINT FOODS PRIVATE LIMITED</SVCURRENTCOMPANY>
    </STATICVARIABLES>
   </REQUESTDESC>
   <REQUESTDATA>
${vouchers.map(vch).join('\n')}
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>
`.replace(/\n/g, '\r\n');
}

// ---------------------------------------------------------------------------
// What Tally reports back
// ---------------------------------------------------------------------------

/** The add-on's report of Tally's sales orders: <SALESORDER> per voucher. */
function parseSeenXml(xml) {
  if (typeof xml !== 'string') return { company: '', tdlVersion: '', orders: [] };
  const blocks = xml.match(/<SALESORDER>[\s\S]*?<\/SALESORDER>/g) || [];
  return {
    company: tagValue(xml, 'COMPANY'),
    tdlVersion: tagValue(xml, 'TDLVERSION'),
    orders: blocks.map((b) => ({
      guid: tagValue(b, 'GUID'),
      voucherNumber: tagValue(b, 'VOUCHERNUMBER'),
      date: parseTallyDate(tagValue(b, 'DATE')),
      party: cleanName(tagValue(b, 'PARTY')),
      reference: tagValue(b, 'REFERENCE'),
      narration: tagValue(b, 'NARRATION'),
    })),
  };
}

const CRM_NO_RX = /^\s*(TEST\s*\/\s*)?SO[\s_-]*(\d{4})[\s_-]*(\d{1,5})\s*$/i;
const NARRATION_RX = /CRM (TEST ORDER.*?)?order SO-(\d{4})-(\d{1,5})/i;

/** The CRM order a Tally sales order was created for, from its Order no. (or narration). */
function crmRefOf(so) {
  let m = String(so.reference || '').match(CRM_NO_RX);
  if (m) return { number: `SO-${m[2]}-${String(Number(m[3])).padStart(4, '0')}`, mode: m[1] ? 'test' : 'live' };
  m = String(so.narration || '').match(NARRATION_RX);
  if (m) return { number: `SO-${m[2]}-${String(Number(m[3])).padStart(4, '0')}`, mode: m[1] ? 'test' : 'live' };
  return null;
}

/**
 * Writes Tally's number onto each order whose voucher the report carries. A
 * voucher for an order the CRM never handed out in that mode (keyed by hand,
 * or imported from the fallback file) is recorded too — it is in Tally, so the
 * add-on must not create it again. A leftover test voucher of an order that
 * has since gone live is ignored.
 */
async function recordSeen(xml) {
  const report = parseSeenXml(xml);
  const at = new Date();
  let matched = 0;
  for (const so of report.orders) {
    const ref = crmRefOf(so);
    if (!ref) continue;
    const order = await SalesOrder.findOne({ number: ref.number }).select('tally').lean();
    if (!order) continue;
    const t = order.tally || {};
    if (t.mode && t.mode !== ref.mode && (t.sentAt || t.seenAt)) continue;
    await SalesOrder.updateOne(
      { _id: order._id },
      {
        $set: {
          'tally.mode': ref.mode,
          'tally.orderNo': orderNoFor(ref.number, ref.mode),
          'tally.voucherNumber': so.voucherNumber || t.voucherNumber || '',
          'tally.guid': so.guid || t.guid || '',
          'tally.seenAt': at,
          'tally.holdReason': '',
        },
      }
    );
    matched += 1;
  }
  await Setting.updateOne(
    { key: 'global' },
    {
      $set: {
        'tallyOrders.lastSeenAt': at,
        'tallyOrders.lastSeenCount': report.orders.length,
        'tallyOrders.lastTdlVersion': report.tdlVersion || '',
      },
    }
  );
  return { company: report.company, tdlVersion: report.tdlVersion, vouchers: report.orders.length, matched };
}

// ---------------------------------------------------------------------------
// What the screens show
// ---------------------------------------------------------------------------

/**
 * Where one order stands with Tally:
 *   off        the feature is switched off (and the order never went)
 *   waiting    not confirmed yet — it goes once it is
 *   before     confirmed before the switch-on — never sent
 *   queued     confirmed, due at the add-on's next visit
 *   held       confirmed, but cannot be built (reason says why)
 *   sent       collected by the add-on, not in Tally's report yet
 *   in_tally   Tally has it (voucherNumber)
 *   missing    was in Tally, gone from its latest report (deleted there?)
 *   none       past confirmed without ever going (nothing to do)
 */
function statusOf(order, cfg, now = new Date()) {
  const t = order.tally || {};
  const base = { mode: t.mode || '', orderNo: t.orderNo || '', voucherNumber: t.voucherNumber || '', sentAt: t.sentAt || null, seenAt: t.seenAt || null, holdReason: '' };
  // A send in the other mode (a test copy, once live is on) does not count:
  // the order is due again in this one.
  const sameMode = !cfg.enabled || !t.mode || t.mode === cfg.mode;
  if (sameMode && t.seenAt) {
    const recent = order.confirmedAt && now - new Date(order.confirmedAt) < 55 * DAY_MS;
    const gone = recent && cfg.lastSeenAt && new Date(t.seenAt) < new Date(cfg.lastSeenAt) - 60 * 1000;
    return { ...base, state: gone ? 'missing' : 'in_tally' };
  }
  if (sameMode && t.sentAt) return { ...base, state: 'sent' };
  if (!cfg.enabled) return { ...base, state: 'off' };
  if (order.status === 'open') return { ...base, state: 'waiting' };
  if (order.status !== 'confirmed') return { ...base, state: 'none' };
  if (cfg.sendFrom && order.confirmedAt && new Date(order.confirmedAt) < new Date(cfg.sendFrom)) {
    return { ...base, state: 'before' };
  }
  return { ...base, state: t.holdReason ? 'held' : 'queued', holdReason: t.holdReason || '' };
}

/** Clears an order's send so the add-on offers it again (admin, after checking Tally). */
async function resetSend(orderId) {
  return SalesOrder.findByIdAndUpdate(
    orderId,
    {
      $set: {
        'tally.mode': '',
        'tally.orderNo': '',
        'tally.sentAt': null,
        'tally.voucherNumber': '',
        'tally.guid': '',
        'tally.seenAt': null,
        'tally.holdReason': '',
      },
    },
    { new: true }
  );
}

/**
 * The settings screen's picture: what is due (and what is held back and
 * why), what went and has not shown up in Tally, and when the add-on last
 * called in each direction.
 */
async function overview() {
  const cfg = await getConfig();
  const [{ vouchers, held }, sentWaiting, inTally, testLedgerInTally, calls, lastStockSync] = await Promise.all([
    takeOrders({ claim: false, limit: 200 }),
    cfg.enabled
      ? SalesOrder.find({ 'tally.mode': cfg.mode, 'tally.sentAt': { $ne: null }, 'tally.seenAt': null })
          .select('number customerName tally.sentAt')
          .sort({ 'tally.sentAt': -1 })
          .limit(50)
          .lean()
      : [],
    cfg.enabled ? SalesOrder.countDocuments({ 'tally.mode': cfg.mode, 'tally.seenAt': { $ne: null } }) : 0,
    cfg.testLedger ? Customer.exists({ name: cfg.testLedger }) : null,
    TallyOrderCall.find({}).sort({ at: -1 }).limit(20).lean(),
    StockSyncLog.findOne({ source: 'push' }).sort({ createdAt: -1 }).select('syncedAt createdAt tdlVersion').lean(),
  ]);
  return {
    config: cfg,
    tdlLatest: TDL_VERSION,
    tdlCurrent: (cfg.lastTdlVersion || '') === TDL_VERSION,
    testLedgerInTally: Boolean(testLedgerInTally),
    queued: vouchers.map((v) => ({ id: v.id, number: v.number, party: v.party, total: v.total })),
    held,
    sentWaiting: sentWaiting.map((o) => ({ id: String(o._id), number: o.number, customerName: o.customerName, sentAt: o.tally.sentAt })),
    inTally,
    // What the Tally side actually sent, newest first — the stock push beside
    // it shows whether Tally's timer is running at all.
    calls,
    lastStockPush: lastStockSync
      ? { at: lastStockSync.syncedAt || lastStockSync.createdAt, tdlVersion: lastStockSync.tdlVersion || '' }
      : null,
  };
}

module.exports = {
  getConfig,
  orderNoFor,
  buildVouchers,
  takeOrders,
  sampleVouchers,
  rowsXml,
  importXml,
  parseSeenXml,
  crmRefOf,
  recordSeen,
  statusOf,
  resetSend,
  overview,
};
