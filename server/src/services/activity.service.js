const ActivityLog = require('../models/ActivityLog');

/**
 * Fire-and-forget audit trail writer. Never throws — audit failures
 * must not break the main request flow.
 */
async function logActivity({ userId, action, entity, entityId, details = '', meta = {}, ip = '' }) {
  try {
    await ActivityLog.create({ userId, action, entity, entityId, details, meta, ip });
  } catch (err) {
    console.error('[activity] failed to write log:', err.message);
  }
}

module.exports = { logActivity };
