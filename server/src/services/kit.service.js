const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { PassThrough } = require('stream');
const RateItem = require('../models/RateItem');
const brand = require('../config/brand');
const content = require('../config/kitContent');

const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'uploads');
const KITS_DIR = path.join(UPLOADS_ROOT, 'kits');

// Pre-built marketing PDFs shipped with the app (committed, not in uploads/).
// Attached as-is to every kit alongside the generated documents.
const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const BROCHURE_PATH = path.join(ASSETS_DIR, 'Mickys_Brochure.pdf');

// ---- Brand palette ----
const MAROON = '#6F0E13';
const GOLD = '#F1C53E';
const SLATE = '#454343';
const INK = '#2a2220';
const LIGHT = '#f4f1ec';
const BAND = '#efe7e0';
const BORDER = '#e2ddd7';

const M = 40; // page margin

// PDFKit's built-in fonts have no ₹ glyph, so amounts use the "Rs." prefix.
const inr = (n) => 'Rs. ' + Number(n || 0).toLocaleString('en-IN');
const inr2 = (n) => 'Rs. ' + Number(n || 0).toFixed(2);

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

/** "Raj Restaurant" -> "RajRestaurant" for safe file names. */
function sanitizeName(s) {
  return (
    String(s || '')
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join('') || 'Client'
  );
}

function renderPdfBuffer(draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: M });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      draw(doc);
    } catch (err) {
      return reject(err);
    }
    doc.end();
  });
}

// ---------------- Shared layout pieces ----------------
function contentWidth(doc) {
  return doc.page.width - 2 * M;
}

/** Full brand header band on page 1. Returns the y to start content at. */
function brandHeader(doc, title, ctx, opts = {}) {
  const W = doc.page.width;
  doc.rect(0, 0, W, 88).fill(MAROON);
  doc.rect(0, 88, W, 3).fill(GOLD);
  doc.fill('#ffffff').font('Helvetica-Bold').fontSize(18).text(brand.brandName, M, 16);
  doc.font('Helvetica-Oblique').fontSize(8).fill('#f1d4d6').text(brand.tagline, M, 39);
  doc.font('Helvetica').fontSize(7.5).fill('#e7c4c6').text(brand.legalEntityShort, M, 52);
  // Title is boxed to the right portion so it never overlaps the brand wordmark.
  const titleX = M + 250;
  doc.font('Helvetica-Bold').fontSize(12.5).fill('#ffffff').text(String(title).toUpperCase(), titleX, 18, { width: W - M - titleX, align: 'right' });
  if (opts.subtitle) doc.font('Helvetica').fontSize(8.5).fill(GOLD).text(opts.subtitle, titleX, 39, { width: W - M - titleX, align: 'right' });
  if (ctx?.lead && opts.showRef !== false) {
    doc.font('Helvetica').fontSize(8).fill('#f1d4d6').text(`Ref: ${ctx.lead.refNumber}`, M, 53, { width: W - 2 * M, align: 'right' });
    doc.text(`Date: ${fmtDate(ctx.lead.leadDate)}`, M, 64, { width: W - 2 * M, align: 'right' });
  }
  doc.fillColor(INK);
  return 104;
}

/** Slim header for continuation pages. */
function slimHeader(doc) {
  const W = doc.page.width;
  doc.rect(0, 0, W, 30).fill(MAROON);
  doc.rect(0, 30, W, 2).fill(GOLD);
  doc.fill('#ffffff').font('Helvetica-Bold').fontSize(10).text(brand.brandName, M, 9);
  doc.font('Helvetica-Oblique').fontSize(7.5).fill('#f1d4d6').text(brand.tagline, M, 9, { width: W - 2 * M, align: 'right' });
  doc.fillColor(INK);
  return 44;
}

function pageFooter(doc, label) {
  const W = doc.page.width;
  const y = doc.page.height - 44;
  // The footer sits below the bottom margin; neutralise it so PDFKit doesn't
  // auto-paginate (which would push it onto a new page).
  const savedBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.moveTo(M, y).lineTo(W - M, y).stroke(BORDER);
  doc.font('Helvetica').fontSize(6.8).fill(SLATE)
    .text(`${brand.legalEntity}  ·  ${brand.address}  ·  FSSAI: ${brand.fssai}`, M, y + 5, { width: W - 2 * M, align: 'center', lineBreak: false });
  doc.font('Helvetica').fontSize(6.8).fill(SLATE)
    .text(`${brand.contact.name}  ·  ${brand.contact.phone}  ·  ${brand.contact.email}  ·  ${brand.website}`, M, y + 15, { width: W - 2 * M, align: 'center', lineBreak: false });
  if (label) doc.font('Helvetica-Oblique').fontSize(6.5).fill(MAROON).text(label, M, y + 25, { width: W - 2 * M, align: 'center', lineBreak: false });
  doc.page.margins.bottom = savedBottom;
}

