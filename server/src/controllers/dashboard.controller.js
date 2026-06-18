const asyncHandler = require('../utils/asyncHandler');
const Lead = require('../models/Lead');
const User = require('../models/User');

const GENERATED = ['generated', 'delivered'];
const OPEN = ['new', 'kit_selected', 'rates_confirmed'];

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Leads created per month for the last 12 months. */
async function monthlyLeads(match = {}) {
  return Lead.aggregate([
    { $match: { ...match, createdAt: { $gte: monthsAgo(11) } } },
    {
      $group: {
        _id: { y: { $year: '$createdAt' }, m: { $month: '$createdAt' } },
        leads: { $sum: 1 },
        kits: { $sum: { $cond: [{ $in: ['$status', GENERATED] }, 1, 0] } },
      },
    },
    { $sort: { '_id.y': 1, '_id.m': 1 } },
    {
      $project: {
        _id: 0,
        month: {
          $concat: [
            { $arrayElemAt: [['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], '$_id.m'] },
            ' ',
            { $substr: [{ $toString: '$_id.y' }, 2, 2] },
          ],
        },
        leads: 1,
        kits: 1,
      },
    },
  ]);
}

const statusBreakdown = (match = {}) =>
  Lead.aggregate([
    { $match: match },
    { $group: { _id: '$status', count: { $sum: 1 } } },
    { $project: { _id: 0, status: '$_id', count: 1 } },
  ]);

const byField = (field, match = {}, limit = 8) =>
  Lead.aggregate([
    { $match: { ...match, [field]: { $nin: [null, ''] } } },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: limit },
    { $project: { _id: 0, name: '$_id', count: 1 } },
  ]);

// GET /api/dashboard/admin
const adminAnalytics = asyncHandler(async (_req, res) => {
  const [
    totalLeads, newLeads, generatedKits, deliveredKits, activeExecs,
    monthly, status, cityWise, businessTypeWise, kitSplit, execPerformance,
  ] = await Promise.all([
    Lead.countDocuments(),
    Lead.countDocuments({ status: 'new' }),
    Lead.countDocuments({ status: { $in: GENERATED } }),
    Lead.countDocuments({ status: 'delivered' }),
    User.countDocuments({ role: 'sales_exec', isActive: true }),

    monthlyLeads(),
    statusBreakdown(),
    byField('city'),
    byField('businessType'),
    Lead.aggregate([
      { $match: { kitType: { $in: ['distributor', 'institutional'] } } },
      { $group: { _id: '$kitType', count: { $sum: 1 } } },
      { $project: { _id: 0, name: '$_id', count: 1 } },
    ]),
    Lead.aggregate([
      {
        $group: {
          _id: '$assignedExecId',
          leads: { $sum: 1 },
          kits: { $sum: { $cond: [{ $in: ['$status', GENERATED] }, 1, 0] } },
          delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
        },
      },
      { $sort: { leads: -1 } },
      { $limit: 10 },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'exec' } },
      { $unwind: '$exec' },
      { $project: { _id: 0, name: '$exec.name', leads: 1, kits: 1, delivered: 1 } },
    ]),
  ]);

  res.json({
    success: true,
    data: {
      cards: { totalLeads, newLeads, generatedKits, deliveredKits, activeExecs },
      charts: { monthly, status, cityWise, businessTypeWise, kitSplit, execPerformance },
    },
  });
});

const IST = 'Asia/Kolkata';

/** Builds a createdAt range match from ?from & ?to (inclusive of the whole day). */
function createdAtMatch({ from, to }) {
  if (!from && !to) return {};
  const range = {};
  if (from) range.$gte = new Date(from);
  if (to) {
    const t = new Date(to);
    t.setHours(23, 59, 59, 999);
    range.$lte = t;
  }
  return { createdAt: range };
}

// GET /api/dashboard/lead-tracker  (admin) — leads grouped by who created them,
// with a per-status breakdown, plus a per-day creation breakdown. Both scoped by
// an optional ?from / ?to creation-date range.
const leadTracker = asyncHandler(async (req, res) => {
  const match = createdAtMatch(req.query);
  const statusSum = (s) => ({ $sum: { $cond: [{ $eq: ['$status', s] }, 1, 0] } });

  const [creators, daily] = await Promise.all([
    Lead.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$createdBy',
          total: { $sum: 1 },
          new: statusSum('new'),
          kit_selected: statusSum('kit_selected'),
          rates_confirmed: statusSum('rates_confirmed'),
          generated: statusSum('generated'),
          delivered: statusSum('delivered'),
          firstAt: { $min: '$createdAt' },
          lastAt: { $max: '$createdAt' },
        },
      },
      { $sort: { total: -1 } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'creator' } },
      { $unwind: { path: '$creator', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          creatorId: '$_id',
          name: { $ifNull: ['$creator.name', 'Unknown'] },
          role: '$creator.role',
          total: 1, new: 1, kit_selected: 1, rates_confirmed: 1, generated: 1, delivered: 1,
          firstAt: 1, lastAt: 1,
        },
      },
    ]),
    Lead.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: IST } },
          leads: { $sum: 1 },
          kits: { $sum: { $cond: [{ $in: ['$status', GENERATED] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, date: '$_id', leads: 1, kits: 1 } },
    ]),
  ]);

  res.json({ success: true, data: { creators, daily } });
});


// GET /api/dashboard/exec  (own leads only)
const execAnalytics = asyncHandler(async (req, res) => {
  const execId = req.user._id;
  const match = { assignedExecId: execId };

  const [todayCount, monthCount, openCount, generatedCount, deliveredCount, monthly, status] =
    await Promise.all([
      Lead.countDocuments({ ...match, createdAt: { $gte: startOfToday() } }),
      Lead.countDocuments({ ...match, createdAt: { $gte: monthsAgo(0) } }),
      Lead.countDocuments({ ...match, status: { $in: OPEN } }),
      Lead.countDocuments({ ...match, status: { $in: GENERATED } }),
      Lead.countDocuments({ ...match, status: 'delivered' }),
      monthlyLeads(match),
      statusBreakdown(match),
    ]);

  res.json({
    success: true,
    data: {
      cards: { todayCount, monthCount, openCount, generatedCount, deliveredCount },
      charts: { monthly, status },
    },
  });
});

module.exports = { adminAnalytics, leadTracker, execAnalytics };
