import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, ARJUN, createTestEnv, login, PRIYA, SANJAY, userId, type Client, type TestEnv } from './helpers';

let env: TestEnv;
let admin: Client;

beforeAll(async () => {
  env = await createTestEnv();
  admin = await login(env.app, ADMIN);
});

describe('two faculty in-charges per exam hall', () => {
  it('shows both faculty of a two-faculty hall to the admin', async () => {
    const detail = (await admin.get(`/api/exams/${env.seed.exams.dbmsToday}`)).body;
    const a101 = detail.rooms.find((r: { roomNo: string }) => r.roomNo === 'A-101');
    expect(a101.inchargeIds).toHaveLength(2);
    expect(a101.inchargeName).toBe('Dr. Priya Raman, Mr. Sanjay Verma');
    // the hall appears exactly once (no duplicate rows from the join)
    expect(detail.rooms.filter((r: { roomNo: string }) => r.roomNo === 'A-101')).toHaveLength(1);
  });

  it('lets both faculty open, mark and see their co-invigilator', async () => {
    const { dbmsToday } = env.seed.exams;
    const a101 = env.seed.rooms['A-101'];
    for (const email of [PRIYA, SANJAY]) {
      const c = await login(env.app, email);
      const sheet = await c.get(`/api/attendance/${dbmsToday}/${a101}`);
      expect(sheet.status, email).toBe(200);
      expect(sheet.body.inchargeName).toBe('Dr. Priya Raman, Mr. Sanjay Verma');
      const duties = (await c.get('/api/duties')).body as { roomNo: string; examId: string }[];
      expect(duties.filter((d) => d.examId === dbmsToday && d.roomNo === 'A-101')).toHaveLength(1);
    }
    // a faculty member of another hall still cannot open it
    const arjun = await login(env.app, ARJUN);
    expect((await arjun.get(`/api/attendance/${dbmsToday}/${a101}`)).status).toBe(403);
  });

  it('assigns two faculty in one request, and rejects a third or a duplicate', async () => {
    const { mathDraft } = env.seed.exams; // C-301 currently has Priya only
    const c301 = env.seed.rooms['C-301'];
    const sanjay = await userId(env.db, SANJAY);
    const priya = await userId(env.db, PRIYA);
    const arjun = await userId(env.db, ARJUN);

    const ok = await admin.put(`/api/exams/${mathDraft}/incharges`, { assignments: [{ roomId: c301, inchargeIds: [priya, sanjay] }] });
    expect(ok.status).toBe(200);
    let room = (await admin.get(`/api/exams/${mathDraft}`)).body.rooms.find((r: { id: string }) => r.id === c301);
    expect(room.inchargeIds.sort()).toEqual([priya, sanjay].sort());

    const three = await admin.put(`/api/exams/${mathDraft}/incharges`, { assignments: [{ roomId: c301, inchargeIds: [priya, sanjay, arjun] }] });
    expect(three.status).toBe(400);
    expect(three.body.error.details.fields['assignments.0.inchargeIds']).toMatch(/at most 2/);

    const dup = await admin.put(`/api/exams/${mathDraft}/incharges`, { assignments: [{ roomId: c301, inchargeIds: [priya, priya] }] });
    expect(dup.status).toBe(400);

    // swapping one faculty member for another works without tripping the limit
    const swap = await admin.put(`/api/exams/${mathDraft}/incharges`, { assignments: [{ roomId: c301, inchargeIds: [sanjay, priya].slice(0, 1) }] });
    expect(swap.status).toBe(200);
    room = (await admin.get(`/api/exams/${mathDraft}`)).body.rooms.find((r: { id: string }) => r.id === c301);
    expect(room.inchargeIds).toEqual([sanjay]);
  });

  it('enforces the two-faculty limit in the database itself', async () => {
    await expect(
      env.db.asUser(env.seed.adminId, (q) =>
        q.query(
          `insert into incharge_assignments (exam_id, room_id, incharge_id, exam_date, session, exam_active)
           select exam_id, room_id, $3, exam_date, session, exam_active from exam_rooms where exam_id = $1 and room_id = $2`,
          [env.seed.exams.dbmsToday, env.seed.rooms['A-101'], env.seed.incharges.arjun],
        ),
      ),
    ).rejects.toThrow(/ERR_TOO_MANY_INCHARGES/);
  });

  it('still prevents one faculty member from covering two halls in the same session', async () => {
    // Arjun supervises B-202 in today's forenoon CS301 session, so he cannot also take A-101 in that slot
    const arjun = await userId(env.db, ARJUN);
    const priya = await userId(env.db, PRIYA);
    const r = await admin.put(`/api/exams/${env.seed.exams.dbmsToday}/incharges`, {
      assignments: [{ roomId: env.seed.rooms['A-101'], inchargeIds: [priya, arjun] }],
    });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/already supervises another room/);
  });

  it('can unassign a hall completely', async () => {
    const r = await admin.put(`/api/exams/${env.seed.exams.dspToday}/incharges`, { assignments: [{ roomId: env.seed.rooms['B-201'], inchargeIds: [] }] });
    expect(r.status).toBe(200);
  });
});