/** Adds a continuation page with slim header + footer. Returns starting y. */
function newPage(doc, label) {
  doc.addPage();
  const y = slimHeader(doc);
  pageFooter(doc, label);
  return y;
}

const bottomLimit = (doc) => doc.page.height - 56;

/** Client + executive summary card, used on lead-specific documents. */
function clientCard(doc, y, ctx) {
  const { lead, exec } = ctx;
  const W = contentWidth(doc);
  const half = W / 2 - 10;
  doc.roundedRect(M, y, W, 88, 6).fill(LIGHT);
  doc.fill(SLATE).font('Helvetica-Bold').fontSize(8).text('PREPARED FOR', M + 12, y + 10);
  doc.font('Helvetica-Bold').fontSize(13).fill(MAROON).text(lead.businessName, M + 12, y + 22, { width: half });
  doc.font('Helvetica').fontSize(9).fill(SLATE);
  let ly = y + 40;
  [
    `${lead.contactPerson}${lead.designation ? ', ' + lead.designation : ''}`,
    [lead.city, lead.state].filter(Boolean).join(', '),
    `Mob: ${lead.mobileNumber}`,
    lead.gstin ? `GSTIN: ${lead.gstin}` : null,
  ]
    .filter(Boolean)
    .forEach((l) => {
      doc.text(l, M + 12, ly, { width: half });
      ly += 11;
    });
  const rx = M + W / 2 + 10;
  doc.font('Helvetica-Bold').fontSize(8).fill(SLATE).text('SALES EXECUTIVE', rx, y + 10);
  doc.font('Helvetica').fontSize(10).fill(INK).text(exec?.name || '-', rx, y + 22, { width: half });
  doc.fontSize(8.5).fill(SLATE).text(exec?.email || '', rx, y + 36, { width: half });
  if (exec?.phone) doc.text(`Mob: ${exec.phone}`, rx, y + 48, { width: half });
  doc.font('Helvetica-Bold').fontSize(8).fill(SLATE).text('BUSINESS TYPE', rx, y + 62);
  doc.font('Helvetica').fontSize(9.5).fill(INK).text(lead.businessType || '-', rx, y + 73, { width: half });
  doc.fillColor(INK);
  return y + 88 + 14;
}

/** Numbered terms list inside a titled section. */
function termsBlock(doc, y, heading, items, label) {
  const W = contentWidth(doc);
  if (y > bottomLimit(doc) - 60) y = newPage(doc, label);
  doc.font('Helvetica-Bold').fontSize(10).fill(MAROON).text(heading, M, y);
  y += 16;
  items.forEach((t, i) => {
    if (y > bottomLimit(doc)) y = newPage(doc, label);
    doc.font('Helvetica-Bold').fontSize(8.5).fill(SLATE).text(`${i + 1}.`, M, y, { width: 16 });
    doc.font('Helvetica').fontSize(8.5).fill(INK).text(t, M + 18, y, { width: W - 18 });
    y += doc.heightOfString(t, { width: W - 18 }) + 5;
  });
  return y + 4;
}

/** Dual signature block (company + counterparty). */
function signatureBlock(doc, y, ctx, leftRole, rightParty, rightRole, label) {
  if (y > bottomLimit(doc) - 86) y = newPage(doc, label);
  const W = contentWidth(doc);
  const colW = W / 2 - 16;
  const rx = M + W / 2 + 16;
  doc.font('Helvetica-Bold').fontSize(9.5).fill(MAROON).text('Authorised Signatories', M, y);
  y += 20;
  // left — company
  doc.font('Helvetica').fontSize(8.5).fill(SLATE).text(`For ${brand.brandName}`, M, y);
  doc.font('Helvetica-Bold').fontSize(10).fill(INK).text(brand.signatory.name, M, y + 12);
  doc.font('Helvetica').fontSize(8.5).fill(SLATE).text(leftRole || brand.signatory.designation, M, y + 25);
  doc.moveTo(M, y + 56).lineTo(M + colW, y + 56).stroke(SLATE);
  doc.fontSize(8).fill(SLATE).text('Signature', M, y + 58);
  doc.text('Date: ______ / ______ / ______', M, y + 70);
  // right — counterparty
  doc.font('Helvetica').fontSize(8.5).fill(SLATE).text(`For ${rightParty}`, rx, y);
  doc.font('Helvetica-Bold').fontSize(10).fill(INK).text(rightParty, rx, y + 12, { width: colW });
  doc.font('Helvetica').fontSize(8.5).fill(SLATE).text(rightRole || 'Authorised Signatory', rx, y + 25);
  doc.moveTo(rx, y + 56).lineTo(rx + colW, y + 56).stroke(SLATE);
  doc.fontSize(8).fill(SLATE).text('Signature', rx, y + 58);
  doc.text('Date: ______ / ______ / ______', rx, y + 70);
  doc.fillColor(INK);
  return y + 90;
}

