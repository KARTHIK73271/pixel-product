import { createApp } from './app';
import { config } from './config';
import { openDatabase } from './db/connection';
import { migrate } from './db/migrate';

const db = await openDatabase();
await migrate(db, (m) => console.log(`[db] ${m}`));

// Embedded mode: refresh the last-known-good snapshot after startup and periodically after writes.
const snapshot = (db as { snapshot?: () => Promise<void> }).snapshot;
let dirty = false;
if (snapshot) {
  await snapshot();
  setInterval(() => {
    if (!dirty) return;
    dirty = false;
    snapshot().catch((e) => console.error('[db] snapshot failed', e));
  }, 120_000).unref();
}

const app = createApp(db, { onMutation: () => (dirty = true) });
const server = app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port} (${db.kind}${db.kind === 'pglite' ? `: ${config.pgliteDataDir}` : ''})`);
});

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  server.close();
  server.closeAllConnections?.();
  try {
    await db.close(); // snapshots, flushes PGlite and releases the data-directory lock
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGBREAK', shutdown);
