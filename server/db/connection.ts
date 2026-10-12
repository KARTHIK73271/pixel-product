import fs from 'node:fs';
import { config } from '../config';
import { createPgliteDatabase, createPostgresDatabase, type Database } from './index';
import { acquireDataDirLock } from './lock';

/** Transient file locks (antivirus, sync clients) can make a first open fail; retry with a fresh instance. */
async function openWithRetry(dir: string, attempts = 3): Promise<Database> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const db = createPgliteDatabase(dir);
    try {
      await db.system((q) => q.query('select 1'));
      return db;
    } catch (err) {
      lastErr = err;
      await db.close().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

/**
 * Opens the configured database: external PostgreSQL when DATABASE_URL is set, otherwise embedded
 * PGlite with two safeguards:
 *  1. an exclusive directory lock (two processes on one PGlite directory can corrupt it);
 *  2. a last-known-good snapshot (`<dir>.snapshot.tgz`, written atomically). If the directory
 *     ever fails to open, it is moved aside and the snapshot is restored automatically.
 */
export async function openDatabase(log: (m: string) => void = console.log): Promise<Database> {
  if (config.databaseUrl) return createPostgresDatabase(config.databaseUrl);
  const dir = config.pgliteDataDir;
  const snapshotFile = `${dir}.snapshot.tgz`;
  fs.mkdirSync(dir, { recursive: true });
  const release = await acquireDataDirLock(dir);

  let db: Database;
  try {
    db = await openWithRetry(dir);
  } catch (err) {
    if (!fs.existsSync(snapshotFile)) {
      release();
      throw new Error(`Embedded database at ${dir} failed to open (${(err as Error).message}) and no snapshot exists. Run \`npm run db:reset\`.`);
    }
    const aside = `${dir}.corrupt-${Date.now()}`;
    fs.renameSync(dir, aside);
    fs.mkdirSync(dir, { recursive: true });
    log(`[db] WARNING: database failed to open; moved it to ${aside} and restored the last snapshot (${fs.statSync(snapshotFile).mtime.toISOString()}).`);
    db = createPgliteDatabase(dir, { loadDataDir: new Blob([fs.readFileSync(snapshotFile)]) });
    await db.system((q) => q.query('select 1'));
  }

  let snapshotting: Promise<void> | null = null;
  const snapshot = async () => {
    if (snapshotting) return snapshotting;
    snapshotting = (async () => {
      const blob = await db.dump!();
      const tmp = `${snapshotFile}.tmp`;
      fs.writeFileSync(tmp, Buffer.from(await blob.arrayBuffer()));
      fs.renameSync(tmp, snapshotFile); // atomic replace: never a half-written snapshot
    })().finally(() => {
      snapshotting = null;
    });
    return snapshotting;
  };

  return {
    ...db,
    snapshot,
    async close() {
      try {
        await snapshot().catch((e) => log(`[db] snapshot on shutdown failed: ${(e as Error).message}`));
        await db.close();
      } finally {
        release();
      }
    },
  } as Database & { snapshot: () => Promise<void> };
}