function confidentialNote(doc, y, who) {
  const W = contentWidth(doc);
  if (y > bottomLimit(doc) - 24) y = newPage(doc, null);
  doc.font('Helvetica-Oblique').fontSize(7.5).fill(SLATE)
    .text(`This document is confidential and intended solely for ${who}. Unauthorized use is strictly prohibited.`, M, y, { width: W });
  return y + 18;
}

// A lead's edited Terms & Conditions (one clause per line) override the default
// list when present; otherwise the standard kit-type terms are used.
function termsFor(ctx, fallback) {
  const custom = ctx.lead.customTerms?.termsAndConditions;
  if (custom && custom.trim()) {
    return custom.split('\n').map((l) => l.trim()).filter(Boolean);
  }
  return fallback;
}

function agreementTermsFor(ctx) {
  const custom = ctx.lead.customTerms?.agreementTermsAndConditions;
  const source = custom && custom.trim()
    ? custom.split('\n').map((l) => l.trim()).filter(Boolean).map((line, i) => {
      const parts = line.split('|');
      if (parts.length >= 2) return [parts.shift().trim(), parts.join('|').trim()];
      return [`Clause ${i + 1}`, line];
    })
    : content.DISTRIBUTOR_AGREEMENT_TERMS;

  return source
    .map(([particular, term]) => [
      String(particular || '').replace('{distributor}', ctx.lead.businessName),
      String(term || '').replace('{distributor}', ctx.lead.businessName),
    ])
    .filter(([particular, term]) => particular || term);
}

// ---------------- Price Card ----------------
// Distributor price card. The DLP (Delivered Landed Price) is the editable
// price; DSP (Distributor Selling Price) is the product's institutional rate.
// Margins are derived: DLP->DSP = (DSP-DLP)/DSP, DLP->MRP = (MRP-DSP)/MRP.
function priceTable(doc, y, ctx) {
  const W = contentWidth(doc);
  const right = M + W;
  const footerLabel = 'Price Card  ·  Trade Confidential';
  const pct = (n) => `${n.toFixed(1)}%`;

  // Column widths sum to the content width (last column takes the remainder).
  // The two margin columns are spelled out as "Margin …" (wrapping to two lines)
  // so the reader knows the percentages are margins.
  const defs = [
    ['sr', 'Sr', 18, 'left'],
    ['name', 'Product Name', 138, 'left'],
    ['wt', 'Wt', 48, 'left'],
    ['mrp', 'MRP', 40, 'right'],
    ['basic', 'Basic', 40, 'right'],
    ['gst', 'GST 5%', 42, 'right'],
    ['dlp', 'DLP', 42, 'right'],
    ['mDsp', 'Margin\nDLP-DSP', 50, 'right'],
    ['dsp', 'DSP', 40, 'right'],
    ['mMrp', 'Margin\nDLP-MRP', W - 458, 'right'],
  ];
  let cx = M;
  const cols = defs.map(([key, label, w, align]) => {
    const c = { key, label, x: cx, w, align };
    cx += w;
    return c;
  });

  const HEAD_H = 26; // taller so the two-line margin headers fit
  const drawHead = (yy) => {
    doc.rect(M, yy, W, HEAD_H).fill(MAROON);
    doc.font('Helvetica-Bold').fontSize(7).fill('#ffffff');
    cols.forEach((c) => doc.text(c.label, c.x + 3, yy + 4, { width: c.w - 6, align: c.align }));
    return yy + HEAD_H;
  };
  y = drawHead(y);

  // group catalogue by category in the reference order
  const groups = {};
  (ctx.catalog || []).forEach((it) => {
    (groups[it.category] = groups[it.category] || []).push(it);
  });

  const categoryOrder = [
    ...content.CATEGORY_ORDER,
    ...Object.keys(groups).filter((cat) => !content.CATEGORY_ORDER.includes(cat)),
  ];
  categoryOrder.forEach((cat) => {
    const rows = groups[cat];
    if (!rows || !rows.length) return;
    if (y > bottomLimit(doc) - 28) { y = newPage(doc, footerLabel); y = drawHead(y); }
    // category band
    doc.rect(M, y, W, 16).fill(BAND);
    doc.font('Helvetica-Bold').fontSize(8).fill(MAROON).text(cat, M + 6, y + 4);
    y += 16;
    rows.forEach((it, i) => {
      if (y > bottomLimit(doc)) { y = newPage(doc, footerLabel); y = drawHead(y); }
      if (i % 2 === 1) doc.rect(M, y, W, 16).fill('#faf7f2');
      const basic = Number(it.basic) || 0;
      const dlp = Number(it.netRate) || 0; // editable DLP
      const dsp = Number(it.dsp) || 0;
      const tbd = !basic;
      const gstAmt = basic * (it.gst / 100);
      const mDsp = dsp > 0 && dlp > 0 ? ((dsp - dlp) / dsp) * 100 : null;
      const mMrp = it.mrp > 0 && dsp > 0 ? ((it.mrp - dsp) / it.mrp) * 100 : null;
      const vals = {
        sr: String(i + 1),
        name: it.productName,
        wt: it.packSize || '',
        mrp: inr(it.mrp),
        basic: tbd ? 'TBD' : inr(basic),
        gst: tbd ? '-' : inr2(gstAmt),
        dlp: tbd ? '-' : inr(dlp),
        mDsp: mDsp == null ? '-' : pct(mDsp),
        dsp: dsp > 0 ? inr(dsp) : '-',
        mMrp: mMrp == null ? '-' : pct(mMrp),
      };
      doc.font('Helvetica').fontSize(7.5).fill(INK);
      cols.forEach((c) => doc.fill(c.key === 'dlp' ? MAROON : INK).text(vals[c.key], c.x + 3, y + 4, { width: c.w - 6, align: c.align, lineBreak: false }));
      y += 16;
      doc.moveTo(M, y).lineTo(right, y).stroke(BORDER);
    });
  });
  return y + 6;
}

