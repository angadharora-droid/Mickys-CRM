const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const ROLES = ['admin', 'sales_exec', 'pr_manager'];

// bcrypt work factor. 12 is a sensible 2020s default; the cost is embedded in
// each hash, so raising it doesn't invalidate passwords hashed at a lower cost.
const BCRYPT_ROUNDS = 12;

// One active login session (a rotated refresh token). We store only the SHA-256
// hash of the token plus timing/audit metadata so a DB leak can't replay tokens.
// createdAt is the session's first-login time and is preserved across rotation so
// the absolute-lifetime cap can't be reset by simply refreshing.
const sessionSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date, default: Date.now },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    role: { type: String, enum: ROLES, required: true, index: true },
    employeeCode: { type: String, trim: true, uppercase: true },
    phone: { type: String, trim: true },
    // Floor of 4 covers admin PINs; the role-aware rule (8+ chars for everyone,
    // 4/6-digit PIN allowed for admins) is enforced in validators/controllers.
    password: { type: String, required: true, minlength: 4, select: false },
    isActive: { type: Boolean, default: true },
    // Active login sessions (supports multiple devices, rotation + session timing).
    sessions: { type: [sessionSchema], default: [], select: false },
    // Per-account login lockout state (defence-in-depth on top of per-IP limiting).
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

// True while the account is temporarily locked after too many failed logins.
userSchema.virtual('isLocked').get(function () {
  return Boolean(this.lockUntil && this.lockUntil.getTime() > Date.now());
});

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, BCRYPT_ROUNDS);
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.statics.hashToken = function (token) {
  return crypto.createHash('sha256').update(token).digest('hex');
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.sessions;
  delete obj.failedLoginAttempts;
  delete obj.lockUntil;
  delete obj.__v;
  return obj;
};

const User = mongoose.model('User', userSchema);
User.ROLES = ROLES;
module.exports = User;
