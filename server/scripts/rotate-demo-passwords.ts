/**
 * Before putting the app on the public internet: every account that still uses the published demo
 * password gets a fresh random password, and all their sessions are signed out. The new
 * credentials are written to PUBLIC-ACCESS-CREDENTIALS.txt (git-ignored) for the owner.
 *
 *   npm run demo:lock      → rotate (run while the server is stopped)
 *   npm run demo:unlock    → put the demo password back (only after the public link is closed)
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { hashPassword, verifyPassword } from '../auth/password';
import { openDatabase } from '../db/connection';
import { migrate } from '../db/migrate';
import { DEMO_PASSWORD } from '../routes/auth';

const restore = process.argv.includes('--restore');
const OUT = 'PUBLIC-ACCESS-CREDENTIALS.txt';
// readable but strong: 4 groups of base32-ish characters, e.g. Kp7m-Qx2a-9TzR-w4Lc
const newPassword = () =>
  randomBytes(12)
    .toString('base64url')
    .replace(/[-_]/g, 'x')
    .match(/.{1,4}/g)!
    .slice(0, 4)
    .join('-');

const db = await openDatabase(() => undefined);
try {
  await migrate(db);
  if (restore) {
    const rows = fs.existsSync(OUT)
      ? fs
          .readFileSync(OUT, 'utf8')
          .split('\n')
          .map((l) => l.match(/^\s*\S+\s+(\S+@\S+)\s+/)?.[1])
          .filter((e): e is string => !!e)
      : [];
    if (!rows.length) throw new Error(`${OUT} not found — nothing to restore.`);
    const hash = await hashPassword(DEMO_PASSWORD);
    await db.system((q) => q.query('update users set password_hash = $2 where email = any($1::text[])', [rows, hash]));
    console.log(`Restored the demo password for ${rows.length} account(s).`);
  } else {
    const users = (
      await db.system((q) =>
        q.query<{ id: string; email: string; role: string; full_name: string; password_hash: string }>(
          `select id, email, role, full_name, password_hash from users where is_active order by role, email`,
        ),
      )
    ).rows;
    const lines: string[] = [];
    for (const u of users) {
      if (!(await verifyPassword(DEMO_PASSWORD, u.password_hash))) continue; // already private
      const pw = newPassword();
      const hash = await hashPassword(pw);
      await db.system(async (q) => {
        await q.query('update users set password_hash = $2 where id = $1', [u.id, hash]);
        await q.query('delete from sessions where user_id = $1', [u.id]);
      });
      lines.push(`${u.role.padEnd(9)} ${u.email.padEnd(36)} ${pw}    ${u.full_name}`);
    }
    if (!lines.length) {
      console.log('No account uses the demo password any more — nothing to rotate.');
    } else {
      fs.writeFileSync(
        OUT,
        [
          'Smart Examination Section — private credentials for the public link',
          `Generated ${new Date().toISOString()}. Keep this file private; it is git-ignored.`,
          'Restore the old demo password later with: npm run demo:unlock (only after closing the public link)',
          '',
          ...lines,
          '',
        ].join('\n'),
      );
      console.log(`Rotated ${lines.length} account(s). New credentials written to ${OUT}.`);
    }
  }
} finally {
  await db.close();
}