function incentiveBlock(doc, y, label) {
  const W = contentWidth(doc);
  if (y > bottomLimit(doc) - 90) y = newPage(doc, label);
  doc.font('Helvetica-Bold').fontSize(10).fill(MAROON).text('MONTHLY INCENTIVE SCHEME', M, y);
  doc.font('Helvetica').fontSize(8).fill(SLATE).text(`Validity — ${content.INCENTIVE_VALIDITY}`, M, y + 13);
  y += 28;
  const cols = [
    { x: M, w: 40, label: 'Sr', align: 'left' },
    { x: M + 40, w: 330, label: 'Slab (Monthly Volume)', align: 'left' },
    { x: M + 370, w: W - 370, label: 'Incentive %', align: 'right' },
  ];
  doc.rect(M, y, W, 18).fill(MAROON);
  doc.font('Helvetica-Bold').fontSize(8).fill('#ffffff');
  cols.forEach((c) => doc.text(c.label, c.x + 4, y + 5, { width: c.w - 8, align: c.align }));
  y += 18;
  content.INCENTIVE_SLABS.forEach((row, i) => {
    if (i % 2 === 1) doc.rect(M, y, W, 16).fill('#faf7f2');
    doc.font('Helvetica').fontSize(8.5).fill(INK);
    doc.text(String(i + 1), cols[0].x + 4, y + 4, { width: cols[0].w - 8 });
    doc.text(row[0], cols[1].x + 4, y + 4, { width: cols[1].w - 8 });
    doc.font('Helvetica-Bold').fill(MAROON).text(row[1], cols[2].x + 4, y + 4, { width: cols[2].w - 8, align: 'right' });
    y += 16;
    doc.moveTo(M, y).lineTo(M + W, y).stroke(BORDER);
  });
  return y + 6;
}

function drawPriceCard(doc, ctx) {
  const footerLabel = 'Price Card  ·  Trade Confidential';
  const W = contentWidth(doc);
  let y = brandHeader(doc, 'Distributor Price Card', ctx, {
    subtitle: 'W.E.F. 01/06/2026',
    showRef: false,
  });
  pageFooter(doc, footerLabel);

  // "PRODUCT PRICE LIST" band
  doc.rect(M, y, W, 18).fill(MAROON);
  doc.font('Helvetica-Bold').fontSize(9).fill('#ffffff')
    .text('PRODUCT PRICE LIST', M, y + 5, { width: W, align: 'center' });
  y += 24;

  doc.font('Helvetica').fontSize(7.5).fill(SLATE)
    .text('All prices in Rs.  ·  DLP = Delivered Landed Price  ·  DSP = Distributor Selling Price  ·  Margins shown as %', M, y, { width: W });
  y += 14;
  y = priceTable(doc, y, ctx);
  const priceTerms = content.PRICE_CARD_TERMS.map((t) => t.replace('{priceLabel}', 'DLP'));
  // The editable per-lead T&C drives the distributor price card (its main doc).
  y = termsBlock(doc, y + 6, 'TERMS & CONDITIONS', termsFor(ctx, priceTerms), footerLabel);
  incentiveBlock(doc, y + 4, footerLabel);
}

