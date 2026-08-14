const PDFDocument = require('pdfkit');
const brand = require('../config/brand');

// Same palette + layout idiom as kit.service.js, kept local so the two
// renderers can evolve independently.
const MAROON = '#6F0E13';
const GOLD = '#F1C53E';
const SLATE = '#454343';
const INK = '#2a2220';
const LIGHT = '#f4f1ec';
const BORDER = '#e2ddd7';

const M = 40; // page margin

// PDFKit's built-in fonts have no ₹ glyph, so amounts use the "Rs." prefix.
const inr2 = (n) => 'Rs. ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

const qtyText = (n, unit) => {
  const num = Number(n || 0);
  const s = Number.isInteger(num) ? num.toLocaleString('en-IN') : num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return unit ? `${s} ${unit}` : s;
};

function pageFooter(doc) {
  const W = doc.page.width;
  const y = doc.page.height - 44;
  const savedBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.moveTo(M, y).lineTo(W - M, y).stroke(BORDER);
  doc.font('Helvetica').fontSize(6.8).fill(SLATE)
    .text(`${brand.legalEntity}  ·  ${brand.address}  ·  FSSAI: ${brand.fssai}`, M, y + 5, { width: W - 2 * M, align: 'center', lineBreak: false });
  doc.font('Helvetica').fontSize(6.8).fill(SLATE)
    .text(`${brand.contact.name}  ·  ${brand.contact.phone}  ·  ${brand.contact.email}  ·  ${brand.website}`, M, y + 15, { width: W - 2 * M, align: 'center', lineBreak: false });
  doc.font('Helvetica-Oblique').fontSize(6.5).fill(MAROON)
    .text('This is an order confirmation, not a tax invoice.', M, y + 25, { width: W - 2 * M, align: 'center', lineBreak: false });
  doc.page.margins.bottom = savedBottom;
  doc.fillColor(INK);
}

/** Slim continuation-page header; returns starting y. */
function newPage(doc) {
  doc.addPage();
  const W = doc.page.width;
  doc.rect(0, 0, W, 30).fill(MAROON);
  doc.rect(0, 30, W, 2).fill(GOLD);
  doc.fill('#ffffff').font('Helvetica-Bold').fontSize(10).text(brand.brandName, M, 9);
  doc.font('Helvetica-Oblique').fontSize(7.5).fill('#f1d4d6').text(brand.tagline, M, 9, { width: W - 2 * M, align: 'right' });
  doc.fillColor(INK);
  pageFooter(doc);
  return 44;
}

const bottomLimit = (doc) => doc.page.height - 70;

// Item table column widths (content width is 515 on A4 with 40pt margins).
const COLS = [
  { key: 'idx', label: '#', w: 24, align: 'left' },
  { key: 'name', label: 'ITEM', w: 231, align: 'left' },
  { key: 'qty', label: 'QTY', w: 90, align: 'right' },
  { key: 'rate', label: 'RATE', w: 80, align: 'right' },
  { key: 'amount', label: 'AMOUNT', w: 90, align: 'right' },
];

function tableHeader(doc, y) {
  const W = doc.page.width - 2 * M;
  doc.rect(M, y, W, 18).fill(MAROON);
  let x = M + 6;
  doc.font('Helvetica-Bold').fontSize(8).fill('#ffffff');
  for (const c of COLS) {
    doc.text(c.label, x, y + 5, { width: c.w - 10, align: c.align });
    x += c.w;
  }
  doc.fillColor(INK);
  return y + 18;
}

/**
 * Renders a sales order into a PDF buffer.
 * order: SalesOrder doc (lean or hydrated); exec: creating user (name/phone).
 */
