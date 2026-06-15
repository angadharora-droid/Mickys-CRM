const asyncHandler = require('../utils/asyncHandler');
const ActivityLog = require('../models/ActivityLog');
const { getPagination, buildMeta } = require('../utils/pagination');
const { searchRegex } = require('../utils/sanitize');

// GET /api/activity-logs?userId=&entity=&action=&dateFrom=&dateTo=&page=&limit=
const listLogs = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = {};
  const q = req.query;

  if (q.userId) filter.userId = q.userId;
  if (q.entity) filter.entity = q.entity;
  if (q.action) filter.action = searchRegex(q.action);
  if (q.search) filter.details = searchRegex(q.search);
  if (q.dateFrom || q.dateTo) {
    filter.timestamp = {};
    if (q.dateFrom) filter.timestamp.$gte = new Date(q.dateFrom);
    if (q.dateTo) {
      const to = new Date(q.dateTo);
      to.setHours(23, 59, 59, 999);
      filter.timestamp.$lte = to;
    }
  }

  const [logs, total] = await Promise.all([
    ActivityLog.find(filter)
      .populate({ path: 'userId', select: 'name role email' })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit),
    ActivityLog.countDocuments(filter),
  ]);
  res.json({ success: true, data: logs, meta: buildMeta(total, page, limit) });
});

module.exports = { listLogs };