// ---------------- Distributor Agreement ----------------
function drawAgreement(doc, ctx) {
  const { lead } = ctx;
  const footerLabel = 'HORECA Distributor Agreement  ·  Confidential';
  let y = brandHeader(doc, 'HORECA Distributor Agreement', ctx);
  pageFooter(doc, footerLabel);
  doc.font('Helvetica').fontSize(9).fill(INK)
    .text(`Distributor: `, M, y, { continued: true })
    .font('Helvetica-Bold').text(lead.businessName, { continued: true })
    .font('Helvetica').text(`     ·     Effective Date: ___ / ___ / ${new Date().getFullYear()}`);
  y += 22;

  const W = contentWidth(doc);
  const cols = [
    { x: M, w: 28, align: 'left' },
    { x: M + 28, w: 150, align: 'left' },
    { x: M + 178, w: W - 178, align: 'left' },
  ];
  const drawHead = (yy) => {
    doc.rect(M, yy, W, 18).fill(MAROON);
    doc.font('Helvetica-Bold').fontSize(8).fill('#ffffff');
    doc.text('Sr.', cols[0].x + 4, yy + 5, { width: cols[0].w - 8 });
    doc.text('Particulars', cols[1].x + 4, yy + 5, { width: cols[1].w - 8 });
    doc.text('Terms & Conditions', cols[2].x + 4, yy + 5, { width: cols[2].w - 8 });
    return yy + 18;
  };
  y = drawHead(y);

  agreementTermsFor(ctx).forEach(([particular, text], i) => {
    const termH = doc.heightOfString(text, { width: cols[2].w - 8 });
    const partH = doc.heightOfString(particular, { width: cols[1].w - 8 });
    const rowH = Math.max(termH, partH, 11) + 8;
    if (y + rowH > bottomLimit(doc)) { y = newPage(doc, footerLabel); y = drawHead(y); }
    if (i % 2 === 1) doc.rect(M, y, W, rowH).fill('#faf7f2');
    doc.font('Helvetica').fontSize(8).fill(SLATE).text(String(i + 1), cols[0].x + 4, y + 4, { width: cols[0].w - 8 });
    doc.font('Helvetica-Bold').fontSize(8).fill(INK).text(particular, cols[1].x + 4, y + 4, { width: cols[1].w - 8 });
    doc.font('Helvetica').fontSize(8).fill(SLATE).text(text, cols[2].x + 4, y + 4, { width: cols[2].w - 8 });
    y += rowH;
    doc.moveTo(M, y).lineTo(M + W, y).stroke(BORDER);
  });

  y = signatureBlock(doc, y + 16, ctx, brand.signatory.designation, lead.businessName, 'Authorised Signatory', footerLabel);
  confidentialNote(doc, y + 6, 'the named distributor');
}