function renderSalesOrderPdf(order, exec) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: M });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      const W = doc.page.width;
      const CW = W - 2 * M;

      // Brand header band
      doc.rect(0, 0, W, 88).fill(MAROON);
      doc.rect(0, 88, W, 3).fill(GOLD);
      doc.fill('#ffffff').font('Helvetica-Bold').fontSize(18).text(brand.brandName, M, 16);
      doc.font('Helvetica-Oblique').fontSize(8).fill('#f1d4d6').text(brand.tagline, M, 39);
      doc.font('Helvetica').fontSize(7.5).fill('#e7c4c6').text(brand.legalEntityShort, M, 52);
      const titleX = M + 250;
      doc.font('Helvetica-Bold').fontSize(12.5).fill('#ffffff').text('SALES ORDER', titleX, 18, { width: W - M - titleX, align: 'right' });
      doc.font('Helvetica').fontSize(8.5).fill(GOLD).text(order.number, titleX, 39, { width: W - M - titleX, align: 'right' });
      doc.font('Helvetica').fontSize(8).fill('#f1d4d6').text(`Date: ${fmtDate(order.createdAt)}`, M, 53, { width: CW, align: 'right' });
      doc.fillColor(INK);
      pageFooter(doc);
      let y = 104;

      // Customer / order info card
      doc.roundedRect(M, y, CW, 66, 6).fill(LIGHT);
      const half = CW / 2 - 10;
      doc.fill(SLATE).font('Helvetica-Bold').fontSize(8).text('CUSTOMER', M + 12, y + 10);
      doc.font('Helvetica-Bold').fontSize(13).fill(MAROON).text(order.customerName, M + 12, y + 22, { width: half });
      const rx = M + CW / 2 + 10;
      doc.font('Helvetica-Bold').fontSize(8).fill(SLATE).text('ORDER DETAILS', rx, y + 10);
      doc.font('Helvetica').fontSize(9).fill(INK);
      doc.text(`Order No: ${order.number}`, rx, y + 22, { width: half });
      doc.text(`Order Date: ${fmtDate(order.createdAt)}`, rx, y + 34, { width: half });
      doc.text(`Booked By: ${exec?.name || '-'}${exec?.phone ? ` · ${exec.phone}` : ''}`, rx, y + 46, { width: half });
      doc.fillColor(INK);
      y += 66 + 16;

      // Items table
      y = tableHeader(doc, y);
      doc.font('Helvetica').fontSize(9);
      (order.items || []).forEach((item, i) => {
        const nameH = doc.heightOfString(item.name, { width: COLS[1].w - 10 });
        const rowH = Math.max(18, nameH + 8);
        if (y + rowH > bottomLimit(doc)) {
          y = newPage(doc);
          y = tableHeader(doc, y);
        }
        if (i % 2 === 1) doc.rect(M, y, CW, rowH).fill(LIGHT);
        doc.fillColor(INK).font('Helvetica').fontSize(9);
        const cells = {
          idx: String(i + 1),
          name: item.name,
          qty: qtyText(item.qty, item.baseUnits),
          rate: inr2(item.rate),
          amount: inr2(item.amount),
        };
        let x = M + 6;
        for (const c of COLS) {
          doc.text(cells[c.key], x, y + 5, { width: c.w - 10, align: c.align });
          x += c.w;
        }
        doc.moveTo(M, y + rowH).lineTo(M + CW, y + rowH).stroke(BORDER);
        y += rowH;
      });

      // Total band
      if (y + 26 > bottomLimit(doc)) y = newPage(doc);
      doc.rect(M, y, CW, 22).fill(GOLD);
      doc.font('Helvetica-Bold').fontSize(10).fill(MAROON);
      doc.text('TOTAL', M + 6, y + 6, { width: CW - COLS[4].w - 12, align: 'right' });
      doc.text(inr2(order.total), M + CW - COLS[4].w + 2, y + 6, { width: COLS[4].w - 12, align: 'right' });
      doc.fillColor(INK);
      y += 22 + 14;

      // Notes
      if (order.notes) {
        if (y + 40 > bottomLimit(doc)) y = newPage(doc);
        doc.font('Helvetica-Bold').fontSize(9).fill(MAROON).text('Notes', M, y);
        y += 13;
        doc.font('Helvetica').fontSize(8.5).fill(INK).text(order.notes, M, y, { width: CW });
        y += doc.heightOfString(order.notes, { width: CW }) + 14;
      }

      // Signature block
      if (y + 78 > bottomLimit(doc)) y = newPage(doc);
      const colW = CW / 2 - 16;
      const srx = M + CW / 2 + 16;
      y += 10;
      doc.font('Helvetica').fontSize(8.5).fill(SLATE);
      doc.text(`For ${brand.legalEntity}`, M, y, { width: colW });
      doc.text('Customer Acceptance', srx, y, { width: colW });
      y += 34;
      doc.moveTo(M, y).lineTo(M + colW, y).stroke(SLATE);
      doc.moveTo(srx, y).lineTo(srx + colW, y).stroke(SLATE);
      y += 5;
      doc.fontSize(8).text(`${brand.signatory.name}, ${brand.signatory.designation}`, M, y, { width: colW });
      doc.text('Name, Signature & Stamp', srx, y, { width: colW });
    } catch (err) {
      return reject(err);
    }
    doc.end();
  });
}

module.exports = { renderSalesOrderPdf };
