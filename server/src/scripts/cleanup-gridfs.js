/**
 * One-time storage reclaim for the kitFiles GridFS bucket.
 *
 * Historically every generated kit stored, in MongoDB:
 *   - a copy of the 15.6 MB static brochure (identical for every lead), and
 *   - the full kit ZIP (which itself contains the brochure again),
 * costing ~30 MB per lead and filling the 512 MB Atlas quota.
 *
 * The app now serves the brochure from disk and assembles the ZIP on demand, so
 * neither needs to live in the database. This script removes the already-stored
 * brochure + ZIP blobs, sweeps any orphaned chunks left by past failed deletes,
 * and clears the now-dangling fileId references on leads. Only the small per-lead
 * PDFs remain in GridFS.
 *
 * Deletes free space even while the cluster is write-blocked over quota, so they
 * run first; the lead reference updates run afterwards once space is reclaimed.
 *
 * Usage:
 *   node src/scripts/cleanup-gridfs.js          # dry run (reports, no changes)
 *   node src/scripts/cleanup-gridfs.js --apply  # delete blobs + clear references
 */
const mongoose = require('mongoose');
const env = require('../config/env');
const Lead = require('../models/Lead');

const BUCKET_NAME = 'kitFiles';
// docTypes that are now served from disk / built on demand and must not persist.
const REDUNDANT_DOC_TYPES = ['KitZip', 'Brochure'];
const APPLY = process.argv.includes('--apply');

const mb = (bytes) => `${(Number(bytes || 0) / (1024 * 1024)).toFixed(2)} MB`;

async function dbUsedBytes(db) {
  const stats = await db.command({ dbStats: 1, scale: 1 });
  return (stats.dataSize || 0) + (stats.indexSize || 0);
}

async function run() {
  await mongoose.connect(env.mongoUri);
  const db = mongoose.connection.db;
  console.log(`[cleanup] connected to ${mongoose.connection.name} (${APPLY ? 'APPLY' : 'DRY RUN'})`);
  console.log(`[cleanup] storage in use before: ${mb(await dbUsedBytes(db))}`);

  const filesColl = db.collection(`${BUCKET_NAME}.files`);
  const chunksColl = db.collection(`${BUCKET_NAME}.chunks`);
  const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: BUCKET_NAME });

  // 1) Brochure + ZIP blobs — identified by their stored metadata.docType.
  const targets = await filesColl
    .find({ 'metadata.docType': { $in: REDUNDANT_DOC_TYPES } })
    .project({ _id: 1, length: 1, filename: 1, 'metadata.docType': 1 })
    .toArray();
  const reclaimable = targets.reduce((sum, t) => sum + (t.length || 0), 0);
  console.log(
    `[cleanup] redundant blobs: ${targets.length} file(s), ${mb(reclaimable)} ` +
      `(${REDUNDANT_DOC_TYPES.join(', ')})`
  );

  if (APPLY) {
    let deleted = 0;
    for (const t of targets) {
      try {
        await bucket.delete(t._id);
        deleted += 1;
      } catch (err) {
        const msg = String(err?.message || '');
        if (!/file ?not ?found/i.test(msg)) console.error(`  failed to delete ${t._id}: ${msg}`);
      }
    }
    console.log(`[cleanup] deleted ${deleted}/${targets.length} redundant blob(s)`);
  }

  // 2) Orphaned chunks — chunks whose parent file no longer exists (left behind
  //    by past best-effort deletes). bucket.delete above handles current files;
  //    this mops up the rest.
  const liveIds = new Set((await filesColl.distinct('_id')).map(String));
  const chunkFileIds = await chunksColl.distinct('files_id');
  const orphanIds = chunkFileIds.filter((id) => !liveIds.has(String(id)));
  const orphanCount = orphanIds.length
    ? await chunksColl.countDocuments({ files_id: { $in: orphanIds } })
    : 0;
  console.log(`[cleanup] orphaned chunks: ${orphanCount} (across ${orphanIds.length} missing file(s))`);
  if (APPLY && orphanIds.length) {
    const r = await chunksColl.deleteMany({ files_id: { $in: orphanIds } });
    console.log(`[cleanup] deleted ${r.deletedCount} orphaned chunk(s)`);
  }

  // 3) Clear dangling references on leads (writes — run after deletes free space).
  //    Stored zip blobs are gone (ZIP is built on demand) and brochure entries
  //    now serve from disk, so their fileIds must be blanked.
  const zipRefs = await Lead.countDocuments({ 'zipFile.fileId': { $nin: ['', null] } });
  const brochureRefs = await Lead.countDocuments({
    generatedFiles: { $elemMatch: { static: true, fileId: { $nin: ['', null] } } },
  });
  console.log(`[cleanup] lead references to clear: ${zipRefs} zip fileId(s), ${brochureRefs} brochure fileId(s)`);
  if (APPLY) {
    const z = await Lead.updateMany(
      { 'zipFile.fileId': { $nin: ['', null] } },
      { $set: { 'zipFile.fileId': '' } }
    );
    const b = await Lead.updateMany(
      { 'generatedFiles.static': true },
      { $set: { 'generatedFiles.$[el].fileId': '' } },
      { arrayFilters: [{ 'el.static': true, 'el.fileId': { $nin: ['', null] } }] }
    );
    console.log(`[cleanup] cleared ${z.modifiedCount} zip ref(s), ${b.modifiedCount} lead(s) brochure ref(s)`);
  }

  console.log(`[cleanup] storage in use after:  ${mb(await dbUsedBytes(db))}`);
  if (!APPLY) console.log('[cleanup] DRY RUN — re-run with --apply to delete and free space.');
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