// ---------------- Annexure B — Onboarding Checklist ----------------
function drawAnnexure(doc, ctx) {
  const { lead } = ctx;
  const footerLabel = 'Annexure B – Onboarding Checklist  ·  Confidential';
  let y = brandHeader(doc, 'Annexure B – Onboarding Checklist', ctx);
  pageFooter(doc, footerLabel);
  doc.font('Helvetica').fontSize(9).fill(INK)
    .text(`Distributor: `, M, y, { continued: true })
    .font('Helvetica-Bold').text(lead.businessName, { continued: true })
    .font('Helvetica').text(`     ·     Effective Date: ___ / ___ / ${new Date().getFullYear()}`);
  y += 18;
  const W = contentWidth(doc);
  doc.font('Helvetica').fontSize(8.5).fill(SLATE)
    .text('All items below must be completed and verified prior to the first dispatch. Tick each box upon completion.', M, y, { width: W });
  y += doc.heightOfString('All items...', { width: W }) + 10;

  content.ONBOARDING_CHECKLIST.forEach((group) => {
    if (y > bottomLimit(doc) - 30) y = newPage(doc, footerLabel);
    doc.rect(M, y, W, 16).fill(BAND);
    doc.font('Helvetica-Bold').fontSize(8.5).fill(MAROON).text(group.section, M + 6, y + 4);
    y += 20;
    group.items.forEach(([item, note]) => {
      const noteH = doc.heightOfString(note, { width: W - 200 });
      const rowH = Math.max(14, noteH) + 6;
      if (y + rowH > bottomLimit(doc)) y = newPage(doc, footerLabel);
      doc.roundedRect(M + 2, y + 1, 11, 11, 2).lineWidth(1).stroke(MAROON);
      doc.font('Helvetica-Bold').fontSize(9).fill(INK).text(item, M + 22, y + 1, { width: 168 });
      doc.font('Helvetica').fontSize(8.5).fill(SLATE).text(note, M + 196, y + 1, { width: W - 196 });
      y += rowH;
    });
    y += 6;
  });

  if (y > bottomLimit(doc) - 110) y = newPage(doc, footerLabel);
  y = signatureBlock(doc, y + 10, ctx, brand.signatory.designation, lead.businessName, 'Authorised Signatory', footerLabel);
  confidentialNote(doc, y + 6, 'the named distributor');
}

// ---------------- Quotation ----------------
function labelledRows(doc, x, y, w, rows) {
  rows.forEach(([k, v]) => {
    doc.font('Helvetica-Bold').fontSize(8).fill(SLATE).text(k, x, y, { width: w });
    doc.font('Helvetica').fontSize(8.5).fill(INK).text(v || '__________________________', x, y + 10, { width: w });
    y += 26;
  });
  return y;
}

