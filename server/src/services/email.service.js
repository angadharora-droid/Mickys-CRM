const fs = require('fs');
const path = require('path');
const env = require('../config/env');
const Setting = require('../models/Setting');
const EmailCredential = require('../models/EmailCredential');
const ApiError = require('../utils/ApiError');
const { decrypt } = require('../utils/credCrypto');
const { escapeHtml } = require('../utils/sanitize');

let resendClient = null; // cached Resend SDK instance

/**
 * Resolves the shared company email provider from .env + DB settings
 * (Admin > Settings). Resend is preferred whenever RESEND_API_KEY is set;
 * SMTP is the fallback. Returns null when email is disabled/unconfigured so
 * callers can skip silently.
 */
async function getProvider(settings) {
  settings = settings || (await Setting.getGlobal());
  const dbEmail = settings.email || {};
  if (dbEmail.enabled === false) return null; // admin kill-switch

  const from = dbEmail.from || env.smtp.from;

  // 1. Resend wins whenever an API key is present in .env.
  if (env.resend.apiKey) {
    return { type: 'resend', from, apiKey: env.resend.apiKey };
  }

  // 2. A fully-filled SMTP block in Admin > Settings takes over, used as one
  //    unit so DB and .env are never mixed (no field silently shadowing another).
  if (dbEmail.host && dbEmail.user && dbEmail.pass) {
    return {
      type: 'smtp',
      from,
      smtp: {
        host: dbEmail.host,
        port: dbEmail.port || 587,
        secure: !!dbEmail.secure,
        auth: { user: dbEmail.user, pass: dbEmail.pass },
      },
    };
  }

  // 3. Otherwise email is driven entirely from .env (the default path).
  if (env.smtp.host && env.smtp.user && env.smtp.pass) {
    return {
      type: 'smtp',
      from,
      smtp: {
        host: env.smtp.host,
        port: env.smtp.port,
        secure: env.smtp.secure,
        auth: { user: env.smtp.user, pass: env.smtp.pass },
      },
    };
  }

  return null;
}

/**
 * Resolves a user's linked official mailbox (Email settings) into an SMTP
 * provider, or null when they haven't linked one. Throws when the stored
 * password can't be decrypted (e.g. CRED_ENCRYPTION_KEY was rotated) so a
 * stale credential fails loudly instead of silently sending from the wrong
 * account.
 */
async function getUserProvider(userId) {
  if (!userId) return null;
  const cred = await EmailCredential.findOne({ userId }).select('+passEnc');
  if (!cred) return null;
  let pass;
  try {
    pass = decrypt(cred.passEnc);
  } catch (err) {
    console.error(`[email] failed to decrypt linked mailbox for user ${userId}: ${err.message}`);
    throw ApiError.badRequest(
      'Your linked mailbox could not be used — the stored password is unreadable. Re-link it under Email settings.'
    );
  }
  return {
    type: 'smtp',
    personal: true,
    email: cred.email,
    from: cred.email,
    smtp: {
      host: cred.host,
      port: cred.port,
      secure: cred.secure,
      // On STARTTLS ports (secure=false) refuse to fall back to plaintext —
      // the mailbox password must never cross the wire unencrypted.
      requireTLS: !cred.secure,
      auth: { user: cred.email, pass },
    },
  };
}

/**
 * Whether the shared company account can send, and its from-address — used by
 * the Email settings page and the send dialog to show who a mail would go
 * out as.
 */
async function sharedMailboxStatus() {
  const provider = await getProvider();
  return { configured: !!provider, email: provider ? addressOf(provider.from) : '' };
}

// Resend wants attachment bytes inline; read any local file path into a Buffer.
function toResendAttachments(attachments = []) {
  return attachments.map((a) => ({
    filename: a.filename,
    content: a.content || fs.readFileSync(a.path),
  }));
}

async function sendViaResend(provider, { from, to, subject, html, attachments, replyTo, cc, bcc }) {
  if (!resendClient) {
    const { Resend } = require('resend');
    resendClient = new Resend(provider.apiKey);
  }
  const resendAttachments = toResendAttachments(attachments);
  const { data, error } = await resendClient.emails.send({
    from,
    to,
    cc: cc || undefined,
    bcc: bcc || undefined,
    replyTo: replyTo || undefined,
    subject,
    html,
    attachments: resendAttachments.length ? resendAttachments : undefined,
  });
  if (error) throw new Error(`Resend send failed: ${error.message || JSON.stringify(error)}`);
  return data?.id;
}

async function sendViaSmtp(provider, { from, to, subject, html, attachments, replyTo, cc, bcc }) {
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport(provider.smtp);
  const info = await transporter.sendMail({
    from,
    to,
    cc: cc || undefined,
    bcc: bcc || undefined,
    replyTo: replyTo || undefined,
    subject,
    html,
    attachments,
  });
  return info.messageId;
}

