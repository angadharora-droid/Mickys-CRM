const app = require('./app');
const env = require('./config/env');
const connectDB = require('./config/db');

async function main() {
  try {
    await connectDB();
    app.listen(env.port, () => {
      console.log(`[server] Mickys PO API running on http://localhost:${env.port} (${env.nodeEnv})`);
    });
  } catch (err) {
    console.error('[server] failed to start:', err.message);
    process.exit(1);
  }
}

process.on('unhandledRejection', (err) => {
  console.error('[server] unhandled rejection:', err);
});

main();