function drawQuotation(doc, ctx) {
  const { lead, exec, settings } = ctx;
  const kit = settings.kit || {};
  const footerLabel = 'Quotation  ·  Confidential';
  const W = contentWidth(doc);
  const validUntil = new Date(lead.leadDate || Date.now());
  validUntil.setDate(validUntil.getDate() + content.QUOTATION_DEFAULTS.validityDays);

  let y = brandHeader(doc, 'Quotation', ctx, { subtitle: 'HORECA & Institutional Supply', showRef: false });
  pageFooter(doc, footerLabel);

  // TO + meta block
  const boxH = 96;
  doc.roundedRect(M, y, W, boxH, 6).fill(LIGHT);
  const colW = W / 2 - 18;
  doc.fill(SLATE).font('Helvetica-Bold').fontSize(8).text('TO', M + 12, y + 8);
  doc.font('Helvetica-Bold').fontSize(11.5).fill(MAROON).text(lead.businessName, M + 12, y + 19, { width: colW });
  doc.font('Helvetica').fontSize(8.5).fill(INK);
  let ly = y + 36;
  [
    `${lead.contactPerson}${lead.designation ? ', ' + lead.designation : ''}`,
    lead.address || [lead.city, lead.state].filter(Boolean).join(', '),
    [lead.gstin ? `GSTIN: ${lead.gstin}` : null, `Contact: ${lead.mobileNumber}`].filter(Boolean).join('  ·  '),
  ].filter(Boolean).forEach((l) => { doc.text(l, M + 12, ly, { width: colW }); ly += 12; });
  const rx = M + W / 2 + 6;
  labelledRows(doc, rx, y + 8, colW, [
    ['Quotation No.', `QT – ${lead.refNumber}`],
    ['Date', fmtDate(lead.leadDate)],
    ['Valid Until', fmtDate(validUntil)],
  ]);
  doc.font('Helvetica-Bold').fontSize(8).fill(SLATE).text('Prepared By', rx + colW / 2, y + 8);
  doc.font('Helvetica').fontSize(8.5).fill(INK).text(exec?.name || '-', rx + colW / 2, y + 18, { width: colW / 2 });
  doc.font('Helvetica-Bold').fontSize(8).fill(SLATE).text('Category', rx + colW / 2, y + 34);
  doc.font('Helvetica').fontSize(8.5).fill(INK).text(lead.kitType === 'distributor' ? 'Distributor' : 'Institutional', rx + colW / 2, y + 44);
  y += boxH + 14;

  // Items table
  doc.font('Helvetica-Bold').fontSize(10).fill(MAROON).text('QUOTATION ITEMS', M, y);
  y += 16;
  const cols = [
    { key: 'sr', label: 'Sr', x: M, w: 24, align: 'left' },
    { key: 'name', label: 'Product / SKU', x: M + 24, w: 150, align: 'left' },
    { key: 'qty', label: 'Qty', x: M + 174, w: 36, align: 'center' },
    { key: 'unit', label: 'Unit', x: M + 210, w: 40, align: 'center' },
    { key: 'price', label: 'Unit Price', x: M + 250, w: 70, align: 'right' },
    { key: 'gst', label: 'GST 5%', x: M + 320, w: 58, align: 'right' },
    { key: 'amt', label: 'Amount', x: M + 378, w: 70, align: 'right' },
    { key: 'rem', label: 'Remarks', x: M + 448, w: W - 448, align: 'left' },
  ];
  const drawHead = (yy) => {
    doc.rect(M, yy, W, 18).fill(MAROON);
    doc.font('Helvetica-Bold').fontSize(7.5).fill('#ffffff');
    cols.forEach((c) => doc.text(c.label, c.x + 3, yy + 5, { width: c.w - 6, align: c.align }));
    return yy + 18;
  };
  y = drawHead(y);
  // Group the included items by category (same ordering as the price card) so
  // the quotation reads as a categorised list rather than one flat run. ctx.catalog
  // is the confirmed/included snapshot with categories already resolved.
  const groups = {};
  (ctx.catalog || []).forEach((it) => {
    const cat = it.category || 'Other';
    (groups[cat] = groups[cat] || []).push(it);
  });
  const categoryOrder = [
    ...content.CATEGORY_ORDER,
    ...Object.keys(groups).filter((cat) => !content.CATEGORY_ORDER.includes(cat)),
  ];
  let sr = 0;
  categoryOrder.forEach((cat) => {
    const rows = groups[cat];
    if (!rows || !rows.length) return;
    if (y > bottomLimit(doc) - 28) { y = newPage(doc, footerLabel); y = drawHead(y); }
    // category band
    doc.rect(M, y, W, 16).fill(BAND);
    doc.font('Helvetica-Bold').fontSize(8).fill(MAROON).text(cat, M + 6, y + 4);
    y += 16;
    rows.forEach((r) => {
      if (y > bottomLimit(doc)) { y = newPage(doc, footerLabel); y = drawHead(y); }
      sr += 1;
      if (sr % 2 === 0) doc.rect(M, y, W, 16).fill('#faf7f2');
      const gstAmt = r.netRate * (r.gst / 100);
      const vals = {
        sr: String(sr),
        name: r.productName + (r.packSize ? ` (${r.packSize})` : ''),
        qty: '',
        unit: 'Pack',
        price: inr(r.netRate),
        gst: inr2(gstAmt),
        amt: '',
        rem: '',
      };
      doc.font('Helvetica').fontSize(8).fill(INK);
      cols.forEach((c) => doc.text(vals[c.key], c.x + 3, y + 4, { width: c.w - 6, align: c.align }));
      y += 16;
      doc.moveTo(M, y).lineTo(M + W, y).stroke(BORDER);
    });
  });
  // Totals (qty/amount confirmed on order)
  const totals = [['Subtotal (Basic — before GST)', ''], ['GST @ 5%', ''], ['GRAND TOTAL  (Incl. GST)', '']];
  totals.forEach(([k, v], i) => {
    const bold = i === totals.length - 1;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fill(bold ? MAROON : SLATE)
      .text(k, M + W - 250, y + 4, { width: 160, align: 'right' });
    doc.font('Helvetica').fontSize(8.5).fill(INK).text(v || '____________', M + W - 86, y + 4, { width: 86, align: 'right' });
    y += 16;
  });
  doc.font('Helvetica-Oblique').fontSize(7.5).fill(SLATE).text('Quantities and totals to be confirmed at the time of order.', M, y + 2, { width: W });
  y += 18;

  // Delivery + Payment two-column
  if (y > bottomLimit(doc) - 110) y = newPage(doc, footerLabel);
  const half = W / 2 - 8;
  doc.font('Helvetica-Bold').fontSize(9).fill(MAROON).text('DELIVERY DETAILS', M, y);
  doc.font('Helvetica-Bold').fontSize(9).fill(MAROON).text('PAYMENT DETAILS', M + W / 2 + 8, y);
  const dy = y + 16;
  labelledRows(doc, M, dy, half, [
    ['Delivery Address', lead.address || ''],
    ['Expected Delivery', ''],
    ['Mode of Delivery', ''],
  ]);
  labelledRows(doc, M + W / 2 + 8, dy, half, [
    ['Payment Terms', lead.customTerms?.paymentTerms || content.QUOTATION_DEFAULTS.paymentTerms],
    ['Mode', brand.bank.mode],
    ['Account No.', `${brand.bank.accountNo}  ·  IFSC: ${brand.bank.ifsc}`],
  ]);
  y = dy + 26 * 3 + 6;

  y = termsBlock(doc, y, 'TERMS & CONDITIONS', termsFor(ctx, content.QUOTATION_TERMS), footerLabel);
  // Acceptance + signature
  if (y > bottomLimit(doc) - 80) y = newPage(doc, footerLabel);
  signatureBlock(doc, y + 6, ctx, brand.signatory.designation, lead.businessName, 'Customer Acceptance', footerLabel);
}

