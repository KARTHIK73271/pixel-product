import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Role } from '../../shared/schemas';
import { config } from '../config';
import type { Database, Queryable } from '../db/index';
import { forbidden, unauthorized } from '../http/errors';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  studentId: string | null;
}

export interface RequestContext {
  user: AuthUser;
  /** Run work in a transaction with Row-Level Security scoped to the current user. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
}

declare module 'express-serve-static-core' {
  interface Request {
    ctx?: RequestContext;
  }
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export async function createSession(db: Database, userId: string, meta: { ip?: string; userAgent?: string }) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3600_000);
  await db.system(async (q) => {
    // opportunistic cleanup of expired sessions
    await q.query('delete from sessions where expires_at < now()');
    await q.query(
      `insert into sessions (user_id, token_hash, expires_at, ip, user_agent) values ($1, $2, $3, $4, $5)`,
      [userId, sha256(token), expiresAt.toISOString(), meta.ip ?? null, meta.userAgent?.slice(0, 300) ?? null],
    );
    await q.query('update users set last_login_at = now() where id = $1', [userId]);
  });
  return { token, expiresAt };
}

export async function destroySession(db: Database, token: string) {
  await db.system((q) => q.query('delete from sessions where token_hash = $1', [sha256(token)]));
}

export async function resolveSession(db: Database, token: string): Promise<AuthUser | null> {
  const r = await db.system((q) =>
    q.query<{ id: string; email: string; full_name: string; role: Role; student_id: string | null }>(
      `select u.id, u.email, u.full_name, u.role, st.id as student_id
         from sessions s
         join users u on u.id = s.user_id
         left join students st on st.user_id = u.id and st.is_active
        where s.token_hash = $1 and s.expires_at > now() and u.is_active`,
      [sha256(token)],
    ),
  );
  const row = r.rows[0];
  if (!row) return null;
  return { id: row.id, email: row.email, fullName: row.full_name, role: row.role, studentId: row.student_id };
}

export function sessionCookieOptions(expires?: Date) {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax' as const,
    path: '/',
    ...(expires ? { expires } : {}),
  };
}

/** Attaches req.ctx when a valid session cookie is present. */
export function authenticate(db: Database) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = req.cookies?.[config.cookieName];
      if (typeof token === 'string' && token.length > 20 && token.length < 100) {
        const user = await resolveSession(db, token);
        if (user) req.ctx = { user, tx: (fn) => db.asUser(user.id, fn) };
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.ctx) return next(unauthorized());
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.ctx) return next(unauthorized());
    if (!roles.includes(req.ctx.user.role)) return next(forbidden());
    next();
  };
}

export function ctxOf(req: Request): RequestContext {
  if (!req.ctx) throw unauthorized();
  return req.ctx;
}