async function sendMail({ to, subject, html, attachments = [], replyTo, fromName, cc, bcc, senderUser }) {
  const settings = await Setting.getGlobal();
  if ((settings.email || {}).enabled === false) {
    console.warn(`[email] skipped "${subject}" — email is disabled in Settings`);
    return { skipped: true, reason: 'disabled' };
  }

  // A linked personal mailbox wins for user-triggered emails: the message goes
  // out from the sender's own official account so replies land in their inbox.
  let provider = senderUser ? await getUserProvider(senderUser._id) : null;
  let from;
  if (provider) {
    const safeName = String(senderUser.name || '').replace(/["\\]/g, '').trim();
    from = safeName ? `"${safeName}" <${provider.email}>` : provider.email;
  } else {
    provider = await getProvider(settings);
    if (provider) {
      // Keep the verified/authenticated sending address but show the exec's name when provided.
      from = fromName ? `"${fromName}" <${addressOf(provider.from)}>` : provider.from;
    }
  }
  if (!provider) {
    console.warn(`[email] skipped "${subject}" — no email provider configured`);
    return { skipped: true, reason: 'not-configured' };
  }
  const payload = { from, to, subject, html, attachments, replyTo, cc, bcc };

  const messageId =
    provider.type === 'resend'
      ? await sendViaResend(provider, payload)
      : await sendViaSmtp(provider, payload);

  const via = provider.personal ? 'personal mailbox' : provider.type;
  console.log(`[email] sent "${subject}" to ${to} via ${via} (${messageId})`);
  return {
    skipped: false,
    messageId,
    provider: provider.type,
    from: addressOf(from),
    sentVia: provider.personal ? 'personal' : 'company',
  };
}

// Extracts the bare address from a "Name <addr@host>" or plain "addr@host" string.
function addressOf(from) {
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1] : from;
}

/**
 * Sends a generated sales kit to the client. Sent from the acting user's
 * linked official mailbox when they've set one up under Email settings (so
 * the From address is genuinely theirs and replies reach them); otherwise it
 * falls back to the shared company account, presenting the assigned exec as
 * the sender (From name + Reply-To). The kit inbox is BCC'd for
 * record-keeping. Each kit document is attached separately (as its own PDF).
 */
async function sendKitEmail({ lead, exec, actingUser, to, cc, subject, message, files = [], bcc }) {
  const recipient = to || lead.email;
  if (!recipient) return { skipped: true, reason: 'No recipient email' };

  const kitLabel =
    lead.kitType === 'stockist' ? 'Stockist' : lead.kitType === 'institutional' ? 'Institutional'
      : lead.kitType === 'export' ? 'Export' : 'Distributor';
  // Distributor & stockist kits carry a term sheet; institutional carries a
  // quotation; the export kit is an export rate card + brochure.
  const isTermSheet = lead.kitType === 'distributor' || lead.kitType === 'stockist';
  const defaultBody =
    lead.kitType === 'export'
      ? `Please find attached your Micky&rsquo;s Export kit. It includes our export rate card and product brochure.
         We look forward to partnering with you.`
      : `Please find attached your Micky&rsquo;s ${kitLabel} sales kit. It includes our rate card,
         ${isTermSheet ? 'term sheet' : 'quotation'} and supporting documents.
         We look forward to partnering with you.`;
  const intro =
    message && message.trim()
      ? `<p style="margin:0 0 12px">${escapeHtml(message).replace(/\n/g, '<br>')}</p>`
      : `<p style="margin:0 0 12px">Dear ${escapeHtml(lead.contactPerson || lead.businessName)},</p>
         <p style="margin:0 0 12px">${defaultBody}</p>`;

  // A plain, personal-looking email (no branded card/header/footer) — just the
  // message, a small details block and the attachment note.
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">
      ${intro}
      <table style="border-collapse:collapse;font-size:14px;margin:12px 0">
        <tr><td style="padding:2px 24px 2px 0;color:#666">Reference</td><td><strong>${escapeHtml(lead.refNumber)}</strong></td></tr>
        <tr><td style="padding:2px 24px 2px 0;color:#666">Prepared for</td><td>${escapeHtml(lead.businessName)}</td></tr>
        <tr><td style="padding:2px 24px 2px 0;color:#666">Sales Executive</td><td>${escapeHtml(exec?.name || '-')}${exec?.phone ? ' · ' + escapeHtml(exec.phone) : ''}</td></tr>
      </table>
      <p style="margin:12px 0 0;color:#666">The kit documents are attached to this email.</p>
    </div>`;

  const resolvedSubject =
    subject || `Micky's Sales Kit for ${lead.businessName} — Ref: ${lead.refNumber}`;
  const attachments = files.map((f) =>
    typeof f === 'string' ? { filename: path.basename(f), path: f } : f
  );

  const result = await sendMail({
    to: recipient,
    cc,
    bcc,
    subject: resolvedSubject,
    html,
    // The acting user's linked mailbox (if any) takes over as the real sender;
    // fromName/replyTo only shape the shared-account fallback.
    senderUser: actingUser,
    fromName: exec?.name ? `${exec.name} via Micky's` : undefined,
    replyTo: exec?.email || undefined,
    attachments,
  });

  // Surface the rendered email so callers can log exactly what went out (the
  // body and resolved subject aren't otherwise known outside this function).
  return {
    ...result,
    to: recipient,
    cc: Array.isArray(cc) ? cc : cc ? [cc] : [],
    bcc: bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : [],
    subject: resolvedSubject,
    html,
    attachments: attachments.map((a) => a.filename),
  };
}

module.exports = { sendMail, sendKitEmail, sharedMailboxStatus };
