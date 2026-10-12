/**
 * Operator CLI: pre-register a staff account (e.g. bootstrap the first admin for Google sign-in).
 *
 *   npm run user:create -- --email you@university.edu --name "Dr. Your Name" --role ADMIN
 *   npm run user:create -- --email x@university.edu --name "X" --role INCHARGE --password "S3cure-pass-123"
 *
 * Without --password the account is Google-only. Runs with database-owner rights, so it is meant
 * for whoever operates the server — it is not exposed over HTTP.
 */
import { parseArgs } from 'node:util';
import { userCreateSchema } from '../../shared/schemas';
import { hashPassword } from '../auth/password';
import { openDatabase } from '../db/connection';
import { migrate } from '../db/migrate';
import { mapDatabaseError } from '../http/errors';
import { GOOGLE_ONLY_HASH } from '../services/catalog';

const { values } = parseArgs({
  options: { email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string', default: 'INCHARGE' }, password: { type: 'string' } },
});
const parsed = userCreateSchema.safeParse({ email: values.email, fullName: values.name, role: values.role?.toUpperCase(), password: values.password ?? '' });
if (!parsed.success) {
  console.error('Invalid arguments:', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  console.error('Usage: npm run user:create -- --email you@university.edu --name "Full Name" --role ADMIN|INCHARGE [--password ...]');
  process.exit(1);
}
const input = parsed.data;
const db = await openDatabase();
try {
  await migrate(db);
  const hash = input.password ? await hashPassword(input.password) : GOOGLE_ONLY_HASH;
  await db.system(async (q) => {
    const r = await q.query<{ id: string }>('insert into users (email, password_hash, role, full_name) values ($1, $2, $3, $4) returning id', [
      input.email,
      hash,
      input.role,
      input.fullName,
    ]);
    await q.query(
      `insert into audit_events (action, entity_type, entity_id, summary, metadata) values ('USER_CREATED', 'user', $1, $2, '{"via":"cli"}'::jsonb)`,
      [r.rows[0].id, `Created ${input.role.toLowerCase()} account for ${input.fullName} from the server console`],
    );
  });
  console.log(`Created ${input.role} ${input.email} (${input.password ? 'password + Google' : 'Google sign-in only'}).`);
} catch (err) {
  console.error(mapDatabaseError(err)?.message ?? (err as Error).message);
  process.exitCode = 1;
} finally {
  await db.close();
}
