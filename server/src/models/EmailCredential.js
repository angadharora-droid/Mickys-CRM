const mongoose = require('mongoose');

const PROVIDERS = ['rediffmail', 'hostinger', 'gmail', 'custom'];

/**
 * A user's linked official mailbox. Client-facing emails they trigger are sent
 * through this SMTP account (From: their address) so replies reach them
 * directly, instead of going out from the shared company account.
 *
 * The mailbox password is stored AES-256-GCM-encrypted (utils/credCrypto.js) —
 * SMTP needs it back in plaintext at send time, so it can't be hashed — and is
 * `select: false` + stripped from toJSON so it can never appear in an API
 * response by accident.
 */
const emailCredentialSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    provider: { type: String, enum: PROVIDERS, default: 'rediffmail' },
    email: { type: String, required: true, lowercase: true, trim: true },
    host: { type: String, required: true, trim: true },
    port: { type: Number, required: true },
    secure: { type: Boolean, default: true },
    passEnc: { type: String, required: true, select: false },
    // Set on every successful transporter.verify() — credentials are never
    // stored without passing a live login check first.
    verifiedAt: { type: Date },
  },
  { timestamps: true }
);

emailCredentialSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.passEnc;
  delete obj.__v;
  return obj;
};

const EmailCredential = mongoose.model('EmailCredential', emailCredentialSchema);
EmailCredential.PROVIDERS = PROVIDERS;
module.exports = EmailCredential;
