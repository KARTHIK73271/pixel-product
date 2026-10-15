/**
 * Credential bootstrap for a permanently hosted instance.
 *
 * A hosted link is reachable by anyone who knows the URL, so the published demo password
 * (`Demo@2026`) must never be a working credential there. On every boot the seeded sample
 * accounts are re-pointed at passwords only the deployment's owner can read — values held by
 * the host as environment variables (Render generates and displays them), never in the repo.
 *
 *   ADMIN_PASSWORD   → the ADMIN account (default admin@exam.local, override with ADMIN_EMAIL)
 *   STAFF_PASSWORD   → the other seeded accounts (in-charge and student sample logins)
 *
 * Scope is deliberately limited to the seeded demo identities, recognised by their reserved
 * `exam.local` domain. A real account added later (a staff member's actual address, a Google
 * sign-in) is never touched, so this cannot overwrite a genuine user's credentials.
 *
 * Within that scope the environment is authoritative, and the work is done on every boot rather
 * than once. Two reasons: a free host with no persistent disk re-seeds from scratch after an
 * idle shutdown, which would otherwise restore the published password; and the owner rotating
 * ADMIN_PASSWORD in the dashboard should actually take effect on the next deploy. Nothing in
 * the application can set a password, so there is no user-chosen password here to clobber.
 *
 * With neither variable set (local development) this is a no-op.
 */
import { hashPassword, verifyPassword } from '../auth/password';
import type { Database } from '../db/index';
import { DEMO_PASSWORD } from '../routes/auth';

type Row = { id: string; email: string; role: string; password_hash: string };

/** The reserved domains the seed uses. Anything else is a real account and is left alone. */
const SEEDED_DOMAINS = ['@exam.local', '@student.exam.local'];

export async function applyHostedCredentials(db: Database, log: (m: string) => void = console.log): Promise<void> {
  const adminPassword = process.env.ADMIN_PASSWORD?.trim();
  const staffPassword = process.env.STAFF_PASSWORD?.trim();
  if (!adminPassword && !staffPassword) return;

  const adminEmail = (process.env.ADMIN_EMAIL?.trim() || 'admin@exam.local').toLowerCase();

  // Refuse to weaken anything: a host-supplied password must beat the one it replaces.
  for (const [name, value] of [
    ['ADMIN_PASSWORD', adminPassword],
    ['STAFF_PASSWORD', staffPassword],
  ] as const) {
    if (!value) continue;
    if (value.length < 12) {
      log(`[credentials] ${name} is shorter than 12 characters — ignoring it rather than setting a weak password`);
      return;
    }
    if (value === DEMO_PASSWORD) {
      log(`[credentials] ${name} is the published demo password — ignoring it`);
      return;
    }
  }

  const users = (
    await db.system((q) => q.query<Row>('select id, email, role, password_hash from users where is_active order by role, email'))
  ).rows;

  let changed = 0;
  for (const u of users) {
    const email = u.email.toLowerCase();
    if (!SEEDED_DOMAINS.some((d) => email.endsWith(d))) continue;
    const target = email === adminEmail || u.role === 'ADMIN' ? adminPassword : staffPassword;
    if (!target) continue;
    if (await verifyPassword(target, u.password_hash)) continue; // already correct — most boots end here
    const hash = await hashPassword(target);
    await db.system(async (q) => {
      await q.query('update users set password_hash = $2 where id = $1', [u.id, hash]);
      await q.query('delete from sessions where user_id = $1', [u.id]); // old password must not keep a live session
    });
    changed++;
  }

  if (changed > 0) log(`[credentials] applied host-held passwords to ${changed} seeded account(s); the demo password no longer works`);
}
