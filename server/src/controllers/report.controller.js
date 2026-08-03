const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { logActivity } = require('../services/activity.service');
const reportService = require('../services/report.service');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const sendWorkbook = (res, buffer, fileName) => {
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(Buffer.from(buffer));
};

// GET /api/reports  (catalog of available report types for the picker)
const listReports = asyncHandler(async (req, res) => {
  res.json({ success: true, data: reportService.reportCatalog() });
});

// GET /api/reports/:type?from&to&execId&format=json|xlsx
const getReport = asyncHandler(async (req, res) => {
  const { type } = req.params;
  // Whitelist check (own keys only — "constructor" etc. must not pass).
  if (!reportService.REPORT_TYPES.includes(type)) throw ApiError.notFound('Unknown report type');

  const ctx = reportService.buildContext(req.user, req.query);
  const report = await reportService.runReport(type, ctx);

  if (req.query.format === 'xlsx') {
    const buffer = await reportService.buildWorkbook([report], ctx, req.user.name);
    await logActivity({
      userId: req.user._id, action: 'REPORT_EXPORTED', entity: 'Report',
      details: `Exported ${report.label} (${ctx.fromStr} to ${ctx.toStr}) to Excel`, ip: req.ip,
    });
    return sendWorkbook(res, buffer, `mickys-${type}-report_${ctx.fromStr}_to_${ctx.toStr}.xlsx`);
  }

  res.json({
    success: true,
    data: {
      type,
      label: report.label,
      columns: report.columns.map(({ key, header, type: colType }) => ({ key, header, type: colType || 'string' })),
      rows: report.rows,
      totals: report.totals,
      meta: { from: ctx.fromStr, to: ctx.toStr, count: report.rows.length },
    },
  });
});

// GET /api/reports/export/all?from&to&execId  (one workbook, every report as a sheet)
const exportAll = asyncHandler(async (req, res) => {
  const ctx = reportService.buildContext(req.user, req.query);
  const reports = [];
  for (const type of reportService.REPORT_TYPES) {
    // The daily summary caps at ~6 months; on longer all-report exports skip
    // that sheet instead of aborting the whole workbook.
    if (type === 'daily-summary' && reportService.rangeDayCount(ctx) > reportService.DAILY_SUMMARY_MAX_DAYS) continue;
    reports.push(await reportService.runReport(type, ctx));
  }
  const buffer = await reportService.buildWorkbook(reports, ctx, req.user.name);
  await logActivity({
    userId: req.user._id, action: 'REPORT_EXPORTED', entity: 'Report',
    details: `Exported all reports (${ctx.fromStr} to ${ctx.toStr}) to Excel`, ip: req.ip,
  });
  sendWorkbook(res, buffer, `mickys-all-reports_${ctx.fromStr}_to_${ctx.toStr}.xlsx`);
});

module.exports = { listReports, getReport, exportAll };
