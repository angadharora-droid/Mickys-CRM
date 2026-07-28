const app = require('./app');
const env = require('./config/env');
const connectDB = require('./config/db');
const { startMetaSync } = require('./services/metaSync.service');

async function main() {
  try {
    await connectDB();
    app.listen(env.port, () => {
      console.log(`[server] Mickys PO API running on http://localhost:${env.port} (${env.nodeEnv})`);
    });
    // Poll the Meta Ads lead sheet in-process, so new leads arrive on their own.
    startMetaSync();
  } catch (err) {
    console.error('[server] failed to start:', err.message);
    process.exit(1);
  }
}

process.on('unhandledRejection', (err) => {
  console.error('[server] unhandled rejection:', err);
});

main();