describe('branch-restricted examinations', () => {
  const studentId = async (roll: string) =>
    (await env.db.system((q) => q.query<{ id: string }>('select id from students where roll_no = $1', [roll]))).rows[0].id;

  it('only enrols students of the examination’s branch (criteria enrolment)', async () => {
    const depts = await env.db.system((q) =>
      q.query<{ code: string }>(
        `select distinct d.code from exam_students es join students s on s.id = es.student_id join departments d on d.id = s.department_id where es.exam_id = $1`,
        [env.seed.exams.osShortage],
      ),
    );
    expect(depts.rows.map((r) => r.code)).toEqual(['CSE']);
  });

  it('refuses to add a student from another branch, naming who was refused', async () => {
    const ece = await studentId('23ECE003');
    const r = await admin.post(`/api/exams/${env.seed.exams.osShortage}/eligible`, { mode: 'add', studentIds: [ece] });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('BRANCH_MISMATCH');
    expect(r.body.error.message).toMatch(/only for CSE students.*23ECE003 \(ECE\)/);
  });

  it('enforces the branch rule in the database even when the API is bypassed', async () => {
    const ece = await studentId('23ECE004');
    await expect(
      env.db.asUser(env.seed.adminId, (q) =>
        q.query(
          `insert into exam_students (exam_id, student_id, exam_date, session, exam_active)
           select id, $2, exam_date, session, is_active from examinations where id = $1`,
          [env.seed.exams.osShortage, ece],
        ),
      ),
    ).rejects.toThrow(/ERR_BRANCH_MISMATCH/);
  });

  it('allows any branch for a multi-department paper', async () => {
    const depts = await env.db.system((q) =>
      q.query<{ code: string }>(
        `select distinct d.code from exam_students es join students s on s.id = es.student_id join departments d on d.id = s.department_id
          where es.exam_id = $1 order by 1`,
        [env.seed.exams.mathDraft],
      ),
    );
    expect(depts.rows.map((r) => r.code)).toEqual(['CSE', 'ECE']);
  });

  it('refuses to restrict an examination to a branch while other-branch students are enrolled', async () => {
    const exam = (await admin.get(`/api/exams/${env.seed.exams.mathDraft}`)).body.exam;
    const meta = (await admin.get('/api/meta')).body;
    const cse = meta.departments.find((d: { code: string }) => d.code === 'CSE');
    const r = await admin.put(`/api/exams/${exam.id}`, {
      name: exam.name,
      examType: exam.examType,
      courseId: exam.courseId,
      departmentId: cse.id,
      year: exam.year,
      section: exam.section,
      examDate: exam.examDate,
      session: exam.session,
      startTime: exam.startTime,
      durationMinutes: exam.durationMinutes,
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('BRANCH_MISMATCH');
    expect(r.body.error.message).toMatch(/14 enrolled student\(s\) are not in CSE/);
  });

  it('refuses to move a student to another branch while they sit a branch-only exam', async () => {
    const s = (await admin.get('/api/students?q=23CSE002')).body.items[0];
    const meta = (await admin.get('/api/meta')).body;
    const ece = meta.departments.find((d: { code: string }) => d.code === 'ECE');
    const r = await admin.put(`/api/students/${s.id}`, {
      rollNo: s.rollNo,
      fullName: s.fullName,
      email: s.email,
      departmentId: ece.id,
      year: s.year,
      section: s.section,
      isActive: s.isActive,
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('BRANCH_MISMATCH');
  });
});
