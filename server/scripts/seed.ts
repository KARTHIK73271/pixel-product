import { config } from '../config';
import { openDatabase } from '../db/connection';
import { migrate } from '../db/migrate';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../routes/auth';
import { runSeedSelfCheck, seedDatabase } from '../seed/seed';

if (config.isProd && process.env.ALLOW_DEMO_SEED !== 'true') {
  console.error('Refusing to load demo data with NODE_ENV=production. Set ALLOW_DEMO_SEED=true only for a disposable demo instance.');
  process.exit(1);
}

const db = await openDatabase();
try {
  await migrate(db, (m) => console.log(`[db] ${m}`));
  const seed = await seedDatabase(db, (m) => console.log(`[seed] ${m}`));
  await runSeedSelfCheck(db, seed, (m) => console.log(`[seed] ${m}`));
  console.log('\nDemo accounts (development only) — password for all:', DEMO_PASSWORD);
  for (const a of DEMO_ACCOUNTS) console.log(`  ${a.label.padEnd(32)} ${a.email}`);
  console.log('  Any student: <rollno>@student.exam.local, e.g. 23ece004@student.exam.local');
} catch (err) {
  console.error(`[seed] ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
