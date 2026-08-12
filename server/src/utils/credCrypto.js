const crypto = require('crypto');
const env = require('../config/env');
const ApiError = require('./ApiError');

/**
 * Reversible encryption for linked-mailbox SMTP passwords (AES-256-GCM).
 *
 * These credentials MUST be recoverable — nodemailer needs the plaintext
 * password at send time — so hashing is not an option, and plaintext storage
 * is unacceptable. The key is derived from the CRED_ENCRYPTION_KEY env var,
 * which never lives in the database: a DB dump alone cannot decrypt anything.
 */

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // GCM-recommended nonce size
const VERSION = 'v1'; // future-proofs the stored format against key/algo changes

let cachedKey = null;

function getKey() {
  if (cachedKey) return cachedKey;
  let secret = env.credEncryptionKey;
  if (!secret) {
    // In production a missing key must fail loudly (never fall back to a
    // guessable default); in dev a fixed key keeps the feature usable.
    if (env.isProd) {
      throw ApiError.badRequest(
        'Mailbox linking is unavailable: the server is missing the CRED_ENCRYPTION_KEY environment variable. Ask an admin to set it.'
      );
    }
    console.warn('[credCrypto] CRED_ENCRYPTION_KEY not set — using an insecure dev-only key');
    secret = 'dev-only-cred-encryption-key';
  }
  cachedKey = crypto.createHash('sha256').update(secret).digest();
  return cachedKey;
}

/** Encrypts a plaintext secret into a single storable string. */
function encrypt(plaintext) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const data = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(':');
}

/** Decrypts a blob produced by encrypt(). Throws on tampering or a rotated key. */
function decrypt(blob) {
  const [version, iv, tag, data] = String(blob).split(':');
  if (version !== VERSION || !iv || !tag || !data) {
    throw new Error('Unrecognized credential format');
  }
  const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
