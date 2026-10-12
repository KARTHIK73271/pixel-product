import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN,
  ARJUN,
  createTestEnv,
  ECE_STUDENT,
  login,
  PRIYA,
  STUDENT,
  userId,
  type Client,
  type TestEnv,
} from './helpers';

let env: TestEnv;
let admin: Client;
let priya: Client;
let arjun: Client;
let student: Client;
let studentUid: string;

beforeAll(async () => {
  env = await createTestEnv();
  admin = await login(env.app, ADMIN);
  priya = await login(env.app, PRIYA);
  arjun = await login(env.app, ARJUN);
  student = await login(env.app, STUDENT);
  studentUid = await userId(env.db, STUDENT);
});

describe('authentication & session handling', () => {
  it('requires a session for every API endpoint', async () => {
    for (const url of ['/api/exams', '/api/dashboard/admin', '/api/student/portal', '/api/duties', '/api/audit']) {
      const r = await request(env.app).get(url);
      expect(r.status, url).toBe(401);
    }
  });

  it('uses one generic message for unknown users and wrong passwords', async () => {
    const a = await request(env.app).post('/api/auth/login').set('X-Requested-With', 'exam-app').send({ email: ADMIN, password: 'wrong-password' });
    const b = await request(env.app).post('/api/auth/login').set('X-Requested-With', 'exam-app').send({ email: 'nobody@exam.local', password: 'x' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('issues an httpOnly SameSite cookie and never returns secrets', async () => {
    const r = await request(env.app).post('/api/auth/login').set('X-Requested-With', 'exam-app').send({ email: PRIYA, password: 'Demo@2026' });
    const cookie = String(r.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(JSON.stringify(r.body)).not.toMatch(/password|hash|scrypt/i);
  });

  it('rejects state-changing requests without the anti-CSRF header', async () => {
    const agent = request.agent(env.app);
    await agent.post('/api/auth/login').set('X-Requested-With', 'exam-app').send({ email: ADMIN, password: 'Demo@2026' });
    const r = await agent.post('/api/rooms').send({ roomNo: 'X-1', block: 'X', capacity: 10, status: 'AVAILABLE' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('CSRF');
  });

  it('validates input on the server', async () => {
    const r = await admin.post('/api/rooms', { roomNo: 'bad room!', block: '', capacity: -5, status: 'AVAILABLE' });
    expect(r.status).toBe(400);
    expect(Object.keys(r.body.error.details.fields)).toEqual(expect.arrayContaining(['roomNo', 'block', 'capacity']));
    expect((await admin.get('/api/exams/not-a-uuid')).status).toBe(400);
  });

  it('ends access immediately when an account is disabled', async () => {
    const sanjay = await login(env.app, 'sanjay.verma@exam.local');
    expect((await sanjay.get('/api/duties')).status).toBe(200);
    const id = await userId(env.db, 'sanjay.verma@exam.local');
    expect((await admin.patch(`/api/users/${id}`, { isActive: false })).status).toBe(200);
    expect((await sanjay.get('/api/duties')).status).toBe(401);
  });
});

describe('role permissions (API layer)', () => {
  it('blocks in-charges and students from admin endpoints', async () => {
    for (const c of [priya, student]) {
      expect((await c.get('/api/exams')).status).toBe(403);
      expect((await c.get('/api/dashboard/admin')).status).toBe(403);
      expect((await c.post('/api/rooms', { roomNo: 'Z-9', block: 'Z', capacity: 10, status: 'AVAILABLE' })).status).toBe(403);
      expect((await c.post(`/api/exams/${env.seed.exams.mathDraft}/publish`, {})).status).toBe(403);
    }
  });

  it('denies an in-charge access to rooms they are not assigned to', async () => {
    const { dbmsToday } = env.seed.exams;
    const a101 = env.seed.rooms['A-101']; // Priya's room
    const sheet = await arjun.get(`/api/attendance/${dbmsToday}/${a101}`);
    expect(sheet.status).toBe(403);
    const mark = await arjun.put(`/api/attendance/${dbmsToday}/${a101}/marks`, {
      marks: [{ allocationId: '00000000-0000-0000-0000-000000000000', status: 'PRESENT' }],
    });
    expect(mark.status).toBe(403);
    expect((await arjun.post(`/api/attendance/${dbmsToday}/${a101}/submit`)).status).toBe(403);
    expect((await arjun.get(`/api/reports/absentees/${dbmsToday}?roomId=${a101}`)).status).toBe(403);
    expect((await arjun.get(`/api/print/whatever`)).status).toBe(404);
  });

  it('rejects marking an allocation that belongs to another room (IDOR)', async () => {
    const { dbmsToday } = env.seed.exams;
    const foreign = (
      await env.db.system((q) =>
        q.query<{ id: string }>('select id from allocations where exam_id = $1 and room_id = $2 limit 1', [dbmsToday, env.seed.rooms['A-101']]),
      )
    ).rows[0].id;
    const r = await arjun.put(`/api/attendance/${dbmsToday}/${env.seed.rooms['B-202']}/marks`, { marks: [{ allocationId: foreign, status: 'ABSENT' }] });
    expect(r.status).toBe(400);
  });

  it('shows an in-charge only their own duties', async () => {
    const duties = (await arjun.get('/api/duties')).body as { inchargeName: string }[];
    expect(duties.length).toBeGreaterThan(0);
    expect(new Set(duties.map((d) => d.inchargeName))).toEqual(new Set(['Prof. Arjun Mehta']));
  });

  it('limits an in-charge absentee report to their assigned rooms', async () => {
    const r = await arjun.get(`/api/reports/absentees/${env.seed.exams.dbmsToday}`);
    expect(r.status).toBe(200);
    expect(r.body.scope).toBe('ASSIGNED_ROOMS');
    expect(r.body.rooms.map((x: { roomNo: string }) => x.roomNo)).toEqual(['B-202']);
  });

  it('blocks students from staff endpoints', async () => {
    const { dbmsToday } = env.seed.exams;
    expect((await student.get('/api/duties')).status).toBe(403);
    expect((await student.get(`/api/attendance/${dbmsToday}/${env.seed.rooms['A-101']}`)).status).toBe(403);
    expect((await student.get('/api/reports')).status).toBe(403);
    expect((await student.get(`/api/reports/absentees/${dbmsToday}`)).status).toBe(403);
  });
});

describe('row-level security (database layer, bypassing the API)', () => {
  it('lets a student see only their own student record', async () => {
    const rows = await env.db.asUser(studentUid, (q) => q.query<{ roll_no: string }>('select roll_no from students'));
    expect(rows.rows.map((r) => r.roll_no)).toEqual(['23CSE001']);
  });

  it('lets a student see only their own allocations', async () => {
    const rows = await env.db.asUser(studentUid, (q) => q.query<{ student_id: string }>('select distinct student_id from allocations'));
    expect(rows.rows).toHaveLength(1);
  });

  it('never exposes unpublished allocations or examinations to students', async () => {
    const { mathDraft } = env.seed.exams; // ALLOCATED (draft) — student 23CSE001 is seated in it
    const seated = await env.db.system((q) =>
      q.query('select 1 from allocations a join students s on s.id = a.student_id where a.exam_id = $1 and s.roll_no = $2', [mathDraft, '23CSE001']),
    );
    expect(seated.rows).toHaveLength(1);
    const visible = await env.db.asUser(studentUid, async (q) => ({
      allocations: (await q.query('select 1 from allocations where exam_id = $1', [mathDraft])).rows.length,
      exams: (await q.query('select 1 from examinations where id = $1', [mathDraft])).rows.length,
      eligibility: (await q.query('select 1 from exam_students where exam_id = $1', [mathDraft])).rows.length,
    }));
    expect(visible).toEqual({ allocations: 0, exams: 0, eligibility: 0 });
    const portal = (await student.get('/api/student/portal')).body;
    const ids = [...portal.upcoming, ...portal.history].map((e: { examId: string }) => e.examId);
    expect(ids).not.toContain(mathDraft);
    expect(ids).not.toContain(env.seed.exams.osShortage);
  });

  it('reveals the seat to the student once published', async () => {
    const { mathDraft } = env.seed.exams;
    expect((await admin.post(`/api/exams/${mathDraft}/publish`, {})).status).toBe(200);
    const portal = (await student.get('/api/student/portal')).body;
    const seat = portal.upcoming.find((e: { examId: string }) => e.examId === mathDraft);
    expect(seat?.roomNo).toBeTruthy();
    expect(seat?.seatNo).toBeGreaterThan(0);
  });

  it('prevents cross-student data access', async () => {
    const other = await login(env.app, ECE_STUDENT);
    const mine = (await student.get('/api/student/portal')).body;
    const theirs = (await other.get('/api/student/portal')).body;
    expect(mine.profile.rollNo).toBe('23CSE001');
    expect(theirs.profile.rollNo).toBe('23ECE001');
    expect(JSON.stringify(mine)).not.toContain('23ECE001');
    const eceUid = await userId(env.db, ECE_STUDENT);
    const leak = await env.db.asUser(eceUid, (q) => q.query("select 1 from students where roll_no = '23CSE001'"));
    expect(leak.rows).toHaveLength(0);
  });

  it('shows a student their own finalized attendance only', async () => {
    const portal = (await student.get('/api/student/portal')).body;
    const past = portal.history.find((e: { examId: string }) => e.examId === env.seed.exams.cnPast);
    expect(['PRESENT', 'ABSENT']).toContain(past.attendance);
    const rows = await env.db.asUser(studentUid, (q) => q.query('select allocation_id from attendance_records'));
    expect(rows.rows.length).toBeLessThanOrEqual(2); // own records in finalized rooms only
  });

  it('hides other in-charges’ rooms at the database level', async () => {
    const r = await env.db.asUser(env.seed.incharges.arjun, (q) =>
      q.query('select count(*)::int as n from allocations where exam_id = $1 and room_id = $2', [env.seed.exams.dbmsToday, env.seed.rooms['A-101']]),
    );
    expect(r.rows[0].n).toBe(0);
    await expect(
      env.db.asUser(env.seed.incharges.arjun, (q) =>
        q.query(
          `insert into attendance_submissions (exam_id, room_id, status) values ($1, $2, 'IN_PROGRESS')`,
          [env.seed.exams.dspToday, env.seed.rooms['B-201']],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('protects secrets and the audit trail from the application role', async () => {
    await expect(env.db.asUser(env.seed.adminId, (q) => q.query('select password_hash from users'))).rejects.toThrow(/permission denied/);
    const sessions = await env.db.asUser(env.seed.adminId, (q) => q.query('select count(*)::int as n from sessions').catch((e) => e));
    expect(sessions instanceof Error ? sessions.message : sessions.rows[0].n).toMatch(/permission denied|^0$/);
    await expect(
      env.db.asUser(env.seed.adminId, (q) =>
        q.query(`insert into audit_events (action, entity_type, summary) values ('FORGED_EVENT', 'x', 'forged')`),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(env.db.asUser(env.seed.adminId, (q) => q.query('delete from audit_events'))).rejects.toThrow(/permission denied/);
    // an in-charge cannot escalate their own role
    await expect(
      env.db.asUser(env.seed.incharges.priya, (q) => q.query(`update users set role = 'ADMIN' where id = $1`, [env.seed.incharges.priya])),
    ).rejects.toThrow(/permission denied/);
  });

  it('records the real actor in audit events (cannot be spoofed)', async () => {
    await env.db.asUser(env.seed.incharges.priya, (q) => q.query(`select app.log_event('TEST_EVENT', 'test', null, null, 'probe', '{}'::jsonb)`));
    const r = await env.db.system((q) => q.query<{ actor_name: string; actor_role: string }>(`select actor_name, actor_role from audit_events where action = 'TEST_EVENT'`));
    expect(r.rows[0]).toEqual({ actor_name: 'Dr. Priya Raman', actor_role: 'INCHARGE' });
  });

  it('keeps concurrent requests isolated (no identity bleed between transactions)', async () => {
    const ids = [env.seed.adminId, env.seed.incharges.priya, env.seed.incharges.arjun, studentUid];
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => ids[i % ids.length]).map((uid) =>
        env.db.asUser(uid, async (q) => {
          await q.query('select pg_sleep(0.002)');
          return (await q.query<{ v: string }>(`select current_setting('app.user_id', true) as v`)).rows[0].v === uid;
        }),
      ),
    );
    expect(results.every(Boolean)).toBe(true);
  });
});
