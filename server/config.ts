import os from 'node:os';
import path from 'node:path';

try {
  process.loadEnvFile?.();
} catch {
  /* no .env file — rely on the real environment */
}

/**
 * Default embedded-database location. Cloud-sync clients (OneDrive, Dropbox, iCloud, Google Drive)
 * lock files while uploading, which makes PGlite's file layer abort — so when the project lives in
 * a synced folder, the database defaults to the local app-data directory instead of ./.data.
 */
function defaultDataDir() {
  const local = path.resolve('.data/pglite');
  if (!/[\\/](OneDrive[^\\/]*|Dropbox|iCloud ?Drive|Google ?Drive)[\\/]/i.test(local)) return local;
  const base = process.env.LOCALAPPDATA ?? path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'smart-exam-section', 'pglite');
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProd = nodeEnv === 'production';

/**
 * Express `trust proxy`. Behind a platform load balancer (Render, Railway, Fly, Koyeb) the real
 * client address arrives in X-Forwarded-For and the original scheme in X-Forwarded-Proto; without
 * this every request looks like it came from the proxy, which would collapse the per-IP sign-in
 * rate limits onto a single bucket. `loopback` stays the local default so a dev machine cannot be
 * spoofed by a forged header.
 */
function trustProxySetting(): number | string | boolean {
  const raw = process.env.TRUST_PROXY?.trim();
  if (!raw) return isProd ? 1 : 'loopback';
  if (raw === 'false') return false;
  if (raw === 'true') return true;
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}

export const config = {
  nodeEnv,
  isProd,
  isTest: nodeEnv === 'test',
  port: Number(process.env.PORT ?? 3001),
  trustProxy: trustProxySetting(),
  /** When set, connect to an external PostgreSQL server instead of embedded PGlite. */
  databaseUrl: process.env.DATABASE_URL || undefined,
  pgliteDataDir: process.env.PGLITE_DATA_DIR ? path.resolve(process.env.PGLITE_DATA_DIR) : defaultDataDir(),
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 12),
  cookieName: 'ses_sid',
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProd,
  /** Demo mode shows seeded demo credentials on the login screen. Never enable in production. */
  // In production only an explicit disposable demo (ALLOW_DEMO_SEED + DEMO_MODE, set by `npm run share`) shows them.
  demoMode: isProd
    ? process.env.DEMO_MODE === 'true' && process.env.ALLOW_DEMO_SEED === 'true'
    : process.env.DEMO_MODE
      ? process.env.DEMO_MODE === 'true'
      : true,
};
