const { renderSalesOrderPdf } = require('./salesOrderPdf.service');
const { sendMail } = require('./email.service');
const { escapeHtml } = require('../utils/sanitize');

/**
 * Emails a sales order out as its PDF. Two audiences share this one path so
 * both attachments are byte-identical to the document the exec can download:
 * the customer (sent by hand from the order screen) and the accounts desk
 * (sent automatically the moment an order is confirmed, when Settings says so).
 *
 * The mail goes out from the acting user's linked official mailbox when they
 * have one — the same rule the kit emails follow — so a customer replying to
 * their order reaches the person who booked it rather than a no-reply address.
 */

const inr = (n) => `Rs. ${(Number(n) || 0).toLocaleString('en-IN')}`;

const fmtDate = (d) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(d || Date.now()));

/**
 * A plain, personal-looking email (no branded card) — the covering note, a
 * small details block and the attachment line. The order itself is the PDF;
 * repeating every line item in the body would only invite the two to disagree.
 */
function orderEmailHtml(order, { message, defaultBody }) {
  const intro =
    message && message.trim()
      ? `<p style="margin:0 0 12px">${escapeHtml(message).replace(/\n/g, '<br>')}</p>`
      : `<p style="margin:0 0 12px">${defaultBody}</p>`;

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">
      ${intro}
      <table style="border-collapse:collapse;font-size:14px;margin:12px 0">
        <tr><td style="padding:2px 24px 2px 0;color:#666">Order No.</td><td><strong>${escapeHtml(order.number)}</strong></td></tr>
        <tr><td style="padding:2px 24px 2px 0;color:#666">Customer</td><td>${escapeHtml(order.customerName)}</td></tr>
        <tr><td style="padding:2px 24px 2px 0;color:#666">Order date</td><td>${escapeHtml(fmtDate(order.createdAt))}</td></tr>
        <tr><td style="padding:2px 24px 2px 0;color:#666">Items</td><td>${(order.items || []).length}</td></tr>
        <tr><td style="padding:2px 24px 2px 0;color:#666">Order value</td><td><strong>${escapeHtml(inr(order.total))}</strong></td></tr>
      </table>
      <p style="margin:12px 0 0;color:#666">The order is attached to this email as a PDF.</p>
    </div>`;
}

/**
 * Renders the order and sends it. `to` and `cc` are arrays; the caller has
 * already resolved and validated them. Returns the sendMail result plus the
 * resolved recipients and subject, which is what the order's email history is
 * written from — the subject in particular is only known here when the caller
 * left it blank.
 */
async function sendOrderEmail(order, { kind, to, cc = [], subject, message, exec, actingUser }) {
  const buffer = await renderSalesOrderPdf(order, exec);

  const defaultBody =
    kind === 'accounts'
      ? `Sales order ${escapeHtml(order.number)} for ${escapeHtml(order.customerName)} has been confirmed.
         The order is attached for invoicing.`
      : `Thank you for your order. Please find your sales order ${escapeHtml(order.number)} attached
         for your records. Do let us know if anything needs correcting.`;

  const resolvedSubject =
    (subject && subject.trim()) ||
    (kind === 'accounts'
      ? `Confirmed sales order ${order.number} — ${order.customerName}`
      : `Sales order ${order.number} — ${order.customerName}`);

  const result = await sendMail({
    to,
    cc: cc.length ? cc : undefined,
    subject: resolvedSubject,
    html: orderEmailHtml(order, { message, defaultBody }),
    // The acting user's linked mailbox (if any) takes over as the real sender;
    // fromName/replyTo only shape the shared-account fallback.
    senderUser: actingUser,
    fromName: exec?.name ? `${exec.name} via Micky's` : undefined,
    replyTo: exec?.email || undefined,
    attachments: [{ filename: `${order.number}.pdf`, content: buffer }],
  });

  return { ...result, to, cc, subject: resolvedSubject };
}

module.exports = { sendOrderEmail };
