const { Readable } = require('stream');
const mongoose = require('mongoose');

const BUCKET_NAME = 'kitFiles';

function bucket() {
  if (!mongoose.connection.db) throw new Error('MongoDB connection is not ready');
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: BUCKET_NAME });
}

function uploadBuffer({ buffer, filename, contentType, metadata = {} }) {
  return new Promise((resolve, reject) => {
    const upload = bucket().openUploadStream(filename, {
      contentType,
      metadata,
    });
    upload.on('error', reject);
    upload.on('finish', () => resolve(upload.id));
    Readable.from(buffer).pipe(upload);
  });
}

// Best-effort cleanup of superseded files. A missing file (already deleted) is
// benign, and any other delete error must never break the caller (e.g. a kit
// regenerate) — orphaned blobs are preferable to a failed regeneration.
function deleteFiles(ids = []) {
  return Promise.all(
    ids.filter(Boolean).map((id) =>
      bucket().delete(new mongoose.Types.ObjectId(id)).catch((err) => {
        const msg = String(err?.message || '');
        // Driver message varies by version: 'FileNotFound' vs 'File not found for id …'.
        if (err?.code === 'ENOENT' || /file ?not ?found/i.test(msg)) return;
        console.error('[fileStore] failed to delete file', String(id), '-', msg);
      })
    )
  );
}

function openDownloadStream(id) {
  return bucket().openDownloadStream(new mongoose.Types.ObjectId(id));
}

function getBuffer(id) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    openDownloadStream(id)
      .on('data', (chunk) => chunks.push(chunk))
      .on('error', reject)
      .on('end', () => resolve(Buffer.concat(chunks)));
  });
}

module.exports = { uploadBuffer, deleteFiles, openDownloadStream, getBuffer };
