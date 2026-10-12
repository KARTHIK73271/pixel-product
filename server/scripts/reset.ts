import fs from 'node:fs';
import { config } from '../config';
import { createPostgresDatabase } from '../db/index';
import { acquireDataDirLock } from '../db/lock';

/** Wipes the development database. Seed again afterwards with `npm run db:seed`. */
if (config.isProd && process.env.ALLOW_DEMO_SEED !== 'true') {
  console.error('Refusing to reset a production database.');
  process.exit(1);
}

if (config.databaseUrl) {
  const db = createPostgresDatabase(config.databaseUrl);
  await db.system((q) =>
    q.exec(`drop schema if exists app cascade; drop schema public cascade; create schema public;
            drop owned by exam_app; drop role if exists exam_app;`),
  );
  await db.close();
  console.log('[db] PostgreSQL schemas dropped');
} else {
  // Take the directory lock so we never delete a database another process has open.
  const release = await acquireDataDirLock(config.pgliteDataDir, 3_000);
  fs.rmSync(config.pgliteDataDir, { recursive: true, force: true });
  fs.rmSync(`${config.pgliteDataDir}.snapshot.tgz`, { force: true });
  release();
  console.log(`[db] removed ${config.pgliteDataDir}`);
}