// ---------------- Kit assembly ----------------
// A pre-built brochure shipped with both kits. `staticFile` entries are read
// from disk as-is instead of being rendered from lead data.
const BROCHURE_DOC = { docType: 'Brochure', label: "Micky's Brochure", staticFile: BROCHURE_PATH };

const DOC_PLANS = {
  distributor: [
    { docType: 'PriceCard', label: 'Distributor Price Card', draw: drawPriceCard },
    { docType: 'Agreement', label: 'HORECA Distributor Agreement', draw: drawAgreement },
    { docType: 'OnboardingChecklist', label: 'Annexure B – Onboarding Checklist', draw: drawAnnexure },
    BROCHURE_DOC,
  ],
  institutional: [
    // The institutional price card is intentionally omitted — the quotation
    // (with categorised items) is the single pricing document for this kit.
    { docType: 'Quotation', label: 'Quotation with Terms & Conditions', draw: drawQuotation },
    BROCHURE_DOC,
  ],
};

function zipFiles(files) {
  return new Promise((resolve, reject) => {
    const output = new PassThrough();
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks = [];
    output.on('data', (chunk) => chunks.push(chunk));
    output.on('end', () => resolve(Buffer.concat(chunks)));
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    files.forEach((f) => archive.append(f.buffer, { name: f.fileName }));
    archive.finalize();
  });
}

/**
 * Builds the full sales kit for a lead: one PDF per document — all rendered from
 * the live data (client details, confirmed rates, and the data-driven product
 * catalogue) to match the official Micky's reference layouts — bundled into a
 * single ZIP. Returns file + zip metadata to persist on the Lead.
 */
async function generateKit({ lead, exec, settings }) {
  const company = settings.company || {};
  const clientSlug = sanitizeName(lead.businessName);
  const ref = lead.refNumber;

  const plan = DOC_PLANS[lead.kitType];
  if (!plan) throw new Error(`Unknown kit type: ${lead.kitType}`);

  // Render the exact confirmed lead snapshot so exclusions and rate overrides
  // are reflected consistently in both price cards and quotations.
  const confirmedRates = (lead.rates || []).filter((line) => line.included !== false);
  const rateItemIds = confirmedRates.map((line) => line.rateItemId).filter(Boolean);
  const categories = await RateItem.find({ _id: { $in: rateItemIds } }).select('_id category').lean();
  const categoryById = new Map(categories.map((item) => [String(item._id), item.category || 'Other']));
  const catalog = confirmedRates
    .map((line) => {
      const item = typeof line.toObject === 'function' ? line.toObject() : line;
      return {
        ...item,
        category: item.category || categoryById.get(String(item.rateItemId)) || 'Other',
      };
    })
    .sort((a, b) => String(a.sku || '').localeCompare(String(b.sku || '')));
  const ctx = { lead, exec, settings, company, brand, content, catalog };
  const files = [];

  for (const d of plan) {
    let buffer;
    let fileName;
    if (d.staticFile) {
      // Pre-built asset (e.g. the brochure): identical for every client, so it
      // keeps a generic name. Skip gracefully if the file isn't deployed.
      if (!fs.existsSync(d.staticFile)) {
        console.warn(`[kit] static document missing, skipping: ${d.staticFile}`);
        continue;
      }
      buffer = fs.readFileSync(d.staticFile);
      fileName = `Mickys_${d.docType}.pdf`;
    } else {
      fileName = `Mickys_${d.docType}_${clientSlug}_${ref}.pdf`;
      buffer = await renderPdfBuffer((doc) => d.draw(doc, ctx));
    }
    files.push({
      docType: d.docType,
      label: d.label,
      fileName,
      buffer,
      contentType: 'application/pdf',
      static: !!d.staticFile,
    });
  }

  const zipName = `MickysSalesKit_${clientSlug}_${ref}.zip`;
  const zipBuffer = await zipFiles(files);

  return {
    files,
    zip: { fileName: zipName, buffer: zipBuffer, contentType: 'application/zip' },
  };
}

module.exports = { generateKit, KITS_DIR };
