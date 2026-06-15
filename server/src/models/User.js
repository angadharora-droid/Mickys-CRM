const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const ROLES = ['admin', 'sales_exec'];

// bcrypt work factor. 12 is a sensible 2020s default; the cost is embedded in
// each hash, so raising it doesn't invalidate passwords hashed at a lower cost.
const BCRYPT_ROUNDS = 12;

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
    password: { type: String, required: true, minlength: 8, select: false },
    isActive: { type: Boolean, default: true },
    // SHA-256 hashes of issued refresh tokens (supports multiple devices + rotation)
    refreshTokens: { type: [String], default: [], select: false },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

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
  delete obj.refreshTokens;
  delete obj.__v;
  return obj;
};

const User = mongoose.model('User', userSchema);
User.ROLES = ROLES;
module.exports = User;
