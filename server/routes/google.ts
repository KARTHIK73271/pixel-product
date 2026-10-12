import { Router, type Response } from 'express';
import type { Role } from '../../shared/schemas';
import { exchangeCode, googleConfig, newAuthorization, OAuthError, safeReturnTo, sha256, verifyIdToken } from '../auth/google';
import { createSession, sessionCookieOptions } from '../auth/session';
import { config } from '../config';
import type { Database } from '../db/index';
import { asyncHandler } from '../http/errors';

const STATE_COOKIE = 'oauth_state';
const TX_TTL_MS = 10 * 60_000;
const homeFor = (role: Role) => (role === 'ADMIN' ? '/dashboard' : role === 'INCHARGE' ? '/duties' : '/my');

/** Reasons shown on the login page (see LoginPage OAUTH_MESSAGES). */
type FailReason =
  | 'not_configured'
  | 'cancelled'
  | 'state'
  | 'not_registered'
  | 'disabled'
  | 'identity_mismatch'
  | 'unverified_email'
  | 'domain'
  | 'failed'
  | 'rate_limited';

// Abuse brake on starting sign-ins. Generous on purpose: a whole campus often shares one NAT'd IP,
// and each start only writes one short-lived row.
const starts = new Map<string, { count: number; resetAt: number }>();
function startAllowed(ip: string) {
  const limit = Number(process.env.OAUTH_START_LIMIT ?? 300);
  const now = Date.now();
  const e = starts.get(ip);
  if (!e || e.resetAt < now) {
    starts.set(ip, { count: 1, resetAt: now + TX_TTL_MS });
    return true;
  }
  return ++e.count <= limit;
}

export function googleRoutes(db: Database) {
  const r = Router();
  const stateCookie = (maxAge?: number) => ({
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax' as const, // must survive the top-level redirect back from accounts.google.com
    path: '/api/auth/google',
    ...(maxAge ? { maxAge } : {}),
  });

  const fail = (res: Response, reason: FailReason, extra: Record<string, string> = {}) => {
    const base = googleConfig()?.appUrl ?? '';
    res.clearCookie(STATE_COOKIE, stateCookie());
    res.redirect(303, `${base}/login?${new URLSearchParams({ oauth_error: reason, ...extra })}`);
  };

  const auditRejection = (summary: string, metadata: Record<string, unknown>) =>
    db
      .system((q) =>
        q.query(
          `insert into audit_events (action, entity_type, summary, metadata) values ('SIGN_IN_REJECTED', 'auth', $1, $2::jsonb)`,
          [summary, JSON.stringify(metadata)],
        ),
      )
      .catch((e) => console.error('[auth] failed to audit rejected sign-in', e));

  // Step 1 — send the browser to Google.
  r.get(
    '/start',
    asyncHandler(async (req, res) => {
      const cfg = googleConfig();
      if (!cfg) return fail(res, 'not_configured');
      if (req.ctx) return res.redirect(303, `${cfg.appUrl}${homeFor(req.ctx.user.role)}`); // already signed in
      if (!startAllowed(req.ip ?? 'unknown')) return fail(res, 'rate_limited');

      const auth = newAuthorization(cfg);
      await db.system(async (q) => {
        await q.query('delete from oauth_transactions where expires_at < now()');
        await q.query(
          `insert into oauth_transactions (state_hash, nonce, code_verifier, return_to, expires_at) values ($1, $2, $3, $4, $5)`,
          [sha256(auth.state), auth.nonce, auth.codeVerifier, safeReturnTo(req.query.returnTo), new Date(Date.now() + TX_TTL_MS).toISOString()],
        );
      });
      res.cookie(STATE_COOKIE, auth.state, stateCookie(TX_TTL_MS));
      res.set('Cache-Control', 'no-store');
      res.redirect(303, auth.url);
    }),
  );

  // Step 2 — Google redirects back here.
  r.get(
    '/callback',
    asyncHandler(async (req, res) => {
      const cfg = googleConfig();
      if (!cfg) return fail(res, 'not_configured');
      const { code, state, error } = req.query as Record<string, string | undefined>;
      if (error) return fail(res, error === 'access_denied' ? 'cancelled' : 'failed');

      // The state must match the one bound to this browser, and the transaction is consumed exactly once.
      const cookieState = req.cookies?.[STATE_COOKIE];
      if (typeof state !== 'string' || typeof code !== 'string' || typeof cookieState !== 'string' || cookieState !== state) {
        return fail(res, 'state');
      }
      const tx = (
        await db.system((q) =>
          q.query<{ nonce: string; code_verifier: string; return_to: string | null; expired: boolean }>(
            `delete from oauth_transactions where state_hash = $1
             returning nonce, code_verifier, return_to, expires_at < now() as expired`,
            [sha256(state)],
          ),
        )
      ).rows[0];
      if (!tx || tx.expired) return fail(res, 'state');

      let identity;
      try {
        const idToken = await exchangeCode(cfg, code, tx.code_verifier);
        identity = await verifyIdToken(cfg, idToken, tx.nonce);
      } catch (err) {
        const reason = err instanceof OAuthError ? err.reason : 'exchange_failed';
        console.warn(`[auth] Google sign-in failed: ${(err as Error).message}`);
        if (reason === 'unverified_email') return fail(res, 'unverified_email');
        if (reason === 'domain') return fail(res, 'domain');
        return fail(res, 'failed');
      }

      // Match a pre-registered account: by bound Google subject first, otherwise by verified email.
      type Row = { id: string; role: Role; is_active: boolean; google_sub: string | null; email: string };
      const outcome = await db.system(async (q): Promise<{ ok: true; user: Row } | { ok: false; reason: FailReason }> => {
        let user = (await q.query<Row>('select id, role, is_active, google_sub, email from users where google_sub = $1', [identity.sub])).rows[0];
        if (!user) {
          user = (await q.query<Row>('select id, role, is_active, google_sub, email from users where email = $1 for update', [identity.email])).rows[0];
          if (!user) return { ok: false, reason: 'not_registered' };
          if (user.google_sub && user.google_sub !== identity.sub) return { ok: false, reason: 'identity_mismatch' };
        }
        if (!user.is_active) return { ok: false, reason: 'disabled' };
        if (!user.google_sub) await q.query('update users set google_sub = $2 where id = $1', [user.id, identity.sub]);
        return { ok: true, user };
      });

      if (!outcome.ok) {
        await auditRejection(`Google sign-in refused for ${identity.email} (${outcome.reason.replace('_', ' ')})`, {
          email: identity.email,
          reason: outcome.reason,
          ip: req.ip,
        });
        return fail(res, outcome.reason, outcome.reason === 'not_registered' ? { email: identity.email } : {});
      }

      const { user } = outcome;
      const { token, expiresAt } = await createSession(db, user.id, { ip: req.ip, userAgent: req.get('user-agent') });
      res.clearCookie(STATE_COOKIE, stateCookie());
      res.cookie(config.cookieName, token, sessionCookieOptions(expiresAt));
      await db.asUser(user.id, (q) =>
        q.query(`select app.log_event('USER_SIGNED_IN', 'user', $1, null, 'Signed in with Google', $2::jsonb)`, [
          user.id,
          JSON.stringify({ method: 'google' }),
        ]),
      );
      res.redirect(303, `${cfg.appUrl}${tx.return_to ?? homeFor(user.role)}`);
    }),
  );

  return r;
}
