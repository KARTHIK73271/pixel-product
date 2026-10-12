import { createPgliteDatabase } from '../db/index';
import { migrate } from '../db/migrate';

// Applies all migrations to a throwaway in-memory database (used for CI / quick validation).
const db = createPgliteDatabase();
await migrate(db, (m) => console.log(m));
const r = await db.system((q) =>
  q.query<{ n: number }>(`select count(*)::int as n from pg_policies where schemaname = 'public'`),
);
console.log(`ok — ${r.rows[0].n} RLS policies installed`);
await db.close();
