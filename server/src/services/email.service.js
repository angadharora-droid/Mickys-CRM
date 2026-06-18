const fs = require('fs');
const path = require('path');
const env = require('../config/env');
const Setting = require('../models/Setting');
const { escapeHtml } = require('../utils/sanitize');

let resendClient = null; // cached Resend SDK instance

/**
 * Resolves the active email provider from .env + DB settings (Admin > Settings).
 * Resend is preferred whenever RESEND_API_KEY is set; SMTP is the fallback.
 * Returns null when email is disabled/unconfigured so callers can skip silently.
 */
async function getProvider() {
  const settings = await Setting.getGlobal();
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

async function sendMail({ to, subject, html, attachments = [], replyTo, fromName, cc, bcc }) {
  const provider = await getProvider();
  if (!provider) {
    console.warn(`[email] skipped "${subject}" — email provider not configured`);
    return { skipped: true };
  }
  // Keep the verified/authenticated sending address but show the exec's name when provided.
  const from = fromName ? `"${fromName}" <${addressOf(provider.from)}>` : provider.from;
  const payload = { from, to, subject, html, attachments, replyTo, cc, bcc };

  const messageId =
    provider.type === 'resend'
      ? await sendViaResend(provider, payload)
      : await sendViaSmtp(provider, payload);

  console.log(`[email] sent "${subject}" to ${to} via ${provider.type} (${messageId})`);
  return { skipped: false, messageId };
}

// Extracts the bare address from a "Name <addr@host>" or plain "addr@host" string.
function addressOf(from) {
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1] : from;
}

function baseTemplate(title, bodyHtml) {
  return `
  <div style="font-family:Segoe UI,Arial,sans-serif;background:#faf9f7;padding:24px">
    <div style="max-width:640px;margin:auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e2ddd7">
      <div style="background:#6F0E13;color:#fff;padding:18px 24px">
        <h2 style="margin:0;font-size:18px">Micky&rsquo;s &mdash; Sales CRM</h2>
      </div>
      <div style="padding:24px;color:#2a2220">
        <h3 style="margin-top:0;color:#6F0E13">${title}</h3>
        ${bodyHtml}
      </div>
      <div style="padding:14px 24px;background:#f4f1ec;color:#6a6767;font-size:12px">
        Rasoi Ki Taiyaari, Micky&rsquo;s Ki Zimmedari.
      </div>
    </div>
  </div>`;
}

/**
 * Sends a generated sales kit to the client. Uses the shared SMTP account but
 * presents the assigned exec as the sender (From name + Reply-To) so client
 * replies reach them. The kit inbox is BCC'd for record-keeping. Each kit
 * document is attached separately (as its own PDF). Skips silently when no
 * email provider is configured.
 */
async function sendKitEmail({ lead, exec, to, cc, subject, message, files = [], bcc }) {
  const recipient = to || lead.email;
  if (!recipient) return { skipped: true, reason: 'No recipient email' };

  const kitLabel = lead.kitType === 'distributor' ? 'Distributor' : 'Institutional';
  const intro =
    message && message.trim()
      ? `<p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`
      : `<p>Dear ${escapeHtml(lead.contactPerson || lead.businessName)},</p>
         <p>Please find attached your Micky&rsquo;s ${kitLabel} sales kit. It includes our rate card,
         ${lead.kitType === 'distributor' ? 'term sheet' : 'quotation'} and supporting documents.
         We look forward to partnering with you.</p>`;

  const html = baseTemplate(
    `Micky's ${kitLabel} Sales Kit`,
    `${intro}
     <table style="width:100%;font-size:14px;margin:16px 0">
       <tr><td style="color:#6a6767;padding:4px 0;width:150px">Reference</td><td><strong>${escapeHtml(lead.refNumber)}</strong></td></tr>
       <tr><td style="color:#6a6767;padding:4px 0">Prepared for</td><td>${escapeHtml(lead.businessName)}</td></tr>
       <tr><td style="color:#6a6767;padding:4px 0">Sales Executive</td><td>${escapeHtml(exec?.name || '-')}${exec?.phone ? ' · ' + escapeHtml(exec.phone) : ''}</td></tr>
     </table>
     <p style="color:#6a6767;font-size:13px">The kit documents are attached to this email.</p>`
  );

  return sendMail({
    to: recipient,
    cc,
    bcc,
    subject: subject || `Micky's Sales Kit for ${lead.businessName} — Ref: ${lead.refNumber}`,
    html,
    fromName: exec?.name ? `${exec.name} via Micky's` : undefined,
    replyTo: exec?.email || undefined,
    attachments: files.map((f) => (
      typeof f === 'string'
        ? { filename: path.basename(f), path: f }
        : f
    )),
  });
}

module.exports = { sendMail, sendKitEmail };
