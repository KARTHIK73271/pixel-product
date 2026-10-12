import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from './index';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

/** Applies pending SQL migrations in filename order, each inside its own transaction. */
export async function migrate(db: Database, log: (msg: string) => void = () => undefined) {
  await db.system((q) =>
    q.exec(`create table if not exists schema_migrations (
              name text primary key,
              applied_at timestamptz not null default now())`),
  );
  const applied = new Set(
    (await db.system((q) => q.query<{ name: string }>('select name from schema_migrations'))).rows.map((r) => r.name),
  );
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await db.system(async (q) => {
      await q.exec(sql);
      await q.query('insert into schema_migrations (name) values ($1)', [file]);
    });
    log(`applied ${file}`);
  }
}
