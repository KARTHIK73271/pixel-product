import { PGlite, types } from '@electric-sql/pglite';
import pg from 'pg';

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  query<T = Record<string, any>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
}

export interface Database {
  kind: 'pglite' | 'postgres';
  /** Embedded only: a gzip tarball of the data directory (consistent point-in-time copy). */
  dump?: () => Promise<Blob>;
  /** Privileged transaction (table owner). Only for auth/session bookkeeping, migrations and seeding. */
  system<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  /** Transaction executed as the least-privileged `exam_app` role with Row-Level Security for `userId`. */
  asUser<T>(userId: string, fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

async function enterUserScope(q: Queryable, userId: string) {
  await q.query('set local role exam_app');
  await q.query(`select set_config('app.user_id', $1, true)`, [userId]);
}

// Consistent value shapes for both drivers: dates as 'YYYY-MM-DD', bigint/numeric as numbers.
const identity = (v: string) => v;
const toNumber = (v: string) => Number(v);

const pad = (n: number) => String(n).padStart(2, '0');
/** PGlite returns DATE columns as JS Date (UTC midnight); normalise to the canonical 'YYYY-MM-DD' text. */
const dateToIso = (v: unknown) =>
  v instanceof Date ? `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}` : v;
const numericToNumber = (v: unknown) => (typeof v === 'string' || typeof v === 'bigint' ? Number(v) : v);

function normalizeRows<T>(rows: T[], fields: { name: string; dataTypeID: number }[]): T[] {
  const fixes = fields
    .map((f) => ({
      name: f.name,
      fn: f.dataTypeID === types.DATE ? dateToIso : f.dataTypeID === types.INT8 || f.dataTypeID === types.NUMERIC ? numericToNumber : null,
    }))
    .filter((f): f is { name: string; fn: (v: unknown) => unknown } => f.fn !== null);
  if (fixes.length === 0) return rows;
  for (const row of rows as Record<string, unknown>[]) for (const f of fixes) row[f.name] = f.fn(row[f.name]);
  return rows;
}

export function createPgliteDatabase(dataDir?: string, opts: { loadDataDir?: Blob } = {}): Database {
  const db = new PGlite(dataDir, { loadDataDir: opts.loadDataDir });

  const wrap = (tx: { query: PGlite['query']; exec: PGlite['exec'] }): Queryable => ({
    async query<T>(text: string, params?: unknown[]) {
      const r = await tx.query<T>(text, params as any[]);
      return { rows: normalizeRows(r.rows, r.fields), rowCount: r.affectedRows ?? r.rows.length };
    },
    async exec(sql: string) {
      await tx.exec(sql);
    },
  });

  return {
    kind: 'pglite',
    dump: () => db.dumpDataDir('gzip'),
    system: (fn) => db.transaction((tx) => fn(wrap(tx))),
    asUser: (userId, fn) =>
      db.transaction(async (tx) => {
        const q = wrap(tx);
        await enterUserScope(q, userId);
        return fn(q);
      }),
    close: () => db.close(),
  };
}

export function createPostgresDatabase(connectionString: string): Database {
  pg.types.setTypeParser(1082, identity); // date
  pg.types.setTypeParser(20, toNumber); // int8
  pg.types.setTypeParser(1700, toNumber); // numeric
  const pool = new pg.Pool({ connectionString, max: 10 });

  async function run<T>(fn: (q: Queryable) => Promise<T>, userId?: string): Promise<T> {
    const client = await pool.connect();
    const q: Queryable = {
      async query<R>(text: string, params?: unknown[]) {
        const r = await client.query(text, params as any[]);
        return { rows: r.rows as R[], rowCount: r.rowCount ?? 0 };
      },
      async exec(sql: string) {
        await client.query(sql);
      },
    };
    try {
      await client.query('begin');
      if (userId) await enterUserScope(q, userId);
      const result = await fn(q);
      await client.query('commit');
      return result;
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  return {
    kind: 'postgres',
    system: (fn) => run(fn),
    asUser: (userId, fn) => run(fn, userId),
    close: () => pool.end(),
  };
}
