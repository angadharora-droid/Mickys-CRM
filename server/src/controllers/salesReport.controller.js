const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { logActivity } = require('../services/activity.service');
const salesReportService = require('../services/salesReport.service');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const sendWorkbook = (res, buffer, fileName) => {
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(Buffer.from(buffer));
};

// GET /api/sales-reports  (catalog of report types this user may run)
const listReports = asyncHandler(async (req, res) => {
  res.json({ success: true, data: salesReportService.reportCatalog(req.user) });
});

// GET /api/sales-reports/:type?from&to&execId&format=json|xlsx
const getReport = asyncHandler(async (req, res) => {
  const { type } = req.params;
  // Whitelist check (own keys only — "constructor" etc. must not pass). A type
  // the user may not run is refused by runReport with a reason, not hidden as
  // a 404: silently missing reports read as a bug.
  if (!salesReportService.REPORT_TYPES.includes(type)) throw ApiError.notFound('Unknown report type');

  const ctx = salesReportService.buildContext(req.user, req.query);
  const report = await salesReportService.runReport(type, ctx, req.user);

  if (req.query.format === 'xlsx') {
    const buffer = await salesReportService.buildWorkbook([report], ctx, req.user.name);
    // A report that names its own period ignores the requested window, so the
    // file is neither filed nor logged under one — a dated filename on a
    // current-position extract is read as a period extract by whoever it is
    // forwarded to.
    const period = report.rangeLabel || `${ctx.fromStr} to ${ctx.toStr}`;
    const suffix = report.rangeLabel ? '' : `_${ctx.fromStr}_to_${ctx.toStr}`;
    await logActivity({
      userId: req.user._id, action: 'SALES_REPORT_EXPORTED', entity: 'Report',
      details: `Exported ${report.label} (${period}) to Excel`, ip: req.ip,
    });
    return sendWorkbook(res, buffer, `mickys-sales-${type}-report${suffix}.xlsx`);
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

// GET /api/sales-reports/export/all?from&to&execId  (one workbook, a sheet per report)
const exportAll = asyncHandler(async (req, res) => {
  const ctx = salesReportService.buildContext(req.user, req.query);
  const reports = [];
  // Only the reports this user may run — an exec's workbook simply has no
  // Executive Performance sheet.
  for (const type of salesReportService.permittedTypes(req.user)) {
    reports.push(await salesReportService.runReport(type, ctx, req.user));
  }
  const buffer = await salesReportService.buildWorkbook(reports, ctx, req.user.name);
  await logActivity({
    userId: req.user._id, action: 'SALES_REPORT_EXPORTED', entity: 'Report',
    details: `Exported all sales order reports (${ctx.fromStr} to ${ctx.toStr}) to Excel`, ip: req.ip,
  });
  sendWorkbook(res, buffer, `mickys-sales-all-reports_${ctx.fromStr}_to_${ctx.toStr}.xlsx`);
});

module.exports = { listReports, getReport, exportAll };
