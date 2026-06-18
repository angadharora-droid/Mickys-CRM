const multer = require('multer');
const env = require('../config/env');

/**
 * In-memory multipart handling for manual lead attachments (photos, PDFs,
 * spreadsheets, etc.). Files are buffered then streamed into GridFS by the
 * controller. Any file type is accepted; size is capped by MAX_FILE_SIZE_MB.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxFileSizeMb * 1024 * 1024, files: 10 },
});

module.exports = upload;
