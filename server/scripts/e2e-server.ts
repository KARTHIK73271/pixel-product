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

// Fake Google identity provider so the browser can complete the full OAuth round-trip offline.
const E2E_FAKE_GOOGLE_PORT = Number(process.env.E2E_FAKE_GOOGLE_PORT ?? 3102);
const { startFakeGoogle } = await import('../testing/fake-google');
const fakeGoogle = await startFakeGoogle({
  port: E2E_FAKE_GOOGLE_PORT,
  clientId: 'e2e-client.apps.googleusercontent.com',
  clientSecret: 'e2e-client-secret',
  accounts: [
    { email: 'admin@exam.local', name: 'Dr. Kavitha Subramanian' },
    { email: 'priya.raman@exam.local', name: 'Dr. Priya Raman' },
    { email: '23cse001@student.exam.local', name: 'Aarav Sharma' },
    { email: 'stranger@gmail.com', name: 'Unregistered Visitor' },
  ],
});
Object.assign(process.env, fakeGoogle.env, {
  GOOGLE_REDIRECT_URI: `http://localhost:${process.env.PORT}/api/auth/google/callback`,
});

const { openDatabase } = await import('../db/connection');
const { migrate } = await import('../db/migrate');
const { seedDatabase } = await import('../seed/seed');
const { createApp } = await import('../app');

const db = await openDatabase();
await migrate(db);
await seedDatabase(db);
const server = createApp(db).listen(Number(process.env.PORT), () => console.log(`[e2e] ready on http://localhost:${process.env.PORT}`));
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
const stop = async () => {
  await db.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
