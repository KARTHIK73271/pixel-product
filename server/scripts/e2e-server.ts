/**
 * End-to-end test server: a fresh, seeded, file-backed database in a temp directory and the
 * production build of the SPA served by Express on E2E_PORT. Used by playwright.config.ts.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.join(os.tmpdir(), 'smart-exam-e2e', 'pglite');
fs.rmSync(path.dirname(dir), { recursive: true, force: true });
process.env.PGLITE_DATA_DIR = dir;
process.env.NODE_ENV = 'production';
process.env.COOKIE_SECURE = 'false'; // plain http://localhost during tests
process.env.PORT = process.env.E2E_PORT ?? '3101';

const { openDatabase } = await import('../db/connection');
const { migrate } = await import('../db/migrate');
const { seedDatabase } = await import('../seed/seed');
const { createApp } = await import('../app');

const db = await openDatabase();
await migrate(db);
await seedDatabase(db);
createApp(db).listen(Number(process.env.PORT), () => console.log(`[e2e] ready on http://localhost:${process.env.PORT}`));
const stop = async () => {
  await db.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
