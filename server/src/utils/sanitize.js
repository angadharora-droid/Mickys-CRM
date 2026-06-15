/**
 * Small, dependency-free sanitisation helpers used across the API.
 */

/** Escapes regex metacharacters so user input is matched literally (prevents ReDoS). */
function escapeRegex(input = '') {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Builds a safe, case-insensitive "contains" RegExp from untrusted user input. */
function searchRegex(input = '') {
  return new RegExp(escapeRegex(String(input).trim()), 'i');
}

/** Escapes HTML special chars to prevent stored XSS when interpolating data into markup/emails. */
function escapeHtml(input = '') {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Recursively removes keys that could be interpreted as MongoDB query operators
 * ($-prefixed) or path traversal (dotted). Mutates in place and returns the value.
 * Leaves operator objects that the application itself builds untouched, because it
 * only ever runs against untrusted request input (body/query/params).
 */
function sanitizeMongo(value) {
  if (Array.isArray(value)) {
    value.forEach(sanitizeMongo);
    return value;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (key.startsWith('$') || key.includes('.')) {
        delete value[key];
      } else {
        sanitizeMongo(value[key]);
      }
    }
  }
  return value;
}

module.exports = { escapeRegex, searchRegex, escapeHtml, sanitizeMongo };
