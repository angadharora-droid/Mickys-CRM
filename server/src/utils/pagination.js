/**
 * Parse pagination params from query string with sane bounds.
 */
function getPagination(query) {
  const page = Math.max(parseInt(query.page || '1', 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit || '10', 10) || 10, 1), 100);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

function buildMeta(total, page, limit) {
  return {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
    hasNext: page * limit < total,
    hasPrev: page > 1,
  };
}

module.exports = { getPagination, buildMeta };
