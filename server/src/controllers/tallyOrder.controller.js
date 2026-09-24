const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const SalesOrder = require('../models/SalesOrder');
const TallyOrderCall = require('../models/TallyOrderCall');
const { logActivity } = require('../services/activity.service');
const { istDateKey } = require('../utils/istDate');
const { TDL_VERSION } = require('../services/tallyStock.service');
const {
  takeOrders,
  sampleVouchers,
  rowsXml,
  importXml,
  recordSeen,
  resetSend,
  overview,
} = require('../services/tallyOrder.service');

/** Same guard as the stock sync: only Mickys (CENTRE POINT FOODS…) talks to the CRM. */
const SYNC_COMPANY = /^CENTRE POINT/i;

/**
 * Keeps a record of each call from the Tally side (models/TallyOrderCall.js)
 * for the settings screen — the only place anyone can see what Tally sent.
 * Never allowed to fail the call itself.
 */
const recordCall = (req, fields) =>
  TallyOrderCall.create({ userAgent: String(req.headers['user-agent'] || '').slice(0, 200), ...fields }).catch((err) =>
    console.error(`[tally-orders] could not record the call: ${err.message}`)
  );

const tallyReply = (res, ok, message) =>
  res.type('text/xml').send(`<RESPONSE><STATUS>${ok ? 1 : 0}</STATUS><MESSAGE>${message}</MESSAGE></RESPONSE>`);

// GET /api/stock/tally-orders?key=&claim=1 — the rows the add-on walks to
// create the due orders. Only the add-on's own request (key + claim=1) hands
// orders out; opening the URL without claim=1 just shows what is due.
const orderFeed = asyncHandler(async (req, res) => {
  // ?sample=1 — a fixed TEST sample for the add-on's "Sample order" / "Check
  // feed" buttons; no CRM order is touched.
  if (req.query.sample === '1') {
    const { cfg, vouchers } = await sampleVouchers();
    if (req.tallyPush) await recordCall(req, { kind: 'feed', note: 'sample order', handedOut: vouchers.map((v) => v.orderNo) });
    return res.type('text/xml').send(rowsXml(vouchers, cfg));
  }
  const claim = Boolean(req.tallyPush) && req.query.claim === '1';
  const { cfg, vouchers } = await takeOrders({ claim });
  if (req.tallyPush) {
    await recordCall(req, {
      kind: 'feed',
      claim,
      handedOut: vouchers.map((v) => v.number),
      note: cfg.enabled ? '' : 'Orders into Tally is switched off',
    });
  }
  if (claim && vouchers.length) {
    await logActivity({
      action: 'TALLY_ORDERS_SENT',
      entity: 'SalesOrder',
      details:
        `Tally add-on collected ${vouchers.length} sales order(s) to create (${cfg.mode} mode): ` +
        vouchers.map((v) => `${v.number} as ${v.orderNo}`).join(', '),
      ip: req.ip,
    });
  }
  res.type('text/xml').send(rowsXml(vouchers, cfg));
});

// POST /api/stock/tally-orders/seen?key= — body: the add-on's report of the
// sales orders Tally holds (XML).
const ordersSeen = asyncHandler(async (req, res) => {
  const xml = typeof req.body === 'string' ? req.body : req.body?.xml;
  if (!xml || typeof xml !== 'string') {
    await recordCall(req, {
      kind: 'seen',
      note: `No XML body (content-type "${req.headers['content-type'] || ''}")`,
    });
    throw ApiError.badRequest('No Tally XML provided');
  }
  const company = (xml.match(/<COMPANY>([\s\S]*?)<\/COMPANY>/) || [])[1] || '';
  const call = {
    kind: 'seen',
    company: company.trim(),
    bytes: xml.length,
    blocks: (xml.match(/<SALESORDER>/g) || []).length,
    sample: xml.slice(0, 800),
  };
  if (company && !SYNC_COMPANY.test(company.trim())) {
    await recordCall(req, { ...call, note: 'Refused: not CENTRE POINT FOODS' });
    return tallyReply(res, false, `Ignored: sales orders from "${company.trim()}" - only CENTRE POINT FOODS talks to the CRM`);
  }
  const result = await recordSeen(xml);
  await recordCall(req, { ...call, tdlVersion: result.tdlVersion, matched: result.matched });
  const outdated = result.tdlVersion !== TDL_VERSION;
  return tallyReply(
    res,
    true,
    `Mickys CRM: ${result.vouchers} sales orders seen, ${result.matched} from the CRM` +
      (outdated ? ` [OLD TDL - download v${TDL_VERSION} from the CRM and restart Tally]` : ` [TDL v${TDL_VERSION}]`)
  );
});

// GET /api/tally-orders/overview — the settings screen's status panel.
const tallyOrdersOverview = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await overview() });
});

// GET /api/tally-orders/import-file?claim=1 — the due orders as a Tally import
// file (Import → Transactions): the fallback while the add-on is not running.
// With claim=1 the orders in it count as sent, so the add-on will not create
// them a second time.
const tallyImportFile = asyncHandler(async (req, res) => {
  const claim = req.query.claim === '1';
  const { cfg, vouchers } = await takeOrders({ claim, limit: 200 });
  if (!cfg.enabled) throw ApiError.badRequest('Sending orders to Tally is switched off in Sales Order Settings');
  if (!vouchers.length) throw ApiError.badRequest('No confirmed order is due in Tally right now');
  if (claim) {
    await logActivity({
      userId: req.user._id,
      action: 'TALLY_ORDERS_SENT',
      entity: 'SalesOrder',
      details: `Downloaded ${vouchers.length} sales order(s) as a Tally import file (${cfg.mode} mode): ${vouchers.map((v) => v.number).join(', ')}`,
      ip: req.ip,
    });
  }
  res.setHeader('Content-Type', 'text/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="crm-sales-orders-${istDateKey(new Date())}.xml"`);
  res.send(importXml(vouchers, cfg));
});

// POST /api/sales-orders/:id/tally-resend — admin: offer the order to the
// add-on again (it was sent but never arrived, or was deleted in Tally).
const resendToTally = asyncHandler(async (req, res) => {
  const order = await SalesOrder.findById(req.params.id).select('number status tally');
  if (!order) throw ApiError.notFound('Sales order not found');
  if (order.status !== 'confirmed') {
    throw ApiError.badRequest(`Only confirmed orders go to Tally — ${order.number} is ${order.status}`);
  }
  const before = order.tally?.voucherNumber ? ` (was Tally ${order.tally.voucherNumber})` : '';
  await resetSend(order._id);
  await logActivity({
    userId: req.user._id,
    action: 'TALLY_ORDER_RESEND',
    entity: 'SalesOrder',
    entityId: order._id,
    details: `Sales order ${order.number} queued to go to Tally again${before}`,
    ip: req.ip,
  });
  res.json({ success: true, message: `${order.number} will go to Tally at the add-on's next run` });
});

module.exports = { orderFeed, ordersSeen, tallyOrdersOverview, tallyImportFile, resendToTally };
