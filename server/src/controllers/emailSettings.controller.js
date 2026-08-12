const nodemailer = require('nodemailer');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const EmailCredential = require('../models/EmailCredential');
const { encrypt } = require('../utils/credCrypto');
const { sharedMailboxStatus, emailDomain } = require('../services/email.service');
const { logActivity } = require('../services/activity.service');

/**
 * Per-user linked mailbox (Email settings). Every endpoint operates strictly
 * on the authenticated user's own credential — there is no way to read or
 * write anyone else's, and the mailbox password never leaves the server.
 */

// Preset providers are resolved server-side so the client can never smuggle a
// mismatched host under a well-known provider name.
const SMTP_PRESETS = {
  rediffmail: { host: 'smtp.rediffmailpro.com', port: 465, secure: true },
  hostinger: { host: 'smtp.hostinger.com', port: 465, secure: true },
  gmail: { host: 'smtp.gmail.com', port: 587, secure: false }, // STARTTLS
};

// What the API exposes about a linked mailbox: connection details only, never
// any form of the password.
function credStatus(cred) {
  if (!cred) return { linked: false };
  return {
    linked: true,
    provider: cred.provider,
    email: cred.email,
    host: cred.host,
    port: cred.port,
    secure: cred.secure,
    verifiedAt: cred.verifiedAt,
  };
}

// Translates nodemailer verify() failures into something a salesperson can act on.
function verifyErrorMessage(err, host, port) {
  const code = err?.code || '';
  if (code === 'EAUTH') {
    return 'The mail server rejected this email/password combination. Check both and try again (Gmail accounts need an App Password, not the regular password).';
  }
  if (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'EDNS', 'ECONNREFUSED'].includes(code)) {
    return `Could not reach the mail server at ${host}:${port}. Check the host/port (and your network) and try again.`;
  }
  return `Mailbox verification failed: ${err?.message || 'unknown error'}`;
}

// GET /api/email-settings — status only (configured/email/host/port), plus
// whether the shared company account exists so the UI can explain the fallback.
const getEmailSettings = asyncHandler(async (req, res) => {
  const [cred, company] = await Promise.all([
    EmailCredential.findOne({ userId: req.user._id }),
    sharedMailboxStatus(),
  ]);
  res.json({ success: true, data: { ...credStatus(cred), company } });
});

// PUT /api/email-settings — link or replace the caller's official mailbox.
// The SMTP login is verified against the mail server BEFORE anything is
// stored; bad credentials are rejected immediately and nothing changes.
const updateEmailSettings = asyncHandler(async (req, res) => {
  const { provider, password } = req.body;
  const email = String(req.body.email).trim().toLowerCase();

  const preset = SMTP_PRESETS[provider];
  const host = preset ? preset.host : String(req.body.host || '').trim();
  const port = preset ? preset.port : Number(req.body.port);
  // Custom defaults to SSL on 465, STARTTLS otherwise, unless stated explicitly.
  const secure = preset ? preset.secure : typeof req.body.secure === 'boolean' ? req.body.secure : port === 465;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    // Same EHLO hostname the real sends use — strict servers (Rediffmail Pro)
    // reject the container's own hostname with "550 Invalid HeloHost".
    name: emailDomain(email),
    requireTLS: !secure, // STARTTLS ports must still never send the password in the clear
    auth: { user: email, pass: password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  try {
    await transporter.verify();
  } catch (err) {
    throw ApiError.badRequest(verifyErrorMessage(err, host, port));
  } finally {
    transporter.close();
  }

  const passEnc = encrypt(password); // AES-256-GCM; throws (operational) if the server key is missing
  const cred = await EmailCredential.findOneAndUpdate(
    { userId: req.user._id },
    { provider, email, host, port, secure, passEnc, verifiedAt: new Date() },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  await logActivity({
    userId: req.user._id, action: 'MAILBOX_LINKED', entity: 'EmailCredential', entityId: cred._id,
    details: `Linked official mailbox ${email} (${host}:${port})`, ip: req.ip,
  });

  const company = await sharedMailboxStatus();
  res.json({
    success: true,
    message: `Mailbox verified and linked — client emails you send will now go out from ${email}`,
    data: { ...credStatus(cred), company },
  });
});

// DELETE /api/email-settings — unlink the caller's mailbox (falls back to the
// company account for future sends).
const deleteEmailSettings = asyncHandler(async (req, res) => {
  const cred = await EmailCredential.findOneAndDelete({ userId: req.user._id });
  if (!cred) throw ApiError.notFound('No linked mailbox to remove');

  await logActivity({
    userId: req.user._id, action: 'MAILBOX_UNLINKED', entity: 'EmailCredential', entityId: cred._id,
    details: `Unlinked official mailbox ${cred.email}`, ip: req.ip,
  });

  const company = await sharedMailboxStatus();
  res.json({
    success: true,
    message: 'Mailbox unlinked — client emails will use the company account instead',
    data: { linked: false, company },
  });
});

module.exports = { getEmailSettings, updateEmailSettings, deleteEmailSettings };
