const app = require('./app');
const env = require('./config/env');
const connectDB = require('./config/db');
const { startMetaSync } = require('./services/metaSync.service');
const { startFxSync } = require('./services/fx.service');

async function main() {
  try {
    await connectDB();
    app.listen(env.port, () => {
      console.log(`[server] Mickys PO API running on http://localhost:${env.port} (${env.nodeEnv})`);
    });
    // Poll the Meta Ads lead sheet in-process, so new leads arrive on their own.
    startMetaSync();
    // Refresh the export-kit exchange rates daily, so cards never use stale FX.
    startFxSync();
  } catch (err) {
    console.error('[server] failed to start:', err.message);
    process.exit(1);
  }
}

process.on('unhandledRejection', (err) => {
  console.error('[server] unhandled rejection:', err);
});

main();
