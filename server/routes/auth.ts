import { Router } from 'express';
import { loginSchema } from '../../shared/schemas';
import { burnPasswordCheck, verifyPassword } from '../auth/password';
import { createSession, destroySession, sessionCookieOptions } from '../auth/session';
import { config } from '../config';
import type { Database } from '../db/index';
import { AppError, asyncHandler, parse, unauthorized } from '../http/errors';

/** Fixed-window limiter for login attempts, keyed by IP + email (in-memory; per process). */
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 10;

function checkRateLimit(key: string) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  entry.count++;
  if (entry.count > MAX_ATTEMPTS) {
    throw new AppError(429, 'RATE_LIMITED', 'Too many sign-in attempts. Please wait a few minutes and try again.');
  }
}

export const DEMO_ACCOUNTS = [
  { role: 'ADMIN', email: 'admin@exam.local', label: 'Examination Admin' },
  { role: 'INCHARGE', email: 'priya.raman@exam.local', label: 'In-Charge · Dr. Priya Raman' },
  { role: 'INCHARGE', email: 'arjun.mehta@exam.local', label: 'In-Charge · Prof. Arjun Mehta' },
  { role: 'STUDENT', email: '23cse001@student.exam.local', label: 'Student · Aarav Sharma' },
];
export const DEMO_PASSWORD = 'Demo@2026';

export function authRoutes(db: Database) {
  const r = Router();

  r.post(
    '/login',
    asyncHandler(async (req, res) => {
      const { email, password } = parse(loginSchema, req.body);
      checkRateLimit(`${req.ip}|${email}`);
      const user = (
        await db.system((q) =>
          q.query<{ id: string; password_hash: string; is_active: boolean }>(
            'select id, password_hash, is_active from users where email = $1',
            [email],
          ),
        )
      ).rows[0];
      if (!user) {
        await burnPasswordCheck(password);
        throw unauthorized('Invalid email or password.');
      }
      const ok = await verifyPassword(password, user.password_hash);
      if (!ok || !user.is_active) throw unauthorized('Invalid email or password.');
      attempts.delete(`${req.ip}|${email}`);
      const { token, expiresAt } = await createSession(db, user.id, { ip: req.ip, userAgent: req.get('user-agent') });
      res.cookie(config.cookieName, token, sessionCookieOptions(expiresAt));
      await db.asUser(user.id, (q) =>
        q.query(`select app.log_event('USER_SIGNED_IN', 'user', $1, null, 'Signed in', '{}'::jsonb)`, [user.id]),
      );
      const me = await db.system((q) =>
        q.query(
          `select u.id, u.email, u.full_name as "fullName", u.role, s.id as "studentId"
             from users u left join students s on s.user_id = u.id where u.id = $1`,
          [user.id],
        ),
      );
      res.json({ user: me.rows[0] });
    }),
  );

  r.post(
    '/logout',
    asyncHandler(async (req, res) => {
      const token = req.cookies?.[config.cookieName];
      if (typeof token === 'string') await destroySession(db, token);
      res.clearCookie(config.cookieName, sessionCookieOptions());
      res.json({ ok: true });
    }),
  );

  // Session probe: 200 with user=null when signed out (keeps the browser console free of expected 401s).
  r.get('/me', (req, res) => {
    res.json({ user: req.ctx?.user ?? null });
  });

  r.get('/demo', (_req, res) => {
    res.json(config.demoMode ? { enabled: true, password: DEMO_PASSWORD, accounts: DEMO_ACCOUNTS } : { enabled: false });
  });

  return r;
}
