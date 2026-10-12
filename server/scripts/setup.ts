/**
 * First-run setup for a new machine: apply migrations, and load the demo data only if the
 * database is empty (it never wipes or duplicates existing data). Safe to run repeatedly.
 */
import { config } from '../config';
import { openDatabase } from '../db/connection';
import { migrate } from '../db/migrate';
import { DEMO_PASSWORD } from '../routes/auth';
import { seedDatabase } from '../seed/seed';

const db = await openDatabase();
try {
  await migrate(db, (m) => console.log(`[setup] ${m}`));
  const users = (await db.system((q) => q.query<{ n: number }>('select count(*)::int as n from users'))).rows[0].n;
  if (users > 0) {
    console.log(`[setup] database ready (${users} accounts) at ${config.databaseUrl ? 'DATABASE_URL' : config.pgliteDataDir}`);
  } else if (config.isProd && process.env.ALLOW_DEMO_SEED !== 'true') {
    console.log('[setup] empty production database — create the first admin with `npm run user:create`.');
  } else {
    await seedDatabase(db, (m) => console.log(`[setup] ${m}`));
    console.log(`[setup] demo data loaded — demo password for every account: ${DEMO_PASSWORD}`);
  }
} finally {
  await db.close();
}
