const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const SalesOrder = require('../models/SalesOrder');
const { logActivity } = require('../services/activity.service');
const { istDateKey } = require('../utils/istDate');
const { TDL_VERSION } = require('../services/tallyStock.service');
const {
  takeOrders,
  rowsXml,
  importXml,
  recordSeen,
  resetSend,
  overview,
} = require('../services/tallyOrder.service');

/** Same guard as the stock sync: only Mickys (CENTRE POINT FOODS…) talks to the CRM. */
const SYNC_COMPANY = /^CENTRE POINT/i;

const tallyReply = (res, ok, message) =>
  res.type('text/xml').send(`<RESPONSE><STATUS>${ok ? 1 : 0}</STATUS><MESSAGE>${message}</MESSAGE></RESPONSE>`);

// GET /api/stock/tally-orders?key=&claim=1 — the rows the add-on walks to
// create the due orders. Only the add-on's own request (key + claim=1) hands
// orders out; opening the URL without claim=1 just shows what is due.
const orderFeed = asyncHandler(async (req, res) => {
  const claim = Boolean(req.tallyPush) && req.query.claim === '1';
  const { cfg, vouchers } = await takeOrders({ claim });
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
  if (!xml || typeof xml !== 'string') throw ApiError.badRequest('No Tally XML provided');
  const company = (xml.match(/<COMPANY>([\s\S]*?)<\/COMPANY>/) || [])[1] || '';
  if (company && !SYNC_COMPANY.test(company.trim())) {
    return tallyReply(res, false, `Ignored: sales orders from "${company.trim()}" - only CENTRE POINT FOODS talks to the CRM`);
  }
  const result = await recordSeen(xml);
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
