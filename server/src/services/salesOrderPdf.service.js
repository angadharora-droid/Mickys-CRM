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
// The WEIGHT column appears only when a line carries a pack weight (frozen-list
// orders); plain Tally-ledger orders have no weight source and skip it.
const colsFor = (hasWeight) =>
  hasWeight
    ? [
        { key: 'idx', label: '#', w: 24, align: 'left' },
        { key: 'name', label: 'ITEM', w: 171, align: 'left' },
        { key: 'weight', label: 'WEIGHT', w: 70, align: 'right' },
        { key: 'qty', label: 'QTY', w: 80, align: 'right' },
        { key: 'rate', label: 'RATE', w: 80, align: 'right' },
        { key: 'amount', label: 'AMOUNT', w: 90, align: 'right' },
      ]
    : [
        { key: 'idx', label: '#', w: 24, align: 'left' },
        { key: 'name', label: 'ITEM', w: 231, align: 'left' },
        { key: 'qty', label: 'QTY', w: 90, align: 'right' },
        { key: 'rate', label: 'RATE', w: 80, align: 'right' },
        { key: 'amount', label: 'AMOUNT', w: 90, align: 'right' },
      ];

function tableHeader(doc, y, cols) {
  const W = doc.page.width - 2 * M;
  doc.rect(M, y, W, 18).fill(MAROON);
  let x = M + 6;
  doc.font('Helvetica-Bold').fontSize(8).fill('#ffffff');
  for (const c of cols) {
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

      // Customer / order info card. Appointed customers carry full details
      // (all stored in CAPS); plain orders just show the name.
      const cust = order.customer && order.customer.companyName ? order.customer : null;
      const custLines = cust
        ? [
            cust.address,
            cust.gstin ? `GSTIN: ${cust.gstin}` : null,
            cust.mobile ? `Mob: ${cust.mobile}` : null,
            cust.email || null,
          ].filter(Boolean)
        : [];
      const half = CW / 2 - 10;
      // Measured before the card is drawn. A long address wraps onto several
      // lines, and stepping a fixed 11pt per entry would print the GSTIN on
      // top of it and run the block out through the bottom of the panel.
      doc.font('Helvetica-Bold').fontSize(13);
      const nameH = doc.heightOfString(order.customerName, { width: half });
      doc.font('Helvetica').fontSize(8.5);
      const custHeights = custLines.map((l) => doc.heightOfString(l, { width: half }));
      const leftBottom = 22 + nameH + 4 + custHeights.reduce((sum, h) => sum + h + 2, 0);
      // The right column is three fixed single lines ending at y + 57.
      const cardH = Math.max(66, Math.max(leftBottom, 57) + 10);

      doc.roundedRect(M, y, CW, cardH, 6).fill(LIGHT);
      doc.fill(SLATE).font('Helvetica-Bold').fontSize(8).text('CUSTOMER', M + 12, y + 10);
      doc.font('Helvetica-Bold').fontSize(13).fill(MAROON).text(order.customerName, M + 12, y + 22, { width: half });
      doc.font('Helvetica').fontSize(8.5).fill(SLATE);
      let cy = y + 22 + nameH + 4;
      custLines.forEach((line, i) => {
        doc.text(line, M + 12, cy, { width: half });
        cy += custHeights[i] + 2;
      });
      const rx = M + CW / 2 + 10;
      doc.font('Helvetica-Bold').fontSize(8).fill(SLATE).text('SALES ORDER DETAILS', rx, y + 10);
      doc.font('Helvetica').fontSize(9).fill(INK);
      doc.text(`Order No: ${order.number}`, rx, y + 22, { width: half });
      doc.text(`Order Date: ${fmtDate(order.createdAt)}`, rx, y + 34, { width: half });
      doc.text(`Booked By: ${exec?.name || '-'}${exec?.phone ? ` · ${exec.phone}` : ''}`, rx, y + 46, { width: half });
      doc.fillColor(INK);
      y += cardH + 16;

      // Items table
      const cols = colsFor((order.items || []).some((i) => i.packSize));
      const nameCol = cols.find((c) => c.key === 'name');
      const amountCol = cols[cols.length - 1];
      y = tableHeader(doc, y, cols);
      doc.font('Helvetica').fontSize(9);
      (order.items || []).forEach((item, i) => {
        const nameH = doc.heightOfString(item.name, { width: nameCol.w - 10 });
        const rowH = Math.max(18, nameH + 8);
        if (y + rowH > bottomLimit(doc)) {
          y = newPage(doc);
          y = tableHeader(doc, y, cols);
        }
        if (i % 2 === 1) doc.rect(M, y, CW, rowH).fill(LIGHT);
        doc.fillColor(INK).font('Helvetica').fontSize(9);
        const cells = {
          idx: String(i + 1),
          name: item.name,
          weight: item.packSize || '',
          qty: qtyText(item.qty, item.baseUnits),
          rate: inr2(item.rate),
          amount: inr2(item.amount),
        };
        let x = M + 6;
        for (const c of cols) {
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
      doc.text('TOTAL', M + 6, y + 6, { width: CW - amountCol.w - 12, align: 'right' });
      doc.text(inr2(order.total), M + CW - amountCol.w + 2, y + 6, { width: amountCol.w - 12, align: 'right' });
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

      // Frozen commercial terms — appointed customers only (frozen alongside
      // their rate list at appointment time).
      const terms = cust?.terms || {};
      const headline = [
        terms.paymentTerms ? `Payment Terms: ${terms.paymentTerms}` : null,
        terms.creditPeriod ? `Credit Period: ${terms.creditPeriod}` : null,
      ].filter(Boolean);
      const clauses = (terms.termsAndConditions || '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      if (headline.length || clauses.length) {
        if (y + 40 > bottomLimit(doc)) y = newPage(doc);
        doc.font('Helvetica-Bold').fontSize(9).fill(MAROON).text('Terms & Conditions', M, y);
        y += 13;
        for (const line of headline) {
          doc.font('Helvetica-Bold').fontSize(8.5).fill(INK);
          const h = doc.heightOfString(line, { width: CW });
          if (y + h > bottomLimit(doc)) y = newPage(doc);
          doc.text(line, M, y, { width: CW });
          y += h + 2;
        }
        clauses.forEach((clause, i) => {
          doc.font('Helvetica').fontSize(8).fill(SLATE);
          const text = `${i + 1}. ${clause}`;
          const h = doc.heightOfString(text, { width: CW });
          if (y + h > bottomLimit(doc)) y = newPage(doc);
          doc.text(text, M, y, { width: CW });
          y += h + 2;
        });
        doc.fillColor(INK);
        y += 12;
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
