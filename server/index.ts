import { createApp } from './app';
import { applyHostedCredentials } from './boot/public-credentials';
import { config } from './config';
import { openDatabase } from './db/connection';
import { migrate } from './db/migrate';

const db = await openDatabase();
await migrate(db, (m) => console.log(`[db] ${m}`));

/**
 * First-boot demo seeding for a disposable public instance.
 *
 * Deliberately opt-in (ALLOW_DEMO_SEED) and only ever on a database with no users, so a redeploy
 * never touches data an evaluator has already entered. A seeding failure is logged rather than
 * thrown: a crash-looping web service is a worse outcome than one that starts empty and can be
 * seeded by hand.
 */
if (process.env.ALLOW_DEMO_SEED === 'true') {
  try {
    const { rows } = await db.system((q) => q.query<{ n: number }>('select count(*)::int as n from users'));
    if (rows[0].n > 0) {
      console.log('[seed] database already has users — leaving it untouched');
    } else {
      const { seedDatabase, runSeedSelfCheck } = await import('./seed/seed');
      const seed = await seedDatabase(db, (m) => console.log(`[seed] ${m}`));
      await runSeedSelfCheck(db, seed, (m) => console.log(`[seed] ${m}`));
      console.log('[seed] demo data loaded on first boot');
    }
  } catch (err) {
    console.error(`[seed] first-boot seeding failed: ${(err as Error).message}`);
  }
}

// A hosted instance replaces the published demo password with host-held secrets. No-op locally.
// Logged rather than thrown for the same reason as seeding: never crash-loop the service.
try {
  await applyHostedCredentials(db);
} catch (err) {
  console.error(`[credentials] hosted credential bootstrap failed: ${(err as Error).message}`);
}

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
// Keep idle sockets open longer than clients/proxies do, so a reused keep-alive connection is never
// closed by us mid-request (Node's 5 s default causes sporadic ECONNRESET).
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

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
