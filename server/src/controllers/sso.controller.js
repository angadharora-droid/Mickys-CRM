const asyncHandler = require('../utils/asyncHandler');
const User = require('../models/User');

// GET /api/sso/users — user directory for the central sign-on admin screen,
// so accounts can be matched to portal logins without pasting a CSV. Reachable
// only with the shared secret (directoryGuard in routes). The projection names
// the public fields explicitly; secrets (password, sessions, lock state) are
// select:false on the model and never leave the server.
const listUsers = asyncHandler(async (_req, res) => {
  const users = await User.find({ isActive: true }, 'name email role').sort({ name: 1 }).lean();
  res.json(users.map((u) => ({ id: String(u._id), name: u.name, email: u.email, role: u.role })));
});

module.exports = { listUsers };
